import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { promoteSealedArtifact } from "../dist/runtime/artifact-promotion.js";
import { verifyDeclaredArtifacts } from "../dist/runtime/role-executor.js";
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
  const canonicalFiles = await Promise.all(files.map(async (file) => ({
    path: file,
    sha256: createHash("sha256").update(await readFile(path.join(artifactDir, file))).digest("hex"),
    sizeBytes: (await readFile(path.join(artifactDir, file))).byteLength,
    mediaType: file.endsWith(".json") ? "application/json" : "text/javascript"
  })));
  const unsignedCanonicalManifest = {
    version: 1,
    status: "verified",
    artifactId: `artifact:${runId}:fixture`,
    runId,
    producerRoleId: "fixture",
    executionId: "fixture",
    generatedAt: "2026-01-01T00:00:00.000Z",
    files: canonicalFiles,
    totalBytes: canonicalFiles.reduce((sum, file) => sum + file.sizeBytes, 0)
  };
  const manifestSha256 = createHash("sha256").update(`${JSON.stringify(unsignedCanonicalManifest, null, 2)}\n`).digest("hex");
  await writeFile(path.join(sharedDir, "artifact-manifest.json"), JSON.stringify({ ...unsignedCanonicalManifest, manifestSha256 }, null, 2) + "\n");
  const manifest = {
    status: "sealed",
    artifact: "miniprogram/",
    testReport: "test-report.json",
    manifestSha256,
    files: canonicalFiles.map(({ path, sha256 }) => ({ path, sha256 }))
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

test("Role artifact sealing writes the report path consumed by promotion", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-role-artifact-seal-"));
  const runId = "run-role-artifact-1";
  const runDir = path.join(workdir, ".ogs", "runs", runId);
  const executionDir = path.join(runDir, "roles", "writer", "executions", "exec-1");
  const workspace = path.join(executionDir, "workspace");
  const sharedDir = path.join(runDir, "shared");
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(sharedDir, { recursive: true });
    await writeFile(path.join(workspace, "report.txt"), "sealed report\n");
    await verifyDeclaredArtifacts({
      declarations: [{ artifactId: "report", kind: "text", path: "report.txt", mediaType: "text/plain" }],
      workspace,
      executionDir,
      sharedDir,
      runId,
      roleId: "writer",
      executionId: "exec-1"
    });
    const seal = JSON.parse(await readFile(path.join(sharedDir, "seal-manifest.json"), "utf8"));
    const report = JSON.parse(await readFile(path.join(sharedDir, "verification.json"), "utf8"));
    assert.equal(seal.testReport, "verification.json");
    assert.equal(report.passed, true);
    assert.deepEqual(report, JSON.parse(await readFile(path.join(executionDir, "verification.json"), "utf8")));
    await writeFile(path.join(runDir, "summary.json"), JSON.stringify({ status: "done" }));
    const result = await promoteSealedArtifact({
      workdir,
      runId,
      source: "shared/artifacts",
      destination: "release/report"
    });
    assert.equal(result.fileCount, 1);
    assert.equal(await readFile(path.join(workdir, "release", "report", "report.txt"), "utf8"), "sealed report\n");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("artifact verification does not remove a pre-existing target when preflight rejects it", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-artifact-preflight-") );
  const runId = "run-artifact-preflight";
  const runDir = path.join(workdir, ".ogs", "runs", runId);
  const executionDir = path.join(runDir, "roles", "writer", "executions", "exec-1");
  const workspace = path.join(executionDir, "workspace");
  const sharedDir = path.join(runDir, "shared");
  const target = path.join(sharedDir, "artifacts", "report.txt");
  try {
    await mkdir(workspace, { recursive: true });
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(path.join(workspace, "report.txt"), "new report\n");
    await writeFile(target, "pre-existing evidence\n");
    await assert.rejects(() => verifyDeclaredArtifacts({
      declarations: [{ artifactId: "report", kind: "text", path: "report.txt", mediaType: "text/plain" }],
      workspace,
      executionDir,
      sharedDir,
      runId,
      roleId: "writer",
      executionId: "exec-1"
    }), /already exists/);
    assert.equal(await readFile(target, "utf8"), "pre-existing evidence\n");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("parallel Role sealing admits one immutable Run bundle and rejects the other", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-role-artifact-race-"));
  const runId = "run-role-artifact-race";
  const runDir = path.join(workdir, ".ogs", "runs", runId);
  const sharedDir = path.join(runDir, "shared");
  const executionArgs = ["a", "b"].map((roleId) => {
    const executionDir = path.join(runDir, "roles", roleId, "executions", "exec-1");
    return { roleId, executionDir, workspace: path.join(executionDir, "workspace") };
  });
  try {
    await mkdir(sharedDir, { recursive: true });
    await Promise.all(executionArgs.map(async ({ roleId, workspace }) => {
      await mkdir(workspace, { recursive: true });
      await writeFile(path.join(workspace, `${roleId}.txt`), roleId);
    }));
    const results = await Promise.allSettled(executionArgs.map(({ roleId, executionDir, workspace }) => verifyDeclaredArtifacts({
      declarations: [{ artifactId: roleId, kind: "text", path: `${roleId}.txt`, mediaType: "text/plain" }],
      workspace,
      executionDir,
      sharedDir,
      runId,
      roleId,
      executionId: "exec-1"
    })));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.match(String(rejected?.reason?.message || rejected?.reason), /Join\/Merge Stage for unified sealing/);
    assert.equal((await readdir(path.join(sharedDir, "artifacts"))).length, 1);
    assert.equal((await readdir(sharedDir)).includes(".artifact-seal.lock"), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test("Role artifact sealing recovers an interrupted stale bundle before retry", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogs-role-artifact-recovery-"));
  const runId = "run-role-artifact-recovery";
  const runDir = path.join(workdir, ".ogs", "runs", runId);
  const executionDir = path.join(runDir, "roles", "writer", "executions", "exec-2");
  const workspace = path.join(executionDir, "workspace");
  const sharedDir = path.join(runDir, "shared");
  try {
    await mkdir(path.join(sharedDir, "artifacts"), { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "report.txt"), "retry report\n");
    await writeFile(path.join(sharedDir, "artifacts", "report.txt"), "partial\n");
    await writeFile(path.join(sharedDir, "artifact-manifest.json"), "partial manifest\n");
    await writeFile(path.join(sharedDir, "verification.json"), "partial verification\n");
    await writeFile(path.join(sharedDir, ".artifact-seal.lock"), JSON.stringify({
      lockId: "dead-lock",
      runId,
      executionId: "exec-1",
      pid: 999999,
      host: (await import("node:os")).hostname(),
      artifactPaths: ["report.txt"]
    }));
    await verifyDeclaredArtifacts({
      declarations: [{ artifactId: "report", kind: "text", path: "report.txt", mediaType: "text/plain" }],
      workspace,
      executionDir,
      sharedDir,
      runId,
      roleId: "writer",
      executionId: "exec-2"
    });
    assert.equal(await readFile(path.join(sharedDir, "artifacts", "report.txt"), "utf8"), "retry report\n");
    assert.equal((await readdir(sharedDir)).includes(".artifact-seal.lock"), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
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

test("promotion writes business output to workspace-dir while keeping evidence under ogs-dir", async () => {
  const fixture = await createRun();
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "ogs-artifact-workspace-"));
  try {
    const result = await promoteSealedArtifact({
      workdir: fixture.workdir,
      workspaceDir,
      runId: fixture.runId,
      source: "shared/miniprogram",
      destination: "reports/run-test-1"
    });
    assert.equal(result.destination, path.join(await realpath(workspaceDir), "reports", "run-test-1"));
    assert.deepEqual(await readFile(path.join(workspaceDir, "reports", "run-test-1", "app.json")), await readFile(path.join(fixture.artifactDir, "app.json")));
    await assert.rejects(() => readFile(path.join(fixture.workdir, "reports", "run-test-1", "app.json")), { code: "ENOENT" });
  } finally {
    await rm(fixture.workdir, { recursive: true, force: true });
    await rm(workspaceDir, { recursive: true, force: true });
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
    await t.test("seal manifest symlink", async () => {
      const seal = path.join(fixture.sharedDir, "seal-manifest.json");
      const moved = path.join(fixture.sharedDir, "seal-manifest-real.json");
      const outside = await mkdtemp(path.join(os.tmpdir(), "ogs-seal-link-"));
      const fake = path.join(outside, "seal.json");
      await (await import("node:fs/promises")).rename(seal, moved);
      await writeFile(fake, await readFile(moved));
      await (await import("node:fs/promises")).symlink(fake, seal, "file");
      try {
        await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "release/output" }), /ARTIFACT_SYMLINK_NOT_ALLOWED/);
      } finally {
        await rm(seal, { force: true });
        await (await import("node:fs/promises")).rename(moved, seal);
        await rm(outside, { recursive: true, force: true });
      }
    });
    await t.test("canonical manifest symlink", async () => {
      const manifest = path.join(fixture.sharedDir, "artifact-manifest.json");
      const moved = path.join(fixture.sharedDir, "artifact-manifest-real.json");
      const outside = await mkdtemp(path.join(os.tmpdir(), "ogs-manifest-link-"));
      const fake = path.join(outside, "manifest.json");
      await (await import("node:fs/promises")).rename(manifest, moved);
      await writeFile(fake, await readFile(moved));
      await (await import("node:fs/promises")).symlink(fake, manifest, "file");
      try {
        await assert.rejects(() => promoteSealedArtifact({ ...fixture, source: "shared/miniprogram", destination: "release/output" }), /ARTIFACT_SYMLINK_NOT_ALLOWED/);
      } finally {
        await rm(manifest, { force: true });
        await (await import("node:fs/promises")).rename(moved, manifest);
        await rm(outside, { recursive: true, force: true });
      }
    });
  } finally {
    await rm(fixture.workdir, { recursive: true, force: true });
  }
});
