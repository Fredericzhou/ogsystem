# Role Reasoning Effort 适配方案

## 1. 文档目的

本文定义 Role 级 reasoning/thinking 配置的长期适配方案、运行时边界、CLI adapter 映射、验收标准和验收方法。

本阶段只定义运行时 contract、catalog 能力和 adapter 行为，不修改 Visualizer 页面。页面在运行时能力稳定后，根据 catalog 动态能力再接入控件。

本文适用于当前已接入或计划接入的 backend：

```text
opencode / codex / ollama / pi / qwen / kimi
```

当前 CLI 交付重点是 `pi`、`qwen`、`kimi`；`opencode`、`codex`、`ollama` 保留现有 backend 边界。
Gemini 不属于当前交付范围。Ollama 只使用本机 loopback 服务，不连接远程 `OLLAMA_HOST`；本方案暂不宣称 reasoning 能力：catalog 必须返回 `kind: "none"`，明确等级请求返回 `REASONING_UNSUPPORTED`，待有真实协议证据后再单独增加映射。

## 2. 设计结论

Reasoning effort 是模型执行能力参数，不是 Mermaid 图语义，也不是新的证据类型。

统一边界如下：

```text
Role model selection
    -> reasoningEffort
    -> BackendAdapter capability mapping
    -> provider CLI protocol
```

必须遵循：

- Role 配置只保存 OGS 统一字段，不保存 provider 原始参数。
- 不把 reasoning effort 写入 `system.mmd`，模型和推理设置仍属于 selection/config 层。
- 不把 `reasoningEffort` 复用为 OpenCode 专用的 `variant`。
- adapter 必须先发现实际能力，再决定某个等级是否可用。
- 不支持的等级默认 fail-closed，不静默降级。
- Run plan、fingerprint、audit 和 resume 必须保留请求值与实际生效值。
- 不新增 thinking 专用事件库、日志库或 `protocol.ndjson`。
- 继续使用现有证据链：

```text
events.ndjson -> timeline.jsonl
```

## 3. 统一配置 Contract

### 3.1 Canonical 类型

公共类型定义如下：

```ts
export type ReasoningEffort =
  | "auto"
  | "off"
  | "on"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";
```

`on` 是 OGS 的统一 toggle 值，不是 Kimi 或其他 provider 的原始字段。adapter 负责把它映射为 provider 的 `on`（或等价开启值）。`auto` 表示使用 backend/provider/model 的默认设置，属于 OGS 的选择语义，不要求 provider 把 `auto` 暴露为能力等级。

`ReasoningCapability.levels` 只列出 provider 已确认支持的显式 OGS 值，不包含合成值 `auto`：

```ts
type EffortLevel = "off" | "low" | "medium" | "high" | "xhigh" | "max";
type ToggleLevel = "off" | "on";
type ReasoningCapability =
  | { supported: true; kind: "effort"; levels: EffortLevel[]; default?: EffortLevel }
  | { supported: true; kind: "toggle"; levels: ToggleLevel[]; default?: ToggleLevel }
  | { supported: false; kind: "none"; levels: []; default?: never };
```

因此，toggle backend 的 catalog 使用 `levels: ["off", "on"]`；前端可以额外显示 `auto`，但不得把它误报成 provider 能力。

模型选择配置示例：

```json
{
  "configVersion": "3",
  "defaults": {
    "backend": "qwen",
    "modelId": "gpt-6-luna",
    "reasoningEffort": "medium"
  },
  "roles": {
    "planner": {
      "reasoningEffort": "high"
    },
    "extractor": {
      "reasoningEffort": "low"
    }
  }
}
```

Role entry 是 partial override。它可以只声明 `reasoningEffort` 或其他需要覆盖的字段；解析时按 `role override > project default` 合并，合并后仍必须得到完整的 `backend/modelId`。没有项目默认值时，只有包含完整 backend/modelId 的 Role entry 才能解析为可执行选择。

Fallback contract 使用带 backend 的完整解析对象：

```json
{
  "defaults": {
    "backend": "qwen",
    "modelId": "gpt-6-luna",
    "reasoningEffort": "high",
    "fallback": {
      "backend": "pi",
      "modelId": "gpt-6-luna",
      "modelRef": "gpt-6-luna",
      "reasoningEffort": "high"
    }
  }
}
```

Phase A 直接采用 `fallback` 对象，并在解析时补齐 `modelRef`。

生效优先级：

```text
Role override > project default > provider/CLI default
```

当前 `variant` 字段继续表示 backend-native model variant。它和 `reasoningEffort` 不能互相覆盖，也不能由 UI 隐式合并。

### 3.2 能力 Contract

model catalog 的 model entry 应增加可选 reasoning 能力：

```json
{
  "backend": "qwen",
  "modelId": "gpt-6-luna",
  "runnable": true,
  "reasoning": {
    "supported": true,
    "kind": "effort",
    "levels": ["off", "low", "medium", "high", "xhigh", "max"],
    "default": "medium"
  }
}
```

能力类型使用 3.1 定义的 discriminated union；adapter 和 API 校验必须同时约束 `kind` 与 `levels`，例如 `kind: "toggle"` 不能返回 `low`，`kind: "none"` 不能返回任何等级。

`levels` 必须来自真实 CLI/ACP/RPC 探测或可信的 adapter 版本规则。不能根据 `modelId` 字符串推测。

### 3.3 Runtime request

`ExecutorBinding` 和 `BackendExecuteRequest` 应分别携带：

```ts
reasoningEffort?: ReasoningEffort;
```

adapter 返回或记录：

```ts
requestedReasoningEffort?: ReasoningEffort;
effectiveReasoningEffort?: Exclude<ReasoningEffort, "auto">;
reasoningCapability?: ReasoningCapability;
```

`requestedReasoningEffort` 是 OGS 请求值，`effectiveReasoningEffort` 是 provider 实际接受后归一化回 OGS 的显式值。两者不能混为一个字段；provider 原始值只允许留在 adapter 内部或冻结 plan 的恢复材料中。

执行解析还必须保留一个可冻结的 capability snapshot。`auto` 在新 Run 首次执行时解析为 provider 返回的实际显式等级；如果 provider 没有返回可重放的实际值，执行结果可以记录为未知，但该 Run 的 resume 必须 fail-closed。

## 4. low / medium / high 语义

这些等级控制推理预算、推理深度或 provider 的 effort 参数，不代表模型版本变化，也不保证正确率按比例提升。

| 等级 | 典型用途 | 延迟/成本 | 说明 |
| --- | --- | --- | --- |
| `off` | 简单提取、格式转换、短文本分类 | 最低 | 不主动使用 reasoning 能力 |
| `low` | 轻量判断、简单修复、高吞吐任务 | 较低 | 使用有限推理预算 |
| `medium` | 普通分析、审查、一般编程任务 | 平衡 | 推荐的通用默认值 |
| `high` | 多步规划、复杂调试、架构判断 | 较高 | 获得更多推理预算，仍不保证正确 |
| `xhigh` / `max` | 极复杂任务 | 最高 | 只有实际能力声明支持时才可用 |

运行时不得用等级自动修改 `timeoutMs`、`maxOutputBytes` 或 retry 次数。可以在 readiness 阶段提示高等级可能需要更长 timeout，但最终配置必须显式可追踪。

## 5. Backend 映射策略

### 5.1 OpenCode

- 将统一 `reasoningEffort` 映射到 OpenCode SDK 支持的 `reasoningEffort` 或等价 model option。
- `variant` 只处理 OpenCode model variant。
- 发现不到某个等级时，catalog 不标记该等级。
- Phase A 必须移除当前 `args.variant ?? args.reasoningEffort` 的合并路径；reasoning 只能从独立的 `reasoningEffort` 字段进入 adapter，并增加回归测试证明 variant 不会改变 reasoning。

### 5.2 Codex

- 将统一等级映射到 app-server turn 的 reasoning 参数。
- 不把 `reasoningEffort` 拼接到 model ID。
- Codex 不支持的等级必须在 probe 或执行前返回稳定错误。

### 5.3 Pi

Pi RPC 支持 `set_thinking_level` 和 `get_available_thinking_levels`。

- 每次 session 创建后读取可用等级。
- 每次 Role 执行前，若当前等级不同，发送 `set_thinking_level`。
- session resume 后重新确认等级，不能假定旧进程状态仍然存在。
- provider/model 使用 `provider/model` 形式时，model ID 仍保持 backend-local 语义。

### 5.4 Qwen ACP

Qwen ACP 当前通过 session 配置暴露 reasoning effort。adapter 应：

- 从 `session/new` 的 config options 读取实际等级。
- 使用 ACP 配置方法设置 `reasoning_effort`。
- 记录实际配置值，而不是只记录 OGS 请求值。
- 首次 ACP prompt 可能较慢，minimum probe 使用足够的启动窗口；当前实现使用 60 秒上限。

### 5.5 Kimi ACP

当前 Kimi Code 2.4.1 通过 `kimi acp` 提供 OGS 会话接口；模型请求使用本机 provider 配置的
OpenAI Responses API。当前 `ogs-codex` provider 指向 `http://43.134.72.68:8080`，模型为
`gpt-6-luna`。OGS 不另外拼接 Chat Completions 请求。

当前 ACP 对 `gpt-6-luna` 暴露的是 thinking `off/on`，不是 low/medium/high 多级 effort。

- `auto` 使用 Kimi 配置默认值，不写入 `levels`。
- `off` 映射为 Kimi `off`，`on` 映射为 Kimi `on`。
- 当前 `gpt-6-luna` 仅可声明 `levels: ["off", "on"]`；只有 Kimi catalog 由真实探测确认支持时才允许 `low/medium/high`。
- 不得把多个等级静默映射为同一个 `on`，否则审计结果会误导用户。
- Kimi 配置中声明的 `api_key_env` 必须存在于启动 `ogs` 的父进程环境；不得把 token 写入
  `.ogs`、model selection、run plan 或 audit。Discovery 报 authentication required 时，应先
  确认运行环境继承了该变量，再判断 provider/API endpoint 状态。

### 5.6 Ollama

Ollama 保持现有模型执行 backend，但只连接本机 loopback 服务，且本交付不猜测其 reasoning 协议：

- catalog entry 必须包含 `reasoning: { supported: false, kind: "none", levels: [] }`。
- `auto` 可以沿用 provider 默认行为；`off` 或任意显式 effort/toggle 值只有在 adapter 有明确协议证据时才允许。
- 对未声明支持的显式值返回 `REASONING_UNSUPPORTED`，不得把请求转换为 prompt 文本或静默忽略。
- 后续增加 Ollama 映射时，必须新增版本绑定的 fixture、能力探测和验收记录。

### 5.7 Adapter 长期扩展边界

每个 backend adapter 只实现同一组生命周期操作，provider 字段只留在 adapter 内部：

```ts
type ReasoningAdapter = {
  discoverCapability(input: DiscoveryInput): Promise<ReasoningCapabilityResult>;
  resolve(input: {
    requested: ReasoningEffort;
    capability: ReasoningCapability;
  }): Promise<ReasoningResolution>;
  apply(input: {
    session: AdapterSession;
    resolution: ReasoningResolution;
  }): Promise<AppliedReasoning>;
};
```

以上是 backend 内部 adapter boundary 的示意类型，不是前端需要实现的接口；前端只依赖第 9 节 HTTP contract。

其中 `ReasoningResolution` 至少包含 `requested`, `effective?`, `kind`, `supported` 和 `capabilityDigest`；`providerValue` 只能作为 adapter 内部或冻结 plan 的恢复材料，不能进入 selection 配置。`effective` 缺失表示 provider 没有返回可复现值，允许记录本次结果但不允许 resume。

`discoverCapability` 负责真实探测和证据版本，`resolve` 负责 canonical 值到 provider 值的映射，`apply` 负责 session 创建或恢复后的设置。执行器只依赖 `ReasoningResolution`、`AppliedReasoning` 和稳定错误码，不依赖 ACP/RPC 参数名称。新增 provider 只需实现这三个边界并增加 fixture/版本矩阵，不改变 Role schema、事件格式或前端接口。

## 6. 配置失败与降级策略

默认策略是 fail-closed：

| 情况 | 结果 |
| --- | --- |
| 模型不支持 reasoning | 只有 `auto` 或 `off` 可用 |
| 请求等级不在 catalog levels | readiness 阻断，执行前失败 |
| provider 拒绝设置等级 | Role 执行失败并记录稳定错误码 |
| ACP/RPC 不返回能力信息 | 视为未知，不宣称支持高等级 |
| resume 后等级无法恢复 | 记录 session recovery failure，禁止静默继续 |
| fallback backend 不支持原等级 | fallback 阻断，除非未来显式配置 fallback effort |

不建议第一版增加自动降级字段。若未来确有需要，应使用明确字段：

```json
{
  "reasoningEffort": "high",
  "unsupportedReasoningPolicy": "fail"
}
```

后续如增加 `degrade_to_auto`，必须同时记录原始请求值和实际生效值。

### 6.1 Capability unknown、stale catalog 与三个运行场景

`capability unknown` 和 `catalog stale` 不能用一个全局阻断规则处理。必须区分配置保存、新 Run 和 resume：

| 场景 | 规则 |
| --- | --- |
| 保存新配置 | fresh catalog 已确认的显式值才可保存；未知能力只允许 `auto`（以及 adapter 明确声明始终可用的 `off`），不得保存 `on/low/medium/high/xhigh/max`。stale catalog 下同样不得新增未经确认的显式高等级。 |
| 新 Run | 对已通过校验且已有固定选择的配置，stale catalog 可按现有“警告但允许运行”策略执行；fresh unknown 或本次新选择的未知显式值必须在启动前阻断。`auto` 必须在启动时解析并写入 frozen plan。 |
| resume | 只使用 frozen run plan 中的 requested/effective 值和 capability snapshot，不重新读取当前 provider 默认值，也不依赖当前 catalog 新鲜度；snapshot 缺失、等级无法重新设置或无法证明 exact setting 时 fail-closed。 |

保存阶段的 `auto` 只表示“以后在新 Run 解析 provider 默认”；它不是对当前 provider 能力的永久背书。新 Run 一旦开始，实际生效值必须冻结到 plan 和 audit。

## 7. Run、Resume 与 Evidence

### 7.1 Plan fingerprint

`reasoningEffort` 是可执行输入，必须进入 run plan fingerprint。相同 graph、model 和 prompt，但 reasoning 等级不同，应产生不同 fingerprint。

primary 和 fallback 的 resolved backend、modelId、modelRef、requested/effective reasoning 以及 capability snapshot digest 都必须进入 fingerprint。不能用未解析的 provider 默认代替实际值。

### 7.2 Audit

Role execution audit 至少记录：

```json
{
  "requestedReasoningEffort": "high",
  "effectiveReasoningEffort": "high",
  "reasoningKind": "effort",
  "reasoningSupported": true
}
```

字段必须沿以下单向链路传递，不能在 Role 层重新猜测：

```text
BackendExecuteResult
  -> ExecutorResult
  -> role-executor executionResult
  -> AuditRecordInput
  -> AuditRecord
  -> events.ndjson / timeline.jsonl
```

成功和失败记录都应包含 `requestedReasoningEffort`、`effectiveReasoningEffort`、`reasoningKind`、`reasoningSupported`；失败时还要携带稳定的 `reasoningErrorCode`，至少支持 `REASONING_UNSUPPORTED`、`REASONING_CONFIG_FAILED`、`REASONING_CAPABILITY_UNKNOWN`。这些只是现有 audit/event 的 metadata，不创建新的 evidence 文件。

只记录配置、能力和 provider 返回的有限计量信息，不记录完整思维内容，不新增 evidence chain。

### 7.3 Resume/retry

- retry 必须沿用原 Role 的 reasoning 配置。
- 新 Run 开始时将 requested、解析后的 effective、capability snapshot 和 adapter/CLI 版本写入冻结 run plan；`auto` 也必须在此时得到可复现的 effective 值。
- resume 必须从冻结 run plan 恢复，不重新读取当前 provider 默认值覆盖旧设置。若 provider 只能接受默认值而不能重放冻结的 effective 值，resume 必须报告恢复失败并停止。
- session recreation 后必须重新设置 reasoning effort。
- fallback model 使用相同等级时，必须重新做 capability check，并使用已经解析的 fallback backend/model/reasoning 对象。

## 8. 推荐实施顺序

### Phase A: Contract

- 增加 `ReasoningEffort` 和 `ReasoningCapability` 类型。
- 增加 selection schema 和 plan fingerprint 字段；Role override 必须允许 partial entry，并在合并后校验完整 backend/modelId。
- 将 fallback contract 固定为 `{ backend, modelId, modelRef, reasoningEffort? }`，解析和 fingerprint 都使用完整 resolved 结构。
- 将 OpenCode 的 reasoning 与 `variant` 完全分离，删除 `args.variant ?? args.reasoningEffort` 路径并加入回归测试。
- 增加稳定错误码：`REASONING_UNSUPPORTED`、`REASONING_CONFIG_FAILED`、`REASONING_CAPABILITY_UNKNOWN`。
- 保持 Visualizer 页面不变。

### Phase B: Discovery

- 扩展 catalog schema。
- Pi 读取 `get_available_thinking_levels`。
- Qwen 读取 ACP config options。
- Kimi 读取 `thinking` 配置能力。
- Ollama 返回 `kind: "none"`，不猜测或伪造 reasoning levels。
- OpenCode/Codex 通过 adapter probe 验证可用等级。

### Phase C: Execution

- Executor 将字段传入 adapter。
- adapter 在 session 创建或 Role 执行前设置实际等级。
- 记录 requested/effective 两个值。
- 将 `BackendExecuteResult -> ExecutorResult -> AuditRecordInput -> AuditRecord` 的 reasoning 字段和稳定错误码贯通到现有事件流。
- 覆盖 timeout、取消、resume、fallback 和 session recreation。

### Phase D: Verification

- 先执行 fixture adapter 测试，再执行真实本机 CLI 探测。
- 更新绑定 CLI 版本、adapter 版本和 fixture 证据的兼容矩阵。
- 页面只读取 catalog 能力，不维护第二份 backend capability 列表。

### Phase E: Visualizer

只有 Phase A-D 全部通过后，才增加 Role 配置控件。控件必须根据 catalog 动态渲染：

- `kind=effort`：显示可用等级。
- `kind=toggle`：显示开关。
- `kind=none`：显示不可用原因。
- catalog stale 或 capability unknown：禁止提交高等级配置。

## 9. 前端对接接口

本节是前端可以直接依赖的 HTTP contract。它只暴露 OGS 统一字段，不暴露 Qwen ACP、Kimi ACP 或 Pi RPC 的原始参数。

### 9.1 读取项目能力和当前选择

继续使用现有接口：

```http
GET /api/project
```

响应中的模型相关字段应保持以下结构：

```json
{
  "modelCatalog": {
    "catalogVersion": "3",
    "generatedAt": "2026-11-03T04:00:00.000Z",
    "sources": [
      {
        "backend": "qwen",
        "displayName": "Qwen Code",
        "transport": "acp-stdio",
        "sessionKind": "process-session",
        "processOwnership": "spawned_by_ogs",
        "status": "runnable",
        "detail": "Qwen ACP ready"
      }
    ],
    "models": [
      {
        "backend": "qwen",
        "modelId": "gpt-6-luna",
        "name": "GPT-6 Luna",
        "runnable": true,
        "reasoning": {
          "supported": true,
          "kind": "effort",
          "levels": ["off", "low", "medium", "high", "xhigh", "max"],
          "default": "medium"
        }
      }
    ]
  },
  "modelSelection": {
    "configVersion": "3",
    "defaults": {
      "backend": "qwen",
      "modelId": "gpt-6-luna",
      "reasoningEffort": "medium"
    },
    "roles": {
      "planner": {
        "reasoningEffort": "high"
      }
    }
  },
  "resolvedModelSelection": {
    "planner": {
      "backend": "qwen",
      "modelId": "gpt-6-luna",
      "reasoningEffort": "high",
      "reasoning": {
        "supported": true,
        "kind": "effort",
        "levels": ["off", "low", "medium", "high", "xhigh", "max"],
        "default": "medium"
      }
    }
  },
  "modelSelectionWarnings": []
}
```

`levels` 不包含 `auto`。前端可以在任何 capability 选择器中提供一个 OGS canonical 的 `auto` 选项；提交后由后端在新 Run 解析 provider 默认并冻结 effective 值。前端不得从 `sources` 推断模型能力，也不得自行拼接 `backend/modelId` 来猜测等级。Role 控件应使用 `resolvedModelSelection[roleId].reasoning`。

### 9.2 刷新实时能力

继续使用现有接口：

```http
POST /api/project/models/sync
Content-Type: application/json
```

响应：

```json
{
  "status": "ok",
  "catalogPath": ".ogs/model-catalog.json",
  "selectionPath": ".ogs/model-selection.json",
  "catalog": {},
  "selection": {},
  "warnings": []
}
```

同步操作可以更新 catalog，但不能覆盖用户已经保存的 model selection。前端刷新完成后应重新请求 `GET /api/project`，不要只合并局部响应。

### 9.3 预校验 Role 选择

新增稳定接口：

```http
POST /api/project/model-selection/validate
Content-Type: application/json
```

请求：

```json
{
  "selection": {
    "configVersion": "3",
    "defaults": {
      "backend": "qwen",
      "modelId": "gpt-6-luna",
      "reasoningEffort": "high"
    },
    "roles": {
      "reviewer": {
        "backend": "kimi",
        "modelId": "gpt-6-luna",
        "reasoningEffort": "high"
      }
    }
  },
  "expectedSelectionDigest": "sha256:..."
}
```

成功响应：

```json
{
  "valid": true,
  "selection": {},
  "resolvedByRoleId": {},
  "issues": [],
  "warnings": []
}
```

不支持 Kimi `high` 时，响应必须是结构化问题，而不是 HTTP 200 加一段普通文本：

```json
{
  "valid": false,
  "issues": [
    {
      "code": "REASONING_UNSUPPORTED",
      "path": "roles.reviewer.reasoningEffort",
      "roleId": "reviewer",
      "backend": "kimi",
      "modelId": "gpt-6-luna",
      "requested": "high",
      "supported": ["off", "on"],
      "autoAllowed": true,
      "message": "The selected Kimi model does not expose high reasoning effort."
    }
  ],
  "warnings": []
}
```

### 9.4 原子保存 Role 选择

新增稳定接口：

```http
PUT /api/project/model-selection
Content-Type: application/json
```

请求结构与 validate 相同，必须携带：

```json
{
  "expectedSelectionDigest": "sha256:...",
  "selection": {}
}
```

保存规则：

- 服务端重新执行 schema、catalog capability 和 Role resolution 校验。
- `valid=false` 时不写文件，返回 `422 MODEL_SELECTION_INVALID`。
- digest 不匹配时不写文件，返回 `409 MODEL_SELECTION_CONFLICT`。
- 成功时原子写入 `.ogs/model-selection.json`，返回新 digest 和 resolved selection。
- 不修改 `system.mmd`、Role package 或运行中的 Run。

成功响应：

```json
{
  "status": "saved",
  "selectionDigest": "sha256:new-digest",
  "selection": {},
  "resolvedByRoleId": {},
  "warnings": []
}
```

### 9.5 通用错误 envelope

前端沿用当前 API 的统一错误格式：

```json
{
  "error": {
    "code": "REASONING_CAPABILITY_UNKNOWN",
    "message": "Reasoning capability is not known for qwen/gpt-6-luna.",
    "details": {
      "backend": "qwen",
      "modelId": "gpt-6-luna",
      "catalogGeneratedAt": "2026-11-03T04:00:00.000Z",
      "nextAction": "Run POST /api/project/models/sync."
    }
  }
}
```

前端处理规则：

| 错误码 | 前端行为 |
| --- | --- |
| `REASONING_UNSUPPORTED` | 禁止提交，展示实际支持等级 |
| `REASONING_CAPABILITY_UNKNOWN` | 要求刷新 catalog，不允许选择高等级 |
| `REASONING_CONFIG_FAILED` | 保留草稿，显示 provider/adapter 诊断 |
| `MODEL_SELECTION_INVALID` | 定位到字段路径，不覆盖当前保存值 |
| `MODEL_SELECTION_CONFLICT` | 重新加载项目后由用户重新确认 |
| `MODEL_CATALOG_STALE` | 显示刷新动作，不能自动改写选择 |

### 9.6 前端状态模型

前端只需要维护三类状态：

```ts
type ReasoningUiState = {
  requested: ReasoningEffort;
  effective?: string;
  capability: ReasoningCapability | null;
  loading: boolean;
  dirty: boolean;
  issues: Array<{ code: string; path?: string; message: string }>;
};
```

页面不维护 provider capability 白名单，不把 capability 写入浏览器 localStorage，也不从模型名称解析 reasoning 等级。

### 9.7 前端接口验收

- [ ] `GET /api/project` 同时返回 catalog、当前 selection 和 resolved selection。
- [ ] `POST /api/project/models/sync` 后前端重新加载完整项目上下文。
- [ ] validate 接口不会写入文件。
- [ ] invalid selection 不会覆盖旧 selection。
- [ ] digest conflict 不会覆盖其他客户端的修改。
- [ ] unsupported reasoning 返回 `REASONING_UNSUPPORTED` 和 supported levels。
- [ ] capability unknown 不允许前端提交 high/xhigh/max。
- [ ] 保存成功后返回新 digest，前端更新本地 revision。
- [ ] 前端不需要读取 provider 原始协议字段。

## 10. 验收标准

### A. Contract 验收

- [ ] selection schema 接受合法 `reasoningEffort`，拒绝未知值。
- [ ] canonical 枚举包含 `auto/off/on/low/medium/high/xhigh/max`；`auto` 不进入 catalog `levels`。
- [ ] 默认值为 `auto` 或未设置时使用 provider 默认值，并在新 Run 的 frozen plan 中写入 effective 值。
- [ ] partial Role override 可以只声明 `reasoningEffort`，合并后缺少 backend/modelId 时才报配置错误。
- [ ] Role override 覆盖 project default。
- [ ] primary/fallback 的完整 resolved backend/model/modelRef/reasoning 和 capability snapshot 进入 plan fingerprint。
- [ ] OpenCode 的 `variant` 不会改变 reasoning；不再执行 `variant ?? reasoningEffort`。
- [ ] fallback 使用对象 contract，不依赖隐含 backend 的旧字段。

### B. Capability 验收

- [ ] catalog 能记录 `supported/kind/levels/default`。
- [ ] Pi 能读取实际 thinking levels。
- [ ] Qwen 能读取 ACP reasoning options。
- [ ] Kimi 能正确表达 `off/on`，不伪造 low/medium/high。
- [ ] Ollama 返回 `kind: "none"`，显式 reasoning 请求稳定失败。
- [ ] 未知能力不会被标记为 runnable effort。
- [ ] catalog 记录探测所绑定的 CLI/adapter 版本和 fixture 证据。

### C. Execution 验收

- [ ] `off/low/medium/high` 在支持的 backend 上传递到 provider。
- [ ] `on` 只在 toggle capability 声明支持时上传递到 provider。
- [ ] provider 拒绝不支持等级时返回稳定错误码。
- [ ] `BackendExecuteResult -> ExecutorResult -> AuditRecordInput -> AuditRecord` 保留 reasoning 字段和错误码。
- [ ] retry 使用相同 reasoning 设置。
- [ ] resume/session recreation 使用 frozen effective 值重新应用 reasoning 设置，不重新读取 provider 默认。
- [ ] `auto` 在新 Run 解析后被冻结；无法重放时 resume fail-closed。
- [ ] fallback backend 使用完整 resolved contract 并重新检查能力。
- [ ] timeout、abort、non-zero exit 不会遗留 OGS-owned process。

### D. Evidence 验收

- [ ] audit 记录 requested/effective reasoning effort。
- [ ] `events.ndjson` 仍是唯一事件源。
- [ ] `timeline.jsonl` 可从事件源重新生成。
- [ ] 不生成 `protocol.ndjson` 或 thinking 专用证据文件。
- [ ] 凭据、完整思维内容和原始 permission payload 不进入 artifacts。
- [ ] 成功和失败 audit 都能携带 `requestedReasoningEffort`、`effectiveReasoningEffort`、`reasoningKind`、`reasoningSupported`；失败时有稳定 reasoning error code。

### E. Capability 场景验收

- [ ] 保存新配置时，fresh unknown 不允许保存 `on/low/medium/high/xhigh/max`；`auto` 按 provider default 语义保存。
- [ ] 新 Run 对 stale catalog 下已固定且已校验的选择按现有策略允许运行，并对 freshness 给出 warning。
- [ ] 新 Run 对 fresh unknown 或本次新增的未知显式等级在启动前阻断。
- [ ] resume 不依赖当前 catalog；缺少 frozen capability snapshot 或无法 exact restore 时 fail-closed。

### F. Regression 验收

- [ ] `pnpm build` 通过。
- [ ] 完整 `pnpm test` 通过。
- [ ] targeted contract/adapter tests 通过。
- [ ] `ogs doctor` 通过。
- [ ] `models discover` 能反映真实 backend 状态。
- [ ] dry-run 不调用真实模型但能保留 reasoning 配置到 plan/audit。
- [ ] 实际 CLI prompt 至少完成一次成功、一次取消或超时、一次不支持等级。

## 11. 验收方法

### 11.1 静态与 schema

```bash
pnpm build
pnpm exec tsc -p tsconfig.json --noEmit
git diff --check
```

检查项：

- schema、TypeScript 类型和 runtime parser 使用同一枚举。
- 没有直接从 Visualizer 读取 provider 原始字段。
- 没有新增第二事件存储。

### 11.2 Fixture adapter

使用假的 stdio RPC/ACP server，覆盖：

1. 返回 `off/low/medium/high` 能力。
2. 只返回 `off/on` 能力。
3. 返回未知能力。
4. 拒绝 `set reasoning`。
5. session resume 后等级丢失。
6. prompt 超时、取消、非零退出。
7. 超过最大输出限制。

每个 fixture 都检查：退出码、稳定错误码、process cleanup、audit 字段和事件投影。

### 11.3 真实 CLI

在具有 provider 凭据的登录 shell 中运行：

```bash
zsh -lic 'cd /path/to/ogsystem && pnpm exec tsx src/runtime/cli.ts models discover --ogs-dir .'
zsh -lic 'cd /path/to/ogsystem && pnpm exec tsx src/runtime/doctor.ts --ogs-dir .'
```

记录每个 backend：

```text
CLI version
backend ID
model ID
transport
session kind
process ownership
reasoning kind
supported levels
default level
minimum prompt result
```

每条记录必须绑定 OGSystem revision、adapter 版本、CLI 版本和 fixture 版本。当前机器上 Pi/Qwen/Kimi 的一次成功 prompt 只能作为该版本的运行证据，不能直接写成 provider 的长期协议；后续版本变化必须重新探测并更新矩阵。

真实验证必须区分：

- 未安装。
- 已安装但未认证。
- session 可创建但 prompt 失败。
- prompt 成功。
- provider 限流、地区限制或网络错误。

### 11.4 端到端 Run

为每个支持 reasoning 的 backend 准备一个最小系统：

```text
Start -> planner -> End
```

分别运行 `off`、`low`、`medium`、`high`（仅限 catalog 宣称支持的值），并检查：

```bash
pnpm exec tsx src/runtime/cli.ts run start \
  --system examples/target-model-binding-system.mmd \
  --input "reasoning adapter verification" \
  --ogs-dir .
```

检查 run directory：

- frozen plan 中有 reasoning 请求值。
- role audit 中有 requested/effective 值。
- `events.ndjson` 有标准化事件。
- `timeline.jsonl` 可重新投影。
- session 关闭后不存在 OGS-owned 残留进程。

### 11.5 Resume 与 fallback

测试步骤：

1. 使用 `high` 启动一个可恢复 Role。
2. 在 prompt 完成前停止进程。
3. 执行 `run resume`。
4. 检查恢复后的 session 重新设置了原等级。
5. 切换到不支持该等级的 fallback backend。
6. 确认执行被稳定阻断，而不是静默降级。

### 11.6 证据重放

```bash
pnpm test
```

用事件投影测试确认：删除或重建 `timeline.jsonl` 后，可以只从 `events.ndjson` 重新生成相同 timeline，且 reasoning metadata 不产生第二证据链。

## 12. 验收记录模板

每次 CLI 或 provider 版本变化时，保存一份简短记录：

```text
Date:
OGSystem revision:
CLI:
CLI version:
Backend:
Model:
Transport:
Session kind:
Process ownership:
Reasoning kind:
Supported levels:
Default level:
Probe result:
Execution result:
Resume result:
Cancellation result:
Known limitation:
Evidence directory:
```

认证失败、地区限制和 provider 限流属于环境结果，不能直接判定 adapter 代码失败；但 adapter 必须返回稳定状态和可执行的修复提示。

## 13. 长期维护判断

当 provider 改变参数名称、CLI 增加等级或 ACP/RPC 增加配置项时，只允许修改对应 adapter、能力探测和兼容测试。

以下变化不应要求修改 Mermaid 语义或历史运行数据：

- provider 参数名称变化。
- CLI transport 变化。
- model catalog 中新增 reasoning level。
- backend 从 toggle 能力升级为 effort 能力。

只有 OGS 统一 reasoning contract 本身发生语义变化时，才允许修改公共类型、schema、fingerprint 和验收矩阵。任何 provider-specific 字段进入 Role 语义或形成第二证据系统，都视为架构回归。

## 14. 本机 Backend 验证记录

验证日期：2026-11-03。使用本机已配置的 Responses endpoint `http://43.134.72.68:8080`，通过 OGS backend discovery 和最小 JSON prompt probe 验证。记录不包含认证信息。

| Backend | CLI / 服务版本 | Probe 模型 | 结果 |
| --- | --- | --- | --- |
| Codex | `codex-cli 0.166.0` | `gpt-6-luna` | 通过，App Server discovery 与 prompt probe 均为 runnable |
| OpenCode | `1.18.20` | `codex-gateway/gpt-6-luna` | 通过，configured model prompt probe 成功 |
| Pi | `1.5.0` | `gpt-6-luna` | 通过，RPC discovery 与 prompt probe 均为 runnable |
| Qwen Code | `0.26.6` | `gpt-6-luna` | 通过，ACP discovery 与 prompt probe 均为 runnable |
| Kimi Code | `2.4.1` | `gpt-6-luna` | 通过，ACP discovery 与 prompt probe 重试成功；首次全量探测曾短暂失败 |
| Ollama | `0.40.13` | 本机 `llama3.2:latest` | 通过，本机服务 probe 成功，发现 5 个本地模型 |

本次修正让项目已有的默认、Role 和 fallback 模型优先参与 minimum probe，避免 catalog 首项不可用时误判整个 backend。无模型选择时仍使用首个 runnable catalog 项；新建项目如依赖该默认行为，应在选定默认模型后再次执行 discovery 验证。
