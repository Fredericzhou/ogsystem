import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    runResult: { dataSchema: { type: "object", properties: { answer: { type: "string" }, evidence: { type: "object", properties: { source: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, required: ["source", "labels"], additionalProperties: false } }, required: ["answer"], additionalProperties: false }, artifactSlots: { report: slot } },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 30000 },
    agents: [{
      id: "writer", packageRef: "role:writer@1", bindingRef: "binding:writer",
      inputPorts: {
        draft: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, artifactSlots: { sources: slot } },
        revise: { dataSchema: { type: "object", properties: { answer: { type: "string" }, comments: { type: "string" }, status: { type: "string" }, metadata: { type: "object", properties: { summary: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, required: ["summary", "labels"], additionalProperties: false } }, required: [], additionalProperties: false } },
        audit: { dataSchema: { type: "object", properties: { reason: { type: "string" } }, required: [], additionalProperties: false } }
      },
      outputPorts: {
        DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" }, again: { type: "boolean" }, evidence: { type: "object", properties: { source: { type: "string" }, labels: { type: "array", items: { type: "string" } } }, required: ["source", "labels"], additionalProperties: false } }, required: ["answer", "again", "evidence"], additionalProperties: false }, artifactSlots: { report: outputSlot } },
        BLOCKED: { dataSchema: { type: "object", properties: { reason: { type: "string" } }, required: [], additionalProperties: false } }
      }
    }],
    handoffs: [
      { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "writer", inputPort: "draft" }, map: { data: { prompt: { $ref: "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 10000 } },
      { id: "revise", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "agent", agentId: "writer", inputPort: "revise" }, map: { data: { answer: { $ref: "$.output.data.answer" }, comments: { $ref: "$.review.feedback.comments" } } }, when: { condition: { op: "equals", args: [{ $ref: "$.review.decision" }, { $literal: "reject" }] }, priority: 0 }, delivery: { deadlineMs: 10000 } },
      { id: "exit", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { $ref: "$.output.data.answer" } }, artifacts: { report: { $ref: "$.output.artifacts.report" } } }, when: { condition: { op: "equals", args: [{ $ref: "$.review.decision" }, { $literal: "approve" }] }, priority: 1 } }
    ],
    orchestration: {
      routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["entry"] },
        { from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["revise", "exit"] }
      ],
      joins: [],
      loops: [{ id: "revision", members: ["writer"], boundaryAgentId: "writer", entryHandoffIds: ["entry"], continueHandoffIds: ["revise"], exitHandoffIds: ["exit"], maxRounds: 3, maxAgentActivations: 4, onExhausted: "finish" }],
      reviews: [{ id: "review-draft", at: { kind: "agentOutput", agentId: "writer", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { comments: { type: "string", minLength: 1 } }, required: ["comments"], additionalProperties: false }, timeoutMs: 5000, onTimeout: "fail" }]
    },
    bindings: [{ id: "binding:writer", kind: "a2a", agentCardRef: "https://agents.example/card.json", attemptTimeoutMs: 10000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }]
  };
}

test("Team IR v2 Studio validates, saves, reopens and preserves v2 API boundaries on mobile", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-studio-browser-"));
  const resolverPath = join(projectsRoot, "test-resolver.mjs");
  await writeFile(resolverPath, `
export async function resolveTeamIrReleaseClosure({ teamIR }) {
  return {
    complete: true,
    packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "${"a".repeat(64)}"])),
    bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "${"b".repeat(64)}"])),
    adapterVersions: Object.fromEntries([...new Set(teamIR.bindings.map((binding) => binding.kind))].map((kind) => [kind, "browser-fake/1"]))
  };
}
export const a2aAdapterVersion = "browser-fake-a2a/1";
const a2aCard = {
  protocolVersion: "1.0", name: "Browser Fake Agent", version: "1",
  defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
  capabilities: { streaming: false, pushNotifications: false }
};
export async function resolveA2AAgent() {
  return {
    agentCard: a2aCard,
    client: {
      async getAgentCard() { return a2aCard; },
      async sendMessage() { return { id: "browser-task", status: "completed", result: { event: "DONE", data: { answer: "Simulation result", again: false, evidence: { source: "Simulation result", labels: ["Simulation result"] } } } }; },
      async getTask(taskId) { return { id: taskId, status: "completed", result: { event: "DONE", data: { answer: "Simulation result", again: false, evidence: { source: "Simulation result", labels: ["Simulation result"] } } } }; },
      async cancelTask() { return true; }
    }
  };
}
export async function resolveBindings({ teamIR }) {
  const valueForSchema = (schema) => {
    if (schema.type === "object") return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, valueForSchema(child)]));
    if (schema.type === "array") return [valueForSchema(schema.items || {})];
    if (schema.type === "boolean") return false;
    if (schema.type === "integer" || schema.type === "number") return 1;
    return "Simulation result";
  };
  return Object.fromEntries(teamIR.agents.map((agent) => {
    const event = Object.hasOwn(agent.outputPorts, "ALT_DONE") ? "ALT_DONE" : Object.keys(agent.outputPorts)[0];
    const port = agent.outputPorts[event];
    const data = valueForSchema(port.dataSchema || { type: "object", properties: {} });
    return [agent.bindingRef, { async invoke(invocation) {
      if (invocation.artifactResolver) {
        const reference = invocation.input.artifacts?.sources;
        if (!reference) throw new Error("Missing mapped input artifact for " + invocation.handoffId + ": " + JSON.stringify(invocation.input));
        await invocation.artifactResolver.read(reference.artifactId);
      }
      return { kind: "completed", output: { event, data } };
    } }];
  }));
}
`, "utf8");
  const port = await reserveBrowserSafePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_TEAM_IR_V2_RESOLVER_MODULE: resolverPath },
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
    const templateChoices = page.locator('input[name="templateCaseId"]');
    assert.equal(await templateChoices.count(), 9, "new Team IR drafts expose a blank option and all eight classic templates");
    await page.locator('input[name="templateCaseId"][value="software-team"]').check();
    await page.locator("#new-project-form input[name=name]").fill("Template browser draft");
    await page.locator("#new-project-form textarea[name=overview]").fill("Verify a classic template creates an independent Team IR v2 draft.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/ir$/);
    const templateDraftId = page.url().match(/\/studio\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.ok(templateDraftId);
    const templateDraft = await page.request.get(`${url}/api/v1/team-versions/${templateDraftId}`).then((response) => response.json());
    assert.equal(templateDraft.teamVersionStatus, "draft");
    assert.equal(templateDraft.caseId, "software-team");

    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("IR v2 Browser UAT");
    await page.locator("#new-project-form textarea[name=overview]").fill("Create a simple versioned Team IR and verify it after reopening.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/teams\/[a-z0-9-]+\/ir$/);
    const teamVersionId = page.url().match(/\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.ok(teamVersionId);

    await page.goto(`${url}/studio/teams/${teamVersionId}/ir`, { waitUntil: "networkidle" });
    await page.locator("#team-ir-editor").waitFor({ timeout: 5000 }).catch(async () => {
      assert.fail(`Team IR editor did not render at ${page.url()}: ${await page.locator("body").innerText().catch(() => "no body")} | page errors: ${pageErrors.join("; ")}`);
    });
    assert.equal(await page.locator('[data-ir-agent]').count(), 1);
    assert.equal(await page.locator('[name="agent-0-id"]').inputValue(), "worker");
    assert.equal(await page.locator('[name="agent-0-package"]').inputValue(), "role:worker@1");
    assert.equal(await page.locator('[name="agent-0-binding"]').inputValue(), "binding:worker");
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).bindings[0].modelRef, "codex-gateway/gpt-6-luna");
    const graphCanvas = page.locator("[data-ir-graph-canvas]");
    assert.ok(await graphCanvas.evaluate((canvas) => canvas.scrollWidth > canvas.clientWidth), "narrow viewports keep a usable horizontally scrollable graph canvas");
    const runNode = page.locator('[data-ir-layout-node="run"] > .ir-graph-node');
    const runBox = await runNode.boundingBox();
    await page.mouse.move(runBox.x + runBox.width / 2, runBox.y + runBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(runBox.x + runBox.width / 2 + 42, runBox.y + runBox.height / 2 + 26);
    await page.mouse.up();
    assert.match(await page.locator('[data-ir-layout-node="run"]').getAttribute("style"), /left:\s*66px;\s*top:\s*50px/);
    assert.ok(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}").run?.x === 66, await graphCanvas.getAttribute("data-layout-key")), "node layout persists locally outside the Team IR payload");
    await page.locator("[data-ir-add-agent]").click();
    assert.equal(await page.locator('[name="agent-1-package"]').inputValue(), "");
    assert.equal(await page.locator('[name="agent-1-binding"]').inputValue(), "");
    const addedAgentContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.equal(addedAgentContracts.bindings.some((binding) => binding.id === "binding:agent-2" || binding.modelRef === "codex-gateway/gpt-6-luna" && binding.id !== "binding:worker"), false,
      "a new Agent must not invent package or model Binding references");
    await page.locator('[data-ir-remove-agent="1"]').click();
    const teamIdInput = page.locator('[name="team-id"]');
    await teamIdInput.fill("bad team");
    const invalidAgentValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const invalidAgentBody = await (await invalidAgentValidation).json();
    assert.equal(invalidAgentBody.ok, false);
    const teamDiagnostic = page.locator("[data-team-ir-diagnostics] button.ir-diagnostic").filter({ hasText: "/team/id" }).first();
    assert.ok(invalidAgentBody.diagnostics.some((item) => item.code === "IR_SCHEMA_INVALID" && item.pointer === "/team/id"), JSON.stringify(invalidAgentBody.diagnostics));
    await teamDiagnostic.waitFor();
    await teamDiagnostic.click();
    assert.equal(await teamIdInput.evaluate((element) => document.activeElement === element), true);
    assert.equal(await teamIdInput.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)), "bad team");
    assert.equal(await teamIdInput.evaluate((element) => element.classList.contains("ir-diagnostic-target")), true);
    await teamIdInput.fill(teamVersionId);
    await page.locator('[data-ir-add-port="0"][data-ir-port-direction="outputPorts"]').click();
    const alternatePort = page.locator('[data-ir-port-row="outputPorts"][data-ir-port-index="1"]');
    await alternatePort.locator('input[name$="-id"]').fill("ALT_DONE");
    await alternatePort.locator('textarea[name$="-schema"]').fill(JSON.stringify({
      type: "object", properties: { summary: { type: "string" }, evidence: { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false } }, required: ["summary", "evidence"], additionalProperties: false
    }));
    await alternatePort.locator('textarea[name$="-artifacts"]').fill(JSON.stringify({
      trace: { required: false, mediaTypes: ["text/plain"], cardinality: "single" }
    }));
    await page.locator('[data-ir-add-port="0"][data-ir-port-direction="inputPorts"]').click();
    const secondaryInputPort = page.locator('[data-ir-port-row="inputPorts"][data-ir-port-index="1"]');
    await secondaryInputPort.locator('input[name$="-id"]').fill("SECOND_INPUT");
    await secondaryInputPort.locator('textarea[name$="-schema"]').fill(JSON.stringify({
      type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false
    }));
    await page.locator('[data-ir-add-port="0"][data-ir-port-direction="outputPorts"]').click();
    await page.locator('[data-ir-remove-port="0"][data-ir-port-direction="outputPorts"][data-ir-port-index="2"]').click();
    assert.equal(Object.hasOwn(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).agentPortContracts.worker.outputPorts, "output-3"), false,
      "removing an unused port removes it from the Team IR contract");
    await page.locator('[data-ir-remove-handoff="1"]').click();
    await page.locator('[data-ir-remove-handoff="0"]').click();

    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.match(await page.locator("[data-ir-connect-status]").innerText(), /先选择来源/);
    assert.equal(await page.locator("[data-ir-handoff]").count(), 0, "target-first selection must not create an edge");
    await page.locator('[data-ir-connect-source="run"]').click();
    assert.match(await page.locator("[data-ir-connect-status]").innerText(), /来源已选择/);
    await page.locator("[data-ir-connect-cancel]").click();
    assert.match(await page.locator("[data-ir-connect-status]").innerText(), /连接已取消/);
    assert.equal(await page.locator("[data-ir-handoff]").count(), 0, "cancel must discard the selected source");
    await page.locator('[data-ir-connect-source="run"]').click();
    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.equal(await page.locator("[data-ir-handoff]").count(), 1);
    const generatedContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(generatedContracts.handoffContracts["handoff-1"].from, { kind: "run" });
    assert.deepEqual(generatedContracts.handoffContracts["handoff-1"].to, { kind: "agent", agentId: "worker", inputPort: "default" });
    assert.deepEqual(generatedContracts.handoffContracts["handoff-1"].map, { data: {} }, "generated edge keeps data mapping explicit");
    await page.locator(".ir-graph-wire").waitFor();
    assert.match(await page.locator(".ir-graph-wire").getAttribute("d"), /^M /, "Handoff geometry connects explicit canvas port anchors");
    assert.equal(generatedContracts.bindings.find((binding) => binding.id === "binding:worker")?.modelRef, "codex-gateway/gpt-6-luna");
    await page.locator('[name="handoff-0-id"]').fill("run-to-worker");
    const runMapping = page.locator('[name="handoff-0-mapping"]');
    assert.equal(await runMapping.inputValue(), "", "mapping suggestions must not become semantics before acceptance");
    await page.locator('[data-ir-map-suggest="0"]').click();
    const runSuggestion = page.locator('[data-ir-map-accept="request"]');
    await runSuggestion.waitFor();
    assert.equal(await runMapping.inputValue(), "");
    await runSuggestion.click();
    assert.equal(await runMapping.inputValue(), "request=$.run.input.request");
    assert.equal(await page.locator('[data-ir-map-row="0"] [data-ir-map-target]').inputValue(), "request");
    assert.equal(await page.locator('[data-ir-map-row="0"] [data-ir-map-source]').inputValue(), "$.run.input.request");
    await page.locator('[data-ir-handoff="0"] [data-ir-map-remove]').click();
    assert.equal(await runMapping.inputValue(), "", "removing a field row removes its mapping");
    await page.locator('[data-ir-map-add="0"]').click();
    const addedMapRow = page.locator('[data-ir-handoff="0"] [data-ir-map-row]');
    await addedMapRow.locator('[data-ir-map-target]').selectOption("request");
    await addedMapRow.locator('[data-ir-map-source]').selectOption("$.run.input.request");
    assert.equal(await runMapping.inputValue(), "request=$.run.input.request", "field selections update the Team IR mapping");
    await page.locator('[data-ir-port-source-agent-index="0"][data-ir-port="ALT_DONE"]').click();
    await page.locator('[data-ir-connect-target="result"]').click();
    await page.locator('[name="handoff-1-id"]').fill("worker-to-result");
    const resultMapping = page.locator('[name="handoff-1-mapping"]');
    await page.locator('[data-ir-map-suggest="1"]').click();
    const resultSuggestion = page.locator('[data-ir-map-accept="summary"]');
    await resultSuggestion.waitFor();
    assert.equal(await resultMapping.inputValue(), "");
    await resultSuggestion.click();
    assert.equal(await resultMapping.inputValue(), "summary=$.output.data.summary");
    const valueSetup = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    valueSetup.runResult.dataSchema.properties.evidence = {
      type: "object",
      properties: { source: { type: "string" }, labels: { type: "array", items: { type: "string" } } },
      required: ["source", "labels"],
      additionalProperties: false
    };
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(valueSetup, null, 2));
    await page.locator('[data-ir-map-add="1"]').click();
    const evidenceMapping = page.locator('[data-ir-handoff="1"] [data-ir-map-row]').last();
    await evidenceMapping.locator('[data-ir-map-target]').selectOption("evidence");
    await evidenceMapping.locator('[data-ir-value-kind]').selectOption("object");
    await evidenceMapping.locator('[data-ir-value-node][data-ir-value-depth="0"] [data-ir-value-add="object"]').click();
    await evidenceMapping.locator("[data-ir-value-entry]").first().locator('[data-ir-value-object-key]').fill("source");
    await evidenceMapping.locator("[data-ir-value-entry]").first().locator('[data-ir-value-object-key]').press("Tab");
    const firstEvidenceField = evidenceMapping.locator('[data-ir-value-node][data-ir-value-depth="1"]').first();
    await firstEvidenceField.locator('[data-ir-value-kind]').selectOption("reference");
    await firstEvidenceField.locator('[data-ir-value-ref-path]').fill("$.output.data.evidence.source");
    await evidenceMapping.locator('[data-ir-value-node][data-ir-value-depth="0"] [data-ir-value-add="object"]').click();
    await evidenceMapping.locator("[data-ir-value-entry]").nth(1).locator('[data-ir-value-object-key]').fill("labels");
    await evidenceMapping.locator("[data-ir-value-entry]").nth(1).locator('[data-ir-value-object-key]').press("Tab");
    const secondEvidenceField = evidenceMapping.locator('[data-ir-value-node][data-ir-value-depth="1"]').nth(1);
    await secondEvidenceField.locator('[data-ir-value-kind]').selectOption("array");
    await secondEvidenceField.locator('[data-ir-value-add="array"]').click();
    const evidenceArrayItem = secondEvidenceField.locator('[data-ir-value-node][data-ir-value-depth="2"]');
    await evidenceArrayItem.locator('[data-ir-value-literal]').fill('"verified"');
    const nestedEvidence = {
      source: { $ref: "$.output.data.evidence.source" },
      labels: [{ $literal: "verified" }]
    };
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).handoffContracts["worker-to-result"].map.data.evidence, nestedEvidence,
      "nested references, object construction, array construction and literals sync to Advanced JSON");

    const validationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const validation = await validationResponse;
    const validationBody = await validation.json();
    assert.equal(validation.status(), 200);
    assert.equal(validationBody.ok, true, JSON.stringify(validationBody.diagnostics));
    const savedTeamIr = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(savedTeamIr.agentPortContracts.worker.outputPorts.ALT_DONE.dataSchema, {
      type: "object", properties: { summary: { type: "string" }, evidence: { type: "object", properties: { source: { type: "string" } }, required: ["source"], additionalProperties: false } }, required: ["summary", "evidence"], additionalProperties: false
    });
    assert.deepEqual(savedTeamIr.agentPortContracts.worker.outputPorts.ALT_DONE.artifactSlots, {
      trace: { required: false, mediaTypes: ["text/plain"], cardinality: "single" }
    });
    assert.deepEqual(savedTeamIr.agentPortContracts.worker.inputPorts.SECOND_INPUT.dataSchema, {
      type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false
    });
    assert.deepEqual(savedTeamIr.handoffContracts["worker-to-result"].from,
      { kind: "agent", agentId: "worker", outputPort: "ALT_DONE" }, "Handoff uses the selected non-first output port");
    assert.deepEqual(savedTeamIr.handoffContracts["worker-to-result"].map.data, { summary: { $ref: "$.output.data.summary" }, evidence: nestedEvidence });
    const saveResponse = await page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir`, { timeout: 5000 });
    assert.equal(saveResponse.status(), 200, await saveResponse.text());
    await page.getByText(/(?:Saved and reopened|已保存并重开) ·/, { exact: false }).waitFor();

    const reopened = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json());
    const expectedDigest = teamIRSemanticDigest(reopened.teamIR);
    assert.equal(reopened.semanticDigest, expectedDigest);
    assert.equal(await page.locator('[data-ir-agent]').count(), 1);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#team-ir-editor").waitFor();
    assert.equal(await page.locator('[name="agent-0-id"]').inputValue(), "worker");
    assert.equal(await page.locator('[data-ir-handoff]').count(), 2);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).agentPortContracts.worker.outputPorts.ALT_DONE.artifactSlots, {
      trace: { required: false, mediaTypes: ["text/plain"], cardinality: "single" }
    }, "all Agent port and Artifact slot contracts survive save and reopen");
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).agentPortContracts.worker.inputPorts.SECOND_INPUT.dataSchema, {
      type: "object", properties: { note: { type: "string" } }, required: ["note"], additionalProperties: false
    }, "additional Agent input ports survive save and reopen");
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).handoffContracts["worker-to-result"].map.data, { summary: { $ref: "$.output.data.summary" }, evidence: nestedEvidence },
      "nested ValueExpr tree survives save and reopen with the stored digest");
    await page.locator('[data-ir-remove-port="0"][data-ir-port-direction="outputPorts"][data-ir-port-index="1"]').click();
    assert.match(await page.locator("[data-team-ir-status]").innerText(), /Cannot remove ALT_DONE; it is referenced by Handoff worker-to-result/);
    assert.ok(Object.hasOwn(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).agentPortContracts.worker.outputPorts, "ALT_DONE"),
      "a referenced port cannot be removed into a broken IR");
    assert.equal((await page.locator("[data-team-ir-digest]").innerText()).trim(), expectedDigest);
    assert.equal(await page.locator('[data-ir-handoff="0"] [data-ir-map-target]').inputValue(), "request");
    assert.equal(await page.locator('[data-ir-handoff="0"] [data-ir-map-source]').inputValue(), "$.run.input.request");
    const blockedReadiness = await page.request.post(`${url}/api/v1/team-versions/${teamVersionId}/release`, { data: {} });
    assert.notEqual(blockedReadiness.status(), 200);
    assert.match((await blockedReadiness.json()).error, /TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED/);
    const simulationAdvanced = page.locator("[data-ir-advanced-json]");
    const simulationContracts = JSON.parse(await simulationAdvanced.inputValue());
    simulationContracts.runInput.dataSchema = {
      type: "object",
      properties: {
        request: { type: "string", title: "Request" },
        count: { type: "integer", default: 3 },
        temperature: { type: "number", default: 0.25 },
        enabled: { type: "boolean", default: true }
      },
      required: ["request"], additionalProperties: true
    };
    await simulationAdvanced.fill(JSON.stringify(simulationContracts, null, 2));
    assert.equal(await page.locator('[data-ir-simulation-field="request"]').getAttribute("type"), "text");
    assert.equal(await page.locator('[data-ir-simulation-field="count"]').getAttribute("type"), "number");
    assert.equal(await page.locator('[data-ir-simulation-field="count"]').inputValue(), "3");
    assert.equal(await page.locator('[data-ir-simulation-field="temperature"]').inputValue(), "0.25");
    assert.equal(await page.locator('[data-ir-simulation-field="enabled"]').isChecked(), true);
    simulationContracts.runInput.dataSchema.properties.request.pattern = "^[a-z]+$";
    await simulationAdvanced.fill(JSON.stringify(simulationContracts, null, 2));
    assert.equal(await page.locator("[data-ir-simulation-input]").count(), 1, "unsupported schema constraints keep the JSON fallback");
    await page.locator("[data-ir-simulation-input]").fill(JSON.stringify({ request: "browser test", extra: { kept: true } }));
    delete simulationContracts.runInput.dataSchema.properties.request.pattern;
    await simulationAdvanced.fill(JSON.stringify(simulationContracts, null, 2));
    assert.equal(await page.locator('[data-ir-simulation-field="request"]').inputValue(), "browser test");
    const validateSimulationSchema = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const simulationSchemaValidation = await (await validateSimulationSchema).json();
    assert.equal(simulationSchemaValidation.ok, true, JSON.stringify(simulationSchemaValidation.diagnostics));
    const saveSimulationSchema = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir`);
    assert.equal((await saveSimulationSchema).status(), 200);
    await page.getByText(/(?:Saved and reopened|已保存并重开) ·/, { exact: false }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-ir-simulation-field="request"]').waitFor();
    assert.equal(await page.locator('[data-ir-simulation-field="count"]').inputValue(), "3", "schema defaults are restored after save and reopen");
    await page.locator('[data-ir-simulation-run]').click();
    assert.match(await page.locator('[data-ir-simulation-status]').innerText(), /request is required/);
    simulationContracts.runInput.dataSchema.properties.request.pattern = "^[a-z]+$";
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(simulationContracts, null, 2));
    await page.locator("[data-ir-simulation-input]").fill(JSON.stringify({ request: "browser test", extra: { kept: true } }));
    delete simulationContracts.runInput.dataSchema.properties.request.pattern;
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(simulationContracts, null, 2));
    assert.equal(await page.locator('[data-ir-simulation-field="request"]').inputValue(), "browser test");
    const simulationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/simulations`);
    await page.locator("[data-ir-simulation-run]").click();
    const simulationResponseValue = await simulationResponse;
    const simulation = await simulationResponseValue.json();
    assert.deepEqual(simulationResponseValue.request().postDataJSON().input, {
      request: "browser test", count: 3, temperature: 0.25, enabled: true, extra: { kept: true }
    }, "typed fields serialize with defaults while unknown JSON values survive schema refresh");
    assert.equal(simulationResponseValue.status(), 200, JSON.stringify(simulation));
    assert.equal(simulation.status, "completed", JSON.stringify(simulation));
    assert.equal(simulation.run.resultWritten, true);
    await page.locator("[data-ir-simulation-evidence] h3").getByText(simulation.simulationId).waitFor();
    await page.locator("[data-ir-simulation-history]").getByText(simulation.simulationId, { exact: false }).first().waitFor();
    await page.goto(`${url}/studio/teams/${teamVersionId}/release`, { waitUntil: "networkidle" });
    await page.locator("h1").filter({ hasText: "Team IR v2" }).waitFor();
    assert.equal(await page.locator("#studio-release-button").isDisabled(), false);
    await page.locator("#studio-release-button").click();
    await page.locator("#studio-view .status-chip.released").waitFor();
    const released = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}`).then((response) => response.json());
    assert.equal(released.teamVersionStatus, "released");
    const releaseSnapshot = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir/release-snapshot`);
    assert.equal(releaseSnapshot.status(), 200);
    await page.goto(`${url}/studio/teams/${teamVersionId}/ir`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("[data-ir-add-join]").isDisabled(), true);
    assert.equal(await page.locator("[data-ir-add-loop]").isDisabled(), true);
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(layout.content <= layout.viewport + 1, `mobile page overflows horizontally: ${JSON.stringify(layout)}`);

    const sourceIrBeforeFork = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json());
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    const forkResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/edit`);
    await page.locator(`[data-team-action="edit"][data-team-id="${teamVersionId}"]`).click();
    const forkResponseValue = await forkResponse;
    const forkedVersion = await forkResponseValue.json();
    assert.equal(forkResponseValue.status(), 201, JSON.stringify(forkedVersion));
    await page.waitForURL(new RegExp(`/studio/teams/${forkedVersion.projectId}/ir$`));
    await page.locator("#team-ir-editor").waitFor();
    assert.equal(await page.locator('[data-ir-advanced-json]').isDisabled(), false);
    const sourceAfterFork = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}`).then((response) => response.json());
    const sourceIrAfterFork = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json());
    const forkedIr = await page.request.get(`${url}/api/v1/team-versions/${forkedVersion.projectId}/ir`).then((response) => response.json());
    assert.equal(sourceAfterFork.teamVersionStatus, "released");
    assert.equal(sourceIrAfterFork.semanticDigest, sourceIrBeforeFork.semanticDigest);
    assert.equal(forkedIr.semanticDigest, sourceIrBeforeFork.semanticDigest, "fork starts from the exact source Team IR contract");
    assert.equal(forkedVersion.teamVersionStatus, "draft");
    assert.equal(forkedVersion.parentTeamVersionId, teamVersionId);

    const legacy = await page.request.post(`${url}/api/v1/team-versions/${teamVersionId}/design/validate`, {
      data: { schemaVersion: 2, teamIR: reopened.teamIR }
    });
    assert.equal(legacy.status(), 409);
    assert.match((await legacy.json()).error, /TEAM_IR_V2_REQUIRED/);

    const advancedTeam = await page.request.post(`${url}/api/v1/team-ir-drafts`, {
      data: { name: "IR v2 Advanced Contracts", overview: "Round-trip advanced Team IR contracts." }
    }).then((response) => response.json());
    const advancedId = advancedTeam.projectId;
    const joinTeam = await page.request.post(`${url}/api/v1/team-ir-drafts`, {
      data: { name: "IR v2 Join Contracts", overview: "Round-trip a supported Run-scope Join." }
    }).then((response) => response.json());
    const joinId = joinTeam.projectId;
    const joinIr = JSON.parse(await readFile(new URL("../../../examples/team-ir-v2/classic-conditional-signoff.json", import.meta.url), "utf8"));
    joinIr.team.id = joinId;
    joinIr.runInput.dataSchema.properties.tag = { type: "string" };
    joinIr.agents.find((agent) => agent.id === "signoff-chair").inputPorts.collect.dataSchema.properties.sourceTag = { type: "string" };
    const joinInitial = await page.request.get(`${url}/api/v1/team-versions/${joinId}/ir`).then((response) => response.json());
    const joinSeed = await page.request.put(`${url}/api/v1/team-versions/${joinId}/ir`, {
      data: { teamIR: joinIr, expectedSemanticDigest: joinInitial.semanticDigest }
    });
    assert.equal(joinSeed.status(), 200, await joinSeed.text());
    await page.goto(`${url}/studio/teams/${joinId}/ir`, { waitUntil: "networkidle" });
    const signoffJoin = page.locator("[data-ir-join]").first();
    await signoffJoin.waitFor();
    assert.equal(await signoffJoin.locator("[data-ir-join-base-row]").count(), 1);
    const ownershipRequest = signoffJoin.locator(".ir-join-ownership tbody tr").filter({ hasText: "request" }).first();
    assert.match(await ownershipRequest.innerText(), /Run input/, "Join ownership includes fields supplied by baseMapping");
    await signoffJoin.locator("[data-ir-join-base-add]").click();
    assert.equal(await signoffJoin.locator("[data-ir-join-base-row]").count(), 2);
    const addedJoinMapping = signoffJoin.locator("[data-ir-join-base-row]").last();
    await addedJoinMapping.locator("[data-ir-join-base-target]").selectOption("sourceTag");
    await addedJoinMapping.locator("[data-ir-value-ref-path]").fill("$.run.input.tag");
    const joinValidationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${joinId}/ir/validate`);
    let joinSaveObserved = false;
    const observeJoinSave = (request) => {
      if (request.method() === "PUT" && new URL(request.url()).pathname === `/api/v1/team-versions/${joinId}/ir`) joinSaveObserved = true;
    };
    page.on("request", observeJoinSave);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const joinValidationBody = await (await joinValidationResponse).json();
    assert.equal(joinValidationBody.ok, true, JSON.stringify(joinValidationBody.diagnostics));
    await page.getByText(/(?:Saved and reopened|已保存并重开) ·/, { exact: false }).waitFor();
    page.off("request", observeJoinSave);
    assert.equal(joinSaveObserved, true);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("[data-ir-join-base-row]").count(), 2, "Run-scope Join field edits survive save and reopen");
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.joins[0].baseMapping.data.sourceTag.$ref,
      "$.run.input.tag");
    const invalidJoinMapping = structuredClone(joinIr);
    invalidJoinMapping.orchestration.joins[0].baseMapping.data.request.$ref = "$.run.input.missing";
    const joinDiagnosticResponse = await page.request.post(`${url}/api/v1/team-versions/${joinId}/ir/validate`, { data: { teamIR: invalidJoinMapping } });
    const joinDiagnosticBody = await joinDiagnosticResponse.json();
    assert.ok(joinDiagnosticBody.diagnostics.some((item) => item.code === "IR_MAPPING_SOURCE_MISSING"
      && item.pointer === "/orchestration/joins/0/baseMapping/data/request"), JSON.stringify(joinDiagnosticBody.diagnostics));

    const advancedIr = advancedTeamIr(advancedId);
    const advancedWriter = advancedIr.agents.find((agent) => agent.id === "writer");
    advancedWriter.inputPorts.revise.dataSchema.properties.answer.description = "Preserve this advanced description";
    advancedWriter.inputPorts.revise.dataSchema.properties.answer.examples = ["reviewed answer"];
    advancedWriter.outputPorts.DONE.artifactSlots.supplement = {
      mediaTypes: ["text/plain"], cardinality: "single", required: false
    };
    const conditionSummaries = await page.evaluate(async () => {
      const { teamIrConditionSummary } = await import("/app/views/app.js");
      const ref = { $ref: "$.run.input.decision" };
      const pass = { $literal: "PASS" };
      return [
        teamIrConditionSummary({ op: "equals", args: [ref, pass] }),
        teamIrConditionSummary({ op: "notEquals", args: [ref, pass] }),
        teamIrConditionSummary({ op: "and", args: [{ op: "equals", args: [ref, pass] }, { op: "exists", args: [{ $ref: "$.run.input.note" }] }] }),
        teamIrConditionSummary({ op: "or", args: [{ op: "equals", args: [ref, pass] }, { op: "notEquals", args: [ref, pass] }] }),
        teamIrConditionSummary({ op: "not", args: [{ op: "exists", args: [{ $ref: "$.run.input.note" }] }] }),
        teamIrConditionSummary({ op: "exists", args: [{ $ref: "$.run.input.note" }] })
      ];
    });
    assert.deepEqual(conditionSummaries, [
      '$.run.input.decision equals "PASS"',
      '$.run.input.decision does not equal "PASS"',
      '($.run.input.decision equals "PASS" AND $.run.input.note exists (the path must be present; explicit null counts as present))',
      '($.run.input.decision equals "PASS" OR $.run.input.decision does not equal "PASS")',
      'NOT ($.run.input.note exists (the path must be present; explicit null counts as present))',
      '$.run.input.note exists (the path must be present; explicit null counts as present)'
    ]);
    advancedIr.handoffs.find((handoff) => handoff.id === "exit").when.priority = 1;
    const advancedStored = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir`).then((response) => response.json());
    const seeded = await page.request.put(`${url}/api/v1/team-versions/${advancedId}/ir`, {
      data: { teamIR: advancedIr, expectedSemanticDigest: advancedStored.semanticDigest }
    });
    const seededBody = await seeded.json();
    assert.equal(seeded.status(), 200, JSON.stringify(seededBody));
    assert.equal(seededBody.saved, true, JSON.stringify(seededBody.diagnostics));
    await page.goto(`${url}/studio/teams/${advancedId}/ir`, { waitUntil: "networkidle" });
    await page.locator("[data-ir-advanced-json]").waitFor();
    const unsupportedCombined = structuredClone(advancedIr);
    unsupportedCombined.orchestration.joins.push({ id: "maker-checker-join", agentId: "writer", inputPort: "revise", mode: "all_of", handoffIds: ["revise"], scope: { kind: "run" }, timeoutMs: 5000, onTimeout: "fail" });
    const unsupportedResponse = await page.request.post(`${url}/api/v1/team-versions/${advancedId}/ir/validate`, { data: { teamIR: unsupportedCombined } });
    const unsupportedBody = await unsupportedResponse.json();
    assert.equal(unsupportedResponse.status(), 200);
    assert.ok(unsupportedBody.diagnostics.some((item) => item.code === "IR_REVIEW_TOPOLOGY_UNSUPPORTED" && item.pointer === "/orchestration/reviews/0"), JSON.stringify(unsupportedBody.diagnostics));
    assert.ok(unsupportedBody.diagnostics.some((item) => item.code === "IR_LOOP_TOPOLOGY_UNSUPPORTED" && item.pointer === "/orchestration/loops/0"), JSON.stringify(unsupportedBody.diagnostics));
    const unsupportedSave = await page.request.put(`${url}/api/v1/team-versions/${advancedId}/ir`, {
      data: { teamIR: unsupportedCombined, expectedSemanticDigest: advancedStored.semanticDigest }
    });
    assert.notEqual(unsupportedSave.status(), 200, "unsupported Loop + Join + Review must be blocked before it can be released");
    const advancedEditor = page.locator("[data-ir-advanced-json]");
    const contracts = JSON.parse(await advancedEditor.inputValue());
    assert.equal(contracts.orchestration.joins.length, 0);
    assert.equal(contracts.orchestration.loops[0].id, "revision");
    assert.equal(contracts.orchestration.reviews[0].id, "review-draft");
    assert.equal(contracts.agentPortContracts.writer.outputPorts.DONE.artifactSlots.report.required, false);
    assert.equal(contracts.bindings[0].kind, "a2a");
    assert.equal(await page.locator("[data-ir-join]").count(), 0);
    assert.equal(await page.locator("[data-ir-loop]").count(), 1);
    assert.equal(await page.locator("[data-ir-review]").count(), 1);
    assert.equal(await page.locator('[name="review-0-at"]').inputValue(), JSON.stringify(["writer", "DONE"]));
    const advancedAfterLoad = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    advancedAfterLoad.agentPortContracts.writer.inputPorts.revise.dataSchema.properties.answer.description = "Added after the editor loaded";
    advancedAfterLoad.agentPortContracts.writer.inputPorts.revise.dataSchema.properties.answer.examples = ["advanced-after-load"];
    advancedIr.agents.find((agent) => agent.id === "writer").inputPorts.revise.dataSchema.properties.answer.description = "Added after the editor loaded";
    advancedIr.agents.find((agent) => agent.id === "writer").inputPorts.revise.dataSchema.properties.answer.examples = ["advanced-after-load"];
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(advancedAfterLoad, null, 2));
    const reviseSchemaQuick = page.locator('[data-ir-schema-quick][data-ir-schema-target="agent-0-inputPorts-1-schema"]');

    const advancedContractRename = structuredClone(advancedAfterLoad);
    const reviseProperties = advancedContractRename.agentPortContracts.writer.inputPorts.revise.dataSchema.properties;
    reviseProperties.answer2 = { ...reviseProperties.answer, type: "number", description: "Renamed by Advanced JSON" };
    delete reviseProperties.answer;
    advancedContractRename.agentPortContracts.writer.inputPorts.revise.dataSchema.required = ["answer2"];
    const doneSlots = advancedContractRename.agentPortContracts.writer.outputPorts.DONE.artifactSlots;
    doneSlots.finalReport = { ...doneSlots.report, required: true };
    delete doneSlots.report;
    doneSlots.auditTrail = { mediaTypes: ["application/json"], cardinality: "many", required: false };
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(advancedContractRename, null, 2));
    const renamedSchemaJson = JSON.parse(await page.locator('[data-ir-schema-textarea][name="agent-0-inputPorts-1-schema"]').inputValue());
    assert.ok(renamedSchemaJson.properties.answer2, JSON.stringify(renamedSchemaJson));
    const renamedSchemaQuick = page.locator('[data-ir-schema-quick][data-ir-schema-target="agent-0-inputPorts-1-schema"]');
    const renamedSchemaHtml = await renamedSchemaQuick.evaluate((element) => element.outerHTML);
    assert.match(renamedSchemaHtml, /answer2/, renamedSchemaHtml);
    const renamedAnswerIndex = await renamedSchemaQuick.locator('[data-ir-schema-name]').evaluateAll((inputs) => inputs.findIndex((input) => input.value === "answer2"));
    assert.ok(renamedAnswerIndex >= 0, renamedSchemaHtml);
    const renamedAnswerRow = renamedSchemaQuick.locator('[data-ir-schema-field]').nth(renamedAnswerIndex);
    assert.equal(await renamedAnswerRow.locator('[data-ir-schema-name]').inputValue(), "answer2",
      "Advanced JSON field renames refresh the quick editor row");
    assert.equal(await renamedAnswerRow.locator('[data-ir-schema-type]').inputValue(), "number",
      "Advanced JSON field type changes refresh the quick editor row");
    assert.equal(await renamedAnswerRow.getAttribute("data-ir-schema-original"), "answer2",
      "Advanced JSON field renames refresh the quick editor original key");
    const renamedArtifactQuick = page.locator('[data-ir-artifact-quick][data-ir-artifact-target="agent-0-outputPorts-0-artifacts"]');
    assert.deepEqual(await renamedArtifactQuick.locator('[data-ir-artifact-name]').evaluateAll((inputs) => inputs.map((input) => input.value)), ["supplement", "finalReport", "auditTrail"],
      "Advanced JSON Artifact additions and renames refresh all quick rows");
    const renamedReportIndex = await renamedArtifactQuick.locator('[data-ir-artifact-name]').evaluateAll((inputs) => inputs.findIndex((input) => input.value === "finalReport"));
    assert.ok(renamedReportIndex >= 0);
    const renamedReportRow = renamedArtifactQuick.locator('[data-ir-artifact-field]').nth(renamedReportIndex);
    assert.equal(await renamedReportRow.getAttribute("data-ir-artifact-original"), "finalReport",
      "Advanced JSON Artifact renames refresh the quick editor original key");
    await renamedAnswerRow.locator('[data-ir-schema-required]').uncheck();
    await renamedReportRow.locator('[data-ir-artifact-required]').uncheck();
    const quickAfterAdvancedEdit = JSON.parse(await page.locator('[data-ir-advanced-json]').inputValue());
    assert.equal(quickAfterAdvancedEdit.agentPortContracts.writer.inputPorts.revise.dataSchema.properties.answer2.type, "number",
      "Quick edits after Advanced JSON changes keep the renamed Schema field");
    assert.equal(Object.hasOwn(quickAfterAdvancedEdit.agentPortContracts.writer.inputPorts.revise.dataSchema.properties, "answer"), false);
    assert.equal(quickAfterAdvancedEdit.agentPortContracts.writer.outputPorts.DONE.artifactSlots.finalReport.required, false,
      "Quick edits after Advanced JSON changes keep renamed Artifact metadata");
    assert.ok(Object.hasOwn(quickAfterAdvancedEdit.agentPortContracts.writer.outputPorts.DONE.artifactSlots, "auditTrail"),
      "Quick edits after Advanced JSON changes keep newly added Artifact slots");
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(advancedAfterLoad, null, 2));
    const reviseSchemaName = reviseSchemaQuick.locator('[data-ir-schema-name]').first();
    await reviseSchemaName.fill("");
    let schemaAfterEmptyName = JSON.parse(await page.locator('[data-ir-schema-textarea][name="agent-0-inputPorts-1-schema"]').inputValue());
    assert.equal(schemaAfterEmptyName.properties.answer.description, "Added after the editor loaded", "empty Schema names do not discard the advanced baseline");
    await reviseSchemaName.fill("invalid name");
    schemaAfterEmptyName = JSON.parse(await page.locator('[data-ir-schema-textarea][name="agent-0-inputPorts-1-schema"]').inputValue());
    assert.equal(schemaAfterEmptyName.properties.answer.description, "Added after the editor loaded", "invalid Schema names do not discard the advanced baseline");
    await reviseSchemaName.fill("answerRenamed");
    let revisedSchema = JSON.parse(await page.locator('[data-ir-schema-textarea][name="agent-0-inputPorts-1-schema"]').inputValue());
    assert.equal(revisedSchema.properties.answerRenamed.description, "Added after the editor loaded");
    assert.deepEqual(revisedSchema.properties.answerRenamed.examples, ["advanced-after-load"]);
    await reviseSchemaQuick.locator('[data-ir-schema-name]').first().fill("answer");
    const reportArtifactQuick = page.locator('[data-ir-artifact-quick][data-ir-artifact-target="agent-0-outputPorts-0-artifacts"]');
    const artifactRows = reportArtifactQuick.locator('[data-ir-artifact-field]');
    const reportArtifactName = artifactRows.nth(0).locator('[data-ir-artifact-name]');
    const supplementArtifactName = artifactRows.nth(1).locator('[data-ir-artifact-name]');
    await supplementArtifactName.fill("report");
    let duplicateSlots = JSON.parse(await page.locator('[data-ir-artifact-textarea][name="agent-0-outputPorts-0-artifacts"]').inputValue());
    assert.ok(Object.hasOwn(duplicateSlots, "report") && Object.hasOwn(duplicateSlots, "supplement"), "duplicate Artifact names do not commit a partial update");
    await supplementArtifactName.fill("supplement");
    const reportArtifactBefore = JSON.parse(await page.locator('[data-ir-artifact-textarea][name="agent-0-outputPorts-0-artifacts"]').inputValue()).report;
    await reportArtifactName.fill("");
    const artifactAfterEmptyName = JSON.parse(await page.locator('[data-ir-artifact-textarea][name="agent-0-outputPorts-0-artifacts"]').inputValue());
    assert.deepEqual(artifactAfterEmptyName.report, reportArtifactBefore, "empty Artifact names do not discard the advanced baseline");
    await reportArtifactName.fill("invalid name");
    const artifactAfterInvalidName = JSON.parse(await page.locator('[data-ir-artifact-textarea][name="agent-0-outputPorts-0-artifacts"]').inputValue());
    assert.deepEqual(artifactAfterInvalidName.report, reportArtifactBefore, "invalid Artifact names do not discard the advanced baseline");
    await reportArtifactName.fill("reportRenamed");
    await reportArtifactQuick.locator('[data-ir-artifact-media]').first().fill("text/markdown, text/plain");
    let renamedSlots = JSON.parse(await page.locator('[data-ir-artifact-textarea][name="agent-0-outputPorts-0-artifacts"]').inputValue());
    assert.deepEqual(renamedSlots.reportRenamed.cardinality, reportArtifactBefore.cardinality);
    assert.equal(renamedSlots.reportRenamed.required, reportArtifactBefore.required);
    assert.deepEqual(renamedSlots.reportRenamed.mediaTypes, ["text/markdown", "text/plain"]);
    await reportArtifactName.fill("report");
    await reportArtifactQuick.locator('[data-ir-artifact-media]').first().fill((reportArtifactBefore.mediaTypes || reportArtifactBefore.acceptedMediaTypes || []).join(", "));
    assert.equal(await page.locator("[data-ir-output-contract-hint]").count(), 1);
    assert.match(await page.locator("[data-ir-output-contract-hint]").innerText(), /Binding 必须返回单个 JSON 对象.*event.*data.*artifactTexts/);
    assert.match(await page.locator("[data-ir-output-contract-hint]").innerText(), /Provider 需支持该输出 Schema/);
    const writerIndex = advancedIr.agents.findIndex((agent) => agent.id === "writer");
    await page.locator(`[data-ir-remove-agent="${writerIndex}"]`).click();
    assert.match(await page.locator("[data-team-ir-status]").innerText(), /Cannot remove Agent writer; it is referenced by .*Review review-draft/);
    assert.ok(Object.hasOwn(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).agentPortContracts, "writer"),
      "Agent deletion must not discard a Review's source endpoint");
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.loops[0].entryHandoffIds, ["entry"]);
    await page.locator('[name="loop-0-rounds"]').fill("4");
    await page.locator('[name="review-0-timeout"]').fill("7500");
    const editedFeedbackSchema = { type: "object", properties: { comments: { type: "string", minLength: 1 }, evidence: { type: "string" } }, required: ["comments"], additionalProperties: false };
    await page.locator('[name="review-0-feedback-schema"]').fill(JSON.stringify(editedFeedbackSchema, null, 2));
    await page.locator('[name="handoff-1-priority"]').fill("3");
    const editedCondition = {
      op: "equals",
      args: [{ $ref: "$.review.decision" }, { $literal: "reject" }]
    };
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.reviews[0].feedbackSchema,
      editedFeedbackSchema, "Review feedback schema edits immediately synchronize advanced JSON");
    const structuredValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const structuredBody = await (await structuredValidation).json();
    assert.equal(structuredBody.ok, true, JSON.stringify(structuredBody.diagnostics));
    const structuredSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`);
    const structuredSaveResponse = await structuredSave;
    assert.equal(structuredSaveResponse.status(), 200);
    const structuredSavedBody = structuredSaveResponse.request().postDataJSON();
    assert.deepEqual(structuredSavedBody.teamIR.handoffs.find((handoff) => handoff.id === "revise").when.condition,
      editedCondition);
    assert.equal(structuredSavedBody.teamIR.handoffs.find((handoff) => handoff.id === "revise").when.priority, 3);
    await page.reload({ waitUntil: "networkidle" });
    assert.match(await page.locator('[data-ir-condition-summary="1"]').innerText(), /review\.decision equals "reject"/);
    assert.equal(await page.locator('[name="loop-0-rounds"]').inputValue(), "4");
    assert.equal(await page.locator('[name="review-0-timeout"]').inputValue(), "7500");
    assert.deepEqual(JSON.parse(await page.locator('[name="review-0-feedback-schema"]').inputValue()), editedFeedbackSchema);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).handoffContracts.revise.when.condition,
      editedCondition, "nested Handoff condition edits survive save and reopen");
    Object.assign(contracts.orchestration, JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration);
    assert.equal(contracts.orchestration.loops[0].maxRounds, 4);
    assert.equal(contracts.orchestration.reviews[0].timeoutMs, 7500);
    assert.deepEqual(contracts.orchestration.reviews[0].feedbackSchema, editedFeedbackSchema);
    advancedIr.orchestration.loops[0].maxRounds = 4;
    advancedIr.orchestration.reviews[0].timeoutMs = 7500;
    advancedIr.orchestration.reviews[0].feedbackSchema = editedFeedbackSchema;
    advancedIr.handoffs.find((handoff) => handoff.id === "revise").when.condition = editedCondition;
    advancedIr.handoffs.find((handoff) => handoff.id === "revise").when.priority = 3;

    const advancedEdit = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    advancedEdit.orchestration.loops[0].maxRounds = 5;
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(advancedEdit, null, 2));
    const advancedEditValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    const advancedEditSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const advancedEditValidationBody = await (await advancedEditValidation).json();
    assert.equal(advancedEditValidationBody.ok, true, JSON.stringify(advancedEditValidationBody.diagnostics));
    const advancedEditSaveResponse = await advancedEditSave;
    assert.equal(advancedEditSaveResponse.status(), 200);
    const advancedEditSavedBody = advancedEditSaveResponse.request().postDataJSON();
    assert.equal(advancedEditSavedBody.teamIR.orchestration.loops[0].maxRounds, 5);
    await page.getByText(/(?:Saved and reopened|已保存并重开) ·/, { exact: false }).waitFor();
    assert.equal(await page.locator('[name="loop-0-rounds"]').inputValue(), "5", "advanced Loop edits flow back to the structured row");
    const roundTripped = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(roundTripped.orchestration.loops[0].entryHandoffIds, ["entry"], "Loop Handoff IDs survive a visual/JSON round trip");
    assert.deepEqual(roundTripped.orchestration.reviews[0].feedbackSchema, editedFeedbackSchema, "Review feedback schema survives a visual/JSON round trip");

    let emptyReviewValidationRequests = 0;
    let emptyReviewSaveRequests = 0;
    const countEmptyReviewRequests = (request) => {
      if (new URL(request.url()).pathname !== `/api/v1/team-versions/${advancedId}/ir`) return;
      if (request.method() === "POST") emptyReviewValidationRequests += 1;
      if (request.method() === "PUT") emptyReviewSaveRequests += 1;
    };
    page.on("request", countEmptyReviewRequests);
    await page.locator('[name="review-0-at"]').selectOption("");
    await page.locator('#team-ir-editor button[type="submit"]').click();
    await page.locator("[data-team-ir-status]").getByText(/requires a valid Agent output position/).waitFor();
    assert.equal(emptyReviewValidationRequests, 0, "an empty Review position must be rejected before validation API");
    assert.equal(emptyReviewSaveRequests, 0, "an empty Review position must not reach save API");
    page.off("request", countEmptyReviewRequests);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[name="review-0-at"]').waitFor();

    await page.locator("[data-ir-add-loop]").click();
    assert.equal(await page.locator("[data-ir-loop]").count(), 2);
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.loops[1].id, "loop-2");
    await page.locator('[data-ir-remove-loop="1"]').click();
    assert.equal(await page.locator("[data-ir-loop]").count(), 1);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.loops[0].entryHandoffIds, ["entry"]);
    await page.locator("[data-ir-add-review]").click();
    assert.equal(await page.locator("[data-ir-review]").count(), 2);
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.reviews[1].id, "review-2");
    await page.locator('[data-ir-remove-review="1"]').click();
    assert.equal(await page.locator("[data-ir-review]").count(), 1);
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.reviews[0].id, "review-draft");

    await page.reload({ waitUntil: "networkidle" });

    await page.locator('[data-ir-connect-source-agent-index="0"]').click();
    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.equal(await page.locator("[data-ir-handoff]").count(), 4, "same-Agent distinct-port Loop handoffs remain authorable");
    const selfLoopContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(selfLoopContracts.handoffContracts["handoff-4"].from, { kind: "agent", agentId: "writer", outputPort: "DONE" });
    assert.deepEqual(selfLoopContracts.handoffContracts["handoff-4"].to, { kind: "agent", agentId: "writer", inputPort: "draft" });
    assert.deepEqual(selfLoopContracts.orchestration.routes.find((route) => route.from.kind === "agent" && route.from.outputPort === "DONE").handoffIds,
      ["revise", "exit", "handoff-4"], "an existing route must continue to list every outgoing Handoff");
    await page.locator('[data-ir-link-source-port="0"]').selectOption("BLOCKED");
    await page.locator('[data-ir-link-target-port="0"]').selectOption("audit");
    await page.locator('[data-ir-port-source-agent-index="0"][data-ir-port="BLOCKED"]').dragTo(page.locator('[data-ir-port-target-agent-index="0"][data-ir-port="audit"]'));
    assert.equal(await page.locator("[data-ir-handoff]").count(), 5);
    const selectedPortContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(selectedPortContracts.handoffContracts["handoff-5"].from,
      { kind: "agent", agentId: "writer", outputPort: "BLOCKED" }, "dragging an event source uses the selected output port");
    assert.deepEqual(selectedPortContracts.handoffContracts["handoff-5"].to,
      { kind: "agent", agentId: "writer", inputPort: "audit" }, "dropping on an input target uses the selected input port");
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-ir-advanced-json]").waitFor();

    const incompatibleContracts = structuredClone(contracts);
    incompatibleContracts.runInput.dataSchema.properties.prompt.pattern = "^source-";
    incompatibleContracts.agentPortContracts.writer.inputPorts.draft.dataSchema.properties.prompt.pattern = "^target-";
    incompatibleContracts.handoffContracts.entry.map.data = {};
    await advancedEditor.fill(JSON.stringify(incompatibleContracts, null, 2));
    await page.locator('[data-ir-map-suggest="0"]').click();
    await page.locator('[data-ir-map-suggestions="0"]').getByText("No compatible required fields with matching names.").waitFor();
    assert.equal(await page.locator('[data-ir-map-accept="prompt"]').count(), 0,
      "same-name fields with incompatible pattern constraints must not be suggested");
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));

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
    assert.equal(invalidSaves, 1, "the server receives invalid drafts and rejects them without writing");
    await page.locator("[data-team-ir-diagnostics]").getByText("/orchestration/reviews/0/timeoutMs").click();
    const reviewTimeout = page.locator('[name="review-0-timeout"]');
    assert.equal(await reviewTimeout.evaluate((element) => document.activeElement === element), true);
    assert.equal(await reviewTimeout.inputValue(), "0");

    contracts.orchestration.reviews[0].timeoutMs = 7500;
    contracts.orchestration.loops[0].maxRounds = 0;
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));
    const invalidLoopValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const invalidLoopBody = await (await invalidLoopValidation).json();
    assert.equal(invalidLoopBody.ok, false);
    await page.locator("[data-team-ir-diagnostics]").getByText("/orchestration/loops/0/maxRounds").click();
    const loopRounds = page.locator('[name="loop-0-rounds"]');
    assert.equal(await loopRounds.evaluate((element) => document.activeElement === element), true);
    assert.equal(await loopRounds.inputValue(), "0");

    await page.reload({ waitUntil: "networkidle" });
    const pointerContracts = JSON.parse(await advancedEditor.inputValue());
    pointerContracts.handoffContracts.entry.map.data.prompt.$ref = "$.run.input.missing";
    await advancedEditor.fill(JSON.stringify(pointerContracts, null, 2));
    const handoffMappingValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const handoffMappingBody = await (await handoffMappingValidation).json();
    assert.equal(handoffMappingBody.ok, false);
    const handoffMappingDiagnostic = handoffMappingBody.diagnostics.find((item) => item.pointer === "/handoffs/0/map/data/prompt");
    assert.ok(handoffMappingDiagnostic, JSON.stringify(handoffMappingBody.diagnostics));
    assert.equal(handoffMappingDiagnostic.code, "IR_MAPPING_SOURCE_MISSING");
    await page.locator("[data-team-ir-diagnostics] button.ir-diagnostic").filter({ hasText: handoffMappingDiagnostic.pointer }).first().click();
    const handoffMappingReference = page.locator('[data-ir-handoff="0"] [data-ir-map-row]').first().locator('[data-ir-value-direct-ref]');
    assert.equal(await handoffMappingReference.evaluate((element) => document.activeElement === element), true,
      "a missing reference path should focus the structured reference editor");
    assert.equal(await handoffMappingReference.inputValue(), "$.run.input.missing");

    pointerContracts.handoffContracts.entry.map.data.prompt.$ref = "$.run.input.prompt";
    pointerContracts.handoffContracts.revise.when.condition.args[0].$ref = "$.output.data.missing";
    await advancedEditor.fill(JSON.stringify(pointerContracts, null, 2));
    const handoffConditionValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const handoffConditionBody = await (await handoffConditionValidation).json();
    assert.equal(handoffConditionBody.ok, false);
    const handoffConditionDiagnostic = handoffConditionBody.diagnostics.find((item) => item.pointer.startsWith("/handoffs/1/when/condition"));
    assert.ok(handoffConditionDiagnostic, JSON.stringify(handoffConditionBody.diagnostics));
    assert.equal(handoffConditionDiagnostic.code, "IR_MAPPING_SOURCE_MISSING");
    await page.locator("[data-team-ir-diagnostics] button.ir-diagnostic").filter({ hasText: handoffConditionDiagnostic.pointer }).first().click();
    const conditionOperator = page.locator('[data-ir-condition-editor="1"] [data-ir-condition-root="true"] [data-ir-condition-op]').first();
    assert.equal(await conditionOperator.evaluate((element) => document.activeElement === element), true,
      "condition diagnostics must focus the live structured AST editor");

    pointerContracts.handoffContracts.revise.when.condition = {
      op: "equals",
      args: [{ $ref: "$.review.decision" }, { $literal: "reject" }]
    };
    pointerContracts.runInput.dataSchema.properties["bad/~key"] = { type: "not-a-json-type" };
    await advancedEditor.fill(JSON.stringify(pointerContracts, null, 2));
    const escapedPointerValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const escapedPointerBody = await (await escapedPointerValidation).json();
    assert.equal(escapedPointerBody.ok, false);
    const escapedPointer = "/runInput/dataSchema/properties/bad~1~0key/type";
    assert.ok(escapedPointerBody.diagnostics.some((item) => item.code === "IR_SCHEMA_INVALID" && item.pointer === escapedPointer), JSON.stringify(escapedPointerBody.diagnostics));
    const escapedDiagnostic = page.locator("[data-team-ir-diagnostics] button.ir-diagnostic").filter({ hasText: escapedPointer }).first();
    await escapedDiagnostic.waitFor();
    await escapedDiagnostic.click();
    assert.equal(await advancedEditor.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)), '"not-a-json-type"');

    delete pointerContracts.runInput.dataSchema.properties["bad/~key"];
    pointerContracts.handoffContracts.revise.when.condition = structuredClone(advancedIr.handoffs.find((handoff) => handoff.id === "revise").when.condition);
    await advancedEditor.fill(JSON.stringify(pointerContracts, null, 2));
    const advancedValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    const advancedSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`).catch(() => null);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const advancedValidationBody = await (await advancedValidation).json();
    assert.equal(advancedValidationBody.ok, true, JSON.stringify(advancedValidationBody.diagnostics));
    assert.equal((await advancedSave).status(), 200);
    await page.getByText(/(?:Saved and reopened|已保存并重开) ·/, { exact: false }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    const advancedReopened = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir`).then((response) => response.json());
    assert.equal(advancedReopened.semanticDigest, teamIRSemanticDigest(advancedReopened.teamIR));
    assert.deepEqual(advancedReopened.teamIR.orchestration.loops, [{ ...advancedIr.orchestration.loops[0], maxRounds: 5 }]);
    assert.deepEqual(advancedReopened.teamIR.orchestration.joins, []);
    assert.deepEqual(advancedReopened.teamIR.orchestration.reviews, advancedIr.orchestration.reviews);
    assert.deepEqual(advancedReopened.teamIR.orchestration.routes, advancedIr.orchestration.routes);
    assert.deepEqual(advancedReopened.teamIR.runInput.artifactSlots, advancedIr.runInput.artifactSlots);
    assert.deepEqual(advancedReopened.teamIR.runResult.artifactSlots, advancedIr.runResult.artifactSlots);
    assert.deepEqual(advancedReopened.teamIR.agents[0].inputPorts, advancedIr.agents[0].inputPorts);
    assert.deepEqual(advancedReopened.teamIR.agents[0].outputPorts, advancedIr.agents[0].outputPorts);
    assert.deepEqual(advancedReopened.teamIR.handoffs.find((handoff) => handoff.id === "exit").map.artifacts, advancedIr.handoffs.find((handoff) => handoff.id === "exit").map.artifacts);
    assert.deepEqual(advancedReopened.teamIR.handoffs, advancedIr.handoffs);
    assert.deepEqual(advancedReopened.teamIR.bindings, advancedIr.bindings);
    const artifactUatIr = structuredClone(advancedReopened.teamIR);
    artifactUatIr.handoffs = artifactUatIr.handoffs.filter((handoff) => ["entry", "exit"].includes(handoff.id));
    artifactUatIr.handoffs.find((handoff) => handoff.id === "entry").map.artifacts = {
      sources: { $ref: "$.run.attachments.brief" }
    };
    artifactUatIr.handoffs.find((handoff) => handoff.id === "exit").map = {
      data: { answer: { $ref: "$.output.data.answer" } }
    };
    artifactUatIr.handoffs.find((handoff) => handoff.id === "exit").when = { priority: 0 };
    artifactUatIr.orchestration = {
      routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["entry"] },
        { from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["exit"] }
      ], joins: [], loops: [], reviews: []
    };
    const artifactUatSave = await page.request.put(`${url}/api/v1/team-versions/${advancedId}/ir`, {
      data: { teamIR: artifactUatIr, expectedSemanticDigest: advancedReopened.semanticDigest }
    });
    const artifactUatSaved = await artifactUatSave.json();
    assert.equal(artifactUatSave.status(), 200, JSON.stringify(artifactUatSaved));
    assert.equal(artifactUatSaved.saved, true, JSON.stringify(artifactUatSaved.diagnostics));
    const artifactUatStored = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir`).then((response) => response.json());
    assert.deepEqual(artifactUatStored.teamIR.handoffs.find((handoff) => handoff.id === "entry").map.artifacts,
      { sources: { $ref: "$.run.attachments.brief" } });
    await page.reload({ waitUntil: "networkidle" });
    assert.ok(await page.locator("[data-ir-artifact-quick]").count() > 0, "Agent Artifact slots should expose the structured editor");
    const browserArtifactSlotsResponse = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir/simulation-artifact-slots`);
    const browserArtifactSlots = await browserArtifactSlotsResponse.json();
    assert.equal(browserArtifactSlotsResponse.status(), 200, JSON.stringify(browserArtifactSlots));
    assert.deepEqual(browserArtifactSlots.slots.map((slot) => slot.slotId), ["brief"]);
    await page.locator("[data-ir-simulation-artifact-slot]").waitFor({ state: "attached" });
    assert.equal(await page.locator("[data-ir-simulation-artifact-inputs]").isVisible(), true,
      `Simulation Artifact controls did not load: ${await page.locator("[data-ir-simulation-artifact-status]").innerText()}`);
    assert.equal(await page.locator("[data-ir-simulation-artifact-slot] option").first().getAttribute("value"), "brief");
    await page.locator("[data-ir-simulation-artifact-file]").setInputFiles({
      name: "source.md", mimeType: "text/markdown", buffer: Buffer.from("Browser Sandbox source")
    });
    await page.locator("[data-ir-simulation-artifact-add]").click();
    await page.getByText("Simulation attachment registered.").waitFor();
    assert.match(await page.locator("[data-ir-simulation-artifact-list]").innerText(), /brief[\s\S]*source\.md/);
    await page.locator('[data-ir-simulation-field="prompt"]').fill("Use the attached source");
    const artifactSimulationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/simulations`);
    await page.locator("[data-ir-simulation-run]").click();
    const artifactSimulationResponseValue = await artifactSimulationResponse;
    const artifactSimulationRequest = artifactSimulationResponseValue.request().postDataJSON();
    assert.deepEqual(Object.keys(artifactSimulationRequest.attachments), ["brief"]);
    const artifactSimulation = await artifactSimulationResponseValue.json();
    assert.equal(artifactSimulation.status, "completed", JSON.stringify(artifactSimulation));
    assert.deepEqual(Object.keys(artifactSimulation.attachments), ["brief"]);
    assert.deepEqual(artifactSimulationRequest.attachments.brief, {
      artifactId: artifactSimulation.attachments.brief.artifactId,
      mediaType: "text/markdown"
    });
    assert.match(artifactSimulation.attachments.brief.artifactId, /^art_[a-f0-9-]+$/);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("[data-ir-graph-node=run]").click();
    assert.equal(await page.locator('[name="team-id"]').evaluate((element) => document.activeElement === element), true);
    await page.locator('[data-ir-graph-node="agent"][data-agent-id="writer"]').click();
    assert.equal(await page.locator('[name="agent-0-id"]').evaluate((element) => document.activeElement === element), true);
    await page.locator('[data-ir-graph-handoff="0"]').click();
    assert.equal(await page.locator('[data-ir-handoff="0"] [data-ir-map-target]').evaluate((element) => document.activeElement === element), true);
    await page.locator("[data-ir-graph-node=result]").click();
    assert.equal(await advancedEditor.evaluate((element) => document.activeElement === element), true);
    await page.setViewportSize({ width: 390, height: 844 });
    const advancedLayout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(advancedLayout.content <= advancedLayout.viewport + 1, `advanced graph/editor overflows narrow viewport: ${JSON.stringify(advancedLayout)}`);
    assert.equal(await page.locator("[data-ir-graph-node]").count(), advancedIr.agents.length + 2);
    assert.ok(await page.locator("[data-ir-graph-handoff]").count() >= 2);

    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    const studioClassicCases = await page.locator("[data-studio-classic-case]").evaluateAll((elements) => elements.map((element) => element.dataset.studioClassicCase));
    assert.deepEqual(studioClassicCases, ["software-team", "expert-consultation", "structured-debate", "a2a-intake", "artifact-evidence", "conditional-signoff", "maker-checker", "release-gate"]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "classic Team entries fit the narrow Studio viewport");
    const classicTemplateResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/cases/structured-debate/template");
    await page.locator('[data-classic-team-template="structured-debate"]').click();
    const classicTemplate = await (await classicTemplateResponse).json();
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/ir$/);
    const classicTemplateId = page.url().match(/\/studio\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.equal(classicTemplate.projectId, classicTemplateId);
    await page.locator("#team-ir-editor").waitFor();
    assert.equal(await page.locator("[data-ir-agent]").count(), 5);
    assert.equal((await page.locator("[data-team-ir-digest]").innerText()).trim().length, 64);
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator('#studio-view a[href="/studio/new"]').click();
    await page.waitForURL(`${url}/studio/new`);
    await page.locator(".new-team-heading h1").getByText("Team IR v2").waitFor();
    await page.locator("#new-project-form input[name=name]").fill("Native v2 draft");
    await page.locator("#new-project-form textarea[name=overview]").fill("A native Team IR draft with a typed starter workflow.");
    const nativeCreate = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/team-ir-drafts");
    await page.locator("#new-project-form button[type=submit]").click();
    const nativeCreateResponse = await nativeCreate;
    assert.equal(nativeCreateResponse.status(), 201, await nativeCreateResponse.text());
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/ir$/);
    const nativeId = page.url().match(/\/studio\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.ok(nativeId);
    const nativeProject = await page.request.get(`${url}/api/v1/team-versions/${nativeId}`).then((response) => response.json());
    assert.equal(nativeProject.source, "team-ir-v2");
    assert.equal(nativeProject.templateId, "team-ir-v2");
    const nativeIr = await page.request.get(`${url}/api/v1/team-versions/${nativeId}/ir`).then((response) => response.json());
    assert.equal(nativeIr.teamIR.schemaVersion, 2);
    assert.equal(nativeIr.semanticDigest, teamIRSemanticDigest(nativeIr.teamIR));
    assert.equal(nativeIr.teamIR.agents[0].id, "worker");
    assert.match(await readFile(join(projectsRoot, nativeId, ".ogs", "team.ir.json"), "utf8"), /"schemaVersion": 2/);
    await assert.rejects(access(join(projectsRoot, nativeId, "system.mmd")), { code: "ENOENT" });
    await assert.rejects(access(join(projectsRoot, nativeId, ".ogs", "authoring.json")), { code: "ENOENT" });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await page.locator("[data-team-ir-digest]").innerText()).trim(), nativeIr.semanticDigest);
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    const nativeCard = page.locator(`[data-team-root-id="${nativeId}"]`);
    await nativeCard.locator(`a[href="/studio/teams/${nativeId}/ir"]`).waitFor();
    assert.equal(await nativeCard.locator(`a[href="/studio/teams/${nativeId}/design"]`).count(), 0);

    const v2ReviewRouteCalls = [];
    const diagnosticMessages = await page.evaluate(async () => {
      const { teamBindingDiagnosticMessage } = await import("/app/views/app.js");
      return {
        zh: teamBindingDiagnosticMessage("OUTPUT_JSON_SYNTAX", "zh-CN"),
        en: teamBindingDiagnosticMessage("OUTPUT_JSON_MARKDOWN_FENCE", "en"),
        unsupported: teamBindingDiagnosticMessage("OUTPUT_PARTS_UNSUPPORTED", "zh-CN"),
        unknown: teamBindingDiagnosticMessage("UNKNOWN_DIAGNOSTIC", "en")
      };
    });
    assert.match(diagnosticMessages.zh, /JSON 语法无效/);
    assert.match(diagnosticMessages.en, /Markdown fences/);
    assert.match(diagnosticMessages.unsupported, /Provider 是否支持结构化 JSON 输出/);
    assert.equal(diagnosticMessages.unknown, "");
    let v2ReviewStatus = "pending";
    let validReviewPosts = 0;
    let reviewReads = 0;
    await page.route("**/api/v1/projects/project-v2/tasks/task-v2/runs/run-v2/team-ir-reviews/review-draft", async (route) => {
      const request = route.request();
      v2ReviewRouteCalls.push({ method: request.method(), body: request.postDataJSON() });
      if (request.method() === "GET") {
        reviewReads += 1;
        if (reviewReads === 1) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary review query failure" }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          projectId: "project-v2", taskId: "task-v2", runId: "run-v2", reviewId: "review-draft",
          revision: 3, revisionToken: "trusted-revision-token", activatedAt: "2026-10-28T00:00:00.000Z",
          deadlineAt: "2026-10-28T01:00:00.000Z", status: v2ReviewStatus
        }) });
      } else if (request.postDataJSON()?.feedback?.comments === "valid feedback") {
        validReviewPosts += 1;
        if (validReviewPosts === 1) {
          v2ReviewStatus = "rejected";
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "resume dispatch response was lost" }) });
        } else {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "rejected", decision: "reject", revision: 4, resumedRun: { runId: "run-v2", status: "completed" } }) });
        }
      } else {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "REVIEW_FEEDBACK_INVALID: comments required" }) });
      }
    });
    await page.evaluate(async () => {
      const { mountTeamIrRunReviews } = await import("/app/views/app.js");
      const detail = document.createElement("div");
      detail.dataset.projectId = "project-v2";
      detail.dataset.taskId = "task-v2";
      detail.dataset.runId = "run-v2";
      detail.dataset.selectedRunId = "run-v2";
      document.body.append(detail);
      window.__teamIrReviewDetail = detail;
      await mountTeamIrRunReviews(detail, {
        runId: "run-v2", owner: { teamIrSemanticDigest: "f".repeat(64) },
        plan: { team: { orchestration: { reviews: [{ id: "review-draft" }] } } }
      });
    });
    const reviewPanel = page.locator("[data-team-ir-run-reviews]");
    await reviewPanel.getByText("temporary review query failure").waitFor();
    await reviewPanel.getByRole("button", { name: "重新读取审核状态" }).click();
    await page.locator("[data-team-ir-run-reviews] h3").getByText("review-draft").waitFor();
    const reviewForm = page.locator('[data-team-ir-review="0"]');
    assert.equal(await reviewForm.locator("[name=decision]").inputValue(), "approve");
    await reviewForm.locator("[name=decision]").selectOption("reject");
    await reviewForm.locator("[name=feedback]").fill("not-json");
    await reviewForm.locator("button[type=submit]").click();
    await reviewForm.getByText("反馈必须是有效 JSON 对象。").waitFor();
    assert.equal(v2ReviewRouteCalls.length, 2, "invalid feedback must not be sent to the server");
    await reviewForm.locator("[name=feedback]").fill("{}");
    await reviewForm.locator("button[type=submit]").click();
    await reviewForm.getByText(/REVIEW_FEEDBACK_INVALID/).waitFor();
    await reviewForm.locator("[name=feedback]").fill('{"comments":"valid feedback"}');
    await reviewForm.locator("button[type=submit]").click();
    await reviewForm.getByText(/resume dispatch response was lost/).waitFor();
    await reviewForm.locator("button[type=submit]").click();
    await page.locator("[data-team-ir-run-reviews]").waitFor({ state: "detached" });
    assert.deepEqual(v2ReviewRouteCalls.map((call) => call.method), ["GET", "GET", "POST", "POST", "POST", "GET"]);
    assert.equal(v2ReviewRouteCalls[2].body.decision, "reject");
    assert.deepEqual(v2ReviewRouteCalls[2].body.feedback, {});
    assert.equal(v2ReviewRouteCalls[2].body.revisionToken, "trusted-revision-token");
    assert.match(v2ReviewRouteCalls[2].body.idempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.equal(Object.hasOwn(v2ReviewRouteCalls[2].body, "reviewerId"), false);
    assert.equal(v2ReviewRouteCalls[3].body.feedback.comments, "valid feedback");
    assert.equal(v2ReviewRouteCalls[4].body.idempotencyKey, v2ReviewRouteCalls[3].body.idempotencyKey, "retry after a lost response must replay with the same idempotency key");
    assert.equal(Object.hasOwn(v2ReviewRouteCalls[4].body, "reviewerId"), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait)).catch(() => {});
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
