import { createHash } from "node:crypto";
import { WORKSPACE_EVENT_TYPES, type WorkspaceEventType } from "./workspace-event-types.js";

export { WORKSPACE_EVENT_TYPES } from "./workspace-event-types.js";
export type { WorkspaceEventType } from "./workspace-event-types.js";

export const WORKSPACE_CONTRACT_VERSION = 2 as const;
export const WORKSPACE_SCHEMA_VERSION = 1 as const;

export type ContractEnvelope = {
  ogsContractVersion: 2;
  schemaVersion: 1;
};

export type WorkspaceRef = ContractEnvelope & {
  workspaceId: string;
  commit: string;
  path: string;
  digest: string;
};

export type WorkspaceCheckpoint = ContractEnvelope & {
  runId: string;
  nodeId: string;
  attempt: number;
  status: string;
  worktreeId: string;
  branch: string;
  baseCommit: string;
  roleCommit?: string;
  mergeCommit?: string;
  releaseCommit?: string;
  changedPaths: string[];
  branchId: string;
  lineageId: string;
  round: number;
  loopIteration: number;
  stateVersion: number;
  decisionBackground: Record<string, unknown>;
  evidenceRefs: string[];
};

export type CanonicalWorkspaceLock = ContractEnvelope & {
  workspaceId: string;
  owner: string;
  leaseUntil: string;
  fencingToken: number;
  expectedCanonicalHead: string;
};

export type ReleaseStatus = "prepared" | "materialized" | "ref_updated" | "published" | "failed";
export type ReleaseFailureCode =
  | "STALE_CANONICAL_HEAD"
  | "CANDIDATE_INVALID"
  | "MATERIALIZATION_FAILED"
  | "OUTPUT_DIGEST_MISMATCH"
  | "RELEASE_STORE_UNAVAILABLE"
  | "RELEASE_RECONCILIATION_FAILED";

export type ReleaseRecord = ContractEnvelope & {
  releaseId: string;
  runId: string;
  workspaceId: string;
  releaseCommit: string;
  expectedCanonicalHead: string;
  materializationManifestRef?: string;
  materializationManifestDigest?: string;
  outputDigest?: string;
  materializationMetadata?: Record<string, unknown>;
  downloadReference?: string;
  failureCode?: ReleaseFailureCode | null;
  status: ReleaseStatus;
  createdAt: string;
  updatedAt: string;
};

export type EvidenceManifest = ContractEnvelope & {
  manifestId: string;
  runId: string;
  eventRefs: string[];
  checkpointRefs: string[];
  provenanceRefs: string[];
  reviewRefs: string[];
  digest: string;
};

export type MaterializationManifestEntry = {
  path: string;
  digest: string;
  sizeBytes: number;
  lfsObjectId?: string;
};

export type MaterializationManifest = ContractEnvelope & {
  manifestId: string;
  releaseId: string;
  releaseCommit: string;
  files: MaterializationManifestEntry[];
  digest: string;
};

export type WorkspaceEventEnvelope = ContractEnvelope & {
  eventId: string;
  eventType: WorkspaceEventType;
  runId: string;
  recordedAt: string;
  payload: Record<string, unknown>;
};

const FULL_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

function fail(code: string, message: string): never {
  throw new Error(`[${code}] ${message}`);
}

function assertEnvelope(value: unknown): asserts value is ContractEnvelope {
  if (!value || typeof value !== "object" || (value as ContractEnvelope).ogsContractVersion !== 2 || (value as ContractEnvelope).schemaVersion !== 1) {
    fail("WORKSPACE_CONTRACT_VERSION_INVALID", "record must carry ogsContractVersion=2 and schemaVersion=1");
  }
}

function assertSafePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || !path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("WORKSPACE_PATH_INVALID", "path must be repository-relative and normalized");
  }
}

export function assertWorkspaceRef(value: unknown): asserts value is WorkspaceRef {
  assertEnvelope(value);
  const ref = value as WorkspaceRef;
  if (typeof ref.workspaceId !== "string" || !ref.workspaceId || !FULL_COMMIT.test(ref.commit)) fail("WORKSPACE_REF_INVALID", "workspaceId and full commit are required");
  assertSafePath(ref.path);
  if (typeof ref.digest !== "string" || !SHA256.test(ref.digest)) fail("WORKSPACE_REF_INVALID", "digest must be sha256:<hex>");
}

export function assertWorkspaceCheckpoint(value: unknown): asserts value is WorkspaceCheckpoint {
  assertEnvelope(value);
  const checkpoint = value as WorkspaceCheckpoint;
  for (const key of ["runId", "nodeId", "worktreeId", "branch", "baseCommit", "branchId", "lineageId"] as const) {
    if (typeof checkpoint[key] !== "string" || !checkpoint[key]) fail("WORKSPACE_CHECKPOINT_INVALID", `${key} is required`);
  }
  if (typeof checkpoint.status !== "string" || !checkpoint.status || !FULL_COMMIT.test(checkpoint.baseCommit)
    || (checkpoint.roleCommit !== undefined && (typeof checkpoint.roleCommit !== "string" || !FULL_COMMIT.test(checkpoint.roleCommit)))
    || (checkpoint.mergeCommit !== undefined && (typeof checkpoint.mergeCommit !== "string" || !FULL_COMMIT.test(checkpoint.mergeCommit)))
    || (checkpoint.releaseCommit !== undefined && (typeof checkpoint.releaseCommit !== "string" || !FULL_COMMIT.test(checkpoint.releaseCommit)))) fail("WORKSPACE_CHECKPOINT_INVALID", "status and commit references must be valid");
  if (!Array.isArray(checkpoint.changedPaths) || checkpoint.changedPaths.some((path) => { assertSafePath(path); return false; })) fail("WORKSPACE_CHECKPOINT_INVALID", "changedPaths must be safe paths");
  if (!Number.isInteger(checkpoint.attempt) || checkpoint.attempt < 1 || !Number.isInteger(checkpoint.round) || checkpoint.round < 1 || !Number.isInteger(checkpoint.loopIteration) || checkpoint.loopIteration < 0 || !Number.isInteger(checkpoint.stateVersion) || checkpoint.stateVersion < 0) fail("WORKSPACE_CHECKPOINT_INVALID", "checkpoint counters are invalid");
  if (!checkpoint.status || !checkpoint.decisionBackground || typeof checkpoint.decisionBackground !== "object" || Array.isArray(checkpoint.decisionBackground) || !Array.isArray(checkpoint.evidenceRefs) || checkpoint.evidenceRefs.some((ref) => typeof ref !== "string")) fail("WORKSPACE_CHECKPOINT_INVALID", "checkpoint context is invalid");
}

export function assertCanonicalWorkspaceLock(value: unknown): asserts value is CanonicalWorkspaceLock {
  assertEnvelope(value);
  const lock = value as CanonicalWorkspaceLock;
  if (typeof lock.workspaceId !== "string" || typeof lock.owner !== "string" || typeof lock.leaseUntil !== "string"
    || !lock.workspaceId || !lock.owner || !lock.leaseUntil || !FULL_COMMIT.test(lock.expectedCanonicalHead)
    || !Number.isInteger(lock.fencingToken) || lock.fencingToken < 1 || Number.isNaN(Date.parse(lock.leaseUntil))) fail("WORKSPACE_LOCK_INVALID", "lock fields are invalid");
}

export function assertRelease(value: unknown): asserts value is ReleaseRecord {
  assertEnvelope(value);
  const release = value as ReleaseRecord;
  if (typeof release.releaseId !== "string" || typeof release.runId !== "string" || typeof release.workspaceId !== "string"
    || typeof release.createdAt !== "string" || typeof release.updatedAt !== "string"
    || !release.releaseId || !release.runId || !release.workspaceId || !release.createdAt || !release.updatedAt
    || !FULL_COMMIT.test(release.releaseCommit) || !FULL_COMMIT.test(release.expectedCanonicalHead)
    || Number.isNaN(Date.parse(release.createdAt)) || Number.isNaN(Date.parse(release.updatedAt))) fail("RELEASE_INVALID", "release identity, timestamps, and commit fields are required");
  if (!["prepared", "materialized", "ref_updated", "published", "failed"].includes(release.status)) fail("RELEASE_INVALID", "unknown release status");
  const failureCodes = ["STALE_CANONICAL_HEAD", "CANDIDATE_INVALID", "MATERIALIZATION_FAILED", "OUTPUT_DIGEST_MISMATCH", "RELEASE_STORE_UNAVAILABLE", "RELEASE_RECONCILIATION_FAILED"];
  if (release.failureCode !== undefined && release.failureCode !== null && !failureCodes.includes(release.failureCode)) fail("RELEASE_INVALID", "unknown failureCode");
  if (release.status === "failed" && !release.failureCode) fail("RELEASE_INVALID", "failed release requires failureCode");
  if (release.status !== "failed" && release.failureCode) fail("RELEASE_INVALID", "only failed releases may carry a failureCode");
  if ((release.status === "prepared" || release.status === "failed") && release.downloadReference !== undefined) fail("RELEASE_INVALID", `${release.status} release cannot expose a download reference`);
  if ((release.status === "materialized" || release.status === "ref_updated" || release.status === "published") && (!release.materializationManifestRef || !release.materializationManifestDigest || !release.outputDigest || !release.downloadReference)) fail("RELEASE_INVALID", `${release.status} release must have verified output fields`);
  if (release.status === "published" && release.failureCode) fail("RELEASE_INVALID", "published release cannot have a failure code");
  if (release.materializationManifestRef !== undefined && (typeof release.materializationManifestRef !== "string" || !release.materializationManifestRef)) fail("RELEASE_INVALID", "manifest reference must be a non-empty string");
  if (release.materializationManifestDigest !== undefined && (typeof release.materializationManifestDigest !== "string" || !SHA256.test(release.materializationManifestDigest))) fail("RELEASE_INVALID", "manifest digest must be sha256:<hex>");
  if (release.outputDigest !== undefined && (typeof release.outputDigest !== "string" || !SHA256.test(release.outputDigest))) fail("RELEASE_INVALID", "output digest must be sha256:<hex>");
  if (release.downloadReference !== undefined && (typeof release.downloadReference !== "string" || !release.downloadReference)) fail("RELEASE_INVALID", "download reference must be a non-empty string");
}

export function assertEvidenceManifest(value: unknown): asserts value is EvidenceManifest {
  assertEnvelope(value);
  const manifest = value as EvidenceManifest;
  if (typeof manifest.manifestId !== "string" || !manifest.manifestId || typeof manifest.runId !== "string" || !manifest.runId
    || !Array.isArray(manifest.eventRefs) || manifest.eventRefs.some((ref) => typeof ref !== "string")
    || !Array.isArray(manifest.checkpointRefs) || manifest.checkpointRefs.some((ref) => typeof ref !== "string")
    || !Array.isArray(manifest.provenanceRefs) || manifest.provenanceRefs.some((ref) => typeof ref !== "string")
    || !Array.isArray(manifest.reviewRefs) || manifest.reviewRefs.some((ref) => typeof ref !== "string")
    || typeof manifest.digest !== "string" || !SHA256.test(manifest.digest)) {
    fail("WORKSPACE_MANIFEST_INVALID", "evidence manifest is invalid");
  }
  const { digest: _digest, ...withoutDigest } = manifest;
  if (digestRecord(withoutDigest) !== manifest.digest) fail("WORKSPACE_MANIFEST_DIGEST_MISMATCH", "evidence manifest digest is invalid");
}

export function assertMaterializationManifest(value: unknown): asserts value is MaterializationManifest {
  assertEnvelope(value);
  const manifest = value as MaterializationManifest;
  if (typeof manifest.manifestId !== "string" || !manifest.manifestId || typeof manifest.releaseId !== "string" || !manifest.releaseId
    || manifest.manifestId !== `${manifest.releaseId}:materialization`
    || !FULL_COMMIT.test(manifest.releaseCommit) || !Array.isArray(manifest.files)
    || typeof manifest.digest !== "string" || !SHA256.test(manifest.digest)) {
    fail("WORKSPACE_MANIFEST_INVALID", "materialization manifest is invalid");
  }
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || typeof entry.digest !== "string"
      || !SHA256.test(entry.digest) || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes < 0
      || (entry.lfsObjectId !== undefined && (typeof entry.lfsObjectId !== "string" || !SHA256.test(entry.lfsObjectId)))) {
      fail("WORKSPACE_MANIFEST_INVALID", "materialization file entry is invalid");
    }
    assertSafePath(entry.path);
  }
  const { digest: _digest, ...withoutDigest } = manifest;
  if (digestRecord(withoutDigest) !== manifest.digest) fail("WORKSPACE_MANIFEST_DIGEST_MISMATCH", "materialization manifest digest is invalid");
}

export function assertWorkspaceEvent(value: unknown): asserts value is WorkspaceEventEnvelope {
  assertEnvelope(value);
  const event = value as WorkspaceEventEnvelope;
  if (typeof event.eventId !== "string" || typeof event.runId !== "string" || typeof event.eventType !== "string"
    || typeof event.recordedAt !== "string" || !event.eventId || !event.runId || !WORKSPACE_EVENT_TYPES.includes(event.eventType)
    || Number.isNaN(Date.parse(event.recordedAt)) || !event.payload || typeof event.payload !== "object" || Array.isArray(event.payload)) fail("WORKSPACE_EVENT_INVALID", "event envelope is invalid");
  if (event.eventType === "result_committed") {
    const payload = event.payload;
    if ("resultCommit" in payload) {
      if (typeof payload.runId !== "string" || !payload.runId || payload.runId !== event.runId || typeof payload.nodeId !== "string" || !payload.nodeId || typeof payload.roleId !== "string" || !payload.roleId || typeof payload.baseCommit !== "string" || !FULL_COMMIT.test(payload.baseCommit) || typeof payload.resultCommit !== "string" || !FULL_COMMIT.test(payload.resultCommit) || !Array.isArray(payload.changedPaths) || payload.changedPaths.some((path) => typeof path !== "string") || !Array.isArray(payload.lfsObjectIds) || payload.lfsObjectIds.some((id) => typeof id !== "string") || !payload.decisionBackground || typeof payload.decisionBackground !== "object" || Array.isArray(payload.decisionBackground) || !Array.isArray(payload.evidenceRefs) || payload.evidenceRefs.some((ref) => typeof ref !== "string")) fail("WORKSPACE_EVENT_INVALID", "Workspace result_committed payload is invalid");
      for (const path of payload.changedPaths) assertSafePath(path);
    } else if (typeof payload.runId !== "string" || !payload.runId || payload.runId !== event.runId
      || typeof payload.resultId !== "string" || !payload.resultId
      || !Number.isInteger(payload.stateVersion) || (payload.stateVersion as number) < 0) {
      fail("WORKSPACE_EVENT_INVALID", "result_committed requires a Workspace commit or result-state projection payload");
    }
  }
  if (event.eventType === "join_quorum_reached") {
    const payload = event.payload;
    const requiredStrings = ["joinId", "roleId", "lineageId", "joinMode", "arrivedFromRoleId", "arrivedFromBranchId", "activatedBranchId"] as const;
    if (requiredStrings.some((key) => typeof payload[key] !== "string" || !payload[key])
      || !Number.isInteger(payload.loopIteration) || (payload.loopIteration as number) < 0
      || !Number.isInteger(payload.requiredSourceCount) || (payload.requiredSourceCount as number) < 0
      || !Array.isArray(payload.joinSources) || payload.joinSources.some((source) => typeof source !== "string" || !source)
      || !Array.isArray(payload.satisfiedSources) || payload.satisfiedSources.some((source) => typeof source !== "string" || !source)
      || (payload.joinMin !== undefined && (!Number.isInteger(payload.joinMin) || (payload.joinMin as number) < 1))) fail("WORKSPACE_EVENT_INVALID", "join_quorum_reached payload is invalid");
    if (payload.sourceSnapshot !== undefined && (!Array.isArray(payload.sourceSnapshot) || payload.sourceSnapshot.some((source) => !source || typeof source !== "object" || typeof source.roleId !== "string" || !source.roleId || typeof source.status !== "string" || !source.status || (source.branchId !== undefined && typeof source.branchId !== "string") || (source.arrivedAt !== undefined && (typeof source.arrivedAt !== "string" || Number.isNaN(Date.parse(source.arrivedAt))))))) fail("WORKSPACE_EVENT_INVALID", "join_quorum_reached sourceSnapshot is invalid");
  }
}

export function digestRecord(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export function buildWorkspaceRef(args: Omit<WorkspaceRef, "ogsContractVersion" | "schemaVersion">): WorkspaceRef {
  const ref: WorkspaceRef = { ogsContractVersion: 2, schemaVersion: 1, ...args };
  assertWorkspaceRef(ref);
  return ref;
}

export function buildWorkspaceEvent(args: Omit<WorkspaceEventEnvelope, "ogsContractVersion" | "schemaVersion">): WorkspaceEventEnvelope {
  const event: WorkspaceEventEnvelope = { ogsContractVersion: 2, schemaVersion: 1, ...args };
  assertWorkspaceEvent(event);
  return event;
}
