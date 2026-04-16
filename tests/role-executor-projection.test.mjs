import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import { getExecutionPlanNode, createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { compileExecutionSnapshot } from "../dist/runtime/compiler.js";
import { createInitialState } from "../dist/runtime/graph-runtime-state.js";
import { loadModelPackage } from "../dist/runtime/model-repo.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";
import { initializeRunContext } from "../dist/runtime/run-artifacts.js";
import { loadFlowContractPlan } from "../dist/runtime/flow-contract.js";
import { executeRoleNode } from "../dist/runtime/role-executor.js";
import { validateRuntimeConfig } from "../dist/runtime/config.js";

function parseJsonCodeBlock(markdown) {
  const match = markdown.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(match, "expected markdown to contain one json code block");
  return JSON.parse(match[1]);
}

async function writeRolePackage(args) {
  const roleDir = path.resolve(args.rolesRoot, args.roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: args.roleId,
        roleVersion: "1.0.0",
        name: args.roleId,
        description: `${args.roleId} test role`,
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "prompt.md"),
    ["Task:", "{{task}}", "", "Context:", "{{context}}", "", "Allowed events: {{allowed_events}}"].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: args.allowedEvents
          },
          content: {
            type: "string"
          },
          data: {
            type: "object",
            additionalProperties: true
          }
        },
        required: args.requireEvent === false ? [] : ["event"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );
}

async function prepareRoleExecutorFixture(args) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), args.tempPrefix));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");

  await mkdir(rolesRoot, { recursive: true });
  await mkdir(path.resolve(rolesRoot, "_shared"), { recursive: true });
  await writeFile(systemPath, args.systemSource, "utf8");

  for (const role of args.roles) {
    await writeRolePackage({
      rolesRoot,
      roleId: role.roleId,
      allowedEvents: role.allowedEvents,
      requireEvent: role.requireEvent
    });
  }

  const system = parseSystemFromMermaidSource(args.systemSource);
  const plan = createExecutionPlan(system);
  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: "./og-roles",
      modelRepo: path.resolve("og-models"),
      runsDir: ".ogs/runs"
    },
    "runtime.json"
  );
  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: args.prompt,
    workdir: tempRoot,
    runtimeConfig
  });

  const rolePackagesByRoleId = new Map();
  for (const role of args.roles) {
    rolePackagesByRoleId.set(
      role.roleId,
      await loadRolePackage({
        roleId: role.roleId,
        roleRootDir: rolesRoot
      })
    );
  }

  const modelPackage = await loadModelPackage({
    modelId: "balanced-gpt52",
    modelRootDir: path.resolve("og-models")
  });
  const compilerSnapshot = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    }
  }).snapshot;

  return {
    tempRoot,
    system,
    plan,
    runContext,
    rolePackagesByRoleId,
    compilerSnapshot,
    modelsById: new Map([["balanced-gpt52", modelPackage]])
  };
}

test("executeRoleNode projects deterministic context.map for ordinary nodes", async () => {
  const fixture = await prepareRoleExecutorFixture({
    tempPrefix: "ogsystem-role-projection-ordinary-",
    prompt: "projection prompt",
    systemSource: `flowchart TD
%% system.id=role.projection.ordinary
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=intake
%% context.map.reviewer.brief=direct.data.brief
%% context.map.reviewer.language=global.user_profile.language
%% context.map.reviewer.task=global.task
%% model.bind.intake=balanced-gpt52
%% model.bind.reviewer=balanced-gpt52

input -->|GO| intake[Role:intake]
intake[Role:intake] -->|DONE| reviewer[Role:reviewer]
reviewer[Role:reviewer] -->|DONE| output
`,
    roles: [
      { roleId: "intake", allowedEvents: ["DONE"] },
      { roleId: "reviewer", allowedEvents: ["DONE"] }
    ]
  });

  const state = createInitialState(fixture.plan, "projection prompt");
  state.roleResults["intake@1#1"] = {
    roleId: "intake",
    event: "DONE",
    content: "intake complete",
    data: {
      brief: "short brief"
    },
    branchId: "intake@1#1",
    lineageId: "intake@1#1",
    loopIteration: 1
  };
  const reviewerBranch = {
    branchId: "reviewer@1#2",
    roleId: "reviewer",
    loopIteration: 1,
    branchSequence: 2,
    lineageId: "intake@1#1",
    sessionLineageId: "reviewer@1#2",
    parentBranchId: "intake@1#1",
    activatedByRoleId: "intake",
    activatedByEvent: "DONE",
    status: "active"
  };
  state.branchRecords[reviewerBranch.branchId] = reviewerBranch;

  const result = await executeRoleNode({
    roleId: "reviewer",
    node: getExecutionPlanNode(fixture.plan, "reviewer"),
    plan: fixture.plan,
    state,
    branch: reviewerBranch,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: fixture.modelsById,
    rolePackagesByRoleId: fixture.rolePackagesByRoleId,
    compilerSnapshot: fixture.compilerSnapshot,
    runContext: fixture.runContext,
    executor: {
      async start() {},
      async close() {},
      async abortSession() {},
      getServerMetadata() {
        return {};
      },
      async execute() {
        return {
          exitCode: 0,
          stdout: JSON.stringify({ event: "DONE", content: "ok" }),
          stderr: "",
          args: [],
          sessionId: "ses_projection",
          messageId: "msg_projection"
        };
      }
    },
    userProfile: {
      userProfileId: "user.profile",
      language: "zh-CN"
    },
    workdir: fixture.tempRoot
  });

  assert.equal(result.status, "ok");
  assert.equal(result.audit.compilerDigest, fixture.compilerSnapshot.digest);
  const inbox = parseJsonCodeBlock(
    await readFile(
      path.resolve(fixture.runContext.runDir, "roles", "reviewer", "inbox.md"),
      "utf8"
    )
  );
  const context = JSON.parse(inbox.context);
  assert.deepStrictEqual(Object.keys(context), ["brief", "language", "task"]);
  assert.deepStrictEqual(context, {
    brief: "short brief",
    language: "zh-CN",
    task: "projection prompt"
  });
  assert.strictEqual(inbox.last_output, inbox.context);
});

test("executeRoleNode fails closed when join projection source is unavailable", async () => {
  const fixture = await prepareRoleExecutorFixture({
    tempPrefix: "ogsystem-role-projection-join-fail-",
    prompt: "quorum prompt",
    systemSource: `flowchart TD
%% system.id=role.projection.join.fail
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=3
%% context.map.review.missing=source(worker_c).content
%% model.bind.dispatch=balanced-gpt52
%% model.bind.worker_a=balanced-gpt52
%% model.bind.worker_b=balanced-gpt52
%% model.bind.worker_c=balanced-gpt52
%% model.bind.review=balanced-gpt52

input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
dispatch[Role:dispatch] -->|TO_C| workerC[Role:worker_c]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
workerC[Role:worker_c] -->|C_DONE| review[Role:review]
review[Role:review] -->|DONE| output
`,
    roles: [
      { roleId: "dispatch", allowedEvents: ["TO_A", "TO_B", "TO_C"], requireEvent: false },
      { roleId: "worker_a", allowedEvents: ["A_DONE"] },
      { roleId: "worker_b", allowedEvents: ["B_DONE"] },
      { roleId: "worker_c", allowedEvents: ["C_DONE"] },
      { roleId: "review", allowedEvents: ["DONE"] }
    ]
  });

  const state = createInitialState(fixture.plan, "quorum prompt");
  state.roleResults["worker_a@1#2"] = {
    roleId: "worker_a",
    event: "A_DONE",
    content: "alpha",
    branchId: "worker_a@1#2",
    lineageId: "dispatch@1#1",
    loopIteration: 1
  };
  state.roleResults["worker_b@1#3"] = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "beta",
    branchId: "worker_b@1#3",
    lineageId: "dispatch@1#1",
    loopIteration: 1
  };
  const reviewBranch = {
    branchId: "review@1#5",
    roleId: "review",
    loopIteration: 1,
    branchSequence: 5,
    lineageId: "dispatch@1#1",
    sessionLineageId: "review@1#5",
    parentBranchId: "worker_b@1#3",
    activatedByRoleId: "worker_b",
    activatedByEvent: "B_DONE",
    status: "active"
  };
  state.branchRecords[reviewBranch.branchId] = reviewBranch;

  let executeCount = 0;
  const result = await executeRoleNode({
    roleId: "review",
    node: getExecutionPlanNode(fixture.plan, "review"),
    plan: fixture.plan,
    state,
    branch: reviewBranch,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: fixture.modelsById,
    rolePackagesByRoleId: fixture.rolePackagesByRoleId,
    compilerSnapshot: fixture.compilerSnapshot,
    runContext: fixture.runContext,
    executor: {
      async start() {},
      async close() {},
      async abortSession() {},
      getServerMetadata() {
        return {};
      },
      async execute() {
        executeCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ event: "DONE", content: "ok" }),
          stderr: "",
          args: [],
          sessionId: "ses_projection_fail",
          messageId: "msg_projection_fail"
        };
      }
    },
    workdir: fixture.tempRoot
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failure.errorCode, "ROLE_CONTEXT_SOURCE_UNAVAILABLE");
  assert.equal(result.audit.compilerDigest, fixture.compilerSnapshot.digest);
  assert.equal(result.audit.compilerDiagnosticCode, "COMPILER_CONTEXT_SOURCE_UNDEFINED");
  assert.equal(executeCount, 0);
});

test("executeRoleNode fails closed with ROLE_CONTEXT_PATH_MISSING for null direct.data path segments", async () => {
  const fixture = await prepareRoleExecutorFixture({
    tempPrefix: "ogsystem-role-projection-direct-path-missing-",
    prompt: "path missing prompt",
    systemSource: `flowchart TD
%% system.id=role.projection.direct.path.missing
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=intake
%% context.map.reviewer.missing=direct.data.detail.summary
%% model.bind.intake=balanced-gpt52
%% model.bind.reviewer=balanced-gpt52

input -->|GO| intake[Role:intake]
intake[Role:intake] -->|DONE| reviewer[Role:reviewer]
reviewer[Role:reviewer] -->|DONE| output
`,
    roles: [
      { roleId: "intake", allowedEvents: ["DONE"] },
      { roleId: "reviewer", allowedEvents: ["DONE"] }
    ]
  });

  const state = createInitialState(fixture.plan, "path missing prompt");
  state.roleResults["intake@1#1"] = {
    roleId: "intake",
    event: "DONE",
    content: "intake complete",
    data: {
      detail: null
    },
    branchId: "intake@1#1",
    lineageId: "intake@1#1",
    loopIteration: 1
  };
  const reviewerBranch = {
    branchId: "reviewer@1#2",
    roleId: "reviewer",
    loopIteration: 1,
    branchSequence: 2,
    lineageId: "intake@1#1",
    sessionLineageId: "reviewer@1#2",
    parentBranchId: "intake@1#1",
    activatedByRoleId: "intake",
    activatedByEvent: "DONE",
    status: "active"
  };
  state.branchRecords[reviewerBranch.branchId] = reviewerBranch;

  let executeCount = 0;
  const result = await executeRoleNode({
    roleId: "reviewer",
    node: getExecutionPlanNode(fixture.plan, "reviewer"),
    plan: fixture.plan,
    state,
    branch: reviewerBranch,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: fixture.modelsById,
    rolePackagesByRoleId: fixture.rolePackagesByRoleId,
    compilerSnapshot: fixture.compilerSnapshot,
    runContext: fixture.runContext,
    executor: {
      async start() {},
      async close() {},
      async abortSession() {},
      getServerMetadata() {
        return {};
      },
      async execute() {
        executeCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ event: "DONE", content: "ok" }),
          stderr: "",
          args: [],
          sessionId: "ses_path_missing_direct",
          messageId: "msg_path_missing_direct"
        };
      }
    },
    workdir: fixture.tempRoot
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failure.errorCode, "ROLE_CONTEXT_PATH_MISSING");
  assert.equal(result.audit.compilerDiagnosticCode, "COMPILER_CONTEXT_SELECTOR_INVALID");
  assert.equal(executeCount, 0);
});

test("executeRoleNode fails closed with ROLE_CONTEXT_PATH_MISSING for null join source path segments", async () => {
  const fixture = await prepareRoleExecutorFixture({
    tempPrefix: "ogsystem-role-projection-join-path-missing-",
    prompt: "join path missing prompt",
    systemSource: `flowchart TD
%% system.id=role.projection.join.path.missing
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b
%% join.min.review=2
%% context.map.review.primary_risk=source(worker_b).data.risks.primary
%% model.bind.dispatch=balanced-gpt52
%% model.bind.worker_a=balanced-gpt52
%% model.bind.worker_b=balanced-gpt52
%% model.bind.review=balanced-gpt52

input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
review[Role:review] -->|DONE| output
`,
    roles: [
      { roleId: "dispatch", allowedEvents: ["TO_A", "TO_B"], requireEvent: false },
      { roleId: "worker_a", allowedEvents: ["A_DONE"] },
      { roleId: "worker_b", allowedEvents: ["B_DONE"] },
      { roleId: "review", allowedEvents: ["DONE"] }
    ]
  });

  const state = createInitialState(fixture.plan, "join path missing prompt");
  state.roleResults["worker_a@1#2"] = {
    roleId: "worker_a",
    event: "A_DONE",
    content: "alpha",
    data: {
      risks: {
        primary: "ok"
      }
    },
    branchId: "worker_a@1#2",
    lineageId: "dispatch@1#1",
    loopIteration: 1
  };
  state.roleResults["worker_b@1#3"] = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "beta",
    data: {
      risks: null
    },
    branchId: "worker_b@1#3",
    lineageId: "dispatch@1#1",
    loopIteration: 1
  };
  const reviewBranch = {
    branchId: "review@1#4",
    roleId: "review",
    loopIteration: 1,
    branchSequence: 4,
    lineageId: "dispatch@1#1",
    sessionLineageId: "review@1#4",
    parentBranchId: "worker_b@1#3",
    activatedByRoleId: "worker_b",
    activatedByEvent: "B_DONE",
    status: "active"
  };
  state.branchRecords[reviewBranch.branchId] = reviewBranch;

  let executeCount = 0;
  const result = await executeRoleNode({
    roleId: "review",
    node: getExecutionPlanNode(fixture.plan, "review"),
    plan: fixture.plan,
    state,
    branch: reviewBranch,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: fixture.modelsById,
    rolePackagesByRoleId: fixture.rolePackagesByRoleId,
    compilerSnapshot: fixture.compilerSnapshot,
    runContext: fixture.runContext,
    executor: {
      async start() {},
      async close() {},
      async abortSession() {},
      getServerMetadata() {
        return {};
      },
      async execute() {
        executeCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ event: "DONE", content: "ok" }),
          stderr: "",
          args: [],
          sessionId: "ses_path_missing_join",
          messageId: "msg_path_missing_join"
        };
      }
    },
    workdir: fixture.tempRoot
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failure.errorCode, "ROLE_CONTEXT_PATH_MISSING");
  assert.equal(result.audit.compilerDiagnosticCode, "COMPILER_CONTEXT_SELECTOR_INVALID");
  assert.equal(executeCount, 0);
});

test("executeRoleNode validates role_input contracts against projected context objects", async () => {
  const fixture = await prepareRoleExecutorFixture({
    tempPrefix: "ogsystem-role-projection-contract-",
    prompt: "contract prompt",
    systemSource: `flowchart TD
%% system.id=role.projection.contract
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=intake
%% handoff.mode=transition
%% handoff.contracts=contracts/handoff.contracts.json
%% context.map.reviewer.brief=direct.data.brief
%% context.map.reviewer.language=global.user_profile.language
%% context.map.reviewer.task=global.task
%% model.bind.intake=balanced-gpt52
%% model.bind.reviewer=balanced-gpt52

input -->|GO| intake[Role:intake]
intake[Role:intake] -->|DONE| reviewer[Role:reviewer]
reviewer[Role:reviewer] -->|DONE| output
`,
    roles: [
      { roleId: "intake", allowedEvents: ["DONE"] },
      { roleId: "reviewer", allowedEvents: ["DONE"] }
    ]
  });

  const contractsDir = path.resolve(fixture.tempRoot, "contracts");
  await mkdir(contractsDir, { recursive: true });
  await writeFile(
    path.resolve(contractsDir, "reviewer-input.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          summary: {
            type: "string"
          }
        },
        required: ["summary"],
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(contractsDir, "handoff.contracts.json"),
    JSON.stringify(
      {
        version: 1,
        contracts: [
          {
            id: "reviewer.input.v1",
            kind: "role_input",
            match: {
              roleId: "reviewer"
            },
            schema: "reviewer-input.schema.json",
            onViolation: "FAIL"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  const contractPlan = await loadFlowContractPlan({
    system: fixture.system,
    contractPath: path.resolve(contractsDir, "handoff.contracts.json")
  });
  assert.equal(contractPlan.roleInputContractsByRoleId.has("reviewer"), true);
  const contractCompilerSnapshot = compileExecutionSnapshot({
    system: fixture.system,
    rolePackagesByRoleId: fixture.rolePackagesByRoleId,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    contractPlan
  }).snapshot;

  const state = createInitialState(fixture.plan, "contract prompt");
  state.roleResults["intake@1#1"] = {
    roleId: "intake",
    event: "DONE",
    content: "intake complete",
    data: {
      brief: "short brief"
    },
    branchId: "intake@1#1",
    lineageId: "intake@1#1",
    loopIteration: 1
  };
  const reviewerBranch = {
    branchId: "reviewer@1#2",
    roleId: "reviewer",
    loopIteration: 1,
    branchSequence: 2,
    lineageId: "intake@1#1",
    sessionLineageId: "reviewer@1#2",
    parentBranchId: "intake@1#1",
    activatedByRoleId: "intake",
    activatedByEvent: "DONE",
    status: "active"
  };
  state.branchRecords[reviewerBranch.branchId] = reviewerBranch;

  let executeCount = 0;
  const result = await executeRoleNode({
    roleId: "reviewer",
    node: getExecutionPlanNode(fixture.plan, "reviewer"),
    plan: fixture.plan,
    state,
    branch: reviewerBranch,
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map(),
    toolsByRef: new Map(),
    modelsById: fixture.modelsById,
    rolePackagesByRoleId: fixture.rolePackagesByRoleId,
    compilerSnapshot: contractCompilerSnapshot,
    contractPlan,
    runContext: fixture.runContext,
    executor: {
      async start() {},
      async close() {},
      async abortSession() {},
      getServerMetadata() {
        return {};
      },
      async execute() {
        executeCount += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify({ event: "DONE", content: "ok" }),
          stderr: "",
          args: [],
          sessionId: "ses_contract_fail",
          messageId: "msg_contract_fail"
        };
      }
    },
    userProfile: {
      userProfileId: "user.profile",
      language: "zh-CN"
    },
    workdir: fixture.tempRoot
  });

  assert.equal(result.status, "failed");
  assert.equal(result.failure.errorCode, "CONTRACT_ROLE_INPUT_VALIDATION_FAILED");
  assert.equal(result.audit.compilerDiagnosticCode, "COMPILER_ROLE_INPUT_CONTEXT_MISSING");
  assert.equal(executeCount, 0);
});
