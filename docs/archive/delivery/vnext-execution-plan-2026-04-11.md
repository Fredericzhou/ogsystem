# OGSystem vNext 执行计划（开发测试版，破坏性变更）

Archived: yes (delivery record only; not active source of truth)  
Stable-track superseded by: `docs/todo-backlog.md`, `docs/long-term-stability-roadmap.md`  
Status: Proposed  
Date: 2026-04-11  
Owner: Runtime maintainers

## 1. 约束与原则

1. 本计划用于开发测试版本，不兼容历史数据与旧接口。
2. 先保证确定性与恢复一致性，再提升吞吐与并发。
3. 所有关键改动必须配套测试与注释更新。

## 2. 目标

1. 语义升级：`UserProfile` 全量升级为 `SubjectContext`，并拆分 `identity` 与 `subjectContext`。
2. 架构加固：引入 `CapabilityRequirements` 与 `LockProvider` 抽象，推进有界真并发。
3. 文档专业化：全仓注释治理，关键路径落实 Failure Window 说明。
4. 可观测与可靠性升级：增强因果投影与重试策略（指数退避+抖动）。

## 3. 分阶段实施

### Phase 1（Day 1-2）：语义重构

1. 全仓重命名 `UserProfile -> SubjectContext`（类型、字段、函数参数、日志文案）。
2. `RunContext` 拆分为 `identity` 与 `subjectContext`。
3. 持久化拆分为 `identity.json` 与 `context.json`，移除旧命名语义。
4. 更新角色输入投影与 Prompt 注入结构，统一 `subject_context` 命名。
5. 同步更新测试 fixture、快照与示例。

交付：

1. 语义重构代码。
2. 新持久化文件格式。
3. 对应单测通过。

### Phase 2（Day 3-6）：架构契约加固

1. 在角色绑定链路增加 `CapabilityRequirements`。
2. 绑定前进行能力硬校验（例如 `tool-use`、`long-context`）。
3. 抽象 `LockProvider` 接口并提供 `LocalFsLockProvider` 默认实现。
4. 并发策略升级为“有界并发调度 + 确定性合并顺序”。
5. 保证 checkpoint 序列与回放顺序仍为确定性。

交付：

1. 能力契约类型与校验器。
2. 锁提供器抽象层与本地实现。
3. 并发调度实现与一致性测试。

### Phase 3（Day 7-8）：注释与文档治理

1. 为 `src/**/*.ts` 补齐文件头导读（职责、边界、取舍）。
2. 在 I/O、恢复、重试、状态推进关键段补 Failure Window 注释。
3. `src/runtime/types.ts` 优先完成 TSDoc 契约注释。
4. 执行“禁止复读机注释”审查规则。

交付：

1. 注释补强 PR。
2. 文档同步更新与审查清单。

### Phase 4（Day 9-11）：可靠性与可观测升级

1. 增强 `stage-projector`，输出结构化运行路径（含因果链信息）。
2. 重试升级为“指数退避 + 抖动 + 上限 + 可观测指标”。
3. 新增重试与恢复指标采集（尝试次数、退避时长、失败分类）。

交付：

1. 路径投影工件。
2. 新重试策略实现与压测结果。

### Phase 5（Day 12-14）：验证与发布门禁

1. 单测：契约校验、锁、重试、投影。
2. 集成测：崩溃恢复窗口、并发一致性、checkpoint 回放一致性。
3. 质量门禁：`typecheck`、全量测试、关键基准（吞吐与恢复时延）。
4. 结项条件：功能正确、恢复一致、可观测可用、文档同步。

## 4. 风险与缓解

1. 并发升级破坏恢复顺序。  
缓解：更新合并顺序约束并增加回放一致性测试。
2. 语义重命名导致遗漏。  
缓解：全局静态扫描与契约测试覆盖。
3. 注释与实现漂移。  
缓解：关键逻辑改动必须同 PR 更新注释。

## 5. 验收标准（DoD）

1. 语义层：`UserProfile` 不再出现在运行时主路径。
2. 契约层：能力校验与锁抽象生效，且测试覆盖关键分支。
3. 恢复层：崩溃后回放结果与预期一致，无重复执行与漏执行。
4. 文档层：关键模块具备文件头导读与 Failure Window 注释。
5. 性能层：并发升级后吞吐提升，恢复时延不退化到不可接受范围。
