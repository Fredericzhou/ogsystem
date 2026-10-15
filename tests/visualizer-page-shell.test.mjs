import test from "node:test";
import assert from "node:assert/strict";

import { renderPageHtml } from "../dist/visualizer/page-shell.js";
import { renderPageShellStyles } from "../dist/visualizer/page-shell-styles.js";

const REQUIRED_ELEMENT_IDS = [
  "run-list",
  "search",
  "flash",
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
  "operate-empty-state",
  "run-graph-disclosure",
  "project-wizard",
  "stats",
  "timeline",
  "graph-view",
  "state",
  "reviews",
  "review-detail",
  "review-detail-disclosure",
  "resume-diagnostics-disclosure",
  "ops-summary",
  "binding-explain",
  "role-packages",
  "contract-explain",
  "logs",
  "detail",
  "locale-select",
  "project-name",
  "global-status-context",
  "global-status-diagnostics"
];

test("page shell keeps HTML, style, assets, and client script mounted", () => {
  const html = renderPageHtml("/tmp/<demo>&project", "/api/v1", { locale: "zh-CN" });
  const styles = renderPageShellStyles();
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<html lang="zh-CN" data-visualizer-theme="light">/);
  assert.match(html, /data-visualizer-theme="light"/);
  assert.match(html, /ogs\.visualizer\.theme/);
  assert.match(html, /data-visualizer-theme-toggle/);
  assert.match(html, /data-theme-icon="moon"/);
  assert.match(html, /data-theme-icon="sun"/);
  assert.match(html, /<title>OGS多智能体图编排系统<\/title>/);
  assert.match(html, /<link rel="icon" href="data:," \/>/);
  assert.match(html, /<style>\n/);
  assert.match(styles, /--surface-panel: var\(--panel\)/);
  assert.match(styles, /--surface-section: var\(--panel-soft\)/);
  assert.match(styles, /--surface-inset: var\(--panel-deep\)/);
  assert.match(styles, /\.visualizer-theme-toggle \{[\s\S]*?width: 36px;[\s\S]*?height: 36px;/);
  assert.match(styles, /select option \{[\s\S]*?color: #e5eefb;[\s\S]*?background-color: #0f172a/);
  assert.match(styles, /\.studio-system-settings > summary,[\s\S]*?\.studio-contract-editor > summary[\s\S]*?font-size: 13px;[\s\S]*?font-weight: 600/);
  assert.match(styles, /\.studio-system-settings \.field input,[\s\S]*?\.studio-system-settings \.field select[\s\S]*?min-height: 36px;[\s\S]*?font-size: 13px/);
  assert.match(styles, /\.studio-graph-island input\[type="checkbox"\][\s\S]*?width: 16px;[\s\S]*?height: 16px;[\s\S]*?accent-color: #38bdf8/);
  assert.match(styles, /\.card \{[\s\S]*?background: var\(--surface-panel\)/);
  assert.match(styles, /\.event \{[\s\S]*?background: var\(--surface-section\)/);
  assert.match(html, /<body>/);
  assert.match(html, /<script src="\/assets\/studio-graph\.js"><\/script>/);
  assert.match(html, /window\.__OGS_VISUALIZER_BOOTSTRAP__ = /);
  assert.match(html, /"apiPrefix":"\/api\/v1"/);
  assert.match(html, /<script src="\/assets\/client-app\.js"><\/script>/);
  assert.match(html, /\/tmp\/&lt;demo&gt;&amp;project/);
  assert.match(html, /<option value="zh-CN" selected>中文<\/option>/);

  for (const id of REQUIRED_ELEMENT_IDS) {
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }

  assert.match(html, /<div class="shell content">[\s\S]*<aside id="sidebar" class="sidebar">/);
  assert.match(html, /<header class="top-nav">[\s\S]*id="console-tabs"/);
  assert.match(html, /class="top-nav-center"[\s\S]*id="console-tabs"[\s\S]*class="top-nav-actions"[\s\S]*class="hero-utilities top-nav-utilities"/);
  assert.match(html, /<main class="main-stage">[\s\S]*id="workbench-body"/);
  assert.match(html, /<header class="top-nav">[\s\S]*id="workdir"/);
  assert.match(html, /<span id="workdir" hidden>/);
  assert.match(styles, /#workdir\[hidden\] \{[\s\S]*?display: none/);
  assert.doesNotMatch(html, /id="copy-workdir"/);
  assert.doesNotMatch(html, /id="open-workdir"/);
  assert.match(html, /class="workbench-state-cache" hidden[\s\S]*id="workbench-title"[\s\S]*id="workbench-meta"[\s\S]*id="workbench-tabs"[\s\S]*id="workbench-actions"/);
  assert.match(html, /<footer class="status-bar global-status">[\s\S]*id="global-status-context"[\s\S]*id="global-status-diagnostics"[\s\S]*id="workbench-status"[\s\S]*id="live"/);
  assert.match(html, /<aside id="sidebar" class="sidebar">[\s\S]*id="run-list"/);
  assert.doesNotMatch(html, /class="brand"/);
  assert.match(html, /id="search"[^>]*aria-label="按 id、状态、角色筛选运行\.\.\."/);
  assert.match(html, /id="sidebar-toggle"[^>]*aria-controls="sidebar"[^>]*aria-expanded="false"/);
  assert.match(html, /id="hero-validate"/);
  assert.match(html, /id="hero-save"/);
  assert.match(html, /id="hero-reindex"/);
  assert.match(html, /id="hero-release-export"/);
  assert.match(html, /id="console-panel-project"[^>]*aria-labelledby="console-tab-project"/);
  assert.match(html, /id="console-panel-build"[^>]*aria-labelledby="console-tab-design"/);
  assert.match(html, /id="console-panel-validate-release"[^>]*aria-labelledby="console-tab-release"/);
  assert.match(html, /id="operate-tabs"[^>]*role="tablist"[^>]*aria-label="运行视图"/);
  assert.match(html, /id="operate-tabpanel-overview"[^>]*role="tabpanel"[^>]*aria-labelledby="operate-tab-overview"/);
  assert.match(styles, /body\.show-operate-workspace:not\(\.has-selected-run\) \.operate-overview/);
  assert.match(html, /id="run-graph-disclosure" class="run-graph-disclosure"/);
  assert.match(html, /id="console-panel-ops"[\s\S]*id="console-panel-debug"/);
  assert.match(html, /id="failure-detail-disclosure" class="run-event-details"[\s\S]*id="failure-detail"/);
  assert.match(html, /id="failure-next-checks-disclosure" class="run-event-details"[\s\S]*id="failure-next-checks"/);
  assert.match(html, /class="operate-evidence-disclosure"/);
  assert.match(html, /class="debug-graph-body operate-graph-shell"/);
  assert.match(html, /class="operate-graph-main"[\s\S]*id="graph-view"/);
  assert.match(html, /class="operate-graph-sidebar"[\s\S]*id="state"/);
  assert.match(html, /id="console-panel-logs"[^>]*role="tabpanel"[^>]*aria-labelledby="operate-tab-logs"/);
  assert.match(html, /id="timeline-type"[^>]*aria-label="事件类型"/);
  assert.match(html, /id="timeline-branch"[^>]*aria-label="分支 id"/);
  assert.match(html, /id="timeline-review"[^>]*aria-label="评审 id"/);
  assert.match(html, /id="timeline-error"[^>]*aria-label="错误码"/);
  assert.match(html, /id="log-tail"[^>]*aria-label="尾部"/);
  assert.match(html, /id="log-since"[^>]*aria-label="[^"]+"/);
  assert.match(html, /id="log-page-size"[^>]*aria-label="[^"]+"/);
  assert.match(html, /id="logs-all"[^>]*aria-label="[^"]+"/);
  assert.doesNotMatch(html, /aria-label="Log (page size|scope|since)"/);
});

test("page shell keeps local directory permission in bootstrap without showing the path in the header", () => {
  const localHtml = renderPageHtml("/tmp/demo", "/api/v1", { allowLocalDirectoryOpen: true });
  const remoteHtml = renderPageHtml("/tmp/demo", "/api/v1");
  assert.match(localHtml, /<span id="workdir" hidden>/);
  assert.doesNotMatch(localHtml, /class="workdir-pill"/);
  assert.match(remoteHtml, /<span id="workdir" hidden>/);
  assert.doesNotMatch(remoteHtml, /class="workdir-pill"/);
  assert.match(localHtml, /"allowLocalDirectoryOpen":true/);
  assert.match(remoteHtml, /"allowLocalDirectoryOpen":false/);
});

test("page shell styles are isolated behind a CSS renderer", () => {
  const css = renderPageShellStyles();
  assert.match(css, /\.app\s*\{/);
  assert.match(css, /\.top-nav\s*\{/);
  assert.match(css, /\.top-nav-center\s*\{/);
  assert.match(css, /\.main-stage\s*\{/);
  assert.match(css, /\.status-bar\s*\{/);
  assert.match(css, /\.sidebar\s*\{/);
  assert.match(css, /\.shell\.content > \.sidebar/);
  assert.match(css, /\.disclosure-summary\s*\{/);
  assert.match(css, /\.operate-graph-main,\s*\n\s*\.operate-graph-sidebar/);
  assert.match(css, /\.debug-graph-body\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /#action-form-section\s*\{[\s\S]*position:\s*fixed/);
  assert.match(css, /#action-form-section\[hidden\]\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.studio-selection-command-host \.studio-command-dialog\s*\{[\s\S]*position:\s*absolute/);
  assert.match(css, /\.studio-role-io-dialog\s*\{[\s\S]*width:\s*min\(760px/);
  assert.match(css, /\.console-panel\[hidden\]\s*\{/);
  assert.match(css, /--control-height:\s*36px/);
  assert.match(css, /:root\[data-visualizer-theme="light"\]/);
  assert.match(css, /\.button:focus-visible,[\s\S]*?\.select:focus-visible/);
  assert.match(css, /select\.select,[\s\S]*?\.studio-graph-toolbar select,[\s\S]*?\.studio-bridge-index-controls > select\s*\{[\s\S]*?appearance:\s*none;[\s\S]*?background-image:/);
  assert.match(css, /scrollbar-gutter:\s*stable both-edges/);
  assert.match(css, /\.studio-icon-button,[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px/);
  assert.match(css, /\.stat\s*\{[\s\S]*?justify-items:\s*center;[\s\S]*?text-align:\s*center/);
  assert.match(css, /\.button:hover\s*\{[\s\S]*?border-color:[\s\S]*?background:/);
  assert.match(css, /@media \(max-width: 960px\)/);
});
