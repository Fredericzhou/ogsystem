import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";

import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  appendBufferedText,
  flushBufferedRunArtifacts,
  initializeRunContext
} from "../dist/runtime/run-artifacts.js";

const systemSource = `flowchart TD
%% system.id=test.fault.injection
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=test-operator
%% model.bind.test-operator=balanced-gpt52

input -->|GO| operator[Role:test-operator]
operator[Role:test-operator] -->|DONE| output
`;

test("buffered append recovery replays content after a partial write failure", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-buffer-recovery-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  await writeFile(systemPath, systemSource, "utf8");

  const system = parseSystemFromMermaidSource(systemSource);
  const runtimeConfig = validateRuntimeConfig(
    {
      executor: "opencode",
      roleRepo: path.resolve("og-roles"),
      modelRepo: path.resolve("og-models"),
      runsDir: "ogsystem-history"
    },
    path.resolve(tempRoot, "runtime.json")
  );

  const runContext = await initializeRunContext({
    system,
    systemPath,
    prompt: "buffer fault",
    workdir: tempRoot,
    runtimeConfig
  });
  const failingPath = path.resolve(runContext.runDir, "fault", "delayed.log");

  await appendBufferedText({
    context: runContext,
    key: "fault-test",
    path: failingPath,
    content: "recovered line\n"
  });

  await assert.rejects(() => flushBufferedRunArtifacts(runContext), /ENOENT|no such file/i);

  await mkdir(path.dirname(failingPath), { recursive: true });
  await initializeRunContext({
    system,
    systemPath,
    prompt: "buffer fault",
    workdir: tempRoot,
    runtimeConfig,
    resumeRunDir: path.relative(tempRoot, runContext.runDir)
  });

  const content = await readFile(failingPath, "utf8");
  assert.strictEqual(content, "recovered line\n");

  const recoveryDir = path.resolve(runContext.runDir, ".buffer-recovery");
  const recoveryEntries = await readdir(recoveryDir);
  assert.deepStrictEqual(recoveryEntries, []);
});
