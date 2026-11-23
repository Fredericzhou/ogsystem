# OGSystem Stage A (Candidate Replication Package) 导出包独立目录隔离复现审计报告

> **报告时间 / Timestamp:** 2026-11-23T17:59:09.789Z
> **验证类型 / Verification Type:** 导出包独立目录隔离复现 (Local Darwin Isolated Directory Verification; 真实容器 Clean-Room / CI 无缓存验证留待阶段 B)
> **验证环境 / Environment:** macOS Darwin (Node.js v22.21.1, pnpm 10.33.2)
> **产物压缩包 / Tarball:** `dist/ogsystem-anonymous-artifact.tar.gz`
> **压缩包大小 / Size:** 117.60 MB (123307677 bytes)
> **压缩包 SHA-256:** `2ad9a92c7af58db0a7e5fdcb080f17e539e83343bf037f9426cc4119325ec9bc`
> **包含文件总数 / Total Files:** 803 个文件
> **清单记录 / Manifest File:** [`stage-a-artifact-manifest.json`](./stage-a-artifact-manifest.json)

---

## 一、 验证结论与测试口径对齐

1. **测试口径对比与统一**：
   - **全仓工程基准（Full Monorepo）**：共发现 596 项测试（488 项核心通过、1 项 Windows 平台跳过、107 项 Team Site 通过、0 项失败）；
   - **阶段 A 匿名复现包（Stage A Candidate Package）**：共发现 **486 项** 核心回归测试（完全剔除 `apps/team-site` 专有的 3 项测试治具及 `tests/archive/` 历史测试）；
   - **实测执行结果**：**485 项通过，1 项按环境跳过（Windows PowerShell smoke），0 项失败，通过率 100%（执行测试无一失败）**。

2. **零成本离线论文验算（reproduce-paper-results.mjs）**：
   - 4 项权威证据链与密码学哈希全部通过（`[PASS]`）；
   - 包含中英双语论文表 1、表 2 形式化状态矩阵与协议边界。

3. **CLI 独立开箱即用性**：
   - `node bin/ogs.mjs --help` 正常运行，基础核心命令可用。

---

## 二、 边界隔离审查

- [x] **已排除商业私有层**：`apps/team-site` 源码全量排除；
- [x] **已排除商业多机服务脚本**：`scripts/team-site-service.mjs`、`scripts/start-team-site-tailnet.ps1` 全量排除；
- [x] **已排除商业测试**：`tests/team-site-*.test.mjs`、`tests/archive/` 全量排除；
- [x] **已排除商业导入 Persona**：`og-roles/roles/imported.*`（250+ 商业角色）全量排除；
- [x] **已排除内部 UAT 与截图**：`docs/development/release-uat-checklist.md`、`docs/development/evidence/screenshots/` 全量排除；
- [x] **已排除动态运行数据**：所有 `.ogs/runs/` 及 `runs-index.json` 历史调试数据全量排除；
- [x] **已排除作者端导出流水线脚本**：`scripts/export-open-source-core.mjs` 排除出导出包；
- [x] **明确审稿期研究工具范围**：Visualizer & Studio 本地单机工作台（`src/visualizer/`）作为审稿期单节点研究辅助工具随包提供；正式 GA 阶段须按 Gate 2 将 Studio 编排剥离保留在私有层。

---

## 三、 全文件脱敏审计（Gate 4 导出物无死角审计）

审计器对导出目录执行了 100% 文件物理扫描（**无任何自我排除白名单例外**），确认以下标识泄露数为 **0**：
- **本地主机绝对路径**（如本机用户名路径）：0 处
- **真实未脱敏 Session ID**（如 `ses_e1af...`、`01a1e50e-...`）：0 处
- **真实未脱敏 Message ID**（如 `msg_093c...`）：0 处
- **未脱敏本地开发/服务端口**（如 `52195`、`4173`、`4174`、`4177`）：0 处
- **未脱敏服务 PID**：0 处（均已归零或占位化）
- **Tailnet 地址**：0 处

---

## 四、 执行耗时

- `pnpm install --frozen-lockfile`: ~1 秒
- `pnpm run build`: ~4 秒
- `reproduce-paper-results.mjs`: < 1 秒
- `run-node-tests.mjs` (486 项): ~45 秒
- **总端到端验证耗时**: 47.3 秒
