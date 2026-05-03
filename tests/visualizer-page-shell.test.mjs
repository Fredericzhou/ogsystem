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
});

test("page shell styles are isolated behind a CSS renderer", () => {
  const css = renderPageShellStyles();
  assert.match(css, /\.app\s*\{/);
  assert.match(css, /\.sidebar\s*\{/);
  assert.match(css, /\.console-panel\[hidden\]\s*\{/);
  assert.match(css, /@media \(max-width: 960px\)/);
});
