# OGS Visualizer 优化清单

Date: 2026-04-23  
Status: completed  
Scope: 在保持当前轻量、read-mostly 观测面边界的前提下，补齐响应式布局、控制面语义、Mermaid 工作台、运行管理、项目重绑定与项目导出

## 1. 当前实现结论

- [x] visualizer 保持了 read-mostly 观测面边界
- [x] 新增写入口继续围绕 lifecycle / control-plane 展开
- [x] Mermaid 工作台已支持编辑、校验、保存、另存为、草稿恢复、结构视图、渲染视图
- [x] 运行控制已支持 `start` / `resume` / `stop`
- [x] review `pause` / `terminate` 与 run `stop` 已在 UI 与 API 上区分语义
- [x] 项目加载采用方案 A：当前 visualizer 重新绑定到新 `workdir`
- [x] 项目导出首版锁定为单一模式：`single-project-v1` JSON bundle，仅包含 `system.mmd` 与 `.ogs` 配置面，不包含 `.ogs/runs`、日志、timeline、checkpoint、review 工件

## 2. P0 响应式布局与样式

- [x] 为 `.hero`、`.actions`、`.row`、日志筛选区补齐多断点：`1180 / 960 / 768 / 480`
- [x] 顶部操作区拆分为项目侧与运行控制侧两组
- [x] 按钮统一最小高度、最小宽度、间距与换行策略
- [x] `.row` 在中小屏改为可换行 / 单列布局
- [x] 侧栏在窄屏下改为抽屉式
- [x] run/review 长文本增加截断与 `title` 完整值查看
- [x] `pre`、timeline、preview 面板补齐高度策略，减少多滚动容器互抢空间
- [x] 移动端单列展示，先列表后详情的操作顺序可用
- [x] 主操作、次操作、危险操作已做视觉层级区分
- [x] 完成 1440 / 1180 / 960 / 768 / 480 断点样式收口

验收：

- [x] 顶部按钮、筛选输入、状态标签在 768px 及以下不再发生重叠
- [x] 手机宽度下可完成“选 run -> 看图 -> 看 review -> stop/review decide”基础路径
- [x] 主要操作不再依赖横向滚动

## 3. P0 现有控制面语义澄清

- [x] UI 文案明确区分 run `stop`、review `pause`、review `terminate(scope=branch|run)`
- [x] stop 按钮与说明不再误导为“可恢复的普通 pause”
- [x] 确认与成功反馈包含 `runId` / `reviewId` / `scope`
- [x] stop 反馈明确区分 request 已记录、outcome 是否已生效、run 状态是否已收敛
- [x] review `pause` 反馈明确是 human review 待续，而非整个 runtime 的通用 pause
- [x] 已完成 / 已失败 / 已停止 run 会禁用 stop
- [x] 非 `pending` / `paused` review 不再显示决策动作

验收：

- [x] review `pause` 不再被包装成 run 级 pause
- [x] run `stop` 与 review `terminate(run)` 的区别已可见
- [x] 控制面反馈与 runtime 语义一致

## 4. P0 Mermaid 编辑与实时渲染

### 4.1 编辑器能力

- [x] 新增 Mermaid 源码编辑区
- [x] 支持编辑当前 `system.mmd`
- [x] 支持新建 Mermaid 草稿
- [x] 支持保存
- [x] 支持另存为
- [x] 标记未保存状态
- [x] 支持恢复上次草稿
- [x] 支持回退到磁盘版本

### 4.2 实时校验

- [x] 复用 Mermaid 解析/验证链路做实时校验
- [x] 错误可定位到行级
- [x] 区分 Mermaid 解析/验证错误与 compile/reference 类错误

### 4.3 实时渲染

- [x] 新增预览面板
- [x] 编辑区与预览区可以切换 `源码视图 / 渲染视图 / 结构视图`
- [x] 输入变更后使用防抖校验/渲染
- [x] 渲染失败时保留最近一次成功结构
- [x] 错误摘要在工作台内可见

### 4.4 与项目/运行关系

- [x] 明确区分项目当前 `system.mmd` 与 run snapshot `system.mmd`
- [x] run 详情继续保留 snapshot 可见性
- [x] 保存后提示 `project sync` / `sync-models` / 新 run 验证建议

验收：

- [x] visualizer 中可直接编辑 `system.mmd`
- [x] 修改后可实时看到预览结果
- [x] 解析错误可定位且不会拖垮整个页面

## 5. P0 运行管理最小闭环

### 5.1 启动与恢复

- [x] 新增 `Start Run` 入口
- [x] 支持选择 system 文件
- [x] 支持输入 prompt / input
- [x] 支持 dry-run 开关
- [x] 支持可选 `runtime / user-profile / laws` 参数
- [x] 新增 `Resume Run` 入口
- [x] `resume` 前可先查看 resume diagnostics
- [x] `start` / `resume` 成功后自动跳转目标 run

### 5.2 停止与终止

- [x] 保留 `stop`，并明确其为终止当前 run 的 stop request
- [x] 已完成 / 已失败 / 已停止 run 禁用 stop
- [x] stop 后展示 request / outcome / run 收敛状态

### 5.3 关于 pause

- [x] 未新增假的全局 `Pause Run`
- [x] UI 中明确当前只有 human review 节点支持 `pause`
- [x] run 级 pause 仍保留为未来独立 runtime 语义设计项

### 5.4 Review 控制一致性

- [x] review 动作与 run 动作的危险级别和确认流程已统一
- [x] review `pause` / `terminate` 与 run `stop` 的作用域已明确区分
- [x] `terminate scope` 以 branch / run 真实含义展示

验收：

- [x] 用户可以从 visualizer 发起 `start`、`resume`、`stop`
- [x] review `pause` 不再被误解为 run 级 pause
- [x] run 生命周期主路径不再必须切回 CLI

## 6. P1 项目入口演进

### 6.1 项目加载方案决策

- [x] 锁定唯一方案：方案 A，当前 visualizer 重新绑定到新 `workdir`
- [x] 决策时同步澄清 URL、workdir 生命周期、缓存失效、最近项目语义与 API 作用域
- [x] 该能力未再混入多项目首页状态

### 6.2 项目加载实现

- [x] 已补 UI / API
- [x] 支持加载已有 `system.mmd + .ogs/` 结构的项目目录
- [x] 对无效目录返回结构化错误

验收：

- [x] 项目加载能力建立在单一产品方案上
- [x] 未引入未定义的多项目状态混乱

## 7. P1 项目导出

- [x] 已锁定单一导出边界：`single-project-v1` JSON bundle
- [x] 导出内容为 `system.mmd` 与 `.ogs` 配置面
- [x] 默认不带出 `.ogs/runs`、日志、timeline、checkpoint、review 工件
- [x] 首版只保留这一种清晰导出模式
- [x] 导出语义已与 run 工件下载区分

验收：

- [x] 导出范围单一且明确
- [x] 导出语义不与 run 工件下载混淆

## 8. API / 服务端配套改造

- [x] 为 Mermaid 编辑、校验、保存、另存为补齐 API 路由
- [x] 为 `start` / `resume` / `stop` 补齐 API 路由
- [x] 项目加载 / 导出 API 已实现并绑定已确认方案
- [x] DTO 显式化，新增 workbench / lifecycle / control action / error envelope 视图
- [x] 维持 visualizer “read-mostly + 少量 control-plane 写入口”边界
- [x] workdir 重绑定时显式失效 project/runs 缓存
- [x] Mermaid 保存具备防误操作与错误回显
- [x] 写操作继续通过 lifecycle / runtime 入口，不直接改写 run 工件目录
- [x] 失败路径统一为结构化 JSON error envelope

验收：

- [x] 新增功能不要求前端直接访问磁盘
- [x] 服务端接口语义与 CLI 保持一致

## 9. 测试与验收补强

### 9.1 前端

- [x] 补 route/state/workbench 回归
- [x] 补 busy / success / error 状态测试
- [x] 补 Mermaid workbench 保存与 start 行为测试

### 9.2 服务端

- [x] 补 Mermaid workbench API 测试
- [x] 补 `start` / `resume` / `stop` API 测试
- [x] 补 project load / export API 测试
- [x] 补失败路径覆盖：无效 mermaid、结构化 4xx / 5xx

### 9.3 Smoke

- [x] 编辑 `system.mmd`
- [x] 实时预览 Mermaid
- [x] 启动 dry-run
- [x] 查看 graph / logs / reviews
- [x] review pause / approve / terminate
- [x] stop run

说明：

- [x] 在当前 sandbox 中以前端 harness、服务端 API 回归、runtime integration 回归完成 smoke 与回归验证

## 10. 关键风险与前置决策

- [x] “加载项目”已明确为单项目重新绑定
- [x] “导出项目”已明确为单一 bundle 模式
- [x] Mermaid 预览方案已锁定为“服务端校验 + 前端 SVG 结构渲染”
- [x] review pause 未被误包装成 run pause
- [x] visualizer 未绕开 lifecycle 直接改写运行目录

## 11. Definition Of Done

- [x] 页面在桌面端和移动端均无明显布局重叠
- [x] visualizer 可以编辑并实时渲染 `system.mmd`
- [x] visualizer 可以发起 `start` / `resume` / `stop`
- [x] review `pause` / `terminate` 与 run `stop` 语义清晰区分
- [x] 新增功能均有 API 回归和关键交互回归

## 12. 本轮验证记录

- [x] `pnpm build`
- [x] `node --test tests/visualizer-client.test.mjs tests/visualizer-data.test.mjs tests/visualizer.test.mjs`
- [x] `node --test tests/graph-runtime.integration.test.mjs`

## 13. 交付说明

- [x] 前端：新增 Mermaid Workbench、响应式布局、多断点、抽屉侧栏、分级按钮、控制面语义收口
- [x] 服务端：新增 workbench API、`start` / `resume` / `stop` 生命周期 API、project load/export API、结构化错误
- [x] 测试：补齐 workbench、lifecycle、project load/export、客户端交互与 runtime resume 回归
- [x] 文档：本清单已从 proposal 更新为 completed
