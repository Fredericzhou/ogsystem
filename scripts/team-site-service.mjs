import { execFileSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SERVICE_LABEL = "com.ogsystem.team-site";
const scriptRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(scriptRoot, "..");
export const appRoot = join(repoRoot, "apps", "team-site");
export const serviceStateRoot = join(homedir(), ".ogsystem", "team-site");
export const launchAgentPath = join(homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`);
export const logRoot = join(serviceStateRoot, "logs");
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
${plistString(join(app, "server.mjs"))}
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
${plistString(join(logs, "team-site.stdout.log"))}
  <key>StandardErrorPath</key>
${plistString(join(logs, "team-site.stderr.log"))}
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
  try {
    await access(required, constants.R_OK);
  } catch {
    execFileSync("pnpm", ["build"], { cwd: repoRoot, stdio: "inherit" });
  }
  execFileSync("pnpm", ["--dir", appRoot, "run", "build:assets"], { cwd: repoRoot, stdio: "inherit" });
}

export async function installService({ prepare = true } = {}) {
  if (platform() !== "darwin") throw new Error("team-site service management requires macOS launchd.");
  if (prepare) await ensureBuild();
  await mkdir(dirname(launchAgentPath), { recursive: true });
  await mkdir(logRoot, { recursive: true });
  await mkdir(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"), { recursive: true });
  await mkdir(process.env.OGS_VIS_WORKDIR || join(homedir(), ".ogsystem", "visualizer-workspace"), { recursive: true });
  await writeFile(launchAgentPath, createLaunchdPlist(), "utf8");
  const domain = guiDomain();
  await stopService();
  launchctl(["bootstrap", domain, launchAgentPath]);
  launchctl(["kickstart", "-k", serviceDomain()]);
  await waitForReady();
  return launchAgentPath;
}

export async function stopService() {
  if (platform() !== "darwin") throw new Error("team-site service management requires macOS launchd.");
  launchctl(["bootout", serviceDomain()], { allowFailure: true });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!launchctl(["print", serviceDomain()], { allowFailure: true })) return;
    await delay(100);
  }
  throw new Error("Timed out while stopping the Team Site launchd job.");
}

export async function probe(url = "http://127.0.0.1:4173/healthz") {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function waitForReady({ timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await probe("http://127.0.0.1:4173/readyz");
    if (result.ok && result.status === 200) return result;
    await delay(150);
  }
  throw new Error("Team Site launchd job did not become ready within 15 seconds. Inspect ~/.ogsystem/team-site/logs/.");
}

export async function readServiceStatus() {
  const details = launchctl(["print", serviceDomain()], { allowFailure: true });
  const pid = Number(details.match(/\bpid\s*=\s*(\d+)/)?.[1] || 0);
  const health = await probe();
  const ready = await probe("http://127.0.0.1:4173/readyz");
  return { label: SERVICE_LABEL, launchd: Boolean(details), pid: pid || null, health, ready, plist: launchAgentPath };
}

async function main(command = process.argv[2] || "status") {
  if (command === "start") {
    await installService();
    console.log(`Team Site started: http://127.0.0.1:${process.env.PORT || 4173}/projects`);
    return;
  }
  if (command === "stop") {
    await stopService();
    console.log("Team Site stopped.");
    return;
  }
  if (command === "restart") {
    await stopService();
    await installService();
    console.log(`Team Site restarted: http://127.0.0.1:${process.env.PORT || 4173}/projects`);
    return;
  }
  if (command === "status") {
    const status = await readServiceStatus();
    console.log(JSON.stringify(status, null, 2));
    if (!status.launchd || !status.health.ok || !status.ready.ok) process.exitCode = 1;
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
