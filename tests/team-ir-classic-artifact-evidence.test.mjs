import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, FileTeamArtifactStore, FileTeamRunStore, TeamRuntime, validateTeamIr } from "../dist/team-ir/index.js";

const fixtureUrl = new URL("../examples/team-ir-v2/classic-artifact-evidence.json", import.meta.url);

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, "utf8"));
}

test("classic artifact evidence team validates and executes with Run grants, handoff provenance, and opaque result refs", async (t) => {
  const team = await loadFixture();
  assert.deepEqual(validateTeamIr(team).filter((diagnostic) => diagnostic.severity === "error"), []);
  const closure = {
    packageDigests: Object.fromEntries(team.agents.map((agent) => [agent.packageRef, "a".repeat(64)])),
    bindingDigests: Object.fromEntries(team.bindings.map((binding) => [binding.id, "b".repeat(64)])),
    adapterVersions: { model: "fixture-model-adapter/1" }
  };
  const plan = compileTeamIr(team, closure);
  const root = await mkdtemp(join(tmpdir(), "team-ir-classic-artifact-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactsRoot = join(root, "artifacts");
  const artifactStore = new FileTeamArtifactStore(artifactsRoot);
  const owner = { projectId: "artifact-evidence-project", runId: "artifact-evidence-run" };

  await assert.rejects(artifactStore.registerRunInput({
    team,
    projectId: owner.projectId,
    slotId: "brief",
    mediaType: "text/markdown",
    content: Buffer.from("unauthorized brief"),
    authorizeUpload: () => false
  }), (error) => error?.code === "ARTIFACT_ACCESS_DENIED");

  const brief = await artifactStore.registerRunInput({
    team,
    projectId: owner.projectId,
    slotId: "brief",
    mediaType: "text/markdown",
    content: Buffer.from("# Evidence brief\nInclude the release constraints."),
    authorizeUpload: () => true
  });
  const observed = { analystBrief: undefined, editorDraft: undefined, analystDraftRef: undefined, editorReportRef: undefined };
  const bindings = {
    "binding:evidence-analyst": {
      async invoke(invocation) {
        assert.deepEqual(invocation.input.artifacts, { brief });
        observed.analystBrief = Buffer.from(await invocation.artifactResolver.read(brief.artifactId)).toString();
        await assert.rejects(
          invocation.artifactResolver.read("art_00000000-0000-0000-0000-000000000000"),
          (error) => error?.code === "ARTIFACT_ACCESS_DENIED"
        );
        return {
          kind: "completed",
          output: {
            event: "A_DONE",
            data: { analysis: "The brief requires a verifiable release checklist." },
            artifacts: { draft: { mediaType: "text/markdown", content: Buffer.from("# Analysis\nKeep the evidence attached.") } }
          }
        };
      }
    },
    "binding:evidence-editor": {
      async invoke(invocation) {
        const draft = invocation.input.artifacts.draft;
        observed.analystDraftRef = draft;
        observed.editorDraft = Buffer.from(await invocation.artifactResolver.read(draft.artifactId)).toString();
        await assert.rejects(
          invocation.artifactResolver.read("art_00000000-0000-0000-0000-000000000001"),
          (error) => error?.code === "ARTIFACT_ACCESS_DENIED"
        );
        return {
          kind: "completed",
          output: {
            event: "B_DONE",
            data: { summary: "Evidence report ready." },
            artifacts: { report: { mediaType: "text/markdown", content: Buffer.from("# Final evidence report") } }
          }
        };
      }
    }
  };
  const runStore = new FileTeamRunStore(join(root, "runs"));
  const runtime = new TeamRuntime({
    store: runStore,
    clock: { now: () => 100, sleep: () => new Promise(() => {}) },
    bindings,
    artifactStore
  });

  await runtime.createRun(plan, {
    ...owner,
    task: "Prepare an evidence-backed release report.",
    input: { request: "Prepare a release evidence report." },
    attachments: { brief }
  });
  const result = await runtime.executeRun(plan, owner.runId);

  assert.equal(result.status, "completed", JSON.stringify(result.events.filter((event) => event.type === "run.failing")));
  assert.equal(observed.analystBrief, "# Evidence brief\nInclude the release constraints.");
  assert.equal(observed.editorDraft, "# Analysis\nKeep the evidence attached.");
  assert.deepEqual(Object.keys(observed.analystDraftRef).sort(), ["artifactId", "mediaType"]);
  assert.equal(result.result.data.summary, "Evidence report ready.");
  assert.deepEqual(Object.keys(result.result.artifacts.report).sort(), ["artifactId", "mediaType"]);
  assert.equal(JSON.stringify(result).includes("# Evidence brief"), false);
  assert.equal(JSON.stringify(result).includes("# Analysis"), false);
  assert.equal(JSON.stringify(result).includes("# Final evidence report"), false);

  assert.deepEqual(await artifactStore.validateReference({
    team,
    owner,
    kind: "agent-output",
    agentId: "evidence-analyst",
    portId: "A_DONE",
    slotId: "draft",
    reference: observed.analystDraftRef
  }), observed.analystDraftRef);
  await assert.rejects(artifactStore.validateReference({
    team,
    owner,
    kind: "agent-output",
    agentId: "evidence-editor",
    portId: "B_DONE",
    slotId: "report",
    reference: observed.analystDraftRef
  }), (error) => error?.code === "ARTIFACT_ACCESS_DENIED");

  const persistedRun = await new FileTeamRunStore(join(root, "runs")).load(owner.runId);
  assert.deepEqual(persistedRun.result, result.result);
  const reopenedArtifacts = new FileTeamArtifactStore(artifactsRoot);
  const reportResolver = await reopenedArtifacts.createInvocationResolver({ owner, allowedArtifacts: [persistedRun.result.artifacts.report] });
  assert.equal(Buffer.from(await reportResolver.read(persistedRun.result.artifacts.report.artifactId)).toString(), "# Final evidence report");
  await assert.rejects(reopenedArtifacts.createInvocationResolver({
    owner: { ...owner, projectId: "another-project" },
    allowedArtifacts: [persistedRun.result.artifacts.report]
  }), (error) => error?.code === "ARTIFACT_REFERENCE_INVALID");
});
