# Current Version Validation 2026-11-10

This record describes the validation boundary for the current working version.

## Passed

- `pnpm build`
- Runtime artifact, workspace, permission and selector contract tests
- Team Site Deliverable, sealed bundle, verified stream and integrity tests
- `pnpm run test:visualizer-browser` (17 passed, 2 deployment-only tests skipped)
- Lint for all five classic teams
- Local publisher output: Markdown, DOCX, PDF, JSON, CSV, XLSX, PNG, MP4 and MP3
- `ffprobe` media streams and SHA-256 manifest/seal generation

The publisher roles write only to the Runtime execution workspace. Runtime verifies relative paths, regular files, no-follow handles, size quotas and hashes, then stores the immutable bundle under `run/shared/artifacts`.

## Blocked

OpenCode and Codex are not logged in on this host (`opencode auth list` reports zero credentials and `codex login status` reports not logged in). The five real model Sandbox Runs therefore remain `BLOCKED`; simulation or dry-run output is not evidence of a model run.

The Business Data Adapter transaction sequence `validate -> diff -> confirm -> commit` and external database writes remain out of scope. `business_data` may declare JSON, CSV, XLSX, image, video or audio files; `mediaType` is metadata and does not perform conversion or magic-number validation.

## Notes

The full Team Site test suite still contains two pre-existing UI timeout failures around platform settings data-root switching and linked model selection. The focused artifact and Deliverable suites pass.
