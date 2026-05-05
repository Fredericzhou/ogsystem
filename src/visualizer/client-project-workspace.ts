type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

export function projectCreateErrorFromResponse(error: Record<string, any> | null | undefined, t: Translator) {
  const code = error?.code || error?.errorCode || "";
  const messageByCode: Record<string, string> = {
    PROJECT_ALREADY_EXISTS: t("projectWizard.errorAlreadyExists", undefined, "This directory is already an OGSystem project."),
    PROJECT_DIR_CONFLICT: t("projectWizard.errorDirectoryConflict", undefined, "This directory has existing files. Confirm current-directory initialization to continue."),
    PROJECT_FILE_CONFLICT: t("projectWizard.errorFileConflict", undefined, "This directory contains OGSystem-controlled files and cannot be initialized."),
    INVALID_PROJECT_NAME: t("projectWizard.errorInvalidProjectName", undefined, "Use a project name that starts with a letter or number."),
    INVALID_PROJECT_TEMPLATE: t("projectWizard.errorInvalidTemplate", undefined, "Choose an available project template."),
    INVALID_PROJECT_WORKDIR: t("projectWizard.errorInvalidWorkdir", undefined, "Project creation only supports the current visualizer directory.")
  };
  return {
    code,
    message: messageByCode[code] || error?.message || t("projectWizard.createFailed", undefined, "Project creation failed.")
  };
}
