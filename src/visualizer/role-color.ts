export function roleColorForId(
  roleId: string,
  theme: "light" | "dark" = "light"
): { accent: string; fill: string; ink: string } {
  let hash = 2166136261;
  for (const character of roleId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  const hue = (hash >>> 0) % 360;
  return theme === "dark"
    ? { accent: `hsl(${hue} 78% 69%)`, fill: `hsl(${hue} 40% 17%)`, ink: `hsl(${hue} 60% 10%)` }
    : { accent: `hsl(${hue} 58% 30%)`, fill: `hsl(${hue} 42% 95%)`, ink: "#ffffff" };
}
