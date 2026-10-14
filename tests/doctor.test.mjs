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
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.storage.writable, true);
  assert.ok(report.storage.availableBytes > 0);
  assert.equal(report.required.includes("opencode"), true);
});

test("doctor checks arbitrary required command names and reports them as missing", async () => {
  const missingCommand = "ogs-command-that-does-not-exist";
  const report = await runDoctor({ requiredCsv: missingCommand, workdir: process.cwd() });
  assert.equal(report.status, "failed");
  assert.deepEqual(report.missingRequired, [missingCommand]);
  assert.equal(report.checks.find((item) => item.command === missingCommand)?.found, false);
});

test("doctor enforces the requested minimum free space", async () => {
  const report = await runDoctor({
    minFreeBytes: Number.MAX_SAFE_INTEGER,
    workdir: process.cwd()
  });
  assert.equal(report.status, "failed");
  assert.ok(report.errors.some((item) => item.includes("below required")));
});

test("production doctor requires a disk threshold, minimal environment, and retention", async () => {
  await assert.rejects(() => runDoctor({ production: true, workdir: process.cwd() }), /requires --min-free-bytes/);
  const report = await runDoctor({
    production: true,
    minFreeBytes: 1,
    systemPath: path.resolve("examples/target-model-binding-system.mmd"),
    workdir: process.cwd()
  });
  assert.equal(report.status, "failed");
  assert.ok(report.errors.some((item) => item.includes("environmentPolicy=\"minimal\"")));
  assert.ok(report.errors.some((item) => item.includes("retention.enabled=true")));
});

test("doctor validates system/runtime/law inputs", async () => {
  const report = await runDoctor({
    systemPath: path.resolve("examples/target-model-binding-system.mmd"),
    lawsPath: path.resolve(".ogs/laws.json"),
    workdir: process.cwd()
  });

  assert.equal(report.status, "ok");
  assert.equal(report.errors.length, 0);
  assert.ok(report.notes.some((item) => item.includes("system: demo.target.model.binding")));
  assert.ok(
    report.providerHealth.some(
      (item) =>
        item.status === "skipped" &&
        item.code === "DOCTOR_PROVIDER_ONLINE_SKIPPED" &&
        item.modelRef
    )
  );
});

test("doctor reports missing resume prerequisites in run dir inspection", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-doctor-run-"));
  const runDir = path.resolve(tempRoot, ".ogs/runs", "broken-run");
  await mkdir(path.resolve(runDir, "audit"), { recursive: true });
  await mkdir(path.resolve(runDir, "roles"), { recursive: true });
  await writeFile(path.resolve(runDir, "state.json"), JSON.stringify({ status: "done" }), "utf8");

  const report = await runDoctor({
    runDir: ".ogs/runs/broken-run",
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
