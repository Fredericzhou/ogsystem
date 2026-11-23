# Post-Merge Validation 2026-11-24

This record documents local validation after the Contract Set v2 branch was fast-forwarded to
`main` at commit `a1a771a5`. It is engineering evidence for this host and is not a substitute for
the GitHub Actions Linux, macOS, and Windows matrix.

## Passed

- `pnpm install --frozen-lockfile`
- `pnpm test`: 488 core tests passed, one Windows-specific test skipped, zero core failures.
- Team Site suite: 107 passed, zero failures.
- `pnpm run smoke:package-install:npm`
- `pnpm run smoke:package-install:pnpm`
- `pnpm run test:visualizer-browser`: 17 passed, two deployment-only tests skipped.
- `pnpm run test:doctor`: command completed successfully with no missing required commands.

## Boundaries

- The local host used Node `v26.7.0`; CI is configured for Node 20. Cross-platform CI remains
  authoritative for supported runner behavior.
- `test:doctor` reported a stale `.ogs/model-catalog.json` and recommended
  `ogs project sync-models`; this is a readiness warning, not a test failure.
- `pnpm run test:examples` exited successfully and exercised the configured dry-run examples. One
  example emitted a terminal `failed` runtime status for an unmatched route, so this command result
  should be read as command-level smoke coverage rather than proof that every example workflow
  reaches `done`.
