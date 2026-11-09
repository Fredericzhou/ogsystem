import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createWorkspaceTools, verifyArtifactDirectory } from "../dist/runtime/adapter.js";

test("workspace tools enforce clean-room paths and quotas", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-workspace-tools-"));
  try {
    const tools = createWorkspaceTools({ root, quota: { maxFileBytes: 32, maxTotalBytes: 64, maxFiles: 3 } });
    await tools.writeText("src/main.txt", "hello");
    assert.equal(await tools.readText("src/main.txt"), "hello");
    await tools.patchText("src/main.txt", [{ start: 0, end: 5, replacement: "world" }]);
    assert.equal(await tools.readText("src/main.txt"), "world");
    await assert.rejects(tools.readText("../outside.txt"), /WORKSPACE_PATH_INVALID/);
    await assert.rejects(tools.writeText("large.txt", "x".repeat(33)), /WORKSPACE_FILE_QUOTA_EXCEEDED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact verifier supports custom text and enforces image quota while ignoring hidden temp files", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-artifact-verifier-"));
  try {
    await writeFile(join(root, "report.custom"), "hello");
    await writeFile(join(root, ".atomic.tmp"), "ignored");
    const verified = await verifyArtifactDirectory({ root, artifactId: "artifact-1", runId: "run-1", producerRoleId: "writer", executionId: "exec-1", mediaTypeByPath: { "report.custom": "text/x-custom" } });
    assert.deepEqual(verified.manifest.files.map((entry) => entry.path), ["report.custom"]);
    assert.equal(verified.manifest.runId, "run-1");
    const imageRoot = await mkdtemp(join(tmpdir(), "ogs-image-"));
    try {
      await writeFile(join(imageRoot, "image.bin"), Buffer.from([0]));
      await assert.rejects(verifyArtifactDirectory({ root: imageRoot, artifactId: "image", runId: "run-1", producerRoleId: "writer", executionId: "exec-2", mediaTypeByPath: { "image.bin": "image/png" }, limits: { maxImageBytes: 0 } }), /ARTIFACT_IMAGE_QUOTA_EXCEEDED/);
    } finally {
      await rm(imageRoot, { recursive: true, force: true });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
