import assert from "node:assert/strict";
import test from "node:test";
import { createStudioTranscriptTools } from "../public/app/components/studio-transcript.js";

const tools = createStudioTranscriptTools({
  roleColorForId: () => ({ accent: "#000", fill: "#fff" }),
  renderRoleAvatarWithBadge: () => "",
  formatEventTime: () => "",
  formatStatus: (value) => value
});

test("structured chat expansion keeps natural language content instead of raw JSON", () => {
  const presentation = tools.messagePresentation('{"event":"READY","content":"The review is complete."}');
  assert.equal(presentation.event, "READY");
  assert.equal(presentation.content, "The review is complete.");
  assert.equal(presentation.fullText, undefined);

  const markup = tools.messageSectionMarkup("Output", '{"event":"READY","content":"The review is complete."}');
  assert.match(markup, /The review is complete\./);
  assert.doesNotMatch(markup, /\\"event\\"|\\"content\\"/);
});
