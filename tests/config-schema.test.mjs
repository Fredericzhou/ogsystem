import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

import Ajv2020 from "ajv/dist/2020.js";

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function createValidator(schema) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });
  return ajv.compile(schema);
}

test("runtime config schema accepts repository runtime.json", async () => {
  const runtimeSchema = await readJson(path.resolve("schemas/runtime-config.schema.json"));
  const runtimeConfig = await readJson(path.resolve(".ogsystem/runtime.json"));

  const validate = createValidator(runtimeSchema);
  const ok = validate(runtimeConfig);
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
});

test("runtime config schema rejects unknown workspace fields", async () => {
  const runtimeSchema = await readJson(path.resolve("schemas/runtime-config.schema.json"));
  const validate = createValidator(runtimeSchema);

  const ok = validate({
    executor: "opencode",
    roleRepo: "./og-roles",
    modelRepo: "./og-models",
    workspace: {
      rolesDir: "roles",
      privateDirName: "private",
      linkSharedIntoRoleDir: false
    }
  });

  assert.equal(ok, false);
});

test("user profile schema accepts repository user-profile.json", async () => {
  const profileSchema = await readJson(path.resolve("schemas/user-profile.schema.json"));
  const userProfile = await readJson(path.resolve(".ogsystem/user-profile.json"));

  const validate = createValidator(profileSchema);
  const ok = validate(userProfile);
  assert.equal(ok, true, JSON.stringify(validate.errors, null, 2));
});

test("user profile schema rejects unknown fields", async () => {
  const profileSchema = await readJson(path.resolve("schemas/user-profile.schema.json"));
  const validate = createValidator(profileSchema);

  const ok = validate({
    userProfileId: "default.profile",
    language: "zh-CN",
    customFlag: true
  });

  assert.equal(ok, false);
});
