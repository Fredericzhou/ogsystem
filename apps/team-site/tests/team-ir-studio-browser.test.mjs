import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function advancedTeamIr(teamVersionId) {
  const slot = { required: false, acceptedMediaTypes: ["text/markdown"], cardinality: "single" };
  const outputSlot = { required: false, mediaTypes: ["text/markdown"], cardinality: "single" };
  return {
    schemaVersion: 2,
    team: { id: teamVersionId, version: "2.0.0" },
    runInput: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, preferencesSchema: { type: "object" }, artifactSlots: { brief: slot } },
    runResult: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }, artifactSlots: { report: slot } },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 30000 },
    agents: [{
      id: "writer", packageRef: "role:writer@1", bindingRef: "binding:writer",
      inputPorts: {
        draft: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, artifactSlots: { sources: slot } },
        revise: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: [], additionalProperties: false } }
      },
      outputPorts: { DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" }, again: { type: "boolean" } }, required: ["answer", "again"], additionalProperties: false }, artifactSlots: { report: outputSlot } } }
    }],
    handoffs: [
      { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "writer", inputPort: "draft" }, map: { data: { prompt: { $ref: "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 10000 } },
      { id: "revise", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "agent", agentId: "writer", inputPort: "revise" }, map: { data: { answer: { $ref: "$.loop.previous.writer.output.data.answer" } } }, when: { condition: { op: "equals", args: [{ $ref: "$.output.data.again" }, { $literal: true }] }, priority: 0 }, delivery: { deadlineMs: 10000 } },
      { id: "exit", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { $ref: "$.output.data.answer" } }, artifacts: { report: { $ref: "$.output.artifacts.report" } } }, when: { priority: 1 } }
    ],
    orchestration: {
      routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["entry"] },
        { from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["revise", "exit"] }
      ],
      joins: [{ id: "revision-input", agentId: "writer", inputPort: "revise", mode: "all_of", handoffIds: ["revise"], scope: { kind: "loop", loopId: "revision" }, timeoutMs: 5000, onTimeout: "fail" }],
      loops: [{ id: "revision", members: ["writer"], boundaryAgentId: "writer", entryHandoffIds: ["entry"], continueHandoffIds: ["revise"], exitHandoffIds: ["exit"], maxRounds: 3, maxAgentActivations: 6, onExhausted: "fail" }],
      reviews: [{ id: "review-draft", at: { kind: "agentOutput", agentId: "writer", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { decision: { enum: ["approve", "reject"] } }, required: ["decision"], additionalProperties: false }, timeoutMs: 5000, onTimeout: "fail" }]
    },
    bindings: [{ id: "binding:writer", kind: "a2a", agentCardRef: "https://agents.example/card.json", attemptTimeoutMs: 10000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }]
  };
}

test("Team IR v2 Studio validates, saves, reopens and preserves v2 API boundaries on mobile", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-studio-browser-"));
  const port = await reserveBrowserSafePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const startedAt = Date.now();
    let url;
    while (!url && Date.now() - startedAt < 10000) {
      url = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!url) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(url, `Team Site did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("IR v2 Browser UAT");
    await page.locator("#new-project-form textarea[name=overview]").fill("Create a simple versioned Team IR and verify it after reopening.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/teams\/[a-z0-9-]+\/design$/);
    const teamVersionId = page.url().match(/\/teams\/([a-z0-9-]+)\/design$/)?.[1];
    assert.ok(teamVersionId);

    await page.goto(`${url}/studio/teams/${teamVersionId}/ir`, { waitUntil: "networkidle" });
    await page.locator("#team-ir-editor").waitFor({ timeout: 5000 }).catch(async () => {
      assert.fail(`Team IR editor did not render at ${page.url()}: ${await page.locator("body").innerText().catch(() => "no body")} | page errors: ${pageErrors.join("; ")}`);
    });
    assert.equal(await page.locator('[data-ir-agent]').count(), 0);
    await page.locator("[data-ir-add-agent]").click();
    await page.locator('[name="agent-0-id"]').fill("worker");
    await page.locator('[name="agent-0-package"]').fill("role:worker@1");
    await page.locator('[name="agent-0-binding"]').fill("binding:worker");
    await page.locator('[name="agent-0-input-fields"]').fill("request");
    await page.locator('[name="agent-0-output-fields"]').fill("summary");

    await page.locator("[data-ir-add-handoff]").click();
    await page.locator('[name="handoff-0-id"]').fill("run-to-worker");
    await page.locator('[name="handoff-0-mapping"]').fill("request=$.run.input.request");
    await page.locator("[data-ir-add-handoff]").click();
    await page.locator('[name="handoff-1-id"]').fill("worker-to-result");
    await page.locator('[name="handoff-1-from-agent"]').selectOption("worker");
    await page.locator('[name="handoff-1-from-port"]').fill("DONE");
    await page.locator('[name="handoff-1-to-agent"]').selectOption("@result");
    await page.locator('[name="handoff-1-mapping"]').fill("summary=$.output.data.summary");

    const validationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const validation = await validationResponse;
    const validationBody = await validation.json();
    assert.equal(validation.status(), 200);
    assert.equal(validationBody.ok, true, JSON.stringify(validationBody.diagnostics));
    const saveResponse = await page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir`, { timeout: 5000 });
    assert.equal(saveResponse.status(), 200, await saveResponse.text());
    await page.getByText("Saved and reopened ·", { exact: false }).waitFor();

    const reopened = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json());
    const expectedDigest = teamIRSemanticDigest(reopened.teamIR);
    assert.equal(reopened.semanticDigest, expectedDigest);
    assert.equal(await page.locator('[data-ir-agent]').count(), 1);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#team-ir-editor").waitFor();
    assert.equal(await page.locator('[name="agent-0-id"]').inputValue(), "worker");
    assert.equal(await page.locator('[data-ir-handoff]').count(), 2);
    assert.equal((await page.locator("[data-team-ir-digest]").innerText()).trim(), expectedDigest);
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(layout.content <= layout.viewport + 1, `mobile page overflows horizontally: ${JSON.stringify(layout)}`);

    const legacy = await page.request.post(`${url}/api/v1/team-versions/${teamVersionId}/design/validate`, {
      data: { schemaVersion: 2, teamIR: reopened.teamIR }
    });
    assert.equal(legacy.status(), 409);
    assert.match((await legacy.json()).error, /TEAM_IR_VERSION_UNSUPPORTED_HERE/);

    const advancedTeam = await page.request.post(`${url}/api/v1/team-factory`, {
      data: { name: "IR v2 Advanced Contracts", overview: "Round-trip advanced Team IR contracts." }
    }).then((response) => response.json());
    const advancedId = advancedTeam.projectId;
    const advancedIr = advancedTeamIr(advancedId);
    const seeded = await page.request.put(`${url}/api/v1/team-versions/${advancedId}/ir`, {
      data: { teamIR: advancedIr, expectedSemanticDigest: null }
    });
    const seededBody = await seeded.json();
    assert.equal(seeded.status(), 200, JSON.stringify(seededBody));
    assert.equal(seededBody.saved, true, JSON.stringify(seededBody.diagnostics));
    await page.goto(`${url}/studio/teams/${advancedId}/ir`, { waitUntil: "networkidle" });
    await page.locator("[data-ir-advanced-json]").waitFor();
    const advancedEditor = page.locator("[data-ir-advanced-json]");
    const contracts = JSON.parse(await advancedEditor.inputValue());
    assert.equal(contracts.orchestration.joins[0].id, "revision-input");
    assert.equal(contracts.orchestration.loops[0].id, "revision");
    assert.equal(contracts.orchestration.reviews[0].id, "review-draft");
    assert.equal(contracts.agentPortContracts.writer.outputPorts.DONE.artifactSlots.report.required, false);
    assert.equal(contracts.bindings[0].kind, "a2a");

    contracts.orchestration.reviews[0].timeoutMs = 0;
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));
    let invalidSaves = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && new URL(request.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`) invalidSaves += 1;
    });
    const invalidValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const invalidBody = await (await invalidValidation).json();
    assert.equal(invalidBody.ok, false);
    await page.locator("[data-team-ir-diagnostics]").getByText("/orchestration/reviews/0/timeoutMs").waitFor();
    assert.match(await page.locator("[data-team-ir-diagnostics]").innerText(), /IR_SCHEMA_INVALID/);
    assert.equal(invalidSaves, 0, "invalid advanced contracts must not reach save API");

    contracts.orchestration.reviews[0].timeoutMs = 5000;
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));
    const advancedSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    assert.equal((await advancedSave).status(), 200);
    await page.getByText("Saved and reopened ·", { exact: false }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    const advancedReopened = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir`).then((response) => response.json());
    assert.equal(advancedReopened.semanticDigest, teamIRSemanticDigest(advancedReopened.teamIR));
    assert.deepEqual(advancedReopened.teamIR.orchestration.loops, advancedIr.orchestration.loops);
    assert.deepEqual(advancedReopened.teamIR.orchestration.joins, advancedIr.orchestration.joins);
    assert.deepEqual(advancedReopened.teamIR.orchestration.reviews, advancedIr.orchestration.reviews);
    assert.deepEqual(advancedReopened.teamIR.orchestration.routes, advancedIr.orchestration.routes);
    assert.deepEqual(advancedReopened.teamIR.runInput.artifactSlots, advancedIr.runInput.artifactSlots);
    assert.deepEqual(advancedReopened.teamIR.runResult.artifactSlots, advancedIr.runResult.artifactSlots);
    assert.deepEqual(advancedReopened.teamIR.agents[0].inputPorts, advancedIr.agents[0].inputPorts);
    assert.deepEqual(advancedReopened.teamIR.agents[0].outputPorts, advancedIr.agents[0].outputPorts);
    assert.deepEqual(advancedReopened.teamIR.handoffs.find((handoff) => handoff.id === "exit").map.artifacts, advancedIr.handoffs.find((handoff) => handoff.id === "exit").map.artifacts);
    assert.deepEqual(advancedReopened.teamIR.handoffs, advancedIr.handoffs);
    assert.deepEqual(advancedReopened.teamIR.bindings, advancedIr.bindings);
    const advancedLayout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(advancedLayout.content <= advancedLayout.viewport + 1, `advanced contract editor overflows mobile viewport: ${JSON.stringify(advancedLayout)}`);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait)).catch(() => {});
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
