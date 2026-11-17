/**
 * @fileoverview Strict validators for runtime-side JSON configuration files.
 * File Set: runtime-adapter
 * Responsibilities:
 * - Validate profiles/tools/laws/user-profile/runtime config payloads.
 * - Return strongly typed structures with precise field-path errors.
 * Boundaries:
 * - No filesystem IO and no runtime execution side effects.
 */
import type {
  LawCatalog,
  LawSpec,
  RuntimeConfig,
  UserProfile
} from "./types.js";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export class ConfigValidationError extends Error {
  constructor(
    public readonly filePath: string,
    public readonly fieldPath: string,
    message: string
  ) {
    super(`Invalid config in ${filePath} at ${fieldPath}: ${message}`);
    this.name = "ConfigValidationError";
  }
}

function fail(filePath: string, fieldPath: string, message: string): never {
  throw new ConfigValidationError(filePath, fieldPath, message);
}

function describeType(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  return typeof value;
}

function expectRecord(
  value: unknown,
  filePath: string,
  fieldPath: string
): Record<string, JsonValue> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(filePath, fieldPath, `expected object, received ${describeType(value)}`);
  }
  return value as Record<string, JsonValue>;
}

function expectArray(value: unknown, filePath: string, fieldPath: string): JsonValue[] {
  if (!Array.isArray(value)) {
    fail(filePath, fieldPath, `expected array, received ${describeType(value)}`);
  }
  return value as JsonValue[];
}

function expectString(value: unknown, filePath: string, fieldPath: string): string {
  if (typeof value !== "string") {
    fail(filePath, fieldPath, `expected string, received ${describeType(value)}`);
  }
  if (!value.trim()) {
    fail(filePath, fieldPath, "expected non-empty string");
  }
  return value;
}

function expectOptionalString(
  value: unknown,
  filePath: string,
  fieldPath: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return expectString(value, filePath, fieldPath);
}

function expectOptionalBoolean(
  value: unknown,
  filePath: string,
  fieldPath: string
): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    fail(filePath, fieldPath, `expected boolean, received ${describeType(value)}`);
  }
  return value;
}

function expectOptionalPositiveInteger(
  value: unknown,
  filePath: string,
  fieldPath: string
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(filePath, fieldPath, "expected positive integer");
  }
  return value;
}

function expectNoExtraKeys(
  record: Record<string, JsonValue>,
  allowedKeys: string[],
  filePath: string,
  fieldPath: string
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail(filePath, `${fieldPath}.${key}`, "unknown field");
    }
  }
}

function assertUniqueStringKey(args: {
  key: string;
  index: number;
  seenByKey: Map<string, number>;
  filePath: string;
  fieldPath: string;
  label: string;
}): void {
  const existingIndex = args.seenByKey.get(args.key);
  if (existingIndex !== undefined) {
    fail(
      args.filePath,
      args.fieldPath,
      `duplicate ${args.label} "${args.key}" (first declared at index ${existingIndex})`
    );
  }
  args.seenByKey.set(args.key, args.index);
}

export function validateProfilesConfig(_value: unknown, filePath: string): never {
  fail(filePath, "$", "profiles.json is not accepted by Contract Set v2");
}

function validateStringArray(value: unknown, filePath: string, fieldPath: string): string[] {
  return expectArray(value, filePath, fieldPath).map((item, index) => expectString(item, filePath, `${fieldPath}[${index}]`));
}

export function validateToolsConfig(_value: unknown, filePath: string): never {
  fail(filePath, "$", "tools.json is not accepted by Contract Set v2");
}

function validateLawSpec(value: unknown, filePath: string, fieldPath: string): LawSpec {
  const record = expectRecord(value, filePath, fieldPath);
  expectNoExtraKeys(record, ["lawId", "constraints"], filePath, fieldPath);

  const constraintsValue = record.constraints;
  let constraints: LawSpec["constraints"];
  if (constraintsValue !== undefined) {
    const constraintsRecord = expectRecord(constraintsValue, filePath, `${fieldPath}.constraints`);
    expectNoExtraKeys(
      constraintsRecord,
      ["forbiddenToolRefs", "maxTransitions", "allowNoopWithoutExecutionBinding", "maxPromptCharsPerRole", "maxTotalPromptCharsPerRun", "isolateExternalData"],
      filePath,
      `${fieldPath}.constraints`
    );

    const forbiddenToolRefsValue = constraintsRecord.forbiddenToolRefs;
    const forbiddenToolRefs =
      forbiddenToolRefsValue === undefined
        ? undefined
        : expectArray(forbiddenToolRefsValue, filePath, `${fieldPath}.constraints.forbiddenToolRefs`).map(
            (entry, index) =>
              expectString(
                entry,
                filePath,
                `${fieldPath}.constraints.forbiddenToolRefs[${index}]`
              )
          );

    constraints = {
      forbiddenToolRefs,
      maxTransitions: expectOptionalPositiveInteger(
        constraintsRecord.maxTransitions,
        filePath,
        `${fieldPath}.constraints.maxTransitions`
      ),
      allowNoopWithoutExecutionBinding: expectOptionalBoolean(
        constraintsRecord.allowNoopWithoutExecutionBinding,
        filePath,
        `${fieldPath}.constraints.allowNoopWithoutExecutionBinding`
      ),
      maxPromptCharsPerRole: expectOptionalPositiveInteger(
        constraintsRecord.maxPromptCharsPerRole,
        filePath,
        `${fieldPath}.constraints.maxPromptCharsPerRole`
      ),
      maxTotalPromptCharsPerRun: expectOptionalPositiveInteger(
        constraintsRecord.maxTotalPromptCharsPerRun,
        filePath,
        `${fieldPath}.constraints.maxTotalPromptCharsPerRun`
      ),
      isolateExternalData: expectOptionalBoolean(
        constraintsRecord.isolateExternalData,
        filePath,
        `${fieldPath}.constraints.isolateExternalData`
      )
    };
  }

  return {
    lawId: expectString(record.lawId, filePath, `${fieldPath}.lawId`),
    constraints
  };
}

export function validateLawsConfig(value: unknown, filePath: string): LawCatalog {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(record, ["laws"], filePath, "$");
  const seenLawIds = new Map<string, number>();
  const laws = expectArray(record.laws, filePath, "$.laws").map((item, index) => {
    const law = validateLawSpec(item, filePath, `$.laws[${index}]`);
    assertUniqueStringKey({
      key: law.lawId,
      index,
      seenByKey: seenLawIds,
      filePath,
      fieldPath: `$.laws[${index}].lawId`,
      label: "lawId"
    });
    return law;
  });
  return { laws };
}

export function validateUserProfileConfig(value: unknown, filePath: string): UserProfile {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(
    record,
    [
      "userProfileId",
      "language",
      "style",
      "riskPreference",
      "outputLength",
      "domainBackground"
    ],
    filePath,
    "$"
  );

  const domainBackgroundValue = record.domainBackground;
  const domainBackground =
    domainBackgroundValue === undefined
      ? undefined
      : expectArray(domainBackgroundValue, filePath, "$.domainBackground").map((entry, index) =>
          expectString(entry, filePath, `$.domainBackground[${index}]`)
        );

  return {
    userProfileId: expectString(record.userProfileId, filePath, "$.userProfileId"),
    language: expectOptionalString(record.language, filePath, "$.language"),
    style: expectOptionalString(record.style, filePath, "$.style"),
    riskPreference: expectOptionalString(record.riskPreference, filePath, "$.riskPreference"),
    outputLength: expectOptionalString(record.outputLength, filePath, "$.outputLength"),
    domainBackground
  };
}

export function validateRuntimeConfig(value: unknown, filePath: string): RuntimeConfig {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(
    record,
    [
      "configVersion",
      "executor",
      "roleRepo",
      "runsDir",
      "sharedDir",
      "workspace",
      "retention",
      "redaction",
      "tools",
      "opencode"
    ],
    filePath,
    "$"
  );

  const configVersion = expectOptionalString(record.configVersion, filePath, "$.configVersion");
  if (configVersion !== undefined && configVersion !== "2") {
    fail(filePath, "$.configVersion", `unsupported config version "${configVersion}"; expected "2"`);
  }

  const executor = expectString(record.executor, filePath, "$.executor");
  if (executor !== "opencode") {
    fail(filePath, "$.executor", `expected "opencode", received "${executor}"`);
  }

  const workspaceRecord =
    record.workspace === undefined
      ? {}
      : expectRecord(record.workspace, filePath, "$.workspace");
  expectNoExtraKeys(
    workspaceRecord,
    ["rolesDir", "privateDirName", "workspaceIsolation"],
    filePath,
    "$.workspace"
  );
  const workspaceIsolation = expectOptionalString(
    workspaceRecord.workspaceIsolation,
    filePath,
    "$.workspace.workspaceIsolation"
  );
  if (
    workspaceIsolation !== undefined &&
    workspaceIsolation !== "role" &&
    workspaceIsolation !== "branch"
  ) {
    fail(
      filePath,
      "$.workspace.workspaceIsolation",
      `expected "role" or "branch", received "${workspaceIsolation}"`
    );
  }

  const opencodeRecord =
    record.opencode === undefined
      ? undefined
      : expectRecord(record.opencode, filePath, "$.opencode");
  if (opencodeRecord) {
    expectNoExtraKeys(opencodeRecord, ["baseArgs"], filePath, "$.opencode");
  }
  const baseArgsValue = opencodeRecord?.baseArgs;
  const baseArgs =
    baseArgsValue === undefined
      ? undefined
      : expectArray(baseArgsValue, filePath, "$.opencode.baseArgs").map((entry, index) =>
          expectString(entry, filePath, `$.opencode.baseArgs[${index}]`)
        );

  const retentionRecord =
    record.retention === undefined
      ? undefined
      : expectRecord(record.retention, filePath, "$.retention");
  if (retentionRecord) {
    expectNoExtraKeys(
      retentionRecord,
      ["enabled", "executionDirThreshold", "keepLatest"],
      filePath,
      "$.retention"
    );
  }
  const retentionEnabled = expectOptionalBoolean(
    retentionRecord?.enabled,
    filePath,
    "$.retention.enabled"
  );
  const retentionExecutionDirThreshold = expectOptionalPositiveInteger(
    retentionRecord?.executionDirThreshold,
    filePath,
    "$.retention.executionDirThreshold"
  );
  const retentionKeepLatest = expectOptionalPositiveInteger(
    retentionRecord?.keepLatest,
    filePath,
    "$.retention.keepLatest"
  );
  const retention =
    retentionRecord === undefined
      ? undefined
      : {
          enabled: retentionEnabled ?? false,
          executionDirThreshold: retentionExecutionDirThreshold ?? 2000,
          keepLatest: retentionKeepLatest ?? 100
        };

  const toolsRecord =
    record.tools === undefined
      ? undefined
      : expectRecord(record.tools, filePath, "$.tools");
  if (toolsRecord) {
    expectNoExtraKeys(toolsRecord, ["environmentPolicy", "envAllowlist"], filePath, "$.tools");
  }
  const environmentPolicy = expectOptionalString(
    toolsRecord?.environmentPolicy,
    filePath,
    "$.tools.environmentPolicy"
  );
  if (environmentPolicy !== undefined && environmentPolicy !== "inherit" && environmentPolicy !== "minimal") {
    fail(filePath, "$.tools.environmentPolicy", `expected "inherit" or "minimal", received "${environmentPolicy}"`);
  }
  const envAllowlist =
    toolsRecord?.envAllowlist === undefined
      ? []
      : expectArray(toolsRecord.envAllowlist, filePath, "$.tools.envAllowlist").map((entry, index) =>
          expectString(entry, filePath, `$.tools.envAllowlist[${index}]`)
        );
  if (new Set(envAllowlist).size !== envAllowlist.length) {
    fail(filePath, "$.tools.envAllowlist", "must not contain duplicate variable names");
  }
  envAllowlist.forEach((name, index) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      fail(filePath, `$.tools.envAllowlist[${index}]`, "must be a valid environment variable name");
    }
  });

  const redactionRecord =
    record.redaction === undefined
      ? undefined
      : expectRecord(record.redaction, filePath, "$.redaction");
  if (redactionRecord) {
    expectNoExtraKeys(redactionRecord, ["enabled"], filePath, "$.redaction");
  }
  const redaction = {
    enabled: expectOptionalBoolean(redactionRecord?.enabled, filePath, "$.redaction.enabled") ?? true
  };

  return {
    configVersion: "2",
    executor: "opencode",
    roleRepo: expectOptionalString(record.roleRepo, filePath, "$.roleRepo") ?? "./og-roles",
    runsDir: expectOptionalString(record.runsDir, filePath, "$.runsDir") ?? ".ogs/runs",
    sharedDir: expectOptionalString(record.sharedDir, filePath, "$.sharedDir"),
    workspace: {
      rolesDir:
        expectOptionalString(workspaceRecord.rolesDir, filePath, "$.workspace.rolesDir") ?? "roles",
      privateDirName:
        expectOptionalString(
          workspaceRecord.privateDirName,
          filePath,
          "$.workspace.privateDirName"
        ) ?? "private",
      workspaceIsolation: (workspaceIsolation as "role" | "branch" | undefined) ?? "role"
    },
    retention,
    redaction,
    tools: {
      environmentPolicy: (environmentPolicy as "inherit" | "minimal" | undefined) ?? "inherit",
      envAllowlist
    },
    opencode: { baseArgs }
  };
}
