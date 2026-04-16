#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { accessSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  validateLawsConfig,
  validateProfilesConfig,
  validateUserProfileConfig
} from "../../../dist/runtime/config.js";
import { loadModelPackage } from "../../../dist/runtime/model-repo.js";
import { parseSystemFromMermaidSource } from "../../../dist/runtime/parse-mermaid.js";
import { loadRolePackage } from "../../../dist/runtime/role-repo.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "../../..");
const defaultRoleRoot = resolve(repoRoot, "og-roles", "roles");
const defaultModelRoot = resolve(repoRoot, "og-models");

function usage() {
  return [
    "Usage:",
    "  node skills/ogsystem-nl-to-mmd/scripts/validate_ogsystem_mmd.mjs --system <file.mmd>",
    "",
    "Options:",
    "  --system <file>        Mermaid system file to validate",
    "  --role-root <dir>      Role root directory (default: og-roles/roles)",
    "  --model-root <dir>     Model root directory (default: og-models)",
    "  --profiles <file>      Optional profiles.json for exec.bind validation",
    "  --user-profile <file>  Optional user-profile.json validation",
    "  --laws <file>          Optional laws.json for law.global validation",
    "  --run-dir <dir>        Optional generated .ogs/runs/<run-id> validation",
    "  --help                 Show help"
  ].join("\n");
}

async function readJson(path) {
  const source = await readFile(path, "utf8");
  return JSON.parse(source);
}

function fileExists(path) {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function getEventEnum(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return null;
  }
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return null;
  }
  const eventSchema = properties.event;
  if (!eventSchema || typeof eventSchema !== "object" || Array.isArray(eventSchema)) {
    return null;
  }
  return Array.isArray(eventSchema.enum)
    ? eventSchema.enum.filter((item) => typeof item === "string")
    : null;
}

function requireFile(path, errors, label) {
  if (!fileExists(path)) {
    errors.push(`missing ${label}: ${path}`);
  }
}

async function validateRunDir(runDir, system, errors, warnings) {
  requireFile(resolve(runDir, "run.md"), errors, "run contract file");
  requireFile(resolve(runDir, "request.md"), errors, "run contract file");
  requireFile(resolve(runDir, "system.mmd"), errors, "run contract file");
  requireFile(resolve(runDir, "state.json"), errors, "run contract file");
  requireFile(resolve(runDir, "events.ndjson"), errors, "run contract file");
  requireFile(resolve(runDir, "audit", "summary.md"), errors, "run contract file");
  requireFile(resolve(runDir, "audit", "transitions.md"), errors, "run contract file");

  const rolesDir = resolve(runDir, "roles");
  if (!fileExists(rolesDir)) {
    errors.push(`missing roles directory: ${rolesDir}`);
    return;
  }

  const roleIds = await readdir(rolesDir);
  if (roleIds.length === 0) {
    warnings.push(`run directory has no role artifacts under ${rolesDir}`);
    return;
  }

  if (fileExists(resolve(runDir, "state.json"))) {
    const stateJson = await readJson(resolve(runDir, "state.json"));
    if (system.engine === "langgraph") {
      if (!Array.isArray(stateJson.activeBranches)) {
        errors.push(`langgraph run state is missing activeBranches in ${resolve(runDir, "state.json")}`);
      }
      if (!Array.isArray(stateJson.completedBranches)) {
        errors.push(`langgraph run state is missing completedBranches in ${resolve(runDir, "state.json")}`);
      }
      if (!stateJson.loopIterations || typeof stateJson.loopIterations !== "object") {
        errors.push(`langgraph run state is missing loopIterations in ${resolve(runDir, "state.json")}`);
      }
      if (!stateJson.graphState || typeof stateJson.graphState !== "object") {
        errors.push(`langgraph run state is missing graphState in ${resolve(runDir, "state.json")}`);
      }
    }
  }

  for (const roleId of roleIds) {
    const roleDir = resolve(rolesDir, roleId);
    requireFile(resolve(roleDir, "private"), errors, `role private directory for "${roleId}"`);
    requireFile(resolve(roleDir, "role.md"), errors, `role artifact for "${roleId}"`);

    const executedArtifacts = ["inbox.md", "prompt.md", "audit.md"];
    const presentCount = executedArtifacts.filter((name) => fileExists(resolve(roleDir, name))).length;
    if (presentCount > 0 && presentCount !== executedArtifacts.length) {
      errors.push(`role "${roleId}" has partial execution artifacts; expected inbox.md, prompt.md, audit.md together`);
    }
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      system: { type: "string" },
      "role-root": { type: "string" },
      "model-root": { type: "string" },
      profiles: { type: "string" },
      "user-profile": { type: "string" },
      laws: { type: "string" },
      "run-dir": { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  if (!values.system) {
    throw new Error(`Missing required --system\n\n${usage()}`);
  }

  const systemPath = resolve(process.cwd(), values.system);
  const roleRoot = resolve(process.cwd(), values["role-root"] ?? defaultRoleRoot);
  const modelRoot = resolve(process.cwd(), values["model-root"] ?? defaultModelRoot);
  const errors = [];
  const warnings = [];

  const source = await readFile(systemPath, "utf8");
  const system = parseSystemFromMermaidSource(source);

  let profilesById = null;
  let allowNoopWithoutExecutionBinding = false;
  if (values.profiles) {
    const profilesPath = resolve(process.cwd(), values.profiles);
    const profiles = validateProfilesConfig(await readJson(profilesPath), profilesPath);
    profilesById = new Map(profiles.map((profile) => [profile.profileId, profile]));
  }

  if (values.laws) {
    const lawsPath = resolve(process.cwd(), values.laws);
    const laws = validateLawsConfig(await readJson(lawsPath), lawsPath);
    const matchingLaw = laws.laws.find((law) => law.lawId === system.lawBinding.globalLawRef);
    if (!matchingLaw) {
      errors.push(`law.global "${system.lawBinding.globalLawRef}" not found in ${lawsPath}`);
    } else {
      allowNoopWithoutExecutionBinding =
        matchingLaw.constraints?.allowNoopWithoutExecutionBinding === true;
    }
  }

  if (values["user-profile"]) {
    const userProfilePath = resolve(process.cwd(), values["user-profile"]);
    validateUserProfileConfig(await readJson(userProfilePath), userProfilePath);
  }

  if (values["run-dir"]) {
    const runDir = resolve(process.cwd(), values["run-dir"]);
    await validateRunDir(runDir, system, errors, warnings);
  }

  const outgoingByRole = new Map();
  for (const flow of system.flows) {
    const list = outgoingByRole.get(flow.fromRoleId) ?? [];
    list.push(flow.eventType);
    outgoingByRole.set(flow.fromRoleId, list);
  }

  for (const roleId of system.roleIds) {
    const roleDir = resolve(roleRoot, roleId);
    const roleJsonPath = resolve(roleDir, "role.json");
    const promptPath = resolve(roleDir, "prompt.md");
    const outputSchemaPath = resolve(roleDir, "output.schema.json");

    if (!fileExists(roleJsonPath)) {
      errors.push(`missing role package: ${roleJsonPath}`);
      continue;
    }
    if (!fileExists(promptPath)) {
      errors.push(`missing prompt template: ${promptPath}`);
    }
    if (!fileExists(outputSchemaPath)) {
      errors.push(`missing output schema: ${outputSchemaPath}`);
    }

    try {
      const rolePackage = await loadRolePackage({ roleId, roleRootDir: roleRoot });
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
            errors.push(
              `role "${roleId}" output event enum is missing outgoing event "${event}"`
            );
          }
        }
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const modelId = system.modelBinding[roleId];
    const profileId = system.executionBinding[roleId];

    if (modelId) {
      try {
        await loadModelPackage({ modelId, modelRootDir: modelRoot });
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    if (!modelId && !profileId) {
      if (allowNoopWithoutExecutionBinding) {
        warnings.push(
          `role "${roleId}" has no model.bind.${roleId} or exec.bind.${roleId}; current law allows noop only for unambiguous single-path roles`
        );
      } else {
        errors.push(`role "${roleId}" is missing required model.bind.${roleId} or exec.bind.${roleId}`);
      }
      continue;
    }

    if (profilesById && !profilesById.has(profileId)) {
      errors.push(`exec.bind.${roleId} references missing profile "${profileId}"`);
    }
  }

  const result = {
    status: errors.length > 0 ? "failed" : "ok",
    system: {
      systemId: system.systemId,
      systemVersion: system.systemVersion,
      entryRoleId: system.entryRoleId,
      lawRef: system.lawBinding.globalLawRef,
      roleIds: system.roleIds
    },
    errors,
    warnings
  };

  console.log(JSON.stringify(result, null, 2));
  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const result = {
    status: "failed",
    errors: [error instanceof Error ? error.message : String(error)],
    warnings: []
  };
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
});
