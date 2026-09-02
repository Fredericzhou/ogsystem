import test from "node:test";
import assert from "node:assert/strict";

import {
  Annotation,
  END,
  isGraphDrained,
  RunControl,
  START,
  StateGraph
} from "@langchain/langgraph";
import { resolveRoleNodeTimeoutMs } from "../dist/runtime/graph-runner.js";

test("role node timeout uses the effective execution budget plus persistence grace", () => {
  const modelNode = {
    roleId: "model-role",
    binding: {
      kind: "model",
      modelRef: "provider/model",
      timeoutMs: 1000,
      bindingSource: "selection"
    }
  };
  const profileNode = {
    roleId: "profile-role",
    binding: { kind: "profile", profileId: "profile.slow" }
  };
  const noopNode = {
    roleId: "noop-role",
    binding: { kind: "noop" }
  };

  assert.equal(resolveRoleNodeTimeoutMs(modelNode, new Map()), 6000);
  assert.equal(
    resolveRoleNodeTimeoutMs(profileNode, new Map([["profile.slow", { profileId: "profile.slow", timeoutMs: 2000 }]])),
    7000
  );
  assert.equal(resolveRoleNodeTimeoutMs(noopNode, new Map()), undefined);
});

test("RunControl drains a graph at the next superstep boundary", async () => {
  const state = Annotation.Root({
    value: Annotation({
      reducer: (_current, update) => update,
      default: () => 0
    })
  });
  const graph = new StateGraph(state)
    .addNode("step", async () => ({ value: 1 }))
    .addEdge(START, "step")
    .addEdge("step", END)
    .compile();
  const control = new RunControl();
  control.requestDrain("test-drain");

  await assert.rejects(
    async () => {
      const stream = await graph.stream({ value: 0 }, { streamMode: "values", control });
      for await (const _chunk of stream) {
        // Drain is expected before a value is emitted.
      }
    },
    (error) => {
      assert.equal(isGraphDrained(error), true);
      assert.equal(error.reason, "test-drain");
      return true;
    }
  );
});
