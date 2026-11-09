import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { redactText } from "../../../dist/runtime/redaction.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath, readSafeEvidenceFile } from "./safe-evidence-path.mjs";
import { projectOgsDir } from "./project-paths.mjs";

function assertSafeId(value, field, pattern) {
  if (!pattern.test(String(value || ""))) throw new Error(`${field} is invalid.`);
}

function redactStructuredValue(value) {
  if (typeof value === "string") return redactText(value, { enabled: true });
  if (Array.isArray(value)) return value.map(redactStructuredValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactStructuredValue(item)]));
  }
  return value;
}

function safeArtifactRelativePath(value, label = "artifact path") {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("//")) throw new Error(`RUN_ARTIFACT_PATH_INVALID: ${label} must be relative.`);
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    throw new Error(`RUN_ARTIFACT_PATH_INVALID: ${label} contains an unsafe segment.`);
  }
  return segments;
}

function verifiedManifestDigest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || typeof manifest.manifestSha256 !== "string") return null;
  const { manifestSha256, ...unsigned } = manifest;
  return createHash("sha256").update(`${JSON.stringify(unsigned, null, 2)}\n`, "utf8").digest("hex") === manifestSha256.toLowerCase()
    ? manifestSha256.toLowerCase()
    : null;
}

export function createFileRunResultStore({ projectsRoot }) {
  if (!projectsRoot) throw new TypeError("Run result store projects root is required.");
  const root = resolve(projectsRoot);

  return Object.freeze({
    async readFinalOutputs(run) {
      const projectId = run.owner?.kind === "project_task" ? run.owner.projectId : undefined;
      assertSafeId(projectId, "projectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
      assertSafeId(run.taskId, "taskId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      assertSafeId(run.runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      const projectRoot = resolve(root, projectId);
      if (!projectRoot.startsWith(`${root}${sep}`)) throw new Error("Run result path is outside the site workspace.");
      await assertSafeEvidencePath(root, [projectId], { kind: "directory", label: "Project" });
      await assertSafeEvidencePath(root, [projectId, ".site"], { kind: "directory", label: "Project metadata" });
      await assertSafeEvidencePath(root, [projectId, ".site", "project.json"], { kind: "file", label: "Project metadata" });
      const metadata = JSON.parse(await readFile(join(projectRoot, ".site", "project.json"), "utf8"));
      const task = (metadata.taskRecords || []).find((item) => item.taskId === run.taskId && !item.deletedAt);
      if (metadata.projectType !== "collaboration" || !task) throw new Error("RUN_NOT_FOUND: run does not belong to this Project Task.");
      const project = { projectId, workdir: projectRoot, ogsDir: projectRoot };
      await readProjectRunOwner(project, task, run.runId);
      const controlRoot = projectOgsDir(project);
      const statePath = join(controlRoot, ".ogs", "runs", run.runId, "state.json");
      let snapshot;
      try {
        await assertSafeEvidencePath(controlRoot, [".ogs", "runs", run.runId, "state.json"], { kind: "file", label: "Run state" });
        snapshot = JSON.parse(await readFile(statePath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
      const graphState = snapshot?.graphState;
      const committedResult = graphState?.resultCommit?.status === "committed";
      if (graphState?.status !== "done" || !committedResult) return undefined;
      const outputMap = graphState?.finalOutputsByRoleId;
      if (!outputMap || typeof outputMap !== "object" || Array.isArray(outputMap)) return undefined;
      const finalOutputsByRoleId = Object.fromEntries(Object.entries(outputMap).map(([roleId, outputs]) => [
        roleId,
        Array.isArray(outputs) ? outputs.map((output) => ({
          ...(typeof output?.content === "string" ? { content: redactStructuredValue(output.content) } : {}),
          ...(output?.data && typeof output.data === "object" && !Array.isArray(output.data)
            ? { data: redactStructuredValue(output.data) }
            : {})
        })) : []
      ]));
      return {
        finalOutputsByRoleId,
        finalOutputRoleOrder: Array.isArray(graphState.finalOutputRoleOrder) ? [...graphState.finalOutputRoleOrder] : []
      };
    },
    async readSealedArtifactBundle(run, { maxTotalBytes = 200 * 1024 * 1024 } = {}) {
      const outputs = await this.readFinalOutputs(run);
      if (!outputs) return undefined;
      const projectId = run.owner?.kind === "project_task" ? run.owner.projectId : undefined;
      assertSafeId(projectId, "projectId", /^[a-z0-9][a-z0-9-]{0,80}$/);
      assertSafeId(run.runId, "runId", /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
      const projectRoot = resolve(root, projectId);
      const controlRoot = projectOgsDir({ workdir: projectRoot, ogsDir: projectRoot });
      const runSegments = [".ogs", "runs", run.runId];
      const manifestSegments = [...runSegments, "shared", "seal-manifest.json"];
      let manifest;
      try {
        manifest = JSON.parse(await readSafeEvidenceFile(controlRoot, manifestSegments, "utf8", "sealed artifact manifest"));
      } catch (error) {
        if (error?.code === "ENOENT") return undefined;
        throw error;
      }
      if (manifest?.status !== "sealed" || !Array.isArray(manifest.files) || !manifest.files.length) {
        throw new Error("RUN_ARTIFACT_SEAL_INVALID: sealed artifact manifest is incomplete.");
      }
      let verifiedManifest;
      try {
        verifiedManifest = JSON.parse(await readSafeEvidenceFile(controlRoot, [...runSegments, "shared", "artifact-manifest.json"], "utf8", "verified artifact manifest"));
      } catch (error) {
        if (error?.code === "ENOENT") throw new Error("RUN_ARTIFACT_MANIFEST_NOT_FOUND: verified artifact manifest is missing.");
        throw error;
      }
      if (verifiedManifestDigest(verifiedManifest) !== String(manifest.manifestSha256 || "").toLowerCase()) {
        throw new Error("RUN_ARTIFACT_MANIFEST_DIGEST_MISMATCH: verified artifact manifest failed integrity verification.");
      }
      const rawArtifact = String(manifest.artifact || "").replace(/^shared\//, "").replace(/\/$/, "");
      const artifactRootSegments = safeArtifactRelativePath(rawArtifact, "seal artifact root");
      const files = [];
      const seenPaths = new Set();
      let totalBytes = 0;
      const expectedFiles = Array.isArray(verifiedManifest.files) ? verifiedManifest.files : [];
      if (!expectedFiles.length || JSON.stringify(manifest.files) !== JSON.stringify(expectedFiles.map(({ path, sha256, mediaType }) => ({ path, sha256, ...(mediaType ? { mediaType } : {}) })))) {
        throw new Error("RUN_ARTIFACT_SEAL_INVALID: seal metadata does not match verified artifact manifest.");
      }
      for (const entry of expectedFiles) {
        if (!entry || typeof entry.path !== "string" || !/^[a-f0-9]{64}$/i.test(String(entry.sha256 || ""))) {
          throw new Error("RUN_ARTIFACT_SEAL_INVALID: sealed artifact file entry is invalid.");
        }
        const fileSegments = safeArtifactRelativePath(entry.path, "sealed artifact file");
        const relativePath = fileSegments.join("/");
        if (seenPaths.has(relativePath)) throw new Error("RUN_ARTIFACT_SEAL_INVALID: sealed artifact contains duplicate file paths.");
        seenPaths.add(relativePath);
        const bytes = await readSafeEvidenceFile(controlRoot, [...runSegments, "shared", ...artifactRootSegments, ...fileSegments], null, "sealed artifact file");
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        const digest = createHash("sha256").update(buffer).digest("hex");
        if (digest !== String(entry.sha256).toLowerCase()) throw new Error(`RUN_ARTIFACT_FILE_DIGEST_MISMATCH: ${entry.path}`);
        totalBytes += buffer.byteLength;
        if (totalBytes > maxTotalBytes) throw new Error(`RUN_ARTIFACT_BYTES_QUOTA_EXCEEDED: ${totalBytes} exceeds ${maxTotalBytes}`);
        files.push({ path: relativePath, content: buffer, encoding: "binary", mediaType: entry.mediaType || "application/octet-stream", sha256: digest });
      }
      return { files, artifact: rawArtifact, manifestSha256: manifest.manifestSha256 };
    }
  });
}
