/**
 * @fileoverview Local validator for NL2MMD Mermaid candidates against runtime contracts.
 * File Set: nl2mmd-validation
 * Responsibilities:
 * - Parse Mermaid with runtime parser and cross-check role/model/binding consistency.
 * - Return structured errors/warnings and txt-graph preview.
 * Boundaries:
 * - Validation only; does not execute runs.
 */
import { readJsonFile } from "../runtime/json-file.js";
import { resolveModelSelectionForSystem } from "../runtime/model-selection.js";
import { parseSystemFromMermaidSource } from "../runtime/parse-mermaid.js";
import { loadRolePackage } from "../runtime/role-repo.js";
import {
  validateLawsConfig,
  validateProfilesConfig,
  validateUserProfileConfig
} from "../runtime/config.js";
import { renderTxtGraphFromMermaidSource } from "./txt-graph.js";
import type { Nl2MmdContext, Nl2MmdValidationResult } from "./types.js";

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function loadRolePackageForValidation(args: {
  roleId: string;
  context: Nl2MmdContext;
}) {
  try {
    return await loadRolePackage({
      roleId: args.roleId,
      roleRootDir: args.context.roleRootDir
    });
  } catch (error) {
    if (
      isFileNotFoundError(error) &&
      args.context.templateRoleRootDir &&
      args.context.templateRoleRootDir !== args.context.roleRootDir
    ) {
      return loadRolePackage({
        roleId: args.roleId,
        roleRootDir: args.context.templateRoleRootDir
      });
    }
    throw error;
  }
}

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

function isRuntimeErrorEdgeEvent(event: string): boolean {
  return event === "ERROR" || event.startsWith("ERROR.");
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

  let resolvedModelsByRoleId = new Map<string, { modelRef: string }>();
  try {
    const resolvedModelSelection = resolveModelSelectionForSystem({
      system,
      selection: args.context.modelSelection,
      catalog: args.context.rawModelCatalog
    });
    resolvedModelsByRoleId = resolvedModelSelection.resolvedByRoleId;
    warnings.push(...resolvedModelSelection.warnings);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
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

  const roleChecks = await Promise.all(
    system.roleIds.map(async (roleId) => {
      const roleErrors: string[] = [];
      const roleWarnings: string[] = [];

      try {
        const rolePackage = await loadRolePackageForValidation({
          roleId,
          context: args.context
        });
        const outgoingEvents = outgoingByRole.get(roleId) ?? [];
        const eventEnum = getEventEnum(rolePackage.outputSchema);

        if (outgoingEvents.length > 0 && !eventEnum) {
          roleWarnings.push(
            `role "${roleId}" has outgoing flows but output.schema.json does not constrain event enum`
          );
        }

        if (eventEnum) {
          for (const event of outgoingEvents) {
            if (isRuntimeErrorEdgeEvent(event)) {
              continue;
            }
            if (!eventEnum.includes(event)) {
              roleErrors.push(`role "${roleId}" output event enum is missing outgoing event "${event}"`);
            }
          }
        }
      } catch (error) {
        roleErrors.push(error instanceof Error ? error.message : String(error));
        return { roleErrors, roleWarnings };
      }

      const modelBinding = system.modelBinding[roleId];
      const profileId = system.executionBinding[roleId];
      const resolvedModel = resolvedModelsByRoleId.get(roleId);

      if (modelBinding && resolvedModel && resolvedModel.modelRef !== modelBinding) {
        roleWarnings.push(
          `role "${roleId}" declares model.bind.${roleId}="${modelBinding}" but resolves via "${resolvedModel.modelRef}" from .ogs/model-selection.json`
        );
      }

      if (profileId && profilesById && !profilesById.has(profileId)) {
        roleErrors.push(`exec.bind.${roleId} references missing profile "${profileId}"`);
      }

      if (!resolvedModel && !profileId) {
        if (allowNoopWithoutExecutionBinding) {
          roleWarnings.push(
            `role "${roleId}" has no model.bind.${roleId} or exec.bind.${roleId}; current law allows noop only for unambiguous single-path roles`
          );
        } else {
          roleErrors.push(`role "${roleId}" is missing required model.bind.${roleId} or exec.bind.${roleId}`);
        }
      }

      return { roleErrors, roleWarnings };
    })
  );

  for (const { roleErrors, roleWarnings } of roleChecks) {
    errors.push(...roleErrors);
    warnings.push(...roleWarnings);
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
