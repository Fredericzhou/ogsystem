type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

export function projectCreateErrorFromResponse(error: Record<string, any> | null | undefined, t: Translator) {
  const code = error?.code || error?.errorCode || "";
  const messageByCode: Record<string, string> = {
    PROJECT_ALREADY_EXISTS: t("projectWizard.errorAlreadyExists", undefined, "This directory is already an OGSystem project. Load it instead."),
    PROJECT_DIR_CONFLICT: t("projectWizard.errorDirectoryConflict", undefined, "This directory has existing files. Choose current-directory initialization, another directory, or load an existing project."),
    PROJECT_FILE_CONFLICT: t("projectWizard.errorFileConflict", undefined, "This directory contains OGSystem-controlled files. Choose another directory or load the existing project."),
    INVALID_PROJECT_ID: t("projectWizard.errorInvalidProjectId", undefined, "Use a project id with letters, numbers, dots, underscores, or hyphens."),
    INVALID_PROJECT_NAME: t("projectWizard.errorInvalidProjectName", undefined, "Use a project name that starts with a letter or number."),
    INVALID_PROJECT_TEMPLATE: t("projectWizard.errorInvalidTemplate", undefined, "Choose an available project template."),
    INVALID_PROJECT_WORKDIR: t("projectWizard.errorInvalidWorkdir", undefined, "Choose an existing directory that can hold this project."),
    INVALID_PROJECT_MODEL_DEFAULT: t("projectWizard.errorInvalidModelDefault", undefined, "Use a default model reference in provider/model format.")
  };
  return {
    code,
    message: messageByCode[code] || error?.message || t("projectWizard.createFailed", undefined, "Project creation failed.")
  };
}
