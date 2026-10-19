import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRunId } from "../../../dist/runtime/run-artifacts.js";

export function createTaskExecutionIdentifiers({ now = () => new Date() } = {}) {
  return Object.freeze({
    createRunId: () => createRunId(now()),
    fingerprint: (payload) => createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    resolveProjectMaterial: (workdir, path) => resolve(workdir, path),
    resolveRunRoot: (project, runId) => resolve(project.workdir, ".ogs", "runs", runId)
  });
}
