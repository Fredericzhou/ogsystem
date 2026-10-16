# OGS Team Site

An isolated, bilingual product experience for creating and running OGS Team Assets. The site uses
the Platform Runtime Core and keeps team-library, project, resource, and run management here.

The site calls a static OGS definition a **team**. Creating a team creates an OGS project asset in
the team library; selecting it creates a Project workspace for materials and task execution.

## Run locally

From the repository root, build the latest committed framework CLI, then start the site:

```powershell
pnpm build
pnpm --dir apps/team-site start
```

Open `http://127.0.0.1:4173`. The public demo endpoint executes the actual graph runtime in dry-run mode with fixed site-owned role contracts. It does not make model calls.

The public site opens at `/`. The runnable workspace is at `/studio`; bilingual case backgrounds and
team responsibilities are available at `/cases/software-team`, `/cases/expert-consultation`, and
`/cases/structured-debate`.

Product APIs are under `/api/v1/projects` and `/api/v1/team-packages`. Vis owns the separate
professional routes under `/api/v1/ogs/workspace` and `/api/v1/ogs/runs`.

The site discovers the professional Vis entrypoint from `/api/v1/config`. Set `OGS_VIS_URL` when
the Vis server is not running at its local default (`http://127.0.0.1:4177`).

## Verify cases with real models

The release verification lints and runs every case through the installed backend/model selected by `OGS_DEMO_BACKEND` and `OGS_DEMO_MODEL` (defaults: `codex` and `gpt-6-luna`). It checks each expected role and verifies backend/model values in the audit trail. Ensure the selected CLI is authenticated before running:

```powershell
pnpm --dir apps/team-site verify:cases
```

For OpenCode, the framework starts one `opencode serve` process per case run and reuses it across that run's role sessions. On Windows, the harness also adds the Node installation's bundled OpenCode executable directory to the child process path when present.

```powershell
$env:OGS_DEMO_BACKEND = "opencode"
$env:OGS_DEMO_MODEL = "multidebate/gpt-6-luna"
pnpm --dir apps/team-site verify:cases
```

`OGSYSTEM_ROOT` can point to another OGSystem checkout. The site must be tested against the exact framework commit intended for release.
