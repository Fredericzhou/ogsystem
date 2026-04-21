/**
 * @fileoverview Interactive and one-shot CLI for NL2MMD drafting workflow.
 * File Set: nl2mmd-entry
 * Responsibilities:
 * - Manage REPL/session lifecycle and user commands.
 * - Run NL2MMD turns, show suggestions, and print validation feedback.
 * Boundaries:
 * - Delegates generation/validation details to NL2MMD service modules.
 */
import { stdin as input, stdout as output } from "node:process";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";

import { isDirectModelRef } from "../runtime/model-selection.js";
import {
  createNl2MmdConversation,
  detectSemanticHints,
  loadNl2MmdContext,
  runNl2MmdPreflight,
  runNl2MmdTurn,
  searchModels,
  searchRoles,
  validateNl2MmdCandidate
} from "./index.js";
import { syncProjectDependencies } from "../runtime/project-lifecycle.js";
import type { Nl2MmdConversation, Nl2MmdContext, Nl2MmdTurnResult } from "./types.js";

function usage(): string {
  return [
    "Usage:",
    "  ogs-nl2mmd [--message <text>] [--model <provider/model>]",
    "",
    "Base command:",
    "  direct entrypoint for prompt generation and validation against local roles plus .ogs model-selection/model-catalog",
    "",
    "Source repository equivalent:",
    "  pnpm run run:nl2mmd -- [--message <text>] [--model <provider/model>]",
    "",
    "Options:",
    "  --message <text>       One-shot NL2MMD request; omit for interactive mode",
    "  --model <provider/model>  Direct default model ref (overrides .ogs/model-selection.json defaults)",
    "  --runtime <file>       Runtime config JSON (optional)",
    "  --laws <file>          Laws JSON (optional)",
    "  --profiles <file>      Legacy profiles JSON for exec.bind validation (optional)",
    "  --user-profile <file>  User profile JSON for validation (optional)",
    "  --no-preflight         Skip startup preflight (default is preflight enabled)",
    "  --workdir <path>       Working directory (default: cwd)",
    "  --help                 Show help",
    "",
    "Defaults:",
    "  workdir defaults to the current directory",
    "  model defaults to .ogs/model-selection.json, then .ogs/model-catalog.json",
    "  preflight runs before the first turn unless disabled",
    "",
    "Interactive commands:",
    "  /help                  Show commands",
    "  /roles <query>         Search role repo",
    "  /models <query>        Search local model catalog",
    "  /laws                  List discovered law ids",
    "  /use-model <provider/model>   Switch the conversation model",
    "  /status                Show current draft/model/session status",
    "  /validate              Re-run local validation for the current Mermaid draft",
    "  /clear                 Clear current draft/validation state",
    "  /quit                  Exit"
  ].join("\n");
}

function printSection(title: string, body?: string): void {
  console.log(`\n${title}`);
  if (body) {
    console.log(body);
  }
}

function formatRoleSearch(context: Nl2MmdContext, query: string): string {
  const matches = searchRoles(context, query, 8);
  if (matches.length === 0) {
    return "(no role matches)";
  }
  return matches
    .map(
      (item) =>
        `${item.item.roleId} | ${item.item.name} | events=${item.item.outputEvents.join(",") || "-"} | ${item.reason}`
    )
    .join("\n");
}

function formatModelSearch(context: Nl2MmdContext, query: string): string {
  const matches = searchModels(context, query, 8);
  if (matches.length === 0) {
    return "(no model matches)";
  }
  return matches
    .map(
      (item) =>
        `${item.item.modelRef} | ${item.item.model} | variants=${item.item.variants.join(",") || "-"} | ${item.reason}`
    )
    .join("\n");
}

function formatSemanticHints(message: string): string {
  const hints = detectSemanticHints(message);
  if (hints.length === 0) {
    return "(no fixed semantic hints detected)";
  }
  return hints.map((item) => `${item.label} | ${item.detail}`).join("\n");
}

function printSuggestions(context: Nl2MmdContext, message: string): void {
  printSection("Detected Semantic Hints", formatSemanticHints(message));
  printSection("Role Suggestions", formatRoleSearch(context, message));
  printSection("Model Suggestions", formatModelSearch(context, message));
}

function printValidation(turn: Nl2MmdTurnResult): void {
  if (!turn.validation) {
    return;
  }
  const lines = [
    `status=${turn.validation.status}`,
    `errors=${turn.validation.errors.length}`,
    `warnings=${turn.validation.warnings.length}`
  ];
  printSection("Validation", lines.join("\n"));
  if (turn.validation.errors.length > 0) {
    printSection("Validation Errors", turn.validation.errors.join("\n"));
  }
  if (turn.validation.warnings.length > 0) {
    printSection("Validation Warnings", turn.validation.warnings.join("\n"));
  }
}

function printTurn(turn: Nl2MmdTurnResult): void {
  printSection("Mode", turn.mode);
  printSection("Summary", turn.summary);

  if (turn.questions.length > 0) {
    printSection("Questions", turn.questions.map((item, index) => `${index + 1}. ${item}`).join("\n"));
  }
  if (turn.assumptions.length > 0) {
    printSection("Assumptions", turn.assumptions.join("\n"));
  }
  if (turn.unresolvedItems.length > 0) {
    printSection("Unresolved", turn.unresolvedItems.join("\n"));
  }
  if (turn.txtGraph) {
    printSection("Txt Graph", turn.txtGraph);
  }
  if (turn.mermaid.trim()) {
    printSection("Mermaid", turn.mermaid);
  }
  printValidation(turn);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      message: { type: "string" },
      model: { type: "string" },
      runtime: { type: "string" },
      laws: { type: "string" },
      profiles: { type: "string" },
      "user-profile": { type: "string" },
      "no-preflight": { type: "boolean" },
      workdir: { type: "string" },
      help: { type: "boolean", short: "h" }
    },
    allowPositionals: false
  });

  if (values.help) {
    console.log(usage());
    return;
  }

  const workdir = values.workdir ?? process.cwd();
  const context = await loadNl2MmdContext({
    workdir,
    runtimeConfigPath: values.runtime,
    lawsPath: values.laws
  });

  const initialModelRef = values.model ?? context.defaultModelRef ?? context.modelCatalog[0]?.modelRef;
  if (!initialModelRef || !isDirectModelRef(initialModelRef)) {
    throw new Error(
      "No usable NL2MMD model ref found. Set --model <provider/model> or configure .ogs/model-selection.json."
    );
  }
  let modelRef = initialModelRef;
  let draftMermaid = "";
  let lastTurn: Nl2MmdTurnResult | undefined;
  let conversation: Nl2MmdConversation | undefined;

  async function ensureConversation(): Promise<Nl2MmdConversation> {
    if (conversation) {
      return conversation;
    }
    conversation = await createNl2MmdConversation({
      workdir,
      modelRef,
      runtimeConfigPath: values.runtime,
      lawsPath: values.laws,
      context
    });
    return conversation;
  }

  async function switchModel(nextModelRef: string): Promise<void> {
    if (!isDirectModelRef(nextModelRef)) {
      throw new Error(`Invalid model ref "${nextModelRef}". Expected provider/model.`);
    }
    conversation?.close();
    conversation = undefined;
    modelRef = nextModelRef;
  }

  async function submit(message: string): Promise<Nl2MmdTurnResult> {
    printSuggestions(context, message);
    const activeConversation = await ensureConversation();
    let turn = await runNl2MmdTurn({
      conversation: activeConversation,
      input: {
        message,
        draftMermaid,
        validationErrors: lastTurn?.validation?.errors,
        validationWarnings: lastTurn?.validation?.warnings
      },
      lawsPath: values.laws,
      profilesPath: values.profiles,
      userProfilePath: values["user-profile"]
    });
    if (turn.mermaid.trim()) {
      const syncResult = await syncProjectDependencies({
        workdir,
        systemSource: turn.mermaid
      });
      if (syncResult.importedRoleIds.length > 0 || syncResult.importedModelIds.length > 0) {
        printSection(
          "Imported Project Dependencies",
          [
            `roles=${syncResult.importedRoleIds.join(", ") || "-"}`,
            `models=${syncResult.importedModelIds.join(", ") || "-"}`
          ].join("\n")
        );
      }
      const validation = await validateNl2MmdCandidate({
        mermaid: turn.mermaid,
        context,
        lawsPath: values.laws,
        profilesPath: values.profiles,
        userProfilePath: values["user-profile"]
      });
      turn = {
        ...turn,
        validation,
        txtGraph: validation.txtGraph
      };
      draftMermaid = turn.mermaid;
    }
    lastTurn = turn;
    printTurn(turn);
    return turn;
  }

  async function runPreflightIfNeeded(): Promise<void> {
    if (values["no-preflight"]) {
      return;
    }
    printSection("Preflight", "checking opencode lifecycle and model subscription...");
    const activeConversation = await ensureConversation();
    try {
      await runNl2MmdPreflight({
        conversation: activeConversation
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `NL2MMD preflight failed: ${detail}\nHint: verify Opencode account/group subscription and model access permissions.`
      );
    }
    printSection("Preflight", "ok");
  }

  try {
    await runPreflightIfNeeded();

    if (values.message) {
      await submit(values.message);
      return;
    }

    console.log("OGSystem NL2MMD interactive CLI");
    console.log(`workdir=${workdir}`);
    console.log(`model=${modelRef}`);
    console.log('Type natural language requirements, or "/help" for commands.');

    const rl = createInterface({ input, output });
    try {
      while (true) {
        const line = (await rl.question("\nnl2mmd> ")).trim();
        if (!line) {
          continue;
        }

        if (line === "/quit" || line === "/exit") {
          break;
        }
        if (line === "/help") {
          console.log(usage());
          continue;
        }
        if (line === "/laws") {
          printSection("Laws", context.lawIds.length > 0 ? context.lawIds.join("\n") : "(none)");
          continue;
        }
        if (line === "/status") {
          printSection(
            "Status",
            [
              `model=${modelRef}`,
              `session=${conversation?.sessionId ?? "(none)"}`,
              `hasDraft=${draftMermaid ? "yes" : "no"}`,
              `lastMode=${lastTurn?.mode ?? "(none)"}`
            ].join("\n")
          );
          continue;
        }
        if (line === "/clear") {
          draftMermaid = "";
          lastTurn = undefined;
          printSection("State", "draft cleared");
          continue;
        }
        if (line.startsWith("/roles ")) {
          printSection("Role Search", formatRoleSearch(context, line.slice("/roles ".length).trim()));
          continue;
        }
        if (line.startsWith("/models ")) {
          printSection("Model Search", formatModelSearch(context, line.slice("/models ".length).trim()));
          continue;
        }
        if (line.startsWith("/use-model ")) {
          await switchModel(line.slice("/use-model ".length).trim());
          printSection("Model", `switched to ${modelRef}`);
          continue;
        }
        if (line === "/validate") {
          if (!draftMermaid.trim()) {
            printSection("Validation", "no draft Mermaid available");
            continue;
          }
          const validation = await validateNl2MmdCandidate({
            mermaid: draftMermaid,
            context,
            lawsPath: values.laws,
            profilesPath: values.profiles,
            userProfilePath: values["user-profile"]
          });
          printSection("Txt Graph", validation.txtGraph);
          printSection(
            "Validation",
            [
              `status=${validation.status}`,
              `errors=${validation.errors.length}`,
              `warnings=${validation.warnings.length}`
            ].join("\n")
          );
          if (validation.errors.length > 0) {
            printSection("Validation Errors", validation.errors.join("\n"));
          }
          if (validation.warnings.length > 0) {
            printSection("Validation Warnings", validation.warnings.join("\n"));
          }
          continue;
        }

        await submit(line);
      }
    } finally {
      rl.close();
    }
  } finally {
    conversation?.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
