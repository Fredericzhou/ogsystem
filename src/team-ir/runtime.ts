import { randomUUID } from "node:crypto";
import { evaluateTeamCondition, evaluateTeamValueExpr, MISSING_TEAM_VALUE } from "./reference.js";
import type { CompiledTeamPlan } from "./compiler.js";
import { assertValidTeamPayload } from "./payload-validation.js";
import { applyTeamJoinEvent, createTeamJoinRound, type TeamJoinRound } from "./join-runtime.js";
import type { ArtifactStore, TeamArtifactPublicationReservation, TeamArtifactResolver } from "./artifact-store.js";
import { TeamArtifactError } from "./artifact-store.js";
import type { TeamRunStatus } from "./types.js";
import { TeamReviewRuntime, readTeamReviewContext, type TeamReviewRecord } from "./review-runtime.js";

export type TeamFailureClass = "transport" | "timeout" | "rate_limited" | "server_error" | "invalid_input" | "invalid_output" | "cancelled" | "policy";
export type TeamBindingDiagnosticCode =
  | "OUTPUT_JSON_INVALID"
  | "OUTPUT_ENVELOPE_INVALID"
  | "OUTPUT_FIELD_UNDECLARED"
  | "OUTPUT_DATA_SCHEMA_INVALID"
  | "OUTPUT_ARTIFACT_MAP_INVALID"
  | "OUTPUT_ARTIFACT_SLOT_INVALID"
  | "OUTPUT_ARTIFACT_TOO_LARGE"
  | "OUTPUT_ARTIFACT_REQUIRED";
export type TeamBindingResult =
  | { kind: "completed"; output: { event: string; data: unknown; artifacts?: Record<string, unknown> } }
  | { kind: "input-required"; remoteTaskId: string; messageParts: unknown[]; requestedInputSchema?: unknown };

export class TeamBindingError extends Error {
  outcomeUnknown = false;

  constructor(message: string, readonly failureClass: TeamFailureClass, readonly diagnosticCode?: TeamBindingDiagnosticCode) {
    super(message);
    this.name = "TeamBindingError";
  }
}

export interface TeamBindingInvocation {
  runId: string;
  handoffId: string;
  agentId: string;
  bindingId: string;
  attempt: number;
  input: unknown;
  artifactResolver?: TeamArtifactResolver;
  idempotencyKey: string;
  remoteTaskId?: string;
}

export interface TeamBinding {
  invoke(input: TeamBindingInvocation): Promise<TeamBindingResult>;
  cancel?(input: TeamBindingInvocation): Promise<boolean>;
}

export interface TeamClock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface TeamRunEvent {
  id: string;
  type: string;
  at: number;
  data?: unknown;
}

export interface TeamInvocationState {
  id: string;
  handoffId: string;
  agentId: string;
  bindingId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "input-required";
  deadlineAt: number;
  attempt: number;
  activeAttemptStartedAt?: number;
  output?: TeamBindingResult;
  error?: string;
  diagnosticCode?: TeamBindingDiagnosticCode;
  outcomeUnknown?: boolean;
  artifactPublication?: {
    id: string;
    reservation: TeamArtifactPublicationReservation;
    artifacts: Record<string, { artifactId: string; mediaType: string }>;
    status: "reserved" | "pending" | "committed" | "aborted";
  };
}

export interface TeamRunRecord {
  runId: string;
  projectId: string;
  revision: number;
  status: TeamRunStatus;
  compiledPlanDigest: string;
  createdAt: number;
  updatedAt: number;
  runInput: { task: string; input: unknown; preferences: unknown; attachments: Record<string, unknown> };
  activeExecutionBudgetMs: number;
  activeExecutionMs: number;
  terminalIntent?: "failed" | "cancelled";
  result?: unknown;
  resultWritten?: boolean;
  pendingResult?: { value: unknown; handoffId: string };
  loopStates: Record<string, { rounds: number; agentActivations: number; previousOutputs: Record<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }>; currentOutputs: Record<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }> }>;
  scheduler?: { pending: string[]; sources: Record<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }>; skippedHandoffs: string[]; arrivedHandoffs: string[]; visited: Record<string, number>; invocationIds: Record<string, string>; reviewContexts: Record<string, { decision: "approve" | "reject"; feedback?: unknown }>; joinRounds?: Record<string, TeamJoinRound> };
  waitingReview?: { reviewId: string; lineage: string; loopRound?: number };
  waitingReviews?: Array<{ reviewId: string; lineage: string; loopRound?: number }>;
  invocations: Record<string, TeamInvocationState>;
  pendingInput?: { handoffId: string; agentId: string; bindingId: string; remoteTaskId: string; messageParts: unknown[]; requestedInputSchema?: unknown };
  events: TeamRunEvent[];
}

export interface TeamRunStore {
  create(record: TeamRunRecord): Promise<void>;
  load(runId: string): Promise<TeamRunRecord | undefined>;
  compareAndSet(runId: string, expectedRevision: number, record: TeamRunRecord): Promise<boolean>;
}

export class TeamRunConflictError extends Error {
  constructor(message = "Team Run state changed concurrently") {
    super(message);
    this.name = "TeamRunConflictError";
  }
}

export class TeamRouteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TeamRouteError";
  }
}

export class MemoryTeamRunStore implements TeamRunStore {
  private readonly records = new Map<string, TeamRunRecord>();
  async create(record: TeamRunRecord): Promise<void> {
    if (this.records.has(record.runId)) throw new TeamRunConflictError("Team Run already exists");
    this.records.set(record.runId, structuredClone(record));
  }
  async load(runId: string): Promise<TeamRunRecord | undefined> {
    const record = this.records.get(runId);
    return record ? structuredClone(record) : undefined;
  }
  async compareAndSet(runId: string, expectedRevision: number, record: TeamRunRecord): Promise<boolean> {
    const current = this.records.get(runId);
    if (!current || current.revision !== expectedRevision) return false;
    this.records.set(runId, structuredClone(record));
    return true;
  }
}

const terminal = new Set<TeamRunStatus>(["completed", "failed", "cancelled"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function event(record: TeamRunRecord, id: string, type: string, now: number, data?: unknown): void {
  if (record.events.some((item) => item.id === id)) return;
  record.events.push({ id, type, at: now, ...(data === undefined ? {} : { data }) });
}

function latestInvocationForHandoff(record: TeamRunRecord, handoffId: string): TeamInvocationState | undefined {
  return Object.values(record.invocations)
    .filter((invocation) => invocation.handoffId === handoffId)
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .at(-1);
}

function isSupportedMakerCheckerLoop(plan: CompiledTeamPlan): boolean {
  const orchestration = plan.team.orchestration as Record<string, unknown>;
  const loops = Array.isArray(orchestration.loops) ? orchestration.loops.filter(isRecord) : [];
  const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews.filter(isRecord) : [];
  const joins = Array.isArray(orchestration.joins) ? orchestration.joins : [];
  const handoffs = [...plan.handoffsById.values()];
  const routes = Array.isArray(orchestration.routes) ? orchestration.routes.filter(isRecord) : [];
  if (loops.length !== 1 || reviews.length !== 1 || joins.length !== 0) return false;
  const loop = loops[0];
  const members = Array.isArray(loop.members) ? loop.members.map(String) : [];
  const entryIds = Array.isArray(loop.entryHandoffIds) ? loop.entryHandoffIds.map(String) : [];
  const continueIds = Array.isArray(loop.continueHandoffIds) ? loop.continueHandoffIds.map(String) : [];
  const exitIds = Array.isArray(loop.exitHandoffIds) ? loop.exitHandoffIds.map(String) : [];
  const agentId = String(loop.boundaryAgentId);
  const review = reviews[0];
  const at = isRecord(review.at) ? review.at : {};
  if (members.length !== 1 || members[0] !== agentId || at.kind !== "agentOutput" || at.agentId !== agentId) return false;
  if (entryIds.length !== 1 || continueIds.length !== 1 || exitIds.length !== 1) return false;
  const entry = plan.handoffsById.get(entryIds[0]);
  const revise = plan.handoffsById.get(continueIds[0]);
  const exit = plan.handoffsById.get(exitIds[0]);
  if (!isRecord(entry?.from) || entry.from.kind !== "run" || !isRecord(entry.to) || entry.to.kind !== "agent" || entry.to.agentId !== agentId) return false;
  if (!isRecord(revise?.from) || revise.from.kind !== "agent" || revise.from.agentId !== agentId || revise.from.outputPort !== at.outputPort
    || !isRecord(revise.to) || revise.to.kind !== "agent" || revise.to.agentId !== agentId || revise.to.inputPort === entry.to.inputPort) return false;
  if (!isRecord(exit?.from) || exit.from.kind !== "agent" || exit.from.agentId !== agentId || exit.from.outputPort !== at.outputPort
    || !isRecord(exit.to) || exit.to.kind !== "result") return false;
  const decisionCondition = (handoff: Record<string, unknown> | undefined, decision: string): boolean => {
    const when = isRecord(handoff?.when) ? handoff.when : {};
    const condition = isRecord(when.condition) ? when.condition : {};
    const args = Array.isArray(condition.args) ? condition.args : [];
    return condition.op === "equals" && args.length === 2 && isRecord(args[0]) && args[0].$ref === "$.review.decision"
      && isRecord(args[1]) && args[1].$literal === decision;
  };
  if (!decisionCondition(revise, "reject") || !decisionCondition(exit, "approve")) return false;
  if (!isRecord(revise.map) || !isRecord(revise.map.data)
    || !Object.values(revise.map.data).some((value) => isRecord(value) && typeof value.$ref === "string" && value.$ref.startsWith("$.review.feedback."))) return false;
  const sourceRoute = routes.filter((route) => isRecord(route.from) && route.from.kind === "agent" && route.from.agentId === agentId && route.from.outputPort === at.outputPort);
  const runRoute = routes.filter((route) => isRecord(route.from) && route.from.kind === "run");
  if (sourceRoute.length !== 1 || sourceRoute[0].mode !== "exclusive_priority"
    || !Array.isArray(sourceRoute[0].handoffIds) || sourceRoute[0].handoffIds.map(String).sort().join("\0") !== [continueIds[0], exitIds[0]].sort().join("\0")) return false;
  if (runRoute.length !== 1 || runRoute[0].mode !== "exclusive_priority" || !Array.isArray(runRoute[0].handoffIds)
    || runRoute[0].handoffIds.map(String).join("\0") !== entryIds.join("\0")) return false;
  const scopedHandoffs = handoffs.filter((handoff) => {
    const from = isRecord(handoff.from) ? handoff.from : {};
    const to = isRecord(handoff.to) ? handoff.to : {};
    return from.kind === "agent" && from.agentId === agentId || to.kind === "agent" && to.agentId === agentId;
  });
  return scopedHandoffs.every((handoff) => [entryIds[0], continueIds[0], exitIds[0]].includes(String(handoff.id)));
}

function isSupportedReviewBeforeFanout(plan: CompiledTeamPlan): boolean {
  const orchestration = plan.team.orchestration as Record<string, unknown>;
  const loops = Array.isArray(orchestration.loops) ? orchestration.loops : [];
  const joins = Array.isArray(orchestration.joins) ? orchestration.joins : [];
  const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews.filter(isRecord) : [];
  const routes = Array.isArray(orchestration.routes) ? orchestration.routes.filter(isRecord) : [];
  const fanouts = routes.filter((route) => route.mode === "parallel_fanout");
  if (loops.length !== 0 || joins.length !== 0 || routes.length < 1 || fanouts.length !== 1) return false;

  const fanout = fanouts[0];
  const fanoutSource = isRecord(fanout.from) ? fanout.from : {};
  const fanoutIds = Array.isArray(fanout.handoffIds) ? fanout.handoffIds.map(String) : [];
  if (fanoutSource.kind === "run" && routes.length === 1 && reviews.length >= 2 && fanoutIds.length === reviews.length) {
    const agents = fanoutIds.map((id) => {
      const handoff = plan.handoffsById.get(id);
      return handoff && isRecord(handoff.to) && handoff.to.kind === "agent" ? String(handoff.to.agentId) : undefined;
    });
    const reviewedAgents = reviews.map((review) => {
      const at = isRecord(review.at) ? review.at : {};
      return at.kind === "agentOutput" ? String(at.agentId) : undefined;
    });
    return agents.every((agent) => agent !== undefined)
      && new Set(agents).size === agents.length
      && reviewedAgents.every((agent) => agent !== undefined && agents.includes(agent))
      && new Set(reviewedAgents).size === reviewedAgents.length;
  }
  if (reviews.length !== 1 || routes.length !== 2) return false;

  const review = reviews[0];
  const at = isRecord(review.at) ? review.at : {};
  if (at.kind !== "agentOutput") return false;
  const agentId = String(at.agentId);
  const outputPort = String(at.outputPort);
  if (fanoutSource.kind !== "agent" || fanoutSource.agentId !== agentId || fanoutSource.outputPort !== outputPort) return false;
  if (fanoutIds.length < 2 || new Set(fanoutIds).size !== fanoutIds.length) return false;
  const targets = fanoutIds.map((id) => {
    const handoff = plan.handoffsById.get(id);
    return handoff && isRecord(handoff.from) && handoff.from.kind === "agent" && handoff.from.agentId === agentId
      && handoff.from.outputPort === outputPort && isRecord(handoff.to) && handoff.to.kind === "agent"
      ? String(handoff.to.agentId) : undefined;
  });
  if (targets.some((target) => target === undefined) || new Set(targets).size !== targets.length) return false;

  const runRoute = routes.find((route) => isRecord(route.from) && route.from.kind === "run");
  if (!runRoute || runRoute.mode !== "exclusive_priority") return false;
  const runHandoffIds = Array.isArray(runRoute.handoffIds) ? runRoute.handoffIds.map(String) : [];
  return runHandoffIds.length > 0 && runHandoffIds.every((id) => {
    const handoff = plan.handoffsById.get(id);
    return handoff && isRecord(handoff.to) && handoff.to.kind === "agent" && handoff.to.agentId === agentId;
  });
}

function isSupportedReviewOnRunAllOfJoin(plan: CompiledTeamPlan): boolean {
  const orchestration = plan.team.orchestration as Record<string, unknown>;
  const loops = Array.isArray(orchestration.loops) ? orchestration.loops : [];
  const joins = Array.isArray(orchestration.joins) ? orchestration.joins.filter(isRecord) : [];
  const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews.filter(isRecord) : [];
  const routes = Array.isArray(orchestration.routes) ? orchestration.routes.filter(isRecord) : [];
  if (loops.length !== 0 || joins.length !== 1 || reviews.length !== 1 || routes.length !== 1) return false;

  const join = joins[0];
  const scope = isRecord(join.scope) ? join.scope : {};
  if (join.mode !== "all_of" || scope.kind !== "run") return false;
  const targetAgentId = String(join.agentId);
  const targetInputPort = String(join.inputPort);
  const reviewAt = isRecord(reviews[0].at) ? reviews[0].at : {};
  if (reviewAt.kind !== "agentOutput" || reviewAt.agentId !== targetAgentId) return false;
  const targetAgent = plan.team.agents.find((agent) => agent.id === targetAgentId) as Record<string, unknown> | undefined;
  const outputPorts = isRecord(targetAgent?.outputPorts) ? targetAgent.outputPorts : {};
  if (!Object.hasOwn(outputPorts, String(reviewAt.outputPort))) return false;

  const route = routes[0];
  const routeFrom = isRecord(route.from) ? route.from : {};
  const routeHandoffIds = Array.isArray(route.handoffIds) ? route.handoffIds.map(String) : [];
  if (routeFrom.kind !== "run" || route.mode !== "parallel_fanout" || routeHandoffIds.length < 2) return false;
  const producers = new Set<string>();
  for (const id of routeHandoffIds) {
    const handoff = plan.handoffsById.get(id);
    if (!isRecord(handoff?.to) || handoff.to.kind !== "agent") return false;
    producers.add(String(handoff.to.agentId));
  }
  if (routeHandoffIds.length !== producers.size) return false;
  const joinHandoffIds = Array.isArray(join.handoffIds) ? join.handoffIds.map(String) : [];
  if (joinHandoffIds.length < 2 || joinHandoffIds.length !== producers.size) return false;
  const joinedProducers = new Set<string>();
  for (const id of joinHandoffIds) {
    const handoff = plan.handoffsById.get(id);
    const from = isRecord(handoff?.from) ? handoff.from : {};
    const to = isRecord(handoff?.to) ? handoff.to : {};
    if (from.kind !== "agent" || to.kind !== "agent" || to.agentId !== targetAgentId || to.inputPort !== targetInputPort
      || !producers.has(String(from.agentId))) return false;
    joinedProducers.add(String(from.agentId));
  }
  return joinedProducers.size === producers.size;
}

function sourceKey(source: Record<string, unknown>): string {
  return source.kind === "run" ? "run" : `agent:${String(source.agentId)}:${String(source.outputPort)}`;
}

function valueContext(input: { task: string; input: unknown; preferences?: unknown; attachments?: Record<string, unknown> }, output?: unknown, loopPrevious?: Record<string, unknown>, review?: { decision: "approve" | "reject"; feedback?: unknown }) {
  return {
    run: { task: input.task, input: input.input, preferences: input.preferences ?? {}, attachments: input.attachments ?? {} },
    ...(output === undefined ? {} : { output }),
    ...(loopPrevious === undefined ? {} : { loop: { previous: loopPrevious } }),
    ...(review === undefined ? {} : { review })
  };
}

export function selectTeamHandoffs(plan: CompiledTeamPlan, source: Record<string, unknown>, output: { event?: string; data?: unknown; artifacts?: unknown }, runInput: { task: string; input: unknown; preferences?: unknown; attachments?: Record<string, unknown> }, allowedHandoffIds?: readonly string[], review?: { decision: "approve" | "reject"; feedback?: unknown }): string[] {
  const route = plan.routesBySource.get(sourceKey(source));
  const candidates = Array.isArray(route?.handoffIds) ? route.handoffIds as string[] :
    [...plan.handoffsById.values()].filter((handoff) => isRecord(handoff.from) && sourceKey(handoff.from) === sourceKey(source)).map((handoff) => String(handoff.id));
  const allowed = allowedHandoffIds ? new Set(allowedHandoffIds) : undefined;
  const context = valueContext(runInput, output, undefined, review);
  const eligible: Array<{ id: string; priority: number }> = [];
  for (const id of candidates) {
    if (allowed && !allowed.has(id)) continue;
    const handoff = plan.handoffsById.get(id);
    if (!handoff) continue;
    const when = isRecord(handoff.when) ? handoff.when : {};
    try {
      if (when.condition !== undefined && !evaluateTeamCondition(when.condition, context)) continue;
    } catch (error) {
      throw new TeamRouteError("ROUTE_CONDITION_INVALID", `Route condition for '${id}' could not be evaluated: ${String(error)}`);
    }
    eligible.push({ id, priority: typeof when.priority === "number" ? when.priority : Number.MAX_SAFE_INTEGER });
  }
  if (route?.mode === "exclusive_priority") {
    eligible.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    if (eligible.length) return [eligible[0].id];
  } else if (eligible.length) {
    return eligible.map((item) => item.id).sort();
  }
  if (route?.onNoMatch === "fail") throw new TeamRouteError("ROUTE_NO_MATCH", "No Handoff matched and onNoMatch is fail.");
  return [];
}

export function retryDelayMs(backoff: Record<string, unknown>, retryIndex: number): number {
  if (backoff.mode === "constant") return Number(backoff.delayMs);
  if (backoff.mode === "exponential") return Math.min(Number(backoff.initialDelayMs) * 2 ** retryIndex, Number(backoff.maxDelayMs));
  return 0;
}

function retryable(policy: Record<string, unknown>, error: unknown): boolean {
  if (!(error instanceof TeamBindingError)) return false;
  return Array.isArray(policy.retryOn) && policy.retryOn.includes(error.failureClass);
}

export class TeamRuntime {
  private readonly activeCancellationSignals = new Map<string, () => void>();
  private readonly failureCancellationRuns = new Map<string, Promise<void>>();
  private readonly joinTimeoutWaiters = new Map<string, AbortController>();

  constructor(private readonly args: { store: TeamRunStore; clock: TeamClock; bindings: Record<string, TeamBinding>; artifactStore?: ArtifactStore; reviewRuntime?: TeamReviewRuntime }) {}

  async getReview(runId: string, reviewId: string, lineage = "run", loopRound?: number): Promise<TeamReviewRecord> {
    if (!this.args.reviewRuntime) throw new TeamRunConflictError("TEAM_REVIEW_RUNTIME_UNAVAILABLE");
    return this.args.reviewRuntime.get({ runId, reviewId, lineage, loopRound });
  }

  async decideReview(input: Parameters<TeamReviewRuntime["decide"]>[0]): Promise<TeamReviewRecord> {
    if (!this.args.reviewRuntime) throw new TeamRunConflictError("TEAM_REVIEW_RUNTIME_UNAVAILABLE");
    return this.args.reviewRuntime.decide(input);
  }

  async createRun(plan: CompiledTeamPlan, input: { runId: string; projectId?: string; task: string; input: unknown; preferences?: unknown; attachments?: Record<string, unknown> }): Promise<TeamRunRecord> {
    const now = this.args.clock.now();
    const owner = { projectId: input.projectId ?? "local", runId: input.runId };
    const attachments = input.attachments ?? {};
    let normalizedAttachments: Record<string, unknown> = {};
    if (this.args.artifactStore) {
      normalizedAttachments = await this.args.artifactStore.bindRunInputAttachments({ team: plan.team, owner, attachments });
    } else {
      const declaredSlots = isRecord(plan.team.runInput.artifactSlots) ? Object.values(plan.team.runInput.artifactSlots) : [];
      if (Object.keys(attachments).length || declaredSlots.some((slot) => isRecord(slot) && slot.required === true)) {
        throw new TeamArtifactError("ARTIFACT_STORE_REQUIRED", "Run input Artifact slots require an ArtifactStore.");
      }
    }
    const normalizedInput = {
      task: input.task,
      input: input.input,
      preferences: input.preferences ?? {},
      attachments: normalizedAttachments
    };
    assertValidTeamPayload(plan, { kind: "run-input", part: "input" }, normalizedInput.input);
    assertValidTeamPayload(plan, { kind: "run-input", part: "preferences" }, normalizedInput.preferences);
    const record: TeamRunRecord = {
      runId: input.runId, projectId: owner.projectId, revision: 0, status: "queued", compiledPlanDigest: plan.compiledPlanDigest,
      createdAt: now, updatedAt: now,
      runInput: normalizedInput,
      activeExecutionBudgetMs: Number((plan.team.executionPolicy as Record<string, unknown>).activeExecutionBudgetMs),
      activeExecutionMs: 0, invocations: {}, loopStates: {},
      scheduler: { pending: selectTeamHandoffs(plan, { kind: "run" }, {}, normalizedInput), sources: {}, skippedHandoffs: [], arrivedHandoffs: [], visited: {}, invocationIds: {}, reviewContexts: {} },
      events: []
    } as TeamRunRecord;
    event(record, `${record.runId}:created`, "run.created", now, { compiledPlanDigest: record.compiledPlanDigest });
    await this.args.store.create(record);
    return (await this.args.store.load(input.runId))!;
  }

  private async update(runId: string, mutate: (record: TeamRunRecord) => void): Promise<TeamRunRecord> {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const current = await this.args.store.load(runId);
      if (!current) throw new Error(`Unknown Team Run '${runId}'`);
      const next = structuredClone(current);
      mutate(next);
      next.revision = current.revision + 1;
      next.updatedAt = this.args.clock.now();
      if (await this.args.store.compareAndSet(runId, current.revision, next)) return next;
    }
    throw new TeamRunConflictError("Team Run state changed too often to commit");
  }

  async claim(runId: string, expectedDigest: string): Promise<TeamRunRecord> {
    return this.update(runId, (record) => {
      if (record.status !== "queued") throw new TeamRunConflictError(`Cannot claim Run in ${record.status}`);
      if (record.compiledPlanDigest !== expectedDigest) throw new TeamRunConflictError("compiledPlanDigest mismatch");
      record.status = "running";
      event(record, `${runId}:claimed`, "run.started", this.args.clock.now());
    });
  }

  async cancel(runId: string): Promise<TeamRunRecord> {
    const before = await this.args.store.load(runId);
    if (!before) throw new Error(`Unknown Team Run '${runId}'`);
    const record = await this.update(runId, (record) => {
      if (terminal.has(record.status) || record.status === "failing" || record.status === "cancelling") throw new TeamRunConflictError(`Cannot cancel Run in ${record.status}`);
      record.status = "cancelling";
      record.terminalIntent = "cancelled";
      event(record, `${runId}:cancel-intent`, "run.cancelling", this.args.clock.now());
    });
    this.disarmRunJoinTimeouts(runId);
    for (const invocation of Object.values(record.invocations)) {
      if (invocation.status !== "running" && invocation.status !== "input-required") continue;
      const binding = this.args.bindings[invocation.bindingId];
      const remoteTaskId = invocation.output?.kind === "input-required" ? invocation.output.remoteTaskId : undefined;
      let confirmed = false;
      if (binding?.cancel) {
        try {
          confirmed = await binding.cancel({
            runId, handoffId: invocation.handoffId, agentId: invocation.agentId, bindingId: invocation.bindingId,
            attempt: invocation.attempt, input: undefined, idempotencyKey: invocation.id, ...(remoteTaskId ? { remoteTaskId } : {})
          });
        } catch { confirmed = false; }
      }
      if (confirmed) this.activeCancellationSignals.get(invocation.id)?.();
      await this.update(runId, (next) => {
        const current = next.invocations[invocation.id];
        if (current.status !== "running" && current.status !== "input-required") return;
        current.status = "cancelled";
        current.outcomeUnknown = !confirmed;
        if (remoteTaskId && next.pendingInput?.remoteTaskId === remoteTaskId) delete next.pendingInput;
        event(next, `${invocation.id}:cancelled`, "invocation.cancelled", this.args.clock.now(), {
          outcomeUnknown: !confirmed,
          ...(remoteTaskId ? { remoteTaskId } : {})
        });
      });
    }
    const current = (await this.args.store.load(runId))!;
    if (before.status === "paused_input_required" && current.status === "cancelling"
      && !Object.values(current.invocations).some((invocation) => invocation.status === "running")) {
      return this.settle(runId);
    }
    return current;
  }

  async executeHandoff(plan: CompiledTeamPlan, runId: string, handoffId: string, runInput: { task: string; input: unknown; preferences?: unknown; attachments?: Record<string, unknown> }, output?: { event: string; data: unknown; artifacts?: Record<string, unknown> }, inputOverride?: unknown, options: { invocationId?: string; loopPrevious?: Record<string, unknown>; review?: { decision: "approve" | "reject"; feedback?: unknown }; artifactOverride?: Record<string, unknown> } = {}): Promise<TeamRunRecord> {
    const handoff = plan.handoffsById.get(handoffId);
    if (!handoff || !isRecord(handoff.to) || handoff.to.kind !== "agent") throw new Error(`Unknown Agent Handoff '${handoffId}'`);
    const target = handoff.to;
    const agentId = String(target.agentId);
    const agent = plan.team.agents.find((item) => item.id === agentId);
    const bindingId = String(agent?.bindingRef);
    const binding = this.args.bindings[bindingId];
    if (!binding) throw new Error(`Missing Team Binding adapter '${bindingId}'`);
    const bindingSpec = plan.team.bindings.find((item) => item.id === bindingId) as Record<string, unknown>;
    const retry = bindingSpec.retry as Record<string, unknown>;
    const attemptTimeoutMs = Number(bindingSpec.attemptTimeoutMs);
    const delivery = handoff.delivery as Record<string, unknown>;
    const now = this.args.clock.now();
    const existing = await this.args.store.load(runId);
    if (!existing) throw new Error(`Unknown Team Run '${runId}'`);
    if (existing.compiledPlanDigest !== plan.compiledPlanDigest) throw new TeamRunConflictError("compiledPlanDigest mismatch");
    const canonicalRunInput = existing.runInput;
    const deadlineAt = now + Number(delivery.deadlineMs);
    const context = valueContext(canonicalRunInput, output, options.loopPrevious, options.review);
    const mapping = isRecord(handoff.map) ? handoff.map : {};
    const mappedData = inputOverride ?? (mapping.data === undefined ? {} : evaluateTeamValueExpr(mapping.data, context));
    if (mappedData === MISSING_TEAM_VALUE) throw new TeamBindingError("Handoff input mapping resolved to missing", "invalid_input");
    const mappedArtifacts: Record<string, { artifactId: string; mediaType: string }> = {};
    const artifactMapping = options.artifactOverride ?? (isRecord(mapping.artifacts) ? mapping.artifacts : {});
    if (Object.keys(artifactMapping).length && !this.args.artifactStore) throw new TeamArtifactError("ARTIFACT_STORE_REQUIRED", "Artifact Handoff mappings require an ArtifactStore.");
    for (const [slotId, expression] of Object.entries(artifactMapping)) {
      const candidate = evaluateTeamValueExpr(expression, context);
      const reference = await this.args.artifactStore!.validateReference({
        team: plan.team, owner: { projectId: existing.projectId, runId }, kind: "agent-input",
        agentId, portId: String(target.inputPort), slotId, reference: candidate
      });
      mappedArtifacts[slotId] = reference;
    }
    const inputPort = isRecord(agent?.inputPorts) && isRecord(agent.inputPorts[String(target.inputPort)])
      ? agent.inputPorts[String(target.inputPort)] as Record<string, unknown> : {};
    const inputSlots = isRecord(inputPort.artifactSlots) ? inputPort.artifactSlots as Record<string, Record<string, unknown>> : {};
    if (Object.entries(inputSlots).some(([slotId, slot]) => slot.required === true && !mappedArtifacts[slotId])) {
      return this.fail(runId, options.invocationId ?? `${runId}:${handoffId}`, "AGENT_INPUT_ARTIFACT_REQUIRED");
    }
    const mapped = Object.keys(mappedArtifacts).length ? { data: mappedData, artifacts: mappedArtifacts } : mappedData;
    const invocationId = options.invocationId ?? `${runId}:${handoffId}`;
    const priorInvocation = existing.invocations[invocationId];
    if (priorInvocation?.status === "completed") return existing;
    if (priorInvocation) throw new TeamRunConflictError(`Cannot execute Handoff '${handoffId}' in ${priorInvocation.status}; its outcome requires recovery handling.`);
    try {
      assertValidTeamPayload(plan, { kind: "agent-input", agentId, portId: String(target.inputPort) }, mappedData);
    } catch (error) {
      return this.fail(runId, invocationId, "AGENT_INPUT_SCHEMA_INVALID");
    }
    let cancellationRequested = false;
    let rejectCancellation: ((error: TeamBindingError) => void) | undefined;
    const cancellationError = () => new TeamBindingError("Binding cancelled after a sibling failure", "cancelled");
    const requestCancellation = () => {
      cancellationRequested = true;
      rejectCancellation?.(cancellationError());
    };
    this.activeCancellationSignals.set(invocationId, requestCancellation);
    try {
      await this.update(runId, (record) => {
        if (record.status !== "running") throw new TeamRunConflictError(`Cannot execute Handoff in ${record.status}`);
        if (record.invocations[invocationId]) throw new TeamRunConflictError("Handoff invocation already exists");
        record.invocations[invocationId] = { id: invocationId, handoffId, agentId, bindingId, status: "running", deadlineAt, attempt: 0 };
        event(record, `${invocationId}:activated`, "handoff.activated", now, { deadlineAt });
      });

      for (let attempt = 1; attempt <= Number(retry.maxAttempts); attempt += 1) {
        const attemptStartedAt = this.args.clock.now();
        const left = deadlineAt - attemptStartedAt;
        if (left <= 0) return this.fail(runId, invocationId, "HANDOFF_DEADLINE_EXCEEDED");
        await this.update(runId, (record) => {
          const state = record.invocations[invocationId];
          state.attempt = attempt;
          state.activeAttemptStartedAt = attemptStartedAt;
          event(record, `${invocationId}:attempt:${attempt}:started`, "binding.attempt.started", attemptStartedAt, { attempt });
        });
        let artifactResolver: TeamArtifactResolver | undefined;
        try {
          artifactResolver = Object.keys(mappedArtifacts).length
            ? await this.args.artifactStore!.createInvocationResolver({
              owner: { projectId: existing.projectId, runId }, allowedArtifacts: Object.values(mappedArtifacts)
            })
            : undefined;
        } catch (error) {
          const code = error instanceof TeamArtifactError ? error.code : "ARTIFACT_RESOLVER_UNAVAILABLE";
          return this.fail(runId, invocationId, code);
        }
        const call = { runId, handoffId, agentId, bindingId, attempt, input: mapped, ...(artifactResolver ? { artifactResolver } : {}), idempotencyKey: invocationId };
        const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject; });
        void cancellation.catch(() => undefined);
        if (cancellationRequested) requestCancellation();
        let result: TeamBindingResult;
        try {
          if (cancellationRequested) throw cancellationError();
          result = await this.withTimeout(binding.invoke(call), Math.min(attemptTimeoutMs, left), () => binding.cancel ? binding.cancel(call) : Promise.resolve(undefined), cancellation);
        } catch (error) {
          const finishedAt = this.args.clock.now();
          const actualClass = error instanceof TeamBindingError ? error.failureClass : "transport";
          const diagnosticCode = error instanceof TeamBindingError ? error.diagnosticCode : undefined;
          const elapsed = Math.max(0, finishedAt - attemptStartedAt);
          const current = (await this.args.store.load(runId))!;
          const budgetExceeded = current.activeExecutionMs + elapsed > current.activeExecutionBudgetMs;
          await this.update(runId, (record) => {
            record.activeExecutionMs += elapsed;
            event(record, `${invocationId}:attempt:${attempt}:failed`, "binding.attempt.failed", finishedAt, {
              failureClass: actualClass,
              ...(diagnosticCode ? { diagnosticCode } : {}),
              budgetExceeded
            });
          });
          if (budgetExceeded) return this.fail(runId, invocationId, "ACTIVE_EXECUTION_BUDGET_EXCEEDED");
          const timedOut = error instanceof TeamBindingError && error.failureClass === "timeout";
          const failureIntentWon = (await this.args.store.load(runId))?.terminalIntent === "failed";
          const canRetry = !failureIntentWon && attempt < Number(retry.maxAttempts) && retryable(retry, error)
            && !(error instanceof TeamBindingError && (error.outcomeUnknown || error.failureClass === "cancelled"));
          if (canRetry) {
            const delay = retryDelayMs(retry.backoff as Record<string, unknown>, attempt - 1);
            if (this.args.clock.now() + delay < deadlineAt) {
              await this.args.clock.sleep(delay);
              continue;
            }
          }
          if (this.args.clock.now() >= deadlineAt || timedOut) return this.fail(runId, invocationId, this.args.clock.now() >= deadlineAt ? "HANDOFF_DEADLINE_EXCEEDED" : "BINDING_ATTEMPT_TIMEOUT", error instanceof TeamBindingError && error.outcomeUnknown);
          return this.fail(runId, invocationId, `BINDING_${actualClass.toUpperCase()}`, error instanceof TeamBindingError && error.outcomeUnknown, diagnosticCode);
        }
        const finishedAt = this.args.clock.now();
        const afterBinding = await this.args.store.load(runId);
        if (afterBinding?.terminalIntent === "failed" || afterBinding?.status === "failing") {
          return this.update(runId, (record) => {
            const state = record.invocations[invocationId];
            if (state.status !== "running") return;
            state.status = "failed";
            state.error = "SIBLING_FAILURE_CANCELLED";
            event(record, `${invocationId}:late-completion-ignored`, "invocation.late_completion_ignored", finishedAt, { reason: "sibling_failure" });
          });
        }
        if (result.kind === "input-required") {
          return this.update(runId, (record) => {
            if (record.terminalIntent === "failed" || record.status === "failing") return;
            record.status = "paused_input_required";
            record.pendingInput = { handoffId, agentId, bindingId, ...result };
            record.invocations[invocationId].status = "input-required";
            record.invocations[invocationId].output = result;
            record.activeExecutionMs += Math.max(0, finishedAt - attemptStartedAt);
            event(record, `${invocationId}:input-required`, "run.paused_input_required", finishedAt, { handoffId, remoteTaskId: result.remoteTaskId });
          });
        }
        try {
          assertValidTeamPayload(plan, { kind: "agent-output", agentId, portId: result.output.event }, result.output.data);
        } catch (error) {
          return this.fail(runId, invocationId, "AGENT_OUTPUT_SCHEMA_INVALID");
        }
        const beforeArtifactRegistration = await this.args.store.load(runId);
        if (beforeArtifactRegistration?.terminalIntent === "failed" || beforeArtifactRegistration?.status === "failing") {
          return this.update(runId, (record) => {
            const state = record.invocations[invocationId];
            if (state.status !== "running") return;
            state.status = "failed";
            state.error = "SIBLING_FAILURE_CANCELLED";
            event(record, `${invocationId}:late-completion-ignored`, "invocation.late_completion_ignored", finishedAt, { reason: "sibling_failure" });
          });
        }
        const registeredArtifacts: Record<string, { artifactId: string; mediaType: string }> = {};
        if (result.output.artifacts !== undefined && !isRecord(result.output.artifacts)) return this.fail(runId, invocationId, "ARTIFACT_OUTPUT_INVALID");
        const artifactEntries = isRecord(result.output.artifacts) ? Object.entries(result.output.artifacts) : [];
        if (artifactEntries.length && !this.args.artifactStore) return this.fail(runId, invocationId, "ARTIFACT_STORE_REQUIRED");
        const publicationId = artifactEntries.length ? randomUUID() : undefined;
        let reservation: TeamArtifactPublicationReservation | undefined;
        if (publicationId) {
          reservation = await this.args.artifactStore!.reserveOutputPublication({
            owner: { projectId: existing.projectId, runId }, invocationId, publicationId
          });
          try {
            await this.update(runId, (record) => {
              const state = record.invocations[invocationId];
              if (state.status !== "running") throw new TeamRunConflictError("Cannot reserve Artifacts for a non-active invocation.");
              state.artifactPublication = { id: publicationId, reservation: reservation!, artifacts: {}, status: "reserved" };
            });
          } catch (error) {
            const persisted = (await this.args.store.load(runId))?.invocations[invocationId]?.artifactPublication;
            if (persisted?.id !== publicationId || persisted.status !== "reserved") {
              await this.args.artifactStore!.abortOutputPublication({ reservation });
              throw error;
            }
          }
        }
        const abortPublication = async (): Promise<void> => {
          if (!reservation || !this.args.artifactStore) return;
          try {
            await this.args.artifactStore.abortOutputPublication({ reservation });
            await this.update(runId, (record) => {
              const publication = record.invocations[invocationId]?.artifactPublication;
              if (publication && publication.id === publicationId && publication.status === "reserved") publication.status = "aborted";
            });
          } catch {
            // Recovery reconciles the durable reservation after the invocation is settled.
          }
        };
        if (publicationId && reservation) {
          try {
            for (const [slotId, value] of artifactEntries) {
              if (!isRecord(value) || typeof value.mediaType !== "string" || !(value.content instanceof Uint8Array)) {
                throw new TeamArtifactError("ARTIFACT_OUTPUT_INVALID", "Agent output Artifact is invalid.");
              }
              registeredArtifacts[slotId] = await this.args.artifactStore!.prepareOutput({
                team: plan.team, owner: { projectId: existing.projectId, runId }, agentId,
                outputPortId: result.output.event, slotId, mediaType: value.mediaType, content: value.content,
                publicationId, invocationId, reservation
              });
            }
          } catch (error) {
            await abortPublication();
            if (error instanceof TeamArtifactError) return this.fail(runId, invocationId, error.code);
            throw error;
          }
        }
        const outputSlots = isRecord(agent?.outputPorts) && isRecord(agent.outputPorts[result.output.event])
          && isRecord((agent.outputPorts[result.output.event] as Record<string, unknown>).artifactSlots)
          ? (agent.outputPorts[result.output.event] as Record<string, unknown>).artifactSlots as Record<string, Record<string, unknown>> : {};
        if (Object.entries(outputSlots).some(([slotId, slot]) => slot.required === true && !registeredArtifacts[slotId])) {
          await abortPublication();
          return this.fail(runId, invocationId, "AGENT_OUTPUT_ARTIFACT_REQUIRED");
        }
        const current = (await this.args.store.load(runId))!;
        const elapsed = Math.max(0, finishedAt - attemptStartedAt);
        if (current.activeExecutionMs + elapsed > current.activeExecutionBudgetMs) {
          await abortPublication();
          return this.fail(runId, invocationId, "ACTIVE_EXECUTION_BUDGET_EXCEEDED");
        }
        let completed: TeamRunRecord;
        try {
          completed = await this.update(runId, (record) => {
          const state = record.invocations[invocationId];
          if (record.status === "paused_input_required" || record.status === "cancelling" || record.status === "cancelled"
            || state.status !== "running") {
            event(record, `${invocationId}:late-completion-ignored`, "invocation.late_completion_ignored", finishedAt, {
              runStatus: record.status,
              invocationStatus: state.status
            });
            return;
          }
          state.status = "completed";
          state.output = result.kind === "completed"
            ? { ...result, output: { ...result.output, ...(Object.keys(registeredArtifacts).length ? { artifacts: registeredArtifacts } : {}) } }
            : result;
          if (publicationId && reservation && Object.keys(registeredArtifacts).length) {
            state.artifactPublication = { id: publicationId, reservation, artifacts: registeredArtifacts, status: "pending" };
          }
          record.activeExecutionMs += elapsed;
          event(record, `${invocationId}:completed`, record.status === "failing" ? "invocation.completed_after_failure_intent" : "handoff.completed", finishedAt, { event: result.output.event });
          });
        } catch (error) {
          const persisted = await this.args.store.load(runId);
          const publication = persisted?.invocations[invocationId]?.artifactPublication;
          if (!publicationId || !persisted || persisted.invocations[invocationId]?.status !== "completed" || publication?.id !== publicationId || publication.status !== "pending") {
            await abortPublication();
            throw error;
          }
          completed = persisted;
        }
        const intent = completed.invocations[invocationId]?.artifactPublication;
        if (publicationId && reservation && intent?.id === publicationId && intent.status === "pending") {
          await this.args.artifactStore!.activateOutputPublication({ reservation, references: Object.values(registeredArtifacts) });
        } else if (publicationId) {
          await abortPublication();
        }
        return this.commitInvocationArtifacts(completed, invocationId);
      }
      return this.fail(runId, invocationId, "BINDING_RETRIES_EXHAUSTED");
    } finally {
      if (this.activeCancellationSignals.get(invocationId) === requestCancellation) this.activeCancellationSignals.delete(invocationId);
    }
  }

  private async commitInvocationArtifacts(record: TeamRunRecord, invocationId: string): Promise<TeamRunRecord> {
    const publication = record.invocations[invocationId]?.artifactPublication;
    if (!publication || publication.status === "committed" || publication.status === "aborted") return record;
    if (!this.args.artifactStore) throw new TeamArtifactError("ARTIFACT_STORE_REQUIRED", "Artifact publication recovery requires an ArtifactStore.");
    await this.args.artifactStore.activateOutputPublication({ reservation: publication.reservation, references: Object.values(publication.artifacts) });
    for (const reference of Object.values(publication.artifacts)) {
      await this.args.artifactStore.commitOutput({
        owner: { projectId: record.projectId, runId: record.runId }, reference, publicationId: publication.id
      });
    }
    await this.args.artifactStore.finishOutputPublication({ reservation: publication.reservation });
    return this.update(record.runId, (current) => {
      const state = current.invocations[invocationId];
      if (state.artifactPublication?.id === publication.id) state.artifactPublication.status = "committed";
    });
  }

  private async recoverArtifactPublications(record: TeamRunRecord): Promise<TeamRunRecord> {
    if (!this.args.artifactStore) {
      if (Object.values(record.invocations).some((invocation) => invocation.artifactPublication
        && invocation.artifactPublication.status !== "aborted")) {
        throw new TeamArtifactError("ARTIFACT_STORE_REQUIRED", "Artifact publication recovery requires an ArtifactStore.");
      }
      return record;
    }
    const retainedPublicationIds = Object.values(record.invocations)
      .filter((invocation) => invocation.artifactPublication && invocation.artifactPublication.status !== "aborted"
        && (invocation.artifactPublication.status !== "reserved" || invocation.status === "running"))
      .map((invocation) => invocation.artifactPublication!.id);
    const liveInvocationIds = Object.values(record.invocations)
      .filter((invocation) => invocation.status === "running")
      .map((invocation) => invocation.id);
    const recovered = await this.args.artifactStore.recoverOutputPublications({
      owner: { projectId: record.projectId, runId: record.runId }, retainedPublicationIds, liveInvocationIds
    });
    for (const invocation of Object.values(record.invocations)) {
      const publication = invocation.artifactPublication;
      if (!publication || publication.status === "aborted") continue;
      const backend = recovered.find((item) => item.reservation.publicationId === publication.id);
      if (!backend || backend.reservation.invocationId !== invocation.id) {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Run and Artifact publication checkpoints do not match.");
      }
      if (backend.state === "aborted") {
        if (publication.status === "reserved" && invocation.status !== "running") {
          await this.update(record.runId, (current) => {
            const state = current.invocations[invocation.id]?.artifactPublication;
            if (state && state.id === publication.id && state.status === "reserved") state.status = "aborted";
          });
          continue;
        }
        throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Run intent references an aborted Artifact publication.");
      }
      if (backend.reservation.fencingGeneration !== publication.reservation.fencingGeneration) {
        throw new TeamArtifactError("ARTIFACT_RESERVATION_INVALID", "Run and Artifact publication fencing tokens do not match.");
      }
      if (publication.status === "reserved" && invocation.status !== "running") {
        await this.args.artifactStore.abortOutputPublication({ reservation: publication.reservation });
        await this.update(record.runId, (current) => {
          const state = current.invocations[invocation.id]?.artifactPublication;
          if (state?.id === publication.id && state.status === "reserved") state.status = "aborted";
        });
      }
    }
    let current = (await this.args.store.load(record.runId))!;
    for (const invocation of Object.values(record.invocations)) {
      if (invocation.artifactPublication?.status !== "pending") continue;
      const backend = recovered.find((item) => item.reservation.publicationId === invocation.artifactPublication!.id);
      if (backend?.state === "committed") {
        current = await this.update(record.runId, (latest) => {
          const publication = latest.invocations[invocation.id]?.artifactPublication;
          if (publication && publication.id === invocation.artifactPublication!.id) publication.status = "committed";
        });
      } else {
        current = await this.commitInvocationArtifacts(current, invocation.id);
      }
    }
    return current;
  }

  async executeRun(plan: CompiledTeamPlan, runId: string): Promise<TeamRunRecord> {
    let initial = await this.args.store.load(runId);
    if (!initial) throw new Error(`Unknown Team Run '${runId}'`);
    if (initial.compiledPlanDigest !== plan.compiledPlanDigest) throw new TeamRunConflictError("compiledPlanDigest mismatch");
    initial = await this.recoverArtifactPublications(initial);
    if (terminal.has(initial.status)) return initial;
    if (initial.status === "queued") await this.claim(runId, plan.compiledPlanDigest);
    else if (initial.status === "waiting_human_review") {
      const waitingReviews = initial.waitingReviews ?? (initial.waitingReview ? [initial.waitingReview] : []);
      if (!this.args.reviewRuntime || waitingReviews.length === 0 || !initial.scheduler) throw new TeamRunConflictError("TEAM_REVIEW_RESUME_UNSUPPORTED: review runtime or scheduler checkpoint is unavailable.");
      const reviewResults = await Promise.all(waitingReviews.map(async (waiting) => ({
        waiting,
        review: await this.args.reviewRuntime!.get({ runId, reviewId: waiting.reviewId, lineage: waiting.lineage, loopRound: waiting.loopRound })
      })));
      const pendingReviews = reviewResults.filter(({ review }) => review.status === "pending");
      if (pendingReviews.length > 0) {
        await this.update(runId, (record) => {
          record.waitingReviews = pendingReviews.map(({ waiting }) => waiting);
          record.waitingReview = record.waitingReviews[0];
        });
        return (await this.args.store.load(runId))!;
      }
      const timedOut = reviewResults.find(({ review }) => review.status === "timed_out");
      if (timedOut) return this.failScheduler(runId, `${runId}:review:${timedOut.review.reviewId}`, "REVIEW_TIMEOUT");
      const rejected = reviewResults.find(({ review }) => review.status !== "approved" && !(review.status === "rejected" && isSupportedMakerCheckerLoop(plan)));
      if (rejected) return this.failScheduler(runId, `${runId}:review:${rejected.review.reviewId}`, "REVIEW_REJECTED");
      const definitions = Array.isArray((plan.team.orchestration as Record<string, unknown>).reviews)
        ? (plan.team.orchestration as Record<string, unknown>).reviews as Array<Record<string, unknown>> : [];
      try {
        await this.update(runId, (record) => {
          if (record.status !== "waiting_human_review") throw new TeamRunConflictError(`Cannot resume Run in ${record.status}`);
          record.status = "running";
          record.waitingReview = undefined;
          record.waitingReviews = undefined;
          const contexts = { ...record.scheduler!.reviewContexts };
          for (const { waiting, review } of reviewResults) {
            event(record, `${runId}:review:${review.reviewId}:${waiting.loopRound ?? "run"}:${review.status}`, `run.review.${review.status}`, this.args.clock.now(), {
              reviewId: review.reviewId, loopRound: waiting.loopRound, decision: review.decision
            });
            const definition = definitions.find((item) => item.id === review.reviewId);
            const at = isRecord(definition?.at) ? definition.at : undefined;
            if (at && at.kind === "agentOutput" && typeof at.agentId === "string" && typeof at.outputPort === "string") {
              contexts[`agent:${at.agentId}:${at.outputPort}`] = readTeamReviewContext(review);
            }
          }
          record.scheduler!.reviewContexts = contexts;
        });
      } catch (error) {
        const latest = await this.args.store.load(runId);
        if (latest && terminal.has(latest.status)) return latest;
        throw error;
      }
    }
    else if (initial.status === "running" && !initial.scheduler) throw new TeamRunConflictError("TEAM_RUN_RESUME_UNSUPPORTED: no scheduler checkpoint exists for this active Run.");
    else if (initial.status === "running") {
      const active = Object.values(initial.invocations).filter((invocation) => invocation.status === "running");
      if (active.length) {
        for (const invocation of active) {
          const binding = this.args.bindings[invocation.bindingId];
          if (binding?.cancel) {
            try {
              await binding.cancel({ runId, handoffId: invocation.handoffId, agentId: invocation.agentId, bindingId: invocation.bindingId, attempt: invocation.attempt, input: undefined, idempotencyKey: invocation.id });
            } catch { /* Outcome remains unknown even if cancellation was attempted. */ }
          }
        }
        await this.update(runId, (record) => {
          record.status = "failing";
          record.terminalIntent = "failed";
          for (const invocation of active) {
            const current = record.invocations[invocation.id];
            if (current?.status !== "running") continue;
            current.status = "failed";
            current.error = "BINDING_OUTCOME_UNKNOWN_AFTER_RESTART";
            current.outcomeUnknown = true;
            event(record, `${invocation.id}:restart-outcome-unknown`, "binding.outcome_unknown", this.args.clock.now(), { reason: "scheduler_recovery_found_active_invocation" });
          }
          event(record, `${runId}:failure-intent`, "run.failing", this.args.clock.now(), { code: "BINDING_OUTCOME_UNKNOWN_AFTER_RESTART" });
        });
        const settled = await this.settle(runId);
        return this.recoverArtifactPublications(settled);
      }
    }
    else if (initial.status === "paused_input_required") throw new TeamRunConflictError("TEAM_RUN_INPUT_REQUIRED_NEW_RUN: input-required Runs cannot resume; create a new Run with the revised input.");
    else throw new TeamRunConflictError(`Cannot execute Run in ${initial.status}`);

    const orchestration = plan.team.orchestration as Record<string, unknown>;
    const loops = Array.isArray(orchestration.loops) ? orchestration.loops.filter(isRecord) : [];
    const joinDefinitions = Array.isArray(orchestration.joins) ? orchestration.joins.filter(isRecord) : [];
    const quorumJoins = Array.isArray(orchestration.joins)
      ? orchestration.joins.filter((join) => isRecord(join) && join.mode === "quorum_of") as Record<string, unknown>[]
      : [];
    const loopScopedQuorum = loops.length === 1 && joinDefinitions.length === 1
      && quorumJoins.length === 1 && joinDefinitions[0] === quorumJoins[0]
      && isRecord(quorumJoins[0].scope) && quorumJoins[0].scope.kind === "loop"
      && quorumJoins[0].scope.loopId === loops[0].id;
    if (quorumJoins.length > 0 && loops.length > 0 && !loopScopedQuorum) {
      return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_QUORUM_TOPOLOGY_UNSUPPORTED");
    }
    const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews.filter(isRecord) : [];
    const routes = Array.isArray(orchestration.routes) ? orchestration.routes.filter(isRecord) : [];
    const fanoutRoutes = routes.filter((route) => route.mode === "parallel_fanout");
    const supportsMakerChecker = isSupportedMakerCheckerLoop(plan);
    const supportsReviewOnJoin = isSupportedReviewOnRunAllOfJoin(plan);
    if (reviews.length && (!this.args.reviewRuntime || (loops.length > 0 && !supportsMakerChecker)
      || plan.joinsByTarget.size > 0 && !supportsReviewOnJoin
      || fanoutRoutes.length > 0 && !isSupportedReviewBeforeFanout(plan) && !supportsReviewOnJoin)) {
      return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_REVIEW_TOPOLOGY_UNSUPPORTED");
    }

    if (fanoutRoutes.length > 0 && loops.length === 0 && reviews.length === 0) {
      const fanout = fanoutRoutes.length === 1 ? fanoutRoutes[0] : undefined;
      const targets = fanout && Array.isArray(fanout.handoffIds)
        ? fanout.handoffIds.map((id) => plan.handoffsById.get(String(id)))
        : [];
      const supportedFanout = isRecord(fanout?.from) && (fanout.from.kind === "run" || fanout.from.kind === "agent")
        && targets.length > 1 && targets.every((handoff) => isRecord(handoff?.to) && handoff.to.kind === "agent");
      if (!supportedFanout) {
        return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_FAIL_FAST_TOPOLOGY_UNSUPPORTED");
      }
    }

    if (loops.length > 1 || loops.some((loop) => {
      const members = Array.isArray(loop.members) ? loop.members : [];
      const continueIds = Array.isArray(loop.continueHandoffIds) ? loop.continueHandoffIds : [];
      const entries = Array.isArray(loop.entryHandoffIds) ? loop.entryHandoffIds : [];
      const exits = Array.isArray(loop.exitHandoffIds) ? loop.exitHandoffIds : [];
      const loopJoins = joinDefinitions.filter((join) => isRecord(join.scope) && join.scope.kind === "loop" && join.scope.loopId === loop.id);
      const loopJoin = loopJoins.length === 1 ? loopJoins[0] : undefined;
      const loopJoinSources = Array.isArray(loopJoin?.handoffIds) ? loopJoin.handoffIds.map(String) : [];
      const joinTarget = loopJoin ? `${String(loopJoin.agentId)}:${String(loopJoin.inputPort)}` : undefined;
      const supportedLoopJoin = Boolean(loopJoin && joinDefinitions.length === 1 && (loopJoin.mode === "all_of" || loopJoin.mode === "quorum_of")
        && isRecord(loopJoin.scope) && loopJoin.scope.loopId === loop.id
        && members.includes(String(loopJoin.agentId)) && loopJoinSources.length > 0
        && loopJoinSources.every((id) => {
          const source = plan.handoffsById.get(id);
          return source && isRecord(source.from) && source.from.kind === "agent" && members.includes(String(source.from.agentId))
            && isRecord(source.to) && source.to.kind === "agent" && `${String(source.to.agentId)}:${String(source.to.inputPort)}` === joinTarget;
        })
        && ((plan.team.orchestration as Record<string, unknown>).routes as Record<string, unknown>[])
          .filter((route) => isRecord(route.from) && route.from.kind === "agent" && route.from.agentId === loop.boundaryAgentId && route.mode === "parallel_fanout").length === 1);
      const edges = [...entries, ...continueIds, ...exits].map((id) => plan.handoffsById.get(String(id)));
      return members.length < 1 || continueIds.length !== 1 || entries.length !== 1 || exits.length < 1
        || edges.some((edge) => !edge || (isRecord(edge.to) && edge.to.kind === "agent" && plan.joinsByTarget.has(`${String(edge.to.agentId)}:${String(edge.to.inputPort)}`)))
        || continueIds.some((id) => !plan.handoffsById.has(String(id)))
        || loopJoins.length > 0 && !supportedLoopJoin
        || [...plan.handoffsById.values()].some((edge) => isRecord(edge.to) && edge.to.kind === "agent"
          && members.includes(String(edge.to.agentId)) && plan.joinsByTarget.has(`${String(edge.to.agentId)}:${String(edge.to.inputPort)}`)
          && (!supportedLoopJoin || `${String(edge.to.agentId)}:${String(edge.to.inputPort)}` !== joinTarget))
        || (plan.team.orchestration as Record<string, unknown>).routes instanceof Array
          && ((plan.team.orchestration as Record<string, unknown>).routes as Record<string, unknown>[]).some((route) => isRecord(route.from)
            && route.from.kind === "agent" && members.includes(String(route.from.agentId)) && route.mode === "parallel_fanout"
            && (route.from.agentId !== loop.boundaryAgentId || !Array.isArray(route.handoffIds) || route.handoffIds.some((id) => {
              const handoff = plan.handoffsById.get(String(id));
              return !handoff || !isRecord(handoff.to) || handoff.to.kind !== "agent" || !members.includes(String(handoff.to.agentId));
            })))
        || loops.some((other) => other !== loop && Array.isArray(other.members) && other.members.some((member) => members.includes(member)));
    })) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_LOOP_TOPOLOGY_UNSUPPORTED");

    const joinArtifactMappings = joinDefinitions.some((join) => {
      const baseArtifacts = isRecord(join.baseMapping) && isRecord(join.baseMapping.artifacts) && Object.keys(join.baseMapping.artifacts).length > 0;
      const handoffIds = Array.isArray(join.handoffIds) ? join.handoffIds : [];
      return baseArtifacts || handoffIds.some((id) => {
        const handoff = plan.handoffsById.get(String(id));
        return isRecord(handoff?.map) && isRecord(handoff.map.artifacts) && Object.keys(handoff.map.artifacts).length > 0;
      });
    });
    if (joinArtifactMappings && !this.args.artifactStore) {
      return this.failScheduler(runId, `${runId}:scheduler`, "ARTIFACT_STORE_REQUIRED");
    }

    const loop = loops[0];
    const loopId = loop ? String(loop.id) : undefined;
    const loopJoin = loop && joinDefinitions.length === 1 && isRecord(joinDefinitions[0].scope)
      && joinDefinitions[0].scope.kind === "loop" && joinDefinitions[0].scope.loopId === loopId
      ? joinDefinitions[0] : undefined;
    const loopJoinSourceIds = new Set(Array.isArray(loopJoin?.handoffIds) ? loopJoin.handoffIds.map(String) : []);
    const loopMembers = new Set(loop && Array.isArray(loop.members) ? loop.members.map(String) : []);
    const loopContinues = new Set(loop && Array.isArray(loop.continueHandoffIds) ? loop.continueHandoffIds.map(String) : []);
    const loopExits = new Set(loop && Array.isArray(loop.exitHandoffIds) ? loop.exitHandoffIds.map(String) : []);
    const loopState = loopId ? (initial.loopStates[loopId] ?? { rounds: 0, agentActivations: 0, previousOutputs: {}, currentOutputs: {} }) : undefined;
    if (loopId && !initial.loopStates[loopId]) await this.update(runId, (record) => { record.loopStates[loopId] = structuredClone(loopState!); });

    const runInput = initial.runInput;
    const sources = new Map<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }>();
    const checkpoint = (await this.args.store.load(runId))?.scheduler;
    for (const [key, value] of Object.entries(checkpoint?.sources ?? {})) sources.set(key, structuredClone(value));
    const skippedHandoffs = new Set(checkpoint?.skippedHandoffs ?? []);
    const arrivedHandoffs = new Set(checkpoint?.arrivedHandoffs ?? []);
    const reviewContexts = new Map(Object.entries(checkpoint?.reviewContexts ?? {}));
    const joinRounds = new Map(Object.entries(checkpoint?.joinRounds ?? {}));
    for (const [roundKey, round] of joinRounds) this.armJoinTimeout(runId, roundKey, round);
    let pending = checkpoint ? [...checkpoint.pending] : selectTeamHandoffs(plan, { kind: "run" }, {}, runInput);
    const visited = new Map(Object.entries(checkpoint?.visited ?? {}));
    const quorumJoinSources = new Set(quorumJoins.flatMap((join) => Array.isArray(join.handoffIds) ? join.handoffIds.map(String) : []));
    const quorumTargetInvoked = new Set<string>();
    if (!checkpoint) await this.update(runId, (record) => {
      record.scheduler = { pending: [...pending], sources: {}, skippedHandoffs: [], arrivedHandoffs: [], visited: {}, invocationIds: {}, reviewContexts: {}, joinRounds: {} };
    });
    const startJoinForPredecessor = async (agentId: string): Promise<void> => {
      for (const join of joinDefinitions) {
        if (!isRecord(join.scope)) continue;
        const runScoped = join.scope.kind === "run" && loops.length === 0;
        const loopScoped = loopJoin === join && join.scope.kind === "loop" && join.scope.loopId === loopId;
        if (!runScoped && !loopScoped) continue;
        const sourceIds = Array.isArray(join.handoffIds) ? join.handoffIds.map(String) : [];
        if (!sourceIds.some((id) => {
          const edge = plan.handoffsById.get(id);
          return isRecord(edge?.from) && edge.from.kind === "agent" && edge.from.agentId === agentId;
        })) continue;
        const joinId = String(join.id);
        const currentLoopState = loopScoped ? (await this.args.store.load(runId))?.loopStates[loopId!] : undefined;
        if (loopScoped && !currentLoopState) return;
        const loopRound = loopScoped ? Math.max(1, currentLoopState!.rounds) : undefined;
        const roundKey = loopRound === undefined ? joinId : `${joinId}:${loopRound}`;
        const targetAgent = plan.team.agents.find((agent) => agent.id === join.agentId) as Record<string, unknown> | undefined;
        const targetPorts = isRecord(targetAgent?.inputPorts) ? targetAgent.inputPorts : {};
        const targetPort = isRecord(targetPorts[String(join.inputPort)]) ? targetPorts[String(join.inputPort)] as Record<string, unknown> : {};
        const requiredFields = isRecord(targetPort.dataSchema) && Array.isArray(targetPort.dataSchema.required) ? targetPort.dataSchema.required as string[] : [];
        const targetArtifactSlots = isRecord(targetPort.artifactSlots) ? targetPort.artifactSlots as Record<string, Record<string, unknown>> : {};
        const requiredArtifactSlots = Object.entries(targetArtifactSlots).filter(([, slot]) => slot.required === true).map(([slotId]) => slotId);
        const requiredSourceIds = sourceIds.filter((id) => {
          const edge = plan.handoffsById.get(id)!;
          const map = isRecord(edge.map) ? edge.map : {};
          const data = isRecord(map.data) ? map.data : {};
          const artifacts = isRecord(map.artifacts) ? map.artifacts : {};
          return Object.keys(data).some((field) => requiredFields.includes(field))
            || Object.keys(artifacts).some((slotId) => requiredArtifactSlots.includes(slotId));
        });
        const baseMapping = isRecord(join.baseMapping) ? join.baseMapping : {};
        const loopPrevious = currentLoopState
          ? Object.fromEntries(Object.entries(currentLoopState.previousOutputs).map(([previousAgentId, output]) => [previousAgentId, { output }]))
          : undefined;
        let persistedRound!: TeamJoinRound;
        await this.update(runId, (record) => {
          const rounds = record.scheduler!.joinRounds ?? (record.scheduler!.joinRounds = {});
          let round = rounds[roundKey] ?? createTeamJoinRound({
            joinId, runId, lineage: "run", ...(loopRound === undefined ? {} : { loopRound }), mode: String(join.mode) as "all_of" | "quorum_of",
            handoffIds: sourceIds, threshold: typeof join.threshold === "number" ? join.threshold : undefined,
            timeoutMs: Number(join.timeoutMs), requiredSourceIds, requiredFields, requiredArtifactSlots,
            baseMapping: {
              data: isRecord(baseMapping.data) ? evaluateTeamValueExpr(baseMapping.data, valueContext(runInput, undefined, loopPrevious)) as Record<string, unknown> : {},
              artifacts: isRecord(baseMapping.artifacts) ? evaluateTeamValueExpr(baseMapping.artifacts, valueContext(runInput, undefined, loopPrevious)) as Record<string, unknown> : {}
            }
          });
          round = applyTeamJoinEvent(round, { type: "predecessor_activated", at: this.args.clock.now() });
          rounds[roundKey] = structuredClone(round);
          persistedRound = round;
        });
        joinRounds.set(roundKey, persistedRound);
        this.armJoinTimeout(runId, roundKey, persistedRound);
      }
    };
    const executeEdge = async (handoffId: string, source?: { event: string; data: unknown; artifacts?: Record<string, unknown> }, inputOverride?: unknown, review?: { decision: "approve" | "reject"; feedback?: unknown }, artifactOverride?: Record<string, unknown>): Promise<TeamRunRecord> => {
      const handoff = plan.handoffsById.get(handoffId);
      const target = handoff && isRecord(handoff.to) ? handoff.to : undefined;
      if (!target || target.kind !== "agent" || !loopId || !loopMembers.has(String(target.agentId))) {
        if (target?.kind === "agent") await startJoinForPredecessor(String(target.agentId));
        return this.executeHandoff(plan, runId, handoffId, runInput, source, inputOverride, { review, artifactOverride });
      }
      const current = (await this.args.store.load(runId))!;
      const state = current.loopStates[loopId];
      let invocationId = current.scheduler?.invocationIds[handoffId];
      if (!invocationId) {
        if (state.agentActivations >= Number(loop.maxAgentActivations)) return this.failScheduler(runId, `${runId}:loop:${loopId}`, "LOOP_EXHAUSTED");
        const nextActivation = state.agentActivations + 1;
        invocationId = `${runId}:${handoffId}:loop:${loopId}:activation:${nextActivation}`;
        await this.update(runId, (record) => {
          record.loopStates[loopId].agentActivations = nextActivation;
          record.scheduler!.invocationIds[handoffId] = invocationId!;
          event(record, `${runId}:loop:${loopId}:activation:${nextActivation}`, "loop.agent.activated", this.args.clock.now(), { agentId: target.agentId, handoffId });
        });
      }
      const existingInvocation = current.invocations[invocationId];
      if (existingInvocation?.status === "completed") return current;
      const latest = (await this.args.store.load(runId))!.loopStates[loopId];
      const previous = Object.fromEntries(Object.entries(latest.previousOutputs).map(([agentId, output]) => [agentId, { output }]));
      await startJoinForPredecessor(String(target.agentId));
      return this.executeHandoff(plan, runId, handoffId, runInput, source, inputOverride, {
        invocationId,
        loopPrevious: previous,
        review,
        artifactOverride
      });
    };
    let rounds = 0;
    while (pending.length) {
      if (++rounds > plan.handoffsById.size + Number(loop?.maxAgentActivations ?? 1) + 1) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_SCHEDULER_CYCLE_UNSUPPORTED");
      const nextSources = new Map<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }>();
      const joins: Record<string, unknown>[][] = [];
      const immediate: string[] = [];
      for (const handoffId of pending.sort()) {
        const visits = (visited.get(handoffId) ?? 0) + 1;
        visited.set(handoffId, visits);
        const repeatedLoopEdge = loopId && isRecord(plan.handoffsById.get(handoffId)?.from)
          && isRecord(plan.handoffsById.get(handoffId)?.to)
          && loopMembers.has(String((plan.handoffsById.get(handoffId)!.from as Record<string, unknown>).agentId))
          && loopMembers.has(String((plan.handoffsById.get(handoffId)!.to as Record<string, unknown>).agentId));
        if (visits > 1 && !repeatedLoopEdge) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_SCHEDULER_CYCLE_UNSUPPORTED");
        const handoff = plan.handoffsById.get(handoffId);
        if (!handoff || !isRecord(handoff.to)) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_SCHEDULER_HANDOFF_INVALID");
        if (handoff.to.kind === "result") {
          const source = isRecord(handoff.from) ? sources.get(sourceKey(handoff.from)) : undefined;
          if (!source) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_RESULT_SOURCE_MISSING");
          const map = isRecord(handoff.map) ? handoff.map : {};
          const mapped = map.data === undefined ? {} : evaluateTeamValueExpr(map.data, valueContext(runInput, source));
          try { assertValidTeamPayload(plan, { kind: "run-result" }, mapped); }
          catch { return this.failScheduler(runId, `${runId}:scheduler`, "RUN_RESULT_SCHEMA_INVALID"); }
          const mappedArtifacts: Record<string, { artifactId: string; mediaType: string }> = {};
          const artifactMappings = isRecord(map.artifacts) ? map.artifacts : {};
          if (Object.keys(artifactMappings).length && !this.args.artifactStore) return this.failScheduler(runId, `${runId}:scheduler`, "ARTIFACT_STORE_REQUIRED");
          for (const [slotId, expression] of Object.entries(artifactMappings)) {
            const candidate = evaluateTeamValueExpr(expression, valueContext(runInput, source));
            mappedArtifacts[slotId] = await this.args.artifactStore!.validateReference({
              team: plan.team, owner: { projectId: initial.projectId, runId }, kind: "run-result", slotId, reference: candidate
            });
          }
          const resultSlots = isRecord(plan.team.runResult.artifactSlots) ? plan.team.runResult.artifactSlots as Record<string, Record<string, unknown>> : {};
          if (Object.entries(resultSlots).some(([slotId, slot]) => slot.required === true && !mappedArtifacts[slotId])) {
            return this.failScheduler(runId, `${runId}:scheduler`, "RUN_RESULT_ARTIFACT_REQUIRED");
          }
          const current = await this.args.store.load(runId);
          if (current?.resultWritten || current?.pendingResult) continue;
          await this.update(runId, (record) => {
            if (record.status !== "running" || record.terminalIntent !== undefined) {
              throw new TeamRunConflictError(`Cannot write Run Result in ${record.status}`);
            }
            if (record.resultWritten || record.pendingResult) throw new TeamRunConflictError("Run result already selected");
            record.pendingResult = {
              value: Object.keys(mappedArtifacts).length ? { data: mapped, artifacts: mappedArtifacts } : mapped,
              handoffId
            };
          });
          continue;
        }
        if (handoff.to.kind !== "agent") return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_SCHEDULER_ENDPOINT_UNSUPPORTED");
        if (loopJoin && loopJoinSourceIds.has(handoffId) && loopJoin.mode !== "quorum_of") {
          const key = `${String(handoff.to.agentId)}:${String(handoff.to.inputPort)}`;
          const group = joins.find((items) => isRecord(items[0]?.to) && `${String(items[0].to.agentId)}:${String(items[0].to.inputPort)}` === key);
          if (group) group.push(handoff);
          else joins.push([handoff]);
        } else if (loopJoin && loopJoinSourceIds.has(handoffId) && loopJoin.mode === "quorum_of") {
          immediate.push(handoffId);
        } else if (plan.joinsByTarget.has(`${String(handoff.to.agentId)}:${String(handoff.to.inputPort)}`)) {
          const key = `${String(handoff.to.agentId)}:${String(handoff.to.inputPort)}`;
          const group = joins.find((items) => isRecord(items[0]?.to) && `${String(items[0].to.agentId)}:${String(items[0].to.inputPort)}` === key);
          if (group) group.push(handoff);
          else joins.push([handoff]);
        } else immediate.push(handoffId);
      }

      const invocations = await Promise.all(immediate.map(async (handoffId) => {
        const handoff = plan.handoffsById.get(handoffId)!;
        const source = isRecord(handoff.from) ? sources.get(sourceKey(handoff.from)) : undefined;
        let result: TeamRunRecord;
        try {
          let reviewContext = isRecord(handoff.from) ? reviewContexts.get(sourceKey(handoff.from)) : undefined;
          if (loopId && isRecord(handoff.from) && handoff.from.kind === "agent" && loopMembers.has(String(handoff.from.agentId))) {
            const round = (await this.args.store.load(runId))!.loopStates[loopId].rounds;
            reviewContext = reviewContexts.get(`${sourceKey(handoff.from)}:loop:${round}`) ?? reviewContext;
          }
          result = await executeEdge(handoffId, source, undefined, reviewContext);
        } catch (error) {
          const current = await this.args.store.load(runId);
          if (current?.status === "paused_input_required" || (current?.status === "failing" && current.terminalIntent === "failed")) result = current;
          else throw error;
        }
        if (result.status === "paused_input_required") await this.cancelSiblingInvocations(runId, `${runId}:${handoffId}`);
        if (result.status === "failing" && (await this.args.store.load(runId))?.terminalIntent === "failed") {
          await this.cancelActiveInvocationsAfterFailure(runId, `${runId}:${handoffId}`);
        }
        if (quorumJoins.length > 0 && result.status === "running") {
          const completed = latestInvocationForHandoff((await this.args.store.load(runId))!, handoffId);
          if (completed?.status === "completed" && completed.output?.kind === "completed") {
            const output = completed.output.output;
            const source = { kind: "agent", agentId: completed.agentId, outputPort: output.event };
            const selected = selectTeamHandoffs(plan, source, output, runInput);
            for (const quorumJoin of quorumJoins) {
              const quorumJoinId = String(quorumJoin.id);
              const scopedLoopJoin = loopJoin === quorumJoin;
              const currentLoopState = scopedLoopJoin ? (await this.args.store.load(runId))!.loopStates[loopId!] : undefined;
              const loopRound = scopedLoopJoin ? Math.max(1, currentLoopState!.rounds) : undefined;
              const roundKey = loopRound === undefined ? quorumJoinId : `${quorumJoinId}:${loopRound}`;
              const loopPrevious = currentLoopState
                ? Object.fromEntries(Object.entries(currentLoopState.previousOutputs).map(([previousAgentId, previousOutput]) => [previousAgentId, { output: previousOutput }]))
                : undefined;
              const quorumJoinSourceIds = new Set((quorumJoin.handoffIds as string[]).map(String));
              const sourceId = selected.find((id) => quorumJoinSourceIds.has(id));
              if (!sourceId) continue;
              const edge = plan.handoffsById.get(sourceId)!;
              const map = isRecord(edge.map) ? edge.map : {};
              const data = map.data === undefined ? {} : evaluateTeamValueExpr(map.data, valueContext(runInput, output, loopPrevious));
              const targetAgent = plan.team.agents.find((agent) => agent.id === quorumJoin.agentId) as Record<string, unknown>;
              const targetPort = (targetAgent.inputPorts as Record<string, Record<string, unknown>>)[String(quorumJoin.inputPort)];
              const requiredFields = isRecord(targetPort?.dataSchema) && Array.isArray(targetPort.dataSchema.required) ? targetPort.dataSchema.required as string[] : [];
              const targetArtifactSlots = isRecord(targetPort?.artifactSlots) ? targetPort.artifactSlots as Record<string, Record<string, unknown>> : {};
              const requiredArtifactSlots = Object.entries(targetArtifactSlots).filter(([, slot]) => slot.required === true).map(([slotId]) => slotId);
              const requiredSourceIds = (quorumJoin.handoffIds as string[]).filter((id) => {
                const item = plan.handoffsById.get(id)!;
                const fields = isRecord(item.map) && isRecord(item.map.data) ? item.map.data : {};
                const artifacts = isRecord(item.map) && isRecord(item.map.artifacts) ? item.map.artifacts : {};
                return Object.keys(fields).some((field) => requiredFields.includes(field))
                  || Object.keys(artifacts).some((slotId) => requiredArtifactSlots.includes(slotId));
              });
              const baseMapping = isRecord(quorumJoin.baseMapping) ? quorumJoin.baseMapping : {};
              const initialRound = joinRounds.get(roundKey) ?? createTeamJoinRound({
                joinId: quorumJoinId, runId, lineage: "run", ...(loopRound === undefined ? {} : { loopRound }), mode: "quorum_of",
                handoffIds: quorumJoin.handoffIds as string[], threshold: Number(quorumJoin.threshold),
                timeoutMs: Number(quorumJoin.timeoutMs), requiredSourceIds, requiredFields, requiredArtifactSlots,
                baseMapping: {
                  data: isRecord(baseMapping.data) ? evaluateTeamValueExpr(baseMapping.data, valueContext(runInput, undefined, loopPrevious)) as Record<string, unknown> : {},
                  artifacts: isRecord(baseMapping.artifacts) ? evaluateTeamValueExpr(baseMapping.artifacts, valueContext(runInput, undefined, loopPrevious)) as Record<string, unknown> : {}
                }
              });
              const artifactMappings = isRecord(map.artifacts) ? map.artifacts : {};
              const artifacts = Object.fromEntries(Object.entries(artifactMappings).map(([slotId, expression]) => [slotId, evaluateTeamValueExpr(expression, valueContext(runInput, output, loopPrevious))]));
              let round = initialRound;
              await this.update(runId, (record) => {
                const storedRound = record.scheduler!.joinRounds?.[roundKey] ?? initialRound;
                round = applyTeamJoinEvent(storedRound, { type: "arrival", sourceId, contribution: { data: isRecord(data) ? data : {}, artifacts }, at: this.args.clock.now() });
                record.scheduler!.joinRounds = { ...(record.scheduler!.joinRounds ?? {}), [roundKey]: structuredClone(round) };
              });
              joinRounds.set(roundKey, round);
              if (round.status === "collecting") this.armJoinTimeout(runId, roundKey, round);
              else this.disarmJoinTimeout(runId, roundKey);
              if (round.status === "failed") return this.failScheduler(runId, `${runId}:join:${quorumJoinId}`, round.failure?.code ?? "JOIN_FAILED");
              if (round.status === "ready" && round.merged && !quorumTargetInvoked.has(roundKey)) {
                quorumTargetInvoked.add(roundKey);
                const artifactOverride = Object.fromEntries(Object.entries(round.merged.artifacts ?? {}).map(([slotId, envelope]) => [
                  slotId, isRecord(envelope) && Object.prototype.hasOwnProperty.call(envelope, "value") ? envelope.value : envelope
                ]));
                const driven = await executeEdge((quorumJoin.handoffIds as string[])[0], undefined, round.merged.data ?? {}, undefined, artifactOverride);
                if (driven.status !== "running") return driven;
                const targetInvocation = latestInvocationForHandoff((await this.args.store.load(runId))!, (quorumJoin.handoffIds as string[])[0]);
                if (targetInvocation?.status === "completed" && targetInvocation.output?.kind === "completed") {
                  nextSources.set(`agent:${targetInvocation.agentId}:${targetInvocation.output.output.event}`, targetInvocation.output.output);
                }
              }
            }
          }
        }
        return result;
      }));
      const afterInvocations = await this.args.store.load(runId);
      if (afterInvocations?.status === "paused_input_required") {
        this.disarmRunJoinTimeouts(runId);
        return afterInvocations;
      }
      const failed = invocations.find((record) => record.status !== "running");
      if (failed) return failed.status === "failing" ? this.settle(runId) : failed;
      for (const handoffId of immediate) {
        const handoff = plan.handoffsById.get(handoffId)!;
        const invocation = latestInvocationForHandoff((await this.args.store.load(runId))!, handoffId);
        if (invocation?.status !== "completed" || invocation.output?.kind !== "completed") continue;
        arrivedHandoffs.add(handoffId);
        const output = invocation.output.output;
        nextSources.set(`agent:${invocation.agentId}:${output.event}`, output);
      }

      for (const group of joins) {
        const first = group[0];
        const firstTarget = isRecord(first?.to) ? first.to : undefined;
        if (!firstTarget) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_SCHEDULER_HANDOFF_INVALID");
        const join = plan.joinsByTarget.get(`${String(firstTarget.agentId)}:${String(firstTarget.inputPort)}`)!;
        const sourceIds = Array.isArray(join.handoffIds) ? join.handoffIds as string[] : [];
        const scopedLoopJoin = loopJoin && String(join.id) === String(loopJoin.id);
        const currentLoopState = scopedLoopJoin ? (await this.args.store.load(runId))!.loopStates[loopId!] : undefined;
        const loopRound = scopedLoopJoin ? Math.max(1, currentLoopState!.rounds) : undefined;
        const roundKey = scopedLoopJoin ? `${String(join.id)}:${String(loopRound)}` : String(join.id);
        const currentRound = joinRounds.get(roundKey);
        if (sourceIds.some((id) => scopedLoopJoin
          ? !group.some((edge) => String(edge.id) === id) && currentRound?.sourceStates[id] !== "skipped"
          : !arrivedHandoffs.has(id) && !skippedHandoffs.has(id))) {
          continue;
        }
        const targetAgent = plan.team.agents.find((agent) => agent.id === join.agentId) as Record<string, unknown>;
        const targetPort = (targetAgent.inputPorts as Record<string, Record<string, unknown>>)[String(join.inputPort)];
        const requiredFields = isRecord(targetPort?.dataSchema) && Array.isArray(targetPort.dataSchema.required) ? targetPort.dataSchema.required as string[] : [];
        const targetArtifactSlots = isRecord(targetPort?.artifactSlots) ? targetPort.artifactSlots as Record<string, Record<string, unknown>> : {};
        const requiredArtifactSlots = Object.entries(targetArtifactSlots).filter(([, slot]) => slot.required === true).map(([slotId]) => slotId);
        const requiredSourceIds = sourceIds.filter((id) => {
          const item = plan.handoffsById.get(id)!;
          const data = isRecord(item.map) && isRecord(item.map.data) ? item.map.data : {};
          const artifacts = isRecord(item.map) && isRecord(item.map.artifacts) ? item.map.artifacts : {};
          return Object.keys(data).some((field) => requiredFields.includes(field))
            || Object.keys(artifacts).some((slotId) => requiredArtifactSlots.includes(slotId));
        });
        const baseMapping = isRecord(join.baseMapping) ? join.baseMapping : {};
        const loopPrevious = currentLoopState
          ? Object.fromEntries(Object.entries(currentLoopState.previousOutputs).map(([agentId, output]) => [agentId, { output }]))
          : undefined;
        let round = joinRounds.get(roundKey) ?? createTeamJoinRound({
          joinId: String(join.id), runId, lineage: "run", ...(loopRound === undefined ? {} : { loopRound }), mode: String(join.mode) as "all_of" | "quorum_of",
          handoffIds: sourceIds, threshold: typeof join.threshold === "number" ? join.threshold : undefined,
          timeoutMs: Number(join.timeoutMs), requiredSourceIds, requiredFields, requiredArtifactSlots,
          baseMapping: {
            data: isRecord(baseMapping.data) ? evaluateTeamValueExpr(baseMapping.data, valueContext(runInput, undefined, loopPrevious)) as Record<string, unknown> : {},
            artifacts: isRecord(baseMapping.artifacts) ? evaluateTeamValueExpr(baseMapping.artifacts, valueContext(runInput, undefined, loopPrevious)) as Record<string, unknown> : {}
          }
        });
        const at = this.args.clock.now();
        round = applyTeamJoinEvent(round, { type: "predecessor_activated", at });
        for (const id of sourceIds) {
          const edge = plan.handoffsById.get(id)!;
          if (scopedLoopJoin && !group.some((item) => String(item.id) === id)) {
            if (round.sourceStates[id] !== "skipped") {
              round = applyTeamJoinEvent(round, { type: "skip", sourceId: id, at: this.args.clock.now() });
            }
            continue;
          }
          const source = scopedLoopJoin
            ? isRecord(edge.from) ? sources.get(sourceKey(edge.from)) : undefined
            : arrivedHandoffs.has(id) && isRecord(edge.from) ? sources.get(sourceKey(edge.from)) : undefined;
          if (!source) {
            round = applyTeamJoinEvent(round, { type: "skip", sourceId: id, at: this.args.clock.now() });
            continue;
          }
          const map = isRecord(edge.map) ? edge.map : {};
          const data = map.data === undefined ? {} : evaluateTeamValueExpr(map.data, valueContext(runInput, source));
          const artifactMappings = isRecord(map.artifacts) ? map.artifacts : {};
          const artifacts = Object.fromEntries(Object.entries(artifactMappings).map(([slotId, expression]) => [slotId, evaluateTeamValueExpr(expression, valueContext(runInput, source))]));
          round = applyTeamJoinEvent(round, { type: "arrival", sourceId: id, contribution: { data: isRecord(data) ? data : {}, artifacts }, at: this.args.clock.now() });
        }
        joinRounds.set(roundKey, round);
        await this.update(runId, (record) => {
          record.scheduler!.joinRounds = { ...(record.scheduler!.joinRounds ?? {}), [roundKey]: structuredClone(round) };
        });
        if (round.status === "collecting") this.armJoinTimeout(runId, roundKey, round);
        else this.disarmJoinTimeout(runId, roundKey);
        if (round.status === "failed") return this.failScheduler(runId, `${runId}:join:${String(join.id)}`, round.failure?.code ?? "JOIN_FAILED");
        if (round.status !== "ready" || !round.merged) return this.failScheduler(runId, `${runId}:join:${String(join.id)}`, "JOIN_NOT_READY");
        const drivingHandoff = sourceIds[0];
        const artifactOverride = Object.fromEntries(Object.entries(round.merged.artifacts ?? {}).map(([slotId, envelope]) => [
          slotId, isRecord(envelope) && Object.prototype.hasOwnProperty.call(envelope, "value") ? envelope.value : envelope
        ]));
        const targetRecord = await executeEdge(drivingHandoff, undefined, round.merged.data ?? {}, undefined, artifactOverride);
        if (targetRecord.status !== "running") return targetRecord.status === "failing" ? this.settle(runId) : targetRecord;
        const invocation = latestInvocationForHandoff((await this.args.store.load(runId))!, drivingHandoff);
        if (invocation?.status === "completed") arrivedHandoffs.add(drivingHandoff);
        if (invocation?.status === "completed" && invocation.output?.kind === "completed") {
          nextSources.set(`agent:${invocation.agentId}:${invocation.output.output.event}`, invocation.output.output);
        }
      }

      const parallelRunReviewGate = reviews.length > 1 && fanoutRoutes.length === 1
        && isRecord(fanoutRoutes[0].from) && fanoutRoutes[0].from.kind === "run";
      if (parallelRunReviewGate) {
        const activatedReviews = [...nextSources].flatMap(([source, output]) => {
          const [, agentId] = source.split(":", 3);
          const definition = reviews.find((item) => isRecord(item.at) && item.at.agentId === agentId && item.at.outputPort === output.event);
          return definition ? [{ source, output, definition, reviewId: String(definition.id) }] : [];
        });
        const reviewResults = await Promise.all(activatedReviews.map(async (activation) => ({
          ...activation,
          review: await this.args.reviewRuntime!.openFromPlan({ plan, runId, reviewId: activation.reviewId, lineage: "run" })
        })));
        const pendingReviews = reviewResults.filter(({ review }) => review.status === "pending");
        const rejectedReview = reviewResults.find(({ review }) => review.status === "rejected" || review.status === "timed_out");
        if (rejectedReview) {
          return this.failScheduler(runId, `${runId}:review:${rejectedReview.review.reviewId}`,
            rejectedReview.review.status === "timed_out" ? "REVIEW_TIMEOUT" : "REVIEW_REJECTED");
        }
        for (const { source, review } of reviewResults) {
          if (review.status === "approved") reviewContexts.set(source, readTeamReviewContext(review));
        }
        if (pendingReviews.length > 0) {
          const waitingReviews = pendingReviews.map(({ review }) => ({ reviewId: review.reviewId, lineage: "run" }));
          await this.update(runId, (record) => {
            record.status = "waiting_human_review";
            record.waitingReviews = waitingReviews;
            record.waitingReview = waitingReviews.find(({ reviewId }) => pendingReviews.some((item) => item.review.reviewId === reviewId));
            record.scheduler!.reviewContexts = Object.fromEntries(reviewContexts);
            for (const { review } of pendingReviews) {
              event(record, `${runId}:review:${review.reviewId}:run:waiting`, "run.waiting_human_review", this.args.clock.now(), {
                reviewId: review.reviewId, deadlineAt: review.deadlineAt
              });
            }
          });
          this.disarmRunJoinTimeouts(runId);
          return (await this.args.store.load(runId))!;
        }
      }

      const outgoing: string[] = [];
      const loopOutputs: Array<[string, { event: string; data: unknown; artifacts?: Record<string, unknown> }]> = [];
      let projectedRounds = loopId ? (await this.args.store.load(runId))!.loopStates[loopId].rounds : 0;
      for (const [source, output] of nextSources) {
        const [, agentId] = source.split(":", 3);
        const reviewDefinition = reviews.find((item) => isRecord(item.at) && item.at.agentId === agentId && item.at.outputPort === output.event);
        const currentLoopState = loopId ? (await this.args.store.load(runId))!.loopStates[loopId] : undefined;
        const reviewLoopRound = reviewDefinition && supportsMakerChecker && currentLoopState && agentId === String(loop?.boundaryAgentId)
          ? currentLoopState.rounds + 1 : undefined;
        const reviewContextKey = reviewLoopRound === undefined ? source : `${source}:loop:${reviewLoopRound}`;
        let reviewContext = reviewContexts.get(reviewContextKey);
        if (reviewDefinition) {
          const reviewId = String(reviewDefinition.id);
          const review = await this.args.reviewRuntime!.openFromPlan({ plan, runId, reviewId, lineage: "run", loopRound: reviewLoopRound });
          if (review.status === "pending") {
            await this.update(runId, (record) => {
              record.status = "waiting_human_review";
              record.waitingReview = { reviewId, lineage: "run", ...(reviewLoopRound === undefined ? {} : { loopRound: reviewLoopRound }) };
              event(record, `${runId}:review:${reviewId}:${reviewLoopRound ?? "run"}:waiting`, "run.waiting_human_review", this.args.clock.now(), { reviewId, loopRound: reviewLoopRound, deadlineAt: review.deadlineAt });
            });
            this.disarmRunJoinTimeouts(runId);
            return (await this.args.store.load(runId))!;
          }
          if (review.status === "timed_out") return this.failScheduler(runId, `${runId}:review:${reviewId}`, "REVIEW_TIMEOUT");
          if (review.status !== "approved" && !(review.status === "rejected" && supportsMakerChecker)) {
            return this.failScheduler(runId, `${runId}:review:${reviewId}`, "REVIEW_REJECTED");
          }
          await this.update(runId, (record) => {
            event(record, `${runId}:review:${reviewId}:${reviewLoopRound ?? "run"}:${review.status}`, `run.review.${review.status}`, this.args.clock.now(), {
              reviewId, loopRound: reviewLoopRound, decision: review.decision
            });
          });
          reviewContext = readTeamReviewContext(review);
          reviewContexts.set(reviewContextKey, reviewContext);
        }
        if (loopId && loopMembers.has(agentId)) {
          loopOutputs.push([agentId, structuredClone(output)]);
          if (agentId === String(loop.boundaryAgentId)) projectedRounds += 1;
        }
        const selected = selectTeamHandoffs(plan, { kind: "agent", agentId, outputPort: output.event }, output, runInput, undefined, reviewContext);
        const selectedSet = new Set(selected);
        for (const handoffId of selected) {
          arrivedHandoffs.add(handoffId);
          skippedHandoffs.delete(handoffId);
        }
        for (const [handoffId, handoff] of plan.handoffsById) {
          if (isRecord(handoff.from) && handoff.from.kind === "agent"
            && handoff.from.agentId === agentId && handoff.from.outputPort === output.event
            && !selectedSet.has(handoffId)) {
            skippedHandoffs.add(handoffId);
            arrivedHandoffs.delete(handoffId);
            if (loopJoin && loopJoinSourceIds.has(handoffId)) {
              const currentLoopState = (await this.args.store.load(runId))!.loopStates[loopId!];
              const loopRound = Math.max(1, currentLoopState.rounds);
              const joinId = String(loopJoin.id);
              const roundKey = `${joinId}:${loopRound}`;
              let round = joinRounds.get(roundKey);
              if (!round) return this.failScheduler(runId, `${runId}:join:${joinId}`, "JOIN_ROUND_MISSING");
              round = applyTeamJoinEvent(round, { type: "skip", sourceId: handoffId, at: this.args.clock.now() });
              joinRounds.set(roundKey, round);
              await this.update(runId, (record) => {
                record.scheduler!.joinRounds = { ...(record.scheduler!.joinRounds ?? {}), [roundKey]: structuredClone(round!) };
              });
              if (round.status === "collecting") this.armJoinTimeout(runId, roundKey, round);
              else this.disarmJoinTimeout(runId, roundKey);
              if (round.status === "failed") return this.failScheduler(runId, `${runId}:join:${joinId}`, round.failure?.code ?? "JOIN_FAILED");
            }
            for (const quorumJoin of quorumJoins.filter((join) => (join.handoffIds as string[]).includes(handoffId))) {
              if (loopJoin === quorumJoin) continue;
              const quorumJoinId = String(quorumJoin.id);
              const initialRound = joinRounds.get(quorumJoinId) ?? createTeamJoinRound({
                joinId: quorumJoinId, runId, lineage: "run", mode: "quorum_of",
                handoffIds: quorumJoin.handoffIds as string[], threshold: Number(quorumJoin.threshold),
                timeoutMs: Number(quorumJoin.timeoutMs)
              });
              let round = initialRound;
              await this.update(runId, (record) => {
                const storedRound = record.scheduler!.joinRounds?.[quorumJoinId] ?? initialRound;
                round = applyTeamJoinEvent(storedRound, { type: "skip", sourceId: handoffId, at: this.args.clock.now() });
                record.scheduler!.joinRounds = { ...(record.scheduler!.joinRounds ?? {}), [quorumJoinId]: structuredClone(round!) };
              });
              joinRounds.set(quorumJoinId, round);
              if (round.status === "collecting") this.armJoinTimeout(runId, quorumJoinId, round);
              else this.disarmJoinTimeout(runId, quorumJoinId);
              if (round.status === "failed") return this.failScheduler(runId, `${runId}:join:${quorumJoinId}`, round.failure?.code ?? "JOIN_FAILED");
            }
          }
        }
        if (loopId && loopMembers.has(agentId)) {
          const continueSelected = selected.filter((id) => loopContinues.has(id));
          const state = (await this.args.store.load(runId))!.loopStates[loopId];
          if (continueSelected.length && projectedRounds >= Number(loop.maxRounds)) {
            if (loop.onExhausted !== "finish") return this.failScheduler(runId, `${runId}:loop:${loopId}`, "LOOP_EXHAUSTED");
            const exits = selectTeamHandoffs(plan, { kind: "agent", agentId, outputPort: output.event }, output, runInput, [...loopExits]);
            if (!exits.length) return this.failScheduler(runId, `${runId}:loop:${loopId}`, "LOOP_EXHAUSTED");
            outgoing.push(...exits);
            continue;
          }
          if (state.agentActivations >= Number(loop.maxAgentActivations) && continueSelected.length) {
            if (loop.onExhausted !== "finish") return this.failScheduler(runId, `${runId}:loop:${loopId}`, "LOOP_EXHAUSTED");
            const exits = selectTeamHandoffs(plan, { kind: "agent", agentId, outputPort: output.event }, output, runInput, [...loopExits]);
            if (!exits.length) return this.failScheduler(runId, `${runId}:loop:${loopId}`, "LOOP_EXHAUSTED");
            outgoing.push(...exits);
            continue;
          }
        }
        if (quorumJoins.length > 0) outgoing.push(...selected.filter((id) => !quorumJoinSources.has(id)));
        else outgoing.push(...selected);
      }
      pending = [...new Set(outgoing)];
      for (const [key, value] of nextSources) sources.set(key, value);
      await this.update(runId, (record) => {
        const state = loopId ? record.loopStates[loopId] : undefined;
        for (const [agentId, output] of loopOutputs) {
          if (!state) break;
          state.currentOutputs[agentId] = structuredClone(output);
          if (agentId === String(loop?.boundaryAgentId)) {
            state.rounds += 1;
            state.previousOutputs = structuredClone(state.currentOutputs);
            state.currentOutputs = {};
            event(record, `${runId}:loop:${loopId}:round:${state.rounds}`, "loop.round.completed", this.args.clock.now(), { boundaryAgentId: agentId });
          }
        }
        record.scheduler = {
          pending: [...pending],
          sources: Object.fromEntries([...sources].map(([key, value]) => [key, structuredClone(value)])),
          skippedHandoffs: [...skippedHandoffs].sort(),
          arrivedHandoffs: [...arrivedHandoffs].sort(),
          visited: Object.fromEntries(visited),
          invocationIds: {},
          reviewContexts: Object.fromEntries(reviewContexts),
          joinRounds: Object.fromEntries([...joinRounds].map(([id, round]) => [id, structuredClone(round)]))
        };
      });
    }

    const complete = await this.args.store.load(runId);
    if (!complete) throw new Error(`Unknown Team Run '${runId}'`);
    if (loops.length === 0) {
      for (const join of joinDefinitions) {
        if (!isRecord(join.scope) || join.scope.kind !== "run") continue;
        const joinId = String(join.id);
        const sourceIds = Array.isArray(join.handoffIds) ? join.handoffIds.map(String) : [];
        if (sourceIds.length === 0 || !sourceIds.every((id) => skippedHandoffs.has(id))) continue;
        const targetAgent = plan.team.agents.find((agent) => agent.id === join.agentId) as Record<string, unknown> | undefined;
        const targetPorts = isRecord(targetAgent?.inputPorts) ? targetAgent.inputPorts : {};
        const targetPort = isRecord(targetPorts[String(join.inputPort)]) ? targetPorts[String(join.inputPort)] as Record<string, unknown> : {};
        const requiredFields = isRecord(targetPort.dataSchema) && Array.isArray(targetPort.dataSchema.required) ? targetPort.dataSchema.required as string[] : [];
        const targetArtifactSlots = isRecord(targetPort.artifactSlots) ? targetPort.artifactSlots as Record<string, Record<string, unknown>> : {};
        const requiredArtifactSlots = Object.entries(targetArtifactSlots).filter(([, slot]) => slot.required === true).map(([slotId]) => slotId);
        const requiredSourceIds = sourceIds.filter((id) => {
          const edge = plan.handoffsById.get(id)!;
          const map = isRecord(edge.map) ? edge.map : {};
          const data = isRecord(map.data) ? map.data : {};
          const artifacts = isRecord(map.artifacts) ? map.artifacts : {};
          return Object.keys(data).some((field) => requiredFields.includes(field))
            || Object.keys(artifacts).some((slotId) => requiredArtifactSlots.includes(slotId));
        });
        const baseMapping = isRecord(join.baseMapping) ? join.baseMapping : {};
        let round = joinRounds.get(joinId) ?? createTeamJoinRound({
          joinId, runId, lineage: "run", mode: String(join.mode) as "all_of" | "quorum_of",
          handoffIds: sourceIds, threshold: typeof join.threshold === "number" ? join.threshold : undefined,
          timeoutMs: Number(join.timeoutMs), requiredSourceIds, requiredFields, requiredArtifactSlots,
          baseMapping: {
            data: isRecord(baseMapping.data) ? evaluateTeamValueExpr(baseMapping.data, valueContext(runInput)) as Record<string, unknown> : {},
            artifacts: isRecord(baseMapping.artifacts) ? evaluateTeamValueExpr(baseMapping.artifacts, valueContext(runInput)) as Record<string, unknown> : {}
          }
        });
        const at = this.args.clock.now();
        round = applyTeamJoinEvent(round, { type: "predecessor_activated", at });
        for (const id of sourceIds) {
          if (round.sourceStates[id] === "pending") round = applyTeamJoinEvent(round, { type: "skip", sourceId: id, at: this.args.clock.now() });
        }
        joinRounds.set(joinId, round);
        await this.update(runId, (record) => {
          record.scheduler!.joinRounds = { ...(record.scheduler!.joinRounds ?? {}), [joinId]: structuredClone(round) };
        });
        if (round.status === "failed") return this.failScheduler(runId, `${runId}:join:${joinId}`, round.failure?.code ?? "JOIN_FAILED");
      }
    }
    if (!complete.pendingResult && (plan.team.executionPolicy as Record<string, unknown>).resultMode === "required") {
      return this.failScheduler(runId, `${runId}:scheduler`, "RUN_RESULT_REQUIRED");
    }
    const completed = await this.update(runId, (record) => {
      if (record.status !== "running") throw new TeamRunConflictError(`Cannot complete Run in ${record.status}`);
      if (record.pendingResult) {
        record.result = record.pendingResult.value;
        record.resultWritten = true;
        event(record, `${runId}:result-written`, "run.result.written", this.args.clock.now(), { handoffId: record.pendingResult.handoffId });
        delete record.pendingResult;
      }
      record.status = "completed";
      event(record, `${runId}:settled:completed`, "run.completed", this.args.clock.now());
    });
    this.disarmRunJoinTimeouts(runId);
    return completed;
  }

  private async failScheduler(runId: string, invocationId: string, code: string): Promise<TeamRunRecord> {
    const failed = await this.fail(runId, invocationId, code);
    if (Object.values(failed.invocations).some((invocation) => invocation.status === "running")) return failed;
    return this.settle(runId);
  }

  private async cancelSiblingInvocations(runId: string, pausedInvocationId: string): Promise<void> {
    const snapshot = await this.args.store.load(runId);
    if (!snapshot || snapshot.status !== "paused_input_required") return;
    for (const invocation of Object.values(snapshot.invocations)) {
      if (invocation.id === pausedInvocationId || invocation.status !== "running") continue;
      const binding = this.args.bindings[invocation.bindingId];
      let confirmed = false;
      if (binding?.cancel) {
        try {
          confirmed = await binding.cancel({
            runId,
            handoffId: invocation.handoffId,
            agentId: invocation.agentId,
            bindingId: invocation.bindingId,
            attempt: invocation.attempt,
            input: undefined,
            idempotencyKey: invocation.id
          });
        } catch { confirmed = false; }
      }
      await this.update(runId, (record) => {
        const current = record.invocations[invocation.id];
        if (record.status !== "paused_input_required" || current.status !== "running") return;
        current.status = "cancelled";
        current.outcomeUnknown = !confirmed;
        event(record, `${invocation.id}:input-required-cancelled`, "invocation.cancelled_for_input_required", this.args.clock.now(), {
          outcomeUnknown: !confirmed,
          remoteTaskId: record.pendingInput?.remoteTaskId
        });
      });
    }
  }

  private armJoinTimeout(runId: string, roundKey: string, round: TeamJoinRound): void {
    if (round.status !== "collecting" || round.deadlineAt === undefined) return;
    const waiterKey = `${runId}:${roundKey}`;
    if (this.joinTimeoutWaiters.has(waiterKey)) return;
    const controller = new AbortController();
    this.joinTimeoutWaiters.set(waiterKey, controller);
    const remaining = Math.max(0, round.deadlineAt - this.args.clock.now());
    void this.args.clock.sleep(remaining, controller.signal).then(async () => {
      if (controller.signal.aborted) return;
      let timedOut: TeamJoinRound | undefined;
      await this.update(runId, (record) => {
        const current = record.scheduler?.joinRounds?.[roundKey];
        if (!current) return;
        const next = applyTeamJoinEvent(current, { type: "tick", at: this.args.clock.now() });
        if (next !== current) {
          record.scheduler!.joinRounds![roundKey] = structuredClone(next);
        }
        timedOut = next;
      });
      if (timedOut?.failure?.code !== "JOIN_TIMEOUT") return;
      await this.fail(runId, `${runId}:join:${roundKey}`, "JOIN_TIMEOUT");
      await this.cancelActiveInvocationsAfterFailure(runId, `${runId}:join:${roundKey}`);
      const current = await this.args.store.load(runId);
      if (current?.status === "failing" && !Object.values(current.invocations).some((invocation) => invocation.status === "running")) {
        await this.settle(runId);
      }
    }).catch(() => undefined).finally(() => {
      if (this.joinTimeoutWaiters.get(waiterKey) === controller) this.joinTimeoutWaiters.delete(waiterKey);
    });
  }

  private disarmJoinTimeout(runId: string, roundKey: string): void {
    const waiterKey = `${runId}:${roundKey}`;
    const controller = this.joinTimeoutWaiters.get(waiterKey);
    if (!controller) return;
    this.joinTimeoutWaiters.delete(waiterKey);
    controller.abort();
  }

  private disarmRunJoinTimeouts(runId: string): void {
    const prefix = `${runId}:`;
    for (const waiterKey of this.joinTimeoutWaiters.keys()) {
      if (waiterKey.startsWith(prefix)) this.disarmJoinTimeout(runId, waiterKey.slice(prefix.length));
    }
  }

  private async cancelActiveInvocationsAfterFailure(runId: string, failedInvocationId: string): Promise<void> {
    const existing = this.failureCancellationRuns.get(runId);
    if (existing) return existing;
    const cancellation = this.cancelActiveInvocationsAfterFailureOnce(runId, failedInvocationId);
    this.failureCancellationRuns.set(runId, cancellation);
    try {
      await cancellation;
    } finally {
      if (this.failureCancellationRuns.get(runId) === cancellation) this.failureCancellationRuns.delete(runId);
    }
  }

  private async cancelActiveInvocationsAfterFailureOnce(runId: string, failedInvocationId: string): Promise<void> {
    const snapshot = await this.args.store.load(runId);
    if (!snapshot || snapshot.terminalIntent !== "failed") return;
    for (const invocation of Object.values(snapshot.invocations)) {
      if (invocation.id === failedInvocationId || invocation.status !== "running") continue;
      const cancellationEventPrefix = `${invocation.id}:sibling-failure-cancel:`;
      if (snapshot.events.some((item) => item.id.startsWith(cancellationEventPrefix))) continue;
      const binding = this.args.bindings[invocation.bindingId];
      let confirmed = false;
      if (binding?.cancel) {
        try {
          confirmed = await binding.cancel({
            runId,
            handoffId: invocation.handoffId,
            agentId: invocation.agentId,
            bindingId: invocation.bindingId,
            attempt: invocation.attempt,
            input: undefined,
            idempotencyKey: invocation.id
          });
        } catch { confirmed = false; }
      }
      await this.update(runId, (record) => {
        event(record, `${invocation.id}:sibling-failure-cancel:${confirmed ? "confirmed" : "unconfirmed"}`, confirmed
          ? "invocation.cancelled_after_sibling_failure" : "invocation.cancel_unconfirmed_after_sibling_failure", this.args.clock.now(), { failedInvocationId });
      });
      if (confirmed) this.activeCancellationSignals.get(invocation.id)?.();
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, cancel?: () => Promise<boolean | undefined>, cancellation?: Promise<never>): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = this.args.clock.sleep(timeoutMs, controller.signal).then(() => {
      timedOut = true;
      throw new TeamBindingError("Binding attempt timed out", "timeout");
    });
    try {
      return await Promise.race(cancellation ? [promise, timeout, cancellation] : [promise, timeout]);
    } catch (error) {
      if (timedOut) {
        let confirmed = false;
        try { confirmed = (await cancel?.()) === true; } catch { confirmed = false; }
        if (error instanceof TeamBindingError) error.outcomeUnknown = !confirmed;
      }
      throw error;
    } finally {
      controller.abort();
    }
  }

  private async fail(runId: string, invocationId: string, code: string, outcomeUnknown = false, diagnosticCode?: TeamBindingDiagnosticCode): Promise<TeamRunRecord> {
    const failed = await this.update(runId, (record) => {
      if (record.status === "cancelling" || record.status === "cancelled" || record.status === "paused_input_required") {
        event(record, `${invocationId}:late-failure:${code}`, "invocation.late_failure_ignored", this.args.clock.now(), { code });
        return;
      }
      if (record.terminalIntent !== "failed") {
        record.status = "failing";
        record.terminalIntent = "failed";
        event(record, `${runId}:failure-intent`, "run.failing", this.args.clock.now(), { code });
      }
      const invocation = record.invocations[invocationId];
      if (invocation) {
        invocation.status = "failed";
        invocation.error = code;
        if (diagnosticCode) invocation.diagnosticCode = diagnosticCode;
        invocation.outcomeUnknown = outcomeUnknown;
      }
    });
    if (failed.status === "failing" || terminal.has(failed.status)) this.disarmRunJoinTimeouts(runId);
    return failed;
  }

  async settle(runId: string): Promise<TeamRunRecord> {
    const settled = await this.update(runId, (record) => {
      if (terminal.has(record.status)) return;
      if (Object.values(record.invocations).some((invocation) => invocation.status === "running")) {
        throw new TeamRunConflictError("Cannot settle before active invocations have been closed");
      }
      if (record.status === "failing" && record.terminalIntent === "failed") record.status = "failed";
      else if (record.status === "cancelling" && record.terminalIntent === "cancelled") record.status = "cancelled";
      else throw new TeamRunConflictError(`Run ${record.status} cannot settle`);
      delete record.pendingResult;
      event(record, `${runId}:settled:${record.status}`, `run.${record.status}`, this.args.clock.now());
    });
    this.disarmRunJoinTimeouts(runId);
    return settled;
  }
}
