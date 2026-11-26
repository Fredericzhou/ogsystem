import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { closeSync, openSync } from "node:fs";
import { constants } from "node:fs";
import { homedir, networkInterfaces, platform } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVICE_LABEL = "com.ogsystem.team-site";
const scriptRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptRoot, "..");
export const appRoot = join(repoRoot, "apps", "team-site");
export const serviceStateRoot = join(homedir(), ".ogsystem", "team-site");
export const launchAgentPath = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
export const logRoot = join(serviceStateRoot, "logs");
export const serviceStatePath = join(serviceStateRoot, "service.json");
export const nodePath = process.execPath;

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function plistString(value) {
  return `    <string>${xml(value)}</string>`;
}

export function createLaunchdPlist({
  node = nodePath,
  app = appRoot,
  projectsRoot = process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"),
  logs = logRoot,
  port = process.env.PORT || "4173",
  host = process.env.HOST || "127.0.0.1",
  visualizerUrl = process.env.OGS_VIS_URL || "http://127.0.0.1:4177",
  visualizerWorkdir = process.env.OGS_VIS_WORKDIR || join(homedir(), ".ogsystem", "visualizer-workspace"),
  pathValue = [...new Set([dirname(node), ...(process.env.PATH || "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean))].join(":"),
  label = SERVICE_LABEL
} = {}) {
  const environment = [
    ["HOST", host], ["PORT", port], ["OGS_VIS_URL", visualizerUrl],
    ["OGS_VIS_WORKDIR", visualizerWorkdir], ["OGS_SITE_PROJECTS_DIR", projectsRoot],
    ["PATH", pathValue]
  ];
  const environmentXml = environment.map(([key, value]) => `    <key>${xml(key)}</key>\n${plistString(value)}`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
${plistString(label)}
  <key>ProgramArguments</key>
  <array>
${plistString(node)}
${plistString(posix.join(app, "server.mjs"))}
  </array>
  <key>WorkingDirectory</key>
${plistString(app)}
  <key>EnvironmentVariables</key>
  <dict>
${environmentXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
${plistString("Interactive")}
  <key>StandardOutPath</key>
${plistString(posix.join(logs, "team-site.stdout.log"))}
  <key>StandardErrorPath</key>
${plistString(posix.join(logs, "team-site.stderr.log"))}
</dict>
</plist>
`;
}

function launchctl(args, { allowFailure = false } = {}) {
  try {
    return execFileSync("launchctl", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    if (allowFailure) return "";
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`launchctl ${args.join(" ")} failed: ${detail}`);
  }
}

function guiDomain(uid = process.getuid?.()) {
  if (!uid) throw new Error("Unable to determine the current macOS user id.");
  return `gui/${uid}`;
}

function delay(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export function serviceDomain(uid = process.getuid?.()) {
  return `${guiDomain(uid)}/${SERVICE_LABEL}`;
}

async function ensureBuild() {
  const required = join(repoRoot, "dist", "visualizer", "project-projection.js");
  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  try {
    await access(required, constants.R_OK);
  } catch {
    execFileSync(packageManager, ["build"], { cwd: repoRoot, stdio: "inherit" });
  }
  execFileSync(packageManager, ["--dir", appRoot, "run", "build:assets"], { cwd: repoRoot, stdio: "inherit" });
}

function serviceEnvironment({ host, port }) {
  return {
    ...process.env,
    HOST: host,
    PORT: String(port),
    OGS_VIS_URL: process.env.OGS_VIS_URL || "http://127.0.0.1:4177",
    OGS_VIS_WORKDIR: process.env.OGS_VIS_WORKDIR || join(homedir(), ".ogsystem", "visualizer-workspace"),
    OGS_SITE_PROJECTS_DIR: process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects")
  };
}

async function installPortableService({ host, port }) {
  await mkdir(logRoot, { recursive: true });
  await mkdir(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"), { recursive: true });
  await mkdir(process.env.OGS_VIS_WORKDIR || join(homedir(), ".ogsystem", "visualizer-workspace"), { recursive: true });
  await stopService();
  const stdout = openSync(join(logRoot, "team-site.stdout.log"), "a");
  const stderr = openSync(join(logRoot, "team-site.stderr.log"), "a");
  const child = spawn(nodePath, [join(appRoot, "server.mjs")], {
    cwd: appRoot,
    env: serviceEnvironment({ host, port }),
    detached: true,
    stdio: ["ignore", stdout, stderr]
  });
  closeSync(stdout);
  closeSync(stderr);
  child.unref();
  await writeFile(serviceStatePath, JSON.stringify({ pid: child.pid, host, port: Number(port) }, null, 2), "utf8");
  try {
    await waitForReady({ port });
  } catch (error) {
    await stopPortableService();
    throw error;
  }
  return serviceStatePath;
}

async function readPortableState() {
  try {
    return JSON.parse(await readFile(serviceStatePath, "utf8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function terminatePortableProcess(pid) {
  if (!pid || !processIsAlive(pid)) return;
  if (platform() === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // The process may have exited between the liveness check and taskkill.
    }
    return;
  }
  try {
    process.kill(Number(pid), "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function stopPortableService() {
  const state = await readPortableState();
  if (!state) return;
  const port = state.port || process.env.PORT || "4173";
  try {
    const response = await fetch(`http://127.0.0.1:${port}/_service/drain`, {
      method: "POST",
      signal: AbortSignal.timeout(10 * 60 * 1000 + 5000)
    });
    if (response.status === 404 || response.status === 405) await waitForLegacyServiceIdle(`http://127.0.0.1:${port}`);
    else if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Team Site refused to stop safely (HTTP ${response.status}).`);
    }
  } catch (error) {
    if (error?.cause?.code !== "ECONNREFUSED") throw error;
  }
  terminatePortableProcess(state.pid);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!processIsAlive(state.pid)) break;
    await delay(100);
  }
  await waitForServicePortRelease(port);
  await rm(serviceStatePath, { force: true });
}

export async function installService({ prepare = true, host = process.env.OGS_SITE_HOST || process.env.HOST || "127.0.0.1", port = process.env.PORT || "4173" } = {}) {
  if (prepare) await ensureBuild();
  if (platform() !== "darwin") return installPortableService({ host, port });
  await mkdir(dirname(launchAgentPath), { recursive: true });
  await mkdir(logRoot, { recursive: true });
  await mkdir(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"), { recursive: true });
  await mkdir(process.env.OGS_VIS_WORKDIR || join(homedir(), ".ogsystem", "visualizer-workspace"), { recursive: true });
  await writeFile(launchAgentPath, createLaunchdPlist({ host, port }), "utf8");
  const domain = guiDomain();
  await stopService();
  // A prior launchd disable persists across bootout, so re-enable the job before bootstrap.
  launchctl(["enable", serviceDomain()]);
  launchctl(["bootstrap", domain, launchAgentPath]);
  launchctl(["kickstart", "-k", serviceDomain()]);
  await waitForReady({ port });
  return launchAgentPath;
}

export async function stopService() {
  if (platform() !== "darwin") {
    await stopPortableService();
    return;
  }
  const serviceDetails = launchctl(["print", serviceDomain()], { allowFailure: true });
  if (!serviceDetails) {
    await waitForServicePortRelease(process.env.PORT || "4173");
    return;
  }
  const port = serviceDetails.match(/\bPORT\s*=>\s*(\d+)/)?.[1] || "4173";
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/_service/drain`, {
      method: "POST",
      signal: AbortSignal.timeout(10 * 60 * 1000 + 5000)
    });
  } catch (error) {
    if (error?.cause?.code !== "ECONNREFUSED") {
      throw new Error(`Team Site did not complete graceful shutdown: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (response && (response.status === 404 || response.status === 405)) {
    await waitForLegacyServiceIdle(`http://127.0.0.1:${port}`);
    response = undefined;
  }
  if (response && !response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Team Site refused to stop safely (HTTP ${response.status}).`);
  }
  launchctl(["bootout", serviceDomain()], { allowFailure: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!launchctl(["print", serviceDomain()], { allowFailure: true })) {
      await waitForServicePortRelease(port);
      return;
    }
    await delay(100);
  }
  throw new Error("Timed out while stopping the Team Site launchd job.");
}

async function waitForServicePortRelease(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(500) });
    } catch (error) {
      if (error?.cause?.code === "ECONNREFUSED") return;
      throw new Error(`Unable to confirm that Team Site released port ${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Team Site to release port ${port}.`);
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Unable to inspect active work (HTTP ${response.status}).`);
  return response.json();
}

async function waitForLegacyServiceIdle(origin, timeoutMs = 10 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const repository = await readJson(`${origin}/api/v2/team-repository?pageSize=50&page=1`);
    const teams = [...(repository.teams || [])];
    for (let page = 2; page <= Number(repository.pagination?.totalPages || 1); page += 1) {
      const next = await readJson(`${origin}/api/v2/team-repository?pageSize=50&page=${page}`);
      teams.push(...(next.teams || []));
    }
    let active = false;
    for (const team of teams) {
      const teamId = team.teamId || team.teamRootId || team.teamVersionId || team.projectId;
      const teamVersionId = team.teamVersionId || team.projectId;
      if (!teamId || !teamVersionId) continue;
      const simulations = await readJson(`${origin}/api/v2/teams/${encodeURIComponent(teamId)}/versions/${encodeURIComponent(teamVersionId)}/simulations`);
      if ((simulations.simulations || []).some((item) => ["running", "stopping"].includes(item.status))) active = true;
    }
    const projectList = await readJson(`${origin}/api/v2/projects`);
    for (const project of projectList.projects || []) {
      const detail = await readJson(`${origin}/api/v2/projects/${encodeURIComponent(project.projectId)}`);
      if ((detail.taskRecords || []).some((task) => ["planning", "running", "pause_requested", "cancel_requested"].includes(task.status))) active = true;
    }
    if (!active) return;
    await delay(1000);
  }
  throw new Error("Service restart cancelled because active runs did not finish within 10 minutes.");
}

export async function probe(url = "http://127.0.0.1:4173/healthz") {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function waitForReady({ timeoutMs = 15000, port = process.env.PORT || "4173" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe(`http://127.0.0.1:${port}/readyz`);
    if (result.ok && result.status === 200) return result;
    await delay(150);
  }
  throw new Error("Team Site launchd job did not become ready within 15 seconds. Inspect ~/.ogsystem/team-site/logs/.");
}

export async function readServiceStatus() {
  if (platform() !== "darwin") {
    const state = await readPortableState();
    const host = state?.host || null;
    const port = state?.port || Number(process.env.PORT || "4173");
    const health = await probe(`http://127.0.0.1:${port}/healthz`);
    const ready = await probe(`http://127.0.0.1:${port}/readyz`);
    return { label: SERVICE_LABEL, managed: Boolean(state), pid: state?.pid || null, host, port, urls: serviceUrls(host, port), health, ready, state: serviceStatePath };
  }
  const details = launchctl(["print", serviceDomain()], { allowFailure: true });
  const pid = Number(details.match(/\bpid\s*=\s*(\d+)/)?.[1] || 0);
  const host = details.match(/\bHOST\s*=>\s*(\S+)/)?.[1] || null;
  const port = details.match(/\bPORT\s*=>\s*(\d+)/)?.[1] || "4173";
  const health = await probe(`http://127.0.0.1:${port}/healthz`);
  const ready = await probe(`http://127.0.0.1:${port}/readyz`);
  return { label: SERVICE_LABEL, managed: Boolean(details), pid: pid || null, host, port: Number(port), urls: serviceUrls(host, port), health, ready, plist: launchAgentPath };
}

function serviceUrls(host, port = process.env.PORT || 4173) {
  if (!host || host === "127.0.0.1" || host === "localhost") return [`http://127.0.0.1:${port}/projects`];
  const addresses = Object.values(networkInterfaces()).flatMap((items) => items || [])
    .filter((item) => item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
  return [...new Set(addresses)].map((address) => `http://${address}:${port}/projects`);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--lan") options.host = "0.0.0.0";
    else if (value === "--host") {
      options.host = args[index + 1];
      if (!options.host || options.host.startsWith("--")) throw new Error("--host requires an address.");
      index += 1;
    } else if (value === "--port") {
      options.port = args[index + 1];
      if (!options.port || options.port.startsWith("--")) throw new Error("--port requires a number.");
      index += 1;
    } else if (value) throw new Error(`Unknown option: ${value}`);
  }
  if (options.host === undefined && process.env.OGS_SITE_HOST) options.host = process.env.OGS_SITE_HOST;
  if (options.port === undefined && process.env.PORT) options.port = process.env.PORT;
  return options;
}

async function main(command = process.argv[2] || "status", args = process.argv.slice(3)) {
  const options = parseOptions(args);
  if (command === "start") {
    await installService(options);
    console.log(`Team Site started:\n${serviceUrls(options.host || "127.0.0.1", options.port).join("\n")}`);
    return;
  }
  if (command === "stop") {
    await stopService();
    console.log("Team Site stopped.");
    return;
  }
  if (command === "restart") {
    await stopService();
    await installService(options);
    console.log(`Team Site restarted:\n${serviceUrls(options.host || "127.0.0.1", options.port).join("\n")}`);
    return;
  }
  if (command === "status") {
    const status = await readServiceStatus();
    console.log(JSON.stringify(status, null, 2));
    if (!status.managed || !status.health.ok || !status.ready.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`Unknown command: ${command}. Use start, stop, restart, or status.`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
