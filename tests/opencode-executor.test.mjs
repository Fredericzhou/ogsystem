import test from "node:test";
import assert from "node:assert/strict";

import {
  executeOpencodeModelRole,
  startOpencodeRunClient
} from "../dist/runtime/opencode-executor.js";

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

function makeRunClient(overrides = {}) {
  return {
    url: "http://127.0.0.1:4096",
    pid: 12345,
    startedAt: "2026-04-09T00:00:00.000Z",
    close() {},
    getOutput() {
      return "opencode server listening";
    },
    client: {
      session: {
        async create() {
          return {
            data: {
              id: "ses_123"
            }
          };
        },
        async prompt() {
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
        },
        async abort() {
          return true;
        }
      }
    },
    ...overrides
  };
}

test("startOpencodeRunClient starts one reusable shared server", async () => {
  let createClientArgs;

  const runClient = await startOpencodeRunClient(
    {
      timeoutMs: 5000
    },
    {
      async startServer() {
        return {
          url: "http://127.0.0.1:4096",
          pid: 321,
          close() {},
          getOutput() {
            return "opencode server listening";
          }
        };
      },
      createClient(args) {
        createClientArgs = args;
        return makeRunClient().client;
      }
    }
  );

  assert.strictEqual(runClient.url, "http://127.0.0.1:4096");
  assert.strictEqual(runClient.pid, 321);
  assert.strictEqual(createClientArgs.baseUrl, "http://127.0.0.1:4096");
});

test("executeOpencodeModelRole uses shared server sessions and maps variant", async () => {
  let createArgs;
  let promptArgs;
  let closed = false;

  const runClient = makeRunClient({
    close() {
      closed = true;
    },
    client: {
      session: {
        async create(args) {
          createArgs = args;
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
        },
        async abort() {
          return true;
        }
      }
    }
  });

  const result = await executeOpencodeModelRole({
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
    maxOutputBytes: 4096,
    runClient
  });

  assert.deepStrictEqual(createArgs, {
    title: createArgs.title,
    directory: "/tmp/run/roles/debate-moderator"
  });
  assert.strictEqual(promptArgs.sessionID, "ses_123");
  assert.strictEqual(promptArgs.directory, "/tmp/run/roles/debate-moderator");
  assert.strictEqual(promptArgs.variant, "low");
  assert.deepStrictEqual(promptArgs.model, {
    providerID: "openai",
    modelID: "gpt-5.4-mini"
  });
  assert.strictEqual(promptArgs.format.type, "json_schema");
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "SEND_MINIMALIST",
    content: "dispatch"
  });
  assert.match(result.stderr, /step-start/);
  assert.match(result.stderr, /planner:completed/);
  assert.strictEqual(result.sessionId, "ses_123");
  assert.strictEqual(result.messageId, "msg_456");
  assert.strictEqual(result.serverPid, 12345);
  assert.strictEqual(closed, false);
});

test("executeOpencodeModelRole rejects unsupported model args before using run client", async () => {
  await assert.rejects(
    executeOpencodeModelRole({
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
      maxOutputBytes: 4096,
      runClient: makeRunClient()
    }),
    /Unsupported OpenCode model args/
  );
});

test("executeOpencodeModelRole keeps sessions isolated on one shared server", async () => {
  const createCalls = [];
  const promptCalls = [];
  let sequence = 0;

  const runClient = makeRunClient({
    url: "http://127.0.0.1:4096",
    pid: 321,
    client: {
      session: {
        async create(args) {
          createCalls.push(args);
          sequence += 1;
          return {
            data: {
              id: `ses_${sequence}`
            }
          };
        },
        async prompt(args) {
          promptCalls.push(args);
          return {
            data: {
              id: `msg_${args.sessionID}`,
              info: {
                structured: {
                  event: "NEXT",
                  content: `${args.sessionID}:${args.parts[0].text}`
                }
              },
              parts: [{ type: "step-start" }, { type: "step-finish" }]
            }
          };
        },
        async abort() {
          return true;
        }
      }
    }
  });

  const schema = {
    type: "object",
    required: ["event", "content"],
    properties: {
      event: { type: "string" },
      content: { type: "string" }
    },
    additionalProperties: false
  };

  const first = await executeOpencodeModelRole({
    roleId: "role-a",
    prompt: "first",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/role-a",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  const second = await executeOpencodeModelRole({
    roleId: "role-b",
    prompt: "second",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/role-b",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  assert.deepStrictEqual(createCalls, [
    {
      title: createCalls[0].title,
      directory: "/tmp/run/roles/role-a"
    },
    {
      title: createCalls[1].title,
      directory: "/tmp/run/roles/role-b"
    }
  ]);
  assert.deepStrictEqual(
    promptCalls.map((entry) => ({
      sessionID: entry.sessionID,
      directory: entry.directory
    })),
    [
      {
        sessionID: "ses_1",
        directory: "/tmp/run/roles/role-a"
      },
      {
        sessionID: "ses_2",
        directory: "/tmp/run/roles/role-b"
      }
    ]
  );
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

test("executeOpencodeModelRole keeps session-local memory isolated for sibling sessions of the same role", async () => {
  let sequence = 0;
  const memoryBySessionId = new Map();

  const runClient = makeRunClient({
    client: {
      session: {
        async create() {
          sequence += 1;
          return {
            data: {
              id: `ses_${sequence}`
            }
          };
        },
        async prompt(args) {
          const prompt = args.parts[0].text;
          const rememberMatch = prompt.match(/^remember:(.+)$/);
          if (rememberMatch) {
            memoryBySessionId.set(args.sessionID, rememberMatch[1]);
            return {
              data: {
                id: `msg_${args.sessionID}_remember`,
                info: {
                  structured: {
                    event: "NEXT",
                    content: `stored:${rememberMatch[1]}`
                  }
                },
                parts: [{ type: "step-finish" }]
              }
            };
          }

          return {
            data: {
              id: `msg_${args.sessionID}_recall`,
              info: {
                structured: {
                  event: "NEXT",
                  content: memoryBySessionId.get(args.sessionID) ?? "missing"
                }
              },
              parts: [{ type: "step-finish" }]
            }
          };
        },
        async abort() {
          return true;
        }
      }
    }
  });

  const schema = {
    type: "object",
    required: ["event", "content"],
    properties: {
      event: { type: "string" },
      content: { type: "string" }
    },
    additionalProperties: false
  };

  const first = await executeOpencodeModelRole({
    roleId: "debate-summary",
    prompt: "remember:branch-a",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/debate-summary",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  const sibling = await executeOpencodeModelRole({
    roleId: "debate-summary",
    prompt: "recall",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/debate-summary",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  const continued = await executeOpencodeModelRole({
    roleId: "debate-summary",
    prompt: "recall",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/debate-summary",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient,
    sessionId: first.sessionId
  });

  assert.strictEqual(first.sessionId, "ses_1");
  assert.strictEqual(sibling.sessionId, "ses_2");
  assert.deepStrictEqual(JSON.parse(sibling.stdout), {
    event: "NEXT",
    content: "missing"
  });
  assert.deepStrictEqual(JSON.parse(continued.stdout), {
    event: "NEXT",
    content: "branch-a"
  });
});

test("executeOpencodeModelRole reuses an existing session when provided", async () => {
  let createCalls = 0;
  let promptSessionId;

  const result = await executeOpencodeModelRole({
    roleId: "role-loop",
    prompt: "continue debate",
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
    workdir: "/tmp/run/roles/role-loop",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient: makeRunClient({
      client: {
        session: {
          async create() {
            createCalls += 1;
            return {
              data: {
                id: "ses_created"
              }
            };
          },
          async prompt(args) {
            promptSessionId = args.sessionID;
            return {
              data: {
                id: "msg_loop",
                info: {
                  structured: {
                    event: "NEXT",
                    content: "continued"
                  }
                },
                parts: [{ type: "step-start" }, { type: "step-finish" }]
              }
            };
          },
          async abort() {
            return true;
          }
        }
      }
    }),
    sessionId: "ses_existing"
  });

  assert.strictEqual(createCalls, 0);
  assert.strictEqual(promptSessionId, "ses_existing");
  assert.strictEqual(result.sessionId, "ses_existing");
  assert.strictEqual(result.messageId, "msg_loop");
});

test("executeOpencodeModelRole keeps session-local memory isolated across sessions", async () => {
  let createCalls = 0;
  const sessionMemory = new Map();

  const schema = {
    type: "object",
    required: ["event", "content"],
    properties: {
      event: { type: "string" },
      content: { type: "string" }
    },
    additionalProperties: false
  };

  const runClient = makeRunClient({
    client: {
      session: {
        async create() {
          createCalls += 1;
          return {
            data: {
              id: `ses_${createCalls}`
            }
          };
        },
        async prompt(args) {
          const command = args.parts[0].text.trim();
          if (command.startsWith("remember:")) {
            sessionMemory.set(args.sessionID, command.slice("remember:".length));
          }
          return {
            data: {
              id: `msg_${args.sessionID}_${sessionMemory.size}`,
              info: {
                structured: {
                  event: "NEXT",
                  content: sessionMemory.get(args.sessionID) ?? ""
                }
              },
              parts: [{ type: "step-start" }, { type: "step-finish" }]
            }
          };
        },
        async abort() {
          return true;
        }
      }
    }
  });

  const branchAFirst = await executeOpencodeModelRole({
    roleId: "role-shared",
    prompt: "remember:branch-a-secret",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/role-shared",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });
  const branchASecond = await executeOpencodeModelRole({
    roleId: "role-shared",
    prompt: "recall",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/role-shared",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient,
    sessionId: branchAFirst.sessionId
  });
  const branchBFirst = await executeOpencodeModelRole({
    roleId: "role-shared",
    prompt: "recall",
    schema,
    modelPackage: makeModelPackage(),
    workdir: "/tmp/run/roles/role-shared",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  assert.strictEqual(branchAFirst.sessionId, "ses_1");
  assert.strictEqual(branchASecond.sessionId, "ses_1");
  assert.strictEqual(branchBFirst.sessionId, "ses_2");
  assert.deepStrictEqual(JSON.parse(branchASecond.stdout), {
    event: "NEXT",
    content: "branch-a-secret"
  });
  assert.deepStrictEqual(JSON.parse(branchBFirst.stdout), {
    event: "NEXT",
    content: ""
  });
});

test("executeOpencodeModelRole aborts only the timed out session", async () => {
  const aborted = [];

  await assert.rejects(
    executeOpencodeModelRole({
      roleId: "role-timeout",
      prompt: "hang",
      schema: {
        type: "object",
        properties: {
          content: { type: "string" }
        }
      },
      modelPackage: makeModelPackage(),
      workdir: "/tmp/run/roles/role-timeout",
      timeoutMs: 10,
      maxOutputBytes: 4096,
      runClient: makeRunClient({
        client: {
          session: {
            async create() {
              return {
                data: {
                  id: "ses_timeout"
                }
              };
            },
            async prompt() {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return {
                data: {
                  id: "msg_timeout",
                  info: {
                    structured: {
                      content: "late"
                    }
                  },
                  parts: []
                }
              };
            },
            async abort(args) {
              aborted.push(args);
              return true;
            }
          }
        }
      })
    }),
    /Command timeout/
  );

  assert.deepStrictEqual(aborted, [
    {
      sessionID: "ses_timeout",
      directory: "/tmp/run/roles/role-timeout"
    }
  ]);
});

test("executeOpencodeModelRole aborts a session created after timeout", async () => {
  const aborted = [];
  let promptCalls = 0;

  await assert.rejects(
    executeOpencodeModelRole({
      roleId: "role-timeout-create-race",
      prompt: "hang on create",
      schema: {
        type: "object",
        properties: {
          content: { type: "string" }
        }
      },
      modelPackage: makeModelPackage(),
      workdir: "/tmp/run/roles/role-timeout-create-race",
      timeoutMs: 10,
      maxOutputBytes: 4096,
      runClient: makeRunClient({
        client: {
          session: {
            async create() {
              await new Promise((resolve) => setTimeout(resolve, 50));
              return {
                data: {
                  id: "ses_create_late"
                }
              };
            },
            async prompt() {
              promptCalls += 1;
              return {
                data: {
                  id: "msg_create_late",
                  info: {
                    structured: {
                      content: "should-not-run"
                    }
                  },
                  parts: []
                }
              };
            },
            async abort(args) {
              aborted.push(args);
              return true;
            }
          }
        }
      })
    }),
    /Command timeout/
  );

  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.strictEqual(promptCalls, 0);
  assert.deepStrictEqual(aborted, [
    {
      sessionID: "ses_create_late",
      directory: "/tmp/run/roles/role-timeout-create-race"
    }
  ]);
});

test("executeOpencodeModelRole retries transient prompt failures on the same session", async () => {
  const createdSessions = [];
  const promptedSessions = [];
  const abortedSessions = [];
  let promptAttempts = 0;

  const result = await executeOpencodeModelRole({
    roleId: "role-retry",
    prompt: "retry once",
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
    workdir: "/tmp/run/roles/role-retry",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient: makeRunClient({
      client: {
        session: {
          async create() {
            const sessionID = `ses_${createdSessions.length + 1}`;
            createdSessions.push(sessionID);
            return {
              data: {
                id: sessionID
              }
            };
          },
          async prompt(args) {
            promptedSessions.push(args.sessionID);
            promptAttempts += 1;
            if (promptAttempts === 1) {
              throw new Error(
                'Type validation failed: Value: {"error":{"type":"api_error","message":"Service temporarily unavailable"}}'
              );
            }
            return {
              data: {
                id: "msg_2",
                info: {
                  structured: {
                    event: "NEXT",
                    content: "recovered"
                  }
                },
                parts: [{ type: "step-start" }, { type: "step-finish" }]
              }
            };
          },
          async abort(args) {
            abortedSessions.push(args.sessionID);
            return true;
          }
        }
      }
    })
  });

  assert.deepStrictEqual(createdSessions, ["ses_1"]);
  assert.deepStrictEqual(promptedSessions, ["ses_1", "ses_1"]);
  assert.deepStrictEqual(abortedSessions, ["ses_1"]);
  assert.strictEqual(result.sessionId, "ses_1");
  assert.strictEqual(result.messageId, "msg_2");
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "NEXT",
    content: "recovered"
  });
});

test("executeOpencodeModelRole continues retry when transient-error abort cleanup fails", async () => {
  const promptedSessions = [];
  let promptAttempts = 0;

  const result = await executeOpencodeModelRole({
    roleId: "role-retry-abort-failure",
    prompt: "retry with abort failure",
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
    workdir: "/tmp/run/roles/role-retry-abort-failure",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient: makeRunClient({
      client: {
        session: {
          async create() {
            return {
              data: {
                id: "ses_retry_abort_fail"
              }
            };
          },
          async prompt(args) {
            promptedSessions.push(args.sessionID);
            promptAttempts += 1;
            if (promptAttempts === 1) {
              throw new Error(
                'Type validation failed: Value: {"error":{"type":"api_error","message":"Service temporarily unavailable"}}'
              );
            }
            return {
              data: {
                id: "msg_retry_abort_fail",
                info: {
                  structured: {
                    event: "NEXT",
                    content: "recovered despite abort failure"
                  }
                },
                parts: [{ type: "step-start" }, { type: "step-finish" }]
              }
            };
          },
          async abort() {
            throw new Error("abort failed");
          }
        }
      }
    })
  });

  assert.deepStrictEqual(promptedSessions, ["ses_retry_abort_fail", "ses_retry_abort_fail"]);
  assert.strictEqual(result.sessionId, "ses_retry_abort_fail");
  assert.strictEqual(result.messageId, "msg_retry_abort_fail");
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "NEXT",
    content: "recovered despite abort failure"
  });
});

test("executeOpencodeModelRole accepts JSON string structured output", async () => {
  const result = await executeOpencodeModelRole({
    roleId: "role-string-structured",
    prompt: "return json text",
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
    workdir: "/tmp/run/roles/role-string-structured",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient: makeRunClient({
      client: {
        session: {
          async create() {
            return { data: { id: "ses_string" } };
          },
          async prompt() {
            return {
              data: {
                id: "msg_string",
                info: {
                  structured: '{"event":"NEXT","content":"string"}'
                },
                parts: [{ type: "step-start" }, { type: "step-finish" }]
              }
            };
          },
          async abort() {
            return true;
          }
        }
      }
    })
  });

  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "NEXT",
    content: "string"
  });
});

test("executeOpencodeModelRole falls back to text parts when structured output is missing", async () => {
  const result = await executeOpencodeModelRole({
    roleId: "role-parts-fallback",
    prompt: "return json in text",
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
    workdir: "/tmp/run/roles/role-parts-fallback",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient: makeRunClient({
      client: {
        session: {
          async create() {
            return { data: { id: "ses_parts" } };
          },
          async prompt() {
            return {
              data: {
                id: "msg_parts",
                info: {},
                parts: [
                  { type: "step-start" },
                  {
                    type: "text",
                    text: '{"event":"NEXT","content":"from-parts"}'
                  }
                ]
              }
            };
          },
          async abort() {
            return true;
          }
        }
      }
    })
  });

  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "NEXT",
    content: "from-parts"
  });
});

test("executeOpencodeModelRole retries once with corrective prompt when structured output is missing", async () => {
  const promptInputs = [];
  let callCount = 0;

  const result = await executeOpencodeModelRole({
    roleId: "role-corrective-retry",
    prompt: "return json",
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
    workdir: "/tmp/run/roles/role-corrective-retry",
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient: makeRunClient({
      client: {
        session: {
          async create() {
            return { data: { id: "ses_retry_structured" } };
          },
          async prompt(args) {
            promptInputs.push(args.parts[0]?.text ?? "");
            callCount += 1;
            if (callCount === 1) {
              return {
                data: {
                  id: "msg_retry_1",
                  info: {},
                  parts: [{ type: "step-start" }]
                }
              };
            }
            return {
              data: {
                id: "msg_retry_2",
                info: {
                  structured: {
                    event: "NEXT",
                    content: "corrected"
                  }
                },
                parts: [{ type: "step-finish" }]
              }
            };
          },
          async abort() {
            return true;
          }
        }
      }
    })
  });

  assert.strictEqual(callCount, 2);
  assert.match(promptInputs[1], /Return exactly one JSON object/);
  assert.deepStrictEqual(JSON.parse(result.stdout), {
    event: "NEXT",
    content: "corrected"
  });
});

test("executeOpencodeModelRole surfaces SDK create error payload instead of generic session-id failure", async () => {
  await assert.rejects(
    executeOpencodeModelRole({
      roleId: "role-create-error-payload",
      prompt: "hello",
      schema: {
        type: "object",
        properties: {
          content: { type: "string" }
        }
      },
      modelPackage: makeModelPackage(),
      workdir: "/tmp/run/roles/role-create-error-payload",
      timeoutMs: 5000,
      maxOutputBytes: 4096,
      runClient: makeRunClient({
        client: {
          session: {
            async create() {
              return {
                error: {
                  name: "UnknownError",
                  data: {
                    message: "DrizzleError: Failed to run session.create"
                  }
                }
              };
            },
            async prompt() {
              throw new Error("prompt should not be called");
            },
            async abort() {
              return true;
            }
          }
        }
      })
    }),
    /DrizzleError: Failed to run session\.create/
  );
});

test("executeOpencodeModelRole adds remediation hint for openai-compatible responses mismatch", async () => {
  await assert.rejects(
    executeOpencodeModelRole({
      roleId: "role-openai-compatible-mismatch",
      prompt: "hello",
      schema: {
        type: "object",
        properties: {
          content: { type: "string" }
        }
      },
      modelPackage: makeModelPackage({
        model: "openai/gpt-5.4"
      }),
      workdir: "/tmp/run/roles/role-openai-compatible-mismatch",
      timeoutMs: 5000,
      maxOutputBytes: 4096,
      runClient: makeRunClient({
        client: {
          session: {
            async create() {
              return {
                data: {
                  id: "ses_mismatch"
                }
              };
            },
            async prompt() {
              throw new Error(
                "sdk.responses is not a function. (In 'sdk.responses(modelID)', 'sdk.responses' is undefined)"
              );
            },
            async abort() {
              return true;
            }
          }
        }
      })
    }),
    /@ai-sdk\/openai-compatible/
  );
});
