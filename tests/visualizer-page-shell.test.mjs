import test from "node:test";
import assert from "node:assert/strict";

import { renderPageHtml } from "../dist/visualizer/page-shell.js";
import { renderPageShellStyles } from "../dist/visualizer/page-shell-styles.js";

const REQUIRED_ELEMENT_IDS = [
  "run-list",
  "search",
  "flash",
  "selected-title",
  "selected-subtitle",
  "action-form-section",
  "action-form",
  "console-tabs",
  "console-panel-project",
  "console-panel-build",
  "console-panel-debug",
  "console-panel-ops",
  "console-panel-validate-release",
  "release-gate",
  "workbench-body",
  "operate-tabs",
  "project-summary",
  "project-wizard",
  "project-readiness",
  "stats",
  "timeline",
  "graph-view",
  "state",
  "reviews",
  "review-detail",
  "ops-summary",
  "binding-explain",
  "role-packages",
  "contract-explain",
  "logs",
  "detail",
  "locale-select"
];

test("page shell keeps HTML, style, assets, and client script mounted", () => {
  const html = renderPageHtml("/tmp/<demo>&project", "/api/v1", { locale: "zh-CN" });
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<style>\n/);
  assert.match(html, /<body>/);
  assert.match(html, /<script src="\/assets\/studio-graph\.js"><\/script>/);
  assert.match(html, /const API_PREFIX = "\/api\/v1";/);
  assert.match(html, /\/tmp\/&lt;demo&gt;&amp;project/);
  assert.match(html, /<option value="zh-CN" selected>中文<\/option>/);

  for (const id of REQUIRED_ELEMENT_IDS) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.match(html, /<div class="shell content">/);
  assert.match(html, /<header class="top-nav">[\s\S]*id="console-tabs"/);
  assert.match(html, /<main class="main-stage">[\s\S]*id="workbench-body"/);
  assert.match(html, /<footer class="status-bar global-status">[\s\S]*id="workdir"[\s\S]*id="live"/);
  assert.match(html, /<aside id="sidebar" class="sidebar">[\s\S]*id="run-list"/);
  assert.match(html, /id="search"[^>]*aria-label="按 id、状态、角色筛选运行\.\.\."/);
  assert.match(html, /id="sidebar-toggle"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
  assert.match(html, /id="console-panel-project"[^>]*role="tabpanel"[^>]*aria-labelledby="console-tab-project"/);
  assert.match(html, /id="operate-tabs"[^>]*role="tablist"[^>]*aria-label="Operate views"/);
  assert.match(html, /id="operate-tabpanel-overview"[^>]*role="tabpanel"[^>]*aria-labelledby="operate-tab-overview"/);
  assert.match(html, /id="console-panel-logs"[^>]*role="tabpanel"[^>]*aria-labelledby="operate-tab-logs"/);
  assert.match(html, /id="timeline-type"[^>]*aria-label="事件类型"/);
  assert.match(html, /id="timeline-branch"[^>]*aria-label="分支 id"/);
  assert.match(html, /id="timeline-review"[^>]*aria-label="评审 id"/);
  assert.match(html, /id="timeline-error"[^>]*aria-label="错误码"/);
  assert.match(html, /id="log-tail"[^>]*aria-label="尾部"/);
  assert.match(html, /id="log-since"[^>]*aria-label="Log since"/);
});

test("page shell styles are isolated behind a CSS renderer", () => {
  const css = renderPageShellStyles();
  assert.match(css, /\.app\s*\{/);
  assert.match(css, /\.top-nav\s*\{/);
  assert.match(css, /\.main-stage\s*\{/);
  assert.match(css, /\.status-bar\s*\{/);
  assert.match(css, /\.sidebar\s*\{/);
  assert.match(css, /\.console-panel\[hidden\]\s*\{/);
  assert.match(css, /@media \(max-width: 960px\)/);
});
