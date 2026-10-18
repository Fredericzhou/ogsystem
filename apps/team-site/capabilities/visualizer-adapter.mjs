function authorizationHeader(username, password) {
  if (!username || !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

export function createVisualizerAdapter({ baseUrl, username, password, fetchImpl = fetch } = {}) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  return {
    async chat({ projectId, payload }) {
      const target = new URL(`/api/v1/ogs/workspace/studio/chat?projectId=${encodeURIComponent(projectId)}`, root);
      const headers = { "content-type": "application/json" };
      const authorization = authorizationHeader(username, password);
      if (authorization) headers.authorization = authorization;
      const response = await fetchImpl(target, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { error: text || "Visualizer response was not JSON." }; }
      return { status: response.status, body };
    }
  };
}
