import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalizeTeamIR,
  serializeCanonicalTeamIR,
  teamIRSemanticDigest
} from "../dist/team-ir/canonical.js";

test("canonical Team IR sorts object keys recursively and preserves array order", () => {
  const first = {
    schemaVersion: 2,
    team: { version: "1", id: "demo" },
    agents: [{ id: "b" }, { id: "a" }]
  };
  const reorderedKeys = {
    agents: [{ id: "b" }, { id: "a" }],
    team: { id: "demo", version: "1" },
    schemaVersion: 2
  };

  assert.equal(serializeCanonicalTeamIR(first), serializeCanonicalTeamIR(reorderedKeys));
  assert.equal(teamIRSemanticDigest(first), teamIRSemanticDigest(reorderedKeys));
  assert.notEqual(teamIRSemanticDigest(first), teamIRSemanticDigest({ ...first, agents: [...first.agents].reverse() }));
});

test("presentation does not affect the semantic digest", () => {
  const base = { schemaVersion: 2, team: { id: "demo" } };
  assert.equal(
    teamIRSemanticDigest({ ...base, presentation: { nodes: { a: { x: 1, y: 2 } } } }),
    teamIRSemanticDigest({ ...base, presentation: { nodes: { a: { x: 90, y: -4 } }, viewport: { zoom: 2 } } })
  );
  assert.deepEqual(canonicalizeTeamIR({ ...base, presentation: {} }), canonicalizeTeamIR(base));
});

test("semantic digest is SHA-256 over canonical UTF-8 JSON", () => {
  const value = { schemaVersion: 2, team: { id: "demo" } };
  const serialized = serializeCanonicalTeamIR(value);
  assert.equal(teamIRSemanticDigest(value), createHash("sha256").update(serialized, "utf8").digest("hex"));
  assert.match(teamIRSemanticDigest(value), /^[a-f0-9]{64}$/);
});

test("canonicalization rejects values JSON.stringify would omit or coerce", () => {
  assert.throws(() => canonicalizeTeamIR({ schemaVersion: 2, value: undefined }), /not a JSON value/);
  assert.throws(() => canonicalizeTeamIR({ schemaVersion: 2, value: Number.NaN }), /finite JSON number/);
  assert.throws(() => canonicalizeTeamIR({ schemaVersion: 2, value: 1n }), /not a JSON value/);

  const sparse = [];
  sparse.length = 1;
  assert.throws(() => canonicalizeTeamIR({ schemaVersion: 2, sparse }), /present JSON array value/);
});

test("canonicalization rejects cycles, accessors and non-plain objects", () => {
  const cyclic = { schemaVersion: 2 };
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeTeamIR(cyclic), /contains a cycle/);
  assert.throws(() => canonicalizeTeamIR({ schemaVersion: 2, date: new Date() }), /plain JSON object/);
  assert.throws(() => canonicalizeTeamIR({ schemaVersion: 2, get unsafe() { return true; } }), /enumerable JSON data property/);
});
