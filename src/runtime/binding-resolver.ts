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
  env?: Record<string, string>;
  modelId?: string;
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
  roleDirs?: RoleRunDirs;
  allowedEvents: string[];
  effectiveLaw: EffectiveLawConstraints;
  profilesById: Map<string, ExecutionProfile>;
  toolsByRef: Map<string, CliTool>;
  modelsById: Map<string, LoadedModelPackage>;
}): ResolvedExecutionBinding {
  const defaults = {
    timeoutMs: 120000,
    maxOutputBytes: 64 * 1024
  };
  const sessionDirectory = args.roleDirs?.privateDir;

  if (args.node.binding.kind === "model") {
    const modelPackage = args.modelsById.get(args.node.binding.modelId);
    if (!modelPackage) {
      throw new Error(`Model package not loaded for model "${args.node.binding.modelId}"`);
    }
    const workdir = sessionDirectory ?? args.roleDirs?.roleDir ?? args.baseWorkdir;
    return {
      binding: {
        kind: "model",
        modelPackage
      },
      bindingLabel: `model:${modelPackage.manifest.modelId}`,
      timeoutMs: modelPackage.manifest.timeoutMs ?? defaults.timeoutMs,
      maxOutputBytes: modelPackage.manifest.maxOutputBytes ?? defaults.maxOutputBytes,
      workdir,
      env: {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
        OGSYSTEM_ROLE_DIR: args.roleDirs?.roleDir ?? workdir,
        OGSYSTEM_PRIVATE_DIR: sessionDirectory ?? "",
        OGSYSTEM_ROLE_ID: args.roleId,
        OGSYSTEM_MODEL_ID: modelPackage.manifest.modelId,
        OGSYSTEM_ALLOWED_EVENTS: args.allowedEvents.join(",")
      },
      modelId: modelPackage.manifest.modelId,
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
      env: {
        OGSYSTEM_RUN_DIR: args.runContext.runDir,
        OGSYSTEM_SHARED_DIR: args.runContext.sharedDir,
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
