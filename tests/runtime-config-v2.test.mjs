import assert from "node:assert/strict";
import test from "node:test";
import { validateRuntimeConfig } from "../dist/runtime/config.js";

const baseConfig = {
  configVersion: "2",
  executor: "opencode",
  roleRepo: "./og-roles",
  runsDir: ".ogs/runs"
};

test("V2 runtime config rejects the removed V1 config version", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...baseConfig, configVersion: "1" }, "/tmp/runtime.json"),
    /unsupported config version "1"/
  );
});

test("V2 runtime config rejects removed runtime error-flow roots", () => {
  assert.throws(
    () => validateRuntimeConfig({ ...baseConfig, runtime: { error_flows: { v1: true } } }, "/tmp/runtime.json"),
    /\$\.runtime: unknown field/
  );
});
