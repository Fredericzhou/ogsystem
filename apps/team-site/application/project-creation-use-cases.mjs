function slug(value) {
  return String(value || "new-team").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "new-team";
}

export function createProjectCreationUseCases({ projectStore, workspaceStore, caseMaterializer, projectQuery }) {
  for (const [name, port, operations] of [
    ["Project persistence", projectStore, ["createProject", "saveProjectMetadata", "removeProjectData"]],
    ["Visualizer workspace", workspaceStore, ["createWorkspace"]],
    ["Case materializer", caseMaterializer, ["materialize"]],
    ["Project query", projectQuery, ["getProject"]]
  ]) {
    for (const operation of operations) {
      if (typeof port?.[operation] !== "function") throw new TypeError(`Project creation requires ${name} ${operation}.`);
    }
  }

  return Object.freeze({
    async createProject(input) {
      const project = await projectStore.createProject(input);
      try {
        const existingWorkspace = typeof workspaceStore.inspectWorkspace === "function"
          ? await workspaceStore.inspectWorkspace(project.workdir)
          : undefined;
        if (existingWorkspace?.hasProject !== true || existingWorkspace?.isProjectValid !== true) {
          const workspace = await workspaceStore.createWorkspace({
            currentWorkdir: project.workdir,
            projectId: project.projectId,
            projectName: slug(input.name),
            templateId: input.templateId === "minimal" ? "minimal" : "empty",
            conflictStrategy: "init-current"
          });
          await projectStore.saveProjectMetadata(project.projectId, { ...project, ogsProjectId: workspace.projectId });
        }
        if (input.caseId) await caseMaterializer.materialize(input.caseId, project.workdir, input.locale === "en" ? "en" : "zh-CN");
        return projectQuery.getProject(project.projectId);
      } catch (error) {
        const latest = await projectQuery.getProject(project.projectId).catch(() => undefined);
        const existingWorkspace = latest?.ogsProjectId && typeof workspaceStore.inspectWorkspace === "function"
          ? await workspaceStore.inspectWorkspace(project.workdir).catch(() => undefined)
          : undefined;
        if (existingWorkspace?.hasProject === true && existingWorkspace?.isProjectValid === true) return latest;
        await projectStore.removeProjectData(project.projectId).catch(() => undefined);
        throw error;
      }
    }
  });
}
