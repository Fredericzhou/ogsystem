import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";

const execFile = promisify(execFileCallback);
const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const SHA = /^[a-f0-9]{40}$/;
const MAX_FILES = 5000;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const locks = new Map();

async function resolveHostOverHttps(host) {
  const records = await Promise.all([1, 28].map(async (type) => {
    const query = new URL("https://dns.google/resolve");
    query.searchParams.set("name", host);
    query.searchParams.set("type", String(type));
    let response;
    try {
      response = await fetch(query, {
        headers: { accept: "application/dns-json" },
        redirect: "error",
        signal: AbortSignal.timeout(5000)
      });
    } catch {
      throw new Error("ROLE_SOURCE_GIT_DNS_QUERY_FAILED");
    }
    if (!response.ok) throw new Error("ROLE_SOURCE_GIT_DNS_QUERY_FAILED");
    let result;
    try { result = await response.json(); }
    catch { throw new Error("ROLE_SOURCE_GIT_DNS_RESPONSE_INVALID"); }
    if (result.Status !== 0) throw new Error("ROLE_SOURCE_GIT_DNS_QUERY_FAILED");
    return (Array.isArray(result.Answer) ? result.Answer : [])
      .filter((answer) => answer.type === type && typeof answer.data === "string")
      .map((answer) => ({ address: answer.data, family: type === 1 ? 4 : 6 }));
  }));
  return records.flat();
}

function isPublicIp(address) {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 0 || b === 2 || b === 88 && c === 99 || b === 168) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:") || normalized === "::" || normalized === "::1") return false;
    const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
    return first >= 0x2000 && first <= 0x3fff && !normalized.startsWith("2001:db8:") && !normalized.startsWith("2001:0:");
  }
  return false;
}

async function validateGitUrl(value, resolveHost) {
  const raw = String(value || "");
  let url;
  try { url = new URL(raw); } catch { throw new Error("ROLE_SOURCE_GIT_URL_INVALID"); }
  const host = url.hostname.toLowerCase();
  const authority = /^https:\/\/([^/?#]+)/i.exec(raw)?.[1] || "";
  const explicitPort = /:\d+$/.test(authority);
  if (url.protocol !== "https:" || url.username || url.password || explicitPort || url.port || !host.includes(".") || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".test") || host.endsWith(".invalid") || isIP(host) || host.includes(":")) {
    throw new Error("ROLE_SOURCE_GIT_URL_INVALID");
  }
  let addresses;
  try { addresses = await resolveHost(host); } catch { throw new Error("ROLE_SOURCE_GIT_HOST_UNRESOLVABLE"); }
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address))) throw new Error("ROLE_SOURCE_GIT_HOST_NOT_PUBLIC");
  url.hash = "";
  url.search = "";
  return { canonical: url.toString().replace(/\/$/, ""), host, addresses };
}

function validateBranch(value) {
  const branch = String(value || "").trim();
  if (!branch || branch.length > 200 || branch.startsWith("-") || branch.startsWith("/") || branch.endsWith("/") || branch.includes("..") || branch.includes("@{") || /[\s~^:?*\[\\]/.test(branch) || branch.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))) {
    throw new Error("ROLE_SOURCE_BRANCH_INVALID");
  }
  return branch;
}

function safeRelativePath(value) {
  const path = String(value || "");
  const parts = path.split("/");
  if (!path || path.startsWith("/") || path.includes("\\") || path.length > 4096 || parts.some((part) => !part || part === "." || part === ".." || part.includes("\0"))) return false;
  return true;
}

function slug(value) {
  return String(value || "role").normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 58) || "role";
}

function sourceRoleId(path, name) {
  const category = path.split("/")[0] || "role";
  const key = slug(name || path.split("/").at(-1)?.replace(/\.md$/i, ""));
  const digest = createHash("sha256").update(path).digest("hex").slice(0, 8);
  return `${slug(category).slice(0, 15)}-${key.slice(0, 45)}-${digest}`;
}

function gitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("GIT_") || ["SSH_ASKPASS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].includes(key)) delete env[key];
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", GIT_OPTIONAL_LOCKS: "0" };
}

async function runGit(repoPath, args, { allowFailure = false, binary = false, curloptResolve } = {}) {
  try {
    const gitArgs = ["-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, "-c", "core.autocrlf=false", "-c", "core.fsmonitor=false", "-c", "fetch.recurseSubmodules=false", "-c", "http.followRedirects=false"];
    if (curloptResolve) gitArgs.push("-c", `http.curloptResolve=${curloptResolve}`);
    const result = await execFile("git", [...gitArgs, ...args], { cwd: repoPath, env: gitEnv(), encoding: "buffer", maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return binary ? result.stdout : Buffer.isBuffer(result.stdout) ? result.stdout.toString("utf8") : result.stdout;
  } catch (error) {
    if (allowFailure) return null;
    const detail = String(error.stderr || error.message || "").slice(0, 1000);
    const failure = new Error("ROLE_SOURCE_GIT_OPERATION_FAILED");
    failure.detail = detail;
    throw failure;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

function treeEntries(raw) {
  const entries = [];
  for (const record of raw.split("\0")) {
    if (!record) continue;
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const [mode, type, object] = record.slice(0, tab).split(" ");
    entries.push({ mode, type, object, path: record.slice(tab + 1) });
  }
  return entries;
}

async function withSourceLock(sourceId, callback) {
  const previous = locks.get(sourceId) || Promise.resolve();
  let release;
  const current = new Promise((resolvePromise) => { release = resolvePromise; });
  const queued = previous.then(() => current);
  locks.set(sourceId, queued);
  await previous;
  try { return await callback(); }
  finally {
    release();
    if (locks.get(sourceId) === queued) locks.delete(sourceId);
  }
}

export function createFileRoleSourceCatalogStore({ root, adapters = {}, resolveHost = resolveHostOverHttps }) {
  if (!root) throw new TypeError("Role source catalog root is required.");
  const catalogRoot = resolve(root);
  const configPath = join(catalogRoot, "sources.json");
  const syncStatusPath = join(catalogRoot, "sync-status.json");
  const sourceDir = (id) => join(catalogRoot, "sources", id);
  const repoDir = (id) => join(sourceDir(id), "checkout");
  const indexDir = (id, commit) => join(sourceDir(id), "indexes", commit);
  const validateId = (value) => {
    const id = String(value || "").trim();
    if (!ID.test(id)) throw new Error("ROLE_SOURCE_ID_INVALID");
    return id;
  };

  async function readConfigs() {
    const result = await readJson(configPath, { version: 1, sources: [] });
    if (result.version !== 1 || !Array.isArray(result.sources)) throw new Error("ROLE_SOURCE_CONFIG_CORRUPT");
    return result.sources;
  }

  async function getConfig(id) {
    const source = (await readConfigs()).find((item) => item.sourceId === validateId(id));
    if (!source) throw new Error("NOT_FOUND");
    return source;
  }

  async function ensureRepo(source) {
    const directory = repoDir(source.sourceId);
    await mkdir(sourceDir(source.sourceId), { recursive: true });
    try {
      const checkoutInfo = await lstat(directory);
      if (!checkoutInfo.isDirectory() || checkoutInfo.isSymbolicLink()) throw new Error("ROLE_SOURCE_CHECKOUT_INVALID");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const gitDir = join(directory, ".git");
    try {
      const gitInfo = await lstat(gitDir);
      if (!gitInfo.isDirectory() || gitInfo.isSymbolicLink()) throw new Error("ROLE_SOURCE_CHECKOUT_INVALID");
    }
    catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(directory, { recursive: true });
      await runGit(directory, ["init", "--quiet"]);
      await runGit(directory, ["remote", "add", "origin", source.gitUrl]);
    }
    const currentRemote = await runGit(directory, ["remote", "get-url", "origin"]);
    const remote = await validateGitUrl(currentRemote.trim(), resolveHost);
    if (remote.canonical !== source.gitUrl) throw new Error("ROLE_SOURCE_CHECKOUT_REMOTE_MISMATCH");
    const executableConfig = await runGit(directory, ["config", "--local", "--name-only", "--get-regexp", "^(filter\\..+\\.(smudge|clean|process|required)|credential\\.helper|core\\.(askPass|fsmonitor|sshCommand|gitProxy|worktree)|extensions\\.worktreeconfig|url\\..+\\.insteadof|include(if)?\\..*|remote\\.origin\\.(uploadpack|receivepack|proxy)|http\\..*)$"], { allowFailure: true });
    if (executableConfig?.trim()) throw new Error("ROLE_SOURCE_CHECKOUT_EXEC_CONFIG_REJECTED");
    return { directory, curloptResolve: `${remote.host}:443:${remote.addresses.map((entry) => entry.address).join(",")}` };
  }

  async function indexCommit(source, commit, updatedAt) {
    if (!SHA.test(commit)) throw new Error("ROLE_SOURCE_COMMIT_INVALID");
    const destination = indexDir(source.sourceId, commit);
    const existing = await readJson(join(destination, "index.json"), null);
    if (existing) return existing;
    const repo = repoDir(source.sourceId);
    const rawTree = await runGit(repo, ["ls-tree", "-rz", "--full-tree", "-r", commit]);
    const files = treeEntries(rawTree);
    if (files.length > MAX_FILES) throw new Error("ROLE_SOURCE_FILE_COUNT_LIMIT");
    const sourceAdapter = adapters[source.adapterId];
    const markdownFiles = files.filter((entry) => entry.type === "blob" && entry.path.toLowerCase().endsWith(".md") && (!sourceAdapter?.shouldIndex || sourceAdapter.shouldIndex(entry.path)));
    let totalBytes = 0;
    const roles = [];
    const stagedFiles = [];
    for (const entry of markdownFiles) {
      if (!safeRelativePath(entry.path)) {
        roles.push({ roleId: sourceRoleId(entry.path, "invalid-path"), path: entry.path, status: "unsupported", diagnostics: ["ROLE_SOURCE_PATH_INVALID"] });
        continue;
      }
      if (entry.mode === "120000") {
        roles.push({ roleId: sourceRoleId(entry.path), path: entry.path, status: "unsupported", diagnostics: ["ROLE_SOURCE_SYMLINK_REJECTED"], commit, updatedAt });
        continue;
      }
      const contentBytes = await runGit(repo, ["show", `${commit}:${entry.path}`], { binary: true });
      const content = contentBytes.toString("utf8");
      if (!Buffer.from(content, "utf8").equals(contentBytes)) {
        roles.push({ roleId: sourceRoleId(entry.path), path: entry.path, status: "unsupported", diagnostics: ["ROLE_SOURCE_TEXT_ENCODING_INVALID"], commit, updatedAt });
        continue;
      }
      const bytes = Buffer.byteLength(content, "utf8");
      totalBytes += bytes;
      if (bytes > MAX_FILE_BYTES) {
        roles.push({ roleId: sourceRoleId(entry.path), path: entry.path, status: "unsupported", diagnostics: ["ROLE_SOURCE_FILE_SIZE_LIMIT"], commit, updatedAt });
        continue;
      }
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error("ROLE_SOURCE_TOTAL_SIZE_LIMIT");
      stagedFiles.push({ path: entry.path, content });
      const adapter = sourceAdapter;
      if (!adapter || typeof adapter.parseMarkdownRole !== "function") {
        roles.push({ roleId: sourceRoleId(entry.path), path: entry.path, category: entry.path.split("/")[0], status: "unsupported", diagnostics: ["ROLE_SOURCE_ADAPTER_UNAVAILABLE"], commit, updatedAt });
        continue;
      }
      try {
        const category = entry.path.split("/")[0] || "uncategorized";
        const parsed = adapter.parseMarkdownRole(content, { category });
        const name = String(parsed.name || "").slice(0, 120);
        roles.push({
          roleId: sourceRoleId(entry.path, name), name, category: category.slice(0, 80),
          description: String(parsed.description || "").slice(0, 1000), language: String(parsed.language || "und").slice(0, 16),
          path: entry.path, commit, updatedAt, adapterId: source.adapterId, adapterVersion: source.adapterVersion,
          icon: parsed.metadata?.emoji ? { type: "emoji", value: String(parsed.metadata.emoji).slice(0, 16) } : { type: "builtin", value: "role" },
          display: { color: /^#[0-9a-f]{6}$/i.test(parsed.metadata?.color || "") ? parsed.metadata.color : undefined, vibe: String(parsed.metadata?.vibe || "").slice(0, 160) },
          sourceDigest: parsed.sourceDigest, status: "ready", diagnostics: []
        });
      } catch (error) {
        roles.push({ roleId: sourceRoleId(entry.path), name: entry.path.split("/").at(-1).replace(/\.md$/i, ""), category: entry.path.split("/")[0], path: entry.path, commit, updatedAt, adapterId: source.adapterId, adapterVersion: source.adapterVersion, icon: { type: "builtin", value: "role" }, status: "unsupported", diagnostics: [String(error.code || "ROLE_SOURCE_PARSE_FAILED")] });
      }
    }
    const inventory = {
      completeness: "unverified",
      candidateMarkdownFiles: markdownFiles.length,
      readyRoles: roles.filter((role) => role.status === "ready").length,
      unsupportedCandidates: roles.filter((role) => role.status !== "ready").length
    };
    const snapshot = { version: 1, sourceId: source.sourceId, gitUrl: source.gitUrl, branch: source.branch, adapterId: source.adapterId, adapterVersion: source.adapterVersion, commit, updatedAt, inventory, roles };
    const versionsRoot = join(sourceDir(source.sourceId), "indexes");
    const stage = join(versionsRoot, `.index-${randomUUID()}`);
    await mkdir(join(stage, "files"), { recursive: true });
    try {
      for (const file of stagedFiles) {
        const path = join(stage, "files", ...file.path.split("/"));
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.content, { encoding: "utf8", flag: "wx", mode: 0o400 });
      }
      await atomicJson(join(stage, "index.json"), snapshot);
      await mkdir(versionsRoot, { recursive: true });
      await rename(stage, destination);
      return snapshot;
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        const committed = await readJson(join(destination, "index.json"), null);
        if (committed) return committed;
      }
      throw error;
    }
  }

  return Object.freeze({
    async listSources() {
      const configs = await readConfigs();
      const statusData = await readJson(syncStatusPath, { version: 1, sources: {} });
      return Promise.all(configs.map(async (source) => {
        const latest = await readJson(join(sourceDir(source.sourceId), "current-index.json"), null);
        return {
          sourceId: source.sourceId, name: source.name, enabled: source.enabled !== false,
          commit: latest?.commit || null, updatedAt: statusData.sources?.[source.sourceId]?.lastSuccessAt || latest?.updatedAt || null,
          inventory: latest?.inventory || null, roles: latest?.roles || [],
          syncStatus: statusData.sources?.[source.sourceId] || null
        };
      }));
    },
    async listConfiguredSources() {
      const configs = await readConfigs();
      const statusData = await readJson(syncStatusPath, { version: 1, sources: {} });
      return Promise.all(configs.map(async (source) => {
        const latest = await readJson(join(sourceDir(source.sourceId), "current-index.json"), null);
        return {
          ...source, commit: latest?.commit || null, updatedAt: statusData.sources?.[source.sourceId]?.lastSuccessAt || latest?.updatedAt || null,
          inventory: latest?.inventory || null, syncStatus: statusData.sources?.[source.sourceId] || null
        };
      }));
    },
    async getSyncStatus(sourceId) {
      const id = validateId(sourceId);
      const statusData = await readJson(syncStatusPath, { version: 1, sources: {} });
      return statusData.sources?.[id] || null;
    },
    async updateSyncStatus(sourceId, status) {
      const id = validateId(sourceId);
      const statusData = await readJson(syncStatusPath, { version: 1, sources: {} });
      const next = { ...statusData, version: 1, sources: { ...(statusData.sources || {}), [id]: status } };
      await atomicJson(syncStatusPath, next);
      return status;
    },
    async listSourceVersions(sourceId) {
      const id = validateId(sourceId);
      await getConfig(id);
      const versionsRoot = join(sourceDir(id), "indexes");
      let entries;
      try { entries = await readdir(versionsRoot, { withFileTypes: true }); }
      catch (error) { if (error?.code === "ENOENT") return []; throw error; }
      const versions = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !SHA.test(entry.name)) continue;
        const index = await readJson(join(versionsRoot, entry.name, "index.json"), null);
        if (!index || index.sourceId !== id || index.commit !== entry.name || !Array.isArray(index.roles)) throw new Error("ROLE_SOURCE_INDEX_CORRUPT");
        versions.push({ commit: index.commit, updatedAt: index.updatedAt, roleCount: index.roles.length });
      }
      return versions.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)) || right.commit.localeCompare(left.commit));
    },
    async configureSource(payload) {
      const sourceId = validateId(payload?.sourceId);
      const configs = await readConfigs();
      const existing = configs.find((item) => item.sourceId === sourceId);
      const name = String(payload?.name ?? existing?.name ?? sourceId).trim().slice(0, 120);
      if (!name) throw new Error("ROLE_SOURCE_NAME_INVALID");
      const gitUrl = existing && payload?.gitUrl === undefined
        ? existing.gitUrl
        : (await validateGitUrl(payload?.gitUrl ?? existing?.gitUrl, resolveHost)).canonical;
      const branch = validateBranch(payload?.branch ?? existing?.branch ?? "main");
      const adapterId = String(payload?.adapterId ?? existing?.adapterId ?? "").trim();
      if (!ID.test(adapterId) || !adapters[adapterId]) throw new Error("ROLE_SOURCE_ADAPTER_INVALID");
      const registeredAdapterVersion = String(adapters[adapterId].version || "1");
      const adapterVersion = String(payload?.adapterVersion ?? existing?.adapterVersion ?? registeredAdapterVersion).trim();
      if (!/^\d+(?:\.\d+){0,2}$/.test(adapterVersion) || adapterVersion !== registeredAdapterVersion) throw new Error("ROLE_SOURCE_ADAPTER_VERSION_INVALID");
      if (existing && (existing.gitUrl !== gitUrl || existing.branch !== branch || existing.adapterId !== adapterId)) throw new Error("ROLE_SOURCE_CONFIG_IMMUTABLE");
      if (payload?.enabled !== undefined && typeof payload.enabled !== "boolean") throw new Error("ROLE_SOURCE_ENABLED_INVALID");
      const source = { sourceId, name, gitUrl, branch, adapterId, adapterVersion, enabled: payload?.enabled ?? existing?.enabled ?? true };
      const next = existing ? configs.map((item) => item.sourceId === sourceId ? source : item) : [...configs, source];
      await atomicJson(configPath, { version: 1, sources: next });
      return source;
    },
    async synchronizeSource(sourceId) {
      return withSourceLock(validateId(sourceId), async () => {
        const source = await getConfig(sourceId);
        if (!source.enabled) throw new Error("ROLE_SOURCE_DISABLED");
        const checkout = await ensureRepo(source);
        const repo = checkout.directory;
        const gitConfigNames = await runGit(repo, ["help", "--config"]);
        if (!gitConfigNames.includes("http.curloptResolve")) throw new Error("ROLE_SOURCE_GIT_VERSION_UNSUPPORTED");
        const dirty = await runGit(repo, ["status", "--porcelain"]);
        if (dirty.trim()) throw new Error("ROLE_SOURCE_CHECKOUT_DIRTY");
        await runGit(repo, ["fetch", "--no-tags", "--no-recurse-submodules", "origin", source.branch], { curloptResolve: checkout.curloptResolve });
        const target = (await runGit(repo, ["rev-parse", "FETCH_HEAD"])).trim();
        if (!SHA.test(target)) throw new Error("ROLE_SOURCE_COMMIT_INVALID");
        const current = await runGit(repo, ["rev-parse", "HEAD"], { allowFailure: true });
        if (current?.trim() && current.trim() !== target) {
          const ancestor = await runGit(repo, ["merge-base", "--is-ancestor", current.trim(), target], { allowFailure: true });
          if (ancestor === null) throw new Error("ROLE_SOURCE_NON_FAST_FORWARD");
        }
        await runGit(repo, ["checkout", "--quiet", "--detach", target]);
        const indexed = await indexCommit(source, target, new Date().toISOString());
        await atomicJson(join(sourceDir(source.sourceId), "current-index.json"), indexed);
        return indexed;
      });
    },
    async refreshSourceIndex(sourceId) {
      return withSourceLock(validateId(sourceId), async () => {
        const source = await getConfig(sourceId);
        const { directory: repo } = await ensureRepo(source);
        const commit = (await runGit(repo, ["rev-parse", "HEAD"])).trim();
        const indexed = await indexCommit(source, commit, new Date().toISOString());
        await atomicJson(join(sourceDir(source.sourceId), "current-index.json"), indexed);
        return indexed;
      });
    },
    async readRole(sourceId, roleKey, commit) {
      const id = validateId(sourceId);
      const config = await getConfig(id);
      const current = await readJson(join(sourceDir(id), "current-index.json"), null);
      const selectedCommit = commit || current?.commit;
      if (!selectedCommit || !SHA.test(selectedCommit)) throw new Error("NOT_FOUND");
      const index = await readJson(join(indexDir(id, selectedCommit), "index.json"), null);
      if (!index) throw new Error("NOT_FOUND");
      const role = index.roles.find((item) => item.roleId === roleKey);
      if (!role) throw new Error("NOT_FOUND");
      if (!safeRelativePath(role.path)) throw new Error("ROLE_SOURCE_PATH_INVALID");
      let content;
      try {
        const bytes = await readFile(join(indexDir(id, selectedCommit), "files", ...role.path.split("/")));
        content = bytes.toString("utf8");
        if (role.status === "ready" && createHash("sha256").update(bytes).digest("hex") !== role.sourceDigest) throw new Error("ROLE_SOURCE_SNAPSHOT_DIGEST_MISMATCH");
      }
      catch (error) { if (role.status !== "unsupported" || error?.code !== "ENOENT") throw error; }
      return { source: config, role, markdown: content, commit: selectedCommit };
    }
  });
}
