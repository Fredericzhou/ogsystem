import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export type OpenCodeProviderConfig = Record<string, unknown> & {
  npm?: string;
  options?: Record<string, unknown>;
  models?: Record<string, Record<string, unknown>>;
};

export function loadUserProvider(providerId: string, env: NodeJS.ProcessEnv = process.env): OpenCodeProviderConfig | undefined {
  const candidates = [
    env.OGS_OPENCODE_CONFIG,
    resolve(homedir(), ".config", "opencode", "gpt6-luna-serve.json"),
    resolve(homedir(), ".config", "opencode", "opencode.json")
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { provider?: Record<string, OpenCodeProviderConfig> };
      const provider = parsed.provider?.[providerId];
      if (provider && typeof provider === "object") return provider;
    } catch {
      // A missing or malformed user config is handled by the conservative fallback below.
    }
  }
  return undefined;
}

export function resolveChatCompatibleProviders(env: NodeJS.ProcessEnv = process.env): Record<string, OpenCodeProviderConfig> {
  const configured = env.OGS_OPENCODE_COMPATIBLE_PROVIDERS ?? "codex-gateway";
  const providerIds = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Object.fromEntries(providerIds.map((providerId) => {
    const configuredProvider = loadUserProvider(providerId, env);
    if (configuredProvider) return [providerId, configuredProvider];
    return [providerId, { npm: "@ai-sdk/openai-compatible" }];
  }));
}
