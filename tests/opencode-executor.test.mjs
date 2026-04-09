import test from "node:test";
import assert from "node:assert/strict";

import { executeOpencodeModelRole } from "../dist/runtime/opencode-executor.js";

function makeModelPackage(overrides = {}) {
  return {
    resolvedPath: "/tmp/model",
    manifest: {
      modelId: "fast-gpt54",
      executor: "opencode",
      model: "openai/gpt-5.4-mini",
      args: {
        reasoningEffort: "low"
      },
      timeoutMs: 60000,
      maxOutputBytes: 32768,
      tags: ["fast"],
      ...overrides
    }
  };
}

test("executeOpencodeModelRole uses SDK structured output and maps variant", async () => {
  let closed = false;
  let promptArgs;

  const result = await executeOpencodeModelRole(
    {
      roleId: "debate-moderator",
      prompt: "return structured output",
      schema: {
        type: "object",
        required: ["event", "content"],
        properties: {
          event: { type: "string" },
          content: { type: "string" }
        },
        additionalProperties: false
      },
      modelPackage: makeModelPackage(),
      workdir: "/tmp/run/roles/debate-moderator",
      timeoutMs: 5000,
      maxOutputBytes: 4096
    },
    {
      async startServer() {
        return {
          url: "http://127.0.0.1:4096",
          pid: 12345,
          close() {
            closed = true;
          },
          getOutput() {
            return "opencode server listening";
          }
        };
      },
      createClient() {
        return {
          session: {
            async create() {
              return {
                data: {
                  id: "ses_123"
                }
              };
            },
            async prompt(args) {
              promptArgs = args;
              return {
                data: {
                  id: "msg_456",
                  info: {
                    structured: {
                      event: "SEND_MINIMALIST",
                      content: "dispatch"
                    }
                  },
                  parts: [
                    { type: "step-start" },
                    {
                      type: "tool",
                      tool: "planner",
                      state: {
                        status: "completed"
                      }
                    }
                  ]
                }
              };
            }
          }
        };
      }
    }
  );

  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "SEND_MINIMALIST",
    content: "dispatch"
  });
  assert.match(result.stderr, /step-start/);
  assert.match(result.stderr, /planner:completed/);
  assert.strictEqual(result.sessionId, "ses_123");
  assert.strictEqual(result.messageId, "msg_456");
  assert.strictEqual(result.serverPid, 12345);
  assert.strictEqual(promptArgs.variant, "low");
  assert.deepStrictEqual(promptArgs.model, {
    providerID: "openai",
    modelID: "gpt-5.4-mini"
  });
  assert.strictEqual(promptArgs.format.type, "json_schema");
  assert.strictEqual(closed, true);
});

test("executeOpencodeModelRole rejects unsupported model args before transport startup", async () => {
  await assert.rejects(
    executeOpencodeModelRole(
      {
        roleId: "debate-moderator",
        prompt: "return structured output",
        schema: {
          type: "object",
          properties: {
            content: { type: "string" }
          }
        },
        modelPackage: makeModelPackage({
          args: {
            temperature: "0.1"
          }
        }),
        workdir: "/tmp/run/roles/debate-moderator",
        timeoutMs: 5000,
        maxOutputBytes: 4096
      },
      {
        async startServer() {
          throw new Error("transport should not start");
        },
        createClient() {
          throw new Error("transport should not create client");
        }
      }
    ),
    /Unsupported OpenCode model args/
  );
});

test("executeOpencodeModelRole keeps sessions isolated when transport reuses one server", async () => {
  const server = {
    url: "http://127.0.0.1:4096",
    pid: 321,
    close() {},
    getOutput() {
      return "opencode server listening";
    }
  };

  const createdSessionIds = [];
  const clientBindings = [];
  let sequence = 0;

  const transport = {
    async startServer() {
      return server;
    },
    createClient(args) {
      clientBindings.push(args);
      return {
        session: {
          async create() {
            sequence += 1;
            const sessionID = `ses_${sequence}`;
            createdSessionIds.push(sessionID);
            return { data: { id: sessionID } };
          },
          async prompt(promptArgs) {
            return {
              data: {
                id: `msg_${promptArgs.sessionID}`,
                info: {
                  structured: {
                    event: "NEXT",
                    content: `${promptArgs.sessionID}:${promptArgs.parts[0].text}`
                  }
                },
                parts: [{ type: "step-start" }, { type: "step-finish" }]
              }
            };
          }
        }
      };
    }
  };

  const first = await executeOpencodeModelRole(
    {
      roleId: "role-a",
      prompt: "first",
      schema: {
        type: "object",
        required: ["event", "content"],
        properties: {
          event: { type: "string" },
          content: { type: "string" }
        },
        additionalProperties: false
      },
      modelPackage: makeModelPackage(),
      workdir: "/tmp/run/roles/role-a",
      timeoutMs: 5000,
      maxOutputBytes: 4096
    },
    transport
  );

  const second = await executeOpencodeModelRole(
    {
      roleId: "role-b",
      prompt: "second",
      schema: {
        type: "object",
        required: ["event", "content"],
        properties: {
          event: { type: "string" },
          content: { type: "string" }
        },
        additionalProperties: false
      },
      modelPackage: makeModelPackage(),
      workdir: "/tmp/run/roles/role-b",
      timeoutMs: 5000,
      maxOutputBytes: 4096
    },
    transport
  );

  assert.strictEqual(clientBindings.length, 2);
  assert.deepStrictEqual(clientBindings.map((entry) => entry.baseUrl), [
    "http://127.0.0.1:4096",
    "http://127.0.0.1:4096"
  ]);
  assert.deepStrictEqual(clientBindings.map((entry) => entry.directory), [
    "/tmp/run/roles/role-a",
    "/tmp/run/roles/role-b"
  ]);

  assert.deepStrictEqual(createdSessionIds, ["ses_1", "ses_2"]);
  assert.strictEqual(first.sessionId, "ses_1");
  assert.strictEqual(second.sessionId, "ses_2");
  assert.strictEqual(first.messageId, "msg_ses_1");
  assert.strictEqual(second.messageId, "msg_ses_2");
  assert.deepStrictEqual(JSON.parse(first.stdout), {
    event: "NEXT",
    content: "ses_1:first"
  });
  assert.deepStrictEqual(JSON.parse(second.stdout), {
    event: "NEXT",
    content: "ses_2:second"
  });
});
