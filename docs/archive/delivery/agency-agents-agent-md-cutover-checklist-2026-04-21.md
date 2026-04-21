# 通用 Agent Source Importer 与 `agent.md` 单文件切换任务清单

Date: 2026-04-21
Status: proposed execution checklist
Target: latest-version only
Compatibility: not required
Scope: OGSystem role 从 `persona.md + work.md` 收敛为 `agent.md`；外部 agent 仓库通过 importer adapter 导入为 canonical role package
Authority: 非当前权威语义，仅作为执行清单

本文档不代表当前 runtime 已生效语义。
若与 `src/runtime/*` 或活跃文档冲突，以当前实现和活跃文档为准。
只有在方案落地并回写活跃文档后，本文档中的相关结论才可视为正式语义。

## 1. 目标

完成以下切换：

1. 纳入首批上游 agent source，并支持通过 Git 升级；`agency-agents` 可作为第一个接入源。
2. 建立不绑定单一上游仓库的 importer adapter 机制，支持未来接入不同目录结构和内容格式的 agent 仓库。
3. 角色主内容从 `persona.md` / `work.md` 双文件收敛为单个 `agent.md`。
4. runtime、脚手架、文档、测试统一切到新格式，不保留兼容层。
5. 任何上游 agent 仓库都不直接作为 runtime 可执行 role；必须先转换为 OGSystem canonical role package。

## 2. 非目标

- 不保留 `persona.md` / `work.md` 向后兼容读取。
- 不让 runtime 直接扫描任意上游 agent repo 原始目录结构。
- 不从上游 markdown 自动推断项目专属 Mermaid event 名。
- 不在本轮引入远程 repo resolver；上游升级仍以 Git 本地工作树为前提。

## 3. 目标目录契约

目标结构：

```txt
agent-sources/
  agency-agents/
  other-agent-repo/

og-roles/
  roles/
    imported.agency.frontend-developer/
      role.json
      agent.md
      prompt.md
      output.schema.json
      source.json
  importers/
    agency-agents.mjs
    generic-markdown.mjs
    other-agent-repo.mjs
  scripts/
    sync-agent-sources.mjs
  sources.lock.json
```

约束：

- `agent-sources/*` 是上游源目录，可按仓库分别用 `git submodule` 或等效固定引用机制管理。
- `agent-sources/*` 是开发态目录，不属于安装态运行契约。
- runtime 只解析 `roles/<roleId>/`。
- `agent.md` 是角色主文本真相。
- `prompt.md` 只负责 OGSystem 输入壳包装。
- `source.json` 记录上游来源信息；不要把来源元数据塞进 `role.json`。
- runtime 不依赖任何 importer 专属目录结构。
- 安装态产物默认继续只包含 `og-roles/**`，不包含 `agent-sources/**`；只有 canonical role package 进入发布包。

## 3.0 Canonical Import Strategy

长期方案固定为：

1. runtime 只消费 canonical role package
2. 上游仓库差异全部由 importer adapter 收敛
3. `source.json` / `sources.lock.json` 只做溯源与同步，不参与执行契约
4. `agency-agents` 只是第一个 source adapter，不是特殊 runtime 入口

建议 importer 接口：

```ts
type AgentSourceAdapter = {
  sourceType: string;
  detect(rootDir: string): Promise<boolean>;
  listAgents(rootDir: string): Promise<UpstreamAgentRecord[]>;
  normalize(record: UpstreamAgentRecord): Promise<CanonicalRoleDraft>;
};
```

## 3.0a Delivery Sequencing

本清单涵盖三条相关但半径不同的变更线：

1. `agent.md` cutover
2. prompt-input shell 重设计
3. importer framework

实施时不要把三条线当成一次性“小切换”。

建议分阶段执行：

### Phase A: `agent.md` Cutover

- runtime role loader 切到 `agent.md`
- 仓内 role package、脚手架、基础测试迁移
- 不在这一阶段引入多 source importer

### Phase B: Prompt Input Shell Redesign

- 将默认输入壳从旧字段集切到 `allowed_events/user_preferences/task/input`
- 同步更新 `role-input-projector`、`role-prompt-input-schema`、`plan-fingerprint`
- 补齐 resume、artifact、projection、一致性测试

### Phase C: Importer Framework

- 引入 `agent-sources/`
- 实现 canonical importer adapter 接口
- 接入首个 source，并增加专用 smoke system

阶段原则：

- 每个阶段都应可单独评审、单独回归
- 不要求在 Phase A 完成前把 Phase C 一起落地
- 文档可以先描述全局目标，但实施必须按阶段收口

## 3.1 Prompt Input Contract

本轮收敛到以下默认模板顺序：

```md
{{agent}}

Return one JSON object only.

Allowed events:
{{allowed_events}}

User preferences:
{{user_preferences}}

Task:
{{task}}

Input:
{{input}}
```

字段约束：

- `agent`：角色静态定义，来自 `agent.md`
- `allowed_events`：当前节点允许输出的事件集合
- `user_preferences`：用户偏好配置的序列化 JSON
- `task`：原始用户任务；在循环中保持不变，不做累加
- `input`：当前节点主输入；来自上游输出或 `context.map` 投影，在循环中通常会变化

删除项：

- `last_output`
- `system_notes`
- `round`
- `context`
- `user_profile`

命名替换：

- `context` -> `input`
- `user_profile` -> `user_preferences`

排序原则：

- 稳定项前置：`agent`、固定输出约束、`allowed_events`、`user_preferences`
- 变化项后置：`task`、`input`
- 目标是提高长前缀复用与提示缓存命中率

## 4. 运行时切换任务

### 4.1 role loader

- [ ] 修改 `src/runtime/role-repo.ts`
- [ ] 修改 `src/runtime/role-prompt-input-schema.ts`
- [ ] 修改 `src/runtime/plan-fingerprint.ts`
- [ ] 删除对 `persona.md` / `work.md` 的读取逻辑
- [ ] 新增对 `agent.md` 的强制读取逻辑
- [ ] 将 `LoadedRolePackage` 的文本字段从 `persona/work` 收敛为 `agent`
- [ ] 渲染变量从 `{{persona}}` / `{{work}}` 收敛为 `{{agent}}`
- [ ] prompt input 字段从 `task/context/allowed_events/last_output/system_notes/round/user_profile` 收敛为 `allowed_events/user_preferences/task/input`
- [ ] 清理不再使用的类型与测试夹具

验收标准：

- role 缺少 `agent.md` 时直接报错
- `prompt.md` 中 `{{agent}}` 能正常展开
- `prompt.md` 中 `{{input}}` 与 `{{user_preferences}}` 能正常展开
- plan fingerprint 会因新 prompt input contract 稳定反映变更
- 任何依赖 `persona/work` 的旧角色都会在测试或加载阶段失败

### 4.2 role manifest 约束

- [ ] 保持 `role.json` 最小字段集合不扩张，除非有明确运行时消费需求
- [ ] 明确 `source.json` 不参与 runtime manifest 校验
- [ ] 如需新增 `agentTemplate` 等 manifest 字段，先论证必要性；默认不加

验收标准：

- `role.json` 仍只承载运行时真正需要的字段
- 来源追踪信息不污染 manifest 契约

## 5. role package 结构迁移任务

### 5.1 仓内示例角色迁移

- [ ] 将 `og-roles/roles/*/persona.md + work.md` 合并为 `agent.md`
- [ ] 更新每个角色的 `prompt.md`，从 `{{persona}}` / `{{work}}` 改为 `{{agent}}`
- [ ] 将旧字段标签从 `Context` / `User profile` 改为 `Input` / `User preferences`
- [ ] 删除 `Last output`、`system_notes`、`round` 在默认模板中的展示
- [ ] 删除仓内角色目录下的 `persona.md` 与 `work.md`
- [ ] 检查模板角色、demo 角色、测试角色是否全部完成迁移

验收标准：

- 仓内不再存在 `og-roles/roles/*/persona.md`
- 仓内不再存在 `og-roles/roles/*/work.md`
- 仓内所有角色都能在新 loader 下通过加载

### 5.2 脚手架与导入逻辑

- [ ] 更新项目初始化时复制的 role 模板
- [ ] 更新 `project init/create/sync` 相关资源，使导入后的角色包含 `agent.md`
- [ ] 检查打包产物是否仍会携带旧模板文件

验收标准：

- 新创建项目只生成新格式 role
- 安装态 CLI 导入角色时不会生成旧格式残留文件

## 6. Agent Source 接入任务

### 6.1 上游源管理

- [ ] 在 `agent-sources/<source-id>/` 纳入上游仓库
- [ ] 明确每个 source 采用 `git submodule` 还是等效 Git 固定引用机制
- [ ] 记录 source 类型、跟踪分支、固定 commit、升级流程

验收标准：

- 可以通过标准 Git 命令更新上游内容
- 上游版本可追踪、可审计、可回滚

### 6.2 转换脚本

- [ ] 新增 `og-roles/scripts/sync-agent-sources.mjs`
- [ ] 为首批 source 实现 importer adapter
- [ ] 定义通用上游 agent 到 canonical `roles/<roleId>/` 的命名规则
- [ ] 生成 `role.json`
- [ ] 生成 `agent.md`
- [ ] 生成 `prompt.md`
- [ ] 生成 `output.schema.json`
- [ ] 生成 `source.json`
- [ ] 更新 `sources.lock.json`

建议生成规则：

- `roleId` 增加 source 命名空间，例如 `imported.<source>.*`，避免与本仓角色冲突
- `agent.md` 尽量保留上游正文，不做过度重写
- `prompt.md` 统一包裹 `{{agent}} + latest prompt input shell`
- `output.schema.json` 初版用通用事件集，例如 `DONE | NEEDS_CLARIFICATION | BLOCKED`

验收标准：

- 同一上游输入在重复执行脚本后得到稳定输出
- 删除或重命名上游文件时，生成仓能做出可审计的对应变化
- 生成角色可被 runtime 加载
- 在专用 smoke system 中完成一次最小闭环
- 不暗示它们能直接适配任意现有 Mermaid 系统

## 7. 测试任务

### 7.1 单元与契约测试

- [ ] 更新 `tests/role-resolution.test.mjs`
- [ ] 更新 `tests/model-runtime.test.mjs`
- [ ] 更新 `tests/resume-session.test.mjs`
- [ ] 更新所有读取 `persona.md` / `work.md` 的测试夹具
- [ ] 新增 `agent.md` 缺失时的失败测试
- [ ] 新增 importer 生成角色的最小加载测试
- [ ] 新增字段命名切换测试：`input` / `user_preferences`
- [ ] 新增循环场景测试：`task` 保持原始用户输入不累加，`input` 随上游结果变化
- [ ] 补齐与 `roleInputProjection` 相关的 run-artifact 测试
- [ ] 验证 resume 后 prompt input、fingerprint、artifact 仍保持一致

验收标准：

- role 解析与 prompt 渲染测试全部基于 `agent.md`
- 不再要求 `last_output`、`system_notes`、`round` 出现在默认 prompt 输入壳
- 无测试继续依赖旧格式

### 7.2 CLI / 安装态 / 集成测试

- [ ] 更新 `project init/create/sync` 相关测试
- [ ] 更新打包安装测试，确认产物包含 `agent.md`
- [ ] 增加一次 `source repo -> generated roles -> runtime load` 的端到端 smoke test
- [ ] 为首个 adapter 增加专用 smoke system 最小闭环测试

验收标准：

- 源码态和安装态的 role 目录结构一致
- importer 生成角色至少能在专用 smoke system 中完成一次最小执行闭环

## 8. 文档任务

- [ ] 更新 `README.md` 中 role package 结构说明
- [ ] 更新 `docs/usage-manual.md` 中 role contract、目录树、模板示例
- [ ] 更新 `docs/DECISIONS.md`，记录为何从双文件切到 `agent.md`
- [ ] 在活跃文档中明确 canonical role package 与 importer adapter 的边界
- [ ] 在活跃文档中明确 `agent-sources/` 是开发态 only，不进入安装态产物
- [ ] 将旧的 `persona/work` 描述移出或标记为历史
- [ ] 在活跃文档中明确新的字段命名与顺序，说明其缓存友好性
- [ ] 在活跃文档中明确循环语义：`task` 不累加，`input` 承载轮次变化

验收标准：

- 活跃文档不再把 `persona.md` / `work.md` 当当前格式
- `agency-agents/` 与 `roles/` 的边界在文档里清晰一致

## 9. 建议 PR 切片

1. `runtime: replace persona/work with required agent.md`
2. `roles: migrate built-in role packages to agent.md`
3. `cli: switch scaffolded role templates to agent.md`
4. `runtime: redesign prompt-input shell and fingerprint contract`
5. `test: migrate role fixtures and update resume/artifact coverage`
6. `importers: add canonical agent-source sync pipeline`
7. `docs: rewrite role package contract for agent.md cutover`

## 10. 风险与控制

### 风险 1：上游 markdown 结构变动导致转换脚本脆弱

控制：

- 转换逻辑尽量只依赖稳定文件路径与最少 frontmatter 字段
- 将上游来源信息写入 `source.json` 与 `sources.lock.json`
- 为关键目录结构新增 smoke test

### 风险 1a：runtime 被迫理解多个外部仓库格式

控制：

- runtime 不读取外部 source repo
- 只允许 importer adapter 处理上游差异
- canonical role contract 保持单一且稳定

### 风险 2：运行时、脚手架、测试迁移不同步

控制：

- 先切 runtime loader，再统一迁移内置角色和测试夹具
- 合并前要求全量 role fixture 不再出现旧文件名

### 风险 3：文档仍混用双文件和单文件说法

控制：

- 本轮把活跃文档一起改完，不把格式切换留到后续

## 11. 完成定义

本任务完成时，应同时满足以下条件：

- runtime 只接受 `agent.md` 角色主文本
- 仓内 role package 全部迁移到新格式
- 已存在可扩展的 importer adapter 机制，且首个 source 已接入
- 存在可重复执行的转换脚本把外部 agent source 生成成 canonical OGSystem role package
- 相关测试与安装态验证全部切到新格式
- 活跃文档已完成回写，不再把 `persona.md` / `work.md` 视为当前真相
