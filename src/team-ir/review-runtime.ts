import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CompiledTeamPlan } from "./compiler.js";
import { assertValidTeamPayload } from "./payload-validation.js";

export type TeamReviewDecision = "approve" | "reject";
export type TeamReviewStatus = "pending" | "approved" | "rejected" | "timed_out" | "cancelled";

export interface TeamReviewAuditEvent {
  id: string;
  type: string;
  at: number;
  reviewerId?: string;
  decision?: TeamReviewDecision;
  idempotencyKey?: string;
}

export interface TeamReviewRecord {
  key: string;
  runId: string;
  reviewId: string;
  lineage: string;
  loopRound?: number;
  revision: number;
  revisionToken: string;
  status: TeamReviewStatus;
  activatedAt: number;
  deadlineAt: number;
  decision?: TeamReviewDecision;
  feedback?: unknown;
  reviewerId?: string;
  idempotencyKey?: string;
  events: TeamReviewAuditEvent[];
}

export interface TeamReviewStore {
  create(record: TeamReviewRecord): Promise<void>;
  load(key: string): Promise<TeamReviewRecord | undefined>;
  compareAndSet(key: string, expectedRevision: number, record: TeamReviewRecord): Promise<boolean>;
}

export class TeamReviewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TeamReviewError";
  }
}

export class MemoryTeamReviewStore implements TeamReviewStore {
  private readonly records = new Map<string, TeamReviewRecord>();

  async create(record: TeamReviewRecord): Promise<void> {
    if (this.records.has(record.key)) throw new TeamReviewError("REVIEW_CONFLICT", "Review activation already exists.");
    this.records.set(record.key, structuredClone(record));
  }

  async load(key: string): Promise<TeamReviewRecord | undefined> {
    const record = this.records.get(key);
    return record ? structuredClone(record) : undefined;
  }

  async compareAndSet(key: string, expectedRevision: number, record: TeamReviewRecord): Promise<boolean> {
    const current = this.records.get(key);
    if (!current || current.revision !== expectedRevision) return false;
    this.records.set(key, structuredClone(record));
    return true;
  }
}

function reviewKey(input: { runId: string; reviewId: string; lineage: string; loopRound?: number }): string {
  return [input.runId, input.reviewId, input.lineage, input.loopRound ?? "run"]
    .map((part) => encodeURIComponent(String(part)))
    .join(":");
}

function event(record: TeamReviewRecord, item: TeamReviewAuditEvent): void {
  if (!record.events.some((existing) => existing.id === item.id)) record.events.push(item);
}

function assertIdentity(value: string, name: string): void {
  if (typeof value !== "string" || !value.trim()) throw new TeamReviewError("REVIEW_REQUEST_INVALID", `${name} must be a non-empty string.`);
}

export class TeamReviewRuntime {
  constructor(private readonly args: {
    store: TeamReviewStore;
    now: () => number;
    makeRevisionToken?: () => string;
    authorizeReviewer: (input: { runId: string; reviewId: string; reviewerId: string }) => boolean | Promise<boolean>;
  }) {
    if (!args.store || typeof args.store.create !== "function" || typeof args.store.load !== "function"
      || typeof args.store.compareAndSet !== "function" || typeof args.now !== "function"
      || typeof args.authorizeReviewer !== "function") {
      throw new TypeError("TeamReviewRuntime requires a store, clock, and reviewer authorization callback.");
    }
  }

  private token(): string {
    const value = (this.args.makeRevisionToken ?? randomUUID)();
    if (typeof value !== "string" || !value) throw new TeamReviewError("REVIEW_TOKEN_INVALID", "Review revision token generator returned an invalid token.");
    return value;
  }

  async open(input: {
    runId: string;
    reviewId: string;
    lineage?: string;
    loopRound?: number;
    activatedAt?: number;
    timeoutMs: number;
  }): Promise<TeamReviewRecord> {
    assertIdentity(input.runId, "runId");
    assertIdentity(input.reviewId, "reviewId");
    const lineage = input.lineage ?? "run";
    assertIdentity(lineage, "lineage");
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new TeamReviewError("REVIEW_CONFIG_INVALID", "Review timeoutMs must be a positive integer.");
    }
    if (input.loopRound !== undefined && (!Number.isInteger(input.loopRound) || input.loopRound < 1)) {
      throw new TeamReviewError("REVIEW_CONFIG_INVALID", "Review loopRound must be a positive integer.");
    }
    const activatedAt = input.activatedAt ?? this.args.now();
    if (!Number.isFinite(activatedAt) || activatedAt < 0 || activatedAt > this.args.now()) {
      throw new TeamReviewError("REVIEW_CONFIG_INVALID", "Review activation time is invalid.");
    }
    const key = reviewKey({ ...input, lineage });
    const existing = await this.args.store.load(key);
    if (existing) return existing.status === "pending" && this.args.now() >= existing.deadlineAt ? this.timeout(existing) : existing;
    const record: TeamReviewRecord = {
      key,
      runId: input.runId,
      reviewId: input.reviewId,
      lineage,
      ...(input.loopRound === undefined ? {} : { loopRound: input.loopRound }),
      revision: 0,
      revisionToken: this.token(),
      status: "pending",
      activatedAt,
      deadlineAt: activatedAt + input.timeoutMs,
      events: [{ id: `${key}:opened`, type: "review.opened", at: activatedAt }]
    };
    try {
      await this.args.store.create(record);
      return structuredClone(record);
    } catch (error) {
      const raced = await this.args.store.load(key);
      if (raced) return raced;
      throw error;
    }
  }

  async openFromPlan(input: {
    plan: CompiledTeamPlan;
    runId: string;
    reviewId: string;
    lineage?: string;
    loopRound?: number;
    activatedAt?: number;
  }): Promise<TeamReviewRecord> {
    const reviews = (input.plan.team.orchestration as Record<string, unknown>).reviews;
    const definition = Array.isArray(reviews)
      ? (reviews as Array<Record<string, unknown>>).find((item) => item.id === input.reviewId)
      : undefined;
    if (!definition || typeof definition.timeoutMs !== "number") {
      throw new TeamReviewError("REVIEW_NOT_FOUND", "Review is not declared by the compiled Team plan.");
    }
    if (definition.onTimeout !== "fail") {
      throw new TeamReviewError("REVIEW_CONFIG_INVALID", "Review timeout behavior must fail closed.");
    }
    return this.open({ ...input, timeoutMs: definition.timeoutMs });
  }

  async get(input: { runId: string; reviewId: string; lineage?: string; loopRound?: number }): Promise<TeamReviewRecord> {
    const key = reviewKey({ ...input, lineage: input.lineage ?? "run" });
    const record = await this.args.store.load(key);
    if (!record) throw new TeamReviewError("REVIEW_NOT_FOUND", "Review activation does not exist.");
    if (record.status === "pending" && this.args.now() >= record.deadlineAt) return this.timeout(record);
    return record;
  }

  async decide(input: {
    runId: string;
    reviewId: string;
    lineage?: string;
    loopRound?: number;
    revisionToken: string;
    idempotencyKey: string;
    reviewerId: string;
    decision: TeamReviewDecision;
    feedback?: unknown;
    plan: CompiledTeamPlan;
  }): Promise<TeamReviewRecord> {
    assertIdentity(input.revisionToken, "revisionToken");
    assertIdentity(input.idempotencyKey, "idempotencyKey");
    assertIdentity(input.reviewerId, "reviewerId");
    if (input.decision !== "approve" && input.decision !== "reject") {
      throw new TeamReviewError("REVIEW_DECISION_INVALID", "Review decision must be approve or reject.");
    }
    const authorized = await this.args.authorizeReviewer({ runId: input.runId, reviewId: input.reviewId, reviewerId: input.reviewerId });
    if (!authorized) throw new TeamReviewError("REVIEW_UNAUTHORIZED", "Reviewer is not authorized to decide this Review.");

    const reviewDefinition = (input.plan.team.orchestration as Record<string, unknown>).reviews;
    const definitions = Array.isArray(reviewDefinition) ? reviewDefinition as Array<Record<string, unknown>> : [];
    const definition = definitions.find((item) => item.id === input.reviewId);
    if (!definition) throw new TeamReviewError("REVIEW_NOT_FOUND", "Review is not declared by the compiled Team plan.");
    const rejectionRequiresFeedback = input.decision === "reject";
    if (rejectionRequiresFeedback && input.feedback === undefined) {
      throw new TeamReviewError("REVIEW_FEEDBACK_REQUIRED", "Reject decisions require feedback.");
    }
    if (input.feedback !== undefined) {
      try {
        assertValidTeamPayload(input.plan, { kind: "review-feedback", reviewId: input.reviewId }, input.feedback);
      } catch (error) {
        throw new TeamReviewError("REVIEW_FEEDBACK_INVALID", error instanceof Error ? error.message : "Review feedback failed Schema validation.");
      }
    }

    const key = reviewKey({ ...input, lineage: input.lineage ?? "run" });
    for (let attempt = 0; attempt < 32; attempt += 1) {
      let current = await this.args.store.load(key);
      if (!current) throw new TeamReviewError("REVIEW_NOT_FOUND", "Review activation does not exist.");
      if (current.idempotencyKey === input.idempotencyKey) {
        if (current.reviewerId === input.reviewerId && current.decision === input.decision
          && isDeepStrictEqual(current.feedback, input.feedback)) return current;
        throw new TeamReviewError("REVIEW_IDEMPOTENCY_CONFLICT", "Review idempotency key was reused with a different decision.");
      }
      if (current.status === "pending" && this.args.now() >= current.deadlineAt) current = await this.timeout(current);
      if (current.status !== "pending") {
        if (current.status === "timed_out") throw new TeamReviewError("REVIEW_TIMEOUT", "Review deadline expired; Run must fail closed.");
        throw new TeamReviewError("REVIEW_CONFLICT", "Review already has a terminal decision.");
      }
      if (current.revisionToken !== input.revisionToken) throw new TeamReviewError("REVIEW_STALE_TOKEN", "Review revision token is stale.");
      const at = this.args.now();
      const next = structuredClone(current);
      next.revision += 1;
      next.revisionToken = this.token();
      next.status = input.decision === "approve" ? "approved" : "rejected";
      next.decision = input.decision;
      next.feedback = input.feedback === undefined ? undefined : structuredClone(input.feedback);
      next.reviewerId = input.reviewerId;
      next.idempotencyKey = input.idempotencyKey;
      event(next, {
        id: `${key}:decision:${input.idempotencyKey}`,
        type: `review.${input.decision}`,
        at,
        reviewerId: input.reviewerId,
        decision: input.decision,
        idempotencyKey: input.idempotencyKey
      });
      if (await this.args.store.compareAndSet(key, current.revision, next)) return next;
    }
    throw new TeamReviewError("REVIEW_CONFLICT", "Review changed concurrently too many times.");
  }

  async cancel(input: { runId: string; reviewId: string; lineage?: string; loopRound?: number }): Promise<TeamReviewRecord> {
    const current = await this.get(input);
    if (current.status !== "pending") return current;
    const next = structuredClone(current);
    next.revision += 1;
    next.revisionToken = this.token();
    next.status = "cancelled";
    const at = this.args.now();
    event(next, { id: `${current.key}:cancelled`, type: "review.cancelled", at });
    if (!(await this.args.store.compareAndSet(current.key, current.revision, next))) {
      return this.get(input);
    }
    return next;
  }

  private async timeout(current: TeamReviewRecord): Promise<TeamReviewRecord> {
    if (current.status !== "pending") return current;
    const next = structuredClone(current);
    next.revision += 1;
    next.revisionToken = this.token();
    next.status = "timed_out";
    event(next, { id: `${current.key}:timeout`, type: "review.timeout", at: current.deadlineAt });
    if (await this.args.store.compareAndSet(current.key, current.revision, next)) return next;
    const raced = await this.args.store.load(current.key);
    if (!raced) throw new TeamReviewError("REVIEW_NOT_FOUND", "Review activation does not exist.");
    return raced;
  }
}

export function readTeamReviewContext(review: TeamReviewRecord): { decision: TeamReviewDecision; feedback?: unknown } {
  if (review.status !== "approved" && review.status !== "rejected") {
    throw new TeamReviewError("REVIEW_NOT_DECIDED", "Review context is available only after a valid decision.");
  }
  return { decision: review.decision!, ...(review.feedback === undefined ? {} : { feedback: structuredClone(review.feedback) }) };
}

export function validateTeamReviewFeedback(plan: CompiledTeamPlan, reviewId: string, feedback: unknown): void {
  assertValidTeamPayload(plan, { kind: "review-feedback", reviewId }, feedback);
}
