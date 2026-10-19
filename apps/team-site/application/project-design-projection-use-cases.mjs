export function createProjectDesignProjectionUseCases({
  getProject,
  withProjectWriteLock,
  designStore,
  designProjector,
  designSerializer
}) {
  if (typeof getProject !== "function") throw new TypeError("Project design projection requires a Project query.");
  if (typeof withProjectWriteLock !== "function") throw new TypeError("Project design projection requires a Project write lock.");
  if (!designStore || typeof designStore.saveSystemSource !== "function") {
    throw new TypeError("Project design projection requires a design store.");
  }
  if (!designProjector || typeof designProjector.project !== "function") {
    throw new TypeError("Project design projection requires a design projector.");
  }
  if (!designSerializer || typeof designSerializer.serialize !== "function") {
    throw new TypeError("Project design projection requires a design serializer.");
  }
  async function projectDesign(project, locale) {
    const graph = await designProjector.project(project, locale);
    return { ...graph, projectStatus: project.projectStatus, confirmedAt: project.confirmedAt };
  }

  return Object.freeze({
    async getProjectGraph(projectId, locale = "zh-CN") {
      const project = await getProject(projectId);
      return designProjector.project(project, locale);
    },
    async getProjectDesign(projectId, locale = "zh-CN") {
      const project = await getProject(projectId);
      return projectDesign(project, locale);
    },
    async saveProjectDesign(projectId, body = {}) {
      const systemSource = typeof body.systemSource === "string"
        ? body.systemSource
        : body.authoring && typeof body.authoring === "object"
          ? designSerializer.serialize(body.authoring)
          : "";
      if (!systemSource) throw new Error("SYSTEM_SOURCE_REQUIRED: design source is required.");
      return withProjectWriteLock(projectId, "design-save", async () => {
        const currentProject = await getProject(projectId);
        if (body.expectedProjectDigest && body.expectedProjectDigest !== currentProject.projectDigest) {
          throw new Error("PROJECT_DIGEST_CONFLICT: the project changed in another editor.");
        }
        const saved = await designStore.saveSystemSource({ workdir: currentProject.workdir, systemSource });
        if (saved?.validation?.ok !== true) throw new Error("PROJECT_DESIGN_INVALID: design validation failed.");
        const project = await getProject(projectId);
        return projectDesign(project, "zh-CN");
      });
    }
  });
}
