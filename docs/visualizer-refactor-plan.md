# Visualizer 收敛与 UX 重构结项摘要

> 状态：completed
> 完成时间：2026-05-13
> 详细 phase 执行记录已归档到 `docs/archive/delivery/visualizer-refactor-plan-2026-05-13.md`

## 1. Outcome

本轮 Visualizer 收敛与 UX 重构已经完成，`src/visualizer/` 当前主路径已收敛到以下结果：

- 编辑态与运行态统一到 `GraphViewModel + StudioGraphIsland`
- Studio Bridge 收敛到稳定的 `outline / canvas / right inspector` 壳；右侧 inspector 仍支持折叠和调试/结果切换
- `Build / Operate / Validate & Release` 收敛为 `Design / Run / Release`
- chat-to-MMD 改为 semantic-first patch；`replace-authoring` 仅保留为 fallback
- legacy console tabs、`preserveGraphRoot`、`patchStudioBridgePanel` 已从主路径删除；legacy lifecycle 仅保留 query 入参兼容别名

## 2. Locked Decisions

- 保留 `SystemDefinition` / `StudioAuthoringDocument` / `StudioCanvasDocument` 三层真理边界
- 收敛渲染投影层，不改运行内核与 authoring 真理层语义
- Undo/redo 采用语义 command reducer + inverse command，snapshot 仅作 fallback
- Build 与 Run 共用同一张 X6 canvas，通过 mode 控制交互能力
- 不引入 Preact / Solid 等新响应式框架
- `build` / `project` / `operate` / `legacy` / `validate-release` 仅保留为 query 入参兼容别名

## 3. Delivered

- `GraphViewModel` 已成为编辑态与运行态共享视图模型
- Run graph 已切到服务端 draft authority + 当前 dry-run overlay
- 单击选中 / 双击或 `F2` 编辑已替代旧的“选中即编辑”
- 诊断徽章、hover card、minimap、quick open、focus motion 已落地
- 右侧 inspector 保留折叠与 tab 切换能力，不再使用旧的 remount-preservation 补丁路径
- 导航与顶部 CTA 已按 `Design / Run / Release` 情境收敛

## 4. Verification

本轮收口以如下验证为准：

1. `pnpm build`
2. `node --test tests/visualizer-client.test.mjs`
3. `node --test tests/visualizer-client-state.test.mjs tests/visualizer-page-shell.test.mjs tests/visualizer-studio-authoring.test.mjs tests/visualizer-studio-import-guardrails.test.mjs tests/visualizer.test.mjs tests/visualizer-data.test.mjs tests/visualizer-graph-view-model.test.mjs`
4. `pnpm exec playwright test tests-e2e/visualizer-studio-graph.spec.ts --grep "Studio graph island exposes minimap, focus pulse, and quick open when mounted directly"`
5. 手动冒烟：Build 编辑、chat patch、dry-run、Run Graph 布局 authority、legacy deep-link normalization

## 5. Archive Note

- 执行期的 phase 分解、风险说明、逐项改动与文件索引不再保留在主路径文档中。
- 如需追溯实现过程、阶段顺序或当时的决策上下文，请查看：
  - `docs/archive/delivery/visualizer-refactor-plan-2026-05-13.md`
  - 相关提交历史与测试记录
