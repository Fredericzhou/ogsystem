import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { redactText } from "../../../dist/runtime/redaction.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

function assertSafeId(value, field, pattern) {
  if (!pattern.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export function createFileRecentRunStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Recent Run store projects root is required.");
  const root = resolve(projectsRoot);
  async function readRunArtifacts(projectId, taskId, runId) {
      assertSafeId(projectId, "projectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
      assertSafeId(taskId, "taskId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      assertSafeId(runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      const projectRoot = resolve(root, projectId);
      if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run artifact path is outside the site workspace.");
      await assertSafeEvidencePath(root, [projectId], { kind: "directory", label: "Project" });
      await assertSafeEvidencePath(root, [projectId, ".site"], { kind: "directory", label: "Project metadata" });
      await assertSafeEvidencePath(root, [projectId, ".site", "project.json"], { kind: "file", label: "Project metadata" });
      const project = { projectId, workdir: projectRoot };
      const metadata = await readJson(join(projectRoot, ".site", "project.json"));
      if (metadata?.projectType !== "collaboration") throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
      const task = (metadata.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
      if (!task) throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
      await readProjectRunOwner(project, task, runId);
      const runDir = join(projectRoot, ".ogs", "runs", runId);
      const evidenceFiles = [
        [".ogs", "runs", runId, "control"],
        [".ogs", "runs", runId, "control", "state.json"],
        [".ogs", "runs", runId, "run-plan.json"],
        [".ogs", "runs", runId, "state.json"]
      ];
      for (const segments of evidenceFiles) {
        try {
          await assertSafeEvidencePath(projectRoot, segments, {
            kind: segments.at(-1) === "control" ? "directory" : "file",
            label: "Recent Run evidence"
          });
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      const [state, plan] = await Promise.all([
        readJson(join(runDir, "control", "state.json")),
        readJson(join(runDir, "run-plan.json"))
      ]);
      const output = await readJson(join(runDir, "state.json"));
      const finalOutput = output?.graphState?.finalOutput;
      return {
        state,
        plan,
        outputSummary: typeof finalOutput === "string" ? redactText(finalOutput, { enabled: true }).slice(0, 500) : ""
      };
  }

  return Object.freeze({ readRunArtifacts, readAttempt: readRunArtifacts });
}
