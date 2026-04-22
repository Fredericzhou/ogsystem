# OGS GStacklike

这是一个“项目级”示例，不是最小语义样例。

它把这些能力放到同一条主路径里：

- 项目本地 role 仓库：`og-roles/roles/<roleId>/`
- runtime-native human review：`review.*`
- run 级共享产物：`shared/index.html`
- 失败补偿：`ERROR -> error-handler-base`
- 场景化回归：`scenarios/*.mmd` + `scripts/validate-scenarios.sh`

## 什么时候看这个示例

如果你想先理解最小语义，先看 `examples/runtime-native-human-review/`。

如果你要看“真实项目如何把本地角色仓库、人工审核、交付产物和补偿流串起来”，看这个目录。

## 直接运行

在仓库根目录执行：

```bash
ogs run start --system examples/ogs-gstacklike/system.mmd --input "构建一个html页面，要求显示bye world2" --workdir examples/ogs-gstacklike
```

第一次运行会停在人工审核态。这是预期行为，不是失败。

- `ship` 角色先完成草稿结果
- runtime 创建 pending review request
- run 进入等待审核态
- `shared/index.html` 还不会生成

这也是为什么“运行后仍然未生成 html”：只有审核通过并 `resume` 之后，`ship-deploy` 才会真正写出页面产物。

当审核结论是 `rework` 时，runtime 会直接重新激活 `ship`，而不是跳到额外的 `review-feedback` / human gate 节点。

- `ship` 首轮执行时没有 human review 上下文
- rework 分支会自动拿到 `human_review_comment`、`human_review_round`、`previous_ship_output`
- 这些字段通过可选 `global.human_review.current.*?` selector 投影，首轮没有上下文时会被省略
- `qa -> ship` 会传一个小型 `releaseCandidate`
- `ship -> ship-deploy` 会传一个更紧凑的 `deploy` payload
- `ship-deploy` 只消费这个 deploy payload，最终 `shared/index.html` 不再嵌入完整 prompt shell

## 查看与放行

```bash
ogs run list --workdir examples/ogs-gstacklike
ogs run review list <run-id> --workdir examples/ogs-gstacklike
ogs run review inspect <run-id> <review-id> --workdir examples/ogs-gstacklike

ogs run review decide <run-id> <review-id> --decision approve --comment "approved" --actor reviewer --workdir examples/ogs-gstacklike
ogs run resume <run-id> --workdir examples/ogs-gstacklike
```

审核通过后，产物会写到：

- `.ogs/runs/<run-id>/shared/index.html`

## 先看哪些文件

拿到 `<run-id>` 之后，优先看这几处：

- `.ogs/runs/<run-id>/control/reviews/<reviewId>.request.json`
- `.ogs/runs/<run-id>/control/reviews/<reviewId>.decision.json`
- `.ogs/runs/<run-id>/summary.json`
- `.ogs/runs/<run-id>/timeline.jsonl`
- `.ogs/runs/<run-id>/shared/index.html`

如果你想顺着 handoff 看示例是不是“像项目”而不是“像事件桩”，再补看：

- `.ogs/runs/<run-id>/roles/qa/result.json`
- `.ogs/runs/<run-id>/roles/ship/result.json`
- `.ogs/runs/<run-id>/roles/retro/result.json`
- `.ogs/runs/<run-id>/roles/learn/result.json`

## Compact Walkthroughs

`approve` 路径：

1. `ogs run start --system examples/ogs-gstacklike/system.mmd --input "构建一个html页面，要求显示hello world" --workdir examples/ogs-gstacklike`
2. `ogs run list --workdir examples/ogs-gstacklike`
3. `ogs run status <run-id> --workdir examples/ogs-gstacklike`
4. 读取 `latestPendingReviewId`
5. `ogs run review inspect <run-id> <review-id> --workdir examples/ogs-gstacklike`
6. `ogs run review decide <run-id> <review-id> --decision approve --comment "approved" --actor reviewer --workdir examples/ogs-gstacklike`
7. `ogs run resume <run-id> --workdir examples/ogs-gstacklike`
8. 打开 `.ogs/runs/<run-id>/shared/index.html`

`rework -> second review -> approve` 路径：

1. 启动 `scenarios/approval-rework.mmd`
2. 第一轮对 `ship` 写 `rework`
3. `ogs run resume <run-id> --workdir examples/ogs-gstacklike`
4. 重新执行后的 `ship` 会带着 reviewer comment 产出新的 release candidate
5. 用 `ogs run status <run-id>` 读取新的 `latestPendingReviewId`
6. 第二轮对新的 review request 写 `approve`
7. 再次 `resume`
8. 最终检查 `shared/index.html`、`timeline.jsonl`、`summary.json`

## Scenarios 是什么

`scenarios/` 不是“输入样例”，而是这个项目的系统变体，用来验证不同业务语义是否仍然成立。

- `approval-rework.mmd`: rework 后把人工反馈直接投影回 `ship`
- `review-pause.mmd`: pause 后 run 继续保持 waiting review
- `review-terminate.mmd`: terminate(run) 终止当前 run
- `deploy-failure.mmd`: 审核通过后部署失败，再走补偿流

`approval-rework.mmd` 的实际操作是两轮 review：

1. 第一轮对 `ship` 做 `rework`
2. `resume` 后 runtime 重新执行 `ship`
3. `ship` 重新产出 draft，并再次进入 waiting review
4. 第二轮再对新的 review request 做 `approve`，run 才会结束

## 一键回归

```bash
bash examples/ogs-gstacklike/scripts/validate-scenarios.sh
```

这个脚本会验证：

- approve 后恢复并生成 `shared/index.html`
- rework 反馈投影
- pause 决策幂等落盘
- terminate(run) 的停止语义
- deploy failure 仍能进入补偿角色

## 可视化

这个示例很适合拿来验证可视化是否能正确表达 runtime-native review：

```bash
ogs visualizer --workdir examples/ogs-gstacklike
```

或在启动时临时挂载：

```bash
ogs run start --system system.mmd --input "构建一个html页面，要求显示hello world" --workdir examples/ogs-gstacklike --visualize
```

可视化侧至少应该能看到：

- 当前 run 是否 `hasWaitingHumanReview`
- pending review 数量
- 当前停在哪个 role / branch
- review decision 之后的恢复流向
- `shared/index.html` 何时出现
