import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseRoleExecutionOutputWithRepair } from "../dist/runtime/role-output-parser.js";
import { buildArtifactReference, createArtifactResolver } from "../dist/runtime/artifact-access.js";
import { validateRoleOutputSchema } from "../dist/runtime/role-repo.js";

function manifestFor(reference) {
  const unsigned = {
    version: 1,
    status: "verified",
    artifactId: reference.artifactId,
    runId: reference.runId,
    producerRoleId: "producer",
    executionId: "exec-1",
    generatedAt: "2026-11-09T00:00:00.000Z",
    files: [{ path: "output.txt", sha256: createHash("sha256").update("hello").digest("hex"), sizeBytes: 5, mediaType: "text/plain" }],
    totalBytes: 5
  };
  return { ...unsigned, manifestSha256: createHash("sha256").update(`${JSON.stringify(unsigned, null, 2)}\n`).digest("hex") };
}

test("role output rejects Runtime-owned file declarations", () => {
  assert.throws(() => parseRoleExecutionOutputWithRepair({
    rawOutput: JSON.stringify({ event: "READY", content: "done", artifacts: [{ artifactId: "report", path: "output.txt" }] }),
    requireEvent: true
  }), /unsupported field "artifacts"/);
});

test("role output keeps business data in content or data", () => {
  const parsed = parseRoleExecutionOutputWithRepair({
    rawOutput: JSON.stringify({ event: "READY", content: "published", data: { mediaType: "application/json" } }),
    requireEvent: true
  });
  assert.deepEqual(parsed.output.data, { mediaType: "application/json" });
});

test("role schema rejects Runtime-owned file declarations", () => {
  assert.throws(() => validateRoleOutputSchema({
    roleId: "writer",
    schemaPath: "inline-output.schema.json",
    schema: { type: "object", required: ["event", "content"], additionalProperties: false, properties: { event: { type: "string" }, content: { type: "string" } } },
    output: { event: "READY", content: "done", artifacts: [{ artifactId: "report", kind: "text", path: "report.txt", mediaType: "text/plain" }] }
  }), /additional property not allowed/);
});

test("ArtifactResolver verifies manifest/file hashes and audits rejected reads", () => {
  const artifactRef = buildArtifactReference({ runId: "run-1", executionId: "exec-1", mediaType: "text/plain" });
  const result = { roleId: "producer", branchId: "branch", lineageId: "lineage", loopIteration: 0, artifactRef, provenance: { runId: "run-1", producerRoleId: "producer", branchId: "branch", lineageId: "lineage", loopIteration: 0, mediaType: "text/plain" } };
  const audits = [];
  const resolver = createArtifactResolver([result], {
    readManifest: () => manifestFor(artifactRef),
    readFile: () => "hello"
  });
  const manifest = resolver.resolveManifest(artifactRef, {
    consumerRoleId: "consumer",
    allowedArtifactIds: new Set([artifactRef.artifactId])
  });
  assert.deepEqual(manifest.files[0], {
    path: "output.txt",
    sha256: createHash("sha256").update("hello").digest("hex"),
    sizeBytes: 5,
    mediaType: "text/plain"
  });
  assert.equal(typeof manifest.manifestSha256, "string");
  assert.equal(manifest.manifestSha256.length, 64);
  assert.equal(resolver.readFile(artifactRef, "output.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), "hello");
  const tamperedResolver = createArtifactResolver([result], { readManifest: () => manifestFor(artifactRef), readFile: () => "tampered" });
  assert.throws(() => tamperedResolver.readFile(artifactRef, "output.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), /ARTIFACT_FILE_DIGEST_MISMATCH/);
  assert.throws(() => resolver.readFile(artifactRef, "missing.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), /ARTIFACT_FILE_NOT_FOUND/);
  assert.equal(audits.at(-1).action, "read_file");
  assert.equal(audits.at(-1).allowed, false);
  assert.throws(() => resolver.readFile(artifactRef, "../output.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), /ARTIFACT_PATH_INVALID/);
  assert.equal(audits.at(-1).allowed, false);
});
