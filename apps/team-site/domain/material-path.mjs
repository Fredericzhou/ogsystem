export const SUPPORTED_MATERIAL_EXTENSIONS = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv"]);

export function isSupportedMaterialPath(filename) {
  const leaf = String(filename || "").split("/").pop() || "";
  const dot = leaf.lastIndexOf(".");
  const extension = dot <= 0 ? (leaf.endsWith(".") ? "." : "") : leaf.slice(dot).toLowerCase();
  return SUPPORTED_MATERIAL_EXTENSIONS.has(extension);
}

export function normalizeMaterialPath(filename) {
  const normalized = String(filename || "material.txt").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw new Error("MATERIAL_PATH_INVALID: material path must stay inside the project workspace.");
  }
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part.includes("\0"))) throw new Error("MATERIAL_PATH_INVALID: material path is invalid.");
  return parts.join("/");
}
