import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { redactText } from "../../../dist/runtime/redaction.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

function assertSafeId(value, field, pattern) {
  if (!pattern.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

export function createFileRunResultStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Run result store projects root is required.");
  const root = resolve(projectsRoot);

  return Object.freeze({
    async readFinalOutput(run) {
      const projectId = run.owner?.kind === "project_task" ? run.owner.projectId : undefined;
      assertSafeId(projectId, "projectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
      assertSafeId(run.taskId, "taskId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      assertSafeId(run.runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      const projectRoot = resolve(root, projectId);
      if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run result path is outside the site workspace.");
      await assertSafeEvidencePath(root, [projectId], { kind: "directory", label: "Project" });
      await assertSafeEvidencePath(root, [projectId, ".site"], { kind: "directory", label: "Project metadata" });
      await assertSafeEvidencePath(root, [projectId, ".site", "project.json"], { kind: "file", label: "Project metadata" });
      const metadata = JSON.parse(await readFile(join(projectRoot, ".site", "project.json"), "utf8"));
      const task = (metadata.taskRecords || []).find((item) => item.taskId === run.taskId && !item.deletedAt);
      if (metadata.projectType !== "collaboration" || !task) throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
      const project = { projectId, workdir: projectRoot };
      await readProjectRunOwner(project, task, run.runId);
      const statePath = join(projectRoot, ".ogs", "runs", run.runId, "state.json");
      let snapshot;
      try {
        await assertSafeEvidencePath(projectRoot, [".ogs", "runs", run.runId, "state.json"], { kind: "file", label: "Run state" });
        snapshot = JSON.parse(await readFile(statePath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
      const finalOutput = snapshot?.graphState?.finalOutput;
      return typeof finalOutput === "string"
        ? redactText(finalOutput, { enabled: true })
        : undefined;
    }
  });
}
