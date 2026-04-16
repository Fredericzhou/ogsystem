# OGSystem 统一静态编译入口执行清单（v1，2026-04-16）

Archived: yes (delivery proposal; updated with current implementation status)  
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

- 不要求 runtime 完全只消费编译摘要。
- 不要求一次性移除 parser / executor / runner 里的防御性校验。
- 不做通用类型推导器，不扩展 OGSystem 的表达力。

---

## 2. 当前实际状态

当前仓库里，`compiler facade` 已经落地在 `src/runtime/compiler.ts`，很多“前置校验”仍然分散落在现有模块中：

- `src/runtime/parse-mermaid.ts` 已经负责 Mermaid 子集解析、`entry.role`、`route.order`、`context.map`、`join.*`、`loop.max`、`model.bind`、`exec.bind`、`handoff.mode` 的静态校验，并产出 `SystemDefinition`。
- `src/runtime/flow-contract.ts` 已经负责合同 bundle 读取、局部 `$ref` 解析、JSON Schema 校验、`role_input` 绑定、`handoff.mode=strict` 约束检查，并生成合同 digest。
- `src/runtime/execution-plan.ts` 已经把 `SystemDefinition` 归一化成 runtime execution plan，保留 binding、join、context、loop 和 route order 语义。
- `src/runtime/role-executor.ts` 仍保留运行时最后防线，负责 projection、join context、输入校验和执行证据落盘。
- `src/runtime/adapter.ts` / `src/runtime/run-artifacts.ts` 已经有 resume fingerprint 体系，现阶段覆盖 `system`、`rolePackages`、`modelPackages`、`effectiveLaw`，并配套 outcome、checkpoint、WAL 风格持久化。
- 现有测试已经覆盖 lint、execution plan 归一化、resume fingerprint 等关键路径。

因此，这次执行清单的目标不是“从零引入类型系统”，而是把这些分散的静态事实收拢成一个统一的编译入口，并把 runtime 重复校验逐步压缩到最后防线。

---

## 3. v1 最小架构

### 3.1 编译结果

引入一个轻量编译结果：

```ts
CompiledExecutionSnapshot
```

最小字段建议如下：

- `basePlan`
- `diagnostics`
- `digest`
- `projectionSummaryByRoleId`
- `contractSummaryById`
- `joinSummaryByRoleId`

其中 `projectionSummaryByRoleId` 只是派生摘要，不是 v1 的唯一 source of truth；它必须明确复用现有 `role-executor` 的投影规范化规则，不能假装编译器已经独立接管 projection 生成。

### 3.2 静态事实

v1 只冻结当前已经存在的事实，不做通用类型推导：

- `RoleSummary`
- `FlowSummary`
- `ContextProjectionSummary`
- `JoinSummary`
- `ContractSummary`
- `LoopSummary`
- `BindingSummary`
- `LawSummary`

### 3.3 编译 / 运行边界

编译阶段负责：

- 符号解析。
- selector / join / route.order 合法性检查。
- `role_input` 和 `flow` 合同可绑定性检查。
- `model.bind` / `exec.bind` / effective law 的摘要收集。
- 稳定 diagnostics。
- 稳定 digest。

运行时继续负责：

- 状态推进。
- 节点执行。
- IO。
- checkpoint / resume。
- 审计落盘。

---

## 4. 实施原则

1. 编译期 fail-closed，但优先返回 diagnostics，而不是扩大 runtime 替换面。
2. 运行时保留最后防线，不假设 compiler 覆盖所有路径。
3. 旧路径必须可并存、可切换、可回退。
4. 复杂度先集中在 `compiler.ts` / compiler facade，不扩散到 executor。
5. 所有新增规则必须回写测试和文档。

---

## 5. 完整执行清单

### 5.1 已存在能力，先确认不重复建设

- [x] `parse-mermaid.ts` 已完成受限 Mermaid 解析和静态验证。
- [x] `parse-mermaid.ts` 已覆盖 `parallel_split` / `all_of` / `quorum_of` / `context.map` / `loop.max` / `route.order` 语义。
- [x] `flow-contract.ts` 已完成合同 bundle 加载和 JSON Schema 校验。
- [x] `flow-contract.ts` 已完成 `role_input` 与 `flow` 合同绑定校验。
- [x] `role-executor.ts` 已保留 runtime 投影和防御性校验。
- [x] `run-artifacts.ts` 已支持 plan fingerprint 和 resume mismatch 校验。
- [x] `execution-plan.ts` 已完成 runtime plan 归一化和 binding 选择。

### 5.2 编译核心类型

- [x] 新增 `CompiledExecutionSnapshot`。
- [x] 定义 `CompilerDiagnostic`。
- [x] 定义 `CompilerResult`，包含成功 / 失败、diagnostics 和 digest。
- [x] 为 `RoleSummary`、`FlowSummary`、`ContextProjectionSummary`、`JoinSummary`、`ContractSummary`、`LoopSummary`、`BindingSummary`、`LawSummary` 建立最小结构。
- [x] 为结果字段制定稳定排序规则。
- [x] 明确 digest 只包含语义字段，不包含运行时噪声。

验收：

- [x] 相同输入在不同路径下生成一致 digest。
- [x] 结果字段不依赖运行时内部可变对象。

### 5.3 编译前端

- [x] 新增编译入口模块，例如 `src/runtime/compiler.ts`。
- [x] 从 `SystemDefinition` 提取符号表。
- [x] 从 `LoadedRolePackage` 提取 role schema、prompt schema、output schema。
- [x] 从 `FlowContractPlan` 提取 `flow` / `role_input` 合同。
- [x] 从 `ExecutionPlan` 提取 `model.bind`、`exec.bind`、`route.order`、`context.map`、`join`、`loop.max` 元信息。
- [x] 从 effective law / runtime policy 提取可稳定摘要的约束事实。
- [x] 把 `parse-mermaid.ts` 的解析结果转换成编译器输入结构。

验收：

- [x] 编译器能独立输入 `system + roles + contracts + policy`。
- [x] 不依赖 runtime state 也能完成静态校验。

### 5.4 统一 diagnostics

- [x] 对 `context.map` selector 做编译期合法性检查。
- [x] 对 `join.sources`、`join.min`、入边一致性做编译期合法性检查。
- [x] 对 `role_input` 合同的可绑定性做编译期合法性检查。
- [x] 对 `flow` 合同的可绑定性做编译期合法性检查。
- [x] 对 `loop.max` 做编译期合法性检查。
- [x] 对 `model.bind`、`exec.bind`、effective law 的摘要稳定性做编译期检查。
- [x] 对 `route.order` 的排序语义与可达性边界做编译期检查。
- [x] 建立 runtime failure -> compiler diagnostic 的对照映射。

验收：

- [x] 负例能够提前产出稳定 diagnostics。
- [x] 同一输入的 compiler diagnostics 与 runtime 失败原因可对照。

### 5.5 生成编译快照

- [x] 编译输出保留 `basePlan`，便于过渡。
- [x] 每个 node 附带静态摘要。
- [x] 每条 flow 附带静态摘要。
- [x] 每个 projection 附带稳定字段顺序。
- [x] 每个 join 附带就绪条件和 source 集合。
- [x] 每个 node 附带 `model.bind` / `exec.bind` 摘要。
- [x] 每个系统附带 effective law 摘要。
- [x] `route.order` 作为排序摘要进入快照，但不改变可达性。
- [x] 生成 compiler digest，并纳入 resume 指纹。
- [x] `projectionSummaryByRoleId` 仅在能稳定复用现有投影规则时生成，且不替代 `role-executor` 的运行时投影真源。

验收：

- [x] 同一份系统定义生成的快照稳定可复现。
- [x] 快照可序列化、可比较、可 fingerprint。

### 5.6 运行时接入

- [x] `graph-runner` 先接收 compiler 输出，但保留现有执行路径。
- [x] `role-executor` 优先消费编译后的 projection / contract 摘要，但保留防御性校验。
- [x] 在现有 `system` / `rolePackages` / `modelPackages` / `effectiveLaw` fingerprint 基础上追加 compiler digest、`model.bind` / `exec.bind` 摘要和 effective law 的编译摘要。
- [x] 审计事件写入编译摘要，方便回溯。
- [x] 旧 runtime 校验保持为 last defense，不在 v1 一次性删除。
- [x] projection 相关摘要只作为可选派生层，不改变 runtime 作为最终投影真源的职责边界。

验收：

- [x] runtime 对已前置规则尽量改为摘要消费或 last defense，不把它们重新做成主路径解释逻辑。
- [x] resume 对编译产物变化敏感，但对无关运行时噪声不敏感。

### 5.7 测试体系

- [x] 增加 compiler 单元测试。
- [x] 增加 compiler negative tests。
- [x] 增加 digest 稳定性测试。
- [x] 增加 compiler 与 runtime shadow compare 测试。
- [x] 增加 example-system 端到端测试。
- [x] 增加 resume fingerprint 兼容性测试。

必须覆盖的案例：

- [x] `parallel_split`
- [x] `all_of`
- [x] `quorum_of`
- [x] `context.map`
- [x] `role_input`
- [x] `model.bind`
- [x] `exec.bind`
- [x] `effectiveLaw`
- [x] `handoff.mode=strict`
- [x] `handoff.mode=transition`
- [x] `loop.max`
- [x] `route.order`

### 5.8 文档回写

- [x] 更新 `docs/product-introduction.md`。
- [x] 更新 `docs/usage-manual.md`。
- [x] 更新 `docs/ogsystem-orchestration-semantics-v1.md`。
- [x] 更新 `docs/README.md` 索引。
- [x] 更新 `docs/todo-backlog.md`，拆分 compiler 主线和稳定性主线。
- [x] 为 compiler 补一份专门的设计说明或语义附录。

---

## 6. 推荐实现顺序

### Phase 1: 核心定义

1. 定义编译结果结构。
2. 定义 diagnostics。
3. 定义 digest。

### Phase 2: 编译前端

1. 读入 system / role / contract / policy。
2. 建立符号表。
3. 解析 selector / join / flow / role_input / route.order。

### Phase 3: 影子校验

1. 对照现有 runtime 校验结果。
2. 统一 diagnostics 形状。
3. 补足负例测试。

### Phase 4: 选择性前置

1. 前置明显可判定的静态规则。
2. 保留 runtime 防线。
3. 让运行时开始消费摘要，而不是重复解释。

### Phase 5: 小步发布

1. 影子编译。
2. 对照诊断。
3. 逐步切默认路径。

---

## 7. 验收标准

- [x] 现有主例子在编译器下保持通过。
- [x] 已纳入编译入口的主要静态负例能得到稳定 diagnostics。
- [x] runtime 仍保留最后防线，但不再把已前置规则放在主路径里重复解释。
- [x] resume 对 digest 敏感。
- [x] 审计记录能回溯到编译摘要。
- [x] 文档与代码一致。

---

## 8. 对现有语义的影响

### 8.1 `context.map`

- 仍然只允许受限 selector，不引入任意历史节点查询。
- `direct.*`、`global.task`、`global.user_profile.*`、`source(...)` 仍是唯一基础来源族。
- `source(...)` 继续受 `join.sources` 和 join 语义约束，不会变成通用 graph state 访问器。
- 编译器会把 selector 的语法和绑定合法性前移到编译期；source 可达性和 lineage 相关失败仍可能保留在运行时最后防线中，因此不会把它描述成纯静态可证明。

### 8.2 `flow`

- flow 传递的核心 envelope 仍然是 `event/content/data`。
- `context.map` 不会被塞进 flow payload。
- flow 合同会被提前绑定并生成摘要，但 runtime 仍保留少量防御性校验。

### 8.3 `role_input`

- `role_input` 仍然校验“投影后的结构化输入”，不是字符串化 prompt。
- 其可达性判断会更早发生，减少运行时才发现字段缺失的情况。
- `role.inputSchema` 继续保留为技术层护栏，不会被 `role_input` 替代。

### 8.4 `resume` 与审计

- resume 的稳定性会提升，因为 compiler digest 会参与指纹。
- 审计仍然以运行时实际执行证据为准，不会被编译摘要覆盖。

---

## 9. 风险与回退

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

## 10. 最小定义完成

当以下条件同时满足时，可以认为本计划 v1 完成：

- [x] 编译前置路径已经覆盖主要静态规则。
- [x] `flow`、`join`、`context.map`、`role_input` 在编译期得到统一 diagnostics。
- [x] runtime 仍然负责执行、持久化、恢复和审计。
- [x] 现有主例子和负例都通过回归。
- [x] 相关文档同步更新并对齐。
