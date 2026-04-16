# OGSystem 统一强类型编译器落地执行清单（2026-04-16）

Archived: yes (delivery proposal; not active source of truth)  
Status: proposed  
Date: 2026-04-16  
Owner: Runtime maintainers

## 1. 目标

把当前分散在解析器、合同层、执行器里的校验，收敛成一个统一的强类型编译阶段。

目标不是“再造一门语言”，而是让以下事实在编译期成立：

- 图结构合法。
- join 语义合法。
- context 投影合法。
- flow contract 合法。
- role input 合法。
- resume 所需的语义指纹稳定。

运行时只消费已验证的 `TypedExecutionPlan`，尽量不再解释语义。

---

## 2. 当前基线

当前仓库已经具备以下前置能力：

1. Mermaid 受限子集解析与白名单 metadata 校验。
2. `parallel_split` / `all_of` / `quorum_of` / `context.map` / `loop.max` 语义。
3. `handoff.mode` + `handoff.contracts` 的合同加载与 JSON Schema 校验。
4. `role_input` 合同对投影对象的校验。
5. 文件优先恢复、checkpoint/WAL、审计记录和严格指纹。

对应实现入口：

- `src/runtime/parse-mermaid.ts`
- `src/runtime/flow-contract.ts`
- `src/runtime/role-executor.ts`
- `src/runtime/run-artifacts.ts`
- `src/runtime/graph-runner.ts`

本计划的任务，是把这些能力从“分散的运行时规则”升级成“统一编译结果”。

---

## 3. 目标架构

### 3.1 统一 IR

新增一个编译产物：

```ts
TypedExecutionPlan
```

它应包含：

- `basePlan`
- `typeEnv`
- `nodeTypesByRoleId`
- `flowTypesByKey`
- `projectionTypesByRoleId`
- `contractTypesById`
- `diagnostics`

### 3.2 统一类型环境

类型环境至少应包含：

- `RoleType`
- `FlowType`
- `ContextProjectionType`
- `JoinType`
- `ContractType`
- `LoopType`

### 3.3 编译与运行边界

编译器负责：

- 符号解析。
- 类型归一化。
- 约束求解。
- 诊断生成。
- Typed IR 输出。

运行时负责：

- 状态推进。
- 节点执行。
- IO。
- checkpoint。
- resume。

---

## 4. 实施原则

1. 编译期 fail-closed。
2. 运行时不重复解释已被编译器证明的规则。
3. 旧路径可并存，但必须可切换、可回退。
4. 复杂度优先集中在 compiler，不扩散到 executor。
5. 所有新增类型必须能回写到测试和文档。

---

## 5. 里程碑

### M1. 类型 IR 冻结

目标：先把类型数据结构定死。

### M2. 编译器前端

目标：从 `system.mmd`、`role package`、`contract bundle` 构造类型环境。

### M3. 约束求解

目标：把 flow / join / projection / role_input 合并校验。

### M4. 运行时接管

目标：runtime 改为消费 `TypedExecutionPlan`。

### M5. 回归与灰度

目标：通过测试、基准和文档后，切换默认路径。

---

## 6. 详细执行清单

### 6.1 冻结类型模型

- [ ] 新增 `TypedExecutionPlan` 定义。
- [ ] 为 `RoleType`、`FlowType`、`ContextProjectionType`、`JoinType`、`ContractType` 建立最小结构。
- [ ] 定义 `CompilerDiagnostic`。
- [ ] 定义 `CompilerResult`，包含成功/失败与 diagnostics。
- [ ] 明确 `TypedExecutionPlan` 是否替代现有 `ExecutionPlan`，或与之并存一段过渡期。
- [ ] 为 IR 字段制定稳定排序与 digest 规则。

验收：

- [ ] 任何相同输入在不同路径下生成一致 digest。
- [ ] IR 类型字段不依赖运行时内部对象的可变结构。

### 6.2 建立编译器前端

- [ ] 新增编译入口模块，例如 `src/runtime/compiler.ts`。
- [ ] 从 `SystemDefinition` 提取符号表。
- [ ] 从 `LoadedRolePackage` 提取 role schema、prompt schema、output schema。
- [ ] 从 `FlowContractPlan` 提取 flow/role_input 合同。
- [ ] 将 `parse-mermaid.ts` 的解析结果转成编译器 AST。
- [ ] 将 `context.map`、`join.sources`、`join.min`、`loop.max` 统一进入编译上下文。

验收：

- [ ] 编译器能独立输入 `system + roles + models + contracts`。
- [ ] 不依赖 runtime state 即可完成静态校验。

### 6.3 建立类型推导

- [ ] 为每个 role 生成 `RoleType`。
- [ ] 从 role output schema 推导输出类型。
- [ ] 从 `context.map` selector 推导投影字段类型。
- [ ] 从 `role_input` schema 推导接收类型。
- [ ] 从 `flow` 合同推导边类型。
- [ ] 从 `join` 语义推导合流类型。
- [ ] 将 `global.task` / `global.user_profile.*` / `direct.*` / `source(...)` 视作受限 selector 类型。

验收：

- [ ] `source(...)` 仅能在 join 上下文和合法 source 范围内通过。
- [ ] `context.map` 缺字段在编译期报错，而不是留给执行期。

### 6.4 统一约束求解

- [ ] 合并检查 `join.sources` 与 Mermaid 入边一致性。
- [ ] 合并检查 `join.min` 范围。
- [ ] 合并检查 `handoff.contracts` 与图边的绑定一致性。
- [ ] 合并检查 `role_input` 是否能被 `context.map` 满足。
- [ ] 合并检查 `flow` 合同是否能被实际输出事件满足。
- [ ] 合并检查 `loop.max` 是否覆盖所有循环路径。
- [ ] 合并检查 `route.order` 仅影响排序，不影响可达性。

验收：

- [ ] 所有现有 negative tests 都能在编译期给出稳定 diagnostics。
- [ ] 不出现“运行时才发现 join/contract 错误”的主路径回退。

### 6.5 生成 typed IR

- [ ] 编译输出保留 `basePlan`，便于过渡。
- [ ] 每个 node 附带已验证的输入/输出类型摘要。
- [ ] 每条 flow 附带已验证的合同摘要。
- [ ] 每个 projection 附带稳定字段顺序。
- [ ] 每个 join 附带就绪条件和 source 集合。
- [ ] 生成编译产物 digest，并纳入 resume 指纹。

验收：

- [ ] 同一份系统定义生成的 typed IR 稳定可复现。
- [ ] IR 可序列化、可比较、可 fingerprint。

### 6.6 改造运行时消费方式

- [ ] `graph-runner` 只读取 typed IR 的节点和边。
- [ ] `role-executor` 只消费编译后的投影结果与合同摘要。
- [ ] `run-artifacts` 的 fingerprint 包含 compiler digest。
- [ ] 运行时保留防御性断言，但不再承担读型校验。
- [ ] 将已编译的 input/output 形状写入审计事件。

验收：

- [ ] runtime 不再依赖重复解析 `context.map`、`join.sources`、`handoff.contracts`。
- [ ] resume 对编译产物变化敏感，但对无关运行时噪声不敏感。

### 6.7 迁移现有校验

- [ ] 将 parser 中可静态判定的规则迁入 compiler。
- [ ] 将 `flow-contract.ts` 中可前置的 schema 绑定逻辑迁入 compiler。
- [ ] 将 `role-executor.ts` 中的 `role_input` 合同前置到编译期。
- [ ] 将 `context.map` selector 的合法性判断前置到编译期。
- [ ] 保留少量 runtime 断言作为最后防线。

验收：

- [ ] 新旧路径在测试上等价。
- [ ] 旧 runtime 校验逐步退场，但不一次性删除。

### 6.8 测试体系

- [ ] 增加 compiler 单元测试。
- [ ] 增加 compiler negative tests。
- [ ] 增加 typed IR digest 测试。
- [ ] 增加 resume fingerprint 稳定性测试。
- [ ] 增加 example-system 端到端测试。
- [ ] 增加 compiler 与 runtime shadow compare 测试。

必须覆盖的案例：

- [ ] `parallel_split`
- [ ] `all_of`
- [ ] `quorum_of`
- [ ] `context.map`
- [ ] `role_input`
- [ ] `handoff.mode=strict`
- [ ] `handoff.mode=transition`
- [ ] `loop.max`
- [ ] `route.order`

### 6.9 文档回写

- [ ] 更新 `docs/product-introduction.md`。
- [ ] 更新 `docs/usage-manual.md`。
- [ ] 更新 `docs/ogsystem-orchestration-semantics-v1.md`。
- [ ] 更新 `docs/README.md` 索引。
- [ ] 更新 `docs/todo-backlog.md`，将 compiler 主线和稳定性主线拆开。
- [ ] 为编译器补一份专门的设计说明或语义附录。

---

## 7. 推荐实现顺序

### Phase 1: IR 与诊断

1. 定义 typed IR。
2. 定义 diagnostics。
3. 定义 compiler digest。

### Phase 2: 前端与类型环境

1. 读入 system / role / contract。
2. 建立符号表。
3. 解析 selector / join / flow / role_input。

### Phase 3: 统一校验

1. 结构合法性。
2. 类型兼容性。
3. 合同可满足性。

### Phase 4: runtime 接管

1. graph-runner 消费 typed IR。
2. role-executor 简化为执行器。
3. resume fingerprint 改为 compiler digest 驱动。

### Phase 5: 灰度发布

1. 影子编译。
2. 对照诊断。
3. 切默认路径。

---

## 8. 验收标准

- [ ] 现有例子全部能被 compiler 接受。
- [ ] 所有负例在编译期失败。
- [ ] runtime 不再重复校验已由 compiler 证明的规则。
- [ ] resume 对 typed IR digest 敏感。
- [ ] 审计记录能回溯到 typed IR 证据。
- [ ] 文档与代码一致。

---

## 9. 对现有语义的影响

### 9.1 `context.map`

- 仍然只允许受限 selector，不引入任意历史节点查询。
- `direct.*`、`global.task`、`global.user_profile.*`、`source(...)` 仍是唯一基础来源族。
- `source(...)` 继续受 `join.sources` 和 join 语义约束，不会变成通用 graph state 访问器。
- 编译器会把 selector 合法性前移到编译期，因此无效 selector 会更早失败。

### 9.2 `flow`

- flow 传递的核心 envelope 仍然是 `event/content/data`。
- `context.map` 不会被塞进 flow payload。
- flow 合同会变成编译期可证明的边类型摘要，运行时只做执行和最少量防御性校验。

### 9.3 `role_input`

- `role_input` 仍然校验“投影后的结构化输入”，不是字符串化 prompt。
- 其可达性判断会更早发生，减少运行时才发现字段缺失的情况。
- `role.inputSchema` 继续保留为技术层护栏，不会被 `role_input` 替代。

### 9.4 `resume` 与审计

- resume 的稳定性会提升，因为编译结果会参与 digest。
- 审计仍然以运行时实际执行证据为准，不会被编译产物覆盖。

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

- 先冻结最小类型集，不引入通用推导。
- 优先支持 OGSystem 已有语义，不扩展表达力。

### 风险 3：IR digest 不稳定

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

- [ ] `TypedExecutionPlan` 成功替代 runtime 的主要解释性校验路径。
- [ ] `flow`、`join`、`context.map`、`role_input` 都在编译期统一收敛。
- [ ] runtime 只负责执行、持久化、恢复和审计。
- [ ] 现有主例子和负例都通过回归。
- [ ] 相关文档同步更新并对齐。
