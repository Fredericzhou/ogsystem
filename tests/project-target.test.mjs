import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";

import {
  ensureProjectSkeleton
} from "../dist/runtime/project-lifecycle.js";
import { resolveProjectTargetDirectory } from "../dist/runtime/project-target.js";

test("project target defaults to the control plane and supports an external coding project", async () => {
  const controlDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-target-control-"));
  const codingDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-target-code-"));

  assert.equal(
    await resolveProjectTargetDirectory({ workdir: controlDir }),
    controlDir
  );

  await ensureProjectSkeleton({
    workdir: controlDir,
    targetDir: codingDir
  });

  const project = JSON.parse(
    await readFile(path.resolve(controlDir, ".ogs", "project.json"), "utf8")
  );
  assert.equal(project.target.directory, path.relative(controlDir, codingDir));
  assert.equal(
    await resolveProjectTargetDirectory({ workdir: controlDir }),
    codingDir
  );
});

test("resume keeps the persisted coding project and rejects a target switch", async () => {
  const controlDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-target-resume-"));
  const codingDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-target-code-"));
  const otherCodingDir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-target-other-"));
  const runDir = path.resolve(controlDir, ".ogs", "runs", "run-1");
  const resolvedConfigPath = path.resolve(runDir, "resolved-config.json");

  await mkdir(runDir, { recursive: true });
  await writeFile(
    resolvedConfigPath,
    JSON.stringify({ effective: { targetDir: codingDir } }),
    "utf8"
  );

  assert.equal(
    await resolveProjectTargetDirectory({
      workdir: controlDir,
      resumeRunDir: runDir
    }),
    codingDir
  );
  await assert.rejects(
    resolveProjectTargetDirectory({
      workdir: controlDir,
      targetDir: otherCodingDir,
      resumeRunDir: runDir
    }),
    /Resume target directory differs from the original run/
  );
});
