# OGSystem Flow / Edge 语义对齐审计（2026-04-15）

Archived: yes (decision record; active conclusions have been written back to the canonical docs)

## 1. 结论

结论：**`flow` 应作为 OGSystem 的根语义，`edge` 只保留给 Mermaid 语法表层。**

原因很直接：

1. 运行时核心类型已经是 `Flow`，不是 `Edge`。
2. parser 明确把 Mermaid `edge` 归一化成 runtime `flow`。
3. 业务合同、调度、路由、join readiness 都是在 `flow` 语义上工作。

因此，当前仓内所有命名应按以下原则统一：

1. **语法层**：说 `edge`。
2. **语义层 / runtime 层 / 配置层**：说 `flow`。
3. 不再把 `edge` 当成独立运行时概念扩散到配置、功能开关、文档主术语里。

---

## 2. 证据

### 2.1 Runtime 根类型是 `Flow`

`src/runtime/types.ts` 中：

1. 根图转移类型是 `Flow`。
2. `SystemDefinition.flows`、`ExecutionPlanNode.incoming/outgoing`、`ExecutionPlan.flows` 全部以 `Flow` 为单位。

这说明在系统实现里，**运行时真正理解的是 flow，不是 edge**。

### 2.2 Parser 已经把 Mermaid edge 归一成 flow

`src/runtime/parse-mermaid.ts` 中明确写着：

> Boundary edges are normalized into the same role-flow model the runtime uses

即：

1. Mermaid 文件里用户写的是 edge。
2. parser 内部 token 化时可以叫 edge。
3. 一旦进入系统语义与执行模型，就统一变成 flow。

这条边界已经在实现层存在，只是文档和配置命名还没有完全跟上。

---

## 3. 三层命名模型（建议冻结）

### 3.1 Mermaid 语法层：允许使用 `edge`

仅以下场景使用 `edge`：

1. Mermaid 原文语法。
2. parser token 化阶段。
3. 解释 `A -->|EVENT| B` 这种源文件形态。

允许保留的词：

1. `edge`
2. `edge label`
3. `boundary edge`
4. `TokenizedEdge`
5. `parseEdgeLine`

原因：这些词描述的是**文本语法结构**，不是运行时语义。

### 3.2 编译与运行时语义层：统一使用 `flow`

以下场景应统一使用 `flow`：

1. 图转移语义。
2. 路由与命中规则。
3. join 的入边/出边语义说明。
4. 错误补偿路径。
5. feature flag / config 命名。
6. 业务合同与校验对象。

推荐主术语：

1. `flow`
2. `incoming flow`
3. `outgoing flow`
4. `error flow`
5. `business flow`
6. `flow routing`
7. `flow contract`

### 3.3 文档表达层：采用“双层表述”

推荐写法：

1. “Mermaid incoming edges 会被编译成 runtime incoming flows”
2. “ERROR* 在 Mermaid 中表现为 edge label，在运行时语义上属于 error flow”
3. “join.sources 必须与 join 节点的 Mermaid incoming edges 一致；编译后它们对应同一组 incoming flows”

这样既不丢语法事实，也不让语义层漂移。

---

## 4. 当前不对齐点

### 4.1 `runtime.error_edges.v1` 与根语义冲突

当前 runtime 配置键是：

1. `runtime.error_edges.v1`

问题：

1. 它属于 runtime 配置，不是 Mermaid 语法层。
2. 它控制的是失败路由语义，而不是“文本 edge 解析开关”。
3. 因此这里继续用 `edge`，与 runtime 以 `Flow` 为根语义不一致。

结论：

1. **目标 canonical 应改为 `runtime.error_flows.v1`。**
2. `runtime.error_edges.v1` 不应继续保留，应直接退出活跃语义与活跃配置面。

### 4.2 “异常边语义”应改成“异常流语义”

当前大量文档使用：

1. `异常边语义`
2. `ERROR* edges`
3. `business event edges`

问题：

1. 这些表述把 Mermaid 语法词汇直接提升成系统根语义。
2. 会和代码内 `Flow`、`flows`、`outgoing flows` 冲突。

结论：

1. 文档主标题和主术语应改为 `异常流语义` / `error flow semantics`。
2. 仅在解释 Mermaid 写法时，保留“`ERROR*` edge label”。

### 4.3 `error-edge-*` 文件/目录命名是次级不一致

例如：

1. `src/runtime/error-edge-utils.ts`
2. `tests/error-edge-runtime.test.mjs`
3. `examples/error-edge-compensation/`

这些命名不影响语义正确性，但会持续强化错误词汇。

结论：

1. 可以分阶段改。
2. 优先级低于 config canonical 与主文档术语修正。

---

## 5. 建议的统一口径

### 5.1 总原则

一句话原则：

**写 Mermaid 时说 edge，谈 runtime 时说 flow。**

### 5.2 推荐术语映射

1. `Mermaid edge` -> 语法层术语，保留。
2. `role edge` -> 若指 runtime 转移，改成 `role flow`。
3. `incoming edges` -> 若指 Mermaid 原文，可保留；若指运行时匹配结果，改成 `incoming flows`。
4. `ERROR* edge semantics` -> 改成 `ERROR* error flow semantics`。
5. `business event edges` -> 改成 `business event flows`。
6. `error_edges` -> canonical 改为 `error_flows`。

---

## 6. 目标命名方案

### 6.1 配置层

目标 canonical：

1. `runtime.error_flows.v1`

不再保留：

1. `runtime.error_edges.v1`

执行原则：

1. 活跃文档、活跃代码、活跃测试、活跃示例全部直接切换为 `runtime.error_flows.v1`。
2. 不设计 alias、deprecation、双键共存规则。
3. 历史语义仅留在 `docs/archive/**` 或明确历史说明中。

### 6.2 文档层

目标主术语：

1. `异常流语义`
2. `error flow`
3. `business flow`
4. `flow routing`

保留的语法层表述：

1. `ERROR* edge label`
2. `Mermaid incoming edges`
3. `boundary edge`

### 6.3 代码层

建议目标：

1. `error-edge-utils.ts` -> `error-flow-utils.ts`
2. `errorEdgeRoutingEnabled` -> `errorFlowRoutingEnabled`
3. `runtime.error_edges.v1` 对应内部字段 -> `runtime.error_flows.v1`

但以下命名可保留：

1. `TokenizedEdge`
2. `parseEdgeLine`
3. parser 内部围绕 Mermaid 行解析的 `edge` 变量

因为这些属于语法层。

---

## 7. 迁移顺序（推荐）

### Phase 1：先冻结语言，不急着全仓重命名

1. 先在活跃文档中冻结原则：`flow` 是根语义，`edge` 是 Mermaid 表层。
2. 所有新文档按此口径写。
3. 新 RFC 与新设计文档不再继续扩散 `error_edges` / `异常边`。

### Phase 2：配置 canonical 切换

1. runtime config 新增 `runtime.error_flows.v1`。
2. 活跃代码与 schema 同步移除 `runtime.error_edges.v1`。
3. 文档与示例统一展示 `runtime.error_flows.v1`。

### Phase 3：代码与文件名清理

1. `error-edge-*` helper/test/example 逐步改名。
2. 文案中的 `exception edge` / `异常边` 统一替换为 `error flow` / `异常流`。
3. 保留 parser 里的 `edge` 词汇不动。

---

## 8. 不该一刀切替换的地方

以下地方**不建议**从 `edge` 改成 `flow`：

1. Mermaid 源文件说明。
2. parser token 命名。
3. `edge label` 这类纯语法概念。
4. 任何明确在解释 `A -->|EVENT| B` 文本形式的段落。

原因：

1. 那些地方描述的是语法，不是运行时模型。
2. 如果全部改成 `flow`，反而会把“源文件写法”和“编译后语义”混掉。

---

## 9. 最终建议

1. 接受“`flow` 是根语义，`edge` 只是 Mermaid 表层”这一原则。
2. 将 `runtime.error_flows.v1` 设为唯一 canonical，不再保留 `runtime.error_edges.v1`。
3. 活跃文档中的“异常边语义”统一改为“异常流语义”。
4. 仅在 Mermaid 语法说明里继续使用 `edge`。
5. helper/test/example 的 `error-edge-*` 文件路径改名放到第二阶段，不作为第一阶段阻塞项。
