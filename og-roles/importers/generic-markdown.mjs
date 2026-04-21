import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function listMarkdownFiles(rootDir, options) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (options.excludeDirs?.includes(entry.name)) {
      continue;
    }

    const categoryDir = join(rootDir, entry.name);
    const categoryEntries = await readdir(categoryDir, { withFileTypes: true });
    for (const categoryEntry of categoryEntries) {
      if (!categoryEntry.isFile() || !categoryEntry.name.endsWith(".md")) {
        continue;
      }
      results.push({
        category: entry.name,
        filePath: join(categoryDir, categoryEntry.name),
        relativePath: relative(rootDir, join(categoryDir, categoryEntry.name)).replaceAll("\\", "/"),
        fileName: categoryEntry.name
      });
    }
  }

  return results.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function pickMetadataLine(content, key) {
  const regex = new RegExp(`^${key}\\s+(.+)$`, "mi");
  const match = content.match(regex);
  return match?.[1]?.trim();
}

function pickHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim();
}

export function createGenericMarkdownAdapter(options) {
  return {
    sourceType: options.sourceType,
    async detect(rootDir) {
      if (options.detect) {
        return options.detect(rootDir);
      }
      const entries = await listMarkdownFiles(rootDir, options);
      return entries.length > 0;
    },
    async listAgents(rootDir) {
      return listMarkdownFiles(rootDir, options);
    },
    async normalize(record, context) {
      const content = await readFile(record.filePath, "utf8");
      if (options.shouldInclude && !options.shouldInclude(content, record)) {
        return null;
      }
      const title =
        pickMetadataLine(content, "name") ??
        pickHeading(content) ??
        basename(record.fileName, ".md");
      const description =
        pickMetadataLine(content, "description") ??
        options.defaultDescription?.(record) ??
        `${title} imported from ${context.sourceId}`;
      const sourceSlug = options.roleNamespace ?? slugify(context.sourceId);
      const normalizedSlug = slugify(
        options.roleSlug?.(record) ?? basename(record.fileName, ".md")
      );

      return {
        roleId: `imported.${sourceSlug}.${normalizedSlug}`,
        roleName: title,
        description,
        roleVersion: context.sourceCommit ? `imported-${context.sourceCommit.slice(0, 12)}` : "imported-dev",
        agent: content.trimEnd(),
        sourcePath: record.relativePath,
        tags: Array.from(
          new Set([
            "imported",
            options.sourceType,
            slugify(record.category),
            ...(options.tags?.(record) ?? [])
          ])
        ).filter(Boolean)
      };
    }
  };
}
