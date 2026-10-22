import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";

function assertSegment(segment, index) {
  if (typeof segment !== "string" || !segment || segment === "." || segment === ".."
    || isAbsolute(segment) || segment.includes("/") || segment.includes("\\")) {
    throw new Error(`Evidence path segment ${index} is invalid.`);
  }
}

export function resolveSafeEvidencePath(root, segments) {
  if (typeof root !== "string" || !root || !Array.isArray(segments)) {
    throw new TypeError("Evidence path requires a root and path segments.");
  }
  const resolvedRoot = resolve(root);
  let target = resolvedRoot;
  for (const [index, segment] of segments.entries()) {
    assertSegment(segment, index);
    target = resolve(target, segment);
    if (!target.startsWith(`${resolvedRoot}${sep}`)) {
      throw new Error("Evidence path is outside its configured root.");
    }
  }
  return target;
}

export async function assertSafeEvidencePath(root, segments, {
  kind = "any",
  allowMissingFinal = false,
  label = "evidence"
} = {}) {
  if (!["any", "directory", "file"].includes(kind)) throw new TypeError("Evidence path kind must be any, directory, or file.");
  const resolvedRoot = resolve(root);
  const target = resolveSafeEvidencePath(resolvedRoot, segments);
  const paths = [resolvedRoot];
  let current = resolvedRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    paths.push(current);
  }

  for (const [index, path] of paths.entries()) {
    const isFinal = index === paths.length - 1;
    let stats;
    try {
      stats = await lstat(path);
    } catch (error) {
      if (error?.code === "ENOENT" && isFinal && allowMissingFinal) return target;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`RUN_EVIDENCE_LINK_NOT_ALLOWED: ${label} path cannot contain symlinks or junctions.`);
    }
    if (!isFinal && !stats.isDirectory()) {
      throw new Error(`RUN_EVIDENCE_PATH_INVALID: ${label} parent path must be a directory.`);
    }
    if (isFinal && kind === "directory" && !stats.isDirectory()) {
      throw new Error(`RUN_EVIDENCE_PATH_INVALID: ${label} must be a directory.`);
    }
    if (isFinal && kind === "file" && !stats.isFile()) {
      throw new Error(`RUN_EVIDENCE_PATH_INVALID: ${label} must be a regular file.`);
    }
  }
  return target;
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

export async function readSafeEvidenceFile(root, segments, encoding = "utf8", label = "evidence") {
  const target = await assertSafeEvidencePath(root, segments, { kind: "file", label });
  const before = await lstat(target);
  const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const handle = await open(target, constants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat();
    const after = await lstat(target);
    if (!opened.isFile() || after.isSymbolicLink() || !sameFile(before, opened) || !sameFile(opened, after)) {
      throw new Error(`RUN_EVIDENCE_RACE: ${label} changed while it was being opened.`);
    }
    await assertSafeEvidencePath(root, segments, { kind: "file", label });
    return await handle.readFile({ encoding });
  } finally {
    await handle.close();
  }
}
