# OGS Team Site

An isolated, bilingual product experience for creating and running OGS Team Assets. The site uses
the Platform Runtime Core and keeps team-library, project, resource, and run management here.

The site presents a static OGS collaboration definition as a **team asset**. “Team” is a product
metaphor: graph members are stable responsibility roles, not specific people or separately
identified agents. Creating a team creates a draft OGS asset; structural confirmation puts it in the
team library. Selecting a confirmed team opens a Project workspace for materials, task input, and
execution. Confirmation does not establish provider connectivity or credentials; project readiness
reports static blockers and warnings without probing online services. The UI calls a `Run` a
**运行**; the API and runtime keep `project` and `run` as their canonical technical terms.

## Product workflow

The site keeps team authoring separate from team use:

1. **Team library**: create a team from a natural-language goal, choose guided options, continue
   the conversation, or open the professional Vis editor for detailed structure and runtime work.
2. **Team confirmation**: validate the OGS structure and supported topology, then save the confirmed
   static team asset. This is separate from run readiness.
3. **Project workspace**: select a confirmed team, add workspace materials, enter a task, choose
   Dry Run or Sandbox Run, and inspect the result. Dry Run previews the flow; Sandbox Run requires
   static readiness checks to pass. Neither readiness nor confirmation probes provider connectivity
   or verifies CLI credentials.

`/studio/new` creates a team draft. `/studio` is the team library. A project URL is the working
instance of a selected team; it does not add a second Team entity. The site owns the ordinary-user
flow, while Vis owns professional authoring, diagnostics, and advanced runtime inspection. Both
surfaces call the same Runtime Core.

## Run locally

From the repository root, build the latest committed framework CLI, then start the site:

```powershell
pnpm build
pnpm --dir apps/team-site start
```

Open `http://127.0.0.1:4173`. The public demo endpoint executes the actual graph runtime in Dry Run
mode with fixed site-owned role contracts. It does not make model calls.

The public site opens at `/`. The team library is at `/studio`; create-team authoring starts at
`/studio/new`; a team can be opened from `/cases/software-team`, `/cases/expert-consultation`, or
`/cases/structured-debate`.

Product APIs are under `/api/v1/projects` and `/api/v1/team-packages`. Vis owns the separate
professional routes under `/api/v1/ogs/workspace` and `/api/v1/ogs/runs`; it is not a second product
site or a second runtime. `GET /api/v1/projects/{projectId}/readiness` reports static blockers and
warnings for Sandbox Run without exposing local paths or probing provider connectivity.

The site discovers the professional Vis entrypoint from `/api/v1/config`. Set `OGS_VIS_URL` when
the Vis server is not running at its local default (`http://127.0.0.1:4177`).

## Verify cases with real models

The release verification lints and runs every case through the installed backend/model selected by `OGS_DEMO_BACKEND` and `OGS_DEMO_MODEL` (defaults: `codex` and `gpt-5.6-luna`). It checks each expected role and verifies backend/model values in the audit trail. Ensure the selected CLI is authenticated before running:

```powershell
pnpm --dir apps/team-site verify:cases
```

For OpenCode, the framework starts one `opencode serve` process per case run and reuses it across that run's role sessions. On Windows, the harness also adds the Node installation's bundled OpenCode executable directory to the child process path when present.

```powershell
$env:OGS_DEMO_BACKEND = "opencode"
$env:OGS_DEMO_MODEL = "multidebate/gpt-5.6-luna"
pnpm --dir apps/team-site verify:cases
```

`OGSYSTEM_ROOT` can point to another OGSystem checkout. The site must be tested against the exact framework commit intended for release.
