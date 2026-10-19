export function createProjectDesignValidationUseCases({ getProject, designValidator }) {
  if (typeof getProject !== "function") throw new TypeError("Project design validation requires a Project query.");
  if (!designValidator || typeof designValidator.validate !== "function") {
    throw new TypeError("Project design validation requires a design validator.");
  }

  return Object.freeze({
    async validateProjectDesign(projectId, body = {}) {
      const project = await getProject(projectId);
      return designValidator.validate(project, body);
    }
  });
}
