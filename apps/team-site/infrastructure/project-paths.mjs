import { resolve } from "node:path";

/** The Project control root owns .site and .ogs evidence. */
export function projectOgsDir(project) {
  return resolve(String(project?.ogsDir || project?.workdir || ""));
}

/** The Project business workspace is the target used by role tools and materials. */
export function projectWorkspaceDir(project) {
  return resolve(String(project?.workspaceDir || project?.workdir || ""));
}
