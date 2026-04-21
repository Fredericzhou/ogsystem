import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  loadNl2MmdContext,
  runNl2MmdPreflight,
  runNl2MmdTurn
} from "../dist/nl2mmd/index.js";
import { logNl2MmdDebug } from "../dist/nl2mmd/logger.js";

const repoRoot = path.resolve(".");

let fixtureCache;

async function loadFixtures() {
  if (!fixtureCache) {
    fixtureCache = (async () => {
      const context = await loadNl2MmdContext({
        workdir: repoRoot
      });
      const modelRef = context.defaultModelRef ?? "opencode/gpt-5-nano";
      const validMermaid = await readFile(
        path.resolve(repoRoot, "examples/langgraph-debate-current/system.mmd"),
        "utf8"
      );
      return {
        context,
        modelRef,
        timeoutMs: context.defaultTimeoutMs ?? 120000,
        maxOutputBytes: context.defaultMaxOutputBytes ?? 65536,
        validMermaid,
        lawsPath: path.resolve(repoRoot, "examples/langgraph-debate-current/laws.json")
      };
    })();
  }
  return fixtureCache;
}

function structuredResponse(structured, id = "msg_001") {
  return {
    data: {
      id,
      info: {
        structured
      },
      parts: [{ type: "step-start" }, { type: "step-finish" }]
    }
  };
}

function makeRunClient(responses) {
  const createCalls = [];
  const promptCalls = [];

  return {
    createCalls,
    promptCalls,
    runClient: {
      url: "http://127.0.0.1:4096",
      pid: 12345,
      startedAt: "2026-04-12T00:00:00.000Z",
      close() {},
      getOutput() {
        return "opencode server listening";
      },
      client: {
        session: {
          async create(args) {
            createCalls.push(args);
            return {
              data: {
                id: `ses_${createCalls.length}`
              }
            };
          },
          async prompt(args) {
            promptCalls.push(args);
            const next = responses.shift();
            if (!next) {
              throw new Error("Unexpected NL2MMD prompt call");
            }
            return next;
          },
          async abort() {
            return true;
          }
        }
      }
    }
  };
}

test("nl2mmd service preflight creates one session and turn reuses it", async () => {
  const { context, modelRef, timeoutMs, maxOutputBytes } = await loadFixtures();
  const { runClient, createCalls, promptCalls } = makeRunClient([
    structuredResponse({ status: "ok" }, "msg_preflight"),
    structuredResponse(
      {
        mode: "ask",
        summary: "Need one missing role clarified before drafting the graph.",
        questions: ["Should @not-found-role be mapped to an existing local role?"],
        assumptions: ["Existing debate roles remain reusable."],
        referencedRoles: ["debate-judge"],
        unresolvedItems: ["@not-found-role"],
        mermaid: ""
      },
      "msg_turn"
    )
  ]);

  const conversation = {
    context,
    modelRef,
    timeoutMs,
    maxOutputBytes,
    workdir: repoRoot,
    sessionId: undefined,
    close() {},
    runClient
  };

  await runNl2MmdPreflight({
    conversation
  });

  assert.strictEqual(conversation.sessionId, "ses_1");
  assert.strictEqual(createCalls.length, 1);

  const result = await runNl2MmdTurn({
    conversation,
    input: {
      message: "请用 @debate-judge 汇总，并检查未知的 @not-found-role 是否存在",
      validationErrors: ["missing entry.role"],
      validationWarnings: ["using inferred model binding"]
    }
  });

  assert.strictEqual(createCalls.length, 1);
  assert.strictEqual(promptCalls[0].sessionID, "ses_1");
  assert.strictEqual(promptCalls[1].sessionID, "ses_1");
  assert.match(
    promptCalls[1].parts[0].text,
    /Mentions: @debate-judge:resolved, @not-found-role:missing/
  );
  assert.match(promptCalls[1].parts[0].text, /Errors: missing entry\.role/);
  assert.match(promptCalls[1].parts[0].text, /Warnings: using inferred model binding/);
  assert.strictEqual(result.mode, "ask");
  assert.strictEqual(result.validation, undefined);
  assert.strictEqual(result.txtGraph, undefined);
  assert.strictEqual(result.sessionId, "ses_1");
  assert.strictEqual(result.messageId, "msg_turn");
});

test("nl2mmd service validates draft mermaid output and preserves an existing session", async () => {
  const { context, modelRef, timeoutMs, maxOutputBytes, validMermaid, lawsPath } =
    await loadFixtures();
  const { runClient, createCalls, promptCalls } = makeRunClient([
    structuredResponse(
      {
        mode: "draft",
        summary: "Drafted a parallel debate graph with a judge join.",
        questions: [],
        assumptions: ["Existing debate roles and law remain valid."],
        referencedRoles: [
          "debate-moderator",
          "debate-minimalist",
          "debate-alignmentist",
          "debate-judge",
          "debate-summary"
        ],
        unresolvedItems: [],
        mermaid: validMermaid
      },
      "msg_draft"
    )
  ]);

  const conversation = {
    context,
    modelRef,
    timeoutMs,
    maxOutputBytes,
    workdir: repoRoot,
    sessionId: "ses_existing",
    close() {},
    runClient
  };

  const result = await runNl2MmdTurn({
    conversation,
    lawsPath,
    input: {
      message: "请并行组织一场架构辩论，最后由 judge 汇总",
      draftMermaid: "flowchart TD\ninput --> draft[Role:debate-judge]",
      validationErrors: [],
      validationWarnings: []
    }
  });

  assert.strictEqual(createCalls.length, 0);
  assert.strictEqual(promptCalls[0].sessionID, "ses_existing");
  assert.match(promptCalls[0].parts[0].text, /Draft: flowchart TD/);
  assert.match(promptCalls[0].parts[0].text, /Errors: \(none\)/);
  assert.match(promptCalls[0].parts[0].text, /Warnings: \(none\)/);
  assert.strictEqual(result.mode, "draft");
  assert.strictEqual(result.sessionId, "ses_existing");
  assert.strictEqual(result.messageId, "msg_draft");
  assert.strictEqual(result.validation?.status, "ok");
  assert.ok(result.txtGraph?.includes("CONNECTIONS"));
});

test("nl2mmd service rejects invalid response fields from the model", async () => {
  const { context, modelRef, timeoutMs, maxOutputBytes } = await loadFixtures();
  const { runClient } = makeRunClient([
    structuredResponse({
      mode: "draft",
      summary: "bad payload",
      questions: "not-an-array",
      assumptions: [],
      referencedRoles: [],
      unresolvedItems: [],
      mermaid: "flowchart TD\ninput --> output"
    })
  ]);

  const conversation = {
    context,
    modelRef,
    timeoutMs,
    maxOutputBytes,
    workdir: repoRoot,
    sessionId: "ses_existing",
    close() {},
    runClient
  };

  await assert.rejects(
    runNl2MmdTurn({
      conversation,
      input: {
        message: "draft a graph"
      }
    }),
    /Invalid NL2MMD response field "questions"/
  );
});

test("nl2mmd service rejects ask responses that include mermaid content", async () => {
  const { context, modelRef, timeoutMs, maxOutputBytes } = await loadFixtures();
  const { runClient } = makeRunClient([
    structuredResponse({
      mode: "ask",
      summary: "Need clarification",
      questions: ["Which reviewers should participate?"],
      assumptions: [],
      referencedRoles: [],
      unresolvedItems: ["reviewer selection"],
      mermaid: "flowchart TD\ninput --> output"
    })
  ]);

  const conversation = {
    context,
    modelRef,
    timeoutMs,
    maxOutputBytes,
    workdir: repoRoot,
    sessionId: "ses_existing",
    close() {},
    runClient
  };

  await assert.rejects(
    runNl2MmdTurn({
      conversation,
      input: {
        message: "ask for clarification"
      }
    }),
    /must not include Mermaid content/
  );
});

test("nl2mmd service rejects final responses without mermaid content", async () => {
  const { context, modelRef, timeoutMs, maxOutputBytes } = await loadFixtures();
  const { runClient } = makeRunClient([
    structuredResponse({
      mode: "final",
      summary: "Graph is ready",
      questions: [],
      assumptions: [],
      referencedRoles: ["debate-judge"],
      unresolvedItems: [],
      mermaid: ""
    })
  ]);

  const conversation = {
    context,
    modelRef,
    timeoutMs,
    maxOutputBytes,
    workdir: repoRoot,
    sessionId: "ses_existing",
    close() {},
    runClient
  };

  await assert.rejects(
    runNl2MmdTurn({
      conversation,
      input: {
        message: "finalize the graph"
      }
    }),
    /must include Mermaid content/
  );
});

test("nl2mmd debug logger emits sanitized payload when enabled", (t) => {
  const previous = process.env.OGSYSTEM_NL2MMD_DEBUG;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.OGSYSTEM_NL2MMD_DEBUG;
      return;
    }
    process.env.OGSYSTEM_NL2MMD_DEBUG = previous;
  });
  process.env.OGSYSTEM_NL2MMD_DEBUG = "true";

  const calls = [];
  t.mock.method(console, "error", (line) => {
    calls.push(line);
  });

  logNl2MmdDebug("turn.complete", {
    count: 2,
    nested: {
      mode: "draft"
    },
    list: ["a", "b"],
    none: null,
    skip: undefined
  });

  assert.strictEqual(calls.length, 1);
  assert.match(calls[0], /^\[nl2mmd\] turn\.complete /);
  assert.match(calls[0], /"nested":"\[object\]"/);
  assert.match(calls[0], /"list":\["a","b"\]/);
  assert.match(calls[0], /"none":null/);
  assert.doesNotMatch(calls[0], /skip/);
});

test("nl2mmd debug logger stays quiet when disabled", (t) => {
  const previous = process.env.OGSYSTEM_NL2MMD_DEBUG;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.OGSYSTEM_NL2MMD_DEBUG;
      return;
    }
    process.env.OGSYSTEM_NL2MMD_DEBUG = previous;
  });
  delete process.env.OGSYSTEM_NL2MMD_DEBUG;

  const calls = [];
  t.mock.method(console, "error", (line) => {
    calls.push(line);
  });

  logNl2MmdDebug("turn.complete", {
    count: 1
  });

  assert.deepStrictEqual(calls, []);
});
