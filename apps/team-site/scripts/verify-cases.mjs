import { cases } from "../cases.mjs";
import { lintCase, runCase } from "../demo-runner.mjs";

const failures = [];
const expectedBackend = process.env.OGS_DEMO_BACKEND || "codex";
const expectedModel = (process.env.OGS_DEMO_MODEL || "gpt-6-luna").split("/").at(-1);
for (const item of cases) {
  process.stdout.write(`\n[lint] ${item.id}\n`);
  try {
    const lint = await lintCase(item.id);
    if (lint.status && lint.status !== "ok" && lint.status !== "ready") throw new Error(JSON.stringify(lint));
    process.stdout.write("[lint] passed\n");
    process.stdout.write(`[model-run] ${item.id} via ${expectedBackend}/${process.env.OGS_DEMO_MODEL || "gpt-6-luna"}\n`);
    const result = await runCase({
      caseId: item.id,
      prompt: process.env.OGS_CASE_PROMPT || "Prepare a concise, evidence-aware collaboration result for a sample task. State assumptions and uncertainty clearly.",
      mode: "model"
    });
    const expectedRoles = new Set(item.roles.map((role) => role.id));
    const successfulEntries = result.auditTrail.filter((entry) => entry.status === "ok");
    const completedRoles = new Set(successfulEntries.map((entry) => entry.roleId));
    const missing = [...expectedRoles].filter((roleId) => !completedRoles.has(roleId));
    const wrongBackend = successfulEntries.filter((entry) => entry.backend !== expectedBackend);
    const wrongModel = successfulEntries.filter((entry) => entry.modelId?.split("/").at(-1) !== expectedModel);
    if (result.status !== "done" || missing.length || wrongBackend.length || wrongModel.length) {
      const actual = [...new Set(successfulEntries.map((entry) => `${entry.backend || "unknown"}/${entry.modelId || "unknown"}`))].join(", ");
      const failures = result.auditTrail.filter((entry) => entry.failure).map((entry) => `${entry.roleId}: ${entry.failure}`).join(" | ");
      throw new Error(`Run status ${result.status}; missing successful roles: ${missing.join(", ") || "none"}; backend mismatches: ${wrongBackend.length}; model mismatches: ${wrongModel.length}; actual=${actual || "no successful audit entries"}${failures ? `; errors=${failures}` : ""}`);
    }
    const bindings = [...new Set(successfulEntries.map((entry) => `${entry.backend}/${entry.modelId}`))].join(", ");
    process.stdout.write(`[model-run] passed in ${result.durationMs} ms; roles=${completedRoles.size}; transitions=${result.summary.totalTransitions}; audit=${bindings}\n`);
  } catch (error) {
    failures.push({ caseId: item.id, message: error instanceof Error ? error.message : String(error) });
    process.stderr.write(`[failed] ${item.id}: ${failures.at(-1).message}\n`);
  }
}

if (failures.length) {
  process.stderr.write(`\n${failures.length} case(s) failed real model verification.\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nAll case templates passed real model verification.\n");
}
