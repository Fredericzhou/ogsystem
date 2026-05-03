# Visualizer 功能优化清单（定性校准版）

> 基于 2026-05-03 的代码复核结果，对已完成项、优先级和措辞做校准后形成的可入库版本。
> 本文用于归档审计结论；活动执行项以 `docs/todo-backlog.md` 为准。

Date: 2026-05-03
Status: calibrated

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
| 11 | 关键面板 `innerHTML` 全量替换导致焦点/滚动丢失 | `client-app.ts` | 已新增 `setInnerHtmlIfChanged()` 和 `bindOnce()`，首批热点已覆盖 `operateTabs` / `workbenchStatus` / `workbenchTabs` / `workbenchViewTabs` / `workbenchActions`；`runListEl` 与 `consoleTabsEl` 仍待处理，不能视为整项完成 |

---

## 二、待修复项

### P1 — 立即可做，影响明确

#### 12. 初始化加载失败无重试入口

- 文件：`client-app.ts`
- 现状：初始 `loadProject()` 失败后只有错误文本，缺少显式 Retry 入口。
- 建议：在错误态旁提供 Retry 按钮，重新触发初始化加载。

#### 13. Workbench textarea 缺少 label / aria-label

- 文件：`client-lifecycle-panels.ts`
- 现状：`<textarea id="workbench-editor" ...>` 缺少关联 `label` 或 `aria-label`。
- 建议：添加可翻译的 `aria-label` 或显式 `<label for="workbench-editor">`。

#### 14. `runListEl` 和 `consoleTabsEl` 仍为高频 `innerHTML` 全量替换

- 文件：`client-app.ts`
- 现状：两处仍在搜索过滤、状态切换和流式刷新时整块重写 DOM，容易造成焦点丢失、滚动跳动和闪烁。
- 建议：优先复用 `setInnerHtmlIfChanged()`；必要时再细化为局部 patch。若继续保留整块重绘路径，必须同步约束监听器绑定策略，继续使用 `bindOnce()` 或只在 markup 真正变化后重绑，避免重复监听。

#### 15. 成功类 Flash 消息应自动消失

- 文件：`client-app.ts`
- 现状：当前 flash 默认常驻，直到被后续操作覆盖。
- 建议：仅对“不带 action 的纯提示型” `success` / `info` 做自动消失；带 action 的 flash 应保留，避免把可操作入口提前冲掉。`error` / `warning` 保持常驻。

### P2 — 需要一定设计，值得排期

#### 16. `fetchSelectedLogs` 未选 roleId 时对所有 role 并发请求

- 文件：`client-run-data-loaders.ts`
- 现状：未选中 role 时直接 `Promise.all(roleIds.map(...))`，大图会一次发出多路并发请求。
- 建议：增加并发上限，或改为按需加载。

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
- 现状：最多对 250 条 entries 做线性扫描。
- 定性：上限明确，属于中低风险热点，不应抢在更大的稳态问题前处理。
- 建议：后续可改为 `Set` 或游标索引去重。

#### 22. SVG 拓扑排序 `queue.shift()` 为 O(n)

- 文件：`client-renderers.ts`
- 现状：Kahn 拓扑排序使用 `Array.shift()`，理论上为 O(n²)。
- 定性：当前角色规模通常较小，实际收益有限。
- 建议：后续改为 index 游标遍历。

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
