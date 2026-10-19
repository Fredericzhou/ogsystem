import { createRunId } from "../../../dist/runtime/run-artifacts.js";

export function createTaskIdentifiers({ now = () => new Date() } = {}) {
  return Object.freeze({ createTaskId: () => createRunId(now()) });
}
