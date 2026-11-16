# v2 Gate C Real Workflow Attempts

## Scope

These are real CLI Runtime attempts against the v2-only Gate C fixtures. They are retained as
failure evidence and do not close Gate C.

## Software workflow

- Fixture: `examples/gate-c-software/`
- Roles: planner -> implementer -> reviewer
- Backend: OpenCode
- Earlier Run `20261116-011127-1fe48ab0`: planner and implementer completed; the implementer
  wrote and tested `gate-c-output.mjs` and `gate-c-output.test.mjs`, and Runtime verified/sealed
  the Artifact. Reviewer failed with `OPENCODE_EXECUTION_ERROR` / `TypeError` before a decision.
- Later retries exposed unstable model-level native tool subsets (`write`, `edit`, and
  `apply_patch` were not consistently present in fresh capability responses). No reviewer
  promotion or owner sign-off was recorded.

## Documentation workflow

- Fixture: `examples/gate-c-docs/`
- Roles: researcher -> writer -> reviewer
- Run `20261116-012349-d79f3d8b` with `codex-gateway/gpt-6-luna`: researcher completed, but the
  writer returned a declaration for `gate-c-document.md` without creating the file; Runtime
  correctly failed closed with `ARTIFACT_VERIFICATION_FAILED` / `ARTIFACT_FILE_NOT_FOUND`.
- Run `20261116-012521-ab00a756` with OpenCode `opencode/beam-free`: the first Role failed with
  `OPENCODE_EXECUTION_ERROR` / `TypeError` before producing a result.
- No final document Artifact, reviewer decision, promotion, or product-owner sign-off was
  recorded.

## Gate status

`Gate C: Blocked`. These attempts prove that the Runtime rejects missing or unverified Artifact
outputs and records real Backend failures. They do not satisfy the production workflow acceptance
criteria. The remaining release blocker is a stable, verified writable native-tool capability for
the locally available model, followed by successful reviewer and promotion evidence.

## Follow-up bounded team retry

- 2026-11-16 05:28 CST: `node scripts/run-real-python-calculator-team.mjs` was run against
  the final v2 worktree with the real Codex Backend and `gpt-6-luna`, bounded by a 300 second
  process deadline. The process produced no Runtime events or result before the deadline and
  was terminated by the deadline wrapper. This is not a successful workflow run and is not
  included in the success evidence.
- The same code state passes a minimal real Codex `gpt-6-luna` execute in about 2.97 seconds,
  and the native Codex capability probe passes. The team-level hang was not reproduced by the
  minimal call; retain it as an external Backend/model availability or service responsiveness
  issue until a clean environment reproduces the complete team run.
