# Archived v1 tests

These tests exercise the retired Contract Set v1 inputs (`exec.bind`, Profile/Tool files,
`noop`, and v1 runtime envelopes). They are retained as historical rejection and migration
reference only. The active test runner discovers files directly under `tests/`; archived tests
are intentionally excluded from `pnpm test`.

The active v2 regression suite is in `tests/v2-contract.test.mjs` and
`tests/v2-execution-policy.test.mjs`, together with the remaining v2-compatible tests.
