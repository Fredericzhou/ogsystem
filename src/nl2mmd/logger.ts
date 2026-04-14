/**
 * @fileoverview Lightweight debug logger for NL2MMD workflows.
 * File Set: nl2mmd-observability
 * Responsibilities:
 * - Gate debug logs by environment flag.
 * - Sanitize structured fields before printing.
 * Boundaries:
 * - No persistence or trace aggregation.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      sanitized[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      sanitized[key] = value.slice(0, 8);
      continue;
    }
    if (isRecord(value)) {
      sanitized[key] = "[object]";
      continue;
    }
    sanitized[key] = String(value);
  }
  return sanitized;
}

function isNl2MmdDebugEnabled(): boolean {
  const value = process.env.OGSYSTEM_NL2MMD_DEBUG?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function logNl2MmdDebug(event: string, fields?: Record<string, unknown>): void {
  if (!isNl2MmdDebugEnabled()) {
    return;
  }
  const payload = fields ? ` ${JSON.stringify(sanitizeFields(fields))}` : "";
  console.error(`[nl2mmd] ${event}${payload}`);
}
