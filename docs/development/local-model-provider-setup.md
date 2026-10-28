# 本机模型 Provider 配置

本文记录已验证的本机 gpt-6-luna 调用路径，供开发、诊断和本地 Team Site Resolver 使用。配置与密钥留在用户目录，不复制到仓库。

## Codex CLI

Codex 从 `~/.codex/config.toml` 读取自定义 provider 和 `gpt-6-luna` 模型配置。当前 provider 使用的 bearer token 存在该文件的 `experimental_bearer_token` 字段中；不要打印或复制其值。

在项目目录执行只读 Sandbox 模型请求：

```sh
codex exec --ephemeral --sandbox read-only --model gpt-6-luna -C "$PWD" \
  "Return exactly CODEX_MODEL_OK"
```

`codex login status` 只表示 Codex 登录态，不能判定自定义 provider 是否可用。以实际模型请求的响应为准；成功标记应为 `CODEX_MODEL_OK`。

## OpenCode CLI

独立客户端配置位于 `~/.config/opencode/gpt6-luna-client.json`。其关键参数为：

- `baseURL`: `http://43.134.72.68:8080`
- provider: `codex-gateway`，使用 `@ai-sdk/openai-compatible`
- `model`: `codex-gateway/gpt-6-luna`
- API key: 只保存在该用户级配置文件，不写入项目

执行真实模型请求：

```sh
OPENCODE_CONFIG="$HOME/.config/opencode/gpt6-luna-client.json" \
  opencode run --format json --model codex-gateway/gpt-6-luna \
  "Return exactly OPENCODE_MODEL_OK"
```

成功标记应为 `OPENCODE_MODEL_OK`。

## OpenCode Serve

Serve 配置位于 `~/.config/opencode/gpt6-luna-serve.json`，模型引用为 `codex-gateway/gpt-6-luna`，上游地址为 `http://43.134.72.68:8080`。启动脚本为 `~/.config/opencode/start-gpt6-luna-serve`，仅监听本机：

```sh
"$HOME/.config/opencode/start-gpt6-luna-serve"
```

该脚本设置 `OPENCODE_CONFIG`、`OPENCODE_SERVER_USERNAME=opencode`，并从 `~/.config/opencode/gpt6-luna-serve.env` 的 `OPENCODE_API_KEY` 读取本地 serve 密码。脚本还从 `~/.codex/config.toml` 的自定义 provider 配置提取上游 bearer，并只传入进程环境。serve 默认地址为 `http://127.0.0.1:4096`。

本机访问用 Basic Auth。无凭据请求应返回 `401`；带有效凭据的 `GET /global/health` 应返回 `200`。不在命令行参数或日志中展开密码：

```sh
set -a
. "$HOME/.config/opencode/gpt6-luna-serve.env"
set +a
export OPENCODE_SERVER_USERNAME=opencode
export OPENCODE_SERVER_PASSWORD="$OPENCODE_API_KEY"

curl -sS -o /dev/null -w 'health=%{http_code}\n' \
  --user "$OPENCODE_SERVER_USERNAME:$OPENCODE_SERVER_PASSWORD" \
  http://127.0.0.1:4096/global/health

node --input-type=module <<'NODE'
import { createOpencodeClient } from "@opencode-ai/sdk";

const basic = Buffer.from(
  `${process.env.OPENCODE_SERVER_USERNAME}:${process.env.OPENCODE_SERVER_PASSWORD}`
).toString("base64");
const client = createOpencodeClient({
  baseUrl: "http://127.0.0.1:4096",
  headers: { Authorization: `Basic ${basic}` },
  responseStyle: "data"
});
const session = await client.session.create({});
const response = await client.session.prompt({
  path: { id: session.id },
  body: {
    model: { providerID: "codex-gateway", modelID: "gpt-6-luna" },
    parts: [{ type: "text", text: "Return exactly OPENCODE_SERVE_MODEL_OK" }]
  }
});
const text = (response.parts ?? [])
  .filter((part) => part.type === "text")
  .map((part) => part.text)
  .join("\n");
process.stdout.write(`${text}\n`);
if (!text.includes("OPENCODE_SERVE_MODEL_OK")) process.exitCode = 2;
NODE
```

serve 模型请求使用 OpenCode SDK 的 session API：创建 session，再对该 session 调用 prompt，并传入 `codex-gateway/gpt-6-luna`。SDK 请求必须把 Basic Auth 放入 HTTP Authorization header；不要把密钥放入 URL、请求体或仓库文件。

## 本机验证记录

2026-10-28，本机三条请求均返回精确 marker：

- Codex CLI：`CODEX_MODEL_OK`。
- 独立 OpenCode CLI，读取 `gpt6-luna-client.json`：`OPENCODE_MODEL_OK`。
- 本机 OpenCode serve SDK 请求：`OPENCODE_SERVE_MODEL_OK`。

独立客户端配置使用 OpenCode `provider` 配置块，模型引用为 `codex-gateway/gpt-6-luna`；配置文件权限为 `0600`。本次修正了原文件中 OpenCode 不识别的根级 `baseURL` 和 `apiKey`，API key 保留在本机配置中，没有输出或复制到仓库。serve 健康检查带 Basic Auth 返回 `200`，无凭据返回 `401`。这些调用验证模型路由可用，不代表 Team IR 的 resolver、Sandbox Binding、Project Task 或真实 Sandbox UAT 已通过。

## 文件权限与传输边界

- `gpt6-luna-client.json` 和 `gpt6-luna-serve.env` 应为 `0600`。
- `start-gpt6-luna-serve` 应为 `0700`；serve 模型配置不含 secret 时可为 `0644`。
- serve 绑定 `127.0.0.1`，不得改为 `0.0.0.0` 或开启 mDNS。
- 上游目前是明文 HTTP，provider bearer 会经网络传输且没有 TLS 加密。只在接受该网络信任边界的环境使用；需要保护上游凭据时，应先提供受信 TLS endpoint，再更新配置和验证记录。
- 本机 CLI/serve 请求证明模型路由可用，不等于 Team IR 真实 Sandbox UAT。Sandbox UAT 仍要求实际隔离 Binding、可信 Team IR resolver/release evidence 和 Project Task 全链路记录。
