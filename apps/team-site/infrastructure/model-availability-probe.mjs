import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAppServerClient } from "../../../dist/runtime/codex-app-server.js";
import { executeOpencodeModelRole, startOpencodeRunClient } from "../../../dist/runtime/opencode-executor.js";

const probeSchema = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false
};

export function createModelAvailabilityProbe({ now = Date.now, timeoutMs = 30000 } = {}) {
  return async function probeModelAvailability(model) {
    const startedAt = now();
    const workdir = await mkdtemp(join(tmpdir(), "ogs-model-probe-"));
    try {
      if (model.backend === "codex") {
        const client = await CodexAppServerClient.start({ cwd: workdir, timeoutMs: 15000 });
        try {
          await client.execute({
            roleId: "platform-model-probe",
            prompt: 'Return exactly this JSON: {"ok":true}',
            schema: probeSchema,
            modelId: model.id,
            cwd: workdir,
            timeoutMs
          });
        } finally {
          await client.close();
        }
      } else if (model.backend === "opencode") {
        const runClient = await startOpencodeRunClient({ timeoutMs, directory: workdir });
        try {
          await executeOpencodeModelRole({
            roleId: "platform-model-probe",
            prompt: 'Return exactly this JSON: {"ok":true}',
            schema: probeSchema,
            modelRef: model.ref,
            workdir,
            directory: workdir,
            timeoutMs,
            maxOutputBytes: 4096,
            runClient
          });
        } finally {
          await runClient.close();
        }
      } else {
        throw new Error(`Online availability probing is not supported for the ${model.backend} backend.`);
      }
      return { modelRef: model.ref, status: "available", durationMs: Math.max(0, now() - startedAt) };
    } catch (error) {
      return {
        modelRef: model.ref,
        status: "unavailable",
        durationMs: Math.max(0, now() - startedAt),
        message: error instanceof Error ? error.message : String(error)
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  };
}
