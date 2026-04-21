import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

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
    allowed_events: JSON.stringify(["MINIMALIST_DONE", "REBUTTAL_NEEDED"]),
    user_preferences: "{\"language\":\"zh-CN\"}",
    task: "Explain why minimalism matters",
    input: "current debate round 1"
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
    agent: rolePackage.agent,
    values
  });
  assert.ok(rendered.includes("Explain why minimalism matters"));
  assert.ok(rendered.includes("MINIMALIST_DONE"));
  assert.ok(rendered.includes("\"language\":\"zh-CN\""));
});

test("role prompts render the new input and user_preferences fields", async () => {
  const rolePackage = await loadRolePackage({
    roleId: "debate-moderator",
    roleRootDir
  });

  const rendered = renderRolePrompt({
    promptTemplate: rolePackage.promptTemplate,
    agent: rolePackage.agent,
    values: {
      allowed_events: JSON.stringify(["SEND_MINIMALIST", "SEND_ALIGNMENTIST"]),
      user_preferences: "{\"language\":\"zh-CN\"}",
      task: "Coordinate the next debate turn",
      input: "judge requested another round"
    }
  });

  assert.match(rendered, /User preferences:/);
  assert.match(rendered, /judge requested another round/);
});

test("loadRolePackage fails fast when agent.md is missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-role-missing-agent-"));
  const rolesRoot = path.resolve(tempRoot, "roles");
  const roleDir = path.resolve(rolesRoot, "missing-agent");
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: "missing-agent",
        roleVersion: "1.0.0",
        name: "Missing Agent",
        description: "fixture",
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.resolve(roleDir, "prompt.md"), "{{agent}}\n\n{{task}}\n", "utf8");
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify({ type: "object", additionalProperties: true }, null, 2),
    "utf8"
  );

  await assert.rejects(
    () =>
      loadRolePackage({
        roleId: "missing-agent",
        roleRootDir: rolesRoot
      }),
    /agent\.md|ENOENT/
  );
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
