import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getCase } from "../cases.mjs";
import { buildCaseSystem, materializeCaseTeam } from "../demo-runner.mjs";

export const caseTeamMaterializer = Object.freeze({
  materialize: materializeCaseTeam,
  async isCurrent(caseId, workdir) {
    const caseSpec = getCase(caseId);
    if (!caseSpec) return false;
    const expected = buildCaseSystem(caseSpec);
    try {
      if ((await readFile(join(workdir, "system.mmd"), "utf8")) !== expected) return false;
      const bindings = JSON.parse(await readFile(join(workdir, ".ogs", "execution-bindings.json"), "utf8"));
      const authoring = JSON.parse(await readFile(join(workdir, ".ogs", "studio", "system.authoring.json"), "utf8"));
      const roleFiles = await Promise.all(caseSpec.roles.map(async (role) => {
        try { return JSON.parse(await readFile(join(workdir, "team-roles", "roles", role.id, "role.json"), "utf8")); }
        catch { return undefined; }
      }));
      const roleEntries = await readdir(join(workdir, "team-roles", "roles"), { withFileTypes: true }).catch(() => []);
      const expectedRoleIds = new Set(caseSpec.roles.map((role) => role.id));
      const legacyAssets = await Promise.all([
        readFile(join(workdir, ".ogs", "model-selection.json"), "utf8").then(() => true).catch(() => false),
        readFile(join(workdir, "profiles.json"), "utf8").then(() => true).catch(() => false),
        readFile(join(workdir, "tools.json"), "utf8").then(() => true).catch(() => false)
      ]);
      return authoring?.ogsContractVersion === 2
        && authoring?.version === 2
        && roleEntries.filter((entry) => entry.isDirectory()).every((entry) => expectedRoleIds.has(entry.name))
        && roleEntries.filter((entry) => entry.isDirectory()).length === expectedRoleIds.size
        && roleFiles.every((manifest) => manifest?.ogsContractVersion === 2 && manifest?.schemaVersion === 2 && !manifest?.contractVersion && !manifest?.outputs?.events)
        && !legacyAssets.some(Boolean)
        && bindings?.ogsContractVersion === 2
        && bindings?.schemaVersion === 1
        && bindings?.harnessTemplates
        && bindings?.roles
        // Built-in cases are regenerated when their execution budget still
        // carries the old 120s default. User-authored Harness templates are
        // never rewritten by this check.
        && Object.values(bindings.harnessTemplates).every((template) => {
          const timeoutMs = Number(template?.environment?.limits?.timeoutMs);
          return Number.isFinite(timeoutMs) && timeoutMs >= 600000;
        })
        && await Promise.all(caseSpec.roles.map(async (role) => {
          try {
            const schema = JSON.parse(await readFile(join(workdir, "team-roles", "roles", role.id, "output.schema.json"), "utf8"));
            const prompt = await readFile(join(workdir, "team-roles", "roles", role.id, "prompt.md"), "utf8");
            const schemaReady = role.id !== "document-publisher" || Object.hasOwn(schema?.properties || {}, "artifacts");
            const promptReady = role.id === "document-publisher"
              ? prompt.includes("write-capable staging")
              : prompt.includes("does not publish files");
            return schemaReady && promptReady;
          } catch {
            return false;
          }
        })).then((values) => values.every(Boolean));
    } catch {
      return false;
    }
  }
});
