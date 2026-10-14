# OGSystem Agent Team Site

An isolated, bilingual product experience for configuring and trying Agent Teams. The site consumes the repository's `ogs` CLI as its framework boundary and keeps all site code under this directory.

## Run locally

From the repository root, build the latest committed framework CLI, then start the site:

```powershell
pnpm build
pnpm --dir apps/agent-team-site start
```

Open `http://127.0.0.1:4173`. The public demo endpoint executes the actual graph runtime in dry-run mode with fixed site-owned role contracts. It does not make model calls.

## Verify cases with real models

The release verification runs every case through the installed backend/model selected by `OGS_DEMO_BACKEND` and `OGS_DEMO_MODEL` (defaults: `codex` and `gpt-6-luna`). Ensure the selected CLI is authenticated before running:

```powershell
pnpm --dir apps/agent-team-site verify:cases
```

`OGSYSTEM_ROOT` can point to another OGSystem checkout. The site must be tested against the exact framework commit intended for release.
