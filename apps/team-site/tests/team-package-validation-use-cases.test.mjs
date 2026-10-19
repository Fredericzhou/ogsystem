import assert from "node:assert/strict";
import test from "node:test";
import { createTeamPackageValidationUseCases } from "../application/team-package-validation-use-cases.mjs";
import { computePackageDigest, computeTeamPackageCoreDigest } from "../infrastructure/package-integrity.mjs";

const useCases = createTeamPackageValidationUseCases({
  packageIntegrity: { computePackageDigest, computeTeamPackageCoreDigest }
});

function bundle(extra = {}) {
  return { mode: "team-v2", team: { systemSource: "flowchart TD", project: { name: "Team" } }, ...extra };
}

test("Team package validation returns canonical digests and metadata", async () => {
  const input = bundle();
  const result = await useCases.validateTeamPackage(input);
  assert.equal(result.bundle, input);
  assert.deepEqual(result.metadata, { name: "Team" });
  assert.equal(result.teamCoreDigest, computeTeamPackageCoreDigest(input));
  assert.equal(result.packageDigest, computePackageDigest(input));
});

test("Team package validation rejects unsupported schema, unsafe paths, digest mismatch, and credentials", async () => {
  await assert.rejects(useCases.validateTeamPackage({ ...bundle(), mode: "team-v3" }), /PROJECT_PACKAGE_VERSION_UNSUPPORTED/);
  await assert.rejects(useCases.validateTeamPackage(bundle({ releaseManifest: { artifactScope: ["../secret"] } })), /unsafe artifact path/);
  await assert.rejects(useCases.validateTeamPackage(bundle({ packageDigest: "wrong" })), /packageDigest does not match/);
  await assert.rejects(useCases.validateTeamPackage(bundle({ team: { systemSource: "flowchart TD", config: { api_key: "secret" } } })), /credential field is not accepted: team.config.api_key/);
});
