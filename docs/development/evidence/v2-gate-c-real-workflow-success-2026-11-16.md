# v2 Gate C Real Workflow Execution Record (Historical)

> This record predates the final Workspace contract and is retained for execution diagnosis.
> It is not current V2 Release or UAT evidence and cannot close a release gate. Current evidence
> must use the Workspace contracts, Run evidence, and Release materialization records.

## Scope

This record documents a pre-contract engineering execution against the then-current v2 worktree;
it does not close the current Gate C.
Both workflows used the real Codex Backend Adapter, the only locally available model
`gpt-6-luna`, and the v2 CLI Runtime path. The earlier failure record remains in
`v2-gate-c-real-workflow-attempts-2026-11-16.md`.

## Backend readiness

- Backend: `codex`
- Model: `gpt-6-luna`
- Adapter: `codex-app-server-v2-native-tools-1`
- Capability probe: disposable staging probe passed for `apply_patch` and `exec_command`.
- Probe evidence: `fileChange` and successful `commandExecution` events plus sentinel file
  verification; failed probes clean their temporary staging root.
- Codex policy mapping: `approvalPolicy=never`, `sandbox=workspace-write`, and
  `sandboxPolicy.workspaceWrite` restricted to the Run staging root.
- Codex structured-output projection supplies strict object properties and exact required
  keys at the Adapter boundary; the original Role schema remains the Runtime validator.
- Harness binding supports optional `variant` and `reasoningEffort`; the accepted fixtures use
  the Backend default (`reasoningEffort=auto`) and the frozen Run records the Adapter-selected
  effective value when one is returned. The request is never projected into business input.

## Documentation workflow

- Fixture: `examples/gate-c-docs/`
- Run: `20261116-020903-04973f1b`
- Flow: `researcher -> writer -> reviewer`
- Result: `status=done`, 3 transitions, 3 successful Roles, `failed=0`, `noop=0`.
- Writer binding: Codex `gpt-6-luna`, `allowedTools=[apply_patch, exec_command]`, with both
  tools present in the verified Capability Snapshot; the Runtime computed the executable
  intersection in memory. Staged filesystem write and command execution were enabled, network
  denied.
- Writer capability digest: `62133805f519e86da2a29f068ec79a54de4e2563f1576b081fd435d66638f981`;
  policy digest: `bf19edc65fd2cb31acc1265e013a59aabba1068551d21b42fe80a8d52d8610a3`;
  staging root is the Run's writer execution workspace.
- Reviewer result: finalization approved after checking Purpose, Workflow, Evidence, Acceptance,
  traceability, and unsupported-claim constraints.
- Delivered file: `gate-c-document.md`, 1,114 bytes, media type `text/markdown`.
- Historical evidence manifest digest: `ff4beda75d73a8bc6ace9fd34cca6e6e21cdd980e973fd0b8a167dd72e676663`.
- Evidence files: the Run `summary.json`, `resolved-config.json`, `audit/summary.md`,
  the sealed Run evidence manifest, `shared/seal-manifest.json`, and `shared/verification.json`.
- The pre-contract run materialized its sealed output under `release/gate-c-document-final`.
  This directory and its receipt are historical diagnostics; they are not a current V2 Release
  record or download reference.

## Software workflow

- Fixture: `examples/gate-c-software/`
- Run: `20261116-021112-8895f585`
- Flow: `planner -> implementer -> reviewer`
- Result: `status=done`, 3 transitions, 3 successful Roles, `failed=0`, `noop=0`.
- Implementer binding: Codex `gpt-6-luna`, `allowedTools=[apply_patch, exec_command]`, with both
  tools present in the verified Capability Snapshot; the Runtime computed the executable
  intersection in memory. Staged filesystem write, command execution, and network denied.
- Implementer capability digest: `b5f6d342b39d27ea3ca2f1f6e0ec089746432f88aa6854753c3c18aeb82999b7`;
  policy digest: `aa288844a7e91a9e8dd0215188f1ef4ecbf805be9e589b3223897cd68286ce7c`;
  staging root is the Run's implementer execution workspace.
- Reviewer result: approved `node gate-c-output.test.mjs` with exit code 0.
- Delivered files: `gate-c-output.mjs` (60 bytes) and `gate-c-output.test.mjs` (128 bytes), both
  `text/javascript`.
- Historical evidence manifest digest: `e9d97285e6a872db90e6dab4ecd7004641062924a5b11b7d3cb4b292f2cb3567`.
- Evidence files: the Run `summary.json`, `resolved-config.json`, `audit/summary.md`,
  the sealed Run evidence manifest, `shared/seal-manifest.json`, and `shared/verification.json`.
- The pre-contract run materialized its sealed output under `release/gate-c-output-final`.
  This directory and its receipt are historical diagnostics; they are not a current V2 Release
  record or download reference.

## Boundary and regression evidence

### Additional Codex Runtime Evidence

- Isolated two-Role smoke workflow: `examples/target-model-binding-system.mmd` with
  `debate-minimalist -> debate-judge`.
- Backend/model binding: Codex `gpt-6-luna`; the temporary model catalog contained only
  this model, while the Runtime configuration retained its valid `executor=opencode`
  control-plane value.
- Result: `status=done`, `totalTransitions=2`, `okCount=2`, `failedCount=0`,
  `noopCount=0`, `unhandledFailureCount=0`.
- Reproducible Run: `20261116-085140-b8e51449`; the trace recorded `READY` for
  `debate-minimalist` in 10,547 ms and `debate-judge` in 12,998 ms.
- Runtime output: 696 characters across two successful Role turns in the first isolated
  run; 157 projected input characters and 4,042 rendered prompt characters. The run
  completed in approximately 22 seconds with the real Codex app-server and
  `turn/completed` protocol. The reproducible traced Run emitted 729 output characters,
  completed both Roles in approximately 23.3 seconds, and recorded the same zero-failure
  terminal result.
- A minimal real Codex turn using the same model returned `{"model":"gpt-6-luna","status":"READY"}`.
- This evidence confirms that the app-server completion waiter is released by normal
  completion and that the two-Role handoff completes without the earlier indefinite
  `running` state.

- Downstream handoff tests preserve business data and delivery metadata while excluding
  Backend, model, Harness, tool, permission, policy, and workspace execution fields.
- Legacy delivery verification tests authenticate path, media type, size, file digest, and manifest
  digest before exposing metadata; they are implementation regression tests, not the Workspace
  contract source.
- Codex adapter tests cover strict schema projection, native permission mapping, and capability
  discovery. OpenCode adapter tests cover provider configuration and delivery tool phase ordering.
- Pi native RPC capability discovery is covered, but Pi filesystem/process execution remains
  unavailable for production claims because its current cwd boundary does not prove staging
  isolation; explicit resource tools are rejected fail-closed.
- Final browser regression after layout and boundary-input race fixes: `17 passed`, `2 skipped`;
  Build layout regression: `4 passed`. The current full Node regression is `460 passed`,
  `1 skipped`, `0 failed` (`pnpm test`, final v2 worktree); Team Site tests are
  `49 passed`. Earlier counts from
  pre-cutover test enumeration are historical and are not used as the current release total.
- Tarball installation smoke passed through both npm and pnpm. The smoke now verifies the v2
  Role Package/project layout and dry-run entrypoint; it no longer expects the removed v1
  generated local-shell script.

## Acceptance status

## Real Python Team Reverification

- Script: `scripts/run-real-python-calculator-team.mjs`
- Backend/model: Codex `gpt-6-luna`; Harness Template `calculator-worker`; native tools
  `apply_patch` and `exec_command`; staged filesystem, process allowed, network denied.
- Result: `status=done`, four Role commits, Join merge and final publish both succeeded.
- Final merge: `6c9ced8de5c62c136f2188786d5a56366d3406d7`.
- Post-merge Python validation: 10 tests passed; CLI `add 2 3` returned `5`, CLI
  `multiply 6 7` returned `42`; final Git status was clean.
- The acceptance script now distinguishes an incomplete Runtime/publish from a missing
  test fixture and preserves a pre-existing `tests/__init__.py` during unittest discovery.

The pre-contract execution criteria were observed for both workflows. Product-owner and
workflow-operator sign-off required by the release UAT governance document remains outstanding,
and this historical record cannot substitute for current final-contract Project Runs or signatures.
The later bounded Python-team retry is recorded separately as a real Backend/model hang and does
not claim repeatability beyond the successful Run records above.

## 2026-11-17 Team Site real-case verification

`pnpm --dir apps/team-site verify:cases` completed with all four model cases passing against the
same final worktree: `cross-backend-review-loop`, `management-consulting`, `software-team`, and
`structured-debate`. The runs used real Codex `gpt-6-luna` execution; no dry-run result was used.
The management case completed 9/9 Roles and verified one delivered file set. This pre-contract
case output is retained as diagnostics only; current acceptance must attach a Workspace commit,
Release ID, materialization manifest digest, and output digest.
The structured debate case completed 5/5 Roles and verified five delivered files including
`debate-brief.md`. This pre-contract output is also retained as diagnostics only; it cannot satisfy
the current Project/Task/Run and Release evidence requirements.
