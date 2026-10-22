const REPLAY_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "paused", "waiting_review"]);

function publicRunDto(collaborationProjectId, teamVersionId, run) {
  const { projectId: _projectId, ...safe } = run || {};
  const { projectId: _stateProjectId, ...state } = safe.state || {};
  const { projectId: _planProjectId, ...runPlan } = safe.runPlan || {};
  const owner = safe.owner;
  return {
    ...safe,
    runKind: safe.runKind || owner?.kind,
    ...(owner ? { owner, taskId: owner.taskId || null } : {}),
    teamVersionId,
    ...(safe.state ? { state } : {}),
    ...(safe.runPlan ? { runPlan } : {})
  };
}

export function createProjectRunUseCases({ projectStore, teamStore, runStore, readiness, identifiers, evaluateResult, now = () => new Date().toISOString() }) {
  for (const [name, port, operations] of [
    ["Project", projectStore, ["getProject"]],
    ["Run", runStore, ["validateResume", "readLedger", "writeLedger", "acquireProjectWriteLock", "acquireRunLock", "writeResumeControl", "materialInputs", "execute", "rebuildIndex", "readSnapshot", "recordTask"]],
    ["Readiness", readiness, ["requireCurrentConfirmation", "inspect"]],
    ["Identifiers", identifiers, ["createRunId", "fingerprint"]],
    ["Result evaluator", { evaluate: evaluateResult }, ["evaluate"]]
  ]) {
    for (const operation of operations) {
      if (typeof port?.[operation] !== "function") throw new TypeError(`Project Run use cases require ${name} ${operation}.`);
    }
  }

  return Object.freeze({
    async startProjectRun(projectId, {
      prompt,
      mode = "dry-run",
      idempotencyKey,
      materialInputsOverride,
      materialSourceRoot,
      resumeRunId,
      resumeRunDir,
      requestedRunId,
      recordTask = true,
      readinessChecked = false,
      runKind,
      taskId,
      taskNumber,
      attemptNumber,
      teamVersionId,
      materialSnapshotPolicy
    } = {}) {
      if (mode === "real") throw new Error("REAL_RUN_UNSUPPORTED: real project runs are disabled in the first phase.");
      if (mode !== "dry-run" && mode !== "sandbox") throw new Error("Unsupported project run mode.");
      const collaborationProject = await projectStore.getProject(projectId);
      if (runKind !== "project_task" || !taskId || !teamVersionId || typeof teamStore?.getTeamVersion !== "function") {
        throw new Error("PROJECT_RUN_OWNER_INVALID: Run starts require an existing Collaboration Project Task and TeamVersion owner.");
      }
      if (collaborationProject.projectType !== "collaboration") {
        throw new Error("PROJECT_RUN_OWNER_INVALID: Task Runs are owned by Collaboration Projects.");
      }
      const projectTask = (collaborationProject.taskRecords || []).find((item) => item.taskId === taskId && !item.deletedAt);
      const boundRunId = resumeRunId || requestedRunId;
      const taskRunIds = Array.isArray(projectTask?.runIds) ? projectTask.runIds : [];
      const persistedAttemptNumber = boundRunId ? taskRunIds.indexOf(boundRunId) + 1 : 0;
      if (!projectTask || !boundRunId || projectTask.currentRunId !== boundRunId || !taskRunIds.includes(boundRunId)
        || projectTask.teamVersionId !== teamVersionId
        || persistedAttemptNumber <= 0) {
        throw new Error("PROJECT_RUN_OWNER_INVALID: Run identity does not match the existing Collaboration Project Task.");
      }
      if (taskNumber !== projectTask.taskNumber) {
        throw new Error("PROJECT_RUN_OWNER_INVALID: Task number does not match the persisted Task.");
      }
      if (attemptNumber !== persistedAttemptNumber) {
        throw new Error("PROJECT_RUN_OWNER_INVALID: attempt number does not match the persisted Task Run.");
      }
      const assetProject = await teamStore.getTeamVersion(teamVersionId);
      if (!assetProject) throw new Error("TEAM_VERSION_NOT_FOUND: the selected TeamVersion does not exist.");
      const taskOwnedRun = true;
      const teamCoreDigest = assetProject.teamCoreDigest || assetProject.projectDigest;
      const makeExecutionProject = (currentProject) => taskOwnedRun
        ? {
            ...assetProject,
            ...currentProject,
            projectId: currentProject.projectId,
            workdir: currentProject.workdir,
            assetWorkdir: assetProject.workdir,
            trustedClassicTopology: Boolean(assetProject.trustedClassicTopologyDigest)
              || assetProject.source === "classic"
              || assetProject.source === "classic-template",
            projectDigest: assetProject.projectDigest || teamCoreDigest,
            teamVersionId,
            teamCoreDigest,
            teamDigestVersion: assetProject.teamDigestVersion
          }
        : currentProject;
      const initialProject = makeExecutionProject(collaborationProject);
      if (mode === "sandbox") {
        if (!taskOwnedRun) await readiness.requireCurrentConfirmation(initialProject);
        if (!taskOwnedRun && !readinessChecked) {
          const status = await readiness.inspect(initialProject.workdir);
          if (!status.canDryRun) {
            throw new Error(`PROJECT_NOT_READY: resolve ${status.blockers.length} static readiness blocker(s) before Sandbox Run. Inspect project readiness for details.`);
          }
        }
      }

      const requestKey = idempotencyKey ? String(idempotencyKey).slice(0, 160) : undefined;
      let writeLock;
      let writeLockReleased = false;
      let runLock;
      let runId = requestedRunId;
      let requestFingerprint;
      let pendingLedgerEntry;
      try {
        const resume = await runStore.validateResume(initialProject, resumeRunId, resumeRunDir, requestedRunId);
        resumeRunId = resume?.runId;
        const resumeEvidenceDir = resume?.runDir;
        resumeRunDir = resume?.runId;
        const input = String(prompt || resume?.task?.prompt || "").trim();
        if (!input || input.length > 4000) throw new Error("Task must contain 1 to 4,000 characters.");
        requestFingerprint = identifiers.fingerprint({
          collaborationProjectId: projectId,
          taskId: projectTask.taskId,
          runId: boundRunId,
          teamVersionId,
          prompt: input,
          mode,
          materialInputsOverride: materialInputsOverride ?? null,
          resumeRunId: resumeRunId ?? null
        });

        writeLock = await runStore.acquireProjectWriteLock(initialProject, "run-snapshot");
        let project = makeExecutionProject(await projectStore.getProject(projectId));
        if (!resumeRunDir && !taskOwnedRun) await readiness.requireCurrentConfirmation(project);
        const requestLedger = await runStore.readLedger(project);
        if (requestKey && requestLedger[requestKey]) {
          const prior = requestLedger[requestKey];
          if (prior.requestFingerprint !== requestFingerprint) {
            throw new Error("IDEMPOTENCY_KEY_REUSE: idempotency key was already used with a different request.");
          }
          if (prior.status === "running" && prior.runId) {
            const priorSnapshot = await runStore.readSnapshot(project, prior.runId, { allowMissing: true });
            if (priorSnapshot.state && priorSnapshot.plan && REPLAY_TERMINAL_STATUSES.has(priorSnapshot.state.status)) {
              return publicRunDto(projectId, initialProject.teamVersionId || null, {
                runId: prior.runId,
                mode: prior.mode,
                runPlan: priorSnapshot.plan,
                state: priorSnapshot.state,
                quality: evaluateResult({ plan: priorSnapshot.plan, state: priorSnapshot.state }),
                status: priorSnapshot.state.status,
                idempotentReplay: true,
                recovered: true
              });
            }
            if (!priorSnapshot.plan && !priorSnapshot.state) runId = prior.runId;
            else return publicRunDto(projectId, initialProject.teamVersionId || null, { ...(prior.response || prior), idempotentReplay: true });
          } else {
            return publicRunDto(projectId, initialProject.teamVersionId || null, { ...(prior.response || prior), idempotentReplay: true });
          }
        }

        runId ||= resumeRunId || identifiers.createRunId();
        if (requestKey) {
          pendingLedgerEntry = {
            status: "running", projectId, runId, mode, requestFingerprint, prompt: input,
            ...(materialInputsOverride ? { materialInputsOverride } : {}),
            ...(resumeRunId ? { resumeRunId } : {}),
            startedAt: now()
          };
          await runStore.writeLedger(project, { ...requestLedger, [requestKey]: pendingLedgerEntry });
        }

        // Keep the Project lock until the Runtime has created its immutable Run files.
        runLock = await runStore.acquireRunLock(initialProject, runId);
        if (resumeEvidenceDir) await runStore.writeResumeControl(resumeEvidenceDir);
        const materialInputs = runStore.materialInputs(project, materialInputsOverride);
        const result = await runStore.execute(project, {
          prompt: input,
          mode,
          runId,
          runKind: taskOwnedRun ? "project_task" : runKind,
          owner: taskOwnedRun ? {
            kind: "project_task",
            projectId,
            taskId,
            taskNumber,
            attemptNumber,
            teamVersionId,
            teamCoreDigest
          } : undefined,
          resumeRunDir,
          resumeProjectDigest: resume?.plan?.projectDigest,
          materialSnapshotPolicy: materialSnapshotPolicy || resume?.plan?.materialSnapshotPolicy || { kind: "project_current" },
          materialInputs,
          materialSourceRoot,
          onPrepared: async () => {
            if (!resumeRunDir) {
              const latest = makeExecutionProject(await projectStore.getProject(projectId));
              if (!taskOwnedRun) await readiness.requireCurrentConfirmation(latest);
              if (latest.projectDigest !== project.projectDigest) {
                throw new Error("PROJECT_CONFIRMATION_CHANGED: project confirmation changed while preparing the run.");
              }
              project = latest;
            }
            await writeLock.release();
            writeLockReleased = true;
          }
        });
        await runStore.rebuildIndex(project);
        const { plan: runPlan, state } = await runStore.readSnapshot(project, runId);
        const quality = evaluateResult({ plan: runPlan, state });
        const response = publicRunDto(projectId, initialProject.teamVersionId || null, {
          runId, mode, result, runPlan, state, quality, materials: materialInputs,
          runKind: "project_task",
          owner: {
            kind: "project_task",
            projectId,
            taskId: taskOwnedRun ? taskId : null,
            ...(taskOwnedRun ? { taskNumber, attemptNumber } : {}),
            teamVersionId: initialProject.teamVersionId || null,
            teamCoreDigest,
            teamDigestVersion: initialProject.teamDigestVersion
          }
        });
        if (recordTask) {
          await runStore.recordTask(project, {
            taskId: runId,
            runId,
            projectId,
            input,
            status: state.status,
            startedAt: state.startedAt || pendingLedgerEntry?.startedAt || now(),
            completedAt: state.finishedAt || now(),
            roundNumber: ((project.taskRecords || []).length || 0) + 1,
            teamVersionId: project.teamVersionId || project.mountedTeams?.[0]?.teamVersionId || null,
            teamName: project.teamName || project.mountedTeams?.[0]?.teamName || null,
            outputSummary: typeof result?.finalOutput === "string" ? result.finalOutput.slice(0, 500) : ""
          });
        }
        if (requestKey) {
          const ledgerLock = writeLockReleased ? await runStore.acquireProjectWriteLock(initialProject, "run-ledger") : undefined;
          try {
            const currentLedger = await runStore.readLedger(project);
            await runStore.writeLedger(project, { ...currentLedger, [requestKey]: { ...response, status: "completed", requestFingerprint } });
          } finally {
            await ledgerLock?.release();
          }
        }
        return response;
      } catch (error) {
        if (requestKey && requestFingerprint && runId) {
          const ledgerLock = writeLockReleased
            ? await runStore.acquireProjectWriteLock(initialProject, "run-ledger-failure").catch(() => undefined)
            : undefined;
          try {
            const currentLedger = await runStore.readLedger(initialProject);
            await runStore.writeLedger(initialProject, {
              ...currentLedger,
              [requestKey]: {
              ...(pendingLedgerEntry || {}), projectId, runId, mode, status: "failed", requestFingerprint,
                error: error instanceof Error ? error.message : String(error)
              }
            });
          } finally {
            await ledgerLock?.release();
          }
        }
        throw error;
      } finally {
        if (writeLock && !writeLockReleased) await writeLock.release();
        await runLock?.release();
      }
    }
  });
}
