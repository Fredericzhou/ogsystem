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
        && bindings?.roles;
    } catch {
      return false;
    }
  }
});
