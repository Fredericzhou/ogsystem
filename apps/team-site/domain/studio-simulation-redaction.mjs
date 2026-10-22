const SENSITIVE_KEY = /^(authorization|proxy-authorization|password|passwd|token|accessToken|refreshToken|secret|secret[_-]?key|apiKey|api[_-]?key|credential|credentials|providerCredential|providerCredentials|private[_-]?key)$/i;
const KEY_VALUE_SECRET = /\b(password|passwd|token|secret|secret[_-]?key|api[_-]?key|authorization|credential|private[_-]?key|client[_-]?secret)\s*[:=]\s*([^\s,"'}]+)/gi;
const SECRET_PATTERNS = [
  /\b(sk-[A-Za-z0-9_-]{8,})\b/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._-]{8,})\b/gi,
  /\b(ghp_[A-Za-z0-9]{12,})\b/g
];

export function redactStudioSimulationText(value) {
  let redacted = String(value || "").replace(
    /\b(authorization|proxy-authorization)\s*[:=]\s*([A-Za-z]+\s+[^\s,"'}]+|[^\s,"'}]+)/gi,
    (_match, key) => `${key}=[REDACTED]`
  ).replace(KEY_VALUE_SECRET, (_match, key) => `${key}=[REDACTED]`);
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => match.toLowerCase().startsWith("bearer ") ? "Bearer [REDACTED]" : "[REDACTED]");
  }
  return redacted;
}

export function redactStudioSimulationValue(value) {
  if (typeof value === "string") return redactStudioSimulationText(value);
  if (Array.isArray(value)) return value.map(redactStudioSimulationValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactStudioSimulationValue(entry)
    ]));
  }
  return value;
}
