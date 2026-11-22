import assert from "node:assert/strict";
import test from "node:test";
import { createRoleSourceCatalogUseCases } from "../application/role-source-catalog-use-cases.mjs";

test("role source conversion returns a v2 package ready for a Studio draft", async () => {
  const legacyRole = {
    roleId: "legacy-id",
    contractVersion: 1,
    name: "Anthropologist",
    outputs: { events: ["OLD_EVENT"], postconditions: [] },
    constraints: { writableStateFields: [], allowedTools: ["legacy_tool"] }
  };
  const useCases = createRoleSourceCatalogUseCases({
    store: {
      async readRole() {
        return {
          role: { status: "ready", path: "roles/anthropologist.md", language: "en", sourceDigest: "source-digest" },
          markdown: "Research user behavior.",
          commit: "a".repeat(40),
          source: { sourceId: "source-1", gitUrl: "https://example.test/roles", adapterId: "markdown-role", adapterVersion: "1.0.0" }
        };
      }
    },
    adapters: {
      "markdown-role": {
        convertMarkdownRole() {
          return {
            roleId: "anthropologist",
            role: legacyRole,
            files: {
              "role.json": JSON.stringify(legacyRole),
              "output.schema.json": JSON.stringify({ type: "object", properties: { event: { type: "string", enum: ["OLD_EVENT"] } } }),
              "agent.md": "Research user behavior."
            }
          };
        }
      }
    }
  });

  const converted = await useCases.convertRoleSourceRole({ sourceId: "source-1", roleKey: "anthropologist", commit: "a".repeat(40), roleId: "anthropologist" });

  const manifest = JSON.parse(converted.files["role.json"]);
  assert.equal(manifest.roleId, "anthropologist");
  assert.equal(manifest.ogsContractVersion, 2);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal("contractVersion" in manifest, false);
  assert.equal("events" in manifest.outputs, false);
  assert.equal("allowedTools" in manifest.constraints, false);
  assert.deepEqual(manifest.outputs.decisionCriteria, []);
  assert.equal(JSON.parse(converted.files["output.schema.json"]).properties.event.enum, undefined);
  assert.equal(converted.files["agent.md"], "Research user behavior.");
});

test("role source conversion preserves explicitly supplied v2 events", async () => {
  const useCases = createRoleSourceCatalogUseCases({
    store: {
      async readRole() {
        return {
          role: { status: "ready", path: "roles/researcher.md", language: "en", sourceDigest: "source-digest" },
          markdown: "Research.",
          commit: "b".repeat(40),
          source: { sourceId: "source-2", gitUrl: "https://example.test/roles", adapterId: "markdown-role", adapterVersion: "1.0.0" }
        };
      }
    },
    adapters: {
      "markdown-role": {
        convertMarkdownRole() {
          return {
            roleId: "researcher",
            files: {
              "role.json": JSON.stringify({ roleId: "researcher", outputs: {}, constraints: {} }),
              "output.schema.json": JSON.stringify({ type: "object", properties: { event: { type: "string" } } })
            }
          };
        }
      }
    }
  });

  const converted = await useCases.convertRoleSourceRole({ sourceId: "source-2", roleKey: "researcher", commit: "b".repeat(40), roleId: "researcher", events: ["RESEARCH_COMPLETE"] });

  assert.deepEqual(JSON.parse(converted.files["output.schema.json"]).properties.event.enum, ["RESEARCH_COMPLETE"]);
});
