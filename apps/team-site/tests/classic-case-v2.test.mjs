import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cases } from "../cases.mjs";
import { caseTeamMaterializer } from "../infrastructure/case-team-materializer.mjs";
import { validateRolePackageManifest } from "../../../dist/runtime/role-repo.js";

test("structured debate classic team uses the V2 five-role document workflow", () => {
  const debate = cases.find((item) => item.id === "structured-debate");
  assert.ok(debate);
  assert.deepEqual(debate.roles.map((role) => role.id), [
    "debate-host",
    "proponent",
    "opponent",
    "neutral-judge",
    "document-publisher"
  ]);
  assert.deepEqual(debate.flows.at(-2), ["neutral-judge", "document-publisher", "READY"]);
  assert.deepEqual(debate.flows.at(-1), ["document-publisher", "__system_end__", "READY"]);
  assert.equal(debate.roles.some((role) => role.execution), false);
  assert.equal(debate.roles.some((role) => /media-publisher|debate-reporter/.test(role.id)), false);
  assert.match(debate.roles.find((role) => role.id === "document-publisher").prompt, /write-capable staging/i);
  assert.match(debate.roles.find((role) => role.id === "document-publisher").prompt, /write-capable staging/i);
});

test("active classic cases do not carry V1 execution bindings", () => {
  for (const team of cases) {
    for (const role of team.roles) {
      assert.equal("execution" in role, false, `${team.id}/${role.id} carries legacy execution binding`);
      assert.doesNotMatch(role.prompt || "", /profileId|toolRef|profile\.(?:id|model)|tool\.(?:ref|id)/i, `${team.id}/${role.id} carries legacy binding instructions`);
    }
  }
});

test("classic case materialization emits current V2 runtime config and native artifact instructions", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-classic-v2-materializer-"));
  try {
    const softwareTeam = cases.find((item) => item.id === "software-team");
    assert.deepEqual(softwareTeam?.roles.map((role) => role.id), [
      "delivery-coordinator",
      "backend-engineer",
      "experience-engineer",
      "quality-engineer",
      "delivery-lead"
    ]);
    assert.deepEqual(softwareTeam?.joins, [{
      roleId: "delivery-lead",
      mode: "all_of",
      sources: ["backend-engineer", "experience-engineer", "quality-engineer"]
    }]);

    await caseTeamMaterializer.materialize("software-team", workdir);
    assert.equal(await caseTeamMaterializer.isCurrent("software-team", workdir), true);
    const runtimePath = path.join(workdir, ".ogs", "runtime.json");
    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    assert.equal(Object.hasOwn(runtime, "runtime"), false);

    const bindings = JSON.parse(await readFile(path.join(workdir, ".ogs", "execution-bindings.json"), "utf8"));
    const writerRoles = ["backend-engineer", "experience-engineer", "quality-engineer", "delivery-lead"];
    assert.deepEqual(cases.find((item) => item.id === "software-team")?.roles.filter((role) => role.writesFiles).map((role) => role.id), writerRoles);
    for (const roleId of writerRoles) {
      const templateId = bindings.roles[roleId].harnessTemplate;
      const template = bindings.harnessTemplates[templateId];
      assert.deepEqual(template.allowedTools, ["apply_patch", "exec_command"], roleId);
      assert.deepEqual(template.environment.filesystem, { read: true, write: true }, roleId);
      assert.equal(template.environment.process, "allow", roleId);
      assert.equal(template.environment.network, "deny", roleId);
    }
    const coordinatorTemplate = bindings.harnessTemplates[bindings.roles["delivery-coordinator"].harnessTemplate];
    assert.deepEqual(coordinatorTemplate.allowedTools, []);

    const publisherRoot = path.join(workdir, "team-roles", "roles", "delivery-lead");
    const outputSchema = JSON.parse(await readFile(path.join(publisherRoot, "output.schema.json"), "utf8"));
    const prompt = await readFile(path.join(publisherRoot, "prompt.md"), "utf8");
    assert.equal(Object.hasOwn(outputSchema.properties, "artifacts"), false);
    assert.match(prompt, /available native file-writing tool/);
    assert.match(await readFile(path.join(publisherRoot, "agent.md"), "utf8"), /node --test tests\/ledger\.test\.mjs/);
    assert.match(await readFile(path.join(workdir, "team-roles", "roles", "backend-engineer", "agent.md"), "utf8"), /src\/ledger\.mjs/);
    assert.match(await readFile(path.join(workdir, "team-roles", "roles", "experience-engineer", "agent.md"), "utf8"), /src\/app\.js/);
    assert.match(await readFile(path.join(workdir, "team-roles", "roles", "quality-engineer", "agent.md"), "utf8"), /tests\/ledger\.test\.mjs/);

    await writeFile(runtimePath, JSON.stringify({ ...runtime, runtime: { error_flows: { v1: false } } }));
    assert.equal(await caseTeamMaterializer.isCurrent("software-team", workdir), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("every built-in case materializes machine-readable Role responsibility, input, and output contracts", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-classic-role-contracts-"));
  try {
    for (const team of cases) {
      await caseTeamMaterializer.materialize(team.id, workdir);
      assert.equal(await caseTeamMaterializer.isCurrent(team.id, workdir), true, team.id);
      for (const role of team.roles) {
        const manifest = JSON.parse(await readFile(path.join(workdir, "team-roles", "roles", role.id, "role.json"), "utf8"));
        validateRolePackageManifest(manifest, `${team.id}/${role.id}/role.json`);
        assert.ok(manifest.responsibility.contributes.includes("content"), `${team.id}/${role.id} contribution`);
        assert.deepEqual(manifest.inputs.preconditions, [{
          op: "exists",
          args: [{ kind: "path", root: "role", path: ["input"] }]
        }], `${team.id}/${role.id} input precondition`);
        assert.deepEqual(manifest.outputs.postconditions, [{
          op: "exists",
          args: [{ kind: "path", root: "role", path: ["output"] }]
        }], `${team.id}/${role.id} output postcondition`);
      }
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("cross-backend case uses its Codex planner for a bounded business handoff", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-cross-backend-v2-materializer-"));
  try {
    const crossBackend = cases.find((item) => item.id === "cross-backend-review-loop");
    assert.deepEqual(crossBackend?.outputSchema?.required, ["content"]);
    assert.doesNotMatch(JSON.stringify(crossBackend?.detail?.deliverable), /handoff\s*=\s*true/i);
    await caseTeamMaterializer.materialize("cross-backend-review-loop", workdir);
    assert.equal(await caseTeamMaterializer.isCurrent("cross-backend-review-loop", workdir), true);
    const plannerRoot = path.join(workdir, "team-roles", "roles", "planner");
    const implementerRoot = path.join(workdir, "team-roles", "roles", "implementer");
    const outputSchema = JSON.parse(await readFile(path.join(plannerRoot, "output.schema.json"), "utf8"));
    const prompt = await readFile(path.join(plannerRoot, "agent.md"), "utf8");
    const implementerSchema = JSON.parse(await readFile(path.join(implementerRoot, "output.schema.json"), "utf8"));
    const implementerPrompt = await readFile(path.join(implementerRoot, "agent.md"), "utf8");
    const systemSource = await readFile(path.join(workdir, "system.mmd"), "utf8");
    const bindings = JSON.parse(await readFile(path.join(workdir, ".ogs", "execution-bindings.json"), "utf8"));
    assert.equal(Object.hasOwn(outputSchema.properties, "artifacts"), false);
    assert.match(prompt, /cross-backend-review\.md/);
    assert.equal(implementerSchema.additionalProperties, false);
    assert.match(implementerPrompt, /projected handoff content/);
    assert.match(systemSource, /context\.map\.implementer\.handoff=direct\.content/);
    assert.doesNotMatch(systemSource, /workspaceRefs/);
    const implementerTemplate = bindings.harnessTemplates[bindings.roles.implementer.harnessTemplate];
    assert.deepEqual(implementerTemplate.allowedTools, []);
    assert.equal(implementerTemplate.environment.filesystem, "none");
    assert.equal(implementerTemplate.environment.process, "deny");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("consulting roles distinguish Runtime arrival quorum from business approval", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-consulting-quorum-v2-materializer-"));
  try {
    await caseTeamMaterializer.materialize("management-consulting", workdir);
    const synthesis = await readFile(path.join(workdir, "team-roles", "roles", "synthesis-consultant", "agent.md"), "utf8");
    const review = await readFile(path.join(workdir, "team-roles", "roles", "quality-reviewer", "agent.md"), "utf8");
    assert.match(synthesis, /Runtime quorum is an arrival gate, not a vote/);
    assert.match(review, /Keep Runtime join arrival quorum separate from business approval/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("release operations classic team covers approval, rework, and compensation semantics", async () => {
  const release = cases.find((item) => item.id === "release-operations");
  assert.ok(release);
  assert.deepEqual(release.semantics, ["handoff.strict", "parallel_split", "all_of", "context.map", "human_review", "rework", "error_compensation"]);
  assert.deepEqual(release.joins, [{
    roleId: "release-manager",
    mode: "all_of",
    sources: ["implementation-engineer", "quality-engineer", "release-writer"]
  }]);
  assert.deepEqual(release.reviews, [{
    roleId: "release-manager",
    mode: "required",
    timeout: 86400,
    timeoutAction: "pause",
    reworkTarget: "delivery-lead",
    reworkMax: 2,
    terminateScope: "run"
  }]);
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-release-operations-v2-"));
  try {
    await caseTeamMaterializer.materialize("release-operations", workdir);
    assert.equal(await caseTeamMaterializer.isCurrent("release-operations", workdir), true);
    const role = JSON.parse(await readFile(path.join(workdir, "team-roles", "roles", "release-manager", "role.json"), "utf8"));
    assert.deepEqual(role.authority.controlActions, ["approve", "reject", "rework"]);
    const system = await readFile(path.join(workdir, "system.mmd"), "utf8");
    assert.match(system, /handoff\.mode=strict/);
    assert.match(system, /handoff\.contracts=contracts\/handoff\.contracts\.json/);
    assert.match(system, /review\.mode\.release-manager=required/);
    const contracts = JSON.parse(await readFile(path.join(workdir, "contracts", "handoff.contracts.json"), "utf8"));
    const flowSchema = JSON.parse(await readFile(path.join(workdir, "contracts", "flow-envelope.schema.json"), "utf8"));
    assert.equal(contracts.contracts.length, 8);
    assert.ok(contracts.contracts.some((contract) => contract.match.eventType === "READY" && contract.match.toRoleId === "release-deployer"));
    assert.ok(contracts.contracts.some((contract) => contract.match.eventType === "NEEDS_REWORK" && contract.match.toRoleId === "delivery-lead"));
    assert.match(system, /context\.map\.delivery-lead\.humanReviewComment=global\.human_review\.current\.comment\?/);
    const releaseManagerSchema = JSON.parse(await readFile(path.join(workdir, "team-roles", "roles", "release-manager", "output.schema.json"), "utf8"));
    assert.equal(releaseManagerSchema.properties.data.properties.requiredChanges.items.required.includes("criterionId"), true);
    assert.equal(await caseTeamMaterializer.isCurrent("release-operations", workdir), true);
    await writeFile(path.join(workdir, "contracts", "flow-envelope.schema.json"), JSON.stringify({ ...flowSchema, required: ["event", "content"] }));
    assert.equal(await caseTeamMaterializer.isCurrent("release-operations", workdir), false);
    assert.match(system, /release-deployer\[Role:release-deployer\] -->\|ERROR\| error-handler/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
