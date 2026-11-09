import { createHash } from "node:crypto";
import type { StoredRoleResult, VerifiedArtifactManifest } from "./types.js";

export type ArtifactReference = {
  artifactId: string;
  runId: string;
  mediaType?: string;
};

export type ArtifactAccessAudit = {
  at: string;
  action: "read" | "read_manifest" | "read_file";
  artifactId: string;
  runId: string;
  producerRoleId: string;
  consumerRoleId: string;
  allowed: boolean;
  filePath?: string;
  reason?: string;
};

export type ArtifactManifestReader = (reference: ArtifactReference) => VerifiedArtifactManifest | undefined;
export type ArtifactFileReader = (reference: ArtifactReference, filePath: string, entry: VerifiedArtifactManifest["files"][number]) => Uint8Array | string;

export type ArtifactResolver = {
  resolve(reference: ArtifactReference, args: {
    consumerRoleId: string;
    allowedArtifactIds: ReadonlySet<string>;
    audit?: (entry: ArtifactAccessAudit) => void;
  }): StoredRoleResult;
  resolveManifest(reference: ArtifactReference, args: {
    consumerRoleId: string;
    allowedArtifactIds: ReadonlySet<string>;
    audit?: (entry: ArtifactAccessAudit) => void;
  }): VerifiedArtifactManifest;
  readFile(reference: ArtifactReference, filePath: string, args: {
    consumerRoleId: string;
    allowedArtifactIds: ReadonlySet<string>;
    audit?: (entry: ArtifactAccessAudit) => void;
  }): Uint8Array | string;
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

export function createArtifactResolver(results: Iterable<StoredRoleResult>, readers: {
  readManifest?: ArtifactManifestReader;
  readFile?: ArtifactFileReader;
} = {}): ArtifactResolver {
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
    },
    resolveManifest(reference, args) {
      const result = this.resolve(reference, args);
      const manifest = readers.readManifest?.(reference);
      const producerRoleId = result.provenance?.producerRoleId ?? result.roleId;
      if (!manifest) {
        args.audit?.({ at: new Date().toISOString(), action: "read_manifest", artifactId: reference.artifactId, runId: reference.runId, producerRoleId, consumerRoleId: args.consumerRoleId, allowed: false, reason: "verified manifest is unavailable" });
        throw new Error(`[ARTIFACT_MANIFEST_NOT_FOUND] Artifact ${reference.artifactId} has no verified manifest`);
      }
      if (
        manifest.artifactId !== result.artifactRef?.artifactId ||
        manifest.runId !== reference.runId ||
        manifest.producerRoleId !== producerRoleId ||
        (result.provenance?.executionId !== undefined && manifest.executionId !== result.provenance.executionId)
      ) {
        args.audit?.({ at: new Date().toISOString(), action: "read_manifest", artifactId: reference.artifactId, runId: reference.runId, producerRoleId, consumerRoleId: args.consumerRoleId, allowed: false, reason: "manifest provenance mismatch" });
        throw new Error(`[ARTIFACT_MANIFEST_MISMATCH] Artifact ${reference.artifactId} manifest provenance does not match reference`);
      }
      if (!manifest.manifestSha256) {
        args.audit?.({ at: new Date().toISOString(), action: "read_manifest", artifactId: reference.artifactId, runId: reference.runId, producerRoleId, consumerRoleId: args.consumerRoleId, allowed: false, reason: "manifest digest is unavailable" });
        throw new Error(`[ARTIFACT_MANIFEST_INVALID] Artifact ${reference.artifactId} manifest has no digest`);
      }
      const { manifestSha256, ...unsignedManifest } = manifest;
      const expectedManifestSha256 = createHash("sha256").update(`${JSON.stringify(unsignedManifest, null, 2)}\n`, "utf8").digest("hex");
      if (expectedManifestSha256 !== manifestSha256) {
        args.audit?.({ at: new Date().toISOString(), action: "read_manifest", artifactId: reference.artifactId, runId: reference.runId, producerRoleId, consumerRoleId: args.consumerRoleId, allowed: false, reason: "manifest digest mismatch" });
        throw new Error(`[ARTIFACT_MANIFEST_DIGEST_MISMATCH] Artifact ${reference.artifactId} manifest digest does not match`);
      }
      args.audit?.({
        at: new Date().toISOString(), action: "read_manifest", artifactId: reference.artifactId,
        runId: reference.runId, producerRoleId: result.provenance?.producerRoleId ?? result.roleId,
        consumerRoleId: args.consumerRoleId, allowed: true
      });
      return manifest;
    },
    readFile(reference, filePath, args) {
      const manifest = this.resolveManifest(reference, args);
      const normalized = filePath.replaceAll("\\", "/");
      const result = byId.get(reference.artifactId);
      const producerRoleId = result?.provenance?.producerRoleId ?? result?.roleId ?? "unknown";
      const auditFile = (allowed: boolean, reason?: string) => args.audit?.({
        at: new Date().toISOString(), action: "read_file", artifactId: reference.artifactId, runId: reference.runId,
        producerRoleId, consumerRoleId: args.consumerRoleId, allowed, filePath: normalized, ...(reason ? { reason } : {})
      });
      if (!normalized || normalized.startsWith("/") || normalized.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
        auditFile(false, "file path is unsafe");
        throw new Error(`[ARTIFACT_PATH_INVALID] Artifact file path must be safe and relative`);
      }
      const entry = manifest.files.find((candidate) => candidate.path === normalized);
      if (!entry) {
        auditFile(false, "file is not listed in verified manifest");
        throw new Error(`[ARTIFACT_FILE_NOT_FOUND] Artifact ${reference.artifactId} does not contain ${normalized}`);
      }
      if (!readers.readFile) {
        auditFile(false, "file reader is unavailable");
        throw new Error(`[ARTIFACT_FILE_READER_UNAVAILABLE] Artifact ${reference.artifactId} has no file reader`);
      }
      let content: Uint8Array | string;
      try {
        content = readers.readFile(reference, normalized, entry);
      } catch (error) {
        auditFile(false, "file reader failed");
        throw error;
      }
      const digest = createHash("sha256").update(content).digest("hex");
      if (digest !== entry.sha256) {
        auditFile(false, "file digest mismatch");
        throw new Error(`[ARTIFACT_FILE_DIGEST_MISMATCH] Artifact ${reference.artifactId} file ${normalized} failed hash verification`);
      }
      auditFile(true);
      return content;
    }
  };
}

