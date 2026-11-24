# OGSystem V2 论文完整实验方案 (Master Experimental Plan)

> **工作区隔离 / Worktree Isolation:** `/Users/fred/orca/workspaces/ogsystem/paper-experiments-v2`  
> **独立分支 / Branch:** `paper/experiments-v2`（切自 `main` 冻结基线 `0f5d9102` / Tag `paper-eval-v1`）  
> **统一模型 / Unified Model:** `gpt-6-luna`（Codex 后端，对齐 `.ogs/execution-bindings.json`）  
> **核心纪律 / Discipline:** 本方案完全在独立论文 Worktree 中推进，与主仓商业化轨道（`apps/team-site/`、UAT 签收）物理隔离；所有结论严格以第三方客观验收器（`pytest`）实测数据为准，阴性/中性结果与额外开销如实报告。

---

## 1. 核心命题与研究问题（一条主线，不堆砌创新点）

### 唯一核心主张 (Single Core Thesis)
多角色 AI 协作在文件型项目中频繁出现**中间草稿静默覆写、分支失败被掩盖、以及虚报完成（False Completion）**。OGSystem V2 通过将**控制面（有界 EFSM + 四值 Join）**与**文件状态面（不可变 Git Commit + Expected-Head CAS + Release 门禁）**绑定为**单一工作区契约（Single-Workspace Contract）**，使跨角色交接与最终交付成为可验证、可回滚、失败封闭（Fail-Closed）的提交事实。

*(注：四层产品架构、WAL、LangGraph 适配与组织治理类比定位为系统实现背景与问题动机，不作为独立学术创新点争辩。)*

### 三个递进研究问题 (Research Questions)

| RQ | 核心问题 | 对应实验层级 |
| :--- | :--- | :--- |
| **RQ1 (因果有效性)** | 在统一模型 `gpt-6-luna` 与第三方公开多文件基准下，Single-Workspace Contract 相比单 Agent（A）、平铺目录多 Agent（B1）与朴素 GitWorktree（B2），如何影响原始功能通过率（`RawPass`）、可验证交付成功率（`VDS`）与虚报完成率（`FCR`）？ | **第一层：内层受控因果实验**（`A / B1 / B2 / C`） |
| **RQ2 (机制归因与协议开销)** | Context Map、`WorkspaceRef` 与 4 值 Join/CAS 各自守护哪条安全不变量？在真实并发冲突、陈旧 HEAD 与分支失败故障下，协议拦截表现及真实运行时开销（ms）如何？ | **真实 Git 沙箱压测 + 单机制消融 + 专项冲突用例** |
| **RQ3 (外部竞品对标与成本效率)** | 与固定版本的真实外部开源框架源码（优先 **STORM**，可选 MetaGPT/ChatDev）在同一模型 `gpt-6-luna` 与同一考卷下对比，OGS V2 的帕累托效率（`Cost_eff`、`Time_eff`）与 5 维可审计性（`ARS`）表现如何？ | **第二层：外层真实源码实跑对照** |

---

## 2. 对比设计：证明什么 vs 不证明什么

### 2.1 三组关键对比的科学目标

1. **`C` vs `B1`（OGS V2 vs 平铺目录多 Agent）**  
   - **证明**：在不损害原始功能通过率（`RawPass`）的前提下，消除并发原地覆写（`DOR → 0`），大幅压低虚报完成率（`FCR`），显著提升可验证交付成功率（`VDS`）。
2. **`C` vs `B2`（OGS V2 vs 朴素 GitWorktree）**  
   - **证明（正面回应 STORM 2026）**：合并失控与成本上升的根源不是 Git Worktree 本身，而是缺少契约治理。加入 Context Map 写范围边界 + Merge Worktree 冲突隔离 + Expected-Head CAS + Release 门禁后，OGS V2 既保住不可变提交审计链，又克服了 B2 的事后合并污染问题。
3. **`C` vs `A`（OGS V2 vs 单 Agent）**  
   - **证明（回应 Sustainable Agents 2026）**：量化多角色协作在复杂多文件仓库上的收益-成本边界（`VDS` 增益 vs `Cost_eff` / `Time_eff` 开销），明确说明协议治理层仅引入极低确定性开销（真实 Git 沙箱已实测 `< 1s`）。

### 2.2 明确的结论红线（不证明什么）
- **不声称** OGS 让 `gpt-6-luna` 模型本身变聪明；声称的是系统级交付可靠性、并发一致性与可审计性。
- **不声称** 在简单单文件任务上多 Agent 比单 Agent 更省钱或更快。
- **不声称** 跨所有模型的普适结论；主实验结论限定于统一模型 `gpt-6-luna`，跨模型复现单列为后续扩展项。

---

## 3. 实验组设置（两层隔离，堵死混杂与稻草人质疑）

### 3.1 第一层：内层受控因果实验（主表，100% 控制变量）

四组全部固定为：**模型 `gpt-6-luna`（Codex CLI）**、同一批冻结任务、同一角色 Prompt 模板、同一单步超时（`300s`）与同一独立隐藏 `pytest` 验收器。

| Arm | 名称 | 工作区与交接机制 | 合并与发布门禁 |
| :--- | :--- | :--- | :--- |
| **A** | Single-Agent | 单一工作目录，单次完整任务提示 | 无 |
| **B1** | Flat-Dir Multi-Agent | 多角色并发在同一共享目录原地读写（模拟 ChatDev/MetaGPT 共享目录范式） | 无 |
| **B2** | Naive GitWorktree | 多角色各自隔离 `git worktree`，完成后直接向 `main` 执行 `git merge`（复现 STORM 论文中的 `GitWorktree` 基线） | 无 CAS / 无 Release 门禁 |
| **C** | **OGSystem V2** | 真实编译产物 `WorkspaceCoordinator` + `GitCollaboration`：隔离 Role Worktree、不可变 Role Commit、`WorkspaceRef` | Merge Worktree 冲突隔离 + Reconciler + 4 值粘滞 Join + Expected-Head CAS + Release Materialization |

### 3.2 第二层：外层真实开源源码对照（单独成表，不混入主因果表）

| 外部竞品 | 官方源码仓库 | 适配策略与公平准则 |
| :--- | :--- | :--- |
| **STORM (2026)** *(第一优先)* | `https://github.com/dreamyang-liu/STORM` | 锁定具体 Git Commit SHA；统一指向 `gpt-6-luna` 模型端点；跑完全相同的 `Commit0-Lite` 冻结子集；**保留 STORM 原生文件版本锁与 Manager 提示词，不魔改源码**；用同一外部 `pytest` 验收器打分。 |
| **MetaGPT / ChatDev** *(按可运行性选做)* | 官方锁定 Commit | 先执行可运行性检查（能否接入 `gpt-6-luna` 并支持既有骨架仓库增量修改）；若因旧 SDK 或仅支持从零生成而无法运行，**如实记录 Commit SHA 与不可运行原因**，不强行魔改或编造数据。 |

> **透明度要求**：论文附录必须附带 **Matched vs. Unmatched Settings 对照表**，逐项披露模型、步数预算、Prompt、工具权限与文件写入方式的对齐与差异。

---

## 4. 基准考卷选型（权威公开主考卷 + 专项压力用例）

### 4.1 主考卷：Commit0-Lite 精选子集（第三方独立公开基准）
- **来源**：`github.com/commit-0/commit0` / `huggingface.co/datasets/commit0/commit0` (`lite` split) — 同时也是 **STORM (2026)** 的第一主基准，自带官方真实 `pytest` 套件，100% 客观零主观打分。
- **筛选标准（先选 5 个 Pilot 库 → 扩至 10 个主实验库）**：
  1. 纯 Python 或本地 `conda/pip` 零障碍可装依赖；
  2. 包含至少 3 个以上可拆分给并行角色的独立/半耦合模块文件；
  3. 原始官方 `pytest` 在骨架仓库上运行迅速（`< 30s`）且初始全失败/低通过，排除零难度或环境损坏的仓库。

### 4.2 专项并发与治理压力用例（已落地，补齐公开基准盲区）
位于 `benchmarks/live-pilot/tasks/`，共 3 个多文件任务、18 项独立隐藏 `pytest`（已完成 `--dry-run` 校验）：
1. `task-01-ledger-engine`（7 项隐藏测试）：并行分模块交付（账本引擎 + 报表/CSV 导出）。
2. `task-02-config-merger`（5 项隐藏测试）：**并发同文件冲突与恢复**（两角色同时改 `config_pkg/merger.py`，直击 B1 覆写、B2 污染 `main`、C 隔离并由 Reconciler 从不可变 commit 干净合并）。
3. `task-03-task-scheduler`（6 项隐藏测试）：多模块实现 + 既有回归测试保护（`test_existing.py` 不可回归）。

### 4.3 真实 Git 沙箱协议压测（已实测完成，零 LLM 成本）
脚本：`benchmarks/run-protocol-eval.mjs --mode=sandbox`（实际执行临时 Git 仓库 + 编译后的 `WorkspaceCoordinator` + `mergeJoinSourceStatus`）：
- **实测基线数据**：B1 `56.9 ms`（0/4 安全不变量，1/5 审计维）、B2 `166.5 ms`（1/4 安全不变量，2/5 审计维）、C `913.4 ms`（**4/4 安全不变量全过，5/5 审计维**，全套协议开销 `< 1s`）。

### 4.4 跨领域广度补充（可选 Case Study，不混入软件主表）
从 **OfficeBench** 抽取 3–5 个跨文件办公协作任务，独立作为“非源码文件协作通用性 Case Study”汇报，不与软件主表合并求平均。

---

## 5. 四组正交核心指标与统计方法

| 维度 | 指标 | 精确定义 | 方向 |
| :--- | :--- | :--- | :---: |
| **1. 功能正确性** | **`RawPass`** & **`Score_w`** | 独立隐藏 `pytest` 全部通过的任务比例（`RawPass`）及总通过测试数/总测试数（`Score_w`，对齐 STORM） | $\uparrow$ |
| **2. 交付可靠性** | **`VDS`** & **`FCR`** | `VDS` = 测试全过 ∧ 无回归 ∧ Commit Provenance 有效 ∧ Release 为 `published`（对齐 Executable-FSM）；`FCR` = 声称完成但未过独立测试 / 声称完成数 | `VDS` $\uparrow$<br>`FCR` $\downarrow$ |
| **3. 并发与审计安全** | **`Conflict Fail-Closed`** / **`DOR`** / **`ARS`** | 并发冲突与陈旧 HEAD 下主干保持干净的比例；中间草稿被原地覆写的比例（`DOR`）；5 维审计还原度（`ARS`，对齐 Auditable Agents 2026） | `Fail-Closed` $\uparrow$<br>`DOR` $\downarrow$<br>`ARS` $\uparrow$ |
| **4. 帕累托效率** | **`Cost_eff`** & **`Time_eff`** | `Cost_eff = 总费用($) / (VDS × 100)`；`Time_eff = 总墙钟分钟 / (VDS × 100)`（对齐 STORM & Sustainable Agents） | $\downarrow$ |

### 统计与报告规范
- **配对随机化**：按 `(task_id, seed)` 分块随机化 `A / B1 / B2 / C` 执行顺序，每个任务至少运行 **2 个独立种子**（主实验建议 3 种子）。
- **严格分母**：超时、崩溃、合并冲突未恢复、工具报错均保留在分母中，严禁剔除失败运行。
- **统计检验**：配对二元指标（`RawPass` / `VDS`）使用 **McNemar 检验**，比率与效率分布报告 **task-clustered bootstrap 95% 置信区间**；次要对比做 Holm 多重检验校正。

---

## 6. 分阶段执行路线图（全部在 `paper/experiments-v2` Worktree 内推进）

| 阶段 | 目标与交付物 | 执行命令 / 验收门禁 | 状态 |
| :--- | :--- | :--- | :---: |
| **Phase 0** | 冻结基线 `paper-eval-v1` + 建独立 Worktree + 真实 Git 沙箱压测 + Pilot `--dry-run` | `node benchmarks/run-protocol-eval.mjs --mode=sandbox`<br>`node benchmarks/run-live-pilot.mjs --dry-run` | ✅ 已完成 |
| **Phase 1** | **冷启动实跑冒烟**：在 `task-02-config-merger`（并发冲突核心题）上跑通 `gpt-6-luna` 的 `A / B1 / B2 / C` 四组对比 | `node benchmarks/run-live-pilot.mjs --task=task-02-config-merger --arm=all --seed=1 --out=benchmarks/results/pilot-task02-s1.json` | ⏭️ 下一步 |
| **Phase 2** | **权威公开基准接入**：安装/拉取 `Commit0-Lite` 5 个轻量库，验证本地 `pytest` 干净运行，扩充 Adapter 跑 `A / B1 / B2 / C` × 2 种子 | 产出主因果对比表（JSON + LaTeX）与每题完整 Run 证据 | ⏳ 待启动 |
| **Phase 3** | **外部源码同台对照**：克隆 `github.com/dreamyang-liu/STORM`（锁定 SHA）接入同一 `gpt-6-luna` 跑同一批 `Commit0-Lite` 5 个库 | 产出外部产品对照表 + Matched/Unmatched Settings 透明表 | ⏳ 待启动 |
| **Phase 4** | **论文回填与 Stage A-v2 审稿包升版**：将实测数据、统计 CI、LaTeX 表格回填论文；补跑 Linux Clean-Room 无缓存验证并升级 Stage A-v2 匿名包 | 论文正文数据 100% 与 Stage A-v2 Artifact 一致 | ⏳ 待启动 |
