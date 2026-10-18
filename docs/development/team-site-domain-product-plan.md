# Team Site 领域与产品能力实施方案

## 状态

一期与二期基线：已完成；发布验收：通过。

本文冻结 Team、TeamVersion、Project 和资料/导出契约；运行状态由运行可靠性方案负责，页面壳层由前端基础设施方案负责。实现已覆盖多团队项目创建、已发布团队校验、批量资料服务端写入、文件夹相对路径上传、项目导出、Run 预留、摘要稳定性、导入安全校验，以及二期导入预览/冲突处理、临时模拟和团队仓库查询能力。

当前验证证据：构建通过；完整 Team Site 测试 `39/39` 通过；Playwright 浏览器验收和移动端溢出检查通过；Visualizer 完整回归 `248/248` 通过（导入隔离 `1`、主套件 `198`、布局 `49`）；根项目回归 `654/655` 通过（Windows smoke 在 macOS 跳过，CLI compatibility 帮助断言与当前兼容策略文档不一致，非 Team Site 变更）。该结果证明一期和二期领域轨道均已通过发布闸门。

## 领域契约

- `Team` 是逻辑团队根对象；`TeamVersion` 是可编辑、可发布、可挂载的不可变版本。
- `Project` 负责项目目录、资源和团队挂载关系。
- `TaskRecord` 是站点任务入口和显示投影，不拥有运行状态。
- `Run` 的权威状态位于 `.ogs/runs/<runId>/state.json`；`.site/project.json` 和 `runs-index.json` 只保存引用和投影。
- TeamVersion 状态为 `draft -> editing -> released -> archived`。`validated` 是最近一次结构校验产生的派生状态。

### 指纹

- `teamCoreDigest` 只覆盖规范化后的团队核心文件、角色关系、交接契约、循环、分支、汇合和执行绑定，不覆盖名称、图标、分类、时间、项目 ID 或运行文件。
- `projectDefinitionDigest` 覆盖项目资源、资源内容、挂载 TeamVersion 摘要和项目配置，不覆盖任务运行历史。
- `packageDigest` 覆盖导出包内容（排除自身、导出时的项目展示身份和生成时间），只用于包完整性和精确包身份。
- Team 名称只在 Team 根对象内唯一；Project 名称只在 Project 作用域内唯一；两者允许同名。

以下契约已在当前基线实现：

- `teamCoreDigest` 由团队关系、设计、法律约束和可执行角色文件组成的核心摘要计算并持久化；名称、图标、分类、运行文件不参与摘要。
- `projectDefinitionDigest` 持久化于协作项目元数据，并在挂载团队、更新概述和上传资料后更新；`packageDigest` 按稳定导出包内容计算，用于包完整性和精确包身份。

已补齐的契约：
- Team 根对象与 TeamVersion 通过 `teamRootId`、`teamVersionId`、`parentTeamVersionId` 建立明确引用，并持久化于 `.site/team.json` 与 `.site/team-version.json`；`project.json` 保留兼容投影。
- 团队名称在 Team 根对象作用域内唯一，Project 名称在 Project 作用域内唯一，团队与项目允许同名。

## 首期范围

- 发布团队后才允许项目挂载。
- 项目创建一次完成工作目录创建和多个团队挂载；采用 staging 目录写入、完成后原子 rename，HTTP 失败和进程重启会清理遗留 staging，避免留下半成品。
- 服务端资料接口支持批量文件和相对路径，前端支持文件夹选择；当前只接受文本类格式 `md/txt/json/yaml/yml/csv`，单批大小和数量受服务端限制。
- 生成单一版本化项目导出包，排除凭据、checkpoint、WAL 和活动恢复状态。
- 经典团队使用 SVG 图谱缩略图和统一图标集；案例详情与团队展示页分离。

## 二期范围（已完成）

- [x] 团队/项目导入预览、指纹去重和冲突处理。
- [x] 试用团队临时仿真，不创建 Project、TaskRecord 或持久化 Run。
- [x] 团队仓库分类、状态筛选、搜索、排序、分页和统计卡片。

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
  "teamVersionIds": ["team-version-id"]
}
```

`intent` 保留为兼容别名，内部规范字段为 `overview`。工作目录由服务端自动创建并返回，不再要求用户填写路径。

## 验收标准

- 未发布团队不可挂载，已发布团队可以挂载。
- 项目、工作目录和多个团队挂载一次完成，任一失败不会留下半成品。
- 项目名称只在 Project 作用域防重。
- 文件夹上传保留相对路径，并拒绝路径穿越、符号链接和非法格式。
- 导出包内容和摘要稳定，且不包含凭据、checkpoint、WAL 或活动恢复状态。
- `teamCoreDigest` 不受名称、图标和运行文件变化影响；`projectDefinitionDigest` 不随新增 Run 变化。
- 团队和项目导入先返回指纹、名称冲突和建议策略；复用不创建新目录，创建副本使用明确的新身份。
- 团队试用只使用临时工作区，返回后不留下 Project、TaskRecord 或 Run。
- 团队仓库查询支持分类、状态、搜索、排序、分页，并返回总数和内置/自定义统计。

## 当前发布闸门

以下项目已完成并通过验证：

- [x] 完成三类摘要的字段、计算范围、持久化位置和稳定性测试。
- [x] 增加多个团队全部成功挂载、第二个团队中途失败、HTTP 层失败回滚和进程异常场景测试。
- [x] 提供资料批量上传和文件夹上传的真实前端入口，并展示支持/推荐格式。
- [x] 修复项目包导入路径校验回归，补充项目导入与团队导入的指纹冲突测试。
- [x] 完成二期团队/项目导入预览、指纹去重、冲突处理和临时模拟回归测试。
- [x] 完成团队仓库分类、状态筛选、搜索、排序、分页和统计卡片。

## 文件边界

- 领域逻辑位于 `apps/team-site/project-repository.mjs` 的领域兼容层及后续拆出的 domain 模块。
- 运行轨道不得修改 Team/Project 命名、资料和指纹规则。
- 前端轨道只消费本方案接口，不在页面中实现领域去重或回滚逻辑。
