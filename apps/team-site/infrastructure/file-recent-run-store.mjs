import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { redactText } from "../../../dist/runtime/redaction.js";

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
  async function readRunArtifacts(projectId, runId) {
      assertSafeId(projectId, "projectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
      assertSafeId(runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      const projectRoot = resolve(root, projectId);
      if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run artifact path is outside the site workspace.");
      const runDir = join(projectRoot, ".ogs", "runs", runId);
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
