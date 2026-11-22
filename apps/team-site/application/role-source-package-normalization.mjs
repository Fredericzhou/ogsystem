function normalizeImportedRoleManifest(value, roleId) {
  const role = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!role) throw new Error("TEAM_SOURCE_ROLE_MANIFEST_INVALID");
  const { contractVersion: _contractVersion, ...current } = role;
  const { events: _events, decisionCriteria = [], ...outputs } = current.outputs || {};
  const { allowedTools: _allowedTools, writableStateFields = [], ...constraints } = current.constraints || {};
  return {
    ...current,
    roleId,
    ogsContractVersion: 2,
    schemaVersion: 2,
    responsibility: {
      kind: current.responsibility?.kind === "composite" ? "composite" : "atomic",
      owns: Array.isArray(current.responsibility?.owns) ? current.responsibility.owns : [],
      contributes: Array.isArray(current.responsibility?.contributes) ? current.responsibility.contributes : [],
      doesNotOwn: Array.isArray(current.responsibility?.doesNotOwn) ? current.responsibility.doesNotOwn : [],
      ...(current.responsibility?.composition ? { composition: current.responsibility.composition } : {})
    },
    inputs: { ...(current.inputs || {}), preconditions: Array.isArray(current.inputs?.preconditions) ? current.inputs.preconditions : [] },
    outputs: {
      ...outputs,
      postconditions: Array.isArray(outputs.postconditions) ? outputs.postconditions : [],
      decisionCriteria: Array.isArray(decisionCriteria) ? decisionCriteria : []
    },
    authority: { ...(current.authority || {}), controlActions: Array.isArray(current.authority?.controlActions) ? current.authority.controlActions : [] },
    constraints: { ...constraints, writableStateFields },
    failure: {
      ...(current.failure || {}),
      retryableErrorCodes: Array.isArray(current.failure?.retryableErrorCodes) ? current.failure.retryableErrorCodes : [],
      terminalErrorCodes: Array.isArray(current.failure?.terminalErrorCodes) ? current.failure.terminalErrorCodes : []
    },
    audit: { ...(current.audit || {}), requiredFields: Array.isArray(current.audit?.requiredFields) ? current.audit.requiredFields : [] }
  };
}

function createOutputSchema(content, events) {
  let schema;
  try { schema = JSON.parse(String(content || "")); }
  catch { throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID"); }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID");
  const event = schema.properties?.event;
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("TEAM_SOURCE_OUTPUT_SCHEMA_INVALID");
  if (events.length) event.enum = events;
  else delete event.enum;
  return schema;
}

export function normalizeRoleSourcePackageFiles(files, roleId, events = []) {
  if (!files || typeof files !== "object") throw new Error("TEAM_SOURCE_PACKAGE_INVALID");
  const role = normalizeImportedRoleManifest(JSON.parse(String(files["role.json"] || "")), roleId);
  return {
    ...files,
    "role.json": `${JSON.stringify(role, null, 2)}\n`,
    "output.schema.json": `${JSON.stringify(createOutputSchema(files["output.schema.json"], events), null, 2)}\n`
  };
}
