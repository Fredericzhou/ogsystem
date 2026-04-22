# Local Role Repo

`examples/ogs-gstacklike` 使用项目本地 role 仓库。

角色包统一放在 `og-roles/roles/<roleId>/`，由示例目录自己持有，而不是依赖仓库外的共享角色源。

## 当前示例里的角色分层

- 项目流程角色：`office-hours`、`review`、`qa`、`ship`、`ship-deploy`、`retro`、`learn`
- 补偿模板角色：`error-handler-base`
- rework 投影验证角色：`review-feedback`
- 兼容参考模板：`human-approve-gate`

这里保留 `human-approve-gate` 只是为了对照历史用法；当前主路径的人机协作依赖的是 runtime-native human review，而不是额外的人工 gate 节点。
