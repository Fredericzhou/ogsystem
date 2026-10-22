import assert from "node:assert/strict";
import test from "node:test";
import { handleSharedResourceRoutes } from "../api/shared-resource-routes.mjs";

function harness(useCases = {}) {
  const sent = [];
  return {
    sent,
    async invoke(method, path, body = {}) {
      return handleSharedResourceRoutes({
        request: { method }, response: {}, url: new URL(`http://site.test${path}`),
        readBody: async () => body,
        sendJson: (_response, status, payload) => sent.push({ status, payload }),
        errorStatus: (error) => error.message === "NOT_FOUND" ? 404 : 400,
        useCases: {
          listCatalog: async (kind) => ({ [kind]: [{ id: "resource" }] }),
          saveCatalogItem: async (kind, item) => ({ kind, ...item }),
          listDatasets: async () => ({ datasets: [] }),
          createDatasetVersion: async (payload) => payload,
          readDatasetVersion: async (resourceId, versionId) => ({ metadata: { resourceId, versionId }, files: [] }),
          listRoleTemplates: async () => ({ templates: [] }),
          createRoleTemplate: async (payload) => payload,
          getRoleTemplate: async (roleId, versionId) => ({ template: { roleId, versionId }, assets: {} }),
          ...useCases
        }
      });
    }
  };
}

test("shared resource routes project catalogs and immutable dataset snapshots", async () => {
  const h = harness();
  assert.equal(await h.invoke("GET", "/api/v1/platform/tools"), true);
  assert.deepEqual(h.sent.at(-1), { status: 200, payload: { tools: [{ id: "resource" }] } });
  assert.equal(await h.invoke("PUT", "/api/v1/platform/storage-targets", { id: "bucket" }), true);
  assert.deepEqual(h.sent.at(-1), { status: 200, payload: { item: { kind: "storageTargets", id: "bucket" } } });
  assert.equal(await h.invoke("POST", "/api/v1/platform/data-sets/versions", { resourceId: "guide", versionId: "v1" }), true);
  assert.deepEqual(h.sent.at(-1), { status: 201, payload: { version: { resourceId: "guide", versionId: "v1" } } });
  assert.equal(await h.invoke("GET", "/api/v1/platform/data-sets/guide/versions/v1"), true);
  assert.equal(h.sent.at(-1).payload.metadata.resourceId, "guide");
  assert.equal(await h.invoke("GET", "/api/v1/platform/data-sets/../resources.json"), false);
});

test("role repository API separates list, immutable creation, and versioned reads", async () => {
  const h = harness();
  assert.equal(await h.invoke("GET", "/api/v1/studio/role-repository"), true);
  assert.deepEqual(h.sent.at(-1), { status: 200, payload: { templates: [] } });
  assert.equal(await h.invoke("POST", "/api/v1/studio/role-repository", { roleId: "analyst", versionId: "v1" }), true);
  assert.equal(h.sent.at(-1).status, 201);
  assert.equal(await h.invoke("GET", "/api/v1/studio/role-repository/analyst/versions/v1"), true);
  assert.deepEqual(h.sent.at(-1).payload.template, { roleId: "analyst", versionId: "v1" });
});

test("resource route errors use application error mapping", async () => {
  const h = harness({ listDatasets: async () => { throw new Error("NOT_FOUND"); } });
  assert.equal(await h.invoke("GET", "/api/v1/platform/data-sets"), true);
  assert.deepEqual(h.sent.at(-1), { status: 404, payload: { error: "NOT_FOUND" } });
});
