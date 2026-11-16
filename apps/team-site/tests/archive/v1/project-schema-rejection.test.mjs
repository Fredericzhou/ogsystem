import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("project reads and lists reject persisted metadata missing the latest overview field", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-project-schema-"));
  const previousRoot = process.env.OGS_SITE_PROJECTS_DIR;
  process.env.OGS_SITE_PROJECTS_DIR = projectsRoot;
  const store = await import(`../infrastructure/file-project-store.mjs?project-schema=${Date.now()}-${Math.random()}`);

  try {
    const created = await store.createProject({
      name: "Schema Contract Project",
      overview: "A valid project before corruption.",
      templateId: "empty"
    });
    assert.equal((await store.getProject(created.projectId)).overview, "A valid project before corruption.");

    const metadataPath = join(created.workdir, ".site", "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    delete metadata.overview;
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

    await assert.rejects(
      () => store.getProject(created.projectId),
      (error) => error.message.includes("PROJECT_SCHEMA_UNSUPPORTED")
        && error.message.includes("project metadata must use overview")
    );
    await assert.rejects(
      () => store.listProjects(),
      (error) => error.message.includes("PROJECT_SCHEMA_UNSUPPORTED")
        && error.message.includes("project metadata must use overview")
    );
  } finally {
    if (previousRoot === undefined) delete process.env.OGS_SITE_PROJECTS_DIR;
    else process.env.OGS_SITE_PROJECTS_DIR = previousRoot;
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
