import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { FileTeamArtifactStore } from "../../../dist/team-ir/index.js";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { createTeamIrArtifactUseCases } from "../application/team-ir-artifact-use-cases.mjs";

test("Project Run input Artifacts are registered, frozen to the mounted TeamVersion, and reject foreign refs", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ogs-team-ir-task-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = join(root, "project-1");
  const teamRoot = join(root, "team-1");
  await Promise.all([mkdir(join(projectRoot, ".ogs"), { recursive: true }), mkdir(teamRoot, { recursive: true })]);
  const teamIR = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url), "utf8"));
  teamIR.runInput.artifactSlots = { brief: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
  const semanticDigest = teamIRSemanticDigest(teamIR);
  const compiledPlanDigest = "b".repeat(64);
  const teamIrStore = createFileTeamIrStore();
  await teamIrStore.save({ workdir: teamRoot, teamIR });
  const team = { projectId: "team-1", teamVersionId: "team-1", teamVersionStatus: "released", workdir: teamRoot, teamIrSemanticDigest: semanticDigest, compiledPlanDigest };
  const project = {
    projectId: "project-1", projectType: "collaboration", workdir: projectRoot,
    mountedTeams: [{ teamId: "team-1", teamVersionId: "team-1", teamIrSemanticDigest: semanticDigest, compiledPlanDigest }]
  };
  const useCases = createTeamIrArtifactUseCases({
    getProject: async (id) => id === project.projectId ? project : { ...project, projectId: id },
    getTeamVersion: async (id) => id === team.teamVersionId ? team : undefined,
    teamIrStore,
    artifactStoreFactory: async ({ project: owner }) => new FileTeamArtifactStore(join(owner.workdir, ".ogs", "team-artifacts"))
  });
  const registered = await useCases.registerProjectRunInputArtifact("project-1", {
    teamVersionId: "team-1", slotId: "brief", mediaType: "text/plain", contentBase64: Buffer.from("Use this input").toString("base64")
  }, { id: "local-operator" });
  assert.equal(registered.projectId, "project-1");
  assert.equal(registered.slotId, "brief");
  assert.match(registered.artifactId, /^art_[0-9a-f-]{36}$/);
  const frozen = await useCases.validateRunInputAttachments({ project, team, attachments: { brief: { artifactId: registered.artifactId, mediaType: registered.mediaType } } });
  assert.deepEqual(frozen, { brief: { artifactId: registered.artifactId, mediaType: "text/plain" } });
  await assert.rejects(
    useCases.validateRunInputAttachments({ project: { ...project, projectId: "project-2" }, team, attachments: { brief: frozen.brief } }),
    (error) => error.code === "ARTIFACT_ACCESS_DENIED"
  );
  await assert.rejects(
    useCases.validateRunInputAttachments({ project, team, attachments: {} }),
    (error) => error.code === "RUN_INPUT_ARTIFACT_REQUIRED"
  );
  await assert.rejects(useCases.registerProjectRunInputArtifact("project-1", {
    teamVersionId: "team-1", slotId: "brief", mediaType: "text/plain", contentBase64: "not-base64"
  }, { id: "local-operator" }), /ARTIFACT_CONTENT_INVALID/);
});
