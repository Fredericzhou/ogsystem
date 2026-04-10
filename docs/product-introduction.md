# OGSystem 产品自我介绍

## 1. 背景

OGSystem 是一个面向多角色协作流程的控制台运行时，使用受限 Mermaid `flowchart` 作为系统编排 DSL。  
项目目标不是做“全功能平台”，而是提供一个可执行、可审计、可恢复的最小核心，用于快速验证角色编排、模型绑定与运行治理策略。

当前版本已经收敛为单一运行时路径：

- 一个图执行模型（graph runtime）
- 一套持久化状态模型（`state.json.graphState` + `sessions.json`）
- 一套统一节点执行契约（role package + schema validation + executor abstraction）

## 2. 原理

OGSystem 将职责拆分为四层：

- `system.mmd`：定义角色图、流转事件、law 绑定、执行绑定
- `role package`：定义角色语义与 I/O 契约（`prompt.md`、`output.schema.json`）
- `model package`：定义执行器与模型参数（如 OpenCode model/args/timeout）
- runtime：执行图调度、调用 executor、持久化运行证据

核心运行原则：

- Mermaid 图语义先编译成后端中立的 `ExecutionPlan`
- graph runner 只负责图调度和状态编排
- role executor 只负责节点执行、修复策略、审计落盘
- `exec.bind` 是兼容模式，不再代表第二套引擎

## 3. 架构

关键模块如下：

- `src/runtime/adapter.ts`：组合根，装配运行上下文与依赖
- `src/runtime/parse-mermaid.ts` + `src/runtime/execution-plan.ts`：DSL 解析与语义归一化
- `src/runtime/graph-runner.ts`：统一图运行与状态推进
- `src/runtime/role-executor.ts`：节点执行、输出修复、schema 校验
- `src/runtime/executor.ts` + `src/runtime/opencode-executor.ts`：执行器抽象与默认实现
- `src/runtime/run-artifacts.ts` + `src/runtime/run-artifact-policy.ts`：产物写入与契约策略
- `src/runtime/doctor.ts`：运行前健康检查与 run-dir 恢复检查

运行数据默认落盘到 `ogsystem-history/<run-id>/`，其中：

- run-id 命名格式：`yyyy-MM-dd_HH24-mm-ss_xxxx`（`xxxx` 为系统ID派生的4位代码）
- 运行恢复依赖：`state.json.graphState`、`sessions.json`
- 审计与操作视图：`events.ndjson`、`audit/*.md`、`roles/<roleId>/...`

## 4. 安装

```bash
npm install
npm run build
```

建议环境准备：

- Node.js 20+
- 已安装并可执行 `opencode`（如需真实模型执行）

## 5. 使用手册入口

快速入口：

- 使用手册：`docs/usage-manual.md`
- 架构决策：`docs/DECISIONS.md`
- 单运行时执行清单：`docs/single-graph-runtime-execution-checklist.md`

最小 dry-run 示例：

```bash
npm run run:adapter -- \
  --system examples/target-model-binding-system.mmd \
  --prompt "讨论当前架构是否继续最小化" \
  --dry-run
```
