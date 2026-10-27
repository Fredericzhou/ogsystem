import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

const MAX_IR_BYTES = 4 * 1024 * 1024;

async function assertSafePath(root, target) {
  const relativePath = target.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  for (let index = -1; index < relativePath.length; index += 1) {
    if (index >= 0) current = join(current, relativePath[index]);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || (index < relativePath.length - 1 && !info.isDirectory())) {
        throw new Error("TEAM_IR_PATH_UNSAFE: linked or non-directory path rejected.");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function irPath(workdir) {
  const root = resolve(workdir);
  return { root, path: resolve(root, ".ogs", "team.ir.json") };
}

export function createFileTeamIrStore({ read = readFile, write = writeFile, publish = rename, makeId = randomUUID } = {}) {
  return Object.freeze({
    async read({ workdir }) {
      const { root, path } = irPath(workdir);
      await assertSafePath(root, path);
      try {
        const source = await read(path, "utf8");
        const teamIR = JSON.parse(source);
        return { teamIR, semanticDigest: teamIRSemanticDigest(teamIR) };
      } catch (error) {
        if (error?.code === "ENOENT") return { teamIR: null, semanticDigest: null };
        if (error instanceof SyntaxError) throw new Error("TEAM_IR_DOCUMENT_INVALID: stored Team IR is malformed JSON.");
        throw error;
      }
    },
    async save({ workdir, teamIR }) {
      const { root, path } = irPath(workdir);
      const serialized = `${JSON.stringify(teamIR, null, 2)}\n`;
      if (Buffer.byteLength(serialized, "utf8") > MAX_IR_BYTES) throw new Error("TEAM_IR_TOO_LARGE: Team IR must be no larger than 4 MiB.");
      await mkdir(dirname(path), { recursive: true });
      await assertSafePath(root, path);
      const temporary = join(dirname(path), `.team-ir-${makeId()}.tmp`);
      try {
        await write(temporary, serialized, { encoding: "utf8", flag: "wx" });
        await assertSafePath(root, path);
        await publish(temporary, path);
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
      }
      return { semanticDigest: teamIRSemanticDigest(teamIR) };
    }
  });
}
