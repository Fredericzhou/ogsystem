# OpenCode Model Selection Redesign Plan

Date: 2026-04-21  
Status: proposed

## 1. Decision Summary

本文件是下一版本的 redesign 提案，按未发布开发态直接 cutover 制定，不要求兼容当前开发版本的旧模型配置路径。

长期方向仍然是：

- 以本机 OpenCode 已解析出的模型清单为事实来源
- 用户配置只写 OpenCode SDK 可直接消费的模型引用与执行参数
- 支持 project 级默认值，以及 system / role 级覆盖
- `project init/create` 默认生成可运行的最小模板，而不是空壳
- runtime 与 test 都只读取显式项目配置，不按环境猜 provider

当前仓库现状仍然有三点需要正视：

- `providerAliases` 已在 2026-04-21 作为显式配置路径交付并验证
- `og-models/models/<modelId>/model.json` 仍深度参与 runtime setup、fingerprint、resume 与测试
- 若要切到新方案，必须同步补齐 runtime-setup、resume/fingerprint、nl2mmd/parser 与脚手架切换

因此，这份文档的正确定位是：

- 同意长期方向
- 直接定义下一版 cutover 边界
- 不为旧开发态提供额外兼容层

## 2. Current Problems

当前实现存在四个结构性问题：

1. `og-models/models/<modelId>/model.json` 是目录型配置，路径深、心智负担高，不适合作为用户主入口。
2. 仓库内默认模型仍写死为 `openai/gpt-5.4`，但本机 OpenCode 实际可用模型可能是 `gkgk/gpt-5.4` 这类 provider/model 组合，导致最小模板开箱即失败。
3. `opencode.providerAliases` 引入了额外映射层，用户需要同时理解 canonical 前缀、本地 provider id、runtime remap，排障成本高。
4. `project init/create` 当前虽然能生成模板，但模型侧仍偏“仓库模板复制”，而不是“基于本机 OpenCode 能力生成 runnable config”。

当前代码中，这些问题主要落在以下位置：

- `src/runtime/project-lifecycle.ts`
- `src/runtime/runtime-loader.ts`
- `src/runtime/config.ts`
- `src/runtime/model-repo.ts`
- `src/runtime/opencode-executor.ts`
- `og-models/models/*/model.json`
- `schemas/runtime-config.schema.json`

## 3. Design Principles

### 3.1 Discovery Source, Not Runtime Authority

模型发现应以 `opencode models --verbose` 的输出为准，而不是以仓库内的静态 `og-models/catalog/opencode-models.json` 为准。

本机 2026-04-21 实测中，`opencode models` 已直接暴露 `gkgk/gpt-5.4`，说明脚手架与诊断逻辑应消费 OpenCode 的已解析结果，而不是继续假设 canonical `openai/*` 前缀一定可用。

但 `.ogs/model-catalog.json` 应降级为 advisory snapshot：

- 适合 `project init/create`
- 适合 `project sync-models`
- 适合 `ogs doctor`
- 不适合作为 runtime 硬失败依据

原因：

- catalog 只是某一时刻快照，天然可能过期
- runtime 若把 catalog 当事实源，会制造“配置本来可跑，但快照过期导致假阴性”的问题

### 3.2 Direct Runtime Refs

用户配置中的 concrete model 必须直接写成 OpenCode SDK 可消费的引用，例如：

```json
{
  "model": "gkgk/gpt-5.4",
  "variant": "medium"
}
```

不再增加 `openai -> gkgk` 这类 provider remap 关系。

### 3.3 Stable System, Local Selection

系统图描述角色拓扑与执行意图；机器相关的 provider/model 选择放到 `.ogs/` 下的本地配置中。这样：

- `system.mmd` 不必跟随本机 provider id 频繁改动
- 模型升级、切换 provider、切换 variant 时无需改系统图
- 同一个系统可以在不同机器上用不同 provider/model 组合运行

### 3.4 Explicit Over Implicit

runtime、tests、CLI scaffolding 统一依赖显式文件：

- `.ogs/model-selection.json`
- `.ogs/runtime.json`
- 可选的 `.ogs/model-catalog.json`

不通过环境探测、机器状态猜测、源码内置特殊分支来决定 provider。

更准确地说：

- runtime 权威输入应是 `model-selection + explicit direct ref`
- catalog 只是脚手架、提示与诊断输入

## 4. Target Architecture

### 4.1 New Files

### 4.1.1 `.ogs/model-catalog.json`

用途：

- 自动生成
- 只读快照
- 表示“某次同步时这台机器上的 OpenCode 能跑什么”

建议结构：

```json
{
  "catalogVersion": "1",
  "generatedAt": "2026-04-21T09:00:00.000Z",
  "source": {
    "command": "opencode models --verbose"
  },
  "models": [
    {
      "ref": "gkgk/gpt-5.4",
      "provider": "gkgk",
      "model": "gpt-5.4",
      "name": "GPT-5.4",
      "status": "active",
      "capabilities": {
        "textInput": true,
        "textOutput": true,
        "toolcall": true
      },
      "variants": [],
      "raw": {
        "id": "gpt-5.4",
        "providerID": "gkgk"
      }
    }
  ]
}
```

约束：

- 由 CLI 生成与刷新，不要求用户手写
- 保留足够 metadata 供脚手架与 doctor 使用
- `raw` 可选；若保留，必须是裁剪后的调试字段，不直接无脑复制全部上游对象
- runtime 不应仅因 catalog 缺失、过期或未命中而直接失败

### 4.1.2 `.ogs/model-selection.json`

用途：

- 用户主配置入口
- 直接声明默认模型、system 覆盖、role 覆盖
- 所有 concrete 选择都使用 OpenCode 直接引用

建议结构：

```json
{
  "configVersion": "1",
  "defaults": {
    "model": "gkgk/gpt-5.4",
    "variant": "medium",
    "timeoutMs": 120000,
    "maxOutputBytes": 65536
  },
  "systems": {
    "template.minimal": {
      "defaults": {
        "model": "gkgk/gpt-5.4",
        "variant": "medium"
      },
      "roles": {
        "demo-analyst": {
          "model": "gkgk/gpt-5.4",
          "variant": "medium"
        }
      }
    }
  },
  "roles": {
    "test-operator": {
      "model": "gkgk/gpt-5.4",
      "variant": "low"
    }
  }
}
```

字段约束：

- `model`: 必须是 `provider/model` 形式
- `variant`: 直接对齐 OpenCode SDK/runtime 的 `variant`
- `timeoutMs` / `maxOutputBytes`: 继续由 OGSystem runtime 负责
- 不引入 `providerAliases`
- 不引入新的命名映射层，例如 `profiles` / `aliases` / `canonicalProviders`

### 4.2 Resolution Order

最终模型选择建议按以下优先级解析：

1. `system.mmd` 中的 `model.bind.<roleId>`，如果其值已经是 `provider/model`
2. `.ogs/model-selection.json -> systems.<systemId>.roles.<roleId>`
3. `.ogs/model-selection.json -> roles.<roleId>`
4. `.ogs/model-selection.json -> systems.<systemId>.defaults`
5. `.ogs/model-selection.json -> defaults`

解释：

- 1 是 explicit direct ref，优先级最高
- 2-5 是新的权威配置层
- catalog 不在 runtime precedence 中，只用于 advisory 能力感知

### 4.3 `system.mmd` Contract

当前更稳妥的落地方式不是立即引入 `model.bind.<roleId>=default`，而是先把 contract 收敛为：

- 允许 explicit direct ref：
  - `model.bind.<roleId>=gkgk/gpt-5.4`
- 允许通过 `.ogs/model-selection.json` 对 system / role 给出 concrete 选择
- `model.bind.<roleId>=default` 延后到后续阶段，再视 runtime-setup 与迁移成本决定是否引入

推荐理由：

- 避免低估当前 `runtime-setup -> loadModelPackages -> fingerprint/resume` 的改动面
- 避免同时冲击 parser / nl2mmd / examples / tests
- 先完成“direct ref + selection”这条主链，再决定是否需要额外 symbolic token

### 4.4 CLI Lifecycle

### 4.4.1 `ogs project init/create`

初始化流程改为：

1. 读取本机 OpenCode 模型列表：
   - `opencode models --verbose`
2. 生成 `.ogs/model-catalog.json`
3. 自动挑选一个默认模型写入 `.ogs/model-selection.json`
4. 生成 runnable `system.mmd`
5. 生成 `.ogs/runtime.json`
6. 不再生成 `og-models/`

默认模型选择建议：

- 只考虑 `status=active`
- 只考虑支持 text input / text output
- 优先支持 `toolcall`
- 若存在 `medium` variant，则默认 `variant=medium`
- 否则不写 `variant`
- 若候选多于一个，优先使用 OpenCode 当前输出顺序中的第一个合格候选

这是一个明确、可预测、无需环境猜测的默认策略。

补充约束：

- catalog 生成失败时，应给出明确 scaffold 错误
- selection 应尽量生成 runnable 默认值
- 新模板不再依赖 `og-models/`

### 4.4.2 New Command

新增：

```bash
ogs project sync-models
```

行为：

- 刷新 `.ogs/model-catalog.json`
- 若 `.ogs/model-selection.json` 缺失，则生成默认样板
- 若已存在，则只做校验与提示，不覆盖用户选择
- 不把 catalog 未命中直接升级为 runtime 阻断

可选增强：

- `ogs project sync-models --rewrite-default`
- `ogs doctor`
  - 报告 selection 中引用了 catalog 不存在的模型

### 4.5 Runtime Integration

runtime 新增专用解析器，例如：

- `src/runtime/model-catalog.ts`
- `src/runtime/model-selection.ts`

职责：

- 解析 `.ogs/model-selection.json`
- 根据 `systemId + roleId + model.bind value` 计算最终 concrete model
- 返回 executor 直接可用的：
  - `model`
  - `variant`
  - `timeoutMs`
  - `maxOutputBytes`

catalog 在 runtime 内的职责应限制为：

- 可选的诊断增强
- doctor / scaffold 的 advisory 校验
- 不参与运行时硬判定

`src/runtime/opencode-executor.ts` 只接收最终 concrete ref，不负责 provider 推断，也不负责 alias remap。

### 4.6 Runtime Config Simplification

`.ogs/runtime.json` 在下一版中直接收敛，不保留旧模型配置面。

建议目标：

```json
{
  "configVersion": "2",
  "executor": "opencode",
  "roleRepo": "./og-roles",
  "runsDir": ".ogs/runs",
  "workspace": {
    "rolesDir": "roles",
    "privateDirName": "private",
    "workspaceIsolation": "role"
  },
  "redaction": {
    "enabled": true
  },
  "runtime": {
    "error_flows": {
      "v1": false
    }
  }
}
```

下一版目标：

- 删除 `modelRepo`
- 删除 `opencode.providerAliases`
- 模型控制完全转移到 `.ogs/model-selection.json`
- 使用新的 `configVersion: "2"`

### 4.7 Error Model

新的错误语义需要明确分层：

### 配置阶段错误

- `MODEL_SELECTION_CONFIG_INVALID`
- `MODEL_SELECTION_NOT_FOUND`
- `MODEL_BINDING_UNRESOLVED`

说明：

- `MODEL_CATALOG_NOT_FOUND` 更适合 doctor / scaffold 告警
- `MODEL_NOT_IN_CATALOG` 更适合 advisory warning，不应默认升级为 runtime blocker

### 执行阶段错误

- `OPENCODE_PROVIDER_MODEL_NOT_FOUND`
- `OPENCODE_STRUCTURED_OUTPUT_INVALID`
- `OPENCODE_EXECUTION_ERROR`

目标：

- “没配置模型”
- “配置了不存在的模型”
- “OpenCode provider 不暴露该模型”
- “模型返回了坏结构化输出”

这四类问题必须在日志与最终结果中可直接区分，不能再混成一个 generic structured-output 错误。

### 4.8 Cutover Strategy

由于当前仓库仍大量引用 `og-models`，切换时必须按单次 cutover 处理，而不是再增加一层兼容路径：

### 新项目

- 不再生成 `og-models/`
- 不再提供 `providerAliases`
- 默认新增 `.ogs/model-catalog.json` + `.ogs/model-selection.json` 作为主路径

### 已有开发态项目

- 需要一次性迁移到 `.ogs/model-selection.json`
- 不提供 legacy fallback
- 不保证旧 `modelRepo` / `providerAliases` 配置继续可运行

## 5. Implementation Plan

### Phase 1: Contract And Scaffolding

目标：建立新的文件契约与 CLI 初始化能力。

实施项：

- [ ] 新增 `src/runtime/model-catalog.ts`
- [ ] 新增 `src/runtime/model-selection.ts`
- [ ] 新增 `schemas/model-catalog.schema.json`
- [ ] 新增 `schemas/model-selection.schema.json`
- [ ] 直接引入 `configVersion: "2"`
- [ ] 更新 `src/runtime/types.ts`
- [ ] 修改 `src/runtime/project-lifecycle.ts`
- [ ] `project init/create` 自动执行 `opencode models --verbose`
- [ ] 生成 `.ogs/model-catalog.json`
- [ ] 生成 `.ogs/model-selection.json`
- [ ] 最小模板默认写 runnable config
- [ ] `project init/create` 不再复制 `og-models/`
- [ ] 明确 catalog 仅用于 scaffold / doctor，不进入 runtime 硬校验

交付标准：

- `ogs project create demo-app` 产物可直接运行
- 新模板不再暴露 `modelRepo` / `providerAliases`

### Phase 2: Runtime Resolution

目标：把执行入口切换到新的模型选择解析器。

实施项：

- [ ] 修改 `src/runtime/runtime-setup.ts`
- [ ] 修改 plan fingerprint 输入，覆盖新模型选择面
- [ ] 修改 resume 一致性校验，避免旧 fingerprint 误判
- [ ] 梳理 parser / nl2mmd / examples 对新解析路径的影响
- [ ] 在 runtime setup 阶段加载 selection
- [ ] 将 catalog 从 runtime 硬判定中剥离，保留 advisory 角色
- [ ] 实现 `systemId + roleId + model.bind` 的解析优先级
- [ ] executor 仅接收 concrete `provider/model`
- [ ] 不在本阶段引入 `model.bind=default`
- [ ] 删除 `modelRepo` / `providerAliases` 运行路径
- [ ] 增加明确错误码与错误消息

交付标准：

- 最终 audit 中记录的是 resolved concrete model
- 对不存在模型和 provider-model 不匹配的错误能稳定区分
- 对 catalog 缺失或过期不会制造 runtime 假阴性

### Phase 3: Cleanup

目标：删除旧模型入口并完成文档收口。

实施项：

- [ ] 新项目停止复制 `og-models/`
- [ ] 文档改为 `.ogs/model-selection.json` 主路径
- [ ] README / usage manual / examples 更新
- [ ] 删除 `providerAliases` 文档主路径
- [ ] 删除 `og-models/` 作为默认模型仓
- [ ] 增加 `ogs project sync-models`
- [ ] 新增 doctor 检查：selection 是否命中 catalog
- [ ] 重新评估是否真的需要 `model.bind=default`

交付标准：

- 新用户不需要接触 `og-models`
- 下一版只有一个模型配置主路径

## 6. File-Level Change List

预计需要修改或新增的核心文件：

- `src/runtime/types.ts`
- `src/runtime/config.ts`
- `src/runtime/runtime-loader.ts`
- `src/runtime/runtime-setup.ts`
- `src/runtime/project-lifecycle.ts`
- `src/runtime/opencode-executor.ts`
- `src/runtime/adapter.ts`
- `src/runtime/executor.ts`
- `src/runtime/plan-fingerprint.ts`
- `src/runtime/doctor.ts`
- `src/runtime/cli.ts`
- `src/nl2mmd/catalog.ts`
- `src/nl2mmd/service.ts`
- `src/nl2mmd/validate.ts`
- `schemas/runtime-config.schema.json`
- `README.md`
- `docs/usage-manual.md`

预计新增：

- `src/runtime/model-catalog.ts`
- `src/runtime/model-selection.ts`
- `schemas/model-catalog.schema.json`
- `schemas/model-selection.schema.json`
- `tests/model-selection.test.mjs`
- `tests/project-model-sync.test.mjs`
- `tests/resume-session.test.mjs`

## 7. Test Checklist

### 7.1 Unit

- [ ] `provider/model` 解析校验
- [ ] `model-selection.json` schema 校验
- [ ] resolution precedence 校验
- [ ] invalid catalog / invalid selection 报错校验
- [ ] catalog 中无该模型时生成 advisory warning，而非默认 runtime blocker

### 7.2 CLI

- [ ] `ogs project init` 自动生成 `.ogs/model-catalog.json`
- [ ] `ogs project init` 自动生成 `.ogs/model-selection.json`
- [ ] `ogs project create` 默认生成 runnable minimal 模板
- [ ] `ogs project sync-models` 不覆盖已有用户选择
- [ ] OpenCode 不可用时 CLI 返回明确错误

### 7.3 Runtime

- [ ] default selection 可驱动最小模板成功执行
- [ ] system override 生效
- [ ] role override 生效
- [ ] direct `model.bind.<roleId>=provider/model` 生效
- [ ] auditTrail 正确记录 resolved model
- [ ] runtime 不因 catalog 过期而拒绝执行
- [ ] resume/fingerprint 在新模型解析面下保持稳定

### 7.4 Error Propagation

- [ ] 缺失 `.ogs/model-selection.json` 的错误清晰
- [ ] selection 中模型不在 catalog 时表现为 advisory warning，除非另有显式 strict 模式
- [ ] OpenCode `ProviderModelNotFoundError` 不再伪装成 structured-output 错误
- [ ] generic structured-output fallback 只在无更具体诊断时触发

### 7.5 Docs And Packaging

- [ ] 新模板文档不再要求编辑 `providerAliases`
- [ ] 安装产物不再以 `og-models/**` 为主配置入口
- [ ] 文档不再把 `providerAliases` 当作可用主路径

## 8. Acceptance Checklist

- [ ] 用户只需要理解两个模型文件：catalog 与 selection
- [ ] 用户在 selection 中只写 direct OpenCode refs
- [ ] 新项目默认创建后即可运行最小系统
- [ ] runtime 不再按环境猜 provider
- [ ] runtime 不会仅因 catalog 缺失或过期而失败
- [ ] test 不再依赖机器环境差异来通过
- [ ] 错误信息能明确区分配置问题与执行问题
- [ ] 文档主路径逐步不再把 `og-models` 当作推荐模型配置方式
- [ ] 下一版不再保留第二条模型配置主路径

## 9. Recommended Execution Order

推荐按以下顺序落地，以降低 blast radius：

1. 先新增 `model-catalog` / `model-selection` 读写与 schema，并明确 catalog 是 advisory。
2. 再改 `project init/create`，保证新建项目只有新样板。
3. 再改 runtime-setup / fingerprint / resume / nl2mmd 相关路径，把 executor 输入改成 concrete ref。
4. 同步删除 `providerAliases`、`modelRepo` 与 `og-models` 默认脚手架路径。
5. 最后补 error code / doctor / docs 收口。

原因：

- 先把契约与脚手架落地，能避免 runtime 改完却没有可用项目样板
- 先显式写清 blast radius，能避免把 `model.bind=default` 误判成小改
- 删除旧路径要与 runtime cutover 同轮完成，避免双轨维护
- 文档放最后，便于以最终实现为准一次性收口

## 10. Final Recommendation

最佳实践上，长期应采用：

- `system.mmd` 负责拓扑与执行意图
- `.ogs/model-catalog.json` 负责机器能力快照与 advisory 信息
- `.ogs/model-selection.json` 负责用户选择
- runtime 只执行解析后的 concrete `provider/model`

不应继续把以下路径作为主模型体验：

- `opencode.providerAliases`
- `og-models/models/<modelId>/model.json`
- 运行时按环境探测 provider

按这个修订版推进，既满足“自动获取模型列表是关键”，也满足“用户只配置 OpenCode 可直接执行的模型参数”，同时不会把 catalog 误升格为 runtime 强校验源，也会把 `runtime-setup / resume / fingerprint / nl2mmd` 的实际改动面纳入一次性 cutover。
