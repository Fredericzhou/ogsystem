import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertSafeEvidencePath, resolveSafeEvidencePath } from "../infrastructure/safe-evidence-path.mjs";

async function withTempDirectory(action) {
  const root = await mkdtemp(join(tmpdir(), "ogs-safe-evidence-path-"));
  try {
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createDirectoryLink(target, path) {
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}

async function createFileLink(target, path) {
  await symlink(target, path, "file");
}

function canCreateLink(error) {
  return ["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code);
}

test("safe evidence paths reject traversal and resolve nested owner paths under the root", () => {
  const root = resolve("evidence-root");
  assert.equal(resolveSafeEvidencePath(root, ["project-1", ".ogs", "runs", "run-1"]),
    join(root, "project-1", ".ogs", "runs", "run-1"));
  for (const segment of ["..", ".", "../outside", "C:\\outside", "a/b", "a\\b"]) {
    assert.throws(() => resolveSafeEvidencePath(root, [segment]), /segment .* invalid/);
  }
});

test("safe evidence path validates directory and regular file types and permits a missing final path only", async () => {
  await withTempDirectory(async (root) => {
    await mkdir(join(root, "project-1", ".ogs", "runs", "run-1"), { recursive: true });
    await writeFile(join(root, "project-1", ".ogs", "runs", "run-1", "state.json"), "{}", "utf8");
    const segments = ["project-1", ".ogs", "runs", "run-1", "state.json"];
    assert.equal(await assertSafeEvidencePath(root, segments, { kind: "file" }), join(root, ...segments));
    assert.equal(await assertSafeEvidencePath(root, ["project-1", ".ogs", "runs"], { kind: "directory" }),
      join(root, "project-1", ".ogs", "runs"));
    assert.equal(await assertSafeEvidencePath(root, [...segments.slice(0, -1), "missing.json"], {
      kind: "file", allowMissingFinal: true
    }), join(root, ...segments.slice(0, -1), "missing.json"));
    await assert.rejects(assertSafeEvidencePath(root, ["missing", "child"], { allowMissingFinal: true }), /ENOENT/);
    await assert.rejects(assertSafeEvidencePath(root, segments, { kind: "directory" }), /must be a directory/);
  });
});

test("safe evidence path rejects a junction in the project path before traversing it", async (t) => {
  await withTempDirectory(async (root) => {
    const projectsRoot = join(root, "projects");
    const outsideProject = join(root, "outside-project");
    await mkdir(join(outsideProject, ".ogs", "runs", "run-1"), { recursive: true });
    await mkdir(projectsRoot, { recursive: true });
    try {
      await createDirectoryLink(outsideProject, join(projectsRoot, "project-1"));
    } catch (error) {
      if (canCreateLink(error)) return t.skip(`directory links unavailable: ${error.code}`);
      throw error;
    }
    await assert.rejects(
      assertSafeEvidencePath(projectsRoot, ["project-1", ".ogs", "runs", "run-1"], { kind: "directory" }),
      /RUN_EVIDENCE_LINK_NOT_ALLOWED/
    );
  });
});

test("safe evidence path rejects a linked run evidence file", async (t) => {
  await withTempDirectory(async (root) => {
    const evidenceRoot = join(root, "projects", "project-1", ".ogs", "runs", "run-1");
    await mkdir(evidenceRoot, { recursive: true });
    const outsideFile = join(root, "outside-state.json");
    await writeFile(outsideFile, "{}", "utf8");
    try {
      await createFileLink(outsideFile, join(evidenceRoot, "state.json"));
    } catch (error) {
      if (canCreateLink(error)) return t.skip(`file symlinks unavailable: ${error.code}`);
      throw error;
    }
    await assert.rejects(
      assertSafeEvidencePath(join(root, "projects"), ["project-1", ".ogs", "runs", "run-1", "state.json"], { kind: "file" }),
      /RUN_EVIDENCE_LINK_NOT_ALLOWED/
    );
  });
});
