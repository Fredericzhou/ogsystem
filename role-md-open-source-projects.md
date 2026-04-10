# 基于 Role Markdown 的开源项目清单

> 统计时间：2026-04-10  
> 说明：这里的“role 数量”按仓库实际结构分别统计，优先使用 `agents/`、`instructions/`、`skills/`、`.agentuse`、`chatmode`、`workflow` 等目录或文件数；如果项目本身不是“角色库”，我会明确标注为“规范”或“框架”。

## 结论先看

如果你的目标是做一个“基于角色 Markdown、还能支持团队协作”的项目，最值得优先参考的顺序是：

1. `github/awesome-copilot`
2. `DevExpGbb/vscode-ghcp-starter-kit`
3. `agentuse/agentuse`
4. `drivly/agentic.md`
5. `agentsmd/agents.md`

前两个最像“现成角色库”，后两个更像“角色文件格式 / 规范底座”，`agentuse` 更适合做 manager + subagent 协作。

## 清单

| 项目 | 地址 | 简介 | role / agent 数量 | 团队协作相关角色 | 适合场景 |
| --- | --- | --- | --- | --- | --- |
| github/awesome-copilot | https://github.com/github/awesome-copilot | 目前最强的可复用角色/指令/技能仓库之一，面向 GitHub Copilot，但结构对任何 role-md 体系都有参考价值。 | `202 agents`、`177 instructions`、`759 skills`、`7 workflows` | 很强，能看到 `api-architect`、`agent-governance-reviewer`、`atlassian-requirements-to-jira`、DevOps、测试、治理等角色/流程 | 直接搭角色库、企业团队协作、按角色拆分 agent 能力 |
| VoltAgent/awesome-agent-skills | https://github.com/VoltAgent/awesome-agent-skills | 高质量技能聚合仓库，README 明确写了 `1000+ agent skills`，收录大量官方团队发布的 skills。 | `1000+ skills`（按 README 描述） | 很强，包含文档协作、内部沟通、PM、工程规范、测试、平台集成等大量团队技能 | 做技能市场、整理 role/skill 目录、补充团队协作技能 |
| garrytan/gstack | https://github.com/garrytan/gstack | Garry Tan 的 Claude Code 工作流仓库。它不是传统 `role-md` 角色库，而是把一套团队职责封装成可执行工具链。仓库描述直接写明使用 `23 opinionated tools` 承担多角色协作。 | `23 tools`、`6` 个核心角色（按仓库描述） | 很强，明确包括 `CEO`、`Designer`、`Eng Manager`、`Release Manager`、`Doc Engineer`、`QA` | 做高管/设计/工程管理/发布/文档/测试串联的团队代理流程 |
| DevExpGbb/vscode-ghcp-starter-kit | https://github.com/DevExpGbb/vscode-ghcp-starter-kit | 小而精的 Copilot starter，目录结构非常适合照抄。 | `2 chatmodes`、`2 prompts`、`1 AGENTS.md` | 中等，明确有 `platform-architect`、`devops-engineer`，再配 PRD/terraform prompt | 从零搭建角色驱动仓库、VS Code/Copilot 场景 |
| agentuse/agentuse | https://github.com/agentuse/agentuse | 支持本地、CI、定时任务的 agent 框架，虽然不是纯 Markdown，但协作结构清晰。 | `10` 个 `.agentuse` 示例/模板，其中 `manager-demo` 明确是 `manager + researcher + reviewer + writer` 四角色协作 | 很强，天然适合 manager/subagent 模式 | 做多角色协作执行、研究/写作/评审流水线 |
| drivly/agentic.md | https://github.com/drivly/agentic.md | 很纯粹的“用 Markdown 定义 agent / workflow”的项目，概念清晰。 | `3` 个 Markdown agent 示例 | 中等，示例偏 `customer-support`、`data-analysis`、`research-assistant` | 自己设计一套 role.md 规范时做底层参考 |
| OpenHands/OpenHands | https://github.com/OpenHands/OpenHands | 偏工程执行型的 coding agent 平台，不是角色库，但已经用 `AGENTS.md`、`SKILL.md`、microagents 管理行为。 | `5` 类 agenthub agents、`3 SKILL.md`、`2 microagents` Markdown 文件、`1 AGENTS.md` | 中等偏强，适合编码执行、技能注入、长期任务协作 | 做工程型团队代理、代码仓协作 agent |
| OpenBMB/ChatDev | https://github.com/OpenBMB/ChatDev | 经典“虚拟软件公司”多智能体协作项目。新版是零代码多 agent 平台，经典 v1 仍然非常适合研究团队角色分工。 | README 里明确出现的经典角色至少有 `CEO`、`CTO`、`Programmer`、`reviewer`、`designer` 这 5 类；按经典论文/演示通常会扩到 `7+` 角色 | 非常强，核心就是团队分工与研讨式协作 | 想做“产品经理/架构师/程序员/测试/设计”式团队编排时必看 |
| agentsmd/agents.md | https://github.com/agentsmd/agents.md | `AGENTS.md` 开放格式规范，目标是给 coding agents 提供统一的仓库级行为说明。 | `1` 份核心规范文件 | 不直接提供角色库，但很适合做总控规范、团队约束、协作守则 | 给自己的 role-md 体系做统一入口规范 |

## 分组建议

### 1. 最像“现成 role-md 角色库”的项目

- `github/awesome-copilot`
- `DevExpGbb/vscode-ghcp-starter-kit`
- `VoltAgent/awesome-agent-skills`

这类项目的优点是可以直接抄目录结构，尤其适合你做：

- `roles/` 或 `agents/` 目录
- `instructions/` 目录
- `skills/` 目录
- 团队协作 workflow

### 2. 最像“团队协作型角色编排”的项目

- `agentuse/agentuse`
- `OpenBMB/ChatDev`
- `OpenHands/OpenHands`

这类项目的优点不是“角色文件多”，而是协作关系更真实，例如：

- manager 拆任务
- researcher 收集资料
- reviewer 做质量把关
- writer / programmer 负责产出
- human-in-the-loop 做人工介入

### 3. 最像“role-md 格式/标准底座”的项目

- `drivly/agentic.md`
- `agentsmd/agents.md`

如果你准备自己设计一个仓库协议，我建议直接参考这两个项目：

- 用 `AGENTS.md` 作为仓库总入口
- 用单个 `*.agent.md` 或 `roles/*.md` 作为角色文件
- 用 `skills/xxx/SKILL.md` 管能力模块

## 我给你的实际建议

如果你是要自己做一个“基于 role 的 md 仓库”，而且包含团队协作角色，我建议最小可行结构直接这样设计：

```text
AGENTS.md
roles/
  product-manager.md
  architect.md
  tech-lead.md
  developer.md
  reviewer.md
  tester.md
  designer.md
workflows/
  feature-delivery.md
  bugfix.md
  code-review.md
skills/
  prd-writer/SKILL.md
  repo-research/SKILL.md
  test-design/SKILL.md
instructions/
  coding-standards.md
  documentation-standards.md
```

其中最值得直接借鉴的映射关系是：

- 角色库结构：参考 `github/awesome-copilot`
- 小型 starter：参考 `DevExpGbb/vscode-ghcp-starter-kit`
- manager/subagent 协作：参考 `agentuse/agentuse`
- 协议层：参考 `agentsmd/agents.md`
- 团队式软件公司角色分工：参考 `OpenBMB/ChatDev`

## 来源

- https://github.com/github/awesome-copilot
- https://github.com/VoltAgent/awesome-agent-skills
- https://github.com/garrytan/gstack
- https://github.com/DevExpGbb/vscode-ghcp-starter-kit
- https://github.com/agentuse/agentuse
- https://github.com/drivly/agentic.md
- https://github.com/OpenHands/OpenHands
- https://github.com/OpenBMB/ChatDev
- https://github.com/agentsmd/agents.md
