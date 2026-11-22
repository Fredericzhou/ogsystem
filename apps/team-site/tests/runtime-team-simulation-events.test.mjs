import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseTeamMaterializer } from "../infrastructure/case-team-materializer.mjs";
import { createRuntimeTeamSimulation } from "../infrastructure/runtime-team-simulation.mjs";
import { isRuntimeBusinessEvent } from "../infrastructure/runtime-business-event-types.mjs";
import { exportTeamPackage } from "../../../dist/visualizer/project-projection.js";

test("business event classifier accepts canonical eventType envelopes", () => {
  assert.equal(isRuntimeBusinessEvent({ eventType: "workspace_integrated" }), true);
  assert.equal(isRuntimeBusinessEvent({ eventType: "READY", type: "workspace_integrated" }), true);
});

test("Team simulations forward Runtime business decisions and suppress model notifications", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-business-events-"));
  try {
    const teamWorkdir = join(root, "team");
    await caseTeamMaterializer.materialize("software-team", teamWorkdir);
    const bundle = await exportTeamPackage(teamWorkdir);
    const observed = [];
    const runner = createRuntimeTeamSimulation({
      run: async ({ runtimeServicesFactory }) => {
        const runDir = join(root, "runtime-run");
        const services = runtimeServicesFactory({
          runContext: {
            runId: "runtime-run",
            runDir,
            controlDir: join(runDir, "control"),
            checkpointsDir: join(runDir, "checkpoints"),
            eventsPath: join(runDir, "events.jsonl"),
            engineLogPath: join(runDir, "engine.ndjson"),
            roleLogsDir: join(runDir, "roles"),
            redaction: { enabled: false }
          },
          initialState: { stateVersion: 0, lastCheckpointSequence: 0 },
          plan: { irDigest: "ir", planFingerprint: "plan" }
        });
        for (const event of [
          { type: "agent_event", event: { type: "tool.started", name: "exec_command" } },
          { type: "route_decision", roleId: "dispatcher", selectedEvent: "READY", decisionContext: "输入包含完整交付要求" },
          { type: "join_quorum_reached", joinId: "join-review", roleId: "reviewer", lineageId: "review-lineage", loopIteration: 0, joinMode: "all", joinSources: ["writer", "analyst"], requiredSourceCount: 2, satisfiedSources: ["writer", "analyst"], arrivedFromRoleId: "analyst", arrivedFromBranchId: "analyst:1", activatedBranchId: "reviewer:1" },
          { type: "flow.activated", fromRoleId: "reviewer", toRoleId: "publisher", eventType: "READY" },
          { type: "result_committed", runId: "runtime-run", roleId: "publisher", resultId: "result-publisher", stateVersion: 1 }
        ]) await services.audit.append(event);
        return { status: "done", auditTrail: [], finalOutputsByRoleId: {}, finalOutputRoleOrder: [] };
      }
    });
    await runner.simulate({ workdir: teamWorkdir, source: "classic-template", teamVersionId: "software-team" }, {
      prompt: "Verify business events.",
      teamPackageBundle: bundle,
      onRuntimeEvent: async (event) => observed.push(event)
    });

    assert.deepEqual(observed.map((event) => event.type), [
      "route_decision", "join_quorum_reached", "flow.activated", "result_committed"
    ]);
    assert.equal(observed[0].decisionContext, "输入包含完整交付要求");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Studio simulations persist an isolated Git + LFS Workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-simulation-workspace-"));
  try {
    const teamWorkdir = join(root, "team");
    const evidenceDir = join(root, "simulation", "run");
    await caseTeamMaterializer.materialize("software-team", teamWorkdir);
    const bundle = await exportTeamPackage(teamWorkdir);
    let receivedGitCollaboration;
    const runner = createRuntimeTeamSimulation({
      run: async (args) => {
        receivedGitCollaboration = args.gitCollaboration;
        return { status: "done", auditTrail: [], finalOutputsByRoleId: {}, finalOutputRoleOrder: [] };
      }
    });

    const result = await runner.simulate({ workdir: teamWorkdir, source: "classic-template", teamVersionId: "software-team" }, {
      prompt: "Persist the simulation workspace.",
      teamPackageBundle: bundle,
      runEvidenceDirectory: evidenceDir
    });

    const workspaceDir = join(root, "simulation", "workspace");
    await access(join(workspaceDir, ".git", "HEAD"));
    await access(join(workspaceDir, ".gitattributes"));
    assert.equal(result.workspaceBackend, "git-lfs");
    assert.match(result.workspaceId, /^workspace-[a-f0-9]{24}$/);
    assert.match(result.workspaceCommit, /^[a-f0-9]{40}$/);
    assert.equal(receivedGitCollaboration.baseCommit, result.workspaceCommit);
    assert.equal(typeof receivedGitCollaboration.collaboration.probe, "function");
    const manifest = JSON.parse(await readFile(join(evidenceDir, "evidence-manifest.json"), "utf8"));
    assert.match(manifest.manifestId, /^simulation-[a-f0-9-]+:evidence$/);
    assert.equal(manifest.ogsContractVersion, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
