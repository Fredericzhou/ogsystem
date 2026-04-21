# OpenCode Provider Reference And Error Surfacing

Date: 2026-04-21  
Status: delivered

## 1. 背景

最小模板真实运行时，失败被顶层误报为：

- `OpenCode structured output must be a JSON object`

但从 run artifact 与 OpenCode 诊断里可以确认，真实原因是 provider/model 解析失败：

- `ProviderModelNotFoundError`
- provider: `openai`
- model: `gpt-5.4`

这会把“模型不可用”和“模型返回了错误输出格式”混在一起，增加排障成本。

同时，项目脚手架里的 `.ogs/providers/opencode.json` 过于抽象，没有给出可直接映射到本机 OpenCode 配置的 OpenAI-compatible 参考形状。

## 2. 本次交付

### 2.1 Provider 参考样板

项目脚手架现在生成的 `.ogs/providers/opencode.json` 明确为：

- project-local reference sample
- 实际生效配置路径：`~/.config/opencode/opencode.json`
- 推荐 `provider.openai` 形状：
  - `npm: "@ai-sdk/openai-compatible"`
  - `options.baseURL`
  - `options.apiKey`
  - `options.setCacheKey: true`
  - `models.gpt-5.4.name`

约束：

- 不在仓库中写入真实密钥
- 只保留占位符与文档说明

### 2.2 错误传播修正

`src/runtime/opencode-executor.ts` 做了两层修正：

1. 当上游已经返回明确 provider/model 诊断时，优先把该诊断提升为顶层错误。
2. 只有在没有可用诊断时，才保留 generic structured-output fallback。

当前已覆盖的显式场景：

- `ProviderModelNotFoundError`
- 来自 OpenCode/OpenAI-compatible provider 的明确 error 行
- 既有 `@ai-sdk/openai-compatible` / GPT-5 Responses mismatch remediation hint

## 3. 文档更新

已同步更新：

- `README.md`
- `docs/usage-manual.md`

文档现在明确区分两层：

- project-local `.ogs/providers/opencode.json` 只是参考样板
- machine-level `~/.config/opencode/opencode.json` 才是运行时真实配置

## 4. 验证

已完成三类验证：

1. 定向测试
   - `node --test tests/opencode-executor.test.mjs tests/cli-lifecycle.test.mjs`
2. 全量测试
   - `pnpm test`
3. 真实 smoke
   - 最小模板在线运行仍失败，但顶层错误已正确显示为  
     `ProviderModelNotFoundError: provider "openai" does not expose model "gpt-5.4"`

结论：

- 模板无结构性问题
- 运行时错误传播已修正
- 当前剩余问题属于本机 OpenCode provider 对 `openai/gpt-5.4` 的可用性，而不是 OGSystem 将其误判为 structured-output 失败
