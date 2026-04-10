import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import { lintSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

const lintCliPath = path.resolve("dist/runtime/lint.js");

function runLintCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [lintCliPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("lint diagnostics are line-aware and stable", async () => {
  const source = await readFile(
    path.resolve("tests/fixtures/mermaid/invalid-unsupported-metadata.mmd"),
    "utf8"
  );

  assert.deepStrictEqual(lintSystemFromMermaidSource(source), [
    {
      line: 6,
      errorCode: "MERMAID_UNSUPPORTED_METADATA_KEY",
      message: 'Unsupported metadata key "unsupported.flag"',
      stage: "validate"
    }
  ]);
});

test("lint cli hard-fails and prints line + errorCode + message", async () => {
  const { code, stderr } = await runLintCli([
    "--system",
    "tests/fixtures/mermaid/invalid-unsupported-metadata.mmd"
  ]);

  assert.equal(code, 1);
  assert.match(
    stderr,
    /^6 MERMAID_UNSUPPORTED_METADATA_KEY Unsupported metadata key "unsupported\.flag"$/m
  );
  assert.match(stderr, /errorCode=MERMAID_UNSUPPORTED_METADATA_KEY/);
  assert.match(stderr, /stage=validate/);
});

test("lint cli missing required args still emits a stable envelope", async () => {
  const { code, stderr } = await runLintCli([]);

  assert.equal(code, 1);
  assert.match(stderr, /Missing required args/);
  assert.match(stderr, /errorCode=LINT_MISSING_SYSTEM_ARG/);
  assert.match(stderr, /errorCategory=input/);
});
