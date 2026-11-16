# OGS 微信小程序开发与封版流

这是一个使用当前 OGS 项目结构构建的本地开发流：需求定义、页面设计、编码、独立测试、测试返工和封版均为可审计角色。工作流首次会在空状态验收上失败，将 finding 映射回 coding；coding 应用反馈后再次测试，通过才允许 seal。

## 运行

在仓库根目录运行：

```powershell
pnpm exec tsx src/runtime/cli.ts lint --system examples/wechat-miniprogram-factory/system.mmd
pnpm exec tsx src/runtime/cli.ts run start --system examples/wechat-miniprogram-factory/system.mmd --ogs-dir examples/wechat-miniprogram-factory --input "Build the Light Task WeChat Mini Program, feed QA findings back to coding, and seal only after every check passes."
```

`loop.max.coding=2` 限制编码尝试次数。QA 未通过时只允许有界返工，预算耗尽会失败关闭，不会 seal。

## 产物和证据

每次运行都在 `.ogs/runs/<run-id>/shared/` 保存需求、设计、小程序、测试报告和封版清单。成功 run 中：

- `miniprogram/` 是可用微信开发者工具打开的原生小程序项目。
- `test-report.json` 记录结构检查、任务切换和本地存储恢复测试。
- `seal-manifest.json` 记录封版状态及每个源文件的 SHA-256。
- `roles/coding/executions/` 保留两轮编码输入、测试反馈和输出。

封版仅表示这些本地验收和交互模拟通过，不代表微信平台审核、真机兼容或生产发布已完成。

运行端到端回归：

```powershell
node --test tests/wechat-miniprogram-factory.test.mjs
```

此例使用本地确定性工具脚本，方便离线复现 OGS 的 handoff、`context.map`、循环预算、共享产物和审计链；如需模型辅助编码，可将 `coding` role 的执行绑定替换为已配置的模型后端，并保留同一 QA/封版门禁。
