import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { cases } from "../cases.mjs";
import { caseTeamMaterializer } from "../infrastructure/case-team-materializer.mjs";

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
  assert.match(debate.roles.find((role) => role.id === "document-publisher").prompt, /artifacts/i);
});

test("active classic cases do not carry V1 execution bindings", () => {
  for (const team of cases) {
    for (const role of team.roles) {
      assert.equal("execution" in role, false, `${team.id}/${role.id} carries legacy execution binding`);
      assert.doesNotMatch(role.prompt || "", /profileId|toolRef|profile\.|tool\./i, `${team.id}/${role.id} carries legacy binding instructions`);
    }
  }
});

test("classic case materialization emits current V2 runtime config and native artifact instructions", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-classic-v2-materializer-"));
  try {
    await caseTeamMaterializer.materialize("software-team", workdir);
    assert.equal(await caseTeamMaterializer.isCurrent("software-team", workdir), true);
    const runtimePath = path.join(workdir, ".ogs", "runtime.json");
    const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
    assert.equal(Object.hasOwn(runtime, "runtime"), false);

    const publisherRoot = path.join(workdir, "team-roles", "roles", "delivery-lead");
    const outputSchema = JSON.parse(await readFile(path.join(publisherRoot, "output.schema.json"), "utf8"));
    const prompt = await readFile(path.join(publisherRoot, "prompt.md"), "utf8");
    assert.ok(Object.hasOwn(outputSchema.properties, "artifacts"));
    assert.match(prompt, /available native file-writing tool/);

    await writeFile(runtimePath, JSON.stringify({ ...runtime, runtime: { error_flows: { v1: false } } }));
    assert.equal(await caseTeamMaterializer.isCurrent("software-team", workdir), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("cross-backend case uses its Codex planner for a real Markdown handoff artifact", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-cross-backend-v2-materializer-"));
  try {
    await caseTeamMaterializer.materialize("cross-backend-review-loop", workdir);
    assert.equal(await caseTeamMaterializer.isCurrent("cross-backend-review-loop", workdir), true);
    const plannerRoot = path.join(workdir, "team-roles", "roles", "planner");
    const outputSchema = JSON.parse(await readFile(path.join(plannerRoot, "output.schema.json"), "utf8"));
    const prompt = await readFile(path.join(plannerRoot, "agent.md"), "utf8");
    assert.ok(Object.hasOwn(outputSchema.properties, "artifacts"));
    assert.match(prompt, /cross-backend-review\.md/);
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
