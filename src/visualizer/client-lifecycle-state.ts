import type { StreamRefreshPlan } from "./client-stream-state.js";
import { createStreamCursorIndex } from "./client-stream-state.js";

export function createInitialStreamRefreshPlan(): StreamRefreshPlan {
  return {
    detailGraph: false,
    reviews: false,
    reviewDetail: false,
    failure: false,
    resumeReadiness: false,
    markDiagnosticsStale: false
  };
}

export function createProjectStateSlice(resolvedLocale: string) {
  return {
    locale: resolvedLocale,
    workspace: null,
    hasProject: false,
    projectCreateError: null,
    projectCreateStage: "",
    projectWizardDraft: null,
    project: null,
    projectCreateRequestId: "",
    opsSummary: null,
    projectReadiness: null,
    projectLoading: false
  };
}

export function createBuildStateSlice() {
  return {
    workbench: null,
    buildMode: "edit",
    workbenchView: "bridge",
    workbenchSource: "",
    workbenchDiskSource: "",
    workbenchSavedPath: "system.mmd",
    workbenchHasDraft: false,
    workbenchValidationTimer: null,
    workbenchValidationRequestId: 0,
    workbenchValidating: false,
    workbenchRunDraft: null,
    workbenchRunDraftErrors: {},
    studioBridge: null,
    studioCanvas: null,
    studioBridgeLoaded: false,
    studioBridgeLoading: false,
    studioBridgeStale: false,
    studioBridgeWarmupRequestId: 0,
    studioBridgeSelectedRoleId: "",
    studioBridgeSelectedFlowKey: "",
    studioBridgeFilter: "",
    studioBridgeListMode: "all",
    studioWorkbenchSideTab: "structure",
    studioBridgeFullscreen: false,
    studioBridgeEditSelectionRequest: 0,
    studioInspectorCollapsed: false,
    studioInspectorWidth: 380,
    studioSelectionCommandFormOpen: false,
    studioSelectionCommandKind: "",
    studioSelectionDismissCommandFormRequest: 0,
    studioBridgeLastDryRunId: "",
    studioGraphStatusText: "",
    studioGraphRootElement: null,
    studioGraphMountRetryTimer: null,
    studioGraphMountRetryCount: 0,
    studioCanvasSyncRequestId: 0,
    runGraphMountRetryTimer: null,
    runGraphMountRetryCount: 0,
    studioRolePackageEditor: {
      roleId: "",
      loading: false,
      saving: false,
      loaded: false,
      dirty: false,
      error: "",
      data: null,
      draftFiles: {}
    },
    studioRoleConfigEditor: {
      roleId: "",
      saving: false,
      dirty: false,
      error: "",
      data: null,
      draft: null
    },
    studioExecutionConfigEditor: {
      roleId: "",
      loading: false,
      saving: false,
      loaded: false,
      dirty: false,
      error: "",
      data: null,
      draft: null
    },
    studioFlowConfigEditor: {
      flowKey: "",
      saving: false,
      dirty: false,
      error: "",
      validation: null,
      data: null,
      draft: null
    },
    studioRoleIoModal: {
      open: false,
      loading: false,
      error: "",
      requestKey: "",
      data: null
    },
    studioChatSessionId: "",
    studioChatMessages: [],
    studioChatDraftMessage: "",
    studioChatLastRequest: "",
    studioChatResult: null,
    studioChatCollapsed: false,
    studioChatDialogOpen: false,
    studioChatAbortController: null,
    studioChatRequestId: 0,
    studioChatTimeoutMs: 60000,
    studioGraphHistoryEventId: 0,
    studioGraphHistoryEvent: null,
    studioTemplates: [],
    studioRoleCatalog: null,
    workbenchLoading: false
  };
}

export function createOperateStateSlice() {
  return {
    consoleTab: "design",
    runGraphSelectedRoleId: "",
    runGraphSelectedFlowKey: "",
    graphReadingMode: "all",
    graphReadingRoleId: "",
    graphReadingFlowKey: "",
    graphReadingChannel: "",
    graphViewport: null,
    operateTab: "overview",
    sidebarOpen: false,
    runs: [],
    runDetailLoading: false,
    filter: "",
    projectHome: false,
    selectedRunId: "",
    runSelectionRequestId: 0,
    timelineRoleId: "",
    timelineBranchId: "",
    timelineType: "",
    timelineReviewId: "",
    timelineStatus: "",
    timelineErrorCode: "",
    timelineChannel: "",
    conversationMode: false,
    conversation: null,
    conversationCursor: 0,
    conversationLoadInFlight: false,
    conversationRefreshPending: false,
    eventCursor: 0,
    events: [],
    eventCursorIndex: createStreamCursorIndex([]),
    detail: null,
    graph: null,
    bindings: null,
    contracts: null,
    contractRuntimeStatus: null,
    rolePackages: null
  };
}

export function createReviewStateSlice() {
  return {
    selectedReviewId: "",
    failure: null,
    failureLoaded: false,
    failureStale: false,
    reviews: null,
    reviewDetail: null,
    resumeReadiness: null,
    resumeReadinessLoaded: false,
    resumeReadinessStale: false,
    resumeDiagnostics: null,
    resumeDiagnosticsLoaded: false,
    resumeDiagnosticsStale: false
  };
}

export function createLogsStateSlice() {
  return {
    selectedLogRoleId: "",
    logTail: "",
    logPageSize: "100",
    logSince: "",
    engineLogs: [],
    roleLogs: [],
    logsLoaded: false,
    logsStale: false
  };
}

export function createStreamingStateSlice() {
  return {
    stream: null,
    listTimer: null,
    flash: null,
    flashTimer: null,
    actionBusy: "",
    actionForm: null,
    streamRefreshPlan: createInitialStreamRefreshPlan(),
    streamRefreshRunId: "",
    streamRefreshTimer: null,
    streamRefreshInFlight: false
  };
}

export function createInitialVisualizerState(
  resolvedLocale: string
) {
  return {
    ...createProjectStateSlice(resolvedLocale),
    ...createBuildStateSlice(),
    ...createOperateStateSlice(),
    ...createReviewStateSlice(),
    ...createLogsStateSlice(),
    ...createStreamingStateSlice()
  };
}
