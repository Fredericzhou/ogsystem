export function roleColorForId(roleId: string): { accent: string; fill: string } {
  const colors = [
    { accent: "#1b7662", fill: "#e7f4ef" },
    { accent: "#c9674b", fill: "#fbefeb" },
    { accent: "#55798c", fill: "#eaf1f4" },
    { accent: "#bc8b39", fill: "#fbf5e7" },
    { accent: "#467c72", fill: "#e9f3ef" },
    { accent: "#738a73", fill: "#eef3eb" },
    { accent: "#9b6a58", fill: "#f7efeb" },
    { accent: "#687c86", fill: "#edf2f4" }
  ];
  let hash = 2166136261;
  for (const character of roleId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return colors[(hash >>> 0) % colors.length];
}
