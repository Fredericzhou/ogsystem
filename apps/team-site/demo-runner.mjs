import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCase } from "./cases.mjs";
import { localizedEventLabel } from "./event-labels.mjs";
import { parseSystemFromMermaidSource } from "../../dist/runtime/parse-mermaid.js";
import { defaultBackendRegistry } from "../../dist/runtime/model-backend-registry.js";
import { authoringToDesign, importSystemToAuthoring } from "../../dist/visualizer/studio-authoring.js";
import { buildGraphViewModel } from "../../dist/visualizer/graph-view-model.js";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(process.env.OGSYSTEM_ROOT || appRoot, process.env.OGSYSTEM_ROOT ? "." : "../..");
const cliPath = join(repositoryRoot, "bin", "ogs.mjs");
// Codex is the default real-run backend because its app-server exposes a
// verifiable staging boundary for file-producing teams. OpenCode remains
// available for explicit cross-backend and text-only scenarios.
export const DEFAULT_DEMO_BACKEND = "codex";
export const DEFAULT_DEMO_MODEL = "gpt-6-luna";
const DEFAULT_DEMO_MODEL_TIMEOUT_MS = 600000;
// A classic team can contain several sequential model activations. The
// process wrapper must outlive that chain; each role still keeps its own
// model timeout and Runtime node budget.
const DEFAULT_DEMO_RUN_TIMEOUT_MS = 600000;

// Deterministic local publisher used by the classic teams. It writes only to
// the Runtime execution workspace and emits one JSON Role result on stdout.
// Tool diagnostics stay on stderr so the Runtime parser always sees JSON.
const PUBLISH_FILES_SCRIPT = String.raw`import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const format = process.argv[2];
const root = process.cwd();
const request = await readFile(join(process.env.OGSYSTEM_TARGET_DIR || root, "request.md"), "utf8").catch(() => "sample task");
const task = request.trim().slice(0, 500) || "sample task";
const writtenFiles = [];
const add = async (path, kind, mediaType, content, encoding = "utf-8") => {
  await writeFile(join(root, path), content);
  writtenFiles.push(path);
};
const xml = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const makeXlsx = async (path) => {
  const dir = join(root, ".xlsx");
  await mkdir(join(dir, "_rels"), { recursive: true });
  await mkdir(join(dir, "xl", "_rels"), { recursive: true });
  await mkdir(join(dir, "xl", "worksheets"), { recursive: true });
  await writeFile(join(dir, "[Content_Types].xml"), "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/></Types>");
  await writeFile(join(dir, "_rels", ".rels"), "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/></Relationships>");
  await writeFile(join(dir, "xl", "workbook.xml"), "<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets><sheet name=\"Brief\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");
  await writeFile(join(dir, "xl", "_rels", "workbook.xml.rels"), "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/></Relationships>");
  await writeFile(join(dir, "xl", "worksheets", "sheet1.xml"), "<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>Metric</t></is></c><c r=\"B1\" t=\"inlineStr\"><is><t>Value</t></is></c></row><row r=\"2\"><c r=\"A2\" t=\"inlineStr\"><is><t>Task</t></is></c><c r=\"B2\" t=\"inlineStr\"><is><t>" + xml(task) + "</t></is></c></row></sheetData></worksheet>");
  execFileSync("zip", ["-q", "-r", join(root, path), "."], { cwd: dir });
};
const tryMakeXlsx = async (path) => {
  try {
    await makeXlsx(path);
    return true;
  } catch {
    return false;
  }
};
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
const tryRun = (command, args) => {
  try {
    run(command, args);
    return true;
  } catch {
    return false;
  }
};
try {
  if (format === "consulting") {
    const brief = { executiveSummary: "Evidence-aware market entry brief.", recommendations: ["Validate the highest-impact assumption before commitment."], implementationPlan: ["Confirm evidence", "Pilot the smallest reversible step"], risks: ["Evidence is limited to the supplied brief."], assumptions: ["The supplied task is representative."], openQuestions: ["Which metric determines the go or no-go decision?"] };
    await add("executive-brief.md", "business_document", "text/markdown", "# Executive brief\n\nTask: " + task + "\n\n" + brief.executiveSummary + "\n");
    await add("executive-brief.json", "business_data", "application/json", JSON.stringify(brief, null, 2) + "\n");
    await add("executive-brief.csv", "business_data", "text/csv", "field,value\nexecutiveSummary,\"" + brief.executiveSummary + "\"\nrecommendation,\"" + brief.recommendations[0] + "\"\n");
    if (await tryMakeXlsx("executive-brief.xlsx")) {
      writtenFiles.push("executive-brief.xlsx");
    }
    if (tryRun("pandoc", ["executive-brief.md", "-o", "executive-brief.docx"])) {
      writtenFiles.push("executive-brief.docx");
    }
    if (tryRun("pandoc", ["executive-brief.md", "-o", "executive-brief.pdf", "--pdf-engine=xelatex"])) {
      writtenFiles.push("executive-brief.pdf");
    }
  } else if (format === "debate") {
    await add("debate-brief.md", "business_document", "text/markdown", "# Debate brief\n\nTopic: " + task + "\n\nThe structured debate result and follow-up questions are recorded in the accompanying summary.\n");
    await add("debate-summary.json", "business_data", "application/json", JSON.stringify({ topic: task, status: "reviewed", uncertainty: ["Evidence is bounded by the supplied brief."] }, null, 2) + "\n");
    if (tryRun("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=royalblue:s=960x540", "-frames:v", "1", "debate.png"])) {
      writtenFiles.push("debate.png");
    }
    if (tryRun("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=royalblue:s=960x540", "-t", "1", "-pix_fmt", "yuv420p", "debate.mp4"])) {
      writtenFiles.push("debate.mp4");
    }
    if (tryRun("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-q:a", "4", "debate.mp3"])) {
      writtenFiles.push("debate.mp3");
    }
  } else throw new Error("unknown publisher format: " + format);
  process.stdout.write(JSON.stringify({ event: "READY", content: "Published " + writtenFiles.length + " verified files." }));
} catch (error) {
  process.stderr.write(String(error && error.stack || error) + "\n");
  process.exit(1);
}`;

export function resolveDemoBackend(env = process.env) {
  return env.OGS_DEMO_BACKEND || DEFAULT_DEMO_BACKEND;
}

export function resolveDemoModel(env = process.env, backend = resolveDemoBackend(env)) {
  const backendEnvName = `OGS_DEMO_${backend.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_MODEL`;
  const specificModel = env[backendEnvName];
  if (specificModel) return specificModel;
  if (backend === resolveDemoBackend(env) && env.OGS_DEMO_MODEL) return env.OGS_DEMO_MODEL;
  if (backend === "opencode") return "codex-gateway/gpt-6-luna";
  if (["codex", "qwen", "kimi"].includes(backend)) return DEFAULT_DEMO_MODEL;
  throw new Error(`Set ${backendEnvName} to select a model for the ${backend} backend.`);
}

export function resolveCaseRoleModel(caseSpec, role, env = process.env) {
  const backend = role.backend || resolveDemoBackend(env);
  return { backend, modelId: resolveDemoModel(env, backend) };
}

function quote(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildCaseSystem(caseSpec) {
  const lines = [
    "flowchart TD",
    `%% system.id=site.${caseSpec.id}`,
    "%% system.version=2.0.0",
    `%% law.global=law.site.${caseSpec.id}`,
    ...(caseSpec.handoffMode ? [`%% handoff.mode=${caseSpec.handoffMode}`] : []),
    ...(caseSpec.handoffContracts ? [`%% handoff.contracts=${caseSpec.handoffContracts}`] : []),
    ...(caseSpec.reviews ?? []).flatMap((review) => [
      `%% review.mode.${review.roleId}=${review.mode ?? "required"}`,
      ...(review.timeout ? [`%% review.timeout.${review.roleId}=${review.timeout}`] : []),
      ...(review.timeoutAction ? [`%% review.timeout.action.${review.roleId}=${review.timeoutAction}`] : []),
      ...(review.reworkTarget ? [`%% review.rework.target.${review.roleId}=${review.reworkTarget}`] : []),
      ...(review.reworkMax ? [`%% review.rework.max.${review.roleId}=${review.reworkMax}`] : []),
      ...(review.terminateScope ? [`%% review.terminate.scope.${review.roleId}=${review.terminateScope}`] : [])
    ]),
    ...caseSpec.roles.filter((role) => role.mode).map((role) => `%% role.mode.${role.id}=${role.mode}`),
    ...caseSpec.joins.flatMap((joinSpec) => [
      `%% join.mode.${joinSpec.roleId}=${joinSpec.mode}`,
      `%% join.sources.${joinSpec.roleId}=${joinSpec.sources.join(",")}`,
      ...(joinSpec.min ? [`%% join.min.${joinSpec.roleId}=${joinSpec.min}`] : [])
    ]),
    ...(caseSpec.loopBudgets ?? []).map((loop) => `%% loop.max.${loop.roleId}=${loop.max}`),
    ...(caseSpec.projections ?? []).map(([roleId, field, selector]) => `%% context.map.${roleId}.${field}=${selector}`),
    ""
  ];
  for (const [from, to, event] of caseSpec.flows) {
    const source = from === "__system_start__" ? "start[开始]" : `${from}[Role:${from}]`;
    const target = to === "__system_end__" ? "end[结束]" : `${to}[Role:${to}]`;
    lines.push(`${source} -->|${event}| ${target}`);
  }
  return `${lines.join("\n")}\n`;
}

export function buildCaseHandoffContracts(caseSpec) {
  const parallelRoles = new Set(caseSpec.roles.filter((role) => role.mode === "parallel_split").map((role) => role.id));
  const contracts = caseSpec.flows
    .filter(([from, to, event]) => from !== "__system_start__" && to !== "__system_end__" && !["ERROR", "FAILED", "CANCELLED"].includes(event))
    .map(([from, to, event]) => ({
      id: `${from}.to.${to}.${parallelRoles.has(from) ? "split" : event}`.replace(/[^A-Za-z0-9._-]+/g, "-"),
      kind: "flow",
      match: parallelRoles.has(from)
        ? { fromRoleId: from, mode: "split", toRoleId: to }
        : { fromRoleId: from, eventType: event, toRoleId: to },
      schema: "flow-envelope.schema.json",
      onViolation: "FAIL"
    }));
  return { version: 1, contracts };
}

export function buildCaseFlowEnvelopeSchema(caseSpec) {
  return {
    "$schema": "http://json-schema.org/draft-07/schema#",
    type: "object",
    properties: {
      event: { type: "string" },
      content: { type: "string" },
      data: { type: "object" }
    },
    required: ["content"],
    additionalProperties: false
  };
}

export function buildCaseGraph(caseId, locale = "zh-CN") {
  const caseSpec = getCase(caseId);
  if (!caseSpec) throw new Error("Unknown example team.");
  const systemSource = buildCaseSystem(caseSpec);
  const system = parseSystemFromMermaidSource(systemSource);
  const authoring = importSystemToAuthoring({
    workdir: repositoryRoot,
    systemPath: `apps/team-site/projects/${caseId}/system.mmd`,
    system,
    systemSource,
    roleDisplayNames: new Map(caseSpec.roles.map((role) => [role.id, role.label[locale] || role.label["zh-CN"]]))
  });
  for (const role of caseSpec.roles) {
    const resolved = resolveCaseRoleModel(caseSpec, role, process.env);
    authoring.roles[role.id] = {
      ...authoring.roles[role.id],
      bindingKind: "model",
      backend: resolved.backend,
      modelId: resolved.modelId,
      modelRef: `${resolved.backend}/${resolved.modelId}`
    };
  }
  authoring.layout.nodes = Object.fromEntries(caseSpec.roles.map((role) => {
    const [x, y] = caseSpec.layout[role.id] || [120, 120];
    return [role.id, { x, y, width: 230, height: 104 }];
  }));
  const roleDescriptions = Object.fromEntries(caseSpec.roles.map((role) => [
    role.id,
    caseSpec.detail.roles[role.id][locale] || caseSpec.detail.roles[role.id]["zh-CN"]
  ]));
  const edgeLabels = Object.fromEntries([
    ["START", localizedEventLabel("START", locale)],
    ...caseSpec.flows.map(([, , eventType]) => [eventType, localizedEventLabel(eventType, locale)])
  ]);
  const graph = buildGraphViewModel({
    authoring,
    mode: "run",
    presentation: {
      roleDescriptions,
      edgeLabels,
      boundaryLabels: locale === "zh-CN" ? { start: "开始", end: "结束" } : { start: "Start", end: "End" }
    }
  });
  return {
    ...graph,
    nodes: graph.nodes.map((node) => ({ ...node, badges: [], structure: {} }))
  };
}

function roleManifest(role) {
  return {
    roleId: role.id,
    roleVersion: "1.0.0",
    name: role.id,
    description: role.purpose,
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    tags: ["site-demo", "agent-team"],
    ogsContractVersion: 2,
    schemaVersion: 2,
    purpose: role.purpose,
    responsibility: { kind: "atomic", owns: [], contributes: ["content"], doesNotOwn: [] },
    inputs: { preconditions: [{ op: "exists", args: [{ kind: "path", root: "role", path: ["input"] }] }] },
    outputs: {
      postconditions: [{ op: "exists", args: [{ kind: "path", root: "role", path: ["output"] }] }],
      decisionCriteria: []
    },
    authority: { controlActions: role.controlActions ?? [] },
    constraints: { writableStateFields: [] },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] }
  };
}

export async function materializeCaseTeam(caseId, workdir, locale = "zh-CN") {
  const caseSpec = getCase(caseId);
  if (!caseSpec) throw new Error("Unknown example team.");
  await writeCaseProject(caseSpec, workdir, "", "sandbox", locale);
  return { caseSpec, systemSource: buildCaseSystem(caseSpec) };
}

async function writeCaseProject(caseSpec, workdir, prompt, mode, locale = "zh-CN") {
  const rolesRoot = join(workdir, "team-roles", "roles");
  const fileWriterRoleIds = new Set(caseSpec.roles.filter((role) => role.writesFiles).map((role) => role.id));
  // Team Site templates are V2 model roles. Legacy profile/tool assets are
  // intentionally not materialized; Workspace files belong to Framework commits.
  await mkdir(rolesRoot, { recursive: true });
  const expectedRoleIds = new Set(caseSpec.roles.map((role) => role.id));
  for (const entry of await readdir(rolesRoot, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory() && !expectedRoleIds.has(entry.name)) {
      await rm(join(rolesRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const role of caseSpec.roles) {
    const roleDir = join(rolesRoot, role.id);
    await mkdir(roleDir, { recursive: true });
    await writeFile(join(roleDir, "role.json"), `${JSON.stringify(roleManifest(role), null, 2)}\n`);
    await writeFile(join(roleDir, "agent.md"), role.prompt);
    const writesFiles = fileWriterRoleIds.has(role.id);
    const fileInstruction = writesFiles
      ? "- Use the available native file-writing tool to create only the source, test, or delivery files assigned to this Role in the execution Workspace. Report only paths that exist."
      : "- This Role does not publish files. Return only this Role's business result in content.";
    await writeFile(join(roleDir, "prompt.md"), `{{agent}}\n\nAllowed events:\n{{allowed_events}}\n\nUser preferences:\n{{user_preferences}}\n\nTask:\n{{task}}\n\nInput:\n{{input}}\n\nOutput requirements:\n- Return exactly one schema-compliant JSON object and no Markdown.\n- event must be one of allowed_events.\n- Put the useful role result in content.\n${fileInstruction}\n`);
    await writeFile(join(roleDir, "output.schema.json"), `${JSON.stringify({
      type: "object",
      required: ["event", "content"],
      properties: {
        event: { type: "string", enum: role.events },
        content: { type: "string", minLength: 1 },
        ...(role.outputDataSchema ? { data: role.outputDataSchema } : {}),
      },
      additionalProperties: false
    }, null, 2)}\n`);
  }

  const configDir = join(workdir, ".ogs");
  await mkdir(configDir, { recursive: true });
  await Promise.all([
    rm(join(configDir, "model-selection.json"), { force: true }),
    rm(join(workdir, "profiles.json"), { force: true }),
    rm(join(workdir, "tools.json"), { force: true }),
    rm(join(workdir, "tools"), { recursive: true, force: true })
  ]);
  const systemSource = buildCaseSystem(caseSpec);
  await writeFile(join(workdir, "system.mmd"), systemSource);
  if (caseSpec.handoffContracts) {
    const contractsDir = join(workdir, "contracts");
    await mkdir(contractsDir, { recursive: true });
    await writeFile(join(contractsDir, "flow-envelope.schema.json"), `${JSON.stringify(buildCaseFlowEnvelopeSchema(caseSpec), null, 2)}\n`);
    await writeFile(join(workdir, caseSpec.handoffContracts), `${JSON.stringify(buildCaseHandoffContracts(caseSpec), null, 2)}\n`);
  }
  const authoring = importSystemToAuthoring({
    workdir,
    systemPath: "system.mmd",
    system: parseSystemFromMermaidSource(systemSource),
    roleDisplayNames: new Map(caseSpec.roles.map((role) => [role.id, role.label[locale] || role.label["zh-CN"]]))
  });
  for (const role of caseSpec.roles) {
    const resolved = resolveCaseRoleModel(caseSpec, role, process.env);
    authoring.roles[role.id] = {
      ...authoring.roles[role.id],
      bindingKind: "model",
      backend: resolved.backend,
      modelId: resolved.modelId,
      modelRef: `${resolved.backend}/${resolved.modelId}`
    };
  }
  await writeFile(join(workdir, "system.design.json"), `${JSON.stringify(authoringToDesign(authoring), null, 2)}\n`);
  await mkdir(join(configDir, "studio"), { recursive: true });
  await writeFile(join(configDir, "studio", "system.authoring.json"), `${JSON.stringify({
    ...authoring,
    ogsContractVersion: 2,
    version: 2,
    project: { workdir, systemPath: "system.mmd" }
  }, null, 2)}\n`);
  const catalog = await readFile(join(repositoryRoot, ".ogs", "model-catalog.json"), "utf8").catch(() => undefined);
  if (catalog) await writeFile(join(configDir, "model-catalog.json"), catalog);
  await writeFile(join(configDir, "laws.json"), `${JSON.stringify({ laws: [{
    lawId: `law.site.${caseSpec.id}`,
    constraints: { forbiddenToolRefs: [], maxTransitions: 32 }
  }] }, null, 2)}\n`);
  await writeFile(join(configDir, "runtime.json"), `${JSON.stringify({
    configVersion: "2",
    roleRepo: "team-roles",
    runsDir: ".ogs/runs",
    redaction: { enabled: true },
    tools: { environmentPolicy: "minimal", envAllowlist: [] }
  }, null, 2)}\n`);
  const modelTimeoutMs = Number(process.env.OGS_CASE_MODEL_TIMEOUT_MS || DEFAULT_DEMO_MODEL_TIMEOUT_MS);
  if (!Number.isFinite(modelTimeoutMs) || modelTimeoutMs <= 0) {
    throw new Error("OGS_CASE_MODEL_TIMEOUT_MS must be a positive number.");
  }
  const harnessTemplates = {};
  const bindings = {};
  // Simulation is a semantic/debug run. It must not claim verified native
  // tools or request resources that the selected adapter has not discovered.
  // The real model run below materializes the requested tools separately.
  const textOnlySimulation = mode === "simulation";
  for (const role of caseSpec.roles) {
    const resolved = resolveCaseRoleModel(caseSpec, role, process.env);
    const adapterResources = defaultBackendRegistry.getAdapter(resolved.backend)?.getResourceCapabilities?.() || {};
    const canReadWorkspace = adapterResources.filesystem === true;
    const canWriteWorkspace = canReadWorkspace && adapterResources.process === true;
    const roleNeedsWorkspaceTools = role.writesFiles === true || role.readsWorkspaceRefs === true;
    const roleNeedsWriteTools = role.writesFiles === true;
    const workspaceToolsAvailable = roleNeedsWriteTools ? canWriteWorkspace : canReadWorkspace;
    const templateId = `harness.site.${caseSpec.id}.${role.id}`;
    harnessTemplates[templateId] = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      kind: "harness",
      templateId,
      backend: resolved.backend,
      model: resolved.modelId,
      // Cross-backend evidence validates business handoff and adapter identity;
      // it does not claim filesystem/process capabilities for OpenCode.
      allowedTools: textOnlySimulation || !workspaceToolsAvailable || !roleNeedsWorkspaceTools
        ? []
        : roleNeedsWriteTools ? ["apply_patch", "exec_command"] : ["workspace.read"],
      environment: {
        filesystem: textOnlySimulation || !workspaceToolsAvailable || !roleNeedsWorkspaceTools
          ? "none"
          : roleNeedsWriteTools ? { read: true, write: true } : { read: true, write: false },
        process: textOnlySimulation || !workspaceToolsAvailable || !roleNeedsWorkspaceTools || !roleNeedsWriteTools ? "deny" : "allow",
        network: "deny",
        limits: { timeoutMs: role.execution?.timeoutMs ?? modelTimeoutMs, maxOutputBytes: role.execution?.maxOutputBytes ?? 65536 }
      },
      preset: "site-demo"
    };
    bindings[role.id] = { kind: "harness", harnessTemplate: templateId };
  }
  await writeFile(join(configDir, "execution-bindings.json"), `${JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    defaults: { harnessTemplate: Object.keys(harnessTemplates)[0] },
    harnessTemplates,
    roles: bindings
  }, null, 2)}\n`);
  await writeFile(join(configDir, "user-profile.json"), `${JSON.stringify({
    userProfileId: "site.demo",
    language: locale === "en" ? "en" : "zh-CN",
    style: "clear",
    riskPreference: "balanced",
    outputLength: "short"
  }, null, 2)}\n`);
  await writeFile(join(workdir, "request.md"), prompt);
  await writeFile(join(workdir, "run-mode.txt"), mode);
}

function parseJsonTail(output) {
  const starts = [...output.matchAll(/^\s*\{/gm)].map((match) => match.index);
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(output.slice(start));
    } catch {}
  }
  throw new Error("OGSystem CLI did not return a JSON run summary.");
}

async function readJsonIf(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function listRelativeFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listRelativeFiles(root, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

async function collectReleaseEvidence(workdir, runId) {
  if (!runId) return undefined;
  const sharedDir = join(workdir, ".ogs", "runs", runId, "shared");
  const rawManifest = await readJsonIf(join(sharedDir, "artifact-manifest.json"));
  const rawSeal = await readJsonIf(join(sharedDir, "seal-manifest.json"));
  const rawVerification = await readJsonIf(join(sharedDir, "verification.json"));
  const files = await listRelativeFiles(join(sharedDir, "artifacts"));
  const fileDetails = await Promise.all(files.map(async (path) => ({ path, sizeBytes: (await stat(join(sharedDir, "artifacts", path))).size })));
  // The verifier and browser demo consume a Run evidence projection. Keep
  // internal verifier records private so legacy artifact identity fields do
  // not become part of the active Team Site result contract.
  const manifest = rawManifest && typeof rawManifest === "object"
    ? {
        status: rawManifest.status,
        runId: rawManifest.runId,
        producerRoleId: rawManifest.producerRoleId,
        files: rawManifest.files,
        digest: typeof rawManifest.manifestSha256 === "string" ? `sha256:${rawManifest.manifestSha256}` : undefined
      }
    : undefined;
  const seal = rawSeal && typeof rawSeal === "object"
    ? {
        status: rawSeal.status,
        files: rawSeal.files,
        digest: typeof rawSeal.manifestSha256 === "string" ? `sha256:${rawSeal.manifestSha256}` : undefined
      }
    : undefined;
  const verification = rawVerification && typeof rawVerification === "object"
    ? {
        status: rawVerification.status,
        passed: rawVerification.passed,
        files: rawVerification.files,
        digest: typeof rawVerification.manifestSha256 === "string" ? `sha256:${rawVerification.manifestSha256}` : undefined
      }
    : undefined;
  const verified = manifest?.status === "verified" && seal?.status === "sealed" && verification?.status === "verified" && verification?.passed === true;
  return {
    release: {
      kind: "run-evidence-projection",
      releaseId: `run:${runId}`,
      runId,
      status: verified ? "published" : "failed",
      materializationManifestRef: `run://${runId}/evidence/materialization-manifest`,
      materializationManifestDigest: manifest?.digest,
      outputDigest: seal?.digest,
      downloadReference: verified ? `run://${runId}/outputs` : undefined
    },
    materialization: { manifest, seal, verification, files, fileDetails }
  };
}

function runCli(args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const env = { ...process.env, NO_COLOR: "1" };
    const demoBackend = resolveDemoBackend(env);
    if (process.platform === "win32" && demoBackend === "opencode") {
      const nativeBin = join(dirname(process.execPath), "node_modules", "opencode-ai", "bin");
      if (existsSync(join(nativeBin, "opencode.exe"))) {
        env.PATH = `${nativeBin}${delimiter}${env.PATH || ""}`;
      }
    }
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      windowsHide: true,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const maxBytes = 1024 * 1024;
    const timeout = setTimeout(() => child.kill(), options.timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxBytes) child.kill();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxBytes) child.kill();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectRun(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectRun(new Error(`OGSystem run failed (${code}). ${stderr.slice(-3000)}${stdout.slice(-3000)}`));
        return;
      }
      resolveRun({ stdout, stderr });
    });
  });
}

export async function runCase({ caseId, prompt, mode = "simulation", locale = "zh-CN", timeoutMs }) {
  const caseSpec = getCase(caseId);
  if (!caseSpec) throw new Error("Unknown example team.");
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 1200) {
    throw new Error("Enter a task between 1 and 1,200 characters.");
  }
  if (mode !== "simulation" && mode !== "model") throw new Error("Unsupported run mode.");
  const workdir = await mkdtemp(join(tmpdir(), "ogsystem-site-run-"));
  const start = Date.now();
  try {
    await writeCaseProject(caseSpec, workdir, prompt.trim(), mode, locale);
    const args = [
      "run", "start", "--system", "system.mmd", "--laws", ".ogs/laws.json",
      "--user-profile", ".ogs/user-profile.json", "--input", prompt.trim(),
      "--ogs-dir", workdir, "--json", "--quiet-run"
    ];
    if (mode === "simulation") args.push("--dry-run");
    const execution = await runCli(args, { cwd: workdir, timeoutMs: timeoutMs ?? (mode === "model" ? DEFAULT_DEMO_RUN_TIMEOUT_MS : 30000) });
    const result = parseJsonTail(execution.stdout);
    const runEntries = await readdir(join(workdir, ".ogs", "runs"), { withFileTypes: true }).catch(() => []);
    const runId = runEntries.find((entry) => entry.isDirectory())?.name;
    const releaseEvidence = await collectReleaseEvidence(workdir, runId);
    return {
      caseId,
      mode,
      runId,
      status: result.status,
      error: result.error,
      errorEnvelope: result.errorEnvelope,
      finalRoleId: result.finalRoleId,
      finalOutput: result.finalOutput,
      stages: Array.isArray(result.stages) ? result.stages : [],
      auditTrail: Array.isArray(result.auditTrail) ? result.auditTrail.map((item) => ({
        roleId: item.roleId,
        selectedEvent: item.selectedEvent,
        status: item.status,
        durationMs: item.durationMs,
        backend: item.backend,
        modelId: item.modelId,
        profileId: item.profileId,
        toolRef: item.toolRef,
        command: item.command,
        failure: item.error
      })) : [],
      summary: result.runSummary ?? {},
      releaseEvidence,
      durationMs: Date.now() - start
    };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

export async function lintCase(caseId) {
  const caseSpec = getCase(caseId);
  if (!caseSpec) throw new Error("Unknown example team.");
  const workdir = await mkdtemp(join(tmpdir(), "ogsystem-site-lint-"));
  try {
    await writeCaseProject(caseSpec, workdir, "site validation", "simulation");
    const args = ["lint", "--system", "system.mmd"];
    const result = await runCli(args, { cwd: workdir, timeoutMs: 30000 });
    return { status: "ok", output: result.stdout.trim() };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
