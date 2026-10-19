import assert from "node:assert/strict";
import test from "node:test";
import { handlePackageRoutes } from "../api/package-routes.mjs";

function harness(useCases = {}) {
  const sent = [];
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; }
  };
  return {
    sent,
    response,
    dependencies: {
      request: { method: "GET" },
      response,
      url: new URL("http://site.test/"),
      readBody: async () => ({}),
      sendJson: (_response, status, payload) => sent.push({ status, payload }),
      errorStatus: () => 422,
      publicProject: (project) => ({ ...project, public: true }),
      useCases
    }
  };
}

function invoke(h, method, path, body = {}) {
  return handlePackageRoutes({
    ...h.dependencies,
    request: { method },
    url: new URL(`http://site.test${path}`),
    readBody: async (...args) => (h.readArgs = args, body)
  });
}

test("package preview and import routes preserve limits, payload shaping, defaults, and statuses", async () => {
  const calls = [];
  const h = harness({
    importTeamPackage: async (...args) => (calls.push(["team-import", ...args]), { projectId: "team-1" }),
    previewTeamPackage: async (payload) => (calls.push(["team-preview", payload]), { valid: true }),
    importProjectBundle: async (...args) => (calls.push(["project-import", ...args]), { projectId: "project-1" }),
    previewProjectBundle: async (payload) => (calls.push(["project-preview", payload]), { valid: true })
  });

  assert.equal(await invoke(h, "POST", "/api/v1/team-packages/import", { teamName: "Imported", meta: 1 }), true);
  assert.deepEqual([h.readArgs[0].method, h.readArgs[1]], ["POST", 8 * 1024 * 1024]);
  assert.deepEqual(calls[0], ["team-import", { meta: 1 }, { conflictStrategy: "reject", name: "Imported" }]);
  assert.equal(h.sent[0].status, 201);
  assert.deepEqual(h.sent[0].payload, { projectId: "team-1", public: true });

  assert.equal(await invoke(h, "POST", "/api/v1/team-packages/preview", { kind: "team" }), true);
  assert.deepEqual(calls[1], ["team-preview", { kind: "team" }]);
  assert.equal(h.sent[1].status, 200);

  assert.equal(await invoke(h, "POST", "/api/v1/project-packages/import", { conflictStrategy: "rename", project: 7 }), true);
  assert.deepEqual(calls[2], ["project-import", { project: 7 }, { conflictStrategy: "rename" }]);
  assert.equal(h.sent[2].status, 201);

  assert.equal(await invoke(h, "POST", "/api/v1/project-packages/preview", { kind: "project" }), true);
  assert.deepEqual(calls[3], ["project-preview", { kind: "project" }]);
  assert.deepEqual([h.readArgs[0].method, h.readArgs[1]], ["POST", 8 * 1024 * 1024]);
});

test("export routes preserve download headers and pretty JSON bodies", async () => {
  const calls = [];
  const h = harness({
    exportProjectTeam: async (id) => (calls.push(["team", id]), { kind: "team" }),
    exportProjectBundle: async (id) => (calls.push(["project", id]), { kind: "project" })
  });
  assert.equal(await invoke(h, "GET", "/api/v1/projects/research-1/team/export"), true);
  assert.deepEqual(calls[0], ["team", "research-1"]);
  assert.equal(h.response.status, 200);
  assert.deepEqual(h.response.headers, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": 'attachment; filename="research-1.team.ogs.json"',
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  assert.equal(h.response.body, JSON.stringify({ kind: "team" }, null, 2));

  assert.equal(await invoke(h, "GET", "/api/v1/projects/research-1/export"), true);
  assert.deepEqual(calls[1], ["project", "research-1"]);
  assert.equal(h.response.headers["content-disposition"], 'attachment; filename="research-1.project.ogs.json"');
  assert.equal(h.response.body, JSON.stringify({ kind: "project" }, null, 2));
});

test("package routes use standard error conversion and leave other requests unmatched", async () => {
  const failure = new Error("invalid package");
  const h = harness({
    previewTeamPackage: async () => { throw failure; },
    exportProjectBundle: async () => { throw "unknown failure"; }
  });
  assert.equal(await invoke(h, "POST", "/api/v1/team-packages/preview"), true);
  assert.deepEqual(h.sent[0], { status: 422, payload: { error: "invalid package" } });
  assert.equal(await invoke(h, "GET", "/api/v1/projects/p-1/export"), true);
  assert.deepEqual(h.sent[1], { status: 422, payload: { error: "Unable to export project." } });
  assert.equal(await invoke(h, "GET", "/api/v1/unknown"), false);
});
