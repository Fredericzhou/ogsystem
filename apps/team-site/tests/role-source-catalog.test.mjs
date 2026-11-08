import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createFileRoleSourceCatalogStore } from "../infrastructure/file-role-source-catalog-store.mjs";
import { createRoleSourceCatalogUseCases } from "../application/role-source-catalog-use-cases.mjs";
import { handleRoleSourceCatalogRoutes } from "../api/role-source-catalog-routes.mjs";
import { handleRoleSourceAdminRoutes } from "../api/role-source-admin-routes.mjs";

const execFile = promisify(execFileCallback);

async function git(cwd, ...args) {
  await execFile("git", ["-c", "user.name=Catalog Test", "-c", "user.email=catalog@example.test", ...args], { cwd });
}

test("role source catalog pins immutable commit indexes and previews original Markdown", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-role-source-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceId = "agency-agents";
  const checkout = join(root, "sources", sourceId, "checkout");
  await mkdir(join(checkout, "engineering", "notes", "deep"), { recursive: true });
  await mkdir(join(checkout, "new-discipline", "nested"), { recursive: true });
  await mkdir(join(checkout, "examples"), { recursive: true });
  await git(checkout, "init", "--quiet");
  await git(checkout, "remote", "add", "origin", "https://github.com/example/agency-agents.git");
  await writeFile(join(checkout, "engineering/frontend.md"), "---\nname: Frontend\n---\n# Keep body\n");
  await writeFile(join(checkout, "engineering/notes/deep/guide.md"), "A Markdown note without role metadata.\n");
  await writeFile(join(checkout, "new-discipline/nested/researcher.md"), "---\nname: Researcher\n---\n# New category\n");
  await writeFile(join(checkout, "examples/example.md"), "---\nname: Ignored\n---\n");
  await writeFile(join(checkout, "README.md"), "Repository overview, not a role.");
  await git(checkout, "add", ".");
  await git(checkout, "commit", "--quiet", "-m", "first");
  const commit = (await execFile("git", ["rev-parse", "HEAD"], { cwd: checkout })).stdout.trim();
  const store = createFileRoleSourceCatalogStore({
    root,
    resolveHost: async () => [{ address: "93.184.216.34", family: 4 }],
    adapters: { "agency-agents-markdown": { shouldIndex: (path) => path.includes("/") && !path.startsWith("examples/"), parseMarkdownRole: (markdown, { category }) => {
      if (!markdown.startsWith("---")) throw Object.assign(new Error("Missing role metadata"), { code: "ROLE_METADATA_MISSING" });
      const name = /^name:\s*(.+)$/m.exec(markdown)?.[1] || "Unnamed";
      return { name, description: "Build UI", category, language: "en", body: markdown.slice(markdown.indexOf("---", 4) + 3), metadata: { emoji: "🧭", color: "#0077B6" }, sourceDigest: createHash("sha256").update(markdown).digest("hex") };
    } } }
  });
  await store.configureSource({ sourceId, gitUrl: "https://github.com/example/agency-agents.git", branch: "main", adapterId: "agency-agents-markdown" });
  const index = await store.refreshSourceIndex(sourceId);
  assert.equal(index.commit, commit);
  assert.equal(index.roles.length, 3);
  assert.equal(index.roles[0].name, "Frontend");
  assert.deepEqual(index.roles[0].icon, { type: "emoji", value: "🧭" });
  assert.equal(index.roles[0].display.color, "#0077B6");
  assert.deepEqual(index.inventory, { completeness: "unverified", candidateMarkdownFiles: 3, readyRoles: 2, unsupportedCandidates: 1 });
  assert.equal(index.roles.find((item) => item.name === "Researcher").category, "new-discipline");
  assert.equal(index.roles.find((item) => item.name === "Researcher").path, "new-discipline/nested/researcher.md");
  assert.equal(index.roles.find((item) => item.name === "guide").status, "unsupported");
  const opened = await store.readRole(sourceId, index.roles[0].roleId, commit);
  assert.match(opened.markdown, /name: Frontend/);
  await writeFile(join(checkout, "engineering/frontend.md"), "---\nname: Frontend\n---\n# Updated body\n");
  await symlink("frontend.md", join(checkout, "engineering/linked.md"));
  await git(checkout, "add", ".");
  await git(checkout, "commit", "--quiet", "-m", "second");
  const newer = await store.refreshSourceIndex(sourceId);
  assert.notEqual(newer.commit, commit);
  const linked = newer.roles.find((item) => item.path === "engineering/linked.md");
  assert.equal(linked.status, "unsupported");
  assert.deepEqual(linked.diagnostics, ["ROLE_SOURCE_SYMLINK_REJECTED"]);
  assert.match((await store.readRole(sourceId, index.roles[0].roleId, commit)).markdown, /# Keep body/);
  assert.match((await store.readRole(sourceId, newer.roles[0].roleId, newer.commit)).markdown, /# Updated body/);
  assert.equal((await store.listSources())[0].commit, newer.commit);
  const versions = await store.listSourceVersions(sourceId);
  assert.deepEqual(versions.map(({ commit: versionCommit, roleCount }) => ({ commit: versionCommit, roleCount })).sort((a, b) => a.commit.localeCompare(b.commit)), [
    { commit, roleCount: 3 }, { commit: newer.commit, roleCount: 4 }
  ].sort((a, b) => a.commit.localeCompare(b.commit)));
  assert.deepEqual((await store.listSources())[0].inventory, { completeness: "unverified", candidateMarkdownFiles: 4, readyRoles: 2, unsupportedCandidates: 2 });
  const pinnedFile = join(root, "sources", sourceId, "indexes", commit, "files", "engineering", "frontend.md");
  await chmod(pinnedFile, 0o600);
  await writeFile(pinnedFile, "tampered");
  await assert.rejects(store.readRole(sourceId, index.roles[0].roleId, commit), { message: "ROLE_SOURCE_SNAPSHOT_DIGEST_MISMATCH" });
});

test("role source configuration rejects unsafe URLs and adapter IDs", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-role-source-invalid-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createFileRoleSourceCatalogStore({ root, resolveHost: async () => [{ address: "93.184.216.34", family: 4 }], adapters: { "agency-agents-markdown": {} } });
  for (const gitUrl of ["file:///tmp/repo", "http://github.com/owner/repo.git", "https://user:pass@github.com/owner/repo.git", "https://github.com:443/owner/repo.git", "https://127.0.0.1/repo.git", "https://localhost/repo.git"]) {
    await assert.rejects(store.configureSource({ sourceId: "unsafe", gitUrl, branch: "main", adapterId: "agency-agents-markdown" }), { message: "ROLE_SOURCE_GIT_URL_INVALID" });
  }
  await assert.rejects(store.configureSource({ sourceId: "unsafe", gitUrl: "https://github.com/owner/repo.git", branch: "main", adapterId: "../module" }), { message: "ROLE_SOURCE_ADAPTER_INVALID" });
  const privateDnsStore = createFileRoleSourceCatalogStore({ root: join(root, "private-dns"), resolveHost: async () => [{ address: "10.0.0.8", family: 4 }], adapters: { "agency-agents-markdown": {} } });
  await assert.rejects(privateDnsStore.configureSource({ sourceId: "unsafe", gitUrl: "https://public-looking.example/repo.git", branch: "main", adapterId: "agency-agents-markdown" }), { message: "ROLE_SOURCE_GIT_HOST_NOT_PUBLIC" });
});

test("role source display name and enabled state can change while identity fields stay immutable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-role-source-config-edit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let dnsChecks = 0;
  const store = createFileRoleSourceCatalogStore({ root, resolveHost: async () => { dnsChecks += 1; return [{ address: "93.184.216.34", family: 4 }]; }, adapters: { "agency-agents-markdown": { version: "1" } } });
  await store.configureSource({ sourceId: "agency-agents", name: "Agency Agents", gitUrl: "https://github.com/example/agency-agents.git", branch: "main", adapterId: "agency-agents-markdown" });
  const updated = await store.configureSource({ sourceId: "agency-agents", name: "Agency", enabled: false });
  assert.equal(updated.name, "Agency");
  assert.equal(updated.enabled, false);
  assert.equal(updated.gitUrl, "https://github.com/example/agency-agents.git");
  assert.equal(dnsChecks, 1, "display name and enabled updates should not require DNS or network access");
  await assert.rejects(store.configureSource({ sourceId: "agency-agents", name: "Agency", gitUrl: "https://github.com/example/other.git" }), { message: "ROLE_SOURCE_CONFIG_IMMUTABLE" });
  await store.updateSyncStatus("agency-agents", { state: "failed", lastError: "temporary" });
  assert.equal((await store.listConfiguredSources())[0].syncStatus.lastError, "temporary");
  assert.equal((await store.listSources())[0].gitUrl, undefined, "the browsing API omits Git configuration");
  await store.updateSyncStatus("agency-agents", { state: "succeeded", lastSuccessAt: "2026-10-27T01:00:00.000Z" });
  assert.equal((await store.listSources())[0].updatedAt, "2026-10-27T01:00:00.000Z");
});

test("role source checkout rejects a symlinked Git metadata directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-role-source-gitdir-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createFileRoleSourceCatalogStore({ root, resolveHost: async () => [{ address: "93.184.216.34", family: 4 }], adapters: { "agency-agents-markdown": {} } });
  await store.configureSource({ sourceId: "agency-agents", gitUrl: "https://github.com/example/agency-agents.git", branch: "main", adapterId: "agency-agents-markdown" });
  const checkout = join(root, "sources", "agency-agents", "checkout");
  const externalGitDir = join(root, "external.git");
  await mkdir(checkout, { recursive: true });
  await mkdir(externalGitDir, { recursive: true });
  await symlink(externalGitDir, join(checkout, ".git"));
  await assert.rejects(store.refreshSourceIndex("agency-agents"), { message: "ROLE_SOURCE_CHECKOUT_INVALID" });
});

function routeHarness({ remoteAddress = "127.0.0.1", useCases = {} } = {}) {
  const sent = [];
  return {
    sent,
    invoke(method, path, body = {}) {
      return handleRoleSourceCatalogRoutes({
        request: { method, socket: { remoteAddress } }, response: {}, url: new URL(`http://site.test${path}`),
        readBody: async () => body, sendJson: (_response, status, payload) => sent.push({ status, payload }),
        errorStatus: () => 400,
        useCases: {
          listRoleSources: async () => [], configureRoleSource: async (value) => value,
          listRoleSourceVersions: async () => [{ commit: "a".repeat(40), updatedAt: "2026-10-27T00:00:00.000Z", roleCount: 3 }],
          synchronizeRoleSource: async () => ({ commit: "a".repeat(40) }), refreshRoleSourceIndex: async () => ({ commit: "b".repeat(40) }),
          getRoleSourceRole: async () => ({ role: { roleId: "frontend" }, markdown: "# source", source: {} }),
          copyRoleSourceRoleToDraft: async (value) => value,
          ...useCases
        }
      });
    }
  };
}

function adminRouteHarness({ remoteAddress = "127.0.0.1", localAddress = "127.0.0.1", useCases = {}, scheduler = {} } = {}) {
  const sent = [];
  return {
    sent,
    invoke(method, path, body = {}) {
      return handleRoleSourceAdminRoutes({
        request: { method, socket: { remoteAddress, localAddress } }, response: {}, url: new URL(`http://site.test${path}`),
        readBody: async () => body, sendJson: (_response, status, payload) => sent.push({ status, payload }),
        errorStatus: () => 400,
        useCases: { listConfiguredRoleSources: async () => [{ sourceId: "agency-agents", enabled: true }], configureRoleSource: async (value) => value, ...useCases },
        scheduler: { enqueue: (sourceId, operation) => ({ accepted: true, sourceId, operation }), ...scheduler }
      });
    }
  };
}

test("role source administration accepts same-LAN, Tailnet, and loopback clients and queues updates asynchronously", async () => {
  const internet = adminRouteHarness({ remoteAddress: "203.0.113.8" });
  assert.equal(await internet.invoke("POST", "/api/v1/platform/role-sources", {}), true);
  assert.equal(internet.sent[0].status, 403);
  const carrierNat = adminRouteHarness({ remoteAddress: "100.66.1.2", localAddress: "198.51.100.10" });
  await carrierNat.invoke("GET", "/api/v1/platform/role-sources");
  assert.equal(carrierNat.sent[0].status, 403, "the shared CGNAT range alone must not grant administration");
  const crossLan = adminRouteHarness({ remoteAddress: "192.168.1.8", localAddress: "192.168.0.109" });
  await crossLan.invoke("GET", "/api/v1/platform/role-sources");
  assert.equal(crossLan.sent[0].status, 403, "a different private LAN must not grant administration");
  const sameLan = adminRouteHarness({ remoteAddress: "192.168.0.8", localAddress: "192.168.0.109" });
  await sameLan.invoke("GET", "/api/v1/platform/role-sources");
  assert.equal(sameLan.sent[0].status, 200);
  const enqueued = [];
  const tailnet = adminRouteHarness({
    remoteAddress: "100.66.1.2",
    localAddress: "100.66.1.3",
    useCases: { configureRoleSource: async (value) => ({ ...value, enabled: true }) },
    scheduler: { enqueue: (...value) => { enqueued.push(value); return { accepted: true, alreadyRunning: false }; } }
  });
  assert.equal(await tailnet.invoke("POST", "/api/v1/platform/role-sources", { sourceId: "agency-agents" }), true);
  assert.equal(tailnet.sent[0].status, 201);
  assert.equal(tailnet.sent[0].payload.sync, "manual");
  assert.deepEqual(enqueued, [], "registering or enabling a source must not synchronize it automatically");
  await tailnet.invoke("POST", "/api/v1/platform/role-sources/agency-agents/sync");
  assert.deepEqual(enqueued, [["agency-agents", "sync"]]);
  const disabled = adminRouteHarness({ useCases: { listConfiguredRoleSources: async () => [{ sourceId: "agency-agents", enabled: false }] } });
  await disabled.invoke("POST", "/api/v1/platform/role-sources/agency-agents/sync");
  assert.equal(disabled.sent[0].status, 409);
  assert.equal(disabled.sent[0].payload.error, "ROLE_SOURCE_DISABLED");
  const local = adminRouteHarness();
  assert.equal(await local.invoke("POST", "/api/v1/platform/role-sources/agency-agents/sync"), true);
  assert.equal(local.sent[0].status, 202);
  assert.equal(local.sent[0].payload.operation, "sync");
});

test("role catalog has no source mutation or synchronous sync endpoints", async () => {
  const remote = routeHarness({ remoteAddress: "203.0.113.8" });
  assert.equal(await remote.invoke("POST", "/api/v1/studio/role-sources", {}), false);
  assert.equal(await remote.invoke("POST", "/api/v1/studio/role-sources/agency-agents/sync"), false);
  assert.equal(await remote.invoke("POST", "/api/v1/studio/role-sources/agency-agents/roles/frontend/copy", { teamVersionId: "team-v1", roleId: "frontend" }), true);
  assert.equal(remote.sent[0].status, 201);

  let copied;
  const local = routeHarness({ useCases: { copyRoleSourceRoleToDraft: async (payload) => { copied = payload; return { saved: true }; } } });
  assert.equal(await local.invoke("POST", "/api/v1/studio/role-sources/agency-agents/roles/engineering-frontend-12345678/copy", { teamVersionId: "team-v1", roleId: "frontend" }), true);
  assert.equal(local.sent.at(-1).status, 201);
  assert.equal(copied.events, undefined);
  assert.equal(copied.allowedTools, undefined);
  assert.equal(copied.sourceId, "agency-agents");
});

test("role source versions endpoint exposes immutable commit summaries", async () => {
  const h = routeHarness();
  assert.equal(await h.invoke("GET", "/api/v1/studio/role-sources/agency-agents/versions"), true);
  assert.deepEqual(h.sent.at(-1), {
    status: 200,
    payload: { versions: [{ commit: "a".repeat(40), updatedAt: "2026-10-27T00:00:00.000Z", roleCount: 3 }] }
  });
});

test("role trial route pins the requested source commit and forwards structured input", async () => {
  let trialPayload;
  const h = routeHarness({ useCases: { trialRoleSourceRole: async (payload) => { trialPayload = payload; return { status: "completed" }; } } });
  assert.equal(await h.invoke("POST", "/api/v1/studio/role-sources/agency-agents/roles/frontend/trial?commit=" + "a".repeat(40), {
    task: "Summarize", input: { document: "hello" }, userPreferences: "concise"
  }), true);
  assert.equal(h.sent.at(-1).status, 200);
  assert.equal(trialPayload.commit, "a".repeat(40));
  assert.deepEqual(trialPayload.input, { document: "hello" });
  assert.equal(trialPayload.sourceId, "agency-agents");
});

test("copy use case converts the selected immutable source version and leaves missing confirmations unverified", async () => {
  const source = { sourceId: "agency-agents", gitUrl: "https://github.com/example/agency-agents.git", adapterId: "agency-agents-markdown", adapterVersion: "1" };
  const role = { roleId: "engineering-frontend-12345678", name: "Frontend", path: "engineering/frontend.md", category: "engineering", language: "en", sourceDigest: "sha256:original", status: "ready" };
  const store = { readRole: async () => ({ source, role, markdown: "---\nname: Frontend\n---\nBody", commit: "a".repeat(40) }) };
  const calls = [];
  const adapter = { convertMarkdownRole: (value) => { calls.push(value); return { roleId: value.roleId || "frontend", files: { "source.json": "{}" }, verification: { status: "unverified" } }; } };
  const copied = [];
  const useCases = createRoleSourceCatalogUseCases({ store, adapters: { "agency-agents-markdown": adapter }, copyRoleSourceToDraft: async (value) => { copied.push(value); return value; } });
  await useCases.copyRoleSourceRoleToDraft({ sourceId: "agency-agents", roleKey: role.roleId, teamVersionId: "team-v1" });
  assert.equal(calls[0].commit, "a".repeat(40));
  assert.equal(calls[0].outputEvents, undefined);
  assert.equal(calls[0].allowedTools, undefined);
  assert.equal(copied[0].identityConfirmed, false);
  assert.equal(copied[0].roleId, "frontend");
  assert.equal(copied[0].sourceVersion.path, "engineering/frontend.md");

  await useCases.copyRoleSourceRoleToDraft({ sourceId: "agency-agents", roleKey: role.roleId, teamVersionId: "team-v1", roleId: "frontend_dev", events: ["DONE"], allowedTools: [] });
  assert.deepEqual(calls[1].outputEvents, ["DONE"]);
  assert.deepEqual(calls[1].allowedTools, []);
  assert.equal(copied[1].identityConfirmed, true);
});
