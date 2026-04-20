#!/usr/bin/env node

const { existsSync } = require("node:fs");

const userAgent = process.env.npm_config_user_agent || "";
const isRepositoryDevelopmentInstall = existsSync("pnpm-lock.yaml");
const isPnpmUserAgent = /pnpm\//.test(userAgent);
const isGlobalInstall = process.env.npm_config_global === "true";

if (isRepositoryDevelopmentInstall && !isPnpmUserAgent && !isGlobalInstall) {
  console.error("Use pnpm only for repository development.");
  process.exit(1);
}
