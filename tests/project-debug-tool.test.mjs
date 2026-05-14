import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import {
  ensureProjectSkeleton,
  scaffoldProjectTemplate,
  syncProjectDependencies
} from "../dist/runtime/project-lifecycle.js";

test("scaffolded console print tool executes as a standard exec.bind debugger", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-console-print-"));

  await ensureProjectSkeleton({ workdir });
  await scaffoldProjectTemplate({ workdir, templateId: "minimal" });
  await syncProjectDependencies({ workdir, systemPath: "system.mmd" });

  const systemPath = path.resolve(workdir, "system.mmd");
  const systemSource = await readFile(systemPath, "utf8");
  await writeFile(
    systemPath,
    systemSource.replace(
      "%% exec.bind.hello-ogsystem=profile.hello.ogsystem",
      "%% exec.bind.hello-ogsystem=profile.console.print"
    ),
    "utf8"
  );

  await stat(path.resolve(workdir, "profiles.json"));
  await stat(path.resolve(workdir, "tools.json"));
  await stat(path.resolve(workdir, "scripts", "console-print.mjs"));

  const result = await runSystemWithAdapter({
    systemPath,
    prompt: "debug this role through the standard console print tool",
    workdir,
    dryRun: false
  });

  assert.equal(result.status, "done");
  assert.equal(result.finalRoleId, "hello-ogsystem");
  assert.equal(result.auditTrail[0]?.toolRef, "tool.console.print");
  assert.equal(result.auditTrail[0]?.selectedEvent, "HELLO_DONE");
  assert.match(result.finalOutput ?? "", /standard console print tool/);

  const toolsConfig = JSON.parse(await readFile(path.resolve(workdir, "tools.json"), "utf8"));
  assert.equal(toolsConfig.tools[0]?.command, "node");
  assert.equal(toolsConfig.tools[0]?.argsTemplate[0], "scripts/console-print.mjs");
  assert.equal(toolsConfig.tools[0]?.stdinMode, "text");
});
