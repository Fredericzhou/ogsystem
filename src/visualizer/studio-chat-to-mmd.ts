/**
 * @fileoverview Visualizer-side chat-to-MMD control-plane adapter.
 * Responsibilities:
 * - Bridge Build/Studio Bridge chat turns to NL2MMD sessions.
 * - Convert generated Mermaid into Studio authoring preview payloads.
 * Boundaries:
 * - Visualizer control-plane only; does not mutate runtime/parser/compiler behavior.
 */
import { resolve } from "node:path";

import {
  createNl2MmdConversation,
  runNl2MmdTurn,
  type Nl2MmdConversation,
  type Nl2MmdTurnResult
} from "../nl2mmd/index.js";
import {
  authoringToCanvasDocument,
  importMermaidToAuthoring,
  serializeAuthoringToMermaid,
  type StudioAuthoringDocument,
  type StudioCanvasDocument,
  type StudioSystemValidation
} from "./studio-authoring.js";

export type StudioChatToMmdSession = {
  workdir: string;
  conversation: Nl2MmdConversation;
  updatedAtMs: number;
};

export type StudioChatToMmdSessionMap = Map<string, StudioChatToMmdSession>;

export type StudioChatToMmdRequest = {
  message: string;
  sessionId?: string;
  modelRef?: string;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  authoring?: StudioAuthoringDocument;
  systemSource?: string;
  validation?: Record<string, unknown>;
  runtimeConfigPath?: string;
  runtimePath?: string;
  lawsPath?: string;
  profilesPath?: string;
  userProfilePath?: string;
};

export type StudioChatToMmdResponse = {
  mode: "ask" | "draft" | "final";
  sessionId: string;
  upstreamSessionId?: string;
  messageId?: string;
  summary: string;
  questions: string[];
  assumptions: string[];
  authoringPatch: {
    type: "replace-authoring";
    authoring: StudioAuthoringDocument;
    canvas: StudioCanvasDocument;
    source: "nl2mmd";
  } | null;
  previewMermaid: string;
  warnings: string[];
  validation: {
    nl2mmd?: Nl2MmdTurnResult["validation"];
    project?: StudioSystemValidation;
  };
  actions: Array<{
    id: string;
    label: string;
    enabled: boolean;
    reason?: string;
  }>;
  context: {
    selectedRoleId?: string;
    selectedFlowKey?: string;
    referencedRoles: string[];
    unresolvedItems: string[];
  };
};

type ValidateStudioSystemSource = (args: {
  workdir: string;
  systemPath: string;
  systemSource: string;
}) => Promise<StudioSystemValidation>;

const DEFAULT_STUDIO_CHAT_SESSION_TTL_MS = 30 * 60 * 1000;
const DEFAULT_STUDIO_CHAT_SESSION_MAX_SIZE = 64;

function hasObjectShape(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeOptionalString(value: unknown): string | undefined {
  const text = asString(value)?.trim();
  return text ? text : undefined;
}

function normalizeAuthoring(value: unknown): StudioAuthoringDocument | undefined {
  if (!hasObjectShape(value) || value.version !== 1) {
    return undefined;
  }
  return value as StudioAuthoringDocument;
}

function resolveOptionalPathWithinWorkdir(
  workdir: string,
  inputPath: string | undefined,
  label: string
): string | undefined {
  if (!inputPath) {
    return undefined;
  }
  const resolvedWorkdir = resolve(workdir);
  const resolvedPath = resolve(workdir, inputPath);
  if (
    resolvedPath !== resolvedWorkdir &&
    !resolvedPath.startsWith(`${resolvedWorkdir}/`) &&
    !resolvedPath.startsWith(`${resolvedWorkdir}\\`)
  ) {
    throw new Error(`${label} must stay within the current workdir.`);
  }
  return resolvedPath;
}

export function parseStudioChatToMmdRequest(body: Record<string, unknown>): StudioChatToMmdRequest {
  const message = normalizeOptionalString(body.message);
  if (!message) {
    throw new Error("CHAT_MESSAGE_REQUIRED");
  }
  return {
    message,
    sessionId: normalizeOptionalString(body.sessionId),
    modelRef: normalizeOptionalString(body.modelRef),
    selectedRoleId: normalizeOptionalString(body.selectedRoleId),
    selectedFlowKey: normalizeOptionalString(body.selectedFlowKey),
    authoring: normalizeAuthoring(body.authoring),
    systemSource: asString(body.systemSource),
    validation: hasObjectShape(body.validation) ? body.validation : undefined,
    runtimeConfigPath: normalizeOptionalString(body.runtimeConfigPath ?? body.runtimePath),
    runtimePath: normalizeOptionalString(body.runtimePath),
    lawsPath: normalizeOptionalString(body.lawsPath),
    profilesPath: normalizeOptionalString(body.profilesPath),
    userProfilePath: normalizeOptionalString(body.userProfilePath)
  };
}

export function pruneStudioChatToMmdSessions(args: {
  sessions: StudioChatToMmdSessionMap;
  ttlMs?: number;
  maxSize?: number;
  nowMs?: number;
}): void {
  const ttlMs = args.ttlMs ?? DEFAULT_STUDIO_CHAT_SESSION_TTL_MS;
  const maxSize = args.maxSize ?? DEFAULT_STUDIO_CHAT_SESSION_MAX_SIZE;
  const nowMs = args.nowMs ?? Date.now();
  for (const [sessionId, session] of args.sessions.entries()) {
    if (nowMs - session.updatedAtMs > ttlMs) {
      session.conversation.close();
      args.sessions.delete(sessionId);
    }
  }
  while (args.sessions.size > maxSize) {
    const oldestSessionId = args.sessions.keys().next().value;
    if (!oldestSessionId) {
      break;
    }
    args.sessions.get(oldestSessionId)?.conversation.close();
    args.sessions.delete(oldestSessionId);
  }
}

function createLocalSessionId(): string {
  return `studio-chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function diagnosticsToMessages(validation: Record<string, unknown> | undefined, severity: string): string[] {
  const diagnostics = Array.isArray(validation?.diagnostics) ? validation.diagnostics : [];
  return diagnostics
    .filter((item): item is Record<string, unknown> => hasObjectShape(item))
    .filter((item) => item.severity === severity)
    .map((item) => asString(item.message) ?? asString(item.code) ?? "")
    .filter(Boolean);
}

function buildContextualMessage(request: StudioChatToMmdRequest): string {
  const contextLines = [
    request.selectedRoleId ? `Selected role: ${request.selectedRoleId}` : "",
    request.selectedFlowKey ? `Selected flow: ${request.selectedFlowKey}` : ""
  ].filter(Boolean);
  if (contextLines.length === 0) {
    return request.message;
  }
  return `${request.message}\n\nStudio Bridge context:\n${contextLines.join("\n")}`;
}

function buildDraftMermaid(request: StudioChatToMmdRequest): string | undefined {
  if (request.authoring) {
    return serializeAuthoringToMermaid(request.authoring);
  }
  return request.systemSource?.trim() ? request.systemSource : undefined;
}

function flowDisplayKey(flow: { fromRoleId: string; eventType: string; toRoleId: string }): string {
  return `${flow.fromRoleId}:${flow.eventType}:${flow.toRoleId}`;
}

function preserveAuthoringDisplayNames(args: {
  imported: StudioAuthoringDocument;
  previous?: StudioAuthoringDocument;
}): StudioAuthoringDocument {
  if (!args.previous) {
    return args.imported;
  }
  const previousRoleTitleById = new Map(
    Object.values(args.previous.roles ?? {})
      .filter((role) => typeof role.title === "string" && role.title.trim())
      .map((role) => [role.roleId, role.title])
  );
  const previousFlowLabelByKey = new Map(
    Object.values(args.previous.flows ?? {})
      .filter((flow) => typeof flow.label === "string" && flow.label.trim())
      .map((flow) => [flowDisplayKey(flow), flow.label])
  );
  for (const role of Object.values(args.imported.roles ?? {})) {
    const title = previousRoleTitleById.get(role.roleId);
    if (title) {
      role.title = title;
    }
  }
  for (const flow of Object.values(args.imported.flows ?? {})) {
    const label = previousFlowLabelByKey.get(flowDisplayKey(flow));
    if (label) {
      flow.label = label;
    }
  }
  return args.imported;
}

function buildActions(args: {
  mode: StudioChatToMmdResponse["mode"];
  previewMermaid: string;
  authoringPatch: StudioChatToMmdResponse["authoringPatch"];
  projectValidation?: StudioSystemValidation;
}): StudioChatToMmdResponse["actions"] {
  const hasPreview = Boolean(args.previewMermaid.trim());
  const projectOk = args.projectValidation?.ok === true;
  return [
    {
      id: "answer-questions",
      label: "Answer questions",
      enabled: args.mode === "ask" && !hasPreview
    },
    {
      id: "preview-mermaid",
      label: "Preview Mermaid",
      enabled: hasPreview
    },
    {
      id: "apply-authoring-patch",
      label: "Apply to Studio Bridge",
      enabled: Boolean(args.authoringPatch) && projectOk,
      reason: !args.authoringPatch
        ? "No structured authoring patch is available."
        : projectOk
          ? undefined
          : "Project validation must pass before applying the patch."
    },
    {
      id: "refine",
      label: "Refine in chat",
      enabled: true
    }
  ];
}

async function getOrCreateSession(args: {
  workdir: string;
  request: StudioChatToMmdRequest;
  sessions: StudioChatToMmdSessionMap;
}): Promise<{ sessionId: string; session: StudioChatToMmdSession }> {
  pruneStudioChatToMmdSessions({ sessions: args.sessions });
  const existingSessionId = args.request.sessionId;
  const existing = existingSessionId ? args.sessions.get(existingSessionId) : undefined;
  if (existing && existing.workdir === args.workdir) {
    existing.updatedAtMs = Date.now();
    return { sessionId: existingSessionId as string, session: existing };
  }

  const conversation = await createNl2MmdConversation({
    workdir: args.workdir,
    modelRef: args.request.modelRef,
    runtimeConfigPath: args.request.runtimeConfigPath,
    lawsPath: args.request.lawsPath
  });
  const sessionId = createLocalSessionId();
  const session: StudioChatToMmdSession = {
    workdir: args.workdir,
    conversation,
    updatedAtMs: Date.now()
  };
  args.sessions.set(sessionId, session);
  pruneStudioChatToMmdSessions({ sessions: args.sessions });
  return { sessionId, session };
}

export async function runStudioChatToMmdTurn(args: {
  workdir: string;
  request: StudioChatToMmdRequest;
  sessions: StudioChatToMmdSessionMap;
  validateSystemSource: ValidateStudioSystemSource;
}): Promise<StudioChatToMmdResponse> {
  const runtimeConfigPath = resolveOptionalPathWithinWorkdir(
    args.workdir,
    args.request.runtimeConfigPath,
    "runtimeConfigPath"
  );
  const lawsPath = resolveOptionalPathWithinWorkdir(args.workdir, args.request.lawsPath, "lawsPath");
  const profilesPath = resolveOptionalPathWithinWorkdir(args.workdir, args.request.profilesPath, "profilesPath");
  const userProfilePath = resolveOptionalPathWithinWorkdir(
    args.workdir,
    args.request.userProfilePath,
    "userProfilePath"
  );
  const { sessionId, session } = await getOrCreateSession({
    workdir: args.workdir,
    request: {
      ...args.request,
      runtimeConfigPath,
      lawsPath
    },
    sessions: args.sessions
  });
  const draftMermaid = buildDraftMermaid(args.request);
  const validationErrors = [
    ...diagnosticsToMessages(args.request.validation, "error")
  ];
  const validationWarnings = [
    ...diagnosticsToMessages(args.request.validation, "warning")
  ];

  const turn = await runNl2MmdTurn({
    conversation: session.conversation,
    input: {
      message: buildContextualMessage(args.request),
      draftMermaid,
      validationErrors,
      validationWarnings
    },
    lawsPath,
    profilesPath,
    userProfilePath
  });
  session.updatedAtMs = Date.now();

  const previewMermaid = turn.mermaid;
  let projectValidation: StudioSystemValidation | undefined;
  let authoringPatch: StudioChatToMmdResponse["authoringPatch"] = null;
  const warnings = [...turn.unresolvedItems];

  if (previewMermaid.trim()) {
    const systemPath = resolve(args.workdir, "system.mmd");
    projectValidation = await args.validateSystemSource({
      workdir: args.workdir,
      systemPath,
      systemSource: previewMermaid
    });
    try {
      const authoring = preserveAuthoringDisplayNames({
        imported: importMermaidToAuthoring({
          workdir: args.workdir,
          systemPath,
          systemSource: previewMermaid
        }),
        previous: args.request.authoring
      });
      authoringPatch = {
        type: "replace-authoring",
        authoring,
        canvas: authoringToCanvasDocument(authoring),
        source: "nl2mmd"
      };
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    mode: turn.mode,
    sessionId,
    upstreamSessionId: turn.sessionId,
    messageId: turn.messageId,
    summary: turn.summary,
    questions: turn.questions,
    assumptions: turn.assumptions,
    authoringPatch,
    previewMermaid,
    warnings,
    validation: {
      nl2mmd: turn.validation,
      project: projectValidation
    },
    actions: buildActions({
      mode: turn.mode,
      previewMermaid,
      authoringPatch,
      projectValidation
    }),
    context: {
      selectedRoleId: args.request.selectedRoleId,
      selectedFlowKey: args.request.selectedFlowKey,
      referencedRoles: asStringArray(turn.referencedRoles),
      unresolvedItems: asStringArray(turn.unresolvedItems)
    }
  };
}
