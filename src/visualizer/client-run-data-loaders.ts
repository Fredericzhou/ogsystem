type RequestJsonFn = (path: string, init?: unknown) => Promise<any>;

type GraphPayloadLike = {
  graph?: {
    nodes?: Array<{ roleId?: string | null } | null> | null;
  } | null;
};

export function buildLogsQuery(args: {
  apiPrefix: string;
  runId: string;
  engine?: boolean;
  roleId?: string | null;
  logTail?: string | null;
  logPageSize?: string | null;
  logSince?: string | null;
}): string {
  const params = new URLSearchParams();
  if (args.engine) {
    params.set("engine", "true");
  }
  if (args.roleId) {
    params.set("roleId", args.roleId);
  }
  const effectiveTail = args.logTail || args.logPageSize;
  if (effectiveTail) {
    params.set("tail", effectiveTail);
  }
  if (args.logSince) {
    const normalized = args.logSince.includes(":") && args.logSince.length === 16
      ? new Date(args.logSince).toISOString()
      : args.logSince;
    params.set("since", normalized);
  }
  return args.apiPrefix + "/runs/" + encodeURIComponent(args.runId) + "/logs?" + params.toString();
}

export async function fetchSelectedLogs(args: {
  requestJson: RequestJsonFn;
  apiPrefix: string;
  runId: string;
  selectedLogRoleId?: string | null;
  graphPayload?: GraphPayloadLike | null;
  logTail?: string | null;
  logPageSize?: string | null;
  logSince?: string | null;
}): Promise<{ engineLogs: any[]; roleLogs: any[] }> {
  const maxParallelRoleLogRequests = 4;
  // Callers are expected to treat log filter edits as commit-on-change, not per-keystroke reloads.
  const loadLogRecords = async (extra: { engine?: boolean; roleId?: string | null }): Promise<any[]> => {
    const payload = await args.requestJson(buildLogsQuery({
      apiPrefix: args.apiPrefix,
      runId: args.runId,
      engine: extra.engine,
      roleId: extra.roleId,
      logTail: args.logTail,
      logPageSize: args.logPageSize,
      logSince: args.logSince
    }));
    return payload.records || [];
  };

  const engineLogsPromise = loadLogRecords({ engine: true });
  let roleLogsPromise: Promise<any[]>;
  if (args.selectedLogRoleId) {
    roleLogsPromise = loadLogRecords({ roleId: args.selectedLogRoleId });
  } else {
    const roleIds = (args.graphPayload?.graph?.nodes || [])
      .map((node) => node?.roleId || "")
      .filter(Boolean);
    roleLogsPromise = roleIds.length
      ? (async () => {
          const roleLogs: any[] = [];
          for (let index = 0; index < roleIds.length; index += maxParallelRoleLogRequests) {
            const batch = roleIds.slice(index, index + maxParallelRoleLogRequests);
            const payloads = await Promise.all(batch.map((roleId) => loadLogRecords({ roleId })));
            roleLogs.push(...payloads.flat());
          }
          return roleLogs;
        })()
      : Promise.resolve([]);
  }

  const [engineLogs, roleLogs] = await Promise.all([engineLogsPromise, roleLogsPromise]);
  return { engineLogs, roleLogs };
}

export function shouldSkipDeferredPanelLoad(args: {
  runId?: string | null;
  actionBusy?: boolean;
  internal?: boolean;
  loaded?: boolean;
  stale?: boolean;
  force?: boolean;
}): boolean {
  if (!args.runId) {
    return true;
  }
  if (args.actionBusy && !args.internal) {
    return true;
  }
  if (args.loaded && !args.stale && !args.force) {
    return true;
  }
  return false;
}

export async function fetchFailureData(args: {
  requestJson: RequestJsonFn;
  apiPrefix: string;
  runId: string;
}): Promise<any> {
  return args.requestJson(args.apiPrefix + "/runs/" + encodeURIComponent(args.runId) + "/failure");
}

export async function fetchResumeReadinessData(args: {
  requestJson: RequestJsonFn;
  apiPrefix: string;
  runId: string;
}): Promise<any> {
  return args.requestJson(args.apiPrefix + "/runs/" + encodeURIComponent(args.runId) + "/resume-readiness");
}

export async function fetchResumeDiagnosticsData(args: {
  requestJson: RequestJsonFn;
  apiPrefix: string;
  runId: string;
}): Promise<any> {
  return args.requestJson(args.apiPrefix + "/runs/" + encodeURIComponent(args.runId) + "/resume-diagnostics");
}
