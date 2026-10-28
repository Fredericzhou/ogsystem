function readLocale() {
  try { return localStorage.getItem("ogs-locale") || "zh-CN"; } catch { return "zh-CN"; }
}

export const state = {
  cases: [],
  eventLabels: {},
  locale: readLocale(),
  view: "workspace",
  projectId: null,
  recentRuns: [],
  requestVersion: 0,
  activeRequest: null,
  dirty: false,
  dirtySources: new Set()
};

export function setDirty(source = "page") {
  state.dirtySources.add(source);
  state.dirty = true;
}

export function clearDirty(source) {
  if (source) state.dirtySources.delete(source);
  else state.dirtySources.clear();
  state.dirty = state.dirtySources.size > 0;
}

export function isDirty() {
  return state.dirtySources.size > 0 || state.dirty === true;
}

export function beginPageRequest() {
  state.activeRequest?.runPollers?.forEach((stop) => stop());
  state.activeRequest?.runPollers?.clear();
  state.activeRequest?.controller.abort();
  state.requestVersion += 1;
  const controller = new AbortController();
  state.activeRequest = { version: state.requestVersion, controller, signal: controller.signal, runPollers: new Set() };
  return state.activeRequest;
}

export function isCurrentRequest(request) {
  return Boolean(request && state.activeRequest === request && request.version === state.requestVersion && !request.signal.aborted);
}

export function isAbort(error) {
  return error?.name === "AbortError";
}
