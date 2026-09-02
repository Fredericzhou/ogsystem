# Runtime Test Coverage Audit

Date: 2026-04-11
Scope: OGSystem runtime and orchestration critical paths

## 1. 执行结论

- 全量测试：`112/112` 通过（`npm test`）。
- 覆盖统计：`line 88.09% / branch 82.09% / funcs 90.54%`（`node --test --experimental-test-coverage tests`）。
- 关键场景（恢复、会话隔离、崩溃补偿、阈值清理、状态脱水）均有测试覆盖。

## 2. 关键场景覆盖清单

1. Resume 指纹一致性与漂移拒绝：已覆盖
   测试：`tests/resume-session.test.mjs`
2. Resume 锁互斥与 stale lock 接管：已覆盖
   测试：`tests/resume-session.test.mjs`、`tests/runtime-fault-injection.test.mjs`
3. Crash 窗口（durable outcome 与 checkpoint 对账）：已覆盖
   测试：`tests/runtime-fault-injection.test.mjs`
4. 会话血缘隔离（并行 sibling 不串会话）：已覆盖
   测试：`tests/session-recovery.test.mjs`、`tests/graph-runtime.integration.test.mjs`
5. Graph 语义（parallel_split / all_of / loop.max）：已覆盖
   测试：`tests/graph-runtime.integration.test.mjs`、`tests/parser.test.mjs`
6. 状态脱水（recentAudits + auditSummary）与 metrics 增强：已覆盖
   测试：`tests/graph-runtime.integration.test.mjs`
7. 显式阈值清理（retention enabled）：已覆盖
   测试：`tests/graph-runtime.integration.test.mjs`
8. retention 关闭时不触发自动清理：已覆盖
   测试：`tests/graph-runtime.integration.test.mjs`（2026-04-11 新增）
9. `events.ndjson` 读取容错与角色过滤：已覆盖
   测试：`tests/run-artifacts-events.test.mjs`（2026-04-11 新增）
10. transient 错误重试与 abort 失败兜底：已覆盖
    测试：`tests/opencode-executor.test.mjs`

## 3. 本轮新增覆盖

- 新增 `tests/run-artifacts-events.test.mjs`，验证：
  - 事件文件缺失时返回空集合。
  - 跳过损坏行/非审计行，并按角色白名单过滤。
- 扩展 `tests/graph-runtime.integration.test.mjs`，新增：
  - `retention.enabled=false` 时自动清理不会触发。

## 4. 残余覆盖短板（非阻断）

- `dist/runtime/opencode-executor.js` 行覆盖仍低于主流程文件，这是由大量 provider/transport 异常分支导致；当前关键重试和隔离链路已覆盖。
- `dist/runtime/doctor.js` 覆盖偏低，主要是命令行分支和可选诊断路径；不影响运行时核心正确性。

## 5. 建议

1. 将覆盖门槛聚焦在核心运行时模块（`adapter/graph-runner/run-artifacts/role-executor`）而不是所有 CLI 辅助文件一刀切。
2. 保持每次核心语义变更都同步追加“关键场景映射测试”。
