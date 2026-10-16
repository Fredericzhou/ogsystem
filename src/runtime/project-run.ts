/**
 * Minimal project-level run contract.
 *
 * The graph runtime remains the execution authority. This module only persists the
 * immutable inputs needed to explain and resume a project run without rereading the
 * mutable project directory.
 */
import { copyFile, lstat, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, relative, resolve, sep } from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";
import type { ExecutionPlan } from "./types.js";
import type { RunPlanFingerprint } from "./run-artifacts.js";
import { createProjectRunState, saveProjectRunState } from "./project-run-state.js";
import { assertProjectAssetSnapshot, readProjectAssetManifestDigest } from "./project-run-snapshot.js";

export type ProjectRunMode = "dry-run" | "sandbox" | "real";

export type ProjectMaterialInput = {
  materialId: string;
  sourcePath: string;
  contentType?: string;
  selectedRanges?: Array<{ start?: number; end?: number }>;
  consumingNodeIds?: string[];
};

export type ProjectMaterialSnapshot = {
  materialId: string;
  sourcePath: string;
  snapshotPath: string;
  contentHash: string;
  size: number;
  contentType?: string;
  selectedRanges: Array<{ start?: number; end?: number }>;
  consumingNodeIds: string[];
};

export type ProjectInputRef = {
  materialId: string;
  snapshotPath: string;
  contentHash: string;
  selectedRanges: Array<{ start?: number; end?: number }>;
  consumingNodeIds: string[];
};

export type ProjectNodePlan = {
  nodeId: string;
  incoming: Array<{ from: string; event: string }>;
  outgoing: Array<{ to: string; event: string }>;
  reviewRequired: boolean;
  loopMax?: number;
};

export type ProjectRunPlan = {
  version: 1;
  runId: string;
  projectId?: string;
  createdAt: string;
  projectDigest: string;
  designDigest: string;
  workspaceDigest: string;
  taskDigest: string;
  fingerprintDigest: string;
  projectAssetManifestDigest: string | null;
  entryNodeId: string;
  backend: string[];
  nodeGraph: ProjectNodePlan[];
  executionPolicy: {
    mode: ProjectRunMode;
    dryRun: boolean;
    singleWorker: true;
    allowExternalSideEffects: boolean;
    maxTransitions?: number;
  };
  reviewPolicy: {
    requiredNodeIds: string[];
  };
  inputRefs: ProjectInputRef[];
  runPlanDigest: string;
};

export type ProjectRunArtifacts = {
  runPlan: ProjectRunPlan;
  materials: ProjectMaterialSnapshot[];
  taskPath: string;
  runPlanPath: string;
  materialsPath: string;
};

export const PROJECT_RUN_PLAN_FILE = "run-plan.json";
export const PROJECT_RUN_MATERIALS_FILE = "control/materials.json";
export const PROJECT_RUN_TASK_FILE = "task.json";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function digestRunPlan(plan: Omit<ProjectRunPlan, "runPlanDigest">): string {
  const { createdAt: _createdAt, ...stablePlan } = plan;
  return digest(stablePlan);
}

function assertSafeId(value: string, field: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${field} must use letters, numbers, dots, underscores, or hyphens.`);
  }
}

function assertWithin(root: string, target: string, field: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`${field} must stay within ${resolvedRoot}.`);
  }
  return resolvedTarget;
}

function buildNodeGraph(plan: ExecutionPlan): ProjectNodePlan[] {
  return Array.from(plan.nodesByRoleId.values())
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map((node) => ({
      nodeId: node.roleId,
      incoming: node.incoming
        .map((flow) => ({ from: flow.fromRoleId, event: flow.eventType }))
        .sort((left, right) => `${left.from}:${left.event}`.localeCompare(`${right.from}:${right.event}`)),
      outgoing: node.outgoing
        .map((flow) => ({ to: flow.toRoleId, event: flow.eventType }))
        .sort((left, right) => `${left.to}:${left.event}`.localeCompare(`${right.to}:${right.event}`)),
      reviewRequired: node.review?.mode === "required",
      loopMax: node.loopMax
    }));
}

function resolveBackendNames(plan: ExecutionPlan): string[] {
  return Array.from(new Set(
    Array.from(plan.nodesByRoleId.values()).flatMap((node) =>
      node.binding.kind === "model" ? [node.binding.backend] : []
    )
  )).sort();
}

/** First-phase project runs intentionally accept a single, terminating chain. */
export function validateLinearProjectTopology(nodeGraph: ProjectNodePlan[], entryNodeId?: string): void {
  if (nodeGraph.length === 0) throw new Error("PROJECT_TOPOLOGY_INVALID: project has no executable nodes.");
  const ids = new Set(nodeGraph.map((node) => node.nodeId));
  const byId = new Map(nodeGraph.map((node) => [node.nodeId, node]));
  const incomingFromNodes = new Map<string, number>();
  for (const node of nodeGraph) {
    if (node.outgoing.length > 1 || node.incoming.filter((edge) => ids.has(edge.from)).length > 1) {
      throw new Error("PROJECT_TOPOLOGY_UNSUPPORTED: first-phase runs only support linear flows.");
    }
    if (node.loopMax !== undefined) {
      throw new Error("PROJECT_TOPOLOGY_UNSUPPORTED: loops are not enabled for first-phase project runs.");
    }
    for (const edge of node.outgoing) {
      if (ids.has(edge.to)) incomingFromNodes.set(edge.to, (incomingFromNodes.get(edge.to) ?? 0) + 1);
    }
  }
  const roots = nodeGraph.filter((node) => (incomingFromNodes.get(node.nodeId) ?? 0) === 0);
  if (roots.length !== 1 || (entryNodeId && roots[0].nodeId !== entryNodeId)) {
    throw new Error("PROJECT_TOPOLOGY_UNSUPPORTED: project must have one linear entry.");
  }
  const visited = new Set<string>();
  let current: string | undefined = roots[0].nodeId;
  while (current) {
    if (visited.has(current)) throw new Error("PROJECT_TOPOLOGY_UNSUPPORTED: loops are not enabled for first-phase project runs.");
    visited.add(current);
    const node = byId.get(current);
    const next = node?.outgoing.filter((edge) => ids.has(edge.to)) ?? [];
    current = next[0]?.to;
  }
  if (visited.size !== nodeGraph.length) {
    throw new Error("PROJECT_TOPOLOGY_UNSUPPORTED: disconnected or branching project flow.");
  }
}

export function buildProjectRunPlan(args: {
  runId: string;
  projectId?: string;
  prompt: string;
  plan: ExecutionPlan;
  fingerprint: RunPlanFingerprint;
  mode: ProjectRunMode;
  projectDigest?: string;
  projectAssetManifestDigest?: string | null;
  materialSnapshot?: ProjectMaterialSnapshot[];
  enforceLinearTopology?: boolean;
}): ProjectRunPlan {
  const materials = args.materialSnapshot ?? [];
  const components = (args.fingerprint.payload.components ?? {}) as Record<string, { digest?: unknown; value?: unknown }>;
  const designDigest = (typeof components.design?.digest === "string" ? components.design.digest : undefined)
    ?? (typeof components.system?.digest === "string" ? components.system.digest : undefined)
    ?? args.fingerprint.digest;
  const taskDigest = digest({ prompt: args.prompt });
  const workspaceDigest = digest(materials.map((item) => ({
    materialId: item.materialId,
    contentHash: item.contentHash,
    size: item.size,
    selectedRanges: item.selectedRanges,
    consumingNodeIds: item.consumingNodeIds
  })));
  const nodeGraph = buildNodeGraph(args.plan);
  if (args.enforceLinearTopology !== false) validateLinearProjectTopology(nodeGraph, args.plan.entryRoleId);
  const maxTransitions = components.effectiveLaw?.value;
  const maxTransitionValue = typeof maxTransitions === "object" && maxTransitions !== null
    ? (maxTransitions as Record<string, unknown>).maxTransitions
    : undefined;
  const plan: Omit<ProjectRunPlan, "runPlanDigest"> = {
    version: 1,
    runId: args.runId,
    ...(args.projectId ? { projectId: args.projectId } : {}),
    createdAt: new Date().toISOString(),
    projectDigest: args.projectDigest ?? designDigest,
    designDigest,
    workspaceDigest,
    taskDigest,
    fingerprintDigest: args.fingerprint.digest,
    projectAssetManifestDigest: args.projectAssetManifestDigest ?? null,
    entryNodeId: args.plan.entryRoleId,
    backend: resolveBackendNames(args.plan),
    nodeGraph,
    executionPolicy: {
      mode: args.mode,
      dryRun: args.mode === "dry-run",
      singleWorker: true,
      allowExternalSideEffects: args.mode === "real",
      ...(typeof maxTransitionValue === "number" ? { maxTransitions: maxTransitionValue } : {})
    },
    reviewPolicy: {
      requiredNodeIds: nodeGraph.filter((node) => node.reviewRequired).map((node) => node.nodeId)
    },
    inputRefs: materials.map((item) => ({
      materialId: item.materialId,
      snapshotPath: item.snapshotPath,
      contentHash: item.contentHash,
      selectedRanges: item.selectedRanges,
      consumingNodeIds: item.consumingNodeIds
    }))
  };
  return { ...plan, runPlanDigest: digestRunPlan(plan) };
}

async function snapshotMaterials(args: {
  workdir: string;
  runDir: string;
  materials: ProjectMaterialInput[];
  nodeIds: string[];
}): Promise<ProjectMaterialSnapshot[]> {
  const inputDir = resolve(args.runDir, "inputs");
  await mkdir(inputDir, { recursive: true });
  const output: ProjectMaterialSnapshot[] = [];
  for (const input of args.materials) {
    assertSafeId(input.materialId, "materialId");
    const sourcePath = assertWithin(args.workdir, input.sourcePath, "material source path");
    const sourceStat = await lstat(sourcePath);
    if (sourceStat.isSymbolicLink()) throw new Error(`MATERIAL_SYMLINK_UNSUPPORTED: ${sourcePath}`);
    const source = await readFile(sourcePath);
    const filename = `${input.materialId}-${basename(sourcePath)}`;
    const snapshotPath = resolve(inputDir, filename);
    await copyFile(sourcePath, snapshotPath);
    output.push({
      materialId: input.materialId,
      sourcePath: relative(args.workdir, sourcePath),
      snapshotPath: relative(args.runDir, snapshotPath),
      contentHash: createHash("sha256").update(source).digest("hex"),
      size: source.byteLength,
      contentType: input.contentType,
      selectedRanges: input.selectedRanges ?? [],
      consumingNodeIds: input.consumingNodeIds ?? args.nodeIds
    });
  }
  return output;
}

export async function initializeProjectRunArtifacts(args: {
  workdir: string;
  runDir: string;
  projectId?: string;
  prompt: string;
  plan: ExecutionPlan;
  fingerprint: RunPlanFingerprint;
  mode: ProjectRunMode;
  projectDigest?: string;
  materials?: ProjectMaterialInput[];
  enforceLinearTopology?: boolean;
  enforceSnapshotContract?: boolean;
}): Promise<ProjectRunArtifacts> {
  if (args.enforceSnapshotContract === true && !args.projectId) {
    throw new Error("PROJECT_ID_REQUIRED: project execution must identify its project asset.");
  }
  const runPlanPath = resolve(args.runDir, PROJECT_RUN_PLAN_FILE);
  const materialsPath = resolve(args.runDir, PROJECT_RUN_MATERIALS_FILE);
  const taskPath = resolve(args.runDir, PROJECT_RUN_TASK_FILE);
  await mkdir(resolve(args.runDir, "control"), { recursive: true });
  if (args.enforceSnapshotContract === true) await assertProjectAssetSnapshot(args.runDir);
  const projectAssetManifestDigest = args.enforceSnapshotContract === true
    ? await readProjectAssetManifestDigest(args.runDir)
    : null;

  let materials: ProjectMaterialSnapshot[];
  if (await fileExists(materialsPath)) {
    const stored = await readJsonFile(materialsPath);
    if (!Array.isArray(stored)) throw new Error(`Invalid material snapshot: ${materialsPath}`);
    materials = stored as ProjectMaterialSnapshot[];
    if (args.enforceSnapshotContract !== false) await verifyMaterialSnapshots(args.runDir, materials);
  } else {
    materials = await snapshotMaterials({
      workdir: args.workdir,
      runDir: args.runDir,
      materials: args.materials ?? [],
      nodeIds: Array.from(args.plan.nodesByRoleId.keys())
    });
    await writeJsonFileAtomic(materialsPath, materials);
  }

  const runPlan = buildProjectRunPlan({
    runId: args.runDir.split(/[\\/]/).pop() ?? "run",
    projectId: args.projectId,
    prompt: args.prompt,
    plan: args.plan,
    fingerprint: args.fingerprint,
    mode: args.mode,
    projectDigest: args.projectDigest,
    projectAssetManifestDigest,
    materialSnapshot: materials,
    enforceLinearTopology: args.enforceLinearTopology
  });
  if (await fileExists(runPlanPath)) {
    const stored = await readJsonFile(runPlanPath) as ProjectRunPlan;
    const { runPlanDigest: _storedDigest, ...storedWithoutDigest } = stored;
    if (args.enforceSnapshotContract === true && typeof stored.projectAssetManifestDigest !== "string") {
      throw new Error("RUN_SNAPSHOT_INVALID: stored run plan is missing the project asset manifest digest.");
    }
    if (!stored.runPlanDigest || stored.runPlanDigest !== digestRunPlan(storedWithoutDigest) ||
      stored.projectDigest !== runPlan.projectDigest || stored.fingerprintDigest !== runPlan.fingerprintDigest) {
      throw new Error("RUN_PLAN_CHANGED: the stored run plan does not match the current runtime fingerprint.");
    }
    // Project runs freeze the complete task and execution plan. The general
    // Runtime resume path may receive a refreshed prompt, but must still use
    // the persisted task snapshot rather than rewriting the run contract.
    if (args.enforceSnapshotContract !== false && stored.runPlanDigest !== runPlan.runPlanDigest) {
      throw new Error("RUN_PLAN_CHANGED: the stored run plan does not match the current runtime fingerprint.");
    }
    if (stored.runId !== runPlan.runId || stored.executionPolicy.mode !== runPlan.executionPolicy.mode) {
      throw new Error("RUN_PLAN_CHANGED: the stored run plan execution identity does not match the requested run.");
    }
    if (args.enforceLinearTopology !== false) validateLinearProjectTopology(stored.nodeGraph, stored.entryNodeId);
    if (args.enforceSnapshotContract !== false) {
      const task = await readJsonFile(taskPath).catch(() => undefined) as { prompt?: string; taskDigest?: string } | undefined;
      if (!task || task.taskDigest !== stored.taskDigest || task.prompt !== args.prompt) {
        throw new Error("RUN_SNAPSHOT_INVALID: immutable task snapshot is missing or changed.");
      }
    }
    if (!(await fileExists(resolve(args.runDir, "control", "state.json")))) {
      await saveProjectRunState(args.runDir, createProjectRunState(stored));
    }
    return { runPlan: stored, materials, taskPath, runPlanPath, materialsPath };
  }

  await writeJsonFileAtomic(taskPath, {
    version: 1,
    prompt: args.prompt,
    taskDigest: runPlan.taskDigest,
    createdAt: runPlan.createdAt
  });
  await writeJsonFileAtomic(runPlanPath, runPlan);
  await saveProjectRunState(args.runDir, createProjectRunState(runPlan));
  return { runPlan, materials, taskPath, runPlanPath, materialsPath };
}

export async function loadProjectRunPlan(runDir: string): Promise<ProjectRunPlan> {
  return await readJsonFile(resolve(runDir, PROJECT_RUN_PLAN_FILE)) as ProjectRunPlan;
}

export async function loadProjectMaterialSnapshots(runDir: string): Promise<ProjectMaterialSnapshot[]> {
  const value = await readJsonFile(resolve(runDir, PROJECT_RUN_MATERIALS_FILE));
  if (!Array.isArray(value)) {
    throw new Error(`Invalid material snapshot: ${resolve(runDir, PROJECT_RUN_MATERIALS_FILE)}`);
  }
  return value as ProjectMaterialSnapshot[];
}

export async function verifyMaterialSnapshots(runDir: string, materials: ProjectMaterialSnapshot[]): Promise<void> {
  const inputRoot = resolve(runDir, "inputs");
  for (const material of materials) {
    const path = assertWithin(inputRoot, resolve(runDir, material.snapshotPath), "material snapshot path");
    const stat = await lstat(path).catch(() => undefined);
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`RUN_SNAPSHOT_INVALID: material snapshot is missing or unsafe: ${material.snapshotPath}`);
    }
    const content = await readFile(path);
    const hash = createHash("sha256").update(content).digest("hex");
    if (hash !== material.contentHash || content.byteLength !== material.size) {
      throw new Error(`RUN_SNAPSHOT_INVALID: material snapshot hash mismatch: ${material.materialId}`);
    }
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
