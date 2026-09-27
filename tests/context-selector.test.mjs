import test from "node:test";
import assert from "node:assert/strict";
import { listContextSelectorCandidates, summarizeContextSelector } from "../dist/context-selector.js";

test("context selector semantic module accepts supported nested paths", () => {
  for (const selector of [
    "direct.data.issueId",
    "source(worker-a).data.result.issueId",
    "global.user_profile.locale.language",
    "global.human_review.current.previous_output.answer"
  ]) {
    assert.equal(summarizeContextSelector(selector).validPath, true, selector);
  }
});

test("context selector optional marker remains limited to Human Review values", () => {
  assert.equal(summarizeContextSelector("global.human_review.current.comment?").validPath, true);
  assert.equal(summarizeContextSelector("direct.data.issueId?").validPath, false);
  assert.equal(summarizeContextSelector("direct.data.bad-key").validPath, false);
});

test("context selector candidates follow incoming roles and quorum availability", () => {
  const direct = listContextSelectorCandidates({ incomingRoleIds: ["writer"] });
  assert.ok(direct.includes("direct.data"));
  assert.ok(!direct.some((candidate) => candidate.startsWith("source(")));

  const join = listContextSelectorCandidates({ incomingRoleIds: ["writer", "reviewer"], joinMode: "all_of" });
  assert.ok(join.includes("source(writer).data"));
  assert.ok(join.includes("source(reviewer).content"));

  const unavailableQuorum = listContextSelectorCandidates({
    incomingRoleIds: ["writer", "reviewer"], joinMode: "quorum_of", joinMin: 1
  });
  assert.ok(!unavailableQuorum.some((candidate) => candidate.startsWith("source(")));
});
