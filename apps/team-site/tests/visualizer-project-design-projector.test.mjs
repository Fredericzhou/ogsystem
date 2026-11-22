import assert from "node:assert/strict";
import test from "node:test";
import { createVisualizerProjectDesignProjector } from "../infrastructure/visualizer-project-design-projector.mjs";

test("project design projection retains matching V2 Studio role display names", async () => {
  const flow = { flowId: "start:START:source-dmayat", fromRoleId: "__system_start__", toRoleId: "source-dmayat", eventType: "START" };
  const canonicalAuthoring = {
    system: { systemId: "team.factory" },
    roles: { "source-dmayat": { roleId: "source-dmayat", bindingKind: "model" } },
    flows: { [flow.flowId]: flow },
    layout: { nodes: {} }
  };
  const savedAuthoring = {
    ogsContractVersion: 2,
    version: 2,
    system: { systemId: "team.factory" },
    roles: { "source-dmayat": { roleId: "source-dmayat", title: "Anthropologist", bindingKind: "model" } },
    flows: { [flow.flowId]: flow },
    layout: { nodes: {} }
  };
  const projector = createVisualizerProjectDesignProjector({
    async read(path) {
      if (path.endsWith("system.mmd")) return "flowchart TD";
      if (path.endsWith("system.design.json")) return "{}";
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    },
    parseSystem() { return { roleIds: ["source-dmayat"] }; },
    importAuthoring() { return canonicalAuthoring; },
    async loadAuthoringDraft() { return { authoring: savedAuthoring }; },
    async loadBindings() {
      return {
        harnessTemplates: { default: { templateId: "default", backend: "codex", model: "gpt-6-luna" } },
        roles: { "source-dmayat": { kind: "harness", harnessTemplate: "default" } }
      };
    },
    async loadSemanticConfig() { return { routes: new Map() }; },
    serializeAuthoring() { return "same-topology"; },
    toCanvas(authoring) { return { roles: Object.values(authoring.roles) }; },
    buildViewModel({ authoring }) { return { roles: Object.values(authoring.roles) }; }
  });

  const result = await projector.project({ projectId: "team", workdir: "/unused", projectDigest: "digest" }, "zh-CN");

  assert.equal(result.authoring.roles["source-dmayat"].title, "Anthropologist");
  assert.equal(result.canvas.roles[0].title, "Anthropologist");
  assert.equal(result.viewModel.roles[0].title, "Anthropologist");
});
