import { cases } from "../cases.mjs";
import { lintCase, resolveCaseRoleModel, runCase } from "../demo-runner.mjs";

const failures = [];
const verificationTimeoutMs = Number(process.env.OGS_CASE_TIMEOUT_MS || 600000);
if (!Number.isFinite(verificationTimeoutMs) || verificationTimeoutMs <= 0) {
  throw new Error("OGS_CASE_TIMEOUT_MS must be a positive number.");
}
for (const item of cases) {
  process.stdout.write(`\n[lint] ${item.id}\n`);
  try {
    const lint = await lintCase(item.id);
    if (lint.status && lint.status !== "ok" && lint.status !== "ready") throw new Error(JSON.stringify(lint));
    process.stdout.write("[lint] passed\n");
    const expectedBindings = [...new Set(item.roles.map((role) => role.execution
      ? `profile:${role.execution.profileId}`
      : (() => {
          const model = resolveCaseRoleModel(item, role);
          return `${model.backend}/${model.modelId}`;
        })()))].join(", ");
    process.stdout.write(`[model-run] ${item.id} via ${expectedBindings}\n`);
    const result = await runCase({
      caseId: item.id,
      prompt: process.env.OGS_CASE_PROMPT || "Prepare a concise, evidence-aware collaboration result for a sample task. State assumptions and uncertainty clearly.",
      mode: "model",
      timeoutMs: verificationTimeoutMs
    });
    const expectedRoles = new Set(item.roles.map((role) => role.id));
    const successfulEntries = result.auditTrail.filter((entry) => entry.status === "ok");
    const completedRoles = new Set(successfulEntries.map((entry) => entry.roleId));
    const missing = [...expectedRoles].filter((roleId) => !completedRoles.has(roleId));
    const expectedBindingByRole = new Map(item.roles.map((role) => [role.id, role.execution
      ? { kind: "profile", profileId: role.execution.profileId, toolRef: role.execution.toolRef }
      : { kind: "model", ...resolveCaseRoleModel(item, role) }]));
    const wrongBindings = successfulEntries.filter((entry) => {
      const expected = expectedBindingByRole.get(entry.roleId);
      if (!expected) return true;
      if (expected.kind === "profile") {
        return entry.profileId !== expected.profileId || entry.toolRef !== expected.toolRef;
      }
      return entry.backend !== expected.backend || entry.modelId !== expected.modelId;
    });
    if (result.status !== "done" || missing.length || wrongBindings.length) {
      const actual = [...new Set(successfulEntries.map((entry) => entry.profileId
        ? `profile:${entry.profileId}`
        : `${entry.backend || "unknown"}/${entry.modelId || "unknown"}`))].join(", ");
      const failures = result.auditTrail.filter((entry) => entry.failure).map((entry) => `${entry.roleId}: ${entry.failure}`).join(" | ");
      const runError = result.errorEnvelope?.errorCode
        ? `[${result.errorEnvelope.errorCode}] ${result.error}`
        : result.error;
      throw new Error(`Run status ${result.status}; missing successful roles: ${missing.join(", ") || "none"}; backend/model mismatches: ${wrongBindings.length}; actual=${actual || "no successful audit entries"}${runError ? `; run-error=${runError}` : ""}${failures ? `; role-errors=${failures}` : ""}`);
    }
    if (item.roles.some((role) => role.id === "document-publisher")) {
      const evidence = result.artifactEvidence;
      const manifest = evidence?.manifest;
      const seal = evidence?.seal;
      const verification = evidence?.verification;
      const declaredFiles = Array.isArray(manifest?.files) ? manifest.files : [];
      const deliveredFiles = Array.isArray(evidence?.files) ? evidence.files : [];
      const requiredPaths = item.id === "structured-debate"
        ? ["debate-brief.md"]
        : item.id === "management-consulting"
          ? ["executive-brief.md"]
          : [];
      if (
        manifest?.status !== "verified" ||
        manifest.producerRoleId !== "document-publisher" ||
        typeof manifest.manifestSha256 !== "string" ||
        declaredFiles.length === 0 ||
        seal?.status !== "sealed" ||
        seal.manifestSha256 !== manifest.manifestSha256 ||
        verification?.status !== "verified" ||
        verification?.passed !== true ||
        !declaredFiles.every((entry) => typeof entry?.path === "string" && deliveredFiles.includes(entry.path)) ||
        !requiredPaths.every((requiredPath) => declaredFiles.some((entry) => entry?.path === requiredPath) && deliveredFiles.includes(requiredPath)) ||
        !evidence?.artifactRef?.artifactId
      ) {
        throw new Error("Artifact delivery evidence is incomplete: expected declarations, generated files, verified manifest, sealed manifest, and a deliverable artifact reference.");
      }
      process.stdout.write(`[artifacts] passed; files=${declaredFiles.length}; manifest=${manifest.manifestSha256}\n`);
    }
    const bindings = [...new Set(successfulEntries.map((entry) => entry.profileId
      ? `profile:${entry.profileId}`
      : `${entry.backend}/${entry.modelId}`))].join(", ");
    const artifactSummary = result.artifactEvidence?.manifest
      ? `; artifacts=${Array.isArray(result.artifactEvidence.manifest.files) ? result.artifactEvidence.manifest.files.length : 0}; manifest=${result.artifactEvidence.manifest.manifestSha256 || "unknown"}`
      : "";
    process.stdout.write(`[model-run] passed; run=${result.runId || "unknown"}; duration=${result.durationMs} ms; roles=${completedRoles.size}; transitions=${result.summary.totalTransitions}; audit=${bindings}${artifactSummary}\n`);
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
