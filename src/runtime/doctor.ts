/**
 * @fileoverview Runtime diagnostics command (`run:doctor`) for environment and run health checks.
 * File Set: runtime-observability
 * Responsibilities:
 * - Verify required executables and config/repo integrity.
 * - Inspect run-resume prerequisites and optional online model connectivity.
 * Boundaries:
 * - Diagnostic only; does not start graph execution.
 */
import { accessSync, constants } from "node:fs";
import { readdir } from "node:fs/promises";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  resolveProjectRoleRepoRoot,
  resolveProjectRoleRootDir
} from "./bundled-repos.js";
import { validateLawsConfig, validateRuntimeConfig, validateUserProfileConfig } from "./config.js";
import { readJsonFile } from "./json-file.js";
import { listSupportedJoinModes, listSupportedRoutingModes } from "./graph-mode-registry.js";
import { loadModelCatalog } from "./model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "./model-selection.js";
import { executeOpencodeModelRole, startOpencodeRunClient } from "./opencode-executor.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { redactText } from "./redaction.js";
import { loadRolePackage } from "./role-repo.js";
import { resolveProjectTargetDirectory } from "./project-target.js";
import { listRunArtifactPolicy } from "./run-artifact-policy.js";
import {
  RuntimeError,
  createRuntimeError,
  formatRuntimeErrorEnvelope,
  normalizeRuntimeError
} from "./runtime-errors.js";
import type { RuntimeConfig, SystemDefinition } from "./types.js";

type CheckResult = {
  command: string;
  found: boolean;
  path?: string;
};

export type ProviderHealthCheck = {
  roleId?: string;
  modelRef?: string;
  status: "ok" | "failed" | "skipped";
  code:
    | "DOCTOR_PROVIDER_ONLINE_SKIPPED"
    | "DOCTOR_PROVIDER_NO_MODEL_BINDINGS"
    | "DOCTOR_PROVIDER_CONNECTIVITY_OK"
    | "DOCTOR_PROVIDER_CONNECTIVITY_FAILED";
  message: string;
};

export type DoctorReport = {
  status: "ok" | "failed";
  required: string[];
  missingRequired: string[];
  checks: CheckResult[];
  errors: string[];
  warnings: string[];
  notes: string[];
  providerHealth: ProviderHealthCheck[];
  run?: {
    runDir: string;
    status?: string;
    activeBranches: number;
    completedBranches: number;
    sessions: number;
    resumePrerequisites: Array<{
      name: string;
      ok: boolean;
    }>;
  };
};

export function usage(): string {
  return [
    "Usage:",
    "  ogs doctor [--required opencode] [--system file.mmd] [--run-dir .ogs/runs/<run-id>]",
    "",
    "Source repository equivalent:",
    "  pnpm run run:doctor -- [--required opencode] [--system file.mmd] [--run-dir .ogs/runs/<run-id>]",
    "",
    "Options:",
    "  --required <csv>       Required commands. Missing required commands return exit code 2.",
    "  --runtime <file>       Runtime config JSON (default: .ogs/runtime.json)",
    "  --laws <file>          Law catalog JSON (default: .ogs/laws.json)",
    "  --user-profile <file>  User profile JSON (default: .ogs/user-profile.json)",
    "  --system <file>        Mermaid system to validate with the active config/law catalog",
    "  --run-dir <dir>        Inspect an existing run directory for resume prerequisites",
    "  --online-check         Optional online model connectivity probe (costs tokens)",
    "  --workdir <path>       Working directory root (default: cwd)",
    "  --help                 Show help"
  ].join("\n");
}

function createDoctorInputError(errorCode: string, message: string): RuntimeError {
  return createRuntimeError({
    errorCode,
    errorCategory: "input",
    message,
    retryable: false,
    stage: "doctor"
  });
}

function parseDoctorArgs() {
  try {
    return parseArgs({
      options: {
        required: { type: "string" },
        runtime: { type: "string" },
        laws: { type: "string" },
        "user-profile": { type: "string" },
        system: { type: "string" },
        "run-dir": { type: "string" },
        "online-check": { type: "boolean" },
        workdir: { type: "string" },
        help: { type: "boolean", short: "h" }
      },
      allowPositionals: false
    });
  } catch (error) {
    throw createDoctorInputError(
      "DOCTOR_INVALID_ARGS",
      error instanceof Error ? error.message : String(error)
    );
  }
}

function fileAccessible(path: string): boolean {
  try {
    accessSync(path, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCandidates(command: string): string[] {
  const hasExt = extname(command) !== "";
  if (hasExt) {
    return [command];
  }
  if (process.platform === "win32") {
    return (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .map((ext) => ext.trim())
      .filter(Boolean)
      .map((ext) => `${command}${ext}`);
  }
  return [command];
}

function findExecutable(command: string): string | undefined {
  const candidates = resolveCandidates(command);
  for (const candidate of candidates) {
    if (fileAccessible(candidate)) {
      return candidate;
    }
  }

  const containsSeparator = command.includes("/") || command.includes("\\");
  if (containsSeparator) {
    return undefined;
  }

  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const candidate of candidates) {
      const fullPath = join(entry, candidate);
      if (fileAccessible(fullPath)) {
        return fullPath;
      }
    }
  }

  return undefined;
}

function checkCommand(command: string): CheckResult {
  const path = findExecutable(command);
  return { command, found: Boolean(path), path: path || undefined };
}

function addError(report: DoctorReport, message: string): void {
  report.errors.push(message);
}

function addWarning(report: DoctorReport, message: string): void {
  report.warnings.push(message);
}

function addNote(report: DoctorReport, message: string): void {
  report.notes.push(message);
}

async function inspectRoleRepoInventory(report: DoctorReport, roleRepoRoot: string): Promise<void> {
  const rolesRoot = resolve(roleRepoRoot, "roles");
  let entries;
  try {
    entries = await readdir(rolesRoot, { withFileTypes: true });
  } catch (error) {
    addError(report, `role repo missing or unreadable: ${rolesRoot} (${String(error)})`);
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith("_")) {
      continue;
    }
    try {
      await loadRolePackage({
        roleId: entry.name,
        roleRootDir: rolesRoot
      });
    } catch (error) {
      addWarning(report, `role package inventory warning: ${entry.name} (${String(error)})`);
    }
  }
  addNote(report, `role repo inventory scanned: ${rolesRoot}`);
}

async function inspectModelCatalog(report: DoctorReport, workdir: string): Promise<void> {
  const catalogPath = resolve(workdir, ".ogs", "model-catalog.json");
  try {
    const catalog = await loadModelCatalog(catalogPath);
    if (!catalog) {
      addWarning(report, `model catalog unavailable: ${catalogPath}`);
      return;
    }
    addNote(report, `model catalog loaded: ${catalog.models.length} entries`);
  } catch (error) {
    addError(report, `model catalog invalid: ${catalogPath} (${String(error)})`);
    return;
  }
}

async function inspectRunDir(report: DoctorReport, runDir: string): Promise<void> {
  const statePath = resolve(runDir, "state.json");
  const sessionsPath = resolve(runDir, "sessions.json");
  const prerequisites = [
    {
      name: "state.json",
      ok: false
    },
    {
      name: "state.json.graphState",
      ok: false
    },
    {
      name: "sessions.json",
      ok: false
    }
  ];

  let status: string | undefined;
  let activeBranches = 0;
  let completedBranches = 0;
  let sessions = 0;

  try {
    const state = await readJsonFile(statePath);
    prerequisites[0].ok = true;
    if (
      typeof state === "object" &&
      state !== null &&
      !Array.isArray(state) &&
      "graphState" in state
    ) {
      prerequisites[1].ok = true;
      const record = state as {
        status?: string;
        activeBranches?: unknown[];
        completedBranches?: unknown[];
      };
      status = record.status;
      activeBranches = Array.isArray(record.activeBranches) ? record.activeBranches.length : 0;
      completedBranches = Array.isArray(record.completedBranches)
        ? record.completedBranches.length
        : 0;
    } else {
      addError(report, `run inspection missing state.json.graphState: ${statePath}`);
    }
  } catch (error) {
    addError(report, `run inspection missing state.json: ${statePath} (${String(error)})`);
  }

  try {
    const sessionIndex = await readJsonFile(sessionsPath);
    if (Array.isArray(sessionIndex)) {
      prerequisites[2].ok = true;
      sessions = sessionIndex.length;
    } else {
      addWarning(report, `run inspection sessions.json is not an array: ${sessionsPath}`);
    }
  } catch {
    addWarning(report, `run inspection missing sessions.json: ${sessionsPath}`);
  }

  report.run = {
    runDir,
    status,
    activeBranches,
    completedBranches,
    sessions,
    resumePrerequisites: prerequisites
  };

  for (const prerequisite of prerequisites) {
    if (!prerequisite.ok && prerequisite.name !== "sessions.json") {
      addError(report, `resume prerequisite missing: ${prerequisite.name}`);
    }
  }
  addNote(report, `artifact policy entries: ${listRunArtifactPolicy().length}`);
}

async function runOnlineModelConnectivityCheck(args: {
  report: DoctorReport;
  workdir: string;
  targetDir: string;
  system: SystemDefinition;
}): Promise<void> {
  const ONLINE_CHECK_MIN_TIMEOUT_MS = 20000;
  const ONLINE_CHECK_MAX_TIMEOUT_MS = 90000;

  const selection = await loadModelSelection(resolve(args.workdir, ".ogs", "model-selection.json"));
  const catalog = await loadModelCatalog(resolve(args.workdir, ".ogs", "model-catalog.json"));
  const resolvedSelection = resolveModelSelectionForSystem({
    system: args.system,
    selection,
    catalog
  });
  const resolvedModels = Array.from(resolvedSelection.resolvedByRoleId.entries());
  if (resolvedModels.length === 0) {
    args.report.providerHealth.push({
      status: "skipped",
      code: "DOCTOR_PROVIDER_NO_MODEL_BINDINGS",
      message: "online check skipped: system does not bind any model"
    });
    addWarning(args.report, "online check skipped: system does not bind any model");
    return;
  }

  let serverTimeoutMs = ONLINE_CHECK_MIN_TIMEOUT_MS;
  for (const [, selectionConfig] of resolvedModels) {
    serverTimeoutMs = Math.max(serverTimeoutMs, selectionConfig.timeoutMs ?? ONLINE_CHECK_MIN_TIMEOUT_MS);
  }
  serverTimeoutMs = Math.min(Math.max(serverTimeoutMs, ONLINE_CHECK_MIN_TIMEOUT_MS), ONLINE_CHECK_MAX_TIMEOUT_MS);

  // Trade-off: reuse one short-lived OpenCode server for all probes to keep doctor latency/cost
  // bounded while still validating each model binding independently.
  const runClient = await startOpencodeRunClient({
    timeoutMs: serverTimeoutMs,
    directory: args.targetDir
  });

  try {
    for (const [roleId, selectionConfig] of resolvedModels) {
      try {
        const checkTimeoutMs = Math.min(
          Math.max(selectionConfig.timeoutMs ?? ONLINE_CHECK_MIN_TIMEOUT_MS, ONLINE_CHECK_MIN_TIMEOUT_MS),
          ONLINE_CHECK_MAX_TIMEOUT_MS
        );
        await executeOpencodeModelRole({
          roleId: `doctor-online-${roleId}`,
          prompt: 'Return exactly this JSON: {"ok": true}',
          schema: {
            type: "object",
            properties: {
              ok: {
                type: "boolean"
              }
            },
            required: ["ok"],
            additionalProperties: false
          },
          modelRef: selectionConfig.modelRef,
          variant: selectionConfig.variant,
          workdir: args.workdir,
          directory: args.targetDir,
          timeoutMs: checkTimeoutMs,
          maxOutputBytes: selectionConfig.maxOutputBytes ?? 4096,
          runClient
        });
        args.report.providerHealth.push({
          roleId,
          modelRef: selectionConfig.modelRef,
          status: "ok",
          code: "DOCTOR_PROVIDER_CONNECTIVITY_OK",
          message: "online connectivity ok"
        });
        addNote(args.report, `online connectivity ok: ${roleId} -> ${selectionConfig.modelRef}`);
      } catch (error) {
        const message = redactText(error instanceof Error ? error.message : String(error));
        args.report.providerHealth.push({
          roleId,
          modelRef: selectionConfig.modelRef,
          status: "failed",
          code: "DOCTOR_PROVIDER_CONNECTIVITY_FAILED",
          message
        });
        addError(
          args.report,
          `online connectivity failed: ${roleId} -> ${selectionConfig.modelRef} (${message})`
        );
      }
    }
  } finally {
    await runClient.close();
  }
}

export async function runDoctor(args: {
  requiredCsv?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  lawsPath?: string;
  systemPath?: string;
  runDir?: string;
  onlineCheck?: boolean;
  workdir?: string;
}): Promise<DoctorReport> {
  const workdir = resolve(args.workdir ?? process.cwd());
  const runtimePath = resolve(workdir, args.runtimeConfigPath ?? ".ogs/runtime.json");
  const lawsPath = resolve(workdir, args.lawsPath ?? ".ogs/laws.json");
  const userProfilePath = resolve(workdir, args.userProfilePath ?? ".ogs/user-profile.json");
  const required = Array.from(
    new Set(
      (args.requiredCsv ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );

  const report: DoctorReport = {
    status: "ok",
    required,
    missingRequired: [],
    checks: ["opencode", "codex"].map((command) => checkCommand(command)),
    errors: [],
    warnings: [],
    notes: [],
    providerHealth: []
  };

  report.missingRequired = report.checks
    .filter((item) => required.includes(item.command) && !item.found)
    .map((item) => item.command);
  if (report.missingRequired.length > 0) {
    addError(report, `missing required commands: ${report.missingRequired.join(", ")}`);
  }

  let runtimeConfig: RuntimeConfig | undefined;
  try {
    runtimeConfig = validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath);
    addNote(report, `runtime config: ${runtimePath}`);
    await inspectRoleRepoInventory(report, resolveProjectRoleRepoRoot(workdir, runtimeConfig.roleRepo));
    await inspectModelCatalog(report, workdir);
  } catch (error) {
    addError(report, `runtime config invalid: ${String(error)}`);
  }

  try {
    validateUserProfileConfig(await readJsonFile(userProfilePath), userProfilePath);
    addNote(report, `user profile: ${userProfilePath}`);
  } catch (error) {
    addWarning(report, `user profile unavailable: ${String(error)}`);
  }

  let lawIds = new Set<string>();
  try {
    const laws = validateLawsConfig(await readJsonFile(lawsPath), lawsPath);
    lawIds = new Set(laws.laws.map((item) => item.lawId));
    addNote(report, `laws: ${lawsPath}`);
  } catch (error) {
    addError(report, `laws invalid: ${String(error)}`);
  }

  let system: SystemDefinition | undefined;
  if (args.systemPath) {
    try {
      system = await loadSystemFromMermaid(resolve(workdir, args.systemPath));
      addNote(report, `system: ${system.systemId}`);
      if (!lawIds.has(system.lawBinding.globalLawRef)) {
        addError(report, `system law reference missing from law catalog: ${system.lawBinding.globalLawRef}`);
      }

      const loadedRuntimeConfig =
        runtimeConfig ?? validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath);
      runtimeConfig = loadedRuntimeConfig;
      const roleRootDir = resolveProjectRoleRootDir(workdir, loadedRuntimeConfig.roleRepo);
      for (const roleId of system.roleIds) {
        try {
          await loadRolePackage({
            roleId,
            roleRootDir
          });
        } catch (error) {
          addError(report, `system role package invalid: ${roleId} (${String(error)})`);
        }
      }
      const selection = await loadModelSelection(resolve(workdir, ".ogs", "model-selection.json"));
      const catalog = await loadModelCatalog(resolve(workdir, ".ogs", "model-catalog.json"));
      const resolvedSelection = resolveModelSelectionForSystem({
        system,
        selection,
        catalog
      });
      for (const warning of resolvedSelection.warnings) {
        addWarning(report, warning);
      }
      addNote(report, `resolved model bindings: ${resolvedSelection.resolvedByRoleId.size}`);
      if (!args.onlineCheck) {
        for (const [roleId, selectionConfig] of resolvedSelection.resolvedByRoleId.entries()) {
          report.providerHealth.push({
            roleId,
            modelRef: selectionConfig.modelRef,
            status: "skipped",
            code: "DOCTOR_PROVIDER_ONLINE_SKIPPED",
            message: "online provider credential check skipped; pass --online-check to probe connectivity"
          });
        }
      }
    } catch (error) {
      addError(report, `system invalid: ${String(error)}`);
    }
  }

  if (args.onlineCheck) {
    if (!system || !runtimeConfig) {
      addWarning(report, "online check skipped: requires both valid runtime config and --system");
    } else {
      await runOnlineModelConnectivityCheck({
        report,
        workdir,
        targetDir: await resolveProjectTargetDirectory({ workdir }),
        system
      });
    }
  }

  if (args.runDir) {
    await inspectRunDir(report, resolve(workdir, args.runDir));
  }

  addNote(report, `routing modes: ${listSupportedRoutingModes().join(", ")}`);
  addNote(report, `join modes: ${listSupportedJoinModes().join(", ")}`);

  report.status = report.errors.length > 0 ? "failed" : "ok";
  return report;
}

export async function main(): Promise<void> {
  const { values } = parseDoctorArgs();

  if (values.help) {
    console.log(usage());
    return;
  }

  const report = await runDoctor({
    requiredCsv: values.required,
    runtimeConfigPath: values.runtime,
    lawsPath: values.laws,
    userProfilePath: values["user-profile"],
    systemPath: values.system,
    runDir: values["run-dir"],
    onlineCheck: values["online-check"] ?? false,
    workdir: values.workdir
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.missingRequired.length > 0) {
    process.exitCode = 2;
    return;
  }
  if (report.status === "failed") {
    process.exitCode = 1;
  }
}

export function handleDoctorCliError(error: unknown): void {
  const runtimeError =
    error instanceof RuntimeError
      ? error
      : createRuntimeError(
          normalizeRuntimeError(error, {
            errorCode: "DOCTOR_COMMAND_FAILED",
            errorCategory: "system",
            stage: "doctor",
            retryable: false
          })
        );
  console.error(runtimeError.message);
  console.error(formatRuntimeErrorEnvelope(runtimeError.envelope));
  process.exitCode = 1;
}

const isMainModule =
  typeof process.argv[1] === "string" && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

export async function runDoctorCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const originalArgv = process.argv;
  process.argv = [originalArgv[0] ?? "node", originalArgv[1] ?? "ogs", ...args];
  try {
    await main();
  } catch (error) {
    handleDoctorCliError(error);
  } finally {
    process.argv = originalArgv;
  }
}

if (isMainModule) {
  void runDoctorCli();
}
