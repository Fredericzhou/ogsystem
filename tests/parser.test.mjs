import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  loadSystemFromMermaid,
  parseSystemFromMermaidSource
} from "../dist/runtime/parse-mermaid.js";
import { validateNl2MmdCandidate } from "../dist/nl2mmd/index.js";

const validSource = `flowchart TD
%% system.id=test.parser
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=intake
%% exec.bind.intake=profile.parser
input -->|ENTER| intake[Role:intake]
intake[Role:intake] -->|COMPLETE| output
`;

const invalidSource = `flowchart TD
%% system.id=test.parser
%% system.version=0.1.0
input -->|ENTER| intake[Role:intake]
`;

const graphSource = `flowchart TD
%% system.id=test.langgraph
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% handoff.mode=strict
%% handoff.contracts=contracts/handoff.json
%% role.mode.dispatch=parallel_split
%% route.order.dispatch=worker_b,worker_a
%% join.mode.review=all_of
%% join.sources.review=worker_a,worker_b
%% loop.max.dispatch=2
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.deep
%% model.bind.review=model.deep
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
review[Role:review] -->|RETRY| dispatch[Role:dispatch]
review[Role:review] -->|FINISH| output
`;

const routeOrderIgnoresErrorEdgesSource = `flowchart TD
%% system.id=test.route.order.error
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% route.order.dispatch=worker_b,worker_a
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.fast
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
dispatch[Role:dispatch] -->|ERROR.INVALID| output
worker_a[Role:worker_a] -->|DONE_A| output
worker_b[Role:worker_b] -->|DONE_B| output
`;

const cycleWithoutLoopBudgetSource = `flowchart TD
%% system.id=test.cycle.no-budget
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=a
%% exec.bind.a=profile.a
%% exec.bind.b=profile.b
input -->|START| a[Role:a]
a[Role:a] -->|NEXT| b[Role:b]
b[Role:b] -->|RETRY| a[Role:a]
b[Role:b] -->|DONE| output
`;

const cycleWithLoopBudgetSource = `flowchart TD
%% system.id=test.cycle.with-budget
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=a
%% loop.max.a=2
%% exec.bind.a=profile.a
%% exec.bind.b=profile.b
input -->|START| a[Role:a]
a[Role:a] -->|NEXT| b[Role:b]
b[Role:b] -->|RETRY| a[Role:a]
b[Role:b] -->|DONE| output
`;

const joinSourcesWithoutJoinModeSource = `flowchart TD
%% system.id=test.join.sources.without-mode
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.worker_b=profile.worker
%% exec.bind.review=profile.review
%% join.sources.review=worker_a,worker_b
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
review[Role:review] -->|DONE| output
`;

const joinSourcesMismatchSource = `flowchart TD
%% system.id=test.join.sources.mismatch
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=all_of
%% join.sources.review=worker_a,worker_b
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.fast
%% model.bind.worker_c=model.fast
%% model.bind.review=model.fast
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
dispatch[Role:dispatch] -->|C| worker_c[Role:worker_c]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
worker_c[Role:worker_c] -->|DONE_C| review[Role:review]
review[Role:review] -->|DONE| output
`;

const quorumJoinWithProjectionSource = `flowchart TD
%% system.id=test.quorum.projection
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=3
%% context.map.review.summary=source(worker_a).content
%% context.map.review.risks=source(worker_b).data.risks
%% context.map.review.task=global.task
%% context.map.worker_a.brief=direct.data.brief
%% context.map.worker_a.profile=global.user_profile.language
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.fast
%% model.bind.worker_c=model.fast
%% model.bind.review=model.fast
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
dispatch[Role:dispatch] -->|C| worker_c[Role:worker_c]
worker_a[Role:worker_a] -->|DONE_A| review[Role:review]
worker_b[Role:worker_b] -->|DONE_B| review[Role:review]
worker_c[Role:worker_c] -->|DONE_C| review[Role:review]
review[Role:review] -->|DONE| output
`;

test("parser accepts a minimal system", () => {
  const system = parseSystemFromMermaidSource(validSource);
  assert.strictEqual(system.entryRoleId, "intake");
  assert.ok(system.flows.length >= 1);
  assert.strictEqual(system.lawBinding.globalLawRef, "law.test");
  assert.strictEqual(system.executionBinding.intake, "profile.parser");
  assert.strictEqual(system.modelBinding.intake, undefined);
  assert.deepStrictEqual(system.graph?.routingModeByRoleId ?? {}, {});
});

test("parser rejects missing metadata", () => {
  assert.throws(() => parseSystemFromMermaidSource(invalidSource), /Missing required metadata/);
});

test("parser accepts graph metadata and compiles semantic hints without engine flag", () => {
  const system = parseSystemFromMermaidSource(graphSource);
  assert.strictEqual(system.graph?.handoffMode, "strict");
  assert.strictEqual(system.graph?.handoffContracts, "contracts/handoff.json");
  assert.strictEqual(system.graph?.routingModeByRoleId.dispatch, "parallel_split");
  assert.deepStrictEqual(system.graph?.routeOrderByRoleId?.dispatch, ["worker_b", "worker_a"]);
  assert.strictEqual(system.graph?.joinModeByRoleId.review, "all_of");
  assert.deepStrictEqual(system.graph?.joinSourcesByRoleId.review, ["worker_a", "worker_b"]);
  assert.strictEqual(system.graph?.loopMaxByRoleId.dispatch, 2);
  assert.deepStrictEqual(system.graph?.joinMinByRoleId ?? {}, {});
  assert.deepStrictEqual(system.graph?.contextMapByRoleId ?? {}, {});
});

test("parser accepts review metadata with defaults and explicit overrides", () => {
  const source = `flowchart TD
%% system.id=test.review.metadata
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% exec.bind.reviewer=profile.reviewer
%% review.mode.reviewer=required
%% review.timeout.reviewer=3600
%% review.rework.target.reviewer=writer
%% review.rework.max.reviewer=2
input -->|START| writer[Role:writer]
writer[Role:writer] -->|DONE| reviewer[Role:reviewer]
reviewer[Role:reviewer] -->|APPROVED| output
`;

  const system = parseSystemFromMermaidSource(source);
  assert.deepStrictEqual(system.graph?.reviewByRoleId?.reviewer, {
    mode: "required",
    timeoutSeconds: 3600,
    timeoutAction: "pause",
    reworkTargetRoleId: "writer",
    reworkMax: 2,
    terminateScope: "branch"
  });
});

test("parser accepts optional human review selectors in context.map", () => {
  const source = `flowchart TD
%% system.id=test.review.selector.optional
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% context.map.writer.review_comment=global.human_review.current.comment?
%% context.map.writer.previous_content=global.human_review.current.previous_output.content?
input -->|START| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`;

  const system = parseSystemFromMermaidSource(source);
  assert.deepStrictEqual(system.graph?.contextMapByRoleId?.writer, {
    review_comment: "global.human_review.current.comment?",
    previous_content: "global.human_review.current.previous_output.content?"
  });
});

test("parser rejects review metadata without review.mode", () => {
  const source = `flowchart TD
%% system.id=test.review.missing.mode
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
%% exec.bind.reviewer=profile.reviewer
%% review.timeout.reviewer=120
input -->|START| writer[Role:writer]
writer[Role:writer] -->|DONE| reviewer[Role:reviewer]
reviewer[Role:reviewer] -->|APPROVED| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_MISSING_REVIEW_MODE|requires review\.mode\.reviewer=required/
  );
});

test("parser rejects handoff.contracts without handoff.mode", () => {
  const source = `flowchart TD
%% system.id=test.handoff.missing.mode
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=intake
%% handoff.contracts=contracts/handoff.json
%% exec.bind.intake=profile.parser
input -->|ENTER| intake[Role:intake]
intake[Role:intake] -->|COMPLETE| output
`;
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_MISSING_HANDOFF_MODE|handoff\.contracts requires handoff\.mode/
  );
});

test("parser ignores runtime error edges when validating route order coverage", () => {
  const system = parseSystemFromMermaidSource(routeOrderIgnoresErrorEdgesSource);
  assert.deepStrictEqual(system.graph?.routeOrderByRoleId?.dispatch, ["worker_b", "worker_a"]);
  assert.strictEqual(system.modelBinding.dispatch, "model.fast");
});

test("loadSystemFromMermaid resolves handoff contract paths relative to the system file", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "ogsystem-system-"));
  const contractsDir = path.join(tempDir, "contracts");
  await mkdir(contractsDir, { recursive: true });
  await writeFile(
    path.join(contractsDir, "handoff.json"),
    JSON.stringify({ version: 1, contracts: [] }),
    "utf8"
  );
  const systemPath = path.join(tempDir, "system.mmd");
  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.resolve.contracts
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=intake
%% handoff.mode=strict
%% handoff.contracts=contracts/handoff.json
%% exec.bind.intake=profile.parser
input -->|ENTER| intake[Role:intake]
intake[Role:intake] -->|DONE| output
`,
    "utf8"
  );

  const system = await loadSystemFromMermaid(systemPath);
  assert.strictEqual(
    system.graph?.handoffContracts,
    path.resolve(contractsDir, "handoff.json")
  );
});

test("parser accepts quorum_of join.min and context.map metadata", () => {
  const system = parseSystemFromMermaidSource(quorumJoinWithProjectionSource);
  assert.strictEqual(system.graph?.joinModeByRoleId.review, "quorum_of");
  assert.deepStrictEqual(system.graph?.joinSourcesByRoleId.review, [
    "worker_a",
    "worker_b",
    "worker_c"
  ]);
  assert.strictEqual(system.graph?.joinMinByRoleId.review, 3);
  assert.deepStrictEqual(system.graph?.contextMapByRoleId.review, {
    summary: "source(worker_a).content",
    risks: "source(worker_b).data.risks",
    task: "global.task"
  });
  assert.deepStrictEqual(system.graph?.contextMapByRoleId.worker_a, {
    brief: "direct.data.brief",
    profile: "global.user_profile.language"
  });
});

test("parser rejects cyclic topology without explicit loop budget", () => {
  assert.throws(
    () => parseSystemFromMermaidSource(cycleWithoutLoopBudgetSource),
    /MERMAID_CYCLE_REQUIRES_LOOP_MAX|Add loop\.max/
  );
});

test("parser accepts cyclic topology when at least one role in the cycle has loop budget", () => {
  const system = parseSystemFromMermaidSource(cycleWithLoopBudgetSource);
  assert.strictEqual(system.graph?.loopMaxByRoleId.a, 2);
});

test("parser rejects join.sources without an explicit join.mode", () => {
  assert.throws(
    () => parseSystemFromMermaidSource(joinSourcesWithoutJoinModeSource),
    /MERMAID_JOIN_SOURCES_REQUIRE_JOIN_MODE|requires join\.mode/
  );
});

for (const joinSourcesMismatchCase of [
  {
    name: "parser rejects all_of join when join.sources does not match incoming role edges",
    source: joinSourcesMismatchSource
  },
  {
    name: "parser rejects quorum_of join when join.sources does not match incoming role edges",
    source: quorumJoinWithProjectionSource.replace(
      /%% join\.sources\.review=.*/,
      "%% join.sources.review=worker_a,worker_b"
    )
  }
]) {
  test(joinSourcesMismatchCase.name, () => {
    assert.throws(
      () => parseSystemFromMermaidSource(joinSourcesMismatchCase.source),
      /MERMAID_JOIN_SOURCES_MISMATCH|join\.sources\.review must match exactly/
    );
  });
}

test("parser rejects quorum_of join without join.min", () => {
  const source = quorumJoinWithProjectionSource.replace("%% join.min.review=3\n", "");
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_MISSING_JOIN_MIN|join\.min\.review is required/
  );
});

test("parser rejects quorum_of join.min outside source range", () => {
  const source = quorumJoinWithProjectionSource.replace("%% join.min.review=3", "%% join.min.review=4");
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_INVALID_JOIN_MIN_RANGE|must be within \[1, 3\]/
  );
});

test("parser rejects source selectors for quorum_of when join.min is below join.sources size", () => {
  const source = quorumJoinWithProjectionSource.replace("%% join.min.review=3", "%% join.min.review=2");
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_JOIN_SELECTOR_SOURCE_NOT_ALLOWED|join\.mode\.review=quorum_of/
  );
});

for (const duplicateJoinSourceCase of [
  {
    name: "parser rejects duplicate join.sources entries for all_of",
    source: graphSource.replace(
      /%% join\.sources\.review=.*/,
      "%% join.sources.review=worker_a,worker_a,worker_b"
    )
  },
  {
    name: "parser rejects duplicate join.sources entries for quorum_of before join.min validation",
    source: quorumJoinWithProjectionSource.replace(
      /%% join\.sources\.review=.*/,
      "%% join.sources.review=worker_a,worker_a,worker_b,worker_c"
    )
  }
]) {
  test(duplicateJoinSourceCase.name, () => {
    assert.throws(
      () => parseSystemFromMermaidSource(duplicateJoinSourceCase.source),
      /MERMAID_DUPLICATE_JOIN_SOURCE|duplicate source role/
    );
  });
}

test("parser rejects join-only selector on non-join role", () => {
  const source = quorumJoinWithProjectionSource.replace(
    "%% context.map.worker_a.brief=direct.data.brief",
    "%% context.map.worker_a.brief=source(worker_b).content"
  );
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_JOIN_SELECTOR_REQUIRES_JOIN_MODE|join-only selector/
  );
});

test("parser rejects source selector that is outside join.sources", () => {
  const source = quorumJoinWithProjectionSource.replace(
    "%% context.map.review.summary=source(worker_a).content",
    "%% context.map.review.summary=source(dispatch).content"
  );
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_JOIN_SELECTOR_SOURCE_NOT_ALLOWED|not declared in join\.sources\.review/
  );
});

test("parser rejects source selector referencing undefined role", () => {
  const source = quorumJoinWithProjectionSource.replace(
    "%% context.map.review.summary=source(worker_a).content",
    "%% context.map.review.summary=source(worker_x).content"
  );
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_UNDEFINED_ROLE_REF|references undefined role "worker_x"/
  );
});

test("parser rejects invalid selector grammar", () => {
  const source = quorumJoinWithProjectionSource.replace(
    "%% context.map.worker_a.brief=direct.data.brief",
    "%% context.map.worker_a.brief=direct.data[0]"
  );
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_INVALID_SELECTOR|unsupported selector/
  );
});

test("parser rejects context.map referencing undefined role", () => {
  const source = quorumJoinWithProjectionSource.replace(
    "%% context.map.worker_a.profile=global.user_profile.language",
    "%% context.map.ghost.profile=global.user_profile.language"
  );
  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_UNDEFINED_ROLE_REF|context\.map\.ghost references undefined role/
  );
});

test("parser rejects duplicate metadata keys instead of silently overriding", () => {
  const duplicateLawSource = `flowchart TD
%% system.id=test.duplicate.metadata
%% system.version=0.1.0
%% law.global=law.first
%% law.global=law.second
%% entry.role=intake
%% model.bind.intake=model.fast
input -->|GO| intake[Role:intake]
intake[Role:intake] -->|DONE| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(duplicateLawSource),
    /MERMAID_DUPLICATE_METADATA_KEY|Duplicate metadata key "law\.global"/
  );
});

test("parser rejects role binding conflicts when model.bind and exec.bind coexist", () => {
  const bindingConflictSource = `flowchart TD
%% system.id=test.binding.conflict
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=intake
%% exec.bind.intake=profile.parser
%% model.bind.intake=model.fast
input -->|GO| intake[Role:intake]
intake[Role:intake] -->|DONE| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(bindingConflictSource),
    /defines both model\.bind\.intake=model\.fast and exec\.bind\.intake=profile\.parser/
  );
});

test("parser accepts route order when multiple edges share the same target", () => {
  const source = `flowchart TD
%% system.id=test.route.order.duplicate.target
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=dispatch
%% route.order.dispatch=worker_b,worker_a
%% model.bind.dispatch=model.fast
%% model.bind.worker_a=model.fast
%% model.bind.worker_b=model.fast
input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|A| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|A2| worker_a[Role:worker_a]
dispatch[Role:dispatch] -->|B| worker_b[Role:worker_b]
worker_a[Role:worker_a] -->|DONE_A| output
worker_b[Role:worker_b] -->|DONE_B| output
`;

  const system = parseSystemFromMermaidSource(source);
  assert.deepStrictEqual(system.graph?.routeOrderByRoleId?.dispatch, ["worker_b", "worker_a"]);
});

test("parser rejects ERROR* edges declared from input boundary", () => {
  const source = `flowchart TD
%% system.id=test.error.input
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=intake
%% exec.bind.intake=profile.intake
input -->|ERROR| intake[Role:intake]
intake[Role:intake] -->|DONE| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_INPUT_ERROR_EDGE_NOT_ALLOWED|input boundary cannot declare ERROR/
  );
});

test("parser rejects duplicate ERROR fallback edges from the same role", () => {
  const source = `flowchart TD
%% system.id=test.error.fallback.duplicate
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.comp_a=profile.worker
%% exec.bind.comp_b=profile.worker
input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR| comp_a[Role:comp_a]
worker[Role:worker] -->|ERROR| comp_b[Role:comp_b]
worker[Role:worker] -->|DONE| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_DUPLICATE_ERROR_FALLBACK_EDGE|duplicate ERROR fallback edges/
  );
});

test("parser rejects duplicate ERROR.<code> edges from the same role", () => {
  const source = `flowchart TD
%% system.id=test.error.code.duplicate
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.retry_a=profile.worker
%% exec.bind.retry_b=profile.worker
input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| retry_a[Role:retry_a]
worker[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| retry_b[Role:retry_b]
worker[Role:worker] -->|DONE| output
`;

  assert.throws(
    () => parseSystemFromMermaidSource(source),
    /MERMAID_DUPLICATE_ERROR_CODE_EDGE|duplicate ERROR\.TOOL_EXECUTION_TIMEOUT edges/
  );
});

for (const invalidErrorEdgeEventCase of [
  {
    name: "parser rejects invalid reserved ERROR* event forms",
    source: `flowchart TD
%% system.id=test.error.invalid.prefix
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=worker
%% exec.bind.worker=profile.worker
input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR_SPAWN| output
`,
    expectedMessage: /MERMAID_INVALID_ERROR_EDGE_EVENT|reserved ERROR\* events must be exactly/
  },
  {
    name: "parser rejects ERROR.<code> with empty code",
    source: `flowchart TD
%% system.id=test.error.invalid.empty
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=worker
%% exec.bind.worker=profile.worker
input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR.| output
`,
    expectedMessage: /MERMAID_INVALID_ERROR_EDGE_EVENT|non-empty <errorCode>/
  }
]) {
  test(invalidErrorEdgeEventCase.name, () => {
    assert.throws(
      () => parseSystemFromMermaidSource(invalidErrorEdgeEventCase.source),
      invalidErrorEdgeEventCase.expectedMessage
    );
  });
}

test("nl2mmd validator ignores ERROR* edges when checking role output event enum", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "ogsystem-nl2mmd-error-flow-"));
  const roleRootDir = path.join(tempRoot, "roles");
  const modelRootDir = path.join(tempRoot, "models");
  await mkdir(roleRootDir, { recursive: true });
  await mkdir(modelRootDir, { recursive: true });

  const writeRolePackage = async (roleId, eventEnum) => {
    const roleDir = path.join(roleRootDir, roleId);
    await mkdir(roleDir, { recursive: true });
    await writeFile(
      path.join(roleDir, "role.json"),
      JSON.stringify(
        {
          roleId,
          roleVersion: "0.1.0",
          name: roleId,
          description: `${roleId} test role`,
          promptTemplate: "prompt.md",
          outputSchema: "output.schema.json"
        },
        null,
        2
      )
    );
    await writeFile(path.join(roleDir, "prompt.md"), "{{agent}}\n\ntest prompt");
    await writeFile(path.join(roleDir, "agent.md"), `# ${roleId}\n\ntest agent\n`);
    await writeFile(
      path.join(roleDir, "output.schema.json"),
      JSON.stringify(
        {
          type: "object",
          properties: {
            event: {
              type: "string",
              enum: eventEnum
            },
            content: {
              type: "string"
            },
            data: {
              type: "object"
            }
          },
          required: ["event", "content", "data"],
          additionalProperties: true
        },
        null,
        2
      )
    );
  };

  await writeRolePackage("worker", ["DONE"]);
  await writeRolePackage("compensate", ["RECOVERED"]);

  const mermaid = `flowchart TD
%% system.id=test.nl2mmd.error.edge
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.compensate=profile.compensate
input -->|START| worker[Role:worker]
worker[Role:worker] -->|DONE| output
worker[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| compensate[Role:compensate]
compensate[Role:compensate] -->|RECOVERED| output
`;

  const validation = await validateNl2MmdCandidate({
    mermaid,
    context: {
      workdir: tempRoot,
      roleRootDir,
      modelRootDir,
      roleCatalog: [],
      modelCatalog: [],
      lawIds: [],
      supportedDictionary: {
        flowcharts: [],
        boundaryTokens: [],
        exactMetadataKeys: [],
        metadataPrefixes: [],
        roleModes: [],
        joinModes: [],
        mentionPrefix: "@",
        nodeTokenPattern: "",
        edgePattern: ""
      }
    }
  });

  assert.equal(validation.status, "ok");
  assert.deepStrictEqual(validation.errors, []);
});
