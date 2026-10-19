export function assertReleasedTeamVersion(team) {
  if (!team || team.teamProjectId || team.teamVersionStatus !== "released") {
    throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be mounted.");
  }
  assertCanonicalTeamVersionId(team.teamVersionId || team.projectId);
}

export function assertCanonicalTeamVersionId(teamVersionId) {
  const id = String(teamVersionId || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) {
    throw new Error("TEAM_VERSION_ID_INVALID: use a persisted TeamVersion ID.");
  }
}

export function createMountedTeamRecord(team, previous) {
  const teamVersionId = team.teamVersionId || team.projectId;
  assertCanonicalTeamVersionId(teamVersionId);
  assertCanonicalTeamVersionId(team.teamId || team.projectId);
  return {
    teamId: team.teamId || team.projectId,
    teamVersionId,
    teamVersionNumber: team.teamVersionNumber || 1,
    teamName: team.teamName || team.name,
    mountedAt: previous?.mountedAt || new Date().toISOString(),
    status: "available",
    ...(team.teamCoreDigest ? { teamCoreDigest: team.teamCoreDigest } : {}),
    ...(team.builtIn ? { builtIn: true } : {})
  };
}
