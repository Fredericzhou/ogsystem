import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type VersionedStateSnapshot<T> = {
  schemaVersion: number;
  stateVersion: number;
  lastEventId?: string;
  lastCheckpointSequence: number;
  state: T;
  irDigest: string;
  runtimeDigest: string;
};

export type StateCommitInput<T> = {
  expectedStateVersion: number;
  eventId: string;
  idempotencyKey: string;
  checkpointSequence?: number;
  update: (state: T) => T;
};

export type StateCommitResult<T> = {
  status: "accepted" | "duplicate";
  snapshot: VersionedStateSnapshot<T>;
  resultDigest: string;
};

export class StateVersionConflictError extends Error {
  readonly expectedStateVersion: number;
  readonly actualStateVersion: number;

  constructor(expectedStateVersion: number, actualStateVersion: number) {
    super(`State version conflict: expected ${expectedStateVersion}, found ${actualStateVersion}`);
    this.name = "StateVersionConflictError";
    this.expectedStateVersion = expectedStateVersion;
    this.actualStateVersion = actualStateVersion;
  }
}

/**
 * In-memory reference implementation of the linearized state-store contract.
 * Persistence adapters should preserve these commit semantics when replacing it.
 */
export class VersionedStateStore<T> {
  private snapshot: VersionedStateSnapshot<T>;
  private readonly commits = new Map<string, StateCommitResult<T>>();

  constructor(snapshot: VersionedStateSnapshot<T>) {
    this.snapshot = structuredClone(snapshot);
  }

  load(): VersionedStateSnapshot<T> {
    return structuredClone(this.snapshot);
  }

  commit(input: StateCommitInput<T>): StateCommitResult<T> {
    const previous = this.commits.get(input.idempotencyKey);
    if (previous) {
      return {
        ...structuredClone(previous),
        status: "duplicate"
      };
    }
    if (!input.eventId || !input.idempotencyKey) {
      throw new Error("eventId and idempotencyKey are required");
    }
    if (input.expectedStateVersion !== this.snapshot.stateVersion) {
      throw new StateVersionConflictError(input.expectedStateVersion, this.snapshot.stateVersion);
    }
    const nextState = input.update(structuredClone(this.snapshot.state));
    const nextSnapshot: VersionedStateSnapshot<T> = {
      ...this.snapshot,
      stateVersion: this.snapshot.stateVersion + 1,
      lastEventId: input.eventId,
      lastCheckpointSequence: Math.max(this.snapshot.lastCheckpointSequence, input.checkpointSequence ?? 0),
      state: nextState
    };
    const resultDigest = createHash("sha256").update(JSON.stringify(nextSnapshot)).digest("hex");
    const result: StateCommitResult<T> = {
      status: "accepted",
      snapshot: nextSnapshot,
      resultDigest
    };
    this.snapshot = nextSnapshot;
    this.commits.set(input.idempotencyKey, result);
    return structuredClone(result);
  }
}

type PersistedState<T> = {
  snapshot: VersionedStateSnapshot<T>;
  commits: Record<string, StateCommitResult<T>>;
};

/** Durable implementation of the OGS state-store contract for the filesystem backend. */
export class FileVersionedStateStore<T> {
  private readonly lockPath: string;

  constructor(private readonly filePath: string, private readonly initialSnapshot?: VersionedStateSnapshot<T>) {
    this.lockPath = `${resolve(filePath)}.lock`;
  }

  private async readPersisted(): Promise<PersistedState<T>> {
    try {
      const value = JSON.parse(await readFile(this.filePath, "utf8")) as PersistedState<T>;
      if (!value?.snapshot || typeof value.snapshot.stateVersion !== "number") {
        throw new Error("Invalid versioned state snapshot");
      }
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (!this.initialSnapshot) throw new Error(`State snapshot not found: ${this.filePath}`);
      return { snapshot: structuredClone(this.initialSnapshot), commits: {} };
    }
  }

  async load(): Promise<VersionedStateSnapshot<T> | undefined> {
    try {
      const persisted = await this.readPersisted();
      return structuredClone(persisted.snapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !this.initialSnapshot) return undefined;
      throw error;
    }
  }

  private async acquireLock(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    for (;;) {
      try {
        await mkdir(this.lockPath);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
  }

  async commit(input: StateCommitInput<T>): Promise<StateCommitResult<T>> {
    if (!input.eventId || !input.idempotencyKey) throw new Error("eventId and idempotencyKey are required");
    await this.acquireLock();
    try {
      const persisted = await this.readPersisted();
      const previous = persisted.commits[input.idempotencyKey];
      if (previous) return { ...structuredClone(previous), status: "duplicate" };
      if (input.expectedStateVersion !== persisted.snapshot.stateVersion) {
        throw new StateVersionConflictError(input.expectedStateVersion, persisted.snapshot.stateVersion);
      }
      const nextSnapshot: VersionedStateSnapshot<T> = {
        ...persisted.snapshot,
        stateVersion: persisted.snapshot.stateVersion + 1,
        lastEventId: input.eventId,
        lastCheckpointSequence: Math.max(persisted.snapshot.lastCheckpointSequence, input.checkpointSequence ?? 0),
        state: input.update(structuredClone(persisted.snapshot.state))
      };
      const resultDigest = createHash("sha256").update(JSON.stringify(nextSnapshot)).digest("hex");
      const result: StateCommitResult<T> = { status: "accepted", snapshot: nextSnapshot, resultDigest };
      persisted.snapshot = nextSnapshot;
      persisted.commits[input.idempotencyKey] = result;
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tempPath, JSON.stringify(persisted), "utf8");
      await rename(tempPath, this.filePath);
      return structuredClone(result);
    } finally {
      await rm(this.lockPath, { recursive: true, force: true });
    }
  }
}
