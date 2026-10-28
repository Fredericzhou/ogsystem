import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRuntimeTeamConfirmation } from "../infrastructure/runtime-team-confirmation.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { createRuntimeTaskExecutionReadiness } from "../infrastructure/runtime-task-execution-readiness.mjs";
import { classicSoftwareTeamIr } from "./team-ir-test-runtime.mjs";

test("native Team IR v2 task confirmation hashes IR without reading legacy project assets", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "team-ir-task-readiness-v2-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const teamIrStore = createFileTeamIrStore();
  await teamIrStore.save({ workdir, teamIR: classicSoftwareTeamIr });
  const confirmation = createRuntimeTeamConfirmation({ teamIrStore });
  const readiness = createRuntimeTaskExecutionReadiness({ teamIrStore, confirmation });
  const project = { workdir, projectType: "team", teamVersionStatus: "released" };
  project.projectDigest = (await confirmation.computeDigests(project)).projectDigest;
  project.teamIrSemanticDigest = (await teamIrStore.read({ workdir })).semanticDigest;

  await assert.doesNotReject(() => readiness.requireCurrentConfirmation(project));
  await teamIrStore.save({ workdir, teamIR: { ...structuredClone(classicSoftwareTeamIr), name: "Changed after release" } });
  await assert.rejects(() => readiness.requireCurrentConfirmation(project), /TEAM_IR_SEMANTIC_DIGEST_MISMATCH/);
});
