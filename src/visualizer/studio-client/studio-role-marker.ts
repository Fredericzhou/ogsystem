export function studioRoleMarkerVisible(node: { roleSeat: boolean; editable: boolean }): boolean {
  return node.roleSeat && node.editable;
}

export function studioRoleMonogram(label: string, roleId: string): string {
  const source = label.trim() || roleId;
  const words = source.split(/[\s/_-]+/u).filter(Boolean);
  const parts = words.length > 1
    ? [words[0], words[words.length - 1]]
    : Array.from(source).slice(0, 2);
  return parts.map((part) => Array.from(part)[0] ?? "").join("").toUpperCase();
}
