/**
 * @fileoverview Console logger for run/role/transition lifecycle events.
 * File Set: runtime-observability
 * Responsibilities:
 * - Render concise stderr log lines for run progress.
 * - Apply optional ANSI coloring when terminal supports it.
 * Boundaries:
 * - Logging-only; does not persist audit artifacts.
 */
type LoggerLine = {
  tag: string;
  fields: Record<string, string | number | boolean | undefined>;
};

type ColorPalette = {
  tagBlue: string;
  ok: string;
  failed: string;
  noop: string;
  reset: string;
};

const NO_COLOR: ColorPalette = {
  tagBlue: "",
  ok: "",
  failed: "",
  noop: "",
  reset: ""
};

const ANSI_COLOR: ColorPalette = {
  tagBlue: "\u001b[34m",
  ok: "\u001b[32m",
  failed: "\u001b[31m",
  noop: "\u001b[90m",
  reset: "\u001b[0m"
};

function shouldUseAnsiColor(): boolean {
  return Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
}

function colorizeStatus(
  status: string | number | boolean | undefined,
  palette: ColorPalette
): string | number | boolean | undefined {
  if (status === "ok") {
    return `${palette.ok}${status}${palette.reset}`;
  }
  if (status === "failed") {
    return `${palette.failed}${status}${palette.reset}`;
  }
  if (status === "noop") {
    return `${palette.noop}${status}${palette.reset}`;
  }
  return status;
}

function formatLine(args: LoggerLine, palette: ColorPalette): string {
  const normalizedFields = Object.fromEntries(
    Object.entries(args.fields).map(([key, value]) => [
      key,
      key === "status" ? colorizeStatus(value, palette) : value
    ])
  );
  const tag =
    args.tag === "transition"
      ? `${palette.tagBlue}[${args.tag}]${palette.reset}`
      : `[${args.tag}]`;
  const normalizedPairs = Object.entries(normalizedFields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  return [tag, ...normalizedPairs].join(" ");
}

export type RunConsoleLogger = {
  runStart(args: {
    runId: string;
    systemId: string;
    entryRoleId: string;
    resume: boolean;
  }): void;
  roleStart(args: {
    roleId: string;
    branchId: string;
    loopIteration: number;
    binding: string;
    timeoutMs?: number;
  }): void;
  roleWaiting(args: {
    roleId: string;
    branchId: string;
    waitKind: "technical";
    stage: string;
    elapsedMs: number;
    timeoutMs?: number;
    binding?: string;
  }): void;
  roleDone(args: {
    roleId: string;
    branchId: string;
    status: "ok" | "failed" | "noop";
    selectedEvent?: string;
    durationMs: number;
    errorCode?: string;
  }): void;
  transition(args: {
    fromRoleId: string;
    event?: string;
    toRoleId: string;
    branchId: string;
  }): void;
  joinWait(args: {
    roleId: string;
    arrivedFrom: string;
    waitingFor: string[];
  }): void;
  runWaiting(args: {
    waitKind: "business";
    reason: string;
    pendingReviewCount?: number;
  }): void;
  runEnd(args: {
    status: "done" | "failed" | "stopped";
    finalRoleId?: string;
    totalTransitions: number;
    okCount: number;
    failedCount: number;
    noopCount: number;
  }): void;
};

const noopLogger: RunConsoleLogger = {
  runStart() {},
  roleStart() {},
  roleWaiting() {},
  roleDone() {},
  transition() {},
  joinWait() {},
  runWaiting() {},
  runEnd() {}
};

export function createRunConsoleLogger(enabled: boolean): RunConsoleLogger {
  if (!enabled) {
    return noopLogger;
  }

  const palette = shouldUseAnsiColor() ? ANSI_COLOR : NO_COLOR;
  const print = (line: LoggerLine) => {
    console.error(formatLine(line, palette));
  };

  return {
    runStart(args) {
      print({
        tag: "run:start",
        fields: {
          run: args.runId,
          system: args.systemId,
          resume: args.resume,
          entry: args.entryRoleId
        }
      });
    },
    roleStart(args) {
      print({
        tag: "role:start",
        fields: {
          role: args.roleId,
          branch: args.branchId,
          loop: args.loopIteration,
          binding: args.binding,
          timeout: args.timeoutMs === undefined ? undefined : `${args.timeoutMs}ms`
        }
      });
    },
    roleWaiting(args) {
      print({
        tag: "role:waiting",
        fields: {
          kind: args.waitKind,
          role: args.roleId,
          branch: args.branchId,
          stage: args.stage,
          elapsed: `${args.elapsedMs}ms`,
          timeout: args.timeoutMs === undefined ? undefined : `${args.timeoutMs}ms`,
          binding: args.binding
        }
      });
    },
    roleDone(args) {
      print({
        tag: "role:done",
        fields: {
          role: args.roleId,
          branch: args.branchId,
          status: args.status,
          event: args.selectedEvent,
          errorCode: args.errorCode,
          duration: `${args.durationMs}ms`
        }
      });
    },
    transition(args) {
      print({
        tag: "transition",
        fields: {
          from: args.fromRoleId,
          event: args.event,
          to: args.toRoleId,
          branch: args.branchId
        }
      });
    },
    joinWait(args) {
      print({
        tag: "join:wait",
        fields: {
          role: args.roleId,
          arrived: args.arrivedFrom,
          waiting: args.waitingFor.join(",")
        }
      });
    },
    runWaiting(args) {
      print({
        tag: "run:waiting",
        fields: {
          kind: args.waitKind,
          reason: args.reason,
          pendingReviewCount: args.pendingReviewCount
        }
      });
    },
    runEnd(args) {
      print({
        tag: "run:end",
        fields: {
          status: args.status,
          final: args.finalRoleId,
          total: args.totalTransitions,
          ok: args.okCount,
          failed: args.failedCount,
          noop: args.noopCount
        }
      });
    }
  };
}
