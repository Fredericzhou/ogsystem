import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function omitV2Snapshot(record) {
  const { teamIrSemanticDigest, compiledPlanDigest, compilerSemanticsVersion, ...legacy } = record;
  return legacy;
}

export async function convertTaskFixtureToLegacySnapshot({ project, team, task }) {
  const projectPath = join(project.workdir, ".site", "project.json");
  const teamPath = join(team.workdir, ".site", "project.json");
  const teamVersionPath = join(team.workdir, ".site", "team-version.json");
  const [projectMetadata, teamMetadata, teamVersion] = await Promise.all([
    readJson(projectPath), readJson(teamPath), readJson(teamVersionPath)
  ]);
  projectMetadata.taskRecords = projectMetadata.taskRecords.map((record) => record.taskId === task.taskId ? omitV2Snapshot(record) : record);
  projectMetadata.mountedTeams = projectMetadata.mountedTeams.map((record) => record.teamVersionId === team.teamVersionId ? omitV2Snapshot(record) : record);
  await Promise.all([
    writeJson(projectPath, projectMetadata),
    writeJson(teamPath, omitV2Snapshot(teamMetadata)),
    writeJson(teamVersionPath, omitV2Snapshot(teamVersion))
  ]);
}
