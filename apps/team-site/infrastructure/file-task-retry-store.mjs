import { resolve, sep } from "node:path";
import { loadProjectMaterialSnapshots } from "../../../dist/runtime/project-run.js";
import { loadProjectRunState } from "../../../dist/runtime/project-run-state.js";

function safeRoot(workdir) {
  if (typeof workdir !== "string" || !workdir.trim()) {
    throw new Error("TASK_RETRY_STORAGE_INVALID: project workspace is required.");
  }
  const root = resolve(workdir);
  return root;
}

function safeRunId(runId) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(runId || ""))) {
    throw new Error("TASK_RETRY_STORAGE_INVALID: Run ID is invalid.");
  }
  return runId;
}

export function createFileTaskRetryStore() {
  return Object.freeze({
    async readRunState(workdir, runId) {
      const root = safeRoot(workdir);
      return loadProjectRunState(resolve(root, ".ogs", "runs", safeRunId(runId)));
    },
    async loadMaterialSnapshots(workdir, runId) {
      const root = safeRoot(workdir);
      return loadProjectMaterialSnapshots(resolve(root, ".ogs", "runs", safeRunId(runId)));
    },
    resolveMaterialPath(workdir, relativePath) {
      const root = safeRoot(workdir);
      const target = resolve(root, String(relativePath || ""));
      if (!target.startsWith(`${root}${sep}`)) throw new Error("TASK_RETRY_STORAGE_INVALID: material path escapes the Project workspace.");
      return target;
    },
    resolveRunArtifactPath(workdir, runId, relativePath) {
      const root = safeRoot(workdir);
      const runRoot = resolve(root, ".ogs", "runs", safeRunId(runId));
      const target = resolve(runRoot, String(relativePath || ""));
      if (!target.startsWith(`${runRoot}${sep}`)) throw new Error("TASK_RETRY_STORAGE_INVALID: material snapshot path escapes the Run workspace.");
      return target;
    }
  });
}
