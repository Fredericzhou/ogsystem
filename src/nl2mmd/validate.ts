import { readJsonFile } from "../runtime/json-file.js";
import { loadModelPackage } from "../runtime/model-repo.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { loadRolePackage } from "../runtime/role-repo.js";
import {
  validateLawsConfig,
  validateProfilesConfig,
  validateUserProfileConfig
} from "../runtime/config.js";
import { renderTxtGraphFromMermaidSource } from "./txt-graph.js";
import type { Nl2MmdContext, Nl2MmdValidationResult } from "./types.js";

function getEventEnum(schema: unknown): string[] | null {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    return null;
  }
  const record = schema as {
    properties?: {
      event?: {
        enum?: unknown;
      };
    };
  };
  return Array.isArray(record.properties?.event?.enum)
    ? record.properties.event.enum.filter((item): item is string => typeof item === "string")
    : null;
}

export async function validateNl2MmdCandidate(args: {
  mermaid: string;
  context: Nl2MmdContext;
  lawsPath?: string;
  profilesPath?: string;
  userProfilePath?: string;
}): Promise<Nl2MmdValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  let system;
  try {
    system = parseSystemFromMermaidSource(args.mermaid);
  } catch (error) {
    return {
      status: "failed",
      errors: [error instanceof Error ? error.message : String(error)],
      warnings: []
    };
  }

  let allowNoopWithoutExecutionBinding = false;
  if (args.lawsPath) {
    const laws = validateLawsConfig(await readJsonFile(args.lawsPath), args.lawsPath);
    const law = laws.laws.find((item) => item.lawId === system.lawBinding.globalLawRef);
    if (!law) {
      errors.push(`law.global "${system.lawBinding.globalLawRef}" not found in ${args.lawsPath}`);
    } else {
      allowNoopWithoutExecutionBinding =
        law.constraints?.allowNoopWithoutExecutionBinding === true;
    }
  }

  if (args.userProfilePath) {
    await validateUserProfileConfig(await readJsonFile(args.userProfilePath), args.userProfilePath);
  }

  let profilesById: Map<string, string> | undefined;
  if (args.profilesPath) {
    const profiles = validateProfilesConfig(await readJsonFile(args.profilesPath), args.profilesPath);
    profilesById = new Map(profiles.map((profile) => [profile.profileId, profile.profileId]));
  }

  const outgoingByRole = new Map<string, string[]>();
  for (const flow of system.flows) {
    const bucket = outgoingByRole.get(flow.fromRoleId) ?? [];
    bucket.push(flow.eventType);
    outgoingByRole.set(flow.fromRoleId, bucket);
  }

  for (const roleId of system.roleIds) {
    try {
      const rolePackage = await loadRolePackage({
        roleId,
        roleRootDir: args.context.roleRootDir
      });
      const outgoingEvents = outgoingByRole.get(roleId) ?? [];
      const eventEnum = getEventEnum(rolePackage.outputSchema);

      if (outgoingEvents.length > 0 && !eventEnum) {
        warnings.push(
          `role "${roleId}" has outgoing flows but output.schema.json does not constrain event enum`
        );
      }

      if (eventEnum) {
        for (const event of outgoingEvents) {
          if (!eventEnum.includes(event)) {
            errors.push(`role "${roleId}" output event enum is missing outgoing event "${event}"`);
          }
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    const modelId = system.modelBinding[roleId];
    const profileId = system.executionBinding[roleId];

    if (modelId) {
      try {
        await loadModelPackage({
          modelId,
          modelRootDir: args.context.modelRootDir
        });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (profileId && profilesById && !profilesById.has(profileId)) {
      errors.push(`exec.bind.${roleId} references missing profile "${profileId}"`);
    }

    if (!modelId && !profileId) {
      if (allowNoopWithoutExecutionBinding) {
        warnings.push(
          `role "${roleId}" has no model.bind.${roleId} or exec.bind.${roleId}; current law allows noop only for unambiguous single-path roles`
        );
      } else {
        errors.push(`role "${roleId}" is missing required model.bind.${roleId} or exec.bind.${roleId}`);
      }
    }
  }

  return {
    status: errors.length > 0 ? "failed" : "ok",
    system: {
      systemId: system.systemId,
      systemVersion: system.systemVersion,
      entryRoleId: system.entryRoleId,
      lawRef: system.lawBinding.globalLawRef,
      roleIds: system.roleIds
    },
    errors,
    warnings,
    txtGraph: renderTxtGraphFromMermaidSource(args.mermaid)
  };
}
