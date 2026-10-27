import { isDeepStrictEqual } from "node:util";

export type TeamJoinMode = "all_of" | "quorum_of";
export type TeamJoinSourceStatus = "pending" | "arrived" | "skipped";
export type TeamJoinRoundStatus = "collecting" | "ready" | "failed";

export interface TeamJoinArtifactContribution {
  value: unknown;
  mediaType?: string;
}

export interface TeamJoinContribution {
  data?: Record<string, unknown>;
  artifacts?: Record<string, unknown | TeamJoinArtifactContribution>;
}

export interface TeamJoinRoundConfig {
  joinId: string;
  runId: string;
  lineage: string;
  loopRound?: number;
  mode: TeamJoinMode;
  handoffIds: string[];
  threshold?: number;
  timeoutMs: number;
  requiredSourceIds?: string[];
  requiredFields?: string[];
  requiredArtifactSlots?: string[];
  baseMapping?: TeamJoinContribution;
}

export interface TeamJoinRound {
  readonly key: string;
  readonly joinId: string;
  readonly runId: string;
  readonly lineage: string;
  readonly loopRound?: number;
  readonly mode: TeamJoinMode;
  readonly threshold: number;
  readonly timeoutMs: number;
  readonly sourceIds: readonly string[];
  readonly requiredSourceIds: readonly string[];
  readonly requiredFields: readonly string[];
  readonly requiredArtifactSlots: readonly string[];
  readonly baseMapping: TeamJoinContribution;
  readonly startedAt?: number;
  readonly deadlineAt?: number;
  readonly status: TeamJoinRoundStatus;
  readonly sourceStates: Readonly<Record<string, TeamJoinSourceStatus>>;
  readonly contributions: Readonly<Record<string, TeamJoinContribution>>;
  readonly merged?: TeamJoinContribution;
  readonly failure?: { code: string; sourceId?: string; at: number };
  readonly audit: readonly { id: string; type: string; at: number; sourceId?: string }[];
}

export type TeamJoinEvent =
  | { type: "predecessor_activated"; at: number }
  | { type: "arrival"; sourceId: string; contribution: TeamJoinContribution; at: number }
  | { type: "skip"; sourceId: string; at: number }
  | { type: "source_failed"; sourceId: string; at: number; errorCode?: string }
  | { type: "tick"; at: number };

export class TeamJoinError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TeamJoinError";
  }
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function validateConfig(config: TeamJoinRoundConfig): void {
  if (!config.joinId || !config.runId || !config.lineage) throw new TeamJoinError("JOIN_CONFIG_INVALID", "Join identity is incomplete.");
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs <= 0) throw new TeamJoinError("JOIN_CONFIG_INVALID", "Join timeoutMs must be a positive integer.");
  if (!Array.isArray(config.handoffIds) || config.handoffIds.length === 0 || new Set(config.handoffIds).size !== config.handoffIds.length) {
    throw new TeamJoinError("JOIN_CONFIG_INVALID", "Join handoffIds must be a non-empty unique set.");
  }
  if (config.mode === "quorum_of") {
    if (!Number.isInteger(config.threshold) || Number(config.threshold) < 1 || Number(config.threshold) > config.handoffIds.length) {
      throw new TeamJoinError("JOIN_CONFIG_INVALID", "Quorum threshold must be between one and the source count.");
    }
  } else if (config.threshold !== undefined) {
    throw new TeamJoinError("JOIN_CONFIG_INVALID", "all_of does not accept a threshold.");
  }
  if (config.loopRound !== undefined && (!Number.isInteger(config.loopRound) || config.loopRound < 1)) {
    throw new TeamJoinError("JOIN_CONFIG_INVALID", "Loop round must be a positive integer.");
  }
  for (const sourceId of config.requiredSourceIds ?? []) {
    if (!config.handoffIds.includes(sourceId)) throw new TeamJoinError("JOIN_CONFIG_INVALID", `Required source '${sourceId}' is not declared by this Join.`);
  }
}

function joinKey(config: TeamJoinRoundConfig): string {
  return config.loopRound === undefined
    ? `${config.joinId}:${config.runId}:${config.lineage}`
    : `${config.joinId}:${config.runId}:${config.lineage}:${config.loopRound}`;
}

export function createTeamJoinRound(config: TeamJoinRoundConfig): TeamJoinRound {
  validateConfig(config);
  const sourceStates = Object.fromEntries(config.handoffIds.map((id) => [id, "pending" as const]));
  return {
    key: joinKey(config), joinId: config.joinId, runId: config.runId, lineage: config.lineage,
    ...(config.loopRound === undefined ? {} : { loopRound: config.loopRound }),
    mode: config.mode, threshold: config.mode === "all_of" ? config.handoffIds.length : Number(config.threshold),
    timeoutMs: config.timeoutMs, sourceIds: [...config.handoffIds],
    requiredSourceIds: [...new Set(config.requiredSourceIds ?? [])],
    requiredFields: [...new Set(config.requiredFields ?? [])],
    requiredArtifactSlots: [...new Set(config.requiredArtifactSlots ?? [])],
    baseMapping: copy(config.baseMapping ?? {}), status: "collecting", sourceStates, contributions: {}, audit: []
  };
}

function startIfNeeded(round: TeamJoinRound, at: number): TeamJoinRound {
  if (round.startedAt !== undefined) return round;
  return { ...round, startedAt: at, deadlineAt: at + round.timeoutMs };
}

function addAudit(round: TeamJoinRound, id: string, type: string, at: number, sourceId?: string): TeamJoinRound {
  if (round.audit.some((entry) => entry.id === id)) return round;
  return { ...round, audit: [...round.audit, { id, type, at, ...(sourceId === undefined ? {} : { sourceId }) }] };
}

function fail(round: TeamJoinRound, code: string, at: number, sourceId?: string): TeamJoinRound {
  if (round.status === "failed") return round;
  return {
    ...addAudit(round, `${round.key}:failure:${code}`, "join.failed", at, sourceId),
    status: "failed", failure: { code, at, ...(sourceId === undefined ? {} : { sourceId }) }
  };
}

function artifactEnvelope(sourceId: string, value: unknown): { sourceHandoffId: string; value: unknown; mediaType?: string } {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, "value")) {
    const item = value as TeamJoinArtifactContribution;
    return { sourceHandoffId: sourceId, value: copy(item.value), ...(item.mediaType === undefined ? {} : { mediaType: item.mediaType }) };
  }
  return { sourceHandoffId: sourceId, value: copy(value) };
}

function merge(round: TeamJoinRound, sourceIds: string[]): TeamJoinContribution {
  const data: Record<string, unknown> = {};
  const artifacts: Record<string, unknown> = {};
  const baseData = round.baseMapping.data ?? {};
  const baseArtifacts = round.baseMapping.artifacts ?? {};
  for (const [key, value] of Object.entries(baseData)) data[key] = copy(value);
  for (const [slot, value] of Object.entries(baseArtifacts)) artifacts[slot] = artifactEnvelope("join.baseMapping", value);
  for (const sourceId of sourceIds) {
    const contribution = round.contributions[sourceId];
    if (!contribution) continue;
    for (const [key, value] of Object.entries(contribution.data ?? {})) {
      if (Object.prototype.hasOwnProperty.call(data, key)) throw new TeamJoinError("IR_JOIN_FIELD_CONFLICT", `Join field '${key}' has multiple providers.`);
      data[key] = copy(value);
    }
    for (const [slot, value] of Object.entries(contribution.artifacts ?? {})) {
      if (Object.prototype.hasOwnProperty.call(artifacts, slot)) throw new TeamJoinError("IR_JOIN_FIELD_CONFLICT", `Join Artifact slot '${slot}' has multiple providers.`);
      artifacts[slot] = artifactEnvelope(sourceId, value);
    }
  }
  for (const field of round.requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(data, field)) throw new TeamJoinError("JOIN_REQUIRED_FIELD_MISSING", `Required Join field '${field}' is missing.`);
  }
  for (const slot of round.requiredArtifactSlots) {
    if (!Object.prototype.hasOwnProperty.call(artifacts, slot)) throw new TeamJoinError("JOIN_REQUIRED_ARTIFACT_MISSING", `Required Join Artifact slot '${slot}' is missing.`);
  }
  return { data, artifacts };
}

function evaluate(round: TeamJoinRound, at: number): TeamJoinRound {
  if (round.status !== "collecting") return round;
  const states = Object.values(round.sourceStates);
  const arrived = states.filter((state) => state === "arrived").length;
  const pending = states.filter((state) => state === "pending").length;
  if (round.mode === "quorum_of") {
    if (arrived >= round.threshold) {
      if (arrived === 0) return fail(round, "JOIN_NO_ARRIVALS", at);
      const arrivedIds = round.sourceIds.filter((id) => round.sourceStates[id] === "arrived");
      try {
        const merged = merge(round, arrivedIds);
        return { ...addAudit(round, `${round.key}:ready`, "join.ready", at), status: "ready", merged };
      } catch (error) {
        return fail(round, error instanceof TeamJoinError ? error.code : "JOIN_MERGE_FAILED", at);
      }
    }
    if (arrived + pending < round.threshold) return fail(round, "JOIN_QUORUM_UNREACHABLE", at);
    return round;
  }

  if (round.sourceIds.some((id) => round.sourceStates[id] === "skipped" && round.requiredSourceIds.includes(id))) {
    const skipped = round.sourceIds.find((id) => round.sourceStates[id] === "skipped" && round.requiredSourceIds.includes(id))!;
    return fail(round, "JOIN_SOURCE_SKIPPED", at, skipped);
  }
  if (pending > 0) return round;
  if (arrived === 0) return fail(round, "JOIN_NO_ARRIVALS", at);
  const arrivedIds = round.sourceIds.filter((id) => round.sourceStates[id] === "arrived");
  try {
    const merged = merge(round, arrivedIds);
    return { ...addAudit(round, `${round.key}:ready`, "join.ready", at), status: "ready", merged };
  } catch (error) {
    return fail(round, error instanceof TeamJoinError ? error.code : "JOIN_MERGE_FAILED", at);
  }
}

export function applyTeamJoinEvent(snapshot: TeamJoinRound, event: TeamJoinEvent): TeamJoinRound {
  if (!Number.isFinite(event.at) || event.at < 0) throw new TeamJoinError("JOIN_EVENT_INVALID", "Join event timestamp must be a non-negative finite number.");
  if (snapshot.status === "failed") return snapshot;
  if (snapshot.status === "ready") {
    if (event.type === "source_failed") {
      if (!snapshot.sourceIds.includes(event.sourceId)) throw new TeamJoinError("JOIN_SOURCE_UNKNOWN", `Handoff '${event.sourceId}' is not a source of Join '${snapshot.joinId}'.`);
      const code = event.errorCode ?? "JOIN_SOURCE_FAILED";
      return { ...fail(snapshot, code, event.at, event.sourceId), merged: snapshot.merged };
    }
    if (event.type === "arrival" || event.type === "skip") {
      if (!snapshot.sourceIds.includes(event.sourceId)) throw new TeamJoinError("JOIN_SOURCE_UNKNOWN", `Handoff '${event.sourceId}' is not a source of Join '${snapshot.joinId}'.`);
      const current = snapshot.sourceStates[event.sourceId];
      if (event.type === "arrival" && current === "arrived") {
        if (isDeepStrictEqual(snapshot.contributions[event.sourceId], event.contribution)) return snapshot;
        throw new TeamJoinError("JOIN_SOURCE_CONFLICT", `Handoff '${event.sourceId}' submitted conflicting contributions.`);
      }
      if (event.type === "skip" && current === "skipped") return snapshot;
      if (current !== "pending") throw new TeamJoinError("JOIN_SOURCE_CONFLICT", `Handoff '${event.sourceId}' already terminated as ${current}.`);
      const id = `${snapshot.key}:late:${event.sourceId}:${event.type}`;
      const auditOnly = addAudit(snapshot, id, event.type === "arrival" ? "join.source.late_arrival" : "join.source.late_skip", event.at, event.sourceId);
      if (event.type === "arrival") {
        return {
          ...auditOnly,
          sourceStates: { ...snapshot.sourceStates, [event.sourceId]: "arrived" },
          contributions: { ...snapshot.contributions, [event.sourceId]: copy(event.contribution) },
          merged: snapshot.merged
        };
      }
      return { ...auditOnly, sourceStates: { ...snapshot.sourceStates, [event.sourceId]: "skipped" }, merged: snapshot.merged };
    }
    return snapshot;
  }
  let round = snapshot;
  if (event.type === "predecessor_activated" || event.type === "arrival") round = startIfNeeded(round, event.at);
  if (event.type === "predecessor_activated") {
    if (round.deadlineAt !== undefined && event.at >= round.deadlineAt) return applyTeamJoinEvent(round, { type: "tick", at: event.at });
    return round;
  }
  if (event.type === "source_failed" && !round.sourceIds.includes(event.sourceId)) {
    throw new TeamJoinError("JOIN_SOURCE_UNKNOWN", `Handoff '${event.sourceId}' is not a source of Join '${round.joinId}'.`);
  }
  if (event.type === "source_failed") return fail(round, event.errorCode ?? "JOIN_SOURCE_FAILED", event.at, event.sourceId);
  if (event.type === "tick") {
    if (round.deadlineAt !== undefined && event.at >= round.deadlineAt) return fail(round, "JOIN_TIMEOUT", event.at);
    return round;
  }
  if (!round.sourceIds.includes(event.sourceId)) throw new TeamJoinError("JOIN_SOURCE_UNKNOWN", `Handoff '${event.sourceId}' is not a source of Join '${round.joinId}'.`);
  if (round.deadlineAt !== undefined && event.at >= round.deadlineAt) return fail(round, "JOIN_TIMEOUT", event.at);
  const previousStatus = round.sourceStates[event.sourceId];
  if (event.type === "arrival") {
    if (previousStatus === "arrived") {
      if (isDeepStrictEqual(round.contributions[event.sourceId], event.contribution)) return round;
      throw new TeamJoinError("JOIN_SOURCE_CONFLICT", `Handoff '${event.sourceId}' submitted conflicting contributions.`);
    }
    if (previousStatus === "skipped") throw new TeamJoinError("JOIN_SOURCE_CONFLICT", `Skipped Handoff '${event.sourceId}' cannot later arrive.`);
    const states = { ...round.sourceStates, [event.sourceId]: "arrived" as const };
    round = {
      ...round, sourceStates: states,
      contributions: { ...round.contributions, [event.sourceId]: copy(event.contribution) }
    };
    round = addAudit(round, `${round.key}:arrival:${event.sourceId}`, "join.source.arrived", event.at, event.sourceId);
    return evaluate(round, event.at);
  }
  if (previousStatus === "skipped") return round;
  if (previousStatus === "arrived") throw new TeamJoinError("JOIN_SOURCE_CONFLICT", `Arrived Handoff '${event.sourceId}' cannot later be skipped.`);
  const states = { ...round.sourceStates, [event.sourceId]: "skipped" as const };
  round = { ...round, sourceStates: states };
  round = addAudit(round, `${round.key}:skip:${event.sourceId}`, "join.source.skipped", event.at, event.sourceId);
  return evaluate(round, event.at);
}
