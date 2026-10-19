import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function sourceFiles(relative) {
  const directory = new URL(relative, root);
  const names = await readdir(directory);
  return Promise.all(names.filter((name) => name.endsWith(".mjs")).map(async (name) => ({
    name,
    source: await readFile(new URL(name, directory), "utf8")
  })));
}

test("Domain modules depend only on domain modules", async () => {
  const files = await sourceFiles("domain/");
  for (const { name, source } of files) {
    assert.doesNotMatch(source, /from\s+["'](?:node:|\.\.\/|.*(?:runtime|visualizer|api|public|infrastructure|application))/,
      `${name} must not depend on platform, transport, or outer layers`);
  }
});

test("Application modules do not depend on HTTP, filesystem, or runtime adapters", async () => {
  const files = await sourceFiles("application/");
  for (const { name, source } of files) {
    assert.doesNotMatch(source, /from\s+["'](?:node:|\.\.\/api|\.\.\/infrastructure|.*(?:dist\/runtime|dist\/visualizer))/,
      `${name} must depend on domain rules and injected ports`);
  }
});

test("startup recovery is an Application use case backed by an injected file adapter", async () => {
  const source = await readFile(new URL("server.mjs", root), "utf8");
  assert.match(source, /createRunRecoveryUseCases/);
  assert.match(source, /createFileRunRecoveryStore/);
  assert.doesNotMatch(source, /run-service\.mjs/);
});

test("resource API routes do not import storage, runtime, or filesystem modules", async () => {
  const files = await sourceFiles("api/");
  for (const { name, source } of files) {
    assert.doesNotMatch(source, /from\s+["'](?:node:fs|\.\.\/project-repository|.*(?:dist\/runtime|dist\/visualizer))/,
      `${name} must call injected application operations instead of infrastructure`);
  }
});

test("migrated Project, Package, Team, and Task lifecycle use cases have no repository facades", async () => {
  const source = await readFile(new URL("infrastructure/file-project-store.mjs", root), "utf8");
  assert.doesNotMatch(source, /from\s+["']\.\/application\//, "the repository must not compose Application use cases");
  assert.doesNotMatch(source, /export\s+async\s+function\s+(?:updateProject|invalidateProjectConfirmation|previewProjectBundle|listProjectTeams|replaceProjectTeams|createCollaborationProject|listCollaborationProjects|createProjectTask|startProjectTask|retryProjectTask|controlProjectTask|controlProjectRun|reviewProjectTask|deleteProjectTask|createProjectWorkspace|createClassicTeamProject|provisionBuiltInTeamVersions|forkTeamVersion|releaseTeamVersion|confirmProjectTeam|addProjectMaterials|addProjectMaterial|startProjectRun)\b/);
});

test("Project file store performs persistence only and contains no application or external adapter orchestration", async () => {
  const source = await readFile(new URL("infrastructure/file-project-store.mjs", root), "utf8");
  assert.doesNotMatch(source, /function projectStage\b|projectStage\s*:/);
  assert.doesNotMatch(source, /TEAM_PACKAGE_MODE|team-v2|artifactScope|bundle\.(?:packageDigest|teamCoreDigest)|credential field is not accepted|TEAM_IMPORT_DIGEST_MISMATCH/,
    "Team Package schema, digest, and credential validation belong outside the file store");
  assert.doesNotMatch(source, /saveProjectSystemSource|validateProjectSystemSource/,
    "Visualizer design persistence and validation belong behind the design application port");
  assert.match(source, /export async function listTeamRepository\(\{ includeUnreleased = false \} = \{\}\) \{\s*return fileTeamCatalog\.listTeamRepository\(\{ includeUnreleased \}\);\s*\}/,
    "release and archive catalog selection must be delegated to the team catalog");
  assert.doesNotMatch(source, /projectVisualizerStore|visualizer|caseTeamMaterializer|materialize\(|createWorkspace|inspectWorkspace/,
    "Visualizer workspace operations and case materialization belong to Application use cases and dedicated adapters");
  assert.doesNotMatch(source, /assertTaskTransition|loadProjectRunPlan|loadProjectRunState|redactText/,
    "Run projections and Task transitions belong outside the file store");
  assert.doesNotMatch(source, /computeProjectDefinitionDigest|computeTeamPackageCoreDigest|computePackageDigest/,
    "definition and package digest rules belong in Application use cases");
  assert.doesNotMatch(source, /runAttempts\s*:|currentState|from\s+["']\.\.\/demo-runner/,
    "Task/Run query projection and case execution services must stay outside the file store");
  assert.doesNotMatch(source, /activeTaskWorkers|waitForActiveTaskWorker|taskWorkers|isTerminalTaskStatus/,
    "Task worker coordination belongs to the worker adapter and Application query use cases");
  assert.match(source, /export async function removeProjectData\(/,
    "project compensation should expose a persistence-only deletion primitive to the Application use case");
});
