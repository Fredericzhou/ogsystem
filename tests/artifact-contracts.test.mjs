import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseRoleExecutionOutputWithRepair } from "../dist/runtime/role-output-parser.js";
import { buildArtifactReference, createArtifactResolver } from "../dist/runtime/artifact-access.js";
import { validateRoleOutputSchema, withRuntimeArtifactOutputSchema } from "../dist/runtime/role-repo.js";

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

test("role output accepts artifacts and rejects unsafe or duplicate declarations", () => {
  const parsed = parseRoleExecutionOutputWithRepair({
    rawOutput: JSON.stringify({ event: "READY", content: "done", artifacts: [{ artifactId: "report", kind: "text", path: "output.txt", mediaType: "text/plain" }] }),
    requireEvent: true
  });
  assert.equal(parsed.output.artifacts[0].artifactId, "report");
  assert.throws(() => parseRoleExecutionOutputWithRepair({ rawOutput: JSON.stringify({ event: "READY", artifacts: [
    { artifactId: "report", kind: "text", path: "output.txt", mediaType: "text/plain" },
    { artifactId: "report", kind: "text", path: "other.txt", mediaType: "text/plain" }
  ] }), requireEvent: true }), /duplicate artifactId/);
  assert.throws(() => parseRoleExecutionOutputWithRepair({ rawOutput: JSON.stringify({ event: "READY", artifacts: [{ artifactId: "bad", kind: "text", path: "..\/secret", mediaType: "text/plain" }] }), requireEvent: true }), /relative path/);
});

test("business_data can declare text and binary file formats without implying conversion", () => {
  const parsed = parseRoleExecutionOutputWithRepair({
    rawOutput: JSON.stringify({
      event: "READY",
      content: "published",
      artifacts: [
        { artifactId: "json", kind: "business_data", path: "brief.json", mediaType: "application/json" },
        { artifactId: "csv", kind: "business_data", path: "brief.csv", mediaType: "text/csv" },
        { artifactId: "xlsx", kind: "business_data", path: "brief.xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", encoding: "binary" },
        { artifactId: "image", kind: "business_data", path: "brief.png", mediaType: "image/png", encoding: "binary" },
        { artifactId: "video", kind: "business_data", path: "brief.mp4", mediaType: "video/mp4", encoding: "binary" },
        { artifactId: "audio", kind: "business_data", path: "brief.mp3", mediaType: "audio/mpeg", encoding: "binary" }
      ]
    }),
    requireEvent: true
  });
  assert.deepEqual(parsed.output.artifacts.map((item) => item.mediaType), [
    "application/json", "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "image/png", "video/mp4", "audio/mpeg"
  ]);
});

test("legacy strict role schemas accept the Runtime artifact extension", () => {
  assert.doesNotThrow(() => validateRoleOutputSchema({
    roleId: "writer",
    schemaPath: "inline-output.schema.json",
    schema: { type: "object", required: ["event", "content"], additionalProperties: false, properties: { event: { type: "string" }, content: { type: "string" } } },
    output: { event: "READY", content: "done", artifacts: [{ artifactId: "report", kind: "text", path: "report.txt", mediaType: "text/plain" }] }
  }));
});

test("Runtime artifact schema overlay preserves role fields and remains optional", () => {
  const schema = withRuntimeArtifactOutputSchema({
    type: "object",
    additionalProperties: false,
    required: ["event"],
    properties: { event: { type: "string" } }
  });
  assert.deepEqual(schema.required, ["event"]);
  assert.equal(schema.properties.event.type, "string");
  assert.equal(schema.properties.artifacts.type, "array");
});

test("ArtifactResolver verifies manifest/file hashes and audits rejected reads", () => {
  const artifactRef = buildArtifactReference({ runId: "run-1", executionId: "exec-1", mediaType: "text/plain" });
  const result = { roleId: "producer", branchId: "branch", lineageId: "lineage", loopIteration: 0, artifactRef, provenance: { runId: "run-1", producerRoleId: "producer", branchId: "branch", lineageId: "lineage", loopIteration: 0, mediaType: "text/plain" } };
  const audits = [];
  const resolver = createArtifactResolver([result], {
    readManifest: () => manifestFor(artifactRef),
    readFile: () => "hello"
  });
  assert.equal(resolver.readFile(artifactRef, "output.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), "hello");
  const tamperedResolver = createArtifactResolver([result], { readManifest: () => manifestFor(artifactRef), readFile: () => "tampered" });
  assert.throws(() => tamperedResolver.readFile(artifactRef, "output.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), /ARTIFACT_FILE_DIGEST_MISMATCH/);
  assert.throws(() => resolver.readFile(artifactRef, "missing.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), /ARTIFACT_FILE_NOT_FOUND/);
  assert.equal(audits.at(-1).action, "read_file");
  assert.equal(audits.at(-1).allowed, false);
  assert.throws(() => resolver.readFile(artifactRef, "../output.txt", { consumerRoleId: "consumer", allowedArtifactIds: new Set([artifactRef.artifactId]), audit: (entry) => audits.push(entry) }), /ARTIFACT_PATH_INVALID/);
  assert.equal(audits.at(-1).allowed, false);
});
