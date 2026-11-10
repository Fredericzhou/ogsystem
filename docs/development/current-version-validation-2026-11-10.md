# Current Version Validation 2026-11-10

This record describes the validation boundary for the current working version.

## Passed

- `pnpm build`
- Runtime artifact, workspace, permission and selector contract tests
- Team Site Deliverable, sealed bundle, verified stream and integrity tests
- `pnpm run test:visualizer-browser` (17 passed, 2 deployment-only tests skipped)
- Lint for all five classic teams
- Real API model runs for all five classic teams using the configured Codex app-server API (`gpt-6-luna`); the cross-backend review case also used the OpenCode protocol route `codex-gateway/gpt-6-luna`
- Local publisher output: Markdown, DOCX, PDF, JSON, CSV, XLSX, PNG, MP4 and MP3
- `ffprobe` media streams and SHA-256 manifest/seal generation

The publisher roles write only to the Runtime execution workspace. Runtime verifies relative paths, regular files, no-follow handles, size quotas and hashes, then stores the immutable bundle under `run/shared/artifacts`.

## Boundaries

Model availability is established through the configured CLI protocols and API calls. Interactive CLI login status is not an availability signal and is not used as a validation gate. The verified Codex route uses the local app-server API configuration; the OpenCode route is verified through its protocol endpoint. Dry-run output remains separate from real model evidence.

The Business Data Adapter transaction sequence `validate -> diff -> confirm -> commit` and external database writes remain out of scope. `business_data` may declare JSON, CSV, XLSX, image, video or audio files; `mediaType` is metadata and does not perform conversion or magic-number validation.

## Notes

The full Team Site test suite still contains two pre-existing UI timeout failures around platform settings data-root switching and linked model selection. The focused artifact and Deliverable suites pass.
