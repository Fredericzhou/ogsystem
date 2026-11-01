# OGS 控制目录与共享 Workspace 统一方案

> 状态：当前实施方案。本文同时定义 Studio、Projects、Runtime 的目录边界和发布验收标准。
> 当前版本尚未发布，不提供旧 `workspace/.ogs` 数据迁移或兼容读取。

## 1. 目标

OGS 将控制数据与业务工作目录分离：

- `--ogs-dir` 是 OGS 控制目录，拥有 System、Role、模型配置、TeamVersion 摘要和 Run 证据。
- `--workspace-dir` 是纯业务工作目录，供角色工具读取输入、修改代码和生成业务产物。
- 一个 Project 只绑定一个 `workspaceDir`；挂载的多个 TeamVersion 共用该目录。
- 框架不创建 `source/`、`destination/` 或其他隐式业务目录，也不在 workspace 中创建 `.ogs`。

## 2. 目录模型

```text
<ogs-dir>/
  system.mmd
  og-roles/
  profiles.json
  tools.json
  .ogs/
    runtime.json
    model-selection.json
    team-versions/<teamVersionId>/manifest.json
    runs/<runId>/
      team-version.json
      project-assets/
      materials/
      events.ndjson
      audit/
      logs/
      roles/
      checkpoints/

<workspace-dir>/
  用户代码、输入资料和业务产物
```

`runDir` 固定为 `<ogs-dir>/.ogs/runs/<runId>`。工作目录中的业务文件保留用户原有路径；正式交付物由 Project Deliverable 流程创建独立只读快照。

## 3. Studio 与 Projects

### Studio

Studio 负责 Team、Draft、TeamVersion、图谱设计、Simulation、诊断和发布。Studio Simulation 继续使用独立命名空间：

```text
.studio/simulations/<teamVersionId>/<simulationId>/
```

Simulation 不进入 Project Task、Project Run、项目容量或 Deliverable。每个 Simulation 必须保存 TeamVersion ID、digest、脱敏输入、模式、状态、事件和输出摘要。

### Projects

Projects 负责一个共享 `workspaceDir`、Materials、Task、Project Run、Review 和 Deliverable。Task 固定一个已发布 TeamVersion；Project Run 的状态和审计写入 Project 的 `ogsDir/.ogs/runs`，不能写入 TeamVersion 目录。

### Runtime

运行时调用必须区分以下输入：

```text
assetSource       当前冻结的 TeamVersion 资产
ogsDir            配置和运行证据根
workspaceDir      业务工作目录
runEvidenceRoot   Project 的 ogsDir
materialSourceRoot / targetDir  workspaceDir
owner             project_task 或 studio_simulation
```

不得再用一个含义不清的 `workdir` 同时推导控制目录、业务目录和运行证据目录。

## 4. TeamVersion 冻结

每个已使用的版本写入不可变 manifest：

```json
{
  "teamVersionId": "team-v2",
  "teamCoreDigest": "<sha256>",
  "teamDigestVersion": 1,
  "systemDigest": "<sha256>",
  "packageDigest": "<sha256>",
  "parentTeamVersionId": "team-v1",
  "capturedAt": "<iso-date>"
}
```

Project Run 额外写入 `.ogs/runs/<runId>/team-version.json`。同一 TeamVersion 的 manifest digest 不允许被覆盖；新团队变更必须生成新 TeamVersion ID。Run 使用的 TeamVersion 资产和 digest 在后续发布或挂载变化后仍保持不变。

## 5. 输入、输出和工作目录浏览

- Materials 相对于 `workspaceDir` 解析，并在 Run 启动时复制成不可变快照。
- 角色工具的 `targetDir` 是 `workspaceDir`；角色可以直接写入用户指定的业务路径。
- Artifact promotion 的目标相对于 `workspaceDir`，不强制使用 `destination/`。
- “打开工作目录”只浏览业务文件。
- “查看运行证据”只浏览 `.ogs/runs/<runId>` 中受控的审计、事件、日志和角色输出。
- 两类浏览器使用不同的路径校验和 API，不能互相读取。

## 6. 实施范围

1. Runtime/CLI：使 `ogsDir`、`workspaceDir`、`assetSource`、`runEvidenceRoot` 成为独立参数；Run 初始化、恢复、停止、审计和 Runs index 统一使用 `ogsDir/.ogs/runs`。
2. Team Site：Project metadata 保存唯一 `ogsDir/workspaceDir` 绑定；Project Run、Review、Recovery 和材料路径分别使用控制目录和共享 workspace；Studio Simulation 保持 `.studio` 命名空间。
3. 安全：所有 ID、路径 containment、symlink/junction、敏感目录和跨域 owner 检查必须在读写前完成。
4. 文档和测试：同步 README、OGS concepts、usage manual、Release UAT 和运行路径契约测试。

## 7. 验收标准

### 7.1 控制目录隔离

- 独立 `ogsDir/workspaceDir` 的 Run 只出现在 `ogsDir/.ogs/runs/<runId>`。
- workspace 不新增 `.ogs`、`source` 或 `destination`。
- System、Role、模型配置只从控制目录或冻结 TeamVersion 资产读取。
- OpenCode/Codex 的实际工具目录为 workspace。

### 7.2 多 Team 共享 workspace

- 两个不同控制目录指向同一 workspace，并分别运行不同 TeamVersion。
- 两个控制目录的 Run 历史、审计和配置互不污染。
- 两个 Team 均能读取前一 Team 写入的业务文件。

### 7.3 版本冻结

- v1 Run 完成后发布 v2，v1 的 manifest、资产快照、digest 和结果不变。
- v2 Run 记录新的 TeamVersion ID 和 digest。
- manifest digest 冲突时拒绝覆盖。

### 7.4 Studio/Projects 隔离

- Studio Simulation 只出现在 `.studio/simulations`，不出现在 Project Task 或 Deliverable。
- Project Run 只出现在 Project `ogsDir/.ogs/runs`，不出现在 Studio Simulation 历史。
- 两类运行均显示正确的 owner、TeamVersion 和 digest。

### 7.5 真实浏览器 UAT

记录以下证据后才算通过：

- `Project ID`、`TeamVersion ID`、`Task ID`、`Run ID` 或 `Simulation ID`；
- `ogsDir`、`workspaceDir`、Run 证据 URL 和实际业务产物路径；
- 开始、运行、完成/停止、刷新恢复的关键截图；
- 运行事件、角色输出、TeamVersion manifest 和工作目录文件；
- 浏览器控制台错误记录。

必须使用真实浏览器和真实 OpenCode Sandbox。模型不可用、凭据缺失或真实运行失败均记录为 Blocked，不得用 Mock Runner 替代。

## 8. Release Gate

- Runtime 路径、恢复、停止、symlink 和 traversal 测试通过；
- Studio Simulation 与 Project Run 的 owner、存储和 API 隔离测试通过；
- 两个 Team 共享同一 workspace 的集成测试通过；
- TeamVersion 冻结和恢复测试通过；
- 工作目录与运行证据浏览器测试通过；
- 桌面、平板和移动视口无越界、遮挡或错误滚动；
- 真实 OpenCode Sandbox UAT 完成；
- 所有高优先级问题关闭；
- UAT 每一项均有 Pass、Fail 或明确 Blocked 证据，Blocked 不得标记为通过。
