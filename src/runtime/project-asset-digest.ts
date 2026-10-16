import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSystemFromMermaidSource } from "./parse-mermaid.js";

const FIXED_ASSETS = [
  "system.mmd",
  "system.design.json",
  ".ogs/runtime.json",
  ".ogs/model-selection.json",
  ".ogs/model-catalog.json",
  ".ogs/laws.json",
  ".ogs/user-profile.json",
  "profiles.json",
  "tools.json"
];

const SEMANTIC_FILE_NAMES = [
  "semantics.yaml",
  "semantics.yml",
  "semantics.json",
  "models.yaml",
  "models.yml",
  "models.json"
];

async function collectFiles(root: string, prefix: string): Promise<Array<{ path: string; content: string | null }>> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: Array<{ path: string; content: string | null }> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await collectFiles(path, relativePath));
    else if (entry.isFile()) files.push({ path: relativePath, content: await readFile(path, "utf8").catch(() => null) });
  }
  return files;
}

export async function computeProjectAssetDigest(workdir: string): Promise<string> {
  const values: Array<{ path: string; content: string | null }> = [];
  for (const asset of FIXED_ASSETS) {
    values.push({ path: asset, content: await readFile(resolve(workdir, asset), "utf8").catch(() => null) });
  }
  for (const fileName of SEMANTIC_FILE_NAMES) {
    values.push({
      path: `.ogs/${fileName}`,
      content: await readFile(resolve(workdir, ".ogs", fileName), "utf8").catch(() => null)
    });
  }
  for (const directory of ["systems", "subsystems"]) {
    values.push(...await collectFiles(resolve(workdir, ".ogs", directory), `semantic/${directory}`));
  }
  const runtime = JSON.parse(await readFile(resolve(workdir, ".ogs", "runtime.json"), "utf8").catch(() => "{}")) as { roleRepo?: unknown };
  const roleRepo = typeof runtime.roleRepo === "string" && runtime.roleRepo.trim()
    ? resolve(workdir, runtime.roleRepo)
    : resolve(workdir, "og-roles");
  values.push(...await collectFiles(roleRepo, "rolePackages"));
  values.push(...await collectFiles(resolve(workdir, ".ogs", "contracts"), "contracts"));
  const systemSource = await readFile(resolve(workdir, "system.mmd"), "utf8").catch(() => "");
  if (systemSource) {
    const configuredContractPath = parseSystemFromMermaidSource(systemSource).graph?.handoffContracts;
    if (configuredContractPath) {
      const contractPath = resolve(workdir, configuredContractPath);
      const contractContent = await readFile(contractPath, "utf8").catch(() => undefined);
      if (contractContent !== undefined) values.push({ path: "configured-handoff-contract", content: contractContent });
      else values.push(...await collectFiles(contractPath, "configured-handoff-contract"));
    }
  }
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}
