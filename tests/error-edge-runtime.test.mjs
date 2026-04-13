import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

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
    [
      `Role: ${args.roleId}`,
      "Task:",
      "{{task}}",
      "",
      "Context:",
      "{{context}}",
      "",
      "Allowed events: {{allowed_events}}",
      "Round: {{round}}"
    ].join("\n"),
    "utf8"
  );

  const properties = {
    content: { type: "string" },
    data: { type: "object", additionalProperties: true }
  };
  if ((args.allowedEvents ?? []).length > 0) {
    properties.event = {
      type: "string",
      enum: args.allowedEvents
    };
  }
  const required = args.requireEvent === false ? [] : ["event"];
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties,
        required,
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );
}

async function writeToolScript(args) {
  const scriptPath = path.resolve(args.tempRoot, "scripts", `${args.roleId}.js`);
  await mkdir(path.dirname(scriptPath), { recursive: true });
  let script = "";
  if (args.mode.kind === "fail") {
    script = `process.stderr.write("intentional ${args.roleId} failure\\n"); process.exit(1);\n`;
  } else if (args.mode.kind === "content") {
    script = `console.log(JSON.stringify({ content: ${JSON.stringify(args.mode.content)} }));\n`;
  } else if (args.mode.kind === "event-data") {
    script = `console.log(JSON.stringify({ event: ${JSON.stringify(args.mode.event)}, content: ${JSON.stringify(args.mode.content ?? args.roleId)}, data: ${JSON.stringify(args.mode.data ?? {})} }));\n`;
  } else {
    script = `console.log(JSON.stringify({ event: ${JSON.stringify(args.mode.event)}, content: ${JSON.stringify(args.mode.content ?? args.roleId)} }));\n`;
  }
  await writeFile(scriptPath, script, "utf8");
  return scriptPath;
}

async function setupFixture(args) {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), `ogsystem-error-edge-${args.id}-`));
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");
  await mkdir(rolesRoot, { recursive: true });

  const profiles = [];
  const tools = [];
  for (const role of args.roles) {
    await writeRolePackage({
      rolesRoot,
      roleId: role.roleId,
      allowedEvents: role.allowedEvents,
      requireEvent: role.requireEvent
    });
    const profileId = `profile.${role.roleId}`;
    const toolRef = `tool.${role.roleId}`;
    const scriptPath = await writeToolScript({
      tempRoot,
      roleId: role.roleId,
      mode: role.mode
    });
    profiles.push({
      profileId,
      toolRef
    });
    tools.push({
      toolRef,
      runner: "local_shell",
      command: "node",
      argsTemplate: [scriptPath],
      stdinMode: "none"
    });
  }

  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, "runtime.json");
  const profilesPath = path.resolve(tempRoot, "profiles.json");
  const toolsPath = path.resolve(tempRoot, "tools.json");
  const lawsPath = path.resolve(tempRoot, "laws.json");

  await writeFile(systemPath, args.systemSource, "utf8");
  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: path.resolve(repoRoot, "og-models"),
        runsDir: ".ogs/runs",
        runtime: {
          error_edges: {
            v1: args.errorEdgesV1
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(profilesPath, JSON.stringify(profiles, null, 2), "utf8");
  await writeFile(toolsPath, JSON.stringify({ tools }, null, 2), "utf8");
  await writeFile(
    lawsPath,
    JSON.stringify(
      {
        laws: [
          {
            lawId: "law.test.error.edge",
            constraints: {
              forbiddenToolRefs: [],
              maxTransitions: 24,
              allowNoopWithoutExecutionBinding: false
            }
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    tempRoot,
    systemPath,
    runtimePath,
    profilesPath,
    toolsPath,
    lawsPath
  };
}

async function runFixture(fixture, prompt = "error edge runtime test") {
  return runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimePath,
    profilesPath: fixture.profilesPath,
    toolsPath: fixture.toolsPath,
    lawsPath: fixture.lawsPath,
    prompt,
    workdir: fixture.tempRoot
  });
}

async function readFailureHandledEvents(fixture) {
  const runsDir = path.resolve(fixture.tempRoot, ".ogs", "runs");
  const runIds = await readdir(runsDir);
  assert.equal(runIds.length, 1);
  const eventsPath = path.resolve(runsDir, runIds[0], "events.ndjson");
  const lines = (await readFile(eventsPath, "utf8"))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    })
    .filter((record) => record && record.type === "failure_handled");
}

async function readGraphStateSnapshot(fixture) {
  const runsDir = path.resolve(fixture.tempRoot, ".ogs", "runs");
  const runIds = await readdir(runsDir);
  assert.equal(runIds.length, 1);
  const statePath = path.resolve(runsDir, runIds[0], "state.json");
  const stateJson = JSON.parse(await readFile(statePath, "utf8"));
  return stateJson.graphState;
}

for (const routingCase of [
  {
    name: "runtime routes failed role via ERROR.<code> before ERROR fallback",
    id: "exact-priority",
    roles: [
      {
        roleId: "worker",
        mode: { kind: "fail" },
        allowedEvents: ["DONE"],
        requireEvent: false
      },
      {
        roleId: "specific",
        mode: { kind: "event", event: "SPEC_DONE", content: "specific" },
        allowedEvents: ["SPEC_DONE"]
      },
      {
        roleId: "fallback",
        mode: { kind: "event", event: "FB_DONE", content: "fallback" },
        allowedEvents: ["FB_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.edge.priority
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.specific=profile.specific
%% exec.bind.fallback=profile.fallback

input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR.TOOL_EXECUTION_SPAWN| specific[Role:specific]
worker[Role:worker] -->|ERROR| fallback[Role:fallback]
specific[Role:specific] -->|SPEC_DONE| output
fallback[Role:fallback] -->|FB_DONE| output
`,
    expectedStatus: "done",
    expectedFinalRoleId: "specific",
    expectedHandledByEvent: "ERROR.TOOL_EXECUTION_SPAWN",
    expectedHandledTargetRoleId: "specific",
    expectedHandledFailureCount: 1,
    expectedUnhandledFailureCount: 0
  },
  {
    name: "runtime falls back to ERROR when no typed error edge matches",
    id: "fallback",
    roles: [
      {
        roleId: "worker",
        mode: { kind: "fail" },
        allowedEvents: ["DONE"],
        requireEvent: false
      },
      {
        roleId: "fallback",
        mode: { kind: "event", event: "FB_DONE", content: "fallback" },
        allowedEvents: ["FB_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.edge.fallback
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.fallback=profile.fallback

input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR| fallback[Role:fallback]
fallback[Role:fallback] -->|FB_DONE| output
`,
    expectedStatus: "done",
    expectedFinalRoleId: "fallback",
    expectedHandledByEvent: "ERROR",
    expectedHandledTargetRoleId: "fallback",
    expectedHandledFailureCount: 1,
    expectedUnhandledFailureCount: 0
  },
  {
    name: "runtime keeps fail-stop behavior when no ERROR* edge matches",
    id: "no-match",
    roles: [
      {
        roleId: "worker",
        mode: { kind: "fail" },
        allowedEvents: ["DONE"],
        requireEvent: false
      },
      {
        roleId: "other",
        mode: { kind: "event", event: "OTHER_DONE", content: "other" },
        allowedEvents: ["OTHER_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.edge.no.match
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.other=profile.other

input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR.TOOL_EXECUTION_TIMEOUT| other[Role:other]
other[Role:other] -->|OTHER_DONE| output
`,
    expectedStatus: "failed",
    expectedHandledByEvent: undefined,
    expectedHandledTargetRoleId: undefined,
    expectedHandledFailureCount: 0,
    expectedUnhandledFailureCount: 1
  }
]) {
  test(routingCase.name, async () => {
    const fixture = await setupFixture({
      id: routingCase.id,
      errorEdgesV1: true,
      roles: routingCase.roles,
      systemSource: routingCase.systemSource
    });
    const result = await runFixture(fixture);
    assert.equal(result.status, routingCase.expectedStatus);
    if (routingCase.expectedFinalRoleId) {
      assert.equal(result.finalRoleId, routingCase.expectedFinalRoleId);
    }

    const workerAudit = result.auditTrail.find((item) => item.roleId === "worker");
    assert.ok(workerAudit);

    const handledEvents = await readFailureHandledEvents(fixture);
    if (routingCase.expectedHandledByEvent) {
      assert.equal(handledEvents.length, 1);
      assert.equal(handledEvents[0].handledByEvent, routingCase.expectedHandledByEvent);
      assert.equal(handledEvents[0].handledTargetRoleId, routingCase.expectedHandledTargetRoleId);
      assert.equal(result.runSummary.handledFailureByEvent[routingCase.expectedHandledByEvent], 1);
      assert.equal(
        result.runSummary.handledFailureByTargetRole[routingCase.expectedHandledTargetRoleId],
        1
      );
    } else {
      assert.equal(handledEvents.length, 0);
      assert.equal(workerAudit.handledByEvent, undefined);
      assert.equal(workerAudit.handledTargetRoleId, undefined);
    }

    assert.equal(result.runSummary.handledFailureCount, routingCase.expectedHandledFailureCount);
    assert.equal(result.runSummary.unhandledFailureCount, routingCase.expectedUnhandledFailureCount);
  });
}

test("handled failure last_context uses failed role input context projection", async () => {
  const fixture = await setupFixture({
    id: "handled-last-context",
    errorEdgesV1: true,
    roles: [
      {
        roleId: "prep",
        mode: {
          kind: "event-data",
          event: "PREP_DONE",
          content: "raw-upstream-content",
          data: { detail: "mapped-context-value" }
        },
        allowedEvents: ["PREP_DONE"]
      },
      {
        roleId: "worker",
        mode: { kind: "fail" },
        allowedEvents: ["DONE"],
        requireEvent: false
      },
      {
        roleId: "fallback",
        mode: { kind: "event", event: "FB_DONE", content: "fallback" },
        allowedEvents: ["FB_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.last.context
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=prep
%% exec.bind.prep=profile.prep
%% exec.bind.worker=profile.worker
%% exec.bind.fallback=profile.fallback
%% context.map.worker.input=direct.data.detail

input -->|START| prep[Role:prep]
prep[Role:prep] -->|PREP_DONE| worker[Role:worker]
worker[Role:worker] -->|ERROR| fallback[Role:fallback]
fallback[Role:fallback] -->|FB_DONE| output
`
  });

  const result = await runFixture(fixture, "last context projection");
  assert.equal(result.status, "done");
  const graphState = await readGraphStateSnapshot(fixture);
  const handledArtifact = Object.values(graphState.roleResults).find(
    (item) => item.roleId === "worker.__handled_failure"
  );
  assert.ok(handledArtifact);
  assert.equal(typeof handledArtifact.data?.last_context, "string");
  assert.match(handledArtifact.data.last_context, /mapped-context-value/);
  assert.doesNotMatch(handledArtifact.data.last_context, /raw-upstream-content/);
});

test("runtime keeps fail-stop behavior when error edge routing flag is disabled", async () => {
  const fixture = await setupFixture({
    id: "flag-off",
    errorEdgesV1: false,
    roles: [
      {
        roleId: "worker",
        mode: { kind: "fail" },
        allowedEvents: ["DONE"],
        requireEvent: false
      },
      {
        roleId: "fallback",
        mode: { kind: "event", event: "FB_DONE", content: "fallback" },
        allowedEvents: ["FB_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.edge.flag.off
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=worker
%% exec.bind.worker=profile.worker
%% exec.bind.fallback=profile.fallback

input -->|START| worker[Role:worker]
worker[Role:worker] -->|ERROR| fallback[Role:fallback]
fallback[Role:fallback] -->|FB_DONE| output
`
  });

  const result = await runFixture(fixture);
  assert.equal(result.status, "failed");
  const workerAudit = result.auditTrail.find((item) => item.roleId === "worker");
  assert.ok(workerAudit);
  assert.equal(workerAudit.handledByEvent, undefined);
  assert.equal(workerAudit.handledTargetRoleId, undefined);
  assert.equal(result.runSummary.handledFailureCount, 0);
  assert.equal(result.runSummary.unhandledFailureCount, 1);
});

test("runtime handles failure per-branch in parallel split and continues healthy branches", async () => {
  const fixture = await setupFixture({
    id: "parallel-branch",
    errorEdgesV1: true,
    roles: [
      {
        roleId: "dispatch",
        mode: { kind: "content", content: "parallel dispatch" },
        allowedEvents: [],
        requireEvent: false
      },
      {
        roleId: "worker_fail",
        mode: { kind: "fail" },
        allowedEvents: ["FAIL_DONE"],
        requireEvent: false
      },
      {
        roleId: "worker_ok",
        mode: { kind: "event", event: "OK_DONE", content: "ok branch" },
        allowedEvents: ["OK_DONE"]
      },
      {
        roleId: "compensate",
        mode: { kind: "event", event: "COMP_DONE", content: "compensated" },
        allowedEvents: ["COMP_DONE"]
      },
      {
        roleId: "final",
        mode: { kind: "event", event: "FINAL_DONE", content: "finalized" },
        allowedEvents: ["FINAL_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.edge.parallel
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.final=all_of
%% join.sources.final=worker_ok,compensate
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_fail=profile.worker_fail
%% exec.bind.worker_ok=profile.worker_ok
%% exec.bind.compensate=profile.compensate
%% exec.bind.final=profile.final

input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_FAIL| worker_fail[Role:worker_fail]
dispatch[Role:dispatch] -->|TO_OK| worker_ok[Role:worker_ok]
worker_fail[Role:worker_fail] -->|ERROR| compensate[Role:compensate]
worker_ok[Role:worker_ok] -->|OK_DONE| final[Role:final]
compensate[Role:compensate] -->|COMP_DONE| final[Role:final]
final[Role:final] -->|FINAL_DONE| output
`
  });

  const result = await runFixture(fixture);
  assert.equal(result.status, "done");
  assert.equal(result.finalRoleId, "final");
  assert.ok(result.auditTrail.some((item) => item.roleId === "worker_ok"));
  assert.ok(result.auditTrail.some((item) => item.roleId === "compensate"));
  const failedAudit = result.auditTrail.find((item) => item.roleId === "worker_fail");
  assert.ok(failedAudit);
  assert.equal(failedAudit.status, "failed");
  const handledEvents = await readFailureHandledEvents(fixture);
  assert.equal(handledEvents.length, 1);
  assert.equal(handledEvents[0].handledByEvent, "ERROR");
  assert.equal(result.runSummary.failedCount, 1);
  assert.equal(result.runSummary.handledFailureCount, 1);
  assert.equal(result.runSummary.unhandledFailureCount, 0);
});

test("parallel_split success path ignores ERROR* edges and duplicate targets", async () => {
  const fixture = await setupFixture({
    id: "parallel-success-error-filter",
    errorEdgesV1: true,
    roles: [
      {
        roleId: "dispatch",
        mode: { kind: "content", content: "parallel dispatch success" },
        allowedEvents: [],
        requireEvent: false
      },
      {
        roleId: "worker_ok",
        mode: { kind: "event", event: "OK_DONE", content: "ok branch" },
        allowedEvents: ["OK_DONE"]
      },
      {
        roleId: "compensate",
        mode: { kind: "event", event: "COMP_DONE", content: "compensated" },
        allowedEvents: ["COMP_DONE"]
      }
    ],
    systemSource: `flowchart TD
%% system.id=test.error.edge.parallel.success.filter
%% system.version=1.0.0
%% law.global=law.test.error.edge
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_ok=profile.worker_ok
%% exec.bind.compensate=profile.compensate

input -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_OK| worker_ok[Role:worker_ok]
dispatch[Role:dispatch] -->|TO_OK_DUP| worker_ok[Role:worker_ok]
dispatch[Role:dispatch] -->|ERROR| compensate[Role:compensate]
dispatch[Role:dispatch] -->|ERROR.TOOL_EXECUTION_SPAWN| compensate[Role:compensate]
worker_ok[Role:worker_ok] -->|OK_DONE| output
compensate[Role:compensate] -->|COMP_DONE| output
`
  });

  const result = await runFixture(fixture);
  assert.equal(result.status, "done");
  assert.equal(result.finalRoleId, "worker_ok");
  assert.equal(result.auditTrail.filter((item) => item.roleId === "worker_ok").length, 1);
  assert.equal(result.auditTrail.filter((item) => item.roleId === "compensate").length, 0);
  assert.equal(result.runSummary.handledFailureCount, 0);
});
