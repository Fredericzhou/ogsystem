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

export function projectOpenMessageFromResponse(
  result: Record<string, any> | null | undefined,
  t: Translator
) {
  const code = result?.code || result?.errorCode || "";
  const messageByCode: Record<string, string> = {
    PROJECT_OPEN_NOT_FOUND: t("projectOpen.statusNotFound", undefined, "Path does not exist."),
    PROJECT_OPEN_NOT_DIRECTORY: t("projectOpen.statusNotDirectory", undefined, "Path is not a directory."),
    PROJECT_OPEN_NOT_READABLE: t("projectOpen.statusNotReadable", undefined, "Directory is not readable."),
    PROJECT_OPEN_READY: t("projectOpen.statusReady", undefined, "OGSystem project is ready to open."),
    PROJECT_OPEN_EMPTY: t(
      "projectOpen.statusEmpty",
      undefined,
      "Directory is empty and can be initialized as a project."
    ),
    PROJECT_OPEN_CONTROLLED_PATH_CONFLICT: t(
      "projectOpen.statusControlledPathConflict",
      undefined,
      "Directory contains OGSystem-controlled paths but is not a complete project."
    ),
    PROJECT_OPEN_DIR_CONFLICT: t(
      "projectOpen.statusDirectoryConflict",
      undefined,
      "Directory is not empty and is not an OGSystem project."
    )
  };
  return {
    code,
    message: messageByCode[code] || result?.message || t("projectOpen.notOpenable", undefined, "Select a valid OGSystem project directory before opening.")
  };
}
