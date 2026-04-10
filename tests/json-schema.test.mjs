import test from "node:test";
import assert from "node:assert/strict";

import { validateRoleOutputSchema } from "../dist/runtime/role-repo.js";

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
