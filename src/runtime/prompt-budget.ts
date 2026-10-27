import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { readJsonFile, writeJsonFileAtomic } from "./json-file.js";
import { createRuntimeError } from "./runtime-errors.js";
import type { RunContext, RunPromptBudgetLedger } from "./types.js";

type PersistedPromptBudgetLedger = {
  version: 1;
  legacyBaseCommittedChars: number;
  committedByCallId: Record<string, number>;
  reservedByCallId: Record<string, number>;
};

const queues = new Map<string, Promise<void>>();

function emptyLedger(): RunPromptBudgetLedger {
  return {
    legacyBaseCommittedChars: 0,
    committedChars: 0,
    reservedChars: 0,
    committedByCallId: new Map(),
    reservedByCallId: new Map()
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, chars]) => Number.isSafeInteger(chars) && Number(chars) >= 0)) as Record<string, number>;
}

function hydrateLedger(context: RunContext, persisted: PersistedPromptBudgetLedger): void {
  const committedByCallId = new Map(Object.entries(validateMap(persisted.committedByCallId)));
  const reservedByCallId = new Map(Object.entries(validateMap(persisted.reservedByCallId)));
  context.promptBudgetLedger = {
    ...context.promptBudgetLedger,
    legacyBaseCommittedChars: Number.isSafeInteger(persisted.legacyBaseCommittedChars) && persisted.legacyBaseCommittedChars >= 0
      ? persisted.legacyBaseCommittedChars
      : 0,
    committedByCallId,
    reservedByCallId,
    committedChars: Array.from(committedByCallId.values()).reduce((sum, value) => sum + value, 0),
    reservedChars: Array.from(reservedByCallId.values()).reduce((sum, value) => sum + value, 0)
  };
}

function serializeLedger(ledger: RunPromptBudgetLedger): PersistedPromptBudgetLedger {
  return {
    version: 1,
    legacyBaseCommittedChars: ledger.legacyBaseCommittedChars,
    committedByCallId: Object.fromEntries(ledger.committedByCallId),
    reservedByCallId: Object.fromEntries(ledger.reservedByCallId)
  };
}

async function loadLedger(context: RunContext): Promise<void> {
  try {
    const value = await readJsonFile(context.promptBudgetLedgerPath);
    if (isRecord(value) && value.version === 1) hydrateLedger(context, value as unknown as PersistedPromptBudgetLedger);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function persistLedger(context: RunContext): Promise<void> {
  await mkdir(dirname(context.promptBudgetLedgerPath), { recursive: true });
  await writeJsonFileAtomic(context.promptBudgetLedgerPath, serializeLedger(context.promptBudgetLedger));
}

async function withLedgerMutation<T>(context: RunContext, action: () => Promise<T>): Promise<T> {
  const path = context.promptBudgetLedgerPath;
  const previous = queues.get(path) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => next);
  queues.set(path, tail);
  await previous;
  try {
    // The runtime adapter holds an active-run lock for this Run, and Resume holds its resume lock.
    // That lifecycle lock excludes other processes; this queue serializes parallel branches locally.
    await loadLedger(context);
    const result = await action();
    await persistLedger(context);
    return result;
  } finally {
    release();
    if (queues.get(path) === tail) queues.delete(path);
  }
}

export async function hydratePromptBudgetLedger(context: RunContext): Promise<RunPromptBudgetLedger> {
  await withLedgerMutation(context, async () => undefined);
  return context.promptBudgetLedger;
}

export async function reservePromptBudget(args: {
  context: RunContext;
  callId: string;
  renderedPromptChars: number;
  maxPromptCharsPerRole?: number;
}): Promise<void> {
  await withLedgerMutation(args.context, async () => {
    const ledger = args.context.promptBudgetLedger;
    if (ledger.committedByCallId.has(args.callId) || ledger.reservedByCallId.has(args.callId)) {
      throw createRuntimeError({ errorCode: "PROMPT_CALL_ID_REUSED", errorCategory: "state", stage: "execute", retryable: false, runId: args.context.runId, message: `Prompt callId has already been reserved or committed: ${args.callId}` });
    }
    if (args.maxPromptCharsPerRole !== undefined && args.renderedPromptChars > args.maxPromptCharsPerRole) {
      throw createRuntimeError({ errorCode: "ROLE_PROMPT_BUDGET_EXCEEDED", errorCategory: "validation", stage: "execute", retryable: false, runId: args.context.runId, message: `Rendered prompt has ${args.renderedPromptChars} characters; the per-role limit is ${args.maxPromptCharsPerRole}.` });
    }
    const pending = ledger.legacyBaseCommittedChars + ledger.committedChars + ledger.reservedChars + args.renderedPromptChars;
    if (ledger.maxTotalPromptCharsPerRun !== undefined && pending > ledger.maxTotalPromptCharsPerRun) {
      throw createRuntimeError({ errorCode: "RUN_PROMPT_BUDGET_EXCEEDED", errorCategory: "validation", stage: "execute", retryable: false, runId: args.context.runId, message: `Run prompt budget would reach ${pending} characters; the limit is ${ledger.maxTotalPromptCharsPerRun}.` });
    }
    ledger.reservedByCallId.set(args.callId, args.renderedPromptChars);
    ledger.reservedChars += args.renderedPromptChars;
  });
}

export async function commitPromptBudget(args: {
  context: RunContext;
  callId: string;
  actualRenderedChars: number;
}): Promise<void> {
  await withLedgerMutation(args.context, async () => {
    const ledger = args.context.promptBudgetLedger;
    if (ledger.committedByCallId.has(args.callId)) return;
    const reserved = ledger.reservedByCallId.get(args.callId);
    if (reserved === undefined) return;
    ledger.reservedByCallId.delete(args.callId);
    ledger.reservedChars -= reserved;
    ledger.committedByCallId.set(args.callId, args.actualRenderedChars);
    ledger.committedChars += args.actualRenderedChars;
  });
}

export async function releasePromptBudget(args: { context: RunContext; callId: string }): Promise<void> {
  await withLedgerMutation(args.context, async () => {
    const ledger = args.context.promptBudgetLedger;
    const reserved = ledger.reservedByCallId.get(args.callId);
    if (reserved === undefined) return;
    ledger.reservedByCallId.delete(args.callId);
    ledger.reservedChars -= reserved;
  });
}

export async function reconcilePromptBudgetLedger(args: {
  context: RunContext;
  committedPromptCharsByCallId?: Record<string, number>;
  legacyTotalRenderedPromptChars?: number;
  promptCalls?: Array<{ callId: string; renderedPromptChars: number }>;
}): Promise<void> {
  await withLedgerMutation(args.context, async () => {
    const ledger = args.context.promptBudgetLedger;
    const committed = new Map(Object.entries(args.committedPromptCharsByCallId ?? {}));
    for (const record of args.promptCalls ?? []) committed.set(record.callId, record.renderedPromptChars);
    for (const [callId, chars] of committed) {
      if (!Number.isSafeInteger(chars) || chars < 0 || ledger.committedByCallId.has(callId)) continue;
      ledger.committedByCallId.set(callId, chars);
      ledger.committedChars += chars;
    }
    if (Object.keys(args.committedPromptCharsByCallId ?? {}).length === 0 && args.legacyTotalRenderedPromptChars !== undefined) {
      ledger.legacyBaseCommittedChars = Math.max(
        ledger.legacyBaseCommittedChars,
        args.legacyTotalRenderedPromptChars - ledger.committedChars
      );
    }
    for (const [callId, chars] of ledger.reservedByCallId) {
      if (!ledger.committedByCallId.has(callId)) {
        ledger.committedByCallId.set(callId, chars);
        ledger.committedChars += chars;
      }
    }
    ledger.reservedByCallId.clear();
    ledger.reservedChars = 0;
  });
}
