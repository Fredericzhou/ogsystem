import { createHash } from "node:crypto";

export function computeContentDigest(content) {
  return createHash("sha256").update(content).digest("hex");
}

export function teamCorePayload(bundle) {
  const design = bundle?.team?.design;
  return {
    systemSource: bundle?.team?.systemSource || "",
    design: design && typeof design === "object" ? {
      schemaVersion: design.schemaVersion,
      intent: design.intent,
      system: design.system,
      seats: design.seats,
      transitions: design.transitions,
      state: design.state,
      contracts: design.contracts,
      policies: design.policies,
      bindings: design.bindings
    } : null,
    laws: bundle?.team?.laws || null,
    executableFiles: Array.isArray(bundle?.team?.executableFiles)
      ? bundle.team.executableFiles.map(({ path, content }) => ({ path, content }))
      : []
  };
}

export function computeTeamPackageCoreDigest(bundle) {
  return computeContentDigest(JSON.stringify(teamCorePayload(bundle)));
}

export function projectDefinitionPayload(project) {
  return {
    name: String(project.name || ""),
    overview: project.overview,
    mountedTeams: (project.mountedTeams || []).map((team) => ({
      teamName: String(team.teamName || team.name || ""),
      teamVersionNumber: Number(team.teamVersionNumber || 1),
      teamCoreDigest: team.teamCoreDigest || null,
      builtIn: Boolean(team.builtIn)
    })),
    materials: (project.materials?.materials || []).map((item) => ({
      filename: String(item.filename || ""),
      contentType: String(item.contentType || "text/plain"),
      contentHash: item.contentHash || (typeof item.content === "string" ? computeContentDigest(item.content) : null)
    })).sort((left, right) => left.filename.localeCompare(right.filename))
  };
}

export function computeProjectDefinitionDigest(project) {
  return computeContentDigest(JSON.stringify(projectDefinitionPayload(project)));
}

export function packageDigestPayload(bundle) {
  const identityFields = new Set([
    "packageDigest", "generatedAt", "projectId", "teamId", "teamRootId", "teamVersionId",
    "mountedAt", "workspaceKey", "source", "runId", "taskId", "requestFingerprint", "taskRecords", "runs"
  ]);
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !identityFields.has(key))
      .map(([key, child]) => [key, canonicalize(child)]));
  };
  return canonicalize(bundle || {});
}

export function computePackageDigest(bundle) {
  return computeContentDigest(JSON.stringify(packageDigestPayload(bundle)));
}
