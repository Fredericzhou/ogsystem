import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { validateRoleOutputSchema } from "../dist/runtime/role-repo.js";

const proposerRoleDir = new URL("../examples/mulit-debate-ogs/og-roles/roles/investment-proposer/", import.meta.url);
const proposerSchema = JSON.parse(await readFile(new URL("output.schema.json", proposerRoleDir), "utf8"));
const proposerPrompt = await readFile(new URL("prompt.md", proposerRoleDir), "utf8");
const debateJudgeSchema = JSON.parse(await readFile(new URL("../debate-judge/output.schema.json", proposerRoleDir), "utf8"));

const nestedOutputSchema = {
  type: "object",
  required: ["event", "content", "data"],
  additionalProperties: false,
  properties: {
    event: {
      type: "string",
      enum: ["DECISION_READY"]
    },
    content: {
      type: "string"
    },
    data: {
      type: "object",
      required: ["score", "tags"],
      additionalProperties: false,
      properties: {
        score: {
          type: "integer"
        },
        tags: {
          type: "array",
          items: {
            type: "string"
          }
        }
      }
    }
  }
};

test("role output schema validation accepts nested objects, arrays, and integer fields", () => {
  assert.doesNotThrow(() =>
    validateRoleOutputSchema({
      roleId: "debate-judge",
      schema: nestedOutputSchema,
      schemaPath: "/tmp/roles/debate-judge/output.schema.json",
      output: {
        event: "DECISION_READY",
        content: "done",
        data: {
          score: 2,
          tags: ["risk", "architecture"]
        }
      }
    })
  );
});

test("role output schema validation reports enum and path details", () => {
  assert.throws(
    () =>
      validateRoleOutputSchema({
        roleId: "debate-judge",
        schema: nestedOutputSchema,
        schemaPath: "/tmp/roles/debate-judge/output.schema.json",
        output: {
          event: "REBUTTAL_NEEDED",
          content: "done",
          data: {
            score: 2,
            tags: ["risk"]
          }
        }
      }),
    /Role "debate-judge" output does not match schema in \/tmp\/roles\/debate-judge\/output\.schema\.json: \$\.event: must be equal to one of the allowed values/
  );
});

test("role output schema validation rejects nested additional properties", () => {
  assert.throws(
    () =>
      validateRoleOutputSchema({
        roleId: "debate-judge",
        schema: nestedOutputSchema,
        schemaPath: "/tmp/roles/debate-judge/output.schema.json",
        output: {
          event: "DECISION_READY",
          content: "done",
          data: {
            score: 2,
            tags: ["risk"],
            extra: true
          }
        }
      }),
    /\$\.data\.extra: additional property not allowed/
  );
});

test("investment proposer keeps its optional event contract aligned with its schema", () => {
  assert.match(proposerPrompt, /event is optional for this parallel_split role/i);
  assert.deepEqual(proposerSchema.required, ["content", "data"]);
  assert.deepEqual(proposerSchema.properties.event.enum, ["SEND_CRITIC", "SEND_OPTIMIZER"]);
  assert.doesNotThrow(() =>
    validateRoleOutputSchema({
      roleId: "investment-proposer",
      schema: proposerSchema,
      schemaPath: "examples/mulit-debate-ogs/og-roles/roles/investment-proposer/output.schema.json",
      output: {
        content: "A reviewable proposal",
        data: { debate_round: 1 }
      }
    })
  );
  assert.throws(() =>
    validateRoleOutputSchema({
      roleId: "investment-proposer",
      schema: proposerSchema,
      schemaPath: "examples/mulit-debate-ogs/og-roles/roles/investment-proposer/output.schema.json",
      output: {
        event: "UNKNOWN",
        content: "A reviewable proposal",
        data: { debate_round: 1 }
      }
    }),
    /\$\.event: must be equal to one of the allowed values/
  );
});

test("investment debate schemas keep branch contracts strict and distinct", () => {
  assert.doesNotThrow(() => validateRoleOutputSchema({
    roleId: "debate-judge",
    schema: debateJudgeSchema,
    schemaPath: "examples/mulit-debate-ogs/og-roles/roles/debate-judge/output.schema.json",
    output: {
      event: "REBUTTAL_NEEDED",
      content: "A bounded objection remains.",
      data: { consensus_reached: false, objections: { summary: "Missing evidence." } }
    }
  }));
  assert.doesNotThrow(() => validateRoleOutputSchema({
    roleId: "debate-judge",
    schema: debateJudgeSchema,
    schemaPath: "examples/mulit-debate-ogs/og-roles/roles/debate-judge/output.schema.json",
    output: {
      event: "DECISION_READY",
      content: "The decision is ready with stated uncertainty.",
      data: { consensus_reached: true, decision: "Proceed to diligence." }
    }
  }));
  assert.throws(() => validateRoleOutputSchema({
    roleId: "debate-judge",
    schema: debateJudgeSchema,
    schemaPath: "examples/mulit-debate-ogs/og-roles/roles/debate-judge/output.schema.json",
    output: {
      event: "DECISION_READY",
      content: "Invalid branch payload.",
      data: { consensus_reached: false, objections: { summary: "Not ready." } }
    }
  }));
});
