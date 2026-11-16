# Local Role Repo

`examples/ogs-gstacklike` 使用项目本地 role 仓库。

角色包统一放在 `og-roles/roles/<roleId>/`，由示例目录自己持有，而不是依赖仓库外的共享角色源。

## 当前示例里的角色分层

- 项目流程角色：`office-hours`、`review`、`qa`、`ship`、`ship-deploy`、`retro`、`learn`
- 补偿模板角色：`error-handler-base`

当前主路径的人机协作依赖的是 runtime-native human review。

- `ship` 既承担首轮交付草稿，也承担 rework 回流点
- reviewer comment 通过 `global.human_review.current.*?` 直接投影到 `ship`
- `qa -> ship` / `ship -> ship-deploy` / `retro -> learn` 都走小型结构化 payload
- 不再通过额外中间节点承接 review 回流

所有本地角色的 `prompt.md` 都保留运行时变量，并要求只输出符合 `output.schema.json` 的 JSON object。事件必须来自 `allowed_events`；语言按 `user_preferences` 决定，中文输入默认中文交付。
