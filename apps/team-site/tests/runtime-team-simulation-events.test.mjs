import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caseTeamMaterializer } from "../infrastructure/case-team-materializer.mjs";
import { createRuntimeTeamSimulation } from "../infrastructure/runtime-team-simulation.mjs";
import { exportTeamPackage } from "../../../dist/visualizer/project-projection.js";

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
          { type: "join_quorum_reached", roleId: "reviewer", arrivedCount: 2, requiredCount: 2 },
          { type: "flow.activated", fromRoleId: "reviewer", toRoleId: "publisher", eventType: "READY" },
          { type: "result_committed", roleId: "publisher" }
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
