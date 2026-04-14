# OGSystem Flow / Edge 对齐执行计划（2026-04-15）

Archived: yes (delivery record; execution is complete and active truth has been written back to code/tests/docs)

## 1. 目标

按最新结论执行：

1. `flow` 是系统根语义。
2. `edge` 仅保留给 Mermaid 语法层。
3. 本次直接按目标版本收敛，不设计迁移期语义，不保留 alias，不引入双 canonical 文档口径。

注意：

1. 这是一次**定向批量替换**，不是全仓无差别字符串替换。
2. Mermaid 语法解释、parser token 命名、`edge label` 一类纯语法词必须保留。

---

## 2. 替换原则

### 2.1 必须替换成 `flow` 的场景

以下属于运行时或语义层，应统一改为 `flow`：

1. 异常流主术语：
   - `异常边语义` -> `异常流语义`
   - `exception edges` -> `error flows`
   - `error edge` -> `error flow`
2. 业务语义对比：
   - `business event edges` -> `business event flows`
   - `异常边 vs 业务事件边` -> `异常流 vs 业务事件流`
3. runtime/config/code naming：
   - `runtime.error_edges.v1` -> `runtime.error_flows.v1`
   - `errorEdgeRoutingEnabled` -> `errorFlowRoutingEnabled`
   - `error-edge-*` 文件/目录/测试名 -> `error-flow-*`
4. 非语法层的 “incoming/outgoing edges”：
   - 若描述运行时匹配、路由、校验结果，应改成 `incoming/outgoing flows`

### 2.2 必须保留 `edge` 的场景

以下不要改：

1. Mermaid 原文语法说明。
2. `A -->|EVENT| B` 这种文本结构解释。
3. `edge label`
4. `boundary edge`
5. parser 内部语法对象与函数：
   - `TokenizedEdge`
   - `parseEdgeLine`
   - parser 中围绕 Mermaid 行解析的 `edge` 局部变量
6. “Mermaid incoming edges” 这类明确指源文件结构的表述

### 2.3 双层表达保留规则

对于既涉及 Mermaid 又涉及 runtime 的段落，采用双层写法：

1. `Mermaid edge 会被编译成 runtime flow`
2. `ERROR* 在 Mermaid 中是 edge label，在运行时语义上属于 error flow`

---

## 3. 执行范围

### 3.1 第一批：活跃文档

优先处理以下文件：

1. `README.md`
2. `docs/ogsystem-orchestration-semantics-v1.md`
3. `docs/ogsystem-semantics-manual.md`
4. `docs/usage-manual.md`
5. `docs/product-introduction.md`
6. `docs/DECISIONS.md`
7. `docs/ogsystem-wait-timeout-semantics-v2.md`
8. `docs/ogsystem-ebook.md`

处理目标：

1. 把主术语统一成 `flow`。
2. 保留 Mermaid 语法层的 `edge`。
3. 把 runtime 配置说明统一成 `runtime.error_flows.v1`。

### 3.2 第二批：runtime 代码与类型

处理文件：

1. `src/runtime/types.ts`
2. `src/runtime/config.ts`
3. `src/runtime/adapter.ts`
4. `src/runtime/project-lifecycle.ts`
5. `src/runtime/graph-runner.ts`
6. `schemas/runtime-config.schema.json`
7. `src/runtime/error-edge-utils.ts` -> 目标改名为 `src/runtime/error-flow-utils.ts`

处理目标：

1. runtime config 字段改为 `error_flows`。
2. 内部变量名改为 `errorFlow*`。
3. parser 中纯语法层的 `edge` 命名不动。

### 3.3 第三批：示例与测试

处理文件：

1. `examples/error-edge-compensation/` -> 目标改名为 `examples/error-flow-compensation/`
2. `tests/error-edge-runtime.test.mjs` -> `tests/error-flow-runtime.test.mjs`
3. `tests/config.test.mjs`
4. `tests/config-schema.test.mjs`
5. `tests/error-envelope.test.mjs`
6. 其他引用 `runtime.error_edges.v1`、`error edge`、或 `errorEdge*` 命名的 tests/examples

处理目标：

1. 示例路径、README、prompt 文案统一。
2. 测试标题与 fixture 名统一。
3. 更新 import / path / docs 引用。

### 3.4 暂不处理

以下范围不纳入本轮：

1. `docs/archive/**`
2. 历史记录型文件
3. 仅用于说明 Mermaid 语法且不涉及 runtime 语义的 edge 表达

---

## 4. 批量替换策略

### 4.1 先做“可安全批量替换”的词

适合直接批量替换：

1. `异常边语义` -> `异常流语义`
2. `runtime.error_edges.v1` -> `runtime.error_flows.v1`
3. `business event edges` -> `business event flows`
4. `exception edges` -> `error flows`
5. `error edge` -> `error flow`（限非 parser、非 Mermaid 语法说明文件）
6. `error-edge-` -> `error-flow-`（文件名、测试名、目录名）

### 4.2 再做“需要人工复核”的词

不能直接全局替换，必须逐处确认：

1. `incoming edges`
2. `outgoing edges`
3. `ERROR* edges`
4. `异常边`
5. `edge` / `edges`

判断规则：

1. 若在解释 Mermaid 语法，保留。
2. 若在解释 runtime 行为、join readiness、配置开关、补偿语义，改为 `flow`。

---

## 5. 工具执行顺序

### 5.1 扫描

先扫描活跃文件：

```bash
rg -n "异常边|error_edges|ERROR\\* edges|business event edges|error edge" README.md docs src tests examples schemas --glob '!docs/archive/**'
rg -n "\\berrorEdge[A-Za-z]+\\b|\\berrorFlow[A-Za-z]+\\b" src tests
```

### 5.2 第一轮安全替换

建议使用 `perl -0pi -e` 或 `sd` 做成组替换。

示例：

```bash
perl -0pi -e 's/异常边语义/异常流语义/g' README.md docs/*.md
perl -0pi -e 's/runtime\\.error_edges\\.v1/runtime.error_flows.v1/g' README.md docs/*.md src/runtime/*.ts tests/*.mjs schemas/*.json examples/**/*.json examples/**/*.md
perl -0pi -e 's/business event edges/business event flows/g' README.md docs/*.md
```

说明：

1. `examples/**/*.json` 需确认 shell 支持 globstar；若不支持，用 `rg --files examples | rg "\\.(json|md)$"` 配合循环。
2. `docs/*.md` 不会覆盖根 `README.md`，因此 README 需单独纳入命令参数。
3. 对代码文件的批量替换只覆盖明确字段名，不做裸 `edge` 替换。
4. `schemas/*.json` 需显式纳入，否则 `runtime-config.schema.json` 不会被更新。

### 5.3 文件与路径改名

示例：

```bash
mv src/runtime/error-edge-utils.ts src/runtime/error-flow-utils.ts
mv tests/error-edge-runtime.test.mjs tests/error-flow-runtime.test.mjs
mv examples/error-edge-compensation examples/error-flow-compensation
```

然后批量更新引用：

```bash
rg -l "error-edge-utils|error-edge-runtime|error-edge-compensation|error_edges|errorEdgeRoutingEnabled" README.md src tests docs examples schemas | xargs perl -0pi -e 's/error-edge-utils/error-flow-utils/g; s/error-edge-runtime/error-flow-runtime/g; s/error-edge-compensation/error-flow-compensation/g; s/error_edges/error_flows/g; s/errorEdgeRoutingEnabled/errorFlowRoutingEnabled/g'
```

### 5.4 第二轮人工复核

执行：

```bash
rg -n "\\bedge\\b|\\bedges\\b" README.md docs src tests examples schemas --glob '!docs/archive/**'
rg -n "\\berrorEdge[A-Za-z]+\\b|\\berrorFlow[A-Za-z]+\\b" src tests
```

逐类确认：

1. Mermaid 语法层保留。
2. parser 语法层保留。
3. runtime/config/docs 主术语若还残留，则改成 `flow`。
4. `errorEdge*` 不再出现在活跃代码与活跃测试中。

---

## 6. 分批提交建议

### Commit 1：活跃文档术语对齐

只改文档：

1. 主术语改为 `flow`
2. `runtime.error_flows.v1` 写法统一
3. Mermaid 语法层表述保留
4. 活跃文档不再保留任何 `error_edges` canonical 说明

### Commit 2：runtime 配置与代码命名

只改代码：

1. `error_edges` -> `error_flows`
2. `errorEdge*` -> `errorFlow*`
3. helper 文件改名

### Commit 3：示例与测试收口

1. examples 目录名、README、runtime.json
2. tests 文件名、测试名、fixture 文案
3. 运行全量测试

---

## 7. 验证清单

### 7.1 文本验证

确保以下结果成立：

1. 活跃文档中不再把 runtime 主语义写成“异常边语义”。
2. 活跃文档中 runtime 开关统一写成 `runtime.error_flows.v1`。
3. 活跃区不再保留 `runtime.error_edges.v1`、`error_edges` canonical、或兼容 alias 说明。
4. Mermaid 语法说明仍保留 `edge`、`edge label`、`boundary edge`。
5. 活跃代码与活跃测试中不再保留 `errorEdge*` 命名。

### 7.2 代码验证

至少运行：

```bash
pnpm build
pnpm test
```

若想先快验：

```bash
pnpm build
node --test tests/config.test.mjs tests/config-schema.test.mjs tests/parser.test.mjs tests/error-flow-runtime.test.mjs
node --test tests/error-envelope.test.mjs
```

### 7.3 残留扫描

最后执行：

```bash
rg -n "runtime\\.error_edges\\.v1|异常边语义|error edge|business event edges" README.md docs src tests examples schemas --glob '!docs/archive/**'
rg -n "\\berrorEdge[A-Za-z]+\\b" src tests
```

预期：

1. 活跃区无残留。

---

## 8. 风险控制

1. 不做 `edge -> flow` 的裸全局替换。
2. parser 语法层文件要单独保护，避免误改 `TokenizedEdge`、`parseEdgeLine`。
3. 目录重命名后先跑 `rg` 查引用，再跑测试，避免 import/path 漏改。
4. 若某段文案同时描述 Mermaid 与 runtime，用双层表达，不强行单词替换。

---

## 9. 一句话执行顺序

先批量替换**确定安全的 runtime 术语**，再人工复核所有 `edge/edges` 残留，只把 Mermaid 语法层留下，其余全部收口到 `flow`。
