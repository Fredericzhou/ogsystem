import assert from "node:assert/strict";
import test from "node:test";
import { createRunPoller } from "../public/app/components/run-poll.js";

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

test("Run polling collects decision events across event pages before publishing the history", async () => {
  const requests = [];
  const updates = [];
  const firstPage = Array.from({ length: 1000 }, (_, index) => ({ cursor: index + 1, record: { type: "role.started" } }));
  const stop = createRunPoller({
    projectId: "project-1",
    taskId: "task-1",
    runId: "run-1",
    request: async (url) => {
      requests.push(url);
      if (url.endsWith("/events?cursor=0&limit=1000")) {
        return jsonResponse({ events: firstPage, nextCursor: 1001 });
      }
      if (url.endsWith("/events?cursor=1001&limit=1000")) {
        return jsonResponse({ events: [{ cursor: 1200, record: { type: "flow.activated", eventType: "NEEDS_REWORK", loopIteration: 2 } }], nextCursor: 1201 });
      }
      if (url.endsWith("/events?cursor=1201&limit=1000")) {
        return jsonResponse({ events: [], nextCursor: 1201 });
      }
      return jsonResponse({ runId: "run-1", state: { status: "completed" } });
    },
    onUpdate: (snapshot) => updates.push(snapshot)
  });

  const startedAt = Date.now();
  while (!updates.length && Date.now() - startedAt < 1000) await new Promise((resolve) => setTimeout(resolve, 5));
  stop();

  assert.equal(updates.length, 1);
  assert.equal(updates[0].events.events.length, 1001);
  assert.equal(updates[0].events.events.at(-1).record.eventType, "NEEDS_REWORK");
  assert.deepEqual(requests.filter((url) => url.includes("/events?")), [
    "/api/v2/projects/project-1/tasks/task-1/runs/run-1/events?cursor=0&limit=1000",
    "/api/v2/projects/project-1/tasks/task-1/runs/run-1/events?cursor=1001&limit=1000"
  ]);
});
