import { stringifyJson } from "./runtime-support.js";
import type { RuntimeRedactionConfig } from "./types.js";

const DEFAULT_SECRET_PATTERNS: RegExp[] = [
  /\b(sk-[A-Za-z0-9_-]{8,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._-]{8,})\b/gi,
  /\b(ghp_[A-Za-z0-9]{12,})\b/g
];
const KEY_VALUE_SECRET_PATTERN =
  /\b(password|passwd|token|secret|api[_-]?key|authorization|credential)\s*[:=]\s*([^\s,"'}]+)/gi;
const SENSITIVE_KEY_PATTERN =
  /^(authorization|proxy-authorization|password|passwd|token|accessToken|refreshToken|secret|apiKey|api[_-]?key|credential|credentials|providerCredential|providerCredentials)$/i;

function maskSecretLikeText(value: string): string {
  let redacted = value.replace(
    /\b(authorization|proxy-authorization)\s*[:=]\s*([A-Za-z]+\s+[^\s,"'}]+|[^\s,"'}]+)/gi,
    (_match, key: string) => `${key}=[REDACTED]`
  );
  redacted = redacted.replace(
    KEY_VALUE_SECRET_PATTERN,
    (_match, key: string) => `${key}=[REDACTED]`
  );
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) =>
      match.includes("Bearer ") ? "Bearer [REDACTED]" : "[REDACTED]"
    );
  }
  return redacted;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return "";
  }
  return stringifyJson(value);
}

export function redactText(value: string, config?: RuntimeRedactionConfig): string {
  if (config?.enabled === false) {
    return value;
  }
  return maskSecretLikeText(value);
}

export function redactOptionalText(
  value: string | undefined,
  config?: RuntimeRedactionConfig
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return redactText(value, config);
}

export function redactUnknown(value: unknown, config?: RuntimeRedactionConfig): unknown {
  if (config?.enabled === false) {
    return value;
  }
  if (typeof value === "string") {
    return redactText(value, config);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactUnknown(entry, config));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redactUnknown(entry, config)
      ])
    );
  }
  return value;
}

export function redactMarkdownText(value: string, config?: RuntimeRedactionConfig): string {
  return redactText(value, config);
}

export function redactJsonForStorage(value: unknown, config?: RuntimeRedactionConfig): string {
  return stringifyJson(redactUnknown(value, config));
}

export function redactPreviewText(value: string | undefined, config?: RuntimeRedactionConfig): string | undefined {
  if (!value) {
    return value;
  }
  return redactText(value, config);
}

export function redactInputContext(value: string | undefined, config?: RuntimeRedactionConfig): string | undefined {
  if (!value) {
    return value;
  }
  return redactText(value, config);
}

export function redactPromptText(value: string, config?: RuntimeRedactionConfig): string {
  return redactText(value, config);
}

export function redactStructuredProjection(
  value: Record<string, unknown>,
  config?: RuntimeRedactionConfig
): Record<string, unknown> {
  return (redactUnknown(value, config) as Record<string, unknown>) ?? {};
}

export function stringifyRedactedUnknown(value: unknown, config?: RuntimeRedactionConfig): string {
  const redacted = redactUnknown(value, config);
  if (typeof redacted === "string") {
    return redacted;
  }
  if (redacted === undefined || redacted === null) {
    return "";
  }
  return JSON.stringify(redacted);
}
