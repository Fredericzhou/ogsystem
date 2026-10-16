import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createProjectRunState } from "../dist/runtime/project-run-state.js";
import { startVisualizationServer } from "../dist/visualizer/server.js";

test("visualizer run plan endpoint exposes immutable execution inputs and quality", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-project-run-api-"));
  const runId = "20261016-010203-plancheck";
  const runDir = resolve(workdir, ".ogs", "runs", runId);
  const plan = {
    version: 1,
    runId,
    createdAt: "2026-10-16T01:02:03.000Z",
    designDigest: "design-digest",
    workspaceDigest: "workspace-digest",
    taskDigest: "task-digest",
    fingerprintDigest: "fingerprint-digest",
    entryNodeId: "writer",
    backend: ["codex"],
    nodeGraph: [
      {
        nodeId: "writer",
        incoming: [],
        outgoing: [{ to: "output", event: "DONE" }],
        reviewRequired: false
      }
    ],
    executionPolicy: {
      mode: "dry-run",
      dryRun: true,
      singleWorker: true,
      allowExternalSideEffects: false
    },
    reviewPolicy: { requiredNodeIds: [] }
  };

  try {
    await mkdir(join(runDir, "control"), { recursive: true });
    await writeFile(join(runDir, "run-plan.json"), JSON.stringify(plan), "utf8");
    await writeFile(join(runDir, "control", "materials.json"), JSON.stringify([
      {
        materialId: "brief",
        sourcePath: "workspace/files/brief.md",
        snapshotPath: "inputs/brief-brief.md",
        contentHash: "material-hash",
        size: 12,
        contentType: "text/markdown",
        selectedRanges: []
      }
    ]), "utf8");
    await writeFile(join(runDir, "control", "side-effects.json"), "[]", "utf8");
    await writeFile(join(runDir, "control", "state.json"), JSON.stringify(createProjectRunState(plan)), "utf8");

    const started = await startVisualizationServer({ workdir, host: "127.0.0.1", port: 0 });
    try {
      const response = await fetch(`${started.url}/api/v1/ogs/runs/${runId}/plan`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.runPlan.entryNodeId, "writer");
      assert.equal(body.runPlan.executionPolicy.singleWorker, true);
      assert.equal(body.materials[0].materialId, "brief");
      assert.deepEqual(body.sideEffects, []);
      assert.equal(body.quality.metrics.nodeCompletionRate, 0);
      assert.equal(body.quality.passed, false);
    } finally {
      await new Promise((resolveClose) => started.server.close(resolveClose));
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
