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
      const roleDir = join(workdir, "team-roles", "roles", roleId);
      await mkdir(roleDir, { recursive: true });
      const sourceVerification = converted.verification?.status === "unverified"
        ? null
        : {
            status: "verified",
            identityConfirmed: true,
            eventsConfirmed: true,
            toolsConfirmed: true,
            confirmedEvents: converted.role?.outputs?.events || [],
            confirmedTools: converted.role?.constraints?.allowedTools || []
          };
      if (!sourceVerification) throw new Error("ROLE_TRIAL_SOURCE_UNVERIFIED");
      for (const [name, content] of Object.entries(converted.files)) {
        const trialContent = name === "source.json"
          ? `${JSON.stringify({ ...converted.source, verification: sourceVerification }, null, 2)}\n`
          : content;
        await writeFile(join(roleDir, name), trialContent, { encoding: "utf8", mode: 0o600 });
      }
      await mkdir(join(workdir, ".ogs"), { recursive: true });
      await writeFile(join(workdir, ".ogs", "runtime.json"), JSON.stringify({ configVersion: "2", roleRepo: "team-roles", runsDir: ".ogs/runs", tools: { environmentPolicy: "minimal", envAllowlist: [] } }));
      await writeFile(join(workdir, ".ogs", "laws.json"), JSON.stringify({ laws: [{ lawId: "law.role-trial", constraints: { forbiddenToolRefs: [], maxTransitions: 4, allowNoopWithoutExecutionBinding: false } }] }));
      await writeFile(join(workdir, ".ogs", "user-profile.json"), JSON.stringify({ userProfileId: "role-trial", ...(typeof userPreferences === "string" && userPreferences.trim() ? { style: userPreferences.trim().slice(0, 2000) } : {}) }));
      const prompt = [
        "Task (instruction):",
        cleanTask,
        "Input (JSON context, requirements, and references for the task):",
        JSON.stringify(input, null, 2),
        "Use the task as the instruction and the JSON input as supporting information for completing it.",
        "Return one JSON object with event ROLE_TRIAL_COMPLETE, content, and optional data."
      ].join("\n\n");
      const result = await run({
        // The trial has no user topology. The in-memory definition supplies only the single
        // role boundary required by the existing Runtime executor.
        systemPath: resolve(workdir, ".ogs", "role-trial.system.mmd"),
        systemDefinition: {
          systemId: "role.trial",
          systemVersion: "1.0.0",
          entryRoleIds: [roleId],
          startDispatch: { mode: "all" },
          startEventType: "START",
          startFlows: [{ fromRoleId: "__system_start__", toRoleId: roleId, eventType: "START" }],
          terminalRoleOrder: [roleId],
          roleIds: [roleId],
          flows: [{ fromRoleId: roleId, toRoleId: "__system_end__", eventType: TRIAL_EVENT }],
          lawBinding: { globalLawRef: "law.role-trial" },
          executionBinding: {},
          modelBinding: {}
        },
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
