import test from "node:test";
import assert from "node:assert/strict";

import { resolveExecutionBinding } from "../dist/runtime/binding-resolver.js";

test("profile tool paths stay rooted in control workdir when coding target differs", () => {
  const binding = resolveExecutionBinding({
    roleId: "builder",
    node: {
      binding: {
        kind: "profile",
        profileId: "profile.local"
      }
    },
    runContext: {
      runDir: "/tmp/control/.ogs/runs/run-1",
      sharedDir: "/tmp/control/.ogs/runs/run-1/shared"
    },
    baseWorkdir: "/tmp/coding-project",
    commandBaseDir: "/tmp/control",
    roleDirs: {
      roleDir: "/tmp/control/.ogs/runs/run-1/roles/builder",
      privateDir: "/tmp/control/.ogs/runs/run-1/roles/builder/private",
      executionsDir: "/tmp/control/.ogs/runs/run-1/roles/builder/executions",
      latestSessionPath: "/tmp/control/.ogs/runs/run-1/roles/builder/latest-session.json"
    },
    allowedEvents: ["DONE"],
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false
    },
    profilesById: new Map([
      ["profile.local", { profileId: "profile.local", toolRef: "tool.local" }]
    ]),
    toolsByRef: new Map([
      ["tool.local", { toolRef: "tool.local", command: "node", argsTemplate: ["scripts/console-print.mjs"] }]
    ])
  });

  assert.equal(binding.commandBaseDir, "/tmp/control");
  assert.equal(binding.workdir, "/tmp/control/.ogs/runs/run-1/roles/builder/private");
  assert.equal(binding.env.OGSYSTEM_TARGET_DIR, "/tmp/coding-project");
});
