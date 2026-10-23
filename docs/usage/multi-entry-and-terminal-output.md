# 开始分发与结束汇聚

`start[开始]` 与 `end[结束]` 是图中的显式特殊角色，只控制流转，不承担业务工作。连接它们的 Flow 是团队结构的一部分，也是唯一的数据来源。

```mermaid
flowchart TD
%% system.id=example.multi-entry
%% system.version=1.0.0
%% law.global=law.minimal.base
start[开始] -->|START| analyst[Role:analyst]
start[开始] -->|START| reviewer[Role:reviewer]
analyst[Role:analyst] -->|DONE| end[结束]
reviewer[Role:reviewer] -->|DONE| end[结束]
```

## 开始分发

- 开始候选集只包含 `start[开始]` 直接连接的不同业务角色。删除 Flow 即从候选集中移除角色。
- 全部模式会激活所有候选角色；随机模式使用 `start.dispatch.mode=random_n` 和 `start.dispatch.count=N`，N 必须在 `1..候选角色数`。
- 所有开始 Flow 都使用结构事件 `START`，不允许为不同候选角色配置不同事件。
- 随机抽选由 Run ID 确定，选中列表会保存在运行状态和审计记录。暂停、恢复和重放沿用该列表，不会重新抽选。
- 每个被选角色收到独立复制的任务输入，不共享可变任务对象。
- 开始角色只负责选择要激活的角色，不拆分业务任务。业务任务拆解、分析和交付由真实业务角色完成。

## 结束汇聚

- 只有直接连接 `end[结束]` 的不同业务角色属于结束统计范围。未连接结束角色的孤立角色不提供终值，也不计入汇聚。
- 默认 `end.join.mode=all_of`，等待所有直接连接结束的不同角色完成。
- `end.join.mode=quorum_of` 必须同时设置 `end.join.min=N`，范围为 `1..直接连接结束的不同角色数`。
- 同一角色循环或重复激活只贡献一票；其多次终值仍按稳定图顺序记录，不按完成时间排序。
- 若开始随机选择造成结束阈值不可能达到，允许保存该结构；运行时会以 `GRAPH_END_QUORUM_UNREACHABLE` 失败，记录未满足角色并取消尚未完成分支。
- 达到 quorum 后运行立即结束，迟到分支会取消，迟到结果不纳入终值。
- 终值以 `finalOutputsByRoleId` 按角色保存，并用 `finalOutputRoleOrder` 保留稳定顺序。

## 随机入口示例

```mermaid
flowchart TD
%% system.id=example.random-entry
%% system.version=1.0.0
%% law.global=law.minimal.base
%% start.dispatch.mode=random_n
%% start.dispatch.count=2
%% end.join.mode=quorum_of
%% end.join.min=2
start[开始] -->|START| analyst[Role:analyst]
start[开始] -->|START| reviewer[Role:reviewer]
start[开始] -->|START| verifier[Role:verifier]
analyst[Role:analyst] -->|READY| end[结束]
reviewer[Role:reviewer] -->|READY| end[结束]
verifier[Role:verifier] -->|READY| end[结束]
```

此结构每次运行从三个候选角色中固定选择两个，并要求两个不同的结束角色到达。若未来调整为随机选择一个，保存仍可通过，运行会明确失败，因为两个结束角色的阈值无法满足。
