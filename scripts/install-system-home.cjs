#!/usr/bin/env node

const { cp, mkdir, readFile, writeFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { homedir } = require("node:os");
const { resolve } = require("node:path");

const packageRoot = resolve(__dirname, "..");
const systemHome = resolve(homedir(), ".ogsystem");

async function installSystemHome(options = {}) {
  const updateMetadata = options.updateMetadata === true;
  const isRepositoryInstall = existsSync(resolve(packageRoot, "pnpm-lock.yaml"));
  const isGlobalInstall = process.env.npm_config_global === "true";
  if (isRepositoryInstall && !isGlobalInstall) {
    return false;
  }

  await mkdir(systemHome, { recursive: true });
  await cp(resolve(packageRoot, "og-roles", "roles"), resolve(systemHome, "roles"), {
    recursive: true,
    force: false,
    errorOnExist: false
  });
  await cp(resolve(packageRoot, "og-roles", "README.md"), resolve(systemHome, "README.md"), {
    force: false,
    errorOnExist: false
  });

  const envExamplePath = resolve(systemHome, ".env.example");
  const envExampleLines = [
    "# Copy to .env and fill only the providers you use.",
    "OPENAI_GATEWAY_BASE_URL=",
    "OPENAI_GATEWAY_API_KEY=",
    "GOOGLE_GATEWAY_BASE_URL=",
    "GOOGLE_GATEWAY_API_KEY=",
    "GROK_GATEWAY_BASE_URL=",
    "GROK_GATEWAY_API_KEY=",
    "SILICONFLOW_BASE_URL=",
    "SILICONFLOW_API_KEY=",
    "OLLAMA_BASE_URL=",
    "OLLAMA_API_KEY=",
    ""
  ];
  if (!existsSync(envExamplePath)) {
    await writeFile(envExamplePath, envExampleLines.join("\n"), {
      encoding: "utf8",
      mode: 0o600
    });
  } else {
    const existing = await readFile(envExamplePath, "utf8");
    const existingNames = new Set(
      existing
        .split(/\r?\n/)
        .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
        .filter(Boolean)
    );
    const missingLines = envExampleLines.filter(
      (line) => line && !line.startsWith("#") && !existingNames.has(line.split("=", 1)[0])
    );
    if (missingLines.length > 0) {
      await writeFile(
        envExamplePath,
        `${existing.replace(/\s*$/, "\n")}${missingLines.join("\n")}\n`,
        "utf8"
      );
    }
  }

  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const installMetadataPath = resolve(systemHome, "install.json");
  if (updateMetadata || !existsSync(installMetadataPath)) {
    await writeFile(
      installMetadataPath,
      `${JSON.stringify({
        package: packageJson.name,
        version: packageJson.version,
        installedAt: new Date().toISOString(),
        rolesDir: "roles",
        envFile: ".env"
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
  }
  return true;
}

if (require.main === module) {
  installSystemHome({ updateMetadata: true }).catch((error) => {
    console.error(`ogsystem user installation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

module.exports = { installSystemHome };
