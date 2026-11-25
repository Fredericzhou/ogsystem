import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function runExample(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, ["exec", "tsx", "src/runtime/cli.ts", "run", "start", ...args], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseResult(name, result) {
  assert.equal(result.stdout.trim().length > 0, true, `${name} produced no JSON result\n${result.stderr}`);
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${name} did not produce valid JSON: ${error instanceof Error ? error.message : String(error)}\n${result.stdout}`);
  }
}

async function main() {
  const target = await runExample([
    "--ogs-dir", "examples/target-model-binding",
    "--system", "examples/target-model-binding-system.mmd",
    "--input", "ci example",
    "--dry-run"
  ]);
  const targetPayload = parseResult("target-model-binding", target);
  assert.equal(target.code, 0, target.stderr);
  assert.equal(targetPayload.status, "done");

  const semanticDryRun = await runExample([
    "--ogs-dir", "examples/langgraph-debate-current",
    "--system", "examples/langgraph-debate-current/system.mmd",
    "--laws", "examples/langgraph-debate-current/laws.json",
    "--user-profile", "examples/langgraph-debate-current/user-profile.json",
    "--input", "ci graph example",
    "--dry-run"
  ]);
  const semanticPayload = parseResult("langgraph-debate-current", semanticDryRun);
  // This fixture intentionally requires business state that synthetic dry-run
  // output does not provide. Verify that semantic routing fails closed.
  assert.equal(semanticDryRun.code, 1, semanticDryRun.stderr);
  assert.equal(semanticPayload.status, "failed");
  assert.equal(semanticPayload.errorEnvelope?.errorCode, "IR_ROUTE_NO_MATCH");

  const medical = await runExample([
    "--ogs-dir", "examples/medical-quorum-consultation",
    "--system", "examples/medical-quorum-consultation/system.mmd",
    "--laws", "examples/medical-quorum-consultation/laws.json",
    "--user-profile", "examples/medical-quorum-consultation/user-profile.json",
    "--input", "ci medical quorum",
    "--dry-run"
  ]);
  const medicalPayload = parseResult("medical-quorum-consultation", medical);
  assert.equal(medical.code, 0, medical.stderr);
  assert.equal(medicalPayload.status, "done");

  console.log("examples smoke passed: 2 successful runs and 1 expected fail-closed semantic dry-run");
}

await main();
