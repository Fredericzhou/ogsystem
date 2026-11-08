import type { StoredRoleResult } from "./types.js";

export type ArtifactReference = {
  artifactId: string;
  runId: string;
  mediaType?: string;
};

export type ArtifactAccessAudit = {
  at: string;
  action: "read";
  artifactId: string;
  runId: string;
  producerRoleId: string;
  consumerRoleId: string;
  allowed: boolean;
  reason?: string;
};

export type ArtifactResolver = {
  resolve(reference: ArtifactReference, args: {
    consumerRoleId: string;
    allowedArtifactIds: ReadonlySet<string>;
    audit?: (entry: ArtifactAccessAudit) => void;
  }): StoredRoleResult;
};

export function buildArtifactReference(args: {
  runId: string;
  executionId: string;
  mediaType?: string;
}): ArtifactReference {
  return {
    artifactId: `artifact:${args.runId}:${args.executionId}`,
    runId: args.runId,
    ...(args.mediaType ? { mediaType: args.mediaType } : {})
  };
}

export function buildAllowedArtifactSet(results: Iterable<StoredRoleResult | undefined>): Set<string> {
  return new Set(Array.from(results).flatMap((result) => result?.artifactRef?.artifactId ? [result.artifactRef.artifactId] : []));
}

export function createArtifactResolver(results: Iterable<StoredRoleResult>): ArtifactResolver {
  const byId = new Map(Array.from(results).flatMap((result: StoredRoleResult) => result.artifactRef ? [[result.artifactRef.artifactId, result] as const] : []));
  return {
    resolve(reference, args) {
      const result = byId.get(reference.artifactId);
      const allowed = args.allowedArtifactIds.has(reference.artifactId);
      const audit = {
        at: new Date().toISOString(),
        action: "read" as const,
        artifactId: reference.artifactId,
        runId: reference.runId,
        producerRoleId: result?.provenance?.producerRoleId ?? result?.roleId ?? "unknown",
        consumerRoleId: args.consumerRoleId,
        allowed
      };
      args.audit?.(allowed ? audit : { ...audit, reason: "reference is outside invocation allowed-set" });
      if (!allowed) throw new Error(`[ARTIFACT_ACCESS_DENIED] Artifact ${reference.artifactId} is not authorized for role ${args.consumerRoleId}`);
      if (!result || result.artifactRef?.runId !== reference.runId) throw new Error(`[ARTIFACT_NOT_FOUND] Artifact ${reference.artifactId} is not available for run ${reference.runId}`);
      if (result.provenance?.runId !== undefined && result.provenance.runId !== reference.runId) {
        throw new Error(`[ARTIFACT_PROVENANCE_MISMATCH] Artifact ${reference.artifactId} producer provenance belongs to run ${result.provenance.runId}`);
      }
      if (
        reference.mediaType !== undefined &&
        (result.artifactRef?.mediaType !== reference.mediaType ||
          (result.provenance?.mediaType !== undefined && result.provenance.mediaType !== reference.mediaType))
      ) {
        throw new Error(`[ARTIFACT_MEDIA_TYPE_MISMATCH] Artifact ${reference.artifactId} is ${result.artifactRef?.mediaType ?? "unknown"}, requested ${reference.mediaType}`);
      }
      return result;
    }
  };
}

