import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// 这个脚本承担两个职责：
// 1. 模拟“部署成功/失败”的执行结果。
// 2. 在部署成功时，把最终页面产物写入 run 级 shared/ 目录。
//
// 这里故意把“产物落点”固定到 shared/：
// - 这样后续角色或操作者都能直接访问
// - 不会把最终交付物散落到某个角色私有目录
// - 更符合 run 级共享产物的语义

async function readPromptFromStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inferHeadline(prompt) {
  const promptLower = prompt.toLowerCase();
  if (promptLower.includes("hello world")) {
    return "hello world";
  }

  const zhMatch = prompt.match(/显示(.+?)(?:$|。|\.|，|,)/);
  if (zhMatch?.[1]?.trim()) {
    return zhMatch[1].trim();
  }

  const enMatch = prompt.match(/show\s+(.+?)(?:$|[.,])/i);
  if (enMatch?.[1]?.trim()) {
    return enMatch[1].trim();
  }

  return "generated page";
}

function buildHtmlDocument(headline, prompt) {
  const safeHeadline = escapeHtml(headline);
  const safePrompt = escapeHtml(prompt);

  return [
    "<!doctype html>",
    '<html lang="zh-CN">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeHeadline}</title>`,
    "  <style>",
    "    :root { color-scheme: light; }",
    "    body {",
    "      margin: 0;",
    "      min-height: 100vh;",
    "      display: grid;",
    "      place-items: center;",
    "      background: linear-gradient(160deg, #f4f7fb 0%, #dfe9f3 100%);",
    '      font-family: "Helvetica Neue", Arial, sans-serif;',
    "      color: #102033;",
    "    }",
    "    main {",
    "      width: min(720px, calc(100vw - 48px));",
    "      padding: 40px;",
    "      border-radius: 24px;",
    "      background: rgba(255, 255, 255, 0.88);",
    "      box-shadow: 0 20px 60px rgba(16, 32, 51, 0.14);",
    "      backdrop-filter: blur(10px);",
    "    }",
    "    h1 { margin: 0 0 12px; font-size: clamp(40px, 8vw, 72px); line-height: 1; }",
    "    p { margin: 0; font-size: 16px; line-height: 1.6; color: #425466; }",
    "    code {",
    "      display: inline-block;",
    "      margin-top: 16px;",
    "      padding: 8px 12px;",
    "      border-radius: 10px;",
    "      background: #eef4fb;",
    "      color: #16324f;",
    "    }",
    "  </style>",
    "</head>",
    "<body>",
    "  <main>",
    `    <h1>${safeHeadline}</h1>`,
    "    <p>该页面由 ogs-gstacklike 的 ship-deploy 阶段写入 run 级 shared/ 目录。</p>",
    `    <code>${safePrompt}</code>`,
    "  </main>",
    "</body>",
    "</html>",
    ""
  ].join("\n");
}

// 失败时不要写产物，直接让 runtime 按 Mermaid 的 ERROR 流处理。
if (process.env.SHIP_DEPLOY_FAIL === "1") {
  console.error("deploy failed: simulated release verification failure");
  process.exit(23);
}

const prompt = await readPromptFromStdin();
const sharedDir = process.env.OGSYSTEM_SHARED_DIR;

if (!sharedDir) {
  console.error("missing OGSYSTEM_SHARED_DIR");
  process.exit(24);
}

const headline = inferHeadline(prompt);
const outputPath = join(sharedDir, "index.html");

await mkdir(sharedDir, { recursive: true });
await writeFile(outputPath, buildHtmlDocument(headline, prompt), "utf8");

console.log(
  JSON.stringify({
    event: "SHIPPED",
    // content 面向人类阅读；真正驱动流程的是 event。
    content: `ship-deploy completed and wrote ${outputPath}`,
    data: {
      roleId: "ship-deploy",
      actor: process.env.ROLE_ACTOR ?? process.env.USER ?? "operator",
      outputPath,
      headline
    }
  })
);
