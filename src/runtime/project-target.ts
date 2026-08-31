/**
 * Resolves the optional external coding project attached to an OGSystem project.
 * The control plane remains rooted at `workdir`; this module only defines the
 * target-directory relationship used by execution and resume.
 */
import { relative, resolve } from "node:path";
import { stat } from "node:fs/promises";

import { readJsonFile } from "./json-file.js";

const PROJECT_CONFIG_RELATIVE_PATH = ".ogs/project.json";

type ProjectTargetRecord = {
  directory?: unknown;
};

function asTargetDirectory(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const directory = (value as ProjectTargetRecord).directory;
  return typeof directory === "string" && directory.trim() ? directory.trim() : undefined;
}

async function readSavedTargetDirectory(path: string): Promise<string | undefined> {
  const record = await readJsonFile(path).catch(() => undefined);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return undefined;
  }
  const target = (record as { target?: unknown }).target;
  const targetDirectory = asTargetDirectory(target);
  if (targetDirectory) {
    return targetDirectory;
  }
  const effective = (record as { effective?: unknown }).effective;
  if (!effective || typeof effective !== "object" || Array.isArray(effective)) {
    return undefined;
  }
  const directory = (effective as { targetDir?: unknown }).targetDir;
  return typeof directory === "string" && directory.trim() ? directory.trim() : undefined;
}

async function assertTargetDirectory(targetDir: string): Promise<string> {
  const resolvedTargetDir = resolve(targetDir);
  const targetStat = await stat(resolvedTargetDir).catch(() => undefined);
  if (!targetStat?.isDirectory()) {
    throw new Error(`OpenCode target directory does not exist or is not a directory: ${resolvedTargetDir}`);
  }
  return resolvedTargetDir;
}

/**
 * Resolves an execution target with this precedence:
 * explicit invocation, persisted resume target, project attachment, same-directory default.
 * A resume cannot silently switch to a different coding project.
 */
export async function resolveProjectTargetDirectory(args: {
  workdir: string;
  targetDir?: string;
  resumeRunDir?: string;
}): Promise<string> {
  const requestedTargetDir = args.targetDir
    ? resolve(args.workdir, args.targetDir)
    : undefined;
  const savedTargetDir = args.resumeRunDir
    ? await readSavedTargetDirectory(
        resolve(args.workdir, args.resumeRunDir, "resolved-config.json")
      )
    : undefined;
  const persistedTargetDir = savedTargetDir ? resolve(savedTargetDir) : undefined;

  if (
    requestedTargetDir &&
    persistedTargetDir &&
    requestedTargetDir !== persistedTargetDir
  ) {
    throw new Error(
      `Resume target directory differs from the original run: expected ${persistedTargetDir}, received ${requestedTargetDir}`
    );
  }

  const attachedTargetDir = args.targetDir
    ? undefined
    : await readSavedTargetDirectory(resolve(args.workdir, PROJECT_CONFIG_RELATIVE_PATH));
  return assertTargetDirectory(
    requestedTargetDir ?? persistedTargetDir ??
      (attachedTargetDir ? resolve(args.workdir, attachedTargetDir) : resolve(args.workdir))
  );
}

export function projectTargetConfig(args: {
  workdir: string;
  targetDir: string;
}): { directory: string } {
  const resolvedWorkdir = resolve(args.workdir);
  const resolvedTargetDir = resolve(args.targetDir);
  const relativeDirectory = relative(resolvedWorkdir, resolvedTargetDir) || ".";
  return {
    directory: relativeDirectory
  };
}
