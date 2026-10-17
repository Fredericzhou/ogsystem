import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { runSystemWithAdapter } from "../../dist/runtime/adapter.js";
import { createRunId } from "../../dist/runtime/run-artifacts.js";
import { rebuildRunsIndex } from "../../dist/runtime/project-lifecycle.js";
import { loadProjectRunPlan, loadProjectMaterialSnapshots, validateLinearProjectTopology } from "../../dist/runtime/project-run.js";
import { evaluateProjectRunResult } from "../../dist/runtime/project-quality.js";
import { createExecutionPlan } from "../../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../../dist/runtime/parse-mermaid.js";
import { acquireActiveRunLock, acquireProjectWriteLock } from "../../dist/runtime/project-run-lock.js";
import { applyRunControl as writeRunStateControl, loadProjectRunState, updateProjectRunState } from "../../dist/runtime/project-run-state.js";
import { readLatestProjectRunControl, writeProjectRunControl } from "../../dist/runtime/project-run-control.js";
import { computeProjectAssetDigest } from "../../dist/runtime/project-asset-digest.js";
import {
  createProjectVisualization,
  inspectProjectWorkspace,
  exportTeamPackage,
  loadTeamPackage
} from "../../dist/visualizer/project-projection.js";
import { authoringToCanvasDocument, importMermaidToAuthoring, serializeAuthoringToMermaid } from "../../dist/visualizer/studio-authoring.js";
import { buildGraphViewModel } from "../../dist/visualizer/graph-view-model.js";
import { inspectProjectReadiness } from "../../dist/visualizer/project-readiness.js";
import { validateProjectSystemSource, saveProjectSystemSource } from "../../dist/visualizer/project-projection.js";
import { getCase } from "./cases.mjs";
import { materializeCaseTeam } from "./demo-runner.mjs";

const projectsRoot = resolve(process.env.OGS_SITE_PROJECTS_DIR || join(homedir(), ".ogsystem", "projects"));
const allowedExtensions = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);

function slug(value) {
  const normalized = String(value || "new-team").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "new-team";
}

function assertProjectId(projectId) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(projectId)) throw new Error("Invalid project id.");
}

function assertSafeId(value, field) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

function projectPath(projectId) {
  assertProjectId(projectId);
  const target = resolve(projectsRoot, projectId);
  if (!target.startsWith(projectsRoot + sep)) throw new Error("Project path is outside the site workspace.");
  return target;
}

async function readJson(path, fallback = undefined) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function writeJson(path, value) {
  await mkdir(resolve(path, ".."), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, path);
}

function normalizeMeta(meta, projectId) {
  const confirmed = meta?.projectStatus === "confirmed" && typeof meta?.projectDigest === "string" && typeof meta?.confirmedAt === "string";
  return {
    projectId,
    name: String(meta?.name || "New team"),
    intent: String(meta?.intent || ""),
    templateId: meta?.templateId || "empty",
    projectStatus: confirmed ? "confirmed" : "draft",
    projectDigest: confirmed ? meta.projectDigest : null,
    confirmedAt: confirmed ? meta.confirmedAt : null,
    createdAt: meta?.createdAt || new Date().toISOString(),
    updatedAt: meta?.updatedAt || new Date().toISOString(),
    source: meta?.source || "created",
    ...(meta?.caseId ? { caseId: meta.caseId } : {}),
    ...(meta?.ogsProjectId ? { ogsProjectId: meta.ogsProjectId } : {})
  };
}

function projectStage(project) {
  // This is a UI projection only. Authorization uses projectStatus, run state, and locks.
  if (project.projectStatus !== "confirmed") return "draft";
  if ((project.runs || []).some((run) => ["running", "planning", "waiting_review", "paused"].includes(run.status))) return "running";
  return "ready";
}

async function withProjectWriteLock(projectId, operation, action) {
  const lock = await acquireProjectWriteLock(projectPath(projectId), operation);
  try { return await action(); } finally { await lock.release(); }
}

async function semanticProjectDigest(project) {
  return computeProjectAssetDigest(project.workdir);
}

function requireConfirmed(project) {
  // A confirmed team is eligible for a project workspace; each run still creates its own snapshot.
  if (project.projectStatus !== "confirmed" || !project.projectDigest || !project.confirmedAt) {
    throw new Error("PROJECT_NOT_CONFIRMED: confirm the team design before preparing or running a task.");
  }
}

function isTrustedTeamTopology(project) {
  return project.source === "classic" || project.source === "classic-template";
}

async function requireCurrentConfirmation(project) {
  requireConfirmed(project);
  const currentDigest = await semanticProjectDigest(project);
  if (currentDigest !== project.projectDigest) throw new Error("PROJECT_CONFIRMATION_STALE: semantic project files changed; confirm the project again.");
}

async function readProject(projectId) {
  const workdir = projectPath(projectId);
  const meta = await readJson(join(workdir, ".site", "project.json"));
  if (!meta) throw new Error("Project not found.");
  const workspace = await inspectProjectWorkspace(workdir);
  const materials = await readJson(join(workdir, "workspace", "index.json"), { version: 1, materials: [] });
  const runs = await readJson(join(workdir, ".ogs", "runs-index.json"), { runs: [] });
  const normalized = normalizeMeta(meta, projectId);
  const project = { ...normalized, workdir, workspace, materials, runs: runs.runs || [] };
  return { ...project, projectStage: projectStage(project) };
}

export async function listProjects() {
  await mkdir(projectsRoot, { recursive: true });
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readJson(join(projectsRoot, entry.name, ".site", "project.json"));
    if (meta) {
      const normalized = normalizeMeta(meta, entry.name);
      const runIndex = await readJson(join(projectsRoot, entry.name, ".ogs", "runs-index.json"), { runs: [] });
      projects.push({
        ...normalized,
        projectStage: projectStage({ ...normalized, runs: runIndex.runs || [] })
      });
    }
  }
  return projects.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function createProject({ name, intent, templateId = "empty", caseId, source = "created", locale = "zh-CN" }) {
  await mkdir(projectsRoot, { recursive: true });
  const projectId = slug(name) + "-" + randomUUID().slice(0, 8);
  const workdir = projectPath(projectId);
  await mkdir(workdir, { recursive: true });
  const created = await createProjectVisualization({
    currentWorkdir: workdir,
    projectName: slug(name),
    templateId: templateId === "minimal" ? "minimal" : "empty",
    conflictStrategy: "reject"
  });
  const now = new Date().toISOString();
  await writeJson(join(workdir, ".site", "project.json"), {
    projectId,
    name: String(name || "New team").trim().slice(0, 120) || "New team",
    intent: String(intent || "").trim().slice(0, 4000),
    templateId,
    projectStatus: "draft",
    projectDigest: null,
    confirmedAt: null,
    createdAt: now,
    updatedAt: now,
    ogsProjectId: created.projectId,
    source,
    ...(caseId ? { caseId } : {})
  });
  await writeJson(join(workdir, "workspace", "index.json"), { version: 1, materials: [] });
  if (caseId) await materializeCaseTeam(caseId, workdir, locale === "en" ? "en" : "zh-CN");
  return readProject(projectId);
}

export async function createClassicTeamProject({ caseId, asTemplate = false, name, intent, locale = "zh-CN" } = {}) {
  const caseSpec = getCase(caseId);
  if (!caseSpec) throw new Error("Unknown example team.");
  const language = locale === "en" ? "en" : "zh-CN";
  const defaultName = caseSpec.title?.[language] || caseSpec.title?.["zh-CN"] || caseSpec.title?.en || caseId;
  const defaultIntent = caseSpec.detail?.scenario?.[language] || caseSpec.detail?.scenario?.["zh-CN"] || caseSpec.short?.[language] || caseSpec.short?.["zh-CN"] || "";
  const project = await createProject({
    name: name || defaultName,
    intent: intent || defaultIntent,
    templateId: `classic:${caseId}`,
    caseId,
    source: asTemplate ? "classic-template" : "classic",
    locale: language
  });
  return asTemplate ? project : confirmProjectTeam(project.projectId, { trustedClassic: true });
}

export async function updateProject(projectId, changes = {}) {
  return withProjectWriteLock(projectId, "project-edit", async () => {
    const project = await readProject(projectId);
    const nextName = changes.name === undefined ? project.name : String(changes.name).trim().slice(0, 120);
    const nextIntent = changes.intent === undefined ? project.intent : String(changes.intent).trim().slice(0, 4000);
    if (!nextName) throw new Error("Project name is required.");
    const semanticChanged = nextIntent !== project.intent || changes.semanticChanged === true;
    const next = {
      ...normalizeMeta(project, projectId),
      name: nextName,
      intent: nextIntent,
      updatedAt: new Date().toISOString()
    };
    if (semanticChanged) {
      next.projectStatus = "draft";
      next.projectDigest = null;
      next.confirmedAt = null;
    }
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function invalidateProjectConfirmation(projectId, reason = "semantic-edit") {
  return withProjectWriteLock(projectId, `invalidate:${reason}`, async () => {
    const project = await readProject(projectId);
    const next = { ...normalizeMeta(project, projectId), projectStatus: "draft", projectDigest: null, confirmedAt: null, updatedAt: new Date().toISOString(), invalidatedReason: reason };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function confirmProjectTeam(projectId, { trustedClassic = false } = {}) {
  return withProjectWriteLock(projectId, "project-confirm", async () => {
    const project = await readProject(projectId);
    const systemSource = await readFile(join(project.workdir, "system.mmd"), "utf8");
    const executionPlan = createExecutionPlan(parseSystemFromMermaidSource(systemSource));
    const nodeGraph = Array.from(executionPlan.nodesByRoleId.values()).map((node) => ({
      nodeId: node.roleId,
      incoming: node.incoming.map((flow) => ({ from: flow.fromRoleId, event: flow.eventType })),
      outgoing: node.outgoing.map((flow) => ({ to: flow.toRoleId, event: flow.eventType })),
      reviewRequired: node.review?.mode === "required",
      loopMax: node.loopMax
    }));
    if (!trustedClassic && !isTrustedTeamTopology(project)) validateLinearProjectTopology(nodeGraph, executionPlan.entryRoleId);
    const digest = await semanticProjectDigest(project);
    if (project.projectStatus === "confirmed" && project.projectDigest === digest) return project;
    const next = { ...normalizeMeta(project, projectId), projectStatus: "confirmed", projectDigest: digest, confirmedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await writeJson(join(project.workdir, ".site", "project.json"), next);
    return readProject(projectId);
  });
}

export async function getProject(projectId) {
  return readProject(projectId);
}

export async function getProjectReadiness(projectId) {
  const project = await readProject(projectId);
  const readiness = await inspectProjectReadiness(project.workdir);
  const projectIssue = (issue) => {
    const messageByCode = {
      READINESS_CONTRACT_BUNDLE_UNREADABLE: "Handoff contract bundle cannot be inspected. Check the configured contract file.",
      READINESS_CONTRACT_PLAN_INVALID: "Handoff contract plan is invalid. Check the contract definitions and schemas.",
      READINESS_MODEL_CATALOG_INVALID: "Model catalog is invalid. Repair .ogs/model-catalog.json.",
      READINESS_ROLE_PACKAGE_INVALID: `Role package "${issue.roleId}" is invalid. Check role.json and its referenced package files.`
    };
    return {
      code: issue.code,
      severity: issue.severity,
      ...(issue.roleId ? { roleId: issue.roleId } : {}),
      message: messageByCode[issue.code] ?? issue.message
    };
  };
  return {
    projectId,
    projectStatus: project.projectStatus,
    projectDigest: project.projectDigest,
    confirmedAt: project.confirmedAt,
    canDryRun: readiness.canDryRun,
    blockers: readiness.blockers.map(projectIssue),
    warnings: readiness.warnings.map(projectIssue),
    missingBindings: readiness.missingBindings
  };
}

export async function getProjectGraph(projectId, locale = "zh-CN") {
  const project = await readProject(projectId);
  const systemPath = join(project.workdir, "system.mmd");
  const systemSource = await readFile(systemPath, "utf8");
  const system = parseSystemFromMermaidSource(systemSource);
  const design = await readJson(join(project.workdir, "system.design.json"), {});
  const roleDisplayNames = new Map(
    Object.entries(design?.seats && typeof design.seats === "object" ? design.seats : {})
      .flatMap(([roleId, seat]) => {
        const title = seat && typeof seat === "object" && !Array.isArray(seat) ? seat.title : undefined;
        return typeof title === "string" && title.trim() ? [[roleId, title.trim()]] : [];
      })
  );
  const authoring = importMermaidToAuthoring({
    workdir: project.workdir,
    systemPath: "system.mmd",
    systemSource,
    roleDisplayNames
  });
  const boundaryLabels = locale === "en"
    ? { input: "Task", output: "Outcome" }
    : { input: "任务", output: "结果" };
  const graph = buildGraphViewModel({
    authoring,
    mode: "design",
    presentation: { boundaryLabels }
  });
  return {
    projectId,
    projectDigest: project.projectDigest,
    systemSource,
    authoring,
    canvas: authoringToCanvasDocument(authoring),
    viewModel: graph
  };
}

export async function getProjectDesign(projectId, locale = "zh-CN") {
  const graph = await getProjectGraph(projectId, locale);
  const project = await readProject(projectId);
  return { ...graph, projectStatus: project.projectStatus, confirmedAt: project.confirmedAt };
}

export async function validateProjectDesign(projectId, body = {}) {
  const project = await readProject(projectId);
  const systemSource = typeof body.systemSource === "string"
    ? body.systemSource
    : body.authoring && typeof body.authoring === "object"
      ? serializeAuthoringToMermaid(body.authoring)
      : await readFile(join(project.workdir, "system.mmd"), "utf8");
  return validateProjectSystemSource({ workdir: project.workdir, systemSource, systemPath: join(project.workdir, "system.mmd") });
}

export async function saveProjectDesign(projectId, body = {}) {
  return withProjectWriteLock(projectId, "design-save", async () => {
    const project = await readProject(projectId);
    if (body.expectedProjectDigest && body.expectedProjectDigest !== project.projectDigest) {
      throw new Error("PROJECT_DIGEST_CONFLICT: the project changed in another editor.");
    }
    const systemSource = typeof body.systemSource === "string"
      ? body.systemSource
      : body.authoring && typeof body.authoring === "object"
        ? serializeAuthoringToMermaid(body.authoring)
        : "";
    if (!systemSource) throw new Error("SYSTEM_SOURCE_REQUIRED: design source is required.");
    const saved = await saveProjectSystemSource({ workdir: project.workdir, systemSource });
    if (saved.validation?.ok !== true) throw new Error("PROJECT_DESIGN_INVALID: design validation failed.");
    return getProjectDesign(projectId);
  });
}

export async function addProjectMaterial(projectId, { filename, content, contentType }) {
  return withProjectWriteLock(projectId, "material-upload", async () => {
  const project = await readProject(projectId);
  await requireCurrentConfirmation(project);
  const safeName = basename(String(filename || "material.txt"));
  const extension = extname(safeName).toLowerCase();
  if (!allowedExtensions.has(extension)) throw new Error("Only md, txt, json, yaml, yml, and csv materials are supported.");
  if (typeof content !== "string" || content.length > 1024 * 1024) throw new Error("Material content must be text up to 1 MB.");
  const materialId = slug(safeName.slice(0, -extension.length)) + "-" + randomUUID().slice(0, 6);
  const target = resolve(project.workdir, "workspace", "files", materialId + extension);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
  const entry = {
    materialId,
    filename: safeName,
    path: "workspace/files/" + basename(target),
    contentType: contentType || "text/plain",
    size: Buffer.byteLength(content),
    contentHash: createHash("sha256").update(content).digest("hex"),
    status: "indexed",
    createdAt: new Date().toISOString()
  };
  const index = project.materials && Array.isArray(project.materials.materials)
    ? project.materials
    : { version: 1, materials: [] };
  index.materials = [...index.materials, entry];
  await writeJson(join(project.workdir, "workspace", "index.json"), index);
  const meta = await readJson(join(project.workdir, ".site", "project.json"), {});
  await writeJson(join(project.workdir, ".site", "project.json"), { ...meta, updatedAt: new Date().toISOString() });
  return entry;
  });
}

export async function startProjectRun(projectId, { prompt, mode = "dry-run", idempotencyKey, materialInputsOverride, resumeRunId, resumeRunDir } = {}) {
  if (mode === "real") throw new Error("REAL_RUN_UNSUPPORTED: real project runs are disabled in the first phase.");
  if (mode !== "dry-run" && mode !== "sandbox") throw new Error("Unsupported project run mode.");
  const initialProject = await readProject(projectId);
  if (mode === "sandbox") {
    await requireCurrentConfirmation(initialProject);
    const readiness = await inspectProjectReadiness(initialProject.workdir);
    if (!readiness.canDryRun) {
      throw new Error(`PROJECT_NOT_READY: resolve ${readiness.blockers.length} static readiness blocker(s) before Sandbox Run. Inspect project readiness for details.`);
    }
  }
  const requestKey = idempotencyKey ? String(idempotencyKey).slice(0, 160) : undefined;
  const requestPath = join(initialProject.workdir, ".site", "run-requests.json");
  let writeLock;
  let writeLockReleased = false;
  let lock;
  let runId;
  let requestFingerprint;
  let pendingLedgerEntry;
  try {
  if (resumeRunDir && !resumeRunId) throw new Error("RUN_RESUME_INVALID: resumeRunId is required when resuming a run.");
  if (resumeRunId) assertSafeId(resumeRunId, "resumeRunId");
  const allowedRunsDir = resolve(initialProject.workdir, ".ogs", "runs");
  const canonicalResumeRunDir = resumeRunId ? resolve(allowedRunsDir, resumeRunId) : undefined;
  if (canonicalResumeRunDir && !canonicalResumeRunDir.startsWith(`${allowedRunsDir}${sep}`)) {
    throw new Error("RUN_RESUME_INVALID: resume run must belong to the requested project.");
  }
  if (resumeRunDir && canonicalResumeRunDir && resolve(resumeRunDir) !== canonicalResumeRunDir) {
    throw new Error("RUN_RESUME_INVALID: resume run directory does not match resumeRunId.");
  }
  resumeRunDir = canonicalResumeRunDir;
  const task = resumeRunDir ? await readJson(join(resumeRunDir, "task.json"), {}) : undefined;
  const resumePlan = resumeRunDir ? await loadProjectRunPlan(resumeRunDir) : undefined;
  if (resumePlan?.projectId && resumePlan.projectId !== projectId) {
    throw new Error("RUN_SNAPSHOT_INVALID: run snapshot belongs to another project.");
  }
  const input = String(prompt || task?.prompt || "").trim();
  if (!input || input.length > 4000) throw new Error("Task must contain 1 to 4,000 characters.");
  requestFingerprint = createHash("sha256").update(JSON.stringify({
    projectId,
    prompt: input,
    mode,
    materialInputsOverride: materialInputsOverride ?? null,
    resumeRunId: resumeRunId ?? null
  })).digest("hex");
  writeLock = await acquireProjectWriteLock(initialProject.workdir, "run-snapshot");
  let project = await readProject(projectId);
  if (!resumeRunDir) await requireCurrentConfirmation(project);
  const requestLedger = await readJson(requestPath, {});
  if (requestKey && requestLedger[requestKey]) {
    const prior = requestLedger[requestKey];
    if (prior.requestFingerprint !== requestFingerprint) throw new Error("IDEMPOTENCY_KEY_REUSE: idempotency key was already used with a different request.");
    if (prior.status === "running" && prior.runId) {
      const priorRunDir = resolve(project.workdir, ".ogs", "runs", prior.runId);
      const priorState = await loadProjectRunState(priorRunDir).catch(() => undefined);
      const priorPlan = await loadProjectRunPlan(priorRunDir).catch(() => undefined);
      if (priorState && priorPlan && ["completed", "failed", "cancelled", "paused", "waiting_review"].includes(priorState.status)) {
        return {
          projectId,
          runId: prior.runId,
          mode: prior.mode,
          runPlan: priorPlan,
          state: priorState,
          quality: evaluateProjectRunResult({ plan: priorPlan, state: priorState }),
          status: priorState.status,
          idempotentReplay: true,
          recovered: true
        };
      }
      // A process can die after reserving the ledger entry but before runtime
      // creates its immutable run files. Reuse that reserved run id so the
      // next identical request replays the same request instead of creating a
      // second run. An existing non-terminal snapshot remains owned by the
      // original worker and is returned as-is.
      if (!priorPlan && !priorState) {
        runId = prior.runId;
      } else {
        return prior.response || { ...prior, idempotentReplay: true };
      }
    } else {
      return prior.response || { ...prior, idempotentReplay: true };
    }
  }
  runId ||= resumeRunId || createRunId(new Date());
  if (requestKey) {
    pendingLedgerEntry = {
      status: "running",
      projectId,
      runId,
      mode,
      requestFingerprint,
      prompt: input,
      ...(materialInputsOverride ? { materialInputsOverride } : {}),
      ...(resumeRunId ? { resumeRunId } : {}),
      startedAt: new Date().toISOString()
    };
    await writeJson(requestPath, { ...requestLedger, [requestKey]: pendingLedgerEntry });
  }
  // Reserve the idempotency record while the project write lock is held, then
  // acquire the long lived run lock before releasing that write lock. A crash
  // in either gap leaves a durable reservation and cannot create a second run.
  lock = await acquireActiveRunLock(initialProject.workdir, runId);
  if (resumeRunDir) await writeProjectRunControl(resumeRunDir, "resume", "project-run-resume");
  const materialInputs = materialInputsOverride || (project.materials.materials || []).map((item) => ({
    materialId: item.materialId,
    sourcePath: resolve(project.workdir, item.path),
    contentType: item.contentType
  }));
  const result = await runSystemWithAdapter({
    systemPath: resolve(project.workdir, "system.mmd"),
    prompt: input,
    workdir: project.workdir,
    runId,
    resumeRunDir,
    dryRun: mode === "dry-run",
    projectId,
    projectRunMode: mode,
    trustedProjectTopology: isTrustedTeamTopology(project),
    projectDigest: resumePlan?.projectDigest ?? project.projectDigest,
    projectRunLock: false,
    materialInputs,
    onProjectRunPrepared: async () => {
      if (!resumeRunDir) {
        const latest = await readProject(projectId);
        await requireCurrentConfirmation(latest);
        if (latest.projectDigest !== project.projectDigest) {
          throw new Error("PROJECT_CONFIRMATION_CHANGED: project confirmation changed while preparing the run.");
        }
        project = latest;
      }
      await writeLock.release();
      writeLockReleased = true;
    },
    logRun: false
  });
  await rebuildRunsIndex(project.workdir);
  const runPlan = await loadProjectRunPlan(resolve(project.workdir, ".ogs", "runs", runId));
  const runDir = resolve(project.workdir, ".ogs", "runs", runId);
  const state = await loadProjectRunState(runDir);
  const quality = evaluateProjectRunResult({ plan: runPlan, state });
  const response = { projectId, runId, mode, result, runPlan, state, quality, materials: materialInputs };
  if (requestKey) {
    const ledgerLock = writeLockReleased
      ? await acquireProjectWriteLock(initialProject.workdir, "run-ledger")
      : undefined;
    try {
      const currentLedger = await readJson(requestPath, {});
      await writeJson(requestPath, {
        ...currentLedger,
        [requestKey]: { ...response, status: "completed", requestFingerprint }
      });
    } finally {
      await ledgerLock?.release();
    }
  }
  return response;
  } catch (error) {
    if (requestKey && requestFingerprint && runId) {
      const ledgerLock = writeLockReleased
        ? await acquireProjectWriteLock(initialProject.workdir, "run-ledger-failure").catch(() => undefined)
        : undefined;
      try {
        const currentLedger = await readJson(requestPath, {});
        await writeJson(requestPath, {
          ...currentLedger,
          [requestKey]: {
            ...(pendingLedgerEntry || {}),
            projectId,
            runId,
            mode,
            status: "failed",
            requestFingerprint,
            error: error instanceof Error ? error.message : String(error)
          }
        });
      } finally {
        await ledgerLock?.release();
      }
    }
    throw error;
  } finally {
    if (writeLock && !writeLockReleased) await writeLock.release();
    await lock?.release();
  }
}

export async function retryProjectRun(projectId, originalRunId, { mode = "dry-run" } = {}) {
  assertSafeId(originalRunId, "runId");
  const project = await readProject(projectId);
  await requireCurrentConfirmation(project);
  const originalRunDir = resolve(project.workdir, ".ogs", "runs", originalRunId);
  const originalState = await loadProjectRunState(originalRunDir);
  if (originalState.status !== "failed") throw new Error("RUN_RETRY_UNSUPPORTED: only failed runs can be retried as a new run.");
  const task = await readJson(join(originalRunDir, "task.json"));
  if (!task || typeof task.prompt !== "string") throw new Error("RUN_RETRY_INVALID: original task snapshot is missing.");
  const snapshots = await loadProjectMaterialSnapshots(originalRunDir);
  const inputs = snapshots.map((item) => ({
    materialId: item.materialId,
    sourcePath: resolve(originalRunDir, item.snapshotPath),
    contentType: item.contentType,
    selectedRanges: item.selectedRanges,
    consumingNodeIds: item.consumingNodeIds
  }));
  return startProjectRun(projectId, { prompt: task.prompt, mode, materialInputsOverride: inputs });
}

export async function controlProjectRun(projectId, runId, control) {
  assertSafeId(runId, "runId");
  if (!["pause", "resume", "cancel"].includes(control)) throw new Error("RUN_CONTROL_INVALID: unsupported control.");
  const project = await readProject(projectId);
  const runDir = resolve(project.workdir, ".ogs", "runs", runId);
  const state = await loadProjectRunState(runDir);
  if (control === "resume") {
      const latestControl = await readLatestProjectRunControl(runDir);
      if (latestControl?.action === "cancel") {
        throw new Error("RUN_RESUME_NOT_ALLOWED: cancellation has already been requested.");
      }
      if (!["waiting_review", "paused", "ready"].includes(state.status)) {
        throw new Error(`RUN_RESUME_NOT_ALLOWED: run status is ${state.status}.`);
      }
      const plan = await loadProjectRunPlan(runDir);
      const task = await readJson(join(runDir, "task.json"), {});
      return await startProjectRun(projectId, {
        prompt: task.prompt,
        mode: plan.executionPolicy.mode,
        resumeRunId: runId,
        resumeRunDir: runDir
      });
  }
  const request = await writeProjectRunControl(runDir, control);
  const safeCancelled = await updateProjectRunState(runDir, (currentState) => {
    const next = writeRunStateControl(currentState, control);
    return control === "cancel" && ["waiting_review", "paused", "ready"].includes(currentState.status)
      ? { ...next, status: "cancelled", updatedAt: new Date().toISOString() }
      : next;
  });
  return { projectId, runId, state: safeCancelled, controlRequest: request };
}

export async function exportProjectTeam(projectId) {
  const project = await readProject(projectId);
  const bundle = await exportTeamPackage(project.workdir);
  return {
    mode: "single-project-v1",
    team: {
      ...(bundle.team || {}),
      project: { name: project.name, intent: project.intent, source: "exported" }
    }
  };
}

export async function importTeamPackage(bundle) {
  if (!bundle || bundle.mode !== "single-project-v1" || !bundle.team || typeof bundle.team.systemSource !== "string") {
    throw new Error("Unsupported project package format; expected mode=single-project-v1.");
  }
  const manifestPaths = bundle.team.releaseManifest?.artifactScope || [];
  if (!Array.isArray(manifestPaths) || manifestPaths.some((path) => typeof path !== "string" || path.startsWith("/") || path.includes("..") || path.includes("\\"))) {
    throw new Error("PROJECT_IMPORT_INVALID: unsafe artifact path.");
  }
  if (bundle.team.systemSource.length > 2 * 1024 * 1024) throw new Error("TEAM_IMPORT_INVALID: system source is too large.");
  const credentialFields = new Set([
    "apikey", "accesstoken", "refreshtoken", "password", "clientsecret", "clientpassword",
    "secretvalue", "credentialvalue", "privatekey"
  ]);
  const findCredentialField = (value, path = "") => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const found = findCredentialField(value[index], `${path}[${index}]`);
        if (found) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[_-]/g, "");
      if (credentialFields.has(normalizedKey) && child !== undefined && child !== null && !(typeof child === "string" && !child.trim())) return `${path}.${key}`;
      const found = findCredentialField(child, path ? `${path}.${key}` : key);
      if (found) return found;
    }
    return undefined;
  };
  const credentialPath = findCredentialField(bundle);
  if (credentialPath) throw new Error(`PROJECT_IMPORT_INVALID: credential field is not accepted: ${credentialPath}.`);
  const metadata = bundle.team.project || {};
  const libraryLock = await acquireProjectWriteLock(projectsRoot, "project-import");
  let project;
  try {
    project = await createProject({ name: metadata.name || "Imported team", intent: metadata.intent || "", templateId: "empty" });
    const loaded = await loadTeamPackage({ workdir: project.workdir, bundle });
    if (loaded.validation?.ok === false) throw new Error("PROJECT_IMPORT_INVALID: imported Mermaid system failed validation.");
    await withProjectWriteLock(project.projectId, "project-import", async () => {
      const current = await readProject(project.projectId);
      await writeJson(join(current.workdir, ".site", "project.json"), { ...normalizeMeta(current, current.projectId), source: "imported", updatedAt: new Date().toISOString() });
    });
    return getProject(project.projectId);
  } catch (error) {
    if (project?.workdir) await rm(project.workdir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`PROJECT_IMPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await libraryLock.release();
  }
}

export { projectsRoot };
