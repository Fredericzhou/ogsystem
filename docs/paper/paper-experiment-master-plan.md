# OGSystem V2 论文完整实验方案 (Master Experimental Plan)

> **工作区隔离 / Worktree Isolation:** `/Users/fred/orca/workspaces/ogsystem/paper-experiments-v2`  
> **独立分支 / Branch:** `paper/experiments-v2`（切自 `main` 冻结基线 `0f5d9102` / Tag `paper-eval-v1`）  
> **统一模型 / Unified Model:** `gpt-6-luna`（Codex 后端，对齐 `.ogs/execution-bindings.json`）  
> **核心纪律 / Discipline:** 本方案完全在独立论文 Worktree 中推进，与主仓商业化轨道（`apps/team-site/`、UAT 签收）物理隔离；所有结论严格以第三方客观验收器（`pytest`）实测数据为准，阴性/中性结果与额外开销如实报告。

---

## 1. 核心命题与研究问题（一条主线，不堆砌创新点）

### 唯一核心主张 (Single Core Thesis)
多角色 AI 协作在文件型项目中可能出现**中间草稿静默覆写、分支失败被掩盖、以及虚报完成（False Completion）**。OGSystem V2 通过将**控制面（有界 EFSM + 四值 Join）**与**文件状态面（不可变 Git Commit + Expected-Head CAS + Release 门禁）**绑定为**单一工作区契约（Single-Workspace Contract）**，旨在把跨角色交接与最终交付约束为可验证、可回滚、失败封闭（Fail-Closed）的提交事实；本文仅在冻结任务和故障轨迹上检验这一边界。

*(注：四层产品架构、WAL、LangGraph 适配与组织治理类比定位为系统实现背景与问题动机，不作为独立学术创新点争辩。)*

### 三个递进研究问题 (Research Questions)

| RQ | 核心问题 | 对应实验层级 |
| :--- | :--- | :--- |
| **RQ1 (因果有效性)** | 在统一模型 `gpt-6-luna` 与冻结的多文件协作任务下，Single-Workspace Contract 相比单 Agent（A）、平铺目录多 Agent（B1）与朴素 GitWorktree（B2），如何影响原始功能通过率（`RawPass`）、协议无关的可验证交付（`VerifiedDelivery`）与虚报完成率（`FCR`）？ | **唯一主实验**（`A / B1 / B2 / C`） |
| **RQ2 (机制与代价)** | 在真实并发冲突、陈旧 HEAD 和分支失败场景下，Single-Workspace Contract 是否保持主干失败封闭、提交可追溯，并带来多少可测运行时开销？ | **Git 沙箱压测 + 专项冲突用例** |
| **RQ3 (延期扩展)** | 外部框架对照是否复现主实验趋势？ | **不属于本文核心实验** |

---

## 2. 对比设计：证明什么 vs 不证明什么

### 2.1 三组关键对比的科学目标

1. **`C` vs `B1`（OGS V2 vs 平铺目录多 Agent）**  
   - **证明**：在不把隐藏测试泄漏给系统内部的前提下，观察原始功能通过率（`RawPass`）、虚报完成率（`FCR`）和四项协议无关交付审计维度的差异。
2. **`C` vs `B2`（OGS V2 vs 朴素 GitWorktree）**  
   - **证明**：单独使用 Git Worktree 不能保证可验证交付；加入 Context Map 写范围边界、Merge Worktree 冲突隔离、Expected-Head CAS 和 Release 门禁后，OGS V2 能在冲突时保持主干不变并完成可追溯发布。
3. **`C` vs `A`（OGS V2 vs 单 Agent）**  
   - **报告**：单 Agent 与受治理多 Agent 的交付可靠性差异，以及额外墙钟时间；不在本阶段声称普遍成本优势。

### 2.2 明确的结论红线（不证明什么）
- **不声称** OGS 让 `gpt-6-luna` 模型本身变聪明；声称的是系统级交付可靠性、并发一致性与可审计性。
- **不声称** 在简单单文件任务上多 Agent 比单 Agent 更省钱或更快。
- **不声称** 跨所有模型的普适结论；主实验结论限定于统一模型 `gpt-6-luna`，跨模型复现单列为后续扩展项。

---

## 3. 实验组设置（两层隔离，堵死混杂与稻草人质疑）

### 3.1 第一层：内层受控因果实验（唯一主表）

四组全部固定为：**模型 `gpt-6-luna`（Codex CLI）**、同一批冻结任务、同一角色 Prompt 模板、同一单步超时（`900s`）与同一独立隐藏 `pytest` 验收器。

| Arm | 名称 | 工作区与交接机制 | 合并与发布门禁 |
| :--- | :--- | :--- | :--- |
| **A** | Single-Agent | 单一工作目录，单次完整任务提示 | 无 |
| **B1** | Flat-Dir Multi-Agent | 多角色并发在同一共享目录原地读写（模拟 ChatDev/MetaGPT 共享目录范式） | 无 |
| **B2** | Naive GitWorktree | 多角色各自隔离 `git worktree`，完成后直接向 `main` 执行 `git merge`（复现 STORM 论文中的 `GitWorktree` 基线） | 无 CAS / 无 Release 门禁 |
| **C** | **OGSystem V2** | 真实编译产物 `WorkspaceCoordinator` + `GitCollaboration`：隔离 Role Worktree、不可变 Role Commit、`WorkspaceRef` | Merge Worktree 冲突隔离 + Reconciler + 4 值粘滞 Join + Expected-Head CAS + Release Materialization |

### 3.2 外部框架对照（延期，不属于本论文主实验）

外部框架（包括 STORM、MetaGPT、ChatDev）不进入当前主实验、主表或主结论。只有在内层结果稳定且论文篇幅允许时，才锁定一个版本做附录对照；不可运行不阻塞主线。

> 若后续增加外部对照，再单独附带 Matched/Unmatched Settings 表；当前阶段不为此增加适配工作。

---

## 4. 任务集与验收器（当前主实验 + 延期外部基准）

### 4.1 第三方基准（延期扩展，不进入当前主表）
- **候选来源**：`github.com/commit-0/commit0` / `huggingface.co/datasets/commit0/commit0` (`lite` split)，自带官方 `pytest` 套件。
- 当前投稿轨道优先验证单一 Workspace Contract 的因果机制，因此不把第三方仓库适配、角色切分和依赖环境引入主实验。若后续投稿 venue 要求更强外部有效性，再锁定固定 5 个库接入同一 v3 驱动，作为独立扩展结果。

### 4.2 专项并发与治理压力用例（已落地，补齐公开基准盲区）
位于 `benchmarks/live-pilot/tasks/`，共 5 个多文件任务、27 项独立隐藏 `pytest`（已完成 `--dry-run` 校验）：
1. `task-01-ledger-engine`（7 项隐藏测试）：并行分模块交付（账本引擎 + 报表/CSV 导出）。
2. `task-02-config-merger`（5 项隐藏测试）：**并发同文件冲突与恢复**（两角色同时改 `config_pkg/merger.py`，直击 B1 覆写、B2 污染 `main`、C 隔离并由 Reconciler 从不可变 commit 干净合并）。
3. `task-03-task-scheduler`（6 项隐藏测试）：多模块实现 + 既有回归测试保护（`test_existing.py` 不可回归）。
4. `task-04-review-rework-loop`（5 项隐藏测试）：实现者与独立复核者共同触碰定价规则，观察冲突、返工和边界修复。
5. `task-05-cross-module-contract`（4 项隐藏测试）：模型与服务跨模块共同演进 Product 契约，观察集成回归和失败封闭。

### 4.3 真实 Git 沙箱协议压测（已实测完成，零 LLM 成本）
脚本：`benchmarks/run-protocol-eval.mjs --mode=sandbox`（实际执行临时 Git 仓库 + 编译后的 `WorkspaceCoordinator` + `mergeJoinSourceStatus`）：
- **实测基线数据**：B1 `56.9 ms`（0/4 安全不变量）、B2 `166.5 ms`（1/4 安全不变量）、C `913.4 ms`（**4/4 安全不变量全过**，全套协议开销 `< 1s`）。

### 4.4 跨领域扩展（延期）
OfficeBench 等非源码任务不属于当前论文主实验，暂不接入。

---

## 5. 核心指标与统计方法

| 维度 | 指标 | 精确定义 | 方向 |
| :--- | :--- | :--- | :---: |
| **1. 功能正确性** | **`RawPass`** | 独立隐藏 `pytest` 全部通过的任务比例 | $\uparrow$ |
| **2. 交付可核验性** | **`VerifiedDelivery`** & **`FCR`** | 四项协议无关二元审计维度全部满足：`RoleAttribution`、`CanonicalIntegrity`、`VerifiedArtifactDigest`、`FailClosedOnError`；`FCR = claimedComplete && !hiddenOracle.rawPass` | `VerifiedDelivery` $\uparrow$<br>`FCR` $\downarrow$ |
| **3. 冲突安全与代价** | **`Conflict Fail-Closed`** & **`WallTime`** | 冲突或陈旧 HEAD 下主干保持干净的比例，以及端到端墙钟时间 | `Fail-Closed` $\uparrow$<br>`WallTime` $\downarrow$ |

### 统计与报告规范
- **配对随机化**：按 `(task_id, seed)` 分块随机化 `A / B1 / B2 / C` 执行顺序，每个任务运行 **2 个独立种子**；不因追求更多指标而扩张样本。
- **严格分母**：超时、崩溃、合并冲突未恢复、工具报错均保留在分母中，严禁剔除失败运行。
- **统计检验**：本核心样本有 10 个 `(task, seed)` 配对单元。正文报告逐单元结果、绝对计数和效应方向；不把小样本 p 值或 bootstrap 区间包装成普遍结论。更大样本的置信区间和显著性检验属于后续扩展。

---

## 6. 分阶段执行路线图（全部在 `paper/experiments-v2` Worktree 内推进）

| 阶段 | 目标与交付物 | 执行命令 / 验收门禁 | 状态 |
| :--- | :--- | :--- | :---: |
| **Phase 0** | 冻结基线 `paper-eval-v1` + 建独立 Worktree + 真实 Git 沙箱压测 + Pilot `--dry-run` | `node benchmarks/run-protocol-eval.mjs --mode=sandbox`<br>`node benchmarks/run-live-pilot.mjs --dry-run` | ✅ 已完成 |
| **Phase 1** | **冷启动实跑冒烟**：在 `task-02-config-merger`（并发冲突核心题）上验证 v3 的可见/隐藏测试隔离、快照和诊断字段（临时冒烟产物不留在正式结果目录） | `node benchmarks/run-live-pilot.mjs --task=task-02-config-merger --arm=all --seed=1 --timeoutMs=300000 --out=/tmp/v3-smoke.json` | ✅ 已完成 |
| **Phase 2** | **主实验完成**：在 5 个专项任务上运行 `A / B1 / B2 / C` × 2 seed，并在所有 arm 完成后统一执行隐藏验收 | `node benchmarks/run-live-pilot.mjs --task=all --arm=all --seed=1 --timeoutMs=900000 --out=benchmarks/results/v3-seed1.json` 与 seed 2 同构命令 | ✅ 已完成 |
| **Phase 2a** | **确定性状态机消融**：C-full 与普通命令式基线的六类故障轨迹 | `node benchmarks/run-efsm-ablation.mjs --out=benchmarks/results/efsm-ablation.json` | ✅ 已完成 |
| **Phase 3** | **公开基准扩展**：Commit0-Lite、外部框架和 OfficeBench均延期，不阻塞本文核心结论 | 不纳入当前论文主表 | ⏸️ 已延期 |
| **Phase 4** | **论文回填**：将核心实验汇总、限制和复现指令回填正文与附录 | 正文结论与原始 JSON 证据一致 | ✅ 已完成 |
| **Phase 5** | **归档确权与发表**：Git 冻结 Tag → Zenodo 归档并取得 DOI → 按当前投稿指南向 Elsevier *Science of Computer Programming*（SCICO；目标 OSP 轨道如仍开放）投稿 → arXiv (`cs.SE`) 预印本 | 补齐作者/ORCID、转 `elsarticle` LaTeX、回填 Zenodo DOI，并保存投稿时采用的政策页面快照 | ⏭️ 下一步 |

### Phase 1/2 v3 实跑记录（2026-11-25）

统一配置为 `gpt-6-luna`、Codex `reasoning=low`、每角色超时 `900s`。v3 冷启动和 5 题 × 2 seed 的完整原始证据见 [`benchmarks/results/v3-seed1.json`](../../benchmarks/results/v3-seed1.json) 与 [`benchmarks/results/v3-seed2.json`](../../benchmarks/results/v3-seed2.json)。隐藏测试均在每个 seed 的 20 个 arm 运行结束后统一执行；交付快照位于 `benchmarks/results/artifacts/`。

### 核心实验汇总（2026-11-25）

主实验共 5 个冻结任务 × 2 个 seed × 4 个 arm（40 个配对单元），原始数据为 [`benchmarks/results/v3-seed1.json`](../../benchmarks/results/v3-seed1.json) 和 [`benchmarks/results/v3-seed2.json`](../../benchmarks/results/v3-seed2.json)，汇总由 [`benchmarks/summarize-live-pilot.mjs`](../../benchmarks/summarize-live-pilot.mjs) 生成。A 没有并发冲突路径；其余臂的失败封闭含义按任务的合并/发布路径解释。

| Arm | RawPass | Claimed | FCR | VerifiedDelivery | Role Attribution | Canonical Integrity | Verified Digest | Fail-Closed | 平均墙钟时间 | 平均 LLM 调用 |
| :-- | :--: | :--: | :--: | :--: | :--: | :--: | :--: | :--: | --: | --: |
| A | 10/10 | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 | 10/10 | 10/10 | 112.8s | 1.00 |
| B1 | 10/10 | 10/10 | 0/10 | 0/10 | 0/10 | 0/10 | 10/10 | 10/10 | 184.6s | 2.40 |
| B2 | 5/10 | 10/10 | 5/10 | 3/10 | 10/10 | 10/10 | 3/10 | 3/10 | 183.4s | 2.40 |
| C | 9/10 | 9/10 | 0/10 | 9/10 | 10/10 | 9/10 | 9/10 | 10/10 | 190.3s | 3.00 |

Arm A 和 B1 的 `CanonicalIntegrity = 0/10` 源于其在工作区内直接产生未提交修改；这不表示其隐藏功能测试失败。该指标现在统一要求交付快照为干净、受版本控制保护的 canonical 内容。

该结果支持有限结论：C 在这组任务上保持较高的原始功能通过率（9/10），FCR 为 0/10，并在 9/10 单元满足四项协议无关审计维度；B2 的 FCR 为 5/10，VerifiedDelivery 为 3/10，说明 Worktree 本身不能保证交付事实。A、B1 在隐藏测试上均为 10/10，但缺少角色不可变归因或完整交付审计链。C 有 1 个冲突单元未发布，失败没有被隐藏在成功率中。确定性消融结果见 [`benchmarks/results/efsm-ablation.json`](../../benchmarks/results/efsm-ablation.json)：普通命令式基线在 6 类轨迹均出现目标违规，C-full 为 0/6。数据只支持冻结任务集和统一模型下的系统级结论，不支持跨模型、外部框架或普遍成本优势。

完整重现实验的环境、固定参数和逐条命令见 [`benchmarks/CORE-EXPERIMENT-REPRO.md`](../../benchmarks/CORE-EXPERIMENT-REPRO.md)。

---

## 7. 论文归档与发表计划（Zenodo → Elsevier SCICO → arXiv）

实验与文本审核通过后，按以下三步推进。该路线通常与期刊投稿不冲突，但最终以投稿时的期刊指南、预印本政策、作者协议和各平台条款为准。

| 步骤 | 平台 / 目标 | 核心动作与交付物 | 关键注意事项 |
| :--- | :--- | :--- | :--- |
| **Step 1** | **Git 冻结 + Zenodo 归档** | 提交当前 `paper/experiments-v2` 全部变更并打冻结 Tag（如 `paper-eval-v3`）；将开源核心代码、40 单元 `v3-seed*.json`、40 个交付快照及 `efsm-ablation.json` 打包发布至 Zenodo，发布记录后取得 DOI（格式如 `10.5281/zenodo.xxxxxxx`）。 | DOI 发布记录通常作为永久归档标识，不能按普通文件方式删除，但记录可能被弃用或产生新版本；不要把占位 DOI 写入论文。上传前确认**不含** `apps/team-site/`、专有商业角色、个人数据或密钥，并为代码、数据和论文分别选择明确许可证。`Restricted` 只在确有访问控制需要时使用，因为审稿人需要能够访问复现包。若论文另发 arXiv，Zenodo 可只归档代码与实验包，并在记录中关联论文。参见 [Zenodo DOI 说明](https://help.zenodo.org/docs/deposit/describe-records/reserve-doi/) 和 [Zenodo 记录说明](https://help.zenodo.org/docs/deposit/describe-records/)。 |
| **Step 2** | **Elsevier *Science of Computer Programming*（SCICO）正式投稿** | 补齐 [`ogsystem-submission-paper-en.md`](ogsystem-submission-paper-en.md) 中的作者、单位、[ORCID](https://orcid.org/) 与联系邮箱，将真实 Zenodo DOI 回填至元数据 `C2`；按 [SCICO Guide for Authors](https://www.sciencedirect.com/journal/science-of-computer-programming/publish/guide-for-authors) 和 [Elsevier LaTeX instructions](https://www.elsevier.com/authors/policies-and-guidelines/latex-instructions) 的当前要求转为 `elsarticle` 模板，将 Mermaid 图导出为期刊接受的矢量图并通过 [Editorial Manager](https://www.editorialmanager.com/scico/default.aspx) 投稿。 | “OSP” 轨道、评审模式、订阅/开放获取选项和 APC 以投稿页面当日信息为准，不预先承诺“单盲”或“零版面费”。在 Cover Letter 和投稿系统的预印本问题中如实注明 Zenodo DOI；录用后再按 Zenodo 的 related identifiers 关联正式期刊 DOI。 |
| **Step 3** | **arXiv 预印本** | 按 [arXiv 分类表](https://arxiv.org/category_taxonomy) 选择 `cs.SE`（Software Engineering）作为主分类；只有论文确实覆盖多智能体系统时再申请 `cs.MA` 交叉分类，并上传作者原稿（Author Original / Preprint），关联代码 Zenodo DOI。 | arXiv 的 [endorsement](https://info.arxiv.org/help/endorsement.html) 主要适用于首次投稿或首次进入某分类的账户，不是每次上传都必须重新取得。遵循 [Elsevier sharing policy](https://www.elsevier.com/about/policies-and-standards/sharing)，上传作者原稿，不上传出版社排版终稿；如 Step 1 已归档论文 PDF，在 Zenodo 中补充关联 arXiv ID。 |
