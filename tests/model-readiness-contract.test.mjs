import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { inspectProjectReadiness } from "../dist/visualizer/project-readiness.js";
import { latestRoleContract } from "../tests-support/role-fixture.mjs";

async function createFixture(options = {}) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-model-readiness-"));
  await mkdir(path.join(workdir, ".ogs"), { recursive: true });
  await mkdir(path.join(workdir, "og-roles", "roles", "writer"), { recursive: true });
  await writeFile(
    path.join(workdir, ".ogs", "runtime.json"),
    JSON.stringify({ configVersion: "2", executor: "opencode", roleRepo: "./og-roles", runsDir: ".ogs/runs" }),
    "utf8"
  );
  await writeFile(
    path.join(workdir, ".ogs", "laws.json"),
    JSON.stringify({ laws: [{ lawId: "law.model.test", constraints: { maxTransitions: 8, allowNoopWithoutExecutionBinding: false, forbiddenToolRefs: [] } }] }),
    "utf8"
  );
  await writeFile(
    path.join(workdir, "og-roles", "roles", "writer", "role.json"),
    JSON.stringify({ roleId: "writer", roleVersion: "1.0.0", name: "writer", description: "fixture", promptTemplate: "prompt.md", outputSchema: "output.schema.json", ...latestRoleContract({ events: ["DONE"] }) }),
    "utf8"
  );
  await writeFile(path.join(workdir, "og-roles", "roles", "writer", "prompt.md"), "{{task}}", "utf8");
  await writeFile(path.join(workdir, "og-roles", "roles", "writer", "agent.md"), "# writer", "utf8");
  await writeFile(path.join(workdir, "og-roles", "roles", "writer", "output.schema.json"), JSON.stringify({ type: "object" }), "utf8");
  await writeFile(
    path.join(workdir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=model.readiness.fixture",
      "%% system.version=1.0.0",
      "%% law.global=law.model.test",
      "%% entry.role=writer",
      "%% model.bind.writer=provider/pinned",
      "input -->|START| writer[Role:writer]",
      "writer[Role:writer] -->|DONE| output"
    ].join("\n"),
    "utf8"
  );
  if (options.catalog) {
    await writeFile(path.join(workdir, ".ogs", "model-catalog.json"), JSON.stringify(options.catalog), "utf8");
  }
  return workdir;
}

test("readiness fails closed when fresh OpenCode discovery excludes a pinned model", async () => {
  const workdir = await createFixture({
    catalog: {
      catalogVersion: "1",
      generatedAt: new Date().toISOString(),
      source: { command: "opencode models --verbose" },
      models: []
    }
  });
  try {
    const readiness = await inspectProjectReadiness(workdir);
    assert.equal(readiness.canDryRun, false);
    assert.ok(readiness.blockers.some((issue) => issue.code === "READINESS_MODEL_UNAVAILABLE" && issue.roleId === "writer" && issue.message.includes("provider/pinned")));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("readiness permits a pinned offline model when the discovery catalog is missing", async () => {
  const workdir = await createFixture();
  try {
    const readiness = await inspectProjectReadiness(workdir);
    assert.equal(readiness.canDryRun, true);
    assert.ok(readiness.warnings.some((issue) => issue.code === "READINESS_MODEL_SELECTION_WARNING" && issue.message.includes("availability was not discovered")));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
