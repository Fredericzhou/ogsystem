# .ogs Control Plane

这是 `examples/ogs-gstacklike` 的本地运行控制面。

这里刻意只保留当前示例真正会用到的文件说明，避免把通用脚手架说明和示例自身语义混在一起。

## 文件说明

- `runtime.json`: 运行时配置，指定本地 role 仓库、runs 目录、workspace 隔离策略，以及 `runtime.error_flows.v1=true`。
- `laws.json`: 当前示例使用的 law 约束。
- `user-profile.json`: 注入到角色提示中的默认用户偏好。
- `runs/`: 运行生成目录。每个 run 一个子目录，包含状态快照、review control plane、审计和共享产物。

## 本示例关心的点

- `roleRepo` 指向项目本地 `./og-roles`
- `runsDir` 固定为 `.ogs/runs`
- `workspace.workspaceIsolation=branch`，便于并行/回路分支各自隔离
- `runtime.error_flows.v1=true`，让 `ship-deploy` 失败时能按 Mermaid `ERROR` 边进入补偿流

## 运行后的关键落点

第一次跑 `system.mmd` 时，如果 `ship` 开启了 `review.mode.ship=required`，run 会先停在 waiting review。

这时最重要的不是日志，而是 run 目录里的 durable 控制面：

- `.ogs/runs/<run-id>/state.json`
- `.ogs/runs/<run-id>/summary.json`
- `.ogs/runs/<run-id>/control/reviews/*.request.json`
- `.ogs/runs/<run-id>/control/reviews/*.decision.json`

只有在人工审核通过并 `resume` 之后，`ship-deploy` 才会把最终页面写入：

- `.ogs/runs/<run-id>/shared/index.html`

## 编辑约束

- 保持 JSON 合法，不要加注释。
- 不要手工修改 `runs/` 下的运行时产物，除非你在做恢复或审计排查。
