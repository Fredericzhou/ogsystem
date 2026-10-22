import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { validateProfilesConfig, validateToolsConfig } from "../../../dist/runtime/config.js";
import { validateModelSelection } from "../../../dist/runtime/model-selection.js";

const ROLE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const ROLE_FILES = ["agent.md", "prompt.md", "role.json", "output.schema.json"];
const CONTRACT_PATH = ".ogs/contracts/handoff.json";
const PROFILE_PATH = "profiles.json";
const TOOL_PATH = "tools.json";
const MODEL_SELECTION_PATH = ".ogs/model-selection.json";
const MAX_FILE_BYTES = 1024 * 1024;

async function assertRealDirectory(path) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("TEAM_ASSET_PATH_UNSAFE: linked or non-directory path rejected.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function assertSafePath(root, path) {
  const relative = path.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  await assertRealDirectory(root);
  for (let index = 0; index < relative.length; index += 1) {
    current = join(current, relative[index]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index < relative.length - 1 && !info.isDirectory())) {
        throw new Error("TEAM_ASSET_PATH_UNSAFE: linked or non-directory path rejected.");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function roleRootPath(root) {
  const runtimePath = resolve(root, ".ogs", "runtime.json");
  await assertSafePath(root, runtimePath);
  let runtime = {};
  try { runtime = JSON.parse(await readFile(runtimePath, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  const roleRepoPath = typeof runtime.roleRepo === "string" && runtime.roleRepo.trim() ? runtime.roleRepo : "./og-roles";
  const repoRoot = resolve(root, roleRepoPath);
  const relativeRoot = relative(root, repoRoot);
  if (!relativeRoot || isAbsolute(relativeRoot) || relativeRoot === ".." || relativeRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error("TEAM_ASSET_PATH_INVALID: role repository must stay within the TeamVersion.");
  }
  return resolve(repoRoot, "roles");
}

function roleFilePath(roleRoot, roleId, file) {
  if (!ROLE_ID.test(roleId) || !ROLE_FILES.includes(file)) throw new Error("TEAM_ASSET_PATH_INVALID: unsupported role asset.");
  return resolve(roleRoot, roleId, file);
}

function contractSchemaPath(workdir, relativePath) {
  const normalized = String(relativePath || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === ".." || !/^[a-zA-Z0-9_.-]+$/.test(part)) || !normalized.endsWith(".json")) {
    throw new Error("TEAM_ASSET_PATH_INVALID: contract schema path must be a relative JSON path.");
  }
  return resolve(workdir, ".ogs", "contracts", normalized);
}

async function readOptional(path) {
  await assertSafePath(path.split(/[\\/]/).slice(0, -1).join(path.includes("\\") ? "\\" : "/"), path);
  try { return await readFile(path, "utf8"); }
  catch (error) { if (error?.code === "ENOENT") return ""; throw error; }
}

function validateAsset(file, content) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    throw new Error("TEAM_ASSET_INVALID: asset content must be text no larger than 1 MiB.");
  }
  if (file === "role.json" || file === "output.schema.json" || file === "handoff.json") {
    let parsed;
    try { parsed = JSON.parse(content); }
    catch { throw new Error(`TEAM_ASSET_INVALID_JSON: ${file} must contain valid JSON.`); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`TEAM_ASSET_INVALID_JSON: ${file} must contain a JSON object.`);
    if (file === "handoff.json" && (parsed.version !== 1 || !Array.isArray(parsed.contracts))) {
      throw new Error("TEAM_ASSET_INVALID_CONTRACTS: handoff manifest must have version 1 and a contracts array.");
    }
  }
}

async function readExecutionConfig(root, read) {
  const profilesPath = resolve(root, PROFILE_PATH);
  const toolsPath = resolve(root, TOOL_PATH);
  await assertSafePath(root, profilesPath);
  await assertSafePath(root, toolsPath);
  let profiles = [];
  let tools = { tools: [] };
  try { profiles = JSON.parse(await read(profilesPath, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  try { tools = JSON.parse(await read(toolsPath, "utf8")); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  return {
    profiles: validateProfilesConfig(profiles, profilesPath),
    tools: validateToolsConfig(tools, toolsPath)
  };
}

export function createFileTeamDesignAssetStore({ write = writeFile, read = readFile, publish = rename, makeId = randomUUID } = {}) {
  return Object.freeze({
    async readReleaseBaselineScenarios({ workdir }) {
      const root = resolve(workdir);
      const path = resolve(root, ".ogs", "release-baselines.json");
      await assertSafePath(root, path);
      try {
        const parsed = JSON.parse(await read(path, "utf8"));
        if (!Array.isArray(parsed)) throw new Error("TEAM_RELEASE_BASELINES_INVALID");
        return parsed;
      } catch (error) {
        if (error?.code === "ENOENT") return [];
        throw new Error("TEAM_RELEASE_BASELINES_INVALID: release baseline file is malformed or unsafe.");
      }
    },
    async saveReleaseBaselineScenarios({ workdir, scenarios }) {
      const root = resolve(workdir);
      const path = resolve(root, ".ogs", "release-baselines.json");
      await assertSafePath(root, path);
      await mkdir(dirname(path), { recursive: true });
      await assertSafePath(root, path);
      const temporary = join(dirname(path), `.ogs-release-baselines-${makeId()}.tmp`);
      try {
        await write(temporary, `${JSON.stringify(scenarios, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
        await assertSafePath(root, path);
        await publish(temporary, path);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      return this.readReleaseBaselineScenarios({ workdir: root });
    },
    async readAssets({ workdir, roleIds = [] }) {
      const root = resolve(workdir);
      const roleRoot = await roleRootPath(root);
      const roles = {};
      for (const roleId of roleIds) {
        roles[roleId] = {};
        for (const file of ROLE_FILES) {
          const path = roleFilePath(roleRoot, roleId, file);
          await assertSafePath(root, path);
          try { roles[roleId][file] = await read(path, "utf8"); }
          catch (error) { if (error?.code !== "ENOENT") throw error; roles[roleId][file] = ""; }
        }
      }
      const contractPath = resolve(root, CONTRACT_PATH);
      await assertSafePath(root, contractPath);
      let contracts = "";
      try { contracts = await read(contractPath, "utf8"); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      let manifest;
      try { manifest = JSON.parse(contracts); } catch { manifest = null; }
      const contractSchemas = {};
      for (const entry of Array.isArray(manifest?.contracts) ? manifest.contracts : []) {
        const schemaPath = typeof entry?.schema === "string" ? entry.schema : entry?.schemaPath;
        if (typeof schemaPath !== "string") continue;
        const path = contractSchemaPath(root, schemaPath);
        await assertSafePath(root, path);
        try { contractSchemas[schemaPath] = await read(path, "utf8"); }
        catch (error) { if (error?.code !== "ENOENT") throw error; contractSchemas[schemaPath] = ""; }
      }
      const modelSelectionPath = resolve(root, MODEL_SELECTION_PATH);
      await assertSafePath(root, modelSelectionPath);
      let modelSelection = { configVersion: "2" };
      try { modelSelection = validateModelSelection(JSON.parse(await read(modelSelectionPath, "utf8")), modelSelectionPath); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      return { roles, contracts, contractSchemas, executionConfig: await readExecutionConfig(root, read), modelSelection };
    },
    async saveAssets({ workdir, assets = {}, roleIds = [] }) {
      const root = resolve(workdir);
      const roleRoot = await roleRootPath(root);
      const files = [];
      for (const roleId of roleIds) {
        const values = assets.roles?.[roleId] || {};
        for (const file of ROLE_FILES) {
          if (values[file] === undefined) continue;
          validateAsset(file, values[file]);
          files.push({ path: roleFilePath(roleRoot, roleId, file), content: values[file] });
        }
      }
      if (assets.contracts !== undefined) {
        validateAsset("handoff.json", assets.contracts);
        files.push({ path: resolve(root, CONTRACT_PATH), content: assets.contracts });
      }
      for (const [relativePath, content] of Object.entries(assets.contractSchemas || {})) {
        validateAsset("output.schema.json", content);
        files.push({ path: contractSchemaPath(root, relativePath), content });
      }
      if (assets.executionConfig !== undefined) {
        const executionConfig = assets.executionConfig;
        const profiles = validateProfilesConfig(executionConfig.profiles, resolve(root, PROFILE_PATH));
        const tools = validateToolsConfig(executionConfig.tools, resolve(root, TOOL_PATH));
        files.push({ path: resolve(root, PROFILE_PATH), content: `${JSON.stringify(profiles, null, 2)}\n` });
        files.push({ path: resolve(root, TOOL_PATH), content: `${JSON.stringify(tools, null, 2)}\n` });
      }
      if (assets.modelSelection !== undefined) {
        const path = resolve(root, MODEL_SELECTION_PATH);
        const modelSelection = validateModelSelection(assets.modelSelection, path);
        files.push({ path, content: `${JSON.stringify(modelSelection, null, 2)}\n` });
      }
      const staged = [];
      try {
        for (const file of files) {
          await assertSafePath(root, file.path);
          const parent = dirname(file.path);
          await mkdir(parent, { recursive: true });
          await assertSafePath(root, file.path);
          const temporary = join(parent, `.ogs-team-asset-${makeId()}.tmp`);
          await write(temporary, file.content, { encoding: "utf8", flag: "wx" });
          staged.push({ ...file, temporary });
        }
        for (const file of staged) {
          await assertSafePath(root, file.path);
          await publish(file.temporary, file.path);
        }
      } catch (error) {
        await Promise.all(staged.map((file) => rm(file.temporary, { force: true }).catch(() => undefined)));
        throw error;
      }
      return this.readAssets({ workdir: root, roleIds });
    }
  });
}
