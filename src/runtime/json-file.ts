/**
 * @fileoverview Small JSON/text file helpers with atomic write semantics.
 * File Set: runtime-support
 * Responsibilities:
 * - Read JSON with consistent parse errors.
 * - Write JSON/text via temp-file rename to reduce partial-write risk.
 * Boundaries:
 * - No schema validation or domain-level error envelopes.
 */
import { randomUUID } from "node:crypto";
import { unlink, writeFile, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";

export async function readJsonFile(path: string): Promise<unknown> {
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${path}: ${message}`);
  }
}

export async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
  const tempPath = join(dirname(path), `${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, JSON.stringify(value, null, 2), "utf8");
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore temp cleanup failures.
    }
    throw error;
  }
}

export async function writeTextFileAtomic(path: string, value: string): Promise<void> {
  const tempPath = join(dirname(path), `${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, value, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    try {
      await unlink(tempPath);
    } catch {
      // Ignore temp cleanup failures.
    }
    throw error;
  }
}
