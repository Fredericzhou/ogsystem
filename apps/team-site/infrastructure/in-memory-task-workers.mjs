function createInMemoryTaskWorkers() {
  const workers = new Map();
  return Object.freeze({
    get: (key) => workers.get(key),
    has: (key) => workers.has(key),
    set: (key, worker) => workers.set(key, worker),
    delete: (key) => workers.delete(key),
    async wait(key) { await workers.get(key)?.catch(() => undefined); }
  });
}

export const taskWorkers = createInMemoryTaskWorkers();

export async function waitForActiveTaskWorker(projectId, taskId) {
  const worker = taskWorkers.get(`${projectId}:${taskId}`);
  if (!worker) return false;
  await worker.catch(() => undefined);
  return true;
}
