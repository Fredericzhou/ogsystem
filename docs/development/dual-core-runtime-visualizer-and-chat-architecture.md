# 运行视图与群聊面板「双核孪生」整体结构性重构计划

## 1. 目标描述 (Goal Description)

响应用户对于产品生命周期显示体系的终极顶层定调：
> **「默认情况下: 在设计阶段突出结构, 在调试阶段突出内容, 在运行时两者并重。」**
> **「宏微双核同屏同意, 并且支持灵活的分别最大化; 对于微观的内容, 支持下钻到具体审计数据中, 方便排查问题. 需要整体设计.」**

本方案将系统的宏微两大核心显示与全生命周期设计原则融为一体：

```mermaid
flowchart TD
    subgraph Lifecycle [团队工程全生命周期显示范式]
        direction LR
        P1["1. 设计阶段 (Design Phase)\n✦ 默认突出结构 (Structure-first)\n画布占主体 (100%)，聚焦拓扑与角色编排"]
        P2["2. 调试阶段 (Debug / Replay Phase)\n✦ 默认突出内容 (Content-first 40:60)\n群聊占优势，聚焦对话内容、交付输出与审计排障"]
        P3["3. 运行时阶段 (Runtime Phase)\n✦ 默认两者并重 (Balanced 50:50)\n左拓扑流向 + 右对话流水同频共振"]
    end

    subgraph DualCore [双核孪生工作台 Dual-Core Twin Workspace]
        direction LR
        subgraph Macro [宏观运行图谱 (Macro Graph)]
            M1["架构拓扑 · 静态稳态连线"]
            M2["实时雷达/沙漏/审核动态状态"]
            M3["最新指标胶囊 & 历史展开"]
            M4["一键最大化 ⛶ / 还原"]
        end

        subgraph Interlock [双向交互中枢]
            I1["图谱节点 ➔ 群聊平滑滚动高亮"]
            I2["群聊头像/@交接 ➔ 图谱平滑居中聚焦"]
        end

        subgraph Micro [微观群聊面板 (Micro Chat)]
            C1["用户任务初始指令气泡 (Prompt)"]
            C2["角色对话卡片 (头像·后端徽章·状态)"]
            C3["@下游角色 接力呼叫卡片"]
            C4["一键最大化 ⛶ / 还原"]
            C5["🔍 审计下钻工作站 (Audit Drilldown)"]
        end

        Macro <--> Interlock <--> Micro
    end

    subgraph AuditDrawer [微观审计下钻抽屉 Audit Drilldown Drawer]
        direction TB
        A1["模型调用与 Token 计量审计 (Prompt Calls / Telemetry)"]
        A2["数据隔离状态 (External Data Isolated)"]
        A3["全量入参快照 (Input Context JSON 结构树)"]
        A4["失败诊断信封 (Error Envelope & Diagnostics)"]
        A5["一键复制原始审计 JSON & 快速聚焦图谱"]
    end

    Lifecycle --> DualCore
    C5 -.->|"点击下钻"| AuditDrawer
```

---

## 2. 核心架构与交互设计 (Architectural & Interaction Design)

### 2.1 全生命周期的「默认偏好」策略 (Lifecycle Default Policy)

| 阶段 (Phase) | 页面场景 (Scene) | 默认布局偏好 (`data-layout-preference`) | 用户心智与交互重心 |
| :--- | :--- | :--- | :--- |
| **设计阶段 (Design)** | `/studio/teams/:id/design` | **突出结构 (`structure-focus` 100:0)** | 专注于团队拓扑编排、角色连线与契约设定；资产抽屉按需展开。 |
| **调试阶段 (Debug Replay)** | `/studio/teams/:id/run/:simId` (已完成/已停止/失败) | **突出内容 (`content-focus` 40:60)** | 专注于对话内容、模型输出结果、异常定位与审计下钻排障；图谱作为对照。 |
| **运行时 (Live Runtime)** | `simulateTeam` 运行中 / `/run/:simId` (running 状态) | **两者并重 (`balanced` 50:50)** | 左侧宏观雷达/沙漏动态与 HUD 跳动，右侧微观打字机式实时吐出卡片，宏微同频共振。 |

> [!TIP]
> 顶部工具区提供轻量**分屏偏好切换器**：`[ ⇄ 两者并重 (50:50) | 📖 突出内容 (40:60) | 📐 突出结构 (60:40) ]`，用户可随时一键切换，系统在不同生命周期提供最聪明的默认值。

---

### 2.2 灵活的分别最大化机制 (Flexible Independent Maximization)

- **宏观图谱最大化**：点击左侧面板右上角 `⛶ 最大化`，容器切换为 `data-maximize-mode="macro"`，图谱占据 100% 空间，图谱引擎自动调用 `fit()` 适配全屏拓扑；按钮变为 `🗗 还原`；
- **微观群聊最大化**：点击右侧面板右上角 `⛶ 最大化`，容器切换为 `data-maximize-mode="micro"`，群聊占据 100% 空间，便于通读长篇对话与交付物；按钮变为 `🗗 还原`；
- **还原**：随时点击 `🗗 还原`，无损平滑恢复当前阶段的默认分屏偏好。

---

### 2.3 微观内容「🔍 审计下钻」工作站 (Deep Audit Drill-down)

在微观群聊的每张角色卡片中注入「🔍 审计下钻」按钮，唤起专业级滑出式审计抽屉（`.studio-audit-drilldown-drawer`），包含五维排障专区：
1. **模型与调用流审计 (Model & Prompt Calls)**：
   - 主模型 (`primaryModelId`) 与备选模型 (`fallbackModelId`)，标注是否触发降级；
   - 每个 Prompt Call 的字符数、估算 Token (输入/输出) 与执行阶段；
   - 外部数据分隔隔离状态（`externalDataIsolated`）。
2. **输入上下文全量结构 (Input Context Snapshot)**：
   - 结构化 JSON 树展开，展示角色执行时收到的完整上下文与环境变量；
   - 来源分支与迭代追踪（`branchId`, `loopIteration`, `attempt`）。
3. **输出与交付日志 (Output & Stdout)**：
   - 原始输出或结构化数据，支持快速复制。
4. **失败诊断信封 (Error Diagnostic Envelope)**（仅在失败激活项展示）：
   - 完整展示 `errorCode`, `errorCategory`, `stage`, `retryable`, `rawMessage`。
5. **原始审计证据 (Raw JSON)**：
   - 一键复制完整原始审计快照 JSON，方便研发直接复现或贴入工单。
   - 抽屉底部提供「在图谱中定位」快捷按钮，一键高亮并平滑居中聚焦对应节点。

---

### 2.4 宏微双向闭环联动与只读稳态 (Bidirectional Interlock & Steady State)

- **宏观 ➔ 微观**：
  - 点击图谱节点：群聊列表平滑滚动并高亮对应角色卡片（闪烁 `is-runtime-focus-entry` 呼吸边框）；
  - 点击流转连线：群聊列表平滑滚动并高亮对应流转事件。
- **微观 ➔ 宏观**：
  - 点击群聊气泡中的角色名称或头像：左侧图谱自动平滑缩放居中聚焦该节点；
  - 点击 `@下游角色` 交接呼叫块：图谱自动聚焦对应下游角色节点。
- **彻底根治只读循环移动粒子**：
  - `syncRuntimeDataPackets` 在 `readOnly` 或 `mode === "run-diagnosis"` 下彻底卸载并不再创建 `<animateMotion>` 粒子节点；
  - `deriveStudioRuntimeVisualState` 在只读态强制将流转边与节点状态置为终态完成，`edgeState.active = false`；
  - CSS 级双保险保障只读态连线无流动粒子与虚线流光，还原沉稳、高质感的交付视图。

---

## 3. 拟变更组件与代码实现 (Proposed Changes)

### Component 1: 运行时图谱引擎稳态化 (`src/visualizer/studio-client/`)

#### [MODIFY] [`studio-graph-runtime.ts`](file:///Users/fred/WorkSpace/AI/ogsystem/src/visualizer/studio-client/studio-graph-runtime.ts)
- 在 `deriveStudioRuntimeVisualState` 中消费 `args.readOnly`；
- 终态同步修正：当 `runStatus !== "running" || args.readOnly` 时，流转状态正确更新为 `completed`（避免误设为 `stopped`）；
- 若 `args.readOnly === true`，强制所有边和节点脱离活跃动效：`edgeState.active = false`、`nodeState.active = false`。

#### [MODIFY] [`studio-graph.ts`](file:///Users/fred/WorkSpace/AI/ogsystem/src/visualizer/studio-client/studio-graph.ts)
- `syncRuntimeDataPackets` 增加 `readOnly?: boolean`，为 `true` 时彻底移除已存在的粒子并退出；
- `applyRuntimeOverlay` 传入 `readOnly: this.options.readOnly === true || this.options.mode === "run-diagnosis"`；
- `constructor`、`update`、`applyRuntimeOverlay` 严密同步维护 `dataset.runtimeHistory`。

#### [MODIFY] [`styles.ts`](file:///Users/fred/WorkSpace/AI/ogsystem/src/visualizer/studio-client/styles.ts)
- 强化 `[data-runtime-history="on"]` 下 `.studio-runtime-data-packets` 与 `.connection` 连线的动画强制禁用规则。

---

### Component 2: 双核孪生布局、最大化与审计下钻 (`apps/team-site/`)

#### [MODIFY] [`apps/team-site/public/styles.css`](file:///Users/fred/WorkSpace/AI/ogsystem/apps/team-site/public/styles.css)
- **生命周期默认布局与最大化样式**：
  ```css
  /* 双核工作台基础容器 */
  .studio-run-dual-core {
    display: grid;
    gap: 16px;
    height: calc(100dvh - 215px);
    min-height: 580px;
    margin: 14px 0;
    transition: grid-template-columns .24s cubic-bezier(.16, 1, .3, 1);
  }
  /* 运行时：两者并重 (Balanced 50:50) */
  .studio-run-dual-core[data-layout-preference="balanced"] {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  /* 调试复盘：突出内容 (Content-first 40:60) */
  .studio-run-dual-core[data-layout-preference="content-focus"] {
    grid-template-columns: minmax(0, 4fr) minmax(0, 6fr);
  }
  /* 宏观最大化 */
  .studio-run-dual-core[data-maximize-mode="macro"] {
    grid-template-columns: minmax(0, 1fr) 0 !important;
  }
  .studio-run-dual-core[data-maximize-mode="macro"] .studio-run-micro-panel {
    display: none !important;
  }
  /* 微观最大化 */
  .studio-run-dual-core[data-maximize-mode="micro"] {
    grid-template-columns: 0 minmax(0, 1fr) !important;
  }
  .studio-run-dual-core[data-maximize-mode="micro"] .studio-run-macro-panel {
    display: none !important;
  }
  ```
- **审计下钻抽屉样式**（`.studio-audit-drilldown-drawer`，多维选项卡、代码块高对比度排版、一键复制、深色模式适配）。
- **生命周期布局切换条样式**（`.studio-layout-switcher`）。

#### [MODIFY] [`apps/team-site/public/app/views/app.js`](file:///Users/fred/WorkSpace/AI/ogsystem/apps/team-site/public/app/views/app.js)
- **重塑 `renderStudioSimulationDetail`**：
  - 判断当前运行状态：运行中默认为 `balanced`（50:50 两者并重），历史回放默认为 `content-focus`（40:60 突出微观内容）；
  - 渲染 `.studio-run-dual-core` 容器与切换条；
  - 挂载宏观与微观面板各自的 `⛶` 最大化按钮事件；
  - 挂载微观卡片「🔍 审计下钻」按钮与抽屉（`renderAuditDrilldownDrawer`）；
  - 完善微观到宏观的反向联动（点击头像/角色名/交接块定位图谱节点）；
- **`renderProjectGraph`**：
  - `readOnly: true` 时显式补充 `mode: "run-diagnosis"`。

---

## 4. 验证计划 (Verification Plan)

### 自动化测试 (Automated Tests)
1. **端到端浏览器测试 (Playwright E2E)**：
   - 运行：`node --test apps/team-site/tests/studio-simulation-browser.test.mjs`
   - 验证点：
     1. 验证历史详情页默认采用 `content-focus`（突出内容）排布；
     2. 验证运行中默认采用 `balanced`（50:50）排布；
     3. 验证 `#studio-run-graph-stage .studio-runtime-data-packet` 数量为 0（彻底消除移动粒子）；
     4. 验证宏观面板点击最大化 `data-maximize-mode="macro"`，还原后正确恢复；
     5. 验证微观面板点击最大化 `data-maximize-mode="micro"`，还原后正确恢复；
     6. 点击「🔍 审计下钻」，验证抽屉滑出并正确展示模型与入参数据；
     7. 验证点击气泡角色名反向居中图谱。
2. **全工程回归测试**：
   - `node --test apps/team-site/tests/desktop-readiness.test.mjs`
   - `pnpm run build` && `node apps/team-site/scripts/build-assets.mjs`
   - `pnpm test`（确保 705 项测试全量通过）

### 手工体验核验 (Manual Verification)
1. 访问 `http://127.0.0.1:4173/studio/teams/<team-id>/run/<simulation-id>`；
2. 体验调试复盘阶段（默认 40:60 突出微观群聊）：
   - 观察宏观图谱沉稳静态，无任何飞舞粒子；
   - 点击顶部切换条测试「两者并重 (50:50)」、「突出内容 (40:60)」与「最大化」；
   - 在群聊气泡中点击「🔍 审计下钻」，查看模型调用流与全量入参快照；
   - 点击气泡头像或 `@下游角色`，图谱自动平滑居中聚焦对应节点；
   - 切换深色模式，检查对比度与科技质感。

## 5. 当前实施状态

- [x] 文档已归档至 `docs/development/dual-core-runtime-visualizer-and-chat-architecture.md`。
- [x] 历史复盘页默认 `content-focus`，支持双核布局切换、宏观/微观分别最大化、审计抽屉、复制原始 JSON 与图谱定位。
- [x] 历史只读图谱已关闭数据粒子、活跃边动画和未收敛状态展示。
- [x] 实时调试工作台运行期间默认 `balanced`，图谱保留运行态动画，对话面板作为微观核同屏显示；运行结束后切换为 `content-focus`。
- [x] 实时运行使用 `runtimeLock` 锁定编辑交互，避免把运行锁误当成历史只读态。
- [x] 设计工作台标记 `structure-focus` 作为生命周期默认偏好。
- [x] 已通过定向浏览器测试、桌面就绪测试、TypeScript 类型检查、完整构建、资源打包和全量回归测试（705 通过，1 项 Windows 专属测试跳过）。

## 6. 工作台状态与通用配置修复方案

### 6.1 面板协调与保存行为

工作台同时存在团队配置、调试配置和调试群聊三个视图。它们共享主工作区，因此由统一的面板协调器维护互斥关系：团队配置打开时仅隐藏调试群聊，运行继续保持；切回运行视图时恢复原来的群聊状态。紧凑视口继续使用单面板模式，桌面视口允许拖拽宽度、停靠和最大化。运行面板弹出或改变宽度时，图谱容器通过 `ResizeObserver` 和显式 resize 同步自适应。

保存团队版本采用原地更新。保存成功后只刷新作者模型、图谱和属性检查器，不重新渲染整个工作台，从而保留当前 Role、Tab、面板宽度、停靠状态、运行订阅和调试历史位置。需要更新版本地址时只替换 URL 状态，不触发页面刷新。

### 6.2 按拓扑显示 Role 配置

Role 的路由和汇聚设置只在具有实际分支或汇聚语义时出现。计算拓扑时排除 Start/End、错误流和展示型关系：有效上游数量大于 1 才显示汇聚策略与最少来源数，有效下游数量大于 1 才显示路由策略与路由顺序。循环字段只对属于循环的 Role 显示；结构变化后清理失效设置并在检查器中给出诊断提示。

### 6.3 通用循环配置

循环上限属于通用配置，不绑定某一个 Role 的局部表单。通用配置按循环编号保存成员、最大轮次和可选的 Role 激活上限：

```json
{
  "loops": {
    "loop-1": {
      "members": ["reviewer", "analyst"],
      "boundary": "reviewer",
      "counter": "round",
      "maxRounds": 3,
      "maxRoleActivations": {"reviewer": 3},
      "onExhausted": "end"
    }
  }
}
```

读取时兼容旧的 `role.loopMax`，写入新配置后保留兼容投影，确保已有 TeamVersion 和 Semantic IR 不丢失循环预算。Role 检查器显示所属循环编号和配置来源，不对非循环 Role 展示循环上限。

### 6.4 群聊渲染、恢复和重新调试

实时运行、刷新恢复和历史详情共用同一 transcript 渲染器。渲染器过滤系统 Start/End 边界事件和 `START` 事件；Role 消息显示用户可读的事件中文标签与内容，长内容折叠到“更多”，用户发送内容靠右显示。底层 executionId、branchId 等字段保留在审计数据，不进入普通群聊气泡。

调试群聊提供隐藏、展开和全屏三个动作，右上角布局按钮在窄屏下保持可用。配置 Tab 与运行 Tab 互斥。活动运行保存 `simulationId`、团队版本和当前视图，刷新后先向后端确认状态再恢复订阅；历史记录可通过“恢复工作台”打开对应运行。运行完成进入终态，按钮改为“重新调试”；重新调试清空 transcript、图谱运行态和 runtime lock，回到配置 Tab，但保留输入内容，且不刷新页面。多个运行按 `simulationId` 隔离，互不覆盖。

### 6.5 图谱运行态信息

运行指标气泡按节点可用宽度限制，超出时截断并通过 tooltip 展示完整值；小节点使用紧凑格式。技术状态 `technical_waiting` 对用户统一显示“工作中”，使用脉冲工作图标；模型等待、工具调用和重试等细节只进入审计数据。人工审核继续显示“审核中”。

### 6.6 实施顺序与验收矩阵

1. 面板协调器、双核 resize 和保存原地更新。
2. 统一 transcript、过滤边界消息、隐藏/展开/全屏和刷新恢复。
3. 运行终态与重新调试，多运行隔离。
4. Role 拓扑条件字段和通用循环配置兼容迁移。
5. 指标气泡约束、状态文案和工作图标。

验收覆盖：桌面与窄屏面板拖拽；调试面板弹出时图谱不被遮挡；Role 点击后的配置面板始终位于可见区域；保存不刷新且保留选择和布局；运行中隐藏/恢复群聊；刷新后恢复当前运行；历史运行恢复；运行结束重新调试；多个 `simulationId` 并行；单上游/单下游 Role 不显示无效策略；循环通用配置与旧字段迁移；长指标和长消息不越界；群聊不出现系统 Start/End 技术消息。

### 6.7 本轮落地状态

- [x] 文档方案已写入本节，且未改动模型服务或 backend 接口。
- [x] Role 检查器按有效拓扑隐藏无意义的路由、汇聚和非循环字段；全局配置新增按循环编号编辑的 JSON 区域，保存时同步写入 `.ogs/semantics.yaml` 顶层 `loops` 供 Semantic IR 编译器消费，并保留旧 `loopMax` 兼容入口。
- [x] 团队保存改为原地刷新图谱和检查器，保留工作台选择与面板状态；团队配置层级高于调试面板，Role 点击时不再被调试面板遮挡。
- [x] 实时和刷新恢复的群聊过滤 Start/End 边界事件，支持中文事件语义、长内容“更多”展开和工作中状态。
- [x] transcript 卡片、事件内容格式化、用户任务/终态消息、审计抽屉交互和运行态交接标记抽离至 `studio-transcript.js`；实时、刷新恢复和历史详情复用卡片与抽屉行为，页面控制器只协调运行事件与图谱状态。
- [x] 用户只作为系统外部输入方显示初始任务；到达 `__system_end__` 的实际 Role 在自己的卡片中向 `@用户` 交付完成结果，支持多个终态 Role，并按 `executionId` 区分循环中的不同激活。
- [x] 运行终态按钮显示“重新调试”，可清理 transcript、运行态和 runtime lock 后回到配置视图。
- [x] 图谱运行指标受节点宽度约束，技术等待统一显示“工作中”并使用工作脉冲图标。
- [x] 定向浏览器测试、桌面就绪测试、Studio 类型检查、完整构建、资源打包和全量回归已通过（705 通过，1 项 Windows 专属测试跳过）。
- [ ] 当前单个工作台仍聚焦一个可见活动运行；多个 `simulationId` 的服务端记录和代次隔离保持不变，历史恢复入口可切换运行。若需要同一页面同时展示多个活动运行，下一步需增加运行实例标签和每实例独立 transcript 容器。
