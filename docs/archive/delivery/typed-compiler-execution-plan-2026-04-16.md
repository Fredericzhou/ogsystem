# OGSystem 统一编译前置执行清单（v1，2026-04-16）

Archived: yes (delivery proposal; not active source of truth)  
Status: revised proposal  
Date: 2026-04-16  
Owner: Runtime maintainers

## 1. 目标

把当前分散在解析器、合同层、执行器里的静态校验前置到一个统一的编译入口，但不在 v1 直接替换运行时主路径。

v1 的目标是：

- 统一收集 system / role / contract / projection 的静态事实。
- 生成稳定 diagnostics。
- 生成稳定 digest，参与 resume 指纹。
- 影子比较 compiler 结果和现有 runtime 校验结果。
- 先把“明显可前置”的规则迁移出去，其他规则保留 runtime 防线。

v1 不做的事：

- 不要求 runtime 完全只消费 typed IR。
- 不要求一次性移除 parser / executor / runner 里的防御性校验。
- 不做通用类型推导器，不扩展 OGSystem 的表达力。

---

## 2. 当前基线

当前仓库已经具备以下前置能力：

1. Mermaid 受限子集解析与白名单 metadata 校验。
2. `parallel_split` / `all_of` / `quorum_of` / `context.map` / `loop.max` 语义。
3. `handoff.mode` + `handoff.contracts` 的合同加载与 JSON Schema 校验。
4. `role_input` 合同对投影对象的校验。
5. 文件优先恢复、checkpoint/WAL、审计记录和严格指纹。
6. `model.bind` / `exec.bind` / effective law 已在运行时绑定与约束链路中生效，但尚未统一进入编译摘要。

对应实现入口：

- `src/runtime/parse-mermaid.ts`
- `src/runtime/flow-contract.ts`
- `src/runtime/role-executor.ts`
- `src/runtime/run-artifacts.ts`
- `src/runtime/graph-runner.ts`

本计划的任务，是把这些能力从“分散的运行时规则”收敛成“编译前置 + 影子诊断”。

---

## 3. v1 目标架构

### 3.1 轻量编译产物

引入一个轻量编译结果：

```ts
CompiledExecutionSnapshot
```

它应包含：

- `basePlan`
- `diagnostics`
- `digest`
- `projectionSummaryByRoleId`
- `contractSummaryById`
- `joinSummaryByRoleId`

### 3.2 类型环境

v1 不建立完整的通用类型系统，只冻结当前已存在的静态事实：

- `RoleSummary`
- `FlowSummary`
- `ContextProjectionSummary`
- `JoinSummary`
- `ContractSummary`
- `LoopSummary`

### 3.3 编译与运行边界

编译阶段负责：

- 符号解析。
- 选择器合法性检查。
- 合同可绑定性检查。
- `model.bind` / `exec.bind` / effective law 的静态摘要收集。
- 约束诊断。
- 稳定 digest 生成。

运行时继续负责：

- 状态推进。
- 节点执行。
- IO。
- checkpoint。
- resume。

---

## 4. 实施原则

1. 编译期 fail-closed，但优先产出 diagnostics 而不是直接扩大运行时替换面。
2. 运行时保留最后防线，不假设编译器永远覆盖所有路径。
3. 旧路径必须可并存，可切换，可回退。
4. 复杂度先集中在 compiler facade，不扩散到 executor。
5. 所有新增规则必须回写到测试和文档。

---

## 5. 里程碑

### M1. 诊断与 digest

目标：先把稳定 diagnostics 和稳定 digest 做出来。

### M2. 编译前端

目标：从 `system.mmd`、`role package`、`contract bundle` 收集静态事实。

### M3. 影子校验

目标：compiler 与现有 runtime 校验并跑，输出可比对结果。

### M4. 选择性前置

目标：先把可静态判定的规则迁移到 compiler facade。

### M5. 小步接管

目标：在测试和示例稳定后，逐步减少 runtime 的重复校验。

---

## 6. 详细执行清单

### 6.1 冻结编译结果

- [ ] 新增 `CompiledExecutionSnapshot` 定义。
- [ ] 为 `RoleSummary`、`FlowSummary`、`ContextProjectionSummary`、`JoinSummary`、`ContractSummary` 建立最小结构。
- [ ] 为 `model.bind`、`exec.bind`、effective law、`route.order` 建立静态摘要结构。
- [ ] 定义 `CompilerDiagnostic`。
- [ ] 定义 `CompilerResult`，包含成功/失败与 diagnostics。
- [ ] 为结果字段制定稳定排序与 digest 规则。

验收：

- [ ] 相同输入在不同路径下生成一致 digest。
- [ ] 结果字段不依赖运行时内部对象的可变结构。

### 6.2 建立编译前端

- [ ] 新增编译入口模块，例如 `src/runtime/compiler.ts`。
- [ ] 从 `SystemDefinition` 提取符号表。
- [ ] 从 `LoadedRolePackage` 提取 role schema、prompt schema、output schema。
- [ ] 从 `FlowContractPlan` 提取 flow/role_input 合同。
- [ ] 从 `ExecutionPlan` 提取 `model.bind`、`exec.bind`、`route.order`、`context.map`、`join` 元信息。
- [ ] 从 effective law / runtime policy 提取可稳定摘要的约束事实。
- [ ] 将 `parse-mermaid.ts` 的解析结果转成编译器输入结构。

验收：

- [ ] 编译器能独立输入 `system + roles + contracts + policy`。
- [ ] 不依赖 runtime state 即可完成静态校验。

### 6.3 影子校验

- [ ] 对 `context.map` selector 做编译期合法性检查。
- [ ] 对 `join.sources` / `join.min` / 入边一致性做编译期合法性检查。
- [ ] 对 `role_input` 合同的可绑定性做编译期合法性检查。
- [ ] 对 `flow` 合同的可绑定性做编译期合法性检查。
- [ ] 对 `loop.max` 做编译期合法性检查。
- [ ] 对 `model.bind` / `exec.bind` / effective law 的摘要稳定性做编译期检查。
- [ ] 对 `route.order` 的排序语义与可达性边界做编译期检查。

验收：

- [ ] 负例能够提前产出稳定 diagnostics。
- [ ] 同一输入的 compiler diagnostics 与 runtime 失败原因可对照。

### 6.4 生成编译快照

- [ ] 编译输出保留 `basePlan`，便于过渡。
- [ ] 每个 node 附带静态摘要。
- [ ] 每条 flow 附带静态摘要。
- [ ] 每个 projection 附带稳定字段顺序。
- [ ] 每个 join 附带就绪条件和 source 集合。
- [ ] 每个 node 附带 `model.bind` / `exec.bind` 摘要。
- [ ] 每个系统附带 effective law 摘要。
- [ ] `route.order` 作为排序摘要进入快照，但不改变可达性。
- [ ] 生成编译 digest，并纳入 resume 指纹。

验收：

- [ ] 同一份系统定义生成的快照稳定可复现。
- [ ] 快照可序列化、可比较、可 fingerprint。

### 6.5 运行时迁移策略

- [ ] `graph-runner` 先接收 compiler 输出，但保留现有执行路径。
- [ ] `role-executor` 优先消费编译后的 projection / contract 摘要，但保留防御性校验。
- [ ] `run-artifacts` 的 fingerprint 包含 compiler digest、`model.bind` / `exec.bind` 摘要和 effective law 摘要。
- [ ] 审计事件写入编译摘要，方便回溯。

验收：

- [ ] runtime 不再重复解释明显已验证的静态规则。
- [ ] resume 对编译产物变化敏感，但对无关运行时噪声不敏感。

### 6.6 迁移现有校验

- [ ] 将 parser 中可静态判定的规则迁入 compiler facade。
- [ ] 将 `flow-contract.ts` 中可前置的 schema 绑定逻辑迁入 compiler facade。
- [ ] 将 `role-executor.ts` 中的 `role_input` 合同前置到编译期可验证阶段。
- [ ] 将 `route.order`、`model.bind`、`exec.bind`、effective law 纳入编译摘要和 digest 规则。
- [ ] 保留少量 runtime 断言作为最后防线。

验收：

- [ ] 新旧路径在测试上等价。
- [ ] 旧 runtime 校验可逐步退场，但不一次性删除。

### 6.7 测试体系

- [ ] 增加 compiler 单元测试。
- [ ] 增加 compiler negative tests。
- [ ] 增加 digest 稳定性测试。
- [ ] 增加 compiler 与 runtime shadow compare 测试。
- [ ] 增加 example-system 端到端测试。

必须覆盖的案例：

- [ ] `parallel_split`
- [ ] `all_of`
- [ ] `quorum_of`
- [ ] `context.map`
- [ ] `role_input`
- [ ] `model.bind`
- [ ] `exec.bind`
- [ ] `effectiveLaw`
- [ ] `handoff.mode=strict`
- [ ] `handoff.mode=transition`
- [ ] `loop.max`
- [ ] `route.order`

### 6.8 文档回写

- [ ] 更新 `docs/product-introduction.md`。
- [ ] 更新 `docs/usage-manual.md`。
- [ ] 更新 `docs/ogsystem-orchestration-semantics-v1.md`。
- [ ] 更新 `docs/README.md` 索引。
- [ ] 更新 `docs/todo-backlog.md`，拆分 compiler 主线和稳定性主线。
- [ ] 为编译器补一份专门的设计说明或语义附录。

---

## 7. 推荐实现顺序

### Phase 1: 诊断与 digest

1. 定义编译结果结构。
2. 定义 diagnostics。
3. 定义 digest。

### Phase 2: 编译前端

1. 读入 system / role / contract。
2. 建立符号表。
3. 解析 selector / join / flow / role_input。

### Phase 3: 影子校验

1. 对照现有 runtime 校验结果。
2. 统一 diagnostics 形状。
3. 补足负例测试。

### Phase 4: 选择性前置

1. 前置明显可判定的静态规则。
2. 保留 runtime 防线。
3. 让运行时开始消费摘要而不是重复解释。

### Phase 5: 小步发布

1. 影子编译。
2. 对照诊断。
3. 逐步切默认路径。

---

## 8. 验收标准

- [ ] 现有例子全部能被 compiler 接受。
- [ ] 所有负例在编译期得到稳定 diagnostics。
- [ ] runtime 不再重复校验已由 compiler 证明的规则。
- [ ] resume 对 digest 敏感。
- [ ] 审计记录能回溯到编译摘要。
- [ ] 文档与代码一致。

---

## 9. 对现有语义的影响

### 9.1 `context.map`

- 仍然只允许受限 selector，不引入任意历史节点查询。
- `direct.*`、`global.task`、`global.user_profile.*`、`source(...)` 仍是唯一基础来源族。
- `source(...)` 继续受 `join.sources` 和 join 语义约束，不会变成通用 graph state 访问器。
- 编译器会把 selector 的语法和绑定合法性前移到编译期；source 可达性和 lineage 相关失败仍可能保留在运行时最后防线中，因此不会把它描述成纯静态可证明。

### 9.2 `flow`

- flow 传递的核心 envelope 仍然是 `event/content/data`。
- `context.map` 不会被塞进 flow payload。
- flow 合同会被提前绑定并生成摘要，但 runtime 仍保留少量防御性校验。

### 9.3 `role_input`

- `role_input` 仍然校验“投影后的结构化输入”，不是字符串化 prompt。
- 其可达性判断会更早发生，减少运行时才发现字段缺失的情况。
- `role.inputSchema` 继续保留为技术层护栏，不会被 `role_input` 替代。

### 9.4 `resume` 与审计

- resume 的稳定性会提升，因为编译 digest 会参与指纹。
- 审计仍然以运行时实际执行证据为准，不会被编译摘要覆盖。

---

## 10. 风险与回退

### 风险 1：编译器过严

表现：

- 合法系统被误拒绝。

回退：

- 保留 legacy validator 影子模式。
- 先做 diagnostics，不直接阻断发布。

### 风险 2：编译器复杂度过高

表现：

- 实现成本和维护成本高于 runtime 校验本身。

回退：

- 先冻结最小能力集，不引入通用推导。
- 优先支持 OGSystem 已有语义，不扩展表达力。

### 风险 3：digest 不稳定

表现：

- resume 频繁失效。

回退：

- 固定字段排序。
- 将非语义字段排除出 digest。

### 风险 4：测试面扩大

表现：

- 需要大量回归用例。

回退：

- 先覆盖 examples，再覆盖主语义负例。

---

## 11. 最小定义完成

当以下条件同时满足时，可以认为本计划 v1 完成：

- [ ] 编译前置路径已经覆盖主要静态规则。
- [ ] `flow`、`join`、`context.map`、`role_input` 在编译期得到统一 diagnostics。
- [ ] runtime 仍然负责执行、持久化、恢复和审计。
- [ ] 现有主例子和负例都通过回归。
- [ ] 相关文档同步更新并对齐。
