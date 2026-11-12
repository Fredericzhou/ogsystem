import { findExecutable } from "./executable-resolver.js";

export async function resolveExecutable(command: string, candidates: string[] = []): Promise<string | undefined> {
  return [command, ...candidates].map(findExecutable).find(Boolean);
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
