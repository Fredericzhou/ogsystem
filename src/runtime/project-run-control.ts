import { mkdir, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";

export type ProjectRunControlAction = "pause" | "resume" | "cancel";

export type ProjectRunControlRequest = {
  version: 1;
  action: ProjectRunControlAction;
  requestedAt: string;
  requestId: string;
  requestedBy?: string;
};

const CONTROL_REQUEST_DIR = "control/requests";

export async function writeProjectRunControl(
  runDir: string,
  action: ProjectRunControlAction,
  requestedBy?: string
): Promise<ProjectRunControlRequest> {
  const request: ProjectRunControlRequest = {
    version: 1,
    action,
    requestedAt: new Date().toISOString(),
    requestId: randomUUID(),
    ...(requestedBy ? { requestedBy } : {})
  };
  const dir = resolve(runDir, CONTROL_REQUEST_DIR);
  await mkdir(dir, { recursive: true });
  await writeJsonFileAtomic(resolve(dir, `${request.requestedAt.replace(/[^0-9]/g, "")}-${request.requestId}.json`), request);
  return request;
}

export async function readProjectRunControls(runDir: string): Promise<ProjectRunControlRequest[]> {
  const dir = resolve(runDir, CONTROL_REQUEST_DIR);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const requests: ProjectRunControlRequest[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const value = await readJsonFile(resolve(dir, entry.name)).catch(() => undefined) as Partial<ProjectRunControlRequest> | undefined;
    if (value?.version !== 1 || !["pause", "resume", "cancel"].includes(String(value.action)) || typeof value.requestedAt !== "string") continue;
    requests.push(value as ProjectRunControlRequest);
  }
  return requests.sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
}

export async function readLatestProjectRunControl(runDir: string): Promise<ProjectRunControlRequest | undefined> {
  const requests = await readProjectRunControls(runDir);
  const latest = requests.at(-1);
  const latestCancel = [...requests].reverse().find((request) => request.action === "cancel");
  // Cancellation is terminal intent. A concurrent pause or stale resume must
  // not downgrade it while the worker is converging at a safe boundary.
  if (latestCancel) return latestCancel;
  return latest;
}
