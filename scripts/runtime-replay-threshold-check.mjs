#!/usr/bin/env node

import { readFile } from "node:fs/promises";

export const RUNTIME_REPLAY_THRESHOLDS = Object.freeze({
  stateLoadMs: 10,
  checkpointLoadMs: 8,
  resumeTotalMs: 1800,
  stateWriteMs: 15
});

export function evaluateRuntimeReplayThresholds(record) {
  const metrics = record?.metrics && typeof record.metrics === "object" ? record.metrics : {};
  const violations = Object.entries(RUNTIME_REPLAY_THRESHOLDS)
    .filter(([metric, threshold]) => typeof metrics[metric] !== "number" || metrics[metric] > threshold)
    .map(([metric, threshold]) => ({
      metric,
      observed: metrics[metric],
      threshold
    }));
  return {
    mode: "report-only",
    ok: violations.length === 0,
    violations
  };
}

async function main(argv) {
  const inputIndex = argv.indexOf("--input");
  const inputPath = inputIndex >= 0 ? argv[inputIndex + 1] : undefined;
  const failOnViolation = argv.includes("--fail");
  if (!inputPath) {
    throw new Error("Usage: node scripts/runtime-replay-threshold-check.mjs --input <record.json> [--fail]");
  }
  const record = JSON.parse(await readFile(inputPath, "utf8"));
  const result = evaluateRuntimeReplayThresholds(record);
  const prefix = result.ok ? "PASS" : "REPORT";
  console.log(`${prefix} runtime-replay threshold check (${result.mode})`);
  for (const [metric, threshold] of Object.entries(RUNTIME_REPLAY_THRESHOLDS)) {
    console.log(`  ${metric}: ${record.metrics?.[metric] ?? "missing"} ms <= ${threshold} ms`);
  }
  if (result.violations.length && failOnViolation) {
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
