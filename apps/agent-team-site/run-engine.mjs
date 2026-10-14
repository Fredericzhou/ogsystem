import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCase } from "./cases.mjs";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(process.env.OGSYSTEM_ROOT || appRoot, process.env.OGSYSTEM_ROOT ? "." : "../..");
const cliPath = join(repositoryRoot, "bin", "ogs.mjs");

function quote(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildSystem(caseSpec) {
  const lines = [
    "flowchart TD",
    `%% system.id=site.${caseSpec.id}`,
    "%% system.version=1.0.0",
    `%% law.global=law.site.${caseSpec.id}`,
    `%% entry.role=${caseSpec.entryRole}`,
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
    const source = from === "input" ? "input" : `${from}[Role:${from}]`;
    const target = to === "output" ? "output" : `${to}[Role:${to}]`;
    lines.push(`${source} -->|${event}| ${target}`);
  }
  return `${lines.join("\n")}\n`;
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
    contractVersion: 1,
    purpose: role.purpose,
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { events: [...role.events].sort((left, right) => left.localeCompare(right)), postconditions: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [], allowedTools: [] },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] }
  };
}

async function writeProject(caseSpec, workdir, prompt, mode, locale = "zh-CN") {
  const rolesRoot = join(workdir, "roles");
  for (const role of caseSpec.roles) {
    const roleDir = join(rolesRoot, role.id);
    await mkdir(roleDir, { recursive: true });
    await writeFile(join(roleDir, "role.json"), `${JSON.stringify(roleManifest(role), null, 2)}\n`);
    await writeFile(join(roleDir, "agent.md"), role.prompt);
    await writeFile(join(roleDir, "prompt.md"), "{{agent}}\n\nAllowed events:\n{{allowed_events}}\n\nUser preferences:\n{{user_preferences}}\n\nTask:\n{{task}}\n\nInput:\n{{input}}\n\nOutput requirements:\n- Return exactly one schema-compliant JSON object and no Markdown.\n- event must be one of allowed_events.\n- Put the useful role result in content.\n");
    await writeFile(join(roleDir, "output.schema.json"), `${JSON.stringify({
      type: "object",
      required: ["event", "content"],
      properties: {
        event: { type: "string", enum: role.events },
        content: { type: "string", minLength: 1 }
      },
      additionalProperties: false
    }, null, 2)}\n`);
  }

  const configDir = join(workdir, ".ogs");
  await mkdir(configDir, { recursive: true });
  await writeFile(join(workdir, "system.mmd"), buildSystem(caseSpec));
  await writeFile(join(configDir, "laws.json"), `${JSON.stringify({ laws: [{
    lawId: `law.site.${caseSpec.id}`,
    constraints: { forbiddenToolRefs: [], maxTransitions: 32, allowNoopWithoutExecutionBinding: false }
  }] }, null, 2)}\n`);
  await writeFile(join(configDir, "runtime.json"), `${JSON.stringify({
    configVersion: "2",
    roleRepo: ".",
    runsDir: ".ogs/runs",
    redaction: { enabled: true },
    tools: { environmentPolicy: "minimal", envAllowlist: [] },
    runtime: { error_flows: { v1: false } }
  }, null, 2)}\n`);
  await writeFile(join(configDir, "model-selection.json"), `${JSON.stringify({
    configVersion: "2",
    defaults: {
      backend: process.env.OGS_DEMO_BACKEND || "codex",
      modelId: process.env.OGS_DEMO_MODEL || "gpt-6-luna",
      timeoutMs: 120000,
      maxOutputBytes: 65536
    }
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

function runCli(args, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
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
    await writeProject(caseSpec, workdir, prompt.trim(), mode, locale);
    const args = [
      "run", "start", "--system", "system.mmd", "--laws", ".ogs/laws.json",
      "--user-profile", ".ogs/user-profile.json", "--input", prompt.trim(),
      "--ogs-dir", workdir, "--json", "--quiet-run"
    ];
    if (mode === "simulation") args.push("--dry-run");
    const execution = await runCli(args, { cwd: workdir, timeoutMs: timeoutMs ?? (mode === "model" ? 180000 : 30000) });
    const result = parseJsonTail(execution.stdout);
    return {
      caseId,
      mode,
      status: result.status,
      finalRoleId: result.finalRoleId,
      finalOutput: result.finalOutput,
      stages: Array.isArray(result.stages) ? result.stages : [],
      auditTrail: Array.isArray(result.auditTrail) ? result.auditTrail.map((item) => ({
        roleId: item.roleId,
        selectedEvent: item.selectedEvent,
        status: item.status,
        durationMs: item.durationMs,
        backend: item.backend,
        modelId: item.modelId
      })) : [],
      summary: result.runSummary ?? {},
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
    await writeProject(caseSpec, workdir, "site validation", "simulation");
    const args = ["lint", "--system", "system.mmd"];
    const result = await runCli(args, { cwd: workdir, timeoutMs: 30000 });
    return { status: "ok", output: result.stdout.trim() };
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}
