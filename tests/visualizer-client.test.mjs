import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  appendIndexedStreamEntry,
  appendStreamEntry,
  buildClientAppScript,
  createStreamCursorIndex,
  buildReleaseReadinessDecision,
  buildRouteSearch,
  formatReviewStatusLabel,
  getStreamRefreshPlan,
  normalizeLifecycleView,
  readRouteStateFromSearch
} from "../dist/visualizer/client-app.js";
import {
  filterStudioBridgeItems,
  renderStudioBridgeInspector,
  renderStudioBridgePanel
} from "../dist/visualizer/client-renderers.js";
import { authoringToCanvasDocument } from "../dist/visualizer/studio-authoring.js";

const PAGE_ELEMENT_IDS = [
  "run-list",
  "search",
  "flash",
  "action-form-section",
  "action-form",
  "console-tabs",
  "console-panel-debug",
  "console-panel-project",
  "console-panel-build",
  "console-panel-ops",
  "console-panel-config",
  "console-panel-logs",
  "console-panel-artifacts",
  "console-panel-validate-release",
  "release-gate",
  "release-export",
  "workdir",
  "workbench-meta",
  "workbench-status",
  "workbench-actions",
  "workbench-tabs",
  "workbench-body",
  "operate-tabs",
  "operate-tabpanel-overview",
  "operate-tabpanel-graph",
  "operate-tabpanel-recovery",
  "operate-tabpanel-reviews",
  "project-wizard",
  "ops-summary",
  "stats",
  "failure-controls",
  "failure-summary",
  "failure-detail",
  "failure-next-checks",
  "timeline",
  "timeline-role",
  "timeline-type",
  "timeline-status",
  "timeline-branch",
  "timeline-review",
  "timeline-error",
  "timeline-apply",
  "timeline-clear",
  "graph-view",
  "state",
  "reviews",
  "review-actions",
  "review-detail",
  "binding-explain",
  "role-packages",
  "contract-explain",
  "resume-readiness",
  "resume-diagnostics",
  "resume-controls",
  "logs-controls",
  "logs-filters",
  "logs",
  "detail",
  "live",
  "global-status-context",
  "global-status-diagnostics",
  "log-role",
  "log-page-size",
  "log-tail",
  "log-since",
  "sidebar",
  "sidebar-overlay",
  "sidebar-toggle",
  "hero-reindex",
  "resume-run",
  "stop-run",
  "refresh",
  "locale-select"
];

const PAGE_ELEMENT_ATTRIBUTES = {
  "action-form-section": {
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "action-form-title"
  },
  "sidebar-toggle": {
    "aria-controls": "sidebar",
    "aria-expanded": "false"
  }
};

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function findWorkbenchViewButton(harness, view) {
  const scope = harness.document.getElementById("global-status-context") ?? harness.document;
  const matches = scope
    .querySelectorAll(`[data-workbench-view="${view}"]`)
    .filter((button) => button.getAttribute("data-workbench-view") === view);
  return matches.findLast((button) => (button.listeners?.get("click")?.length ?? 0) > 0)
    ?? matches.at(-1)
    ?? null;
}

function findStudioSideTabButton(harness, tab) {
  const matches = harness.document.getElementById("workbench-body")
    .querySelectorAll(`[data-studio-side-tab="${tab}"]`)
    .filter((button) => button.getAttribute("data-studio-side-tab") === tab);
  return matches.findLast((button) => (button.listeners?.get("click")?.length ?? 0) > 0)
    ?? matches.at(-1)
    ?? null;
}

function findWorkbenchStartRunButton(harness) {
  return harness.document.getElementById("workbench-body")
    .querySelectorAll("button")
    .find((button) => button.id === "workbench-start-run" || /Start dry run|开始试运行/.test(button.textContent || "")) ?? null;
}

async function openDesignTab(harness) {
  const designTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  assert.ok(designTab);
  if (designTab.getAttribute("aria-pressed") === "true") {
    await settle();
    return;
  }
  await designTab.click();
  await settle();
}

function parseAttributes(source) {
  const attributes = {};
  const matcher = /([a-zA-Z0-9:-]+)=("([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(matcher)) {
    attributes[match[1]] = match[3] ?? match[4] ?? "";
  }
  for (const booleanName of ["checked", "disabled", "selected", "readonly"]) {
    if (new RegExp(`(^|\\s)${booleanName}(\\s|$)`).test(source)) {
      attributes[booleanName] = "";
    }
  }
  return attributes;
}

function testTranslator(_key, vars, fallback) {
  let text = fallback ?? _key;
  for (const [key, value] of Object.entries(vars || {})) {
    text = text.replaceAll(`{${key}}`, String(value));
  }
  return text;
}

test("visualizer client script injects the execution config editor renderer", () => {
  const script = buildClientAppScript("/api/v1");
  assert.match(script, /const renderStudioExecutionConfigEditor = /);
  assert.match(script, /const asRecordCollection = /);
});

test("Studio Bridge renderers display and filter flow labels separately from event types", () => {
  const bridge = {
    validation: { ok: true, diagnostics: [] },
    extracted: {
      systemId: "demo.system",
      systemVersion: "1.0.0",
      entryRoleId: "requirements_analyst",
      lawGlobal: "law.minimal",
      roles: [
        {
          roleId: "requirements_analyst",
          title: "需求分析",
          bindingKind: "model",
          incomingFlowCount: 0,
          outgoingFlowCount: 1,
          allowedEvents: ["REQUIREMENTS_READY"],
          badges: ["entry"]
        },
        {
          roleId: "reviewer",
          bindingKind: "noop",
          incomingFlowCount: 1,
          outgoingFlowCount: 0,
          allowedEvents: [],
          badges: []
        }
      ],
      flows: [{
        flowId: "1:requirements_analyst:REQUIREMENTS_READY:reviewer",
        flowKey: "requirements_analyst:REQUIREMENTS_READY:reviewer",
        fromRoleId: "requirements_analyst",
        toRoleId: "reviewer",
        eventType: "REQUIREMENTS_READY",
        label: "需求已完成",
        runtimeOnlyErrorFlow: false,
        participatesInJoin: false
      }]
    }
  };

  const filtered = filterStudioBridgeItems({
    roles: bridge.extracted.roles,
    flows: bridge.extracted.flows,
    filter: "需求已完成",
    mode: "flows"
  });
  assert.equal(filtered.flows.length, 1);
  assert.equal(filtered.flows[0].eventType, "REQUIREMENTS_READY");

  const inspectorHtml = renderStudioBridgeInspector({
    bridge,
    selectedRoleId: "",
    selectedFlowKey: "requirements_analyst:REQUIREMENTS_READY:reviewer",
    t: testTranslator
  });
  assert.match(inspectorHtml, /需求已完成/);
  assert.match(inspectorHtml, /REQUIREMENTS_READY/);

  const panelHtml = renderStudioBridgePanel({
    bridge,
    readiness: {},
    selectedRoleId: "",
    selectedFlowKey: "requirements_analyst:REQUIREMENTS_READY:reviewer",
    filter: "需求已完成",
    listMode: "flows",
    actionBusy: "",
    t: testTranslator
  });
  assert.match(panelHtml, /需求已完成/);
  assert.match(panelHtml, /REQUIREMENTS_READY/);
});

test("Studio Bridge panel prioritizes selected flow configuration over fallback role content", () => {
  const bridge = {
    authoring: {
      roles: {
        "demo-analyst": { roleId: "demo-analyst" },
        reviewer: { roleId: "reviewer" }
      }
    },
    extracted: {
      roles: [
        {
          roleId: "demo-analyst",
          title: "Demo analyst",
          bindingKind: "model",
          incomingFlowCount: 0,
          outgoingFlowCount: 1,
          allowedEvents: ["DONE"],
          badges: []
        },
        {
          roleId: "reviewer",
          title: "Reviewer",
          bindingKind: "noop",
          incomingFlowCount: 1,
          outgoingFlowCount: 0,
          allowedEvents: [],
          badges: []
        }
      ],
      flows: [{
        flowId: "1:demo-analyst:DONE:output",
        flowKey: "demo-analyst:DONE:output",
        fromRoleId: "demo-analyst",
        toRoleId: "output",
        eventType: "DONE",
        label: "Done",
        runtimeOnlyErrorFlow: false,
        participatesInJoin: false
      }]
    }
  };
  const panelHtml = renderStudioBridgePanel({
    bridge,
    readiness: null,
    selectedRoleId: "",
    selectedFlowKey: "demo-analyst:DONE:output",
    workbenchView: "bridge",
    graphRootContentHtml: "",
    filter: "",
    listMode: "all",
    sideTab: "selection",
    selectionDebugHtml: "",
    selectionResultsHtml: "",
    rolePackageEditor: null,
    executionConfigEditor: null,
    flowConfigEditor: {
      flowKey: "demo-analyst:DONE:output",
      data: {
        sourceRoleId: "demo-analyst",
        targetRoleId: "output",
        eventType: "DONE",
        label: "Done",
        runtimeOnlyErrorFlow: false,
        participatesInJoin: false
      }
    },
    inspectorCollapsed: false,
    actionBusy: "",
    t: testTranslator
  });
  assert.match(panelHtml, /flow config/i);
  assert.match(panelHtml, /data-flow-config-save/);
  assert.doesNotMatch(panelHtml, /data-role-package-load/);
});

function matchesSelector(element, selector) {
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(selector)) {
    return element.tagName.toLowerCase() === selector.toLowerCase();
  }
  const classSelector = selector.match(/^\.([a-zA-Z0-9_-]+)$/);
  if (classSelector) {
    const className = classSelector[1];
    return String(element.attributes.class ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .includes(className);
  }
  const attributeSelector = selector.match(/^\[([a-zA-Z0-9:-]+)(?:="([^"]*)")?\]$/);
  if (attributeSelector) {
    const [, name, value] = attributeSelector;
    if (!Object.hasOwn(element.attributes, name)) {
      return false;
    }
    return value === undefined || element.attributes[name] === value;
  }
  if (selector === "[data-run-id]") {
    return Object.hasOwn(element.attributes, "data-run-id");
  }
  if (selector === "[data-review-id]") {
    return Object.hasOwn(element.attributes, "data-review-id");
  }
  if (selector === "[data-review-action]") {
    return Object.hasOwn(element.attributes, "data-review-action");
  }
  if (selector === "[data-console-tab]") {
    return Object.hasOwn(element.attributes, "data-console-tab");
  }
  if (selector === "[data-project-menu-tab]") {
    return Object.hasOwn(element.attributes, "data-project-menu-tab");
  }
  if (selector === "[data-project-open-recent]") {
    return Object.hasOwn(element.attributes, "data-project-open-recent");
  }
  if (selector === "[data-project-open-browse]") {
    return Object.hasOwn(element.attributes, "data-project-open-browse");
  }
  if (selector === "[data-project-open-project]") {
    return Object.hasOwn(element.attributes, "data-project-open-project");
  }
  if (selector === "[data-studio-role-id]") {
    return Object.hasOwn(element.attributes, "data-studio-role-id");
  }
  if (selector === "[data-studio-flow-key]") {
    return Object.hasOwn(element.attributes, "data-studio-flow-key");
  }
  if (selector === "[data-studio-bridge-filter]") {
    return Object.hasOwn(element.attributes, "data-studio-bridge-filter");
  }
  if (selector === "[data-studio-bridge-list-mode]") {
    return Object.hasOwn(element.attributes, "data-studio-bridge-list-mode");
  }
  if (selector === "[data-studio-bridge-fullscreen]") {
    return Object.hasOwn(element.attributes, "data-studio-bridge-fullscreen");
  }
  if (selector === "[data-workbench-view]") {
    return Object.hasOwn(element.attributes, "data-workbench-view");
  }
  if (selector === "[data-workbench-view=\"source\"]") {
    return element.attributes["data-workbench-view"] === "source";
  }
  if (selector === "[data-workbench-view=\"bridge\"]") {
    return element.attributes["data-workbench-view"] === "bridge";
  }
  return false;
}

function matchesSelectorPath(element, selector) {
  const parts = String(selector).split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return false;
  }
  let current = element;
  if (!matchesSelector(current, parts[parts.length - 1])) {
    return false;
  }
  for (let index = parts.length - 2; index >= 0; index -= 1) {
    const target = parts[index];
    current = current?.parent ?? null;
    while (current && !matchesSelector(current, target)) {
      current = current.parent ?? null;
    }
    if (!current) {
      return false;
    }
  }
  return true;
}

const VOID_TAG_NAMES = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

class FakeElement {
  constructor(document, id = "", tagName = "div", attributes = {}, dynamic = false) {
    this.document = document;
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.dynamic = dynamic;
    this.listeners = new Map();
    this.children = [];
    this.parent = null;
    this._innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(String(this.attributes.class ?? "").split(/\s+/).filter(Boolean));
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        this.attributes.class = Array.from(classes).join(" ");
      }
    };
    this.dataset = {};
    this.disabled = Object.hasOwn(attributes, "disabled");
    this.hidden = Object.hasOwn(attributes, "hidden");
    this.value = attributes.value ?? "";
    this.focused = false;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type) {
    const event = {
      target: this,
      defaultPrevented: false,
      propagationStopped: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.propagationStopped = true;
      }
    };
    let current = this;
    const visited = new Set();
    while (current && !visited.has(current)) {
      visited.add(current);
      const handlers = [...(current.listeners?.get(type) ?? [])];
      for (const handler of handlers) {
        await handler(event);
        if (event.propagationStopped) {
          return;
        }
      }
      current = current.parent ?? null;
    }
  }

  async click() {
    await this.dispatch("click");
  }

  async change(value) {
    this.value = value;
    this.attributes.value = value;
    await this.dispatch("change");
  }

  async input(value) {
    this.value = value;
    this.attributes.value = value;
    await this.dispatch("input");
  }

  focus() {
    this.focused = true;
    this.document.activeElement = this;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  set innerHTML(value) {
    this.document.unregisterChildren(this.children);
    this._innerHTML = String(value);
    this.textContent = this._innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    this.children = this.document.parseChildren(this._innerHTML, this);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll(selector) {
    const selectors = String(selector).split(",").map((entry) => entry.trim()).filter(Boolean);
    const matches = [];
    const visit = (element) => {
      if (selectors.some((entry) => matchesSelectorPath(element, entry))) {
        matches.push(element);
      }
      for (const child of element.children || []) {
        visit(child);
      }
    };
    for (const child of this.children) {
      visit(child);
    }
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getBoundingClientRect() {
    if (this.hidden) {
      return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    }
    if (this.id === "studio-graph-root" || this.id === "run-graph-root") {
      return { width: 720, height: 420, top: 0, left: 0, right: 720, bottom: 420 };
    }
    if (String(this.attributes.class ?? "").includes("studio-selection-dialog")) {
      return { width: 320, height: 420, top: 0, left: 720, right: 1040, bottom: 420 };
    }
    return { width: 320, height: 180, top: 0, left: 0, right: 320, bottom: 180 };
  }

  replaceWith(next) {
    const parent = this.parent;
    if (parent?.children) {
      const index = parent.children.indexOf(this);
      if (index >= 0) {
        parent.children[index] = next;
        next.parent = parent;
      }
    }
    this.document.unregisterElement(this, { keepId: Boolean(next?.id && next.id === this.id) });
    this.document.unregisterChildren(this.children);
    if (next) {
      this.document.registerTree(next);
      if (next.parent && next.parent !== parent && Array.isArray(next.parent.children)) {
        for (const sibling of next.parent.children) {
          if (sibling.id) {
            this.document.elements.set(sibling.id, sibling);
          }
        }
      }
    }
  }

  insertAdjacentHTML(_position, html) {
    const source = String(html);
    if (
      source.includes('data-studio-bridge-region="chat"') &&
      this._innerHTML.includes('data-studio-bridge-region="chat"')
    ) {
      this.document.parseChildren(source, this);
      return;
    }
    const children = this.document.parseChildren(source, this);
    this.children.push(...children);
    this._innerHTML += source;
    this.textContent = this._innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

class FakeTemplateElement extends FakeElement {
  constructor(document) {
    super(document, "", "template", {}, true);
    this.content = {
      children: [],
      querySelector: (selector) => this.content.querySelectorAll(selector)[0] ?? null,
      querySelectorAll: (selector) => {
        const selectors = String(selector).split(",").map((entry) => entry.trim()).filter(Boolean);
        const matches = [];
        const visit = (element) => {
          if (selectors.some((entry) => matchesSelectorPath(element, entry))) {
            matches.push(element);
          }
          for (const child of element.children || []) {
            visit(child);
          }
        };
        for (const child of this.content.children) {
          visit(child);
        }
        return matches;
      }
    };
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.document.unregisterChildren(this.content.children);
    this.content.children = this.document.parseChildren(this._innerHTML, this.content, { register: false });
  }

  get innerHTML() {
    return this._innerHTML;
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.dynamicElements = new Set();
    this.listeners = new Map();
    this.activeElement = null;
    this.body = {
      classList: {
        classes: new Set(),
        toggle(name, enabled) {
          if (enabled) {
            this.classes.add(name);
          } else {
            this.classes.delete(name);
          }
        }
      }
    };
    for (const id of PAGE_ELEMENT_IDS) {
      this.elements.set(id, new FakeElement(this, id, "div", PAGE_ELEMENT_ATTRIBUTES[id] ?? {}));
    }
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  querySelectorAll(selector) {
    const selectors = String(selector).split(",").map((entry) => entry.trim()).filter(Boolean);
    const matches = [];
    const visited = new Set();
    const visit = (element) => {
      if (!element || visited.has(element)) {
        return;
      }
      visited.add(element);
      if (selectors.some((entry) => matchesSelectorPath(element, entry))) {
        matches.push(element);
      }
      for (const child of element.children || []) {
        visit(child);
      }
    };
    for (const element of this.elements.values()) {
      visit(element);
    }
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  unregisterElement(element, options = {}) {
    this.dynamicElements.delete(element);
    if (!options.keepId && element.dynamic && element.id && this.elements.get(element.id) === element) {
      this.elements.delete(element.id);
    }
  }

  unregisterChildren(children) {
    for (const child of children) {
      this.unregisterChildren(child.children);
      this.unregisterElement(child);
    }
  }

  registerTree(element) {
    this.dynamicElements.add(element);
    if (element.id) {
      this.elements.set(element.id, element);
    }
    for (const child of element.children) {
      this.registerTree(child);
    }
  }

  parseChildren(html, parent = null, options = {}) {
    const register = options.register !== false;
    const children = [];
    const root = { children };
    const stack = [root];
    const matcher = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)([^>]*)>/g;
    let cursor = 0;
    const appendText = (raw) => {
      const normalized = String(raw ?? "").replace(/\s+/g, " ").trim();
      if (!normalized) {
        return;
      }
      for (const node of stack) {
        if (!node || typeof node.textContent !== "string") {
          continue;
        }
        node.textContent = node.textContent
          ? `${node.textContent} ${normalized}`
          : normalized;
      }
    };
    const registerElement = (element) => {
      if (!register) {
        return;
      }
      this.dynamicElements.add(element);
      if (element.id) {
        this.elements.set(element.id, element);
      }
    };
    for (const match of html.matchAll(matcher)) {
      appendText(html.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      const isClosing = match[0].startsWith("</");
      const tagName = String(match[1] ?? "").toLowerCase();
      if (!tagName) {
        continue;
      }
      if (isClosing) {
        const expectedTagName = tagName.toUpperCase();
        for (let index = stack.length - 1; index > 0; index -= 1) {
          if (stack[index]?.tagName === expectedTagName) {
            if (expectedTagName === "TEXTAREA" && typeof stack[index].value === "string" && !stack[index].value) {
              stack[index].value = stack[index].textContent;
            }
            stack.length = index;
            break;
          }
        }
        continue;
      }
      const attributes = parseAttributes(match[2] ?? "");
      const id = attributes.id ?? "";
      const element = new FakeElement(this, id, tagName, attributes, true);
      const container = stack[stack.length - 1];
      element.parent = container === root ? parent : container;
      container.children.push(element);
      registerElement(element);
      const selfClosing = VOID_TAG_NAMES.has(tagName) || /\/\s*>$/.test(match[0]);
      if (!selfClosing) {
        stack.push(element);
      }
    }
    appendText(html.slice(cursor));
    return children;
  }

  createElement(tagName) {
    if (String(tagName).toLowerCase() === "template") {
      return new FakeTemplateElement(this);
    }
    return new FakeElement(this, "", tagName, {}, true);
  }
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  emit(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function createResponse(payload, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null;
      }
    },
    async json() {
      return cloneJson(payload);
    },
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    }
  };
}

function createDeferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise
  };
}

function createRejectableDeferred() {
  let resolvePromise;
  let rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise
  };
}

function buildRunFixture({
  runId,
  reviewId,
  runStatus = "stopped",
  decisionPhase,
  roleId = "demo-analyst",
  branchId = "demo-analyst@1#1",
  reviewStatus = "pending",
  failureCode = "TOOL_EXECUTION_TIMEOUT",
  failureMessage = "Command timeout after 120000ms (timeout)",
  failureStage = "execute",
  failureCategory = "timeout budget exhausted",
  timeoutMs = 120000,
  durationMs = 120229,
  bindingSource = "system.mmd",
  resolvedBinding = "opencode/gpt-5-nano",
  readinessStatus = "blocked",
  canResume = false,
  readinessReason = "Review decision is recorded but not applied.",
  readinessBlockerKind = "review_not_applied",
  reviewComment = "ship it",
  errorEventCode = "E_DEMO"
}) {
  const review = {
    reviewId,
    currentStatus: reviewStatus,
    decisionPhase,
    roleId,
    branchId,
    branchStatus: reviewStatus === "pending" ? "waiting_review" : "paused",
    round: 1,
    requestedAt: "2026-04-23T09:15:00.000Z",
    decision: decisionPhase ? "approve" : undefined,
    actor: decisionPhase ? "qa" : undefined,
    comment: decisionPhase ? reviewComment : undefined,
    scope: "branch",
    reworkTarget: "answer-engineer",
    decidedAt: decisionPhase ? "2026-04-23T09:15:01.000Z" : undefined,
    committedAt: decisionPhase ? "2026-04-23T09:15:01.000Z" : undefined,
    checkpointSequence: decisionPhase === "pending_reconcile" || decisionPhase === "applied" ? 7 : undefined,
    appliedAt:
      decisionPhase === "pending_reconcile" || decisionPhase === "applied"
        ? "2026-04-23T09:15:02.000Z"
        : undefined,
    reconciledAt: decisionPhase === "applied" ? "2026-04-23T09:15:03.000Z" : undefined
  };
  return {
    runId,
    reviewId,
    review,
    reviewDetail: {
      ...cloneJson(review),
      runId,
      runDir: `/tmp/${runId}`,
      executionId: `exec-${runId}`,
      requestedByExecutionId: `exec-${runId}`,
      selectedEvent: "DONE",
      spec: { terminateScope: "branch" },
      history: [],
      reviewRequestSnapshot: {
        selectedEvent: "DONE",
        scope: "branch",
        roleId,
        branchId
      },
      decisionSnapshot: {
        decision: review.decision ?? null,
        actor: review.actor ?? null,
        comment: review.comment ?? null,
        decisionPhase: review.decisionPhase ?? null
      },
      humanReviewContext: { comment: reviewComment }
    },
    detail: {
      runId,
      runDir: `/tmp/${runId}`,
      header: {
        runId,
        runDir: `/tmp/${runId}`,
        status: runStatus,
        transitionCount: 1,
        finalRoleId: "",
        lastExecutedRoleId: roleId,
        updatedAt: "2026-04-23T09:15:01.000Z",
        activeBranches: 0,
        pendingReviewCount: 1,
        hasWaitingHumanReview: true,
        recentAudits: 1,
        systemSource: null,
        isSimulation: false,
        runMode: "runtime"
      },
      state: {
        status: runStatus,
        transitionCount: 1,
        totalTransitions: 3,
        noopCount: 1,
        loopIterations: { [roleId]: 2 },
        pendingReviewCount: 1,
        stopOutcome: null
      },
      metrics: {
        runId,
        systemId: "viz.review.demo",
        summary: {
          totalTransitions: 3,
          noopCount: 1
        }
      },
      resolvedConfig: null,
      stopRequest: null,
      stopOutcome: null,
      summary: null,
      systemSource: "flowchart TD",
      snapshotManifest: {
        manifestVersion: 1,
        snapshotId: runId,
        status: "ok",
        source: {
          systemPath: "system.mmd",
          runArtifactSystemPath: "system.mmd",
          sourceHash: "a".repeat(64)
        },
        artifactSemantics: {
          historicalTruth: "run-artifact-system.mmd"
        }
      }
    },
    graph: {
      simulation: { mode: "runtime" },
      graph: {
        systemId: "viz.review.demo",
        entryRoleId: roleId,
        roleCount: 2,
        flowCount: 1,
        nodes: [
          {
            roleId,
            nodeType: "role",
            status: "waiting_review",
            bindingKind: "model",
            activeBranchCount: 0,
            waitingReviewCount: 1,
            loopIteration: 1,
            lastErrorCode: failureCode,
            missingSources: []
          },
          {
            roleId: "qa",
            nodeType: "role",
            status: "idle",
            bindingKind: "profile",
            activeBranchCount: 0,
            waitingReviewCount: 0,
            pendingReviewCount: 0,
            loopIteration: 0,
            lastSelectedEvent: "DONE",
            missingSources: []
          }
        ],
        edges: [
          {
            sourceRoleId: roleId,
            targetRoleId: "qa",
            event: "DONE",
            isErrorFlow: false,
            recentlyActivated: true
          }
        ]
      }
    },
    failure: {
      summary: {
        errorCode: failureCode,
        errorCategory: failureCategory,
        message: failureMessage,
        stage: failureStage,
        roleId,
        branchId,
        retryable: true,
        durationMs
      },
      detail: {
        allowedEvents: ["DONE", "REWORK"],
        inputContext: { prompt: "draft answer", facts: ["law-1"] },
        rawOutput: { answer: "timed out response" },
        schemaPath: `og-roles/${roleId}/output.schema.json`,
        selectedBinding: {
          bindingKind: "model",
          declaredBinding: "model:gpt-5-nano",
          resolvedBinding,
          timeoutMs,
          maxOutputBytes: 16384,
          source: bindingSource
        },
        timeoutMs,
        upstreamRoleIds: ["legal-product-manager"],
        contract: {
          flowKey: `${roleId}->qa:DONE`,
          contractId: "flow.answer.done",
          kind: "flow",
          schemaPath: ".ogs/contracts/flow.answer.done.schema.json"
        }
      }
    },
    readiness: {
      status: readinessStatus,
      canResume,
      reason: readinessReason,
      blockers: [
        {
          kind: readinessBlockerKind,
          severity: "blocking",
          title: "Resume blocked until review lifecycle converges",
          detail: readinessReason
        }
      ],
      driftBySource: {
        contracts: [{ flowKey: `${roleId}->qa:DONE`, contractId: "flow.answer.done" }],
        modelSelection: [{ roleId, resolvedBinding }]
      }
    },
    diagnostics: {
      runId,
      runDir: `/tmp/${runId}`,
      status: "dirty",
      fingerprint: {},
      counts: {},
      checks: [
        {
          id: "review-decisions",
          label: "Review decisions",
          ok: false,
          severity: "warning",
          message: "1 unreconciled decision"
        }
      ],
      recommendations: [
        {
          action: "inspect-resume-readiness",
          label: "Review readiness blockers and drift sources before resume."
        }
      ]
    },
    events: [
      {
        cursor: 0,
        record: {
          type: "human_review_requested",
          at: "2026-04-23T09:15:00.000Z",
          reviewId,
          roleId,
          status: "pending",
          branchId
        }
      },
      {
        cursor: 1,
        record: {
          type: "runtime_error",
          at: "2026-04-23T09:15:30.000Z",
          roleId: "qa",
          errorCode: errorEventCode
        }
      }
    ],
    logMessage: `?run=${runId}`
  };
}

function createBackend(options = {}) {
  const runId = "run-123";
  const secondRunId = "run-456";
  const reviewId = "review-1";
  const decisionPhase = options.decisionPhase;
  const runStatus = options.runStatus ?? "stopped";
  const primaryRun = buildRunFixture({
    runId,
    reviewId,
    runStatus,
    decisionPhase
  });
  const secondaryRun = buildRunFixture({
    runId: secondRunId,
    reviewId: "review-2",
    runStatus: "failed",
    decisionPhase: "recorded",
    roleId: "citation-engineer",
    branchId: "citation-engineer@1#1",
    failureCode: "CONTRACT_VIOLATION",
    failureMessage: "Strict handoff contract missing for citation flow.",
    failureCategory: "contract handoff violation",
    timeoutMs: 90000,
    durationMs: 91234,
    resolvedBinding: "opencode/gpt-5-mini",
    readinessReason: "Contract drift detected against persisted checkpoint.",
    readinessBlockerKind: "fingerprint_drift",
    reviewComment: "needs contract repair",
    errorEventCode: "E_CONTRACT"
  });
  const runFixtures = new Map([[runId, primaryRun]]);
  if (options.includeSecondRun) {
    runFixtures.set(secondRunId, secondaryRun);
  }
  const backend = {
    runId,
    secondRunId,
    reviewId,
    review: cloneJson(primaryRun.review),
    lastReindexBody: null,
    reviewDetail: cloneJson(primaryRun.reviewDetail),
    lastDecisionBody: null,
    lastProjectCreateBody: null,
    lastRoleImportBody: null,
    lastRolePackageSaveBody: null,
    lastStudioChatBody: null,
    workspaceFailOnce: Boolean(options.workspaceFailOnce),
    decisionDeferred: options.decisionDeferred ?? null,
    fetchCalls: [],
    async handle(url, request = {}) {
      const parsed = new URL(url, "http://visualizer.test");
      const pathname = parsed.pathname;
      const method = request.method ?? "GET";
      this.fetchCalls.push({ method, path: `${pathname}${parsed.search}`, body: request.body ?? null });
      const getRunFixture = (requestedRunId) => runFixtures.get(requestedRunId) ?? null;
      const runMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
      const runEventsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
      const runGraphMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/graph$/);
      const runReviewsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/reviews$/);
      const runReviewDetailMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/reviews\/([^/]+)$/);
      const runReviewDecisionMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/reviews\/([^/]+)\/decide$/);
      const runResumeMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/resume$/);
      const runStopMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/stop$/);
      const runLogsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/logs$/);
      const runFailureMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/failure$/);
      const runReadinessMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/resume-readiness$/);
      const runDiagnosticsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/resume-diagnostics$/);
      if (pathname === "/api/v1/workspace") {
        if (this.workspaceFailOnce) {
          this.workspaceFailOnce = false;
          return createResponse({
            error: {
              code: "WORKSPACE_LOAD_FAILED",
              message: "Workspace unavailable."
            }
          }, 500, "Internal Server Error");
        }
        return createResponse(options.workspace ?? {
          workdir: "/tmp/demo",
          exists: true,
          isDirectory: true,
          hasProject: true,
          state: "project",
          entryCount: 2,
          canInitialize: false,
          controlledPathConflicts: []
        });
      }
      if (pathname === "/api/v1/project/create" && method === "POST") {
        this.lastProjectCreateBody = JSON.parse(request.body ?? "{}");
        if (options.projectCreateDeferred) {
          const deferredResponse = await options.projectCreateDeferred.promise;
          if (deferredResponse) {
            return deferredResponse;
          }
        }
        if (options.projectCreateError) {
          return createResponse(
            {
              error: {
                code: options.projectCreateError.code,
                message: options.projectCreateError.message,
                details: options.projectCreateError.details
              }
            },
            options.projectCreateError.status ?? 409,
            "Conflict"
          );
        }
        options.workspace = {
          workdir: "/tmp/demo",
          exists: true,
          isDirectory: true,
          hasProject: true,
          state: "project",
          entryCount: 2,
          canInitialize: false,
          controlledPathConflicts: []
        };
        return createResponse({
          workdir: "/tmp/demo",
          projectId: "empty-visual",
          projectName: this.lastProjectCreateBody.projectName,
          templateId: this.lastProjectCreateBody.templateId,
          draftState: "draft-unbound-unpublishable",
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/role-catalog") {
        return createResponse(options.roleCatalog ?? {
          source: "installed",
          roles: [
            {
              roleId: "demo-analyst",
              name: "Demo Analyst",
              source: "installed",
              health: { status: "ok", issues: [] },
              alreadyImported: false
            },
            {
              roleId: "qa-reviewer",
              name: "QA Reviewer",
              source: "installed",
              health: { status: "ok", issues: [] },
              alreadyImported: false
            }
          ]
        });
      }
      if (pathname === "/api/v1/project/roles/import" && method === "POST") {
        this.lastRoleImportBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          importedRoleIds: this.lastRoleImportBody.roleIds || [],
          skippedRoleIds: [],
          roleCatalog: { source: "installed", roles: [] }
        });
      }
      if (pathname === "/api/v1/project") {
        return createResponse({
          project: {
            projectName: "demo",
            projectId: "viz.project.demo",
            systemId: "viz.review.demo",
            systemVersion: "1.0.0",
            entryRoleId: "demo-analyst",
            roleCount: 1,
            roleIds: ["demo-analyst"],
            flowCount: 1,
            reviewedRoleIds: ["demo-analyst"],
            joinRoleIds: [],
            loopRoleIds: [],
            contextMappedRoleIds: [],
            runsDir: ".ogs/runs"
          },
          recentRuns: []
        });
      }
      if (pathname === "/api/v1/project/system") {
        return createResponse({ systemSource: "flowchart TD" });
      }
      if (pathname === "/api/v1/project/system/workbench") {
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          systemSource: "flowchart TD\n%% system.id=viz.review.demo\n%% system.version=1.0.0\n%% law.global=law.minimal.base\n%% entry.role=demo-analyst\ninput -->|GO| analyst[Role:demo-analyst]\nanalyst[Role:demo-analyst] -->|DONE| output\n",
          validation: {
            ok: true,
            diagnostics: [],
            structure: {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            }
          }
        });
      }
      if (pathname === "/api/v1/project/system/validate" && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        const valid = !String(body.systemSource || "").includes("INVALID");
        return createResponse({
          ok: valid,
          diagnostics: valid
            ? []
            : [{ code: "MERMAID_PARSE_FAILED", message: "bad line", severity: "error", stage: "parse", line: 2 }],
          structure: valid
            ? {
                systemId: "viz.review.demo",
                systemVersion: "1.0.0",
                entryRoleId: "demo-analyst",
                roleCount: 1,
                flowCount: 1,
                roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
                flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
              }
            : null
        });
      }
      if ((pathname === "/api/v1/project/system/save" || pathname === "/api/v1/project/system/save-as") && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        const valid = !String(body.systemSource || "").includes("INVALID");
        return createResponse({
          savedPath: body.saveAsPath ? `/tmp/demo/${body.saveAsPath}` : "/tmp/demo/system.mmd",
          validation: {
            ok: valid,
            diagnostics: valid
              ? []
              : [{ code: "MERMAID_PARSE_FAILED", message: "bad line", severity: "error", stage: "parse", line: 2 }],
            structure: valid ? {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            } : null
          },
          followUpActions: [{ action: "refresh-project-summary", label: "Reload project and graph views to reflect the saved system." }]
        });
      }
      if (pathname === "/api/v1/project/studio/bridge" && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        this.lastStudioBridgeBody = body;
        if (Array.isArray(options.studioBridgeResponses) && options.studioBridgeResponses.length) {
          return options.studioBridgeResponses.shift();
        }
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          systemSource: body.systemSource || "",
          validation: {
            ok: true,
            diagnostics: [],
            structure: {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            }
          },
          authoring: {
            version: 1,
            project: { workdir: "/tmp/demo", systemPath: "/tmp/demo/system.mmd" },
            system: {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              lawGlobalRef: "law.minimal.base"
            },
            roles: {
              "demo-analyst": {
                roleId: "demo-analyst",
                bindingKind: "model",
                modelRef: "opencode/gpt-5.4",
                review: { mode: "required", timeoutAction: "pause", reworkTargetRoleId: "demo-analyst", terminateScope: "branch" }
              }
            },
            flows: {
              "1:demo-analyst:DONE:output": {
                flowId: "1:demo-analyst:DONE:output",
                fromRoleId: "demo-analyst",
                toRoleId: "__system_end__",
                eventType: "DONE"
              }
            },
            layout: { nodes: { "demo-analyst": { x: 120, y: 120 } } }
          },
          extracted: {
            systemId: "viz.review.demo",
            systemVersion: "1.0.0",
            entryRoleId: "demo-analyst",
            lawGlobal: "law.minimal.base",
            roles: [{
              roleId: "demo-analyst",
              bindingKind: "model",
              modelRef: "opencode/gpt-5.4",
              review: { mode: "required" },
              incomingFlowCount: 0,
              outgoingFlowCount: 1,
              allowedEvents: ["DONE"],
              badges: ["entry", "M", "R"]
            }],
            flows: [{
              flowId: "1:demo-analyst:DONE:output",
              flowKey: "demo-analyst:DONE:output",
              fromRoleId: "demo-analyst",
              toRoleId: "__system_end__",
              eventType: "DONE",
              runtimeOnlyErrorFlow: false,
              participatesInJoin: false
            }]
          }
        });
      }
      if (pathname === "/api/v1/project/studio/chat" && method === "POST") {
        this.lastStudioChatBody = JSON.parse(request.body ?? "{}");
        if (options.studioChatDeferred) {
          return options.studioChatDeferred.promise;
        }
        if (options.studioChatError) {
          return createResponse({
            error: {
              code: options.studioChatError.code ?? "STUDIO_CHAT_NL2MMD_UNAVAILABLE",
              message: options.studioChatError.message ?? "Studio Chat to MMD cannot reach OpenCode or the model provider."
            }
          }, options.studioChatError.status ?? 503, "Service Unavailable");
        }
        if (options.studioChatValidationBlocked) {
          return createResponse({
            mode: "draft",
            sessionId: "studio-chat-test",
            summary: "Generated draft has validation issues.",
            questions: [],
            assumptions: [],
            warnings: ["Fix the missing entry role before applying."],
            previewMermaid: "flowchart TD\nINVALID\n",
            validation: {
              project: {
                ok: false,
                diagnostics: [
                  {
                    code: "MERMAID_PARSE_FAILED",
                    message: "Unable to parse generated Mermaid.",
                    severity: "error",
                    stage: "parse"
                  }
                ]
              }
            },
            authoringPatch: {
              type: "replace-authoring",
              source: "nl2mmd",
              authoring: this.lastStudioChatBody.authoring
            },
            actions: [
              {
                id: "apply-authoring-patch",
                enabled: false,
                reason: "Project validation must pass before applying the patch."
              }
            ],
            context: {
              selectedRoleId: this.lastStudioChatBody.selectedRoleId,
              selectedFlowKey: this.lastStudioChatBody.selectedFlowKey,
              referencedRoles: [],
              unresolvedItems: []
            }
          });
        }
        const nextAuthoring = cloneJson(this.lastStudioChatBody.authoring);
        nextAuthoring.system = {
          ...(nextAuthoring.system || {}),
          entryRoleId: "demo-analyst"
        };
        nextAuthoring.roles = {
          ...(nextAuthoring.roles || {}),
          "qa-reviewer": {
            roleId: "qa-reviewer",
            title: "QA Reviewer",
            bindingKind: "exec",
            profileId: "profile.review"
          }
        };
        nextAuthoring.flows = {
          ...(nextAuthoring.flows || {}),
          "2:demo-analyst:REVIEW:qa-reviewer": {
            flowId: "2:demo-analyst:REVIEW:qa-reviewer",
            fromRoleId: "demo-analyst",
            toRoleId: "qa-reviewer",
            eventType: "REVIEW",
            label: "进入复核"
          }
        };
        nextAuthoring.layout = {
          ...(nextAuthoring.layout || {}),
          nodes: {
            ...(nextAuthoring.layout?.nodes || {}),
            "qa-reviewer": { x: 380, y: 120, width: 180, height: 84 }
          }
        };
        return createResponse({
          mode: "draft",
          sessionId: "studio-chat-test",
          summary: "Generated review draft.",
          questions: [],
          assumptions: ["Using the selected Studio context."],
          warnings: [],
          previewMermaid: [
            "flowchart TD",
            "%% system.id=viz.review.demo",
            "%% system.version=1.0.0",
            "%% law.global=law.minimal.base",
            "%% entry.role=demo-analyst",
            "input -->|GO| analyst[Role:demo-analyst]",
            "analyst[Role:demo-analyst] -->|REVIEW| reviewer[Role:qa-reviewer]",
            "reviewer[Role:qa-reviewer] -->|DONE| output",
            ""
          ].join("\n"),
          validation: {
            project: { ok: true, diagnostics: [], structure: null }
          },
          authoringPatch: {
            type: "commands",
            source: "nl2mmd",
            authoring: nextAuthoring,
            commands: [
              {
                type: "add-role",
                roleId: "qa-reviewer",
                title: "QA Reviewer",
                bindingKind: "exec",
                profileId: "profile.review",
                x: 380,
                y: 120
              },
              {
                type: "add-edge",
                sourceRoleId: "demo-analyst",
                targetRoleId: "qa-reviewer",
                eventType: "REVIEW",
                label: "进入复核"
              }
            ]
          },
          actions: [{ id: "apply-authoring-patch", enabled: true }],
          context: {
            selectedRoleId: this.lastStudioChatBody.selectedRoleId,
            selectedFlowKey: this.lastStudioChatBody.selectedFlowKey,
            referencedRoles: ["qa-reviewer"],
            unresolvedItems: []
          }
        });
      }
      if (pathname === "/api/v1/project/studio/authoring" && method === "POST") {
        this.lastAuthoringSaveBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          draftPath: "/tmp/demo/.ogs/studio/system.authoring.json",
          authoring: this.lastAuthoringSaveBody.authoring,
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/studio/authoring/generate-mmd" && method === "POST") {
        this.lastAuthoringGenerateBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          systemSource: "flowchart TD\n%% system.id=viz.review.demo\n%% system.version=1.0.0\n%% law.global=law.minimal.base\n%% entry.role=demo-analyst\nr1[Role:demo-analyst] -->|DONE| output\n",
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/studio/authoring/apply-canvas" && method === "POST") {
        this.lastAuthoringApplyCanvasBody = JSON.parse(request.body ?? "{}");
        const authoring = this.lastAuthoringApplyCanvasBody.authoring;
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          authoring,
          canvas: authoringToCanvasDocument(authoring),
          systemSource: "flowchart TD\n%% system.id=viz.review.demo\n%% system.version=1.0.0\n%% law.global=law.minimal.base\n%% entry.role=demo-analyst\nr1[Role:demo-analyst] -->|DONE| output\n",
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/export" && method === "POST") {
        return createResponse({
          mode: "single-project-v1",
          project: {
            systemPath: "system.mmd",
            systemSource: "flowchart TD",
            runtime: {},
            modelSelection: {},
            modelCatalog: {},
            laws: {},
            userProfile: {},
            project: {}
          }
        });
      }
      if (pathname === "/api/v1/project/config") {
        return createResponse({
          modelSelectionWarnings: [],
          modelCatalog: {
            models: [
              { ref: "opencode/gpt-5.4", name: "GPT 5.4", provider: "opencode", model: "gpt-5.4" },
              { ref: "opencode/gpt-5-nano", name: "GPT 5 Nano", provider: "opencode", model: "gpt-5-nano" }
            ]
          },
          profiles: [{ profileId: "profile.review", toolRef: "tool.review" }],
          tools: [{ toolRef: "tool.review", runner: "local_shell" }]
        });
      }
      if (pathname === "/api/v1/project/execution-config" && method === "POST") {
        this.lastExecutionConfigUpsertBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          profilesPath: "/tmp/demo/profiles.json",
          toolsPath: "/tmp/demo/tools.json",
          profiles: this.lastExecutionConfigUpsertBody.profiles || [],
          tools: this.lastExecutionConfigUpsertBody.tools || []
        });
      }
      if (pathname === "/api/v1/project/studio/templates") {
        return createResponse({
          templates: [
            { id: "review", title: "Review", description: "Human review template" },
            { id: "consultation", title: "Consultation", description: "Specialist consultation template" }
          ]
        });
      }
      if (pathname === "/api/v1/project/profiles" && method === "POST") {
        this.lastProfilesUpsertBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          profilesPath: "/tmp/demo/profiles.json",
          profiles: this.lastProfilesUpsertBody.profiles
        });
      }
      if (pathname === "/api/v1/project/bindings") {
        return createResponse({
          roles: [
            {
              roleId: "demo-analyst",
              bindingKind: "model",
              declaredBinding: "model:gpt-5-nano",
              resolvedBinding: "opencode/gpt-5-nano",
              effectiveBinding: "opencode/gpt-5-nano",
              timeoutMs: 120000,
              maxOutputBytes: 16384,
              source: "system.mmd"
            },
            {
              roleId: "qa",
              bindingKind: "profile",
              declaredBinding: "profile:review",
              resolvedBinding: "profile:review",
              effectiveBinding: "profile:review",
              timeoutMs: 60000,
              maxOutputBytes: 8192,
              source: ".ogs/model-selection.json"
            }
          ]
        });
      }
      if (pathname === "/api/v1/project/contracts") {
        return createResponse({
          flows: options.includeMissingAuditContract
            ? [
                {
                  flowKey: "audit model",
                  contractId: null,
                  kind: "audit",
                  schemaPath: null,
                  lastStatus: "missing"
                }
              ]
            : [
                {
                  flowKey: "demo-analyst->qa:DONE",
                  contractId: "flow.answer.done",
                  kind: "flow",
                  schemaPath: ".ogs/contracts/flow.answer.done.schema.json",
                  lastStatus: "covered"
                }
              ],
          uncoveredEdges: [
            {
              flowKey: "qa->output:APPROVE",
              fromRoleId: "qa",
              toRoleId: "output"
            }
          ]
        });
      }
      const rolePackageDetailMatch = pathname.match(/^\/api\/v1\/project\/role-packages\/([^/]+)$/);
      if (rolePackageDetailMatch) {
        const roleId = decodeURIComponent(rolePackageDetailMatch[1]);
        if (method === "POST") {
          this.lastRolePackageSaveBody = JSON.parse(request.body ?? "{}");
        }
        const files = method === "POST" ? this.lastRolePackageSaveBody.files : null;
        return createResponse({
          roleId,
          status: "ok",
          resolvedPath: `/tmp/demo/og-roles/roles/${roleId}`,
          files: {
            "role.json": {
              exists: true,
              path: `/tmp/demo/og-roles/roles/${roleId}/role.json`,
              content: files?.["role.json"] || JSON.stringify({
                roleId,
                roleVersion: "1.0.0",
                name: "Demo Analyst",
                description: "fixture",
                promptTemplate: "prompt.md",
                outputSchema: "output.schema.json"
              }, null, 2)
            },
            "agent.md": {
              exists: true,
              path: `/tmp/demo/og-roles/roles/${roleId}/agent.md`,
              content: files?.["agent.md"] || "# Demo Analyst\n"
            },
            "prompt.md": {
              exists: true,
              path: `/tmp/demo/og-roles/roles/${roleId}/prompt.md`,
              content: files?.["prompt.md"] || "{{agent}}\n\n{{task}}\n"
            },
            "output.schema.json": {
              exists: true,
              path: `/tmp/demo/og-roles/roles/${roleId}/output.schema.json`,
              content: files?.["output.schema.json"] || JSON.stringify({
                type: "object",
                required: ["event", "content"],
                properties: {
                  event: { type: "string", enum: ["DONE", "REWORK"] },
                  content: { type: "string" }
                }
              }, null, 2)
            }
          },
          validation: { ok: true, diagnostics: [] }
        });
      }
      if (pathname === "/api/v1/project/role-packages") {
        return createResponse({
          rolePackages: [
            {
              roleId: "demo-analyst",
              summary: "primary answer generator",
              outputSchemaPath: "og-roles/demo-analyst/output.schema.json",
              allowedEvents: ["DONE", "REWORK"],
              files: {
                "role.json": true,
                "prompt.md": true,
                "output.schema.json": true,
                "source.json": false
              }
            },
            {
              roleId: "qa",
              summary: "human review gate",
              outputSchemaPath: "og-roles/qa/output.schema.json",
              allowedEvents: ["APPROVE", "REWORK"],
              files: {
                "role.json": true,
                "prompt.md": true,
                "output.schema.json": true,
                "source.json": true
              }
            }
          ]
        });
      }
      if (pathname === "/api/v1/project/roles") {
        return createResponse({ roles: [{ roleId: "demo-analyst", binding: { bindingKind: "model" }, review: {} }] });
      }
      if (pathname === "/api/v1/project/ops-summary") {
        return createResponse({
          summary: {
            recentFailureCount: options.includeSecondRun ? 2 : 1,
            pendingReviewCount: 1,
            pendingReworkCount: 1,
            resumeBlockedRunCount: options.includeSecondRun ? 2 : 1
          },
          recentFailures: [
            {
              runId,
              roleId: "demo-analyst",
              errorCode: "TOOL_EXECUTION_TIMEOUT",
              errorCategory: "timeout",
              message: "Command timeout after 120000ms"
            }
          ],
          failureGroups: {
            byRole: [{ key: "demo-analyst", count: 1 }],
            byErrorCode: [{ key: "TOOL_EXECUTION_TIMEOUT", count: 1 }],
            byErrorCategory: [{ key: "timeout", count: 1 }]
          },
          reviewRework: {
            pendingReviewCount: 1,
            pausedReviewCount: 0,
            pendingReworkCount: 1,
            pendingReviewByRole: [{ key: "demo-analyst", count: 1 }],
            pendingReworkByRole: [{ key: "answer-engineer", count: 1 }]
          },
          resumeReadiness: {
            inspectedRunCount: 1,
            blockedRunCount: 1,
            readyRunCount: 0,
            blockingByCategory: [{ key: "fingerprint drift", count: 1 }],
            driftSources: [{ key: "system.mmd", count: 1 }],
            runs: [{ runId, canResume: false, status: "mismatch", blockingCount: 1 }]
          }
        });
      }
      if (pathname === "/api/v1/project/readiness") {
        return createResponse({
          workdir: "/tmp/ogsystem-visualizer",
          systemId: "viz.review.demo",
          canDryRun: options.readinessCanDryRun === true,
          blockers: options.readinessCanDryRun === true ? [] : [
            {
              code: "READINESS_STRICT_HANDOFF_CONTRACT_MISSING",
              message: "Missing strict handoff contract for qa:APPROVE:output",
              severity: "blocker",
              flowKey: "qa:APPROVE:output"
            }
          ],
          warnings: [],
          missingBindings: [],
          contractCoverage: {
            handoffMode: "strict",
            eligibleFlowCount: 2,
            coveredFlowCount: 1,
            missingFlowCount: 1
          },
          roleRepoHealth: {
            roleRepoRoot: "/tmp/ogsystem-visualizer/og-roles",
            roles: [
              {
                roleId: "demo-analyst",
                status: "ok",
                files: {
                  roleJson: true,
                  promptTemplate: true,
                  outputSchema: true,
                  agent: true,
                  source: false
                },
                missingFiles: []
              }
            ]
          }
        });
      }
      if (pathname === "/api/v1/runs") {
        return createResponse({
          runs: [...runFixtures.values()].map((fixture) => ({
            runId: fixture.runId,
            runDir: `/tmp/${fixture.runId}`,
            status: fixture.detail.header.status,
            transitionCount: 1,
            lastExecutedRoleId: fixture.detail.header.lastExecutedRoleId,
            updatedAt: "2026-04-23T09:15:01.000Z",
            pendingReviewCount: 1,
            hasWaitingHumanReview: true
          }))
        });
      }
      if (pathname === "/api/v1/runs/start" && method === "POST") {
        this.lastStartBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId,
          status: "done",
          resultSummary: {
            systemId: "viz.review.demo",
            transitionCount: 1
          },
          followUpActions: [{ action: "open-run-detail", label: "Open run." }]
        });
      }
      if (runMatch) {
        const fixture = getRunFixture(runMatch[1]);
        if (fixture) {
          const deferred = options.runDetailDeferredByRunId?.[runMatch[1]];
          if (deferred) {
            await deferred.promise;
          }
          return createResponse(fixture.detail);
        }
      }
      if (runEventsMatch) {
        const fixture = getRunFixture(runEventsMatch[1]);
        const events = fixture?.events ?? [];
        const filtered = events.filter((entry) => {
          if (parsed.searchParams.get("roleId") && entry.record.roleId !== parsed.searchParams.get("roleId")) {
            return false;
          }
          if (parsed.searchParams.get("branchId") && entry.record.branchId !== parsed.searchParams.get("branchId")) {
            return false;
          }
          if (parsed.searchParams.get("type") && entry.record.type !== parsed.searchParams.get("type")) {
            return false;
          }
          if (parsed.searchParams.get("reviewId") && entry.record.reviewId !== parsed.searchParams.get("reviewId")) {
            return false;
          }
          if (parsed.searchParams.get("status") && entry.record.status !== parsed.searchParams.get("status")) {
            return false;
          }
          if (parsed.searchParams.get("errorCode") && entry.record.errorCode !== parsed.searchParams.get("errorCode")) {
            return false;
          }
          return true;
        });
        return createResponse({
          events: filtered,
          nextCursor: events.length
        });
      }
      if (runGraphMatch) {
        const fixture = getRunFixture(runGraphMatch[1]);
        if (fixture) {
          return createResponse(fixture.graph);
        }
      }
      if (runReviewsMatch) {
        const fixture = getRunFixture(runReviewsMatch[1]);
        if (fixture) {
          return createResponse({
            latestPendingReviewId: fixture.reviewId,
            reviews: [cloneJson(fixture.review)]
          });
        }
      }
      if (runReviewDetailMatch) {
        const fixture = getRunFixture(runReviewDetailMatch[1]);
        if (fixture && runReviewDetailMatch[2] === fixture.reviewId) {
          return createResponse(cloneJson(fixture.reviewDetail));
        }
      }
      if (runFailureMatch) {
        const fixture = getRunFixture(runFailureMatch[1]);
        if (fixture) {
          const deferred = options.runFailureDeferredByRunId?.[runFailureMatch[1]];
          if (deferred) {
            await deferred.promise;
          }
          return createResponse(cloneJson(fixture.failure));
        }
      }
      if (runReadinessMatch) {
        const fixture = getRunFixture(runReadinessMatch[1]);
        if (fixture) {
          return createResponse(cloneJson(fixture.readiness));
        }
      }
      if (runDiagnosticsMatch) {
        const fixture = getRunFixture(runDiagnosticsMatch[1]);
        if (fixture) {
          return createResponse(cloneJson(fixture.diagnostics));
        }
      }
      if (runResumeMatch && method === "POST") {
        this.lastResumeBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId: runResumeMatch[1],
          status: "done",
          resultSummary: {
            systemId: "viz.review.demo",
            transitionCount: 2
          },
          followUpActions: [{ action: "open-run-detail", label: "Open run." }]
        });
      }
      if (runStopMatch && method === "POST") {
        this.lastStopBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId: runStopMatch[1],
          action: "stop",
          accepted: true,
          detail: {
            requestRecorded: true,
            stopOutcomeApplied: false,
            runStatus: "stopping",
            converged: false
          }
        });
      }
      if (runLogsMatch) {
        const fixture = getRunFixture(runLogsMatch[1]);
        const roleId = parsed.searchParams.get("roleId");
        return createResponse({
          records: [{
            at: "2026-04-23T09:15:00.000Z",
            roleId: roleId || undefined,
            message: parsed.search || fixture?.logMessage || "log"
          }]
        });
      }
      if (pathname === "/api/v1/runs/reindex" && method === "POST") {
        this.lastReindexBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runs: [...runFixtures.values()].map((fixture) => ({
            runId: fixture.runId,
            runDir: `/tmp/${fixture.runId}`,
            status: fixture.detail.header.status,
            transitionCount: 1,
            lastExecutedRoleId: fixture.detail.header.lastExecutedRoleId,
            updatedAt: "2026-04-23T09:15:01.000Z",
            pendingReviewCount: 1,
            hasWaitingHumanReview: true
          }))
        });
      }
      if (runReviewDecisionMatch && method === "POST") {
        const fixture = getRunFixture(runReviewDecisionMatch[1]);
        if (!fixture || runReviewDecisionMatch[2] !== fixture.reviewId) {
          throw new Error(`Unhandled review decision path: ${pathname}`);
        }
        this.lastDecisionBody = JSON.parse(request.body ?? "{}");
        if (options.failDecision) {
          return createResponse({ error: "boom" }, 500, "Internal Server Error");
        }
        if (this.decisionDeferred) {
          await this.decisionDeferred.promise;
        }
        fixture.review = {
          ...fixture.review,
          decision: this.lastDecisionBody.decision,
          actor: this.lastDecisionBody.actor,
          comment: this.lastDecisionBody.comment,
          decisionPhase: "recorded"
        };
        fixture.reviewDetail = {
          ...fixture.reviewDetail,
          decision: this.lastDecisionBody.decision,
          actor: this.lastDecisionBody.actor,
          comment: this.lastDecisionBody.comment,
          decisionPhase: "recorded",
          decidedAt: "2026-04-23T09:15:05.000Z",
          committedAt: "2026-04-23T09:15:05.000Z",
          decisionSnapshot: {
            decision: this.lastDecisionBody.decision,
            actor: this.lastDecisionBody.actor,
            comment: this.lastDecisionBody.comment,
            decisionPhase: "recorded"
          }
        };
        if (runReviewDecisionMatch[1] === runId) {
          this.review = cloneJson(fixture.review);
          this.reviewDetail = cloneJson(fixture.reviewDetail);
        }
        return createResponse({
          runId: runReviewDecisionMatch[1],
          action: "review:" + this.lastDecisionBody.decision,
          accepted: true,
          semanticStatus: this.lastDecisionBody.decision === "pause" ? "human-review-paused" : "human-review-approved",
          detail: {
            reviewId: fixture.reviewId,
            note: "Decision recorded in the control plane; runtime reconcile may still be pending.",
            lifecycle: {
              decision: {
                reviewId: fixture.reviewId,
                decision: this.lastDecisionBody.decision
              }
            }
          }
        });
      }
      throw new Error(`Unhandled fetch path: ${method} ${pathname}${parsed.search}`);
    }
  };
  return backend;
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

async function waitForCondition(predicate, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) {
      return;
    }
    await settle();
  }
}

async function createClientHarness(options = {}) {
  const document = new FakeDocument();
  const backend = options.backend ?? createBackend(options);
  const storage = new Map(Object.entries(options.storage ?? {}));
  const prompts = [...(options.prompts ?? [])];
  const promptCalls = [];
  const confirmCalls = [];
  const confirmResponses = [...(options.confirms ?? [])];
  const eventSources = [];
  const timers = new Map();
  const intervals = new Map();
  let nextTimerId = 1;
  const timerDelays = [];
  const windowObject = {
    location: {
      pathname: "/",
      search: options.search ?? "?runId=run-123",
      href: "/"
    },
    history: {
      replaceState(_state, _title, url) {
        if (typeof url === "string" && url.startsWith("?")) {
          windowObject.location.search = url;
        } else if (typeof url === "string") {
          windowObject.location.pathname = url;
          windowObject.location.search = "";
        }
      }
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    prompt(label, initialValue) {
      promptCalls.push({ label, initialValue });
      return prompts.length > 0 ? prompts.shift() : initialValue ?? "";
    },
    confirm(message) {
      confirmCalls.push(message);
      return confirmResponses.length > 0 ? confirmResponses.shift() : true;
    }
  };
  class FakeAbortController {
    constructor() {
      this.signal = {
        aborted: false,
        reason: undefined,
        listeners: [],
        addEventListener: (eventName, listener) => {
          if (eventName === "abort") {
            this.signal.listeners.push(listener);
          }
        }
      };
    }
    abort(reason) {
      this.signal.aborted = true;
      this.signal.reason = reason;
      for (const listener of this.signal.listeners) {
        listener({ type: "abort" });
      }
    }
  }
  const context = vm.createContext({
    window: windowObject,
    document,
    fetch: async (url, request) => backend.handle(url, request),
    AbortController: FakeAbortController,
    EventSource: class extends FakeEventSource {
      constructor(url) {
        super(url);
        eventSources.push(this);
      }
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, callback);
      timerDelays.push(delay);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    URLSearchParams,
    Date,
    JSON,
    console,
    encodeURIComponent,
    FormData: class FakeFormData {
      constructor(form) {
        this.values = new Map();
        for (const child of form?.document?.dynamicElements?.values?.() ?? []) {
          if (child.attributes?.name) {
            const checked = child.attributes.checked !== undefined;
            if (child.attributes.type === "checkbox" && !checked && child.value !== true) {
              continue;
            }
            const value = child.value ?? child.attributes.value ?? "";
            const existing = this.values.get(child.attributes.name);
            if (existing === undefined) {
              this.values.set(child.attributes.name, value);
            } else if (Array.isArray(existing)) {
              existing.push(value);
            } else {
              this.values.set(child.attributes.name, [existing, value]);
            }
          }
        }
      }
      has(name) {
        return this.values.has(name);
      }
      get(name) {
        const value = this.values.get(name);
        return Array.isArray(value) ? value[0] : value ?? null;
      }
      getAll(name) {
        const value = this.values.get(name);
        return Array.isArray(value) ? value : value === undefined ? [] : [value];
      }
    },
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options?.type ?? "";
      }
    },
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {}
    }
  });
  vm.runInContext(buildClientAppScript("/api/v1", options.i18n), context);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await settle();
    if (
      document.getElementById("resume-controls").innerHTML.includes("Load diagnostics") &&
      document.getElementById("review-detail").textContent.includes("Decision trail")
    ) {
      break;
    }
  }
  return {
    backend,
    confirmCalls,
    document,
    eventSources,
    intervals,
    timerDelays,
    window: windowObject,
    promptCalls,
    async flushTimers() {
      while (timers.size > 0) {
        const callbacks = [...timers.values()];
        timers.clear();
        for (const callback of callbacks) {
          await callback();
        }
        await settle();
      }
    },
    async tickIntervals() {
      const callbacks = [...intervals.values()];
      for (const callback of callbacks) {
        await callback();
      }
      await settle();
    },
    dispose() {
      windowObject.OGSVisualizerClient?.dispose?.();
    }
  };
}

test("visualizer client route helpers round-trip query state", () => {
  const search = buildRouteSearch({
    lifecycle: "run",
    projectHome: false,
    selectedRunId: "run-123",
    selectedReviewId: "review-1",
    selectedLogRoleId: "alpha",
    logTail: "25",
    logSince: "2026-04-23T10:11"
  });
  assert.equal(
    search,
    "lifecycle=run&runId=run-123&reviewId=review-1&logRoleId=alpha&tail=25&since=2026-04-23T10%3A11"
  );
  assert.deepEqual(readRouteStateFromSearch(`?${search}`), {
    view: "",
    lifecycle: "run",
    runId: "run-123",
    reviewId: "review-1",
    logRoleId: "alpha",
    tail: "25",
    since: "2026-04-23T10:11"
  });
  assert.equal(normalizeLifecycleView("build", ""), "design");
  assert.equal(normalizeLifecycleView("", "project"), "project");
  assert.equal(normalizeLifecycleView("", ""), "project");
  assert.equal(
    buildRouteSearch({
      lifecycle: "design",
      projectHome: true,
      selectedRunId: "",
      selectedReviewId: "",
      selectedLogRoleId: "",
      logTail: "",
      logSince: ""
    }),
    "lifecycle=design"
  );
  assert.deepEqual(readRouteStateFromSearch("?lifecycle=design"), {
    view: "",
    lifecycle: "design",
    runId: "",
    reviewId: "",
    logRoleId: "",
    tail: "",
    since: ""
  });
});

test("visualizer client release readiness decision gates every visible blocker category", () => {
  const ready = buildReleaseReadinessDecision({
    validation: { ok: true },
    readiness: { blockers: [], contractCoverage: { missingFlowCount: 0 } },
    bindings: { roles: [{ roleId: "demo", effectiveBinding: "model:gpt" }] },
    rolePackages: { rolePackages: [{ roleId: "demo", files: { roleJson: true, promptTemplate: true } }] },
    contracts: { flows: [{ flowKey: "demo:DONE:output", contractId: "flow.done", schemaPath: "schema.json", lastStatus: "covered" }] },
    workbenchDirty: false
  });
  assert.equal(ready.canExport, true);

  const blocked = buildReleaseReadinessDecision({
    validation: { ok: false },
    readiness: {
      blockers: [{ code: "READINESS_BLOCKER", message: "readiness blocked" }],
      contractCoverage: { missingFlowCount: 1 }
    },
    bindings: { roles: [{ roleId: "demo", resolved: false }] },
    rolePackages: { rolePackages: [{ roleId: "demo", files: { roleJson: true, promptTemplate: false } }] },
    contracts: { flows: [{ flowKey: "audit", contractId: null, schemaPath: null, lastStatus: "missing" }], uncoveredEdges: [{ flowKey: "demo:DONE:output" }] },
    workbenchDirty: true
  });
  assert.equal(blocked.canExport, false);
  assert.deepEqual(
    blocked.blockers.map((blocker) => blocker.code),
    [
      "RELEASE_DIRTY_WORKBENCH",
      "RELEASE_VALIDATION_FAILED",
      "READINESS_BLOCKER",
      "RELEASE_CONTRACT_COVERAGE_MISSING",
      "RELEASE_ARTIFACT_CONTRACT_INCOMPLETE",
      "RELEASE_BINDINGS_UNRESOLVED",
      "RELEASE_ROLE_PACKAGES_UNHEALTHY"
    ]
  );
});

test("visualizer client renders empty workspace without project API writes", async () => {
  const harness = await createClientHarness({
    workspace: {
      workdir: "/tmp/empty-project",
      exists: true,
      isDirectory: true,
      hasProject: false,
      state: "empty",
      entryCount: 0,
      canInitialize: true,
      controlledPathConflicts: []
    },
    search: "?lifecycle=design&runId=old-run"
  });

  await waitForCondition(() => /Initialize current directory|Start a new OGSystem project here/i.test(harness.document.getElementById("project-wizard").textContent));
  assert.match(harness.document.getElementById("project-wizard").textContent, /Start a new OGSystem project here|Initialize current directory/i);
  assert.match(harness.document.getElementById("workbench-body").textContent, /initialize the current directory|not initialized/i);
  assert.match(harness.document.getElementById("graph-view").textContent, /initialize the current directory|project first/i);
  assert.equal(harness.document.getElementById("build-dry-run"), null);
  assert.equal(harness.document.getElementById("build-save"), null);
  assert.equal(harness.document.getElementById("resume-run").hidden, true);
  assert.equal(harness.document.getElementById("release-export").disabled, true);
  assert.equal(harness.window.location.search, "?lifecycle=design");
  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/workspace"));
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/system/workbench"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"), false);
});

test("visualizer client creates a project from the empty workspace wizard", async () => {
  const harness = await createClientHarness({
    workspace: {
      workdir: "/tmp/empty-project",
      exists: true,
      isDirectory: true,
      hasProject: false,
      state: "empty",
      entryCount: 0,
      canInitialize: true,
      controlledPathConflicts: []
    },
    readinessCanDryRun: true,
    search: ""
  });

  await waitForCondition(() => Boolean(
    [...harness.document.dynamicElements].find((child) => child.attributes.name === "projectName")
  ));
  const projectName = [...harness.document.dynamicElements]
    .find((child) => child.attributes.name === "projectName");
  const template = [...harness.document.dynamicElements]
    .find((child) => child.attributes.name === "templateId");
  const projectId = [...harness.document.dynamicElements]
    .find((child) => child.attributes.name === "projectId");
  const workdirInput = [...harness.document.dynamicElements]
    .find((child) => child.attributes.name === "workdir");
  assert.ok(projectName);
  assert.ok(template);
  assert.equal(projectId, undefined);
  assert.equal(workdirInput, undefined);
  assert.equal(harness.document.getElementById("project-role-catalog-filter"), null);

  await projectName.input("Empty visual");
  await template.change("minimal");
  await harness.document.getElementById("project-create-form").dispatch("submit");
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/create"));
  await waitForCondition(() => harness.document.getElementById("console-panel-build").hidden === false);
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/role-catalog"));

  assert.match(harness.backend.lastProjectCreateBody.requestId, /^project-create-/);
  assert.deepEqual(
    {
      projectName: harness.backend.lastProjectCreateBody.projectName,
      templateId: harness.backend.lastProjectCreateBody.templateId,
      conflictStrategy: harness.backend.lastProjectCreateBody.conflictStrategy
    },
    {
      projectName: "Empty visual",
      templateId: "minimal",
      conflictStrategy: "init-current"
    }
  );
  assert.equal("workdir" in harness.backend.lastProjectCreateBody, false);
  assert.equal("projectId" in harness.backend.lastProjectCreateBody, false);
  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project"));
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/create"), true);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/role-catalog"), true);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/roles/import"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/system/save"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"), false);
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.match(harness.document.getElementById("flash").textContent, /Project created\. Continue in Design\./);
});

test("visualizer client shows staged progress while project creation is still running", async () => {
  const deferred = createDeferred();
  const harness = await createClientHarness({
    search: "",
    workspace: {
      workdir: "/tmp/empty-project",
      exists: true,
      isDirectory: true,
      hasProject: false,
      state: "empty",
      entryCount: 0,
      canInitialize: true,
      controlledPathConflicts: []
    },
    projectCreateDeferred: deferred
  });

  await harness.document.getElementById("project-create-form").dispatch("submit");
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/create"));
  await waitForCondition(() => /Creating project|正在创建项目/.test(harness.document.getElementById("project-wizard").textContent));
  assert.match(harness.document.getElementById("project-wizard").textContent, /1 \/ 4/);
  assert.match(harness.document.getElementById("project-wizard").textContent, /Scaffolding project files|writing system\.mmd|生成项目文件骨架|写入 system\.mmd/i);

  deferred.resolve(createResponse({
    workdir: "/tmp/demo",
    projectId: "empty-visual",
    projectName: "my-ogs-project",
    templateId: "empty",
    validation: { ok: true, diagnostics: [], structure: null }
  }));
  await waitForCondition(() => /Project created\. Continue in Design\.|项目已创建，请继续设计。/.test(harness.document.getElementById("flash").textContent));
});

test("visualizer client retries graph workspace warmup until graph content becomes available", async () => {
  const harness = await createClientHarness({
    search: "",
    workspace: {
      workdir: "/tmp/empty-project",
      exists: true,
      isDirectory: true,
      hasProject: false,
      state: "empty",
      entryCount: 0,
      canInitialize: true,
      controlledPathConflicts: []
    },
    studioBridgeResponses: [
      createResponse({
        workdir: "/tmp/demo",
        systemPath: "/tmp/demo/system.mmd",
        systemSource: "flowchart TD\n",
        validation: { ok: true, diagnostics: [], structure: { roleCount: 1, flowCount: 1 } },
        authoring: { version: 1, project: { workdir: "/tmp/demo", systemPath: "/tmp/demo/system.mmd" }, system: { systemId: "viz.review.demo", systemVersion: "1.0.0", entryRoleId: "demo-analyst", lawGlobalRef: "law.minimal.base" }, roles: {}, flows: {}, layout: { nodes: {} } },
        extracted: { systemId: "viz.review.demo", systemVersion: "1.0.0", entryRoleId: "demo-analyst", lawGlobal: "law.minimal.base", roles: [], flows: [] }
      }),
      createResponse({
        workdir: "/tmp/demo",
        systemPath: "/tmp/demo/system.mmd",
        systemSource: "flowchart TD\n",
        validation: { ok: true, diagnostics: [], structure: { roleCount: 1, flowCount: 1 } },
        authoring: {
          version: 1,
          project: { workdir: "/tmp/demo", systemPath: "/tmp/demo/system.mmd" },
          system: { systemId: "viz.review.demo", systemVersion: "1.0.0", entryRoleId: "demo-analyst", lawGlobalRef: "law.minimal.base" },
          roles: { "demo-analyst": { roleId: "demo-analyst", bindingKind: "model" } },
          flows: { "1:demo-analyst:DONE:output": { flowId: "1:demo-analyst:DONE:output", fromRoleId: "demo-analyst", toRoleId: "__system_end__", eventType: "DONE" } },
          layout: { nodes: { "demo-analyst": { x: 120, y: 120 } } }
        },
        extracted: {
          systemId: "viz.review.demo",
          systemVersion: "1.0.0",
          entryRoleId: "demo-analyst",
          lawGlobal: "law.minimal.base",
          roles: [{ roleId: "demo-analyst", bindingKind: "model", incomingFlowCount: 0, outgoingFlowCount: 1, allowedEvents: ["DONE"], badges: ["entry", "M"] }],
          flows: [{ flowId: "1:demo-analyst:DONE:output", flowKey: "demo-analyst:DONE:output", fromRoleId: "demo-analyst", toRoleId: "__system_end__", eventType: "DONE", runtimeOnlyErrorFlow: false, participatesInJoin: false }]
        }
      })
    ]
  });

  await harness.document.getElementById("project-create-form").dispatch("submit");
  await waitForCondition(() => harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/project/studio/bridge").length >= 2);
  assert.equal(harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/project/studio/bridge").length >= 2, true);
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
});

test("visualizer client builds Studio canvas from authoring when bridge extracted graph is unavailable", async () => {
  const harness = await createClientHarness({
    readinessCanDryRun: true,
    studioBridgeResponses: [
      createResponse({
        workdir: "/tmp/demo",
        systemPath: "/tmp/demo/system.mmd",
        systemSource: "flowchart TD\n%% entry.role=demo-analyst\ninput -->|GO| analyst[Role:demo-analyst]\nanalyst[Role:demo-analyst] -->|DONE| output\n",
        validation: {
          ok: true,
          diagnostics: [],
          structure: {
            systemId: "viz.review.demo",
            systemVersion: "1.0.0",
            entryRoleId: "demo-analyst",
            roleCount: 1,
            flowCount: 1,
            roles: [{ roleId: "demo-analyst", bindingKind: "model" }],
            flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
          }
        },
        authoring: {
          version: 1,
          project: { workdir: "/tmp/demo", systemPath: "/tmp/demo/system.mmd" },
          system: {
            systemId: "viz.review.demo",
            systemVersion: "1.0.0",
            entryRoleId: "demo-analyst",
            entryEventType: "GO",
            lawGlobalRef: "law.minimal.base"
          },
          roles: {
            "demo-analyst": {
              roleId: "demo-analyst",
              title: "Demo Analyst",
              bindingKind: "model",
              modelRef: "opencode/gpt-5.4"
            }
          },
          flows: {
            "1:demo-analyst:DONE:output": {
              flowId: "1:demo-analyst:DONE:output",
              fromRoleId: "demo-analyst",
              toRoleId: "__system_end__",
              eventType: "DONE"
            }
          },
          layout: {
            nodes: {
              "demo-analyst": { x: 120, y: 120 }
            }
          }
        },
        extracted: {
          systemId: "viz.review.demo",
          systemVersion: "1.0.0",
          entryRoleId: "demo-analyst",
          lawGlobal: "law.minimal.base",
          roles: [],
          flows: []
        }
      })
    ]
  });
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };

  await openDesignTab(harness);
  const bridgeTab = findWorkbenchViewButton(harness, "bridge");
  assert.ok(bridgeTab);
  await bridgeTab.click();
  await waitForCondition(() => mountCalls.length > 0, 80);

  const latestMount = mountCalls.at(-1)?.options;
  assert.ok(latestMount);
  assert.ok(latestMount.authoring);
  assert.ok(latestMount.canvas.nodes.some((node) => node.roleId === "demo-analyst"));
  assert.ok(latestMount.canvas.edges.some((edge) => edge.source === "demo-analyst" && edge.eventType === "DONE"));
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-role-id]").length > 0);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-flow-key]").length > 0);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]").length > 0);
});

test("visualizer client retries workspace load after initial failure and auto-dismisses success flash", async () => {
  const harness = await createClientHarness({
    workspaceFailOnce: true
  });

  await waitForCondition(() => /Retry|刷新/.test(harness.document.getElementById("run-list").textContent));
  assert.match(harness.document.getElementById("run-list").textContent, /Failed to load visualizer data|加载 visualizer 数据失败/i);
  const retryButton = harness.document.getElementById("project-load-retry");
  assert.ok(retryButton);
  await retryButton.click();
  await waitForCondition(() => /run-123/.test(harness.document.getElementById("run-list").textContent));
  assert.match(harness.document.getElementById("flash").textContent, /Visualizer refreshed/);
  await harness.flushTimers();
  assert.equal(harness.document.getElementById("flash").className, "flash hidden");
});

test("visualizer client keeps console and run list interactions idempotent across rerenders", async () => {
  const harness = await createClientHarness();

  const runTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "run");
  assert.ok(runTab);
  await runTab.click();
  await settle();
  await runTab.click();
  await settle();

  const runButton = harness.document.getElementById("run-list")
    .querySelectorAll("[data-run-id]")
    .find((button) => button.getAttribute("data-run-id") === "run-123");
  assert.ok(runButton);
  assert.match(runButton.getAttribute("aria-label"), /Run run-123 status \w+ transitions \d+ updated/);
  const fetchCountBefore = harness.backend.fetchCalls.length;
  await runButton.click();
  await settle();
  const fetchCountAfterFirst = harness.backend.fetchCalls.length;
  assert.ok(fetchCountAfterFirst > fetchCountBefore);
  await runButton.click();
  await settle();
  const fetchCountAfterSecond = harness.backend.fetchCalls.length;
  assert.ok(fetchCountAfterSecond > fetchCountAfterFirst);
  assert.equal(
    harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length >= 2,
    true
  );
});

test("visualizer client shows stable project create conflict errors", async () => {
  const harness = await createClientHarness({
    search: "",
    workspace: {
      workdir: "/tmp/conflict-project",
      exists: true,
      isDirectory: true,
      hasProject: false,
      state: "non-project-ready",
      entryCount: 1,
      canInitialize: true,
      controlledPathConflicts: []
    },
    projectCreateError: {
      status: 409,
      code: "PROJECT_DIR_CONFLICT",
      message: "Current directory is not empty."
    }
  });

  await waitForCondition(() => Boolean(
    [...harness.document.dynamicElements].find((child) => child.attributes.name === "conflictStrategy")
  ));
  await harness.document.getElementById("project-create-form").dispatch("submit");
  await settle();

  assert.equal(harness.backend.lastProjectCreateBody.conflictStrategy, "reject");
  assert.match(harness.document.getElementById("project-wizard").textContent, /existing files|current directory|needs confirmation/i);
  assert.match(harness.document.getElementById("project-wizard").textContent, /existing files untouched|project root|current-directory initialization/i);
  assert.match(harness.document.getElementById("workbench-body").textContent, /initialize the current directory|not initialized/i);
});

test("visualizer client surfaces invalid project diagnostics and disables editing", async () => {
  const harness = await createClientHarness({
    search: "",
    workspace: {
      workdir: "/tmp/invalid-project",
      exists: true,
      isDirectory: true,
      hasProject: true,
      isProjectValid: false,
      state: "project-invalid",
      entryCount: 2,
      canInitialize: false,
      controlledPathConflicts: [],
      projectValidation: {
        ok: false,
        diagnostics: [
          {
            code: "PROJECT_SYSTEM_PARSE_FAILED",
            message: "entry.role is missing or invalid",
            severity: "error",
            stage: "parse"
          }
        ]
      }
    }
  });

  await settle();

  assert.match(harness.document.getElementById("project-wizard").textContent, /invalid project|无效项目/i);
  assert.match(harness.document.getElementById("project-wizard").textContent, /entry\.role is missing or invalid/i);
  assert.match(harness.document.getElementById("workbench-body").textContent, /fix the project diagnostics|请先修复项目诊断问题/i);
  assert.equal(harness.document.getElementById("resume-run").disabled, true);
  assert.equal(harness.document.getElementById("build-validate"), null);
  assert.equal(harness.document.getElementById("build-save"), null);
});

test("visualizer client stream helpers dedupe timeline entries and cap history", () => {
  const first = appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 2 }, 2);
  assert.deepEqual(first, [{ cursor: 1 }, { cursor: 2 }]);

  const second = appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 3 }, 2);
  assert.deepEqual(second, [{ cursor: 2 }, { cursor: 3 }]);

  const cursorIndex = createStreamCursorIndex([{ cursor: 1 }, { cursor: 2 }]);
  const duplicate = appendIndexedStreamEntry([{ cursor: 1 }, { cursor: 2 }], cursorIndex, { cursor: 2 }, 2);
  assert.deepEqual(duplicate, [{ cursor: 1 }, { cursor: 2 }]);

  const appended = appendIndexedStreamEntry([{ cursor: 1 }, { cursor: 2 }], cursorIndex, { cursor: 3 }, 2);
  assert.deepEqual(appended, [{ cursor: 2 }, { cursor: 3 }]);
  assert.deepEqual([...cursorIndex].sort((a, b) => a - b), [2, 3]);
});

test("visualizer client stream refresh plan keeps review and runtime refreshes targeted", () => {
  assert.deepEqual(getStreamRefreshPlan("human_review_requested"), {
    detailGraph: true,
    reviews: true,
    reviewDetail: true,
    failure: false,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("runtime_error"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    failure: true,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("audit"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    failure: true,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
});

test("visualizer client formats review decision phase labels", () => {
  assert.equal(formatReviewStatusLabel("pending_reconcile"), "pending reconcile");
  assert.equal(formatReviewStatusLabel("waiting_review"), "waiting review");
  assert.equal(formatReviewStatusLabel("applied"), "applied");
});

test("visualizer client renders zh-CN chrome while preserving runtime identifiers", async () => {
  const harness = await createClientHarness({
    i18n: { locale: "zh-CN" },
    includeMissingAuditContract: true
  });
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };

  assert.match(harness.document.getElementById("console-tabs").textContent, /项目 设计 运行 发布/);
  assert.equal(harness.document.getElementById("action-form-section").hidden, true);
  const recoveryTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "recovery");
  assert.ok(recoveryTab);
  await recoveryTab.click();
  await settle();
  assert.match(harness.document.getElementById("failure-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.match(harness.document.getElementById("failure-summary").textContent, /超时预算耗尽/);
  assert.match(harness.document.getElementById("resume-controls").textContent, /加载诊断/);
  assert.match(harness.document.getElementById("run-list").textContent, /已停止/);
  assert.match(harness.document.getElementById("stats").textContent, /已停止/);
  assert.match(harness.document.getElementById("timeline").textContent, /待处理/);
  assert.match(harness.document.getElementById("project-wizard").textContent, /警告/);
  assert.match(harness.document.getElementById("state").textContent, /执行状态/);
  assert.match(harness.document.getElementById("state").textContent, /总转换次数/);
  assert.match(harness.document.getElementById("state").textContent, /空操作次数/);
  assert.match(harness.document.getElementById("detail").textContent, /指标/);
  assert.match(harness.document.getElementById("detail").textContent, /运行 id/);
  assert.match(harness.document.getElementById("detail").textContent, /系统 id/);
  assert.match(harness.document.getElementById("detail").textContent, /循环迭代/);
  assert.doesNotMatch(harness.document.getElementById("detail").textContent, /metrics\.runId|metrics\.systemId|state\.loopIterations/);

  assert.match(harness.document.getElementById("contract-explain").textContent, /审计/);
  assert.match(harness.document.getElementById("contract-explain").textContent, /schema 不适用 · 状态 缺失/);
  assert.doesNotMatch(harness.document.getElementById("contract-explain").textContent, /schema n\/a|状态 missing/);

  const loadDiagnosticsButton =
    harness.document.getElementById("load-diagnostics") ??
    harness.document.getElementById("resume-controls").children.find((child) => child.id === "load-diagnostics");
  assert.ok(loadDiagnosticsButton);
  await loadDiagnosticsButton.click();
  await settle();
  assert.match(harness.document.getElementById("resume-diagnostics").textContent, /警告/);
  assert.match(harness.document.getElementById("resume-diagnostics").textContent, /需关注/);
  assert.doesNotMatch(harness.document.getElementById("resume-diagnostics").textContent, /\bwarning\b|\battention\b/);

  await openDesignTab(harness);
  const bridgeTab = findWorkbenchViewButton(harness, "bridge");
  assert.ok(bridgeTab);
  await bridgeTab.click();
  await settle();
  await waitForCondition(() => mountCalls.length > 0);
  const latestMount = mountCalls.at(-1)?.options;
  assert.ok(latestMount);
  assert.equal(latestMount.labels.viewportGroup, "视图操作");
  assert.equal(latestMount.labels.editGroup, "图谱编辑");
  assert.equal(latestMount.labels.fullscreen, "全屏");
});

test("visualizer client language switch stores locale and refreshes with lang query", async () => {
  const harness = await createClientHarness();

  await harness.document.getElementById("locale-select").change("zh-CN");

  assert.equal(harness.window.localStorage.getItem("ogs.visualizer.lang"), "zh-CN");
  assert.match(harness.window.location.href, /^\//);
  assert.match(harness.window.location.href, /[?&]lang=zh-CN/);
  assert.match(harness.window.location.href, /[?&]runId=run-123/);
});

test("visualizer client redirects stored locale into the URL to keep server shell consistent", async () => {
  const harness = await createClientHarness({
    search: "?view=project",
    storage: {
      "ogs.visualizer.lang": "zh-CN"
    }
  });

  assert.match(harness.window.location.href, /^\//);
  assert.match(harness.window.location.href, /[?&]view=project/);
  assert.match(harness.window.location.href, /[?&]lang=zh-CN/);
});

test("visualizer client keeps diagnostics lazy and renders decision phase detail", async () => {
  const harness = await createClientHarness({
    decisionPhase: "recorded"
  });

  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("Decision trail")
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/failure"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-readiness"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-diagnostics"),
    false
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path.startsWith("/api/v1/runs/run-123/logs")),
    false
  );
  const graphTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "graph");
  assert.ok(graphTab);
  await graphTab.click();
  await settle();
  assert.ok(harness.document.getElementById("graph-view").innerHTML.includes('id="run-graph-root"'));
  const artifactsTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "artifacts");
  assert.ok(artifactsTab);
  await artifactsTab.click();
  await settle();
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-artifacts").hidden, false);
  assert.equal(harness.document.getElementById("operate-tabpanel-overview").hidden, true);
  assert.match(harness.document.getElementById("detail").textContent, /snapshot manifest|Run snapshot manifest/i);
  assert.match(harness.document.getElementById("detail").textContent, /historical truth/i);
  const recoveryTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "recovery");
  assert.ok(recoveryTab);
  await recoveryTab.click();
  await settle();
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-artifacts").hidden, true);
  assert.equal(harness.document.getElementById("operate-tabpanel-recovery").hidden, false);
  assert.match(harness.document.getElementById("failure-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.match(harness.document.getElementById("resume-readiness").textContent, /resume blocked/);
  assert.match(harness.document.getElementById("review-detail").textContent, /Decision durability snapshot/);

  const loadDiagnosticsButton =
    harness.document.getElementById("load-diagnostics") ??
    harness.document.getElementById("resume-controls").children.find((child) => child.id === "load-diagnostics");
  assert.ok(loadDiagnosticsButton);
  await loadDiagnosticsButton.click();
  await settle();

  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-diagnostics"),
    true
  );
  assert.match(harness.document.getElementById("resume-diagnostics").innerHTML, /Review decisions/);
});

test("visualizer client renders config explain panels and failure next checks", async () => {
  const harness = await createClientHarness();

  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/ops-summary"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/readiness"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/bindings"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/contracts"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/role-packages"),
    true
  );
  const designTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  const legacyTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "legacy");
  assert.ok(designTab);
  assert.equal(legacyTab, undefined);
  await designTab.click();
  await settle();
  assert.match(harness.document.getElementById("binding-explain").textContent, /opencode\/gpt-5-nano/);
  assert.match(harness.document.getElementById("ops-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.match(harness.document.getElementById("ops-summary").textContent, /active rework branches/);
  assert.match(harness.document.getElementById("project-wizard").textContent, /dry-run readiness/);
  assert.match(harness.document.getElementById("project-wizard").textContent, /READINESS_STRICT_HANDOFF_CONTRACT_MISSING/);
  assert.match(harness.document.getElementById("role-packages").textContent, /output\.schema\.json/);
  assert.match(harness.document.getElementById("contract-explain").textContent, /flow.answer.done/);
  const runTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "run");
  assert.ok(runTab);
  await runTab.click();
  await settle();
  const recoveryTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "recovery");
  assert.ok(recoveryTab);
  await recoveryTab.click();
  await settle();
  assert.ok(harness.document.getElementById("failure-check-binding"));
  assert.ok(harness.document.getElementById("failure-check-resume"));
});

test("visualizer client switches Design Run Release shells without unloading data", async () => {
  const harness = await createClientHarness({ search: "" });
  const tabs = harness.document.getElementById("console-tabs").querySelectorAll("[data-console-tab]");
  const projectTab = tabs.find((button) => button.getAttribute("data-console-tab") === "project");
  const designTab = tabs.find((button) => button.getAttribute("data-console-tab") === "design");
  const runTab = tabs.find((button) => button.getAttribute("data-console-tab") === "run");
  const releaseTab = tabs.find((button) => button.getAttribute("data-console-tab") === "release");
  const legacyTab = tabs.find((button) => button.getAttribute("data-console-tab") === "legacy");

  assert.equal(tabs.length, 4);
  assert.ok(projectTab);
  assert.ok(designTab);
  assert.ok(runTab);
  assert.ok(releaseTab);
  assert.equal(legacyTab, undefined);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-ops").hidden, true);
  assert.equal(harness.document.body.classList.classes.has("show-operate-workspace"), false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), false);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, true);
  assert.equal(projectTab.getAttribute("aria-pressed"), "true");
  assert.equal(runTab.getAttribute("aria-pressed"), "false");
  assert.equal(harness.document.getElementById("sidebar-toggle").getAttribute("aria-expanded"), "false");
  assert.match(harness.document.getElementById("project-wizard").textContent, /Overview/);
  assert.ok(harness.document.getElementById("project-wizard").querySelectorAll(".project-home-layout").length >= 1);

  await runTab.click();
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-ops").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-logs").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-artifacts").hidden, true);
  assert.equal(harness.document.getElementById("operate-tabpanel-overview").hidden, false);
  assert.equal(harness.document.getElementById("operate-tabpanel-graph").hidden, true);
  assert.equal(harness.document.body.classList.classes.has("show-operate-workspace"), true);
  assert.equal(harness.document.body.classList.classes.has("operate-tab-overview"), true);
  assert.match(harness.document.getElementById("operate-tabs").textContent, /Overview/);
  assert.equal(harness.document.body.classList.classes.has("operate-tab-logs"), false);
  assert.equal(harness.document.body.classList.classes.has("operate-tab-artifacts"), false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), true);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, false);
  const operateTabButtons = harness.document.getElementById("operate-tabs").querySelectorAll("[data-operate-tab]");
  const overviewOperateTab = operateTabButtons.find((button) => button.getAttribute("data-operate-tab") === "overview");
  const logsOperateTab = operateTabButtons.find((button) => button.getAttribute("data-operate-tab") === "logs");
  const lifecycleButtonsAfterOperate = harness.document.getElementById("console-tabs").querySelectorAll("[data-console-tab]");
  const designTabAfterRun = lifecycleButtonsAfterOperate.find((button) => button.getAttribute("data-console-tab") === "design");
  const runTabAfterRun = lifecycleButtonsAfterOperate.find((button) => button.getAttribute("data-console-tab") === "run");
  assert.equal(runTabAfterRun?.getAttribute("aria-pressed"), "true");
  assert.equal(runTabAfterRun?.getAttribute("role"), "tab");
  assert.equal(runTabAfterRun?.getAttribute("aria-selected"), "true");
  assert.equal(runTabAfterRun?.getAttribute("aria-controls"), "operate-tabpanel-overview");
  assert.equal(designTabAfterRun?.getAttribute("aria-pressed"), "false");
  assert.equal(overviewOperateTab?.getAttribute("aria-pressed"), "true");
  assert.equal(overviewOperateTab?.getAttribute("role"), "tab");
  assert.equal(overviewOperateTab?.getAttribute("aria-selected"), "true");
  assert.equal(overviewOperateTab?.getAttribute("aria-controls"), "operate-tabpanel-overview");
  assert.equal(logsOperateTab?.getAttribute("aria-pressed"), "false");
  assert.equal(harness.document.getElementById("operate-tabpanel-overview").getAttribute("role"), "tabpanel");
  assert.match(harness.document.getElementById("operate-tabpanel-overview").getAttribute("aria-labelledby"), /operate-tab-overview/);
  assert.equal(harness.document.getElementById("sidebar-toggle").getAttribute("aria-expanded"), "false");
  assert.match(harness.document.getElementById("ops-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);

  await logsOperateTab.click();
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-logs").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-ops").hidden, true);
  assert.equal(harness.document.getElementById("operate-tabpanel-overview").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-logs").getAttribute("role"), "tabpanel");
  assert.match(harness.document.getElementById("console-panel-logs").getAttribute("aria-labelledby"), /operate-tab-logs/);

  await designTab.click();
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-config").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-config").getAttribute("role"), "region");
  assert.equal(harness.document.getElementById("console-panel-config").getAttribute("aria-label"), "Config Explain");
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), false);
  assert.equal(harness.document.body.classList.classes.has("show-operate-workspace"), false);
  assert.equal(harness.document.body.classList.classes.has("drawer-open"), false);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, true);
  assert.doesNotMatch(harness.document.getElementById("console-panel-build").textContent, /Config Explain/);

  await releaseTab.click();
  assert.equal(harness.document.getElementById("console-panel-validate-release").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-config").hidden, true);
  assert.match(harness.document.getElementById("release-gate").textContent, /release candidate/);
  assert.match(harness.document.getElementById("release-gate").textContent, /Release gate/);
  assert.match(harness.document.getElementById("release-gate").textContent, /Quality signals/);
  assert.match(harness.document.getElementById("release-gate").textContent, /Evidence and export scope/);

  await designTab.click();
  assert.equal(harness.document.getElementById("console-panel-config").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), false);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, true);
  assert.match(harness.document.getElementById("project-wizard").textContent, /Quick actions/);
  assert.match(harness.document.getElementById("project-wizard").textContent, /Recent runs/);
  assert.ok(harness.document.getElementById("project-wizard").querySelectorAll(".project-home-main").length >= 1);

});

test("visualizer client sidebar toggle exposes expanded state", async () => {
  const harness = await createClientHarness({ search: "?lifecycle=run" });
  let sidebarToggle = harness.document.getElementById("sidebar-toggle");
  assert.equal(sidebarToggle.hidden, false);
  assert.equal(sidebarToggle.getAttribute("aria-controls"), "sidebar");
  assert.equal(sidebarToggle.getAttribute("aria-expanded"), "false");

  await sidebarToggle.click();
  sidebarToggle = harness.document.getElementById("sidebar-toggle");
  assert.equal(harness.document.body.classList.classes.has("drawer-open"), true);
  assert.equal(sidebarToggle.getAttribute("aria-expanded"), "true");

  await sidebarToggle.click();
  sidebarToggle = harness.document.getElementById("sidebar-toggle");
  assert.equal(harness.document.body.classList.classes.has("drawer-open"), false);
  assert.equal(sidebarToggle.getAttribute("aria-expanded"), "false");
});

test("visualizer client normalizes legacy lifecycle deep links onto the Run shell", async () => {
  const harness = await createClientHarness({ search: "?lifecycle=legacy" });
  const tabs = harness.document.getElementById("console-tabs").querySelectorAll("[data-console-tab]");
  const runTab = tabs.find((button) => button.getAttribute("data-console-tab") === "run");
  const legacyTab = tabs.find((button) => button.getAttribute("data-console-tab") === "legacy");
  assert.ok(runTab);
  assert.equal(legacyTab, undefined);
  assert.match(harness.window.location.search, /[?&]lifecycle=run/);
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), true);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, false);
});

test("visualizer client normalizes build deep links onto the Design shell", async () => {
  const harness = await createClientHarness({ search: "?lifecycle=build" });

  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-config").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, true);
  assert.match(harness.window.location.search, /[?&]lifecycle=design/);
  assert.doesNotMatch(harness.window.location.search, /[?&]runId=/);
});

test("visualizer client drops run-specific route state when restoring the Design shell", async () => {
  const harness = await createClientHarness({
    search: "?lifecycle=design&runId=run-123&reviewId=review-1&logRoleId=alpha&tail=25&since=2026-05-03T09%3A00"
  });

  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.match(harness.window.location.search, /[?&]lifecycle=design/);
  assert.doesNotMatch(harness.window.location.search, /[?&]runId=/);
  assert.doesNotMatch(harness.window.location.search, /[?&]reviewId=/);
  assert.doesNotMatch(harness.window.location.search, /[?&]logRoleId=/);
  assert.doesNotMatch(harness.window.location.search, /[?&]tail=/);
  assert.doesNotMatch(harness.window.location.search, /[?&]since=/);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/graph"), false);
});

test("visualizer client renders four tabs and navigates to Design with bridge refresh", async () => {
  const harness = await createClientHarness();
  const getTabs = () => harness.document.getElementById("console-tabs").querySelectorAll("[data-console-tab]");
  const getTab = (id) => getTabs().find((button) => button.getAttribute("data-console-tab") === id);

  assert.equal(getTabs().length, 4);
  assert.ok(getTab("project"));
  assert.ok(getTab("design"));
  assert.ok(getTab("run"));
  assert.ok(getTab("release"));

  await getTab("project").click();
  assert.equal(harness.document.getElementById("console-panel-project").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-build").hidden, true);
  assert.equal(getTab("project").getAttribute("aria-pressed"), "true");

  const bridgeCallsBefore = harness.backend.fetchCalls.filter((call) => call.path.includes("/studio/bridge")).length;
  await getTab("design").click();
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(getTab("design").getAttribute("aria-pressed"), "true");
  assert.match(harness.window.location.search, /lifecycle=design/);
  await waitForCondition(() =>
    harness.backend.fetchCalls.filter((call) => call.path.includes("/studio/bridge")).length > bridgeCallsBefore
  );
});

test("visualizer client loads logs on demand and keeps filter changes lazy until loaded", async () => {
  const harness = await createClientHarness();

  const logCallsBefore = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  assert.equal(logCallsBefore, 0);
  assert.match(harness.document.getElementById("logs").textContent, /Logs load on demand/);

  await harness.document.getElementById("log-tail").change("25");
  await settle();

  const logCallsAfterFilterOnly = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  assert.equal(logCallsAfterFilterOnly, 0);

  const loadLogsButton = harness.document.getElementById("load-logs");
  assert.ok(loadLogsButton);
  await loadLogsButton.click();
  await waitForCondition(() =>
    harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length >= 1
  );

  const logCallsAfterLoad = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  assert.ok(logCallsAfterLoad >= 1);
  assert.ok(
    harness.backend.fetchCalls.some((call) =>
      call.path.startsWith("/api/v1/runs/run-123/logs") && call.path.includes("tail=25")
    )
  );
  assert.match(harness.document.getElementById("logs").textContent, /engine and role traces|combined log stream/i);
});

test("visualizer client refreshes failure panels when switching runs", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ includeSecondRun: true })
  });

  const runButtons = harness.document.getElementById("run-list").querySelectorAll("[data-run-id]");
  const secondRunButton = runButtons.find((button) => button.getAttribute("data-run-id") === "run-456");
  assert.ok(secondRunButton);
  const initialStream = harness.eventSources.at(-1);
  assert.ok(initialStream);

  await secondRunButton.click();
  await settle();

  assert.equal(initialStream.closed, true);
  const replacementStream = harness.eventSources.at(-1);
  assert.ok(replacementStream);
  assert.notEqual(replacementStream, initialStream);
  assert.match(replacementStream.url, /run-456\/stream/);
  assert.match(harness.document.getElementById("detail").textContent, /run-456/);
  assert.match(harness.document.getElementById("failure-summary").textContent, /CONTRACT_VIOLATION/);
  assert.match(harness.document.getElementById("failure-detail").textContent, /citation-engineer/);
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456/failure"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456/resume-readiness"),
    true
  );
});

test("visualizer client clears stale run panels immediately when switching runs", async () => {
  const runFailureDeferredByRunId = { "run-456": createDeferred() };
  const delayedBackend = createBackend({ includeSecondRun: true, runFailureDeferredByRunId });
  const delayedHarness = await createClientHarness({ backend: delayedBackend });
  delayedHarness.document.getElementById("logs").innerHTML = '<div class="event"><strong>legacy log payload</strong></div>';
  delayedHarness.document.getElementById("failure-summary").innerHTML = '<div class="event"><strong>TOOL_EXECUTION_TIMEOUT</strong></div>';

  const runButtons = delayedHarness.document.getElementById("run-list").querySelectorAll("[data-run-id]");
  const secondRunButton = runButtons.find((button) => button.getAttribute("data-run-id") === "run-456");
  assert.ok(secondRunButton);
  const pendingSwitch = secondRunButton.click();
  await settle();

  assert.doesNotMatch(delayedHarness.document.getElementById("failure-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.doesNotMatch(delayedHarness.document.getElementById("logs").textContent, /legacy log payload/);

  runFailureDeferredByRunId["run-456"].resolve();
  await pendingSwitch;
  await settle();
});

test("visualizer client ignores stale SSE refreshes after switching runs", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ includeSecondRun: true })
  });

  const initialStream = harness.eventSources.at(-1);
  assert.ok(initialStream);

  const runButtons = harness.document.getElementById("run-list").querySelectorAll("[data-run-id]");
  const secondRunButton = runButtons.find((button) => button.getAttribute("data-run-id") === "run-456");
  assert.ok(secondRunButton);
  await secondRunButton.click();
  await settle();

  harness.backend.fetchCalls.length = 0;
  initialStream.emit({
    cursor: 3,
    record: {
      type: "runtime_error",
      at: "2026-04-23T09:16:30.000Z",
      roleId: "demo-analyst",
      errorCode: "E_STALE"
    }
  });
  await harness.flushTimers();

  assert.equal(initialStream.closed, true);
  assert.equal(harness.document.getElementById("timeline").innerHTML.includes("#3"), false);
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456"),
    false
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456/failure"),
    false
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456/resume-readiness"),
    false
  );
});

test("visualizer client ignores late run-detail responses from an older run selection", async () => {
  const runDetailDeferredByRunId = { "run-123": createDeferred() };
  const harness = await createClientHarness({
    backend: createBackend({ includeSecondRun: true, runDetailDeferredByRunId }),
    search: ""
  });

  const runButtons = harness.document.getElementById("run-list").querySelectorAll("[data-run-id]");
  const firstRunButton = runButtons.find((button) => button.getAttribute("data-run-id") === "run-123");
  const secondRunButton = runButtons.find((button) => button.getAttribute("data-run-id") === "run-456");
  assert.ok(firstRunButton);
  assert.ok(secondRunButton);

  const firstSelection = firstRunButton.click();
  await settle();
  const secondSelection = secondRunButton.click();
  await settle();
  await waitForCondition(() => /run-456/.test(harness.document.getElementById("detail").textContent));
  assert.match(harness.document.getElementById("detail").textContent, /run-456/);

  runDetailDeferredByRunId["run-123"].resolve();
  await firstSelection;
  await settle();

  assert.match(harness.document.getElementById("detail").textContent, /run-456/);

  await secondSelection;
  await waitForCondition(() => /run-456/.test(harness.document.getElementById("detail").textContent));
  assert.match(harness.document.getElementById("failure-summary").textContent, /CONTRACT_VIOLATION/);
  assert.doesNotMatch(harness.document.getElementById("failure-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
});

test("visualizer client review action captures audit input, disables controls while busy, and flashes success", async () => {
  const decisionDeferred = createDeferred();
  const harness = await createClientHarness({
    backend: createBackend({ decisionDeferred })
  });

  const approveButton = harness.document
    .getElementById("review-actions")
    .querySelectorAll("[data-review-action]")
    .find((button) => button.getAttribute("data-review-action") === "approve");
  assert.ok(approveButton);

  await approveButton.click();
  await settle();

  const actorInput = harness.document.getElementById("action-review-actor");
  const commentInput = harness.document.getElementById("action-review-comment");
  const submitButton = harness.document.getElementById("action-form-submit");
  assert.ok(actorInput);
  assert.ok(commentInput);
  assert.ok(submitButton);

  await actorInput.input("operator-a");
  await commentInput.input("looks good");

  const pendingClick = submitButton.click();
  await settle();

  assert.equal(harness.document.getElementById("refresh").disabled, true);
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.confirmCalls.length, 0);

  decisionDeferred.resolve();
  await pendingClick;
  await settle();

  assert.deepEqual(harness.backend.lastDecisionBody, {
    decision: "approve",
    actor: "operator-a",
    comment: "looks good"
  });
  assert.equal(
    harness.document.getElementById("flash").textContent,
    "Review action recorded for review-1: human-review-approved. Decision recorded in the control plane; runtime reconcile may still be pending."
  );
  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("recorded")
  );
});

test("visualizer client action failures stay local and show an error flash", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ failDecision: true })
  });

  const approveButton = harness.document
    .getElementById("review-actions")
    .querySelectorAll("[data-review-action]")
    .find((button) => button.getAttribute("data-review-action") === "approve");
  assert.ok(approveButton);

  await approveButton.click();
  await settle();
  await harness.document.getElementById("action-review-actor").input("operator-a");
  await harness.document.getElementById("action-review-comment").input("retry later");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.match(harness.document.getElementById("flash").textContent, /500 Internal Server Error/);
  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("pending")
  );
});

test("visualizer client resumes and stops runs through inline forms", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ runStatus: "running" })
  });

  await harness.document.getElementById("resume-run").click();
  await settle();
  await harness.document.getElementById("action-resume-input").input("resume with operator note");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.deepEqual(harness.backend.lastResumeBody, {
    systemPath: "system.mmd",
    input: "resume with operator note",
    dryRun: false,
    runtimePath: ".ogs/runtime.json",
    userProfilePath: ".ogs/user-profile.json",
    lawsPath: ".ogs/laws.json"
  });
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.confirmCalls.length, 0);

  await harness.document.getElementById("stop-run").click();
  await settle();
  await harness.document.getElementById("action-stop-reason").input("operator stop");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.deepEqual(harness.backend.lastStopBody, {
    reason: "operator stop"
  });
  assert.match(harness.document.getElementById("flash").textContent, /Stop request recorded/);
});

test("visualizer client keeps dry-run launch inline in Build and avoids opening the action dialog", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  await openDesignTab(harness);

  await waitForCondition(() => Boolean(findStudioSideTabButton(harness, "debug")));
  const debugTabButton = findStudioSideTabButton(harness, "debug");
  assert.ok(debugTabButton);
  await debugTabButton.click();
  await waitForCondition(() => Boolean(findWorkbenchStartRunButton(harness)));
  const dryRunButton = findWorkbenchStartRunButton(harness);
  assert.ok(dryRunButton);
  dryRunButton.focus();
  await dryRunButton.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-run-input")));

  const actionSection = harness.document.getElementById("action-form-section");
  assert.equal(actionSection.hidden, true);
  assert.equal(actionSection.getAttribute("role"), "dialog");
  assert.equal(actionSection.getAttribute("aria-modal"), "true");
  assert.equal(actionSection.getAttribute("aria-labelledby"), "action-form-title");
  assert.equal(actionSection.getAttribute("aria-hidden"), "true");
  assert.equal(harness.document.activeElement?.id, "workbench-run-input");
  assert.equal(harness.document.getElementById("workbench-run-runtime-path").value, ".ogs/runtime.json");
  assert.equal(harness.document.getElementById("workbench-run-user-profile-path").value, ".ogs/user-profile.json");
  assert.equal(harness.document.getElementById("workbench-run-laws-path").value, ".ogs/laws.json");

  for (const handler of harness.document.listeners.get("keydown") ?? []) {
    await handler({ key: "Escape", preventDefault() {} });
  }
  await settle();

  assert.equal(harness.document.getElementById("action-form-section").hidden, true);
  assert.equal(harness.document.getElementById("action-form-section").getAttribute("aria-hidden"), "true");
  assert.equal(harness.document.activeElement?.id, "workbench-run-input");
});

test("visualizer client appends SSE timeline entries and refreshes only targeted panels", async () => {
  const harness = await createClientHarness({
    decisionPhase: "recorded"
  });

  const loadDiagnosticsButton =
    harness.document.getElementById("load-diagnostics") ??
    harness.document.getElementById("resume-controls").children.find((child) => child.id === "load-diagnostics");
  assert.ok(loadDiagnosticsButton);
  await loadDiagnosticsButton.click();
  await settle();

  const stream = harness.eventSources.at(-1);
  assert.ok(stream);
  harness.backend.fetchCalls.length = 0;
  stream.emit({
    cursor: 2,
    record: {
      type: "human_review_requested",
      at: "2026-04-23T09:16:00.000Z",
      reviewId: "review-1",
      roleId: "demo-analyst",
      status: "pending"
    }
  });
  await harness.flushTimers();

  const logCallsAfter = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  const detailCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length;
  const reviewCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/reviews").length;
  const failureCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/failure").length;
  const readinessCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/resume-readiness").length;

  assert.ok(harness.document.getElementById("timeline").innerHTML.includes("#2"));
  assert.ok(harness.document.getElementById("failure-summary").textContent.includes("TOOL_EXECUTION_TIMEOUT"));
  assert.ok(harness.document.getElementById("resume-readiness").textContent.includes("resume blocked"));
  assert.equal(logCallsAfter, 0);
  assert.ok(detailCallsAfter > 0);
  assert.ok(reviewCallsAfter > 0);
  assert.equal(failureCallsAfter, 0);
  assert.ok(readinessCallsAfter > 0);
});

test("visualizer client requeues stream refresh plans that arrive during an in-flight refresh", async () => {
  const refreshDeferred = createDeferred();
  const harness = await createClientHarness({ decisionPhase: "recorded" });
  const originalHandle = harness.backend.handle.bind(harness.backend);
  let blockedDetailCalls = 0;
  harness.backend.handle = async (url, request = {}) => {
    const parsed = new URL(url, "http://visualizer.test");
    if (
      parsed.pathname === "/api/v1/runs/run-123" &&
      (request.method ?? "GET") === "GET" &&
      blockedDetailCalls === 0
    ) {
      blockedDetailCalls += 1;
      harness.backend.fetchCalls.push({ method: request.method ?? "GET", path: `${parsed.pathname}${parsed.search}`, body: request.body ?? null });
      await refreshDeferred.promise;
      return createResponse(buildRunFixture({
        runId: "run-123",
        reviewId: "review-1",
        runStatus: "stopped",
        decisionPhase: "recorded"
      }).detail);
    }
    return originalHandle(url, request);
  };
  const stream = harness.eventSources.at(-1);
  assert.ok(stream);

  harness.backend.fetchCalls.length = 0;
  stream.emit({
    cursor: 2,
    record: {
      type: "runtime_error",
      at: "2026-04-23T09:16:00.000Z",
      roleId: "demo-analyst",
      errorCode: "E_FIRST"
    }
  });
  await harness.flushTimers();
  await waitForCondition(() =>
    harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length >= 1
  );

  stream.emit({
    cursor: 3,
    record: {
      type: "human_review_requested",
      at: "2026-04-23T09:16:01.000Z",
      reviewId: "review-1",
      roleId: "demo-analyst",
      status: "pending"
    }
  });
  await settle();

  const detailCallsDuringFlight = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length;
  assert.equal(detailCallsDuringFlight, 1);

  refreshDeferred.resolve();
  await waitForCondition(() =>
    harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length >= 2
  );
  await harness.flushTimers();

  assert.ok(harness.document.getElementById("timeline").innerHTML.includes("#3"));
  assert.ok(
    harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/reviews").length >= 1
  );
  assert.ok(
    harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/resume-readiness").length >= 2
  );
});

test("visualizer client stream cursor index dedupes repeated SSE events", async () => {
  const harness = await createClientHarness({
    decisionPhase: "recorded"
  });

  const stream = harness.eventSources.at(-1);
  assert.ok(stream);
  const event = {
    cursor: 2,
    record: {
      type: "runtime_error",
      at: "2026-04-23T09:16:00.000Z",
      roleId: "demo-analyst",
      errorCode: "E_DUPLICATE"
    }
  };
  stream.emit(event);
  stream.emit(event);
  await harness.flushTimers();

  const timelineHtml = harness.document.getElementById("timeline").innerHTML;
  assert.equal(timelineHtml.match(/#2/g)?.length ?? 0, 1);
});

test("visualizer client keeps the workbench editor visible with source intact during validation", async () => {
  const harness = await createClientHarness();
  await openDesignTab(harness);

  const sourceTab = findWorkbenchViewButton(harness, "source");
  assert.ok(sourceTab);
  await sourceTab.click();
  await settle();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-new-draft")));

  const newDraftButton = harness.document.getElementById("workbench-new-draft");
  assert.ok(newDraftButton);
  await newDraftButton.click();
  await settle();

  const editor = harness.document.getElementById("workbench-editor");
  assert.ok(editor);

  await editor.input(
    [
      "flowchart TD",
      "%% system.id=viz.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "input -->|GO| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n")
  );
  await harness.flushTimers();

  const editorAfter = harness.document.getElementById("workbench-editor");
  assert.ok(editorAfter);
  assert.equal(editorAfter.value, editor.value);
});

test("visualizer client debounces workbench validation to the latest input", async () => {
  const harness = await createClientHarness();
  await openDesignTab(harness);

  const sourceTab = findWorkbenchViewButton(harness, "source");
  assert.ok(sourceTab);
  await sourceTab.click();
  await settle();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-editor")));

  const editor = harness.document.getElementById("workbench-editor");
  assert.ok(editor);
  const validateCallsBefore = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/project/system/validate").length;

  await editor.input("flowchart TD\nfirst");
  await editor.input("flowchart TD\nsecond");
  await editor.input("flowchart TD\nthird");
  await harness.flushTimers();

  const validateCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/project/system/validate").length;
  assert.equal(validateCallsAfter - validateCallsBefore, 1);
});

test("visualizer client dispose clears polling intervals and pending timers", async () => {
  const harness = await createClientHarness();
  const fetchCountBeforeTick = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs").length;

  harness.dispose();
  assert.equal(harness.intervals.size, 0);

  await harness.tickIntervals();
  await harness.flushTimers();

  const fetchCountAfterTick = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs").length;
  assert.equal(fetchCountAfterTick, fetchCountBeforeTick);
});

test("visualizer client applies timeline filters through the events API", async () => {
  const harness = await createClientHarness();

  const roleSelect = harness.document.getElementById("timeline-role");
  const typeInput = harness.document.getElementById("timeline-type");
  const applyButton = harness.document.getElementById("timeline-apply");

  assert.ok(roleSelect);
  assert.ok(typeInput);
  assert.ok(applyButton);

  await roleSelect.change("demo-analyst");
  await typeInput.input("human_review_requested");
  await applyButton.click();
  await settle();

  assert.ok(
    harness.backend.fetchCalls.some((call) =>
      call.path.includes("/api/v1/runs/run-123/events?") &&
      call.path.includes("roleId=demo-analyst") &&
      call.path.includes("type=human_review_requested")
    )
  );
  assert.ok(harness.document.getElementById("timeline").innerHTML.includes("filtered by"));
  assert.ok(!harness.document.getElementById("timeline").innerHTML.includes("runtime_error"));
});

test("visualizer client edits the Mermaid workbench, saves, and starts a run", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  await openDesignTab(harness);

  const sourceTab = findWorkbenchViewButton(harness, "source");
  assert.ok(sourceTab);
  await sourceTab.click();
  await settle();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-new-draft")));

  const newDraftButton = harness.document.getElementById("workbench-new-draft");
  assert.ok(newDraftButton);
  await newDraftButton.click();
  await settle();

  const editor = harness.document.getElementById("workbench-editor");
  assert.ok(editor);
  await editor.input(
    [
      "flowchart TD",
      "%% system.id=viz.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "input -->|GO| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n")
  );
  await harness.flushTimers();

  assert.ok(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/system/validate")
  );

  const saveButton = harness.document.getElementById("build-save");
  assert.ok(saveButton);
  await saveButton.click();
  await settle();

  assert.ok(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/system/save")
  );

  await waitForCondition(() => Boolean(findStudioSideTabButton(harness, "debug")));
  const debugTabButton = findStudioSideTabButton(harness, "debug");
  assert.ok(debugTabButton);
  await debugTabButton.click();
  await waitForCondition(() => Boolean(findWorkbenchStartRunButton(harness)));
  const dryRunButton = findWorkbenchStartRunButton(harness);
  assert.ok(dryRunButton);
  await dryRunButton.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-run-input")));
  await harness.document.getElementById("workbench-run-input").input("ship a smoke test");
  await harness.document.getElementById("workbench-start-run").click();
  await settle();

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"));
  assert.equal(harness.backend.lastStartBody.systemPath, "system.mmd");
  assert.equal(harness.backend.lastStartBody.input, "ship a smoke test");
  assert.equal(harness.backend.lastStartBody.runtimePath, ".ogs/runtime.json");
  assert.equal(harness.backend.lastStartBody.userProfilePath, ".ogs/user-profile.json");
  assert.equal(harness.backend.lastStartBody.lawsPath, ".ogs/laws.json");
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.document.getElementById("flash").textContent, "Start completed for run-123 (done).");
  assert.equal(
    harness.document.getElementById("console-tabs")
      .querySelectorAll("[data-console-tab]")
      .find((button) => button.getAttribute("data-console-tab") === "design")
      ?.getAttribute("aria-pressed"),
    "true"
  );
  assert.equal(
    harness.document.getElementById("console-tabs")
      .querySelectorAll("[data-console-tab]")
      .find((button) => button.getAttribute("data-console-tab") === "run")
      ?.getAttribute("aria-pressed"),
    "false"
  );
  assert.ok(findStudioSideTabButton(harness, "result"));
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
});

test("visualizer client blocks start run submit when run input is empty", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  await openDesignTab(harness);

  await waitForCondition(() => Boolean(findStudioSideTabButton(harness, "debug")));
  const debugTabButton = findStudioSideTabButton(harness, "debug");
  assert.ok(debugTabButton);
  await debugTabButton.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-run-input")));
  assert.equal(harness.document.getElementById("workbench-run-input").value, "");
  await harness.document.getElementById("workbench-start-run").click();
  await settle();
  assert.equal(harness.backend.lastStartBody, undefined);
  assert.match(harness.document.getElementById("flash").textContent, /Run input is required|运行输入为必填/);
  assert.match(harness.document.getElementById("workbench-body").textContent, /Run input|运行输入/);
});

test("visualizer client removes the separate dry-run action button and keeps Build navigation in footer tabs", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  await openDesignTab(harness);

  assert.equal(harness.document.getElementById("build-dry-run"), null);
  assert.equal(harness.document.getElementById("workbench-actions").textContent.trim(), "");
  const debugTabButton = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-side-tab=\"debug\"]")[0];
  assert.ok(debugTabButton);
  assert.ok(findWorkbenchViewButton(harness, "bridge"));
  assert.ok(findWorkbenchViewButton(harness, "source"));
  assert.equal(harness.document.getElementById("workbench-tabs").textContent, "");
});

test("visualizer client keeps the right-side shell mounted when switching between graph and source views", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  await openDesignTab(harness);

  const sourceViewButton = findWorkbenchViewButton(harness, "source");
  const graphViewButton = findWorkbenchViewButton(harness, "bridge");
  assert.ok(sourceViewButton);
  assert.ok(graphViewButton);

  await sourceViewButton.click();
  await settle();
  assert.equal(
    harness.document.getElementById("studio-graph-root").getAttribute("data-workbench-root-mode"),
    "source"
  );
  assert.ok(harness.document.getElementById("workbench-editor"));
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-side-tab=\"debug\"]").length);
  await graphViewButton.click();
  await settle();
  assert.equal(
    harness.document.getElementById("studio-graph-root").getAttribute("data-workbench-root-mode"),
    "bridge"
  );

  assert.equal(harness.document.getElementById("action-form-section").hidden, true);
  assert.equal(harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/start").length, 0);
});

test("visualizer client opens Studio Bridge and keeps authoring affordances on the graph shell", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };
  const latestEditableMount = () =>
    mountCalls.findLast((call) => typeof call.options.onApplyCanvas === "function")?.options;
  const latestReadonlyMount = () =>
    mountCalls.findLast((call) => call.root.id === "run-graph-root");

  await openDesignTab(harness);
  const bridgeTab = findWorkbenchViewButton(harness, "bridge");
  assert.ok(bridgeTab);

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/bridge"));
  assert.match(harness.document.getElementById("workbench-body").textContent, /demo-analyst|nothing selected/i);
  assert.equal(harness.document.getElementById("workbench-tabs").textContent, "");
  assert.match(harness.document.getElementById("workbench-body").textContent, /demo-analyst|nothing selected/i);
  assert.match(harness.document.getElementById("workbench-body").textContent, /Browse|检索/);
  assert.ok(findStudioSideTabButton(harness, "structure"));
  assert.ok(findStudioSideTabButton(harness, "logs"));
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-role-id]").length > 0);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-flow-key]").length > 0);
  assert.match(harness.document.getElementById("workbench-status").textContent, /disk in sync/i);
  assert.match(harness.document.getElementById("workbench-status").textContent, /validation ok/i);
  assert.match(harness.document.getElementById("workbench-status").textContent, /demo-analyst/i);
  assert.doesNotMatch(harness.document.getElementById("workbench-body").textContent, /\bX6\b/);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]").length);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-list-mode]").length);
  assert.equal(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-fullscreen]").length, 0);
  assert.equal(harness.document.getElementById("build-generate-mermaid"), null);
  assert.equal(harness.document.getElementById("build-dry-run"), null);
  assert.ok(harness.document.getElementById("studio-graph-root"));
  assert.equal(mountCalls.length > 0, true);
  assert.ok(latestEditableMount().rolePackages);
  assert.ok(latestEditableMount().readiness);
  assert.ok(latestEditableMount().bindings);
  assert.ok(latestEditableMount().projectConfig);
  assert.ok(latestEditableMount().commandFormLabels);
  assert.equal(typeof latestEditableMount().onValidateWorkbench, "function");
  assert.equal(typeof latestEditableMount().onSaveWorkbench, "function");
  assert.equal(typeof latestEditableMount().onQuickDebugRun, "function");
  assert.equal(typeof latestEditableMount().onFocusDebugInput, "function");
  assert.equal(latestEditableMount().defaultAutoLayout, true);
  assert.equal(latestEditableMount().labels.viewportGroup, "Viewport");
  assert.equal(latestEditableMount().labels.editGroup, "Edit graph");
  assert.equal(latestEditableMount().labels.fullscreen, "Fullscreen");
  assert.equal(latestEditableMount().labels.debugRun, "Quick debug");
  latestEditableMount().onSelectRole("demo-analyst");
  await settle();
  assert.equal(
    harness.document.getElementById("studio-graph-root").dataset.selectedRoleId,
    "demo-analyst"
  );
  const roleSelectionButton = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-role-id]")[0];
  assert.ok(roleSelectionButton);
  await roleSelectionButton.click();
  await settle();
  await settle();
  const fetchCallsAfterOpen = harness.backend.fetchCalls.length;
  latestEditableMount().onSelectFlow("demo-analyst:DONE:output");
  await settle();
  assert.equal(harness.backend.fetchCalls.length, fetchCallsAfterOpen);
  assert.equal(
    harness.document.getElementById("studio-graph-root").dataset.selectedFlowKey,
    "demo-analyst:DONE:output"
  );
  assert.equal(
    harness.document.getElementById("studio-graph-root").dataset.selectedRoleId,
    ""
  );
  mountCalls.at(-1).options.onClearSelection();
  await settle();
  assert.equal(harness.backend.fetchCalls.length, fetchCallsAfterOpen);
  latestEditableMount().onToggleFullscreen();
  await settle();
  assert.match(harness.document.getElementById("workbench-body").innerHTML, /studio-canvas-shell/);
  assert.equal(latestEditableMount().labels.fullscreen, "Exit fullscreen");
  const filterInput = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]")[0];
  assert.ok(filterInput);
  await filterInput.input("missing-role");
  await settle();
  assert.equal(filterInput.value, "missing-role");
  for (const oldButtonId of [
    "studio-bridge-add-role",
    "studio-bridge-add-edge",
    "studio-bridge-delete-role",
    "studio-bridge-fit",
    "studio-bridge-nudge-left",
    "studio-bridge-nudge-right",
    "studio-bridge-save-draft",
    "studio-bridge-generate",
    "studio-bridge-save",
    "workbench-save-as",
    "studio-bridge-validate",
    "studio-bridge-dry-run",
    "workbench-save"
  ]) {
    assert.equal(harness.document.getElementById(oldButtonId), null);
  }

  mountCalls.length = 0;
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };
  const runTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "run");
  assert.ok(runTab);
  await runTab.click();
  await settle();
  const runButton = harness.document.getElementById("run-list")
    .querySelectorAll("[data-run-id]")
    .find((button) => button.getAttribute("data-run-id") === "run-123");
  assert.ok(runButton);
  await runButton.click();
  const graphOperateTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "graph");
  assert.ok(graphOperateTab);
  await graphOperateTab.click();
  await waitForCondition(() => Boolean(latestReadonlyMount()), 80);
  const readonlyMount = latestReadonlyMount();
  assert.ok(readonlyMount);
  assert.equal(readonlyMount.options.readOnly, true);
  assert.equal(readonlyMount.options.onApplyCanvas, undefined);
  assert.equal(readonlyMount.options.onApplyCommand, undefined);
  assert.doesNotMatch(harness.document.getElementById("graph-view").textContent, /\bX6\b/);
  const designTabButton = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  assert.ok(designTabButton);
  await designTabButton.click();
  await settle();
  const resetFilterInput = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]")[0];
  if (resetFilterInput) {
    await resetFilterInput.input("");
    await settle();
  }
  const designTabAfterRunGraph = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  assert.ok(designTabAfterRunGraph);
  await designTabAfterRunGraph.click();
  await settle();
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, true);
  assert.equal(harness.document.getElementById("action-form-section").hidden, true);
  assert.ok(findWorkbenchViewButton(harness, "bridge"));
  assert.equal(findWorkbenchViewButton(harness, "bridge").getAttribute("aria-pressed"), "true");
  assert.equal(harness.document.getElementById("workbench-tabs").textContent, "");
  assert.match(harness.document.getElementById("workbench-body").textContent, /Browse|检索/i);
  await bridgeTab.click();
  await settle();

  let latestMount = latestEditableMount();
  assert.ok(latestMount);
  assert.equal(latestMount.readOnly, false);
  await latestMount.onApplyCanvas({
    ...latestMount.canvas,
    nodes: latestMount.canvas.nodes.map((node) =>
      node.roleId === "demo-analyst" ? { ...node, x: 160 } : node
    )
  });
  await settle();
  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/authoring/apply-canvas"));
  assert.equal(harness.backend.lastAuthoringApplyCanvasBody.authoring.layout.nodes["demo-analyst"].x, 160);
  assert.match(harness.document.getElementById("flash").textContent, /Studio canvas layout updated/);

  latestMount = latestEditableMount();
  assert.ok(latestMount);
  const addRoleAuthoring = cloneJson(latestMount.authoring);
  const addRoleCanvas = cloneJson(latestMount.canvas);
  addRoleAuthoring.roles["new-role"] = { roleId: "new-role", title: "New role", bindingKind: "exec", profileId: "profile.new-role" };
  addRoleAuthoring.layout.nodes["new-role"] = { x: 380, y: 120, width: 180, height: 84 };
  addRoleCanvas.nodes.push({
    id: "new-role",
    roleId: "new-role",
    x: 380,
    y: 120,
    width: 180,
    height: 84,
    label: "New role",
    badges: [],
    bindingKind: "exec"
  });
  await latestMount.onApplyCommand({
    authoring: addRoleAuthoring,
    canvas: addRoleCanvas,
    selectedRoleId: "new-role",
    profileDrafts: [{ profileId: "profile.new-role", toolRef: "tool.new-role", timeoutMs: 30000 }],
    toolDrafts: [{ toolRef: "tool.new-role", runner: "local_shell", command: "node", argsTemplate: ["scripts/console-print.mjs"], stdinMode: "text" }]
  });
  await settle();
  assert.equal(harness.backend.lastExecutionConfigUpsertBody.profiles[0].profileId, "profile.new-role");
  assert.equal(harness.backend.lastExecutionConfigUpsertBody.tools[0].toolRef, "tool.new-role");
  assert.equal(harness.backend.lastAuthoringApplyCanvasBody.authoring.roles["new-role"].bindingKind, "exec");
  assert.equal(
    Object.hasOwn(harness.backend.lastAuthoringApplyCanvasBody.authoring.layout.nodes, "new-role"),
    true
  );

  latestEditableMount().onSelectRole("new-role");
  await settle();
  const debugTabButton = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-side-tab=\"debug\"]")[0];
  assert.ok(debugTabButton);
  assert.equal(debugTabButton.getAttribute("data-studio-side-tab"), "debug");

  await latestEditableMount().onQuickDebugRun("run from graph toolbar");
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"));
  assert.equal(harness.backend.lastStartBody.input, "run from graph toolbar");
  assert.match(harness.document.getElementById("workbench-body").textContent, /Logs|日志/i);
  assert.match(harness.document.getElementById("workbench-body").textContent, /Structured trace|结构化轨迹/i);
  assert.match(harness.document.getElementById("workbench-body").textContent, /Open Run|Go to Run|打开运行|前往运行/i);
  assert.doesNotMatch(harness.document.getElementById("workbench-body").textContent, /Results keeps the latest dry-run projection compact and scannable/i);
  const logsTabButton = findStudioSideTabButton(harness, "logs");
  assert.ok(logsTabButton);
  assert.equal(logsTabButton.getAttribute("data-studio-side-tab"), "logs");
  await latestEditableMount().onFocusDebugInput();
  await waitForCondition(() => Boolean(harness.document.getElementById("workbench-run-input")));
  assert.equal(harness.document.activeElement?.id, "workbench-run-input");
});

test("visualizer client retries Studio graph mount until the Build panel is visible and sized", async () => {
  const harness = await createClientHarness();
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({
      width: typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect().width : null,
      height: typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect().height : null,
      selectedRoleId: options.selectedRoleId || ""
    });
  };

  await openDesignTab(harness);
  const initialMountCalls = mountCalls.length;
  const buildPanel = harness.document.getElementById("console-panel-build");
  assert.ok(buildPanel);
  buildPanel.hidden = true;
  const bridgeButton = findWorkbenchViewButton(harness, "bridge");
  assert.ok(bridgeButton);
  await bridgeButton.click();
  await settle();
  assert.equal(mountCalls.length, initialMountCalls);

  buildPanel.hidden = false;
  const graphRoot = harness.document.getElementById("studio-graph-root");
  assert.ok(graphRoot);
  graphRoot.getBoundingClientRect = () => ({ width: 640, height: 480, top: 0, left: 0, right: 640, bottom: 480 });
  await harness.flushTimers();
  assert.ok(mountCalls.length > initialMountCalls);
});

test("visualizer client retries readonly run graph mount until the Graph panel is visible and sized", async () => {
  const harness = await createClientHarness();
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({
      rootId: root.id,
      readOnly: Boolean(options.readOnly),
      width: typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect().width : null,
      height: typeof root.getBoundingClientRect === "function" ? root.getBoundingClientRect().height : null
    });
  };

  const runTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "run");
  assert.ok(runTab);
  await runTab.click();
  await settle();

  const graphTab = harness.document.getElementById("operate-tabs")
    .querySelectorAll("[data-operate-tab]")
    .find((button) => button.getAttribute("data-operate-tab") === "graph");
  assert.ok(graphTab);
  const initialRunGraphMountCalls = mountCalls.filter((call) => call.rootId === "run-graph-root").length;
  const runGraphRoot = harness.document.getElementById("run-graph-root");
  assert.ok(runGraphRoot);
  runGraphRoot.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 });

  await graphTab.click();
  await settle();
  assert.equal(mountCalls.filter((call) => call.rootId === "run-graph-root").length, initialRunGraphMountCalls);

  runGraphRoot.getBoundingClientRect = () => ({ width: 720, height: 420, top: 0, left: 0, right: 720, bottom: 420 });
  await graphTab.click();
  await settle();
  await harness.flushTimers();

  const readonlyMount = mountCalls.findLast((call) => call.rootId === "run-graph-root");
  assert.ok(readonlyMount);
  assert.equal(readonlyMount.readOnly, true);
  assert.equal(readonlyMount.width, 720);
  assert.equal(readonlyMount.height, 420);
});

test("visualizer client sends chat-to-MMD context and applies a validated authoring patch", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };

  await openDesignTab(harness);
  await waitForCondition(() => Boolean(harness.document.getElementById("studio-chat-input")));

  const latestEditableMount = () =>
    mountCalls.findLast((call) => typeof call.options.onApplyCanvas === "function")?.options;
  const latestMount = latestEditableMount();
  assert.ok(latestMount);
  latestMount.onSelectRole("demo-analyst");
  await settle();

  const input = harness.document.getElementById("studio-chat-input");
  assert.ok(input);
  await input.input("Add a QA review role after the analyst.");
  await harness.document.getElementById("studio-chat-send").click();
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/chat"));

  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/chat/mmd"),
    false
  );
  assert.equal(harness.backend.lastStudioChatBody.message, "Add a QA review role after the analyst.");
  assert.equal(harness.backend.lastStudioChatBody.selectedRoleId, "demo-analyst");
  assert.ok(harness.backend.lastStudioChatBody.authoring);
  assert.match(harness.backend.lastStudioChatBody.systemSource, /viz\.review\.demo/);
  await waitForCondition(() => harness.document.getElementById("studio-chat-apply")?.disabled === false);

  const applyButton = harness.document.getElementById("studio-chat-apply");
  assert.ok(applyButton);
  await applyButton.click();
  await waitForCondition(() => /Chat draft applied/.test(harness.document.getElementById("flash").textContent));

  assert.match(harness.document.getElementById("flash").textContent, /Chat draft applied/);
  assert.ok(latestEditableMount().authoring.roles["qa-reviewer"]);
  assert.equal(latestEditableMount().authoring.flows["2:demo-analyst:REVIEW:qa-reviewer"].label, "进入复核");
  assert.ok(latestEditableMount().canvas.nodes.some((node) => node.roleId === "qa-reviewer"));
  assert.ok(latestEditableMount().canvas.edges.some((edge) => edge.eventType === "REVIEW" && edge.label === "进入复核"));
  const sourceTab = findWorkbenchViewButton(harness, "source");
  assert.ok(sourceTab);
  await sourceTab.click();
  await settle();
  await waitForCondition(() => /qa-reviewer/.test(harness.document.getElementById("workbench-body").textContent));
  assert.match(harness.document.getElementById("workbench-body").textContent, /qa-reviewer/);
});

test("visualizer client blocks chat-to-MMD apply when preview validation fails", async () => {
  const harness = await createClientHarness({
    readinessCanDryRun: true,
    studioChatValidationBlocked: true
  });

  const designTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  assert.ok(designTab);
  await designTab.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("studio-chat-input")));

  const input = harness.document.getElementById("studio-chat-input");
  await input.input("Generate an invalid draft.");
  await harness.document.getElementById("studio-chat-send").click();
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/chat"));

  assert.equal(harness.backend.lastStudioChatBody.message, "Generate an invalid draft.");
  const applyButton = harness.document.getElementById("studio-chat-apply");
  assert.ok(applyButton);
  assert.equal(applyButton.disabled, true);
  await applyButton.click();
  await settle();
  assert.doesNotMatch(harness.document.getElementById("flash").textContent, /Chat draft applied/);
});

test("visualizer client surfaces chat-to-MMD dependency errors", async () => {
  const harness = await createClientHarness({
    readinessCanDryRun: true,
    studioChatError: {
      message: "Studio Chat to MMD cannot reach the configured OpenAI provider. Check OPENAI_API_KEY or the OpenCode provider apiKey configuration, then retry."
    }
  });

  const designTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  await designTab.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("studio-chat-input")));

  await harness.document.getElementById("studio-chat-input").input("增加一个审核角色");
  await harness.document.getElementById("studio-chat-send").click();
  await waitForCondition(() => /OPENAI_API_KEY|OpenCode provider/.test(harness.document.getElementById("flash").textContent));

  assert.equal(harness.backend.lastStudioChatBody.message, "增加一个审核角色");
  assert.match(harness.document.getElementById("flash").textContent, /OPENAI_API_KEY|OpenCode provider/);
});

test("visualizer client times out chat-to-MMD requests with an actionable message", async () => {
  const deferred = createRejectableDeferred();
  const harness = await createClientHarness({
    readinessCanDryRun: true,
    studioChatDeferred: deferred
  });

  const designTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  await designTab.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("studio-chat-input")));

  await harness.document.getElementById("studio-chat-input").input("增加一个审核角色");
  await harness.document.getElementById("studio-chat-send").click();
  await waitForCondition(() => harness.timerDelays.includes(60000));
  await harness.flushTimers();
  await waitForCondition(() => /OpenCode provider|OPENAI_API_KEY|network/.test(harness.document.getElementById("flash").textContent));

  assert.match(harness.document.getElementById("flash").textContent, /OpenCode provider|OPENAI_API_KEY|network/);
});

test("visualizer client can close a pending chat-to-MMD request", async () => {
  const deferred = createDeferred();
  const harness = await createClientHarness({
    readinessCanDryRun: true,
    studioChatDeferred: deferred
  });

  const designTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "design");
  await designTab.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("studio-chat-input")));

  await harness.document.getElementById("studio-chat-input").input("增加一个审核角色");
  await harness.document.getElementById("studio-chat-send").click();
  await waitForCondition(() => /正在生成|Generating Studio draft/.test(harness.document.getElementById("workbench-body").textContent));
  assert.equal(harness.document.getElementById("studio-chat-close").disabled, false);

  await harness.document.getElementById("studio-chat-close").click();
  await settle();
  assert.doesNotMatch(harness.document.getElementById("workbench-body").textContent, /正在生成|Generating Studio draft/);
  assert.doesNotMatch(harness.document.getElementById("flash").textContent, /cancelled/i);

  deferred.resolve(createResponse({
    mode: "draft",
    sessionId: "late-chat",
    summary: "Late response.",
    questions: [],
    assumptions: [],
    warnings: [],
    previewMermaid: "",
    validation: { project: { ok: true, diagnostics: [] } },
    authoringPatch: null,
    actions: [],
    context: { referencedRoles: [], unresolvedItems: [] }
  }));
  await settle();
  assert.doesNotMatch(harness.document.getElementById("workbench-body").textContent, /Late response/);
});

test("visualizer client keeps project navigation local and reindexes through inline forms", async () => {
  const harness = await createClientHarness();

  assert.equal(harness.document.getElementById("project-load"), null);
  assert.equal(harness.document.getElementById("project-open-form"), null);
  assert.equal(harness.document.getElementById("project-open-workdir"), null);
  assert.equal(harness.document.getElementById("project-wizard").textContent.includes("Open Project"), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path.startsWith("/api/v1/project/browse")), false);
  assert.equal(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/load"), false);

  const reindexButton = harness.document.getElementById("hero-reindex");
  assert.ok(reindexButton);
  await waitForCondition(() => harness.document.getElementById("hero-reindex")?.disabled === false);
  await reindexButton.click();
  await waitForCondition(() => Boolean(harness.document.getElementById("action-form-submit")));
  await harness.document.getElementById("action-form-submit").click();
  await waitForCondition(() => harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/reindex"));

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/reindex"));
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.confirmCalls.length, 0);
});

test("visualizer client shows minimal current-directory initializer before initialization", async () => {
  const harness = await createClientHarness({
    workspace: {
      workdir: "/tmp/blank",
      exists: true,
      isDirectory: true,
      hasProject: false,
      state: "empty",
      entryCount: 0,
      canInitialize: true,
      controlledPathConflicts: []
    }
  });

  await waitForCondition(() => /Initialize current directory|Project name/i.test(harness.document.getElementById("project-wizard").textContent));
  assert.match(harness.document.getElementById("project-wizard").textContent, /Current directory|workdir/i);
  assert.match(harness.document.getElementById("project-wizard").textContent, /Initialize current directory/i);
  assert.match(harness.document.getElementById("project-wizard").textContent, /Hello World/i);
  assert.match(harness.document.getElementById("project-wizard").textContent, /Advanced features/i);
  assert.equal(harness.document.getElementById("project-wizard-next"), null);
  assert.equal(harness.document.getElementById("project-wizard-back"), null);
  assert.equal(
    [...harness.document.dynamicElements].some((child) => child.attributes.name === "projectName"),
    true
  );
  assert.equal(
    [...harness.document.dynamicElements].some((child) => child.attributes.name === "projectId"),
    false
  );
  const projectNameInput = [...harness.document.dynamicElements]
    .find((child) => child.attributes.name === "projectName");
  assert.ok(projectNameInput);
  assert.equal(projectNameInput.value, "blank");
});
