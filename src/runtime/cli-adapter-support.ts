import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, join } from "node:path";

export async function resolveExecutable(command: string, candidates: string[] = []): Promise<string | undefined> {
  const all = [command, ...candidates];
  for (const item of all) {
    if (item.includes("/") || item.includes("\\")) {
      try {
        await access(item, constants.X_OK);
        return item;
      } catch {
        continue;
      }
    }
    for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      const path = join(directory, item);
      try {
        await access(path, constants.X_OK);
        return path;
      } catch {
        continue;
      }
    }
  }
  return undefined;
}

export function boundedText(value: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes <= maxBytes) return value;
  return Buffer.from(value, "utf8").subarray(0, Math.max(0, maxBytes)).toString("utf8");
}

export function modelFromEnv(name: string, fallback = "default"): string {
  const value = process.env[name]?.trim();
  return value || fallback;
}

export function schemaInstruction(schema: unknown): string {
  if (!schema || typeof schema !== "object") return "";
  return `\nReturn only JSON matching this schema:\n${JSON.stringify(schema)}\n`;
}
