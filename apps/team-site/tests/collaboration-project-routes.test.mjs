import assert from "node:assert/strict";
import { test } from "node:test";

import { handleCollaborationProjectRoutes } from "../api/collaboration-project-routes.mjs";

test("Collaboration Project confirmation route persists the current asset digest", async () => {
  const calls = [];
  const sent = [];
  const handled = await handleCollaborationProjectRoutes({
    request: { method: "POST" },
    response: {},
    url: new URL("http://localhost/api/v2/projects/project-1/confirm"),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 500,
    publicProject: (project) => project,
    visualizerUrl: "http://localhost:4177",
    useCases: {
      async confirmCollaborationProject(projectId) {
        calls.push(projectId);
        return { projectId, projectStatus: "confirmed", projectDigest: "a".repeat(64) };
      }
    }
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["project-1"]);
  assert.deepEqual(sent, [{
    status: 200,
    payload: { projectId: "project-1", projectStatus: "confirmed", projectDigest: "a".repeat(64) }
  }]);
});
