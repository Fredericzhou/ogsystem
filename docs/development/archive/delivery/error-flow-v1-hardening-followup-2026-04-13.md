# OGSystem ERROR* V1 Follow-up Hardening Closure (Archived)

Archived: yes (delivery record; not active source of truth)  
Status: Delivered  
Date: 2026-04-13  
Owner: runtime core
Terminology note: active canonical naming is `error flow` / `runtime.error_flows.v1`; this archive keeps delivery-era wording only where helpful for historical context.

## 1. 目标

在 `ERROR*` V1 已交付基础上，完成一轮“契约一致性 + 恢复一致性 + 可观测性 + 测试可维护性”收口，不扩展语义面。

## 2. 本轮交付

1. 契约一致性收口（fail-closed）
   - 解析期与运行期统一 `ERROR*` 约束，避免“可解析但运行报错”的不一致。
   - 角色侧 `allowed_events` 排除 runtime-only 的 `ERROR*`。
2. 失败载荷与上下文
   - `handled failure` 载荷补齐并固化关键字段，补充 `last_context`（截断/脱敏路径）。
3. 恢复一致性
   - 增加 `ERROR*` crash-window + resume 幂等覆盖，确保不重复执行、不重复记录 `failure_handled`。
4. 审计与摘要
   - `runSummary` 区分 `handled/unhandled`，并支持按事件、按目标角色聚合。
5. 并行语义一致性
   - `parallel_split` 成功路径不再激活 `ERROR*` 出边，并对目标角色去重，避免重复激活。
6. 测试结构优化（不改行为）
   - 同构用例参数化/表驱动，提取 crash-window 公共脚手架，保留关键语义专项测试独立性（`last_context`、双 crash-window 目标差异）。

## 3. 验证结果

执行：

```bash
pnpm build
node --test tests/resume-session.test.mjs tests/parser.test.mjs tests/error-flow-runtime.test.mjs tests/runtime-fault-injection.test.mjs
pnpm test
pnpm run test:examples
```

结果：

1. 定向测试：`54/54` 通过。
2. 全量测试：`181/181` 通过。
3. examples 回归：通过。

## 4. 关联提交

1. `93a794b` runtime: harden ERROR* semantics and resume/audit coverage
2. `eb47f7b` runtime: tighten error-edge guidance and failure context fidelity
3. `09b70d2` runtime: align parallel_split with ERROR* failure-only semantics
4. `891a6f4` test: refactor table-driven error edge and resume suites

## 5. 文档归档结论

1. 当前 `ERROR*` V1 语义以活跃文档为准：
   - `docs/ogsystem-orchestration-semantics-v1.md`
   - `docs/usage-manual.md`
   - `docs/DECISIONS.md`
2. 本文档仅记录后续 hardening 交付，不作为运行时语义真相源。
