# OGSystem Runtime Input Contract VNext 方案与执行计划（2026-04-21）

Status: proposed execution plan  
Target: latest-version only  
Compatibility: not required  
Scope: `output.schema -> context.map` 编译期联查、投影对象一等输入化、受控全局共享数据面

## 1. 目标

把当前运行时的“上游输出 -> 下游输入”关系，从“运行时大多靠字符串 prompt 和局部校验兜底”，收敛成一套更完整、可编译、可审计、可恢复的输入契约体系。

本次方案要完成三件事：

1. 编译期联查上游 `output.schema` 与下游 `context.map`
2. 让投影对象成为一等输入，而不是只序列化进字符串 `context`
3. 引入一层受控的全局共享数据面，而不是直接暴露 `GraphState`

约束：

- 不回退到“自动读取任意 runtime state”的做法
- 不引入表达式语言
- 不牺牲当前图执行、join、loop、resume 的确定性
- 不做兼容保留；按下一版本的统一新语义推进

## 2. 当前基线

当前代码已经具备一部分基础，但还不够完整：

### 2.1 已有能力

- 角色输出已经按 `output.schema` 校验并落盘，见 `src/runtime/role-executor.ts`
- `context.map` 已支持受限 selector，并可在运行时构造结构化投影对象，见 `src/runtime/role-input-projector.ts`
- 编译器已能检查 selector 语法、join/source 合法性、`role_input` 绑定存在性，见 `src/runtime/compiler.ts`

### 2.2 当前缺口

- 编译器并不知道 `direct.data.foo` 或 `source(x).data.foo` 在上游 `output.schema` 中是否真的存在
- 运行时虽然会先构造 `buildProjectedContext()` 对象，但随后立刻把它序列化成 `context` 字符串
- 当前 prompt 输入壳仍偏向字符串字段：`task/context/allowed_events/last_output/...`
- 系统没有一层受控、类型化、可审计的共享数据面；只有 `sharedDir` 文件目录和内部 `GraphState`

结论：

- 现在的 `context.map` 方向是对的
- 现在的 `output.schema` 方向也是对的
- 还差的是“编译期 schema 链接 + 运行时对象保真 + 受控共享状态”

## 3. 总体设计结论

下一版本建议收敛到下面这套契约：

### 3.1 保留 `output.schema`

每个 role 仍输出统一 envelope：

```json
{
  "event": "DONE",
  "content": "summary text",
  "data": {}
}
```

其中：

- `event` 负责 flow routing
- `content` 负责人类可读摘要
- `data` 负责结构化机器数据

`output.schema` 继续是 role 产出物的唯一真相。

### 3.2 下游输入改成结构化一等对象

下一版本不再把 `context` 作为唯一核心输入字段，而是把 runtime 构造的投影对象提升为一等输入：

```ts
type RuntimeRoleInput = {
  task: string;
  input: Record<string, unknown>;
  allowedEvents: string[];
  previous: {
    direct?: {
      event?: string;
      content?: string;
      data?: Record<string, unknown>;
    };
    sources?: Record<string, {
      event?: string;
      content?: string;
      data?: Record<string, unknown>;
    }>;
  };
  shared: Record<string, unknown>;
  round: number;
  userProfile: Record<string, unknown>;
  runtime: {
    roleId: string;
    branchId: string;
    lineageId: string;
    loopIteration: number;
  };
};
```

关键点：

- `input` 是业务主输入
- `previous` 是上游输出视图，不再偷塞进 `last_output`
- `shared` 是受控全局共享数据，不是整个 runtime state
- prompt 渲染层再决定把这些对象转成 `{{input_json}}`、`{{shared_json}}` 等文本

### 3.3 `context.map` 继续存在，但职责更清晰

`context.map` 只负责：

- 从授权来源选择字段
- 组装目标 role 的 `input` 对象

它不再承担“兼容旧 prompt 字符串壳”的职责。

### 3.4 新增受控全局共享数据面

新增一个系统级 `sharedData` 数据面：

- 它有独立 schema
- 它有独立初始化值
- 它只能通过声明式写入规则更新
- 它只能通过 `global.shared.*` selector 被读取

这层数据面类似 LangGraph 的 shared state，但比“把整份 state 暴露给节点”更可控。

## 4. VNext 目标语义

### 4.1 新的 selector 读面

保留现有：

- `global.task`
- `global.user_profile`
- `global.user_profile.<path>`
- `direct.content`
- `direct.event`
- `direct.data`
- `direct.data.<path>`
- `source(<roleId>).content`
- `source(<roleId>).event`
- `source(<roleId>).data`
- `source(<roleId>).data.<path>`

新增：

- `global.shared`
- `global.shared.<path>`

限制：

- `global.shared.*` 只能读共享数据面，不读 `GraphState`
- 普通节点仍不能跨层祖先遍历
- join 节点仍只能读取 `join.sources` 里声明的 source

### 4.2 新的共享写入面

新增系统 metadata：

```txt
shared.schema=contracts/shared-state.schema.json
shared.init=contracts/shared-state.init.json
shared.map.dispatch.case.id=output.data.case.id
shared.map.dispatch.case.priority=output.data.priority
shared.map.review.case.summary=output.content
shared.reduce.case=merge
```

含义：

- `shared.schema`：共享数据面的 JSON Schema
- `shared.init`：初始化共享状态
- `shared.map.<writerRoleId>.<targetPath>=<outputSelector>`：role 输出到共享面的映射
- `shared.reduce.<targetPath>`：目标路径的合并策略

第一版 reducer 建议只支持：

- `replace`
- `merge`
- `append`

规则：

- `replace`：目标字段直接覆盖
- `merge`：目标字段必须是 object，做浅合并或稳定深合并
- `append`：目标字段必须是 array，把当前值追加进去

不建议一开始就支持：

- 任意表达式 reducer
- 动态脚本 reducer
- 读写整份 runtime state

### 4.3 默认输入形状

即使系统作者不写 `context.map`，role 仍然有结构化 `input`。

默认规则：

- entry role：`input = { task: global.task }`
- 普通非 join role：`input = { event, content, data }`，来自直接上游
- join role：`input = { sources: { ... } }`，来自 `join.sources`

这保证“没有自定义投影的系统”仍然能工作，只是输入壳从字符串模式升级成对象模式。

## 5. 编译期联查设计

### 5.1 编译器新增的核心能力

编译器不再只验证 selector 语法，而是要额外产出：

- `OutputEnvelopeSummary`
- `ProjectionSchemaSummary`
- `SharedDataSummary`
- `ProjectionLinkDiagnostic`

核心流程：

1. 解析每个 role 的 `output.schema`
2. 抽取 `event/content/data` 的路径与类型摘要
3. 解析每个 role 的 `context.map`
4. 把 selector 解析为“来源 role + 来源字段路径”
5. 在编译期检查该字段路径是否存在、类型是否可读
6. 如果存在 `role_input` 合同，再检查投影结果是否满足该合同
7. 如果存在 `shared.map`，再检查写入路径是否存在、类型是否匹配 reducer

### 5.2 必须新增的编译错误

建议新增以下 diagnostics：

- `COMPILER_CONTEXT_SELECTOR_SCHEMA_PATH_MISSING`
- `COMPILER_CONTEXT_SELECTOR_SCHEMA_TYPE_MISMATCH`
- `COMPILER_CONTEXT_SELECTOR_SOURCE_SCHEMA_MISSING`
- `COMPILER_PROJECTION_CONTRACT_MISMATCH`
- `COMPILER_SHARED_SCHEMA_MISSING`
- `COMPILER_SHARED_TARGET_PATH_MISSING`
- `COMPILER_SHARED_TARGET_TYPE_MISMATCH`
- `COMPILER_SHARED_REDUCER_INVALID`
- `COMPILER_SHARED_MULTI_WRITER_CONFLICT`
- `COMPILER_SHARED_SELECTOR_UNAUTHORIZED`

### 5.3 schema 链接规则

对 `context.map.review.case_id=direct.data.case.id`：

1. 找到 `review` 的直接上游 role
2. 读取该上游 role 的 `output.schema`
3. 验证 `data.case.id` 路径存在
4. 记录 `case_id <- string` 之类的投影字段摘要

对 `context.map.review.a_score=source(score_a).data.score`：

1. 校验 `review` 是 join 节点
2. 校验 `score_a` 在 `join.sources.review` 中
3. 读取 `score_a` 的 `output.schema`
4. 验证 `data.score` 路径存在且类型可解析

对 `context.map.review.priority=global.shared.case.priority`：

1. 校验系统定义了 `shared.schema`
2. 校验共享 schema 中存在 `case.priority`
3. 记录该 selector 来自共享面而非 runtime state

### 5.4 对 `role_input` 合同的定位

建议继续保留 `role_input` 合同，但把它明确成：

- 系统级、业务层的下游输入契约
- 校验对象是 `input`
- 不负责校验整个 prompt 文本

也就是说：

- `output.schema` 约束“我产出什么”
- `context.map` 约束“我从哪里取”
- `role_input` 约束“我最后喂给这个 role 的业务对象长什么样”

## 6. 运行时输入对象设计

### 6.1 新的 prompt 输入壳

建议新增：

```ts
type RenderablePromptInput = {
  task: string;
  input_json: string;
  input_pretty: string;
  shared_json: string;
  shared_pretty: string;
  allowed_events_json: string;
  previous_json: string;
  user_profile_json: string;
  round: string;
  role_id: string;
  branch_id: string;
};
```

其中：

- runtime 内部真相是结构化 `RuntimeRoleInput`
- prompt 模板层只消费明确字符串变量
- 不再把 `context` 作为唯一语义核心

### 6.2 prompt 模板建议改成如下风格

```txt
{{persona}}

{{work}}

Task:
{{task}}

Input JSON:
{{input_pretty}}

Shared JSON:
{{shared_pretty}}

Allowed events:
{{allowed_events_json}}

Previous outputs:
{{previous_json}}

User profile:
{{user_profile_json}}

Return JSON only.
```

这会比现在的 `Context:` / `Last output:` 更准确，因为：

- `input` 才是业务主输入
- `previous` 是执行历史来源
- `shared` 是系统级共享背景

### 6.3 审计与恢复要求

运行时要同时落以下几类证据：

- `input.json`
- `prompt.txt`
- `shared-before.json`
- `shared-after.json`
- `shared-patch.json`

这样恢复与审计都能回答：

- 这个 role 当时看到了什么输入
- 它改了哪些共享字段
- 改动前后的共享状态是什么

## 7. 共享数据面设计

### 7.1 数据模型

在 `GraphState` 中新增：

```ts
sharedData: Record<string, unknown>;
```

但注意：

- `GraphState.sharedData` 只是持久化承载
- 对 role 来说，可见的是经过 schema + selector 限制的 `global.shared.*`
- 不能新增 `global.state.*` 之类的直通入口

### 7.2 更新时机

共享数据只在 role 输出通过 `output.schema` 校验后更新。

顺序必须固定：

1. role 执行
2. 解析输出
3. 按 `output.schema` 校验
4. 根据 `shared.map` 生成共享 patch
5. 按 `shared.reduce` 应用 patch
6. 对更新后的 `sharedData` 再按 `shared.schema` 校验
7. 写 audit / checkpoint
8. 再进行 transition

这样可以保证：

- 不会把非法输出写进共享面
- 不会把不合法共享状态持久化
- resume 重放顺序稳定

### 7.3 多 writer 冲突策略

建议明确 fail-closed：

- 多个 role 可以写同一 target path
- 但 reducer 和目标类型必须一致
- 同一 role 不能同时写 `case` 和 `case.id` 这类祖先/子孙冲突路径
- 如果多个 writer 写同一路径且语义冲突，编译期直接报错

## 8. 实施范围与代码落点

建议按以下文件分层实施。

### 8.1 类型与状态

- `src/runtime/types.ts`
- `src/runtime/graph-runtime-state.ts`
- `src/runtime/runtime-indexes.ts`

工作项：

- 新增 `sharedData`
- 新增 `RuntimeRoleInput`
- 新增 `SharedWriteRule`、`SharedReducerKind`
- 新增编译摘要类型

### 8.2 解析与静态语义

- `src/runtime/parse-mermaid.ts`
- `src/runtime/static-semantics.ts`
- `src/runtime/compiler.ts`

工作项：

- 解析 `shared.schema`
- 解析 `shared.init`
- 解析 `shared.map.*`
- 解析 `shared.reduce.*`
- 增加 selector schema 链接
- 增加 shared read/write schema 链接

### 8.3 运行时投影与执行

- `src/runtime/role-input-projector.ts`
- `src/runtime/role-executor.ts`
- `src/runtime/graph-runner.ts`
- `src/runtime/run-artifacts.ts`

工作项：

- 构造结构化 `RuntimeRoleInput`
- 新增 `global.shared.*` selector
- 生成 prompt render vars
- 应用共享 patch
- 落共享数据审计证据

### 8.4 指纹、恢复与检查工具

- `src/runtime/plan-fingerprint.ts`
- `src/runtime/doctor.ts`
- `src/runtime/run-summary.ts`

工作项：

- 把 `shared.schema` / `shared.init` / `shared.map` / `shared.reduce` 纳入 plan fingerprint
- `doctor` 检查共享 schema 与编译摘要一致性
- 恢复时对 `sharedData` 做完整性校验

## 9. 分阶段执行计划

### Phase 0: 冻结基线

目标：

- 冻结当前 `context.map`、`output.schema`、join、resume 行为

交付：

- 为当前行为补测试快照
- 明确现有 prompt 输入壳的替换范围

必须新增测试：

- `context.map` 普通节点
- `context.map` join 节点
- `quorum_of + source(...)`
- `resume` 后投影稳定性

### Phase 1: 编译期 schema 链接

目标：

- 先不改 prompt 壳，先补最关键的静态联查

交付：

- 编译器能把 selector 链到上游 `output.schema`
- 编译器能把 `global.shared.*` 链到 `shared.schema`
- 编译器能把投影结果与 `role_input` 合同联查

验收：

- 非法 `direct.data.foo` 在编译期失败
- 非法 `source(x).data.foo` 在编译期失败
- 非法 `global.shared.foo` 在编译期失败

### Phase 2: 一等输入对象

目标：

- 用结构化 `RuntimeRoleInput` 替换字符串主输入

交付：

- `buildProjectedContext()` 升级成 `buildRuntimeRoleInput()`
- prompt 渲染从 `context` 切换到 `input_json/shared_json/previous_json`
- 审计记录改存结构化输入

验收：

- 不写 `context.map` 的系统仍能跑通
- 写了 `context.map` 的系统看到的是结构化输入对象
- prompt 产物与 audit 能完整复现当时输入

### Phase 3: 共享数据面

目标：

- 引入可写、可读、可编译验证的 `sharedData`

交付：

- `shared.schema`
- `shared.init`
- `shared.map`
- `shared.reduce`
- runtime patch 应用与校验

验收：

- role 可经 `global.shared.*` 读取共享数据
- writer role 可把 `output.data.*` 投影进共享面
- 非法共享 patch 在执行时 fail closed
- resume 后 `sharedData` 不漂移

### Phase 4: 文档、可视化、运维工具

目标：

- 把新契约变成默认使用方式

交付：

- 更新 `docs/usage-manual.md`
- 更新 `docs/ogsystem-orchestration-semantics-v1.md`
- 更新 `docs/DECISIONS.md`
- visualizer 展示 `input` / `shared` / `shared patch`
- `ogs doctor` 增加共享面检查

验收：

- 文档不再把 `context` 当成唯一输入真相
- visualizer 能看见共享数据变化轨迹

## 10. 测试计划

必须新增以下测试组：

### 10.1 编译器

- 上游 `output.schema` 缺字段时报错
- 上游 `output.schema` 类型不匹配时报错
- `role_input` 合同与投影结果不匹配时报错
- `shared.map` 写入未知路径时报错
- `shared.reduce` 与目标 schema 类型冲突时报错

### 10.2 运行时

- 普通节点默认输入对象构造
- join 节点默认 `sources` 输入对象构造
- `global.shared.*` selector 读取
- `shared.map` patch 应用
- `shared.schema` 运行时校验

### 10.3 恢复与指纹

- `sharedData` 进入 `state.json`
- `sharedData` 经 checkpoint / resume 后一致
- 共享规则变更导致 resume fingerprint 不匹配

### 10.4 端到端

- 线性系统：直接上游投影
- join 系统：多源投影
- consultation/software-dev 示例：共享 case 状态或任务状态

## 11. 风险与控制

### 11.1 风险：prompt 语义变更导致角色模板失效

控制：

- 仓库内 role 模板一次性迁移到 `input_json/shared_json`
- 所有 bundled role 在同一版本更新

### 11.2 风险：共享状态扩大后引入隐式耦合

控制：

- 只允许 `global.shared.*`
- 所有共享读写都必须声明
- 编译器强制 schema 链接

### 11.3 风险：resume 指纹漏算

控制：

- `shared.schema/init/map/reduce` 全部进 fingerprint
- shared patch 进 audit 与 checkpoint

## 12. 推荐实施顺序

建议顺序如下：

1. 先做编译期 schema 链接
2. 再把输入对象提升为一等输入
3. 最后接入共享数据面
4. 收尾更新文档、visualizer、doctor

原因：

- Phase 1 先把错误前置，收益最大、风险最小
- Phase 2 再改 prompt 输入壳，能减少运行时重复返工
- Phase 3 才加共享写入，避免一开始同时改“读面”和“写面”

## 13. 最终结论

这三步不是三个离散 feature，而是一套完整输入契约升级：

- `output.schema` 负责定义生产者
- `context.map` 负责定义读取与投影
- `role_input` 负责定义消费者输入契约
- `sharedData` 负责承载系统级受控共享状态

如果只做其中一步，系统会继续停留在“语义方向正确，但真相散落在运行时字符串和局部约束里”的状态。

按本方案推进后，OGSystem 会得到一条更完整的链路：

`output.schema -> selector link -> projected input -> role_input contract -> prompt render vars -> sharedData`

这条链路才是更接近最佳实践、同时又不回到“直接暴露 runtime state”的收敛方案。
