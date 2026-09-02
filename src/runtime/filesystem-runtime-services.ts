import { mkdir, readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applyGraphUpdate } from "./graph-runner.js";
import { appendEvent, writeAtomicFile } from "./run-artifacts.js";
import type { RuntimeAuditEvent, RuntimeExecutionServices } from "./engine-adapter.js";
import type { GraphState, RuntimeCheckpointRecord, RunContext } from "./types.js";
import { FileVersionedStateStore, type VersionedStateSnapshot } from "./versioned-state.js";

/**
 * Filesystem implementation of the OGS persistence ports. The checkpoint WAL remains separate
 * from the state snapshot so a crash can be reconciled deterministically on resume.
 */
export function createFilesystemRuntimeServices(args: {
  context: RunContext;
  initialState: GraphState;
  irDigest?: string;
  runtimeDigest?: string;
}): RuntimeExecutionServices {
  const store = new FileVersionedStateStore<GraphState>(
    resolve(args.context.controlDir, "versioned-state.json"),
    {
      schemaVersion: 1,
      stateVersion: args.initialState.stateVersion,
      lastEventId: args.initialState.lastEventId,
      lastCheckpointSequence: args.initialState.lastCheckpointSequence,
      state: structuredClone(args.initialState),
      irDigest: args.irDigest ?? "none",
      runtimeDigest: args.runtimeDigest ?? "filesystem-v1"
    }
  );
  // The port addresses the graph runner's durable WAL directly; an adapter-specific mirror would
  // create a second recovery truth and allow the two streams to diverge.
  const checkpointDir = args.context.checkpointsDir;

  return {
    stateStore: {
      load: async (_runId) => store.load(),
      commit: async (input) => store.commit({
        expectedStateVersion: input.expectedStateVersion,
        eventId: input.eventId,
        idempotencyKey: input.idempotencyKey,
        checkpointSequence: input.checkpointSequence,
        update: (current) => applyGraphUpdate(current, input.update)
      })
    },
    checkpointStore: {
      append: async (record: RuntimeCheckpointRecord) => {
        await mkdir(checkpointDir, { recursive: true });
        await writeAtomicFile(
          resolve(checkpointDir, `${String(record.checkpointSequence).padStart(6, "0")}-${record.executionId}.json`),
          JSON.stringify(record, null, 2)
        );
      },
      list: async (_runId) => {
        try {
          const entries = (await readdir(checkpointDir)).filter((entry) => entry.endsWith(".json")).sort();
          const records: RuntimeCheckpointRecord[] = [];
          for (const entry of entries) {
            try {
              const value = JSON.parse(await readFile(resolve(checkpointDir, entry), "utf8")) as RuntimeCheckpointRecord;
              if (value && typeof value.checkpointSequence === "number" && typeof value.executionId === "string") {
                records.push(value);
              }
            } catch {
              // Ignore a partially written checkpoint; completed WAL entries are atomically written.
            }
          }
          return records;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
          throw error;
        }
      }
    },
    audit: {
      append: async (event: RuntimeAuditEvent) => appendEvent(args.context, event)
    }
  };
}

export type FilesystemVersionedStateSnapshot = VersionedStateSnapshot<GraphState>;
