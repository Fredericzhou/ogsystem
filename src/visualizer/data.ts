import { hostname as getHostname } from "node:os";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { compileExecutionSnapshot } from "../runtime/compiler.js";
import { loadFlowContractPlan } from "../runtime/flow-contract.js";
import { readJsonFile } from "../runtime/json-file.js";
import { loadModelCatalog } from "../runtime/model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { loadSystemFromMermaid, parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { buildRunPlanFingerprint } from "../runtime/plan-fingerprint.js";
import {
  inspectRun,
  loadPersistedRunsIndex,
  listHumanReviews,
  resolveOgsPaths,
  resolveRunDir
} from "../runtime/project-lifecycle.js";
import { listRunArtifactPolicy } from "../runtime/run-artifact-policy.js";
import { loadLaws, loadRolePackages, loadRuntimeConfig, loadUserProfile } from "../runtime/runtime-loader.js";
import { pathExists } from "../runtime/run-artifacts.js";
import { resolveEffectiveLaw } from "../runtime/runtime-setup.js";
import { isRuntimeOnlyErrorEvent } from "../runtime/error-flow-utils.js";
import { resolveProjectRoleRepoRoot, resolveProjectRoleRootDir } from "../runtime/bundled-repos.js";
export { inspectRunGraphVisualization } from "./run-graph-projection.js";
import {
  asBoolean,
  asNumber,
  asRecord,
  asString
} from "./json-guards.js";
import type {
  BranchRecord,
  GraphState,
  PendingHumanReview,
  RunArtifactPolicyEntry,
  StoredRoleResult,
  SystemDefinition
} from "../runtime/types.js";

type JsonRecord = Record<string, unknown>;

function parseIsoTimestamp(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

const MAX_MERMAID_LIVE_URL_LENGTH = 16_384;

function buildMermaidLiveUrl(systemSource: string | null): string | undefined {
  if (!systemSource) {
    return undefined;
  }
  const payload = JSON.stringify({
    code: systemSource,
    mermaid: { theme: "default" }
  });
  const url = `https://mermaid.live/edit#base64:${toBase64Url(payload)}`;
  return url.length <= MAX_MERMAID_LIVE_URL_LENGTH ? url : undefined;
}

function extractGraphState(state: unknown): GraphState | undefined {
  const record = asRecord(state);
  const graphState = asRecord(record?.graphState);
  return (graphState ?? record) as GraphState | undefined;
}

function getRunSimulation(detail: JsonRecord): {
  isSimulation: boolean;
  mode: "simulation" | "runtime";
  source: string;
} {
  const resolvedConfig = asRecord(detail.resolvedConfig);
  const effective = asRecord(resolvedConfig?.effective);
  const invocation = asRecord(effective?.invocation);
  const dryRun = asBoolean(invocation?.dryRun) === true;
  return {
    isSimulation: dryRun,
    mode: dryRun ? "simulation" : "runtime",
    source: dryRun ? "resolved-config" : "runtime-default"
  };
}

function isContractErrorCode(errorCode: string | undefined): boolean {
  return Boolean(errorCode && (errorCode.includes("CONTRACT") || errorCode.includes("SCHEMA")));
}

function isContractSignal(record: JsonRecord): boolean {
  const envelope = asRecord(record.errorEnvelope) ?? record;
  const errorCode = asString(envelope.errorCode) ?? asString(record.errorCode);
  const category = asString(envelope.errorCategory) ?? asString(record.errorCategory);
  const message = asString(envelope.message) ?? asString(record.message) ?? asString(record.error);
  return (
    isContractErrorCode(errorCode) ||
    category === "contract" ||
    category === "contract handoff violation" ||
    Boolean(message?.toLowerCase().includes("contract violation")) ||
    Boolean(message?.toLowerCase().includes("handoff contract"))
  );
}

function buildContractFailureEvidence(record: JsonRecord, source: string): JsonRecord {
  const envelope = asRecord(record.errorEnvelope) ?? record;
  return {
    source,
    at: asString(record.at) ?? asString(record.updatedAt),
    type: asString(record.type),
    roleId: asString(record.roleId) ?? asString(envelope.roleId),
    branchId: asString(record.branchId) ?? asString(envelope.branchId),
    errorCode: asString(envelope.errorCode) ?? asString(record.errorCode),
    errorCategory: asString(envelope.errorCategory) ?? asString(record.errorCategory),
    stage: asString(envelope.stage) ?? asString(record.stage),
    message: asString(envelope.message) ?? asString(record.message) ?? asString(record.error),
    contract: asRecord(envelope.contract) ?? asRecord(record.contract) ?? null
  };
}

function collectInlineRuntimeSignals(detail: JsonRecord): JsonRecord[] {
  const state = extractGraphState(detail.state);
  const summary = asRecord(detail.summary);
  const signals: JsonRecord[] = [];
  for (const audit of Array.isArray(state?.recentAudits) ? state.recentAudits : []) {
    const record = asRecord(audit);
    if (record) {
      signals.push({ ...record, source: "state.recentAudits" });
    }
  }
  const stateErrorEnvelope = asRecord(state?.errorEnvelope);
  if (stateErrorEnvelope) {
    signals.push({ ...stateErrorEnvelope, source: "state.errorEnvelope", at: asString(asRecord(state)?.updatedAt) });
  }
  const summaryTerminalEnvelope = asRecord(summary?.terminalErrorEnvelope);
  if (summaryTerminalEnvelope) {
    signals.push({
      ...summaryTerminalEnvelope,
      source: "summary.terminalErrorEnvelope",
      at: asString(summary?.updatedAt)
    });
  }
  const summaryLastErrorCode = asString(summary?.lastErrorCode);
  if (summaryLastErrorCode) {
    signals.push({
      source: "summary.lastErrorCode",
      errorCode: summaryLastErrorCode,
      at: asString(summary?.updatedAt),
      roleId: asString(summary?.lastRoleId)
    });
  }
  return signals;
}

async function readRuntimeEventSignals(runDir: string): Promise<JsonRecord[]> {
  const paths = [
    { path: resolve(runDir, "timeline.jsonl"), source: "timeline.jsonl" },
    { path: resolve(runDir, "events.ndjson"), source: "events.ndjson" }
  ];
  const signals: JsonRecord[] = [];
  for (const entry of paths) {
    const content = await readFile(entry.path, "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const parsed = asRecord(JSON.parse(trimmed));
        if (parsed) {
          signals.push({ ...parsed, source: entry.source });
        }
      } catch {
        continue;
      }
    }
  }
  return signals;
}

function compareSignalRecency(left: JsonRecord, right: JsonRecord): number {
  const leftTime = parseIsoTimestamp(asString(left.at) ?? asString(left.updatedAt)) ?? -1;
  const rightTime = parseIsoTimestamp(asString(right.at) ?? asString(right.updatedAt)) ?? -1;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return 0;
}

export async function inspectRunContractStatusVisualization(
  workdir: string,
  runId: string
): Promise<Record<string, unknown>> {
  const runDir = resolveRunDir(workdir, runId);
  const detail = (await inspectRun(workdir, runId)) as JsonRecord;
  const state = extractGraphState(detail.state);
  const summary = asRecord(detail.summary);
  const signals = [...collectInlineRuntimeSignals(detail), ...(await readRuntimeEventSignals(runDir))]
    .filter((signal) => Object.keys(signal).length > 0)
    .sort(compareSignalRecency);
  const contractFailures = signals.filter(isContractSignal);
  const latestContractFailure = contractFailures.at(-1);
  const runStatus = asString(summary?.status) ?? asString(state?.status) ?? asString(detail.status);
  const failedCount =
    asNumber(summary?.failedCount) ??
    asNumber(asRecord(state?.auditSummary)?.failedCount) ??
    asNumber(asRecord(detail.metrics)?.failedCount);
  const hasRuntimeSignal = signals.length > 0 || state !== undefined || summary !== undefined;
  const terminalPass = (runStatus === "done" || runStatus === "completed") && (failedCount === undefined || failedCount === 0);
  const terminalPassTime = parseIsoTimestamp(asString(summary?.updatedAt)) ?? Number.POSITIVE_INFINITY;
  const latestContractFailureTime = latestContractFailure
    ? (parseIsoTimestamp(asString(latestContractFailure.at) ?? asString(latestContractFailure.updatedAt)) ??
      Number.POSITIVE_INFINITY)
    : Number.NEGATIVE_INFINITY;

  let status: "pass" | "fail" | "unknown" | "no-runtime-signal";
  let reason: string;
  let evidence: JsonRecord | null = null;

  if (terminalPass && terminalPassTime >= latestContractFailureTime) {
    status = "pass";
    reason = "completed run has runtime artifacts and no newer contract-related failure signal";
    evidence = {
      source: summary ? "summary" : "state",
      status: runStatus,
      updatedAt: asString(summary?.updatedAt),
      failedCount: failedCount ?? 0
    };
  } else if (latestContractFailure) {
    status = "fail";
    reason = "latest contract-related error envelope or runtime event indicates a violation";
    evidence = buildContractFailureEvidence(latestContractFailure, asString(latestContractFailure.source) ?? "runtime");
  } else if (!hasRuntimeSignal) {
    status = "no-runtime-signal";
    reason = "run artifacts do not contain state, summary, audit, timeline, or event signals";
  } else {
    status = "unknown";
    reason = "runtime artifacts exist but the run has no terminal successful contract signal or contract failure";
  }

  return {
    runId,
    runDir,
    status,
    reason,
    runStatus: runStatus ?? "unknown",
    signalCount: signals.length,
    attribution: evidence,
    latestContractFailure: latestContractFailure
      ? buildContractFailureEvidence(latestContractFailure, asString(latestContractFailure.source) ?? "runtime")
      : null
  };
}

async function assembleProjectContext(workdir: string): Promise<{
  systemPath: string;
  systemSource: string;
  system: SystemDefinition;
  runtimeConfig: unknown;
  modelSelection: unknown;
  modelCatalog: unknown;
  laws: unknown;
  userProfile: unknown;
  compilerSnapshot: ReturnType<typeof compileExecutionSnapshot>["snapshot"];
  resolvedModelWarnings: string[];
  roleRepoRoot: string;
  projectMeta: unknown;
}> {
  const ogsPaths = resolveOgsPaths(workdir);
  const systemPath = resolve(workdir, "system.mmd");
  const systemSource = await readFile(systemPath, "utf8");
  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const modelSelection = await loadModelSelection(ogsPaths.modelSelectionPath);
  const modelCatalog = await loadModelCatalog(ogsPaths.modelCatalogPath);
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, workdir);
  const userProfile = await loadUserProfile(undefined, workdir);
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const roleRepoRoot = resolveProjectRoleRepoRoot(workdir, runtimeConfig.roleRepo);
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({
        system,
        contractPath: system.graph.handoffContracts
      })
    : undefined;
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo)
  });
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  });
  if (!compilerResult.ok) {
    throw new Error(
      `Compiler static semantics check failed for project visualization: ${compilerResult.diagnostics
        .map((diagnostic) => diagnostic.code)
        .join(", ")}`
    );
  }
  const projectMeta = await readJsonFile(ogsPaths.projectPath).catch(() => undefined);

  return {
    systemPath,
    systemSource,
    system,
    runtimeConfig,
    modelSelection,
    modelCatalog,
    laws,
    userProfile,
    compilerSnapshot: compilerResult.snapshot,
    resolvedModelWarnings: resolvedModelSelection.warnings,
    roleRepoRoot,
    projectMeta
  };
}

export async function inspectProjectVisualization(workdir: string): Promise<Record<string, unknown>> {
  const ogsPaths = resolveOgsPaths(workdir);
  const context = await assembleProjectContext(workdir);
  const persistedIndex = await loadPersistedRunsIndex(workdir);

  return {
    workdir,
    project: {
      projectName: basename(workdir),
      projectId: asString(asRecord(context.projectMeta)?.projectId),
      createdAt: asString(asRecord(context.projectMeta)?.createdAt),
      systemId: context.system.systemId,
      systemVersion: context.system.systemVersion,
      entryRoleId: context.system.entryRoleId,
      roleCount: context.system.roleIds.length,
      roleIds: context.system.roleIds,
      flowCount: context.system.flows.length,
      modelBindings: Object.entries(context.system.modelBinding).map(([roleId, modelRef]) => ({
        roleId,
        modelRef
      })),
      execBindings: Object.entries(context.system.executionBinding).map(([roleId, profileId]) => ({
        roleId,
        profileId
      })),
      reviewedRoleIds: Object.keys(context.system.graph?.reviewByRoleId ?? {}).sort(),
      joinRoleIds: Object.keys(context.system.graph?.joinModeByRoleId ?? {}).sort(),
      loopRoleIds: Object.keys(context.system.graph?.loopMaxByRoleId ?? {}).sort(),
      contextMappedRoleIds: Object.keys(context.system.graph?.contextMapByRoleId ?? {}).sort(),
      roleRepoRoot: context.roleRepoRoot,
      runsDir: asString(asRecord(context.runtimeConfig)?.runsDir) ?? resolve(workdir, ".ogs", "runs"),
      bindingSummaryByRoleId: context.compilerSnapshot.bindingSummaryByRoleId,
      joinSummaryByRoleId: context.compilerSnapshot.joinSummaryByRoleId,
      loopSummaryByRoleId: context.compilerSnapshot.loopSummaryByRoleId,
      projectionSummaryByRoleId: context.compilerSnapshot.projectionSummaryByRoleId,
      reviewSummaryByRoleId: context.compilerSnapshot.reviewSummaryByRoleId,
      flowSummaryByKey: context.compilerSnapshot.flowSummaryByKey,
      lawSummary: context.compilerSnapshot.lawSummary,
      compilerDigest: context.compilerSnapshot.digest,
      compilerDiagnostics: context.compilerSnapshot.diagnostics,
      modelSelectionWarnings: context.resolvedModelWarnings,
      artifactPaths: {
        systemPath: context.systemPath,
        runtimePath: ogsPaths.runtimePath,
        modelSelectionPath: ogsPaths.modelSelectionPath,
        modelCatalogPath: ogsPaths.modelCatalogPath,
        lawsPath: ogsPaths.lawsPath,
        userProfilePath: ogsPaths.userProfilePath,
        projectPath: ogsPaths.projectPath
      }
    },
    recentRuns: persistedIndex?.runs.slice(0, 10) ?? []
  };
}

export async function inspectProjectSystemVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  return {
    workdir,
    systemSource: context.systemSource,
    system: context.system
  };
}

export async function inspectProjectConfigVisualization(workdir: string): Promise<Record<string, unknown>> {
  const ogsPaths = resolveOgsPaths(workdir);
  const context = await assembleProjectContext(workdir);
  return {
    workdir,
    paths: ogsPaths,
    runtime: context.runtimeConfig,
    modelSelection: context.modelSelection ?? null,
    modelCatalog: context.modelCatalog ?? null,
    laws: context.laws ?? null,
    userProfile: context.userProfile ?? null,
    project: context.projectMeta ?? null,
    roleRepoRoot: context.roleRepoRoot,
    compilerDigest: context.compilerSnapshot.digest,
    modelSelectionWarnings: context.resolvedModelWarnings
  };
}

export async function listProjectRolesVisualization(workdir: string): Promise<Record<string, unknown>> {
  const context = await assembleProjectContext(workdir);
  const roles = Object.entries(context.compilerSnapshot.roleSummaryByRoleId)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([roleId, roleSummary]) => ({
      roleId,
      summary: roleSummary,
      binding: context.compilerSnapshot.bindingSummaryByRoleId[roleId] ?? null,
      join: context.compilerSnapshot.joinSummaryByRoleId[roleId] ?? null,
      loop: context.compilerSnapshot.loopSummaryByRoleId[roleId] ?? null,
      projection: context.compilerSnapshot.projectionSummaryByRoleId[roleId] ?? null,
      review: context.compilerSnapshot.reviewSummaryByRoleId[roleId] ?? null
    }));
  return {
    workdir,
    roleRepoRoot: context.roleRepoRoot,
    roles
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}

async function inspectResumeLock(runDir: string): Promise<Record<string, unknown>> {
  const lockPath = resolve(runDir, ".resume.lock");
  if (!(await pathExists(lockPath))) {
    return {
      path: lockPath,
      present: false,
      ok: true,
      stale: false
    };
  }

  let raw: unknown;
  try {
    raw = await readJsonFile(lockPath);
  } catch (error) {
    return {
      path: lockPath,
      present: true,
      ok: false,
      stale: false,
      message: error instanceof Error ? error.message : String(error)
    };
  }

  const record = asRecord(raw);
  const pid = asNumber(record?.pid);
  const lockHostname = asString(record?.hostname);
  const stale = pid !== undefined && lockHostname === getHostname() ? !isProcessAlive(pid) : false;
  return {
    path: lockPath,
    present: true,
    ok: record !== undefined && pid !== undefined && lockHostname !== undefined,
    stale,
    record: raw
  };
}

async function listDecisionFiles(reviewsDir: string): Promise<Array<{ path: string; parsed?: JsonRecord; error?: string }>> {
  let entries;
  try {
    entries = await readdir(reviewsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const decisionFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".decision.json"));
  return Promise.all(
    decisionFiles.map(async (entry) => {
      const filePath = resolve(reviewsDir, entry.name);
      try {
        return {
          path: filePath,
          parsed: asRecord(await readJsonFile(filePath))
        };
      } catch (error) {
        return {
          path: filePath,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

async function listRequestFiles(reviewsDir: string): Promise<Array<{ path: string; parsed?: JsonRecord; error?: string }>> {
  let entries;
  try {
    entries = await readdir(reviewsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const requestFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".request.json"));
  return Promise.all(
    requestFiles.map(async (entry) => {
      const filePath = resolve(reviewsDir, entry.name);
      try {
        return {
          path: filePath,
          parsed: asRecord(await readJsonFile(filePath))
        };
      } catch (error) {
        return {
          path: filePath,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

async function listExecutionOutcomes(runDir: string): Promise<Array<{ path: string; parsed?: JsonRecord; error?: string }>> {
  const rolesDir = resolve(runDir, "roles");
  let roleEntries;
  try {
    roleEntries = await readdir(rolesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const roleEntry of roleEntries) {
    if (!roleEntry.isDirectory()) {
      continue;
    }
    const executionsDir = resolve(rolesDir, roleEntry.name, "executions");
    let executionEntries;
    try {
      executionEntries = await readdir(executionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const executionEntry of executionEntries) {
      if (!executionEntry.isDirectory()) {
        continue;
      }
      files.push(resolve(executionsDir, executionEntry.name, "execution-outcome.json"));
    }
  }

  return Promise.all(
    files.map(async (filePath) => {
      try {
        if (!(await pathExists(filePath))) {
          return {
            path: filePath,
            error: "missing"
          };
        }
        return {
          path: filePath,
          parsed: asRecord(await readJsonFile(filePath))
        };
      } catch (error) {
        return {
          path: filePath,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

async function listCheckpointFiles(runDir: string): Promise<Array<{ path: string; parsed?: JsonRecord; error?: string }>> {
  const checkpointsDir = resolve(runDir, "checkpoints");
  let entries;
  try {
    entries = await readdir(checkpointsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  return Promise.all(
    files.map(async (entry) => {
      const filePath = resolve(checkpointsDir, entry.name);
      try {
        return {
          path: filePath,
          parsed: asRecord(await readJsonFile(filePath))
        };
      } catch (error) {
        return {
          path: filePath,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    })
  );
}

function compareFingerprintComponents(args: { expected: JsonRecord; stored: JsonRecord }): string[] {
  const expectedComponents = asRecord(args.expected.payload)?.components;
  const storedComponents = asRecord(args.stored.payload)?.components;
  const expectedRecord = asRecord(expectedComponents);
  const storedRecord = asRecord(storedComponents);
  if (!expectedRecord || !storedRecord) {
    return [];
  }
  const componentNames = new Set([...Object.keys(expectedRecord), ...Object.keys(storedRecord)]);
  return Array.from(componentNames).filter((name) => {
    const expectedDigest = asString(asRecord(expectedRecord[name])?.digest);
    const storedDigest = asString(asRecord(storedRecord[name])?.digest);
    return expectedDigest !== storedDigest;
  });
}

function extractFingerprintComponentDigests(fingerprint: JsonRecord | undefined): Record<string, string> {
  const components = asRecord(asRecord(fingerprint?.payload)?.components);
  if (!components) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(components).flatMap(([componentName, value]) => {
      const digest = asString(asRecord(value)?.digest);
      return digest ? [[componentName, digest]] : [];
    })
  );
}

function extractReviewId(filePath: string, suffix: string): string {
  const name = basename(filePath);
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
}

function parseCheckpointSequence(filePath: string): number | undefined {
  const match = /^(\d+)-/.exec(basename(filePath));
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : undefined;
}

type ResumeDiagnosticsCacheEntry = {
  token: string;
  expiresAt: number;
  value: Promise<Record<string, unknown>>;
};

const RESUME_DIAGNOSTICS_TTL_MS = 5_000;
const resumeDiagnosticsCache = new Map<string, ResumeDiagnosticsCacheEntry>();

export function invalidateResumeDiagnosticsCache(workdir: string, runId?: string): void {
  if (runId) {
    resumeDiagnosticsCache.delete(`${workdir}:${runId}`);
    return;
  }
  for (const key of resumeDiagnosticsCache.keys()) {
    if (key.startsWith(`${workdir}:`)) {
      resumeDiagnosticsCache.delete(key);
    }
  }
}

async function getMtimeToken(path: string): Promise<string> {
  const fileStat = await stat(path).catch(() => undefined);
  return fileStat ? `${path}:${fileStat.mtimeMs}:${fileStat.size}` : `${path}:missing`;
}

async function listExecutionOutcomeStatTokens(runDir: string): Promise<string[]> {
  const rolesDir = resolve(runDir, "roles");
  let roleEntries;
  try {
    roleEntries = await readdir(rolesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const tokens: string[] = [];
  for (const roleEntry of roleEntries) {
    if (!roleEntry.isDirectory()) {
      continue;
    }
    const executionsDir = resolve(rolesDir, roleEntry.name, "executions");
    let executionEntries;
    try {
      executionEntries = await readdir(executionsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const executionEntry of executionEntries) {
      if (!executionEntry.isDirectory()) {
        continue;
      }
      tokens.push(await getMtimeToken(resolve(executionsDir, executionEntry.name, "execution-outcome.json")));
    }
  }
  return tokens.sort((left, right) => left.localeCompare(right));
}

async function computeResumeDiagnosticsCacheToken(workdir: string, runId: string): Promise<string> {
  const runDir = resolveRunDir(workdir, runId);
  const staticTokens = await Promise.all([
    getMtimeToken(resolve(runDir, "state.json")),
    getMtimeToken(resolve(runDir, "sessions.json")),
    getMtimeToken(resolve(runDir, "plan-fingerprint.json")),
    getMtimeToken(resolve(runDir, "control", "reviews")),
    getMtimeToken(resolve(runDir, "checkpoints")),
    getMtimeToken(resolve(runDir, ".resume.lock"))
  ]);
  const outcomeTokens = await listExecutionOutcomeStatTokens(runDir);
  return staticTokens.concat(outcomeTokens).join("|");
}

async function computeExpectedFingerprint(workdir: string, runDir: string): Promise<JsonRecord> {
  const systemPath = resolve(runDir, "system.mmd");
  const system = await loadSystemFromMermaid(systemPath);
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const modelSelection = await loadModelSelection(resolve(workdir, ".ogs", "model-selection.json"));
  const modelCatalog = await loadModelCatalog(resolve(workdir, ".ogs", "model-catalog.json"));
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const laws = await loadLaws(undefined, workdir);
  const effectiveLaw = resolveEffectiveLaw(system, laws);
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo)
  });
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({
        system,
        contractPath: system.graph.handoffContracts
      })
    : undefined;
  const compilerResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId
  });
  if (!compilerResult.ok) {
    throw new Error(
      `Compiler static semantics check failed while computing resume diagnostics: ${compilerResult.diagnostics
        .map((diagnostic) => diagnostic.code)
        .join(", ")}`
    );
  }

  return buildRunPlanFingerprint({
    system,
    rolePackagesByRoleId,
    resolvedModelsByRoleId: resolvedModelSelection.resolvedByRoleId,
    effectiveLaw,
    contractPlan,
    compilerSnapshot: compilerResult.snapshot
  }) as unknown as JsonRecord;
}

function toDiagnosticCheck(args: {
  id: string;
  label: string;
  ok: boolean;
  severity?: "info" | "warning" | "error";
  message?: string;
  detail?: unknown;
}): Record<string, unknown> {
  return {
    id: args.id,
    label: args.label,
    ok: args.ok,
    severity: args.severity ?? (args.ok ? "info" : "error"),
    message: args.message,
    detail: args.detail
  };
}

export async function inspectRunResumeDiagnostics(workdir: string, runId: string): Promise<Record<string, unknown>> {
  const cacheKey = `${workdir}:${runId}`;
  const token = await computeResumeDiagnosticsCacheToken(workdir, runId);
  const cached = resumeDiagnosticsCache.get(cacheKey);
  if (cached && cached.token === token && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const value = (async (): Promise<Record<string, unknown>> => {
  const runDir = resolveRunDir(workdir, runId);
  const detail = await inspectRun(workdir, runId);
  const graphState = extractGraphState(detail.state);
  const reviewsDir = resolve(runDir, "control", "reviews");
  const [stateStat, sessionsStat, fingerprintStat] = await Promise.all([
    stat(resolve(runDir, "state.json")).catch(() => undefined),
    stat(resolve(runDir, "sessions.json")).catch(() => undefined),
    stat(resolve(runDir, "plan-fingerprint.json")).catch(() => undefined)
  ]);
  const requestFiles = await listRequestFiles(reviewsDir);
  const decisionFiles = await listDecisionFiles(reviewsDir);
  const executionOutcomes = await listExecutionOutcomes(runDir);
  const checkpointFiles = await listCheckpointFiles(runDir);
  const resumeLock = await inspectResumeLock(runDir);
  const policy = listRunArtifactPolicy().filter((entry) => entry.resumeConsumed);

  let storedFingerprint: JsonRecord | undefined;
  let fingerprintReadError: string | undefined;
  try {
    storedFingerprint = asRecord(await readJsonFile(resolve(runDir, "plan-fingerprint.json")));
  } catch (error) {
    fingerprintReadError = error instanceof Error ? error.message : String(error);
  }

  let fingerprintMismatch = false;
  let fingerprintChangedComponents: string[] = [];
  let expectedFingerprint: JsonRecord | undefined;
  let fingerprintExpectedError: string | undefined;
  if (storedFingerprint) {
    try {
      expectedFingerprint = await computeExpectedFingerprint(workdir, runDir);
      fingerprintMismatch = asString(expectedFingerprint.digest) !== asString(storedFingerprint.digest);
      fingerprintChangedComponents = fingerprintMismatch
        ? compareFingerprintComponents({
          expected: expectedFingerprint,
            stored: storedFingerprint
          })
        : [];
    } catch (error) {
      fingerprintExpectedError = error instanceof Error ? error.message : String(error);
    }
  }

  const unresolvedDecisions = decisionFiles.filter(({ parsed }) => {
    const decision = parsed ?? {};
    return (
      asString(decision.reconciledAt) === undefined ||
      asString(decision.appliedAt) === undefined ||
      asNumber(decision.checkpointSequence) === undefined
    );
  });
  const unresolvedOutcomes = executionOutcomes.filter(({ parsed }) => {
    const outcome = parsed ?? {};
    return (
      asString(outcome.reconciledAt) === undefined ||
      asNumber(outcome.checkpointSequence) === undefined
    );
  });
  const requestErrors = requestFiles.filter((file) => file.error);
  const decisionErrors = decisionFiles.filter((file) => file.error);
  const outcomeErrors = executionOutcomes.filter((file) => file.error);
  const checkpointErrors = checkpointFiles.filter((file) => file.error);
  const knownRequestIds = new Set(requestFiles.map((file) => extractReviewId(file.path, ".request.json")));
  const knownDecisionIds = new Set(decisionFiles.map((file) => extractReviewId(file.path, ".decision.json")));
  const pendingReviewIds = Object.keys(graphState?.pendingReviewsById ?? {});
  const historicalDecisionIds = Object.values(graphState?.reviewHistoryByBranchId ?? {})
    .flatMap((entries) => entries)
    .map((entry) => asString(entry.reviewId))
    .filter((reviewId): reviewId is string => Boolean(reviewId));
  const missingRequestIds = pendingReviewIds.filter((reviewId) => !knownRequestIds.has(reviewId));
  const missingDecisionIds = historicalDecisionIds.filter((reviewId) => !knownDecisionIds.has(reviewId));
  const checkpointSequences = checkpointFiles
    .map((file) => parseCheckpointSequence(file.path))
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  const expectedCheckpointMax = graphState?.lastCheckpointSequence ?? 0;
  const missingCheckpointSequences =
    expectedCheckpointMax > 0
      ? Array.from({ length: expectedCheckpointMax }, (_, index) => index + 1).filter(
          (sequence) => !checkpointSequences.includes(sequence)
        )
      : [];
  const orphanOutcomes = executionOutcomes.filter(({ parsed }) => {
    const outcome = parsed ?? {};
    const branchId = asString(outcome.branchId) ?? asString(asRecord(outcome.branch)?.branchId);
    if (branchId && graphState?.branchRecords?.[branchId]) {
      return false;
    }
    const executionId = asString(outcome.executionId);
    return !pendingReviewIds.some((reviewId) => {
      const pendingReview = asRecord(graphState?.pendingReviewsById?.[reviewId]);
      return asString(pendingReview?.executionId) === executionId;
    });
  });

  const checks = [
    toDiagnosticCheck({
      id: "state",
      label: "state.json",
      ok: stateStat?.isFile() === true && detail.state !== undefined,
      message: stateStat?.isFile() ? undefined : "Missing or unreadable state.json"
    }),
    toDiagnosticCheck({
      id: "sessions",
      label: "sessions.json",
      ok: sessionsStat?.isFile() === true,
      message: sessionsStat?.isFile() ? undefined : "Missing or unreadable sessions.json"
    }),
    toDiagnosticCheck({
      id: "fingerprint",
      label: "plan-fingerprint.json",
      ok: fingerprintStat?.isFile() === true && !fingerprintReadError,
      message:
        fingerprintStat?.isFile() !== true
          ? "Missing plan-fingerprint.json"
          : fingerprintReadError
    }),
    toDiagnosticCheck({
      id: "fingerprint-mismatch",
      label: "resume fingerprint",
      ok: !fingerprintMismatch,
      severity: fingerprintExpectedError ? "warning" : fingerprintMismatch ? "error" : "info",
      message:
        fingerprintExpectedError ??
        (fingerprintMismatch
          ? `Fingerprint mismatch${fingerprintChangedComponents.length > 0 ? ` (${fingerprintChangedComponents.join(", ")})` : ""}`
          : "Fingerprint matches current workspace")
    }),
    toDiagnosticCheck({
      id: "review-requests",
      label: "review request files",
      ok: requestErrors.length === 0,
      severity: requestErrors.length > 0 ? "error" : "info",
      message:
        requestErrors.length > 0
          ? `${requestErrors.length} invalid request file(s)`
          : missingRequestIds.length > 0
            ? `${missingRequestIds.length} pending review request file(s) missing`
            : undefined,
      detail: requestErrors.length > 0 ? requestErrors : missingRequestIds
    }),
    toDiagnosticCheck({
      id: "review-decisions",
      label: "review decision files",
      ok: decisionErrors.length === 0 && missingDecisionIds.length === 0,
      severity:
        decisionErrors.length > 0 || missingDecisionIds.length > 0
          ? "error"
          : unresolvedDecisions.length > 0
            ? "warning"
            : "info",
      message:
        decisionErrors.length > 0
          ? `${decisionErrors.length} invalid decision file(s)`
          : missingDecisionIds.length > 0
            ? `${missingDecisionIds.length} historical decision file(s) missing`
          : unresolvedDecisions.length > 0
            ? `${unresolvedDecisions.length} unreconciled decision(s)`
            : undefined,
      detail:
        decisionErrors.length > 0
          ? decisionErrors
          : missingDecisionIds.length > 0
            ? missingDecisionIds
            : unresolvedDecisions
    }),
    toDiagnosticCheck({
      id: "execution-outcomes",
      label: "execution outcomes",
      ok: outcomeErrors.length === 0 && orphanOutcomes.length === 0,
      severity:
        outcomeErrors.length > 0 || orphanOutcomes.length > 0
          ? "error"
          : unresolvedOutcomes.length > 0
            ? "warning"
            : "info",
      message:
        outcomeErrors.length > 0
          ? `${outcomeErrors.length} invalid execution outcome file(s)`
          : orphanOutcomes.length > 0
            ? `${orphanOutcomes.length} orphan execution outcome(s)`
          : unresolvedOutcomes.length > 0
            ? `${unresolvedOutcomes.length} unreconciled execution outcome(s)`
            : undefined,
      detail: outcomeErrors.length > 0 ? outcomeErrors : orphanOutcomes.length > 0 ? orphanOutcomes : unresolvedOutcomes
    }),
    toDiagnosticCheck({
      id: "checkpoints",
      label: "checkpoint wal",
      ok: checkpointErrors.length === 0 && missingCheckpointSequences.length === 0,
      severity:
        checkpointErrors.length > 0 || missingCheckpointSequences.length > 0 ? "error" : "info",
      message:
        checkpointErrors.length > 0
          ? `${checkpointErrors.length} invalid checkpoint file(s)`
          : missingCheckpointSequences.length > 0
            ? `Checkpoint gap detected (${missingCheckpointSequences.join(", ")})`
            : undefined,
      detail: checkpointErrors.length > 0 ? checkpointErrors : missingCheckpointSequences
    }),
    toDiagnosticCheck({
      id: "resume-lock",
      label: ".resume.lock",
      ok: asBoolean(resumeLock.ok) !== false,
      severity:
        asBoolean(resumeLock.present) && asBoolean(resumeLock.stale)
          ? "warning"
          : asBoolean(resumeLock.ok) === false
            ? "error"
            : "info",
      message:
        asBoolean(resumeLock.ok) === false
          ? "Invalid resume lock"
          : asBoolean(resumeLock.stale)
            ? "Stale resume lock"
            : undefined,
      detail: resumeLock
    })
  ];

  const hasBlockingErrors = checks.some(
    (check) => check.ok === false && check.severity === "error"
  );
  const hasWarnings = checks.some((check) => check.severity === "warning");
  const summaryStatus = fingerprintMismatch
    ? "mismatch"
    : hasBlockingErrors
      ? "blocked"
      : hasWarnings
        ? "dirty"
        : "recoverable";
  const recommendations = [
    ...(fingerprintMismatch
      ? [
          {
            action: "inspect-project",
            label: "Inspect system.mmd, laws, model-selection, and role packages for drift before resume."
          }
        ]
      : []),
    ...(missingRequestIds.length > 0 || missingDecisionIds.length > 0
      ? [
          {
            action: "inspect-review",
            label: "Inspect review authority files under control/reviews before attempting resume."
          }
        ]
      : []),
    ...(unresolvedDecisions.length > 0 || unresolvedOutcomes.length > 0
      ? [
          {
            action: "resume",
            label: "Resume to reconcile pending review decisions and execution outcomes."
          }
        ]
      : []),
    ...(orphanOutcomes.length > 0 || missingCheckpointSequences.length > 0
      ? [
          {
            action: "inspect-checkpoints",
            label: "Inspect checkpoint WAL and execution-outcome reconciliation for gaps or orphan files."
          }
        ]
      : []),
    ...(hasBlockingErrors
      ? [
          {
            action: "inspect-logs",
            label: "Inspect logs and authority artifacts before retrying resume."
          }
        ]
      : [])
  ];

  return {
    runId,
    runDir,
    status: summaryStatus,
    simulation: getRunSimulation(asRecord(detail) ?? {}),
    authorityArtifacts: policy.map((entry: RunArtifactPolicyEntry) => ({
      path: entry.path,
      retention: entry.retention,
      resumeConsumed: entry.resumeConsumed,
      description: entry.description
    })),
    fingerprint: {
      storedDigest: asString(storedFingerprint?.digest),
      expectedDigest: asString(expectedFingerprint?.digest),
      mismatch: fingerprintMismatch,
      changedComponents: fingerprintChangedComponents,
      componentDigests: {
        stored: extractFingerprintComponentDigests(storedFingerprint),
        expected: extractFingerprintComponentDigests(expectedFingerprint)
      },
      expectedError: fingerprintExpectedError
    },
    counts: {
      requestFiles: requestFiles.length,
      decisionFiles: decisionFiles.length,
      missingRequestFiles: missingRequestIds.length,
      missingDecisionFiles: missingDecisionIds.length,
      unresolvedDecisions: unresolvedDecisions.length,
      executionOutcomes: executionOutcomes.length,
      orphanOutcomes: orphanOutcomes.length,
      unresolvedOutcomes: unresolvedOutcomes.length,
      checkpoints: checkpointFiles.length,
      missingCheckpoints: missingCheckpointSequences.length
    },
    checks,
    recommendations
  };
  })();
  resumeDiagnosticsCache.set(cacheKey, {
    token,
    expiresAt: Date.now() + RESUME_DIAGNOSTICS_TTL_MS,
    value
  });
  try {
    return await value;
  } catch (error) {
    resumeDiagnosticsCache.delete(cacheKey);
    throw error;
  }
}

function findLatestFailureAudit(state: GraphState | undefined) {
  if (!state) {
    return undefined;
  }
  const recentAudits = Array.isArray(state.recentAudits) ? state.recentAudits : [];
  for (let index = recentAudits.length - 1; index >= 0; index -= 1) {
    const audit = recentAudits[index];
    if (audit.status === "failed" || audit.errorEnvelope) {
      return audit;
    }
  }
  if (state.errorEnvelope || state.error) {
    return {
      at: "",
      roleId: state.lastExecutedRoleId,
      branchId: undefined,
      exitCode: 1,
      durationMs: 0,
      status: "failed" as const,
      error: state.error,
      errorEnvelope: state.errorEnvelope
    };
  }
  return undefined;
}

async function findLatestFailureEvent(runDir: string): Promise<JsonRecord | undefined> {
  const candidates: JsonRecord[] = [];
  for (const fileName of ["events.ndjson", "timeline.jsonl"]) {
    const text = await readFile(resolve(runDir, fileName), "utf8").catch(() => "");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch {
        continue;
      }
      const record = asRecord(parsed);
      if (
        record &&
        (record.status === "failed" || record.type === "runtime_error" || asRecord(record.errorEnvelope))
      ) {
        candidates.push(record);
      }
    }
  }
  return candidates.at(-1);
}

function listAllowedEventsForRole(system: SystemDefinition, roleId: string): string[] {
  return Array.from(
    new Set(
      system.flows
        .filter((flow) => flow.fromRoleId === roleId && !isRuntimeOnlyErrorEvent(flow.eventType))
        .map((flow) => flow.eventType)
    )
  ).sort((left, right) => left.localeCompare(right));
}

function listUpstreamRoleIds(system: SystemDefinition, roleId: string): string[] {
  return Array.from(
    new Set(
      system.flows
        .filter((flow) => flow.toRoleId === roleId && !isRuntimeOnlyErrorEvent(flow.eventType))
        .map((flow) => flow.fromRoleId)
    )
  ).sort((left, right) => left.localeCompare(right));
}

async function resolveBindingVisualizationForRole(args: {
  workdir: string;
  system: SystemDefinition;
  roleId: string;
}): Promise<Record<string, unknown>> {
  if (args.system.executionBinding[args.roleId]) {
    const profileId = args.system.executionBinding[args.roleId];
    return {
      roleId: args.roleId,
      bindingKind: "profile",
      declaredBinding: profileId,
      resolvedBinding: profileId,
      source: "system.mmd:exec.bind"
    };
  }
  const modelSelection = await loadModelSelection(resolve(args.workdir, ".ogs", "model-selection.json"));
  const modelCatalog = await loadModelCatalog(resolve(args.workdir, ".ogs", "model-catalog.json"));
  const resolvedModelSelection = resolveModelSelectionForSystem({
    system: args.system,
    selection: modelSelection,
    catalog: modelCatalog
  });
  const resolvedModel = resolvedModelSelection.resolvedByRoleId.get(args.roleId);
  if (!resolvedModel) {
    return {
      roleId: args.roleId,
      bindingKind: "noop",
      source: "none"
    };
  }
  return {
    roleId: args.roleId,
    bindingKind: "model",
    declaredBinding: args.system.modelBinding[args.roleId],
    resolvedBinding: resolvedModel.modelRef,
    variant: resolvedModel.variant,
    timeoutMs: resolvedModel.timeoutMs,
    maxOutputBytes: resolvedModel.maxOutputBytes,
    source: resolvedModel.bindingSource === "system" ? "system.mmd:model.bind" : ".ogs/model-selection.json"
  };
}

export async function inspectRunFailureVisualization(workdir: string, runId: string): Promise<Record<string, unknown>> {
  const detail = await inspectRun(workdir, runId);
  const runDir = resolveRunDir(workdir, runId);
  const systemSource = await readFile(resolve(runDir, "system.mmd"), "utf8").catch(() => null);
  const system = systemSource ? parseSystemFromMermaidSource(systemSource) : undefined;
  const state = extractGraphState(detail.state);
  const latestFailure = findLatestFailureAudit(state) ?? await findLatestFailureEvent(runDir);
  if (!latestFailure) {
    return {
      runId,
      runDir,
      status: "ok",
      summary: null,
      detail: null,
      suggestedNextChecks: []
    };
  }
  const failureRecord = asRecord(latestFailure) ?? {};
  const envelope = asRecord(failureRecord.errorEnvelope);
  const correctionRequest = asRecord(failureRecord.correctionRequest);
  const roleId = asString(failureRecord.roleId) || state?.lastExecutedRoleId;
  const selectedBinding =
    system && roleId
      ? await resolveBindingVisualizationForRole({ workdir, system, roleId })
      : undefined;
  const summary = {
    errorCode: asString(envelope?.errorCode) ?? asString(failureRecord.errorCode) ?? "ROLE_EXECUTION_FAILED",
    errorCategory: asString(envelope?.errorCategory) ?? asString(failureRecord.errorCategory),
    message: asString(envelope?.message) ?? asString(failureRecord.error) ?? state?.error ?? "Run failed.",
    stage: asString(envelope?.stage) ?? asString(failureRecord.stage),
    roleId,
    branchId: asString(failureRecord.branchId) ?? asString(envelope?.branchId),
    retryable: asBoolean(envelope?.retryable) ?? asBoolean(failureRecord.retryable),
    durationMs: asNumber(failureRecord.durationMs)
  };
  const detailView = roleId && system
    ? {
        allowedEvents: listAllowedEventsForRole(system, roleId),
        inputContext: asString(failureRecord.inputContext),
        rawOutput:
          asString(correctionRequest?.rawOutput) ??
          asString(failureRecord.stdoutPreview) ??
          asString(failureRecord.stderrPreview),
        schemaPath: asString(correctionRequest?.schemaPath),
        selectedBinding,
        upstreamRoleIds: listUpstreamRoleIds(system, roleId),
        correctionKind: asString(correctionRequest?.reason),
        correctionDetail: asString(correctionRequest?.detail),
        providerError: asString(failureRecord.error)
      }
    : {
        allowedEvents: [],
        upstreamRoleIds: [],
        selectedBinding,
        inputContext: asString(failureRecord.inputContext),
        rawOutput:
          asString(correctionRequest?.rawOutput) ??
          asString(failureRecord.stdoutPreview) ??
          asString(failureRecord.stderrPreview),
        schemaPath: asString(correctionRequest?.schemaPath),
        correctionKind: asString(correctionRequest?.reason),
        correctionDetail: asString(correctionRequest?.detail),
        providerError: asString(failureRecord.error)
      };
  const suggestedNextChecks = [
    {
      action: "inspect-projected-input",
      label: "Inspect projected input",
      detail: { roleId }
    },
    {
      action: "inspect-binding-resolution",
      label: "Inspect binding resolution",
      detail: { roleId }
    },
    {
      action: "inspect-role-schema",
      label: "Inspect role schema",
      detail: { roleId, schemaPath: asString(correctionRequest?.schemaPath) }
    },
    {
      action: "inspect-contract",
      label: "Inspect contract",
      detail: { roleId, upstreamRoleIds: detailView.upstreamRoleIds }
    },
    {
      action: "inspect-resume-diagnostics",
      label: "Inspect resume diagnostics",
      detail: { runId }
    }
  ];
  return {
    runId,
    runDir,
    status: "failed",
    summary,
    detail: detailView,
    suggestedNextChecks
  };
}

function toReadinessBlocker(args: {
  id: string;
  category: string;
  severity: "info" | "warning" | "error";
  blocking: boolean;
  message: string;
  source?: string;
  detail?: unknown;
}): Record<string, unknown> {
  return args;
}

export async function inspectRunResumeReadiness(workdir: string, runId: string): Promise<Record<string, unknown>> {
  const diagnostics = await inspectRunResumeDiagnostics(workdir, runId);
  const record = asRecord(diagnostics) ?? {};
  const status = asString(record.status) ?? "unknown";
  const counts = asRecord(record.counts) ?? {};
  const fingerprint = asRecord(record.fingerprint) ?? {};
  const changedComponents = Array.isArray(fingerprint.changedComponents)
    ? fingerprint.changedComponents.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];
  const componentDigests = asRecord(fingerprint.componentDigests);
  const expectedDigests = asRecord(componentDigests?.expected);
  const storedDigests = asRecord(componentDigests?.stored);
  const runDir = asString(record.runDir) ?? resolveRunDir(workdir, runId);
  const systemSource = await readFile(resolve(runDir, "system.mmd"), "utf8").catch(() => null);
  const system = systemSource ? parseSystemFromMermaidSource(systemSource) : undefined;

  const blockers: Record<string, unknown>[] = [];
  if (asBoolean(fingerprint.mismatch) === true) {
    blockers.push(
      toReadinessBlocker({
        id: "fingerprint-drift",
        category: "fingerprint drift",
        severity: "error",
        blocking: true,
        message:
          changedComponents.length > 0
            ? `Resume fingerprint drift detected: ${changedComponents.join(", ")}`
            : "Resume fingerprint drift detected.",
        source: "plan-fingerprint.json",
        detail: {
          changedComponents,
          storedDigest: asString(fingerprint.storedDigest),
          expectedDigest: asString(fingerprint.expectedDigest)
        }
      })
    );
  }
  if ((asNumber(counts.missingRequestFiles) ?? 0) > 0 || (asNumber(counts.missingDecisionFiles) ?? 0) > 0) {
    blockers.push(
      toReadinessBlocker({
        id: "review-files-missing",
        category: "missing files",
        severity: "error",
        blocking: true,
        message: "Review authority artifacts are missing.",
        source: "control/reviews",
        detail: counts
      })
    );
  }
  if ((asNumber(counts.unresolvedDecisions) ?? 0) > 0) {
    blockers.push(
      toReadinessBlocker({
        id: "review-not-applied",
        category: "review not applied",
        severity: "warning",
        blocking: false,
        message: "Review decisions are recorded but not fully applied.",
        source: "control/reviews",
        detail: { unresolvedDecisions: counts.unresolvedDecisions }
      })
    );
  }
  if ((asNumber(counts.missingCheckpoints) ?? 0) > 0) {
    blockers.push(
      toReadinessBlocker({
        id: "checkpoint-mismatch",
        category: "checkpoint mismatch",
        severity: "error",
        blocking: true,
        message: "Checkpoint WAL has gaps that block safe resume.",
        source: "checkpoints",
        detail: { missingCheckpoints: counts.missingCheckpoints }
      })
    );
  }
  if ((asNumber(counts.orphanOutcomes) ?? 0) > 0) {
    blockers.push(
      toReadinessBlocker({
        id: "orphan-outcomes",
        category: "checkpoint mismatch",
        severity: "error",
        blocking: true,
        message: "Execution outcomes are orphaned from active branches or pending reviews.",
        source: "roles/*/executions/*/execution-outcome.json",
        detail: { orphanOutcomes: counts.orphanOutcomes }
      })
    );
  }
  const driftSources = [
    {
      source: "system.mmd",
      changed: changedComponents.includes("system"),
      blocking: changedComponents.includes("system"),
      message: changedComponents.includes("system") ? "Run graph or binding metadata drifted." : "No system drift detected.",
      detail: {
        storedDigest: asString(storedDigests?.system),
        expectedDigest: asString(expectedDigests?.system)
      }
    },
    {
      source: "role packages",
      changed: changedComponents.includes("rolePackages"),
      blocking: changedComponents.includes("rolePackages"),
      message: changedComponents.includes("rolePackages") ? "Role package contents drifted." : "No role package drift detected.",
      detail: {
        storedDigest: asString(storedDigests?.rolePackages),
        expectedDigest: asString(expectedDigests?.rolePackages)
      }
    },
    {
      source: "model selection",
      changed: changedComponents.includes("modelSelection"),
      blocking: changedComponents.includes("modelSelection"),
      message: changedComponents.includes("modelSelection") ? "Resolved model selection drifted." : "No model selection drift detected.",
      detail: {
        storedDigest: asString(storedDigests?.modelSelection),
        expectedDigest: asString(expectedDigests?.modelSelection)
      }
    },
    {
      source: "law",
      changed: changedComponents.includes("effectiveLaw"),
      blocking: changedComponents.includes("effectiveLaw"),
      message: changedComponents.includes("effectiveLaw") ? "Effective law policy drifted." : "No law drift detected.",
      detail: {
        storedDigest: asString(storedDigests?.effectiveLaw),
        expectedDigest: asString(expectedDigests?.effectiveLaw)
      }
    },
    {
      source: "contracts",
      changed:
        changedComponents.includes("system") && Boolean(system?.graph?.handoffContracts),
      blocking:
        changedComponents.includes("system") && Boolean(system?.graph?.handoffContracts),
      message:
        changedComponents.includes("system") && system?.graph?.handoffContracts
          ? "System or handoff contract bundle drifted."
          : "No contract drift detected.",
      detail: {
        contractPath: system?.graph?.handoffContracts
      }
    }
  ];
  const canResume = !blockers.some((blocker) => blocker.blocking === true);
  return {
    runId,
    runDir,
    status,
    canResume,
    blockers,
    driftSources,
    fingerprint: record.fingerprint ?? null,
    counts: record.counts ?? null,
    checks: Array.isArray(record.checks) ? record.checks : [],
    recommendations: Array.isArray(record.recommendations) ? record.recommendations : []
  };
}

export async function listRunReviewsVisualization(workdir: string, runId: string): Promise<Record<string, unknown>> {
  return listHumanReviews(workdir, runId);
}
