import assert from "node:assert/strict";
import test from "node:test";
import { cases } from "../cases.mjs";

test("structured debate classic team uses the V2 five-role document workflow", () => {
  const debate = cases.find((item) => item.id === "structured-debate");
  assert.ok(debate);
  assert.deepEqual(debate.roles.map((role) => role.id), [
    "debate-host",
    "proponent",
    "opponent",
    "neutral-judge",
    "document-publisher"
  ]);
  assert.deepEqual(debate.flows.at(-2), ["neutral-judge", "document-publisher", "READY"]);
  assert.deepEqual(debate.flows.at(-1), ["document-publisher", "__system_end__", "READY"]);
  assert.equal(debate.roles.some((role) => role.execution), false);
  assert.equal(debate.roles.some((role) => /media-publisher|debate-reporter/.test(role.id)), false);
  assert.match(debate.roles.find((role) => role.id === "document-publisher").prompt, /write-capable staging/i);
  assert.match(debate.roles.find((role) => role.id === "document-publisher").prompt, /artifacts/i);
});

test("active classic cases do not carry V1 execution bindings", () => {
  for (const team of cases) {
    for (const role of team.roles) {
      assert.equal("execution" in role, false, `${team.id}/${role.id} carries legacy execution binding`);
      assert.doesNotMatch(role.prompt || "", /profileId|toolRef|profile\.|tool\./i, `${team.id}/${role.id} carries legacy binding instructions`);
    }
  }
});
