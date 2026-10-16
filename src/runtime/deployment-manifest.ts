import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { arch, platform } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveProjectRoleRootDir } from "./bundled-repos.js";
import { compileExecutionSnapshot } from "./compiler.js";
import { loadFlowContractPlan } from "./flow-contract.js";
import { loadModelCatalog } from "./model-catalog.js";
import { loadModelSelection, resolveModelSelectionForSystem } from "./model-selection.js";
import { loadOgsSpecification } from "./ogs-spec-loader.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import { buildRunPlanFingerprint } from "./plan-fingerprint.js";
import { resolveEffectiveLaw } from "./runtime-setup.js";
import { loadLaws, loadProfiles, loadRolePackages, loadRuntimeConfig, loadTools, loadUserProfile } from "./runtime-loader.js";
import { pathExists } from "./run-store.js";
import type { RunPlanFingerprint } from "./run-artifacts.js";

const require = createRequire(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_JSON = require(resolve(PACKAGE_ROOT, "package.json")) as {
  name: string;
  version: string;
};

export type DeploymentManifest = {
  manifestVersion: 1;
  generatedAt: string;
  ogsystem: {
    package: string;
    version: string;
    installedTreeSha256: string;
  };
  runtime: {
    node: string;
    platform: string;
    arch: string;
  };
  modelClis: Record<string, { version?: string; status: "available" | "unavailable" }>;
  project: {
    systemId: string;
    systemVersion: string;
    modelSelection: Record<string, { backend: string; modelRef: string }>;
  };
  fingerprints: {
    runPlan: string;
    components: Record<string, string>;
  };
};

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function listTreeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  await walk(root);
  return files;
}

async function installedTreeDigest(): Promise<string> {
  const roots = ["bin", "dist", "og-roles/roles", "schemas", "scripts"];
  const files = ["package.json", "README.md"].map((name) => resolve(PACKAGE_ROOT, name));
  for (const root of roots) files.push(...await listTreeFiles(resolve(PACKAGE_ROOT, root)));
  const hash = createHash("sha256");
  for (const path of [...new Set(files)].sort()) {
    const content = await readFile(path);
    hash.update(relative(PACKAGE_ROOT, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function getCliVersion(command: string, cwd: string): Promise<{ version?: string; status: "available" | "unavailable" }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, ["--version"], {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32",
      windowsHide: true
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 3000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output = (output + chunk).slice(0, 512);
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolvePromise({ status: "unavailable" });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const version = output.trim().split(/\r?\n/, 1)[0];
      resolvePromise(code === 0 && version
        ? { version, status: "available" }
        : { status: "unavailable" });
    });
  });
}

function fingerprintComponents(fingerprint: RunPlanFingerprint): Record<string, string> {
  const payloadComponents = fingerprint.payload.components as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(payloadComponents)
      .map(([name, component]) => [name, (component as { digest?: string }).digest])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export async function generateDeploymentManifest(args: {
  workdir: string;
  systemPath?: string;
}): Promise<DeploymentManifest> {
  const workdir = resolve(args.workdir);
  const system = await loadSystemFromMermaid(resolve(workdir, args.systemPath ?? "system.mmd"));
  const runtimeConfig = await loadRuntimeConfig(undefined, workdir);
  const roleRootDir = resolveProjectRoleRootDir(workdir, runtimeConfig.roleRepo);
  const [rolePackagesByRoleId, lawCatalog, modelSelection, modelCatalog, profiles, tools, userProfile] = await Promise.all([
    loadRolePackages({ system, roleRootDir }),
    loadLaws(undefined, workdir),
    loadModelSelection(resolve(workdir, ".ogs", "model-selection.json")),
    loadModelCatalog(resolve(workdir, ".ogs", "model-catalog.json")),
    loadProfiles(undefined, workdir),
    loadTools(undefined, workdir),
    loadUserProfile(undefined, workdir)
  ]);
  const resolvedModels = resolveModelSelectionForSystem({ system, selection: modelSelection, catalog: modelCatalog });
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const contractPlan = system.graph?.handoffContracts
    ? await loadFlowContractPlan({ system, contractPath: system.graph.handoffContracts })
    : undefined;
  const compiler = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    contractPlan,
    effectiveLaw,
    resolvedModelsByRoleId: resolvedModels.resolvedByRoleId
  });
  if (!compiler.ok) {
    throw new Error(`Cannot create deployment manifest: system compile failed (${compiler.diagnostics.map((item) => item.code).join(", ")})`);
  }

  let specificationDigest: string | undefined;
  const specificationFiles = ["semantics.yaml", "semantics.yml", "semantics.json", "models.yaml", "models.yml", "models.json"];
  if (await Promise.all(specificationFiles.map((name) => pathExists(resolve(workdir, ".ogs", name)))).then((values) => values.some(Boolean))) {
    specificationDigest = (await loadOgsSpecification(workdir)).digest;
  }
  const fingerprint = buildRunPlanFingerprint({
    system,
    rolePackagesByRoleId,
    resolvedModelsByRoleId: resolvedModels.resolvedByRoleId,
    effectiveLaw,
    contractPlan,
    compilerSnapshot: compiler.snapshot,
    specificationDigest,
    runtimeConfig,
    profiles,
    tools,
    userProfile
  });
  const [opencode, codex] = await Promise.all([
    getCliVersion("opencode", workdir),
    getCliVersion("codex", workdir)
  ]);
  const modelSelectionSummary = Object.fromEntries(
    Array.from(resolvedModels.resolvedByRoleId.entries()).map(([roleId, selection]) => [roleId, {
      backend: selection.backend,
      modelRef: selection.modelRef
    }])
  );

  return {
    manifestVersion: 1,
    generatedAt: new Date().toISOString(),
    ogsystem: {
      package: PACKAGE_JSON.name,
      version: PACKAGE_JSON.version,
      installedTreeSha256: await installedTreeDigest()
    },
    runtime: {
      node: process.version,
      platform: platform(),
      arch: arch()
    },
    modelClis: { opencode, codex },
    project: {
      systemId: system.systemId,
      systemVersion: system.systemVersion,
      modelSelection: modelSelectionSummary
    },
    fingerprints: {
      runPlan: fingerprint.digest,
      components: fingerprintComponents(fingerprint)
    }
  };
}
