import { join, resolve, sep } from "node:path";
import { assertSafeEvidencePath, readSafeEvidenceFile } from "./safe-evidence-path.mjs";

const validProjectId = (value) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(String(value || ""));
const validTaskId = (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(String(value || ""));
const validRunId = validTaskId;

export function resolveProjectRunDirectory(project, runId) {
  if (!validProjectId(project?.projectId)) throw new Error("RUN_NOT_FOUND: project does not exist.");
  if (!validRunId(runId)) throw new Error("runId is invalid.");
  const projectRoot = resolve(project.workdir);
  const allowedRunsDir = resolve(projectRoot, ".ogs", "runs");
  const runDir = resolve(allowedRunsDir, runId);
  if (!allowedRunsDir.startsWith(`${projectRoot}${sep}`) || !runDir.startsWith(`${allowedRunsDir}${sep}`)) {
    throw new Error("RUN_NOT_FOUND: run does not belong to this project.");
  }
  return runDir;
}

export async function readProjectRunOwnerFile(project, runId) {
  const runDir = resolveProjectRunDirectory(project, runId);
  const projectRoot = resolve(project.workdir);
  try {
    await assertSafeEvidencePath(projectRoot, [".ogs", "runs", runId], { kind: "directory", label: "Run evidence" });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("RUN_NOT_FOUND: run evidence does not exist.");
    throw error;
  }
  const ownerPath = join(runDir, "run-owner.json");
  try {
    await assertSafeEvidencePath(projectRoot, [".ogs", "runs", runId, "run-owner.json"], { kind: "file", label: "Run owner" });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("RUN_NOT_FOUND: run owner does not match this Project Task.");
    throw error;
  }
  const owner = JSON.parse(await readSafeEvidenceFile(projectRoot, [".ogs", "runs", runId, "run-owner.json"], "utf8", "Run owner"));
  if (owner?.version !== 1 || owner.runKind !== "project_task" || owner.projectId !== project.projectId || owner.runId !== runId) {
    throw new Error("RUN_NOT_FOUND: run owner does not match this Project.");
  }
  return owner;
}

export async function readProjectRunOwner(project, task, runId) {
  const owner = await readProjectRunOwnerFile(project, runId);
  const taskRuns = Array.isArray(task?.runIds) ? task.runIds : task?.currentRunId ? [task.currentRunId] : [];
  const attemptNumber = taskRuns.indexOf(runId) + 1;
  if (owner.taskId !== task.taskId || !taskRuns.includes(runId)
    || owner.teamVersionId !== task.teamVersionId
    || owner.taskNumber !== task.taskNumber
    || owner.attemptNumber !== attemptNumber
    || (task.teamCoreDigest && owner.teamCoreDigest !== task.teamCoreDigest)
    || (Number.isInteger(task.teamDigestVersion) && owner.teamDigestVersion !== task.teamDigestVersion)) {
    throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
  }
  return owner;
}

export function projectRunOwnerPath(project, runId) {
  return join(resolveProjectRunDirectory(project, runId), "run-owner.json");
}
