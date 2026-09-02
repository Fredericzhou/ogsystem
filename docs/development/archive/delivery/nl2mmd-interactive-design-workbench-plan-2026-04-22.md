# NL2MMD Interactive Design Workbench Plan

Date: 2026-04-22
Status: proposed

## 1. Decision Summary

`nl2mmd` 下一阶段不应继续定位为“自然语言一次性生成 Mermaid”的轻量工具，而应升级为交互式设计工作台。

未来的主路径按以下三条约束收敛：

- `nl2mmd` 是会话式设计入口，用户通过自然语言连续生成和逐步优化 `system.mmd`
- 系统优先构建团队协作流程与 `mmd` 骨架，再逐步打磨 flow、metadata、runtime contract、role binding
- `nl2mmd` 同时面向开放仓库：不仅可以查找 `mmd/role`，还可以生成新的 `mmd/role`

因此，本轮方案的核心不是增加更多 CLI 子命令，而是：

1. 把 `nl2mmd` 改造成状态化设计会话
2. 把“结构语义 + mmd repo + role repo + validation”收敛为统一编排引擎
3. 把生成动作拆成 `build mmd -> refine flow -> resolve/generate roles`

## 2. Current Baseline

当前仓库已经具备可复用基础，但仍停留在“单轮草稿器”阶段：

- `src/nl2mmd/cli.ts`
  - 已支持 one-shot 与交互模式
  - 但交互仍围绕单轮 prompt 和 Mermaid 直接输出
- `src/nl2mmd/service.ts`
  - 已有会话对象与 preflight
  - 但每轮仍主要要求模型直接产出完整 Mermaid
- `src/nl2mmd/catalog.ts`
  - 已能加载本地 role/model/law 上下文
  - 但尚未抽象为开放式 repository layer
- `src/nl2mmd/semantic-map.ts`
  - 已有 hints 与轻量搜索
  - 但仍以规则 + contains 匹配为主
- `src/nl2mmd/structure-templates.ts`
  - 已有稳定结构模板
  - 但模板仍是 advisory，不是主规划器
- `src/nl2mmd/validate.ts`
  - 已有 Mermaid 候选校验
  - 但仍是生成后验证，不是全流程约束反馈

这套实现适合“给一版初稿”，不适合未来的开放设计工作流。

## 3. Product Direction

### 3.1 Single Entry, Conversational Workflow

CLI 保持一个主入口：

```bash
ogs-nl2mmd
```

用户通过自然语言连续推进设计，不要求记忆复杂命令树。

内部允许少量会话控制命令，但不承载主要业务动作：

- `/help`
- `/status`
- `/validate`
- `/diff`
- `/save`
- `/reset`
- `/quit`

业务动作全部通过自然语言表达，例如：

- “先帮我搭一个并行评审流程”
- “把这里改成 quorum”
- “这里加人工审批”
- “不要动角色，只优化 flow”
- “为这个新 role 生成包”

### 3.2 MMD First, Role Second

用户工作顺序明确为：

1. 先构建 `mmd`
2. 再逐步优化 flow / metadata / runtime contract
3. 最后解析、导入或生成 role

这条顺序必须成为系统设计硬约束。

`nl2mmd` 不应在首次生成阶段就把“结构流转设计”和“role package 生成”混成同一轮。

### 3.3 Open Repositories

未来 `nl2mmd` 面向三类知识来源：

- 本地工作区 repo
- 包内默认 repo
- 外部开放 repo

其中包括：

- `mmd repository`
- `role repository`
- 可选的模板/示例 catalog

## 4. Design Principles

### 4.1 Artifact-Driven, Not Prompt-Only

系统主对象不再是“上一次对话文本”，而是设计工件：

- `system.mmd`
- `flow plan`
- `role resolution plan`
- `generated role drafts`
- `validation report`

prompt 只是工件演化的接口，不是状态真相。

### 4.2 Structure Before Surface

先确定结构模板和槽位，再生成 Mermaid 文本。

也就是说，生成器不应直接从自然语言自由生成整张图，而应遵循：

`intent -> semantic query -> template/slot plan -> mmd draft -> validation -> refine`

### 4.3 Interactive Refinement Over Full Rewrite

当已有草稿存在时，系统默认执行局部修改，而不是每轮整图重写。

只有在结构冲突较大时才允许全量重写。

### 4.4 Explainable Suggestions

无论是推荐模板、推荐 role，还是自动补 metadata，系统都必须给出可解释理由。

### 4.5 Repository Neutrality

查找和生成都不应绑死本地目录扫描实现，而要抽象成统一 repository layer。

## 5. Target User Workflow

### Stage A: Build MMD

目标：先形成可运行的团队协作流程骨架。

输入：

- 自然语言任务描述
- 可选已有草稿

输出：

- 建议的结构模板
- 缺失槽位
- 首版 `system.mmd`

### Stage B: Refine Flow

目标：围绕已有 `mmd` 做多轮增量优化。

优化范围包括：

- entry role
- split/join
- quorum
- loop
- contracts
- route order
- context map
- error flows
- runtime feature flags

### Stage C: Resolve Roles

目标：为图中的每个 role 确定来源。

状态分三类：

- 绑定已有 role
- 推荐从 repo 导入 role
- 缺失 role，需要生成

### Stage D: Generate Roles

目标：只对必要角色生成 role package。

输出至少包括：

- `role.json`
- `agent.md`
- `prompt.md`
- `output.schema.json`

## 6. Core Architecture

### 6.1 Session State

建议新增统一会话状态：

```ts
type DesignSessionState = {
  sessionId: string;
  stage: "discover" | "build_mmd" | "refine_flow" | "resolve_roles";
  query: DesignQuery;
  plan: DesignPlan;
  artifacts: {
    systemMmd?: string;
    flowSpec?: FlowSpec;
    rolePlan?: RolePlan;
    generatedRoles?: GeneratedRoleDraft[];
  };
  validation: {
    mmd?: ValidationReport;
    roles?: ValidationReport[];
  };
  history: DesignTurn[];
};
```

该状态必须是会话真相，而不是临时 prompt 拼接物。

### 6.2 Repository Layer

建议抽象统一 repo 接口：

```ts
type Repository<TQuery, TResult> = {
  list(): Promise<TResult[]>;
  get(id: string): Promise<TResult | undefined>;
  search(query: TQuery): Promise<SearchResult<TResult>[]>;
};
```

最少提供三类实现：

- `LocalRoleRepository`
- `LocalMmdRepository`
- `BundledRepository`

后续可扩展：

- `RemoteCatalogRepository`

### 6.3 Semantic Query Layer

自然语言先归一化为结构化设计查询：

```ts
type DesignQuery = {
  message: string;
  stage: "build_mmd" | "refine_flow" | "resolve_roles";
  mentionedRoles: string[];
  mentionedSystems: string[];
  targetFacets: string[];
  topologyNeeds: string[];
  governanceNeeds: string[];
  runtimeNeeds: string[];
  constraints: {
    preserveRoles?: boolean;
    preserveTopology?: boolean;
    roleGenerationAllowed?: boolean;
  };
};
```

这层应取代当前仅返回 label 的 semantic hints 设计。

### 6.4 Semantic Graph

建议引入轻量任务语义图谱，不引入图数据库。

节点类型：

- `facet`
- `template`
- `slot`
- `role`
- `mmd`
- `event`
- `metadata`
- `runtime_flag`

边类型：

- `facet -> suggests -> template`
- `template -> requires -> slot`
- `template -> requires_metadata -> metadata`
- `template -> implies_runtime_flag -> runtime_flag`
- `role -> emits -> event`
- `role -> fits_slot -> slot`
- `role -> supports -> facet`
- `mmd -> instantiates -> template`
- `mmd -> uses_role -> role`

图谱职责：

- 结构模板选择
- 槽位推断
- role 候选重排
- metadata/runtime flag 建议
- 语义冲突解释

### 6.5 Planner Layer

在生成 Mermaid 前先产出中间规划结果：

```ts
type DesignPlan = {
  candidateTemplates: TemplateCandidate[];
  selectedTemplate?: string;
  requiredSlots: RequiredSlot[];
  suggestedRolesBySlot: Record<string, RoleCandidate[]>;
  requiredMetadata: string[];
  requiredRuntimeFlags: string[];
  unresolvedItems: string[];
};
```

该层把“结构规划”与“文本生成”解耦。

### 6.6 Generator Layer

拆分生成器，而不是一个 prompt 全包：

- `MmdBuilder`
- `FlowRefiner`
- `RoleResolver`
- `RoleBuilder`

职责分别为：

- 生成首版 `system.mmd`
- 基于已有草稿做局部修改
- 为图中 role 做绑定/导入/生成决策
- 生成新 role package

## 7. MMD Repository Contract

未来 `mmd repo` 不应只是 Mermaid 文件目录，而应是可检索条目集合。

建议最小条目：

```ts
type MmdRepositoryEntry = {
  systemId: string;
  title: string;
  summary: string;
  tags: string[];
  facets: string[];
  topology: string[];
  requiredSlots: string[];
  roleIds: string[];
  metadataFeatures: string[];
  systemPath: string;
};
```

这样 `nl2mmd` 才能查的是“结构能力”，而不是只查文本。

## 8. Role Resolution Contract

每个 Mermaid role 节点最终必须进入以下状态之一：

- `bound_existing`
- `import_recommended`
- `generation_required`

建议中间结果：

```ts
type RoleResolution = {
  roleId: string;
  status: "bound_existing" | "import_recommended" | "generation_required";
  candidates: RoleCandidate[];
  reasoning: string[];
};
```

这层必须在 `mmd` 稳定后再执行，不应前置。

## 9. Prompt And Response Refactor

### 9.1 Prompt Modes

当前 prompt 体系需要拆分为三类：

- `ask_clarification`
- `build_first_draft`
- `refine_existing_draft`
- `build_role_package`

### 9.2 Response Schema

建议把当前 `ask/draft/final` 扩展为面向交互式优化的协议：

```json
{
  "mode": "ask|draft|revise|final",
  "summary": "本轮动作摘要",
  "changeScope": ["topology", "join", "metadata"],
  "questions": [],
  "assumptions": [],
  "unresolvedItems": [],
  "mermaid": "",
  "patchNotes": []
}
```

其中：

- `draft` 用于首版生成
- `revise` 用于已有草稿增量优化
- `final` 用于可持久化版本确认

## 10. Validation Refactor

验证不应只在末尾运行，而应成为每轮强反馈。

建议拆为：

- `validate-mmd`
- `validate-role`
- `validate-session-consistency`

新增检查：

- 模板一致性检查
- 槽位完整性检查
- metadata/runtime flag 缺失检查
- role resolution completeness 检查
- Mermaid 局部修改后的语义漂移检查

## 11. CLI Interaction Model

外部命令保持极简：

```bash
ogs-nl2mmd
```

CLI 行为：

- 默认进入交互会话
- 若存在已有草稿，则默认进入 refine 模式
- 每轮输出：
  - 本轮摘要
  - Mermaid 草稿或变更说明
  - 校验结果
  - 下一步建议

允许的辅助命令仅用于会话控制：

- `/help`
- `/status`
- `/validate`
- `/diff`
- `/save`
- `/reset`
- `/quit`

明确不推荐把主工作流拆成复杂子命令树。

## 12. File-Level Refactor Plan

建议新增：

- `src/nl2mmd/design-session.ts`
- `src/nl2mmd/design-query.ts`
- `src/nl2mmd/design-plan.ts`
- `src/nl2mmd/semantic-graph-types.ts`
- `src/nl2mmd/semantic-graph-builder.ts`
- `src/nl2mmd/semantic-query.ts`
- `src/nl2mmd/repositories/mmd-repo.ts`
- `src/nl2mmd/repositories/role-repo.ts`
- `src/nl2mmd/repositories/bundled-repo.ts`
- `src/nl2mmd/generators/mmd-builder.ts`
- `src/nl2mmd/generators/flow-refiner.ts`
- `src/nl2mmd/generators/role-builder.ts`
- `src/nl2mmd/planners/role-resolution.ts`

建议重构：

- `src/nl2mmd/cli.ts`
- `src/nl2mmd/service.ts`
- `src/nl2mmd/prompt.ts`
- `src/nl2mmd/catalog.ts`
- `src/nl2mmd/semantic-map.ts`
- `src/nl2mmd/validate.ts`
- `src/nl2mmd/index.ts`

## 13. Delivery Phases

### Phase 1: Session Backbone

目标：

- 引入 `DesignSessionState`
- 保留单入口交互 CLI
- 把当前单轮 Mermaid 生成改造成状态化会话

验收：

- 支持首版生成与继续对话优化
- 每轮都有会话状态与校验反馈

### Phase 2: Semantic Planning

目标：

- 引入 `DesignQuery`
- 接入轻量语义图谱
- 用模板/槽位规划替代平面 hints

验收：

- 结构模板成为主建议面
- role 推荐按 slot 给出

### Phase 3: Repository Opening

目标：

- 新增 `mmd repository`
- 统一 repo abstraction
- 支持本地、包内、远程 repo 检索

验收：

- `nl2mmd` 可同时查找现有 `mmd` 和现有 `role`

### Phase 4: Role Resolution And Generation

目标：

- role resolution 成为显式阶段
- 支持生成缺失 role package

验收：

- 同一会话内完成：
  - 构建 `mmd`
  - 优化 flow
  - 解析 role
  - 生成新 role

## 14. Best-Practice Constraints

本方案明确遵守以下约束：

- 不引入图数据库作为首版依赖
- 不把 embedding 检索作为主语义层
- 不要求用户记复杂 CLI 子命令
- 不把会话状态只保存在 prompt 文本中
- 不在首次生成阶段同时处理流程设计和 role package 生成
- 不让模型自由决定全部 runtime contract，而是由 planner + validator 共同约束

## 15. Summary

未来 `nl2mmd` 的正确定位是：

- 一个交互式 MMD 设计会话系统
- 一个面向开放 `mmd/role` 仓库的设计入口
- 一个遵循 `build mmd -> refine flow -> resolve/generate roles` 顺序的编排工作台

它不应继续停留在“轻量 NL -> Mermaid 草稿器”，也不应演进成复杂命令集合，而应以单入口对话、结构规划、语义图谱、开放仓库与工件驱动状态作为核心设计原则。
