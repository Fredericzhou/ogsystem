import test from "node:test";
import assert from "node:assert/strict";

import {
  getCommandGraphNodes,
  getCommandRegistryHelp,
  getNl2MmdCliUsage,
  getRuntimeCliSubcommandOptions,
  getRuntimeCliUsage,
  getVisualizerCliUsage
} from "../dist/runtime/command-registry.js";
import {
  buildCommandGraphLiveUrl,
  buildCommandGraphMermaid,
  buildCommandGraphText
} from "../dist/runtime/command-graph.js";

test("shared command registry keeps help text and parse specs aligned", () => {
  const help = getCommandRegistryHelp();
  assert.equal(getRuntimeCliUsage(), help.runtimeRoot.lines.join("\n"));
  assert.match(getRuntimeCliUsage("run"), /ogs run start --system <file\.mmd> --prompt <text> \[options\]/);
  assert.match(getRuntimeCliUsage("visualizer"), /ogs visualizer \[--workdir <path>\] \[--host <host>\] \[--port <n>\]/);
  assert.match(getNl2MmdCliUsage(), /pnpm run run:nl2mmd -- \[--message <text>\] \[--model <modelId>\]/);
  assert.match(getVisualizerCliUsage(), /pnpm run run:visualizer -- \[--workdir <path>\] \[--host <host>\] \[--port <n>\]/);

  const runLogsOptions = getRuntimeCliSubcommandOptions("run logs");
  assert.equal(runLogsOptions.json.type, "boolean");
  assert.equal(runLogsOptions.role.type, "string");
  assert.equal(runLogsOptions.help.short, "h");
});

test("shared command graph renders the supported command surface", () => {
  const nodes = getCommandGraphNodes();
  const mermaid = buildCommandGraphMermaid();
  const text = buildCommandGraphText();

  assert.ok(nodes.length > 0);
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /project init/);
  assert.match(mermaid, /run:nl2mmd/);
  assert.match(mermaid, /run:visualizer/);
  assert.match(mermaid, /run:visualizer/);
  assert.match(text, /ogs run reindex/);
  assert.match(buildCommandGraphLiveUrl(mermaid), /mermaid\.live\/edit#base64:/);
});
