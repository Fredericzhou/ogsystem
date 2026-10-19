# OGS 项目、团队与任务运行落地计划

状态：术语与文档基线已收口，工程落地待执行

## 目标

将产品中的三个核心边界固定为：

- **Team**：静态协作定义，包含角色、流转关系、循环/分支/汇合语义及其版本。
- **Project**：项目工作目录、资源、已挂载 Team 版本和多次运行结果的聚合范围。
- **Task Run / Run**：某个 Team 版本的一次完整动态运行，绑定运行工作目录并保存输入、状态、产物和审计证据。

当前产品界面的“任务”仍可作为 Task Run 的用户友好简称；API、代码和持久化规范使用 `Run`。当前不新增独立
的可调度 Task Definition，避免把可复用定义与一次执行混入同一个状态模型。

## 已完成的文档基线

1. 产品词汇表明确 Team、Project、Task Run 的职责边界和基数关系。
2. Core Concepts 增加 Team version、Project workspace、Run workspace 和 Run fingerprint 约束。
3. 编排语义规范明确静态 Team 图与动态 Run 内部事实的边界。
4. 产品简介和使用手册统一“任务运行”与 `Run` 的命名映射。

## 工程落地阶段

### Phase 1：领域对象与标识

定义并固定 `teamId/teamVersion`、`projectId`、`runId` 的所有权、生命周期和引用关系。Run 必须保存所选 Team
版本及其不可变指纹；Project 只保存 Team 挂载引用，不复制 Team 图。

验收：同一 Project 可挂载多个 Team 版本，同一 Team 版本可创建多次 Run；历史 Run 不随 Team 新版本发布而变化。

### Phase 2：工作目录与快照

明确项目工作目录、Run 工作目录 `.ogs/runs/<run-id>/` 和外部编程工作目录的边界。启动 Run 时固定输入资源、
项目配置、Team 版本和执行指纹；运行产物默认写入 Run 目录，项目级发布通过显式 promotion/copy 完成。

验收：修改项目共享资源或切换 `--workspace-dir` 后，既有 Run 仍可按原快照恢复；目录穿越、符号链接和外部未授权
依赖继续 fail closed。

### Phase 3：API、CLI 与站点模型

将 API/CLI 内部字段统一到 `Run`，对现有“任务”接口保留兼容别名和迁移说明。项目 API 返回挂载 Team、Run 列表、
Run 当前状态和工作目录来源；Team API 只返回静态版本，不混入 Run 状态。

验收：创建、开始、暂停、恢复、审核、停止、查询和删除隐藏记录等操作都明确作用于 Run；同一 Project 的并发策略
继续由 Project/Run 控制面负责。

### Phase 4：运行时与投影

在运行计划、恢复快照、摘要、审计和 Visualizer 投影中显式区分 `teamVersion`、`projectId`、`runId`、
`projectWorkspace` 和 `runWorkspace`。Branch、Lineage、RoleExecutionRecord 只作为 Run 的子事实展示。

验收：从任意 Run 详情可以反查 Project 和 Team 版本；从 Team 页面不能误显示某个 Run 的动态状态。

### Phase 5：测试与迁移

补充领域关系、版本冻结、目录隔离、重复运行、恢复和兼容别名测试；对旧任务记录提供只读迁移或明确的字段解释，
不通过猜测方式重写历史运行。

验收：运行现有单元、集成、示例和恢复测试，并增加至少一条“同一 Team 多次 Run”和一条“Team 发布后历史 Run
不变”的回归测试。

## 暂不纳入

- 可重复调度的 Task Definition、模板参数和批量实例化；
- 多 Run 并发写入同一外部编程目录的自动协调；
- 运行结果自动提升为项目资源；
- 将 Project 目录、Run 目录和外部编程目录合并为一个物理目录。

这些能力需要独立的数据模型、并发策略或权限设计，不能通过术语替换直接获得。
