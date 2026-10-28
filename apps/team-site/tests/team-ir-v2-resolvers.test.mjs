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
  await writeFile(reviewModulePath, "export const resolveTeamIrReleaseClosure = () => ({}); export const resolveBindings = () => ({}); export const authorizeTeamIrReviewer = () => true;\n", "utf8");
  const reviewResolvers = await loadTeamIrV2Resolvers(reviewModulePath);
  assert.equal(typeof reviewResolvers.authorizeTeamIrReviewer, "function");
});

test("Team IR v2 resolver composes pinned A2A clients and fails closed when none is configured", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "team-ir-v2-a2a-resolver-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const modulePath = join(directory, "resolver.mjs");
  await writeFile(modulePath, `
    export async function resolveTeamIrReleaseClosure({ teamIR }) {
      return { complete: true, packageDigests: { "role:remote@1": "${"a".repeat(64)}" }, bindingDigests: {}, adapterVersions: { model: "model/1" } };
    }
    export async function resolveBindings({ teamIR }) { return {}; }
    export async function resolveA2AAgent() {
      const agentCard = { protocolVersion: "1.0", name: "Remote", version: "1", defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"], capabilities: { streaming: false, pushNotifications: false } };
      return { agentCard, client: { async getAgentCard() { return agentCard; }, async sendMessage() { return { id: "remote-1", status: "completed", result: { event: "DONE", data: { summary: "ok" } } }; }, async getTask() { throw new Error("unused"); }, async cancelTask() { return true; } } };
    }
  `, "utf8");
  const resolvers = await loadTeamIrV2Resolvers(modulePath);
  const teamIR = {
    agents: [{ id: "remote", packageRef: "role:remote@1", bindingRef: "binding:remote" }],
    bindings: [{ id: "binding:remote", kind: "a2a", agentCardRef: "https://remote.invalid/card", capabilities: { inputMediaTypes: ["application/json"], outputMediaTypes: ["application/json"] } }]
  };
  const closure = await resolvers.resolveTeamIrReleaseClosure({ team: {}, teamIR });
  assert.equal(closure.complete, true);
  assert.equal(closure.adapterVersions.a2a, "ogs-team-ir-a2a-binding/1");
  assert.match(closure.bindingDigests["binding:remote"], /^[a-f0-9]{64}$/);
  const resolved = await resolvers.resolveBindings({ team: {}, teamIR, closure });
  assert.equal((await resolved["binding:remote"].invoke({ idempotencyKey: "run:remote", input: { request: "hello" } })).kind, "completed");

  const modelOnlyPath = join(directory, "model-only.mjs");
  await writeFile(modelOnlyPath, `export const resolveTeamIrReleaseClosure = async () => ({ complete: true, packageDigests: {}, bindingDigests: {}, adapterVersions: {} }); export const resolveBindings = async () => ({});`, "utf8");
  const modelOnly = await loadTeamIrV2Resolvers(modelOnlyPath);
  await assert.rejects(modelOnly.resolveTeamIrReleaseClosure({ team: {}, teamIR }), /TEAM_IR_A2A_RESOLVER_UNAVAILABLE/);
});
