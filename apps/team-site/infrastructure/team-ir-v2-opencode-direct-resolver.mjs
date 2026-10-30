import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { TeamBindingError } from "../../../dist/team-ir/index.js";
import {
  authorizeTeamIrReviewer,
  loadRole,
  makePrompt,
  outputJsonSchema,
  validateModelOutput
} from "./team-ir-v2-opencode-docker-resolver.mjs";

const HERE = new URL("./team-ir-v2-opencode-docker-pins.json", import.meta.url);
const PINS = JSON.parse(await readFile(HERE, "utf8"));
const TOOL_PINS = JSON.parse(await readFile(new URL("./team-ir-v2-opencode-tool-pins.json", import.meta.url), "utf8"));
const ENDPOINT = "http://127.0.0.1:4096";
const MODEL_REF = PINS.modelRef;
const ADAPTER_VERSION = "ogs-opencode-direct-adapter/14";
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const running = new Map();

function disabledTools() {
  return Object.fromEntries(TOOL_PINS.toolIds.map((toolId) => [toolId, false]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadPassword() {
  const passwordFile = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
  if (!passwordFile || !passwordFile.startsWith("/")) {
    throw new Error("TEAM_IR_OPENCODE_PASSWORD_FILE_REQUIRED: set an absolute path to the local serve password file.");
  }
  const passwordStat = await stat(passwordFile);
  if ((passwordStat.mode & 0o077) !== 0) throw new Error("TEAM_IR_OPENCODE_PASSWORD_FILE_PERMISSIONS: password file must be owner-only.");
  const secretFile = (await readFile(passwordFile, "utf8")).trim();
  const match = /^(?:export\s+)?OPENCODE_API_KEY\s*=\s*(.*)$/.exec(secretFile);
  if (!match) throw new Error("TEAM_IR_OPENCODE_PASSWORD_FILE_FORMAT: expected exactly one OPENCODE_API_KEY assignment.");
  let password = match[1].trim();
  if ((password.startsWith("\"") && password.endsWith("\"")) || (password.startsWith("'") && password.endsWith("'"))) {
    password = password.slice(1, -1);
  }
  if (password.length < 16 || password.length > 256) throw new Error("TEAM_IR_OPENCODE_PASSWORD_INVALID");
  return password;
}

async function readArtifacts(invocation) {
  const refs = invocation.input?.artifacts;
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) return {};
  if (typeof invocation.artifactResolver?.read !== "function") throw new TeamBindingError("Authorized Artifact reader is unavailable.", "policy");
  const contents = {};
  for (const [slotId, ref] of Object.entries(refs)) {
    if (!ref || !/^art_[A-Za-z0-9_-]{8,128}$/.test(ref.artifactId)
      || !["text/markdown", "text/plain"].includes(ref.mediaType)) {
      throw new TeamBindingError("Only authorized text Artifacts are accepted by this Binding.", "policy");
    }
    const bytes = Buffer.from(await invocation.artifactResolver.read(ref.artifactId));
    if (bytes.length > MAX_ARTIFACT_BYTES) throw new TeamBindingError("Artifact exceeds the configured size limit.", "invalid_input");
    contents[slotId] = { mediaType: ref.mediaType, text: bytes.toString("utf8") };
  }
  return contents;
}

function authHeader(password) {
  return "Basic " + Buffer.from("opencode:" + password).toString("base64");
}

async function requestJson(url, { headers, body, signal }) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    });
  } catch (error) {
    if (signal.aborted) throw new TeamBindingError("OpenCode invocation was cancelled.", "cancelled");
    if (error?.name === "TimeoutError") throw new TeamBindingError("OpenCode request timed out.", "timeout");
    throw new TeamBindingError("OpenCode service request failed.", "transport");
  }
  if (!response.ok) {
    const failureClass = response.status === 429 ? "rate_limited" : response.status >= 500 ? "server_error" : "policy";
    throw new TeamBindingError("OpenCode service returned HTTP " + response.status + ".", failureClass);
  }
  const chunks = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new TeamBindingError("OpenCode response body is unavailable.", "invalid_output");
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TeamBindingError("OpenCode response exceeds the configured size limit.", "invalid_output");
    }
    chunks.push(Buffer.from(value));
  }
  const bytes = Buffer.concat(chunks, size);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new TeamBindingError("OpenCode service returned malformed JSON.", "invalid_output");
  }
}

function getResponseText(response) {
  const parts = response?.parts;
  if (!Array.isArray(parts) || parts.some((part) => !part || typeof part !== "object" || typeof part.type !== "string")) {
    throw new TeamBindingError("OpenCode response parts are invalid.", "invalid_output", "OUTPUT_PARTS_UNSUPPORTED");
  }
  const structured = parts.filter((part) => part.type === "tool" && part.tool === "StructuredOutput");
  const hasUnexpectedTool = parts.some((part) => part.type === "tool" && part.tool !== "StructuredOutput");
  if (structured.length) {
    if (hasUnexpectedTool) throw new TeamBindingError("OpenCode returned an additional tool call with structured output.", "invalid_output", "OUTPUT_PARTS_UNEXPECTED_TOOL");
    if (structured.length !== 1) throw new TeamBindingError("OpenCode returned multiple structured outputs.", "invalid_output", "OUTPUT_PARTS_MULTIPLE_STRUCTURED");
    const result = structured[0].state;
    if (result?.status !== "completed" || !result.input || typeof result.input !== "object" || Array.isArray(result.input)) {
      throw new TeamBindingError("OpenCode structured response is incomplete.", "invalid_output", "OUTPUT_TEXT_MISSING");
    }
    return JSON.stringify(result.input);
  }
  if (hasUnexpectedTool) throw new TeamBindingError("OpenCode returned an unexpected tool call instead of text output.", "invalid_output", "OUTPUT_PARTS_UNEXPECTED_TOOL");
  if (!parts.some((part) => part.type === "text") || parts.some((part) => !["text", "reasoning", "step-start", "step-finish"].includes(part.type))) {
    throw new TeamBindingError("OpenCode response contains no usable text output part.", "invalid_output", "OUTPUT_PARTS_UNSUPPORTED");
  }
  if (parts.some((part) => part.type === "text" && typeof part.text !== "string")) {
    throw new TeamBindingError("OpenCode response text is invalid.", "invalid_output", "OUTPUT_TEXT_MISSING");
  }
  return parts.filter((part) => part.type === "text").map((part) => part.text).join("");
}

export async function resolveTeamIrReleaseClosure({ teamIR }) {
  if (!teamIR || !Array.isArray(teamIR.agents) || !Array.isArray(teamIR.bindings)) throw new Error("TEAM_IR_CLOSURE_INVALID");
  const packageDigests = {};
  const packageSchemas = {};
  for (const agent of teamIR.agents) {
    const role = await loadRole(agent.packageRef);
    packageDigests[agent.packageRef] = role.digest;
    packageSchemas["schemas/roles/" + agent.packageRef.replaceAll(":", "/").replaceAll("@", "/") + "/output.schema.json"] = role.outputSchema;
  }
  const bindingDigests = {};
  for (const binding of teamIR.bindings) {
    if (binding.kind !== "model" || binding.modelRef !== PINS.modelRef) throw new Error("TEAM_IR_BINDING_NOT_ALLOWLISTED: " + binding.id);
    bindingDigests[binding.id] = sha256(JSON.stringify({ kind: binding.kind, modelRef: binding.modelRef, adapter: ADAPTER_VERSION, endpoint: ENDPOINT }));
  }
  return {
    complete: true,
    packageDigests,
    packageSchemas,
    bindingDigests,
    adapterVersions: { model: ADAPTER_VERSION },
    schemaDigests: {
      opencodeEndpoint: sha256(ENDPOINT),
      model: sha256(PINS.modelRef),
      reviewAuthorization: sha256("ogs-local-os-principal-review-authorization/1")
    }
  };
}

// Only immutable package and adapter summaries are exposed to Studio. The
// local serve credential and endpoint remain resolver-internal.
export function getTeamIrAuthoringCatalog() {
  return {
    version: "team-ir-authoring-catalog/1",
    packages: Object.entries(PINS.packages || {}).map(([ref, pin]) => ({ ref, label: ref, version: ref.split("@").at(-1) || "1", digest: pin.digest })),
    bindings: [{
      ref: "binding:model",
      label: MODEL_REF,
      version: ADAPTER_VERSION,
      kind: "model",
      modelRef: PINS.modelRef,
      adapterVersion: ADAPTER_VERSION
    }]
  };
}

export { authorizeTeamIrReviewer };

export async function resolveBindings({ teamIR, closure }) {
  const expectedClosure = await resolveTeamIrReleaseClosure({ teamIR });
  if (closure?.adapterVersions?.model !== ADAPTER_VERSION
    || Object.entries(expectedClosure.bindingDigests).some(([id, digest]) => closure?.bindingDigests?.[id] !== digest)
    || Object.entries(expectedClosure.packageDigests).some(([ref, digest]) => closure?.packageDigests?.[ref] !== digest)) {
    throw new Error("TEAM_IR_DIRECT_RESOLVER_CLOSURE_MISMATCH");
  }
  const password = await loadPassword();
  const agentsByBinding = new Map(teamIR.agents.map((agent) => [agent.bindingRef, agent]));
  const roles = new Map();
  const bindings = {};
  for (const binding of teamIR.bindings) {
    if (binding.kind !== "model" || binding.modelRef !== MODEL_REF) throw new Error("TEAM_IR_BINDING_NOT_ALLOWLISTED: " + binding.id);
    const agent = agentsByBinding.get(binding.id);
    if (!agent) throw new Error("TEAM_IR_BINDING_AGENT_MISSING: " + binding.id);
    let role = roles.get(agent.packageRef);
    if (!role) {
      role = await loadRole(agent.packageRef);
      roles.set(agent.packageRef, role);
    }
    bindings[binding.id] = {
      async invoke(invocation) {
        const controller = new AbortController();
        const key = invocation.idempotencyKey;
        running.set(key, controller);
        try {
          const input = { ...(invocation.input || {}), artifacts: await readArtifacts(invocation) };
          const prompt = makePrompt({ role, input, invocation, agent });
          const headers = { authorization: authHeader(password), "content-type": "application/json" };
          const created = await requestJson(ENDPOINT + "/session", {
            headers, signal: controller.signal, body: { title: "Team IR model invocation" }
          });
          if (!/^[A-Za-z0-9_-]{1,128}$/.test(created?.id ?? "")) throw new TeamBindingError("OpenCode session response is invalid.", "invalid_output");
          const [providerID, modelID] = MODEL_REF.split("/");
          const response = await requestJson(ENDPOINT + "/session/" + created.id + "/message", {
            headers,
            signal: controller.signal,
            body: {
              model: { providerID, modelID },
              tools: disabledTools(),
              format: { type: "json_schema", schema: outputJsonSchema(agent) },
              options: { structuredOutputMode: "outputFormat" },
              system: prompt.system,
              parts: [{ type: "text", text: prompt.prompt }]
            }
          });
          const text = getResponseText(response);
          if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new TeamBindingError("OpenCode model response exceeds the configured size limit.", "invalid_output");
          return validateModelOutput(text, agent);
        } finally {
          if (running.get(key) === controller) running.delete(key);
        }
      },
      async cancel(invocation) {
        const controller = running.get(invocation.idempotencyKey);
        if (!controller) return false;
        controller.abort();
        return true;
      }
    };
  }
  return bindings;
}

export function getOpenCodeDisabledToolsForTest() {
  return disabledTools();
}
