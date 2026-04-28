# OGSystem Debug-First Console Checklist

Date: 2026-04-28  
Status: delivered Phase 0-3  
Scope: 把 `ogsystem-debug-first-console-roadmap-2026-04-28.md` 的 `Phase 0-3` 收敛成可执行任务，直接映射到当前代码目录、API、DTO、渲染层与测试入口

Delivery notes:

- 已落地在现有 `src/visualizer/*` surface，没有引入 `src/console/*` 或 runtime 语义变更。
- 已覆盖 projection / API / client 三层测试；sandbox 内 server listen 用例保持既有 EPERM skip 行为。
- 后续 `Project Readiness`、`Studio Bridge`、可视 authoring 仍按路线图排在本清单之后。

Related:

- `docs/archive/delivery/ogsystem-debug-first-console-roadmap-2026-04-28.md`
- `docs/archive/delivery/ogsystem-studio-visual-authoring-solution-2026-04-28.md`

## 1. Priority Order

本清单只覆盖以下优先级：

1. `Phase 0` 诊断投影底座
2. `Phase 1` Failure Triage Console
3. `Phase 2` Config Explainability
4. `Phase 3` Review / Resume Operability

不包含：

- `Project Readiness`
- `Studio Bridge`
- 可视 authoring

## 2. Current Code Surface

现有基础已经具备，不需要另起新壳：

- `src/visualizer/server.ts`
  已有 HTTP 路由与控制面入口。
- `src/visualizer/dto.ts`
  已有 workbench / run detail / review / resume diagnostics view。
- `src/visualizer/data.ts`
  已有 run 级诊断与投影聚合能力。
- `src/visualizer/project-projection.ts`
  已有 project / config / workbench 聚合能力。
- `src/visualizer/run-graph-projection.ts`
  已有图状态投影能力。
- `src/visualizer/client-app.ts`
  已有单页状态管理、路由与拉数逻辑。
- `src/visualizer/client-renderers.ts`
  已有面板级 HTML render 函数。
- `tests/visualizer.test.mjs`
  适合覆盖 HTTP API 与页面壳。
- `tests/visualizer-data.test.mjs`
  适合覆盖 projection 聚合逻辑。
- `tests/visualizer-client.test.mjs`
  适合覆盖前端状态机与渲染入口。

结论：

- 第一批工作应该继续落在 `src/visualizer/*`。
- 没有必要为了做 `Phase 0-3` 先迁到 `src/console/*`。

## 3. Phase 0 Checklist

目标：

- 先补统一诊断投影层，让后续面板都消费同一组 explainability 数据。

### 3.1 DTO 增量

- [x] 在 `src/visualizer/dto.ts` 新增 `FailureSummaryView`
- [x] 新增 `FailureDetailView`
- [x] 新增 `BindingResolutionView`
- [x] 新增 `RolePackageSummaryView`
- [x] 新增 `ContractSummaryView`
- [x] 新增 `ReviewQueueView`
- [x] 新增 `ResumeReadinessView`
- [x] 保持现有 `RunDetailView`、`ReviewDetailView`、`ResumeDiagnosticsView` 向后兼容

建议字段最小集：

- `FailureSummaryView`
  `errorCode`、`errorCategory`、`message`、`stage`、`roleId`、`branchId`、`retryable`、`durationMs`
- `FailureDetailView`
  `allowedEvents`、`inputContext`、`rawOutput`、`schemaPath`、`selectedBinding`、`upstreamRoleIds`
- `BindingResolutionView`
  `roleId`、`bindingKind`、`declaredBinding`、`resolvedBinding`、`timeoutMs`、`maxOutputBytes`、`source`
- `ContractSummaryView`
  `flowKey`、`contractId`、`kind`、`schemaPath`、`lastStatus`

### 3.2 Projection 入口

- [x] 在 `src/visualizer/data.ts` 增加失败聚合函数
- [x] 在 `src/visualizer/data.ts` 增加 resume readiness explain 函数
- [x] 在 `src/visualizer/project-projection.ts` 增加 binding explain 聚合函数
- [x] 在 `src/visualizer/project-projection.ts` 增加 role package summary 聚合函数
- [x] 在 `src/visualizer/project-projection.ts` 增加 contract summary 聚合函数
- [x] 在 `src/visualizer/run-graph-projection.ts` 补充每个节点最近失败、最近选中事件、join 等待摘要

建议新增函数名：

- `inspectRunFailureVisualization`
- `inspectRunResumeReadiness`
- `inspectProjectBindingVisualization`
- `inspectProjectRolePackagesVisualization`
- `inspectProjectContractVisualization`

### 3.3 Server API

- [x] 在 `src/visualizer/server.ts` 增加 `GET /api/v1/runs/:runId/failure`
- [x] 增加 `GET /api/v1/runs/:runId/resume-readiness`
- [x] 增加 `GET /api/v1/project/bindings`
- [x] 增加 `GET /api/v1/project/contracts`
- [x] 增加 `GET /api/v1/project/role-packages`
- [x] 所有新接口统一走 `mapErrorView`

### 3.4 Test Gate

- [x] `tests/visualizer-data.test.mjs` 覆盖 failure projection 基础 shape
- [x] `tests/visualizer-data.test.mjs` 覆盖 binding explain shape
- [x] `tests/visualizer.test.mjs` 覆盖新 API 返回 200/404/错误场景

## 4. Phase 1 Checklist

目标：

- 在 UI 中建立“失败分诊主路径”。

## 4.1 Run Console 面板

- [x] 在 `src/visualizer/client-renderers.ts` 新增 `renderFailureSummaryPanel`
- [x] 新增 `renderFailureDetailPanel`
- [x] 新增 `renderSuggestedNextChecksPanel`
- [x] 失败面板显示在 run detail 主区域的高优先位置

失败卡片必须展示：

- 最近失败角色
- `errorCode`
- `stage`
- `retryable`
- 超时/Schema/Provider/Contract 分类
- 一键跳转到相关面板

### 4.2 Client State

- [x] 在 `src/visualizer/client-app.ts` 新增 `state.failure`
- [x] 新增 `state.failureLoaded`
- [x] 新增 `state.failureStale`
- [x] 把 SSE refresh plan 扩展到 failure panel
- [x] `runId` 切换时同步加载 failure data

### 4.3 Suggested Next Checks

不是自由文本建议，而是可执行动作：

- [x] `inspect projected input`
- [x] `inspect binding resolution`
- [x] `inspect role schema`
- [x] `inspect contract`
- [x] `inspect resume diagnostics`

建议动作实现方式：

- 先以按钮/锚点切换已有面板
- 暂不引入复杂命令面板

### 4.4 Error-Type Specific Rendering

- [x] `TOOL_EXECUTION_TIMEOUT` 显示 timeout budget 与 duration
- [x] `ROLE_EXECUTION_FAILED` 显示 schema mismatch / correction request / raw output
- [x] contract violation 显示 flow key、contract id、schema path
- [x] provider/model failure 显示 provider ref 与原始错误 message

### 4.5 Test Gate

- [x] `tests/visualizer-client.test.mjs` 覆盖 failure panel 初次加载
- [x] 覆盖 run 切换时 failure panel 刷新
- [x] 覆盖 stream 事件后 failure stale 标记
- [x] `tests/visualizer.test.mjs` 覆盖 failure API 在页面渲染中被引用

## 5. Phase 2 Checklist

目标：

- 把“最终生效的配置”解释清楚。

### 5.1 Binding Explain Panel

- [x] 在 `src/visualizer/client-renderers.ts` 新增 `renderBindingExplainPanel`
- [x] 逐 role 显示 `declared -> resolved -> effective`
- [x] 展示 timeout 与 output budget
- [x] 区分 `system.mmd` 显式绑定与 `.ogs/model-selection.json` fallback

### 5.2 Role Package Panel

- [x] 新增 `renderRolePackagePanel`
- [x] 展示 `role.json` 摘要
- [x] 展示 `output.schema.json` 路径与 allowed events
- [x] 展示 prompt / schema / source.json 是否存在

### 5.3 Contract Explain Panel

- [x] 新增 `renderContractPanel`
- [x] 展示 strict handoff 下每条 flow 的 contract coverage
- [x] 标出没有 contract 的边
- [x] 标出 role_input contract 与 flow contract 的区别

### 5.4 Project Projection 扩展

- [x] `src/visualizer/project-projection.ts` 增加 role-level binding explain
- [x] 增加 role package file health summary
- [x] 增加 contract coverage summary
- [x] 保证这些投影能同时服务 `Project Home` 和 `Run Console`

### 5.5 Client Integration

- [x] 在 `src/visualizer/client-app.ts` 增加 `state.bindings`
- [x] 增加 `state.contracts`
- [x] 增加 `state.rolePackages`
- [x] 首次 project load 时预取 config explain 数据

### 5.6 Test Gate

- [x] `tests/visualizer-data.test.mjs` 覆盖 binding source/fallback 解释
- [x] 覆盖 contract coverage 数据 shape
- [x] `tests/visualizer-client.test.mjs` 覆盖 binding/contract 面板切换与渲染

## 6. Phase 3 Checklist

目标：

- 把 `review / resume` 从文档动作变成产品内可解释、可判断、可操作的流程。

### 6.1 Review Queue

- [x] 在 `src/visualizer/client-renderers.ts` 增加 `renderReviewQueuePanel`
- [x] 明确区分 `pending`、`paused`、`recorded`、`pending_reconcile`、`applied`
- [x] 展示 `round`、`actor`、`comment`、`rework target`

### 6.2 Review Detail Hardening

- [x] 扩展现有 `renderReviewDetailPanel`
- [x] 显示 review request snapshot 与 decision snapshot 摘要
- [x] 显示当前 branch / role / selected event / execution id
- [x] 显示“下一步动作”按钮状态

### 6.3 Resume Readiness

- [x] 在 `src/visualizer/data.ts` 新增可直接回答 `can resume? why?`
- [x] 在 `src/visualizer/client-renderers.ts` 增加 `renderResumeReadinessPanel`
- [x] 区分：
  `fingerprint drift`、`missing files`、`review not applied`、`checkpoint mismatch`
- [x] 给出阻塞项列表，而不只是 `checks[]`

### 6.4 Resume Drift Diff

- [x] 在 `src/visualizer/data.ts` 把现有 resume diagnostics 再投影成 drift 来源摘要
- [x] 至少区分：
  `system.mmd`、role package、law、model selection、contracts
- [x] 页面上按来源分组展示

### 6.5 Review / Resume Client Flow

- [x] `src/visualizer/client-app.ts` 中将 `review decide` 后自动标记 resume diagnostics stale
- [x] `resume` 成功后自动刷新 detail / graph / reviews / readiness
- [x] review list 与 review detail 选择关系保持稳定

### 6.6 Test Gate

- [x] `tests/visualizer-data.test.mjs` 覆盖 resume readiness 阻塞项分组
- [x] `tests/visualizer.test.mjs` 覆盖 review queue、review detail、resume-readiness API
- [x] `tests/visualizer-client.test.mjs` 覆盖 review decide 后 stale 标记
- [x] 覆盖 resume 后自动刷新逻辑

## 7. Cross-Cutting Tasks

这些任务横跨 `Phase 0-3`，应并行维护。

### 7.1 Naming

- [x] 统一使用 `failure`, `binding`, `contract`, `readiness` 命名
- [x] 避免混用 `diagnostics`, `issues`, `problems`, `alerts`

### 7.2 Rendering Rules

- [x] 所有 explain 面板都先给结论，再给原始 JSON
- [x] 原始 JSON 只做证据层，不做唯一解释层
- [x] 所有面板都必须有空状态和错误状态

### 7.3 API Stability

- [x] DTO 先 additive 扩展，不破坏现有 visualizer 页面
- [x] 新接口命名保持 `api/v1` 风格一致

### 7.4 Performance

- [x] project-level explain 接口优先复用现有 projection cache
- [x] run-level failure/readiness 接口避免重复全量读 run 目录
- [x] SSE 只标 stale，不在每个事件上做全量重拉

## 8. Suggested Execution Order

推荐实际开发顺序：

1. `dto.ts`
2. `data.ts` / `project-projection.ts`
3. `server.ts` API
4. `client-renderers.ts`
5. `client-app.ts`
6. `tests/visualizer-data.test.mjs`
7. `tests/visualizer.test.mjs`
8. `tests/visualizer-client.test.mjs`

原因：

- 先稳定服务端投影和 DTO，前端才不会反复返工。
- 当前项目的核心风险在 explain 数据模型，而不是 DOM 拼接本身。

## 9. Acceptance Gates

只有同时满足以下条件，才算 `Phase 0-3` 真正完成：

- [x] 用户查看一个失败 run 时，不再需要手工翻 `state.json`、`resolved-config.json`、`output.schema.json`
- [x] 用户能直接回答“这个 role 为什么失败”
- [x] 用户能直接回答“这个 binding 为什么是这个值”
- [x] 用户能直接回答“这个 run 现在能不能 resume，为什么”
- [x] 用户能直接回答“这条 review 现在卡在哪个阶段”
- [x] 所有新增能力都有对应 visualizer data / api / client 测试

## 10. Non-Goals

本清单不包括：

- 画布编辑
- Mermaid 导入导出重构
- 新前端框架
- `src/console/` 目录迁移
- runtime 语义变更

## 11. Final Note

`Phase 0-3` 的价值不在“页面更多”，而在“把当前散落在 run artifacts、role 包和配置文件里的调试真相收拢成一条可解释主路径”。

只有这条主路径稳定之后，后面的 `Project Readiness` 和 `Studio` 才不会变成新的复杂度放大器。
