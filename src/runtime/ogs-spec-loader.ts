import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parse } from "yaml";

export type OgsSpecificationSnapshot = {
  specVersion: string;
  systemId: string;
  systemVersion: string;
  sources: Record<string, { digest: string; value: unknown }>;
  digest: string;
};

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, normalize((value as Record<string, unknown>)[key])]));
  }
  return value ?? null;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(path + " must be an object");
  return value as Record<string, unknown>;
}

function readVersioned(value: unknown, path: string): { value: unknown; version: string } {
  const record = asRecord(value, path);
  const version = record.version ?? record.specVersion;
  if (typeof version !== "string" && typeof version !== "number") throw new Error(path + " must declare version");
  return { value, version: String(version) };
}

async function loadStructuredFile(path: string): Promise<{ value: unknown; version: string }> {
  const source = await readFile(path, "utf8");
  const parsed = extname(path).toLowerCase() === ".json" ? JSON.parse(source) : parse(source);
  return readVersioned(parsed, path);
}

export async function loadOgsSpecification(workdir: string): Promise<OgsSpecificationSnapshot> {
  const root = resolve(workdir, ".ogs");
  // Law catalogs are runtime configuration validated by config.ts, not versioned semantic sources.
  // Keeping them out of this snapshot lets a project use the official laws.json shape alongside
  // semantics.yaml without imposing two incompatible version contracts on one file.
  const candidates = ["semantics.yaml", "semantics.yml", "semantics.json", "models.yaml", "models.yml", "models.json"];
  const paths: string[] = [];
  for (const candidate of candidates) {
    const path = resolve(root, candidate);
    try {
      await readFile(path);
      paths.push(path);
    } catch {
      // Optional files are omitted; references are checked by the semantic compiler.
    }
  }
  const contractsRoot = resolve(root, "contracts");
  try {
    for (const entry of await readdir(contractsRoot, { withFileTypes: true })) {
      if (entry.isFile() && extname(entry.name).toLowerCase() === ".json") paths.push(resolve(contractsRoot, entry.name));
    }
  } catch {
    // Contracts are optional until a state/event contract is declared.
  }
  if (paths.length === 0) throw new Error("No OGS specification files found under " + root);

  const sources: Record<string, { digest: string; value: unknown }> = {};
  let specVersion: string | undefined;
  let systemId: string | undefined;
  let systemVersion: string | undefined;
  for (const path of paths.sort()) {
    const loaded = await loadStructuredFile(path);
    const record = asRecord(loaded.value, path);
    const metadata = asRecord(record.system ?? record.metadata ?? {}, path + ".system");
    const candidateSystemId = metadata.systemId ?? record.systemId;
    const candidateSystemVersion = metadata.systemVersion ?? record.systemVersion;
    if (candidateSystemId !== undefined && typeof candidateSystemId !== "string") throw new Error(path + " systemId must be a string");
    if (candidateSystemVersion !== undefined && typeof candidateSystemVersion !== "string") throw new Error(path + " systemVersion must be a string");
    if (specVersion && specVersion !== loaded.version) throw new Error("Specification version mismatch in " + path);
    if (candidateSystemId !== undefined && systemId && systemId !== candidateSystemId) throw new Error("systemId mismatch in " + path);
    if (candidateSystemVersion !== undefined && systemVersion && systemVersion !== candidateSystemVersion) throw new Error("systemVersion mismatch in " + path);
    specVersion ??= loaded.version;
    if (candidateSystemId !== undefined) systemId ??= candidateSystemId;
    if (candidateSystemVersion !== undefined) systemVersion ??= candidateSystemVersion;
    sources[path] = { digest: digest(loaded.value), value: structuredClone(loaded.value) };
  }
  if (!systemId || !systemVersion) throw new Error("OGS specification must declare systemId and systemVersion");
  const payload = { specVersion, systemId, systemVersion, sources: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, source.digest])) };
  return { specVersion: specVersion!, systemId, systemVersion, sources, digest: digest(payload) };
}
