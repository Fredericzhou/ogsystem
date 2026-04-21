import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createGenericMarkdownAdapter } from "./generic-markdown.mjs";

const AGENCY_CATEGORY_DIRS = [
  "academic",
  "design",
  "engineering",
  "finance",
  "game-development",
  "marketing",
  "paid-media",
  "product",
  "project-management",
  "sales",
  "spatial-computing",
  "specialized",
  "strategy",
  "support",
  "testing"
];

function stripCategoryPrefix(record) {
  const fileBase = record.fileName.replace(/\.md$/i, "");
  const categoryPrefix = `${record.category}-`;
  return fileBase.startsWith(categoryPrefix) ? fileBase.slice(categoryPrefix.length) : fileBase;
}

export const agencyAgentsAdapter = createGenericMarkdownAdapter({
  sourceType: "agency-agents",
  roleNamespace: "agency",
  excludeDirs: [".github", "examples", "integrations", "scripts"],
  shouldInclude(content) {
    return /^---[\s\S]*?\bname:\s+/m.test(content) || /^name\s+.+$/m.test(content);
  },
  async detect(rootDir) {
    try {
      const [readme, entries] = await Promise.all([
        readFile(resolve(rootDir, "README.md"), "utf8"),
        readdir(rootDir, { withFileTypes: true })
      ]);
      return (
        readme.includes("The Agency") ||
        entries.some((entry) => entry.isDirectory() && AGENCY_CATEGORY_DIRS.includes(entry.name))
      );
    } catch {
      return false;
    }
  },
  roleSlug(record) {
    return stripCategoryPrefix(record);
  },
  tags(record) {
    return [stripCategoryPrefix(record)];
  }
});
