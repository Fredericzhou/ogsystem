#!/usr/bin/env node

const { existsSync } = require("node:fs");

const userAgent = process.env.npm_config_user_agent || "";
const isRepositoryDevelopmentInstall = existsSync("pnpm-lock.yaml");
const isPnpmUserAgent = /pnpm\//.test(userAgent);

if (isRepositoryDevelopmentInstall && !isPnpmUserAgent) {
  console.error("Use pnpm only for repository development.");
  process.exit(1);
}
