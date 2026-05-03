# Visualizer 功能优化清单（定性校准版）

> 基于 2026-05-03 的代码复核结果，对已完成项、优先级和措辞做校准后形成的可入库版本。
> 本文用于归档审计结论；活动执行项以 `docs/todo-backlog.md` 为准。

Date: 2026-05-03
Status: calibrated

---

## 0. 平台回归补记

在补入 Windows 运行兼容后，额外做了 macOS 回归核查，重点确认现有 macOS/Linux 路径未被 Windows 分支污染。

已验证：

- `pnpm run test:visualizer` 通过，`94/94` pass。
- `node --test tests/package-install.test.mjs tests/session-recovery.test.mjs tests/doctor.test.mjs tests/run-artifact-policy.test.mjs tests/cli.test.mjs tests/cli-lifecycle.test.mjs tests/rust-hello-pipeline.test.mjs` 通过，`26/26` pass。
- Windows 兼容相关的 `.cmd` / `.bat` `shell: true` 逻辑仅存在于 Windows 条件分支，不影响 macOS/Linux 的 `spawn()` 路径。
- `session-recovery`、`visualizer` 中的路径断言已改为兼容 `/` 与 `\\`，属于测试可移植性修复，不改变运行时语义。

本轮额外发现并已修复一处真实跨平台风险：

- `9d5aceb` 曾把 visualizer 项目创建测试故障注入挂到生产 `process.env` 路径，可能在 macOS/Linux 的 shell、CI 或长驻服务中被意外触发。
- 当前已改为仅通过 `startVisualizationServer({ testHooks })` 传入测试专用 hook，不再读取 `OGSYSTEM_TEST_PROJECT_CREATE_*` 环境变量驱动生产项目创建流程。

边界说明：

- 当前回归在 macOS 环境完成。
- Linux 未做本机实跑结论，但从改动边界和通过的跨平台路径测试看，未发现新增的 Linux 特定回归迹象。

---

## 一、已完成与部分缓解

### 已完成修复（10 项）

| # | 问题 | 文件 | 修复方式 |
|---|------|------|----------|
| 1 | `readJsonRequest` 无请求体大小限制 | `server.ts` | 新增 `MAX_JSON_REQUEST_BYTES` 上限，逐 chunk 累加，超限抛 `413` |
| 2 | Mermaid Live URL 用 `encodeURIComponent` 伪装 `#pako:` | `run-graph-projection.ts`、`data.ts` | 改为 Mermaid Live 可识别的 `#base64:` 负载格式 |
| 3 | DTO 恒真三元表达式（死分支） | `dto.ts` | 提取稳定模式常量，移除恒真三元表达式 |
| 4 | 草稿加载吞没所有错误 | `studio-authoring.ts` | 仅对 `ENOENT` 返回 `null`，其他错误继续抛出 |
| 5 | 项目清理失败被静默忽略 | `project-projection.ts` | 汇总清理失败并上抛稳定错误码，调用方保留原始失败上下文 |
| 6 | `hasProject` 初始值默认 `true` | `client-lifecycle-state.ts` | 调整初始语义，避免首屏默认假定已有项目 |
| 7 | `legacyView` 死参数 | `client-route-state.ts` | 恢复为兼容 fallback 路径，并补充测试 |
| 8 | 重复类型导入 | `studio-authoring.ts` | 统一为单次 `import type` / `export type` 流程 |
| 9 | Bridge/import 解析失败对用户不可见 | `studio-authoring.ts` | 将导入失败注入 `validation.diagnostics`，让错误对用户可见 |
| 10 | Chat 面板 `role="dialog" aria-modal="false"` 语义不当 | `client-studio-chat-panel.ts` | 改为 `role="region"`，并补回归测试 |

### 部分缓解（1 项，未关闭）

| # | 问题 | 文件 | 当前状态 |
|---|------|------|----------|
| 11 | 关键面板 `innerHTML` 全量替换导致焦点/滚动丢失 | `client-app.ts` | 已新增 `setInnerHtmlIfChanged()` 和 `bindOnce()`，覆盖 `operateTabs` / `workbenchStatus` / `workbenchTabs` / `workbenchViewTabs` / `workbenchActions` / `runListEl` / `consoleTabsEl`；重复绑定风险已收敛 |

---

## 二、待修复项

### P1 — 立即可做，影响明确

#### 12. 初始化加载失败无重试入口

- 文件：`client-app.ts`
- 现状：初始 `loadProject()` 失败后已提供显式 Retry 入口，且支持重试后恢复页面。
- 状态：已修复。

#### 13. Workbench textarea 缺少 label / aria-label

- 文件：`client-lifecycle-panels.ts`
- 现状：`<textarea id="workbench-editor" ...>` 已补充可翻译 `aria-label`。
- 状态：已修复。

#### 14. `runListEl` 和 `consoleTabsEl` 仍为高频 `innerHTML` 全量替换

- 文件：`client-app.ts`
- 现状：两处已改为复用 `setInnerHtmlIfChanged()`，并配合 `bindOnce()` 控制重复监听。
- 状态：已修复。

#### 15. 成功类 Flash 消息应自动消失

- 文件：`client-app.ts`
- 现状：纯提示型 `success` / `info` flash 已自动消失；带 action 的 flash 仍常驻。
- 状态：已修复。

### P2 — 需要一定设计，值得排期

#### 16. `fetchSelectedLogs` 未选 roleId 时对所有 role 并发请求

- 文件：`client-run-data-loaders.ts`
- 现状：未选中 role 时已改为分批并发加载，避免一次性打满多路请求。
- 状态：已修复。

#### 17. SSE 每连接 1 秒轮询文件系统

- 文件：`server.ts`
- 现状：连接关闭时已 `clearInterval`，不是泄漏；但每连接 1 秒轮询一次，在多标签页场景会放大磁盘 IO。
- 定性：架构热点，不是漏洞。
- 建议：评估退避策略、共享观察或事件驱动方案。

#### 18. Run card 可补充结构化无障碍语义

- 文件：`client-app.ts`
- 现状：Run card 作为 `<button>` 已可读，但缺少更明确的 `aria-label` 或 `aria-describedby`。
- 建议：补充结构化状态摘要，提升屏幕阅读器体验。

#### 19. SVG 图内节点细粒度可访问性不足

- 文件：`client-renderers.ts`
- 现状：整体 SVG 仅有 `role="img"` 和总 `aria-label`，节点和边缺少 `<title>` / `<desc>`。
- 建议：为节点和边补充细粒度文本说明。

#### 20. Tone 系统对色盲支持不足

- 文件：`client-renderers.ts`
- 现状：多数位置仍有文本辅助，但拓扑图和纯视觉状态指示器对色弱用户仍不够友好。
- 建议：加入图标、纹理或其他非颜色状态提示。

### P3 — 低风险或后移处理

#### 21. `appendStreamEntry` 去重使用线性扫描

- 文件：`client-stream-state.ts`
- 现状：已新增显式 cursor 索引结构，SSE 追加路径使用 `Set` 去重，并在历史裁剪时同步清理索引。
- 状态：已修复。

#### 22. SVG 拓扑排序 `queue.shift()` 为 O(n)

- 文件：`client-renderers.ts`
- 现状：Kahn 拓扑排序已改为 index 游标遍历，避免 `Array.shift()` 造成的 O(n²) 行为。
- 状态：已修复。

#### 23. `asString` 在 `project-readiness.ts` 中语义不同

- 文件：`project-readiness.ts`
- 现状：该处 `asString` 会 `trim` 且拒绝空串，与其他同名函数语义不一致。
- 建议：重命名为 `asNonEmptyString` 或统一抽取时显式区分语义。

#### 24. Mermaid Live URL 相关 helper 在两个文件中重复

- 文件：`data.ts`、`run-graph-projection.ts`
- 现状：`toBase64Url` / `buildMermaidLiveUrl` 逻辑重复。
- 建议：后续提取为共享 util。

#### 25. `asString` / `asRecord` / `asNumber` 等辅助函数多处重复定义

- 涉及文件：`server.ts`、`data.ts`、`dto.ts`、`project-projection.ts`、`project-readiness.ts`、`ops-summary-projection.ts`、`run-graph-projection.ts`、`studio-chat-to-mmd.ts`
- 定性：代码质量债，当前功能正确，但维护成本高。
- 建议：放在独立重构批次处理，避免和稳态修复混做大改动。

#### 26. `escapeText` / `escapeHtml` 多份拷贝

- 文件：`client-renderers.ts`、`page-shell.ts`、`page-shell-template.ts`
- 现状：逻辑相近但名称不同。
- 建议：与辅助函数收敛一并处理。

---

## 三、跨单点缺陷的观察项

| 观察项 | 说明 | 处理建议 |
|--------|------|----------|
| `runsListCache` 模块级 Map 无容量上限 | 服务端常驻缓存，当前没有 TTL / max-size；属于真实短期稳态风险，不应降为纯 P3 清洁项 | 已并入活动 backlog 的 P1 短期稳态优化 |
| Workbench validation 250ms 延迟参数 | 当前已存在 debounce，更多是参数调优 | 不列为当前缺陷 |
| Run 列表搜索防抖 | 技术上成立，但当前规模下体感收益有限 | 低优先级体验优化 |
| 运行时在 HTTP 服务进程内执行 | 已知可用性风险，但属于架构决策题，不是单个 visualizer bug | 在活动 backlog 中按“风险待验证/隔离方案评估”单列 |
| URL 路径参数输入校验 | 需要逐条验证 workdir/path 约束后再定性 | 先做边界审查，不直接下漏洞结论 |
| 100+ 字段扁平状态对象 | 主要是可维护性与演化成本问题 | 作为 P2 重构方向推进 |

---

## 四、与活动 backlog 的对齐结论

- 活动执行入口保持为 `docs/todo-backlog.md`。
- 本文只负责校准定性，不直接代表任务已关闭。
- `chat panel` ARIA 语义已修正，但 Studio 图命令表单的 modal 语义、焦点管理和键盘行为仍需继续核对。
- `innerHTML` 热点治理只完成首批面板，剩余 `runListEl` 与 `consoleTabsEl` 继续留在 P1。
- `runsListCache` 无上限问题维持短期稳态优先级，不降到 P3。
