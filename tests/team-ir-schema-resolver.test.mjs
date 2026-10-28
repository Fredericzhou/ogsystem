import test from "node:test";
import assert from "node:assert/strict";

import {
  TEAM_IR_SCHEMA_DIALECT,
  TeamSchemaResolver,
  TeamSchemaResolverError
} from "../dist/team-ir/schema-resolver.js";

const teamDocument = {
  schemaVersion: 2,
  $defs: {
    request: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false
    },
    externalRecord: { $ref: "schemas/shared.json#/$defs/record" }
  }
};

test("resolves Team-local definitions and package-relative JSON Pointers", () => {
  const resolver = new TeamSchemaResolver({
    teamDocument,
    packageSchemas: {
      "schemas/shared.json": {
        $schema: TEAM_IR_SCHEMA_DIALECT,
        $defs: { record: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } }
      }
    }
  });
  assert.equal(resolver.resolve("#/$defs/request").schema.type, "object");
  assert.equal(resolver.resolve("schemas/shared.json#/$defs/record").schema.type, "object");
  const validate = resolver.compile("#/$defs/externalRecord");
  assert.equal(validate({ id: "r1" }), true);
  assert.equal(validate({ id: 2 }), false);
  assert.deepEqual(resolver.snapshot().map((resource) => resource.path), ["schemas/shared.json", "team.json"]);
});

test("resolves package references relative to the containing schema resource", () => {
  const resolver = new TeamSchemaResolver({
    teamDocument,
    packageSchemas: {
      "schemas/root.json": { $schema: TEAM_IR_SCHEMA_DIALECT, $ref: "./common.json#/$defs/item" },
      "schemas/common.json": { $schema: TEAM_IR_SCHEMA_DIALECT, $defs: { item: { type: "integer", minimum: 1 } } }
    }
  });
  const validate = resolver.compile("#", "schemas/root.json");
  assert.equal(validate(3), true);
  assert.equal(validate(0), false);
  assert.deepEqual(resolver.snapshot().map((resource) => resource.path), ["schemas/common.json", "schemas/root.json", "team.json"]);
});

test("rejects network, absolute, escaping and unsupported Team-local references", () => {
  const resolver = new TeamSchemaResolver({ teamDocument, packageSchemas: { "schemas/a.json": { type: "string" } } });
  for (const reference of ["https://example.test/schema.json", "//example.test/schema.json", "/etc/passwd", "../outside.json", "schemas/../../outside.json", "#", "#/schemaVersion", "#/$defsMissing/x", "#not-a-pointer"]) {
    assert.throws(() => resolver.resolve(reference), TeamSchemaResolverError, reference);
  }
  assert.throws(() => new TeamSchemaResolver({ teamDocument, packageSchemas: { "../outside.json": { type: "string" } } }), TeamSchemaResolverError);
  assert.throws(() => new TeamSchemaResolver({ teamDocument, packageSchemas: { "/outside.json": { type: "string" } } }), TeamSchemaResolverError);
});

test("rejects missing resources, pointers and malformed pointer escapes", () => {
  const resolver = new TeamSchemaResolver({ teamDocument });
  assert.throws(() => resolver.resolve("schemas/missing.json"), /does not exist/);
  assert.throws(() => resolver.resolve("#/$defs/unknown"), /does not exist/);
  assert.throws(() => resolver.resolve("#/$defs/~2bad"), /Invalid JSON Pointer escape/);
});

test("uses stable normalized resource digests independent of object insertion order", () => {
  const left = new TeamSchemaResolver({ teamDocument: { $defs: { shape: { properties: { b: { type: "number" }, a: { type: "string" } } } } } });
  const right = new TeamSchemaResolver({ teamDocument: { $defs: { shape: { properties: { a: { type: "string" }, b: { type: "number" } } } } } });
  assert.equal(left.resolve("#/$defs/shape").digest, right.resolve("#/$defs/shape").digest);
  assert.match(left.snapshot()[0].digest, /^[a-f0-9]{64}$/);
});

test("validates schemas with the Draft 2020-12 dialect", () => {
  const resolver = new TeamSchemaResolver({
    teamDocument,
    packageSchemas: {
      "schemas/legacy.json": { $schema: "http://json-schema.org/draft-07/schema#", type: "string" }
    }
  });
  assert.throws(() => resolver.compile("#/$defs/request"), /must use Draft 2020-12/);
});

test("fails closed for network refs hidden inside a referenced schema closure", () => {
  const resolver = new TeamSchemaResolver({
    teamDocument: { $defs: { unsafe: { $ref: "schemas/unsafe.json" } } },
    packageSchemas: { "schemas/unsafe.json": { $ref: "https://example.test/remote.json" } }
  });
  assert.throws(() => resolver.compile("#/$defs/unsafe"), /Network and absolute schema references are forbidden/);
});

test("schema resolver failures expose stable error codes for forbidden, out-of-scope, missing and unsupported resources", () => {
  const resolver = new TeamSchemaResolver({
    teamDocument,
    packageSchemas: {
      "schemas/legacy.json": { $schema: "http://json-schema.org/draft-07/schema#", type: "string" }
    }
  });
  const expectCode = (callback, code) => assert.throws(callback, (error) => error instanceof TeamSchemaResolverError && error.code === code);
  expectCode(() => resolver.resolve("https://example.test/schema.json"), "IR_SCHEMA_REF_FORBIDDEN");
  expectCode(() => resolver.resolve("../outside.json"), "IR_SCHEMA_PATH_OUT_OF_SCOPE");
  expectCode(() => resolver.resolve("schemas/missing.json"), "IR_UNKNOWN_SCHEMA_REF");
  expectCode(() => resolver.compile("schemas/legacy.json"), "IR_SCHEMA_DIALECT_UNSUPPORTED");
  expectCode(() => new TeamSchemaResolver({ teamDocument: { $defs: { invalid: { value: undefined } } } }), "IR_SCHEMA_INVALID");
});
