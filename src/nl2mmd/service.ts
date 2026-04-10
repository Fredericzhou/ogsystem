import {
  executeOpencodeModelRole,
  startOpencodeRunClient,
  type OpencodeRunClient
} from "../runtime/opencode-executor.js";
import { loadModelPackage } from "../runtime/model-repo.js";
import { buildNl2MmdSystemPrompt, buildNl2MmdTurnPrompt, getNl2MmdTurnSchema } from "./prompt.js";
import { validateNl2MmdCandidate } from "./validate.js";
import { loadNl2MmdContext } from "./catalog.js";
import type {
  Nl2MmdContext,
  Nl2MmdConversation,
  Nl2MmdModelResponse,
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

function parseModelResponse(raw: string): Nl2MmdModelResponse {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (
    parsed.mode !== "ask" &&
    parsed.mode !== "draft" &&
    parsed.mode !== "final"
  ) {
    throw new Error('Invalid NL2MMD response field "mode"');
  }
  if (typeof parsed.summary !== "string" || typeof parsed.mermaid !== "string") {
    throw new Error("Invalid NL2MMD response summary/mermaid");
  }
  return {
    mode: parsed.mode,
    summary: parsed.summary,
    questions: assertStringArray(parsed.questions, "questions"),
    assumptions: assertStringArray(parsed.assumptions, "assumptions"),
    referencedRoles: assertStringArray(parsed.referencedRoles, "referencedRoles"),
    unresolvedItems: assertStringArray(parsed.unresolvedItems, "unresolvedItems"),
    mermaid: parsed.mermaid
  };
}

export async function createNl2MmdConversation(args: {
  workdir: string;
  modelId: string;
  runtimeConfigPath?: string;
  lawsPath?: string;
  context?: Nl2MmdContext;
}): Promise<Nl2MmdConversation> {
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

  return conversation;
}

export async function runNl2MmdTurn(args: {
  conversation: Nl2MmdConversation;
  input: Nl2MmdTurnInput;
  lawsPath?: string;
  profilesPath?: string;
  userProfilePath?: string;
}): Promise<Nl2MmdTurnResult> {
  const conversation = args.conversation as ManagedConversation;

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
    validation = await validateNl2MmdCandidate({
      mermaid: modelResponse.mermaid,
      context: conversation.context,
      lawsPath: args.lawsPath,
      profilesPath: args.profilesPath,
      userProfilePath: args.userProfilePath
    });
    txtGraph = validation.txtGraph;
  }

  return {
    ...modelResponse,
    sessionId: result.sessionId,
    messageId: result.messageId,
    txtGraph,
    validation
  };
}
