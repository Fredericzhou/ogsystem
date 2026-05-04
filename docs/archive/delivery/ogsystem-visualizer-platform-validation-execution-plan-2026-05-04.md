# Visualizer 平台验证执行计划

Date: 2026-05-04  
Status: active execution plan  
Source: `docs/todo-backlog.md`

定位说明：本文不是前一个 Visualizer 优化清单的完成记录，而是从 `docs/todo-backlog.md` 派生出的阶段性执行入口，用于集中推进仍未完成、且与 Visualizer 平台验证最相关的事项。活动总入口仍以 `docs/todo-backlog.md` 为准；本文完成后再作为 delivery 记录归档。

## 1. 目标与边界

目标：围绕 Visualizer 的真实安装、跨平台启动、运行数据可观测性、排障能力和安全展示边界，建立一组可持续回归的验证闭环。

本计划只覆盖对“可视化平台验证”最有直接收益的第一、第二优先级事项；不试图清空 `docs/todo-backlog.md` 的全部非 Visualizer 待办。

硬性约束：

- 不影响内核执行语义：不得改变 compiler、runtime 调度、状态机、resume/review、artifact contract 的既有稳定行为；如必须触碰内核路径，只允许增加只读投影、兼容字段或测试专用适配，且必须补充行为不变回归。
- 不影响现有其他正常稳定可靠的功能：CLI、Visualizer、Studio、doctor、package install、session recovery、Rust pipeline 等既有通过路径必须保持兼容；新增字段和命令参数默认 additive，不删除、不重命名、不改变已有 JSON 字段含义。
- 验证功能优先旁路实现：平台验证能力应优先通过 smoke test、fixture、只读 summary/projection、doctor/check 命令和文档校验落地，避免把验证需求耦合进运行主链路。
- 可回滚边界清晰：每个任务独立提交，影响面集中；若回归失败，应能单独回滚该验证项而不影响其他已稳定功能。

不纳入本轮：

- 500+ iterations 长循环恢复阈值。
- 分布式锁、共享存储多实例调度。
- 语义兼容型 resume。
- `state/checkpoint compact`。
- 全量源码注释治理。

## 2. 执行原则

- 每个任务必须包含：落地实现、测试用例更新、针对性回归、文档更新、独立提交。
- 测试按“短路径优先、长路径少量门禁”设计：单元/契约测试覆盖语义，安装态和跨平台 smoke 只覆盖关键路径，避免每轮回归等待时间失控。
- Visualizer 验证优先使用机器可读数据源，减少从 markdown 或人眼 UI 状态推断。
- 涉及日志、审计、运行产物展示时，默认按可能包含敏感信息处理。
- 先证明不破坏，再证明新增能力有效：每项实现前先识别可能影响的现有功能和回归命令；实现后必须运行对应旧功能回归，再运行新增验证用例。
- 默认保持向后兼容：新增 JSON 字段使用 additive schema；新增 CLI 参数不得改变无参数默认输出；文档漂移检查不得要求用户改变已有正常命令。

## 3. 第一优先级

### P1-1. 安装态 smoke test

- [ ] 在 CI 或可本地复用脚本中增加 `pnpm pack` + 安装态 smoke。
- [ ] 覆盖 npm/pnpm 安装后 `ogs help` 可执行。
- [ ] 覆盖模板项目启动与最小 visualizer 启动路径。
- [ ] 避免复用源码树内 `dist` 假阳性，测试应从打包产物安装态启动。
- [ ] 影响面控制：仅新增测试/CI 脚本或 package 校验，不改变运行时入口行为；如发现 package manifest 需调整，必须补 `ogs help`、模板启动和现有 package install 回归。

验收：

- 本地可通过单条命令复跑。
- CI 可作为发布前门禁或可选门禁接入。
- 测试失败能明确区分打包缺失、bin 入口损坏、模板启动失败。

建议测试分层：

- 快速：检查 tarball 内容、bin 入口、`ogs help`。
- 中速：安装到临时目录后执行模板项目最小启动。
- 慢速：只在 release/packaging job 跑完整安装态 smoke。

### P1-2. Windows PowerShell/CMD 生命周期 smoke

- [ ] 增加 Windows PowerShell smoke，覆盖 `project init`、`run start`、`run list`、`run status`。
- [ ] 增加 Windows CMD smoke，覆盖同一最小生命周期路径。
- [ ] 覆盖路径空格、反斜杠和 shell quoting 的基础场景。
- [ ] 明确哪些命令属于 Windows 专属回归，避免 macOS/Linux 每轮等待。
- [ ] 影响面控制：Windows 专属适配必须挂在平台分支或测试 harness 中，不改变 macOS/Linux 当前 `spawn()` 路径。

验收：

- Windows CI 可运行。
- macOS/Linux 不执行 Windows 专属命令，但保留路径兼容单元测试。
- 失败日志能定位到 shell、路径解析或生命周期命令本身。

建议测试分层：

- 快速：路径解析和命令拼接纯函数/单元测试。
- 中速：PowerShell/CMD smoke 各跑一个最小项目。
- 慢速：完整生命周期只放 Windows matrix 或 nightly。

### P1-3. 安装与操作文档漂移检查

- [ ] 建立 README 与 `docs/usage-manual.md` 命令片段对齐校验。
- [ ] 覆盖安装、启动、project init、run start/list/status、visualizer 入口。
- [ ] 为可变输出使用稳定锚点或 fenced block marker，避免脆弱全文比对。
- [ ] 影响面控制：文档校验只约束文档中的稳定命令片段，不改变 CLI 行为，不把示例输出当成强契约。

验收：

- 文档命令变更时，校验能提示需要同步另一个文档。
- 文档检查不依赖网络。
- 检查失败输出能指出具体 block 或命令。

建议测试分层：

- 快速：解析 markdown 标记块并比对命令集合。
- 中速：抽样执行 `ogs help` / help text anchor。
- 慢速：不在文档漂移检查中执行完整生命周期，避免重复安装态 smoke。

### P1-4. `run status/list` 统一字段

- [ ] 为 `run status` 和 `run list` 增加统一字段：运行时长、停止原因、最后错误码、最后角色。
- [ ] 保持 JSON 输出对工具消费稳定，文本输出可读但不作为唯一契约。
- [ ] 评估 Visualizer 是否直接消费这些字段，必要时同步 DTO/API 映射。
- [ ] 影响面控制：字段只能 additive；不得改变现有 status/list 字段含义、排序默认值或退出码；运行时状态来源必须只读，不得为了展示字段改写内核运行状态。

验收：

- `run status --json` 与 `run list --json` 字段命名一致。
- 缺失信息使用 `null` 或字段缺省的规则明确，不能混用不可预期字符串。
- Visualizer 和 CLI 对相同 run 的状态摘要不矛盾。

建议测试分层：

- 快速：状态投影/DTO 单元测试。
- 中速：CLI JSON 输出 contract test。
- 慢速：端到端 run lifecycle 只复用现有最小路径，不新增长等待。

### P1-5. `run logs --tail/--follow/--since`

- [ ] 为 `run logs` 增加 `--tail`。
- [ ] 为 `run logs` 增加 `--since`。
- [ ] 为 `run logs` 增加 `--follow`，并定义退出/超时策略。
- [ ] 与 Visualizer 日志筛选能力对齐，避免 CLI 和 UI 行为分叉。
- [ ] 影响面控制：无参数 `run logs` 行为保持不变；新增过滤只影响显式传参路径；`--follow` 不得持有内核锁或阻塞运行时写日志路径。

验收：

- `--tail` 不读取或输出超出请求范围的历史日志。
- `--since` 使用明确时间格式和错误提示。
- `--follow` 在测试中必须有 deterministic timeout 或可控写入结束条件。
- Visualizer 日志 API 与 CLI 参数语义一致，至少在文档中明确差异。

建议测试分层：

- 快速：日志筛选纯函数测试。
- 中速：临时 run dir fixture 的 CLI 输出测试。
- 慢速：`--follow` 只用短超时和受控追加，不等待真实长运行。

## 4. 第二优先级

### P2-1. run 级 `summary.json`

- [ ] 增加 run 级机器可读 `summary.json`。
- [ ] 覆盖状态、开始/结束时间、duration、最后角色、停止原因、最后错误码、产物索引摘要。
- [ ] 明确与现有 markdown 审计摘要的关系：机器消费优先读 `summary.json`，markdown 保持人读。
- [ ] 影响面控制：`summary.json` 作为新增派生产物，不替代现有 markdown/审计文件；生成失败不得掩盖或改变原始 run 结果，除非明确属于写入产物失败并已有稳定错误策略。

验收：

- run 完成、失败、停止、等待 review 等状态均能生成稳定 summary。
- Visualizer 可优先使用 summary 或至少验证 summary 与现有投影一致。
- schema 变更有测试保护。

建议测试分层：

- 快速：summary builder 单元测试。
- 中速：fixture run dir 投影测试。
- 慢速：端到端 run 只覆盖一条成功和一条失败/停止路径。

### P2-2. Provider 凭据健康检查

- [ ] 增加 provider 凭据健康检查命令或 doctor 扩展。
- [ ] 覆盖缺失凭据、权限不足、模型引用不可用的稳定错误码。
- [ ] 为 Visualizer 显示层提供清晰的配置不可用提示，避免误判为平台故障。
- [ ] 影响面控制：健康检查默认只读，不触发真实 run，不写入项目状态；在线检查必须可跳过，离线环境不得导致现有 doctor/CLI 基础检查失败。

验收：

- 离线/无凭据环境能稳定跳过或返回可解释结果。
- 不在测试日志中输出 secret。
- 错误码能被 CLI、doctor、Visualizer 共用。

建议测试分层：

- 快速：配置解析和错误码映射测试。
- 中速：mock provider 健康检查。
- 慢速：真实 provider 在线检查只作为手动或受保护 CI。

### P2-3. 运行目录敏感字段脱敏

- [ ] 定义运行目录日志、审计输出和 Visualizer 展示的敏感字段规则。
- [ ] 对常见 secret key、token、authorization header、provider credential 做脱敏。
- [ ] 补充防回归测试，覆盖 CLI 输出、日志投影和 Visualizer 数据投影。
- [ ] 影响面控制：脱敏优先发生在展示/输出投影层，不改写原始运行产物；如确需写入脱敏副本，必须保留审计可追溯性并明确原始文件权限边界。

验收：

- 已知敏感字段不会出现在 CLI stdout/stderr、Visualizer API 响应和页面渲染 HTML 中。
- 脱敏后仍保留足够定位信息，例如保留前后少量字符或使用稳定占位。
- 文档说明脱敏边界和已知不覆盖范围。

建议测试分层：

- 快速：redaction helper 表驱动测试。
- 中速：fixture 日志/API 投影测试。
- 慢速：避免真实 secret 或 provider 调用。

### P2-4. Retention 分层与清理准则

- [ ] 形成开发、预发、生产三档 retention 建议。
- [ ] 明确自动清理和一次性 CLI 清理的启用准则。
- [ ] 与 `executionDirCount` 阈值建议、清理审计字段保持一致。
- [ ] 说明 Visualizer 长驻使用时的目录增长风险和推荐设置。
- [ ] 影响面控制：本项先文档化和 dry-run 验证，不默认开启更激进清理；任何默认阈值变更都必须证明不会破坏 resume、审计和历史回看。

验收：

- 运维文档能回答“何时自动清理、何时手动清理、保留多久、保留多少”。
- 清理建议不影响审计和恢复最低需求。
- Visualizer 文档或 usage manual 中有入口引用。

建议测试分层：

- 快速：文档锚点/命令片段校验。
- 中速：清理 dry-run fixture 测试。
- 慢速：不做真实大规模目录生成，阈值用 fixture 模拟。

## 5. 推荐执行顺序

1. P1-1 安装态 smoke test。
2. P1-2 Windows PowerShell/CMD 生命周期 smoke。
3. P1-3 安装与操作文档漂移检查。
4. P1-4 `run status/list` 统一字段。
5. P1-5 `run logs --tail/--follow/--since`。
6. P2-1 run 级 `summary.json`。
7. P2-2 Provider 凭据健康检查。
8. P2-3 运行目录敏感字段脱敏。
9. P2-4 Retention 分层与清理准则。

## 6. 回归基线

每个提交前至少运行：

- 与改动直接相关的单元/contract 测试。
- 对应 CLI 或 Visualizer 的最小 smoke 测试。
- `pnpm build`。

阶段收口时运行：

- `pnpm run test:visualizer`。
- `node --test tests/package-install.test.mjs tests/session-recovery.test.mjs tests/doctor.test.mjs tests/run-artifact-policy.test.mjs tests/cli.test.mjs tests/cli-lifecycle.test.mjs tests/rust-hello-pipeline.test.mjs`。

Windows 相关项收口时额外运行：

- PowerShell lifecycle smoke。
- CMD lifecycle smoke。

## 7. 完成定义

- 上述 P1/P2 checklist 全部勾选。
- `docs/todo-backlog.md` 对应条目状态同步更新。
- 新增或变更的命令、字段、文档锚点均有测试保护。
- 归档执行记录补充最终回归命令、通过数字、已知边界。
