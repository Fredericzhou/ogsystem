import test from "node:test";
import assert from "node:assert/strict";
import { listContextSelectorCandidates, summarizeContextSelector, extractSchemaPropertyPaths } from "../dist/context-selector.js";

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

test("context selector optional marker supports human review and handoff data paths only", () => {
  assert.equal(summarizeContextSelector("global.human_review.current.comment?").validPath, true);
  assert.equal(summarizeContextSelector("direct.data?").validPath, true);
  assert.equal(summarizeContextSelector("source(worker-a).data?").validPath, true);
  assert.equal(summarizeContextSelector("direct.data.issueId?").validPath, true);
  assert.equal(summarizeContextSelector("source(worker-a).data.findings?").validPath, true);
  assert.equal(summarizeContextSelector("direct.artifact").validPath, true);
  assert.equal(summarizeContextSelector("direct.artifact?").validPath, true);
  assert.equal(summarizeContextSelector("source(worker-a).artifact").validPath, true);
  assert.equal(summarizeContextSelector("source(worker-a).artifact?").validPath, true);
  assert.equal(summarizeContextSelector("direct.content?").validPath, false);
  assert.equal(summarizeContextSelector("source(worker-a).content?").validPath, true);
  assert.equal(summarizeContextSelector("source(worker-a).data.bad-key?").validPath, false);
  assert.equal(summarizeContextSelector("direct.data.bad-key").validPath, false);
});

test("context selector candidates follow incoming roles and quorum availability", () => {
  const direct = listContextSelectorCandidates({ incomingRoleIds: ["writer"] });
  assert.ok(direct.includes("direct.data"));
  assert.ok(direct.includes("direct.artifact"));
  assert.ok(!direct.some((candidate) => candidate.startsWith("source(")));

  const join = listContextSelectorCandidates({ incomingRoleIds: ["writer", "reviewer"], joinMode: "all_of" });
  assert.ok(join.includes("source(writer).data"));
  assert.ok(join.includes("source(reviewer).content"));
  assert.ok(join.includes("source(writer).artifact"));

  const unavailableQuorum = listContextSelectorCandidates({
    incomingRoleIds: ["writer", "reviewer"], joinMode: "quorum_of", joinMin: 1
  });
  assert.ok(!unavailableQuorum.some((candidate) => candidate.startsWith("source(")));
});

test("extractSchemaPropertyPaths extracts nested properties from data envelope and top-level schema", () => {
  const schemaWithData = {
    type: "object",
    properties: {
      event: { type: "string" },
      content: { type: "string" },
      data: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Brief overview" },
          analysis: {
            type: "object",
            description: "Detailed analysis",
            properties: {
              score: { type: "number", description: "Confidence score" },
              risks: {
                type: "object",
                properties: {
                  primary: { type: "string", description: "Main risk" },
                  severity: { enum: ["low", "high"] }
                }
              }
            }
          }
        }
      }
    }
  };

  const extracted = extractSchemaPropertyPaths(schemaWithData);
  const paths = extracted.map((item) => item.path);
  assert.deepEqual(paths, [
    "summary",
    "analysis",
    "analysis.score",
    "analysis.risks",
    "analysis.risks.primary",
    "analysis.risks.severity"
  ]);

  const scoreEntry = extracted.find((item) => item.path === "analysis.score");
  assert.equal(scoreEntry?.type, "number");
  assert.equal(scoreEntry?.description, "Confidence score");

  const severityEntry = extracted.find((item) => item.path === "analysis.risks.severity");
  assert.equal(severityEntry?.type, "enum");

  // Fallback for flat business schema without data envelope
  const flatSchema = {
    type: "object",
    properties: {
      event: { type: "string" },
      title: { type: "string", description: "Project title" },
      config: {
        properties: {
          enabled: { type: "boolean" }
        }
      }
    }
  };
  const flatExtracted = extractSchemaPropertyPaths(flatSchema);
  assert.deepEqual(flatExtracted.map((item) => item.path), ["title", "config", "config.enabled"]);

  // Invalid or empty schema returns empty list without error
  assert.deepEqual(extractSchemaPropertyPaths(null), []);
  assert.deepEqual(extractSchemaPropertyPaths({}), []);
  assert.deepEqual(extractSchemaPropertyPaths("not-an-object"), []);
});
