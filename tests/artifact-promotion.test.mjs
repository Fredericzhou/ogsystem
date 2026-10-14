import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { promoteSealedArtifact } from "../dist/runtime/artifact-promotion.js";
import { fileURLToPath } from "node:url";

const runtimeCliPath = fileURLToPath(new URL("../dist/runtime/cli.js", import.meta.url));

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [runtimeCliPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function createRun() {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-artifact-promotion-"));
  const runId = "run-test-1";
  const runDir = path.join(workdir, ".ogs", "runs", runId);
  const sharedDir = path.join(runDir, "shared");
  const artifactDir = path.join(sharedDir, "miniprogram");
  await mkdir(path.join(artifactDir, "pages"), { recursive: true });
  await writeFile(path.join(runDir, "summary.json"), JSON.stringify({ status: "done" }));
  await writeFile(path.join(sharedDir, "test-report.json"), JSON.stringify({ passed: true }));
  await writeFile(path.join(artifactDir, "app.json"), JSON.stringify({ pages: ["pages/index"] }));
  await writeFile(path.join(artifactDir, "pages", "index.js"), "Page({ data: {} });\n");
  const files = ["app.json", "pages/index.js"];
  const manifest = {
    status: "sealed",
    artifact: "miniprogram/",
    testReport: "test-report.json",
    files: await Promise.all(files.map(async (file) => ({
      path: file,
      sha256: createHash("sha256").update(await readFile(path.join(artifactDir, file))).digest("hex")
    })))
  };
  await writeFile(path.join(sharedDir, "seal-manifest.json"), JSON.stringify(manifest));
  return { workdir, runId, runDir, sharedDir, artifactDir };
}

test("promotion verifies and atomically publishes a passing sealed artifact without changing its run", async () => {
  const fixture = await createRun();
  try {
    const before = await readFile(path.join(fixture.artifactDir, "app.json"));
    const result = await promoteSealedArtifact({
      workdir: fixture.workdir,
      runId: fixture.runId,
      source: "shared/miniprogram",
      destination: "release/run-test-1"
    });
    assert.equal(result.fileCount, 2);
    assert.equal(result.runId, fixture.runId);
    assert.deepEqual(await readFile(path.join(fixture.workdir, "release", fixture.runId, "app.json")), before);
    const record = JSON.parse(await readFile(path.join(fixture.workdir, "release", fixture.runId, "promotion.json"), "utf8"));
    assert.equal(record.runId, fixture.runId);
    assert.match(record.sealManifestSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readFile(path.join(fixture.artifactDir, "app.json")), before);
    await assert.rejects(() => promoteSealedArtifact({
      workdir: fixture.workdir,
      runId: fixture.runId,
      source: "shared/miniprogram",
      destination: "release/run-test-1"
    }), /destination already exists/);
  } finally {
    await rm(fixture.workdir, { recursive: true, force: true });
  }
});

test("CLI promotes from the selected project and emits a machine-readable receipt", async () => {
  const fixture = await createRun();
  try {
    const result = await runCli([
      "run", "artifact", "promote", fixture.runId,
      "--ogs-dir", fixture.workdir,
      "--source", "shared/miniprogram",
      "--destination", "release/mini-program"
    ]);
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, "promoted");
    assert.equal(payload.runId, fixture.runId);
    assert.equal(payload.fileCount, 2);
  } finally {
    await rm(fixture.workdir, { recursive: true, force: true });
  }
});

test("promotion rejects incomplete, failed, modified, and unsealed inputs without creating destinations", async (t) => {
  const cases = [
    ["non-terminal run", async ({ runDir }) => writeFile(path.join(runDir, "summary.json"), JSON.stringify({ status: "stopped" })), /is not done/],
    ["failed test report", async ({ sharedDir }) => writeFile(path.join(sharedDir, "test-report.json"), JSON.stringify({ passed: false })), /not passing/],
    ["missing test report", async ({ sharedDir }) => (await import("node:fs/promises")).rm(path.join(sharedDir, "test-report.json")), /ENOENT/],
    ["unsealed manifest", async ({ sharedDir }) => writeFile(path.join(sharedDir, "seal-manifest.json"), JSON.stringify({ status: "draft", artifact: "miniprogram/", testReport: "test-report.json", files: [] })), /not sealed/],
    ["missing seal manifest", async ({ sharedDir }) => (await import("node:fs/promises")).rm(path.join(sharedDir, "seal-manifest.json")), /ENOENT/],
    ["modified source", async ({ artifactDir }) => writeFile(path.join(artifactDir, "app.json"), "{}"), /hash mismatch/],
    ["unmanifested file", async ({ artifactDir }) => writeFile(path.join(artifactDir, "extra.txt"), "extra"), /file set does not exactly match/]
  ];
  for (const [name, change, expected] of cases) {
    await t.test(name, async () => {
      const fixture = await createRun();
      try {
        await change(fixture);
        await assert.rejects(() => promoteSealedArtifact({
          workdir: fixture.workdir,
          runId: fixture.runId,
          source: "shared/miniprogram",
          destination: "release/output"
        }), expected);
        await assert.rejects(() => readFile(path.join(fixture.workdir, "release", "output", "app.json")));
        const staging = await readdir(fixture.workdir).then((entries) => entries.filter((entry) => entry.startsWith(".ogs-promotion-")));
        assert.deepEqual(staging, []);
      } finally {
        await rm(fixture.workdir, { recursive: true, force: true });
      }
    });
  }
});

test("promotion rejects traversal, artifact substitution, and symlinks", async (t) => {
  const fixture = await createRun();
  try {
    await t.test("source traversal", async () => {
      await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "../outside", destination: "release/output" }), /unsafe path segment/);
    });
    await t.test("artifact substitution", async () => {
      await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/other", destination: "release/output" }), /does not match/);
    });
    await t.test("destination traversal", async () => {
      await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "../outside" }), /unsafe path segment/);
    });
    await t.test("source symlink", async () => {
      const link = path.join(fixture.artifactDir, "link");
      await (await import("node:fs/promises")).symlink(path.join(fixture.artifactDir, "app.json"), link);
      try {
        await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "release/output" }), /symbolic link/);
      } finally {
        await rm(link, { force: true });
      }
    });
    await t.test("destination parent symlink", async () => {
      const outside = await mkdtemp(path.join(os.tmpdir(), "ogs-promotion-outside-"));
      try {
        await (await import("node:fs/promises")).symlink(outside, path.join(fixture.workdir, "linked-release"), "junction");
        await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "linked-release/output" }), /destination parent path contains a symbolic link/);
        await assert.deepEqual(await readdir(outside), []);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
    await t.test("source root symlink", async () => {
      const source = path.join(fixture.sharedDir, "miniprogram");
      const moved = path.join(fixture.sharedDir, "miniprogram-real");
      await (await import("node:fs/promises")).rename(source, moved);
      try {
        await (await import("node:fs/promises")).symlink(moved, source, "junction");
        await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "release/output" }), /artifact source path contains a symbolic link/);
      } finally {
        await rm(source, { force: true, recursive: true });
        await (await import("node:fs/promises")).rename(moved, source);
      }
    });
    await t.test("report symlink", async () => {
      const report = path.join(fixture.sharedDir, "test-report.json");
      const moved = path.join(fixture.sharedDir, "test-report-real.json");
      await (await import("node:fs/promises")).rename(report, moved);
      await (await import("node:fs/promises")).symlink(moved, report, "file");
      await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "release/output" }), /test report path contains a symbolic link/);
    });
  } finally {
    await rm(fixture.workdir, { recursive: true, force: true });
  }
});
