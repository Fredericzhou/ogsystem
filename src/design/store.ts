import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readJsonFile, writeJsonFileAtomic } from "../runtime/json-file.js";
import { designDigest, validateSystemDesign } from "./change-set.js";
import type { SystemDesignDocument } from "./types.js";

export function systemDesignPath(workdir: string): string {
  return resolve(workdir, "system.design.json");
}

export async function loadSystemDesign(workdir: string): Promise<SystemDesignDocument | null> {
  try {
    const value = await readJsonFile(systemDesignPath(workdir));
    const validation = validateSystemDesign(value as SystemDesignDocument);
    if (!validation.ok) throw new Error(validation.diagnostics.map((item) => item.message).join("; "));
    return value as SystemDesignDocument;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}

export async function saveSystemDesign(workdir: string, design: SystemDesignDocument): Promise<{ path: string; digest: string }> {
  const validation = validateSystemDesign(design);
  if (!validation.ok) throw new Error(validation.diagnostics.map((item) => item.message).join("; "));
  const path = systemDesignPath(workdir);
  await mkdir(resolve(workdir), { recursive: true });
  await writeJsonFileAtomic(path, design);
  return { path, digest: designDigest(design) };
}

export async function readRawSystemDesign(workdir: string): Promise<string | null> {
  try {
    return await readFile(systemDesignPath(workdir), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT") return null;
    throw error;
  }
}
