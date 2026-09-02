# OGSystem Cross-platform Visualizer Validation Closure

Date: 2026-05-05
Status: completed

## Scope

This record closes the Windows/macOS/Linux harness cleanup for the Visualizer and lifecycle validation flow. It does not change runtime, compiler, graph, parser, or artifact semantics.

## Changes

- `scripts/windows-lifecycle-smoke.mjs` now runs the CMD path through `cmd.exe` with verbatim arguments and `call`, preserving quoted Node, CLI, and workdir paths with spaces.
- `scripts/visualizer-browser-smoke.mjs` no longer hard-codes a macOS-local pnpm path. It resolves `PNPM_BIN`, then falls back to `pnpm.cmd` on Windows and `pnpm` elsewhere; Windows execution goes through `cmd.exe /d /s /c call ...` so `.cmd` shims work under Node 22.
- Browser smoke now handles spawn errors and separates build failure, browser environment failure, and Playwright app assertion failure.
- `package.json` routes `test:visualizer-browser` through the smoke wrapper so local and CI runs use the same classification logic.
- `package.json` no longer publishes a self-referential `ogsystem: link:` dependency, which blocked npm tarball install smoke.
- `scripts/package-install-smoke.mjs` validates the current single `ogs` bin and `ogs doctor --help` instead of the removed legacy `ogs-doctor.mjs` bin.
- `pnpm test` now uses `scripts/run-node-tests.mjs`; Windows runs test files serially to avoid intermittent subprocess lifecycle interference, while macOS/Linux keep the Node test runner default.
- `scripts/docs-command-drift-check.mjs` parses shell fenced blocks with both LF and CRLF line endings.
- `.gitignore` ignores Playwright-generated `test-results/` and `playwright-report/`.
- CI installs pnpm `10.33.2`, matching `packageManager`, and installs Playwright Chromium on all OSes. Linux also installs Chromium system dependencies.

## Platform Coverage

- Windows: local validation covers build, docs drift, PowerShell/CMD lifecycle smoke, visualizer unit coverage, Playwright Chromium install, browser smoke, and full Node test runner.
- macOS: CI matrix runs build, unit tests, browser smoke, examples, and doctor preflight with the same pnpm/browser smoke entrypoints.
- Linux: CI matrix runs the same gates and additionally installs Playwright Chromium system dependencies before browser smoke.

## Validation Commands

```bash
corepack pnpm run build
corepack pnpm run test:docs-command-drift
corepack pnpm run smoke:windows-lifecycle
corepack pnpm run test:visualizer
corepack pnpm exec playwright install chromium
corepack pnpm run test:visualizer-browser
node scripts/visualizer-browser-smoke.mjs
corepack pnpm test
```

Windows local validation completed on 2026-05-05:

- `corepack pnpm run build`: passed.
- `corepack pnpm run test:docs-command-drift`: passed.
- `corepack pnpm run smoke:windows-lifecycle`: passed.
- `corepack pnpm run test:visualizer`: passed, 120/120.
- `corepack pnpm exec playwright install chromium`: passed.
- `corepack pnpm run test:visualizer-browser`: passed, 2/2.
- `node scripts/visualizer-browser-smoke.mjs`: passed, 2/2.
- `corepack pnpm run smoke:package-install:npm`: passed.
- `corepack pnpm run smoke:package-install:pnpm`: passed.
- `corepack pnpm test`: passed, 405 tests, 404 pass, 1 skip.

macOS and Linux coverage is enforced through the GitHub Actions matrix in `.github/workflows/ci.yml`. Linux installs Playwright system dependencies before Chromium; all OSes install the Chromium browser package before browser smoke.

## Cleanup

Generated Playwright artifacts are not source material. `test-results/` and `playwright-report/` are ignored and should be removed after extracting any failure context needed for debugging.
