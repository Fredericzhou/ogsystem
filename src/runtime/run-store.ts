/** Run lifecycle persistence port. */
import {
  clearRunStopRequest,
  initializeRunContext,
  loadResumeGraphState,
  pathExists,
  persistRunPlanFingerprint,
  requestRunStop,
  validateResumePlanFingerprint
} from "./run-artifacts.js";

export type RunStore = {
  initialize: typeof initializeRunContext;
  loadResumeState: typeof loadResumeGraphState;
  persistPlanFingerprint: typeof persistRunPlanFingerprint;
  validatePlanFingerprint: typeof validateResumePlanFingerprint;
  requestStop: typeof requestRunStop;
  clearStopRequest: typeof clearRunStopRequest;
  pathExists: typeof pathExists;
};

export const filesystemRunStore: RunStore = {
  initialize: initializeRunContext,
  loadResumeState: loadResumeGraphState,
  persistPlanFingerprint: persistRunPlanFingerprint,
  validatePlanFingerprint: validateResumePlanFingerprint,
  requestStop: requestRunStop,
  clearStopRequest: clearRunStopRequest,
  pathExists
};

export { pathExists };
