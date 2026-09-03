import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

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
          outputSchema: "output.schema.json",
          contractVersion: 1,
          purpose: "Validate a stable fixture responsibility",
          responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
          inputs: { preconditions: [] },
          outputs: { events: [], postconditions: [] },
          authority: { controlActions: [] },
          constraints: { writableStateFields: [], allowedTools: [] },
          failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
          audit: { requiredFields: [] }
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

test("role manifests reject removed inputSchema fields", () => {
  assert.throws(
    () =>
      validateRolePackageManifest(
        {
          roleId: "invalid-old-field-role",
          roleVersion: "1.0.0",
          name: "Invalid Old Field Role",
          description: "invalid old field",
          promptTemplate: "prompt.md",
          inputSchema: "../_shared/input.schema.json",
          outputSchema: "output.schema.json"
        },
        "invalid-old-field-role/role.json"
      ),
    /unknown field/
  );
});

test("role manifests require the current Role Contract sections", () => {
  assert.throws(
    () =>
      validateRolePackageManifest(
        {
          roleId: "missing-contract-role",
          roleVersion: "1.0.0",
          name: "Missing Contract Role",
          description: "missing current contract",
          promptTemplate: "prompt.md",
          outputSchema: "output.schema.json"
        },
        "missing-contract-role/role.json"
      ),
    /\$\.responsibility.*expected object/
  );
});

test("role purposes reject concrete identities but preserve domain terminology", async () => {
  const base = JSON.parse(await readFile(path.resolve(roleRootDir, "hello-ogsystem", "role.json"), "utf8"));

  assert.doesNotThrow(() => validateRolePackageManifest({
    ...base,
    purpose: "Coordinates human review and Model QA findings."
  }, "valid-purpose/role.json"));
  for (const purpose of [
    "Analyzes Google Ads performance",
    "Optimizes Amazon Marketplace listings",
    "Plans Meta Ads campaigns",
    "Maintains a shared run workspace and selects a terminal branch"
  ]) {
    assert.doesNotThrow(() => validateRolePackageManifest({ ...base, purpose }, "domain-purpose/role.json"));
  }

  for (const purpose of [
    "OpenAI GPT-5 operator Alice",
    "ChatGPT specialist",
    "Uses openai/gpt-5 for analysis",
    "Coordinates work for operator Alice",
    "Runs the session instance session-42",
    "Uses provider: acme-runtime"
  ]) {
    assert.throws(
      () => validateRolePackageManifest({ ...base, purpose }, "concrete-purpose/role.json"),
      /must describe an abstract responsibility/
    );
  }
});

test("role contracts reject overlapping failure classes and unknown audit fields", async () => {
  const base = JSON.parse(await readFile(path.resolve(roleRootDir, "hello-ogsystem", "role.json"), "utf8"));
  base.failure.retryableErrorCodes = ["TEMPORARY_IO"];
  base.failure.terminalErrorCodes = ["TEMPORARY_IO"];
  assert.throws(
    () => validateRolePackageManifest(base, "invalid-failure/role.json"),
    /cannot be both retryable and terminal/
  );

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogs-role-audit-contract-"));
  const roleDir = path.join(tempRoot, "writer");
  await mkdir(roleDir, { recursive: true });
  const valid = JSON.parse(await readFile(path.resolve(roleRootDir, "hello-ogsystem", "role.json"), "utf8"));
  valid.roleId = "writer";
  valid.audit.requiredFields = ["not_an_audit_field"];
  await writeFile(path.join(roleDir, "role.json"), JSON.stringify(valid), "utf8");
  for (const file of ["prompt.md", "agent.md", "output.schema.json"]) {
    await writeFile(path.join(roleDir, file), await readFile(path.resolve(roleRootDir, "hello-ogsystem", file)), "utf8");
  }
  await assert.rejects(
    () => loadRolePackage({ roleId: "writer", roleRootDir: tempRoot }),
    /unknown audit or output field not_an_audit_field/
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
