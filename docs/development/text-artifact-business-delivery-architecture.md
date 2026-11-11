# 文件产物与代码执行能力建设方案 v1（修订定稿）

本文件是文件产物、源码执行和业务成果落地能力的执行基准。它服从
[`ogsystem-constitution-v1.md`](ogsystem-constitution-v1.md)、
[`DECISIONS.md`](DECISIONS.md) 和
[`ogsystem-handoff-semantics-v1.md`](../usage/ogsystem-handoff-semantics-v1.md)。

本修订锁定四个不变量：Opaque ArtifactRef、Explicit Handoff Only、单一状态机控制流、真实安全边界。

## 1. 目标

角色调试和 Project Run 应支持生成、运行、验证并发布文本类文件，也应能通过受控 CLI 工具处理常见的非文本格式。Runtime 不按扩展名建立窄格式白名单；它只负责安全路径、普通文件、符号链接拒绝、哈希、工具验证结果和配额。需要魔数检查时由对应 Verifier 或 CLI 工具执行。

目标文件包括：

- 普通文本：`.txt`、`.md`、`.csv`、`.log`
- 配置和数据：`.json`、`.yaml`、`.yml`、`.toml`、`.xml`
- 源码：`.js`、`.ts`、`.tsx`、`.jsx`、`.py`、`.go`、`.rs`、`.java`、`.sql`
- Web 文件：`.html`、`.css`、`.graphql`
- 常见非文本示例：`.pdf`、`.docx`、`.xlsx`、`.pptx`、`.png`、`.jpeg`、`.webp`、`.svg`、`.zip`

以上扩展名只是常见示例，不是允许列表或拒绝列表。

原则上，Git 能够存储且项目工作流方便处理的格式都可作为产物；格式生成、转换、编译、压缩、渲染和检查由项目声明的 CLI 工具或工具 Profile 负责。Runtime 对 CLI 工具能力不做格式层面的限制，但仍执行 Law、工具授权、进程约束、文件配额和审计。

方案还应支持：

1. 在隔离目录中生成源码和文本文件。
2. 在隔离目录中编译、测试和运行源码。
3. 保存文件、命令、日志和验证结果。
4. 将经过验证的文件发布为业务成果。
5. 将结构化输出提交到业务数据适配器，而不是让角色直接修改业务数据库。

## 2. 当前边界

当前 Runtime 已经能够为每次 Role 激活创建独立 execution staging。Codex、OpenCode、ACP 后端和 `local_shell` Profile 都接收该目录作为本次执行的工作目录，并对 Role 声明的文件生成执行级 manifest、verification、seal 和不可变快照。OpenCode、Codex、Qwen 和 Kimi 的 native permission/capability 请求均由 Role workspace policy 约束；具体映射仍由各 adapter 实现，不能把一个 backend 的工具名称或审批界面当成另一个 backend 的协议。Team Site 已支持封存文件读取、Projects 多文件 Deliverable 归档以及媒体 Range 响应。

当前仍有以下边界：

1. `workspace.run` 等通用 Workspace 工具原语尚未作为统一的 backend-native 工具协议完整暴露给所有 CLI；当前主要依赖各 CLI 的原生能力或 `tools.json` 中的 `local_shell` Profile。已接入的 model backend 会在 adapter 边界执行 workspace capability policy，新增 backend 仍需实现对应的映射和审计。
2. Role 产物验证目前执行路径、符号链接、文件存在性、SHA-256 和固定配额检查；配置化 build/test/lint verifier 尚未接入 Role 的验证配置。当前生成的 `verification.json` 不等同于测试命令通过证明，Promotion 仍要求封存报告中的 `passed: true`。
3. `run-artifacts.ts` 的 artifact manifest 与 checkpoint/resume 端到端对账，以及跨 Role 只读输入自动挂载，仍属于后续接线工作。
4. Business Data Adapter 的 `validate -> diff -> confirm -> commit` 事务端口和前端 artifact canvas 尚未完成。因此当前可以生成并归档业务数据文件，但不能宣称已经完成外部业务数据库事务写入闭环。

因此，在宿主机工具已安装且 Role/Profile 已授权的前提下，Role 可以调用 CLI 生成文档、源码、PPT、图片、音视频等文件；框架当前提供的是受控生成、验证和文件交付能力，具体格式生成仍由宿主机 CLI、模型或项目脚本负责。

## 3. 总体结构

```text
Role Executor
  -> Run Workspace
  -> Artifact Store
  -> Build/Test/Run Verifier
  -> Seal Manifest
  -> Promotion Service
  -> Deliverable Store 或 Business Data Adapter
```

各层职责：

- **Role Executor**：理解任务并生成内容、源码或结构化结果。
- **Run Workspace**：提供隔离的可写目录。
- **Artifact Store**：保存文件、元数据、hash 和来源关系。
- **Verifier**：当前验证声明文件的安全性、完整性和哈希；编译、测试、格式检查和业务 Schema 命令由已绑定的 CLI/Profile 执行，统一配置化 verifier 仍在后续接线。
- **Promotion Service**：校验 seal 后，将产物原子地发布到业务工作区。
- **Deliverable Store**：保存文件型业务成果和其索引。
- **Business Data Adapter**：在确认后把结构化结果写入业务实体。

Runtime 不负责理解 DOCX、PDF、图片、客户、订单等业务概念；它保存任意已验证的文件字节和元数据。需要理解或生成具体格式时，由业务层适配器或 CLI 工具处理。

## 4. 输出契约

保持现有 `event/content/data` 兼容，同时增加可选的 `artifacts`：

```json
{
  "event": "READY",
  "content": "已完成源码和测试。",
  "data": {
    "testCount": 24,
    "passed": true
  },
  "artifacts": [
    {
      "artifactId": "source",
      "kind": "source",
      "path": "src/main.ts",
      "mediaType": "text/typescript",
      "encoding": "utf-8",
      "entrypoint": "src/main.ts"
    },
    {
      "artifactId": "report",
      "kind": "business_document",
      "path": "output/report.txt",
      "mediaType": "text/plain",
      "encoding": "utf-8"
    }
  ]
}
```

`artifacts` 是模型对候选文件的声明，不是授权凭证。模型不应提交宿主机路径或自行声明 hash；Runtime 在执行 staging 中读取普通文件，校验相对路径、符号链接和配额，计算 hash 后生成受控清单。`mediaType` 写入 manifest 作为元数据，当前不承担魔数或格式转换验证。`StoredRoleResult` 继续只保存不透明的 `artifactRef`，不直接保存文件路径或明文文件清单。

### 4.1 Artifact 字段

| 字段 | 说明 |
| --- | --- |
| `artifactId` | 当前 Run 内唯一标识 |
| `kind` | `text`、`source`、`business_document`、`business_data`、`technical_artifact` |
| `path` | Workspace 内的安全相对路径 |
| `mediaType` | 文件 MIME 类型或项目定义的媒体类型字符串；不作为 Runtime 格式白名单 |
| `encoding` | 文本文件默认为 `utf-8`，二进制文件使用 `binary` |
| `entrypoint` | 源码可选的执行入口 |
| `publishTarget` | 可选的业务发布目标，由业务层解释 |

### 4.2 不透明引用和验证清单

角色成功执行后，Runtime 在以下受控位置保存验证清单：

```text
roles/<roleId>/executions/<executionId>/artifact-manifest.json
```

`StoredRoleResult.artifactRef` 只包含 `artifactId`、`runId` 和可选 `mediaType`。文件清单、物理路径、大小和 SHA-256 属于执行证据，只能通过 `src/runtime/artifact-access.ts` 的 `ArtifactResolver` 读取。Resolver 必须同时校验 `artifactAllowedByBranchId`、Run/producer provenance、manifest hash、文件路径和符号链接，并记录允许和拒绝的读取审计。

验证器使用不跟随符号链接的文件句柄，并复用已校验的文件内容生成 hash 和不可变快照。`shared/artifact-manifest.json` 是 canonical verified manifest；`seal-manifest.json.manifestSha256` 必须匹配该 manifest，读取方必须重新验证 canonical manifest 和每个文件 hash，不能把 seal 中可变的 `files` 数组当作信任根。

## 5. Workspace 工具

角色可以使用受控的 Workspace 能力：

```text
workspace.write_text(path, content)
workspace.read_text(path)
workspace.run(command, cwd, timeout)
workspace.list_files(glob?)
workspace.patch_text(path, edits)
```

约束如下：

- 只能访问当前 Run 的 staging workspace。
- 所有路径必须是安全相对路径。
- 禁止符号链接逃逸、绝对路径和 `..` 路径段。
- 命令执行受超时、内存、输出大小和进程环境策略限制。
- 默认角色执行预算为 10 分钟，Graph Runner 额外保留 15 秒持久化宽限；OpenCode 服务启动预算最多 2 分钟。角色、Profile 或 Model 的显式预算优先于默认值。
- 默认结构化执行输出上限为 2 MiB；大体量文件应写入 staging 并通过 `artifacts` 声明，不应把文件内容塞进模型 stdout。
- 当前 `local_shell` 只能声明 `envPolicy: "minimal"` 等进程/环境约束；只有底层 OS、Container 或 Sandbox 真正强制网络命名空间时，才允许声明 `networkPolicy: "none"`。执行器不支持时必须 fail-closed。
- 每次文件写入和命令执行都写入运行证据。
- 不能直接修改正式项目目录或业务数据库。

每次角色激活使用独立 execution staging。新一轮激活默认是 Clean Room；只有 `context.map` 或显式 `baselineArtifact` 通过 ArtifactResolver 授权后，才将上游文件以只读输入挂载到当前工作区。不得默认复制上一轮工作区或形成隐式 Role memory。

### 5.1 视频和其他多媒体产物

视频不需要额外的 Runtime 格式白名单。通常使用 `kind: "technical_artifact"`、`mediaType: "video/mp4"`（或实际 MIME）和 `encoding: "binary"` 声明。Runtime 不生成视频内容；它验证并保存 CLI 或模型在 staging 中生成的文件。

有两种受支持的配置方式：

1. **模型 Role**：Role 的 `constraints.allowedTools` 显式包含 `workspace.write`、`workspace.patch_text` 和 `workspace.run`，模型 CLI 在 execution staging 中调用宿主机 `ffmpeg` 或项目脚本。OpenCode、Codex、Qwen 和 Kimi 的 adapter 会分别将这些能力映射到 native tools、sandbox/approval 或 ACP permission request；未显式授权的请求必须失败。
2. **CLI 工具 Role**：在 TeamVersion 的 `tools.json` 声明 `local_shell` 工具，在 `profiles.json` 设置 `timeoutMs` 和 `maxOutputBytes`，再通过 `system.mmd` 的 `exec.bind.<roleId>` 绑定 Profile。该 Role 的 `allowedTools` 必须包含实际的 `toolRef`。

典型视频产物声明如下：

```json
{
  "event": "READY",
  "content": "视频已生成并完成文件校验。",
  "artifacts": [{
    "artifactId": "demo-video",
    "kind": "technical_artifact",
    "path": "output/demo.mp4",
    "mediaType": "video/mp4",
    "encoding": "binary"
  }]
}
```

宿主机必须安装 `ffmpeg` 及所需编码器；如果视频由图片、音频或 AI 生成素材合成，还必须把相应 CLI、模型和凭据配置在宿主机或项目工具中。FFmpeg 工具脚本应把日志写入 stderr，只把最终 Role JSON 写入 stdout。

## 6. 运行与验证

一次源码型 Run 的阶段如下：

1. 角色声明预期文件和入口。
2. 角色在 execution staging workspace 写入文件。
3. Runtime 检查路径、普通文件、符号链接、大小和文件哈希；验证使用 no-follow 文件句柄，`mediaType` 记录在 manifest 中，不构成格式白名单。
4. 如果 Role 使用已配置的 CLI/Profile，工具可以在 staging 中执行 build、test、lint、渲染或转码命令；当前 Runtime 尚未把这些命令作为统一的 verifier 配置自动执行。
5. 保存 stdout、stderr、退出码、耗时和测试摘要。
6. 对最终文件树计算 SHA-256。
7. 校验输出 Schema 和已声明文件。
8. 生成 `artifact-manifest.json`、`verification.json` 和 `seal-manifest.json`。验证失败只产生 `ERROR.ARTIFACT_VERIFICATION_FAILED` RuntimeErrorEnvelope，交由 system.mmd 已声明的 ERROR 路由、Loop 返工、Retry 或 Human Review 处理；Verifier 不启动隐藏修复循环。

示例：

```json
{
  "status": "sealed",
  "files": [
    { "path": "src/main.ts", "sha256": "...", "mediaType": "text/typescript" },
    { "path": "output/report.txt", "sha256": "...", "mediaType": "text/plain" }
  ],
  "verification": {
    "build": { "command": "npm run build", "exitCode": 0 },
    "test": { "command": "npm test", "exitCode": 0 }
  }
}
```

只有 seal 状态、canonical manifest、文件 hash 和验证结果均有效时，产物才可发布。

## 7. 源码生成和执行

源码产物可以由模型 Role 或 CLI Profile 生成和执行。以下是规划中的验证配置形状，当前版本不会自动读取并执行其中的命令：

```json
{
  "runtime": "node",
  "entrypoint": "src/main.ts",
  "commands": ["npm test", "npm run build"],
  "requiredChecks": ["build", "test"]
}
```

执行规则：

- 源码只在隔离 workspace 中执行。
- 运行命令、依赖、输出和退出码全部记录。
- 已由 CLI/Profile 执行且未通过必需检查的源码不能标记为 `verified`；当前 Runtime 不会自动读取上面的 `requiredChecks` 并执行命令。
- “发布源码”和“执行源码”是两个动作。
- 生产项目不执行未经验证的源码产物。

## 8. 产物目录

Run 证据目录：

```text
.ogs/runs/<run-id>/
├── shared/                 # Run 级共享投影；当前不会自动接收每个 Role 的产物
│   ├── artifact/           # 仅显式汇聚/发布流程使用
│   ├── seal-manifest.json
│   ├── artifact-manifest.json  # canonical verified manifest
│   └── verification.json
├── logs/
├── tests/
└── summary.json
```

角色执行证据：

```text
roles/<roleId>/executions/<executionId>/
├── workspace/              # 当前激活的可写 staging
├── artifacts/              # 成功提交后的不可变文件快照
├── artifact-manifest.json  # verified manifest
└── execution-outcome.json
```

业务成果目录：

```text
workspace/deliverables/<deliverable-id>/
├── metadata.json
├── manifest.json
├── src/
├── output/
└── data/
```

发布目录只能由 Promotion Service 写入，不能由角色直接写入。

## 9. 业务数据落地

文件型业务成果直接作为 Deliverable 发布：

```json
{
  "kind": "business_document",
  "format": "text",
  "files": ["output/customer-summary.txt"],
  "sourceRunId": "run-123",
  "sourceRoleIds": ["writer"],
  "verification": "passed"
}
```

结构化业务数据通过适配器提交：

```text
validate -> preview diff -> user confirm -> transaction commit
```

例如，角色输出客户摘要可以先保存为 JSON，再由 `CustomerSummaryAdapter` 写入客户业务实体。角色不能通过写文件绕过领域校验、权限和幂等规则。

## 10. Studio 与 Project Run

两者使用同一套 Runtime 和 Artifact Service，但发布策略不同：

| 场景 | 可生成文件 | 可运行源码 | 默认可发布业务数据 |
| --- | --- | --- | --- |
| Studio dry-run | 仅模拟产物 | 否 | 否 |
| Studio sandbox | 是 | 受限 | 否 |
| Project Run sandbox | 是 | 依授权执行 | 封存并通过显式 Promotion 后可发布文件；业务数据事务否 |
| Project Run real | 是 | 依 Role/Profile 授权开放 | 可显式归档文件；业务数据事务仍未完成 |

Studio 结果页只提供：

- 文件树
- 文本预览
- 构建/测试结果
- 下载产物
- Seal/Verified 状态和 Release Baseline 验收条件

Studio 不写入 Project Deliverables，也不提供业务数据提交入口。Projects Run 才能通过显式控制面操作发布 Deliverable 或提交业务数据适配器。

HTML/SVG 在线预览必须使用隔离 iframe 和严格 CSP：`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'`。禁止 `allow-same-origin`，SVG 默认移除脚本、外部引用和 `on*` 事件属性，单文件在线渲染上限默认为 2 MiB，超限降级为文本查看或下载。当前图片产物默认使用 20 MiB 文件上限；调整该上限需要 Runtime 配置接线或代码变更，并同时受 Run 总量和通用单文件配额约束。

## 11. CLI 接口

现有 `src/runtime/artifact-promotion.ts` 作为共享 Promotion Service，CLI 和 Team Site 都调用它。当前 CLI 已实现封存产物的显式 Promotion；文件列举、检查和验证主要通过 Team Site/API 与 Run 证据目录完成。当前 Role execution 生成的封存包不会自动投影到 Run 级 `shared/artifact`，因此只有已经存在于 `shared/` 且封存报告包含 `passed: true` 的产物才能使用下面的 CLI Promotion。

```bash
ogs run artifact promote <run-id> \
  --source shared/artifact \
  --destination workspace/deliverables/report
```

`promote` 必须满足：Run 已完成、seal 有效、测试报告通过、文件 hash 一致、目标不存在且路径在业务 workspace 内。

## 12. 需要改造的模块

1. `src/runtime/types.ts`、`src/runtime/role-output-parser.ts`：增加候选 artifact 声明和验证清单类型；保持 `StoredRoleResult.artifactRef` 不透明。
2. `src/runtime/artifact-access.ts`、`src/runtime/role-input-projector.ts`、`src/runtime/redaction.ts`：提供 manifest/单文件的授权读取、显式 context.map 投影和脱敏。
3. `src/runtime/workspace-tools.ts`、`src/runtime/artifact-verifier.ts`、`src/runtime/run-artifacts.ts`：实现 execution staging、配额、命令证据、manifest、verification 和 seal。
4. `src/runtime/artifact-promotion.ts`：在现有 SHA-256、Symlink 拒绝、`mkdtemp` + `rename` 原子复制基础上扩展 list/inspect/verify，并供 CLI 与 Team Site 共用。
5. `schemas/*.schema.json`：同步 Role Output、Runtime Config、State/Artifact 相关 Schema。
6. `apps/team-site/infrastructure/file-studio-simulation-store.mjs`：保持通用 `shared/**` 拦截，新增 `readSimulationSealManifest`、`readSimulationVerificationReport`、`readSimulationSealedFile` 等专用只读方法。
7. `apps/team-site/infrastructure/file-deliverable-store.mjs`、`apps/team-site/application/deliverable-use-cases.mjs`：保持 `metadata.json`、`content.json` 和 `record.digest` 兼容，新增 `manifest.json`、`files/` 原子归档和 Business Data Adapter 四步事务流。
8. `apps/team-site/api/studio-simulation-routes.mjs`、`collaboration-project-routes.mjs`、`run-routes.mjs`：分别暴露 Studio 只读预览、Projects 文件预览/Deliverable 发布/业务数据提交接口。
9. `apps/team-site/public/app/components/artifact-canvas.js`：新增严格 CSP 沙箱预览画布；Studio 只读预览，Projects 提供发布控制面。
10. `tests/**`：覆盖契约、持久化/Resume、Promotion、Studio/Projects 隔离、业务数据幂等和前端安全边界。

## 13. 分阶段实施

### 第一阶段：契约门禁

- 固定业务事件；允许候选 `artifacts` 声明。
- 拒绝绝对路径、`..`、空路径和符号链接。
- 保持 `StoredRoleResult.artifactRef` 为 opaque handle。
- 通过 `context.map` + ArtifactResolver 实现显式授权和同步脱敏。

### 第二阶段：持久化门禁

- Execution staging 隔离和配额。
- Verified manifest、verification、seal 和错误路由。
- Checkpoint/Resume 对账及旧/新 Deliverable 恢复兼容。
- 复用现有 Promotion Service。

### 第三阶段：产品门禁

- Studio 专用只读 Artifact API 与预览，不发布业务成果。
- Projects 支持多文件 Deliverable 和安全预览。
- 业务数据适配器实现 `validate -> diff -> confirm -> commit`，提交绑定控制面 principal、CAS stateVersion 和幂等键。

### 第四阶段：格式适配（按需）

- 所有文本类格式直接按 UTF-8 文本读取、写入、哈希和交付；不限制为 Markdown、JSON 或固定扩展名集合。
- DOCX、XLSX、PPTX、PDF、PNG、JPEG、WebP、SVG、压缩包及其他 Git 可存储格式由 CLI 工具/Profile 生成、转换或验证；Runtime 不因格式名称拒绝文件。
- Runtime 只负责安全文件树、字节完整性、哈希、符号链接拒绝、配额和工具验证证据；不把格式转换逻辑塞入 Runtime。

## 14. 三道硬门禁

### 门禁一：契约门禁

- `READY`、`APPROVED`、`REJECTED`、`NEEDS_REWORK`、`BLOCKED` 五个固定业务结果保持不变；审批请求由 Review 控制面表达。
- 角色输出允许候选 `artifacts`，但拒绝绝对路径、`..`、空路径、非法字符和符号链接引用。
- `StoredRoleResult.artifactRef` 保持 opaque；文件清单和文件内容只能通过 ArtifactResolver 读取。
- `context.map` 未声明的 Artifact 读取必须 fail-closed，并写入 `ArtifactAccessAudit`。

### 门禁二：持久化门禁

- 每个 execution 使用独立 staging；成功提交后才生成不可变 verified manifest。
- `verification.json`、`seal-manifest.json`、execution outcome 和 checkpoint 必须可对账。
- 验证失败只能进入已声明的 Runtime ERROR、Retry、Loop 或 Review 路径。
- Resume 必须恢复已提交的 `artifactRef`，丢弃崩溃窗口中的未提交半成品。
- 旧 Deliverable 仍按 `metadata.json`、`content.json` 和 `record.digest` 恢复；新文件树另行校验 manifest digest。

### 门禁三：产品门禁

- Studio 只读预览、下载和 Release Baseline 验收，不写入 Deliverable 或业务数据。
- Projects Run 才能发布多文件 Deliverable。
- `business_data` 必须经过 `validate -> diff -> confirm -> commit`，并绑定 principal、CAS `stateVersion` 和幂等键。
- HTML/SVG 预览必须使用 CSP、无 `allow-same-origin`、无外网连接、大小上限和内容净化。

## 15. 设计原则

- Runtime 管隔离、执行、验证和证据。
- CLI、Team Site 和其他入口调用同一个 Artifact Service。
- 角色生成候选产物，Runtime 验证并生成 opaque 引用，业务层决定是否发布。
- 技术证据和业务成果使用同一套文件模型，但使用不同发布策略。
- 任何业务数据写入都经过 Schema、权限、幂等和审计检查。
- 文本格式统一支持；其他常见格式通过 CLI 工具按需接入，Runtime 保持格式无关。

## 16. 当前实现状态

截至 2026-11-10，当前仓库已经落地：

- 门禁一的候选 `artifacts` 输出解析、相对路径校验、opaque `artifactRef`、显式 ArtifactResolver 授权和访问审计。
- 各模型 backend 和 `local_shell` Profile 的执行目录已接入 per-attempt execution staging；OpenCode、Codex、Qwen 和 Kimi 的 workspace capability policy 已接入其 native tool/permission 边界。
- Codex strict response schema 由 Runtime 生成兼容视图：递归补齐对象 `required`、`additionalProperties:false`，移除后端不接受的组合关键字；原始 Role Schema 仍用于返回侧完整校验。
- 每个 execution 的 clean staging、声明产物路径/符号链接/配额/SHA-256 核验，以及 execution 级 `artifact-manifest.json`、`verification.json`、`seal-manifest.json` 和不可变文件快照。
- 门禁二的 execution staging、Workspace 路径/符号链接/配额安全检查、统一的 SHA-256 manifest/seal 生成、`run/shared/artifacts` 封存文件包读取，以及现有 Promotion Service 的封存校验复用；配置化 verifier 命令仍未完成。
- 门禁三的 Studio 专用 seal/verification/file 只读 API、Projects 多文件 Deliverable 存储、Run 封存文件包归档、旧快照恢复兼容、文件哈希复核、Range 流式媒体响应和 HTML/SVG 预览安全响应头。
- 新增契约、selector、Resolver、Workspace/Verifier、Studio API、Run 文件包和 Deliverable 完整性测试。
- 使用本机真实 Codex `gpt-6-luna` 完成两 Role 端到端协作验证：`debate-minimalist -> debate-judge`，2/2 Role 成功，Run `status=done`，真实 session/message/audit 证据已写入 `.ogs/runs`。
- 2026-11-10 通过已配置的 Codex/OpenCode API 协议完成五个经典团队的真实模型验证；管理咨询发布 Markdown、DOCX、PDF、JSON、CSV、XLSX，正反方辩论发布 PNG、MP4、MP3，`ffprobe`、Pandoc/XeLaTeX 和 SHA-256 manifest/seal 检查通过。CLI 的交互式 login 状态不作为模型可用性判断；dry-run 仍不计入真实模型证据。
- 当前 Role 产物封存配额为：单文件 50 MiB、单次 Role 声明文件总量 200 MiB、最多 500 个文件；图片默认另有 20 MiB 上限。Team Site 非文本封存文件支持最大 256 MiB 的流式读取，不能据此绕过 Runtime 封存配额。

以下内容仍是后续接线工作，当前版本不作为已完成能力宣称：

- 将 `workspace.run` 等 Workspace 工具原语完整暴露给各 CLI 的内层工具循环，并接入配置化 build/test/lint verifier 命令。
- 为新增 backend 接入 workspace capability/permission policy，并补充真实 CLI 文件生成验收。
- 在 `run-artifacts.ts` 中完成 artifact manifest 与 checkpoint/resume 的端到端对账和只读输入挂载。
- 实现 Business Data Adapter 的 `validate -> diff -> confirm -> commit` 事务端口，以及前端 artifact canvas。

核心结论：CLI 的源码、文档、办公文件、图片和音视频生成能力可以纳入当前框架，但必须由 Role/Profile 显式授权并由宿主机工具实际完成格式生成。当前框架已提供文件契约、基础验签和文件交付底座；配置化测试门禁、Run 级汇聚、完整恢复对账和业务数据事务仍是后续建设项。
