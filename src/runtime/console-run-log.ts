type LoggerLine = {
  tag: string;
  fields: Record<string, string | number | boolean | undefined>;
};

function formatLine(args: LoggerLine): string {
  const pairs = Object.entries(args.fields)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value)}`);
  return [`[${args.tag}]`, ...pairs].join(" ");
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
  runEnd(args: {
    status: "done" | "failed";
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
  roleDone() {},
  transition() {},
  joinWait() {},
  runEnd() {}
};

export function createRunConsoleLogger(enabled: boolean): RunConsoleLogger {
  if (!enabled) {
    return noopLogger;
  }

  const print = (line: LoggerLine) => {
    console.error(formatLine(line));
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
