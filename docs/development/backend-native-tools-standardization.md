# Backend 内置工具标准化与 Studio 配置方案

## 目的

OGSystem 的团队配置需要表达“角色可以使用哪些能力”，而不是绑定某个模型 backend 的专用工具名称。Codex、OpenCode、Pi 等 backend 的工具协议、权限模型和会话方式不同，因此标准化的边界应放在 Runtime，而不是放在模型提示词或 TeamVersion 的 backend 配置中。

本文是基于当前实现的设计方案。文中标记为“当前”内容来自源码；标记为“目标”内容需要后续实现。

## 当前实现

### Backend 注册与工具能力

Runtime 通过 `BackendRegistry` 注册模型 backend。当前注册的 backend 包括：

- `codex`：通过 Codex App Server 的 stdio JSON-RPC 执行。
- `opencode`：通过本地 OpenCode Server 的 HTTP API 执行。
- `pi`：通过 Pi RPC stdio 会话执行。
- `ollama`、`qwen`、`kimi`：使用各自的 adapter；可用性和模型目录由 adapter 探测。

Backend descriptor 中的 `toolcall: true` 表示该 backend 具有工具调用能力或可承载工具执行，但它不表示已经支持全部 OGS 工具。是否能使用某个具体工具，仍取决于 adapter 的映射和 Runtime 的权限检查。

### 各 backend 的实际边界

| Backend | 当前工具相关能力 | 当前限制 |
| --- | --- | --- |
| Codex | 将 Workspace 读写和命令能力映射为 App Server 的 sandbox、approval policy 和 writable roots | 没有通过 OGS 注入通用自定义工具定义的统一接口 |
| OpenCode | 请求中可以注入 Workspace tools；会话返回工具执行过程 | 已接入的工具主要是 Workspace 原语，业务工具仍需统一适配 |
| Pi | RPC 事件可以报告 `tool_execution_start/end` | OGS 当前没有向 Pi 注册标准工具或代理执行请求 |
| Claude | 当前没有独立 Claude backend；使用 Claude 模型时由实际承载它的 adapter 决定工具能力 | 不能把 Claude 的模型名称当作独立 OGS 工具协议 |
| Ollama/Qwen/Kimi | 已有模型 adapter 和能力发现 | 标准工具注入和调用闭环尚未统一 |
| `local_shell` | 通过 `profiles.json`/`tools.json` 执行固定 CLI 工具 | 它是 Runtime CLI Profile，不是模型原生 Tool Calling |

当前已经存在的 Workspace 原语位于 Runtime 的 `workspace-tools` 和角色能力策略中，包含文件列表、文本读取、文本写入和文本修补。角色 `allowedTools`、Law、Workspace 根目录和配额共同决定这些原语是否可用。

## 标准化边界

### 产品配置只保存标准工具 ID

TeamVersion 的角色契约应引用稳定的标准工具 ID，例如：

```json
{
  "constraints": {
    "allowedTools": [
      "workspace.read",
      "workspace.write",
      "workspace.patch_text"
    ]
  }
}
```

配置不直接保存 `codex.write_file`、OpenCode 私有工具名或 Pi RPC 消息名。backend 专用名称只存在于 Runtime adapter 的映射层。

### CLI 工具保持独立

`local_shell` 用于固定的发布脚本、转换器和其他受控宿主机命令。它继续由 `profiles.json` 绑定到 `tools.json`，并经过现有的命令解析、依赖 Readiness、超时、输出上限和工作区隔离。

模型标准工具和 `local_shell` 不合并成一个执行器：前者由模型发起调用，后者由流程中的 CLI Tool Role 启动。这样可以避免模型获得未经授权的宿主机命令能力。

## 目标标准工具契约

第一阶段只标准化跨 backend 语义稳定的 Workspace 能力：

```text
workspace.list
workspace.read
workspace.write
workspace.patch_text
workspace.run
```

每个标准工具需要有版本化契约：

```json
{
  "toolId": "workspace.write",
  "contractVersion": 1,
  "name": "写入工作区文件",
  "inputSchema": {},
  "outputSchema": {},
  "permissions": ["workspace.write"],
  "sideEffects": "workspace"
}
```

契约维护规则：

- `toolId` 和 `contractVersion` 唯一确定工具语义。
- 兼容性增加沿用原版本；改变输入、输出或副作用时创建新版本。
- 契约不保存 API Key、绝对路径或机器相关命令。
- 每次运行快照记录实际工具契约版本、backend 映射和 adapter 版本。

业务工具（搜索、数据库、外部存储、媒体转换）只有在存在明确的权限边界、输入输出 Schema 和 backend adapter 后才进入标准目录。

## Backend 映射结构

目标调用链如下：

```text
模型 backend 原生调用
        ↓
adapter 解析为标准 toolId
        ↓
Runtime 权限、Law、Workspace、配额和超时检查
        ↓
标准工具执行器
        ↓
标准 Tool Result 和审计事件
```

映射原则：

1. Codex 优先使用 App Server 已有的 sandbox 和 approval 约束；无需把 Codex 的内部权限名称暴露给 TeamVersion。
2. OpenCode 将标准工具转换为请求中的工具定义，并把调用交给 Runtime Workspace 工具实现。
3. Pi 通过 RPC 或 MCP bridge 接收标准工具定义和调用结果；在 bridge 完成前不能宣称 Pi 已支持标准工具。
4. Claude 继续按实际承载它的 adapter 执行；只有出现独立 Claude API adapter 时，才增加独立映射。
5. backend 不支持某项标准工具时，Readiness 返回明确的 unsupported 状态；必需工具阻止真实运行，可选工具产生警告，禁止静默替换为语义不同的工具。

### 统一审计字段

标准工具调用应记录：

```json
{
  "toolId": "workspace.write",
  "contractVersion": 1,
  "backend": "opencode",
  "nativeTool": "write",
  "roleId": "document-writer",
  "executionId": "exec-123",
  "inputDigest": "sha256:...",
  "status": "completed",
  "durationMs": 42
}
```

输入正文和凭据不直接写入审计；需要复核时使用受控的 Workspace 证据和摘要哈希。

## Studio 可视化配置

### 普通模式

角色检查器提供“标准工具”区域：

- 按用途搜索和分类；
- 显示工具说明、权限和副作用；
- 显示当前选定 backend 的支持状态；
- 勾选或移除工具；
- 显示 Readiness 提示。

业务人员只需要选择“角色 → 工具 → 保存团队”，不需要知道 backend 私有名称、RPC 方法或宿主机命令。

### 专业模式

专业人员可以展开：

- 输入和输出 Schema；
- backend 原生映射；
- adapter 和契约版本；
- 权限、配额和副作用；
- 不支持的 backend 及原因；
- `local_shell` Profile 的 command、argsTemplate、stdin、超时和输出上限。

标准模型工具与 `local_shell` 工具分区显示，避免将模型可调用能力误认为宿主机命令。

### 目录与 TeamVersion 的关系

目标增加只读目录接口：

```text
GET /api/v1/platform/standard-tools
```

平台目录提供标准工具契约和 backend 映射状态。TeamVersion 保存角色的标准工具授权和版本引用；运行时把引用解析为当前 backend 的映射，并将解析结果写入运行快照。目录条目不会自动变成可执行命令。

## 维护与发布流程

1. 维护人员新增或修改标准工具契约。
2. 为已支持的 backend 增加 adapter 映射和能力测试。
3. 更新平台目录的版本和 Readiness 投影。
4. 在 Studio 中显示普通模式摘要和专业模式细节。
5. 通过 Codex、OpenCode、Pi 的真实或受控 Sandbox 运行验证输入、输出、权限和审计。
6. 发布新的 Runtime 版本；已有 TeamVersion 继续使用其快照中的契约版本。

首期实现顺序：

1. 统一 `workspace.*` 工具和调用审计。
2. 完成 OpenCode 的标准工具注入。
3. 增加 Pi RPC/MCP bridge。
4. 根据实际需求增加独立 Claude adapter。
5. 最后扩展搜索、数据和外部存储等业务工具。

## 验收标准

- 同一个 TeamVersion 的标准工具授权可以在多个 backend 上解析；
- 不支持的映射在运行前被发现，并给出明确原因；
- 角色权限、Law、Workspace 根目录、文件配额和超时在所有 backend 上保持一致；
- 工具输入、输出、失败和审计字段具有统一语义；
- Studio 普通模式无需编辑 JSON，专业模式仍可查看细节；
- `local_shell` 发布器继续按现有 Profile 机制运行，不被模型工具标准化改造破坏。

