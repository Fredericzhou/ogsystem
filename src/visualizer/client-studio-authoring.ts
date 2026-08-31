/** Small client-side authoring adapters kept independent from the application controller. */
export function applyCanvasLayoutPatchToAuthoring(
  authoring: Record<string, any>,
  canvas: Record<string, any>
) {
  if (!authoring || typeof authoring !== "object" || Array.isArray(authoring)) {
    return authoring;
  }
  const roles = authoring.roles && typeof authoring.roles === "object" && !Array.isArray(authoring.roles)
    ? authoring.roles
    : {};
  const layout = authoring.layout && typeof authoring.layout === "object" && !Array.isArray(authoring.layout)
    ? authoring.layout
    : {};
  const nextNodes = layout.nodes && typeof layout.nodes === "object" && !Array.isArray(layout.nodes)
    ? { ...layout.nodes }
    : {};
  for (const node of Array.isArray(canvas?.nodes) ? canvas.nodes : []) {
    const roleId = typeof node?.roleId === "string" ? node.roleId : "";
    if (!roleId || !roles[roleId]) continue;
    nextNodes[roleId] = {
      x: Number(node.x ?? 0),
      y: Number(node.y ?? 0),
      width: Number(node.width ?? 180),
      height: Number(node.height ?? 84)
    };
  }
  return {
    ...authoring,
    layout: { ...layout, nodes: nextNodes, viewport: canvas?.viewport }
  };
}
