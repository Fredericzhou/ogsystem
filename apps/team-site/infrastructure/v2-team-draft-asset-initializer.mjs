import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function initializeV2TeamDraftAssets(project, locale = "zh-CN") {
  const workdir = project.workdir;
  const roleId = "owner";
  const roleTitle = locale === "en" ? "Workflow owner" : "流程负责人";
  const systemSource = [
    "flowchart TD",
    "%% system.id=team.factory",
    "%% system.version=2.0.0",
    "%% law.global=law.team.factory",
    `start[${locale === "en" ? "Start" : "开始"}] -->|START| owner[Role:${roleId}]`,
    `owner[Role:${roleId}] -->|READY| end[${locale === "en" ? "End" : "结束"}]`,
    ""
  ].join("\n");
  const templateId = "harness.team.factory.default";
  const bindings = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    defaults: { harnessTemplate: templateId },
    harnessTemplates: {
      [templateId]: {
        ogsContractVersion: 2,
        schemaVersion: 1,
        kind: "harness",
        templateId,
        backend: "codex",
        model: "gpt-6-luna",
        allowedTools: [],
        environment: {
          filesystem: "none",
          process: "deny",
          network: "deny",
          limits: { timeoutMs: 120000, maxOutputBytes: 65536 }
        },
        preset: "team-factory"
      }
    },
    roles: { [roleId]: { kind: "harness", harnessTemplate: templateId } }
  };
  const roleRoot = join(workdir, "team-roles", "roles", roleId);
  await mkdir(join(workdir, ".ogs", "studio"), { recursive: true });
  await mkdir(roleRoot, { recursive: true });
  await writeFile(join(workdir, "system.mmd"), systemSource, "utf8");
  await writeFile(join(workdir, ".ogs", "execution-bindings.json"), `${JSON.stringify(bindings, null, 2)}\n`, "utf8");
  await writeFile(join(workdir, ".ogs", "runtime.json"), `${JSON.stringify({
    configVersion: "2",
    roleRepo: "team-roles",
    runsDir: ".ogs/runs",
    redaction: { enabled: true },
    tools: { environmentPolicy: "minimal", envAllowlist: [] },
    runtime: { error_flows: { v1: false } }
  }, null, 2)}\n`, "utf8");
  await writeFile(join(workdir, ".ogs", "laws.json"), `${JSON.stringify({ laws: [{ lawId: "law.team.factory", constraints: { forbiddenToolRefs: [], maxTransitions: 8 } }] }, null, 2)}\n`, "utf8");
  await writeFile(join(roleRoot, "role.json"), `${JSON.stringify({
    roleId,
    roleVersion: "1.0.0",
    name: roleId,
    description: "Owns the business workflow and confirms the requested outcome.",
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    tags: ["team-factory"],
    ogsContractVersion: 2,
    schemaVersion: 2,
    purpose: "Own the business workflow and confirm the requested outcome",
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { postconditions: [], decisionCriteria: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [] },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] }
  }, null, 2)}\n`, "utf8");
  await writeFile(join(roleRoot, "agent.md"), `${roleTitle}: keep the business objective explicit and return a concise decision.\n`, "utf8");
  await writeFile(join(roleRoot, "prompt.md"), "{{agent}}\n\nAllowed events:\n{{allowed_events}}\n\nTask:\n{{task}}\n\nInput:\n{{input}}\n", "utf8");
  await writeFile(join(roleRoot, "output.schema.json"), `${JSON.stringify({ type: "object", required: ["event", "content"], properties: { event: { type: "string", enum: ["READY"] }, content: { type: "string", minLength: 1 } }, additionalProperties: false }, null, 2)}\n`, "utf8");
  await writeFile(join(workdir, "system.design.json"), `${JSON.stringify({ schemaVersion: 2, seats: { [roleId]: { roleId, title: roleTitle } } }, null, 2)}\n`, "utf8");
}
