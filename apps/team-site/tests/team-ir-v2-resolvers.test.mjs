import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadTeamIrV2Resolvers } from "../infrastructure/team-ir-v2-resolvers.mjs";

test("Team IR v2 resolver loading stays disabled without an explicit module", async () => {
  assert.deepEqual(await loadTeamIrV2Resolvers(undefined), {});
});

test("Team IR v2 resolver module requires an absolute path and both trusted functions", async (t) => {
  await assert.rejects(loadTeamIrV2Resolvers("./resolver.mjs"), /TEAM_IR_V2_RESOLVER_PATH_INVALID/);
  const directory = await mkdtemp(join(tmpdir(), "team-ir-v2-resolver-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modulePath = join(directory, "resolver.mjs");
  await writeFile(modulePath, "export const resolveTeamIrReleaseClosure = () => ({});\n", "utf8");
  await assert.rejects(loadTeamIrV2Resolvers(modulePath), /TEAM_IR_V2_RESOLVER_INVALID.*resolveBindings/);
  const completeModulePath = join(directory, "complete-resolver.mjs");
  await writeFile(completeModulePath, "export const resolveTeamIrReleaseClosure = () => ({}); export const resolveBindings = () => ({});\n", "utf8");
  const resolvers = await loadTeamIrV2Resolvers(completeModulePath);
  assert.equal(typeof resolvers.resolveTeamIrReleaseClosure, "function");
  assert.equal(typeof resolvers.resolveBindings, "function");
  assert.equal(Object.isFrozen(resolvers), true);
  const reviewModulePath = join(directory, "review-resolver.mjs");
  await writeFile(reviewModulePath, "export const resolveTeamIrReleaseClosure = () => ({}); export const resolveBindings = () => ({}); export const resolveTeamIrReviewContext = () => ({});\n", "utf8");
  const reviewResolvers = await loadTeamIrV2Resolvers(reviewModulePath);
  assert.equal(typeof reviewResolvers.resolveTeamIrReviewContext, "function");
});
