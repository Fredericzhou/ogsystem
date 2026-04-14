/**
 * @fileoverview Shared NL2MMD domain types and API contracts.
 * File Set: nl2mmd-types
 * Responsibilities:
 * - Define catalog, hinting, turn, validation, and conversation shapes.
 * Boundaries:
 * - Type contracts only; no behavior.
 */
import type { LoadedModelPackage, SystemDefinition } from "../runtime/types.js";

export type Nl2MmdRoleSummary = {
  roleId: string;
  name: string;
  description: string;
  tags: string[];
  preferredModelTags: string[];
  outputEvents: string[];
};

export type Nl2MmdModelSummary = {
  modelId: string;
  model: string;
  reasoningEffort?: string;
  tags: string[];
};

export type Nl2MmdSemanticHint = {
  kind:
    | "role_lookup"
    | "model_lookup"
    | "routing_mode"
    | "join_mode"
    | "loop_hint"
    | "binding_policy"
    | "entry_hint"
    | "terminal_hint";
  label: string;
  detail: string;
};

export type Nl2MmdCatalogSearchResult<T> = {
  item: T;
  score: number;
  reason: string;
};

export type Nl2MmdSupportedDictionary = {
  flowcharts: string[];
  boundaryTokens: string[];
  exactMetadataKeys: string[];
  metadataPrefixes: string[];
  roleModes: string[];
  joinModes: string[];
  mentionPrefix: string;
  nodeTokenPattern: string;
  edgePattern: string;
};

export type Nl2MmdRoleMention = {
  mention: string;
  roleId: string;
  exists: boolean;
};

/**
 * Runtime-loaded NL2MMD context assembled from local role/model/law catalogs.
 */
export type Nl2MmdContext = {
  workdir: string;
  roleRootDir: string;
  modelRootDir: string;
  roleCatalog: Nl2MmdRoleSummary[];
  modelCatalog: Nl2MmdModelSummary[];
  lawIds: string[];
  supportedDictionary: Nl2MmdSupportedDictionary;
};

export type Nl2MmdValidationResult = {
  status: "ok" | "failed";
  system?: Pick<SystemDefinition, "systemId" | "systemVersion" | "entryRoleId" | "roleIds"> & {
    lawRef: string;
  };
  errors: string[];
  warnings: string[];
  txtGraph?: string;
};

export type Nl2MmdTurnMode = "ask" | "draft" | "final";

export type Nl2MmdModelResponse = {
  mode: Nl2MmdTurnMode;
  summary: string;
  questions: string[];
  assumptions: string[];
  referencedRoles: string[];
  unresolvedItems: string[];
  mermaid: string;
};

/**
 * One NL2MMD turn output enriched with session and local validation metadata.
 */
export type Nl2MmdTurnResult = Nl2MmdModelResponse & {
  sessionId?: string;
  messageId?: string;
  txtGraph?: string;
  validation?: Nl2MmdValidationResult;
};

export type Nl2MmdTurnInput = {
  message: string;
  draftMermaid?: string;
  validationErrors?: string[];
  validationWarnings?: string[];
};

/**
 * Long-lived conversation handle. Caller owns lifecycle and must call `close`.
 */
export type Nl2MmdConversation = {
  context: Nl2MmdContext;
  modelPackage: LoadedModelPackage;
  workdir: string;
  sessionId?: string;
  close(): void;
};
