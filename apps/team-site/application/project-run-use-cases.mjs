const REPLAY_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "paused", "waiting_review"]);

function publicRunDto(collaborationProjectId, runtimeProjectId, teamVersionId, run) {
  const { projectId: _projectId, ...safe } = run || {};
  const { projectId: _stateProjectId, ...state } = safe.state || {};
  const { projectId: _planProjectId, ...runPlan } = safe.runPlan || {};
  return {
    ...safe,
    collaborationProjectId,
    taskId: null,
    teamVersionId,
    runtimeProjectId,
    ...(safe.state ? { state } : {}),
    ...(safe.runPlan ? { runPlan } : {})
  };
}

export function createProjectRunUseCases({ projectStore, runStore, readiness, identifiers, evaluateResult, now = () => new Date().toISOString() }) {
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
      readinessChecked = false
    } = {}) {
      if (mode === "real") throw new Error("REAL_RUN_UNSUPPORTED: real project runs are disabled in the first phase.");
      if (mode !== "dry-run" && mode !== "sandbox") throw new Error("Unsupported project run mode.");
      const initialProject = await projectStore.getProject(projectId);
      if (mode === "sandbox") {
        await readiness.requireCurrentConfirmation(initialProject);
        if (!readinessChecked) {
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
        resumeRunDir = resume?.runDir;
        const input = String(prompt || resume?.task?.prompt || "").trim();
        if (!input || input.length > 4000) throw new Error("Task must contain 1 to 4,000 characters.");
        requestFingerprint = identifiers.fingerprint({
              collaborationProjectId: null,
              taskId: null,
              runtimeProjectId: projectId,
              teamVersionId: initialProject.teamVersionId || null,
          prompt: input,
          mode,
          materialInputsOverride: materialInputsOverride ?? null,
          resumeRunId: resumeRunId ?? null
        });

        writeLock = await runStore.acquireProjectWriteLock(initialProject, "run-snapshot");
        let project = await projectStore.getProject(projectId);
        if (!resumeRunDir) await readiness.requireCurrentConfirmation(project);
        const requestLedger = await runStore.readLedger(project);
        if (requestKey && requestLedger[requestKey]) {
          const prior = requestLedger[requestKey];
          if (prior.requestFingerprint !== requestFingerprint) {
            throw new Error("IDEMPOTENCY_KEY_REUSE: idempotency key was already used with a different request.");
          }
          if (prior.status === "running" && prior.runId) {
            const priorSnapshot = await runStore.readSnapshot(project, prior.runId, { allowMissing: true });
            if (priorSnapshot.state && priorSnapshot.plan && REPLAY_TERMINAL_STATUSES.has(priorSnapshot.state.status)) {
              return publicRunDto(null, projectId, initialProject.teamVersionId || null, {
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
            else return publicRunDto(null, projectId, initialProject.teamVersionId || null, { ...(prior.response || prior), idempotentReplay: true });
          } else {
            return publicRunDto(null, projectId, initialProject.teamVersionId || null, { ...(prior.response || prior), idempotentReplay: true });
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
        if (resumeRunDir) await runStore.writeResumeControl(resumeRunDir);
        const materialInputs = runStore.materialInputs(project, materialInputsOverride);
        const result = await runStore.execute(project, {
          prompt: input,
          mode,
          runId,
          resumeRunDir,
          resumeProjectDigest: resume?.plan?.projectDigest,
          materialInputs,
          materialSourceRoot,
          onPrepared: async () => {
            if (!resumeRunDir) {
              const latest = await projectStore.getProject(projectId);
              await readiness.requireCurrentConfirmation(latest);
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
        const response = publicRunDto(null, projectId, initialProject.teamVersionId || null, {
          runId, mode, result, runPlan, state, quality, materials: materialInputs
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
              ...(pendingLedgerEntry || {}), runtimeProjectId: projectId, runId, mode, status: "failed", requestFingerprint,
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
