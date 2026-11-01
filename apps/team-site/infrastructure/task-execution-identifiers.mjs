import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRunId } from "../../../dist/runtime/run-artifacts.js";
import { projectOgsDir, projectWorkspaceDir } from "./project-paths.mjs";

export function createTaskExecutionIdentifiers({ now = () => new Date() } = {}) {
  return Object.freeze({
    createRunId: () => createRunId(now()),
    fingerprint: (payload) => createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    resolveProjectMaterial: (workdir, path) => resolve(workdir, path),
    resolveRunRoot: (project, runId) => resolve(projectOgsDir(project), ".ogs", "runs", runId),
    resolveProjectWorkspace: (project) => projectWorkspaceDir(project)
  });
}
