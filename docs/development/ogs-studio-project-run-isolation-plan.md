# OGS Studio 与 Projects 双支柱及运行数据隔离方案

## 1. 目标与范围

本方案规范 OGS Studio、OGS Projects 与共享 Runtime/Platform 的领域边界、运行数据归属、页面职责、接口契约和验收顺序。Studio 与 Projects 是同一产品 Shell 中对等的一级工作台，各自面向不同工作流程；它们可以复用执行引擎、Harness Adapter、脱敏、审计事件格式和只读诊断组件，但不得混用运行记录、生命周期或查询入口。

目标是：

- Studio 负责团队工程资产的设计、验证、仿真、诊断与发布，产出不可变 TeamVersion。
- Projects 负责业务协作项目、Materials、Task、Project Run、Human Review 和 Deliverable。
- 项目任务运行读取指定的不可变 TeamVersion 与项目材料快照，运行状态和证据由 Collaboration Project 所有。
- Studio Simulation 持久化保存并可回放，但不进入项目 Task、Project Run、项目容量、Deliverable 或业务历史。
- 共用运行能力时保持领域归属、存储命名空间、授权检查和 API 查询相互独立。
- 本方案针对未发布产品的当前版本，不做旧数据迁移，也不保留旧 API/路由兼容层。

本文件同时维护设计契约和实施状态。实现状态、实际验证和未覆盖项记录在第 14 节；任何“未执行”或“部分实现”均不视为验收通过。

## 2. 领域边界

```text
Platform
  共享模型目录与探测、Harness Adapter、工具执行配置、脱敏策略、审计事件格式
          │                         │
          ▼                         ▼
Studio（团队工程台）            Projects（业务协作台）
Team / Draft / TeamVersion      Collaboration Project / Materials
Studio Simulation               Task / Project Run / Human Review
设计、仿真、诊断、发布          Deliverable / 业务审计
```

| 领域 | 拥有的数据 | 主要职责 | 明确不拥有 |
| --- | --- | --- | --- |
| Platform | 模型目录、可用性探测结果、Harness 配置、工具配置、共享脱敏与审计格式 | 给 Studio 和 Projects 提供共享基础能力 | Team、Project、Task、Run 或 Deliverable 业务记录 |
| Studio | Team、Draft、不可变 TeamVersion、Studio Simulation | 团队拓扑和角色工程、仿真调试、运行诊断、发布门禁 | 项目材料、业务 Task、项目执行槽位、Deliverable |
| Projects | Collaboration Project、Materials、Task、Project Run、Human Review、Deliverable | 业务协作、任务运行、审核与交付 | 直接修改已发布 TeamVersion 的图谱、提示词或角色资产 |
| Runtime | 一次执行的通用调度、状态机、checkpoint、审计事件和 Harness 调用 | 执行调用方提供的不可变输入并写入调用方指定的证据命名空间 | 决定运行属于哪个业务领域或将不同领域的数据合并 |

### 2.1 运行类型语义

`runKind` 表示领域归属和生命周期；`mode` 仅表示运行机制。二者不可互相推导：

| runKind | mode 示例 | 所有者 | 可进入业务交付 |
| --- | --- | --- | --- |
| `project_task` | `dry-run`、`sandbox` | `projectId + taskId + runId` | 仅成功的 Project Run 可以归档为 Deliverable |
| `studio_simulation` | `dry-run`、仿真执行模式 | `teamVersionId + simulationId` | 永不进入 Deliverable |

Projects 的 dry-run 仍是 Project Task 的一次正式尝试，保留 Task/Run 业务记录并占用项目执行槽。Studio Simulation 即使使用相同 runtime dry-run 引擎，也保持 Studio 所有权，不占项目槽位。

## 3. 核心不变量

1. TeamVersion 发布后不可变。Project Run 仅读取其指定版本；不得在 TeamVersion 目录写入 Run 状态、事件、checkpoint、控制信号或输出。
2. Task 创建时固定 `teamVersionId`。该 Task 的所有重试沿用该版本；希望使用新版本时创建新 Task。
3. 每次 Project Run Attempt 都有独立的 `runId` 目录，含 TeamVersion 资产摘要/快照、项目 Materials 快照、Runtime 状态与审计证据。
4. Project Run 查询必须从 Collaboration Project 的 Task 记录确认 `projectId + taskId + runId` 归属，再读取项目 Run 命名空间。不得根据 teamVersionId 跨域查找 Project Run。
5. Studio Simulation 必须持久化并仅通过 Studio Simulation API 查询。不得被项目任务列表、Recent Project Runs、容量统计、恢复任务扫描或 Deliverable 查询发现。
6. 运行时可以共用状态机、审计事件结构和只读诊断 UI，但两类运行必须使用不同的 owner DTO、仓储端口、目录和 API 路径。
7. Materials 在 Run 启动时固定快照。重试默认使用源 Attempt 的材料快照，不能静默读取用户后来替换的文件；显式无状态失败、尚无快照时的恢复策略必须在启动前确定并写入 Run 元数据。
8. 所有业务动作按服务端状态与归属校验执行；客户端路由、`runKind` 字段或 URL 参数不是授权依据。
9. 文件仓储的路径解析同时执行 ID 校验、词法 containment 和 symlink/junction 检查。拒绝在路径检查之前访问锁文件或证据文件。

## 4. 页面与导航

### 4.1 一级工作台

- `/projects`：业务协作项目列表和项目创建。
- `/projects/:projectId`：项目概览、Materials、挂载团队版本、Task、审核、Project Runs 和 Deliverables。
- `/studio`：团队工程资产概览，展示 Team、发布版本、Draft 与最近仿真摘要。
- `/studio/teams/:teamId/design`：专业团队设计 IDE，提供图谱画布、资产导航、角色/Flow 配置和属性检查器。
- `/studio/teams/:teamVersionId/run`：Simulation 历史列表。
- `/studio/teams/:teamVersionId/run/:simulationId`（或带 TeamVersion 的等价规范路由）：只读仿真诊断与回放。
- `/studio/teams/:teamId/release`：静态检查、版本差异和 TeamVersion 发布门禁。
- `/platform`：模型目录、Harness 与工具执行配置；此页面仅在仓库已有 Platform 能力覆盖的范围内暴露。

Studio 与 Projects 使用同一 SPA Shell、Origin、导航和视觉系统，但不是把 Studio 专业页嵌入项目页面。侧栏将“业务协作”“团队工程”“平台资源”作为清晰导航分组。Projects 的团队卡片只显示已挂载版本摘要，并提供跳转 Studio 的入口，不提供就地修改已发布资产的控件。

### 4.2 Studio 设计页职责

设计页应恢复并承载当前系统真实支持的编辑能力：系统定义和全局法则、角色绑定与执行配置、角色包资产、Flow/事件、交接契约、并行/Join/Loop/Review 策略、Context Map，以及图谱布局与验证。控件必须绑定到真实领域字段和服务端验证；未实现的能力不得显示成可用配置，也不得用静态占位控件制造已支持的错觉。

画布使用可用宽度，不嵌入窄小对话框。角色或连线选择后，右侧检查器显示对应属性；在 1440、1024、768 和移动视口检查图谱不被裁切、检查器可访问、导航不会遮挡主操作。若移动端无法同时呈现三栏，使用明确的面板切换/抽屉，不强行缩放画布至不可读。

### 4.3 Studio 与 Project 运行诊断

诊断视图共享只读渲染组件，例如状态摘要、Timeline、事件流过滤、节点输出、错误详情和脱敏后的输入/输出。两种运行由不同页面上下文进入，并展示领域元数据：

- Project Run：项目名、Task 编号、Attempt 序号、TeamVersion、Project Materials 快照摘要。
- Studio Simulation：Team、TeamVersion、Simulation 输入、不可变版本摘要。

共享组件不提供跨域全局 Run 列表，也不通过 `runKind` 参数将一个领域的 API 转成另一个领域的查询。

## 5. 持久化布局与仓储端口

设 `projectsRoot` 为配置的数据根目录。路径结构如下：

```text
<projectsRoot>/
├── <collaborationProjectId>/
│   ├── .site/
│   │   ├── project.json                 # Project、Task 与 TeamVersion 挂载关系
│   │   └── deliverables.json            # Deliverable 元数据索引
│   ├── workspace/
│   │   ├── materials/                   # 当前业务材料
│   │   └── deliverables/<deliverableId>/# 独立只读交付快照
│   └── .ogs/runs/<runId>/               # Project Run Attempt 证据
│       ├── run-owner.json               # owner、runKind、attempt、TeamVersion 摘要
│       ├── project-assets/              # 本次使用的不可变团队资产快照及 manifest
│       ├── materials_snapshot/          # 本次业务材料快照及 digest
│       ├── control/                     # state、run-control、review
│       ├── checkpoints/
│       └── events.jsonl
├── <teamVersionId>/                     # 只读 TeamVersion 制品
│   ├── system.mmd / system.design.json
│   ├── roles/ 或 og-roles/
│   └── profiles.json / tools.json / .ogs/
└── .studio/simulations/<teamVersionId>/<simulationId>/
    ├── simulation.json                 # owner、输入、digest、状态与时间
    ├── state.json
    ├── checkpoints/
    └── events.jsonl
```

Simulation 放在共享数据根的 `.studio/simulations`，不放在 TeamVersion 目录内。TeamVersion 的制品目录因此可以保持只读；仿真历史仍可按 TeamVersion 过滤和管理。Simulation 清理策略独立于项目数据清理策略。

Project Run 的 `project-assets/` 和 `materials_snapshot/` 均为运行时消费的自包含快照，不采用硬链接、源目录引用或运行时回写 TeamVersion。团队文件以 manifest/digest 校验；材料文件按安全路径复制并记录内容摘要、类型和选择范围。最终输出进入 Run 证据目录，Deliverable 再创建独立快照。

定义领域端口而非让应用层依赖文件路径：

```text
ProjectRunEvidenceStore
  reserveAttempt(projectId, taskId, teamVersionId, runId, attemptNumber, snapshots)
  getRunEvidence(projectId, taskId, runId)
  listTaskRuns(projectId, taskId)
  readRunState(projectId, taskId, runId)
  write/control/recover operations scoped to the same owner

StudioSimulationStore
  createSimulation(teamVersionId, input, options)
  getSimulationEvidence(teamVersionId, simulationId)
  listVersionSimulations(teamVersionId)
  update status/checkpoint and apply Studio-only retention

SharedAuditReader
  readAuditEvents(evidenceDirectory, filters)
```

文件实现是当前默认适配器。端口为未来 SQLite/PostgreSQL 或其他 Harness 底座留出清晰替换点；本阶段不实现数据库迁移框架、分布式队列、通用插件市场或跨域统一仓储。

## 6. Runtime 与 Task 执行契约

Runtime 调用必须显式区分：

- `assetSource`: TeamVersion 的不可变工程资产，用于解析 system、角色、profiles、tools、laws、contracts 和模型绑定。
- `workdir`: Project 的业务工作区，用于项目级目标目录和运行输入语义；不得作为团队资产根的隐式替代。
- `runEvidenceRoot` 或等价的显式 Run store reservation: 由 ProjectRunEvidenceStore 分配到 `<projectId>/.ogs/runs/<runId>`。
- `materialInputs` 与 `materialSourceRoot`: 来自 Project 当前 Materials 或指定 Attempt 的快照。
- `owner`: `runKind=project_task`、projectId、taskId、taskNumber、runId、attemptNumber、teamVersionId、teamCoreDigest。

运行开始按以下顺序完成：

1. 校验 Task 状态、固定 TeamVersion 可用性与 Sandbox 静态 Readiness；Readiness 不声称外网、凭据或真实模型服务可达。
2. 在 Project 写锁内确认单槽容量，保留 Attempt 和 `runId`，记录 Task/TeamVersion 归属。
3. 在 Project Run 目录内准备临时快照；校验输入路径、拒绝符号链接；生成 digest/manifest 后原子发布快照。
4. Runtime 从 TeamVersion 读取只读配置，从 Project Run 的快照工作目录执行，并将状态、事件、checkpoint、控制和结果写入该 Project Run 目录。
5. 按 Attempt 状态原子更新 Task；锁冲突由服务端裁定，客户端收到容量冲突后刷新 Project 状态。

需审查 Runtime 的 `run-store` 初始化和 `prepareRuntimeSetup`：证据根不能只在 Team Site 文件存储层更改，因为 Runtime 当前会按 `workdir + runsDir` 创建状态；资产加载、项目目标目录、材料源根、恢复路径和 evidence root 必须成为明确且彼此独立的输入。恢复 Run 使用保存的快照，不能重新解析到另一 TeamVersion。

运行控制、人工审核、恢复扫描、Attempt 历史、结果查询、Recent Project Runs 和 Deliverable 归档都以 Project owner 定位。不得保留以 `task.runProjectId` 指向 TeamVersion workspace 的执行语义；新的 Task 记录保留 `teamVersionId` 作为工程资产身份，不把它作为 Run 证据存储键。

## 7. Simulation 生命周期

Studio Simulation 由 Studio 用例生成 `simulationId`，以 TeamVersion ID 与 digest 固定输入资产版本，并写入 Studio 专属存储。持久化字段至少包括：

- `simulationId`、`runKind=studio_simulation`、`teamId`、`teamVersionId`、`teamCoreDigest`；
- 脱敏后的测试输入、mode、创建时间、开始/结束时间与状态；
- 状态快照、事件流、失败原因摘要、输出摘要和必要的 checkpoint。

创建、执行和回放均使用 Studio Simulation API。服务重启后，未终结 Simulation 按显式恢复策略恢复或标记为中断失败，不能被项目 Run Recovery 扫描器误识别。Simulation 不读取 Project Materials；如需测试材料，测试输入必须由操作者提供并作为 Simulation 输入快照保存。

## 8. API 与 DTO

### 8.1 Project Run

- `GET /api/v1/projects/:projectId/tasks/:taskId/runs`：列出该 Task Attempts。
- `GET /api/v1/projects/:projectId/tasks/:taskId/runs/:runId`：读取状态、计划和 owner 校验后的元数据。
- `GET /api/v1/projects/:projectId/tasks/:taskId/runs/:runId/events`：读取该 Run 脱敏审计事件。
- 现有 Task 控制、Review、Run Result 与 Deliverable 路由必须经过同一 Project/Task/Run 归属验证。

查找 `runId` 时，先从 project 元数据确认 `taskId` 存在且其 `runIds` 包含 `runId`，再校验证据中的 owner 字段与请求三元组一致；不匹配和不存在均返回不泄露跨域信息的 Not Found。

### 8.2 Studio Simulation

- `POST /api/v1/teams/:teamId/versions/:teamVersionId/simulations`：创建并启动仿真。
- `GET /api/v1/teams/:teamId/versions/:teamVersionId/simulations`：列出该版本 Simulation。
- `GET /api/v1/teams/:teamId/versions/:teamVersionId/simulations/:simulationId`：读取 Simulation 元数据和状态。
- `GET /api/v1/teams/:teamId/versions/:teamVersionId/simulations/:simulationId/events`：仿真事件回放。

Simulation API 只能定位 `.studio/simulations/<teamVersionId>/<simulationId>`；Project API 不查询这个命名空间，Studio API 也不查询 Project Run 目录。

### 8.3 Run Evidence DTO

统一的只读 UI 输入使用带区分字段的 DTO：

```ts
type RunEvidenceDto = {
  runId: string;
  runKind: "project_task" | "studio_simulation";
  mode: "sandbox" | "dry-run";
  owner:
    | {
        kind: "project_task";
        projectId: string;
        taskId: string;
        taskNumber: number;
        attemptNumber: number;
        teamVersionId: string;
        teamCoreDigest: string;
      }
    | {
        kind: "studio_simulation";
        teamId: string;
        teamVersionId: string;
        simulationId: string;
        teamCoreDigest: string;
      };
  status: RunStatus;
  timing: { startedAt?: string; completedAt?: string; durationMs?: number };
  events: AuditEvent[];
  outputSummary?: string;
};
```

API 路由负责构造正确的 discriminated owner。客户端不能把任意 owner 内容提交回来授权读取。

### 8.4 删除旧混合查询

完成新入口及调用方迁移后，删除混合 Studio/Project 的“最近运行”全局查询以及读取 TeamVersion 路径的旧 Project Run 兼容逻辑。全局搜索并清理旧路径、`runProjectId` 的 TeamVersion 语义和旧路由别名；不新增 AST/CI 静态分析工具。保留确有用途的项目内 Recent Runs 时，它只枚举 `runKind=project_task`。

## 9. 安全、并发与恢复

- 所有 path segment 先做严格 ID allowlist 校验，再做 `resolve` containment，再用 `lstat`/等价机制拒绝项目根、`.site`、`.ogs`、`runs`、Run 目录、状态文件和 Simulation 路径中的 symlink/junction。
- 对需要创建写锁的 Project 路径，必须先验证 Project 目录和 `.site` 目录，再打开锁文件；避免检查之前跟随 symlink 写到项目外。
- 读取 Run Result、Run Plan、Events、Review 和 Simulation 也要执行路径组件校验，不能只保护 Deliverable 存储。
- 目录快照采用同父目录临时目录写入，完成后校验 manifest 并 `rename` 原子发布。失败时清理临时目录；最终目录不得暴露半成品。
- Project 执行槽权威仍由 Project 写锁和服务端 Task 状态控制。容量投影为 `{capacity, used, available, activeTasks}`，当前 `capacity=1`；active 状态使用领域枚举。
- 服务重启恢复只遍历 Project 目录中的 `project_task` Run，使用 owner/Task 元数据确认孤儿。Studio Simulation 使用独立恢复和保留策略。
- Review 的 branch termination 只终止对应分支，不把局部分支决策升级为整次 Run cancel；Run 状态及审核策略由 Runtime 负责，Task 用例不得自行推断或扩大作用域。
- Project Run 读取永远通过 `projectId + taskId + runId` 确认关系；相同字符串 runId 出现在不同命名空间时不得造成数据串读。

本地文件系统模型默认假设数据根由服务账号拥有。若需抵抗同机恶意进程在检查后替换路径组件，应再设计目录句柄/no-follow 访问，并单独验证 TOCTOU 威胁；该能力不能由当前静态 symlink 测试宣称保证。

## 10. 分阶段实施与退出条件

### 阶段 A：契约与领域隔离

- 定义 Run owner、`runKind`、Attempt 元数据与两套证据存储端口。
- 新建 Project Run 目录预留和 Simulation 文件存储，给文件路径和序列化 DTO 加单元测试。
- 调整 Task execution contract，使 `assetSource`、Project `workdir`、Materials source 和 evidence root 显式分离。
- 去除 TeamVersion ID 作为业务运行证据路径的语义。

退出条件：Project Run 创建不修改 TeamVersion 文件；Simulation 只落 `.studio/simulations`；相同 Run ID 跨域不会互相读取。

### 阶段 B：运行闭环迁移

- 迁移任务执行、单槽并发、控制/暂停/继续/取消、Review、重试、恢复、结果/事件查询、项目详情 Attempt 投影和业务历史到 Project Run Store。
- 重试沿用 Task 固定版本及来源 Attempt 材料快照；验证缓存、幂等和崩溃恢复。
- 按 Request owner 验证 Project/Task/Run 三元组；阻止跨 Project、跨 Task 和跨运行类型读取。
- 补齐 Readiness：TeamVersion 静态检查为基础，Project readiness 再验证 Project 可用性与已挂载版本；Sandbox 启动仍由服务端重查。

退出条件：暂停/审核/继续/失败/重试/删除/重启恢复全程仅访问 Project Run 路径；容量刷新一致；无 TeamVersion 目录写入。

### 阶段 C：Studio Simulation 闭环与页面恢复

- Simulation 持久化输入、状态、事件、输出摘要与 TeamVersion digest；实现列表、回放、服务重启恢复策略和独立清理策略。
- Studio 恢复成同一 Shell 中的对等一级工作台：团队概览、完整设计 IDE、Simulation 历史/诊断、发布门禁。
- 复用图引擎和真实属性检查器，按 Studio 路由按需加载；离开设计页释放画布、快捷键、DOM 容器与监听器。
- 保持 Project 页面聚焦业务工作，只读展示挂载版本，不将 Studio 配置塞进窄项目面板。
- 提供共享只读诊断组件，分别从严格隔离的 Project/Studio API 装载 DTO。

退出条件：Studio 编辑能力字段与服务端数据一致；刷新/重启后仿真可回放；Projects 的 Run、任务、容量、历史和 Deliverable 无 Simulation。

### 阶段 D：文档、清理与发布验收

- 更新产品概念、使用手册、开发架构、API 和运行/数据目录文档；明确 Run、Attempt、Simulation、dry-run、sandbox 和 Deliverable 的差别。
- 全局搜索清除旧路径与旧混合 API 语义，不做双读、迁移或兼容别名。
- 执行自动化测试、浏览器 UAT、服务重启验证；逐项记录通过/失败/未执行，不将未执行场景写成验收通过。

退出条件：验收矩阵全部关键项通过，未关闭缺陷有明确阻断发布结论；文档与当前页面/API/文件布局一致。

## 11. 自动化验证矩阵

### 11.1 单元与边界测试

- Task attempt reservation 的 owner、Attempt 序号、幂等、容量冲突与失败清理。
- Runtime setup 从 TeamVersion 加载资产，但从 Project Run evidence root 落状态/事件/checkpoint。
- Project Materials 快照及 TeamVersion 资产快照 digest；快照写入中断后不可见半成品。
- retry 复用源 Run 的 Materials 快照，并使用原 Task `teamVersionId`。
- Project Run owner 三元组不匹配时返回 Not Found；同 ID 的 Simulation 不可由 Project API 读取。
- Simulation 的 Project API 反向不可见；不进入 Project 列表、槽位、Recovery、Recent Runs 或 Deliverables。
- Branch-scoped termination 不升级为整次 Run cancellation。
- 对 Project、`.site`、`.ogs`、`runs`、Run 文件、Simulation 路径的 symlink/junction 正负例；路径拒绝发生在锁文件读取/删除之前。
- 审计事件读取脱敏、分页/过滤边界、损坏行恢复和 owner 元数据校验。
- Deliverable 同一 `runId` 幂等，不同成功 Attempt 独立归档；原子快照、索引 digest、链接拒绝及失败恢复。

### 11.2 集成与 API 测试

以隔离临时数据根创建 Team、发布 TeamVersion、创建 Collaboration Project、挂载版本、添加材料并启动 Project Task。断言：

1. Project Run 证据只出现在 `<projectId>/.ogs/runs/<runId>`，TeamVersion 发布目录内容和 digest 保持不变。
2. `run-owner.json`、Task 记录、Task Attempt API 和 Run Evidence DTO 的 owner、attemptNumber、teamVersionId 一致。
3. Project/Task/Run 任意一个 owner 字段错误均不可读取事件、结果、审核详情或控制 Run。
4. Project Run 与 Studio Simulation 即使使用相同 runId 字符串仍相互不可见。
5. 项目 dry-run 是 Project Task Run，消耗单槽并进入项目历史；Studio Simulation 不占槽、不进入业务历史。
6. Project Run 完成后可归档独立 Deliverable 快照；Simulation 永远不能归档。

### 11.3 浏览器 UAT / Playwright

- Studio：团队概览进入设计、修改角色与 Flow 配置、验证、创建 Simulation、查看历史回放、通过门禁发布。
- Projects：创建项目、挂载发布版本、添加 Materials、创建 Task、运行、暂停、审核通过/打回/分支终止、重试、完成后归档 Deliverable。
- 交叉验证：从 Project 只读挂载版本跳回 Studio；发布新 TeamVersion 后按明确流程重新挂载；旧 Task 重试仍指向原版本。
- 页面和交互：Studio/Projects 一级导航清楚，图谱和检查器无遮挡，错误恢复和焦点保持正确，按钮同语义文案一致，状态提示不把静态检查说成网络连通保证。
- 响应式视口至少覆盖 1440、1024、768、390、320 CSS 像素；检查滚动、缩放、面板切换、焦点可见与文本溢出。
- 测试一次服务重启和浏览器刷新：Project Run 状态恢复、Studio Simulation 历史可回放、两个领域仍隔离。

## 12. 发布门槛与未覆盖项

发布前完成：Team Site 单元/集成/API 测试，Runtime 项目运行与恢复回归，Studio 图引擎 import guardrail，构建与类型检查，Playwright 浏览器验收，以及真实 Sandbox Harness 的端到端试跑。Codex/OpenCode 等 Harness 的模型探测与外部凭据可用性需在目标环境验证；静态 Readiness 只能验证配置结构，不能代替真实连通性检查。

真实外部模型、凭据和 Sandbox 执行器不可用时，将对应场景标记为“未验收”，不可用模拟 Runtime 结果替代真实执行结论。验收报告需记录数据根配置、TeamVersion digest、Task/Run/Simulation 标识、步骤、浏览器视口、服务重启结果和未解决缺陷。任何 Project Run 写入 TeamVersion、任何 Simulation 出现在业务 Task/Run/Deliverable 中、任何 owner 越权读取，均为发布阻断项。

## 13. 关键实现位置（初始映射）

以下为开始实施时应复核的入口，实际文件职责以实现阶段检查为准：

- Runtime：`src/runtime/adapter.ts`、`src/runtime/runtime-setup.ts`、`src/runtime/run-artifacts.ts`、`src/runtime/project-run-snapshot.ts`。
- Task 与业务用例：`apps/team-site/application/task-execution-use-cases.mjs`、`task-retry-use-cases.mjs`、`task-lifecycle-use-cases.mjs`、`run-query-use-cases.mjs`、`run-recovery-use-cases.mjs`。
- 文件实现：`apps/team-site/infrastructure/file-task-execution-store.mjs`、`file-run-query-store.mjs`、`file-run-result-store.mjs`、`runtime-task-review-store.mjs`、`runtime-team-simulation.mjs`。
- 组合根与 API：`apps/team-site/server.mjs` 及 `apps/team-site/api/` 下 Task、Run、Team 路由。
- 前端：`apps/team-site/public/app/router.js`、`apps/team-site/public/app/views/app.js`、`apps/team-site/public/index.html`、`apps/team-site/public/styles.css` 及 `src/visualizer/studio-client/`。
- 测试：`apps/team-site/tests/`、`tests/`、`tests-e2e/`。

## 14. 实施与验收记录

本文件定义目标架构、契约和验收矩阵，不维护可过期的测试计数或 UAT 快照。当前实现状态、测试命令与结果、真实执行证据及剩余发布阻断项统一记录在[Studio 与 Projects 测试及 UAT 报告](ogs-studio-project-run-isolation-validation-report.md)。发布状态以该报告最新日期的结论为准；历史数据根和旧版计数只作为当时记录，不覆盖当前契约。
