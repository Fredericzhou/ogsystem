/**
 * Small project-facing state projection around the existing graph runtime.
 * Run control is kept separate from Node execution facts so pause/cancel cannot
 * be confused with a role outcome.
 */
import { writeJsonFileAtomic, readJsonFile } from "./json-file.js";
import type { AdapterRunResult } from "./types.js";
import type { ProjectRunPlan } from "./project-run.js";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { acquireProjectWriteLock, ProjectLockError } from "./project-run-lock.js";

export type ProjectRunStatus =
  | "planning"
  | "ready"
  | "running"
  | "pause_requested"
  | "paused"
  | "waiting_review"
  | "cancel_requested"
  | "failed"
  | "completed"
  | "cancelled";

export type ProjectRunControl = {
  paused: boolean;
  cancelRequested: boolean;
};

export type ProjectTaskReservation = {
  kind: "task-attempt";
  projectId: string;
  taskId: string;
  teamVersionId: string;
  runId: string;
};

export type ProjectNodeState = {
  nodeId: string;
  status: "pending" | "ready" | "running" | "waiting_review" | "completed" | "failed" | "cancelled";
  lastAttemptId?: string;
};

export type ProjectAttemptState = {
  attemptId: string;
  nodeId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  error?: string;
};

export type ProjectReviewState = {
  reviewId: string;
  nodeId: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string;
};

export type ProjectRunState = {
  version: 1;
  runId: string;
  status: ProjectRunStatus;
  control: ProjectRunControl;
  nodes: Record<string, ProjectNodeState>;
  attempts: ProjectAttemptState[];
  reviews: ProjectReviewState[];
  taskReservation?: ProjectTaskReservation;
  updatedAt: string;
};

export const PROJECT_RUN_STATE_FILE = "control/state.json";

export function createProjectRunState(plan: ProjectRunPlan, taskReservation?: ProjectTaskReservation): ProjectRunState {
  const nodes = Object.fromEntries(plan.nodeGraph.map((node) => [node.nodeId, {
    nodeId: node.nodeId,
    status: node.nodeId === plan.entryNodeId ? "ready" : "pending"
  }] as const));
  return {
    version: 1,
    runId: plan.runId,
    status: "ready",
    control: { paused: false, cancelRequested: false },
    nodes,
    attempts: [],
    reviews: [],
    ...(taskReservation ? { taskReservation } : {}),
    updatedAt: new Date().toISOString()
  };
}

export function applyRunControl(
  state: ProjectRunState,
  control: "pause" | "resume" | "cancel"
): ProjectRunState {
  if (control === "cancel") {
    if (["completed", "cancelled"].includes(state.status)) return state;
    return { ...state, status: "cancel_requested", control: { ...state.control, cancelRequested: true }, updatedAt: new Date().toISOString() };
  }
  if (control === "pause") {
    if (state.control.cancelRequested || state.status === "cancel_requested") return state;
    if (["completed", "failed", "cancelled"].includes(state.status)) {
      throw new Error(`RUN_CONTROL_INVALID: cannot pause terminal run (${state.status}).`);
    }
    if (state.status === "paused" || state.status === "pause_requested") return state;
    return {
      ...state,
      status: ["running", "planning"].includes(state.status) ? "pause_requested" : "paused",
      control: { ...state.control, paused: true },
      updatedAt: new Date().toISOString()
    };
  }
  if (["completed", "failed", "cancelled", "cancel_requested", "pause_requested"].includes(state.status)) {
    throw new Error(`RUN_RESUME_NOT_ALLOWED: terminal or cancelling run cannot be resumed (${state.status}).`);
  }
  return {
    ...state,
    status: state.reviews.some((review) => review.status === "pending") ? "waiting_review" : "running",
    control: { ...state.control, paused: false },
    updatedAt: new Date().toISOString()
  };
}

export function projectRunStateFromResult(
  state: ProjectRunState,
  result: AdapterRunResult
): ProjectRunState {
  const attempts = [...state.attempts];
  for (const audit of result.auditTrail) {
    if (attempts.some((attempt) => attempt.nodeId === audit.roleId && attempt.startedAt === audit.at && attempt.status === (audit.status === "failed" ? "failed" : "completed"))) continue;
    attempts.push({
      attemptId: `${state.runId}:${audit.roleId}:${randomUUID()}`,
      nodeId: audit.roleId,
      status: audit.status === "failed" ? "failed" : "completed",
      startedAt: audit.at,
      completedAt: audit.at,
      ...(audit.error ? { error: audit.error } : {})
    });
  }
  const nodes = { ...state.nodes };
  for (const attempt of attempts) {
    nodes[attempt.nodeId] = {
      ...(nodes[attempt.nodeId] ?? { nodeId: attempt.nodeId, status: "pending" }),
      status: attempt.status,
      lastAttemptId: attempt.attemptId
    };
  }
  const pendingReview = result.runSummary.hasWaitingHumanReview === true ||
    result.systemState?.hasWaitingHumanReview === true ||
    Number(result.runSummary.pendingReviewCount ?? result.systemState?.pendingReviewCount ?? 0) > 0;
  const status: ProjectRunStatus = state.control.cancelRequested || state.status === "cancel_requested"
    ? "cancelled"
    : state.status === "pause_requested" || state.control.paused
      ? "paused"
      : pendingReview
        ? "waiting_review"
    : result.status === "done"
      ? "completed"
      : result.status === "stopped" || result.status === "terminated"
        ? "cancelled"
        : result.status === "failed"
          ? "failed"
          : "running";
  return { ...state, status, nodes, attempts, updatedAt: new Date().toISOString() };
}

export async function loadProjectRunState(runDir: string): Promise<ProjectRunState> {
  return await readJsonFile(resolve(runDir, PROJECT_RUN_STATE_FILE)) as ProjectRunState;
}

export async function saveProjectRunState(runDir: string, state: ProjectRunState): Promise<void> {
  await mkdir(resolve(runDir, "control"), { recursive: true });
  await writeJsonFileAtomic(resolve(runDir, PROJECT_RUN_STATE_FILE), state);
}

export async function updateProjectRunStateWithHeldLock(
  runDir: string,
  update: (state: ProjectRunState) => ProjectRunState | Promise<ProjectRunState>
): Promise<ProjectRunState> {
  const current = await loadProjectRunState(runDir);
  const next = await update(current);
  await saveProjectRunState(runDir, next);
  return next;
}

export async function updateProjectRunState(
  runDir: string,
  update: (state: ProjectRunState) => ProjectRunState | Promise<ProjectRunState>
): Promise<ProjectRunState> {
  const workdir = resolve(runDir, "..", "..", "..");
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const lock = await acquireProjectWriteLock(workdir, "project-run-state");
      try {
        return await updateProjectRunStateWithHeldLock(runDir, update);
      } finally {
        await lock.release();
      }
    } catch (error) {
      if (!(error instanceof ProjectLockError) || Date.now() >= deadline) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
}
