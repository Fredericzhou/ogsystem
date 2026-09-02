# OGSystem Visual Lifecycle Follow-up Optimization Backlog

Date: 2026-05-01

## Scope

本清单基于当前 `vis-x6` 分支的最新实现状态，继续检查空项目创建、Lifecycle Studio、Build/Validate/Operate、X6-style 图工作区、国际化、测试和文档边界。

本轮检查目标不是重写内核，也不是把当前 X6-style MVP 直接替换为真实 `@antv/x6`。优化应保持以下边界：

- 不修改 parser/compiler/runtime 的语义。
- 不改变 `system.mmd` 作为项目源事实、run artifact 作为历史事实的边界。
- 不让 `@antv/x6` 进入 `src/runtime/*`、`src/visualizer/server.ts`、`src/visualizer/page-shell.ts` 或 inline 控制面。
- 继续让可视化前端通过 browser graph island/bundle 承载图编辑能力。

## Current Verification

当前验证口径对应提交：

```text
c024734 Harden visual project creation flow
```

已通过：

```text
pnpm run test:visualizer
pnpm run test:visualizer-browser
```

结果：

```text
test:visualizer tests 65
test:visualizer pass 65
fail 0
test:visualizer-browser tests 2
test:visualizer-browser pass 2
fail 0
```

本次检查中发现并修复了一个 TypeScript 阻塞问题：

- `src/visualizer/project-projection.ts` 中 `normalizeProfileDrafts()` 的 `record.profile` 类型收敛不稳定，导致 `tsc` 报 `record is possibly undefined`。
- 已改为先将 `record?.profile` 收敛为 `profile`，再构造 entries，业务语义不变。

Browser smoke 状态更新：

- 沙箱内曾出现 Playwright Chromium 启动后以 `SIGTRAP` 退出，测试未进入应用断言阶段。
- 沙箱外复验 `pnpm run test:visualizer-browser` 已通过，当前不能再把 browser smoke 视为未完成阻塞项。
- 该项仍必须作为后续发布 gate，避免真实浏览器交互只被 fake DOM / node 级测试替代。

## Overall Conclusion

当前落地整体方向成立：空目录启动、Project Wizard、受控创建 API、创建后进入 Build、角色 catalog/import、requestId 幂等、最小 snapshot/release manifest、Lifecycle Shell 组织方式已经形成闭环，并且 node 级回归通过。

仍有几类需要继续优化：

- 产品体验上，Project Wizard 仍偏工程表单，缺少更清晰的路径选择、角色筛选、模型/Profile 策略引导。
- 国际化上，主体 chrome 已覆盖，但部分 flash、错误和运行态说明仍有硬编码英文。
- 架构上，`client-app.ts` 仍承载过多业务 UI 和流程编排，需要继续拆薄。
- 验证上，真实浏览器 smoke 已在沙箱外复验通过；后续变更仍必须把 browser smoke 作为发布 gate。
- 文档上，已把完整 package、framework panel、逐项 hash 等标为后续任务，边界合理，但还需要持续同步到最终交付记录。

## Approval And Landing Bar

本 backlog 同意作为下一轮落地依据，但完成标准不是“任务做完”，而是必须同时满足内核边界、产品体验和产品软件工程三类期望。

### Kernel Impact Bar

落地后不应影响内核语义。任何实现都必须继续满足：

- 不修改 parser/compiler/runtime 的行为语义。
- 不改变 `system.mmd` 作为项目源事实、run artifact 作为历史事实的分层。
- Project Wizard 创建项目必须走受控后端 API，复用现有 project lifecycle / init / sync 能力，前端不得直接手写 `.ogs/project.json`、`profiles.json`、`tools.json` 等项目事实文件。
- Build Dry Run / Debug 只能复用现有 runtime/API 行为，不能引入新的运行语义。
- Release/export 先稳定 manifest contract、digest、requiredEnv、artifact scope，不能把最小 manifest UI 文案包装成完整 production package 能力。
- 真实 `@antv/x6` 如后续引入，只能进入 visualizer/studio browser layer，不能进入 `src/runtime/*`、`src/visualizer/server.ts`、`src/visualizer/page-shell.ts` 或 inline 控制面。

### Product Experience Bar

落地后应达到产品级 Studio 体验，而不是工程表单堆叠：

- Project Wizard 主路径应在 1 分钟内可完成，并清楚展示当前 workdir、目标 workdir、目录状态和冲突后的下一步。
- Wizard 首屏只保留创建必需信息；模型/Profile 等策略进入高级配置或创建后 Build Inspector 引导。
- 角色 catalog 必须支持搜索、筛选、已选摘要和失败后可恢复操作，不能长期依赖前 12 个角色或 demo 默认项。
- Build 第一视角必须是可视化图工作区；Source、Diagnostics、Readiness 作为上下文面板辅助图编辑。
- Operate 第一视角必须是 selected run 的健康、失败位置和下一步动作；logs、audit、resume diagnostics、snapshot manifest 作为下钻信息。
- `zh-CN` 模式下主要可控 UI 操作反馈不应出现硬编码英文；runtime 原始 message、roleId、runId、contractId、path、status code 等机器事实保持不翻译。

### Product Engineering Bar

落地必须保持可回归、可维护、可分阶段撤回：

- P0 必须先于 P1/P2 合并：browser smoke gate、flash/error i18n、Project Wizard 路径体验。
- 不把 P0 发布阻塞和 P1 大拆分混在一个大改动里；`client-app.ts` 拆分应按 Project Wizard、flash、Build、Operate 等边界小步迁移。
- 每个可见交互变化必须同步 en/zh-CN 文案和对应测试。
- 带插值的 flash/error 必须继续在 renderer 层 `escapeText()`，不得让 `t()` 承担 HTML escaping。
- Browser smoke 必须作为发布前 gate；fake DOM / node 级 visualizer 测试不能替代真实浏览器交互验证。
- 沙箱内曾出现的 `test:visualizer-browser` / Chromium `SIGTRAP` 应记录为环境启动失败；沙箱外复验已通过，不得继续把 browser smoke 标为当前阻塞项。
- 工作区生成产物和示例项目变更必须在提交前复核，避免 `test-results/` 或调试 fixture 误入交付提交。

## P0: Remaining Release Gates And High-Priority Fixes

### 1. 保持浏览器 smoke gate

问题：

- 沙箱内曾出现 `test:visualizer-browser` 在 Chromium 启动阶段以 `SIGTRAP` 退出，错误不是应用断言失败。
- 沙箱外复验已通过：`pnpm run test:visualizer-browser` 2/2 pass。
- 真实图工作区、创建项目后的 Build 入口、浏览器布局和可交互能力仍必须依赖 Playwright/browser smoke 验证。

建议：

- 将 browser smoke 保持为发布前 gate，不能只依赖 fake DOM 测试。
- 若后续沙箱或 macOS headless shell 再次出现 SIGTRAP，应优先区分 browser environment failure 和 app assertion failure。
- CI 或可启动 Chromium 的本机环境必须能稳定重跑 `pnpm run test:visualizer-browser`。

验收：

- `tests-e2e/visualizer-studio-graph.spec.ts` 两个用例通过。
- 失败时能区分 browser environment failure 和 app assertion failure。
- 当前状态：已完成复验，但继续作为发布 gate 保留。

### 2. 补齐 flash/error 文案国际化

问题：

`src/visualizer/client-app.ts` 中仍有多处硬编码英文 flash，例如：

- `Studio Bridge refresh failed`
- `Studio Bridge cannot save a draft until Mermaid parses successfully`
- `Studio draft saved to ...`
- `Workbench validation failed`
- `A relative save path is required`
- `Run input is required`
- `Project workdir is required`
- `Runs index rebuilt`
- `Visualizer refreshed`
- `Failed to load failure triage/resume readiness/resume diagnostics`
- `Stream refresh failed`

建议：

- 为这些 flash 增加 `flash.*`、`studio.*`、`workbench.*`、`operate.*` key。
- 保持 runtime message、roleId、runId、contractId、file path、status code 不翻译，只翻 UI chrome 和可控说明。
- 对插值继续在 renderer 层 `escapeText()`，不要让 `t()` 负责 HTML escape。

验收：

- `zh-CN` 下主要操作反馈不再出现可控英文句子。
- 测试覆盖至少一个带插值的错误 flash，确认不会注入 HTML。

### 3. 明确 Project Wizard 的路径选择体验

问题：

- 当前 conflict strategy 中的 “Choose another directory” 更像策略文案，并不是完整目录选择体验。
- 已支持 `workdir` 字段和 target workdir alias，服务端也已修正空 workdir 使用当前目录，避免误写入进程 cwd。
- UI 仍需要让用户在冲突目录下明确理解当前项目会创建到哪里，以及下一步是加载已有、初始化当前还是改用其他目录。

建议：

- 在 Wizard 中显式展示当前 workdir、目标 workdir、是否为空目录、是否已有项目。
- 对 “选择其他目录” 提供明确 workdir 输入区域或跳转到加载/切换项目流程。
- 避免用户以为选择了 strategy 就会自动打开系统目录选择器。

验收：

- 冲突目录下，用户能从同一屏理解三个路径：加载已有项目、初始化当前目录、改用其他目录。
- 错误提示和下一步动作一一对应。

## P1: Product And UX Optimization

### 4. 精简 Project Wizard 表单心智

问题：

- 当前 Wizard 同时承载项目命名、模板、路径、角色导入、默认模型、Profile 策略。
- 对新用户而言信息密度偏高，且模型/Profile 策略容易和 Build Inspector 能力重复。

建议：

- Phase 1 保留必要字段：项目名称、项目 ID、模板、目标目录、角色导入。
- 默认模型/Profile 放入 “高级配置” 折叠区，默认不打断创建主流程。
- 创建成功后在 Build Inspector 中继续引导补齐模型/Profile，而不是要求首屏一次填完。

验收：

- 空项目创建主路径可以在 1 分钟内完成。
- 高级配置为空时仍生成可解析、不可发布的草稿状态。

### 5. 角色 catalog 选择器增强

问题：

- 当前只展示前 12 个角色并提示剩余数量。
- 已修复不再默认勾选 demo role；规模扩大后仍缺少分类、健康状态过滤、已选摘要和更强的导入结果组织。

建议：

- 增加搜索、分类、健康状态过滤、已选摘要。
- 可以按模板推荐角色或让用户显式选择，但不要回到隐式默认勾选 demo role。
- 对跳过、已存在、导入失败提供更清晰的结果摘要。

验收：

- 角色超过 12 个时仍能快速定位和选择。
- 导入失败后 warning flash 可直接触发 retry，并保留上下文。

### 6. Build 图工作区继续从 tab 思维收敛到工作台思维

问题：

- 当前 Lifecycle Shell 已优于旧 tab，但 Build 内仍有 Bridge、Source、Inspector、Diagnostics 等多块能力并存。
- 用户核心目标是“可视化编排为中心”，源码和诊断应辅助图编辑，而不是并列抢占注意力。

建议：

- Build 主区固定为图工作区。
- Source、Diagnostics、Readiness 作为右侧/底部面板，并与选中节点/边联动。
- Dry Run/Debug 作为 Build mode，而不是独立一级入口。

验收：

- 用户进入 Build 后第一视角是系统图。
- 选中 role/edge/project 后 Inspector 内容随上下文变化。
- Dry Run 结果能投影到同一张图。

### 7. Operate 信息密度继续分层

问题：

- Operate 已统一 run list、只读图、logs、failure、resume、audit，但摘要、指标、失败、审计仍容易挤在同一层。

建议：

- 一级只展示 run list + 只读 runtime graph + 当前 run 关键状态。
- failures/resume readiness/audit/logs 作为下钻面板或底部 tabs。
- 对 “n/a、missing、snapshot、non-blocking、runtime summary” 等术语提供统一 display token。

验收：

- 非技术用户能先看到运行是否健康、哪里失败、下一步做什么。
- 技术用户仍能下钻到日志、审计、snapshot manifest。

## P1: Architecture Optimization

### 8. 继续拆薄 `client-app.ts`

问题：

- `client-app.ts` 仍同时负责路由、状态、API 调用、HTML 拼接、Wizard 流程、Operate 流程、flash 和 i18n。
- 后续继续加 Build Studio、Debug mode、Operate Workbench 会放大维护成本。

建议：

- 按领域拆分：
  - `client/project-wizard.ts`
  - `client/build-workbench.ts`
  - `client/operate-workbench.ts`
  - `client/flash.ts`
  - `client/lifecycle-router.ts`
- 保持当前 buildClientAppScript/function.toString 注入边界，renderer 依赖通过参数传入。
- 新 TS 模块注意 NodeNext 相对 import 后缀，或纳入现有 visualizer client bundle 构建。

验收：

- `client-app.ts` 更接近 shell/controller，不继续堆业务 HTML。
- 新增 UI 能力有对应模块和单测入口。

### 9. 统一 Project Create 错误映射

问题：

- Project create 错误码到用户文案的映射仍在流程函数里以嵌套三元表达式存在。

建议：

- 抽出 `projectCreateErrorMessage(code, error)`。
- 覆盖 `PROJECT_ALREADY_EXISTS`、`PROJECT_DIR_CONFLICT`、`PROJECT_FILE_CONFLICT`、`INVALID_PROJECT_ID`、`INVALID_PROJECT_NAME`、`INVALID_PROJECT_TEMPLATE`、`INVALID_PROJECT_WORKDIR`、`INVALID_PROJECT_CREATE_REQUEST_ID`。

验收：

- 新增错误码不需要修改主流程。
- 单测可以直接覆盖映射函数。

### 10. release/export contract 分层

问题：

- 当前 `single-project-v1` 最小 manifest contract 合理，但完整独立运行包还未落地。
- 文档已经标注后续任务，不能在产品文案中暗示已具备完整 package 能力。

建议：

- UI 文案继续使用 “export candidate / manifest contract”，不要写成 “production package ready”。
- 后续先稳定 manifest schema、digest、requiredEnv、artifact scope，再做完整目录结构。

验收：

- Validate & Release 对外承诺和实际产物一致。
- manifest schema 有独立测试。

## P2: Documentation And Cleanup

### 11. 同步最终交付记录

建议：

- 在最终交付记录中明确区分：
  - 已引入/已完成：Lifecycle Shell、空项目创建、Project Wizard、role catalog/import、requestId 幂等、最小 snapshot/release manifest、i18n 主体 chrome。
  - 未完成/后续：真实 `@antv/x6` 替换、独立 framework panel、完整 package 目录、逐项 artifact hash、Debug snapshot 投影、Operate snapshot 汇总。

### 12. 清理生成产物

当前工作区存在：

```text
test-results/
```

这是 Playwright 失败时生成的产物目录。建议在确认不需要保留 error context 后清理，避免误提交。

### 13. 示例项目变更复核

当前工作区仍有：

```text
examples/legal-rag-dev-team/system.mmd
```

建议确认该示例变更是否属于本轮任务。如果只是调试残留，应避免混入可视化交付提交；如果是 intentional fixture 更新，需要在提交说明中明确用途。

## Recommended Next Execution Order

1. 保持 `pnpm run test:visualizer-browser` 作为发布 gate，并在后续变更中持续复跑。
2. 补齐 hardcoded flash i18n，并加插值安全测试。
3. 抽出 Project Create 错误映射，先做低风险收敛。
4. 继续优化 Project Wizard 冲突目录下的加载已有、初始化当前、改用其他目录体验。
5. 精简 Project Wizard 首屏，把模型/Profile 放入高级区。
6. 增强角色 catalog 搜索、分类、健康状态过滤、已选摘要和导入结果组织。
7. 再按边界拆分 `client-app.ts` 中 Project Wizard、flash、Build、Operate 模块。
8. 将完整 package、framework panel、Debug snapshot 投影继续保留为后续明确 milestone。

## Non-goals

以下不建议在本轮继续扩大范围：

- 不重写 runtime/parser/compiler。
- 不把 Debug、Audit 重新提升为一级入口。
- 不先做漂亮 Release 页面再补 artifact contract。
- 不让真实 `@antv/x6` 穿透到服务端或 runtime。
- 不把运行态 message 强行翻译，除非 DTO 已提供稳定 `messageKey + vars`。
