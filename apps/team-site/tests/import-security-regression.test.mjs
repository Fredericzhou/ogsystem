import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadTeamPackage } from "../../../dist/visualizer/project-projection.js";

const systemSource = await readFile(new URL("../../../examples/target-model-binding-system.mmd", import.meta.url), "utf8");

function bundle(executableFiles = [], extraTeam = {}) {
  return {
    mode: "team-v2",
    team: { systemSource, executableFiles, ...extraTeam }
  };
}

function withoutPackageDigest(value) {
  const { packageDigest: _packageDigest, ...withoutDigest } = value;
  return withoutDigest;
}

async function createImportRoot() {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-import-security-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  return workdir;
}

test("team package import rejects absolute, traversal, and Windows-style paths before writing", async () => {
  const unsafePaths = [
    "/tmp/ogs-import-escape.txt",
    "C:/tmp/ogs-import-escape.txt",
    "C:tmp/ogs-import-escape.txt",
    "../ogs-import-escape.txt",
    "nested/../../ogs-import-escape.txt",
    "nested\\..\\ogs-import-escape.txt",
    "nested\\ogs-import-escape.txt"
  ];

  for (const unsafePath of unsafePaths) {
    const workdir = await createImportRoot();
    try {
      await assert.rejects(
        () => loadTeamPackage({
          workdir,
          bundle: bundle([{ path: unsafePath, content: "must not be written" }])
        }),
        /PROJECT_IMPORT_INVALID: unsafe artifact path/
      );
      await assert.rejects(() => stat(join(workdir, "system.mmd")), { code: "ENOENT" });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
});

test("team package import rejects symlink parents and symlink targets without touching the link target", async (t) => {
  const workdir = await createImportRoot();
  const outside = await mkdtemp(join(tmpdir(), "ogs-import-security-outside-"));
  try {
    try {
      await symlink(outside, join(workdir, "linked"), "dir");
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    await assert.rejects(
      () => loadTeamPackage({
        workdir,
        bundle: bundle([{ path: "linked/escaped.txt", content: "must not be written" }])
      }),
      /PROJECT_IMPORT_INVALID: artifact path component is a symbolic link/
    );
    await assert.rejects(() => stat(join(outside, "escaped.txt")), { code: "ENOENT" });

    const outsideFile = join(outside, "existing.txt");
    await writeFile(outsideFile, "unchanged", "utf8");
    const linkedFile = join(workdir, "linked-file.txt");
    await symlink(outsideFile, linkedFile, "file");
    await assert.rejects(
      () => loadTeamPackage({
        workdir,
        bundle: bundle([{ path: "linked-file.txt", content: "must not replace" }])
      }),
      /PROJECT_IMPORT_INVALID: artifact target is a symbolic link/
    );
    assert.equal(await readFile(outsideFile, "utf8"), "unchanged");
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("team package import rejects symlinked fixed project files before any package write", async (t) => {
  const workdir = await createImportRoot();
  const outside = await mkdtemp(join(tmpdir(), "ogs-import-fixed-outside-"));
  const outsideFile = join(outside, "fixed.txt");
  await writeFile(outsideFile, "unchanged", "utf8");
  try {
    try {
      await symlink(outsideFile, join(workdir, "system.mmd"), "file");
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip(`symlink creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      () => loadTeamPackage({ workdir, bundle: bundle() }),
      /PROJECT_IMPORT_INVALID: artifact target is a symbolic link/
    );
    assert.equal(await readFile(outsideFile, "utf8"), "unchanged");
    assert.equal(await readlink(join(workdir, "system.mmd")), outsideFile);
  } finally {
    await rm(workdir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("identical team cores remain distinct imports while preserving the same teamCoreDigest", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-import-digest-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?import-digest=${Date.now()}`);
  try {
    const source = await store.createProject({ name: "Digest Source", overview: "Import identity test.", templateId: "minimal" });
    await store.confirmProjectTeam(source.projectId, { release: true });
    const exported = await store.exportProjectTeam(source.projectId);
    await assert.rejects(
      () => store.importTeamPackage({ ...withoutPackageDigest(exported), teamCoreDigest: "0".repeat(64) }),
      /TEAM_IMPORT_DIGEST_MISMATCH/
    );
    await assert.rejects(
      () => store.importTeamPackage({ ...exported, team: { ...exported.team, systemSource: `${exported.team.systemSource}\n tampered` } }),
      /TEAM_IMPORT_DIGEST_MISMATCH/
    );
    const importedA = await store.importTeamPackage({
      ...withoutPackageDigest(exported),
      team: { ...exported.team, project: { ...exported.team.project, name: "Digest Import A" } }
    });
    const importedB = await store.importTeamPackage({
      ...withoutPackageDigest(exported),
      team: { ...exported.team, project: { ...exported.team.project, name: "Digest Import B" } }
    });
    const confirmedA = await store.confirmProjectTeam(importedA.projectId, { release: true });
    const confirmedB = await store.confirmProjectTeam(importedB.projectId, { release: true });

    assert.notEqual(confirmedA.projectId, confirmedB.projectId);
    assert.equal(confirmedA.teamCoreDigest, confirmedB.teamCoreDigest);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("packageDigest is stable across run history without changing projectDefinitionDigest", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-import-digest-"));
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../project-repository.mjs?package-digest=${Date.now()}`);
  try {
    const team = await store.createProject({ name: "Package Digest Team", overview: "Package identity source.", templateId: "minimal" });
    await store.confirmProjectTeam(team.projectId, { release: true });
    const project = await store.createCollaborationProject({
      name: "Package Digest Project",
      overview: "Package identity test.",
      teamVersionIds: [team.projectId]
    });
    const first = await store.exportProjectBundle(project.projectId);
    const repeat = await store.exportProjectBundle(project.projectId);
    assert.equal(repeat.packageDigest, first.packageDigest);
    assert.equal(repeat.project.projectDefinitionDigest, first.project.projectDefinitionDigest);

    const task = await store.createProjectTask(project.projectId, {
      input: "Create a package digest test run.",
      teamVersionId: team.projectId,
      idempotencyKey: "package-digest-run"
    });
    const started = await store.startProjectTask(project.projectId, task.taskId, { mode: "dry-run" });
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const observed = await store.getProjectRun(project.projectId, started.runId);
      if (["completed", "failed", "cancelled"].includes(observed.state.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const afterRun = await store.exportProjectBundle(project.projectId);
    assert.equal(afterRun.packageDigest, first.packageDigest);
    assert.equal(afterRun.project.projectDefinitionDigest, first.project.projectDefinitionDigest);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
