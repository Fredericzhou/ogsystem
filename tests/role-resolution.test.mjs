import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  loadRolePackage,
  renderRolePrompt,
  validateRoleInputSchema,
  validateRoleOutputSchema
} from "../dist/runtime/role-repo.js";

const roleRootDir = path.resolve("og-roles/roles");

test("loadRolePackage resolves role directory and renders contextual fields", async () => {
  const rolePackage = await loadRolePackage({
    roleId: "debate-minimalist",
    roleRootDir
  });
  assert.ok(rolePackage.inputSchema);

  const values = {
    task: "Explain why minimalism matters",
    context: "current debate round 1",
    allowed_events: JSON.stringify(["MINIMALIST_DONE", "REBUTTAL_NEEDED"]),
    last_output: "previous message",
    system_notes: "",
    round: "1"
  };

  assert.doesNotThrow(() =>
    validateRoleInputSchema({
      input: values,
      schema: rolePackage.inputSchema,
      roleId: "debate-minimalist"
    })
  );

  const rendered = renderRolePrompt({
    promptTemplate: rolePackage.promptTemplate,
    persona: rolePackage.persona,
    work: rolePackage.work,
    values
  });
  assert.ok(rendered.includes("Explain why minimalism matters"));
  assert.ok(rendered.includes("MINIMALIST_DONE"));
});

test("output schema rejects invalid payload", async () => {
  const rolePackage = await loadRolePackage({
    roleId: "debate-minimalist",
    roleRootDir
  });
  assert.throws(() =>
    validateRoleOutputSchema({
      output: { content: "missing event" },
      schema: rolePackage.outputSchema,
      roleId: "debate-minimalist"
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
      roleId: "debate-minimalist"
    })
  );
});
