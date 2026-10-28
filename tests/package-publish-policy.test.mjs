import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

const packageJsonPath = path.resolve("package.json");

test("package publish whitelist includes the built-in and classic Team IR role sets", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const files = Array.isArray(packageJson.files) ? packageJson.files : [];
  const roleEntries = files.filter(
    (entry) => typeof entry === "string" && entry.startsWith("og-roles/roles/")
  );

  assert.deepEqual(roleEntries.sort(), [
    "og-roles/roles/advanced-coordinator/**",
    "og-roles/roles/advanced-reviewer/**",
    "og-roles/roles/advanced-worker-a/**",
    "og-roles/roles/advanced-worker-b/**",
    "og-roles/roles/cardiology-expert/**",
    "og-roles/roles/chief-reviewer/**",
    "og-roles/roles/compliance-reviewer/**",
    "og-roles/roles/consultation-dispatcher/**",
    "og-roles/roles/debate-host/**",
    "og-roles/roles/debate-opponent/**",
    "og-roles/roles/debate-proponent/**",
    "og-roles/roles/debate-reporter/**",
    "og-roles/roles/demo-analyst/**",
    "og-roles/roles/demo-intake/**",
    "og-roles/roles/diagnosis-chief-review/**",
    "og-roles/roles/diagnosis-dispatch/**",
    "og-roles/roles/hello-ogsystem/**",
    "og-roles/roles/imaging-expert/**",
    "og-roles/roles/imported.agency.legal-client-intake/**",
    "og-roles/roles/maker/**",
    "og-roles/roles/neurology-expert/**",
    "og-roles/roles/neutral-judge/**",
    "og-roles/roles/primary-reviewer/**",
    "og-roles/roles/release-gate/**",
    "og-roles/roles/signoff-chair/**",
    "og-roles/roles/software-implementer/**",
    "og-roles/roles/software-lead/**",
    "og-roles/roles/software-planner/**",
    "og-roles/roles/software-tester/**",
    "og-roles/roles/test-branch-a/**",
    "og-roles/roles/test-branch-b/**",
    "og-roles/roles/test-operator/**"
  ]);
  assert.equal(files.includes("og-roles/roles/**"), false);
});

test("package dependencies are registry-installable and do not self-reference", async () => {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const dependencySections = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies"
  ];

  for (const section of dependencySections) {
    const dependencies = packageJson[section] ?? {};
    assert.equal(
      Object.hasOwn(dependencies, packageJson.name),
      false,
      `${section} must not depend on ${packageJson.name}`
    );
    for (const [name, specifier] of Object.entries(dependencies)) {
      assert.equal(
        typeof specifier === "string" &&
          /^(?:link:|workspace:|file:)/.test(specifier),
        false,
        `${section}.${name} must use a registry-installable specifier`
      );
    }
  }
});
