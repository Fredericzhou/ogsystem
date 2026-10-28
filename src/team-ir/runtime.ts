import { evaluateTeamCondition, evaluateTeamValueExpr, MISSING_TEAM_VALUE } from "./reference.js";
import type { CompiledTeamPlan } from "./compiler.js";
import { assertValidTeamPayload } from "./payload-validation.js";
import { applyTeamJoinEvent, createTeamJoinRound, type TeamJoinRound } from "./join-runtime.js";
import type { ArtifactStore, TeamArtifactResolver } from "./artifact-store.js";
import { TeamArtifactError } from "./artifact-store.js";
import type { TeamRunStatus } from "./types.js";
import { TeamReviewRuntime, readTeamReviewContext, type TeamReviewRecord } from "./review-runtime.js";

export type TeamFailureClass = "transport" | "timeout" | "rate_limited" | "server_error" | "invalid_input" | "invalid_output" | "cancelled" | "policy";
export type TeamBindingResult =
  | { kind: "completed"; output: { event: string; data: unknown; artifacts?: Record<string, unknown> } }
  | { kind: "input-required"; remoteTaskId: string; messageParts: unknown[]; requestedInputSchema?: unknown };

export class TeamBindingError extends Error {
  outcomeUnknown = false;

  constructor(message: string, readonly failureClass: TeamFailureClass) {
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
  outcomeUnknown?: boolean;
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
  loopStates: Record<string, { rounds: number; agentActivations: number; previousOutputs: Record<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }>; currentOutputs: Record<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }> }>;
  scheduler?: { pending: string[]; sources: Record<string, { event: string; data: unknown; artifacts?: Record<string, unknown> }>; skippedHandoffs: string[]; arrivedHandoffs: string[]; visited: Record<string, number>; invocationIds: Record<string, string>; reviewContexts: Record<string, { decision: "approve" | "reject"; feedback?: unknown }> };
  waitingReview?: { reviewId: string; lineage: string };
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
  constructor(private readonly args: { store: TeamRunStore; clock: TeamClock; bindings: Record<string, TeamBinding>; artifactStore?: ArtifactStore; reviewRuntime?: TeamReviewRuntime }) {}

  async getReview(runId: string, reviewId: string): Promise<TeamReviewRecord> {
    if (!this.args.reviewRuntime) throw new TeamRunConflictError("TEAM_REVIEW_RUNTIME_UNAVAILABLE");
    return this.args.reviewRuntime.get({ runId, reviewId, lineage: "run" });
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
    const record = await this.update(runId, (record) => {
      if (terminal.has(record.status) || record.status === "failing" || record.status === "cancelling") throw new TeamRunConflictError(`Cannot cancel Run in ${record.status}`);
      record.status = "cancelling";
      record.terminalIntent = "cancelled";
      event(record, `${runId}:cancel-intent`, "run.cancelling", this.args.clock.now());
    });
    for (const invocation of Object.values(record.invocations)) {
      if (invocation.status !== "running") continue;
      const binding = this.args.bindings[invocation.bindingId];
      let confirmed = false;
      if (binding?.cancel) {
        try {
          confirmed = await binding.cancel({
            runId, handoffId: invocation.handoffId, agentId: invocation.agentId, bindingId: invocation.bindingId,
            attempt: invocation.attempt, input: undefined, idempotencyKey: invocation.id
          });
        } catch { confirmed = false; }
      }
      await this.update(runId, (next) => {
        const current = next.invocations[invocation.id];
        current.status = "cancelled";
        current.outcomeUnknown = !confirmed;
        event(next, `${invocation.id}:cancelled`, "invocation.cancelled", this.args.clock.now(), { outcomeUnknown: !confirmed });
      });
    }
    return (await this.args.store.load(runId))!;
  }

  async executeHandoff(plan: CompiledTeamPlan, runId: string, handoffId: string, runInput: { task: string; input: unknown; preferences?: unknown; attachments?: Record<string, unknown> }, output?: { event: string; data: unknown; artifacts?: Record<string, unknown> }, inputOverride?: unknown, options: { invocationId?: string; loopPrevious?: Record<string, unknown>; review?: { decision: "approve" | "reject"; feedback?: unknown } } = {}): Promise<TeamRunRecord> {
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
    const artifactMapping = isRecord(mapping.artifacts) ? mapping.artifacts : {};
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
      try {
        const artifactResolver = Object.keys(mappedArtifacts).length
          ? await this.args.artifactStore!.createInvocationResolver({
            owner: { projectId: existing.projectId, runId }, allowedArtifacts: Object.values(mappedArtifacts)
          })
          : undefined;
        const call = { runId, handoffId, agentId, bindingId, attempt, input: mapped, ...(artifactResolver ? { artifactResolver } : {}), idempotencyKey: invocationId };
        const result = await this.withTimeout(binding.invoke(call), Math.min(attemptTimeoutMs, left), () => binding.cancel ? binding.cancel(call) : Promise.resolve(undefined));
        const finishedAt = this.args.clock.now();
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
        const registeredArtifacts: Record<string, { artifactId: string; mediaType: string }> = {};
        if (result.output.artifacts !== undefined) {
          if (!isRecord(result.output.artifacts) || !this.args.artifactStore) return this.fail(runId, invocationId, "ARTIFACT_STORE_REQUIRED");
          for (const [slotId, value] of Object.entries(result.output.artifacts)) {
            if (!isRecord(value) || typeof value.mediaType !== "string" || !(value.content instanceof Uint8Array)) {
              return this.fail(runId, invocationId, "ARTIFACT_OUTPUT_INVALID");
            }
            registeredArtifacts[slotId] = await this.args.artifactStore.registerOutput({
              team: plan.team, owner: { projectId: existing.projectId, runId }, agentId,
              outputPortId: result.output.event, slotId, mediaType: value.mediaType, content: value.content
            });
          }
        }
        const outputSlots = isRecord(agent?.outputPorts) && isRecord(agent.outputPorts[result.output.event])
          && isRecord((agent.outputPorts[result.output.event] as Record<string, unknown>).artifactSlots)
          ? (agent.outputPorts[result.output.event] as Record<string, unknown>).artifactSlots as Record<string, Record<string, unknown>> : {};
        if (Object.entries(outputSlots).some(([slotId, slot]) => slot.required === true && !registeredArtifacts[slotId])) {
          return this.fail(runId, invocationId, "AGENT_OUTPUT_ARTIFACT_REQUIRED");
        }
        const current = (await this.args.store.load(runId))!;
        const elapsed = Math.max(0, finishedAt - attemptStartedAt);
        if (current.activeExecutionMs + elapsed > current.activeExecutionBudgetMs) {
          return this.fail(runId, invocationId, "ACTIVE_EXECUTION_BUDGET_EXCEEDED");
        }
        return this.update(runId, (record) => {
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
          record.activeExecutionMs += elapsed;
          event(record, `${invocationId}:completed`, record.status === "failing" ? "invocation.completed_after_failure_intent" : "handoff.completed", finishedAt, { event: result.output.event });
        });
      } catch (error) {
        const finishedAt = this.args.clock.now();
        const actualClass = error instanceof TeamBindingError ? error.failureClass : "transport";
        const elapsed = Math.max(0, finishedAt - attemptStartedAt);
        const budgetExceeded = (await this.args.store.load(runId))!.activeExecutionMs + elapsed > (await this.args.store.load(runId))!.activeExecutionBudgetMs;
        await this.update(runId, (record) => {
          record.activeExecutionMs += elapsed;
          event(record, `${invocationId}:attempt:${attempt}:failed`, "binding.attempt.failed", finishedAt, { failureClass: actualClass, budgetExceeded });
        });
        if (budgetExceeded) return this.fail(runId, invocationId, "ACTIVE_EXECUTION_BUDGET_EXCEEDED");
        const timedOut = error instanceof TeamBindingError && error.failureClass === "timeout";
        const canRetry = attempt < Number(retry.maxAttempts) && retryable(retry, error) && !(error instanceof TeamBindingError && error.outcomeUnknown);
        if (canRetry) {
          const delay = retryDelayMs(retry.backoff as Record<string, unknown>, attempt - 1);
          if (this.args.clock.now() + delay < deadlineAt) {
            await this.args.clock.sleep(delay);
            continue;
          }
        }
        if (this.args.clock.now() >= deadlineAt || timedOut) return this.fail(runId, invocationId, this.args.clock.now() >= deadlineAt ? "HANDOFF_DEADLINE_EXCEEDED" : "BINDING_ATTEMPT_TIMEOUT", error instanceof TeamBindingError && error.outcomeUnknown);
        return this.fail(runId, invocationId, `BINDING_${actualClass.toUpperCase()}`, error instanceof TeamBindingError && error.outcomeUnknown);
      }
    }
    return this.fail(runId, invocationId, "BINDING_RETRIES_EXHAUSTED");
  }

  async executeRun(plan: CompiledTeamPlan, runId: string): Promise<TeamRunRecord> {
    const initial = await this.args.store.load(runId);
    if (!initial) throw new Error(`Unknown Team Run '${runId}'`);
    if (initial.compiledPlanDigest !== plan.compiledPlanDigest) throw new TeamRunConflictError("compiledPlanDigest mismatch");
    if (initial.status === "completed") return initial;
    if (initial.status === "queued") await this.claim(runId, plan.compiledPlanDigest);
    else if (initial.status === "waiting_human_review") {
      if (!this.args.reviewRuntime || !initial.waitingReview || !initial.scheduler) throw new TeamRunConflictError("TEAM_REVIEW_RESUME_UNSUPPORTED: review runtime or scheduler checkpoint is unavailable.");
      const review = await this.args.reviewRuntime.get({ runId, reviewId: initial.waitingReview.reviewId, lineage: initial.waitingReview.lineage });
      if (review.status === "pending") return initial;
      if (review.status !== "approved") return this.failScheduler(runId, `${runId}:review:${review.reviewId}`, review.status === "timed_out" ? "REVIEW_TIMEOUT" : "REVIEW_REJECTED");
      await this.update(runId, (record) => {
        record.status = "running";
        record.waitingReview = undefined;
        event(record, `${runId}:review:${review.reviewId}:approved`, "run.review.approved", this.args.clock.now(), { reviewId: review.reviewId });
      });
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
        return this.settle(runId);
      }
    }
    else if (initial.status === "paused_input_required") throw new TeamRunConflictError("TEAM_RUN_INPUT_REQUIRED_NEW_RUN: input-required Runs cannot resume; create a new Run with the revised input.");
    else throw new TeamRunConflictError(`Cannot execute Run in ${initial.status}`);

    const orchestration = plan.team.orchestration as Record<string, unknown>;
    const loops = Array.isArray(orchestration.loops) ? orchestration.loops.filter(isRecord) : [];
    const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews.filter(isRecord) : [];
    if (reviews.length && (!this.args.reviewRuntime || loops.length > 0 || plan.joinsByTarget.size > 0
      || reviews.some((review) => {
        const at = isRecord(review.at) ? review.at : {};
        const route = plan.routesBySource.get(`agent:${String(at.agentId)}:${String(at.outputPort)}`);
        return route?.mode === "parallel_fanout";
      }))) {
      return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_REVIEW_TOPOLOGY_UNSUPPORTED");
    }

    if (loops.length > 1 || loops.some((loop) => {
      const members = Array.isArray(loop.members) ? loop.members : [];
      const continueIds = Array.isArray(loop.continueHandoffIds) ? loop.continueHandoffIds : [];
      const entries = Array.isArray(loop.entryHandoffIds) ? loop.entryHandoffIds : [];
      const exits = Array.isArray(loop.exitHandoffIds) ? loop.exitHandoffIds : [];
      const edges = [...entries, ...continueIds, ...exits].map((id) => plan.handoffsById.get(String(id)));
      return members.length < 1 || continueIds.length !== 1 || entries.length !== 1 || exits.length < 1
        || edges.some((edge) => !edge || (isRecord(edge.to) && edge.to.kind === "agent" && plan.joinsByTarget.has(`${String(edge.to.agentId)}:${String(edge.to.inputPort)}`)))
        || continueIds.some((id) => !plan.handoffsById.has(String(id)))
        || plan.team.orchestration && Array.isArray((plan.team.orchestration as Record<string, unknown>).joins)
          && ((plan.team.orchestration as Record<string, unknown>).joins as Record<string, unknown>[]).some((join) => isRecord(join.scope) && join.scope.kind === "loop" && join.scope.loopId === loop.id)
        || [...plan.handoffsById.values()].some((edge) => isRecord(edge.to) && edge.to.kind === "agent"
          && members.includes(String(edge.to.agentId)) && plan.joinsByTarget.has(`${String(edge.to.agentId)}:${String(edge.to.inputPort)}`))
        || (plan.team.orchestration as Record<string, unknown>).routes instanceof Array
          && ((plan.team.orchestration as Record<string, unknown>).routes as Record<string, unknown>[]).some((route) => isRecord(route.from)
            && route.from.kind === "agent" && members.includes(String(route.from.agentId)) && route.mode === "parallel_fanout")
        || loops.some((other) => other !== loop && Array.isArray(other.members) && other.members.some((member) => members.includes(member)));
    })) return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_LOOP_TOPOLOGY_UNSUPPORTED");

    const loop = loops[0];
    const loopId = loop ? String(loop.id) : undefined;
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
    let pending = checkpoint ? [...checkpoint.pending] : selectTeamHandoffs(plan, { kind: "run" }, {}, runInput);
    const visited = new Map(Object.entries(checkpoint?.visited ?? {}));
    if (!checkpoint) await this.update(runId, (record) => {
      record.scheduler = { pending: [...pending], sources: {}, skippedHandoffs: [], arrivedHandoffs: [], visited: {}, invocationIds: {}, reviewContexts: {} };
    });
    const executeEdge = async (handoffId: string, source?: { event: string; data: unknown; artifacts?: Record<string, unknown> }, inputOverride?: unknown, review?: { decision: "approve" | "reject"; feedback?: unknown }): Promise<TeamRunRecord> => {
      const handoff = plan.handoffsById.get(handoffId);
      const target = handoff && isRecord(handoff.to) ? handoff.to : undefined;
      if (!target || target.kind !== "agent" || !loopId || !loopMembers.has(String(target.agentId))) {
        return this.executeHandoff(plan, runId, handoffId, runInput, source, inputOverride, { review });
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
      return this.executeHandoff(plan, runId, handoffId, runInput, source, inputOverride, {
        invocationId,
        loopPrevious: previous,
        review
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
          if (current?.resultWritten) continue;
          await this.update(runId, (record) => {
            if (record.resultWritten) throw new TeamRunConflictError("Run result already written");
            record.result = Object.keys(mappedArtifacts).length ? { data: mapped, artifacts: mappedArtifacts } : mapped;
            record.resultWritten = true;
            event(record, `${runId}:result-written`, "run.result.written", this.args.clock.now(), { handoffId });
          });
          continue;
        }
        if (handoff.to.kind !== "agent") return this.failScheduler(runId, `${runId}:scheduler`, "TEAM_SCHEDULER_ENDPOINT_UNSUPPORTED");
        if (plan.joinsByTarget.has(`${String(handoff.to.agentId)}:${String(handoff.to.inputPort)}`)) {
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
          result = await executeEdge(handoffId, source, undefined, isRecord(handoff.from) ? reviewContexts.get(sourceKey(handoff.from)) : undefined);
        } catch (error) {
          const current = await this.args.store.load(runId);
          if (current?.status !== "paused_input_required") throw error;
          result = current;
        }
        if (result.status === "paused_input_required") await this.cancelSiblingInvocations(runId, `${runId}:${handoffId}`);
        return result;
      }));
      const afterInvocations = await this.args.store.load(runId);
      if (afterInvocations?.status === "paused_input_required") return afterInvocations;
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
        if (sourceIds.some((id) => !arrivedHandoffs.has(id) && !skippedHandoffs.has(id))) {
          continue;
        }
        const targetAgent = plan.team.agents.find((agent) => agent.id === join.agentId) as Record<string, unknown>;
        const targetPort = (targetAgent.inputPorts as Record<string, Record<string, unknown>>)[String(join.inputPort)];
        const requiredFields = isRecord(targetPort?.dataSchema) && Array.isArray(targetPort.dataSchema.required) ? targetPort.dataSchema.required as string[] : [];
        const requiredSourceIds = sourceIds.filter((id) => {
          const item = plan.handoffsById.get(id)!;
          const data = isRecord(item.map) && isRecord(item.map.data) ? item.map.data : {};
          return Object.keys(data).some((field) => requiredFields.includes(field));
        });
        let round = createTeamJoinRound({
          joinId: String(join.id), runId, lineage: "run", mode: String(join.mode) as "all_of" | "quorum_of",
          handoffIds: sourceIds, threshold: typeof join.threshold === "number" ? join.threshold : undefined,
          timeoutMs: Number(join.timeoutMs), requiredSourceIds, requiredFields,
          baseMapping: isRecord(join.baseMapping) ? { data: isRecord(join.baseMapping.data) ? evaluateTeamValueExpr(join.baseMapping.data, valueContext(runInput)) as Record<string, unknown> : {} } : {}
        });
        const at = this.args.clock.now();
        round = applyTeamJoinEvent(round, { type: "predecessor_activated", at });
        for (const id of sourceIds) {
          const edge = plan.handoffsById.get(id)!;
          const source = arrivedHandoffs.has(id) && isRecord(edge.from) ? sources.get(sourceKey(edge.from)) : undefined;
          if (!source) {
            round = applyTeamJoinEvent(round, { type: "skip", sourceId: id, at: this.args.clock.now() });
            continue;
          }
          const map = isRecord(edge.map) ? edge.map : {};
          const data = map.data === undefined ? {} : evaluateTeamValueExpr(map.data, valueContext(runInput, source));
          round = applyTeamJoinEvent(round, { type: "arrival", sourceId: id, contribution: { data: isRecord(data) ? data : {} }, at: this.args.clock.now() });
        }
        if (round.status === "failed") return this.failScheduler(runId, `${runId}:join:${String(join.id)}`, round.failure?.code ?? "JOIN_FAILED");
        if (round.status !== "ready" || !round.merged) return this.failScheduler(runId, `${runId}:join:${String(join.id)}`, "JOIN_NOT_READY");
        const drivingHandoff = sourceIds[0];
        const targetRecord = await executeEdge(drivingHandoff, undefined, round.merged.data ?? {});
        if (targetRecord.status !== "running") return targetRecord.status === "failing" ? this.settle(runId) : targetRecord;
        const invocation = latestInvocationForHandoff((await this.args.store.load(runId))!, drivingHandoff);
        if (invocation?.status === "completed") arrivedHandoffs.add(drivingHandoff);
        if (invocation?.status === "completed" && invocation.output?.kind === "completed") {
          nextSources.set(`agent:${invocation.agentId}:${invocation.output.output.event}`, invocation.output.output);
        }
      }

      const outgoing: string[] = [];
      const loopOutputs: Array<[string, { event: string; data: unknown; artifacts?: Record<string, unknown> }]> = [];
      let projectedRounds = loopId ? (await this.args.store.load(runId))!.loopStates[loopId].rounds : 0;
      for (const [source, output] of nextSources) {
        const [, agentId] = source.split(":", 3);
        const reviewDefinition = reviews.find((item) => isRecord(item.at) && item.at.agentId === agentId && item.at.outputPort === output.event);
        let reviewContext = reviewContexts.get(source);
        if (reviewDefinition) {
          const reviewId = String(reviewDefinition.id);
          const review = await this.args.reviewRuntime!.openFromPlan({ plan, runId, reviewId, lineage: "run" });
          if (review.status === "pending") {
            await this.update(runId, (record) => {
              record.status = "waiting_human_review";
              record.waitingReview = { reviewId, lineage: "run" };
              event(record, `${runId}:review:${reviewId}:waiting`, "run.waiting_human_review", this.args.clock.now(), { reviewId, deadlineAt: review.deadlineAt });
            });
            return (await this.args.store.load(runId))!;
          }
          if (review.status !== "approved") return this.failScheduler(runId, `${runId}:review:${reviewId}`, review.status === "timed_out" ? "REVIEW_TIMEOUT" : "REVIEW_REJECTED");
          reviewContext = readTeamReviewContext(review);
          reviewContexts.set(source, reviewContext);
        }
        if (loopId && loopMembers.has(agentId)) {
          loopOutputs.push([agentId, structuredClone(output)]);
          if (agentId === String(loop.boundaryAgentId)) projectedRounds += 1;
        }
        const selected = selectTeamHandoffs(plan, { kind: "agent", agentId, outputPort: output.event }, output, runInput, undefined, reviewContext);
        const selectedSet = new Set(selected);
        for (const handoffId of selected) arrivedHandoffs.add(handoffId);
        for (const [handoffId, handoff] of plan.handoffsById) {
          if (isRecord(handoff.from) && handoff.from.kind === "agent"
            && handoff.from.agentId === agentId && handoff.from.outputPort === output.event
            && !selectedSet.has(handoffId)) skippedHandoffs.add(handoffId);
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
        outgoing.push(...selected);
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
          reviewContexts: Object.fromEntries(reviewContexts)
        };
      });
    }

    const complete = await this.args.store.load(runId);
    if (!complete) throw new Error(`Unknown Team Run '${runId}'`);
    if (!complete.resultWritten && (plan.team.executionPolicy as Record<string, unknown>).resultMode === "required") {
      return this.failScheduler(runId, `${runId}:scheduler`, "RUN_RESULT_REQUIRED");
    }
    return this.update(runId, (record) => {
      if (record.status !== "running") throw new TeamRunConflictError(`Cannot complete Run in ${record.status}`);
      record.status = "completed";
      event(record, `${runId}:settled:completed`, "run.completed", this.args.clock.now());
    });
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

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, cancel?: () => Promise<boolean | undefined>): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = this.args.clock.sleep(timeoutMs, controller.signal).then(() => {
      timedOut = true;
      throw new TeamBindingError("Binding attempt timed out", "timeout");
    });
    try {
      return await Promise.race([promise, timeout]);
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

  private async fail(runId: string, invocationId: string, code: string, outcomeUnknown = false): Promise<TeamRunRecord> {
    return this.update(runId, (record) => {
      if (record.status === "cancelling" || record.status === "cancelled" || record.status === "paused_input_required") {
        event(record, `${invocationId}:late-failure:${code}`, "invocation.late_failure_ignored", this.args.clock.now(), { code });
        return;
      }
      record.status = "failing";
      record.terminalIntent = "failed";
      const invocation = record.invocations[invocationId];
      if (invocation) { invocation.status = "failed"; invocation.error = code; invocation.outcomeUnknown = outcomeUnknown; }
      event(record, `${runId}:failure-intent`, "run.failing", this.args.clock.now(), { code });
    });
  }

  async settle(runId: string): Promise<TeamRunRecord> {
    return this.update(runId, (record) => {
      if (Object.values(record.invocations).some((invocation) => invocation.status === "running")) {
        throw new TeamRunConflictError("Cannot settle before active invocations have been closed");
      }
      if (record.status === "failing" && record.terminalIntent === "failed") record.status = "failed";
      else if (record.status === "cancelling" && record.terminalIntent === "cancelled") record.status = "cancelled";
      else throw new TeamRunConflictError(`Run ${record.status} cannot settle`);
      event(record, `${runId}:settled:${record.status}`, `run.${record.status}`, this.args.clock.now());
    });
  }
}
