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
    round: "1",
    user_profile: "{\"language\":\"zh-CN\"}"
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

test("schema validation supports nested objects, arrays, enums, and additionalProperties", () => {
  const schema = {
    type: "object",
    required: ["event", "content", "data"],
    properties: {
      event: {
        type: "string",
        enum: ["DONE"]
      },
      content: {
        type: "string"
      },
      data: {
        type: "object",
        required: ["summary", "scores"],
        properties: {
          summary: {
            type: "string"
          },
          scores: {
            type: "array",
            items: {
              type: "integer"
            }
          }
        },
        additionalProperties: false
      }
    },
    additionalProperties: false
  };

  assert.doesNotThrow(() =>
    validateRoleOutputSchema({
      output: {
        event: "DONE",
        content: "ok",
        data: {
          summary: "nested",
          scores: [1, 2, 3]
        }
      },
      schema,
      roleId: "inline-role",
      schemaPath: "inline-output.schema.json"
    })
  );

  assert.throws(
    () =>
      validateRoleOutputSchema({
        output: {
          event: "DONE",
          content: "ok",
          data: {
            summary: "nested",
            scores: [1, 2],
            extra: true
          }
        },
        schema,
        roleId: "inline-role",
        schemaPath: "inline-output.schema.json"
      }),
    /inline-output\.schema\.json/
  );

  assert.throws(
    () =>
      validateRoleOutputSchema({
        output: {
          event: "OTHER",
          content: "ok",
          data: {
            summary: "nested",
            scores: [1, 2]
          }
        },
        schema,
        roleId: "inline-role",
        schemaPath: "inline-output.schema.json"
      }),
    /allowed values/
  );
});
