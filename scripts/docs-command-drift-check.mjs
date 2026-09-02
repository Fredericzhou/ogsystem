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
  "npm install -g ogsystem",
  "pnpm add -g ogsystem",
  "npm uninstall -g ogsystem",
  "pnpm remove -g ogsystem",
  "ogs project create demo-app --template minimal",
  "ogs project init",
  "ogs run start --system system.mmd --input \"smoke\" --dry-run",
  "ogs run list",
  "ogs run status <run-id>",
  "ogs run logs <run-id> --engine --tail 50",
  "ogs visualizer --workdir ."
];

const REQUIRED_TEXT = [
  {
    label: "retention tiers",
    pattern: /Retention tiers:/,
    files: ["docs/usage/usage-manual.md"]
  },
  {
    label: "provider health stable codes",
    pattern: /DOCTOR_PROVIDER_ONLINE_SKIPPED/,
    files: ["docs/usage/usage-manual.md"]
  },
  {
    label: "redaction authorization boundary",
    pattern: /authorization headers/,
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
    if (!commands.has(required)) {
      failures.push(`${doc.label}: missing shell command block line: ${required}`);
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
