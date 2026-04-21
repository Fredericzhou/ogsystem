#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

import { agencyAgentsAdapter } from "../importers/agency-agents.mjs";

const execFile = promisify(execFileCallback);

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    event: {
      type: "string",
      enum: ["DONE", "NEEDS_CLARIFICATION", "BLOCKED"]
    },
    content: {
      type: "string"
    },
    data: {
      type: "object",
      additionalProperties: true
    }
  },
  required: ["event"],
  additionalProperties: false
};

const PROMPT_TEMPLATE = [
  "{{agent}}",
  "",
  "Return one JSON object only.",
  "",
  "Allowed events:",
  "{{allowed_events}}",
  "",
  "User preferences:",
  "{{user_preferences}}",
  "",
  "Task:",
  "{{task}}",
  "",
  "Input:",
  "{{input}}",
  "",
  "Output requirements:",
  "- Choose the most appropriate event from allowed_events.",
  "- Use NEEDS_CLARIFICATION when the task or input is underspecified.",
  "- Use BLOCKED when you cannot proceed without an external dependency or missing access.",
  "- Put the main answer in content and optional structured details in data."
].join("\n");

const ADAPTERS = new Map([["agency-agents", agencyAgentsAdapter]]);

function parseArgs(argv) {
  const args = {
    sourceId: undefined,
    sourceRoot: undefined,
    rolesRoot: resolve("og-roles/roles"),
    lockFile: resolve("og-roles/sources.lock.json")
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--source" && next) {
      args.sourceId = next;
      index += 1;
      continue;
    }
    if (token === "--source-root" && next) {
      args.sourceRoot = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--roles-root" && next) {
      args.rolesRoot = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--lock-file" && next) {
      args.lockFile = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--help") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.sourceId) {
    throw new Error("Missing required --source <source-id> argument.");
  }
  if (!args.sourceRoot) {
    args.sourceRoot = resolve("agent-sources", args.sourceId);
  }
  return args;
}

function printUsage() {
  console.log(
    [
      "Usage:",
      "  node og-roles/scripts/sync-agent-sources.mjs --source <source-id> [options]",
      "",
      "Options:",
      "  --source-root <path>  Source checkout root (default: agent-sources/<source-id>)",
      "  --roles-root <path>   Canonical role output root (default: og-roles/roles)",
      "  --lock-file <path>    Source lock file path (default: og-roles/sources.lock.json)"
    ].join("\n")
  );
}

async function getGitMetadata(rootDir) {
  try {
    const [commit, branch, remote] = await Promise.all([
      execFile("git", ["-C", rootDir, "rev-parse", "HEAD"]),
      execFile("git", ["-C", rootDir, "rev-parse", "--abbrev-ref", "HEAD"]),
      execFile("git", ["-C", rootDir, "config", "--get", "remote.origin.url"])
    ]);
    return {
      commit: commit.stdout.trim(),
      branch: branch.stdout.trim(),
      remote: remote.stdout.trim()
    };
  } catch {
    return {
      commit: null,
      branch: null,
      remote: null
    };
  }
}

async function loadExistingLock(lockFile) {
  try {
    return JSON.parse(await readFile(lockFile, "utf8"));
  } catch {
    return {
      version: 1,
      generatedAt: null,
      sources: {}
    };
  }
}

async function writeJson(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${value.trimEnd()}\n`, "utf8");
}

async function removeMissingImportedRoles(rolesRoot, sourceRoleIds) {
  const entries = await readdir(rolesRoot, { withFileTypes: true }).catch(() => []);
  const currentRoleIds = new Set(sourceRoleIds);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("imported.")) {
      continue;
    }
    if (entry.name.startsWith("imported.agency.") && !currentRoleIds.has(entry.name)) {
      await rm(join(rolesRoot, entry.name), { recursive: true, force: true });
    }
  }
}

async function syncSource(args) {
  const adapter = ADAPTERS.get(args.sourceId);
  if (!adapter) {
    throw new Error(`Unsupported source adapter: ${args.sourceId}`);
  }
  const detected = await adapter.detect(args.sourceRoot);
  if (!detected) {
    throw new Error(`Source root does not match adapter "${args.sourceId}": ${args.sourceRoot}`);
  }

  const git = await getGitMetadata(args.sourceRoot);
  const listedAgents = await adapter.listAgents(args.sourceRoot);
  const generatedAt = new Date().toISOString();
  const normalized = [];

  for (const record of listedAgents) {
    const role = await adapter.normalize(record, {
        sourceId: args.sourceId,
        sourceRoot: args.sourceRoot,
        sourceCommit: git.commit
      });
    if (role) {
      normalized.push(role);
    }
  }

  await mkdir(args.rolesRoot, { recursive: true });
  for (const role of normalized) {
    const roleDir = join(args.rolesRoot, role.roleId);
    await mkdir(roleDir, { recursive: true });
    await writeJson(join(roleDir, "role.json"), {
      roleId: role.roleId,
      roleVersion: role.roleVersion,
      name: role.roleName,
      description: role.description,
      promptTemplate: "prompt.md",
      outputSchema: "output.schema.json",
      tags: role.tags
    });
    await writeText(join(roleDir, "agent.md"), role.agent);
    await writeText(join(roleDir, "prompt.md"), PROMPT_TEMPLATE);
    await writeJson(join(roleDir, "output.schema.json"), OUTPUT_SCHEMA);
    await writeJson(join(roleDir, "source.json"), {
      version: 1,
      sourceType: adapter.sourceType,
      sourceId: args.sourceId,
      importedAt: generatedAt,
      roleId: role.roleId,
      upstream: {
        path: role.sourcePath,
        commit: git.commit,
        branch: git.branch,
        remote: git.remote
      }
    });
  }

  await removeMissingImportedRoles(
    args.rolesRoot,
    normalized.map((role) => role.roleId)
  );

  const lock = await loadExistingLock(args.lockFile);
  lock.generatedAt = generatedAt;
  lock.sources[args.sourceId] = {
    sourceType: adapter.sourceType,
    sourceRoot: args.sourceRoot,
    commit: git.commit,
    branch: git.branch,
    remote: git.remote,
    roleIds: normalized.map((role) => role.roleId),
    records: normalized.map((role) => ({
      roleId: role.roleId,
      roleName: role.roleName,
      sourcePath: role.sourcePath
    }))
  };
  await writeJson(args.lockFile, lock);

  console.log(
    JSON.stringify(
      {
        sourceId: args.sourceId,
        sourceRoot: args.sourceRoot,
        roleCount: normalized.length,
        lockFile: args.lockFile
      },
      null,
      2
    )
  );
}

const args = parseArgs(process.argv.slice(2));
await syncSource(args);
