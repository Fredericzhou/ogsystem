# OGSystem Debug-First Console Roadmap

Date: 2026-04-28  
Status: delivered Phase 0-4; Phase 5 pending
Scope: 以调试和失败解释为优先目标，推进 `visualizer -> console`，优先解决 run 诊断、配置对账和恢复操作问题，而不是先做可视 authoring

Related:

- `docs/archive/delivery/ogsystem-studio-visual-authoring-solution-2026-04-28.md`
- `docs/archive/delivery/ogsystem-visualization-platform-solution-2026-04-16.md`

## 1. Decision Summary

当前 OGSystem 的主要推进阻力，不是“没有 X6 画布”，而是：

1. 失败原因分散在多处文件和多层语义里，不容易一次性解释清楚。
2. 调试时需要跨 `system.mmd`、`og-roles/`、`.ogs/model-selection.json`、`laws.json`、`handoff.contracts` 和 run artifacts 手工对账。
3. `review / resume / timeout / schema mismatch / provider failure` 这些运行时问题缺少统一的“可点击解释面板”。

因此，产品优先级应调整为：

```text
Run Debuggability
> Config Explainability
> Review/Resume Operability
> Project Readiness
> Visual Authoring
```

这不是否定 Studio。

结论是：

- `Studio` 主要解决 authoring 可用性。
- `Run Console + Ops` 才是当前调试推进的短板。
- 近期应先做 debug-first console，再做 visual authoring。

## 2. What Problem This Plan Actually Solves

本计划解决的是以下现实问题：

- 为什么这个 role 失败了。
- 为什么 runtime 选择了这个 binding。
- 为什么某条边没有触发。
- 为什么 join 一直没到。
- 为什么 review 后不能 resume。
- 为什么 resume 被指纹拒绝。
- 为什么一个系统“看起来对”，但运行时仍 fail-stop。

这些问题和“图能不能拖拽编辑”不是同一个层级。

## 3. Current Product Boundary

当前 `visualizer` 的定位已经很明确：

- 是 read-mostly observability UI。
- 主要职责是 run summaries、details、timeline、review 和少量控制面动作。
- 不是 authoring shell。

这和现有实现一致，见 `src/visualizer/server.ts` 的文件头说明。

因此，最小正确方向不是“直接把 visualizer 改成 Studio”，而是：

1. 先把 visualizer 产品化为 debug-first console。
2. 把 explainability 和 operability 做扎实。
3. 再在其上分化出 Studio。

## 4. Product Thesis

如果一个系统的核心价值是：

- 图可执行
- 运行可恢复
- 结果可审计
- 语义边界清楚

那么它的第一优先可视化，不应是“更好画图”，而应是“更好解释为什么跑成这样”。

这意味着 console 的第一性目标应是：

- 用最短路径解释失败
- 用最短路径解释配置
- 用最短路径解释恢复与审核状态

## 5. Debug-First Console Shape

推荐把产品拆成 4 个面板，但优先建设顺序调整如下：

1. `Run Console`
2. `Ops`
3. `Project Home`
4. `Studio`

这里的关键不是页面数量，而是先后顺序。

### 5.1 Run Console

面向“这个 run 为什么这样执行”。

必须直接回答：

- 当前卡在哪个 role
- 最近一次失败是什么
- 输入、允许事件、实际输出、schema 校验结果分别是什么
- 下一跳为什么存在或不存在
- 当前 review 状态是什么
- 当前 run 是否可 resume，若不可以，为什么

### 5.2 Ops

面向“这个项目最近为什么总出问题”。

必须直接回答：

- 最近失败主要集中在哪些 role
- 最近 review/rework 最多的节点有哪些
- resume 拒绝主要由哪些 drift 引起
- provider timeout / schema mismatch / contract violation 各占多少

Delivery status:

- 已通过 `GET /api/v1/project/ops-summary` 和 `Ops Summary` 面板落地。
- 当前聚合 recent failures、role/errorCode/errorCategory 分布、review/rework pending、resume blocking 和 drift source。

### 5.3 Project Home

面向“在运行前，这个项目是否具备基本可运行性”。

只做 readiness，而不抢 debug 主线。

### 5.4 Studio

面向“更高效地产生和修改 `system.mmd`”。

它重要，但不该抢在 debug-first console 前面。

## 6. Phase Plan

## 6.0 Priority Order

本路线图的正式优先级固定为：

1. 先做 `debug-first console` 的 `Phase 0-3`
2. 再做 `Project Readiness`
3. 最后做 `Studio Bridge` 和可视 authoring

原因：

- 如果 `failure / config / review / resume` 解释链没打通，先上画布只会把复杂性藏起来，不会真正降低调试成本。
- 当前系统的主要摩擦来自运行时 explainability 和 operability，而不是“缺少拖拽入口”。
- 只有在 debug-first console 做扎实之后，Studio 才会拥有可信的诊断底座、配置解释能力和运行前验证能力。
- 否则很容易得到一个“看起来更好用，但失败时仍然说不清楚为什么”的 authoring shell。

## Phase 0. 不做大前端重构，先补诊断投影

目标：

- 不改 runtime 语义
- 不引入前端构建系统
- 直接复用现有 `visualizer` 投影层和 API

交付：

- failure explanation projection
- binding resolution projection
- contract/source/schema explain projection
- resume blocking diagnostics projection

成功标准：

- 用户不再需要同时开 5 个文件追一个失败

## Phase 1. Failure Triage Console

目标：

- 把“失败定位”变成产品内一条主路径

新增视图块：

- `Failure Summary`
- `Execution Context`
- `Validation Details`
- `Suggested Next Checks`

### 6.1 Failure Summary

对每次失败至少聚合显示：

- `errorCode`
- `errorCategory`
- `stage`
- `roleId`
- `branchId`
- `selected binding`
- `durationMs`
- `retryable`

### 6.2 Execution Context

对失败 role 展示：

- rendered input summary
- allowed events
- selected model/profile/tool
- upstream role outputs
- projected input fields

### 6.3 Validation Details

按失败类型给专门解释：

- schema mismatch: 缺什么字段，哪个字段非法
- handoff violation: 哪条 flow contract 不满足
- role_input violation: 哪个 projected field 缺失或越界
- provider failure: provider/model/ref 与原始错误
- timeout: timeout budget、实际耗时、是否可重试

### 6.4 Suggested Next Checks

不是“AI 建议”，而是 deterministic next-step：

- inspect role output schema
- inspect projected input
- inspect model-selection
- inspect review decision
- inspect resume diagnostics

## Phase 2. Config Explainability

目标：

- 让用户看懂 runtime 当次到底消费了什么配置

新增视图：

- `Resolved Config`
- `Binding Resolution`
- `Role Package Summary`
- `Flow Contract Summary`

### 6.5 Resolved Config

按 run 粒度展示：

- `system.mmd` 摘要
- `law.global`
- `.ogs/model-selection.json` 生效值
- system/role override 命中情况
- `runtime.json` 关键字段

### 6.6 Binding Resolution

逐 role 展示：

- declared binding in `system.mmd`
- fallback from model selection
- final selected binding
- timeout budget
- output size budget

### 6.7 Role Package Summary

逐 role 展示：

- `role.json`
- `prompt.md`
- `output.schema.json`
- canonical allowed events

### 6.8 Flow Contract Summary

逐边展示：

- 哪些 flow 有合同
- 合同 schema 是什么
- 当前 run 的最近一次通过/失败情况

Delivery status:

- 已通过 `GET /api/v1/runs/:runId/contracts` 和 `Config Explain > Contract` 面板补齐 run-level contract runtime status。
- `pass` 是 visualizer 层基于“completed run 且未发现 contract failure signal”的确定性推断；runtime 当前没有显式持久化 contract-pass event。

## Phase 3. Review / Resume Operability

目标：

- 把 runtime-native human review 和 strict resume 变成可操作能力，而不是文档能力

新增视图：

- `Review Queue`
- `Review Detail`
- `Resume Readiness`
- `Resume Drift Diff`

### 6.9 Review Queue

按 run / role / review round 展示：

- pending / paused / applied / reconciled
- reviewer comment
- rework target
- terminate scope

### 6.10 Resume Readiness

直接给出：

- 可以 resume / 不可以 resume
- 如果不可以，阻塞项是什么
- 指纹 drift 来自 system / role / law / model selection / contracts 的哪一类

### 6.11 Resume Drift Diff

不是简单显示“digest changed”，而是显示：

- 哪个文件变了
- 哪个 role 包变了
- 哪个 contract 变了
- 哪个 runtime 选择值变了

## Phase 4. Project Readiness

目标：

- 在真正运行前先暴露结构性缺口

新增视图：

- `Project Readiness`
- `Missing Bindings`
- `Contract Coverage`
- `Role Repo Health`

回答：

- 这个系统能否 dry-run
- 哪些 role 没绑定
- strict handoff 下哪些边还没有 contract
- 哪些 role package 文件缺失

说明：

- `Project Readiness` 必须放在 `Phase 0-3` 之后。
- 它依赖前面已经建好的 failure/config/review/resume explainability 投影，才能避免再次发明第二套不一致的项目检查逻辑。

Delivery status:

- 已通过 `GET /api/v1/project/readiness` 和 `Project Readiness` 面板落地。
- 当前检查 `canDryRun`、missing bindings、strict handoff contract coverage、role package required file health，并输出 blockers/warnings。
- 实现限定在 visualizer read-only projection/API/UI/test surface，没有改 runtime 执行内核。

## Phase 5. Studio Bridge

当前面 4 个阶段已经让系统“可解释、可操作”后，再引入 Studio。

这时 Studio 的收益才真实：

- 用户已经知道系统怎么失败
- 也知道 metadata 的实际含义
- 画布不会沦为“把复杂性藏起来但调不动”的壳

因此，Studio 应该接在 `debug-first console + project readiness` 之后，而不是之前。

## 7. API / Projection Priorities

优先补的是投影，不是重写 UI。

推荐新增或强化以下 projection：

1. `run failure projection`
2. `binding resolution projection`
3. `role package projection`
4. `contract coverage projection`
5. `resume drift projection`
6. `project readiness projection`

这些都属于服务端聚合层，适合继续放在现有 `src/visualizer/*` 或未来 `src/console/*` 下。

## 8. Recommended Module Layout

在不立即重构全部目录的前提下，推荐演进到：

```text
src/console/
  server.ts
  project-home/
  run-console/
    failure-projection.ts
    binding-projection.ts
    review-projection.ts
    resume-projection.ts
  ops/
    aggregate-failures.ts
    aggregate-reviews.ts
    aggregate-drift.ts
  studio/
```

短期内如果不想迁目录，也可以先在 `src/visualizer/` 内按相同职责扩展。

## 9. UX Rules

debug-first console 必须遵守以下规则：

1. 每个失败都必须给“发生了什么”和“下一步该看哪里”。
2. 每个配置都必须能回答“最终生效的是哪个值”。
3. 每个 review 都必须能回答“当前状态”和“下一步操作”。
4. 每个 resume 拒绝都必须能回答“具体漂移来源”。
5. 不要求用户自己从 run artifacts 拼事实。

## 10. MVP Cutline

真正能改善当前推进效率的 MVP，不需要 X6，也不需要 Studio。

MVP 只需要：

- 失败聚合卡片
- role 执行上下文面板
- binding explain 面板
- contract explain 面板
- review/resume readiness 面板

只要这 5 件事到位，当前调试效率就会明显改善。

## 11. Non-Goals

当前这条路线不追求：

- 可视化拖拽编辑
- 多人协作画布
- 替换 Mermaid DSL
- 绕过 `system.mmd`
- 重做 runtime 内核

## 12. Final Recommendation

建议明确做出以下排序决策：

1. 先完成 `debug-first console` 的 `Phase 0-3`。
2. 再做 `Project Readiness`。
3. 最后再进入 `Studio Bridge` 和 visual authoring。

简化成一句话：

OGSystem 当前最缺的不是“更好画图”，而是“更好解释为什么这张图这样运行、这样失败、这样不能恢复”；只有这条解释链打通后，Studio 才会真的提升可用性。

## 13. Implementation Status

截至 2026-04-28：

- `Phase 0-3` 已交付为 debug-first console 主路径。
- `Ops` 已交付为项目级聚合视图。
- `Phase 4 Project Readiness` 已交付为运行前只读检查视图。
- `Phase 5 Studio Bridge` 仍 pending，不应在诊断底座之外另起不一致的 authoring 逻辑。
