import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { runDoctor } from "../dist/runtime/doctor.js";

test("doctor keeps required command checks", async () => {
  const report = await runDoctor({
    requiredCsv: "opencode",
    workdir: process.cwd()
  });

  assert.ok(Array.isArray(report.checks));
  assert.equal(report.required.includes("opencode"), true);
});

test("doctor validates system/runtime/law inputs", async () => {
  const report = await runDoctor({
    systemPath: path.resolve("examples/target-model-binding-system.mmd"),
    lawsPath: path.resolve(".ogsystem/laws.json"),
    workdir: process.cwd()
  });

  assert.equal(report.status, "ok");
  assert.equal(report.errors.length, 0);
  assert.ok(report.notes.some((item) => item.includes("system: demo.target.model.binding")));
});

test("doctor reports missing resume prerequisites in run dir inspection", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-doctor-run-"));
  const runDir = path.resolve(tempRoot, "ogsystem-history", "broken-run");
  await mkdir(path.resolve(runDir, "audit"), { recursive: true });
  await mkdir(path.resolve(runDir, "roles"), { recursive: true });
  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({ status: "done" }), "utf8");

  const report = await runDoctor({
    runDir: "ogsystem-history/broken-run",
    workdir: tempRoot
  });

  assert.equal(report.status, "failed");
  assert.ok(report.errors.some((item) => item.includes("state.json.graphState")));
  assert.ok(report.warnings.some((item) => item.includes("sessions.json")));
});

test("doctor skips online check when system context is absent", async () => {
  const report = await runDoctor({
    onlineCheck: true,
    workdir: process.cwd()
  });

  assert.ok(report.warnings.some((item) => item.includes("online check skipped")));
});
