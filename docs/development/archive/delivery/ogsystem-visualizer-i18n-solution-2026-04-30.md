# OGSystem Visualizer Internationalization Solution

Date: 2026-04-30
Status: implemented
Scope: 为 OGSystem Visualizer / Studio Bridge / Run Console / Ops / Config / Logs / Artifacts 增加中文等多语言支持，同时保持 runtime、parser、compiler、artifact schema 和诊断语义稳定。

## 0. Delivery Record

本方案已在 2026-04-30 落地首批实现：

- 新增 `src/visualizer/i18n/`，支持 `en` 与 `zh-CN` 字典、locale canonicalization、`Accept-Language` 解析、纯文本 `t()` 和插值。
- server 首屏按 `?lang` -> `Accept-Language` -> `en` 解析 locale，并渲染 `<html lang>`、title、shell 文案和初始字典。
- client 按 `?lang` -> `localStorage` -> injected server locale -> `en` 解析 locale；Phase 1 语言切换写入 `ogs.visualizer.lang` 并通过 `?lang=<locale>` 刷新页面。
- 当 URL 没有 `?lang`、但 `localStorage` locale 与 server 注入 locale 不一致时，client 会保留现有 query state 并重定向到 `?lang=<storedLocale>`，避免 server shell 与 client 动态 UI 出现中英混杂首屏。
- inline app 继续作为控制面，renderer 只通过参数接收 `t`，不依赖闭包里的 i18n import。
- `t()` 只返回纯文本；写入 HTML 的位置继续使用现有 `escapeText()` / `escapeHtml()`。
- 只翻译 panel chrome、导航、按钮、空状态、筛选、统计标签等 UI 文案；runtime 返回的 message、errorCode、roleId、runId、eventType、schema path、raw JSON 等机器事实保持原样。
- Studio X6 独立 bundle 不 import `src/visualizer/i18n/**`；shell 在 `mountStudioX6Bridge(root, options)` 时用现有 `t()` 注入 `labels`。X6 toolbar/status/empty/toast/confirm 文案均走该 labels 边界，命令层只返回 `blockedCode` 等机器码。
- 已补充 `tests/visualizer-i18n.test.mjs`、client locale/switch 测试和 server 首屏 locale 测试。

验证：

- `pnpm run build && node --test tests/visualizer-i18n.test.mjs tests/visualizer-client.test.mjs tests/visualizer.test.mjs`
- `pnpm run test:visualizer`
- `pnpm test`
- Browser smoke: `pnpm exec playwright screenshot --wait-for-timeout=1500 'http://127.0.0.1:<port>/?lang=zh-CN' /tmp/ogsystem-visualizer-i18n-zh-after.png`
- X6 bundle boundary: `pnpm run test:studio-import-guardrails`
- X6 graph interaction/i18n smoke: `pnpm run test:visualizer-browser`

## 1. Goal

OGSystem Visualizer 需要支持中文等语言，让用户可以用本地语言操作 Studio、Run Debug、Project、Ops、Config、Logs、Artifacts 等界面。

本方案目标：

- 支持 `en` 和 `zh-CN` 作为首批语言。
- 后续可扩展到其他语言，例如 `ja`、`ko`、`fr`、`de`。
- UI 文案可翻译。
- 系统事实、机器语义和 runtime contract 不翻译。
- 不影响 `src/runtime/*`、parser、compiler 和 CLI 执行语义。
- 不改变 run artifact、error envelope、system.mmd、contract schema。

## 2. Non-Goals

以下内容不做翻译：

- `roleId`
- `runId`
- `reviewId`
- `branchId`
- `eventType`
- `errorCode`
- `errorCategory`
- `contractId`
- schema path
- model id
- profile id
- `system.mmd` source
- Mermaid metadata key，例如 `join.mode.*`、`review.*`、`context.map.*`
- raw JSON payload
- runtime artifact 文件名和字段名

原因：这些字段是机器语义、可审计事实或可复制调试对象，翻译会破坏定位、搜索、diff、resume、doctor 和外部工具联动。

## 3. Language Resolution

语言解析必须区分 server 首屏和 client 后续状态。

Server 首屏无法读取 `localStorage`，因此 server 优先级为：

```text
URL ?lang=zh-CN
-> Accept-Language
-> en
```

Client 优先级为：

```text
URL ?lang=zh-CN
-> localStorage ogs.visualizer.lang
-> injected server locale
-> en
```

规则：

- `?lang=zh-CN` 显式覆盖所有来源。
- server 只使用 query 和 `Accept-Language`。
- client 可以读取 `localStorage`。
- server 首屏渲染可根据 query / `Accept-Language` 注入初始 locale。
- 不支持的 locale fallback 到 `en`。

首批 locale：

```ts
type Locale = "en" | "zh-CN";
```

## 4. Module Layout

建议新增：

```text
src/visualizer/i18n/
  index.ts
  en.ts
  zh-CN.ts
```

职责：

- `index.ts`
  - 定义 `Locale`
  - 定义 `MessageKey`
  - 暴露 `resolveLocale`
  - 暴露 `getDictionary`
  - 暴露 `createTranslator`

- `en.ts`
  - 英文字典
  - 作为 fallback truth

- `zh-CN.ts`
  - 简体中文字典
  - key 必须与 `en.ts` 对齐

## 5. Message Key Design

使用稳定 key，不使用英文原文作为 key。

推荐 key 命名：

```text
namespace.surface.intent
```

示例：

```ts
export type MessageKey =
  | "app.title"
  | "app.local"
  | "nav.project"
  | "nav.runDebug"
  | "nav.ops"
  | "nav.config"
  | "nav.logs"
  | "nav.artifacts"
  | "action.refresh"
  | "action.cancel"
  | "action.save"
  | "studio.openBridge"
  | "studio.addRole"
  | "studio.deleteRole"
  | "studio.addEdge"
  | "studio.generateMmd"
  | "studio.saveDraft"
  | "studio.dryRun"
  | "logs.load"
  | "logs.refresh"
  | "logs.loadMore"
  | "readiness.ready"
  | "readiness.blocked"
  | "artifacts.summary"
  | "artifacts.metrics"
  | "artifacts.state"
  | "artifacts.raw";
```

不要把动态数据放进 key：

```text
Bad:
"run ${runId} failed"

Good:
t("run.failed", { runId })
```

## 6. Dictionary Shape

推荐使用 plain object，便于内联到当前 visualizer 页面。

```ts
export const en = {
  "app.title": "OGSystem Visualizer",
  "app.local": "local",
  "nav.project": "Project",
  "nav.runDebug": "Run Debug",
  "nav.ops": "Ops",
  "nav.config": "Config",
  "nav.logs": "Logs",
  "nav.artifacts": "Artifacts",
  "studio.openBridge": "Open Studio Bridge",
  "studio.addRole": "Add role",
  "studio.deleteRole": "Delete role",
  "studio.addEdge": "Add edge",
  "studio.generateMmd": "Generate MMD",
  "studio.saveDraft": "Save Draft",
  "studio.dryRun": "Dry Run",
  "logs.loadMore": "Load more",
  "readiness.ready": "ready",
  "readiness.blocked": "blocked"
} as const;
```

```ts
export const zhCN = {
  "app.title": "OGSystem 可视化控制台",
  "app.local": "本地",
  "nav.project": "项目",
  "nav.runDebug": "运行调试",
  "nav.ops": "运维",
  "nav.config": "配置",
  "nav.logs": "日志",
  "nav.artifacts": "产物",
  "studio.openBridge": "打开 Studio Bridge",
  "studio.addRole": "新增角色",
  "studio.deleteRole": "删除角色",
  "studio.addEdge": "新增连线",
  "studio.generateMmd": "生成 MMD",
  "studio.saveDraft": "保存草稿",
  "studio.dryRun": "试运行",
  "logs.loadMore": "加载更多",
  "readiness.ready": "就绪",
  "readiness.blocked": "阻塞"
} as const;
```

## 7. Translator API

推荐 API：

```ts
export function createTranslator(locale: Locale) {
  const dict = getDictionary(locale);
  const fallback = getDictionary("en");

  return function t(
    key: MessageKey,
    vars?: Record<string, string | number | boolean | null | undefined>
  ): string {
    const template = dict[key] ?? fallback[key] ?? key;
    return interpolate(template, vars);
  };
}
```

插值规则：

```ts
t("run.started", { runId: "20260430-abc" })
```

模板：

```ts
"run.started": "Run {runId} started"
"run.started": "运行 {runId} 已启动"
```

约束：

- `t()` 只返回纯文本。
- `t()` 不负责 HTML escape。
- renderer 在写入 HTML 字符串时继续使用现有 `escapeText()`。
- `textContent` 场景直接使用 `t()` 返回值。
- HTML 场景使用 `escapeText(t(...))`。
- 不允许把 HTML 字符串放进字典。
- 如果需要链接或按钮，renderer 负责拼 HTML，字典只提供纯文本 label。
- 测试必须覆盖翻译插值最终渲染不能注入 HTML。

原因：

- 如果 `t()` 内部 escape，`textContent` 场景可能显示实体文本。
- 如果 renderer 和 `t()` 都 escape，HTML 场景可能双重 escape。
- 单一规则更稳：翻译层只产出纯文本，渲染层负责上下文 escape。

## 8. Server Integration

`server.ts` 应解析 locale：

```ts
function resolveRequestLocale(request: IncomingMessage, url: URL): Locale {
  const queryLang = url.searchParams.get("lang");
  if (isSupportedLocale(queryLang)) {
    return queryLang;
  }

  const acceptLanguage = request.headers["accept-language"];
  return resolveLocaleFromAcceptLanguage(acceptLanguage) ?? "en";
}
```

`renderPageHtml` 增加参数：

```ts
renderPageHtml(workdir, apiPrefix, {
  locale,
  messages: getDictionary(locale)
});
```

页面上设置：

```html
<html lang="zh-CN">
```

并注入：

```js
const INITIAL_LOCALE = "zh-CN";
const I18N_MESSAGES = {...};
```

## 9. Client Integration

`buildClientAppScript` 增加参数：

```ts
export function buildClientAppScript(
  apiPrefix: string,
  i18n: {
    locale: Locale;
    messages: Record<string, string>;
  }
): string
```

client 内部：

```js
const state = {
  locale: INITIAL_LOCALE,
  messages: I18N_MESSAGES,
  ...
};

function t(key, vars) {
  const template = state.messages[key] || key;
  return interpolate(template, vars);
}
```

renderer 调用：

```ts
renderStudioBridgePanel({
  ...args,
  t
});
```

当前架构约束：

- `client-renderers.ts` 的函数会通过 `buildClientAppScript()` 使用 `function.toString()` 内联到页面。
- renderer 不能依赖闭包里的 i18n module import。
- renderer 只能通过参数接收 `t`。
- 注入到页面的 client script 负责创建 `t()` 并传给 renderer。
- 任何 helper 如果被 renderer 调用，也必须通过 `toString()` 注入或作为参数传入。

为了减少一次性改动，可以先让 renderer 仍兼容无 `t`：

```ts
const tr = args.t ?? ((key: string, fallback?: string) => fallback ?? key);
```

## 10. UI Language Switcher

建议在 hero toolbar 或 settings 区增加语言选择：

```html
<select id="locale-select" class="select">
  <option value="en">English</option>
  <option value="zh-CN">简体中文</option>
</select>
```

切换策略分阶段。

### Phase 1: URL Refresh

Phase 1 直接通过 URL 刷新切换语言，避免引入 locale API 和双语首屏字典。

切换行为：

```js
localeSelect.addEventListener("change", (event) => {
  const nextLocale = event.target.value;
  localStorage.setItem("ogs.visualizer.lang", nextLocale);
  const url = new URL(window.location.href);
  url.searchParams.set("lang", nextLocale);
  window.location.href = url.toString();
});
```

优点：

- server 可按 `?lang=` 注入正确字典。
- fake DOM 和 server 测试更简单。
- 不需要新增 `/api/v1/i18n/:locale`。
- 不需要首屏注入多语言完整字典。

### Phase 2: No-Refresh Switch

后续如需无刷新切换，再增加一种方式：

```text
GET /api/v1/i18n/:locale
```

或首屏注入双语字典。

无刷新切换行为：

```js
localeSelect.addEventListener("change", async (event) => {
  state.locale = event.target.value;
  localStorage.setItem("ogs.visualizer.lang", state.locale);
  state.messages = await loadLocaleMessages(state.locale);
  renderSelectedRun();
  renderConsoleTabs();
});
```

Phase 2 才要求：

- client 拉取或已持有目标 locale dictionary。
- 更新 `state.messages`。
- 重新渲染当前 panels。
- 不刷新页面。

## 11. Renderer Migration Order

按用户可见优先级迁移：

1. 页面 shell
   - title
   - brand
   - hero buttons
   - console tabs
   - card headers
   - action form labels

2. Studio Bridge
   - toolbar actions
   - graph action buttons
   - navigator headings
   - inspector headings
   - diagnostics empty state

3. Run Debug
   - Run Snapshot labels
   - Failure Triage headings
   - Timeline filters
   - Review Queue labels
   - Resume Readiness labels

4. Project / Config
   - Project Overview headings
   - Project Readiness headings
   - Binding Explain / Contract Explain labels

5. Logs / Artifacts
   - load / refresh / load more
   - Summary / Metrics / State / Audit / Timeline / Raw

6. Flash / error messages
   - user action success/error messages
   - keep raw server error code untranslated

## 12. Diagnostics Translation Policy

Diagnostic messages should be split into:

```text
machine code: stable, untranslated
human summary: translated
details: raw, untranslated when copied from runtime facts
```

Example:

```text
READINESS_STRICT_HANDOFF_CONTRACT_MISSING
缺少严格 handoff contract
qa:APPROVE:output
```

Do not translate:

```text
READINESS_STRICT_HANDOFF_CONTRACT_MISSING
qa:APPROVE:output
contracts/handoff.json
```

Recommended future shape:

```ts
{
  code: "READINESS_STRICT_HANDOFF_CONTRACT_MISSING",
  messageKey: "readiness.strictHandoffContractMissing",
  message: "Missing strict handoff contract for {flowKey}",
  vars: {
    flowKey: "qa:APPROVE:output"
  }
}
```

分阶段策略：

### Phase 1

当前 DTO 没有稳定 `messageKey` 时，只翻译：

- panel chrome
- button labels
- tab labels
- empty states
- static helper text

不要硬翻 runtime / projection 返回的 `message`。

原因：

- 当前 `message` 可能包含 roleId、flowKey、path、error detail。
- 直接字符串翻译不稳定，也容易破坏复制排障。

### Phase 2

后续 DTO 增加：

```ts
{
  messageKey: string;
  vars: Record<string, string | number | boolean | null>;
}
```

之后再翻译 diagnostic summary。

`code`、`flowKey`、`roleId`、`path` 仍保持原文。

## 13. Formatting

Use `Intl` for locale-aware formatting:

```ts
new Intl.DateTimeFormat(locale, {
  dateStyle: "medium",
  timeStyle: "medium"
}).format(date)
```

Use for:

- timestamps
- durations when appropriate
- counts

Do not localize:

- run IDs
- branch IDs
- ISO timestamps inside raw JSON
- artifact file content

## 14. Tests

### 14.1 Unit Tests

Add:

```text
tests/visualizer-i18n.test.mjs
```

Cover:

- `resolveLocale("zh-CN")`
- `resolveLocale("zh") -> zh-CN`
- unsupported locale fallback to `en`
- dictionary key parity between `en` and `zh-CN`
- `t()` returns plain text
- renderer-level escape prevents HTML injection from translated interpolation

### 14.2 Server Tests

Extend `tests/visualizer.test.mjs`:

- `GET /?lang=zh-CN` returns `<html lang="zh-CN">`
- page includes Chinese nav label, for example `项目`
- unsupported `?lang=xx` falls back to English

### 14.3 Client Tests

Extend `tests/visualizer-client.test.mjs`:

- initial locale from injected state renders Chinese console tabs
- Phase 1 language switch writes `localStorage` and navigates to `?lang=zh-CN`
- raw IDs and error codes remain unchanged

Phase 2 client tests, if no-refresh switch is introduced:

- language switch loads target dictionary
- language switch re-renders tabs/buttons without page reload

### 14.4 Regression

Run:

```bash
pnpm run test:visualizer
pnpm test
```

## 15. Acceptance Criteria

i18n is complete when:

- `en` and `zh-CN` dictionaries exist.
- Visualizer can render Chinese via `?lang=zh-CN`.
- User can switch language in UI.
- Console tabs, top-level actions, Studio Bridge actions, Logs, Artifacts, Readiness surface are translated.
- Runtime facts remain untranslated.
- Raw JSON remains raw.
- `system.mmd` output is unchanged by locale.
- `src/runtime/*` has no dependency on visualizer i18n.
- Visualizer tests pass.
- Full tests pass.

## 16. Recommended Implementation Order

1. Add `src/visualizer/i18n/*`.
2. Add locale resolution in `server.ts`.
3. Inject locale/messages in `page-shell.ts`.
4. Add `t()` in `client-app.ts`.
5. Translate console tabs and hero buttons.
6. Translate Studio Bridge toolbar and graph action buttons.
7. Translate Logs / Artifacts / Readiness panel chrome.
8. Add language switcher.
9. Add tests.
10. Run regression.

## 17. Boundary Summary

Internationalization belongs to visualizer UI and operator-facing text.

It must not become part of:

- runtime semantics
- parser behavior
- compiler behavior
- Mermaid serializer
- run artifacts
- error envelope codes
- role package schema

The core rule:

```text
Translate UI copy.
Do not translate machine truth.
```
