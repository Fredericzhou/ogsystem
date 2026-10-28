const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

async function readStdin() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("input_limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function basicAuth(username, password) {
  return "Basic " + Buffer.from(username + ":" + password).toString("base64");
}

async function requestJson(url, options) {
  const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error("provider_http_" + response.status);
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_OUTPUT_BYTES) throw new Error("provider_response_limit");
  return JSON.parse(text);
}

let stage = "input";
try {
  const input = await readStdin();
  if (input.endpoint !== "http://host.docker.internal:4096" || input.model !== "codex-gateway/gpt-6-luna") throw new Error("endpoint_not_allowed");
  if (typeof input.password !== "string" || input.password.length < 16) throw new Error("credential_invalid");
  const headers = { authorization: basicAuth("opencode", input.password), "content-type": "application/json" };
  stage = "session";
  const created = await requestJson(input.endpoint + "/session", {
    method: "POST", headers, body: JSON.stringify({ title: "Team IR model invocation" })
  });
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(created?.id ?? "")) throw new Error("session_invalid");
  stage = "message";
  const response = await requestJson(input.endpoint + "/session/" + created.id + "/message", {
    method: "POST", headers,
    body: JSON.stringify({
      model: { providerID: "codex-gateway", modelID: "gpt-6-luna" },
      tools: {},
      system: input.system,
      parts: [{ type: "text", text: input.prompt }]
    })
  });
  stage = "response";
  stage = "parse_parts";
  const parts = response?.parts;
  if (!Array.isArray(parts)) throw new Error("response_parts_missing");
  if (parts.some((part) => !part || typeof part !== "object" || typeof part.type !== "string")) throw new Error("response_parts_invalid");
  stage = "inspect_parts";
  stage = "map_part_types";
  const partKinds = parts.map((part) => part?.type ?? "unknown").join("_");
  stage = "check_text_presence";
  if (!parts.some((part) => part?.type === "text") || parts.some((part) => !["text", "reasoning", "step-start", "step-finish"].includes(part?.type))) throw new Error("response_parts_" + partKinds.slice(0, 80));
  stage = "check_text_values";
  if (parts.some((part) => part.type === "text" && typeof part.text !== "string")) throw new Error("response_text_invalid");
  stage = "collect_text";
  const text = parts.filter((part) => part.type === "text").map((part) => part.text).join("");
  stage = "emit";
  if (Buffer.byteLength(text) > MAX_OUTPUT_BYTES) throw new Error("model_output_limit");
  process.stdout.write(JSON.stringify({ text }));
} catch (error) {
  const code = typeof error?.message === "string" && /^(input_limit|endpoint_not_allowed|credential_invalid|session_invalid|provider_http_[0-9]{3}|provider_response_limit|response_parts_missing|response_parts_invalid|response_text_invalid|response_parts_[a-z_0-9-]+|model_output_limit)$/.test(error.message)
    ? error.message
    : "adapter_" + stage + "_" + String(error?.name || "error").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
  process.stderr.write("TEAM_MODEL_ADAPTER_FAILED:" + code + "\n");
  process.exitCode = 2;
}
