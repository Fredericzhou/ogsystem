import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const defaults = Object.freeze({ defaultProvider: "codex", defaultModel: "default", timeoutSeconds: 120, retryCount: 1 });

export function createFilePlatformSettings({ path }) {
  if (!path) throw new TypeError("Platform settings path is required.");
  return Object.freeze({
    async read() {
      try {
        return { ...defaults, ...JSON.parse(await readFile(path, "utf8")), runtimeApplied: false };
      } catch (error) {
        if (error?.code === "ENOENT") return { ...defaults, runtimeApplied: false };
        throw error;
      }
    },
    async write(settings) {
      await mkdir(dirname(path), { recursive: true });
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => {});
        throw error;
      }
    }
  });
}
