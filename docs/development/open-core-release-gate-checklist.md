# OGSystem Open-Core 正式发布门禁清单 (Open-Core Release Gate Checklist)

> **当前状态 / Status:** Open-Core 架构与发布门禁设计已完成，当前优先交付论文审稿用的匿名复现包；正式 Open-Core GA 仍未达到发布条件。
> **纪律红线 / Invariant:** 匿名复现包与正式 Open-Core GA 使用不同门槛。在 GA 的 8 项发布门禁逐一实测通过并签收前，**严禁向公共 GitHub 推送正式开源仓库、严禁公开发布 Docker 镜像、严禁申请并锁定正式 Zenodo DOI**。

---

## 当前门禁实际执行状态对照表 (Current Gate Status Audit)

| 门禁 (Release Gate) | 当前执行状态 | 实际差距与整改进展 |
| :--- | :---: | :--- |
| **Gate 1: 物理许可证与法律条款** | ✅ 阶段 A/B 已通过 | 根目录标准 `LICENSE` (Apache-2.0) 与 `NOTICE`（含版权声明、第三方依赖致谢与专利免责）已物理落地；根 `package.json` 显式声明 `license: Apache-2.0`，`apps/team-site` 显式标注 `private: true` 与 `UNLICENSED`。 |
| **Gate 2: 研究工具与商业层边界确立** | ✅ 阶段 A/B 边界已锁定 | 本地单机 Visualizer & Studio 工作台（`src/visualizer/`）已正式明确归类为开源研究与开发者工具（随 Apache-2.0 核心代码提供）；商业专有私有层严格限定为：① `apps/team-site` 团队协同系统，② Tailnet 多机组网部署脚本，③ 250+ 商业导入 Persona，④ 商业 UAT 证据与人工签字流。 |
| **Gate 3: Clean-Room 隔离复现** | ✅ 阶段 A 实测通过 | 阶段 A 匿名包在全新独立目录（`dist/anonymous-artifact`）实测端到端通过：`pnpm install --frozen-lockfile`、`pnpm build`、`reproduce-paper-results.mjs`、`run-node-tests.mjs`（485 通过、1 跳过、0 失败，共 486 项，已剔除 3 项商业测试）及 CLI dry-run；生成 `ogsystem-anonymous-artifact.tar.gz` 并在仓库提交 SHA-256 清单与审计报告。云端单向流水线留待阶段 B。 |
| **Gate 4: 运行证据与数据脱敏** | ✅ 阶段 A 实测通过 | 阶段 A 导出管道实现全文件物理扫描与自动化脱敏校验，确认 0 处本地机主路径、0 处真实未脱敏 Session/Message ID、0 处未脱敏本地开发端口（如 52195、4173）及 0 处真实服务 PID 泄露；仅打包论文引用的 3 项核心离线记录。 |
| **Gate 5: 论文链接真实化** | ⚠️ 审稿期合规 | 论文文稿已消除虚假占位符，统一为审稿期双盲声明（*Anonymized replication package provided during review*）；公开仓库与 Zenodo 永久 DOI 待录用后阶段 B 创建。 |
| **Gate 6: 评测数据分级与保密** | ⚠️ 阶段 A 已隔离 | 阶段 A 导出已自动剔除商业 persona（`og-roles/roles/imported.*`）；Hidden Tests 保留于内部，公开基准随包提供。 |
| **Gate 7: 严格单向发布流水线** | ❌ 阶段 B 待落地 | 本地单向导出脚本 `scripts/export-open-source-core.mjs` 已成型并支持 `--archive` 与 `--verify-cleanroom`；云端 GitHub Actions 自动发布待 GA 阶段实现。 |
| **Gate 8: 依赖合规与 SBOM 清单** | ⚠️ 阶段 A 初步合规 | `NOTICE` 文件中已落地直接关键依赖的许可证声明（MIT / Apache-2.0 / EPL-2.0），无 GPL/AGPL 强传染协议；完整 SPDX/CycloneDX SBOM 清单待阶段 B 产出。 |

---

## 分阶段交付策略 (Two-Stage Delivery)

### 阶段 A：匿名论文复现包 (Minimum Anonymous Artifact)

阶段 A 的目标是让审稿人能够复核论文核心结论，不承担正式商业发布的全部运营和自动化要求。必须完成：

- 固定公开范围：只包含论文所需的 Runtime、只读审计能力、公开 Benchmark、示例和复现脚本；
- 排除 Team Site、Studio 编排、商业角色和 Hidden Tests；
- 清除本机路径、Session、凭据、业务数据和其他内部运行信息；
- 在全新临时目录完成一次安装、构建、CLI dry-run、公开测试和论文复现脚本；
- 提供 Apache-2.0 许可证文本和第三方依赖说明，确保匿名包本身具备明确的使用授权。

阶段 A 可以使用匿名压缩包或受控 Artifact 链接，不要求公开 GitHub 仓库、Docker 镜像、Zenodo DOI、自动推送流水线或完整 SBOM。

### 阶段 B：正式 Open-Core GA

阶段 B 才执行 Gate 1 至 Gate 8 的完整要求，包括 Visualizer 物理拆分、单向发布流水线、完整 SBOM、多平台 CI、Docker 镜像、公开仓库和 Zenodo DOI。阶段 A 的通过不代表阶段 B 已通过。

**当前执行目标：先完成阶段 A；阶段 B 保持为正式录用后的发布计划。**

---

## 一、 战略背景与核心准则

Open-Core 分层架构旨在同时满足**学术严谨可复现（Academic Reproducibility）**与**商业资产与工程壁垒保护（Commercial IP Protection）**。
然而，“完成架构解耦与目标设计”不等于“具备开箱即用且合法合规的发布包”。为避免商业资产意外泄露、法务诉讼风险及学术数据造假质疑，正式发布必须通过以下 8 项独立门禁。

---

## 二、 八大正式发布门禁 (The Eight Release Gates)

### Gate 1: 物理许可证与法律条款落地 (Licenses, Copyright & Patent Disclaimer)
- [ ] **根目录 LICENSE 落地**：开源包根目录下必须包含标准完整的 Apache License, Version 2.0 官方文本。
- [ ] **物理 NOTICE 文件落地**：
  - 声明 `Copyright 2026 OGSystem Authors`；
  - 明确第三方依赖版权声明与致谢；
  - 明确专利条款边界：说明 Apache-2.0 仅对贡献代码提供专利实施许可（Patent Grant），不构成通用免诉保证，明确专利风险防范边界。
- [ ] **包级显式声明**：
  - 公开核心库 `package.json` 显式标注 `"license": "Apache-2.0"`；
  - 商业私有库（如 `apps/team-site`）显式标注 `"private": true` 与 `"license": "UNLICENSED"`。

### Gate 2: Visualizer 能力细粒度解耦 (Fine-Grained Visualizer Decomposition)
- [ ] **严禁整目录公开**：`src/visualizer/` 包含大量高价值商业协作与 Studio 编排能力，严禁整目录直接打包发布。
- [ ] **明确公开与私有接口边界**：
  - **公开开源部分（Read-Only Inspector）**：仅开放纯只读审计投影（`timeline-projector.ts`、`ops-summary-projection.ts`、`run-query-service.ts`、基础 Mermaid/X6 只读拓扑渲染）；
  - **私有保留部分（Studio Authoring & Control）**：Studio 拖拽式图谱编排（`studio-authoring.ts`）、自然语言转图（`studio-chat-to-mmd.ts`）、图命令与状态修改（`studio-graph-commands.ts`）、企业级团队资产导出控制必须剥离并保留在私有层。

### Gate 3: Clean-Room 隔离复现验证 (Clean-Room Isolated Replication)
- [ ] **独立隔离环境验证**：
  - 在完全脱离本地开发机缓存的空白临时目录（Clean-Room Temporary Directory）或全新 Docker 容器中执行全流程验证；
  - 必须端到端执行通过：
    1. `pnpm install --frozen-lockfile`（零全局依赖侵入）；
    2. `pnpm build`（独立构建 Core 产物）；
    3. `node scripts/run-node-tests.mjs`（核心 488+ 项测试全绿）；
    4. `ogs --help` 与 CLI dry-run（命令行工具可用）；
    5. `pnpm run reproduce:paper-evidence`（离线验证脚本 100% 通过）。
- [ ] **CI 自动化回归**：由独立 GitHub Action 在 Ubuntu/macOS 干净沙箱中自动执行上述验证。

### Gate 4: 运行证据与实验数据脱敏审查 (Evidence & Data Redaction)
- [ ] **物理路径脱敏**：
  - 扫描 `docs/development/evidence/` 及所有示例日志，彻底剥离本机物理路径（如 `<developer-home>/...`），替换为标准相对路径或 `/workspace/...`；
- [ ] **网络与凭据脱敏**：
  - 清洗本地开发 IP（如 `127.0.0.1:4173` 等本地回环地址、局域网 IP）、开发端口与临时测试 Session ID；
  - 确认无任何真实的商业大模型 API Key、网关 Token 或私有业务请求明文。
- [ ] **Commit 历史清理**：导出的 Git 历史中不得包含包含敏感信息的旧 commit 节点。

### Gate 5: 论文链接真实化与消除占位符 (Real Repository & Zenodo DOI upon Publication)
- [ ] **消除过度承诺与虚假链接**：
  - 文稿中严禁出现组织/仓库占位符（如 `<org>/<repo>`）或未分配的 Zenodo DOI 记录号（如 `10.5281/zenodo.<placeholder>`）等占位符链接；
- [ ] **分阶段规范表述**：
  - **预印本 / 同行评审阶段**：严格使用标准双盲规范表述（*“Anonymized replication package provided during review; code and Zenodo DOI will be deposited upon formal publication”*）；
  - **终稿录用阶段**：仅在公开仓库真实创建、Zenodo 实测打通生成永久 DOI 后，方可一次性回填真实地址。

### Gate 6: 评测数据分级与 Hidden Tests 保密 (Benchmark Tiering & Test Secrecy)
- [ ] **公开与隐藏测试严格隔离**：
  - **公开仓库发布内容**：公开开发基准任务集（Public Dev Tasks）、评估评分表（Rubrics）、指标计算公式与自动化评测驱动脚本；
  - **隐藏测试套件（Hidden Test Oracles）**：用于衡量模型泛化性与防止作弊/数据污染的 Hidden Tests 必须严格保留在内部门禁中，严禁推送到公开代码库。

### Gate 7: 严格单向发布流水线治理 (One-Way Automated Release Pipeline)
- [ ] **杜绝人工双仓操作**：严禁通过人工复制代码的方式维护开源库与商业库；
- [ ] **单向发布流水线（One-Way Pipeline）**：
  ```text
  [私有主开发仓: ogsystem-private]
          │
          ▼ 触发 Release 标签 (vX.Y.Z)
  [Git 路径白名单过滤 + 敏感信息脱敏 (Sanitizer)]
          │
          ▼
  [Clean-Room 隔离编译与自动化测试门禁]
          │ (通过)
          ▼
  [自动推送至公开开源仓库: ogsystem-core]
          │
          ▼
  [Zenodo Webhook 自动生成正式 DOI]
  ```

### Gate 8: 第三方依赖合规审计与 SBOM (Third-Party Dependency Audit & SBOM)
- [ ] **依赖许可证审查**：
  - 使用许可证扫描工具检查全量直接与间接依赖（包括 `@antv/x6`、`elkjs`、`marked`、`dompurify`、`@langchain/core`、`@langchain/langgraph` 等）；
  - 确认没有任何 GPL、AGPL 等强传染性开源协议渗透进开源核心发布包。
- [ ] **生成 SBOM 清单**：生成标准的软件物料清单（Software Bill of Materials）与第三方版权致谢文件（Third-Party Notices）。

---

## 三、 执行纪律

1. **红线规则**：任何团队成员或自动化脚本，在未获得上述 8 项门禁的全部确认前，不得修改论文将其声明为“已在公共网络公开”。
2. **审计归档**：每项门禁的通过记录必须附带对应的 CI 运行日志链接或校验报告，归档于 `docs/development/evidence/release-gates/`。
