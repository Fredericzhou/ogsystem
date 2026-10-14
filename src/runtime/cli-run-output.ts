import type { AdapterRunResult } from "./types.js";

export function shouldEmitFullRunJson(args: {
  jsonRequested: boolean;
  stdoutIsTty: boolean;
}): boolean {
  return args.jsonRequested || !args.stdoutIsTty;
}

export function formatHumanRunSummary(args: {
  runId: string;
  runDir: string;
  result: AdapterRunResult;
  durationMs?: number;
}): string {
  const { result } = args;
  const pendingReviews = result.runSummary.pendingReviewCount ?? result.systemState.pendingReviewCount ?? 0;
  return [
    "Run Summary",
    `  Run ID:        ${args.runId}`,
    `  Status:        ${result.status}${pendingReviews > 0 ? " (waiting for human review)" : ""}`,
    `  Transitions:   ${result.runSummary.totalTransitions} (ok: ${result.runSummary.okCount}, failed: ${result.runSummary.failedCount}, noop: ${result.runSummary.noopCount})`,
    `  Duration:      ${typeof args.durationMs === "number" ? `${args.durationMs} ms` : "n/a"}`,
    `  Run Directory: ${args.runDir}`,
    `  Summary Doc:   ${args.runDir}/audit/summary.md`
  ].join("\n");
}
