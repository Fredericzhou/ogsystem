const RESOURCE_ID = /^[a-z0-9][a-z0-9-]{0,79}$/;

export function createSharedResourceUseCases({ store }) {
  if (!store) throw new TypeError("Shared resource use cases require a resource store.");
  const requireId = (value, label) => {
    const id = String(value || "").trim();
    if (!RESOURCE_ID.test(id)) throw new Error(label + "_INVALID");
    return id;
  };
  const validateCatalogItem = (kind, payload) => {
    const id = requireId(payload?.id, "RESOURCE_ID");
    const name = String(payload?.name || "").trim();
    if (!name || name.length > 120) throw new Error("RESOURCE_NAME_INVALID");
    const description = String(payload.description || "").slice(0, 1000);
    const enabled = payload.enabled !== false;
    if (kind === "tools") {
      const type = String(payload.type || "exec");
      if (!["exec", "http", "mcp"].includes(type)) throw new Error("TOOL_TYPE_INVALID");
      return { id, name, description, type, enabled, capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.map(String).slice(0, 40) : [] };
    }
    const type = String(payload.type || "");
    if (!["database", "object", "http"].includes(type)) throw new Error("STORAGE_TARGET_TYPE_INVALID");
    const credentialRef = String(payload.credentialRef || "");
    if (credentialRef && (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(credentialRef) || /secret|token|password|key=/i.test(credentialRef))) throw new Error("STORAGE_CREDENTIAL_REFERENCE_INVALID");
    return { id, name, description, type, enabled, credentialRef: credentialRef || undefined, access: "scoped" };
  };
  return Object.freeze({
    listCatalog: (kind) => store.listCatalog(kind),
    async saveCatalogItem(kind, payload) { return store.putCatalogItem(kind, validateCatalogItem(kind, payload)); },
    listDatasets: () => store.listDatasets(),
    async createDatasetVersion(payload) {
      const resourceId = requireId(payload?.resourceId, "DATASET_ID");
      const versionId = requireId(payload?.versionId, "DATASET_VERSION");
      const result = await store.createDatasetVersion({ ...payload, resourceId, versionId });
      return result;
    },
    async readDatasetVersion(resourceId, versionId) {
      const result = await store.readDatasetFiles(requireId(resourceId, "DATASET_ID"), requireId(versionId, "DATASET_VERSION"));
      return { metadata: result.metadata, files: result.files };
    },
    listRoleTemplates: () => store.listRoleTemplates(),
    async createRoleTemplate(payload) {
      const roleId = requireId(payload?.roleId, "ROLE_TEMPLATE_ID");
      const versionId = requireId(payload?.versionId, "ROLE_TEMPLATE_VERSION");
      return store.createRoleTemplate({ ...payload, roleId, versionId });
    },
    getRoleTemplate: (roleId, versionId) => store.readRoleTemplate(requireId(roleId, "ROLE_TEMPLATE_ID"), requireId(versionId, "ROLE_TEMPLATE_VERSION"))
  });
}
