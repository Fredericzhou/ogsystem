export function assertReleasedTeamVersion(team) {
  if (!team || team.teamProjectId || team.teamVersionStatus !== "released") {
    throw new Error("TEAM_VERSION_NOT_RELEASED: only a released team version can be mounted.");
  }
}

export function createMountedTeamRecord(team, previous) {
  return {
    teamId: team.teamId || team.projectId,
    teamVersionId: team.teamVersionId || team.projectId,
    teamVersionNumber: team.teamVersionNumber || 1,
    teamName: team.teamName || team.name,
    mountedAt: previous?.mountedAt || new Date().toISOString(),
    status: "available",
    ...(team.teamCoreDigest ? { teamCoreDigest: team.teamCoreDigest } : {}),
    ...(team.builtIn ? { builtIn: true } : {})
  };
}
