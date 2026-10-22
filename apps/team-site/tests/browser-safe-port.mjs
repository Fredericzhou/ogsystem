import { createServer } from "node:net";

export async function reserveBrowserSafePort() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = 30000 + Math.floor(Math.random() * 20000);
    const probe = createServer();
    try {
      await new Promise((resolve, reject) => {
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", resolve);
      });
      await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
      return port;
    } catch {
      await new Promise((resolve) => probe.close(() => resolve()));
    }
  }
  throw new Error("Unable to reserve a browser-safe local port.");
}
