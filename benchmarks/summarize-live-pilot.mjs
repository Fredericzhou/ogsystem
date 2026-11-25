#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    input: { type: "string", default: "benchmarks/results" },
    out: { type: "string", default: "benchmarks/results/core-experiment-summary.json" },
    markdown: { type: "string", default: "benchmarks/results/core-experiment-summary.md" }
  }
});

const inputDir = resolve(values.input);
const files = (await readdir(inputDir)).filter((name) => /^v3-seed\d+\.json$/.test(name)).sort();
if (files.length < 2) throw new Error(`Expected at least two v3 seed reports, found ${files.length}`);

const runs = [];
for (const file of files) {
  const report = JSON.parse(await readFile(join(inputDir, file), "utf8"));
  if (report.protocolVersion !== "v3-no-oracle-leakage" || report.model !== "gpt-6-luna" || report.reasoningEffort !== "low") throw new Error(`${file}: unexpected protocol or model configuration`);
  const expected = report.tasks.length * report.arms.length;
  if (report.results.length !== expected) throw new Error(`${file}: expected ${expected} results, found ${report.results.length}`);
  for (const result of report.results) runs.push({ file, seed: report.seed, ...result });
}

const arms = ["A", "B1", "B2", "C"].filter((arm) => runs.some((row) => row.armId === arm));
const mean = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length;
const count = (rows, predicate) => rows.filter(predicate).length;
const summary = {};
for (const armId of arms) {
  const rows = runs.filter((row) => row.armId === armId);
  summary[armId] = {
    runs: rows.length,
    rawPass: count(rows, (row) => row.rawPass),
    visiblePass: count(rows, (row) => row.visibleTestResult?.rawPass),
    claimedComplete: count(rows, (row) => row.claimedComplete),
    fcr: count(rows, (row) => row.fcr),
    verifiedDelivery: count(rows, (row) => row.verifiedDelivery),
    auditDimensionsMean: Number(mean(rows, "auditDimensions").toFixed(2)),
    roleAttribution: count(rows, (row) => row.roleAttribution),
    canonicalIntegrity: count(rows, (row) => row.canonicalIntegrity),
    verifiedArtifactDigest: count(rows, (row) => row.verifiedArtifactDigest),
    failClosedOnError: count(rows, (row) => row.failClosedOnError),
    wallTimeMsMean: Number(mean(rows, "wallTimeMs").toFixed(1)),
    llmCallsMean: Number(mean(rows, "llmCalls").toFixed(2)),
    hiddenPassedTests: rows.reduce((sum, row) => sum + Number(row.hiddenTestResult?.passedTests ?? 0), 0),
    hiddenTotalTests: rows.reduce((sum, row) => sum + Number(row.hiddenTestResult?.totalTests ?? 0), 0)
  };
}

const output = {
  protocol: {
    version: "v3-no-oracle-leakage",
    model: "gpt-6-luna",
    reasoningEffort: "low",
    tasks: [...new Set(runs.map((row) => row.taskId))],
    seeds: [...new Set(runs.map((row) => String(row.seed)))].sort(),
    arms,
    hiddenEvaluation: "post-arm independent evaluation",
    artifactRoot: "benchmarks/results/artifacts"
  },
  sourceFiles: files,
  summary
};

await mkdir(dirname(resolve(values.out)), { recursive: true });
await writeFile(resolve(values.out), `${JSON.stringify(output, null, 2)}\n`);

const lines = [
  "# Corrected Core Experiment Summary",
  "",
  "Protocol: v3, visible tests are optional internal gates; hidden tests run only after all selected arms persist delivery snapshots.",
  "",
  "| Arm | Hidden RawPass | Claimed | FCR | VerifiedDelivery | Role Attribution | Canonical Integrity | Digest | Fail-Closed | Mean wall (s) | Mean LLM calls |",
  "| :-- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |",
  ...arms.map((arm) => {
    const row = summary[arm];
    return `| ${arm} | ${row.rawPass}/${row.runs} | ${row.claimedComplete}/${row.runs} | ${row.fcr}/${row.runs} | ${row.verifiedDelivery}/${row.runs} | ${row.roleAttribution}/${row.runs} | ${row.canonicalIntegrity}/${row.runs} | ${row.verifiedArtifactDigest}/${row.runs} | ${row.failClosedOnError}/${row.runs} | ${(row.wallTimeMsMean / 1000).toFixed(1)} | ${row.llmCallsMean.toFixed(2)} |`;
  }),
  "",
  "Source reports:",
  ...files.map((file) => `- \`${file}\``),
  "",
  "Deterministic state-machine ablation: `benchmarks/results/efsm-ablation.json`.",
  ""
];
await writeFile(resolve(values.markdown), lines.join("\n"));
console.log(lines.join("\n"));
