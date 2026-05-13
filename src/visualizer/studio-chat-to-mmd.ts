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
  runNl2MmdPreflight,
  runNl2MmdTurn,
  type Nl2MmdConversation,
  type Nl2MmdTurnResult
} from "../nl2mmd/index.js";
import {
  importMermaidToAuthoring,
  serializeAuthoringToMermaid,
  type StudioAuthoringDocument,
  type StudioSystemValidation
} from "./studio-authoring.js";
import {
  STUDIO_SYSTEM_END_ROLE_ID,
  normalizeStudioGraphTargetRoleId,
  type StudioAuthoringFlow,
  type StudioAuthoringRole
} from "./studio-contracts.js";
import {
  applyStudioAuthoringCommand,
  type StudioAuthoringCommand
} from "./studio-graph-commands.js";
import {
  asNonEmptyString,
  asRecord,
  asString,
  type JsonRecord
} from "./json-guards.js";

type StudioChatAuthoringPatch =
  | {
      type: "commands";
      commands: StudioAuthoringCommand[];
      authoring: StudioAuthoringDocument;
      source: "nl2mmd";
    }
  | {
      type: "replace-authoring";
      authoring: StudioAuthoringDocument;
      source: "nl2mmd";
    };

export type StudioChatToMmdSession = {
  workdir: string;
  conversation: Nl2MmdConversation;
  updatedAtMs: number;
  preflightOk?: boolean;
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
  authoringPatch: StudioChatAuthoringPatch | null;
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

export class StudioChatToMmdDependencyError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "StudioChatToMmdDependencyError";
  }
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeOptionalString(value: unknown): string | undefined {
  return asNonEmptyString(value);
}

function normalizeAuthoring(value: unknown): StudioAuthoringDocument | undefined {
  const record = asRecord(value);
  if (!record || record.version !== 1) {
    return undefined;
  }
  return record as StudioAuthoringDocument;
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
    validation: asRecord(body.validation),
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

function summarizeNl2MmdDependencyError(error: unknown): string {
  const message = error instanceof Error && error.message.trim() ? error.message.trim() : String(error);
  if (/OPENAI_API_KEY|api key|unauthorized|authentication|invalid_api_key|401/i.test(message)) {
    return "Studio Chat to MMD cannot reach the configured OpenAI provider. Check OPENAI_API_KEY or the OpenCode provider apiKey configuration, then retry.";
  }
  if (/timeout|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network|fetch failed|socket hang up|ECONNRESET/i.test(message)) {
    return "Studio Chat to MMD cannot reach OpenCode or the model provider. Check opencode serve, provider network access, and model binding, then retry.";
  }
  if (/ProviderModelNotFound|does not expose model|provider\/model|model/i.test(message)) {
    return `Studio Chat to MMD model binding is not usable: ${message}`;
  }
  return `Studio Chat to MMD preflight failed: ${message}`;
}

function toNl2MmdDependencyError(error: unknown): StudioChatToMmdDependencyError {
  return new StudioChatToMmdDependencyError(summarizeNl2MmdDependencyError(error), {
    cause: error instanceof Error ? error.message : String(error)
  });
}

function diagnosticsToMessages(validation: Record<string, unknown> | undefined, severity: string): string[] {
  const diagnostics = Array.isArray(validation?.diagnostics) ? validation.diagnostics : [];
  return diagnostics
    .map((item) => asRecord(item))
    .filter((item): item is JsonRecord => Boolean(item))
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

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function roleCommandShape(role: StudioAuthoringRole): Record<string, unknown> {
  return {
    roleId: role.roleId,
    title: role.title,
    bindingKind: role.bindingKind,
    modelRef: role.modelRef,
    profileId: role.profileId
  };
}

function rolePassiveShape(role: StudioAuthoringRole): Record<string, unknown> {
  return {
    routingMode: role.routingMode,
    routeOrder: role.routeOrder ?? [],
    joinMode: role.joinMode,
    joinMin: role.joinMin,
    loopMax: role.loopMax,
    review: role.review,
    contextMap: role.contextMap ?? {}
  };
}

function roleCanBeAddedByCommand(role: StudioAuthoringRole): boolean {
  return !role.routingMode &&
    !(role.routeOrder?.length) &&
    !role.joinMode &&
    role.joinMin == null &&
    !role.loopMax &&
    !role.review &&
    !(role.contextMap && Object.keys(role.contextMap).length);
}

function flowSemanticKey(flow: Pick<StudioAuthoringFlow, "fromRoleId" | "eventType" | "toRoleId">): string {
  return `${flow.fromRoleId}\u0000${flow.eventType}\u0000${flow.toRoleId}`;
}

function flowParticipatesInJoin(authoring: StudioAuthoringDocument, flow: StudioAuthoringFlow): boolean {
  return flow.toRoleId !== STUDIO_SYSTEM_END_ROLE_ID &&
    Boolean(authoring.roles[flow.toRoleId]?.joinSources?.includes(flow.fromRoleId));
}

function flowCommandShape(authoring: StudioAuthoringDocument, flow: StudioAuthoringFlow): Record<string, unknown> {
  return {
    fromRoleId: flow.fromRoleId,
    toRoleId: flow.toRoleId,
    eventType: flow.eventType,
    label: flow.label,
    runtimeOnlyErrorFlow: Boolean(flow.runtimeOnlyErrorFlow),
    participatesInJoin: flowParticipatesInJoin(authoring, flow)
  };
}

function commandTargetRoleId(roleId: string): string {
  return normalizeStudioGraphTargetRoleId(roleId);
}

function roleExistsOrIsBoundary(roleIds: Set<string>, roleId: string): boolean {
  return roleId === STUDIO_SYSTEM_END_ROLE_ID || roleIds.has(roleId);
}

function comparableAuthoringShape(authoring: StudioAuthoringDocument): Record<string, unknown> {
  const roles = Object.keys(authoring.roles ?? {})
    .sort()
    .map((roleId) => {
      const role = authoring.roles[roleId];
      return {
        roleId,
        command: roleCommandShape(role),
        passive: rolePassiveShape(role),
        joinSources: (role.joinSources ?? []).slice().sort()
      };
    });
  const flows = Object.values(authoring.flows ?? {})
    .slice()
    .sort((left, right) => flowSemanticKey(left).localeCompare(flowSemanticKey(right)))
    .map((flow) => flowCommandShape(authoring, flow));
  return {
    version: authoring.version,
    project: authoring.project,
    system: authoring.system,
    roles,
    flows
  };
}

function diffAuthoringToCommands(
  previous: StudioAuthoringDocument,
  next: StudioAuthoringDocument
): StudioAuthoringCommand[] | null {
  if (!sameJson(
    { version: previous.version, project: previous.project, system: previous.system },
    { version: next.version, project: next.project, system: next.system }
  )) {
    return null;
  }

  const commands: StudioAuthoringCommand[] = [];
  const previousRoleIds = new Set(Object.keys(previous.roles ?? {}));
  const nextRoleIds = new Set(Object.keys(next.roles ?? {}));

  for (const roleId of [...nextRoleIds].filter((id) => previousRoleIds.has(id)).sort()) {
    const previousRole = previous.roles[roleId];
    const nextRole = next.roles[roleId];
    if (!sameJson(rolePassiveShape(previousRole), rolePassiveShape(nextRole))) {
      return null;
    }
    if (!sameJson(roleCommandShape(previousRole), roleCommandShape(nextRole))) {
      commands.push({
        type: "update-role",
        originalRoleId: roleId,
        roleId: nextRole.roleId,
        title: nextRole.title,
        bindingKind: nextRole.bindingKind,
        modelRef: nextRole.modelRef,
        profileId: nextRole.profileId
      });
    }
  }

  for (const roleId of [...previousRoleIds].filter((id) => !nextRoleIds.has(id)).sort()) {
    commands.push({ type: "delete-role", roleId });
  }

  for (const roleId of [...nextRoleIds].filter((id) => !previousRoleIds.has(id)).sort()) {
    const role = next.roles[roleId];
    if (!roleCanBeAddedByCommand(role)) {
      return null;
    }
    commands.push({
      type: "add-role",
      roleId,
      title: role.title,
      bindingKind: role.bindingKind,
      modelRef: role.modelRef,
      profileId: role.profileId,
      x: next.layout.nodes?.[roleId]?.x,
      y: next.layout.nodes?.[roleId]?.y
    });
  }

  const previousFlows = new Map(
    Object.values(previous.flows ?? {}).map((flow) => [flowSemanticKey(flow), flow] as const)
  );
  const nextFlows = new Map(
    Object.values(next.flows ?? {}).map((flow) => [flowSemanticKey(flow), flow] as const)
  );
  if (previousFlows.size !== Object.keys(previous.flows ?? {}).length ||
      nextFlows.size !== Object.keys(next.flows ?? {}).length) {
    return null;
  }

  for (const [key, previousFlow] of previousFlows.entries()) {
    if (!nextFlows.has(key)) {
      const touchesDeletedRole =
        !roleExistsOrIsBoundary(nextRoleIds, previousFlow.fromRoleId) ||
        !roleExistsOrIsBoundary(nextRoleIds, previousFlow.toRoleId);
      if (!touchesDeletedRole) {
        commands.push({
          type: "delete-edge",
          flowId: previousFlow.flowId,
          sourceRoleId: previousFlow.fromRoleId,
          targetRoleId: commandTargetRoleId(previousFlow.toRoleId),
          eventType: previousFlow.eventType
        });
      }
      continue;
    }
    const nextFlow = nextFlows.get(key) as StudioAuthoringFlow;
    if (!sameJson(flowCommandShape(previous, previousFlow), flowCommandShape(next, nextFlow))) {
      commands.push({
        type: "update-edge",
        flowId: previousFlow.flowId,
        originalSourceRoleId: previousFlow.fromRoleId,
        originalTargetRoleId: commandTargetRoleId(previousFlow.toRoleId),
        originalEventType: previousFlow.eventType,
        sourceRoleId: nextFlow.fromRoleId,
        targetRoleId: commandTargetRoleId(nextFlow.toRoleId),
        eventType: nextFlow.eventType,
        label: nextFlow.label,
        runtimeOnlyErrorFlow: Boolean(nextFlow.runtimeOnlyErrorFlow),
        participatesInJoin: flowParticipatesInJoin(next, nextFlow)
      });
    }
  }

  for (const [key, nextFlow] of nextFlows.entries()) {
    if (!previousFlows.has(key)) {
      commands.push({
        type: "add-edge",
        sourceRoleId: nextFlow.fromRoleId,
        targetRoleId: commandTargetRoleId(nextFlow.toRoleId),
        eventType: nextFlow.eventType,
        label: nextFlow.label,
        runtimeOnlyErrorFlow: Boolean(nextFlow.runtimeOnlyErrorFlow),
        participatesInJoin: flowParticipatesInJoin(next, nextFlow)
      });
    }
  }

  if (commands.length > 20) {
    return null;
  }

  const verification = applyStudioAuthoringCommand({
    authoring: previous,
    command: { type: "batch", commands }
  });
  if (verification.blockedCode) {
    return null;
  }
  if (!sameJson(comparableAuthoringShape(verification.authoring), comparableAuthoringShape(next))) {
    return null;
  }

  return commands;
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
  if (!session.preflightOk) {
    try {
      await runNl2MmdPreflight({ conversation: session.conversation });
      session.preflightOk = true;
      session.updatedAtMs = Date.now();
    } catch (error) {
      session.conversation.close();
      args.sessions.delete(sessionId);
      throw toNl2MmdDependencyError(error);
    }
  }
  const draftMermaid = buildDraftMermaid(args.request);
  const validationErrors = [
    ...diagnosticsToMessages(args.request.validation, "error")
  ];
  const validationWarnings = [
    ...diagnosticsToMessages(args.request.validation, "warning")
  ];

  let turn: Nl2MmdTurnResult;
  try {
    turn = await runNl2MmdTurn({
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
  } catch (error) {
    throw toNl2MmdDependencyError(error);
  }
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
      const commands = args.request.authoring
        ? diffAuthoringToCommands(args.request.authoring, authoring)
        : null;
      authoringPatch = commands
        ? {
            type: "commands",
            commands,
            authoring,
            source: "nl2mmd"
          }
        : {
            type: "replace-authoring",
            authoring,
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
