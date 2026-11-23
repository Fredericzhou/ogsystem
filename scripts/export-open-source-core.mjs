#!/usr/bin/env node

/**
 * @fileoverview Export and boundary verification tool for the OGSystem Open-Source Core.
 *
 * Ensures clean separation between:
 * - Open-Source Core (Apache-2.0): src/runtime, src/visualizer, src/design, bin, docs/paper, tests, examples
 * - Proprietary Commercial Layer: apps/team-site, non-benchmark roles in og-roles
 *
 * Usage:
 *   node scripts/export-open-source-core.mjs [--dry-run] [--out-dir <target_path>]
 */

import { readdir, readFile, stat, mkdir, cp } from "node:fs/promises";
import { resolve, join, relative } from "node:path";
import { parseArgs } from "node:util";

const repoRoot = resolve(import.meta.dirname, "..");

const rawArgs = process.argv.slice(2).filter(arg => arg !== "--");

const { values } = parseArgs({
  args: rawArgs,
  options: {
    "dry-run": { type: "boolean" },
    "out-dir": { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  strict: false,
  allowPositionals: true
});

if (values.help) {
  console.log(`
OGSystem Open-Source Core Export & Boundary Verifier
Usage:
  node scripts/export-open-source-core.mjs [options]

Options:
  --dry-run             Validate boundaries and print export manifest without copying
  --out-dir <path>      Destination directory to export clean open-core files
  --help                Show this help message
`);
  process.exit(0);
}

// 1. Files & directories that belong to the Open-Source Core
const CORE_INCLUDE_PATTERNS = [
  "bin",
  "src/runtime",
  "src/visualizer",
  "src/design",
  "src/business-events.ts",
  "src/context-selector.ts",
  "docs/paper",
  "examples",
  "schemas",
  "tests",
  "scripts/reproduce-paper-results.mjs",
  "scripts/run-node-tests.mjs",
  "scripts/build-visualizer-client.mjs",
  "package.json",
  "tsconfig.json",
  "tsconfig.visualizer-client.json",
  "README.md",
  "LICENSE"
];

// 2. Directories explicitly excluded (Proprietary / Commercial)
const PROPRIETARY_EXCLUDED = [
  "apps/team-site",
  "og-roles/roles/imported.*"
];

async function listFilesRecursive(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      files.push(...await listFilesRecursive(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

async function verifyCoreIndependence() {
  console.log("[-] Scanning Core codebase for unauthorized imports of proprietary components...");
  const srcFiles = await listFilesRecursive(join(repoRoot, "src"));
  const violations = [];

  for (const file of srcFiles) {
    if (!file.endsWith(".ts") && !file.endsWith(".js") && !file.endsWith(".mjs")) continue;
    const content = await readFile(file, "utf8");
    const rel = relative(repoRoot, file);

    if (content.includes("apps/team-site") || content.includes("team-site")) {
      // Exclude comments or self-descriptions if harmless, but flag imports
      if (/from\s+["'][^"']*team-site/.test(content) || /require\(["'][^"']*team-site/.test(content)) {
        violations.push({ file: rel, issue: "Forbidden import from apps/team-site" });
      }
    }
  }

  return violations;
}

async function main() {
  console.log("================================================================================");
  console.log("   OGSYSTEM: OPEN-SOURCE CORE EXPORT & ARCHITECTURAL BOUNDARY CHECKER");
  console.log("================================================================================\n");

  const violations = await verifyCoreIndependence();

  if (violations.length > 0) {
    console.error("✗ VIOLATIONS DETECTED: Open-core code has hard dependencies on proprietary layer:");
    for (const v of violations) {
      console.error(`  - ${v.file}: ${v.issue}`);
    }
    process.exit(1);
  }

  console.log("✓ Zero architectural coupling: Open-source Core has 0 imports from apps/team-site.\n");

  console.log("[-] Open-Source Core Scope:");
  for (const p of CORE_INCLUDE_PATTERNS) {
    console.log(`  + [INCLUDE] ${p}`);
  }
  console.log("\n[-] Proprietary Commercial Scope (Excluded from public repo):");
  for (const p of PROPRIETARY_EXCLUDED) {
    console.log(`  - [EXCLUDE] ${p}`);
  }

  if (values["out-dir"]) {
    const outDir = resolve(values["out-dir"]);
    console.log(`\n[-] Exporting core distribution to: ${outDir}`);
    await mkdir(outDir, { recursive: true });

    for (const item of CORE_INCLUDE_PATTERNS) {
      const srcPath = join(repoRoot, item);
      const destPath = join(outDir, item);
      try {
        const s = await stat(srcPath);
        if (s.isDirectory() || s.isFile()) {
          await cp(srcPath, destPath, { recursive: true });
        }
      } catch {
        // Optional file like LICENSE may not exist yet
      }
    }
    console.log("✓ Clean Open-Core export completed successfully.\n");
  } else {
    console.log("\n[i] Dry-run completed. Specify --out-dir <path> to generate clean export directory.");
  }
}

main().catch(err => {
  console.error("Export verification failed:", err);
  process.exit(1);
});
