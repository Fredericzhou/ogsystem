import { Buffer } from "node:buffer";

export const MAX_JSON_REQUEST_BYTES = 1024 * 1024;

export class JsonBodyError extends Error {
  statusCode: number;
  errorCode: string;
  details?: unknown;

  constructor(statusCode: number, errorCode: string, message: string, details?: unknown) {
    super(message);
    this.name = "JsonBodyError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }
}

export async function readRequestBodyText(
  request: AsyncIterable<Buffer | string>,
  maxBytes = MAX_JSON_REQUEST_BYTES
): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new JsonBodyError(413, "JSON_BODY_TOO_LARGE", `Request body must be ${maxBytes} bytes or smaller.`, {
        limitBytes: maxBytes
      });
    }
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString("utf8").trim() : "";
}

export function parseJsonObjectBody(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new JsonBodyError(400, "INVALID_JSON_BODY", "Request body must be valid JSON.", {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new JsonBodyError(400, "INVALID_JSON_BODY", "Expected a JSON object request body.");
  }
  return parsed as Record<string, unknown>;
}

export async function readJsonRequestBody(
  request: AsyncIterable<Buffer | string>,
  maxBytes = MAX_JSON_REQUEST_BYTES
): Promise<Record<string, unknown>> {
  return parseJsonObjectBody(await readRequestBodyText(request, maxBytes));
}
