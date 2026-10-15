# OGSystem Agent Team Site

An isolated, bilingual product experience for configuring and trying Agent Teams. The site consumes the repository's `ogs` CLI as its framework boundary and keeps all site code under this directory.

## Run locally

From the repository root, build the latest committed framework CLI, then start the site:

```powershell
pnpm build
pnpm --dir apps/agent-team-site start
```

Open `http://127.0.0.1:4173`. The public demo endpoint executes the actual graph runtime in dry-run mode with fixed site-owned role contracts. It does not make model calls.

The public site opens at `/`. The runnable workspace is at `/studio`; bilingual case backgrounds and team responsibilities are available at `/cases/software-team`, `/cases/expert-consultation`, and `/cases/structured-debate`.

## Verify cases with real models

The release verification lints and runs every case through the installed backend/model selected by `OGS_DEMO_BACKEND` and `OGS_DEMO_MODEL` (defaults: `codex` and `gpt-6-luna`). It checks each expected role and verifies backend/model values in the audit trail. Ensure the selected CLI is authenticated before running:

```powershell
pnpm --dir apps/agent-team-site verify:cases
```

For OpenCode, the framework starts one `opencode serve` process per case run and reuses it across that run's role sessions. On Windows, the harness also adds the Node installation's bundled OpenCode executable directory to the child process path when present.

```powershell
$env:OGS_DEMO_BACKEND = "opencode"
$env:OGS_DEMO_MODEL = "multidebate/gpt-6-luna"
pnpm --dir apps/agent-team-site verify:cases
```

`OGSYSTEM_ROOT` can point to another OGSystem checkout. The site must be tested against the exact framework commit intended for release.
