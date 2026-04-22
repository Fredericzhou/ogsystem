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

## Scenarios 是什么

`scenarios/` 不是“输入样例”，而是这个项目的系统变体，用来验证不同业务语义是否仍然成立。

- `approval-rework.mmd`: rework 后把人工反馈投影回流程
- `review-pause.mmd`: pause 后 run 继续保持 waiting review
- `review-terminate.mmd`: terminate(run) 终止当前 run
- `deploy-failure.mmd`: 审核通过后部署失败，再走补偿流

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

这个示例很适合拿来验证可视化是否能正确表达 human gate：

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
