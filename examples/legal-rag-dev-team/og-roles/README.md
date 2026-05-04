# Local Roles For Legal RAG Dev Team

这个目录是示例项目的本地角色仓库。`system.mmd` 中的 `Role:<roleId>` 会直接解析到 `og-roles/roles/<roleId>/`。

角色写法约定：

- `agent.md` 描述职责边界、中文交付、质量标准、风险处理和协作接口。
- `prompt.md` 保留 `{{allowed_events}}`、`{{user_preferences}}`、`{{task}}`、`{{input}}` 运行时变量。
- 输出必须是一个符合 `output.schema.json` 的 JSON object。
- 事件必须来自 `allowed_events`；`solution-architect` 是 `parallel_split` 调度角色，event 可省略。
- `delivery-lead` 是汇合与 human review 角色，必须显式吸收 `review_comment` rework 反馈。
