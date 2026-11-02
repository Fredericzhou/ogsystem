export function resolveTeamStudioModel(discovery, settings = {}) {
  const models = (discovery?.models || []).filter(
    (model) => model.runnable && model.backend && model.modelId
  );
  const requestedBackend = settings.defaultBackend || settings.defaultProvider || "opencode";
  const requestedModelId = settings.defaultModel && settings.defaultModel !== "default"
    ? settings.defaultModel
    : undefined;
  const requested = requestedModelId
    ? models.find((model) => model.backend === requestedBackend && model.modelId === requestedModelId)
    : undefined;
  const chosen =
    requested ||
    models.find((model) => model.backend === requestedBackend) ||
    models[0];
  return chosen ? { backend: chosen.backend, modelId: chosen.modelId } : undefined;
}
