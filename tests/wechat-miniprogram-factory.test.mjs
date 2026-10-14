import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectSource = join(root, "examples", "wechat-miniprogram-factory");

test("WeChat mini-program OGS flow feeds QA findings back, passes, then seals verified sources", { timeout: 120000 }, async () => {
  const temp = await mkdtemp(join(tmpdir(), "ogs-wechat-factory-"));
  const project = join(temp, "project");
  try {
    await cp(projectSource, project, {
      recursive: true,
      filter: (source) => !source.includes(`${join(".ogs", "runs")}`)
    });
    const cli = join(root, "node_modules", "tsx", "dist", "cli.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      cli,
      join(root, "src", "runtime", "cli.ts"),
      "run", "start",
      "--system", join(project, "system.mmd"),
      "--ogs-dir", project,
      "--input", "Build the Light Task WeChat Mini Program; feed QA findings back to coding and seal only after all checks pass."
    ], { cwd: root, maxBuffer: 4 * 1024 * 1024 });

    const runResult = JSON.parse(stdout);
    assert.equal(runResult.status, "done");
    assert.equal(runResult.finalRoleId, "seal");
    assert.ok(runResult.stages.some((stage) => stage.roleId === "testing" && stage.selectedEvent === "TEST_FAIL"));
    assert.ok(runResult.stages.some((stage) => stage.roleId === "testing" && stage.selectedEvent === "TEST_PASS"));
    assert.ok(runResult.stages.some((stage) => stage.roleId === "seal" && stage.selectedEvent === "SEALED"));

    const runs = await readdir(join(project, ".ogs", "runs"));
    assert.equal(runs.length, 1);
    const runDir = join(project, ".ogs", "runs", runs[0]);
    const shared = join(runDir, "shared");
    const report = JSON.parse(await readFile(join(shared, "test-report.json"), "utf8"));
    assert.equal(report.passed, true);
    assert.ok(report.checks.length >= 10);
    assert.ok(report.checks.every((check) => check.passed === true));

    const codingExecutions = (await readdir(join(runDir, "roles", "coding", "executions"))).sort();
    assert.equal(codingExecutions.length, 2);
    const firstCoding = JSON.parse(await readFile(join(runDir, "roles", "coding", "executions", codingExecutions[0], "result.json"), "utf8"));
    const secondCoding = JSON.parse(await readFile(join(runDir, "roles", "coding", "executions", codingExecutions[1], "result.json"), "utf8"));
    assert.equal(firstCoding.data.feedbackApplied, false);
    assert.equal(secondCoding.data.feedbackApplied, true);
    assert.deepEqual(secondCoding.data.feedbackCodes, ["EMPTY_STATE_REQUIRED"]);

    const manifest = JSON.parse(await readFile(join(shared, "seal-manifest.json"), "utf8"));
    assert.equal(manifest.status, "sealed");
    assert.ok(manifest.files.length >= 8);
    for (const file of manifest.files) {
      const content = await readFile(join(shared, "miniprogram", file.path));
      assert.equal(createHash("sha256").update(content).digest("hex"), file.sha256, file.path);
    }
    const appConfig = JSON.parse(await readFile(join(shared, "miniprogram", "app.json"), "utf8"));
    assert.deepEqual(appConfig.pages, ["pages/index/index"]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
