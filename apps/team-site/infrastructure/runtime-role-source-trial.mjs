import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runSystemWithAdapter } from "../../../dist/runtime/adapter.js";

const TRIAL_EVENT = "ROLE_TRIAL_COMPLETE";

export function createRuntimeRoleSourceTrial({ run = runSystemWithAdapter, getDefaultModelSelection = async () => undefined } = {}) {
  return async function runTrial({ converted, task, input, userPreferences }) {
    const cleanTask = String(task || "").trim();
    if (!cleanTask || cleanTask.length > 12000) throw new Error("ROLE_TRIAL_TASK_INVALID");
    if (input === undefined || input === null || typeof input !== "object" || Array.isArray(input)) throw new Error("ROLE_TRIAL_INPUT_INVALID");
    if (JSON.stringify(input).length > 32000) throw new Error("ROLE_TRIAL_INPUT_TOO_LARGE");
    const selection = await getDefaultModelSelection();
    if (!selection?.modelCatalogModels?.length || !selection.modelSelectionDefaults) throw new Error("ROLE_TRIAL_MODEL_UNAVAILABLE");
    const workdir = await mkdtemp(join(tmpdir(), "ogs-role-trial-"));
    const roleId = converted.roleId;
    const started = Date.now();
    try {
      const roleDir = join(workdir, "team-roles", roleId);
      await mkdir(roleDir, { recursive: true });
      for (const [name, content] of Object.entries(converted.files)) await writeFile(join(roleDir, name), content, { encoding: "utf8", mode: 0o600 });
      await mkdir(join(workdir, ".ogs"), { recursive: true });
      await writeFile(join(workdir, ".ogs", "runtime.json"), JSON.stringify({ configVersion: "2", roleRepo: "team-roles", runsDir: ".ogs/runs", tools: { environmentPolicy: "minimal", envAllowlist: [] } }));
      await writeFile(join(workdir, ".ogs", "laws.json"), JSON.stringify({ laws: [{ lawId: "law.role-trial", constraints: { forbiddenToolRefs: [], maxTransitions: 4, allowNoopWithoutExecutionBinding: false } }] }));
      await writeFile(join(workdir, ".ogs", "user-profile.json"), JSON.stringify({ userProfileId: "role-trial", ...(typeof userPreferences === "string" && userPreferences.trim() ? { style: userPreferences.trim().slice(0, 2000) } : {}) }));
      await writeFile(join(workdir, "system.mmd"), [
        "flowchart TD",
        "%% system.id=role.trial",
        "%% system.version=1.0.0",
        "%% law.global=law.role-trial",
        `start[开始] -->|START| role[Role:${roleId}]`,
        `role -->|${TRIAL_EVENT}| end[结束]`
      ].join("\n") + "\n");
      const prompt = [
        "Task (instruction):",
        cleanTask,
        "Input (JSON context, requirements, and references for the task):",
        JSON.stringify(input, null, 2),
        "Use the task as the instruction and the JSON input as supporting information for completing it.",
        "Return one JSON object with event ROLE_TRIAL_COMPLETE, content, and optional data."
      ].join("\n\n");
      const result = await run({
        systemPath: resolve(workdir, "system.mmd"),
        prompt,
        workdir,
        runId: `role-trial-${randomUUID()}`,
        dryRun: false,
        executionMode: "sandbox",
        runKind: "studio_simulation",
        modelSelectionDefaults: selection.modelSelectionDefaults,
        modelCatalogModels: selection.modelCatalogModels,
        modelCatalogGeneratedAt: selection.modelCatalogGeneratedAt,
        logRun: false
      });
      return {
        status: ["error", "failed", "cancelled", "blocked"].includes(String(result.status || "").toLowerCase()) ? "failed" : "completed",
        model: selection.modelSelectionDefaults,
        durationMs: Date.now() - started,
        output: result.finalOutputsByRoleId?.[roleId] || null,
        summary: result.runSummary || {}
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  };
}
