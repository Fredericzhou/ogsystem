import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  validateLawsConfig,
  validateProfilesConfig,
  validateRuntimeConfig,
  validateToolsConfig,
  validateUserProfileConfig
} from "./config.js";
import { loadModelPackage } from "./model-repo.js";
import { loadSystemFromMermaid } from "./parse-mermaid.js";
import {
  appendEvent,
  initializeRunContext,
  pathExists,
  readJsonFile
} from "./run-artifacts.js";
import { loadRolePackage } from "./role-repo.js";
import { stringifyJson } from "./runtime-support.js";
import { runSystemWithLangGraph } from "./langgraph-runner.js";
import { type OpencodeRunClient, startOpencodeRunClient } from "./opencode-executor.js";
import type {
  AdapterRunResult,
  CliTool,
  EffectiveLawConstraints,
  ExecutionProfile,
  LawCatalog,
  LawSpec,
  LoadedModelPackage,
  LoadedRolePackage,
  RuntimeConfig,
  SystemDefinition,
  UserProfile
} from "./types.js";

function mergeLawConstraints(base: EffectiveLawConstraints, spec?: LawSpec): EffectiveLawConstraints {
  if (!spec?.constraints) {
    return base;
  }

  const next: EffectiveLawConstraints = {
    forbiddenToolRefs: [...base.forbiddenToolRefs],
    maxTransitions: base.maxTransitions,
    allowNoopWithoutExecutionBinding: base.allowNoopWithoutExecutionBinding
  };

  if (spec.constraints.forbiddenToolRefs?.length) {
    next.forbiddenToolRefs = Array.from(
      new Set([...next.forbiddenToolRefs, ...spec.constraints.forbiddenToolRefs])
    );
  }

  const nextMaxTransitions = spec.constraints.maxTransitions;
  if (nextMaxTransitions !== undefined) {
    if (base.maxTransitions !== undefined && nextMaxTransitions > base.maxTransitions) {
      throw new Error(
        `Law merge violation on ${spec.lawId}: maxTransitions cannot be relaxed (${nextMaxTransitions} > ${base.maxTransitions})`
      );
    }
    next.maxTransitions = nextMaxTransitions;
  }

  const nextAllowNoop = spec.constraints.allowNoopWithoutExecutionBinding;
  if (nextAllowNoop !== undefined) {
    if (!base.allowNoopWithoutExecutionBinding && nextAllowNoop === true) {
      next.allowNoopWithoutExecutionBinding = true;
    }
    if (base.allowNoopWithoutExecutionBinding && nextAllowNoop === false) {
      throw new Error(
        `Law merge violation on ${spec.lawId}: allowNoopWithoutExecutionBinding cannot be relaxed`
      );
    }
  }

  return next;
}

export function resolveEffectiveLaw(
  system: SystemDefinition,
  lawCatalog?: LawCatalog
): EffectiveLawConstraints {
  const defaultConstraints: EffectiveLawConstraints = {
    forbiddenToolRefs: [],
    maxTransitions: undefined,
    allowNoopWithoutExecutionBinding: false
  };

  if (!lawCatalog) {
    return defaultConstraints;
  }

  const lawsById = new Map(lawCatalog.laws.map((item) => [item.lawId, item]));
  const globalLaw = lawsById.get(system.lawBinding.globalLawRef);
  if (!globalLaw) {
    throw new Error(`Global law not found in catalog: ${system.lawBinding.globalLawRef}`);
  }

  return mergeLawConstraints(defaultConstraints, globalLaw);
}

async function loadRuntimeConfig(path: string | undefined, workdir: string): Promise<RuntimeConfig> {
  const runtimePath = path ?? resolve(workdir, ".ogsystem", "runtime.json");
  if (!(await pathExists(runtimePath))) {
    return validateRuntimeConfig(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        modelRepo: "./og-models",
        runsDir: ".ogsystems",
        workspace: {
          rolesDir: "roles",
          privateDirName: "private",
          linkSharedIntoRoleDir: false
        },
        opencode: {
          baseArgs: ["run"]
        }
      },
      runtimePath
    );
  }
  return validateRuntimeConfig(await readJsonFile(runtimePath), runtimePath);
}

async function loadUserProfile(
  path: string | undefined,
  workdir: string
): Promise<UserProfile | undefined> {
  const profilePath = path ?? resolve(workdir, ".ogsystem", "user-profile.json");
  if (!(await pathExists(profilePath))) {
    return undefined;
  }
  return validateUserProfileConfig(await readJsonFile(profilePath), profilePath);
}

async function loadProfiles(path?: string): Promise<ExecutionProfile[]> {
  if (!path) {
    return [];
  }
  return validateProfilesConfig(await readJsonFile(path), path);
}

async function loadTools(path?: string): Promise<CliTool[]> {
  if (!path) {
    return [];
  }
  return validateToolsConfig(await readJsonFile(path), path).tools;
}

async function loadLaws(path: string | undefined, workdir: string): Promise<LawCatalog | undefined> {
  const lawPath = path ?? resolve(workdir, ".ogsystem", "laws.json");
  if (!(await pathExists(lawPath))) {
    return undefined;
  }
  return validateLawsConfig(await readJsonFile(lawPath), lawPath);
}

async function loadRolePackages(args: {
  system: SystemDefinition;
  roleRootDir: string;
}): Promise<Map<string, LoadedRolePackage>> {
  const rolePackagesByRoleId = new Map<string, LoadedRolePackage>();

  for (const roleId of args.system.roleIds) {
    const rolePackage = await loadRolePackage({
      roleId,
      roleRootDir: args.roleRootDir
    });
    rolePackagesByRoleId.set(roleId, rolePackage);
  }

  return rolePackagesByRoleId;
}

async function loadModelPackages(args: {
  system: SystemDefinition;
  modelRootDir: string;
}): Promise<Map<string, LoadedModelPackage>> {
  const modelsById = new Map<string, LoadedModelPackage>();
  const referencedModelIds = new Set(Object.values(args.system.modelBinding));

  for (const modelId of referencedModelIds) {
    const modelPackage = await loadModelPackage({
      modelId,
      modelRootDir: args.modelRootDir
    });
    modelsById.set(modelId, modelPackage);
  }

  return modelsById;
}

export async function runSystemWithAdapter(args: {
  systemPath: string;
  profilesPath?: string;
  toolsPath?: string;
  lawsPath?: string;
  runtimeConfigPath?: string;
  userProfilePath?: string;
  resumeRunDir?: string;
  prompt: string;
  workdir: string;
  dryRun?: boolean;
}): Promise<AdapterRunResult> {
  const system = await loadSystemFromMermaid(args.systemPath);
  const runtimeConfig = await loadRuntimeConfig(args.runtimeConfigPath, args.workdir);
  const profiles = await loadProfiles(args.profilesPath);
  const tools = await loadTools(args.toolsPath);
  const lawCatalog = await loadLaws(args.lawsPath, args.workdir);
  const userProfile = await loadUserProfile(args.userProfilePath, args.workdir);
  const rolePackagesByRoleId = await loadRolePackages({
    system,
    roleRootDir: resolve(args.workdir, runtimeConfig.roleRepo, "roles")
  });
  const modelsById = await loadModelPackages({
    system,
    modelRootDir: resolve(args.workdir, runtimeConfig.modelRepo)
  });
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const runContext = await initializeRunContext({
    system,
    systemPath: args.systemPath,
    prompt: args.prompt,
    workdir: args.workdir,
    runtimeConfig,
    resumeRunDir: args.resumeRunDir
  });

  const profilesById = new Map(profiles.map((item) => [item.profileId, item]));
  const toolsByRef = new Map(tools.map((item) => [item.toolRef, item]));
  const requiresOpencodeRunServer = !args.dryRun && modelsById.size > 0;
  let opencodeRun: OpencodeRunClient | undefined;

  try {
    if (requiresOpencodeRunServer) {
      opencodeRun = await startOpencodeRunClient({
        timeoutMs: 30000,
        env: {
          OGSYSTEM_RUN_DIR: runContext.runDir,
          OGSYSTEM_SHARED_DIR: runContext.sharedDir
        }
      });
      runContext.opencodeServerUrl = opencodeRun.url;
      runContext.opencodeServerPid = opencodeRun.pid;
      runContext.opencodeServerStartedAt = opencodeRun.startedAt;
      await writeFile(
        runContext.opencodeServerPath,
        stringifyJson({
          lifecycle: "single-serve-multi-session",
          startedAt: runContext.opencodeServerStartedAt,
          url: runContext.opencodeServerUrl,
          pid: runContext.opencodeServerPid
        }),
        "utf8"
      );
      await appendEvent(runContext, {
        type: "opencode_server_started",
        at: runContext.opencodeServerStartedAt,
        url: runContext.opencodeServerUrl,
        pid: runContext.opencodeServerPid,
        lifecycle: "single-serve-multi-session"
      });
    }

    let initialState: unknown;
    if (args.resumeRunDir) {
      const resumeStatePath = resolve(runContext.runDir, "state.json");
      if (await pathExists(resumeStatePath)) {
        const resumeState = await readJsonFile(resumeStatePath);
        if (
          typeof resumeState === "object" &&
          resumeState !== null &&
          !Array.isArray(resumeState) &&
          "graphState" in resumeState
        ) {
          initialState = (resumeState as Record<string, unknown>).graphState;
        }
      }
    }

    return await runSystemWithLangGraph({
      system,
      effectiveLaw,
      profilesById,
      toolsByRef,
      modelsById,
      runtimeConfig,
      userProfile,
      workdir: args.workdir,
      rolePackagesByRoleId,
      runContext,
      opencodeRun,
      prompt: args.prompt,
      dryRun: args.dryRun,
      initialState: initialState as never
    });
  } finally {
    if (opencodeRun) {
      opencodeRun.close();
      await writeFile(
        runContext.opencodeServerPath,
        stringifyJson({
          lifecycle: "single-serve-multi-session",
          startedAt: runContext.opencodeServerStartedAt,
          closedAt: new Date().toISOString(),
          url: runContext.opencodeServerUrl,
          pid: runContext.opencodeServerPid
        }),
        "utf8"
      );
      await appendEvent(runContext, {
        type: "opencode_server_closed",
        at: new Date().toISOString(),
        url: runContext.opencodeServerUrl,
        pid: runContext.opencodeServerPid,
        lifecycle: "single-serve-multi-session"
      });
    }
  }
}
