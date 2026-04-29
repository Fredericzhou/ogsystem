import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

async function listSourceFiles(globs) {
  const { stdout } = await execFileAsync("rg", ["--files", ...globs], { cwd: repoRoot });
  return stdout.split("\n").filter(Boolean);
}

function normalize(filePath) {
  return filePath.split(path.sep).join("/");
}

test("Studio X6 imports stay isolated to the browser graph island", async () => {
  const sourceFiles = await listSourceFiles(["src"]);
  const violations = [];
  for (const file of sourceFiles) {
    if (!file.endsWith(".ts")) continue;
    const normalized = normalize(file);
    const source = await readFile(path.resolve(repoRoot, file), "utf8");
    if (source.includes("@antv/x6") && !normalized.startsWith("src/visualizer/studio-client/")) {
      violations.push(`${normalized}: @antv/x6 import outside studio-client`);
    }
    if (normalized.startsWith("src/visualizer/studio-client/") && /from\s+["'][^"']*runtime\//.test(source)) {
      violations.push(`${normalized}: studio-client imports runtime`);
    }
    if (normalized.startsWith("src/visualizer/studio-client/") && source.includes("studio-authoring")) {
      violations.push(`${normalized}: studio-client imports studio-authoring`);
    }
    if (normalized.startsWith("src/runtime/") && source.includes("@antv/x6")) {
      violations.push(`${normalized}: runtime imports @antv/x6`);
    }
    if (normalized.startsWith("src/visualizer/studio-client/") && /from\s+["']node:(fs|path|http|url)["']/.test(source)) {
      violations.push(`${normalized}: studio-client imports a Node builtin`);
    }
  }
  assert.deepEqual(violations, []);
});
