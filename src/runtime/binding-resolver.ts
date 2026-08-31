import type { ExecutorBinding } from "./executor.js";
import type {
  CliTool,
  EffectiveLawConstraints,
  ExecutionPlanNode,
  ExecutionProfile,
  LoadedModelPackage,
  RoleRunDirs,
  RunContext
} from "./types.js";

export type ResolvedExecutionBinding = {
  binding?: ExecutorBinding;
  bindingLabel: string;
  timeoutMs: number;
  maxOutputBytes: number;
  workdir: string;
  commandBaseDir?: string;
  env?: Record<string, string>;
  modelRef?: string;
  profileId?: string;
  toolRef?: string;
  command?: string;
  sessionDirectory?: string;
};

export function resolveExecutionBinding(args: {
  roleId: string;
  node: ExecutionPlanNode;
  runContext: RunContext;
  baseWorkdir: string;
  commandBaseDir?: string;
  roleDirs?: RoleRunDirs;
  allowedEvents: string[];
  effectiveLaw: EffectiveLawConstraints;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  modelsById?: Map<string, LoadedModelPackage>;
}): ResolvedExecutionBinding {
  const defaults = {
    timeoutMs: 120000,
    maxOutputBytes: 64 * 1024
  };
  const sessionDirectory = args.roleDirs?.privateDir;

  if (args.node.binding.kind === "model") {
    const workdir = sessionDirectory ?? args.roleDirs?.roleDir ?? args.baseWorkdir;
    const legacyModelId =
      "modelId" in (args.node.binding as unknown as Record<string, unknown>) &&
      typeof (args.node.binding as unknown as { modelId?: unknown }).modelId === "string"
        ? (args.node.binding as unknown as { modelId: string }).modelId
        : undefined;
    const legacyModelPackage = legacyModelId ? args.modelsById?.get(legacyModelId) : undefined;
    const modelRef = args.node.binding.modelRef ?? legacyModelPackage?.manifest.model;
    const variant =
      args.node.binding.variant ??
      (typeof legacyModelPackage?.manifest.args?.variant === "string"
        ? legacyModelPackage.manifest.args.variant
        : typeof legacyModelPackage?.manifest.args?.reasoningEffort === "string"
          ? legacyModelPackage.manifest.args.reasoningEffort
          : undefined);
    if (!modelRef) {
      throw new Error(`Concrete model ref not resolved for role "${args.roleId}"`);
    }
    return {
      binding: {
        kind: "model",
        modelRef,
        variant
      },
      bindingLabel: `model:${legacyModelId ?? modelRef}`,
      timeoutMs: args.node.binding.timeoutMs ?? legacyModelPackage?.manifest.timeoutMs ?? defaults.timeoutMs,
      maxOutputBytes:
        args.node.binding.maxOutputBytes ??
        legacyModelPackage?.manifest.maxOutputBytes ??
        defaults.maxOutputBytes,
      workdir,
      env: {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
        OGSYSTEM_TARGET_DIR: args.baseWorkdir,
        OGSYSTEM_ROLE_DIR: args.roleDirs?.roleDir ?? workdir,
        OGSYSTEM_PRIVATE_DIR: sessionDirectory ?? "",
        OGSYSTEM_ROLE_ID: args.roleId,
        OGSYSTEM_MODEL_ID: legacyModelId ?? modelRef,
        OGSYSTEM_ALLOWED_EVENTS: args.allowedEvents.join(",")
      },
      modelRef,
      sessionDirectory
    };
  }

  if (args.node.binding.kind === "profile") {
    const profile = args.profilesById.get(args.node.binding.profileId);
    if (!profile) {
      throw new Error(`Execution profile not found: ${args.node.binding.profileId}`);
    }
    const tool = args.toolsByRef.get(profile.toolRef);
    if (!tool) {
      throw new Error(`Tool not found: ${profile.toolRef}`);
    }
    if (args.effectiveLaw.forbiddenToolRefs.includes(profile.toolRef)) {
      throw new Error(`Tool is forbidden by effective law: ${profile.toolRef}`);
    }
    return {
      binding: {
        kind: "profile",
        profile,
        tool
      },
      bindingLabel: `profile:${profile.profileId}`,
      timeoutMs: profile.timeoutMs ?? defaults.timeoutMs,
      maxOutputBytes: profile.maxOutputBytes ?? defaults.maxOutputBytes,
      workdir: sessionDirectory ?? args.baseWorkdir,
      commandBaseDir: args.commandBaseDir ?? args.baseWorkdir,
      env: {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
        OGSYSTEM_TARGET_DIR: args.baseWorkdir,
        OGSYSTEM_ROLE_DIR: args.roleDirs?.roleDir ?? args.baseWorkdir,
        OGSYSTEM_PRIVATE_DIR: sessionDirectory ?? "",
        OGSYSTEM_ROLE_ID: args.roleId,
        OGSYSTEM_PROFILE_ID: profile.profileId,
        OGSYSTEM_TOOL_REF: tool.toolRef,
        OGSYSTEM_ALLOWED_EVENTS: args.allowedEvents.join(",")
      },
      profileId: profile.profileId,
      toolRef: tool.toolRef,
      command: tool.command,
      sessionDirectory
    };
  }

  return {
    bindingLabel: "noop",
    timeoutMs: defaults.timeoutMs,
    maxOutputBytes: defaults.maxOutputBytes,
    workdir: args.baseWorkdir
  };
}
