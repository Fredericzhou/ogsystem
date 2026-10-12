import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(repoRoot, "docs", "copyright-output");
const manualPath = path.join(repoRoot, "docs", "copyright", "user-manual.md");
const sourceRoot = path.join(repoRoot, "src");
const manualStem = "OGSystem-1.0.0-User-Manual";
const sourceStem = "OGSystem-1.0.0-Source-Code-Identification";

function escapeHtml(text) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function inline(text) {
  return escapeHtml(text).replace(/`([^`]+)`/gu, "<code>$1</code>");
}

function renderManual(markdown) {
  let inCode = false;
  const body = [];
  for (const line of markdown.split(/\r?\n/u)) {
    if (line.startsWith("```")) {
      body.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
    } else if (inCode) {
      body.push(escapeHtml(line));
    } else if (/^#{1,3} /u.test(line)) {
      const level = line.match(/^#+/u)[0].length;
      body.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
    } else if (/^- /u.test(line)) {
      body.push(`<p class="bullet">&#8226; ${inline(line.slice(2))}</p>`);
    } else if (/^\s*\d+\. /u.test(line)) {
      body.push(`<p class="numbered">${inline(line.trim())}</p>`);
    } else if (line.trim()) {
      body.push(`<p>${inline(line)}</p>`);
    } else {
      body.push("<div class=\"spacer\"></div>");
    }
  }
  return body.join("\n");
}

async function listTypeScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(fullPath);
    return /\.tsx?$/u.test(entry.name) ? [fullPath] : [];
  }));
  return nested.flat().sort((a, b) => {
    const left = a.split(path.sep).join("/");
    const right = b.split(path.sep).join("/");
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

async function sourceRecords() {
  const records = [];
  for (const file of await listTypeScriptFiles(sourceRoot)) {
    const relative = path.relative(repoRoot, file).replaceAll(path.sep, "/");
    const lines = (await fs.readFile(file, "utf8")).split(/\r?\n/u);
    lines.forEach((text, index) => records.push({ file: relative, line: index + 1, text }));
  }
  return records;
}

function sourcePage(records, index) {
  const lines = records.map(({ file, line, text }) =>
    `<div class="source-line"><span class="origin">${escapeHtml(`${file}:${line}`)}</span><code>${escapeHtml(text) || " "}</code></div>`
  ).join("");
  return `<section class="source-page"><div class="page-head">OGSystem 1.0.0 | 源程序鉴别材料 | 第 ${index + 1} 页</div>${lines}</section>`;
}

const manualMarkdown = await fs.readFile(manualPath, "utf8");
const records = await sourceRecords();
if (records.length < 3000) {
  throw new Error(`Need at least 3,000 source lines for front/back 30-page material; found ${records.length}.`);
}
const sample = [...records.slice(0, 1500), ...records.slice(-1500)];
const pages = Array.from({ length: 60 }, (_, index) => sourcePage(sample.slice(index * 50, index * 50 + 50), index));

await fs.mkdir(outputDir, { recursive: true });
const manualHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OGSystem 使用说明书</title><style>
@page{size:A4;margin:18mm 18mm 17mm;@bottom-right{content:counter(page);font:9pt sans-serif;color:#555}}
body{font-family:"Microsoft YaHei","Noto Sans CJK SC",sans-serif;color:#171717;font-size:11pt;line-height:1.35}h1{font-size:20pt;text-align:center;margin:0 0 12pt}h2{font-size:14pt;margin:14pt 0 6pt;border-bottom:1px solid #888;padding-bottom:3pt;break-after:avoid}h3{font-size:11pt;margin:10pt 0 4pt;break-after:avoid}p{margin:3pt 0;text-align:justify}.bullet,.numbered{padding-left:12pt}code,pre{font-family:Consolas,"Microsoft YaHei",monospace;font-size:9pt}pre{white-space:pre-wrap;margin:8pt 12pt;padding:8pt;border:1px solid #bbb}.spacer{height:3pt}strong{font-weight:600}
</style><body>${renderManual(manualMarkdown)}</body></html>`;
const sourceHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>OGSystem 源程序鉴别材料</title><style>
@page{size:A4 portrait;margin:14mm 12mm 13mm;@bottom-right{content:counter(page);font:8pt sans-serif;color:#555}}
*{box-sizing:border-box}body{margin:0;font-family:Consolas,"Microsoft YaHei",monospace;color:#111}.source-page{break-after:page;page-break-after:always}.source-page:last-child{break-after:auto;page-break-after:auto}.page-head{font:8pt "Microsoft YaHei",sans-serif;border-bottom:1px solid #777;padding-bottom:3pt;margin-bottom:4pt}.source-line{display:grid;grid-template-columns:155px minmax(0,1fr);font-size:5.5pt;line-height:7pt;white-space:pre-wrap;overflow-wrap:anywhere}.origin{color:#444;font-size:5pt}.source-line code{font:inherit}
</style><body>${pages.join("\n")}</body></html>`;

await fs.writeFile(path.join(outputDir, `${manualStem}.html`), manualHtml, "utf8");
await fs.writeFile(path.join(outputDir, `${sourceStem}.html`), sourceHtml, "utf8");

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(manualHtml, { waitUntil: "load" });
  await page.pdf({ path: path.join(outputDir, `${manualStem}.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
  await page.setContent(sourceHtml, { waitUntil: "load" });
  const pdf = await page.pdf({ path: path.join(outputDir, `${sourceStem}.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
  const sourcePdfPages = [...pdf.toString("latin1").matchAll(/\/Type\s*\/Page\b/gu)].length;
  const result = {
    manualPdf: path.join(outputDir, `${manualStem}.pdf`),
    manualPages: await pdfPageCount(page, manualHtml),
    sourceHtml: path.join(outputDir, `${sourceStem}.html`),
    sourcePdf: path.join(outputDir, `${sourceStem}.pdf`),
    sourceLines: records.length,
    sourceSampleLines: sample.length,
    sourcePagesExpected: 60,
    sourcePageObjects: sourcePdfPages
  };
  console.log(JSON.stringify(result, null, 2));
  if (sourcePdfPages > 0 && sourcePdfPages !== 60) {
    throw new Error(`Source material rendered to ${sourcePdfPages} PDF pages; expected exactly 60. Adjust print layout before submission.`);
  }
} finally {
  await browser.close();
}

async function pdfPageCount(page, html) {
  await page.setContent(html, { waitUntil: "load" });
  const bytes = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  return [...bytes.toString("latin1").matchAll(/\/Type\s*\/Page\b/gu)].length;
}
