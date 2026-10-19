export function createTaskExecutionUseCases({
  projectStore,
  teamStore,
  attemptStore,
  workerStore,
  runStore,
  runtime,
  readiness,
  identifiers,
  now = () => new Date().toISOString()
}) {
  for (const [name, port, operations] of [
    ["Project", projectStore, ["getProject"]],
    ["TeamVersion", teamStore, ["getTeamVersion"]],
    ["Task attempt", attemptStore, ["reserveAttempt", "completeAttempt", "failAttempt"]],
    ["Task worker", workerStore, ["get", "set", "delete", "wait"]],
    ["Run", runStore, ["execute"]],
    ["Readiness", readiness, ["inspect", "requireCurrentConfirmation"]],
    ["Task identifiers", identifiers, ["createRunId", "fingerprint"]]
  ]) {
    for (const operation of operations) {
      if (typeof port?.[operation] !== "function") throw new TypeError(`Task execution use cases require ${name} ${operation}.`);
    }
  }

  function findTask(project, taskId) {
    const task = (project.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
    if (!task) throw new Error("TASK_NOT_FOUND: task does not exist.");
    return task;
  }

  return Object.freeze({
    async startProjectTask(projectId, taskId, { mode = "dry-run", retrySourceRunId, retryInputs, retrySourceRoot, idempotencyKey } = {}) {
      if (!["dry-run", "sandbox"].includes(mode)) throw new Error("TASK_MODE_INVALID: unsupported task mode.");
      const workerKey = `${projectId}:${taskId}`;
      if (retrySourceRunId) await workerStore.wait(workerKey);

      let project = await projectStore.getProject(projectId);
      let task = findTask(project, taskId);
      const attemptKey = String(idempotencyKey || "").trim().slice(0, 160) || identifiers.createRunId(now());
      const attemptFingerprint = identifiers.fingerprint({ taskId, teamVersionId: task.teamVersionId, mode, retrySourceRunId: retrySourceRunId || null });
      const priorAttempt = task.attemptRequests?.[attemptKey];
      if (priorAttempt) {
        if (priorAttempt.requestFingerprint !== attemptFingerprint) throw new Error("IDEMPOTENCY_KEY_REUSE: attempt key was already used with a different request.");
        return { task, idempotentReplay: true };
      }
      if (!(retrySourceRunId ? ["queued", "failed"].includes(task.status) : task.status === "queued")) {
        if (task.currentRunId && task.currentRunId !== retrySourceRunId) return { task, idempotentReplay: true };
        throw new Error(`TASK_START_NOT_ALLOWED: task status is ${task.status}.`);
      }
      if (task.currentRunId && task.currentRunId !== retrySourceRunId) return { task, idempotentReplay: true };
      const team = await teamStore.getTeamVersion(task.teamVersionId);
      if (!team || (team.teamVersionId && team.teamVersionId !== task.teamVersionId)
        || !["released", "archived"].includes(team.teamVersionStatus)) {
        throw new Error("TASK_EXECUTION_UNAVAILABLE: the Task's selected TeamVersion is unavailable for execution.");
      }
      const runtimeProjectId = team.teamVersionId || team.projectId;
      const runProject = team;
      if (mode === "sandbox") {
        const status = await readiness.inspect(runProject.workdir);
        if (!status.canDryRun) throw new Error(`PROJECT_NOT_READY: resolve ${status.blockers.length} static readiness blocker(s) before Sandbox Run. Inspect project readiness for details.`);
        await readiness.requireCurrentConfirmation(runProject);
      }

      const materials = retryInputs || (project.materials?.materials || []).map((item) => ({
        materialId: item.materialId,
        sourcePath: identifiers.resolveProjectMaterial(project.workdir, item.path),
        contentType: item.contentType
      }));
      const reservedRunId = identifiers.createRunId(now());
      const reserved = await attemptStore.reserveAttempt({
        projectId, taskId, retrySourceRunId, attemptKey, attemptFingerprint,
        runId: reservedRunId, mode, startedAt: task.startedAt || now(), runProjectId: runtimeProjectId,
        runWorkdir: runProject.workdir
      });
      project = reserved.project;
      task = reserved.task;
      if (task.currentRunId !== reservedRunId) return task;

      const worker = (async () => {
        try {
          const result = await runStore.execute(runtimeProjectId, {
            prompt: task.input,
            mode,
            requestedRunId: reservedRunId,
            readinessChecked: mode === "sandbox",
            idempotencyKey: `task:${projectId}:${taskId}:${attemptKey}`,
            materialInputsOverride: materials,
            materialSourceRoot: retrySourceRoot || (retrySourceRunId
              ? identifiers.resolveRunRoot(await teamStore.getTeamVersion(task.teamVersionId), retrySourceRunId)
              : project.workdir),
            recordTask: false
          });
          await attemptStore.completeAttempt({ projectId, taskId, runId: reservedRunId, startedAt: task.startedAt || result.state?.startedAt || now(), result, now: now() });
        } catch (error) {
          await attemptStore.failAttempt({ projectId, taskId, runProject, runId: reservedRunId, error, now: now() }).catch(() => undefined);
        } finally {
          workerStore.delete(workerKey);
        }
      })();
      workerStore.set(workerKey, worker);
      void worker.catch(() => undefined);
      return task;
    }
  });
}
