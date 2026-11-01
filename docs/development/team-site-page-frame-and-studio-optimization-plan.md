# Team Site 页面框架统一与 Studio 工作台交互优化方案

> **状态**：已对齐并确认  
> **文档位置**：`docs/development/team-site-page-frame-and-studio-optimization-plan.md`  
> **关联实施顺序**：Part 1 前置优化 → Part 2 Studio P0/P1/P2 优化 → Part 3 后续专项

---

## 目录

- [第一部分：Team Site 页面框架统一优化（前置优化）](#第一部分team-site-页面框架统一优化前置优化)
  - [1. Summary](#1-summary)
  - [2. Implementation Changes](#2-implementation-changes)
  - [3. Test Plan](#3-test-plan)
  - [4. Assumptions](#4-assumptions)
- [第二部分：Studio 工作台运行态锁与面板交互优化](#第二部分studio-工作台运行态锁与面板交互优化)
  - [1. 确认的真实问题与判断修正](#1-确认的真实问题与判断修正)
  - [2. 实施优先级与任务拆解](#2-实施优先级与任务拆解)
  - [3. 详细设计与代码方案](#3-详细设计与代码方案)
  - [4. 质量保障与测试验证](#4-质量保障与测试验证)
- [第三部分：后续长效演进（专项规划）](#第三部分后续长效演进专项规划)

---

## 第一部分：Team Site 页面框架统一优化（前置优化）

### 1. Summary

统一 Team Site 右侧页面的标题、面包屑和内容容器结构，减少 `page-frame-header` 下方空白，为 `page-frame-body` 提供更多可用空间，并确保桌面、平板、移动端内容不越界。

不改后端接口和数据协议，左侧抽屉布局保持现状。

### 2. Implementation Changes

#### 页面框架与空间
- 以 `page-frame`、`page-frame-header`、`page-frame-body` 为统一布局边界，避免继续针对单个页面追加独立间距。
- 压缩 `page-frame` 上下内边距、标题栏底部 padding 和 `page-frame-body` 顶部 padding。
- 保留 `page-frame-body` 的 `min-height: 0`、独立滚动和 overflow 约束，避免内容撑破父容器（Studio 设计页保留特异性，保持视口高度锁死不出现双滚动条）。
- `page-frame-header`、标题区和操作区增加 `min-width: 0`，长标题、概述和按钮允许收缩。
- 桌面端标题与操作区保持同一行；移动端允许标题和概述换行，禁止横向溢出。
- `page-frame-tabs` 保持横向滚动，仅在标签过多时滚动，不扩大页面宽度。
- 对 `library-heading`、Studio 页面标题和 Platform 页面标题复用同一套紧凑规则。

#### 标题和二级菜单
- 页面标题区只显示当前页面自身的标题和概述。
- `.eyebrow` 统一表示当前二级菜单名称，例如：
  - 协作项目
  - 项目运行历史
  - 团队仓库
  - 角色仓库
  - 模型服务
  - 角色源配置
- 不改变首页、案例卡片和内容区内部的装饰性 `.eyebrow`。
- Studio 设计页继续使用团队名称和团队概述作为主要标题内容，不再显示重复的“团队协作图谱”标题。

#### 一级面包屑
新增基于当前路径的导航上下文映射，并统一设置 `#breadcrumb-current`：
- `/projects`、项目详情、项目团队、项目运行、`/history`：**业务协作**
- `/studio`、`/studio/roles`、Studio 新建、团队设计、团队信息、团队运行、发布：**团队工程**
- `/platform`、`/platform/models`、`/platform/role-sources`：**平台配置**
- 首页保持“**首页**”。

`#breadcrumb-current` 不再直接显示当前二级导航项文本，避免与 `.eyebrow` 语义重复。

#### 一级菜单页统一标准模板 (Template A)
对于左侧菜单点击后在右侧展示的一级菜单页面（如“团队仓库”、“角色仓库”、“协作项目”、“模型服务”等），统一采用微调后的标准模板规范：

```html
<div id="studio-view" class="page-content alternate-view studio-design-page" data-template="A">
  <section class="page-frame" data-template="A" data-fit="">
    <div class="page-frame-body" data-layout-scroll="">
      <section class="project-library-toolbar studio-repository-toolbar">
        <div class="repository-heading">
          <!-- 取消冗余的 .eyebrow，避免与面包屑/左侧菜单重叠 -->
          <h1>{{ 一级菜单名 }}</h1>
          <p>{{ 页面功能与业务规则说明 }}</p>
        </div>
        <div class="project-library-filters repository-actions">
          <!-- 搜索、状态筛选下拉与主行动点按钮 -->
        </div>
      </section>
      <div id="studio-grid" class="project-library-grid">
        <!-- 统一的网格/列表项卡片与空状态 -->
      </div>
    </div>
  </section>
</div>
```

**模板化要点**：
- **取消 `.eyebrow`**：`repository-heading` 内部不再包含 `.eyebrow`，消除与一级面包屑 `#breadcrumb-current` 以及左侧高亮菜单项的三重语义重复。
- **`h1` 规范**：直接展示一级菜单名。例如 `/studio` 页面的 `h1` 从原有的“专业团队开发”规范为 **“团队仓库”**（英文：“Team Repository”）。
- **`p` 规范**：保留说明段落，清晰说明该页面的核心业务规则（例如：“已发布版本不可直接修改；首次保存修改时会创建设计中版本。”）。
- **工具栏与边界线条规范**：
  - **下边缘边界线**：`.project-library-toolbar.studio-repository-toolbar` 彻底取消 `border-top`（消除“页面中间出现多余线条”的视觉割裂），仅保留 `border-bottom: 1px solid var(--line)` 作为工具栏与卡片网格的清晰底边界。
  - **高度压缩与上下居中**：大幅收紧上下 padding（如 `6px 0 10px 0`）与 margin，工具栏内部 `repository-heading` 与右侧操作区垂直上下居中对齐（`align-items: center`），整体高度控制在 50px 左右，为下方核心网格提供更多可用视口空间。
- **工具栏与网格**：`project-library-toolbar` 与 `project-library-grid` 统一作为内容骨架，`page-frame-body` 承载独立纵向滚动（`data-layout-scroll`）。

#### 内容不越界
- 所有页面框架根节点使用 `box-sizing: border-box` 和 `min-width: 0`。
- 标题、概述、标签、按钮和列表项使用 `overflow-wrap`、省略或换行策略。
- 对桌面、平板、移动视口检查：
  - `document.documentElement.scrollWidth <= window.innerWidth`
  - 标题和操作区不互相覆盖
  - `page-frame-body` 可以正常纵向滚动
  - `page-frame-tabs` 不产生页面级横向滚动
- 不调整左侧导航和抽屉尺寸。

### 3. Test Plan

- 更新 Team Site 浏览器测试，覆盖：
  - Projects、Studio、Platform、History 的一级面包屑分组文本。
  - 各页面二级 `.eyebrow` 文本。
  - `page-frame-header` 到 `page-frame-body` 的间距收紧。
  - 桌面、平板、移动视口无水平溢出。
  - 标题、概述、操作按钮和 `page-frame-tabs` 不越界。
  - 页面主体仍可独立滚动。
- 保留并运行现有 Studio 浮动面板、图谱、调试运行和移动端 UAT。
- 执行 `node --check`、资源构建和 `git diff --check`。

### 4. Assumptions

- “统一优化”覆盖所有使用 `page-frame` 的右侧页面，而不是只覆盖 `library-heading`。
- 移动端允许标题和概述换行，以优先保证内容完整和不越界。
- 不新增后端接口，不改变导航 URL 和现有页面功能。

---

## 第二部分：Studio 工作台运行态锁与面板交互优化

### 1. 确认的真实问题与判断修正

#### 确认的真实问题
1. **运行中图谱应进入只读态**：仿真调试期间若修改节点、连线或 Prompt，会导致后续推送的运行事件找不到对应 DOM，产生内存泄漏或状态映射破损。
2. **多面板交互需补强**：多面板首次浮动时坐标重叠覆盖、缺少统一 `Escape` 关闭与焦点回退机制。
3. **长期维护不宜继续扩大单文件**：`app.js` 已超 5000 行，需规划业务域拆分。

#### 修正的判断
1. **AI 构建面板选择器无需作为 Bug 修复**：`#team-build-panel` 原本就挂载了 `.studio-asset-drawer` 类，已在 `floating-panel.js` 的选择器覆盖范围内，运行中不存在层叠竞争死锁。后续可将其与其它面板规范化为 `.studio-floating-panel`。
2. **旧拖拽代码不宜盲目按行数暴力删除**：旧代码被 `data-floating-panel-controller="true"` 条件保护，当前不会执行，需在完备回归测试守护下逐步清理。
3. **避免过度设计**：不应在此刻引入完整的 EventBus、PanelManager 或复杂状态层，以免扩大重构风险。
4. **焦点陷阱约束**：Focus Trap 仅在最大化（Maximized）或移动端全屏抽屉启用；普通浮动面板绝不强制锁死焦点，保持画布穿梭体验。

### 2. 实施优先级与任务拆解

| 优先级 | 任务 | 核心目标 | 落地范围 |
| :--- | :--- | :--- | :--- |
| **P0** | **运行态图谱只读锁** | 杜绝调试流转中拓扑修改，闭环管理开始、结束、停止、异常状态 | `apps/team-site/public/app/views/app.js` |
| **P1** | **统一面板选择器与浮动错位避让** | 规范 `.studio-floating-panel` 标识；浮动重叠时自动级联偏移 28px 避让 | `floating-panel.js` & `app.js` |
| **P1** | **Escape 键响应与条件焦点管理** | 按 Escape 关闭顶层激活面板并归还焦点；仅在最大化/移动端启用 Focus Trap | `floating-panel.js` |
| **P2** | **逐步安全清理旧拖拽分支** | 清理被保护的历史冗余监听代码及未引用的 `resizePanel` | `app.js` |

### 3. 详细设计与代码方案

#### P0: 运行态只读锁生命周期
在 `simulateTeam()` 开始时将图谱切换为只读态，在 `finally` 块中无条件解锁：
```javascript
// simulateTeam 启动阶段：
updateStudioGraph?.update({ readOnly: true });

try {
  // 仿真事件轮询与控制台更新...
} finally {
  // 保证无论 succeeded / failed / stopped 还是网络异常，均平稳解锁
  updateStudioGraph?.update({ readOnly: false });
  state.studioActiveRun = null;
  syncDebugRunButton("idle");
}
```

#### P1: 浮动面板错位避让与类名规范
- 受管浮动面板统一注入 `.studio-floating-panel` 类名；
- 打开浮动面板时，检查同容器中已有可见浮动面板的位置：
```javascript
function cascadeFloatingPosition(panel, host, bounds) {
  const otherPanels = [...host.querySelectorAll(".studio-floating-panel.is-open:not(.is-right-docked)")].filter(p => p !== panel);
  let nextLeft = bounds.left;
  let nextTop = bounds.top;
  for (const other of otherPanels) {
    const ob = panelBounds(other, host);
    if (Math.abs(ob.left - nextLeft) < 32 && Math.abs(ob.top - nextTop) < 32) {
      nextLeft = Math.min(host.clientWidth - bounds.width, nextLeft + 28);
      nextTop = Math.min(host.clientHeight - bounds.height, nextTop + 28);
    }
  }
  return { ...bounds, left: nextLeft, top: nextTop };
}
```

#### P1: Escape 键关闭与条件焦点控制
- **普通浮动模式**：监听 `Escape` 键，关闭当前活跃的顶层面板，并将焦点平稳还原给唤起它的按钮（如 `assetToggle`、`debugOpenButton`、`buildOpenButton`）；
- **最大化 / 移动端全宽抽屉**：
  ```javascript
  function handleFocusTrap(event, panel) {
    if (!isMaximized() && !isCompactViewport()) return;
    const focusable = panel.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      last.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first.focus();
      event.preventDefault();
    }
  }
  ```

#### P2: 安全清理旧拖拽分支
- 移除未使用的 `resizePanel` 函数；
- 移除被 `dataset.floatingPanelController !== "true"` 屏蔽的历史拖拽监听。

### 4. 质量保障与测试验证

1. **测试基线**：保持 Team Site 440/440 项用例与根目录用例全绿；
2. **端到端浏览器测试 (`studio-simulation-browser.test.mjs`) 增强**：
   - 验证仿真运行中图谱处于只读态（无法添加/删除节点与连线）；
   - 验证停止运行或仿真结束后图谱立即恢复可编辑；
   - 验证 `Escape` 键关闭顶层面板并正确恢复触发按钮焦点；
   - 验证多面板浮动打开时无完全叠死遮挡。

---

## 第三部分：后续长效演进（专项规划）

在上述前置优化与 P0~P2 任务落地后，作为独立专项开展：
1. **按业务域物理拆分 `app.js`**：
   - `views/studio/workbench.js`（画布舞台与外框）
   - `views/studio/panels/asset-drawer.js`（团队配置与属性检查）
   - `views/studio/panels/build-panel.js`（AI 构建对话助手）
   - `views/studio/panels/debug-panel.js`（仿真控制台与聊天流）
2. **评估轻量 Panel Registry**：仅在面板数量继续扩展时引入，遵循声明式注册原则，避免提前过度抽象。
