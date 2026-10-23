import { readFile } from "node:fs/promises";
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
      return (await readFile(join(workdir, "system.mmd"), "utf8")) === expected;
    } catch {
      return false;
    }
  }
});
