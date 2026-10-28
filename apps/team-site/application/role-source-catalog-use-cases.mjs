const TEAM_ROLE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function createRoleSourceCatalogUseCases({ store, adapters = {}, copyRoleSourceToDraft }) {
  if (!store) throw new TypeError("Role source catalog use cases require a catalog store.");
  return Object.freeze({
    listRoleSources: () => store.listSources(),
    listConfiguredRoleSources: () => store.listConfiguredSources(),
    listRoleSourceVersions: (sourceId) => store.listSourceVersions(sourceId),
    configureRoleSource: (payload) => store.configureSource(payload),
    synchronizeRoleSource: (sourceId) => store.synchronizeSource(sourceId),
    refreshRoleSourceIndex: (sourceId) => store.refreshSourceIndex(sourceId),
    getRoleSourceRole: (sourceId, roleKey, commit) => store.readRole(sourceId, roleKey, commit),
    async convertRoleSourceRole(payload) {
      const sourceRole = await store.readRole(payload.sourceId, payload.roleKey, payload.commit);
      if (sourceRole.role.status !== "ready" || typeof sourceRole.markdown !== "string") throw new Error("ROLE_SOURCE_ROLE_UNSUPPORTED");
      const adapter = adapters[sourceRole.source.adapterId];
      if (typeof adapter?.convertMarkdownRole !== "function") throw new Error("ROLE_SOURCE_ADAPTER_UNAVAILABLE");
      return adapter.convertMarkdownRole({
        sourceText: sourceRole.markdown,
        sourceId: sourceRole.source.sourceId,
        gitUrl: sourceRole.source.gitUrl,
        commit: sourceRole.commit,
        sourcePath: sourceRole.role.path,
        adapterId: sourceRole.source.adapterId,
        adapterVersion: sourceRole.source.adapterVersion,
        category: sourceRole.role.category,
        ...(typeof payload.roleId === "string" && TEAM_ROLE_ID.test(payload.roleId) ? { roleId: payload.roleId } : {}),
        ...(Array.isArray(payload.events) ? { outputEvents: payload.events } : {}),
        ...(Array.isArray(payload.allowedTools) ? { allowedTools: payload.allowedTools } : {}),
        ...(payload.identityConfirmed === true ? { identityConfirmed: true } : {})
      });
    },
    async copyRoleSourceRoleToDraft(payload) {
      if (typeof copyRoleSourceToDraft !== "function") throw new Error("ROLE_SOURCE_COPY_UNAVAILABLE");
      const sourceRole = await store.readRole(payload.sourceId, payload.roleKey, payload.commit);
      if (sourceRole.role.status !== "ready" || typeof sourceRole.markdown !== "string") throw new Error("ROLE_SOURCE_ROLE_UNSUPPORTED");
      const adapter = adapters[sourceRole.source.adapterId];
      if (typeof adapter?.convertMarkdownRole !== "function") throw new Error("ROLE_SOURCE_ADAPTER_UNAVAILABLE");
      const roleId = payload.roleId;
      const identityConfirmed = typeof roleId === "string" && TEAM_ROLE_ID.test(roleId);
      const converted = adapter.convertMarkdownRole({
        sourceText: sourceRole.markdown,
        sourceId: sourceRole.source.sourceId,
        gitUrl: sourceRole.source.gitUrl,
        commit: sourceRole.commit,
        sourcePath: sourceRole.role.path,
        adapterId: sourceRole.source.adapterId,
        adapterVersion: sourceRole.source.adapterVersion,
        category: sourceRole.role.category,
        ...(identityConfirmed ? { roleId } : {}),
        ...(Array.isArray(payload.events) ? { outputEvents: payload.events } : {}),
        ...(Array.isArray(payload.allowedTools) ? { allowedTools: payload.allowedTools } : {})
      });
      return copyRoleSourceToDraft({
        teamVersionId: String(payload.teamVersionId || ""),
        roleId: identityConfirmed ? roleId : converted.roleId,
        converted,
        ...(Array.isArray(payload.events) ? { events: payload.events.map(String) } : {}),
        ...(Array.isArray(payload.allowedTools) ? { allowedTools: payload.allowedTools.map(String) } : {}),
        identityConfirmed,
        sourceVersion: {
          sourceId: sourceRole.source.sourceId,
          gitUrl: sourceRole.source.gitUrl,
          commit: sourceRole.commit,
          path: sourceRole.role.path,
          adapterId: sourceRole.source.adapterId,
          adapterVersion: sourceRole.source.adapterVersion,
          language: payload.language || sourceRole.role.language,
          sourceDigest: sourceRole.role.sourceDigest
        }
      });
    }
  });
}
