import assert from "node:assert/strict";
import { test } from "node:test";

import { handleTeamRoutes } from "../api/team-routes.mjs";

test("Team routes dispatch training baseline batch operations to Studio Simulation use cases", async () => {
  const sent = [];
  const calls = [];
  const useCases = {
    async startTrainingBaselineBatch(...args) {
      calls.push(["start", ...args]);
      return { batchId: "batch-1", status: "running" };
    },
    async getTrainingBaselineBatchStatus(...args) {
      calls.push(["status", ...args]);
      return { batch: { batchId: "batch-1", status: "running" } };
    },
    async cancelTrainingBaselineBatch(...args) {
      calls.push(["cancel", ...args]);
      return { batchId: "batch-1", status: "cancelled" };
    }
  };
  const invoke = async (method, path, body = {}) => handleTeamRoutes({
    request: { method },
    response: {},
    url: new URL(path, "http://localhost"),
    readBody: async () => body,
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 500,
    publicProject: (value) => value,
    useCases
  });

  assert.equal(await invoke("POST", "/api/v2/team-versions/team-v2/training-baselines/batches", { mode: "missing_only" }), true);
  assert.equal(await invoke("GET", "/api/v2/team-versions/team-v2/training-baselines/batches/latest"), true);
  assert.equal(await invoke("POST", "/api/v2/team-versions/team-v2/training-baselines/batches/batch-1/cancel"), true);
  assert.deepEqual(calls, [
    ["start", "team-v2", { mode: "missing_only" }],
    ["status", "team-v2"],
    ["cancel", "team-v2", "batch-1"]
  ]);
  assert.deepEqual(sent, [
    { status: 202, payload: { batch: { batchId: "batch-1", status: "running" } } },
    { status: 200, payload: { batch: { batchId: "batch-1", status: "running" } } },
    { status: 200, payload: { batch: { batchId: "batch-1", status: "cancelled" } } }
  ]);
});

test("Team routes expose the TeamVersion accuracy review boundary", async () => {
  const sent = [];
  const calls = [];
  const useCases = {
    async getTeamAccuracyReview(...args) { calls.push(["get", ...args]); return { teamVersionId: args[0], review: null }; },
    async saveTeamAccuracyReview(...args) { calls.push(["save", ...args]); return { teamVersionId: args[0], review: { reviewer: "owner" } }; }
  };
  const invoke = async (method, path, body = {}) => handleTeamRoutes({
    request: { method }, response: {}, url: new URL(path, "http://localhost"), readBody: async () => body,
    sendJson: (_response, status, payload) => sent.push({ status, payload }), errorStatus: () => 500,
    publicProject: (value) => value, useCases
  });
  assert.equal(await invoke("GET", "/api/v2/team-versions/team-v2/training-review"), true);
  assert.equal(await invoke("PUT", "/api/v2/team-versions/team-v2/training-review", { reviewer: "owner" }), true);
  assert.deepEqual(calls, [["get", "team-v2"], ["save", "team-v2", { reviewer: "owner" }]]);
  assert.deepEqual(sent, [
    { status: 200, payload: { teamVersionId: "team-v2", review: null } },
    { status: 200, payload: { teamVersionId: "team-v2", review: { reviewer: "owner" } } }
  ]);
});
