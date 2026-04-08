import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  loadAssemblyConfig,
  loadRolePackage,
  renderRolePrompt,
  validateRoleOutputSchema
} from "../dist/runtime/role-repo.js";

const debateAssemblyPath = path.resolve("examples/langgraph-debate-current/assembly.json");
const minimalistRoleRef = "file:../role-packages/debate-minimalist@1.0.0";
const fixtureAssemblyBaseDir = path.resolve("tests/fixtures/assemblies");

test("assembly references roleRef + profileRef", async () => {
  const { assembly } = await loadAssemblyConfig(debateAssemblyPath);
  assert.ok(assembly.nodes);
  for (const [nodeId, metadata] of Object.entries(assembly.nodes)) {
    assert.ok(typeof metadata.roleRef === "string" && metadata.roleRef.length > 0, `${nodeId} missing roleRef`);
    assert.ok(typeof metadata.profileRef === "string" && metadata.profileRef.length > 0, `${nodeId} missing profileRef`);
    assert.ok(metadata.promptArgs, `${nodeId} must provide promptArgs`);
  }
});

test("loadRolePackage resolves versioned local refs and renders contextual fields", async () => {
  const rolePackage = await loadRolePackage({
    roleRef: minimalistRoleRef,
    baseDir: fixtureAssemblyBaseDir
  });
  const rendered = renderRolePrompt({
    promptTemplate: rolePackage.promptTemplate,
    persona: rolePackage.persona,
    work: rolePackage.work,
    values: {
      task: "Explain why minimalism matters",
      context: "current debate round 1",
      allowed_events: JSON.stringify(["MINIMALIST_DONE", "REBUTTAL_NEEDED"]),
      last_output: "previous message",
      system_notes: "",
      round: "1"
    }
  });
  assert.ok(rendered.includes("Explain why minimalism matters"));
  assert.ok(rendered.includes("MINIMALIST_DONE"));
});

test("output schema rejects invalid payload", async () => {
  const rolePackage = await loadRolePackage({
    roleRef: minimalistRoleRef,
    baseDir: fixtureAssemblyBaseDir
  });
  assert.throws(() =>
    validateRoleOutputSchema({
      output: { content: "missing event" },
      schema: rolePackage.outputSchema,
      roleId: "minimalist"
    })
  );

  assert.doesNotThrow(() =>
    validateRoleOutputSchema({
      output: {
        event: "MINIMALIST_DONE",
        content: "Minimalism is the safest path",
        data: { stance: "minimal", confidence: 0.92 }
      },
      schema: rolePackage.outputSchema,
      roleId: "minimalist"
    })
  );
});
