export function roleColorForId(roleId: string): { accent: string; fill: string } {
  const colors = [
    { accent: "#38bdf8", fill: "rgba(56, 189, 248, 0.12)" },
    { accent: "#34d399", fill: "rgba(52, 211, 153, 0.12)" },
    { accent: "#fb7185", fill: "rgba(251, 113, 133, 0.12)" },
    { accent: "#fbbf24", fill: "rgba(251, 191, 36, 0.12)" },
    { accent: "#a78bfa", fill: "rgba(167, 139, 250, 0.12)" },
    { accent: "#22d3ee", fill: "rgba(34, 211, 238, 0.12)" },
    { accent: "#fb923c", fill: "rgba(251, 146, 60, 0.12)" },
    { accent: "#a3e635", fill: "rgba(163, 230, 53, 0.12)" }
  ];
  let hash = 2166136261;
  for (const character of roleId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return colors[(hash >>> 0) % colors.length];
}
