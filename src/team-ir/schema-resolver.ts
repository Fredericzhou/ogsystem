import { createHash } from "node:crypto";
import path from "node:path";
import { Ajv2020, type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";

export const TEAM_IR_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const RESOLVER_ORIGIN = "https://team-ir.invalid/";
const TEAM_RESOURCE = "team.json";

export type TeamSchemaSnapshotResource = {
  path: string;
  dialect: typeof TEAM_IR_SCHEMA_DIALECT;
  digest: string;
};

export type ResolvedSchema = {
  resourcePath: string;
  pointer: string;
  schema: unknown;
  digest: string;
};

export class TeamSchemaResolverError extends Error {
  constructor(message: string, readonly code = "IR_UNKNOWN_SCHEMA_REF") {
    super(message);
    this.name = "TeamSchemaResolverError";
  }
}

function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TeamSchemaResolverError("Schema resources must contain finite JSON numbers", "IR_SCHEMA_INVALID");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      if (input[key] === undefined) throw new TeamSchemaResolverError("Schema resources must contain JSON values", "IR_SCHEMA_INVALID");
      output[key] = normalizeJson(input[key]);
    }
    return output;
  }
  throw new TeamSchemaResolverError("Schema resources must contain JSON values", "IR_SCHEMA_INVALID");
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function resourceDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function normalizePackagePath(input: string, fromResource: string): string {
  if (!input || input.includes("\\") || input.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input)) {
    throw new TeamSchemaResolverError(`Schema reference must be package-relative: ${input}`);
  }
  if (input.includes("?") || input.includes("#")) throw new TeamSchemaResolverError(`Invalid package-relative schema path: ${input}`);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromResource), input));
  if (resolved === "." || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new TeamSchemaResolverError(`Schema path escapes package root: ${input}`, "IR_SCHEMA_PATH_OUT_OF_SCOPE");
  }
  return resolved;
}

function normalizeResourceKey(input: string): string {
  if (!input || input.includes("\\") || input.startsWith("/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(input)) {
    throw new TeamSchemaResolverError(`Invalid package schema path: ${input}`, "IR_SCHEMA_PATH_OUT_OF_SCOPE");
  }
  const normalized = path.posix.normalize(input);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new TeamSchemaResolverError(`Package schema path escapes package root: ${input}`, "IR_SCHEMA_PATH_OUT_OF_SCOPE");
  }
  return normalized;
}

function decodePointer(pointer: string, reference: string): string[] {
  if (!pointer) return [];
  if (!pointer.startsWith("/")) throw new TeamSchemaResolverError(`Invalid JSON Pointer fragment in ${reference}`);
  return pointer.slice(1).split("/").map((encoded) => {
    if (/~(?:[^01]|$)/.test(encoded)) throw new TeamSchemaResolverError(`Invalid JSON Pointer escape in ${reference}`);
    return encoded.replace(/~1/g, "/").replace(/~0/g, "~");
  });
}

function pointerValue(document: unknown, pointer: string, reference: string): unknown {
  let value = document;
  for (const token of decodePointer(pointer, reference)) {
    if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, token)) {
      throw new TeamSchemaResolverError(`Schema pointer does not exist: ${reference}`);
    }
    value = (value as Record<string, unknown>)[token];
  }
  return value;
}

function splitReference(reference: string): { resource?: string; pointer: string } {
  if (typeof reference !== "string" || !reference) throw new TeamSchemaResolverError("Schema reference must be a non-empty string");
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) || reference.startsWith("//") || reference.startsWith("/")) {
    throw new TeamSchemaResolverError(`Network and absolute schema references are forbidden: ${reference}`, "IR_SCHEMA_REF_FORBIDDEN");
  }
  const hashIndex = reference.indexOf("#");
  const resourcePart = hashIndex < 0 ? reference : reference.slice(0, hashIndex);
  let pointer = hashIndex < 0 ? "" : reference.slice(hashIndex + 1);
  try {
    pointer = decodeURIComponent(pointer);
  } catch {
    throw new TeamSchemaResolverError(`Invalid encoded schema fragment: ${reference}`);
  }
  if (pointer && !pointer.startsWith("/")) throw new TeamSchemaResolverError(`Only JSON Pointer schema fragments are supported: ${reference}`);
  return { ...(resourcePart ? { resource: resourcePart } : {}), pointer };
}

function resolverUri(resourcePath: string): string {
  return RESOLVER_ORIGIN + resourcePath.split("/").map(encodeURIComponent).join("/");
}

function withResolverId(schema: unknown, resourcePath: string): AnySchema {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new TeamSchemaResolverError(`Schema resource must be an object: ${resourcePath}`, "IR_SCHEMA_INVALID");
  }
  const record = schema as Record<string, unknown>;
  if (record.$schema !== undefined && record.$schema !== TEAM_IR_SCHEMA_DIALECT) {
    throw new TeamSchemaResolverError(`Schema resource must use Draft 2020-12: ${resourcePath}`, "IR_SCHEMA_DIALECT_UNSUPPORTED");
  }
  return { ...record, $schema: TEAM_IR_SCHEMA_DIALECT, $id: resolverUri(resourcePath) } as AnySchema;
}

export class TeamSchemaResolver {
  private readonly resources = new Map<string, unknown>();
  private readonly usedResources = new Set<string>([TEAM_RESOURCE]);
  private readonly normalizedTeamResource: unknown;
  private inlineSchemaSequence = 0;

  constructor(args: { teamDocument: unknown; packageSchemas?: Record<string, unknown> }) {
    if (!args.teamDocument || typeof args.teamDocument !== "object" || Array.isArray(args.teamDocument)) {
      throw new TeamSchemaResolverError("Team document must be an object", "IR_SCHEMA_INVALID");
    }
    const team = normalizeJson(args.teamDocument) as Record<string, unknown>;
    const definitions = team.$defs;
    if (definitions !== undefined && (!definitions || typeof definitions !== "object" || Array.isArray(definitions))) {
      throw new TeamSchemaResolverError("Team $defs must be an object", "IR_SCHEMA_INVALID");
    }
    this.normalizedTeamResource = {
      $schema: TEAM_IR_SCHEMA_DIALECT,
      ...(definitions === undefined ? {} : { $defs: definitions })
    };
    this.resources.set(TEAM_RESOURCE, this.normalizedTeamResource);
    for (const [resourcePath, schema] of Object.entries(args.packageSchemas ?? {})) {
      const normalizedPath = normalizeResourceKey(resourcePath);
      if (normalizedPath === TEAM_RESOURCE) throw new TeamSchemaResolverError(`${TEAM_RESOURCE} is reserved for the Team document`);
      if (this.resources.has(normalizedPath)) throw new TeamSchemaResolverError(`Duplicate schema resource: ${normalizedPath}`);
      this.resources.set(normalizedPath, normalizeJson(schema));
    }
  }

  resolve(reference: string, fromResource = TEAM_RESOURCE): ResolvedSchema {
    const base = normalizeResourceKey(fromResource);
    const parts = splitReference(reference);
    let resourcePath = base;
    if (parts.resource) resourcePath = normalizePackagePath(parts.resource, base);
    if (parts.resource && !this.resources.has(resourcePath)) {
      throw new TeamSchemaResolverError(`Schema resource does not exist: ${resourcePath}`);
    }
    if (resourcePath === TEAM_RESOURCE && !parts.pointer.startsWith("/$defs/")) {
      throw new TeamSchemaResolverError(`Team-local schema references must target #/$defs: ${reference}`);
    }
    const resource = this.resources.get(resourcePath);
    if (resource === undefined) throw new TeamSchemaResolverError(`Schema resource does not exist: ${resourcePath}`);
    const schema = pointerValue(resource, parts.pointer, reference);
    this.usedResources.add(resourcePath);
    return { resourcePath, pointer: parts.pointer, schema, digest: resourceDigest(resource) };
  }

  snapshot(): TeamSchemaSnapshotResource[] {
    return [...this.usedResources].sort().map((resourcePath) => ({
      path: resourcePath,
      dialect: TEAM_IR_SCHEMA_DIALECT,
      digest: resourceDigest(this.resources.get(resourcePath))
    }));
  }

  compile(reference: string, fromResource = TEAM_RESOURCE): ValidateFunction {
    const resolved = this.resolve(reference, fromResource);
    return this.compileResolved(resolved);
  }

  compileSchema(schema: unknown, fromResource = TEAM_RESOURCE): ValidateFunction {
    const baseResource = normalizeResourceKey(fromResource);
    this.inlineSchemaSequence += 1;
    const resourcePath = `team-runtime-inline-${this.inlineSchemaSequence}.json`;
    const teamDefinitions = (this.normalizedTeamResource as Record<string, unknown>).$defs;
    const resource = {
      $schema: TEAM_IR_SCHEMA_DIALECT,
      ...(teamDefinitions === undefined ? {} : { $defs: teamDefinitions }),
      allOf: [normalizeJson(schema)]
    };
    this.resources.set(resourcePath, resource);
    const validateClosure = (value: unknown, currentResource: string, visited: Set<string>): void => {
      const key = `${currentResource}\u0000${resourceDigest(value)}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (Array.isArray(value)) {
        for (const item of value) validateClosure(item, currentResource, visited);
        return;
      }
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(object, "$dynamicRef") || Object.prototype.hasOwnProperty.call(object, "$recursiveRef")) {
        throw new TeamSchemaResolverError("Dynamic and recursive schema references are not supported", "IR_SCHEMA_REF_FORBIDDEN");
      }
      if (typeof object.$ref === "string") {
        const target = this.resolve(object.$ref, currentResource);
        validateClosure(target.schema, target.resourcePath, visited);
      } else if (Object.prototype.hasOwnProperty.call(object, "$ref")) {
        throw new TeamSchemaResolverError("$ref must be a string", "IR_SCHEMA_INVALID");
      }
      for (const [key, child] of Object.entries(object)) if (key !== "$ref") validateClosure(child, currentResource, visited);
    };
    try {
      validateClosure(schema, baseResource, new Set());
      return this.compile(resourcePath);
    } finally {
      this.resources.delete(resourcePath);
      this.usedResources.delete(resourcePath);
    }
  }

  private createAjv(): Ajv2020 {
    const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: true });
    for (const [resourcePath, schema] of this.resources) {
      const resourceWithId = withResolverId(schema, resourcePath);
      const validSchema = ajv.validateSchema(resourceWithId);
      if (!validSchema) {
        const details = JSON.stringify(ajv.errors ?? []);
        throw new TeamSchemaResolverError(`Invalid Draft 2020-12 schema ${resourcePath}: ${details}`, "IR_SCHEMA_INVALID");
      }
      ajv.addSchema(resourceWithId, resolverUri(resourcePath));
    }
    return ajv;
  }

  private compileResolved(resolved: ResolvedSchema): ValidateFunction {
    const visitReferences = (schema: unknown, resourcePath: string, visited: Set<string>): void => {
      const key = `${resourcePath}\u0000${resourceDigest(schema)}`;
      if (visited.has(key)) return;
      visited.add(key);
      if (Array.isArray(schema)) {
        for (const item of schema) visitReferences(item, resourcePath, visited);
        return;
      }
      if (!schema || typeof schema !== "object") return;
      const record = schema as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(record, "$dynamicRef") || Object.prototype.hasOwnProperty.call(record, "$recursiveRef")) {
        throw new TeamSchemaResolverError("Dynamic and recursive schema references are not supported", "IR_SCHEMA_REF_FORBIDDEN");
      }
      if (typeof record.$ref === "string") {
        const target = this.resolve(record.$ref, resourcePath);
        visitReferences(target.schema, target.resourcePath, visited);
      } else if (Object.prototype.hasOwnProperty.call(record, "$ref")) {
        throw new TeamSchemaResolverError("$ref must be a string", "IR_SCHEMA_INVALID");
      }
      for (const value of Object.values(record)) visitReferences(value, resourcePath, visited);
    };
    visitReferences(resolved.schema, resolved.resourcePath, new Set());
    const ajv = this.createAjv();
    const targetUri = `${resolverUri(resolved.resourcePath)}${resolved.pointer ? `#${resolved.pointer}` : ""}`;
    try {
      return ajv.compile({ $schema: TEAM_IR_SCHEMA_DIALECT, $ref: targetUri });
    } catch (error) {
      throw new TeamSchemaResolverError(`Unable to compile schema reference ${targetUri}: ${String(error)}`, "IR_SCHEMA_INVALID");
    }
  }
}

export function canonicalizeTeamSchemaResource(value: unknown): string {
  return stableJson(value);
}
