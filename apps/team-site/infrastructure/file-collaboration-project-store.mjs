export function createFileCollaborationProjectStore({
  getProject,
  withProjectWriteLock,
  saveProjectMetadata,
  listProjects,
  createProject,
  initializeCollaborationProject,
  removeProject,
  withCollaborationProjectNameLock
}) {
  if (typeof getProject !== "function" || typeof withProjectWriteLock !== "function" || typeof saveProjectMetadata !== "function"
    || typeof listProjects !== "function" || typeof createProject !== "function"
    || typeof initializeCollaborationProject !== "function" || typeof removeProject !== "function"
    || typeof withCollaborationProjectNameLock !== "function") {
    throw new TypeError("File Collaboration Project store requires Project read, write, listing, creation, and cleanup operations.");
  }
  return Object.freeze({
    getProject,
    withProjectWriteLock,
    saveProjectMetadata,
    listProjects,
    createProject,
    initializeCollaborationProject,
    removeProject,
    withCollaborationProjectNameLock
  });
}
