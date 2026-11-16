#!/usr/bin/env node

/*
 * Reproducible cross-Backend acceptance probe.
 *
 * This intentionally records failures as evidence. It never upgrades a failed
 * Codex/OpenCode/Pi run to a pass and never uses a mock model response.
 */
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = resolve(import.meta.dirname, "..");
const model = process.env.OGS_CROSS_BACKEND_MODEL || "gpt-6-luna";
const secondBackend = process.env.OGS_CROSS_BACKEND_BACKEND || "opencode";
const timeoutMs = Number(process.env.OGS_CROSS_BACKEND_TIMEOUT_MS || 120000);

function bindingModel(backend) {
  if (backend === "opencode" && !model.includes("/")) return `codex-gateway/${model}`;
  return model;
}

function run(command, args, cwd, timeout) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr, timedOut: signal === "SIGTERM" });
    });
  });
}

const root = await mkdtemp(join(tmpdir(), "ogs-v2-cross-backend-"));
const ogs = join(root, ".ogs");
await mkdir(ogs, { recursive: true });
await cp(join(repoRoot, "examples", "gate-c-software", "og-roles"), join(root, "og-roles"), { recursive: true });
// The cross-Backend gate proves business handoff semantics. Tool and artifact
// enforcement is covered by the Backend-specific gates because OpenCode/Pi
// intentionally remain resource-degraded until a real staging sandbox exists.
await writeFile(join(root, "og-roles", "roles", "implementer", "prompt.md"), `{{agent}}

Return exactly one JSON object with event, content, data, and artifacts.
Consume the upstream planner handoff and produce a concise business result.
Set event to READY. The content MUST contain CROSS_BACKEND_HANDOFF_OK and data.handoff must equal true.
Do not claim filesystem or process work. Allowed events: {{allowed_events}}
Task: {{task}}
Input: {{input}}
`, "utf8");
await writeFile(join(root, "og-roles", "roles", "implementer", "output.schema.json"), JSON.stringify({
  type: "object",
  required: ["event", "content", "data"],
  properties: {
    event: { type: "string", enum: ["READY"] },
    content: { type: "string" },
    data: { type: "object", required: ["handoff"], properties: { handoff: { const: true } }, additionalProperties: true },
    artifacts: { type: "array" }
  },
  additionalProperties: false
}, null, 2), "utf8");
await cp(join(repoRoot, "examples", "gate-c-software", ".ogs", "laws.json"), join(ogs, "laws.json"));
await cp(join(repoRoot, ".ogs", "user-profile.json"), join(ogs, "user-profile.json"));
await writeFile(join(ogs, "runtime.json"), JSON.stringify({ configVersion: "2", executor: "opencode", roleRepo: "./og-roles", runsDir: ".ogs/runs" }, null, 2));
await writeFile(join(root, "system.mmd"), `flowchart TD
%% system.id=v2.cross.backend.evidence
%% system.version=1.0.0
%% law.global=law.gate.c
start[开始] -->|START| planner[Role:planner]
planner[Role:planner] -->|READY| implementer[Role:implementer]
implementer[Role:implementer] -->|READY| end[结束]
`);
await writeFile(join(ogs, "execution-bindings.json"), JSON.stringify({
  ogsContractVersion: 2,
  schemaVersion: 1,
  harnessTemplates: {
    codex: { ogsContractVersion: 2, schemaVersion: 1, kind: "harness", templateId: "codex", backend: "codex", model, allowedTools: [], environment: { filesystem: "none", process: "deny", network: "deny" } },
    second: { ogsContractVersion: 2, schemaVersion: 1, kind: "harness", templateId: "second", backend: secondBackend, model: bindingModel(secondBackend), allowedTools: [], environment: { filesystem: "none", process: "deny", network: "deny" } }
  },
  roles: {
    planner: { kind: "harness", harnessTemplate: "codex" },
    implementer: { kind: "harness", harnessTemplate: "second" }
  }
}, null, 2));

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = await run(command, ["exec", "tsx", "src/runtime/cli.ts", "run", "start", "--ogs-dir", root, "--system", join(root, "system.mmd"), "--input", "Cross-Backend business handoff probe: summarize the requested change and pass a concise verified business decision to the downstream role. No files, tools, or commands are required.", "--json"], repoRoot, timeoutMs);
const runDirs = await readFile(join(ogs, "runs-index.json"), "utf8").then((value) => JSON.parse(value).runs || []).catch(() => []);
const runSummaries = await Promise.all(runDirs.map(async (run) => {
  const summaryPath = run.runDir ? join(run.runDir, "summary.json") : "";
  return summaryPath ? await readFile(summaryPath, "utf8").then((value) => JSON.parse(value)).catch(() => run) : run;
}));
const completedRuns = runSummaries.filter((run) => run.status === "done" && Number(run.failedCount || 0) === 0 && Number(run.noopCount || 0) === 0 && Number(run.transitionCount || 0) >= 2);
let cliResult;
try { cliResult = JSON.parse(result.stdout); } catch { cliResult = undefined; }
const finalOutputs = Array.isArray(cliResult?.finalOutputsByRoleId?.implementer) ? cliResult.finalOutputsByRoleId.implementer : [];
const finalOutput = finalOutputs.map((item) => typeof item?.content === "string" ? item.content : "").join("\n");
const handoffData = finalOutputs.some((item) => item?.data?.handoff === true);
const handoffMarker = finalOutput.includes("CROSS_BACKEND_HANDOFF_OK");
const refusal = /unable to implement|no files were created|no native file|capabilities explicitly disable/i.test(finalOutput);
const acceptance = {
  runCompleted: completedRuns.length > 0,
  failedRoleCount: runSummaries.reduce((sum, run) => sum + Number(run.failedCount || 0), 0),
  noopCount: runSummaries.reduce((sum, run) => sum + Number(run.noopCount || 0), 0),
  handoffMarker,
  handoffData,
  refusal,
  successfulRunIds: completedRuns.map((run) => run.runId)
};
const sanitize = (value) => typeof value === "string"
  ? value.replaceAll(root, "<fixture>")
  : value;
const evidence = {
  generatedAt: new Date().toISOString(),
  model,
  backends: ["codex", secondBackend],
  fixtureRoot: "<temporary-fixture>",
  command: `${command} exec tsx src/runtime/cli.ts run start --ogs-dir <fixture> --system <fixture>/system.mmd --input <business-handoff> --json`,
  timeoutMs,
  result: { code: result.code, signal: result.signal, timedOut: result.timedOut, stdout: sanitize(result.stdout), stderr: sanitize(result.stderr) },
  runs: runDirs.map((run) => ({ ...run, runDir: sanitize(run.runDir) })),
  acceptance,
  status: result.code === 0 && !result.timedOut && acceptance.runCompleted && acceptance.handoffMarker && acceptance.handoffData && !acceptance.refusal ? "observed" : "failed"
};
const output = process.env.OGS_CROSS_BACKEND_EVIDENCE || join(repoRoot, "docs/development/evidence/v2-cross-backend-real-run-latest.json");
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
process.exitCode = evidence.status === "observed" ? 0 : 1;
