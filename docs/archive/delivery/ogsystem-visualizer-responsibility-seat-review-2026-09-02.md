# OGSystem 可视化与责任席位语义评审

> Historical review. Its conclusions are incorporated into the active [OGS visualizer refactor plan](../../ogs-visualizer-refactor-plan.md) and the orchestration semantics manual; this file is not a standalone implementation contract.
>
> Superseded by: the active semantics and visualizer documents for current implementation guidance.

更新时间：2026-09-02
状态：评审结论
参照项目：[Archify](https://github.com/tt-a1i/archify)

## 1. 总体结论

OGSystem 的运行时语义基础已经较成熟。当前核心节点代表的是业务流程中的角色席位或责任单元，而不是一次具体运行中的执行实例；但这一点还没有被完整固化为类型系统不变量、投影合同和清晰的 UI 文案。

可视化当前的主要问题也不是缺少基础能力。项目已经具备 X6 画布、Dagre 布局、运行聚合、端点路由、minimap、quick open、选择编辑和部分 URL 状态恢复。主要问题在于：

- 责任席位、静态计划节点、运行分支和执行记录之间的概念没有在可视化合同中充分显式化；
- 自动布局使用了“布局子图 + Dagre + 自定义二次排布”的组合，复杂图中容易丢失环路、join 和异常路径的语义；
- 现有路由主要按空间几何处理，业务流、异常流、join 流和循环流没有形成布局级通道；
- 图谱已有编辑交互，但缺少面向理解和审阅的 focus、reach、route probe、比较和故事回放能力；
- URL 已能恢复运行、审核和日志等状态，但尚未稳定恢复图谱焦点、路径、过滤条件和视口。

建议的核心方向是：

```text
责任席位语义不变量
        -> 责任图谱 IR
        -> 运行态 overlay
        -> 语义布局与路由通道
        -> 可恢复的图谱阅读交互
```

## 2. 节点语义边界

### 2.1 当前运行时定义

需要区分以下概念：

| 概念 | 含义 |
| --- | --- |
| `roleId` | 角色定义的标识，不是角色定义本身 |
| `ExecutionPlanNode` | 角色在已编译执行计划中的静态计划节点 |
| `branchId` | 一次具体运行分支的实例标识 |
| `RoleExecutionRecord` | 一次角色执行记录，`branchId` 可以为空，不应与分支实例假定一一对应 |
| `GraphViewModelNode` | 面向可视化的最终节点 DTO，目前承载结构、布局、运行态、诊断和编辑能力 |

运行时类型依据：[types.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/runtime/types.ts:147)、[types.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/runtime/types.ts:424)、[types.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/runtime/types.ts:495)。

### 2.2 核心结论

图上的业务节点不是运行实例，而是流程中可被多次激活的责任席位。一个责任席位可能在同一次运行中：

- 被多个 `branchId` 激活；
- 因循环执行多次；
- 同时拥有多个活动或已完成分支；
- 等待多个 join source；
- 产生多条执行记录和审核记录。

因此，“节点不是运行实例”是正确的核心判断。但不能表述为“运行聚合不存在”：`GraphViewModelNodeRuntime` 已经包含 `activeBranchCount`、`completedBranchCount`、审核等待数以及 join 来源信息。[studio-contracts.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/studio-contracts.ts:127)

当前缺少的是：

- 节点为什么按角色聚合的稳定语义合同；
- UI 对“责任席位”和“运行实例”的明确区分；
- 运行指标的聚合口径说明。

### 2.3 类型合同建议

建议将当前 `kind: "role"` 升级为更明确的判别概念，并把执行范围设为必需字段：

```ts
type GraphViewModelNode = {
  kind: "roleSeat" | "boundary";
  executionScope: "roleAggregate" | "boundary";
  roleId: string;
  // structure / layout / runtime / diagnostic / editable ...
};
```

这里不建议只追加可选的 `semanticKind`。责任席位是节点类型的不变量，应当由类型系统保证。`roleSeat` 表达“业务责任席位”，`roleAggregate` 表达“运行态按角色聚合”，两者分别解决结构语义和运行聚合语义。

UI 中建议使用类似以下文案：

- `责任席位`：节点的主类型；
- `当前实例数`：当前活动分支或执行实例的聚合值；
- `完成次数`：该角色在当前运行中的累计完成值；
- `该席位可在一次运行中被多次激活`：详情面板中的固定语义说明。

## 3. 项目结构与投影边界

当前主路径已经形成较合理的分层：

```text
SystemDefinition
    -> StudioAuthoringDocument
        -> GraphViewModel
            -> X6 cells
```

保留 `GraphViewModel` 作为最终渲染 DTO 是合理的，不需要为了分层而制造三个竞争性真相源。建议拆分的是输入和子层：

```text
ResponsibilityGraph
  - role seats
  - transitions
  - boundaries
  - semantic metadata

ExecutionOverlay
  - active branch count
  - completed count
  - review waiting state
  - join readiness
  - selected route

LayoutProjection
  - position and size
  - rank and lane
  - route points
  - viewport

ResponsibilityGraph + ExecutionOverlay + LayoutProjection
    -> GraphViewModel
```

这样既能继续提供一个方便渲染的 DTO，也能避免布局、结构和运行状态在上游投影过程中互相污染。当前 `graph-view-model.ts` 已经在概念上进行了一部分分层，可继续沿此方向演进。[graph-view-model.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/graph-view-model.ts:210)

## 4. 自动布局问题

### 4.1 当前实现边界

当前不是简单地“没有布局算法”，而是使用了 Dagre，并在其前后加入了自定义处理：

1. 构造用于布局的子图；
2. 通过路径检测，排除会形成环的边，使其不传给 Dagre；
3. 执行 Dagre；
4. 根据 `dagreX` 和 `24px` 阈值重新推断列；
5. 按邻接节点中心点进行二次纵向排布；
6. 最后单独移动 input/output 边界节点。

实现依据：[studio-graph.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/studio-client/studio-graph.ts:1542)、[studio-graph.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/studio-client/studio-graph.ts:1589)、[studio-graph.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/studio-client/studio-graph.ts:1725)。

准确地说，完整边仍保留在画布和邻接关系中；问题是环路边被排除在传给 Dagre 的布局子图之外，导致布局失去环路语义。

### 4.2 主要风险

- Dagre 实际布局的拓扑不是完整业务拓扑；
- 环、join、多入口和异常回退路径容易产生不稳定层级；
- `dagreX ± 24` 不是可靠的 rank 判断方式；
- 二次排布可能重新制造边交叉和长距离连线；
- 错误流、循环流和 backward edge 只能依赖渲染路由器补救；
- 多条相同 source-target 边缺少独立的业务通道。

### 4.3 现有路由能力的准确评价

“没有路由分类”并不准确。当前已经根据空间几何区分：

- `self`
- `backward`
- `vertical`
- `forward`

并且对同侧端点提供稳定偏移。[studio-graph-render.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/studio-client/studio-graph-render.ts:154)

真正缺少的是业务语义级 route channel：

```text
主业务流
异常/补偿流
join 汇合流
循环返回流
```

目前 `runtimeOnlyErrorFlow` 和 `participatesInJoin` 主要影响边样式，没有充分参与布局、排序和通道选择。

### 4.4 建议方案

建议先保留现有 X6，重写布局适配层：

- 保留完整语义图；
- 在布局阶段显式标记 `backEdge`，而不是通过删除边隐式处理；
- 使用 Dagre 或 ELK 生成 rank 和初始顺序；
- 不再用 `dagreX` 阈值重建 rank；
- 为主流、异常流、join 流、循环流分配独立 route channel；
- 对相同 source-target 的多条事件边使用稳定 lane；
- 将 input/output 作为布局约束参与整体布局，而不是最后再校正；
- 运行态更新只改变 overlay，不触发完整重排。

如果可以接受新增依赖，ELK.js 更适合复杂有向流程。若控制体积优先，则可以继续使用 Dagre，但必须把布局适配层和业务语义约束重新设计。

建议增加以下布局质量规则：

- 节点不得重叠；
- 标签不得覆盖边；
- 主流程方向一致；
- join source 顺序稳定；
- 异常流不穿越主流程节点；
- 循环边拥有明确返回通道；
- 多条边不能长期共用不可读的同一路径。

## 5. 图谱交互能力

### 5.1 已有能力

当前已经具备：

- 单击选中；
- 双击编辑；
- 右键菜单；
- 缩放、平移、适配视图；
- minimap；
- quick open；
- 三种布局模式；
- 运行态节点和边 overlay；
- 运行、审核、日志等部分 URL 状态恢复。

因此，当前问题不是基础画布交互缺失，而是图谱阅读能力不足。

### 5.2 主要缺口

建议补充：

- 以上游/下游为中心的责任席位聚焦；
- 某两个责任席位之间的 route probe；
- 主流程、异常流、循环流和 join 流过滤；
- branch/lineage 运行过滤；
- join 等待来源和缺失来源的可视化；
- 两个责任席位的职责、绑定、输入输出和运行数据对比；
- 一次运行或一条业务路径的有限故事回放；
- 可恢复图谱焦点、路径、过滤条件和视口的 stable URL。

当前 URL 状态主要覆盖运行、审核和日志筛选，图谱状态尚未完整纳入。[client-route-state.ts](/Users/maple/Documents/WorkSpace/AI/OGSystem/src/visualizer/client-route-state.ts:1)

建议形成三个互补视图，而不是继续堆叠单一画布上的状态：

```text
责任图谱：责任席位、职责、业务边界和业务路径
运行追踪：branch/lineage 在责任席位上的执行聚合
上下文图：输入投影、join source 和结果流转
```

三者共享同一责任图谱和语义 IR，只切换 projection 与交互状态。

## 6. Archify 的启示

Archify 最值得借鉴的不是具体视觉风格，而是它把图谱当作可验证、可阅读、可分享的语义产物。

### 6.1 Typed IR

Archify 使用 typed JSON IR，并在渲染前进行验证。OGSystem 可以将当前 `GraphViewModel` 演进为严格的内部图谱 IR，明确区分：

```text
roleSeat
transition
boundary
executionOverlay
layoutHint
```

### 6.2 布局判断高于通用自动布局

Archify 强调布局判断，而不是完全依赖通用自动布局。OGSystem 应让业务语义参与布局：

- 入口方向；
- 主流程；
- join 层；
- 异常和补偿路径；
- 循环返回；
- 人工审核门；
- 外部系统边界。

### 6.3 语义交互

Archify 提供 focus、upstream/downstream reach、route probe、role comparison、guided story 和 stable URL。对 OGSystem 来说，这些能力可以直接转化为：

- 聚焦责任席位及其上下游；
- 查看一条明确的业务路由；
- 比较两个责任席位；
- 播放一次运行的有限章节；
- 在链接中恢复阅读上下文。

所有交互都应基于已有的 role 和 flow 推导，不为了视觉效果虚构拓扑，也不把静态可达性误称为运行时影响。

### 6.4 布局和交付验证

Archify 将布局质量、标签清晰度、路由可读性和产物验证纳入交付门禁。OGSystem 可以将布局诊断纳入现有 validation，而不是把布局视为渲染器内部的不可见副作用。

## 7. 分阶段建议

### 第一阶段：固化语义和布局基础

- 将节点类型从 `role` 升级为 `roleSeat`；
- 增加必需的 `executionScope: "roleAggregate"`；
- 在 inspector 中明确责任席位与运行实例的关系；
- 重写 Dagre 适配层，显式处理 back edge；
- 引入主流、异常、join、循环 route channel；
- 增加节点重叠、边交叉和标签清晰度诊断；
- 增加 fan-out、join、cycle、error flow、multi-terminal 布局测试。

### 第二阶段：增强图谱阅读

- 上游/下游聚焦；
- 路径探测；
- join 等待可视化；
- 主流/异常流/循环流过滤；
- branch/lineage 运行过滤；
- stable URL 恢复焦点、路径、过滤条件和视口。

### 第三阶段：审阅和传播

- 责任席位比较；
- 运行故事回放；
- 责任图、运行图、上下文图三种语义视图；
- 带当前焦点、路径和过滤上下文的导出图；
- 布局和投影验证收据。

## 8. 最终判断

OGSystem 的运行内核已经明确区分角色、计划节点、分支实例和执行记录，可视化也已经具备运行聚合和基础交互能力。需要修正的不是运行语义本身，而是将现有语义显式提升为责任席位类型合同，并让布局和交互真正消费这些业务语义。

Archify 提供的最佳参考路径是：

```text
typed responsibility IR
    -> validated semantic layout
    -> execution overlay
    -> truthful graph reading interactions
    -> stable, shareable review state
```

这比单纯更换画图库或继续增加画布按钮更适合 OGSystem 的下一阶段演进。
