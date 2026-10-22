import { createHash } from "node:crypto";
import { TEAM_CORE_DIGEST_VERSION } from "../domain/team.mjs";
export { TEAM_CORE_DIGEST_VERSION } from "../domain/team.mjs";

export function computeContentDigest(content) {
  return createHash("sha256").update(content).digest("hex");
}

const secretValueKey = /(?:secret|token|password|credential|api[_-]?key)(?!ref$)/i;
const volatileMetadataKeys = new Set(["createdAt", "updatedAt", "modifiedAt", "generatedAt", "probedAt", "refreshedAt"]);

function canonicalTeamValue(value, key = "") {
  if (secretValueKey.test(key)) return undefined;
  if (typeof value === "string") return value.replace(/\r\n?/g, "\n");
  if (Array.isArray(value)) return value.map((item) => canonicalTeamValue(item)).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().flatMap((childKey) => {
    if (volatileMetadataKeys.has(childKey)) return [];
    const child = canonicalTeamValue(value[childKey], childKey);
    return child === undefined ? [] : [[childKey, child]];
  }));
}

const RELEASE_BASELINE_FIELDS = [
  "scenarioId", "name", "revision", "prompt", "materials", "expectedRoleIds",
  "outputSchema", "requiredForRelease"
];

export function releaseBaselinePayload(scenario) {
  return Object.fromEntries(RELEASE_BASELINE_FIELDS
    .filter((key) => scenario?.[key] !== undefined)
    .map((key) => [key, canonicalTeamValue(scenario[key])]));
}

export function computeReleaseBaselineDigest(scenario) {
  return computeContentDigest(JSON.stringify(releaseBaselinePayload(scenario)));
}

function canonicalReleaseBaselines(scenarios) {
  return (Array.isArray(scenarios) ? scenarios : []).map((scenario) => ({
    ...releaseBaselinePayload(scenario),
    scenarioDigest: computeReleaseBaselineDigest(scenario)
  }));
}

function canonicalExecutableFiles(files) {
  return (Array.isArray(files) ? files : []).map((item) => ({
    path: String(item?.path || "").replaceAll("\\", "/"),
    content: typeof item?.content === "string" ? item.content.replace(/\r\n?/g, "\n") : ""
  })).sort((left, right) => left.path.localeCompare(right.path));
}

export function teamCorePayload(bundle) {
  const design = bundle?.team?.design;
  const runtime = bundle?.team?.runtime;
  const { runsDir: _runsDir, sharedDir: _sharedDir, ...runtimeExecution } = runtime && typeof runtime === "object" ? runtime : {};
  return {
    digestVersion: TEAM_CORE_DIGEST_VERSION,
    systemSource: String(bundle?.team?.systemSource || "").replace(/\r\n?/g, "\n"),
    design: design && typeof design === "object" ? canonicalTeamValue({
      schemaVersion: design.schemaVersion,
      intent: design.intent,
      system: design.system,
      seats: design.seats,
      transitions: design.transitions,
      state: design.state,
      contracts: design.contracts,
      policies: design.policies,
      bindings: design.bindings
    }) : null,
    laws: canonicalTeamValue(bundle?.team?.laws || null),
    runtime: canonicalTeamValue(runtimeExecution),
    modelSelection: canonicalTeamValue(bundle?.team?.modelSelection || null),
    teamDefaults: canonicalTeamValue(bundle?.team?.userProfile || null),
    profiles: canonicalTeamValue(bundle?.team?.profiles || []),
    tools: canonicalTeamValue(bundle?.team?.tools || { tools: [] }),
    releaseBaselineScenarios: canonicalReleaseBaselines(bundle?.team?.releaseBaselineScenarios || []),
    executableFiles: canonicalExecutableFiles(bundle?.team?.executableFiles)
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
