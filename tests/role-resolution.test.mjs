import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import {
  loadRolePackage,
  renderRolePrompt,
  validateRoleInputSchema,
  validateRolePackageManifest,
  validateRoleOutputSchema
} from "../dist/runtime/role-repo.js";
import { RUNTIME_ROLE_PROMPT_INPUT_SCHEMA } from "../dist/runtime/role-prompt-input-schema.js";

const roleRootDir = path.resolve("og-roles/roles");

test("loadRolePackage resolves role directory and renders contextual fields", async () => {
  const rolePackage = await loadRolePackage({
    roleId: "debate-minimalist",
    roleRootDir
  });

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
      schema: RUNTIME_ROLE_PROMPT_INPUT_SCHEMA,
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

test("loop-aware role prompts can render the injected round field", async () => {
  const rolePackage = await loadRolePackage({
    roleId: "debate-moderator",
    roleRootDir
  });

  const rendered = renderRolePrompt({
    promptTemplate: rolePackage.promptTemplate,
    persona: rolePackage.persona,
    work: rolePackage.work,
    values: {
      task: "Coordinate the next debate turn",
      context: "judge requested another round",
      allowed_events: JSON.stringify(["SEND_MINIMALIST", "SEND_ALIGNMENTIST"]),
      last_output: "judge requested another round",
      system_notes: "",
      round: "2",
      user_profile: "{\"language\":\"zh-CN\"}"
    }
  });

  assert.match(rendered, /Round:\s*2/);
  assert.match(rendered, /judge requested another round/);
});

test("role manifests reject legacy inputSchema fields", () => {
  assert.throws(
    () =>
      validateRolePackageManifest(
        {
          roleId: "legacy-role",
          roleVersion: "1.0.0",
          name: "Legacy Role",
          description: "legacy",
          promptTemplate: "prompt.md",
          inputSchema: "../_shared/input.schema.json",
          outputSchema: "output.schema.json"
        },
        "legacy-role/role.json"
      ),
    /unknown field/
  );
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
