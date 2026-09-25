import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

test("OpenAPI contract covers versioned project, run control, monitoring, and human review operations", async () => {
  const source = await readFile(new URL("../schemas/openapi.yaml", import.meta.url), "utf8");
  const spec = parse(source);
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.version, "1.0.0");
  assert.ok(spec.paths["/api/v1/workspace"]?.get);
  assert.ok(spec.paths["/api/v1/project/system/save"]?.post);
  assert.ok(spec.paths["/api/v1/runs"]?.get);
  assert.ok(spec.paths["/api/v1/runs/start"]?.post);
  assert.ok(spec.paths["/api/v1/runs/{runId}/resume"]?.post);
  assert.ok(spec.paths["/api/v1/runs/{runId}/stop"]?.post);
  assert.ok(spec.paths["/api/v1/runs/{runId}/stream"]?.get);
  assert.ok(spec.paths["/api/v1/runs/{runId}/reviews/{reviewId}/decide"]?.post);
  assert.ok(spec.paths["/healthz"]?.get);
  assert.ok(spec.paths["/readyz"]?.get);
  assert.ok(spec.paths["/metrics"]?.get);
  assert.equal(spec.paths["/api/v1/runs/{runId}/reviews/{reviewId}/decide"].post.requestBody.content["application/json"].schema.properties.actor, undefined);
  assert.equal(spec["x-ogs-control-plane"].version, "v1");
});
