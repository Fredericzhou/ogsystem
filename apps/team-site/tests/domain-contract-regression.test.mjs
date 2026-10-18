import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import test from "node:test";

async function withStore(prefix, callback) {
  const projectsRoot = await mkdtemp(join(tmpdir(), `ogs-site-${prefix}-`));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?domain-contract=${prefix}-${Date.now()}-${Math.random()}`);
  try {
    return await callback(store, projectsRoot);
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
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
    await waitForTerminal(store, project.projectId, reserved.runId);

    const afterRun = await store.getProject(project.projectId);
    assert.equal(afterRun.projectDefinitionDigest, baselineDigest);
    assert.ok(afterRun.taskRecords.some((record) => record.runId === reserved.runId));
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
    await store.startProjectTask(project.projectId, task.taskId, { mode: "dry-run" });
    await assert.rejects(
      () => store.replaceProjectTeams(project.projectId, [firstTeam.projectId]),
      /PROJECT_TEAM_UPDATE_LOCKED/
    );
    await store.controlProjectTask(project.projectId, task.taskId, "cancel");
    await waitForTerminal(store, project.projectId, (await store.getProjectTask(project.projectId, task.taskId)).runId);
    const afterCancel = await store.replaceProjectTeams(project.projectId, [firstTeam.projectId]);
    assert.deepEqual(afterCancel.mountedTeams.map((team) => team.teamVersionId), [firstTeam.projectId]);
  });
});

test("HTTP project creation failure leaves no half-created project", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-http-rollback-"));
  const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: "0", OGS_SITE_PROJECTS_DIR: projectsRoot },
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
    assert.deepEqual((await readdir(projectsRoot)).filter((entry) => entry !== ".site"), []);
  } finally {
    server.kill();
    await new Promise((resolveExit) => server.once("exit", resolveExit));
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("stale staging directories are cleaned on the next process start", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-site-process-recovery-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?process-recovery=${Date.now()}`);
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
