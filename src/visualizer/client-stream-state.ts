export type StreamRefreshPlan = {
  detailGraph: boolean;
  reviews: boolean;
  reviewDetail: boolean;
  failure: boolean;
  resumeReadiness: boolean;
  markDiagnosticsStale: boolean;
};

export function appendStreamEntry<T extends { cursor: number }>(
  entries: T[],
  entry: T,
  limit = 250
): T[] {
  if (entries.some((item) => item.cursor === entry.cursor)) {
    return entries.slice(-limit);
  }
  return entries.concat(entry).slice(-limit);
}

export function createStreamCursorIndex<T extends { cursor: number }>(entries: T[]): Set<number> {
  return new Set(entries.map((entry) => entry.cursor));
}

export function appendIndexedStreamEntry<T extends { cursor: number }>(
  entries: T[],
  cursorIndex: Set<number>,
  entry: T,
  limit = 250
): T[] {
  if (cursorIndex.has(entry.cursor)) {
    return entries.slice(-limit);
  }
  const nextEntries = entries.concat(entry).slice(-limit);
  cursorIndex.add(entry.cursor);
  if (nextEntries.length !== entries.length + 1) {
    const retainedCursors = new Set(nextEntries.map((item) => item.cursor));
    for (const cursor of cursorIndex) {
      if (!retainedCursors.has(cursor)) {
        cursorIndex.delete(cursor);
      }
    }
  }
  return nextEntries;
}

export function getStreamRefreshPlan(type: string | undefined): StreamRefreshPlan {
  const normalized = typeof type === "string" ? type : "";
  if (normalized.startsWith("human_review_")) {
    return {
      detailGraph: true,
      reviews: true,
      reviewDetail: true,
      failure: false,
      resumeReadiness: true,
      markDiagnosticsStale: true
    };
  }
  if (
    normalized === "audit" ||
    normalized === "runtime_error" ||
    normalized.startsWith("run_") ||
    normalized.startsWith("stop_") ||
    normalized.startsWith("resume_") ||
    normalized === "branch_activated" ||
    normalized === "join_ready"
  ) {
    return {
      detailGraph: true,
      reviews: false,
      reviewDetail: false,
      failure: true,
      resumeReadiness: true,
      markDiagnosticsStale: true
    };
  }
  return {
    detailGraph: false,
    reviews: false,
    reviewDetail: false,
    failure: false,
    resumeReadiness: false,
    markDiagnosticsStale: true
  };
}

export function formatReviewStatusLabel(status: string | undefined): string {
  switch (status) {
    case "pending_reconcile":
      return "pending reconcile";
    case "waiting_review":
      return "waiting review";
    default:
      return String(status || "unknown").replace(/_/g, " ");
  }
}
