# OGSystem Cross-Platform Build/Validation + Rust Full-Flow Delivery (Archived)

Archived: yes (delivery record; not active source of truth)  
Status: Delivered  
Date: 2026-04-12  
Owner: Runtime maintainers

## 1. 交付目标

本轮交付覆盖三件事：

1. 构建与安装命令统一为 `pnpm-only`，并明确 Win/macOS/Linux 使用方式。
2. 完整验证（含新增测试用例）并确认回归通过。
3. 基于项目验证新增 Rust `hello world` 三角色全流程（开发、编译、打包运行）。

## 2. 已交付内容

### 2.1 跨平台安装/构建/CI

- 文档更新了 macOS/Linux、Windows PowerShell、Windows CMD 的安装命令。
- 构建命令统一为 `pnpm run build`。
- CI 更新为三平台矩阵：
  - `ubuntu-latest`
  - `macos-latest`
  - `windows-latest`
- CI 统一使用 `pnpm`：
  - `pnpm install --frozen-lockfile`
  - `pnpm run build`
  - `pnpm test`
  - `pnpm run test:examples`
  - `pnpm run test:doctor`

### 2.2 Rust 三角色流水线

新增 `examples/rust-hello-pipeline/`：

- `system.mmd`（开发 -> 编译 -> 打包运行）
- `profiles.json`
- `tools.json`
- `scripts/developer.mjs`
- `scripts/compiler.mjs`
- `scripts/packager.mjs`
- `README.md`

新增角色包：

- `og-roles/roles/rust-developer/`
- `og-roles/roles/rust-compiler/`
- `og-roles/roles/rust-packager/`

新增测试：

- `tests/rust-hello-pipeline.test.mjs`

验证点：

- `cargo` 不可用时自动 skip（保证跨环境可执行）。
- `cargo` 可用时执行完整开发/编译/打包运行链路。
- 断言最终 `status=done`，`finalOutput="hello from OGSystem rust pipeline"`。
- 断言 run 目录关键产物存在（工程文件、release 二进制、打包二进制、角色日志、`events.ndjson`）。

## 3. 验证结果（2026-04-12）

执行命令：

```bash
pnpm test
pnpm run test:examples
pnpm run test:doctor
```

结果：

- `pnpm test`：`128/128` 通过。
- `pnpm run test:examples`：通过。
- `pnpm run test:doctor`：通过。

## 4. 业界对标差异清单（Gap List）

对标对象：成熟 CLI/编排产品在“跨平台发布、可观测性、可运维性、企业治理”上的常见能力基线。

### 4.1 当前已达到

- 单一命令基线（`pnpm-only`）与跨平台安装文档齐备。
- 生命周期命令闭环（init/create/start/resume/stop/list/status/logs/reindex）。
- 运行目录与恢复契约明确（`.ogs/runs/<run-id>/` + 指纹/快照/WAL 补偿）。
- 回归门禁具备（主测 + example + doctor）。

### 4.2 主要差距

- 分发能力：缺少版本化 CLI 发布通道（npm 包版本治理、平台安装器、单文件分发）。
- 可观测性：`run logs` 仍缺少 `tail/follow/since` 等高频排障能力。
- 机器可读摘要：缺少 run 级统一 `summary.json`，工具集成仍偏手工。
- Windows 场景验证深度不足：缺少 PowerShell/CMD 生命周期 smoke 自动化。
- 安全治理：缺少 provider 凭据健康检查与最小权限模板化约束。

## 5. 后续待办（已同步 backlog）

优先级 P1：

- 增加 Rust toolchain 可选门禁作业。
- 增加 Windows PowerShell/CMD 生命周期 smoke test。
- 增加 `run status/list/logs` 可观测字段与检索能力。
- 增加文档命令片段漂移检测。

优先级 P2：

- 规划版本化 CLI 分发与升级路径。
- 增加 provider 凭据健康检查和最小权限模板。
- 增加运行日志/审计的敏感信息脱敏策略。

