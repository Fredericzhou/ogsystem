import { createHash } from "node:crypto";
import { mkdir, readFile, rename, lstat, writeFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function safeId(value) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error("TEAM_VERSION_ID_INVALID: invalid TeamVersion ID.");
  return id;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function manifestFingerprint(manifest) {
  const { capturedAt: _capturedAt, manifestDigest: _manifestDigest, ...immutable } = manifest;
  return sha256(JSON.stringify(stable(immutable)));
}

export function teamVersionManifestPath(ogsDir, teamVersionId) {
  const root = resolve(String(ogsDir || ""));
  const id = safeId(teamVersionId);
  const base = resolve(root, ".ogs", "team-versions");
  const path = resolve(base, id, "manifest.json");
  if (!path.startsWith(`${base}${sep}`)) throw new Error("TEAM_VERSION_MANIFEST_INVALID: path escaped control root.");
  return path;
}

export async function ensureTeamVersionManifest({ ogsDir, teamVersion, capturedAt = new Date().toISOString() }) {
  const teamVersionId = safeId(teamVersion?.teamVersionId || teamVersion?.projectId);
  const path = teamVersionManifestPath(ogsDir, teamVersionId);
  const teamRoot = resolve(String(teamVersion?.workdir || teamVersion?.assetWorkdir || ""));
  let systemDigest = null;
  try { systemDigest = sha256(await readFile(resolve(teamRoot, "system.mmd"))); } catch { /* optional for imported assets */ }
  const teamCoreDigest = String(teamVersion?.teamCoreDigest || teamVersion?.projectDigest || "");
  const manifest = {
    version: 1,
    teamVersionId,
    teamCoreDigest: teamCoreDigest || null,
    teamDigestVersion: Number.isInteger(teamVersion?.teamDigestVersion) ? teamVersion.teamDigestVersion : 1,
    systemDigest,
    packageDigest: teamVersion?.projectDigest || teamCoreDigest || null,
    parentTeamVersionId: teamVersion?.parentTeamVersionId || null,
    capturedAt
  };
  manifest.manifestDigest = manifestFingerprint(manifest);
  let existing;
  try {
    existing = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw new Error(`TEAM_VERSION_MANIFEST_INVALID: cannot read manifest for ${teamVersionId}.`);
  }
  if (existing) {
    if (manifestFingerprint(existing) !== manifest.manifestDigest) {
      throw new Error(`TEAM_VERSION_MANIFEST_CONFLICT: immutable manifest for ${teamVersionId} differs.`);
    }
    return { path, manifest: existing };
  }
  const dir = resolve(path, "..");
  await mkdir(dir, { recursive: true });
  for (const parent of [resolve(String(ogsDir || "")), resolve(String(ogsDir || ""), ".ogs"), resolve(String(ogsDir || ""), ".ogs", "team-versions")]) {
    const parentStat = await lstat(parent).catch(() => undefined);
    if (!parentStat || parentStat.isSymbolicLink() || !parentStat.isDirectory()) throw new Error("TEAM_VERSION_MANIFEST_INVALID: control path is unsafe.");
  }
  const dirStat = await lstat(dir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) throw new Error("TEAM_VERSION_MANIFEST_INVALID: manifest directory is unsafe.");
  const stat = await lstat(path).catch(() => undefined);
  if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new Error("TEAM_VERSION_MANIFEST_INVALID: manifest path is unsafe.");
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    try { await rename(temp, path); } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const raced = JSON.parse(await readFile(path, "utf8"));
      if (manifestFingerprint(raced) !== manifest.manifestDigest) throw new Error(`TEAM_VERSION_MANIFEST_CONFLICT: immutable manifest for ${teamVersionId} differs.`);
      return { path, manifest: raced };
    }
  } finally { await rm(temp, { force: true }).catch(() => undefined); }
  return { path, manifest };
}
