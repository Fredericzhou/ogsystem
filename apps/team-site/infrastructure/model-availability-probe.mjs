import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBackendRegistry } from "../../../dist/runtime/model-backend-registry.js";

export function createModelAvailabilityProbe({ now = Date.now, timeoutMs = 30000 } = {}) {
  return async function probeModelAvailability(model) {
    const startedAt = now();
    const backend = String(model?.backend || "").trim();
    const modelId = String(model?.modelId || "").trim();
    const workdir = await mkdtemp(join(tmpdir(), "ogs-model-probe-"));
    try {
      const adapter = defaultBackendRegistry.getAdapter(backend);
      if (!adapter || !adapter.verifiedRunnable || typeof adapter.probe !== "function") {
        throw new Error(`Online availability probing is not supported for the ${backend} backend.`);
      }
      await adapter.probe({
        modelId,
        workdir,
        timeoutMs
      });
      return {
        backend,
        modelId,
        status: "verified",
        durationMs: Math.max(0, now() - startedAt)
      };
    } catch (error) {
      return {
        backend,
        modelId,
        status: "unavailable",
        durationMs: Math.max(0, now() - startedAt),
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  };
}
