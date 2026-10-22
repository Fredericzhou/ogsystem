import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, parse, resolve, sep } from "node:path";

const ID = /^[a-z0-9][a-z0-9-]{0,79}$/;
const ROLE_FILES = new Set(["agent.md", "prompt.md", "role.json", "output.schema.json"]);
const fail = (code) => { throw new Error(code); };
function assertId(value, label) { if (!ID.test(String(value || ""))) fail(label + "_INVALID"); }
async function publishJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } catch (error) { await rm(temporary, { force: true }).catch(() => undefined); throw error; }
}

async function ensureSafeDirectory(path) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const segments = absolute.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) fail("RESOURCE_PATH_UNSAFE");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current);
    }
  }
  return absolute;
}

async function assertSafePath(root, segments, { allowMissing = false, kind } = {}) {
  let current = resolve(root);
  const paths = [current];
  for (const segment of segments) {
    if (typeof segment !== "string" || !segment || segment === "." || segment === ".." || /[\\/]/.test(segment)) fail("RESOURCE_PATH_INVALID");
    current = join(current, segment);
    paths.push(current);
  }
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    const final = index === paths.length - 1;
    let info;
    try { info = await lstat(path); }
    catch (error) {
      if (allowMissing && final && error.code === "ENOENT") return path;
      throw error;
    }
    if (info.isSymbolicLink()) fail("RESOURCE_PATH_UNSAFE");
    if (!final && !info.isDirectory()) fail("RESOURCE_PATH_UNSAFE");
    if (final && kind === "directory" && !info.isDirectory()) fail("RESOURCE_PATH_UNSAFE");
    if (final && kind === "file" && !info.isFile()) fail("RESOURCE_PATH_UNSAFE");
  }
  return current;
}

export function createFileSharedResourceStore({ root, now = () => new Date().toISOString() }) {
  if (!root) throw new TypeError("Shared resource root is required.");
  const base = resolve(root);
  const catalogPath = join(base, "resources.json");
  const dataRoot = join(base, "datasets");
  const roleRoot = join(base, "roles");
  let mutationQueue = Promise.resolve();
  async function serializeMutation(operation) {
    const previous = mutationQueue;
    let release;
    mutationQueue = new Promise((resolvePromise) => { release = resolvePromise; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
  async function ensureRoot() {
    await ensureSafeDirectory(base);
    await ensureSafeDirectory(dataRoot);
    await ensureSafeDirectory(roleRoot);
  }
  async function assertVersionAbsent(target) {
    try { await lstat(target); fail("RESOURCE_VERSION_IMMUTABLE"); }
    catch (error) { if (error.message === "RESOURCE_VERSION_IMMUTABLE" || error.code !== "ENOENT") throw error; }
  }
  async function readCatalog() {
    await ensureRoot();
    await assertSafePath(base, ["resources.json"], { allowMissing: true });
    try {
      const value = JSON.parse(await readFile(catalogPath, "utf8"));
      if (value.version !== 1 || !Array.isArray(value.tools) || !Array.isArray(value.storageTargets)) fail("RESOURCE_CATALOG_INVALID");
      return value;
    } catch (error) { if (error.code === "ENOENT") return { version: 1, tools: [], storageTargets: [] }; throw error; }
  }
  return Object.freeze({
    async listCatalog(kind) {
      if (kind !== "tools" && kind !== "storageTargets") fail("RESOURCE_KIND_INVALID");
      await ensureRoot();
      const catalog = await readCatalog();
      return { [kind]: catalog[kind] };
    },
    async putCatalogItem(kind, item) {
      if (kind !== "tools" && kind !== "storageTargets") fail("RESOURCE_KIND_INVALID");
      assertId(item && item.id, "RESOURCE_ID");
      return serializeMutation(async () => {
        await ensureRoot();
        const catalog = await readCatalog();
        const value = Object.assign({}, item, { updatedAt: now() });
        const index = catalog[kind].findIndex((entry) => entry.id === value.id);
        if (index < 0) catalog[kind].push(value); else catalog[kind][index] = value;
        await publishJson(catalogPath, catalog);
        return value;
      });
    },
    async listDatasets() {
      await ensureRoot();
      const datasets = [];
      try {
        for (const entry of await readdir(dataRoot, { withFileTypes: true })) {
          if (!ID.test(entry.name)) continue;
          if (entry.isSymbolicLink()) fail("RESOURCE_PATH_UNSAFE");
          if (!entry.isDirectory()) continue;
          const resourceDirectory = await assertSafePath(dataRoot, [entry.name], { kind: "directory" });
          for (const version of await readdir(resourceDirectory, { withFileTypes: true })) {
            if (!ID.test(version.name)) continue;
            if (version.isSymbolicLink()) fail("RESOURCE_PATH_UNSAFE");
            if (!version.isDirectory()) continue;
            await assertSafePath(dataRoot, [entry.name, version.name], { kind: "directory" });
            try { datasets.push(JSON.parse(await readFile(await assertSafePath(dataRoot, [entry.name, version.name, "dataset.json"], { kind: "file" }), "utf8"))); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
          }
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      return { datasets };
    },
    async createDatasetVersion({ resourceId, versionId, name, files }) {
      assertId(resourceId, "DATASET_ID"); assertId(versionId, "DATASET_VERSION");
      if (!Array.isArray(files) || files.length < 1 || files.length > 200) fail("DATASET_FILES_INVALID");
      const normalized = files.map((file) => {
        const path = String(file.path || "").replaceAll("\\", "/");
        if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === ".." || part.startsWith(".")) || typeof file.content !== "string") fail("DATASET_FILE_INVALID");
        if (Buffer.byteLength(file.content, "utf8") > 8 * 1024 * 1024) fail("DATASET_FILE_TOO_LARGE");
        return { path, content: file.content };
      }).sort((left, right) => left.path.localeCompare(right.path));
      return serializeMutation(async () => {
        await ensureRoot();
        const resourceDirectory = await ensureSafeDirectory(join(dataRoot, resourceId));
        const target = join(resourceDirectory, versionId);
        await assertVersionAbsent(target);
        const stage = join(resourceDirectory, ".stage-" + randomUUID());
        await mkdir(stage);
        try {
          const digest = createHash("sha256");
          for (const file of normalized) {
            const destination = resolve(stage, file.path);
            if (!destination.startsWith(stage + sep)) fail("DATASET_FILE_INVALID");
            const parent = await ensureSafeDirectory(dirname(destination));
            if (!parent.startsWith(stage + sep) && parent !== stage) fail("DATASET_FILE_INVALID");
            await writeFile(destination, file.content, { encoding: "utf8", flag: "wx" });
            digest.update(file.path + "\0" + file.content + "\0");
          }
          const metadata = { version: 1, resourceId, versionId, name: String(name || resourceId).slice(0, 120), readOnly: true, digest: digest.digest("hex"), files: normalized.map((item) => item.path), createdAt: now() };
          await writeFile(join(stage, "dataset.json"), JSON.stringify(metadata, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
          await rename(stage, target);
          return metadata;
        } catch (error) { await rm(stage, { recursive: true, force: true }).catch(() => undefined); throw error; }
      });
    },
    async readDatasetFiles(resourceId, versionId) {
      assertId(resourceId, "DATASET_ID"); assertId(versionId, "DATASET_VERSION");
      await ensureRoot();
      const directory = await assertSafePath(dataRoot, [resourceId, versionId], { kind: "directory" });
      const metadata = JSON.parse(await readFile(await assertSafePath(dataRoot, [resourceId, versionId, "dataset.json"], { kind: "file" }), "utf8"));
      if (metadata.version !== 1 || metadata.resourceId !== resourceId || metadata.versionId !== versionId
        || metadata.readOnly !== true || !Array.isArray(metadata.files)) fail("DATASET_METADATA_INVALID");
      const files = [];
      for (const path of metadata.files) {
        const file = resolve(directory, path);
        if (!file.startsWith(directory + sep)) fail("DATASET_FILE_INVALID");
        const safe = await assertSafePath(directory, path.replaceAll("\\", "/").split("/"), { kind: "file" });
        files.push({ path, content: await readFile(safe, "utf8") });
      }
      const digest = createHash("sha256");
      for (const file of files) digest.update(file.path + "\0" + file.content + "\0");
      if (digest.digest("hex") !== metadata.digest) fail("DATASET_DIGEST_MISMATCH");
      return { metadata, files };
    },
    async listRoleTemplates() {
      await ensureRoot();
      const templates = [];
      try {
        for (const role of await readdir(roleRoot, { withFileTypes: true })) {
          if (!ID.test(role.name)) continue;
          if (role.isSymbolicLink()) fail("RESOURCE_PATH_UNSAFE");
          if (!role.isDirectory()) continue;
          await assertSafePath(roleRoot, [role.name], { kind: "directory" });
          for (const version of await readdir(join(roleRoot, role.name), { withFileTypes: true })) {
            if (!ID.test(version.name)) continue;
            if (version.isSymbolicLink()) fail("RESOURCE_PATH_UNSAFE");
            if (!version.isDirectory()) continue;
            await assertSafePath(roleRoot, [role.name, version.name], { kind: "directory" });
            try { templates.push(JSON.parse(await readFile(await assertSafePath(roleRoot, [role.name, version.name, "template.json"], { kind: "file" }), "utf8"))); }
            catch (error) { if (error.code !== "ENOENT") throw error; }
          }
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      return { templates };
    },
    async createRoleTemplate({ roleId, versionId, metadata, assets }) {
      assertId(roleId, "ROLE_TEMPLATE_ID"); assertId(versionId, "ROLE_TEMPLATE_VERSION");
      return serializeMutation(async () => {
        await ensureRoot();
        const roleDirectory = await ensureSafeDirectory(join(roleRoot, roleId));
        const target = join(roleDirectory, versionId);
        await assertVersionAbsent(target);
        const stage = join(roleDirectory, ".stage-" + randomUUID());
        await mkdir(stage);
        try {
        for (const [file, content] of Object.entries(assets || {})) {
          if (!ROLE_FILES.has(file) || typeof content !== "string" || Buffer.byteLength(content, "utf8") > 1024 * 1024) fail("ROLE_TEMPLATE_ASSET_INVALID");
          await writeFile(join(stage, file), content, { encoding: "utf8", flag: "wx" });
        }
        const roleMetadata = metadata && typeof metadata === "object" ? metadata : {};
        const assetNames = Object.keys(assets || {}).sort();
        const digest = createHash("sha256");
        for (const file of assetNames) digest.update(file + "\0" + assets[file] + "\0");
        const template = { version: 1, roleId, versionId, name: String(roleMetadata.name || roleId).slice(0, 120), description: String(roleMetadata.description || "").slice(0, 1000), category: String(roleMetadata.category || "general").slice(0, 80), assets: assetNames, digest: digest.digest("hex"), createdAt: now() };
        await writeFile(join(stage, "template.json"), JSON.stringify(template, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
        await rename(stage, target);
        return template;
        } catch (error) { await rm(stage, { recursive: true, force: true }).catch(() => undefined); throw error; }
      });
    },
    async readRoleTemplate(roleId, versionId) {
      assertId(roleId, "ROLE_TEMPLATE_ID"); assertId(versionId, "ROLE_TEMPLATE_VERSION");
      await ensureRoot();
      const directory = await assertSafePath(roleRoot, [roleId, versionId], { kind: "directory" });
      const template = JSON.parse(await readFile(await assertSafePath(roleRoot, [roleId, versionId, "template.json"], { kind: "file" }), "utf8"));
      if (template.version !== 1 || template.roleId !== roleId || template.versionId !== versionId || !Array.isArray(template.assets)) fail("ROLE_TEMPLATE_METADATA_INVALID");
      const assets = {};
      for (const file of template.assets) {
        if (!ROLE_FILES.has(file)) fail("ROLE_TEMPLATE_ASSET_INVALID");
        assets[file] = await readFile(await assertSafePath(directory, [file], { kind: "file" }), "utf8");
      }
      const digest = createHash("sha256");
      for (const file of [...template.assets].sort()) digest.update(file + "\0" + assets[file] + "\0");
      if (digest.digest("hex") !== template.digest) fail("ROLE_TEMPLATE_DIGEST_MISMATCH");
      return { template, assets };
    }
  });
}
