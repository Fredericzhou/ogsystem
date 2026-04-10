import {
  executeOpencodeModelRole,
  startOpencodeRunClient,
  type OpencodeRunClient
} from "../runtime/opencode-executor.js";
import { loadModelPackage } from "../runtime/model-repo.js";
import { buildNl2MmdSystemPrompt, buildNl2MmdTurnPrompt, getNl2MmdTurnSchema } from "./prompt.js";
import { validateNl2MmdCandidate } from "./validate.js";
import { loadNl2MmdContext } from "./catalog.js";
import { logNl2MmdDebug } from "./logger.js";
import type {
  Nl2MmdContext,
  Nl2MmdConversation,
  Nl2MmdModelResponse,
  Nl2MmdTurnMode,
  Nl2MmdTurnInput,
  Nl2MmdTurnResult
} from "./types.js";

type ManagedConversation = Nl2MmdConversation & {
  runClient: OpencodeRunClient;
};

function assertStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid NL2MMD response field "${field}"`);
  }
  return value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidMode(value: unknown): value is Nl2MmdTurnMode {
  return value === "ask" || value === "draft" || value === "final";
}

function assertStringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`Invalid NL2MMD response field "${field}"`);
  }
  return value;
}

function parseModelResponse(raw: string): Nl2MmdModelResponse {
  const parsed: unknown = JSON.parse(raw);
  if (!isObjectRecord(parsed)) {
    throw new Error("Invalid NL2MMD response root: expected object");
  }
  if (!isValidMode(parsed.mode)) {
    throw new Error('Invalid NL2MMD response field "mode"');
  }
  return {
    mode: parsed.mode,
    summary: assertStringField(parsed, "summary"),
    questions: assertStringArray(parsed.questions, "questions"),
    assumptions: assertStringArray(parsed.assumptions, "assumptions"),
    referencedRoles: assertStringArray(parsed.referencedRoles, "referencedRoles"),
    unresolvedItems: assertStringArray(parsed.unresolvedItems, "unresolvedItems"),
    mermaid: assertStringField(parsed, "mermaid")
  };
}

export async function createNl2MmdConversation(args: {
  workdir: string;
  modelId: string;
  runtimeConfigPath?: string;
  lawsPath?: string;
  context?: Nl2MmdContext;
}): Promise<Nl2MmdConversation> {
  const startedAt = Date.now();
  const context =
    args.context ??
    (await loadNl2MmdContext({
      workdir: args.workdir,
      runtimeConfigPath: args.runtimeConfigPath,
      lawsPath: args.lawsPath
    }));
  const modelPackage = await loadModelPackage({
    modelId: args.modelId,
    modelRootDir: context.modelRootDir
  });
  const runClient = await startOpencodeRunClient({
    timeoutMs: 30000,
    env: {
      OGSYSTEM_NL2MMD: "1"
    }
  });

  const conversation: ManagedConversation = {
    context,
    modelPackage,
    workdir: args.workdir,
    sessionId: undefined,
    runClient,
    close() {
      runClient.close();
    }
  };

  logNl2MmdDebug("conversation.created", {
    workdir: args.workdir,
    modelId: args.modelId,
    roleCount: context.roleCatalog.length,
    modelCount: context.modelCatalog.length,
    durationMs: Date.now() - startedAt
  });

  return conversation;
}

export async function runNl2MmdTurn(args: {
  conversation: Nl2MmdConversation;
  input: Nl2MmdTurnInput;
  lawsPath?: string;
  profilesPath?: string;
  userProfilePath?: string;
}): Promise<Nl2MmdTurnResult> {
  const startedAt = Date.now();
  const conversation = args.conversation as ManagedConversation;
  logNl2MmdDebug("turn.start", {
    modelId: conversation.modelPackage.manifest.modelId,
    hasSession: Boolean(conversation.sessionId),
    hasDraft: Boolean(args.input.draftMermaid?.trim()),
    validationErrorCount: args.input.validationErrors?.length ?? 0,
    validationWarningCount: args.input.validationWarnings?.length ?? 0
  });

  const prompt = [
    buildNl2MmdSystemPrompt(conversation.context),
    "",
    buildNl2MmdTurnPrompt({
      context: conversation.context,
      input: args.input
    })
  ].join("\n");

  const result = await executeOpencodeModelRole({
    roleId: "nl2mmd",
    prompt,
    schema: getNl2MmdTurnSchema(),
    modelPackage: conversation.modelPackage,
    workdir: conversation.workdir,
    timeoutMs: conversation.modelPackage.manifest.timeoutMs ?? 120000,
    maxOutputBytes: conversation.modelPackage.manifest.maxOutputBytes ?? 65536,
    runClient: conversation.runClient,
    sessionId: conversation.sessionId
  });

  const modelResponse = parseModelResponse(result.stdout);
  logNl2MmdDebug("turn.model_response", {
    mode: modelResponse.mode,
    summaryLength: modelResponse.summary.length,
    mermaidLength: modelResponse.mermaid.length,
    questionCount: modelResponse.questions.length,
    unresolvedCount: modelResponse.unresolvedItems.length
  });
  if (modelResponse.mode === "ask" && modelResponse.mermaid.trim()) {
    throw new Error('NL2MMD response mode "ask" must not include Mermaid content');
  }
  if (
    (modelResponse.mode === "draft" || modelResponse.mode === "final") &&
    !modelResponse.mermaid.trim()
  ) {
    throw new Error(`NL2MMD response mode "${modelResponse.mode}" must include Mermaid content`);
  }
  conversation.sessionId = result.sessionId ?? conversation.sessionId;

  let validation;
  let txtGraph;
  if (modelResponse.mermaid.trim()) {
    const validationStartedAt = Date.now();
    validation = await validateNl2MmdCandidate({
      mermaid: modelResponse.mermaid,
      context: conversation.context,
      lawsPath: args.lawsPath,
      profilesPath: args.profilesPath,
      userProfilePath: args.userProfilePath
    });
    txtGraph = validation.txtGraph;
    logNl2MmdDebug("turn.validation", {
      status: validation.status,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      durationMs: Date.now() - validationStartedAt
    });
  }

  const turnResult = {
    ...modelResponse,
    sessionId: result.sessionId,
    messageId: result.messageId,
    txtGraph,
    validation
  };
  logNl2MmdDebug("turn.complete", {
    mode: turnResult.mode,
    sessionId: turnResult.sessionId ?? "(none)",
    hasValidation: Boolean(turnResult.validation),
    durationMs: Date.now() - startedAt
  });
  return turnResult;
}
