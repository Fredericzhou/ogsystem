export function createFileTaskLifecycleStore({ getProject, withProjectWriteLock, saveTaskRecord, controlRun }) {
  if (typeof getProject !== "function" || typeof withProjectWriteLock !== "function"
    || typeof saveTaskRecord !== "function" || typeof controlRun !== "function") {
    throw new TypeError("File Task lifecycle store requires Project reads, write locks, Task persistence, and Run control.");
  }
  return Object.freeze({ getProject, withProjectWriteLock, saveTaskRecord, controlRun });
}
