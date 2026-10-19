import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { redactText } from "../../../dist/runtime/redaction.js";

function assertSafeId(value, field, pattern) {
  if (!pattern.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

export function createFileRunResultStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Run result store projects root is required.");
  const root = resolve(projectsRoot);

  return Object.freeze({
    async readFinalOutput(run) {
      assertSafeId(run.runtimeProjectId, "runtimeProjectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
      assertSafeId(run.runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      const projectRoot = resolve(root, run.runtimeProjectId);
      if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run result path is outside the site workspace.");
      const statePath = join(projectRoot, ".ogs", "runs", run.runId, "state.json");
      let snapshot;
      try {
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
