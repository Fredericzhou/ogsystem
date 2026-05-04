# Legal RAG Dev Team

这个示例展示如何用 OGSystem 把“法律 RAG 问答服务”的软件开发过程编排成一支可运行的多角色团队。

它是当前推荐的“中文多 Agent 协作端到端”示例，覆盖：

- 中文输入与中文交付
- `model.bind` 模型执行绑定
- `parallel_split` 并行拆解
- `all_of` 汇合
- `context.map` 把分支结果和人工审核反馈投影给汇合角色
- `review.*` runtime-native human review
- `rework` 反馈重新注入 `delivery-lead`

目标不是直接替代你的 RAG 服务，而是先让团队在同一条执行链上完成：

- 需求澄清
- 架构拆解
- 法律知识库与信源治理设计
- 检索方案设计
- 回答与引证方案设计
- 评测与验收设计
- 最终实施计划汇总
- 人工审核与 rework

## 团队角色

- `legal-product-manager`
  负责需求澄清、适用法域、用户画像、风险边界、MVP 范围。
- `solution-architect`
  负责把项目拆成并行工作流，并定义接口与交付顺序。
- `legal-knowledge-engineer`
  负责法律语料、版本治理、法条颗粒度、元数据与可追溯 source id。
- `retrieval-engineer`
  负责切分、索引、混合检索、重排、召回监控。
- `answer-engineer`
  负责问答链路、拒答策略、答案结构和 grounded generation。
- `citation-engineer`
  负责“答案中的每个结论如何绑定信源”，包括引文粒度和展示格式。
- `evaluation-engineer`
  负责测试集、引用正确率、幻觉率、时延/成本与回归评测。
- `delivery-lead`
  汇总全部方案，形成可执行实施计划、里程碑和 staffing 建议。

## 为什么这个团队适合法律 RAG

法律问答与普通 RAG 的关键差异不在“能检索”，而在“能否证明答案为什么成立”。这个示例把信源治理单独拆成角色，是为了避免把“引用展示”误当成一个前端格式问题。

你最终至少应该要求系统输出这些信息：

- 结论本身
- 结论适用范围与不确定性
- 每条关键结论对应的信源
- 信源的规范标识
- 法条/判例/解释的版本或生效状态
- 当证据不足时的拒答或降级说明

## 直接运行

源码仓先构建：

```bash
pnpm run build
```

仓库根目录下先做 dry-run：

```bash
node dist/runtime/cli.js run start \
  --system system.mmd \
  --workdir examples/legal-rag-dev-team \
  --input "开发一个面向企业法务的法律RAG问答服务，要求支持法条、司法解释、指导案例检索，并在回答中给出可核验信源" \
  --dry-run
```

如果你已经把 `ogs` 链接到当前仓库，也可以在示例目录内直接运行：

```bash
ogs project sync-models
ogs doctor
ogs run start \
  --system system.mmd \
  --input "开发一个面向企业法务的法律RAG问答服务，要求支持法条、司法解释、指导案例检索，并在回答中给出可核验信源"
```

真实运行：

```bash
node dist/runtime/cli.js run start \
  --system system.mmd \
  --workdir examples/legal-rag-dev-team \
  --input "开发一个面向企业法务的法律RAG问答服务，要求支持法条、司法解释、指导案例检索，并在回答中给出可核验信源"
```

说明：

- 该示例使用本机已验证较稳定的 `model.bind.*=gkgk/gpt-5.4`
- 真实运行前，需要你本机已经配置可用的 OpenCode provider
- 如果 `ogs doctor` 提示缺少 `.ogs/model-catalog.json`，先执行 `ogs project sync-models`；catalog 是本机可用模型快照，缺失时是诊断告警，不是 runtime 硬失败
- 如果你改回 `opencode/gpt-5-nano`，注意该模型在本机 OpenCode SDK structured-output 场景中可能长时间等待后返回 `terminated`
- 长时间执行时，控制台会区分 `role:waiting kind=technical` 和 `run:waiting kind=business reason=human_review`
- `delivery-lead` 角色开启了 runtime-native human review，第一轮运行大概率会停在待审核状态
- `rework` 时，reviewer comment 会通过 `global.human_review.current.*?` 投影回 `delivery-lead`

## 审核与继续执行

```bash
node dist/runtime/cli.js run list --workdir examples/legal-rag-dev-team
node dist/runtime/cli.js run status <run-id> --workdir examples/legal-rag-dev-team
node dist/runtime/cli.js run review list <run-id> --workdir examples/legal-rag-dev-team
node dist/runtime/cli.js run review inspect <run-id> <review-id> --workdir examples/legal-rag-dev-team
node dist/runtime/cli.js run review decide <run-id> <review-id> --decision approve --comment "方案可执行" --actor reviewer --workdir examples/legal-rag-dev-team
node dist/runtime/cli.js run resume <run-id> --workdir examples/legal-rag-dev-team
```

如果你希望补充需求后再收敛，可以把审核决策改为 `rework`，runtime 会把 reviewer comment 重新注入 `delivery-lead`。

## 这个示例产出的实施计划，应该覆盖什么

- 数据面
  法律文本导入、清洗、切分、版本治理、法条定位、source id 设计
- 检索面
  keyword + vector + rerank 的混合检索链路
- 生成面
  只基于证据回答、无证据拒答、按 claim 输出 citation
- 服务面
  API 结构、会话上下文、缓存、审计日志、权限控制
- 评测面
  法律问题集、标准答案、标准引证、线上回归和离线评测

## 如何从“规划团队”走到“真正开发”

建议分两段走：

1. 先用这个示例把实施方案跑出来，并人工审核。
2. 再把其中一部分角色替换成真正执行代码的 `exec.bind` 角色。

推荐的第二阶段拆分：

- `corpus-builder`
  拉取法规/案例数据，构建标准化文档与 metadata。
- `index-builder`
  创建分块、embedding、BM25 索引和 rerank 数据。
- `qa-service-developer`
  实现 `/ask`、`/sources`、`/health` 等接口。
- `eval-runner`
  执行引用准确率与拒答正确率测试。
- `release-review`
  对输出样例进行人工法务抽检。

如果你要把这个示例继续推进成“能真正写代码”的团队，最直接的做法是参考 `examples/rust-hello-pipeline/` 和 `examples/ogs-gstacklike/`，把部分 `model.bind` 角色切换成 `exec.bind`，让角色直接调用本地脚本或构建命令。
