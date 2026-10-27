import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { chromium } from "@playwright/test";
import { cases } from "../cases.mjs";
import { buildCaseSystem } from "../demo-runner.mjs";
import { createFileRoleSourceCatalogStore } from "../infrastructure/file-role-source-catalog-store.mjs";
import { parseMarkdownRole, convertMarkdownRole } from "../../../tools/agent-source/markdown-role-adapter.mjs";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const execFile = promisify(execFileCallback);
const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(appRoot, "../..");
const fixturePath = join(repoRoot, "tests/fixtures/agent-source/agency-agents/engineering/engineering-frontend-developer.md");

async function git(cwd, ...args) {
  await execFile("git", ["-c", "user.name=Role Source E2E", "-c", "user.email=role-source-e2e@example.test", ...args], { cwd });
}

async function jsonRequest(baseUrl, path, method = "GET", body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { response, payload: await response.json() };
}

test("selected source role becomes a persisted Team role in a real Team Site", async (t) => {
  const dataRoot = await mkdtemp(join(tmpdir(), "ogs-role-source-real-team-"));
  const port = await reserveBrowserSafePort();
  const projectsRoot = join(dataRoot, "projects");
  const configRoot = join(dataRoot, "config");
  const sourceRoot = join(configRoot, "role-sources", "sources", "agency-agents", "checkout");
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: configRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const startedAt = Date.now();
    let baseUrl;
    while (!baseUrl && Date.now() - startedAt < 15000) {
      baseUrl = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!baseUrl) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(baseUrl, "Team Site did not start: " + output);

    await mkdir(join(sourceRoot, "engineering"), { recursive: true });
    await git(sourceRoot, "init", "--quiet");
    await git(sourceRoot, "remote", "add", "origin", "https://github.com/msitarzewski/agency-agents.git");
    await writeFile(join(sourceRoot, "engineering/engineering-frontend-developer.md"), await readFile(fixturePath, "utf8"));
    await git(sourceRoot, "add", ".");
    await git(sourceRoot, "commit", "--quiet", "-m", "Pinned Agency Agents fixture");

    const roleSourceStore = createFileRoleSourceCatalogStore({
      root: join(configRoot, "role-sources"),
      resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
      adapters: {
        "agency-agents-markdown": {
          version: "1",
          parseMarkdownRole,
          convertMarkdownRole,
          shouldIndex: (path) => path.includes("/") && !new Set([".github", "docs", "examples", "integrations", "scripts"]).has(path.split("/")[0].toLowerCase())
        }
      }
    });
    await roleSourceStore.configureSource({
      sourceId: "agency-agents", name: "Agency Agents", gitUrl: "https://github.com/msitarzewski/agency-agents.git",
      branch: "main", adapterId: "agency-agents-markdown"
    });
    const index = await roleSourceStore.refreshSourceIndex("agency-agents");
    assert.equal(index.roles.length, 1);
    assert.equal(index.roles[0].name, "Frontend Developer");

    const createTeam = async (name) => {
      const { response, payload } = await jsonRequest(baseUrl, "/api/v1/team-factory", "POST", { name, overview: "Disposable role import verification team", locale: "en" });
      assert.equal(response.status, 201, JSON.stringify(payload));
      return payload.teamVersionId || payload.projectId;
    };
    const addRoleSlot = async (teamVersionId) => {
      await writeFile(join(projectsRoot, teamVersionId, ".ogs/laws.json"), JSON.stringify({ laws: [{ lawId: "law.minimal.base", constraints: { forbiddenToolRefs: [], maxTransitions: 32, allowNoopWithoutExecutionBinding: true } }] }));
      const sourceRole = cases.find((item) => item.id === "software-team").roles.find((role) => role.id === "backend-planner");
      const systemSource = buildCaseSystem({
        ...cases.find((item) => item.id === "software-team"),
        roles: [{ ...sourceRole, id: "demo-analyst" }],
        joins: [],
        loopBudgets: [],
        projections: [],
        flows: [["__system_start__", "demo-analyst", "START"], ["demo-analyst", "__system_end__", "ANALYSIS_DONE"]]
      }).replace("%% law.global=law.site.software-team", "%% law.global=law.minimal.base");
      const { response, payload } = await jsonRequest(baseUrl, "/api/v1/team-versions/" + teamVersionId + "/design", "PUT", { systemSource });
      assert.equal(response.status, 200, JSON.stringify(payload));
    };
    const verifiedTeamId = await createTeam("Verified Source Role Team");
    const invalidTeamId = await createTeam("Invalid Source Event Team");
    const pendingTeamId = await createTeam("Unverified Source Role Team");
    await Promise.all([verifiedTeamId, invalidTeamId, pendingTeamId].map(addRoleSlot));
    const sourceRole = index.roles[0];
    const sourceCommit = index.commit;

    // Case 1: the Team Draft copy endpoint converts the selected pinned source role into a standard package.
    const converted = await jsonRequest(baseUrl,
      "/api/v1/studio/role-sources/agency-agents/roles/" + encodeURIComponent(sourceRole.roleId) + "/copy",
      "POST", { teamVersionId: verifiedTeamId, roleId: "demo-analyst", commit: sourceCommit, events: ["ANALYSIS_DONE"], allowedTools: [] });
    assert.equal(converted.response.status, 201, JSON.stringify(converted.payload));
    const verifiedAssetsResult = await jsonRequest(baseUrl, "/api/v1/team-versions/" + verifiedTeamId + "/design/assets");
    assert.equal(verifiedAssetsResult.response.status, 200);
    const verifiedAssets = verifiedAssetsResult.payload;
    const verifiedRoleFiles = verifiedAssets.roles["demo-analyst"];
    assert.ok(verifiedRoleFiles, "imported role files should be attached to the Team Draft role");
    const teamRole = JSON.parse(verifiedRoleFiles["role.json"]);
    const teamSource = JSON.parse(verifiedRoleFiles["source.json"]);
    assert.equal(teamRole.roleId, "demo-analyst");
    assert.equal(teamRole.name, "Frontend Developer");
    assert.deepEqual(teamRole.outputs.events, ["ANALYSIS_DONE"]);
    assert.deepEqual(teamRole.constraints.allowedTools, []);
    assert.equal(teamSource.path, sourceRole.path);
    assert.equal(teamSource.commit, sourceCommit);
    assert.equal(teamSource.verification.status, "verified");
    for (const file of ["agent.md", "prompt.md", "role.json", "output.schema.json", "source.json"]) assert.ok(verifiedRoleFiles[file], `missing ${file}`);

    // Case 2: source events that disagree with the real Team topology are rejected.
    const mismatch = await jsonRequest(baseUrl,
      "/api/v1/studio/role-sources/agency-agents/roles/" + encodeURIComponent(sourceRole.roleId) + "/copy",
      "POST", { teamVersionId: invalidTeamId, roleId: "demo-analyst", commit: sourceCommit, events: ["WRONG_EVENT"], allowedTools: [] });
    assert.equal(mismatch.response.status, 400);
    assert.match(mismatch.payload.error, /TEAM_SOURCE_EVENTS_MISMATCH/);
    const invalidAssets = (await jsonRequest(baseUrl, "/api/v1/team-versions/" + invalidTeamId + "/design/assets")).payload;
    assert.equal(invalidAssets.roles?.["demo-analyst"]?.["source.json"], undefined);

    // Case 3: an unconfirmed copy is saved but remains unverified and cannot be released.
    const pendingCopy = await jsonRequest(baseUrl,
      "/api/v1/studio/role-sources/agency-agents/roles/" + encodeURIComponent(sourceRole.roleId) + "/copy",
      "POST", { teamVersionId: pendingTeamId, roleId: "demo-analyst", commit: sourceCommit });
    assert.equal(pendingCopy.response.status, 201);
    const pendingAssets = (await jsonRequest(baseUrl, "/api/v1/team-versions/" + pendingTeamId + "/design/assets")).payload;
    const pendingSource = JSON.parse(pendingAssets.roles["demo-analyst"]["source.json"]);
    assert.equal(pendingSource.verification.status, "unverified");
    const readiness = await jsonRequest(baseUrl, "/api/v1/team-versions/" + pendingTeamId + "/release-readiness");
    assert.equal(readiness.response.status, 200);
    assert.equal(readiness.payload.ready, false);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait));
    await rm(dataRoot, { recursive: true, force: true });
  }
});
