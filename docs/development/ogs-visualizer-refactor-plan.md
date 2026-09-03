# OGS 可视化重构方案

状态：活动实施方案

适用版本：OGS 开发测试版本 `0.3.x` 及后续版本

## 1. 目标

当前可视化已经具备图编辑、运行态投影、条件标签、责任席位和基础循环/Join 表达能力，但自动布局仍将拓扑修复、分层、排序、避让和边路由混合处理，复杂流程容易出现节点拥挤、边交叉和主路径不清晰的问题。

本方案的目标是建立一条稳定的可视化链路：

```text
SystemDefinition
  -> Semantic IR
  -> Responsibility Graph
  -> Semantic Layout Projection
  -> Dagre semantic layout adapter
  -> Layout Projection
  -> GraphViewModel
  -> X6 Renderer
  -> Interaction / Execution Overlay
```

本方案是 OGS 平台级能力，不绑定任何具体业务项目、角色名称、事件集合或领域流程。

## 2. 设计原则

1. Semantic IR 是业务语义唯一来源，X6 和 Dagre 都不是语义真相源。
2. 责任席位不是 branch 或 execution 实例；运行数据按角色聚合展示。
3. 业务图必须保留完整拓扑，布局不得删除循环、错误或异常边。
4. 静态结构、运行 overlay、布局投影和渲染交互分层。
5. 运行状态变化只更新 overlay，不触发完整重排。
6. 布局必须确定性、可诊断、可测试、可恢复。
7. 无法安全解释的布局约束应产生诊断，不应静默猜测。

## 3. 技术边界

### 3.1 Dagre semantic layout adapter

Dagre 是当前明确选择的 layered layout adapter，负责计算节点坐标和基础 rank。它不是流程运行时、业务语义引擎或渲染组件。OGS 不引入 ELK.js：当前 X6 bundle 需要保持轻量，现有图规模和交互需求不需要 ELK 的额外约束能力。

OGS 负责把业务语义转换成布局约束，包括：

- 主流程优先级；
- Join source 顺序；
- 错误流、循环流和 Join 流分类；
- 人工审核边界；
- input/output 锚点；
- 节点和边的稳定排序。

X6 负责：

- 绘制节点和边；
- 选择、拖拽、缩放和平移；
- 编辑交互；
- 运行 overlay 的视觉更新。

### 3.2 标准对齐

布局语义参考 Sugiyama 分层布局和 BPMN 2.0 / ISO/IEC 19510:2013 的任务、网关、人工任务和错误边界概念。OGS 不声称实现完整 BPMN 互操作；如需 BPMN 导入/导出，必须另行定义字段映射、版本和 conformance tests。

## 4. 分层模型

### 4.1 ResponsibilityGraph

```ts
type ResponsibilityGraph = {
  graphId: string;
  seats: ResponsibilitySeat[];
  transitions: ResponsibilityTransition[];
  boundaries: GraphBoundary[];
  loops: LoopScope[];
  joins: JoinSpec[];
};
```

它只包含静态责任和流程语义，不包含 x/y 坐标或当前执行状态。

### 4.2 ExecutionOverlay

```ts
type ExecutionOverlay = {
  activeBranchCount: number;
  completedCount: number;
  waitingReviewCount: number;
  joinReadiness?: JoinReadiness;
  selectedLineageId?: string;
  selectedBranchId?: string;
  selectedRoute?: string;
};
```

它只描述运行态，不改变静态图结构和布局结果。

### 4.3 LayoutProjection

```ts
type LayoutProjection = {
  layoutVersion: 1;
  layoutDigest: string;
  nodes: LayoutNodeProjection[];
  edges: LayoutEdgeProjection[];
  diagnostics: LayoutDiagnostic[];
};

type LayoutNodeProjection = {
  nodeId: string;
  rank: number;
  lane?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type LayoutEdgeProjection = {
  edgeId: string;
  channel: "primary" | "normal" | "join" | "error" | "loop" | "backEdge";
  backEdge: boolean;
  laneId: string;
  points: Array<{ x: number; y: number }>;
};
```

对话式运行投影不得重新定义这组布局枚举。其运行语义通道保留
`main | error | loop | join | feedback`，并通过显式 `presentationChannel` 适配到布局合同：

```text
main     -> primary
feedback -> normal
join     -> join
error    -> error
loop     -> loop
loop return edge -> backEdge (backEdge: true)
```

`channel` 用于对话层语义过滤，`presentationChannel` 和 `backEdge` 用于共享图谱样式与边呈现。
适配不得依据几何位置或显示文案推断，且 FEEDBACK 仍只是已有责任席位之间的 flow 事件。

## 5. 节点合同

GraphViewModel 使用判别联合，禁止构造出互相矛盾的节点类型：

```ts
type GraphNode =
  | {
      kind: "roleSeat";
      entityKind: "responsibility_seat";
      roleSeat: true;
      executionScope: "roleAggregate";
      roleId: string;
    }
  | {
      kind: "boundary";
      entityKind: "boundary";
      roleSeat: false;
      executionScope: "boundary";
      roleId: string;
    };
```

责任席位详情必须能表达：

- 角色职责；
- 模型、工具或 profile 绑定；
- 当前执行模式；
- 当前实例数；
- 完成次数；
- 当前 lineage 和 loop iteration；
- 等待审核数量；
- Join expected/ready/missing sources。

固定说明：同一责任席位可在一次运行中被多个 branch 多次激活。

## 6. 边语义分类

所有边在布局前分类，不允许由渲染器根据几何位置猜测：

```text
primary  主业务路径
normal   普通事件流
join     Join 汇聚或 Join 后续路径
error    ERROR、补偿和失败路径
loop     循环内部路径
backEdge 返回前序 rank 的循环边
```

业务语义图必须保留完整边集合。循环边只设置 `backEdge: true`，不得为了让布局器接受 DAG 而删除。

## 7. Dagre 布局流水线

### 7.1 预处理

1. 从 Semantic IR 构建完整 ResponsibilityGraph。
2. 对边进行 channel 分类。
3. 通过强连通分量识别循环边。
4. 计算入口、出口和主路径。
5. 按主路径优先级、Join source 声明顺序和 roleId 建立稳定排序键。

### 7.2 构造 Dagre 输入

Dagre 输入只包含布局所需字段：

```ts
type DagreLayoutNode = {
  id: string;
  width: number;
  height: number;
  layoutOptions?: Record<string, string>;
};

type DagreLayoutEdge = {
  id: string;
  sources: string[];
  targets: string[];
  layoutOptions?: Record<string, string>;
};
```

基础布局采用 layered 算法、从左到右方向和 network simplex 节点放置。所有 Dagre 选项集中在 `src/visualizer/studio-client/dagre-layout-adapter.ts`；列排序、边界锚点、通道和 X6 route metadata 由 OGS semantic layout projection 负责。

Dagre 接收确定性排序后的无环布局拓扑子集；完整业务边集合始终保留在 `LayoutProjection` 中。被 Dagre cycle breaking 或平行边合并影响的边会得到明确诊断和 route channel，不会改变运行语义。

### 7.3 布局锚点

input、output、外部系统边界和人工审核边界是锚点。它们应固定在最左、最右或指定区域，不参与普通业务节点的排序竞争。

### 7.4 禁止的后处理

以下做法禁止继续使用：

- 通过删除回边把业务图强行变成 DAG；
- 在 renderer 中使用像素阈值推断 rank；adapter 内部的 Dagre 坐标只用于确定性列分组后处理；
- 对布局结果进行无约束的二次纵向重排；
- 在渲染器内根据节点几何位置重新判断边方向；
- 运行 overlay 变化时重新计算静态布局。

## 8. Lane 和边路由

推荐通道：

```text
主流程：节点中心区域
Join 流：Join 节点下方的汇聚通道
错误流：主流程上方或外侧通道
循环流：图外侧返回通道
审核流：人工审核边界专用通道
```

同一 source-target 的多条边必须根据稳定 edgeId 分配平行 lane。Dagre adapter 和 semantic projection 生成 route points，X6 直接消费 LayoutProjection，不再在 renderer 内根据几何位置重算路径。

## 9. 语义显示

### 9.1 条件边

条件边标签由 Condition AST 安全格式化：

```text
CONTINUE  [primary p1 when:state.round < 3]
```

`state.round` 仅是展示条件 AST 的中性占位字段；实际字段必须来自具体项目声明的 State Schema，OGS 不内置 `round` 或其他领域字段。

禁止将原始 YAML 或任意代码字符串直接注入 DOM。长标签显示摘要，详情面板保留完整字段路径、操作符和优先级。

### 9.2 角色模式

多个模式显示在同一责任席位节点内，不生成重复角色节点：

```text
Reviewer
mode: normal / escalation
binding: model-x
```

反馈行为沿已有席位之间的 transition 表达，不生成 `a-feedback`、`b-feedback` 等节点。图谱应在
`A -> B` 的边上显示 `FEEDBACK` 事件及其 Payload/条件摘要；只有独立主体承担反馈职责时才显示独立席位。

### 9.3 Loop

Loop 通道显示：

- loopId；
- 当前 round；
- maxRounds 和剩余预算；
- boundaryRoleId；
- onExhausted；
- 返回边和 lane。

### 9.4 Join

Join 节点显示 expected、ready、missing sources、等待原因、timeoutSeconds 和 onTimeout。不同 lineage 或 loopIteration 的 Join scope 不得合并显示。

### 9.5 人工审核

人工审核是 runtime control plane 边界，不是普通角色执行节点。运行态画布可继续显示
`pending`、`paused`、`resolved`，以及 branch terminate 和 run terminate 的区别；对话式投影
使用独立的 `reviewStatus: pending | recorded | applied | expired` 表示审核记录生命周期，
并使用 `decision: approve | rework | pause | terminate` 表示运行时决策。`expired` 只表示
已持久化的外部过期决定，当前 runtime 不会自动计时产生该状态。不得将 `approved`、
`rejected` 或 `rework` 当作 reviewStatus；`rework` 仅是 decision 值。

## 10. 交互视图

建议提供以下视图模式：

- Overview：完整责任图；
- Focus：聚焦责任席位；
- Upstream：查看所有上游；
- Downstream：查看所有下游；
- Route Probe：查看两个席位之间的可达路径；
- Trace：按 branchId / lineageId 查看运行路径；
- Join View：查看 Join 来源和等待状态；
- Loop View：查看循环成员、回合和预算；
- Error View：只显示错误和补偿流；
- Compare：比较两个责任席位；
- Story：按运行事件顺序播放路径。

URL 状态至少保存：

```text
runId
selectedRoleId
selectedEdgeId
focusMode
lineageId
branchId
visibleChannels
layoutMode
```

刷新或分享 URL 后应恢复相同焦点、路径和过滤状态。

## 11. GraphViewModel v2

开发测试版本可直接升级为新的投影合同：

```ts
type GraphViewModel = {
  version: 2;
  graphDigest: string;
  layoutDigest: string;
  mode: "edit" | "run" | "focus" | "trace";
  nodes: GraphViewModelNode[];
  edges: GraphViewModelEdge[];
  viewport?: ViewportState;
  filters: GraphFilters;
  diagnostics: LayoutDiagnostic[];
};
```

结构、布局、运行和诊断字段应分组，不能让渲染 DTO 重新成为业务语义真相源。

## 12. 布局质量规则

每次布局完成后必须执行：

- 节点不得重叠；
- 标签不得覆盖节点或边；
- 主路径方向一致；
- Join source 顺序稳定；
- 循环边必须拥有返回 lane；
- 错误流不得穿过主流程节点；
- 多条边不得共享不可读路径；
- input/output 满足边界约束；
- 相同 Semantic IR 重复布局结果一致。

诊断错误码至少包括：

```text
NODE_OVERLAP
EDGE_CROSSING
LABEL_COLLISION
INVALID_BACK_EDGE
UNSTABLE_ORDER
LANE_CONFLICT
```

## 13. 性能和缓存

Dagre 布局保持在 adapter 边界内；如未来图规模需要异步化，worker 传输的仍是 LayoutInput/LayoutProjection 契约：

```text
main thread -> LayoutInput -> worker -> Dagre adapter -> LayoutProjection -> X6
```

布局缓存键：

```text
semanticIRDigest
layoutProfile
nodeSizeDigest
channelPolicyVersion
```

branch、review、active edge、选中节点和运行计数变化不得使静态布局失效。

## 14. 实施阶段

### 阶段 0：合同冻结

- 冻结 GraphViewModel v2；
- 冻结 edge channel 和 LayoutProjection；
- 建立 golden fixtures；
- 建立布局诊断错误码。

### 阶段 1：布局适配层

- 新增 `semantic-layout-projection.ts`；
- 新增 `dagre-layout-adapter.ts`；
- 将 Dagre 调用与 X6 解耦；
- 保留完整业务边集合并为 cycle/back/multi-terminal 产生投影诊断；
- 删除 renderer 内的几何路由推断。

### 阶段 2：通道和路由

- 实现主流程、Join、错误和循环 lane；
- 实现多边平行 lane；
- 实现 boundary anchor；
- 将 Dagre adapter route points 写入 LayoutProjection。

### 阶段 3：渲染重构

- X6 只消费 GraphViewModel 和 LayoutProjection；
- 渲染条件、优先级和 channel 标签；
- 渲染责任席位、模式、Loop 和 Join 状态；
- 保持运行 overlay 与静态布局分离。

### 阶段 4：图谱阅读能力

- Focus、Upstream、Downstream；
- Route Probe；
- lineage / branch trace；
- Join View、Loop View、Error View；
- stable URL state；
- story playback。

### 阶段 5：验证和发布

- 浏览器截图和多视口测试；
- fan-out、Join、cycle、error flow、multi-terminal fixtures；
- 确定性和布局质量测试；
- 复杂图性能基准；
- 开发测试版本整体发布，不做历史布局数据迁移。

## 15. 测试基线

必须覆盖：

1. 单一路径和多入口；
2. fan-out / fan-in；
3. all_of 和 quorum_of Join；
4. 单层和多层循环；
5. 同一 source-target 多条边；
6. 错误和补偿流；
7. 人工审核边界；
8. 多 terminal；
9. 节点尺寸变化；
10. 运行 overlay 更新不引起节点跳动；
11. 相同输入产生相同 layoutDigest；
12. 无障碍标签和标签溢出处理。

## 16. 验收标准

重构完成必须满足：

- 复杂流程无需人工拖拽即可形成可读主路径；
- 节点无重叠；
- 主流程、异常流、Join 流和循环流可区分；
- 循环使用独立返回通道；
- Join 来源和等待状态可读；
- 条件、优先级和模式可见；
- 同一图重复布局稳定；
- 运行 overlay 不导致节点跳动；
- 所有业务边均保留在语义图中；
- 不包含任何具体业务项目专用布局逻辑。

## 17. 风险和取舍

### 布局适配器体积

Dagre 不增加 ELK.js 的 bundle 成本。若未来需要更复杂的约束布局，应先以同一 LayoutProjection 契约做替换评估，不得让渲染器直接依赖新布局库。

### 自动布局不是业务判断

Dagre 不能自动理解主流程、业务优先级或审核边界。缺少 OGS 语义布局投影时，换库不会自动解决混乱。

### 复杂布局仍需人工约束

对于极端复杂图，应允许保存人工布局 hint，但人工 hint 只能作为布局输入约束，不能替代 Semantic IR，也不能破坏语义边界。

## 18. 最终决策

OGS 采用以下现代开源可视化架构：

```text
Semantic IR
  -> semantic layout projection
  -> Dagre adapter
  -> LayoutProjection diagnostics
  -> GraphViewModel
  -> X6 rendering and interaction
```

OGS 当前正式采用 Dagre 作为显式 semantic layout adapter。Dagre 只负责可重复的基础坐标，OGS 负责责任席位、主路径、Join、循环、错误流、审核边界、完整业务边集合和运行 overlay 的业务判断；renderer 只消费 LayoutProjection。
