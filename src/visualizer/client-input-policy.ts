export const WORKBENCH_VALIDATION_DEBOUNCE_MS = 250;
export const RUN_LIST_SEARCH_MODE = "immediate-local-filter";
export const STUDIO_BRIDGE_FILTER_MODE = "immediate-local-filter";
export const STUDIO_CHAT_INPUT_MODE = "draft-only";
export const PROJECT_OPEN_INPUT_MODE = "draft-only";
export const LOG_FILTER_INPUT_MODE = "commit-on-change";

export type VisualizerInputBoundary = {
  control: string;
  mode: string;
  remoteTrigger: string;
};

export const VISUALIZER_INPUT_BOUNDARIES: VisualizerInputBoundary[] = [
  {
    control: "workbench-editor",
    mode: `debounced-remote-validate:${WORKBENCH_VALIDATION_DEBOUNCE_MS}ms`,
    remoteTrigger: "input settles before /project/system/validate"
  },
  {
    control: "studio-chat-input",
    mode: STUDIO_CHAT_INPUT_MODE,
    remoteTrigger: "send/regenerate/apply actions only"
  },
  {
    control: "project-open-workdir",
    mode: PROJECT_OPEN_INPUT_MODE,
    remoteTrigger: "validate/browse/open actions only"
  },
  {
    control: "search",
    mode: RUN_LIST_SEARCH_MODE,
    remoteTrigger: "none"
  },
  {
    control: "studio-bridge-filter",
    mode: STUDIO_BRIDGE_FILTER_MODE,
    remoteTrigger: "none"
  },
  {
    control: "project-role-catalog-filter",
    mode: "immediate-local-filter-and-rerender",
    remoteTrigger: "none"
  },
  {
    control: "log-role/log-tail/log-page-size/log-since",
    mode: LOG_FILTER_INPUT_MODE,
    remoteTrigger: "change event reloads selected logs when already loaded"
  }
];
