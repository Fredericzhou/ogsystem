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
