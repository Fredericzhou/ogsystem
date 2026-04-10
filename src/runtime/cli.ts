import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { runSystemWithAdapter } from "./adapter.js";

function usage(): string {
  return [
    "Usage:",
    "  npm run run:adapter -- --system <file.mmd> --prompt <text>",
    "",
    "Options:",
    "  --runtime <file>        Runtime config JSON (optional, defaults to .ogsystem/runtime.json)",
    "  --user-profile <file>   User profile JSON (optional, defaults to .ogsystem/user-profile.json)",
    "  --laws <file>           Law catalog JSON (optional, defaults to .ogsystem/laws.json)",
    "  --resume-run <dir>      Reuse an existing ogsystem-history/<run-id> directory",
    "  --profiles <file>       Legacy execution profiles JSON (optional)",
    "  --tools <file>          Legacy CLI tools JSON (optional)",
    "  --workdir <path>        Working directory and shared workspace (default: cwd)",
    "  --trace-out <file>       Write final runtime result JSON",
    "  --dry-run                Do not execute external commands"
  ].join("\n");
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      system: { type: "string" },
      runtime: { type: "string" },
      "user-profile": { type: "string" },
      "resume-run": { type: "string" },
      profiles: { type: "string" },
      tools: { type: "string" },
      laws: { type: "string" },
      prompt: { type: "string" },
      workdir: { type: "string" },
      "trace-out": { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  if (!values.system || !values.prompt) {
    throw new Error(`Missing required args.\n\n${usage()}`);
  }

  const result = await runSystemWithAdapter({
    systemPath: values.system,
    runtimeConfigPath: values.runtime,
    userProfilePath: values["user-profile"],
    resumeRunDir: values["resume-run"],
    profilesPath: values.profiles,
    toolsPath: values.tools,
    lawsPath: values.laws,
    prompt: values.prompt,
    workdir: values.workdir ?? process.cwd(),
    dryRun: values["dry-run"] ?? false
  });

  const output = JSON.stringify(result, null, 2);
  console.log(output);
  if (values["trace-out"]) {
    await writeFile(values["trace-out"], output, "utf8");
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
