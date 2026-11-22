import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createStudioTranscriptTools } from "../public/app/components/studio-transcript.js";

const tools = createStudioTranscriptTools({
  roleColorForId: () => ({ accent: "#000", fill: "#fff" }),
  renderRoleAvatarWithBadge: () => "",
  formatEventTime: () => "",
  formatStatus: (value) => value,
  renderMarkdown: (value) => value
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

test("long messages expand inside the original message container", () => {
  const content = "A structured result that remains readable in the chat. ".repeat(12);
  const markup = tools.messageBodyMarkup({ event: "READY", content });
  assert.match(markup, /data-studio-message-content/);
  assert.doesNotMatch(markup, /data-expanded=/);
  assert.match(markup, /data-studio-raw-markdown/);
  assert.match(markup, /data-studio-message-more[^>]*hidden/);
  assert.match(markup, /data-studio-message-copy/);
  assert.doesNotMatch(markup, /data-studio-message-preview|data-studio-message-full/);
  assert.doesNotMatch(markup, /\\"event\\"|\\"content\\"/);
});

test("message more button follows rendered overflow, including short multi-line content", () => {
  function sectionWithOverflow(scrollHeight, clientHeight) {
    const attributes = new Map([["aria-expanded", "false"]]);
    const listeners = {};
    const content = { dataset: {}, querySelector: () => markdown };
    const markdown = { scrollHeight, clientHeight };
    const button = {
      hidden: true,
      textContent: "更多",
      _studioBound: false,
      getAttribute(name) { return attributes.get(name) ?? null; },
      setAttribute(name, value) { attributes.set(name, value); },
      addEventListener(name, handler) { listeners[name] = handler; }
    };
    const section = {
      isConnected: true,
      querySelector(selector) {
        if (selector === "[data-studio-message-more]") return button;
        if (selector === "[data-studio-message-content]") return content;
        return null;
      }
    };
    tools.bindMessageMore(section);
    return { button, content, listeners };
  }

  const shortButTall = sectionWithOverflow(220, 90);
  assert.equal(shortButTall.button.hidden, false);
  assert.equal(shortButTall.content.dataset.expanded, "false");
  shortButTall.listeners.click({ currentTarget: shortButTall.button });
  assert.equal(shortButTall.content.dataset.expanded, "true");
  assert.equal(shortButTall.button.textContent, "收起");

  const longButShort = sectionWithOverflow(80, 90);
  assert.equal(longButShort.button.hidden, true);
  assert.equal(Object.hasOwn(longButShort.content.dataset, "expanded"), false);
});

test("browser markdown renderer keeps GFM and removes scripts and dangerous links", async (t) => {
  const bundle = await readFile(new URL("../public/app/components/markdown-renderer.bundle.js", import.meta.url));
  const dataUrl = `data:text/javascript;base64,${bundle.toString("base64")}`;
  const systemChrome = process.env.OGSYSTEM_CHROME_PATH
    || (process.platform === "darwin" && "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const browser = await chromium.launch({ headless: true, ...(systemChrome && existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const result = await page.evaluate(async (moduleUrl) => {
    const { renderStudioMarkdown } = await import(moduleUrl);
    return renderStudioMarkdown(`| Name | Status |\n| --- | --- |\n| alpha | ready |\n\n<script>alert(1)</script>\n\n[run](javascript:alert(1))`);
  }, dataUrl);

  assert.match(result, /<table>/);
  assert.match(result, /<td>alpha<\/td>/);
  assert.doesNotMatch(result, /<script|javascript:/i);
});

test("role status has an independent header region so it cannot reflow the role name", () => {
  const markup = tools.roleCardMarkup({
    event: { roleId: "judge", status: "working" },
    roleName: "中立裁判",
    statusLabel: "正在处理任务",
    auditMarkup: ""
  });
  assert.match(markup, /class="team-debug-role"><strong class="team-debug-sender-name"[^>]*>中立裁判<\/strong><\/div><div class="team-debug-header-meta"><span class="team-debug-time-status">正在处理任务<\/span>/);
});

test("smart scroll only shows new-message notices for unread messages and changes after first use", () => {
  const listeners = {};
  const list = {
    dataset: {},
    scrollHeight: 1200,
    scrollTop: 0,
    clientHeight: 300,
    addEventListener(name, handler) { listeners[name] = handler; },
    scrollTo({ top }) { this.scrollTop = top; }
  };
  const button = {
    hidden: true,
    textContent: "",
    addEventListener(name, handler) { listeners[`button:${name}`] = handler; }
  };
  const panel = { querySelector(selector) { return selector === ".team-debug-transcript" ? list : button; } };
  const controller = tools.bindTranscriptSmartScroll(panel);

  listeners.scroll();
  assert.equal(button.hidden, true);
  controller.showPendingMessages();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "↓ 有新消息");
  listeners["button:click"]();
  assert.equal(button.hidden, true);
  assert.equal(button.textContent, "↓ 移动到底部");

  list.scrollTop = 0;
  listeners.scroll();
  assert.equal(button.hidden, true);
  controller.showPendingMessages();
  assert.equal(button.hidden, false);
  assert.equal(button.textContent, "↓ 移动到底部");
});
