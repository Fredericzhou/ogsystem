import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { createFileTeamLifecycleLocks } from "../infrastructure/file-team-lifecycle-locks.mjs";

test("collaboration Project name lock releases after a failed operation", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-name-lock-"));
  const locks = createFileTeamLifecycleLocks({ projectsRoot });
  const name = "A failed project creation";
  const digest = createHash("sha256").update(name.toLocaleLowerCase()).digest("hex");
  const lockPath = join(projectsRoot, ".site", `collaboration-project-${digest}`, ".site", "project-write.lock");

  try {
    await assert.rejects(
      () => locks.withCollaborationProjectNameLock(name, async () => { throw new Error("creation failed"); }),
      /creation failed/
    );
    await assert.rejects(() => access(lockPath), { code: "ENOENT" });
    let entered = false;
    await locks.withCollaborationProjectNameLock(name, async () => { entered = true; });
    assert.equal(entered, true);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Team save lock and lifecycle lock share one reentrant Team lock", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-shared-lock-"));
  const locks = createFileTeamLifecycleLocks({ projectsRoot });
  try {
    let entered = false;
    await locks.withTeamVersionSaveLock("team-root", async () => {
      await locks.withTeamVersionLock("team-root", async () => { entered = true; });
    });
    assert.equal(entered, true);
    await assert.rejects(() => access(join(projectsRoot, ".team-version-team-root", ".site", "project-write.lock")), { code: "ENOENT" });
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("concurrent Team lock requests wait for the active operation", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-lock-queue-"));
  const locks = createFileTeamLifecycleLocks({ projectsRoot });
  let active = 0;
  let maxActive = 0;
  const run = () => locks.withTeamVersionLock("team-root", async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 30));
    active -= 1;
  });
  try {
    await Promise.all([run(), run(), run()]);
    assert.equal(maxActive, 1);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
