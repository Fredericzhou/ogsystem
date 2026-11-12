export function normalizeMaterialPath(filename) {
  const normalized = String(filename || "material.txt").replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => part === "..")) {
    throw new Error("MATERIAL_PATH_INVALID: material path must stay inside the project workspace.");
  }
  const parts = normalized.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part.includes("\0") || part.startsWith("."))) throw new Error("MATERIAL_PATH_INVALID: material path is invalid.");
  return parts.join("/");
}

/** Materials are typed files; extension allowlists belong to optional tools, not storage. */
export function isSupportedMaterialPath(filename) {
  try { normalizeMaterialPath(filename); return true; } catch { return false; }
}
