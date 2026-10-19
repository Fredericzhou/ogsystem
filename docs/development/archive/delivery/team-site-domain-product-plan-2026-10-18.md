# Team Site 领域与产品能力实施方案

> Status: completed delivery record, archived 2026-10-18. Its schemas, package behavior, and acceptance notes describe the delivered implementation at that time. Current domain semantics are defined by [the active refactor plan](../../team-collaboration-module-refactor-plan.md) and [OGS product concepts](../../../usage/ogs-concepts.md); current user-facing behavior is documented in [the Team Site guide](../../../../apps/team-site/README.md).

## 状态

最新方案：已实现；发布验收：通过。

本文冻结 Team、TeamVersion、Project、资料、摘要、导入导出和试用能力。运行状态由运行可靠性方案负责，页面壳层由前端基础设施方案负责。当前版本按最新契约工作，不保留历史字段、旧路由或旧数据迁移路径。

验证证据：`pnpm build` 通过；Team Site 全量测试覆盖 project-v2 跨工作区导入、旧版本拒绝、原子回滚、资料安全、导入冲突、试用团队、仓库分页、项目导出和运行链路回归。浏览器验收覆盖经典团队缩略图、案例详情、团队创建、协作项目创建、桌面端和 390px 移动端。

## 领域契约

- `Team` 是逻辑团队根对象；`TeamVersion` 是可编辑、可发布、可挂载的不可变版本。
- `Project` 负责项目目录、资源和团队挂载关系。
- `Task` 是用户的一次业务工作请求，保存输入、所选 TeamVersion 和任务生命周期。
- `Run` 是该 Task 的一次执行尝试；一次 Task 可关联多次 Run。Run 状态文件权威，Task 状态在绑定 Run 后是列表查询投影。
- `Run` 的权威状态位于 `.ogs/runs/<runId>/control/state.json`；`.site/project.json` 和运行索引只保存引用或投影。
- TeamVersion 状态为 `draft -> editing -> released -> archived`；结构校验结果是派生信息。
- 项目元数据使用 `overview`；`intent` 不属于当前输入契约。

### 摘要

- `teamCoreDigest` 覆盖规范化团队核心文件、角色关系、交接契约、循环、分支、汇合和执行绑定，不覆盖名称、图标、分类、时间、项目 ID 或运行文件。
- `projectDefinitionDigest` 覆盖项目资源、资源内容、挂载 TeamVersion 摘要和项目配置，不覆盖任务运行历史。
- `packageDigest` 覆盖导出包的稳定内容，排除自身、展示身份和生成时间，用于包完整性和精确包身份。
- 项目包唯一格式为 `mode: "project-v2"`；嵌套 TeamVersion 包使用 `mode: "team-v2"`。旧版本统一返回 `PROJECT_PACKAGE_VERSION_UNSUPPORTED`。
- 项目包只恢复项目定义、已发布团队和资料；任务历史、Run、WAL、checkpoint、活动锁和恢复状态不随包导入。
- Team 名称只在 Team 根对象作用域内唯一；Project 名称只在 Project 作用域内唯一；两者允许同名。

## 已实现能力

- 发布团队后才允许项目挂载；项目创建一次完成工作目录和多个团队挂载。
- 保存团队草稿不创建新发布版本；发布生成不可变 TeamVersion，项目引用固定到所挂载的版本。
- 项目创建使用 staging 和原子完成策略；任一团队校验、写入或 HTTP 流程失败都不会留下半成品，服务启动还会清理遗留 staging。
- 项目请求使用 `name`、`overview`、`teamVersionIds`；工作目录由服务端自动创建并返回。
- 资料接口支持批量文件和文件夹选择，保留文件夹相对路径；服务端拒绝路径穿越、绝对路径、符号链接和非法格式，并限制单批数量与大小。
- 项目导出包包含项目摘要、包摘要、挂载团队和资料内容，不包含凭据、checkpoint、WAL 或活动恢复状态。
- 项目导出包递归包含每个去重 TeamVersion 的完整团队包；预览递归校验且不写入目录，导入在 staging 中完成后统一提交。
- 团队和项目导入先返回指纹、名称冲突、团队依赖和 ID 映射计划；复用不创建新对象，创建副本使用新的身份。
- 试用团队使用临时工作区，不创建 Project、TaskRecord 或持久化 Run。
- 团队仓库支持分类、状态、搜索、排序、分页和内置/自定义统计。
- 经典团队卡片展示 SVG 图谱缩略图，点击进入 `/cases/:caseId`。

## 接口

```text
GET  /api/v1/team-repository
POST /api/v1/team-packages/preview
POST /api/v1/team-packages/import
POST /api/v1/project-packages/preview
POST /api/v1/project-packages/import
POST /api/v1/team-versions/:teamVersionId/simulate
POST /api/v1/projects
POST /api/v1/projects/:projectId/materials
GET  /api/v1/projects/:projectId/export
```

项目创建请求：

```json
{
  "name": "项目名称",
  "overview": "项目概述",
  "teamVersionIds": ["team-version-id-1", "team-version-id-2"]
}
```

## 验收标准与完成情况

- [x] 未发布团队不可挂载，已发布团队可以挂载。
- [x] 多团队项目创建一次完成；第二个团队失败、HTTP 失败和进程异常均回滚。
- [x] 项目名称只在 Project 作用域防重，团队与项目允许同名。
- [x] 批量资料和文件夹资料保留相对路径，拒绝危险路径、符号链接和非法格式。
- [x] 项目导出包、项目摘要和包摘要稳定，且排除敏感文件和活动运行状态。
- [x] 项目包使用 project-v2，嵌套团队使用 team-v2；旧版本明确返回 PROJECT_PACKAGE_VERSION_UNSUPPORTED。
- [x] 团队/项目导入具备预览、指纹去重、冲突处理和安全路径校验。
- [x] 跨工作区导入重建 TeamVersion 身份，预览零写入，团队、项目和资料失败全部回滚。
- [x] 试用团队不产生持久化项目、任务或运行记录。
- [x] 团队仓库具备筛选、搜索、排序、分页和统计。
- [x] 领域契约回归测试覆盖最新字段和状态边界。

## 非目标与边界

- 不支持历史 `intent` 输入、`/studio/new` 路由或旧 Run 状态别名。
- 不迁移旧数据；不在领域层复制运行状态或实现页面请求生命周期。
- 前端只消费本方案接口，不在页面中实现领域去重、摘要计算或回滚逻辑。

## 文件边界

- 领域逻辑位于 `apps/team-site/project-repository.mjs` 与 `apps/team-site/domain/`。
- 运行轨道不得修改 Team/Project 命名、资料和摘要规则。
- 前端轨道只消费本方案已冻结的接口。
