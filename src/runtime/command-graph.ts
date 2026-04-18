/**
 * Mermaid command graph generator for the shared command registry.
 * Responsibilities:
 * - Render the command registry as a deterministic flowchart.
 * - Provide a Mermaid Live URL for quick preview.
 * Boundaries:
 * - Read-only string generation only.
 */

import { createHash } from "node:crypto";

import { getCommandGraphNodes } from "./command-registry.js";

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function escapeLabel(value: string): string {
  return value.replace(/"/g, '\\"');
}

export function buildCommandGraphMermaid(): string {
  const nodes = getCommandGraphNodes();
  const lines = ["flowchart TD"];
  for (const node of nodes) {
    lines.push(`  ${node.id.replace(/[^A-Za-z0-9_]/g, "_")}["${escapeLabel(node.label)}"]`);
  }
  for (const node of nodes) {
    if (!node.parentId) {
      continue;
    }
    lines.push(
      `  ${node.parentId.replace(/[^A-Za-z0-9_]/g, "_")} --> ${node.id.replace(/[^A-Za-z0-9_]/g, "_")}`
    );
  }
  return lines.join("\n");
}

export function buildCommandGraphText(): string {
  const nodes = getCommandGraphNodes();
  return nodes
    .map((node) => `${node.id} | ${node.summary}${node.parentId ? ` | parent=${node.parentId}` : ""}`)
    .join("\n");
}

export function buildCommandGraphLiveUrl(source?: string): string {
  const mermaid = source ?? buildCommandGraphMermaid();
  const digest = createHash("sha256").update(mermaid).digest("hex").slice(0, 8);
  const payload = JSON.stringify({
    code: mermaid,
    mermaid: { theme: "default" }
  });
  return `https://mermaid.live/edit#base64:${toBase64Url(payload)}?v=${digest}`;
}
