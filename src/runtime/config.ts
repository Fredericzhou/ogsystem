import type {
  CliTool,
  CliToolRegistry,
  ExecutionProfile,
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

export function validateProfilesConfig(value: unknown, filePath: string): ExecutionProfile[] {
  const items = expectArray(value, filePath, "$");
  const seenProfileIds = new Map<string, number>();
  return items.map((item, index) => {
    const fieldPath = `$[${index}]`;
    const record = expectRecord(item, filePath, fieldPath);
    expectNoExtraKeys(record, ["profileId", "toolRef", "timeoutMs", "maxOutputBytes"], filePath, fieldPath);
    const profileId = expectString(record.profileId, filePath, `${fieldPath}.profileId`);
    assertUniqueStringKey({
      key: profileId,
      index,
      seenByKey: seenProfileIds,
      filePath,
      fieldPath: `${fieldPath}.profileId`,
      label: "profileId"
    });

    return {
      profileId,
      toolRef: expectString(record.toolRef, filePath, `${fieldPath}.toolRef`),
      timeoutMs: expectOptionalPositiveInteger(record.timeoutMs, filePath, `${fieldPath}.timeoutMs`),
      maxOutputBytes: expectOptionalPositiveInteger(
        record.maxOutputBytes,
        filePath,
        `${fieldPath}.maxOutputBytes`
      )
    };
  });
}

function validateTool(value: unknown, filePath: string, fieldPath: string): CliTool {
  const record = expectRecord(value, filePath, fieldPath);
  expectNoExtraKeys(record, ["toolRef", "runner", "command", "argsTemplate", "stdinMode"], filePath, fieldPath);

  const runner = expectString(record.runner, filePath, `${fieldPath}.runner`);
  if (runner !== "local_shell") {
    fail(filePath, `${fieldPath}.runner`, `expected "local_shell", received "${runner}"`);
  }

  const stdinMode = expectString(record.stdinMode, filePath, `${fieldPath}.stdinMode`);
  if (stdinMode !== "none" && stdinMode !== "text") {
    fail(filePath, `${fieldPath}.stdinMode`, `expected "none" or "text", received "${stdinMode}"`);
  }

  const argsTemplate = expectArray(record.argsTemplate, filePath, `${fieldPath}.argsTemplate`).map(
    (entry, argsIndex) =>
      expectString(entry, filePath, `${fieldPath}.argsTemplate[${argsIndex}]`)
  );

  return {
    toolRef: expectString(record.toolRef, filePath, `${fieldPath}.toolRef`),
    runner,
    command: expectString(record.command, filePath, `${fieldPath}.command`),
    argsTemplate,
    stdinMode
  };
}

export function validateToolsConfig(value: unknown, filePath: string): CliToolRegistry {
  const record = expectRecord(value, filePath, "$");
  expectNoExtraKeys(record, ["tools"], filePath, "$");
  const seenToolRefs = new Map<string, number>();
  const tools = expectArray(record.tools, filePath, "$.tools").map((item, index) => {
    const tool = validateTool(item, filePath, `$.tools[${index}]`);
    assertUniqueStringKey({
      key: tool.toolRef,
      index,
      seenByKey: seenToolRefs,
      filePath,
      fieldPath: `$.tools[${index}].toolRef`,
      label: "toolRef"
    });
    return tool;
  });
  return { tools };
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
      ["forbiddenToolRefs", "maxTransitions", "allowNoopWithoutExecutionBinding"],
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
      "modelRepo",
      "runsDir",
      "sharedDir",
      "workspace",
      "retention",
      "opencode"
    ],
    filePath,
    "$"
  );

  const configVersion = expectOptionalString(record.configVersion, filePath, "$.configVersion");
  if (configVersion !== undefined && configVersion !== "1") {
    fail(filePath, "$.configVersion", `unsupported config version "${configVersion}"`);
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
    ["rolesDir", "privateDirName"],
    filePath,
    "$.workspace"
  );

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

  return {
    configVersion: configVersion ?? "1",
    executor: "opencode",
    roleRepo: expectOptionalString(record.roleRepo, filePath, "$.roleRepo") ?? "./og-roles",
    modelRepo: expectOptionalString(record.modelRepo, filePath, "$.modelRepo") ?? "./og-models",
    runsDir: expectOptionalString(record.runsDir, filePath, "$.runsDir") ?? "ogsystem-history",
    sharedDir: expectOptionalString(record.sharedDir, filePath, "$.sharedDir"),
    workspace: {
      rolesDir:
        expectOptionalString(workspaceRecord.rolesDir, filePath, "$.workspace.rolesDir") ?? "roles",
      privateDirName:
        expectOptionalString(
          workspaceRecord.privateDirName,
          filePath,
          "$.workspace.privateDirName"
        ) ?? "private"
    },
    retention,
    opencode: {
      baseArgs
    }
  };
}
