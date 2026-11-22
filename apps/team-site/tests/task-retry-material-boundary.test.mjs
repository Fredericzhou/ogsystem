import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTaskRetryUseCases } from "../application/task-retry-use-cases.mjs";
import { createFileTaskRetryStore } from "../infrastructure/file-task-retry-store.mjs";

test("Task retry reads material snapshots from the validated source Run inputs directory", async () => {
  const task = {
    taskId: "task-1",
    taskNumber: 1,
    status: "failed",
    currentRunId: "run-1",
    runIds: ["run-1"],
    teamVersionId: "team-1",
    lastError: "Runtime failed"
  };
  let startOptions;
  const useCases = createTaskRetryUseCases({
    taskStore: {
      async startTask(_projectId, _taskId, options) {
        startOptions = options;
        return { ...task, currentRunId: "run-2" };
      }
    },
    projectStore: {
      async getProject(projectId) {
        if (projectId === "team-1") return { workdir: "/tmp/team-1" };
        return {
          projectId,
          projectType: "collaboration",
          workspaceDir: "/tmp/project-1/workspace",
          taskRecords: [task]
        };
      }
    },
    runStore: {
      async readRunState() { return { status: "failed" }; },
      async loadMaterialSnapshots() {
        return [{
          materialId: "mat-1",
          snapshotPath: "inputs/input.txt",
          contentType: "text/plain",
          selectedRanges: [],
          consumingNodeIds: ["role-a"]
        }];
      },
      resolveMaterialPath() { throw new Error("current Project materials are not used for snapshot retries"); },
      async resolveRunArtifactPath(_projectId, _taskId, _runId, path) {
        return `/tmp/project-1/.ogs/runs/run-1/${path}`;
      },
      async resolveRunArtifactDirectory(_projectId, _taskId, _runId, path) {
        assert.equal(path, "inputs");
        return "/tmp/project-1/.ogs/runs/run-1/inputs";
      }
    }
  });

  const result = await useCases.retryProjectTask("project-1", "task-1", { mode: "sandbox" });
  assert.equal(result.currentRunId, "run-2");
  assert.equal(startOptions.retrySourceRoot, "/tmp/project-1/.ogs/runs/run-1/inputs");
  assert.deepEqual(startOptions.retryInputs, [{
    materialId: "mat-1",
    sourcePath: "/tmp/project-1/.ogs/runs/run-1/inputs/input.txt",
    contentType: "text/plain",
    selectedRanges: [],
    consumingNodeIds: ["role-a"]
  }]);
  assert.deepEqual(startOptions.materialSnapshotPolicy, { kind: "source_run_snapshot", sourceRunId: "run-1" });
});

test("Task retry requires the Run store to validate a source Run artifact directory", () => {
  assert.throws(() => createTaskRetryUseCases({
    taskStore: { startTask() {} },
    projectStore: { getProject() {} },
    runStore: {
      readRunState() {},
      loadMaterialSnapshots() {},
      resolveMaterialPath() {},
      resolveRunArtifactPath() {}
    }
  }), /Task retry requires Run state and material snapshot reads/);
});

test("Task retry recovers source snapshots when a prior retry failed before writing Run state", async () => {
  const task = {
    taskId: "task-1",
    taskNumber: 1,
    status: "failed",
    currentRunId: "run-2",
    runIds: ["run-1", "run-2"],
    teamVersionId: "team-1",
    lastError: "material source path must stay within the Project Workspace.",
    attemptRequests: {
      retryAttempt: { runId: "run-2", sourceRunId: "run-1", mode: "sandbox" }
    }
  };
  let startOptions;
  const useCases = createTaskRetryUseCases({
    taskStore: {
      async startTask(_projectId, _taskId, options) {
        startOptions = options;
        return { ...task, currentRunId: "run-3" };
      }
    },
    projectStore: {
      async getProject(projectId) {
        if (projectId === "team-1") return { workdir: "/tmp/team-1" };
        return { projectId, projectType: "collaboration", workspaceDir: "/tmp/project-1/workspace", taskRecords: [task] };
      }
    },
    runStore: {
      async readRunState() { return { status: "failed" }; },
      async loadMaterialSnapshots(_projectId, _taskId, runId) {
        if (runId === "run-2") {
          const error = new Error("missing current attempt materials");
          error.code = "ENOENT";
          throw error;
        }
        assert.equal(runId, "run-1");
        return [{ materialId: "mat-1", snapshotPath: "inputs/input.txt", contentType: "text/plain" }];
      },
      resolveMaterialPath() { throw new Error("current Project materials are not used for snapshot retries"); },
      async resolveRunArtifactPath(_projectId, _taskId, runId, path) { return `/tmp/project-1/.ogs/runs/${runId}/${path}`; },
      async resolveRunArtifactDirectory(_projectId, _taskId, runId, path) {
        assert.equal(runId, "run-1");
        assert.equal(path, "inputs");
        return "/tmp/project-1/.ogs/runs/run-1/inputs";
      }
    }
  });

  const result = await useCases.retryProjectTask("project-1", "task-1", { mode: "sandbox" });
  assert.equal(result.currentRunId, "run-3");
  assert.equal(startOptions.retrySourceRunId, "run-2");
  assert.equal(startOptions.retrySourceRoot, "/tmp/project-1/.ogs/runs/run-1/inputs");
  assert.deepEqual(startOptions.materialSnapshotPolicy, { kind: "source_run_snapshot", sourceRunId: "run-1" });
});

test("Run artifact directory resolution is scoped to an owned Run and rejects symlinks", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-task-retry-material-root-"));
  const projectRoot = join(projectsRoot, "project-1");
  const runRoot = join(projectRoot, ".ogs", "runs", "run-1");
  const task = {
    taskId: "task-1",
    taskNumber: 1,
    currentRunId: "run-1",
    runIds: ["run-1"],
    teamVersionId: "team-1",
    teamCoreDigest: "a".repeat(64),
    teamDigestVersion: 1
  };
  try {
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await mkdir(join(runRoot, "inputs"), { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
    await writeFile(join(runRoot, "run-owner.json"), JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId: "project-1",
      taskId: "task-1",
      runId: "run-1",
      teamVersionId: "team-1",
      taskNumber: 1,
      attemptNumber: 1,
      teamCoreDigest: "a".repeat(64),
      teamDigestVersion: 1
    }));
    const store = createFileTaskRetryStore({ projectsRoot });
    assert.equal(await store.resolveRunArtifactDirectory("project-1", "task-1", "run-1", "inputs"), join(runRoot, "inputs"));
    await assert.rejects(() => store.resolveRunArtifactDirectory("project-1", "task-1", "run-1", "../outside"), /directory is invalid/);
    const outside = join(projectsRoot, "outside");
    await mkdir(outside);
    await symlink(outside, join(runRoot, "linked-inputs"));
    await assert.rejects(() => store.resolveRunArtifactDirectory("project-1", "task-1", "run-1", "linked-inputs"), /symlinks or junctions/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
