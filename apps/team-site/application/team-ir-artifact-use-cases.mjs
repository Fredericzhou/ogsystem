import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

const MAX_UPLOAD_BYTES = 512 * 1024;

function assertCollaboratingTeam(project, teamVersionId) {
  if (project?.projectType !== "collaboration") throw new Error("PROJECT_NOT_FOUND: Artifact inputs require a collaboration Project.");
  const mounted = (project.mountedTeams || []).find((item) => item.teamVersionId === teamVersionId);
  if (!mounted) throw new Error("TEAM_VERSION_NOT_MOUNTED: Artifact input TeamVersion is not mounted in this Project.");
  return mounted;
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(MAX_UPLOAD_BYTES / 3) * 4
    || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("ARTIFACT_CONTENT_INVALID: upload must be canonical base64 no larger than 512 KiB.");
  }
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES || bytes.toString("base64") !== value) {
    throw new Error("ARTIFACT_CONTENT_INVALID: upload must be canonical base64 no larger than 512 KiB.");
  }
  return bytes;
}

export function createTeamIrArtifactUseCases({ getProject, getTeamVersion, teamIrStore, artifactStoreFactory }) {
  if (typeof getProject !== "function" || typeof getTeamVersion !== "function"
    || typeof teamIrStore?.read !== "function" || typeof artifactStoreFactory !== "function") {
    throw new TypeError("Team IR Artifact use cases require Project, TeamVersion, and Team IR readers.");
  }

  async function resolveTeam(project, teamVersionId) {
    const mounted = assertCollaboratingTeam(project, teamVersionId);
    const team = await getTeamVersion(teamVersionId);
    if (!team || !["released", "archived"].includes(team.teamVersionStatus)
      || team.teamIrSemanticDigest !== mounted.teamIrSemanticDigest
      || team.compiledPlanDigest !== mounted.compiledPlanDigest) {
      throw new Error("TEAM_IR_SNAPSHOT_MISMATCH: Artifact upload requires the mounted frozen TeamVersion.");
    }
    const stored = await teamIrStore.read({ workdir: team.workdir });
    if (!stored.teamIR || stored.semanticDigest !== team.teamIrSemanticDigest
      || teamIRSemanticDigest(stored.teamIR) !== team.teamIrSemanticDigest) {
      throw new Error("TEAM_IR_SNAPSHOT_MISMATCH: Team IR changed after Project mount.");
    }
    return { team, teamIR: stored.teamIR };
  }

  async function artifactStore(project) {
    return artifactStoreFactory({ project });
  }

  return Object.freeze({
    async listProjectRunInputArtifactSlots(projectId, teamVersionId) {
      const project = await getProject(projectId);
      const { team, teamIR } = await resolveTeam(project, teamVersionId);
      const slots = teamIR.runInput.artifactSlots || {};
      return {
        projectId,
        teamVersionId: team.teamVersionId,
        slots: Object.entries(slots).map(([slotId, spec]) => ({ slotId, ...spec }))
      };
    },

    async registerProjectRunInputArtifact(projectId, input = {}, principal) {
      if (!principal || typeof principal.id !== "string" || !principal.id.trim()) {
        throw new Error("ARTIFACT_PRINCIPAL_UNAVAILABLE: a local Project operator identity is required.");
      }
      const project = await getProject(projectId);
      const { team, teamIR } = await resolveTeam(project, input.teamVersionId);
      const content = decodeBase64(input.contentBase64);
      const store = await artifactStore(project);
      return {
        projectId,
        teamVersionId: team.teamVersionId,
        slotId: input.slotId,
        ...(await store.registerRunInput({
          team: teamIR,
          projectId,
          slotId: input.slotId,
          mediaType: input.mediaType,
          content,
          authorizeUpload: async () => Boolean(principal.id)
        }))
      };
    },

    async validateRunInputAttachments({ project, team: mountedTeam, attachments = {} }) {
      const { team, teamIR } = await resolveTeam(project, mountedTeam.teamVersionId);
      if (team.teamIrSemanticDigest !== mountedTeam.teamIrSemanticDigest
        || team.compiledPlanDigest !== mountedTeam.compiledPlanDigest) {
        throw new Error("TEAM_IR_SNAPSHOT_MISMATCH: Task Artifact references must target the mounted frozen TeamVersion.");
      }
      const store = await artifactStore(project);
      return store.validateRunInputAttachments({ team: teamIR, projectId: project.projectId, attachments });
    }
  });
}
