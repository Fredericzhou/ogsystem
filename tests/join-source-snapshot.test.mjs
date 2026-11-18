import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("quorum decision event freezes source role, branch, status, and arrival time", async () => {
  const repoRoot = process.cwd();
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-join-source-snapshot-"));
  let runId;
  try {
    await mkdir(path.resolve(workdir, ".ogs"), { recursive: true });
    await symlink(path.resolve(repoRoot, "og-roles"), path.resolve(workdir, "og-roles"), "dir");
    for (const name of ["runtime.json", "execution-bindings.json", "model-catalog.json", "laws.json", "user-profile.json"]) {
      await symlink(path.resolve(repoRoot, ".ogs", name), path.resolve(workdir, ".ogs", name));
    }

    const result = await runSystemWithAdapter({
      systemPath: path.resolve(repoRoot, "examples/medical-quorum-consultation/system.mmd"),
      runtimeConfigPath: path.resolve(workdir, ".ogs/runtime.json"),
      lawsPath: path.resolve(repoRoot, "examples/medical-quorum-consultation/laws.json"),
      userProfilePath: path.resolve(workdir, ".ogs/user-profile.json"),
      prompt: "verify quorum source audit snapshot",
      workdir,
      dryRun: true,
      onRunInitialized: (run) => { runId = run.runId; }
    });
    assert.equal(result.status, "done");
    assert.ok(runId);

    const eventsPath = path.resolve(workdir, ".ogs", "runs", runId, "events.ndjson");
    const events = (await readFile(eventsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    const quorum = events.find((event) => event.type === "join_quorum_reached");
    assert.ok(quorum, "expected a quorum decision event");
    assert.equal(quorum.requiredSourceCount, 3);
    assert.deepEqual(quorum.sourceSnapshot.map((source) => source.roleId), [
      "diagnosis-cardiology",
      "diagnosis-neurology",
      "diagnosis-imaging"
    ]);
    assert.ok(quorum.sourceSnapshot.every((source) => source.status === "arrived"));
    assert.ok(quorum.sourceSnapshot.every((source) => source.branchId));
    assert.ok(quorum.sourceSnapshot.every((source) => Number.isFinite(Date.parse(source.arrivedAt))));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
