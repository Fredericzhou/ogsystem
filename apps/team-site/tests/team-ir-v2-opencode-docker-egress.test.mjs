import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getDockerEgressProxySourceForTest } from "../infrastructure/team-ir-v2-opencode-docker-resolver.mjs";

const image = "node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914";
const docker = process.env.OGS_TEAM_IR_V2_DOCKER_BIN || "docker";

function command(args, { input, capture = true } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(docker, args, { shell: false, stdio: [input === undefined ? "ignore" : "pipe", capture ? "pipe" : "ignore", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk).subarray(0, 2048)));
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve(Buffer.concat(stdout).toString("utf8").trim())
      : reject(new Error("docker command failed: " + Buffer.concat(stderr).toString("utf8"))));
    if (input !== undefined) child.stdin.end(input);
  });
}

function waitForProxyReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("egress relay startup timed out")), 10_000);
    child.stdout.on("data", (chunk) => {
      output = (output + chunk.toString("utf8")).slice(-512);
      if (output.includes("EGRESS_PROXY_READY\n")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      if (!output.includes("EGRESS_PROXY_READY\n")) {
        clearTimeout(timer);
        reject(new Error("egress relay exited before ready: " + code));
      }
    });
  });
}

test("Docker egress relay blocks direct and arbitrary egress while preserving host OpenCode auth", {
  skip: process.env.OGS_TEAM_IR_V2_DOCKER_EGRESS_PROBE !== "1"
}, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const networkName = "team-ir-egress-probe-" + suffix;
  const outboundNetworkName = "team-ir-egress-probe-outbound-" + suffix;
  const proxyName = "team-ir-egress-probe-relay-" + suffix;
  let proxy;
  try {
    await command(["network", "create", "--internal", "--driver=bridge", networkName]);
    await command(["network", "create", "--driver=bridge", outboundNetworkName]);
    await command([
      "create", "--name", proxyName, "--network=" + outboundNetworkName, "--add-host=host.docker.internal:host-gateway",
      "--init", "--interactive", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--user=65532:65532", "--memory=128m", "--memory-swap=128m", "--cpus=0.25", "--pids-limit=32",
      "--ulimit=nofile=64:64", "--entrypoint=node", image, "-e", getDockerEgressProxySourceForTest()
    ]);
    await command(["network", "connect", "--alias=team-ir-egress", networkName, proxyName]);
    proxy = spawn(docker, ["start", "--attach", "--interactive", proxyName], { shell: false, stdio: ["pipe", "pipe", "pipe"] });
    proxy.stdin.write(JSON.stringify({ password: "probe-password-not-used-for-health" }) + "\n");
    await waitForProxyReady(proxy);

    const client = String.raw`
      const net = require("node:net");
      const base = "http://team-ir-egress:4318";
      async function status(path, options) { return (await fetch(base + path, options)).status; }
      async function directTcp() {
        return await new Promise((resolve) => {
          const socket = net.createConnection({ host: "1.1.1.1", port: 443, timeout: 2500 });
          socket.once("connect", () => { socket.destroy(); resolve("connected"); });
          socket.once("timeout", () => { socket.destroy(); resolve("timeout"); });
          socket.once("error", (error) => resolve(error.code));
        });
      }
      async function connectStatus() {
        return await new Promise((resolve) => {
          const request = require("node:http").request({ host: "team-ir-egress", port: 4318, method: "CONNECT", path: "host.docker.internal:4096" });
          request.once("connect", (response, socket) => { socket.destroy(); resolve(response.statusCode); });
          request.once("response", (response) => { response.resume(); resolve(response.statusCode); });
          request.once("error", () => resolve(0));
          request.end();
        });
      }
      (async () => {
        const health = await status("/global/health");
        const arbitraryPath = await status("/v1/models");
        const arbitraryTarget = await status("/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Team IR model invocation", target: "http://1.1.1.1" }) });
        const connect = await connectStatus();
        const direct = await directTcp();
        process.stdout.write(JSON.stringify({ health, arbitraryPath, arbitraryTarget, connect, direct }));
      })().catch(() => process.exitCode = 2);
    `;
    const output = await command([
      "run", "--rm", "--network=" + networkName, "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges",
      "--user=65532:65532", "--memory=128m", "--memory-swap=128m", "--cpus=0.25", "--pids-limit=32",
      "--entrypoint=node", image, "-e", client
    ]);
    const result = JSON.parse(output);
    assert.equal(result.health, 401, "unauthenticated OpenCode health request must reach the host service and remain unauthorized");
    assert.equal(result.arbitraryPath, 403);
    assert.equal(result.arbitraryTarget, 403);
    assert.equal(result.connect, 403);
    assert.equal(result.direct, "ENETUNREACH");
  } finally {
    if (proxy) {
      await command(["stop", "--time=2", proxyName]).catch(() => {});
      await new Promise((resolve) => {
        if (proxy.exitCode !== null) return resolve();
        proxy.once("close", resolve);
        setTimeout(() => { proxy.kill("SIGTERM"); resolve(); }, 3_000).unref();
      });
    }
    await command(["rm", "--force", proxyName]).catch(() => {});
    await command(["network", "rm", networkName]).catch(() => {});
    await command(["network", "rm", outboundNetworkName]).catch(() => {});
  }
});
