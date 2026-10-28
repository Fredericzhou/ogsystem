import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createRuntimeTeamConfirmation } from "../infrastructure/runtime-team-confirmation.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";

test("native Team IR v2 confirmation hashes the IR without requiring a legacy system.mmd", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "team-ir-confirmation-v2-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const teamIrStore = createFileTeamIrStore();
  const confirmation = createRuntimeTeamConfirmation({ teamIrStore });
  const project = { workdir, source: "team-ir-v2" };
  const teamIR = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-release-gate.json", import.meta.url), "utf8"));

  await teamIrStore.save({ workdir, teamIR });
  const first = await confirmation.computeDigests(project);
  const second = await confirmation.computeDigests(project);
  assert.deepEqual(first, second);
  assert.match(first.projectDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.projectDigest, first.teamCoreDigest);
  assert.equal(first.teamDigestVersion, 3);
  await assert.doesNotReject(() => confirmation.validateTopology(project));
  assert.equal(await confirmation.computeTopologyDigest(project), teamIRSemanticDigest(teamIR));

  teamIR.team.version = "2.0.1";
  await teamIrStore.save({ workdir, teamIR });
  const changed = await confirmation.computeDigests(project);
  assert.notEqual(changed.teamCoreDigest, first.teamCoreDigest);
});
