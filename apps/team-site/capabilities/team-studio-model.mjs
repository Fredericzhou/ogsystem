import { isDirectModelRef } from "../../../dist/runtime/model-selection.js";

export function resolveTeamStudioModelRef(discovery, settings = {}) {
  const models = (discovery?.models || []).filter((model) => model.backend === "opencode" && model.runnable && isDirectModelRef(model.ref));
  const requestedModel = settings.defaultModel && settings.defaultModel !== "default" ? settings.defaultModel : undefined;
  const requested = requestedModel
    ? models.find((model) => model.id === requestedModel || model.ref === requestedModel)
    : undefined;
  return (requested || models[0])?.ref;
}
