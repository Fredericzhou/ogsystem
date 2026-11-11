import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getCase } from "./cases.mjs";
import { localizedEventLabel } from "./event-labels.mjs";
import { parseSystemFromMermaidSource } from "../../dist/runtime/parse-mermaid.js";
import { authoringToDesign, importSystemToAuthoring } from "../../dist/visualizer/studio-authoring.js";
import { buildGraphViewModel } from "../../dist/visualizer/graph-view-model.js";

const appRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(process.env.OGSYSTEM_ROOT || appRoot, process.env.OGSYSTEM_ROOT ? "." : "../..");
const cliPath = join(repositoryRoot, "bin", "ogs.mjs");
export const DEFAULT_DEMO_BACKEND = "opencode";
export const DEFAULT_DEMO_MODEL = "gpt-6-luna";
const DEFAULT_DEMO_MODEL_TIMEOUT_MS = 120000;
// A classic team can contain several sequential model activations. The
// process wrapper must outlive that chain; each role still keeps its own
// model timeout and Runtime node budget.
const DEFAULT_DEMO_RUN_TIMEOUT_MS = 600000;

// Deterministic local publisher used by the classic teams. It writes only to
// the Runtime execution workspace and emits one JSON Role result on stdout.
// Tool diagnostics stay on stderr so the Runtime parser always sees JSON.
const PUBLISH_ARTIFACTS_SCRIPT = String.raw`import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const format = process.argv[2];
const root = process.cwd();
const request = await readFile(join(process.env.OGSYSTEM_TARGET_DIR || root, "request.md"), "utf8").catch(() => "sample task");
const task = request.trim().slice(0, 500) || "sample task";
const files = [];
const add = async (path, kind, mediaType, content, encoding = "utf-8") => {
  await writeFile(join(root, path), content);
  files.push({ artifactId: path.replace(/[^A-Za-z0-9._:-]/g, "-"), kind, path, mediaType, encoding });
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
const run = (command, args) => execFileSync(command, args, { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
try {
  if (format === "consulting") {
    const brief = { executiveSummary: "Evidence-aware market entry brief.", recommendations: ["Validate the highest-impact assumption before commitment."], implementationPlan: ["Confirm evidence", "Pilot the smallest reversible step"], risks: ["Evidence is limited to the supplied brief."], assumptions: ["The supplied task is representative."], openQuestions: ["Which metric determines the go or no-go decision?"] };
    await add("executive-brief.md", "business_document", "text/markdown", "# Executive brief\n\nTask: " + task + "\n\n" + brief.executiveSummary + "\n");
    await add("executive-brief.json", "business_data", "application/json", JSON.stringify(brief, null, 2) + "\n");
    await add("executive-brief.csv", "business_data", "text/csv", "field,value\nexecutiveSummary,\"" + brief.executiveSummary + "\"\nrecommendation,\"" + brief.recommendations[0] + "\"\n");
    await makeXlsx("executive-brief.xlsx");
    files.push({ artifactId: "executive-brief-xlsx", kind: "business_data", path: "executive-brief.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", encoding: "binary" });
    run("pandoc", ["executive-brief.md", "-o", "executive-brief.docx"]);
    files.push({ artifactId: "executive-brief-docx", kind: "business_document", path: "executive-brief.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", encoding: "binary" });
    run("pandoc", ["executive-brief.md", "-o", "executive-brief.pdf", "--pdf-engine=xelatex"]);
    files.push({ artifactId: "executive-brief-pdf", kind: "business_document", path: "executive-brief.pdf", mediaType: "application/pdf", encoding: "binary" });
  } else if (format === "debate") {
    await add("debate-summary.json", "business_data", "application/json", JSON.stringify({ topic: task, status: "reviewed", uncertainty: ["Evidence is bounded by the supplied brief."] }, null, 2) + "\n");
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=royalblue:s=960x540", "-frames:v", "1", "debate.png"]);
    files.push({ artifactId: "debate-png", kind: "technical_artifact", path: "debate.png", mediaType: "image/png", encoding: "binary" });
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=royalblue:s=960x540", "-t", "1", "-pix_fmt", "yuv420p", "debate.mp4"]);
    files.push({ artifactId: "debate-mp4", kind: "technical_artifact", path: "debate.mp4", mediaType: "video/mp4", encoding: "binary" });
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=1", "-q:a", "4", "debate.mp3"]);
    files.push({ artifactId: "debate-mp3", kind: "technical_artifact", path: "debate.mp3", mediaType: "audio/mpeg", encoding: "binary" });
  } else throw new Error("unknown publisher format: " + format);
  process.stdout.write(JSON.stringify({ event: "READY", content: "Published " + files.length + " verified files.", artifacts: files }));
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
  if (backend === "codex") return DEFAULT_DEMO_MODEL;
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
    "%% system.version=1.0.0",
    `%% law.global=law.site.${caseSpec.id}`,
    ...caseSpec.roles.filter((role) => role.mode).map((role) => `%% role.mode.${role.id}=${role.mode}`),
    ...caseSpec.roles.filter((role) => role.execution?.profileId).map((role) => {
      const profileId = role.execution.profileId;
      const profileRef = profileId.startsWith("profile.") ? profileId : `profile.${profileId}`;
      return `%% exec.bind.${role.id}=${profileRef}`;
    }),
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
    contractVersion: 1,
    purpose: role.purpose,
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { events: [...role.events].sort((left, right) => left.localeCompare(right)), postconditions: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [], allowedTools: role.execution?.toolRef ? [role.execution.toolRef] : [] },
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
  const executionRoles = caseSpec.roles.filter((role) => role.execution);
  if (executionRoles.length) {
    await mkdir(join(workdir, "tools"), { recursive: true });
    await writeFile(join(workdir, "tools", "publish-artifacts.mjs"), PUBLISH_ARTIFACTS_SCRIPT);
  }
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
  const systemSource = buildCaseSystem(caseSpec);
  await writeFile(join(workdir, "system.mmd"), systemSource);
  const authoring = importSystemToAuthoring({
    workdir,
    systemPath: "system.mmd",
    system: parseSystemFromMermaidSource(systemSource),
    roleDisplayNames: new Map(caseSpec.roles.map((role) => [role.id, role.label[locale] || role.label["zh-CN"]]))
  });
  await writeFile(join(workdir, "system.design.json"), `${JSON.stringify(authoringToDesign(authoring), null, 2)}\n`);
  const catalog = await readFile(join(repositoryRoot, ".ogs", "model-catalog.json"), "utf8").catch(() => undefined);
  if (catalog) await writeFile(join(configDir, "model-catalog.json"), catalog);
  await writeFile(join(configDir, "laws.json"), `${JSON.stringify({ laws: [{
    lawId: `law.site.${caseSpec.id}`,
    constraints: { forbiddenToolRefs: [], maxTransitions: 32, allowNoopWithoutExecutionBinding: false }
  }] }, null, 2)}\n`);
  await writeFile(join(configDir, "runtime.json"), `${JSON.stringify({
    configVersion: "2",
    roleRepo: "team-roles",
    runsDir: ".ogs/runs",
    redaction: { enabled: true },
    tools: { environmentPolicy: "minimal", envAllowlist: [] },
    runtime: { error_flows: { v1: false } }
  }, null, 2)}\n`);
  const demoBackend = resolveDemoBackend();
  const demoModel = resolveDemoModel(process.env, demoBackend);
  const modelTimeoutMs = Number(process.env.OGS_CASE_MODEL_TIMEOUT_MS || DEFAULT_DEMO_MODEL_TIMEOUT_MS);
  if (!Number.isFinite(modelTimeoutMs) || modelTimeoutMs <= 0) {
    throw new Error("OGS_CASE_MODEL_TIMEOUT_MS must be a positive number.");
  }
  const roleSelections = Object.fromEntries(caseSpec.roles
    .filter((role) => role.backend)
    .map((role) => [role.id, resolveCaseRoleModel(caseSpec, role)]));
  await writeFile(join(configDir, "model-selection.json"), `${JSON.stringify({
    configVersion: "3",
    defaults: {
      backend: demoBackend,
      modelId: demoModel,
      timeoutMs: modelTimeoutMs,
      maxOutputBytes: 65536
    },
    ...(Object.keys(roleSelections).length ? { roles: roleSelections } : {})
  }, null, 2)}\n`);
  if (executionRoles.length) {
    await writeFile(join(workdir, "profiles.json"), `${JSON.stringify(executionRoles.map((role) => ({
      profileId: role.execution.profileId,
      toolRef: role.execution.toolRef,
      timeoutMs: role.execution.timeoutMs ?? 180000,
      maxOutputBytes: role.execution.maxOutputBytes ?? 65536
    })), null, 2)}\n`);
    await writeFile(join(workdir, "tools.json"), `${JSON.stringify({ tools: executionRoles.map((role) => ({
      toolRef: role.execution.toolRef,
      runner: "local_shell",
      command: process.execPath,
      argsTemplate: ["tools/publish-artifacts.mjs", role.execution.format],
      stdinMode: "none"
    })) }, null, 2)}\n`);
  }
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
    return {
      caseId,
      mode,
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
