import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import {
  assertWorkspaceExecutionDirectory,
  projectWorkspaceCapabilities,
  validateWorkspaceCapabilityPolicy
} from "../dist/runtime/backend-capabilities.js";

const root = resolve("/tmp/ogs-run/roles/worker/executions/execution-1/workspace");

test("workspace capability contract projects only enabled MVP capabilities", () => {
  assert.deepEqual(projectWorkspaceCapabilities({ root, read: true, write: false, command: true }), [
    "workspace.read",
    "workspace.run"
  ]);
});

test("workspace capability contract rejects malformed policies", () => {
  assert.throws(
    () => validateWorkspaceCapabilityPolicy({ root: "relative/workspace", read: true }),
    /BACKEND_WORKSPACE_CONTRACT_INVALID.*absolute path/
  );
  assert.throws(
    () => validateWorkspaceCapabilityPolicy({ root, read: "yes" }),
    /BACKEND_WORKSPACE_CONTRACT_INVALID.*read must be a boolean/
  );
});

test("backend execution directory must remain inside the execution workspace", () => {
  assert.equal(
    assertWorkspaceExecutionDirectory({ directory: "relative/backend-dir" }),
    resolve("relative/backend-dir")
  );
  assert.equal(assertWorkspaceExecutionDirectory({ policy: { root, read: true }, directory: join(root, "src") }), join(root, "src"));
  assert.throws(
    () => assertWorkspaceExecutionDirectory({ policy: { root, read: true }, directory: "/tmp/ogs-run/project" }),
    /BACKEND_WORKSPACE_CONTRACT_INVALID.*escapes capability root/
  );
  assert.throws(
    () => assertWorkspaceExecutionDirectory({ policy: { root, read: true }, directory: `${root}-sibling` }),
    /BACKEND_WORKSPACE_CONTRACT_INVALID.*escapes capability root/
  );
});
