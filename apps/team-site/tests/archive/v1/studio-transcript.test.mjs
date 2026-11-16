import assert from "node:assert/strict";
import test from "node:test";
import { eventLabels } from "../event-labels.mjs";
import { state } from "../public/app/state.js";
import { createStudioTranscriptTools } from "../public/app/components/studio-transcript.js";

const transcript = createStudioTranscriptTools({
  roleColorForId: () => ({ accent: "#16805f", fill: "#e7f3ed" }),
  renderRoleAvatarWithBadge: () => "",
  formatEventTime: () => "",
  formatStatus: () => ""
});

test("Team Site business event labels use conversational Chinese", () => {
  assert.deepEqual(Object.fromEntries([
    "READY", "APPROVED", "REJECTED", "NEEDS_REWORK", "BLOCKED"
  ].map((event) => [event, eventLabels[event][0]])), {
    READY: "准备好了",
    APPROVED: "同意",
    REJECTED: "不同意",
    NEEDS_REWORK: "请再改改",
    BLOCKED: "办不了"
  });
});

test("chat presentation uses configured labels and matching conversational emoji", () => {
  const previousLocale = state.locale;
  const previousLabels = state.eventLabels;
  state.locale = "zh-CN";
  state.eventLabels = eventLabels;
  try {
    assert.equal(transcript.messagePresentation({ event: "READY", content: "done" }).label, "准备好了");
    assert.equal(transcript.messagePresentation({ event: "APPROVED", content: "ok" }).label, "同意");
    assert.equal(transcript.messagePresentation({ event: "REJECTED", content: "no" }).label, "不同意");
    assert.equal(transcript.messagePresentation({ event: "NEEDS_REWORK", content: "retry" }).label, "请再改改");
    assert.equal(transcript.messagePresentation({ event: "BLOCKED", content: "blocked" }).label, "办不了");
  } finally {
    state.locale = previousLocale;
    state.eventLabels = previousLabels;
  }
});

test("long chat messages keep an in-place expandable scroll target", () => {
  const previousLocale = state.locale;
  state.locale = "zh-CN";
  try {
    const content = "这是一段很长的协作结果。".repeat(40);
    const markup = transcript.messageBodyMarkup({ event: "READY", content });
    assert.match(markup, /studio-message-event-emoji/);
    assert.match(markup, /✅/);
    assert.match(markup, /准备好了/);
    assert.match(markup, /data-studio-message-more/);
    assert.match(markup, /aria-expanded="false"/);
    assert.match(markup, /aria-controls="studio-message-full-/);
    assert.match(markup, /data-studio-message-full/);
    assert.doesNotMatch(markup.match(/<pre[^>]*data-studio-message-full[^>]*>([\s\S]*?)<\/pre>/)?.[1] || "", /…|\.\.\./);
  } finally {
    state.locale = previousLocale;
  }
});

test("structured stdout keeps localized event preview while retaining raw JSON for expansion", () => {
  const previousLocale = state.locale;
  const previousLabels = state.eventLabels;
  state.locale = "zh-CN";
  state.eventLabels = eventLabels;
  try {
    const stdout = JSON.stringify({ event: "READY", content: "结论已经整理好了。".repeat(45), data: { items: Array.from({ length: 8 }, (_, index) => index) } });
    const presentation = transcript.messagePresentation(stdout);
    assert.equal(presentation.label, "准备好了");
    assert.match(presentation.content, /^结论已经整理好了/);
    const markup = transcript.messageBodyMarkup(stdout);
    assert.match(markup, /✅/);
    assert.match(markup, /准备好了/);
    assert.match(markup, /结论已经整理好了/);
    assert.match(markup, /&quot;items&quot;/);
  } finally {
    state.locale = previousLocale;
    state.eventLabels = previousLabels;
  }
});
