import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import test from "node:test";
import { createRunResultUseCases } from "../application/run-result-use-cases.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";
import { createRecentRunUseCases } from "../application/recent-run-use-cases.mjs";
import { createFileRecentRunStore } from "../infrastructure/file-recent-run-store.mjs";
import { withRunQueryUseCases } from "./run-query-test-helpers.mjs";

async function withStore(prefix, callback) {
  const projectsRoot = await mkdtemp(join(tmpdir(), `ogs-site-${prefix}-`));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const repository = await import(`../infrastructure/file-project-store.mjs?domain-contract=${prefix}-${Date.now()}-${Math.random()}`);
  const store = withRunQueryUseCases(repository, projectsRoot);
  try {
    return await callback(store, projectsRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rm(projectsRoot, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== "ENOTEMPTY" || attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}

async function createReleasedTeam(store, name) {
  const team = await store.createProject({
    name,
    overview: "Validate the domain contract.",
    templateId: "empty"
  });
  return store.confirmProjectTeam(team.projectId, { release: true });
}

async function waitForTerminal(store, projectId, runId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const run = await store.getProjectRun(projectId, runId);
    if (["completed", "failed", "cancelled"].includes(run.state.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Run did not reach a terminal state in time.");
}

async function waitForTaskTerminal(store, projectId, taskId) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const task = await store.getProjectTask(projectId, taskId);
    if (["completed", "failed", "cancelled", "deleted"].includes(task.status)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Task did not reach a terminal state in time.");
}

test("teamCoreDigest ignores team metadata and run files", async () => {
  await withStore("digest-stability", async (store) => {
    const team = await createReleasedTeam(store, "Digest Stability Team");
    const baselineDigest = team.teamCoreDigest;
    assert.match(baselineDigest, /^[a-f0-9]{64}$/);
    assert.equal(team.teamRootId, team.teamId);
    assert.equal(team.teamVersionId, team.projectId);
    assert.equal(JSON.parse(await readFile(join(team.workdir, ".site", "team.json"), "utf8")).teamId, team.teamRootId);
    assert.equal(JSON.parse(await readFile(join(team.workdir, ".site", "team-version.json"), "utf8")).teamVersionId, team.teamVersionId);

    await store.updateProject(team.projectId, { name: "Renamed Digest Stability Team" });
    const metaPath = join(team.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metaPath, "utf8"));
    await writeFile(metaPath, JSON.stringify({ ...metadata, icon: "new-icon.svg" }, null, 2) + "\n", "utf8");

    const runDir = join(team.workdir, ".ogs", "runs", "digest-fixture");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "state.json"), JSON.stringify({ status: "completed" }) + "\n", "utf8");
    await writeFile(join(team.workdir, ".ogs", "runs-index.json"), JSON.stringify({ runs: [{ runId: "digest-fixture" }] }) + "\n", "utf8");

    const reconfirmed = await store.confirmProjectTeam(team.projectId, { release: true });
    assert.equal(reconfirmed.teamCoreDigest, baselineDigest);
  });
});

test("projectDefinitionDigest ignores newly created Run history", async () => {
  await withStore("project-digest", async (store) => {
    const team = await createReleasedTeam(store, "Run History Team");
    const project = await store.createCollaborationProject({
      name: "Run History Project",
      overview: "Keep runtime history outside the project definition.",
      teamVersionIds: [team.projectId]
    });
    const baselineDigest = project.projectDefinitionDigest;
    assert.match(baselineDigest, /^[a-f0-9]{64}$/);

    const task = await store.createProjectTask(project.projectId, {
      input: "Create a dry-run history entry.",
      teamVersionId: team.projectId,
      idempotencyKey: "domain-contract-run"
    });
    const reserved = await store.startProjectTask(project.projectId, task.taskId, { mode: "dry-run" });
    await waitForTerminal(store, project.projectId, reserved.currentRunId);

    const afterRun = await store.getProject(project.projectId);
    assert.equal(afterRun.projectDefinitionDigest, baselineDigest);
    assert.ok(afterRun.taskRecords.some((record) => record.currentRunId === reserved.currentRunId));
  });
});

test("retrying a collaboration Task creates a new immutable Run attempt", async () => {
  await withStore("task-run-retry", async (store, projectsRoot) => {
    const team = await createReleasedTeam(store, "Task Run Retry Team");
    const project = await store.createCollaborationProject({
      name: "Task Run Retry Project",
      overview: "Retry a failed attempt without creating another Task.",
      teamVersionIds: [team.teamVersionId]
    });
    await store.confirmProjectTeam(project.projectId);
    const task = await store.createProjectTask(project.projectId, {
      input: "Retry this request.",
      teamVersionId: team.teamVersionId,
      idempotencyKey: "task-run-retry"
    });
    const originalRunId = "failed-attempt";
    const originalRunDir = join(team.workdir, ".ogs", "runs", originalRunId);
    await mkdir(join(originalRunDir, "control"), { recursive: true });
    await writeFile(join(originalRunDir, "task.json"), JSON.stringify({ prompt: task.input }), "utf8");
    await writeFile(join(originalRunDir, "control", "materials.json"), "[]\n", "utf8");
    await writeFile(join(originalRunDir, "control", "state.json"), JSON.stringify({ status: "failed", error: "fixture failure" }), "utf8");

    const projectMetaPath = join(project.workdir, ".site", "project.json");
    const projectMeta = JSON.parse(await readFile(projectMetaPath, "utf8"));
    projectMeta.taskRecords = projectMeta.taskRecords.map((record) => record.taskId === task.taskId
      ? { ...record, currentRunId: originalRunId, runIds: [originalRunId], runProjectId: team.projectId, status: "failed", lastError: "fixture failure" }
      : record);
    await writeFile(projectMetaPath, `${JSON.stringify(projectMeta, null, 2)}\n`, "utf8");

    const retry = await store.retryProjectTask(project.projectId, task.taskId, { mode: "dry-run", idempotencyKey: "retry-1" });
    assert.equal(retry.taskId, task.taskId);
    assert.notEqual(retry.currentRunId, originalRunId);
    const replay = await store.retryProjectTask(project.projectId, task.taskId, { mode: "dry-run", idempotencyKey: "retry-1" });
    assert.equal(replay.currentRunId, retry.currentRunId);
    await assert.rejects(() => store.retryProjectTask(project.projectId, task.taskId, { mode: "sandbox", idempotencyKey: "retry-1" }), /IDEMPOTENCY_KEY_REUSE/);
    const retriedTask = await waitForTaskTerminal(store, project.projectId, task.taskId);
    assert.deepEqual(retriedTask.runIds, [originalRunId, retry.currentRunId]);
    assert.equal(retriedTask.currentRunId, retry.currentRunId);
    const originalRun = await store.getProjectRun(project.projectId, originalRunId);
    const retriedRun = await store.getProjectRun(project.projectId, retry.currentRunId);
    assert.equal(originalRun.isCurrent, false);
    assert.equal(originalRun.attemptNumber, 1);
    assert.equal(retriedRun.attemptNumber, 2);
    for (const run of [originalRun, retriedRun]) {
      assert.equal(run.collaborationProjectId, project.projectId);
      assert.equal(Object.hasOwn(run, "projectId"), false);
    }
    const recentRunUseCases = createRecentRunUseCases({
      listProjects: store.listProjects,
      runArtifactStore: createFileRecentRunStore({ projectsRoot })
    });
    const recentAttempts = (await recentRunUseCases.listRecentProjectRuns(50)).filter((run) => run.taskId === task.taskId);
    assert.deepEqual(recentAttempts.map((run) => run.attemptNumber).sort(), [1, 2]);
    assert.equal(recentAttempts.filter((run) => run.isCurrent).length, 1);
    const statePath = join(team.workdir, ".ogs", "runs", retry.currentRunId, "state.json");
    const runSnapshot = JSON.parse(await readFile(statePath, "utf8"));
    runSnapshot.graphState = { ...(runSnapshot.graphState || {}), finalOutput: "Authorization: Bearer abcdefghijklmnop" };
    await writeFile(statePath, `${JSON.stringify(runSnapshot, null, 2)}\n`, "utf8");
    const resultUseCases = createRunResultUseCases({
      getRun: store.getProjectRun,
      runResultStore: createFileRunResultStore({ projectsRoot })
    });
    const result = await resultUseCases.getProjectRunResult(project.projectId, retry.currentRunId);
    assert.equal(result.available, true);
    assert.match(result.result.finalOutput, /\[REDACTED\]/);
    assert.doesNotMatch(result.result.finalOutput, /abcdefghijklmnop/);
    assert.equal((await store.getProjectRun(project.projectId, originalRunId)).taskId, task.taskId);
    assert.equal(Object.hasOwn(result, "projectId"), false);

    const teamMeta = JSON.parse(await readFile(join(team.workdir, ".site", "project.json"), "utf8"));
    assert.equal((teamMeta.taskRecords || []).some((record) => record.taskId === retry.currentRunId), false);
  });
});

test("a reserved Task with a missing Run state can be retried after recovery", async () => {
  await withStore("missing-run-retry", async (store) => {
    const team = await createReleasedTeam(store, "Missing Run Retry Team");
    const project = await store.createCollaborationProject({
      name: "Missing Run Retry Project",
      overview: "Recover a reservation that did not create its Run state.",
      teamVersionIds: [team.teamVersionId]
    });
    const task = await store.createProjectTask(project.projectId, {
      input: "Retry the recovered reservation.",
      teamVersionId: team.teamVersionId
    });
    const missingRunId = "missing-reserved-run";
    const metadataPath = join(project.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    metadata.taskRecords = metadata.taskRecords.map((record) => record.taskId === task.taskId
      ? {
          ...record,
          currentRunId: missingRunId,
          runIds: [missingRunId],
          runProjectId: team.teamVersionId,
          status: "failed",
          lastError: "RUN_STATE_MISSING: reserved Run state was not created."
        }
      : record);
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    const retry = await store.retryProjectTask(project.projectId, task.taskId, {
      mode: "dry-run",
      idempotencyKey: "missing-state-retry"
    });
    assert.equal(retry.taskId, task.taskId);
    assert.notEqual(retry.currentRunId, missingRunId);
    const completed = await waitForTaskTerminal(store, project.projectId, task.taskId);
    assert.equal(completed.status, "completed");
    assert.deepEqual(completed.runIds, [missingRunId, retry.currentRunId]);
    assert.equal((await store.getProjectRun(project.projectId, retry.currentRunId)).attemptNumber, 2);
  });
});

test("same-name Team and collaboration Project coexist, while same-scope duplicates are rejected", async () => {
  await withStore("name-scope", async (store) => {
    const sharedName = "Shared Domain Name";
    const team = await createReleasedTeam(store, sharedName);
    const project = await store.createCollaborationProject({
      name: sharedName,
      overview: "A collaboration project may share a name with its team.",
      teamVersionIds: [team.projectId]
    });

    assert.equal(team.name, sharedName);
    assert.equal(project.name, sharedName);
    assert.notEqual(team.projectId, project.projectId);
    assert.equal(project.projectType, "collaboration");

    await assert.rejects(
      () => store.createProject({ name: sharedName, overview: "Duplicate team name.", templateId: "empty" }),
      /TEAM_NAME_EXISTS/
    );
    await assert.rejects(
      () => store.createCollaborationProject({ name: sharedName, overview: "Duplicate project name.", teamVersionIds: [team.projectId] }),
      /PROJECT_NAME_EXISTS/
    );
  });
});

test("concurrent same-name Team draft creation commits exactly one workspace", async () => {
  await withStore("team-name-concurrency", async (store, projectsRoot) => {
    const results = await Promise.allSettled([
      store.createTeamDraft({ name: "Concurrent Name Team", overview: "First request." }),
      store.createTeamDraft({ name: "Concurrent Name Team", overview: "Second request." })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.match(String(rejection.reason), /TEAM_NAME_EXISTS/);
    const teams = (await store.listProjects()).filter((project) => project.projectType === "team"
      && project.name.toLocaleLowerCase() === "concurrent name team");
    assert.equal(teams.length, 1);
    const workspaces = (await readdir(projectsRoot)).filter((entry) => /^concurrent-name-team-[a-f0-9]{8}$/.test(entry));
    assert.equal(workspaces.length, 1);
  });
});

test("concurrent same-name Collaboration Project creation commits exactly one workspace", async () => {
  await withStore("project-name-concurrency", async (store, projectsRoot) => {
    const team = await createReleasedTeam(store, "Concurrent Project Team");
    const results = await Promise.allSettled([
      store.createCollaborationProject({ name: "Concurrent Project", overview: "First request.", teamVersionIds: [team.teamVersionId] }),
      store.createCollaborationProject({ name: "Concurrent Project", overview: "Second request.", teamVersionIds: [team.teamVersionId] })
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rejection = results.find((result) => result.status === "rejected");
    assert.match(String(rejection.reason), /PROJECT_NAME_EXISTS/);
    const projects = (await store.listCollaborationProjects()).filter((project) => project.name === "Concurrent Project");
    assert.equal(projects.length, 1);
    const workspaces = (await readdir(projectsRoot)).filter((entry) => /^concurrent-project-[a-f0-9]{8}$/.test(entry));
    assert.equal(workspaces.length, 1);
  });
});

test("multi-team creation mounts all teams and rolls back when the second team fails", async () => {
  await withStore("multi-team-atomicity", async (store, projectsRoot) => {
    const firstTeam = await createReleasedTeam(store, "First Mounted Team");
    const secondTeam = await createReleasedTeam(store, "Second Mounted Team");
    const project = await store.createCollaborationProject({
      name: "All Teams Project",
      teamVersionIds: [firstTeam.projectId, secondTeam.projectId]
    });
    assert.deepEqual(
      project.mountedTeams.map((team) => team.teamVersionId),
      [firstTeam.projectId, secondTeam.projectId]
    );

    const draftTeam = await store.createProject({
      name: "Unreleased Second Team",
      overview: "This team must not be mounted.",
      templateId: "empty"
    });
    await assert.rejects(
      () => store.createCollaborationProject({
        name: "Rolled Back Project",
        teamVersionIds: [firstTeam.projectId, draftTeam.projectId]
      }),
      /TEAM_VERSION_NOT_RELEASED/
    );

    const projects = await store.listProjects();
    assert.equal(projects.some((item) => item.projectType === "collaboration" && item.name === "Rolled Back Project"), false);
    const entries = await readdir(projectsRoot);
    assert.equal(entries.some((entry) => entry.startsWith("rolled-back-project-")), false);
  });
});

test("project team replacement updates the existing project and locks during an active run", async () => {
  await withStore("project-team-replacement", async (store) => {
    const firstTeam = await createReleasedTeam(store, "Replacement Team A");
    const secondTeam = await createReleasedTeam(store, "Replacement Team B");
    const project = await store.createCollaborationProject({
      name: "Replace Project Teams",
      overview: "Manage teams without creating another project.",
      teamVersionIds: [firstTeam.projectId]
    });

    const replaced = await store.replaceProjectTeams(project.projectId, [secondTeam.projectId]);
    assert.equal(replaced.projectId, project.projectId);
    assert.deepEqual(replaced.mountedTeams.map((team) => team.teamVersionId), [secondTeam.projectId]);
    assert.notEqual(replaced.projectDefinitionDigest, project.projectDefinitionDigest);
    assert.equal((await store.listCollaborationProjects()).filter((item) => item.name === project.name).length, 1);

    const task = await store.createProjectTask(project.projectId, {
      input: "Keep the project definition stable while running.",
      teamVersionId: secondTeam.projectId,
      idempotencyKey: "replacement-active-run"
    });
    await store.controlProjectTask(project.projectId, task.taskId, "start");
    await assert.rejects(
      () => store.replaceProjectTeams(project.projectId, [firstTeam.projectId]),
      /PROJECT_TEAM_UPDATE_LOCKED/
    );
    await store.controlProjectTask(project.projectId, task.taskId, "cancel");
    await waitForTaskTerminal(store, project.projectId, task.taskId);
    const afterCancel = await store.replaceProjectTeams(project.projectId, [firstTeam.projectId]);
    assert.deepEqual(afterCancel.mountedTeams.map((team) => team.teamVersionId), [firstTeam.projectId]);
  });
});

test("HTTP project creation failure leaves no half-created project", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-http-rollback-"));
  const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  try {
    const startedAt = Date.now();
    let baseUrl;
    while (!baseUrl && Date.now() - startedAt < 10000) {
      baseUrl = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!baseUrl) await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    assert.ok(baseUrl, `site server did not start: ${output}`);
    const response = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "HTTP Rollback Project", overview: "invalid team", teamVersionIds: ["missing-team"] })
    });
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /Project not found/);
    assert.deepEqual((await (await fetch(`${baseUrl}/api/v1/projects`)).json()).projects, []);
    const builtIns = await fetch(`${baseUrl}/api/v1/team-repository?pageSize=50`).then((result) => result.json());
    assert.ok(builtIns.teams.length > 0);
    assert.ok(builtIns.teams.every((team) => team.builtIn && !team.teamVersionId.startsWith("case:")));
    const storedNames = await readdir(projectsRoot);
    assert.equal(storedNames.filter((entry) => entry !== ".site" && entry !== ".staging").length, builtIns.teams.length);
  } finally {
    server.kill();
    await new Promise((resolveExit) => server.once("exit", resolveExit));
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("stale staging directories are cleaned on the next process start", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-process-recovery-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../infrastructure/file-project-store.mjs?process-recovery=${Date.now()}`);
  try {
    const staleDir = join(projectsRoot, ".staging", "crashed-project");
    await mkdir(join(staleDir, ".site"), { recursive: true });
    await writeFile(join(staleDir, ".site", "project.json"), "{\"projectId\":\"crashed-project\"}\n", "utf8");
    assert.deepEqual(await store.listProjects(), []);
    await assert.rejects(() => readFile(join(staleDir, ".site", "project.json")), { code: "ENOENT" });
    await assert.rejects(() => readFile(join(projectsRoot, ".staging"), "utf8"), { code: "ENOENT" });
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
