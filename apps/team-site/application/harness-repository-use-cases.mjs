const ALLOWED_BACKENDS = new Set(["codex", "opencode", "pi"]);

function error(code, message = code) {
  const failure = new Error(message);
  failure.code = code;
  return failure;
}

function normalizeTemplate(input) {
  const template = input?.template && typeof input.template === "object" ? input.template : input;
  if (!template || typeof template !== "object") throw error("HARNESS_TEMPLATE_INVALID");
  const backend = String(template.backend || "").trim();
  const model = String(template.model || "").trim();
  if (!backend || !model) throw error("HARNESS_TEMPLATE_BINDING_REQUIRED", "Backend and model are required.");
  if (!ALLOWED_BACKENDS.has(backend)) throw error("HARNESS_BACKEND_UNSUPPORTED", `Backend ${backend} is not enabled for V2 Harness templates.`);
  if (!Array.isArray(template.allowedTools) || template.allowedTools.some((tool) => typeof tool !== "string" || !tool.trim())) {
    throw error("HARNESS_ALLOWED_TOOLS_INVALID", "allowedTools must contain non-empty strings.");
  }
  const reasoningEffort = template.reasoningEffort === undefined ? undefined : String(template.reasoningEffort).trim();
  if (reasoningEffort !== undefined && !["auto", "off", "on", "low", "medium", "high", "xhigh", "max"].includes(reasoningEffort)) {
    throw error("HARNESS_REASONING_INVALID", `Unsupported reasoning effort ${reasoningEffort}.`);
  }
  const environment = template.environment;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) throw error("HARNESS_ENVIRONMENT_REQUIRED");
  for (const field of ["filesystem", "process", "network"]) {
    if (!(field in environment)) throw error("HARNESS_ENVIRONMENT_INCOMPLETE", `environment.${field} is required.`);
  }
  if (typeof environment.filesystem === "string" && !["staged", "read_only", "none"].includes(environment.filesystem)) {
    throw error("HARNESS_FILESYSTEM_POLICY_INVALID");
  }
  if (environment.filesystem && typeof environment.filesystem === "object" &&
      (typeof environment.filesystem.read !== "boolean" || typeof environment.filesystem.write !== "boolean")) {
    throw error("HARNESS_FILESYSTEM_POLICY_INVALID");
  }
  if (!["allow", "deny"].includes(environment.process) || !["allow", "deny"].includes(environment.network)) {
    throw error("HARNESS_RESOURCE_POLICY_INVALID");
  }
  if (environment.limits !== undefined) {
    for (const key of ["timeoutMs", "maxOutputBytes", "maxStorageBytes"]) {
      if (environment.limits[key] !== undefined && (!Number.isInteger(environment.limits[key]) || environment.limits[key] < 1)) {
        throw error("HARNESS_LIMIT_INVALID", `environment.limits.${key} must be a positive integer.`);
      }
    }
  }
  return {
    ogsContractVersion: 2,
    schemaVersion: 1,
    kind: "harness",
    templateId: String(template.templateId || "").trim(),
    backend,
    model,
    ...(template.variant ? { variant: String(template.variant).trim() } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(template.preset ? { preset: String(template.preset).trim() } : {}),
    allowedTools: [...new Set(template.allowedTools.map((tool) => tool.trim()))],
    environment: {
      filesystem: environment.filesystem,
      process: environment.process,
      network: environment.network,
      ...(environment.limits ? { limits: environment.limits } : {})
    }
  };
}

function environmentFailure(template, resources = {}) {
  const environment = template.environment;
  const filesystemRequested = environment.filesystem !== "none";
  const processRequested = environment.process === "allow";
  const networkRequested = environment.network === "allow";
  if (filesystemRequested && resources.filesystem === false) return "filesystem is not enforceable by this Backend.";
  if (processRequested && resources.process === false) return "process is not enforceable by this Backend.";
  if (networkRequested && resources.network === false) return "network is not enforceable by this Backend.";
  return undefined;
}

export function createHarnessRepositoryUseCases({ repository, modelCatalog, backendRegistry, computeDigest, validateContract, workdir, now = () => new Date().toISOString(), probeModelAvailability, discoveryTimeoutMs = 60000 } = {}) {
  if (!repository || typeof repository.list !== "function" || typeof repository.save !== "function") throw new TypeError("Harness repository is required.");
  if (!modelCatalog || typeof modelCatalog.discoverBackend !== "function") throw new TypeError("Model catalog is required.");
  if (!backendRegistry || typeof backendRegistry.getAdapter !== "function") throw new TypeError("Backend registry is required.");
  if (typeof computeDigest !== "function") throw new TypeError("Harness digest function is required.");
  if (typeof validateContract !== "function") throw new TypeError("Harness contract validator is required.");

  async function discover(backend, refresh = false, requestedModel) {
    const bounded = async (operation) => {
      let timeoutId;
      try {
        return await Promise.race([
          operation(),
          new Promise((_, reject) => {
            timeoutId = setTimeout(() => reject(error("HARNESS_DISCOVERY_TIMEOUT", `Backend discovery exceeded ${discoveryTimeoutMs} ms.`)), discoveryTimeoutMs);
          })
        ]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };
    const discovery = await bounded(() => modelCatalog.discoverBackend(backend, refresh));
    const adapter = backendRegistry.getAdapter(backend);
    if (!adapter || typeof adapter.discoverNativeTools !== "function") {
      return {
        ...discovery,
        nativeTools: {
          status: "unavailable",
          verifiedTools: [],
          configurable: false,
          detail: "This backend does not expose a native tool discovery or restriction contract."
        },
        resources: adapter?.getResourceCapabilities?.() || {}
      };
    }
    const modelId = String(requestedModel || discovery?.models?.find((item) => item.runnable || item.status === "active")?.modelId || "gpt-6-luna").trim();
    try {
      const native = await bounded(() => adapter.discoverNativeTools({ modelId, workdir, timeoutMs: discoveryTimeoutMs }));
      return {
        ...discovery,
        nativeTools: {
          status: "ready",
          verifiedTools: [...new Set(native?.verifiedTools || [])],
          configurable: adapter.nativeToolsConfigurable === true
        },
        resources: adapter.getResourceCapabilities?.() || {},
        permission: { decisions: ["allow", "deny"], interactiveApproval: false, configurable: false },
        modes: { execution: ["staged", "read_only"], approval: ["non_interactive"], configurable: false }
      };
    } catch (failure) {
      return {
        ...discovery,
        nativeTools: {
          status: "unavailable",
          verifiedTools: [],
          configurable: adapter.nativeToolsConfigurable === true,
          detail: failure instanceof Error ? failure.message : String(failure)
        },
        resources: adapter.getResourceCapabilities?.() || {},
        permission: { decisions: ["allow", "deny"], interactiveApproval: false, configurable: false },
        modes: { execution: ["staged", "read_only"], approval: ["non_interactive"], configurable: false }
      };
    }
  }

  async function verify(templateId, requestedRevision) {
    const record = await repository.get(templateId, requestedRevision);
    if (!record) throw error("HARNESS_TEMPLATE_NOT_FOUND");
    const template = normalizeTemplate(record.template);
    const startedAt = now();
    const evidence = { backend: template.backend, model: template.model, verifiedTools: [], checks: [] };
    try {
      const discovery = await discover(template.backend, true, template.model);
      const source = discovery?.source || discovery?.sources?.find((item) => item.backend === template.backend);
      const model = (discovery?.models || []).find((item) => item.modelId === template.model);
      if (!source || ["unavailable", "not_installed", "installed_but_broken"].includes(String(source.status || "").toLowerCase())) {
        throw error("HARNESS_BACKEND_UNAVAILABLE", source?.detail || `Backend ${template.backend} is unavailable.`);
      }
      if (!model || ["unavailable", "disabled", "deprecated"].includes(String(model.status || "").toLowerCase())) {
        throw error("HARNESS_MODEL_UNAVAILABLE", `Model ${template.model} is unavailable in ${template.backend}.`);
      }
      evidence.checks.push({ name: "backend-model", status: "passed" });
      if (template.reasoningEffort && template.reasoningEffort !== "auto") {
        const reasoning = model.reasoning;
        if (!reasoning || reasoning.supported !== true || !Array.isArray(reasoning.levels) || !reasoning.levels.includes(template.reasoningEffort)) {
          throw error("HARNESS_REASONING_UNSUPPORTED", `Model ${template.model} does not report reasoning effort ${template.reasoningEffort}.`);
        }
        evidence.checks.push({ name: "reasoning", status: "passed", requested: template.reasoningEffort, capability: reasoning });
      } else {
        evidence.checks.push({ name: "reasoning", status: "skipped", requested: template.reasoningEffort || "auto" });
      }
      const adapter = backendRegistry.getAdapter(template.backend);
      const resources = adapter?.getResourceCapabilities?.() || {};
      const environmentError = environmentFailure(template, resources);
      if (environmentError) throw error("HARNESS_ENVIRONMENT_UNENFORCEABLE", environmentError);
      evidence.checks.push({ name: "environment", status: "passed", resources });
      if (template.allowedTools.length > 0) {
        if (!adapter || typeof adapter.discoverNativeTools !== "function") throw error("HARNESS_CAPABILITY_DISCOVERY_UNAVAILABLE", `Backend ${template.backend} cannot discover native tools.`);
        const native = discovery?.nativeTools?.status === "ready"
          ? discovery.nativeTools
          : await adapter.discoverNativeTools({ modelId: template.model, workdir, timeoutMs: template.environment.limits?.timeoutMs || 120000 });
        evidence.verifiedTools = [...new Set(native?.verifiedTools || [])];
        const missing = template.allowedTools.filter((tool) => !evidence.verifiedTools.includes(tool));
        if (missing.length) throw error("HARNESS_ALLOWED_TOOLS_UNVERIFIED", `Unverified tools: ${missing.join(", ")}`);
        evidence.checks.push({ name: "native-tools", status: "passed", verifiedTools: evidence.verifiedTools, configurable: adapter?.nativeToolsConfigurable === true });
      } else {
        evidence.checks.push({ name: "native-tools", status: "skipped", verifiedTools: [] });
      }
      // Template verification is deliberately contract-level. Backend
      // discovery has already supplied the model catalog and native tool
      // registry; running a model prompt here would make verification depend
      // on inference latency, credentials, and provider-side behavior.
      evidence.checks.push({ name: "model-catalog", status: "passed" });
      const verifiedAt = now();
      const verification = {
        status: "verified",
        verifiedAt,
        verifiedTools: evidence.verifiedTools,
        evidence,
        digest: computeDigest({ template, verifiedTools: evidence.verifiedTools, evidence })
      };
      return repository.updateVerification(templateId, record.revision, verification);
    } catch (failure) {
      const verification = {
        status: "failed",
        verifiedAt: now(),
        verifiedTools: evidence.verifiedTools,
        error: { code: failure?.code || "HARNESS_VERIFICATION_FAILED", message: failure instanceof Error ? failure.message : String(failure) },
        evidence,
        digest: computeDigest({ template, verifiedTools: evidence.verifiedTools, evidence })
      };
      await repository.updateVerification(templateId, record.revision, verification);
      throw failure;
    }
  }

  return Object.freeze({
    listTemplates: (options) => repository.list(options),
    getTemplate: (id, revision) => repository.get(id, revision),
    async saveTemplate(input) {
      const template = normalizeTemplate(input?.template || input);
      if (!template.templateId) throw error("HARNESS_TEMPLATE_ID_INVALID");
      try {
        await validateContract(template, `Harness template ${template.templateId}`);
      } catch (failure) {
        throw error("HARNESS_TEMPLATE_SCHEMA_INVALID", failure instanceof Error ? failure.message : String(failure));
      }
      return repository.save({ ...input, template, templateId: template.templateId });
    },
    async copyTemplate(sourceId, input = {}) {
      const source = await repository.get(sourceId);
      if (!source) throw error("HARNESS_TEMPLATE_NOT_FOUND");
      if (source.status !== "verified" || !source.verification) {
        throw error("HARNESS_TEMPLATE_NOT_VERIFIED", "HARNESS_TEMPLATE_NOT_VERIFIED: only verified templates can be copied as published templates.");
      }
      const templateId = String(input.templateId || "").trim();
      if (!templateId) throw error("HARNESS_TEMPLATE_ID_INVALID");
      const template = normalizeTemplate({ ...source.template, templateId });
      try {
        await validateContract(template, `Harness template ${template.templateId}`);
      } catch (failure) {
        throw error("HARNESS_TEMPLATE_SCHEMA_INVALID", failure instanceof Error ? failure.message : String(failure));
      }
      const verification = {
        ...source.verification,
        status: "verified",
        verifiedAt: now(),
        digest: computeDigest({ template, verifiedTools: source.verifiedTools || source.verification.verifiedTools || [], evidence: source.verification.evidence })
      };
      return repository.save({
        template,
        templateId,
        name: input.name || `${source.name || source.templateId} copy`,
        description: input.description ?? source.description,
        initialVerification: verification
      });
    },
    verifyTemplate: verify,
    archiveTemplate: (id) => repository.archive(id),
    async listBackends() {
      return backendRegistry.listDescriptors().map((descriptor) => ({
        backend: descriptor.backendId,
        displayName: descriptor.displayName,
        transport: descriptor.transport,
        sessionKind: descriptor.sessionKind,
        capabilities: descriptor.capabilities,
        resources: backendRegistry.getAdapter(descriptor.backendId)?.getResourceCapabilities?.() || {},
        nativeTools: {
          configurable: backendRegistry.getAdapter(descriptor.backendId)?.nativeToolsConfigurable === true
        },
        permission: { decisions: ["allow", "deny"], interactiveApproval: false, configurable: false },
        modes: { execution: ["staged", "read_only"], approval: ["non_interactive"], configurable: false },
        configurable: ALLOWED_BACKENDS.has(descriptor.backendId)
      }));
    },
    discoverBackend: discover,
    async bindingSnapshot(id, revision) {
      const record = await repository.get(id, revision);
      if (!record) throw error("HARNESS_TEMPLATE_NOT_FOUND");
      if (record.status !== "verified") throw error("HARNESS_TEMPLATE_NOT_VERIFIED", "HARNESS_TEMPLATE_NOT_VERIFIED: only verified templates can be bound.");
      return { template: normalizeTemplate(record.template), revision: record.revision, digest: record.verification?.digest || record.digest, verifiedTools: record.verifiedTools || [] };
    }
  });
}
