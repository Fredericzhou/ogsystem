import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { Readable } from "node:stream";

export class ByteRangeError extends Error {
  constructor(size) {
    super("Requested byte range is not satisfiable.");
    this.code = "BYTE_RANGE_NOT_SATISFIABLE";
    this.size = size;
  }
}

export function parseByteRange(value, size) {
  if (value === undefined || value === null || value === "") return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) throw new ByteRangeError(size);
  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new ByteRangeError(size);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
      throw new ByteRangeError(size);
    }
    end = Math.min(end, size - 1);
  }
  if (size <= 0 || start >= size || end < start) throw new ByteRangeError(size);
  return { start, end, length: end - start + 1 };
}

async function openRegularFile(path, label) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  const stats = await handle.stat();
  if (!stats.isFile()) {
    await handle.close();
    throw new Error(`FILE_PATH_INVALID: ${label} must be a regular file.`);
  }
  return { handle, stats };
}

export async function hashVerifiedFile(path, expectedSha256, label = "file") {
  const { handle, stats } = await openRegularFile(path, label);
  const hash = createHash("sha256");
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    await handle.close().catch(() => undefined);
  }
  const digest = hash.digest("hex");
  if (expectedSha256 && digest !== String(expectedSha256).toLowerCase()) {
    const error = new Error(`FILE_DIGEST_MISMATCH: ${label} failed integrity verification.`);
    error.code = "FILE_DIGEST_MISMATCH";
    throw error;
  }
  return { size: stats.size, mtimeMs: stats.mtimeMs, ino: stats.ino, dev: stats.dev, sha256: digest };
}

export async function openVerifiedFile(path, {
  expectedSha256,
  range,
  maxBytes = 2 * 1024 * 1024,
  maxRangeBytes = 16 * 1024 * 1024,
  label = "file"
} = {}) {
  const initial = await openRegularFile(path, label);
  await initial.handle.close();
  const byteRange = parseByteRange(range, initial.stats.size);
  if (!byteRange && initial.stats.size > maxBytes) {
    return { size: initial.stats.size, tooLarge: true };
  }
  if (byteRange && byteRange.length > maxRangeBytes) {
    return { size: initial.stats.size, range: byteRange, tooLarge: true };
  }
  const verified = await hashVerifiedFile(path, expectedSha256, label);
  const current = await openRegularFile(path, label);
  if (current.stats.size !== verified.size || current.stats.mtimeMs !== verified.mtimeMs || current.stats.ino !== verified.ino || current.stats.dev !== verified.dev) {
    await current.handle.close();
    throw new Error(`FILE_RACE: ${label} changed while it was being opened.`);
  }
  if (current.stats.size === 0) {
    await current.handle.close();
    return { size: 0, sha256: verified.sha256, range: null, contentLength: 0, stream: Readable.from([]) };
  }
  const start = byteRange?.start ?? 0;
  const end = byteRange?.end ?? current.stats.size - 1;
  const stream = current.handle.createReadStream({ start, end, autoClose: true });
  stream.once("error", () => current.handle.close().catch(() => undefined));
  return {
    size: current.stats.size,
    sha256: verified.sha256,
    range: byteRange,
    contentLength: byteRange ? byteRange.length : current.stats.size,
    stream
  };
}
