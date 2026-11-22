import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digestRecord } from "../../../dist/runtime/workspace-contracts.js";
import { createFileStudioSimulationStore } from "../infrastructure/file-studio-simulation-store.mjs";

test("Studio Simulation artifact reads expose a Simulation-owned Evidence manifest and verify its references", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-simulation-manifest-"));
  const store = createFileStudioSimulationStore({ projectsRoot });
  const teamVersionId = "team-1";
  const simulationId = "sim-1";
  const runId = `simulation-${simulationId}`;
  try {
    await store.createSimulation(teamVersionId, "manifest test", {
      simulationId,
      teamId: teamVersionId,
      teamCoreDigest: "a".repeat(64)
    });
    const runDirectory = store.getSimulationRunDirectory(teamVersionId, simulationId);
    await mkdir(join(runDirectory, "checkpoints"), { recursive: true });
    const events = ["event-1", "event#1", "event%1"].map((eventId) => ({ eventId, runId }));
    await writeFile(join(runDirectory, "events.ndjson"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
    await writeFile(join(runDirectory, "checkpoints", "checkpoint-1.json"), "{}\n");
    const manifestBase = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      manifestId: `${runId}:evidence`,
      runId,
      eventRefs: ["event-1", "event#1", "event%1"].map((eventId) => `events.ndjson#${encodeURIComponent(eventId)}`),
      checkpointRefs: ["checkpoints/checkpoint-1.json"],
      provenanceRefs: [],
      reviewRefs: []
    };
    await writeFile(join(runDirectory, "evidence-manifest.json"), JSON.stringify({ ...manifestBase, digest: digestRecord(manifestBase) }));

    const listing = await store.listSimulationArtifacts(teamVersionId, simulationId);
    assert.ok(listing.entries.some((entry) => entry.path === "evidence-manifest.json"));
    const artifact = await store.readSimulationArtifact(teamVersionId, simulationId, "evidence-manifest.json");
    assert.deepEqual(JSON.parse(artifact.content), { ...manifestBase, digest: digestRecord(manifestBase) });

    const missingRefBase = { ...manifestBase, eventRefs: ["events.ndjson#missing"] };
    await writeFile(join(runDirectory, "evidence-manifest.json"), JSON.stringify({ ...missingRefBase, digest: digestRecord(missingRefBase) }));
    await assert.rejects(() => store.readSimulationArtifact(teamVersionId, simulationId, "evidence-manifest.json"), /REFERENCE_NOT_FOUND/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});

test("Studio Simulation reads only provenance-owned files from a verified Workspace Materialization", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-simulation-materialization-"));
  const store = createFileStudioSimulationStore({ projectsRoot });
  const teamVersionId = "team-1";
  const simulationId = "sim-1";
  const runId = `simulation-${simulationId}`;
  const releaseId = `release-${runId}`;
  const content = Buffer.from("# Collaboration output\n", "utf8");
  const contentDigest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
  const releaseCommit = "a".repeat(40);
  try {
    await store.createSimulation(teamVersionId, "materialization test", {
      simulationId,
      teamId: teamVersionId,
      teamCoreDigest: "a".repeat(64)
    });
    const runDirectory = store.getSimulationRunDirectory(teamVersionId, simulationId);
    const outputDirectory = join(runDirectory, "release-store", "materializations", releaseId, "output");
    await mkdir(outputDirectory, { recursive: true });
    await mkdir(join(runDirectory, "release-store", "releases"), { recursive: true });
    await mkdir(join(runDirectory, "provenance"), { recursive: true });
    await writeFile(join(runDirectory, "events.ndjson"), "");
    await writeFile(join(outputDirectory, "executive-brief.md"), content);
    await writeFile(join(runDirectory, "provenance", "publisher.json"), JSON.stringify({
      runId,
      kind: "role-commit",
      roleId: "document-publisher",
      changedPaths: ["executive-brief.md", ".ogs/runtime.json"]
    }));
    const manifestBase = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      manifestId: `${releaseId}:materialization`,
      releaseId,
      releaseCommit,
      files: [
        { path: "executive-brief.md", digest: contentDigest, sizeBytes: content.length },
        { path: ".ogs/runtime.json", digest: `sha256:${"b".repeat(64)}`, sizeBytes: 10 }
      ]
    };
    const materializationManifest = { ...manifestBase, digest: digestRecord(manifestBase) };
    await mkdir(join(outputDirectory, ".ogs"), { recursive: true });
    await writeFile(join(outputDirectory, ".ogs", "runtime.json"), "not exposed");
    await writeFile(join(runDirectory, "release-store", "materializations", releaseId, "manifest.json"), JSON.stringify(materializationManifest));
    const release = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      releaseId,
      runId,
      workspaceId: "workspace-sim-1",
      releaseCommit,
      expectedCanonicalHead: "c".repeat(40),
      status: "published",
      failureCode: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:01.000Z",
      materializationManifestRef: `materializations/${releaseId}/manifest.json`,
      materializationManifestDigest: materializationManifest.digest,
      outputDigest: digestRecord(materializationManifest.files),
      downloadReference: `simulation://${teamVersionId}/${simulationId}/output`
    };
    await writeFile(join(runDirectory, "release-store", "releases", `${releaseId}.json`), JSON.stringify(release));
    const evidenceBase = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      manifestId: `${runId}:evidence`,
      runId,
      eventRefs: [],
      checkpointRefs: [],
      provenanceRefs: ["provenance/publisher.json"],
      reviewRefs: []
    };
    await writeFile(join(runDirectory, "evidence-manifest.json"), JSON.stringify({ ...evidenceBase, digest: digestRecord(evidenceBase) }));

    const files = await store.listSimulationMaterializationFiles(teamVersionId, simulationId);
    assert.deepEqual(files.map((file) => file.path), ["output/executive-brief.md"]);
    const output = await store.readSimulationSealedFile(teamVersionId, simulationId, "output/executive-brief.md");
    assert.equal(output.content, content.toString("utf8"));
    await assert.rejects(() => store.readSimulationSealedFile(teamVersionId, simulationId, "output/.ogs/runtime.json"), /SEALED_FILE_NOT_FOUND/);

    await writeFile(join(outputDirectory, "executive-brief.md"), "# Tampered output\n");
    await assert.rejects(() => store.readSimulationSealedFile(teamVersionId, simulationId, "output/executive-brief.md"), /SEALED_FILE_DIGEST_MISMATCH/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
