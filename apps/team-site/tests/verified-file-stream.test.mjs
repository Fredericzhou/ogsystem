import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { hashVerifiedFile, openVerifiedFile, parseByteRange } from "../infrastructure/verified-file-stream.mjs";

test("verified file streams enforce hashes and serve bounded byte ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-file-stream-"));
  const path = join(root, "sample.bin");
  const content = Buffer.from("0123456789");
  try {
    await writeFile(path, content);
    const digest = createHash("sha256").update(content).digest("hex");
    assert.deepEqual(parseByteRange("bytes=2-5", content.length), { start: 2, end: 5, length: 4 });
    assert.deepEqual(parseByteRange("bytes=-3", content.length), { start: 7, end: 9, length: 3 });
    const verified = await hashVerifiedFile(path, digest);
    assert.equal(verified.size, 10);
    assert.equal(verified.sha256, digest);
    const opened = await openVerifiedFile(path, { expectedSha256: digest, range: "bytes=2-5", maxRangeBytes: 8 });
    assert.equal(opened.contentLength, 4);
    const chunks = [];
    for await (const chunk of opened.stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), "2345");
    await assert.rejects(openVerifiedFile(path, { expectedSha256: "0".repeat(64), range: "bytes=2-5" }), /FILE_DIGEST_MISMATCH/);
    assert.throws(() => parseByteRange("bytes=20-21", content.length), { code: "BYTE_RANGE_NOT_SATISFIABLE" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified file streams reject oversized un-ranged files while allowing bounded ranges", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-file-stream-limit-"));
  const path = join(root, "large.bin");
  try {
    await writeFile(path, Buffer.alloc(32, 65));
    const digest = createHash("sha256").update(await readFile(path)).digest("hex");
    assert.equal((await openVerifiedFile(path, { expectedSha256: digest, maxBytes: 8 })).tooLarge, true);
    const ranged = await openVerifiedFile(path, { expectedSha256: digest, range: "bytes=0-7", maxBytes: 8 });
    assert.equal(ranged.contentLength, 8);
    ranged.stream.destroy();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verified file streams handle empty artifacts without an invalid range", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-file-stream-empty-"));
  const path = join(root, "empty.bin");
  try {
    await writeFile(path, Buffer.alloc(0));
    const digest = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
    const opened = await openVerifiedFile(path, { expectedSha256: digest });
    assert.equal(opened.contentLength, 0);
    const chunks = [];
    for await (const chunk of opened.stream) chunks.push(chunk);
    assert.deepEqual(chunks, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
