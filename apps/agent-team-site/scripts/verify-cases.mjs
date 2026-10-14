import { cases } from "../cases.mjs";
import { lintCase, runCase } from "../run-engine.mjs";

const failures = [];
for (const item of cases) {
  process.stdout.write(`\n[lint] ${item.id}\n`);
  try {
    const lint = await lintCase(item.id);
    if (lint.status && lint.status !== "ok" && lint.status !== "ready") throw new Error(JSON.stringify(lint));
    process.stdout.write("[lint] passed\n");
    process.stdout.write(`[model-run] ${item.id} via ${process.env.OGS_DEMO_BACKEND || "codex"}/${process.env.OGS_DEMO_MODEL || "gpt-6-luna"}\n`);
    const result = await runCase({
      caseId: item.id,
      prompt: process.env.OGS_CASE_PROMPT || "Prepare a concise, evidence-aware collaboration result for a sample task. State assumptions and uncertainty clearly.",
      mode: "model"
    });
    const expectedRoles = new Set(item.roles.map((role) => role.id));
    const completedRoles = new Set(result.auditTrail.filter((entry) => entry.status === "ok").map((entry) => entry.roleId));
    const missing = [...expectedRoles].filter((roleId) => !completedRoles.has(roleId));
    if (result.status !== "done" || missing.length) {
      throw new Error(`Run status ${result.status}; missing successful roles: ${missing.join(", ") || "none"}`);
    }
    process.stdout.write(`[model-run] passed in ${result.durationMs} ms; roles=${completedRoles.size}; transitions=${result.summary.totalTransitions}\n`);
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
