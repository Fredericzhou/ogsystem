import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DOCS = [
  {
    label: "README.md",
    path: path.resolve("README.md")
  },
  {
    label: "docs/usage/usage-manual.md",
    path: path.resolve("docs", "usage", "usage-manual.md")
  }
];

const REQUIRED_COMMANDS = [
  { command: "npm install -g ogsystem", files: ["README.md"] },
  { command: "pnpm add -g ogsystem", files: ["README.md"] },
  { command: "npm uninstall -g ogsystem", files: ["README.md"] },
  { command: "pnpm remove -g ogsystem", files: ["README.md"] },
  { command: "ogs project create demo-app --template minimal", files: ["README.md"] },
  { command: "ogs project init", files: ["README.md"] },
  { command: "ogs run start --system system.mmd --input \"smoke\" --dry-run", files: ["README.md"] },
  { command: "ogs run list", files: ["README.md"] },
  { command: "ogs run status <run-id>", files: ["README.md"] },
  { command: "ogs run logs <run-id> --engine --tail 50", files: ["README.md"] },
  { command: "ogs visualizer --ogs-dir .", files: ["README.md"] },
  { command: "pnpm build", files: ["docs/usage/usage-manual.md"] },
  { command: "pnpm test", files: ["docs/usage/usage-manual.md"] }
];

const REQUIRED_TEXT = [
  {
    label: "v2 contract marker",
    pattern: /ogsContractVersion[^\n]*2/,
    files: ["docs/usage/usage-manual.md"]
  },
  {
    label: "Harness binding",
    pattern: /Harness Template/,
    files: ["docs/usage/usage-manual.md"]
  },
  {
    label: "run freeze",
    pattern: /resolved-config\.json/,
    files: ["docs/usage/usage-manual.md"]
  }
];

function extractShellCommands(markdown) {
  const commands = new Set();
  const blockPattern = /```(?:bash|sh|shell)\r?\n([\s\S]*?)```/g;
  for (const match of markdown.matchAll(blockPattern)) {
    const logicalLines = [];
    let continuation = "";
    for (const rawLine of match[1].split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }
      if (line.endsWith("\\")) {
        continuation += `${line.slice(0, -1).trim()} `;
        continue;
      }
      logicalLines.push(`${continuation}${line}`.trim().replace(/\s+/g, " "));
      continuation = "";
    }
    for (const command of logicalLines) {
      commands.add(command);
    }
  }
  return commands;
}

const failures = [];
for (const doc of DOCS) {
  const markdown = await readFile(doc.path, "utf8");
  const commands = extractShellCommands(markdown);
  for (const required of REQUIRED_COMMANDS) {
    if (required.files.includes(doc.label) && !commands.has(required.command)) {
      failures.push(`${doc.label}: missing shell command block line: ${required.command}`);
    }
  }
  for (const required of REQUIRED_TEXT) {
    if (required.files.includes(doc.label) && !required.pattern.test(markdown)) {
      failures.push(`${doc.label}: missing text anchor: ${required.label}`);
    }
  }
}

assert.equal(failures.length, 0, failures.join("\n"));
console.log(`docs command drift check passed for ${DOCS.map((doc) => doc.label).join(", ")}`);
