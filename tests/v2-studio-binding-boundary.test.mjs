import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultStudioCommandFormState, renderStudioCommandForm } from "../dist/visualizer/studio-client/studio-graph-command-forms.js";
import { applyStudioAuthoringCommand } from "../dist/visualizer/studio-client/studio-graph-commands.js";

const context = {
  authoring: {
    ogsContractVersion: 2,
    version: 2,
    system: { systemId: "demo", systemVersion: "1", startDispatch: { mode: "all" }, lawGlobalRef: "default" },
    roles: {},
    flows: {},
    layout: { nodes: {} }
  },
  rolePackages: [],
  projectConfig: { models: [{ backend: "codex", modelId: "gpt-6-luna", runnable: true }] }
};

test("Studio role authoring exposes only v2 model bindings", () => {
  const state = createDefaultStudioCommandFormState({ kind: "add-role", context });
  const html = renderStudioCommandForm({ state, context });
  assert.match(html, /name="modelRef"/);
  assert.doesNotMatch(html, /value="(?:exec|noop)"/);
  assert.doesNotMatch(html, /profile|local_shell/i);

  assert.throws(() => applyStudioAuthoringCommand({
    authoring: context.authoring,
    command: { type: "add-role", roleId: "writer", bindingKind: "exec", profileId: "legacy.profile" }
  }), /V2_STUDIO_LEGACY_BINDING/);
});
