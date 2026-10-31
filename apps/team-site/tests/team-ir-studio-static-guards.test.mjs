import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { applyTeamIrPatch, teamIrToGraphAuthoring } from "../public/app/team-ir-graph-adapter.js";

const siteRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repoRoot = resolve(siteRoot, "../..");
const activeRoots = [
  join(siteRoot, "public", "app"),
  join(siteRoot, "server.mjs"),
  join(siteRoot, "application"),
  join(siteRoot, "infrastructure")
];
const forbiddenTeamPaths = [
  "/api/v1/team-factory",
  "/design",
  "/graph",
  "/chat",
  "/release-baselines"
];
const writeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

async function sourceFiles(path) {
  if ((await stat(path)).isFile()) return [/\.(?:js|mjs|ts)$/.test(path) && !/\.test\.(?:js|mjs|ts)$/.test(path) ? path : []].flat();
  const info = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const entry of info) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file));
    else if (/\.(?:js|mjs|ts)$/.test(entry.name) && !/\.test\.(?:js|mjs|ts)$/.test(entry.name)) files.push(file);
  }
  return files;
}

async function activeSources() {
  const files = [];
  for (const root of activeRoots) files.push(...await sourceFiles(root));
  return Promise.all(files.map(async (file) => ({ file, source: await readFile(file, "utf8") })));
}

function isStringNode(node) {
  return node?.type === "Literal" && typeof node.value === "string";
}

function stringValue(node) {
  if (isStringNode(node)) return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0]?.value?.cooked ?? "";
  return null;
}

function propertyName(node) {
  return node?.type === "Identifier" ? node.name : stringValue(node);
}

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  if (typeof node.type === "string") visit(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    if (Array.isArray(value)) value.forEach((child) => walkAst(child, visit));
    else if (value && typeof value === "object") walkAst(value, visit);
  }
}

function callCalleeName(node) {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "MemberExpression" && !node.computed && node.object?.type === "Identifier") return `${node.object.name}.${propertyName(node.property)}`;
  if (node?.type === "MemberExpression" && node.computed && node.object?.type === "Identifier") return `${node.object.name}.${stringValue(node.property) || ""}`;
  return "";
}

function parseAst(file, source) {
  return parse(source, { ecmaVersion: "latest", sourceType: "module", allowHashBang: true, locations: true, sourceFile: file });
}

function findStringConstants(ast) {
  const constants = new Map();
  walkAst(ast, (node) => {
    if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
      const value = stringValue(node.init);
      if (value !== null) constants.set(node.id.name, value);
    }
  });
  return constants;
}

function collectAstStrings(node, values, constants = new Map()) {
  walkAst(node, (child) => {
    const value = stringValue(child);
    if (value !== null) values.push(value);
    else if (child.type === "Identifier" && constants.has(child.name)) values.push(constants.get(child.name));
  });
}

function collectMethodValues(call, constants) {
  const methods = [];
  for (const argument of call.arguments || []) walkAst(argument, (node) => {
    if (node.type !== "Property" || propertyName(node.key) !== "method") return;
    const literal = stringValue(node.value);
    if (literal !== null) methods.push(literal.toUpperCase());
    else if (node.value?.type === "Identifier" && constants.has(node.value.name)) methods.push(constants.get(node.value.name).toUpperCase());
  });
  const second = stringValue(call.arguments?.[1]);
  if (second !== null) methods.push(second.toUpperCase());
  return methods;
}

function resolveModuleEntry(file, specifier, entriesByFile) {
  if (!specifier?.startsWith(".")) return null;
  const base = resolve(dirname(file), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, `${base}.ts`, join(base, "index.js"), join(base, "index.mjs")]) {
    const entry = entriesByFile.get(resolve(candidate));
    if (entry) return entry;
  }
  return null;
}

function buildDangerousModuleBindings(astEntries, dangerousExports) {
  const entriesByFile = new Map(astEntries.map((entry) => [resolve(entry.file), entry]));
  const info = new Map(astEntries.map((entry) => [entry, { dangerous: new Set(), namespaces: new Set(), exports: new Set() }]));
  const markChanged = (set, value) => {
    const before = set.size;
    set.add(value);
    return set.size !== before;
  };
  for (const entry of astEntries) {
    const state = info.get(entry);
    walkAst(entry.ast, (node) => {
      if (node.type === "FunctionDeclaration" && node.id?.name && dangerousExports.has(node.id.name)) {
        state.dangerous.add(node.id.name);
        state.exports.add(node.id.name);
      }
    });
  }
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const entry of astEntries) {
      const state = info.get(entry);
      walkAst(entry.ast, (node) => {
        if (node.type === "ImportDeclaration") {
          const source = String(node.source?.value || "");
          const target = resolveModuleEntry(entry.file, source, entriesByFile);
          const targetState = target ? info.get(target) : null;
          const directAdapter = source.includes("team-ir-graph-adapter");
          for (const specifier of node.specifiers || []) {
            if (specifier.type === "ImportNamespaceSpecifier" && (directAdapter || targetState?.exports.size)) changed = markChanged(state.namespaces, specifier.local.name) || changed;
            if (specifier.type === "ImportSpecifier") {
              const imported = specifier.imported?.name || specifier.imported?.value;
              if ((dangerousExports.has(imported) || targetState?.exports.has(imported)) && (directAdapter || targetState?.exports.has(imported))) changed = markChanged(state.dangerous, specifier.local.name) || changed;
            }
          }
        }
        if (node.type === "VariableDeclarator" && node.id?.type === "Identifier") {
          if (node.init?.type === "Identifier" && state.dangerous.has(node.init.name)) changed = markChanged(state.dangerous, node.id.name) || changed;
          if (node.init?.type === "MemberExpression" && node.init.object?.type === "Identifier" && state.namespaces.has(node.init.object.name) && dangerousExports.has(propertyName(node.init.property))) changed = markChanged(state.dangerous, node.id.name) || changed;
        }
        if (node.type === "ExportNamedDeclaration") {
          for (const specifier of node.specifiers || []) {
            if (state.dangerous.has(specifier.local?.name)) changed = markChanged(state.exports, specifier.exported?.name || specifier.exported?.value) || changed;
          }
          if (node.declaration?.type === "VariableDeclaration") {
            for (const declaration of node.declaration.declarations || []) if (declaration.id?.type === "Identifier" && state.dangerous.has(declaration.id.name)) changed = markChanged(state.exports, declaration.id.name) || changed;
          }
          const target = resolveModuleEntry(entry.file, node.source?.value, entriesByFile);
          const targetState = target ? info.get(target) : null;
          if (targetState) for (const exported of targetState.exports) changed = markChanged(state.exports, exported) || changed;
        }
        if (node.type === "ExportAllDeclaration") {
          const target = resolveModuleEntry(entry.file, node.source?.value, entriesByFile);
          const targetState = target ? info.get(target) : null;
          if (targetState) for (const exported of targetState.exports) changed = markChanged(state.exports, exported) || changed;
        }
      });
    }
    if (!changed) break;
  }
  return info;
}

function findStaticGuardViolations(entries) {
  const astEntries = entries.map(({ file, source }) => ({ file, source, ast: parseAst(file, source) }));
  const dangerousExports = new Set(["graphAuthoringToTeamIr"]);
  const moduleBindings = buildDangerousModuleBindings(astEntries, dangerousExports);
  const violations = [];

  for (const { file, ast } of astEntries) {
    const constants = findStringConstants(ast);
    const bindingEntry = astEntries.find((entry) => entry.file === file);
    const moduleState = moduleBindings.get(bindingEntry);
    const dangerous = new Set(moduleState?.dangerous || []);
    const dangerousNamespaces = new Set(moduleState?.namespaces || []);
    const dangerousProperties = new Set();

    const collectAliases = () => walkAst(ast, (node) => {
      if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
      if (node.init?.type === "Identifier" && dangerous.has(node.init.name)) dangerous.add(node.id.name);
      if (node.init?.type === "MemberExpression" && node.init.object?.type === "Identifier" && dangerousNamespaces.has(node.init.object.name) && dangerousExports.has(propertyName(node.init.property))) dangerous.add(node.id.name);
      if (node.init?.type !== "ObjectExpression") return;
      for (const property of node.init.properties || []) {
        if (property.type !== "Property") continue;
        const value = property.value;
        if (value?.type === "Identifier" && dangerous.has(value.name)) dangerousProperties.add(`${node.id.name}.${propertyName(property.key)}`);
        if (value?.type === "MemberExpression" && value.object?.type === "Identifier" && dangerousNamespaces.has(value.object.name) && dangerousExports.has(propertyName(value.property))) dangerousProperties.add(`${node.id.name}.${propertyName(property.key)}`);
      }
    });
    for (let pass = 0; pass < 4; pass++) collectAliases();

    walkAst(ast, (node) => {
      if (node.type === "CallExpression") {
        const callee = callCalleeName(node.callee);
        const directDangerous = dangerous.has(callee) || dangerousProperties.has(callee)
          || (node.callee?.type === "MemberExpression" && node.callee.object?.type === "Identifier" && dangerousNamespaces.has(node.callee.object.name) && dangerousExports.has(propertyName(node.callee.property)));
        if (directDangerous) violations.push(`${relative(repoRoot, file)} invokes graphAuthoringToTeamIr through AST alias ${callee}()`);
        const callStrings = [];
        for (const argument of node.arguments || []) collectAstStrings(argument, callStrings, constants);
        const oldPath = forbiddenTeamPaths.find((path) => callStrings.some((value) => value.includes(path)));
        if (oldPath && collectMethodValues(node, constants).some((method) => writeMethods.has(method))) violations.push(`${relative(repoRoot, file)} writes ${oldPath} through ${callee}()`);
        for (const argument of node.arguments || []) if (argument?.type === "Identifier" && dangerous.has(argument.name)) violations.push(`${relative(repoRoot, file)} passes graphAuthoringToTeamIr alias ${argument.name} into ${callee}()`);
      }
      if (isStringNode(node) && /gpt-5\.6/i.test(node.value)) violations.push(`${relative(repoRoot, file)} contains retired gpt-5.6 model default`);
    });
  }
  return violations;
}

test("active Team Site code has no graph authoring write call or legacy Team write endpoint", async () => {
  const violations = findStaticGuardViolations(await activeSources());
  assert.deepEqual(violations, [], violations.join("\n"));
});

test("AST guard catches conversion aliases, indirect forwarding, legacy writes, and model literals", () => {
  const fixture = [
    { file: join(siteRoot, "public", "app", "adapter-fixture.js"), source: "import { graphAuthoringToTeamIr as convert } from './team-ir-graph-adapter.js'; const invoke = convert; invoke(value);" },
    { file: join(siteRoot, "public", "app", "wrapper-fixture.js"), source: "import { graphAuthoringToTeamIr as convert } from './team-ir-graph-adapter.js'; export { convert as transform };" },
    { file: join(siteRoot, "public", "app", "consumer-fixture.js"), source: "import { transform } from './wrapper-fixture.js'; transform(value);" },
    { file: join(siteRoot, "server.mjs"), source: "fetch('/api/v1/team-factory', { method: 'POST' });" },
    { file: join(siteRoot, "application", "model.mjs"), source: "const model = 'codex/gpt-5.6';" }
  ];
  const violations = findStaticGuardViolations(fixture);
  assert.equal(violations.length, 4);
  assert.match(violations[0], /AST alias/);
  assert.match(violations[1], /AST alias/);
  assert.match(violations[2], /writes \/api\/v1\/team-factory/);
  assert.match(violations[3], /gpt-5\.6/);
});

test("all current Team IR v2 fixtures project every agent, handoff, and real endpoint port", async () => {
  const fixtureRoot = join(repoRoot, "examples", "team-ir-v2");
  const fixtureNames = (await readdir(fixtureRoot)).filter((name) => name.endsWith(".json")).sort();
  assert.equal(fixtureNames.length, 8, "the current v2 fixture inventory must contain eight scenarios");
  for (const fixtureName of fixtureNames) {
    const teamIR = JSON.parse(await readFile(join(fixtureRoot, fixtureName), "utf8"));
    const view = teamIrToGraphAuthoring(teamIR);
    assert.equal(Object.keys(view.roles || {}).length, teamIR.agents.length, `${fixtureName}: agent count`);
    assert.equal(Object.keys(view.flows || {}).length, teamIR.handoffs.length, `${fixtureName}: handoff count`);
    for (const agent of teamIR.agents) {
      const role = view.roles[agent.id];
      assert.ok(role, `${fixtureName}: missing projected agent ${agent.id}`);
      assert.equal(role.packageRef, agent.packageRef, `${fixtureName}: packageRef ${agent.id}`);
      assert.equal(role.bindingRef, agent.bindingRef, `${fixtureName}: bindingRef ${agent.id}`);
      const expectedLabel = teamIR.presentation?.nodes?.[agent.id]?.label;
      if (expectedLabel !== undefined) assert.equal(role.label, expectedLabel, `${fixtureName}: presentation label ${agent.id}`);
    }
    for (const handoff of teamIR.handoffs) {
      const flow = view.flows[handoff.id];
      assert.ok(flow, `${fixtureName}: missing projected handoff ${handoff.id}`);
      if (handoff.from?.kind === "agent") {
        assert.equal(flow.eventType, handoff.from.outputPort, `${fixtureName}: source output port ${handoff.id}`);
        assert.ok(flow.outputPort ?? flow.sourceOutputPort ?? flow.eventType, `${fixtureName}: explicit source port ${handoff.id}`);
      }
      if (handoff.to?.kind === "agent") {
        const projectedInputPort = flow.inputPort ?? flow.targetInputPort ?? flow.toInputPort;
        assert.equal(projectedInputPort, handoff.to.inputPort, `${fixtureName}: target input port ${handoff.id}`);
      }
    }
  }
});

test("presentation-only graph patches do not change the Team IR semantic document", () => {
  const source = {
    schemaVersion: 2,
    team: { id: "team", version: "2.0.0" },
    agents: [{ id: "worker", packageRef: "role:worker@1", bindingRef: "binding:worker", inputPorts: {}, outputPorts: {} }],
    handoffs: [],
    bindings: [{ id: "binding:worker", kind: "model", modelRef: "codex-gateway/gpt-6-luna" }],
    presentation: { nodes: { worker: { x: 10, y: 20 } } }
  };
  const result = applyTeamIrPatch(source, { op: "presentation.nodeLabel", id: "worker", value: "中文工作者" });
  assert.equal(result.ok, true);
  assert.equal(result.teamIR.presentation.nodes.worker.label, "中文工作者");
  assert.equal(result.teamIR.agents[0].id, source.agents[0].id);
});
