import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";

import {
  createServeSession,
  fingerprintServeProject,
  listServeSessions,
  readServeSession
} from "../dist/visualizer/session-service.js";

test("serve sessions pin the system and configuration snapshot and preserve parent linkage", async () => {
  const ogsDir = await mkdtemp(path.join(os.tmpdir(), "ogs-serve-session-"));
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "ogs-serve-workspace-"));
  await mkdir(path.resolve(ogsDir, ".ogs"), { recursive: true });
  await mkdir(path.resolve(ogsDir, "og-roles"), { recursive: true });
  const systemPath = path.resolve(ogsDir, "system.mmd");
  const initialSystem = await readFile(path.resolve("examples/target-model-binding-system.mmd"), "utf8");
  await writeFile(systemPath, initialSystem, "utf8");
  await writeFile(path.resolve(ogsDir, ".ogs", "runtime.json"), "{}\n", "utf8");
  const project = { ogsDir, systemPath, workspaceDir };
  const first = await createServeSession({ project });
  const snapshotPath = path.resolve(ogsDir, ".ogs", "sessions", first.sessionId, "system.mmd");
  assert.equal(await readFile(snapshotPath, "utf8"), initialSystem);
  assert.deepEqual(await readServeSession(ogsDir, first.sessionId), first);
  assert.equal((await listServeSessions(ogsDir)).length, 1);

  const before = await fingerprintServeProject(project);
  await writeFile(systemPath, initialSystem.replace("system.version=1.0.0", "system.version=2.0.0"), "utf8");
  const after = await fingerprintServeProject(project);
  assert.notEqual(after.systemDigest, before.systemDigest);
  assert.notEqual(after.configurationDigest, before.configurationDigest);

  const child = await createServeSession({ project, parentSessionId: first.sessionId });
  assert.equal(child.parentSessionId, first.sessionId);
  assert.equal(child.systemDigest, after.systemDigest);
  assert.equal((await listServeSessions(ogsDir)).length, 2);
});
