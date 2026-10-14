# Single Host Production Runbook

This runbook covers one operator, one project workspace, and one local OGS installation. It does
not describe cross-host recovery or execution of untrusted tools.

## Deployment Gate

Use a versioned OGSystem package tarball and record its published SHA-256 alongside the deployment
record. Install and initialize the project from the target host:

```powershell
npm install -g .\ogsystem-1.0.0.tgz
ogs project create production-app --template minimal
cd production-app
ogs models sync
```

Use the equivalent absolute tarball path with `pnpm add -g <tarball>`. Configure the selected model
and its provider CLI credentials under the operating-system account that will run OGS. Do not put
credential values in `deploy-manifest.json` or project files.

Set the production runtime policy in `.ogs/runtime.json`:

```json
{
  "tools": {
    "environmentPolicy": "minimal",
    "envAllowlist": []
  },
  "retention": {
    "enabled": true,
    "executionDirThreshold": 2000,
    "keepLatest": 250
  }
}
```

Add only environment variable names required by reviewed tools to `envAllowlist`. The child process
receives values from the service account's environment. Minimal mode also preserves platform
command-search and temporary-directory variables. It does not restrict filesystem access; `cwd` is
not a sandbox.

Run the preflight with an operator-selected free-space requirement. The value below is an example,
not a universal workload quota:

```text
ogs doctor --production --min-free-bytes 1073741824 --required opencode --system system.mmd --ogs-dir .
ogs doctor --online-check --system system.mmd --ogs-dir .
ogs run start --system system.mmd --input "deployment smoke" --dry-run
ogs project manifest --output deploy-manifest.json
ogs run start --system system.mmd --input "bounded production smoke"
ogs vis --ogs-dir .
```

`--online-check` calls the selected provider and may consume tokens. Run it deliberately. Doctor
outputs versioned JSON and uses exit code `0` for success, `1` for failed checks, and `2` when a
required command is missing. Save its JSON report and the deployment manifest with the release
record. The manifest contains an installed-package tree digest, Node/OS versions, model CLI versions,
model references, and semantic fingerprints; unavailable CLI versions are marked explicitly.

The package install smoke exercises a clean install, project creation, model synchronization,
production Doctor, manifest generation, dry-run, bounded local execution, and localhost Visualizer.
Run it before publishing or promoting a tarball:

```text
pnpm run smoke:package-install:npm
pnpm run smoke:package-install:pnpm
```

## Capacity And Retention

The production starting point is `executionDirThreshold=2000` and `keepLatest=250`. Verify it with
the project's real role output sizes before enabling automatic cleanup. Cleanup removes historical
per-role execution snapshots; it does not archive or remove the full run audit history. Export audit
evidence before any separate archive or deletion process.

Capture a 500-iteration recovery baseline:

```text
pnpm run bench:runtime-replay
```

The report-only reference limits are state load 10 ms, checkpoint load 8 ms, resume total 1800 ms,
and state write 15 ms. For the 10,000-iteration stress run, record results without applying the
500-iteration latency limits:

```text
pnpm run bench:runtime-replay -- --iterations 10000 --restore-checkpoint 9900 --output .ogs/runtime-replay-10000.json
```

Check final state, recovery correctness, run-directory count, and total `.ogs/runs` bytes. Use the
filesystem's own quota/alerting for total disk capacity; OGS's execution-directory count is not a
byte quota.

## Backup And Recovery

Take a project backup only after a run reaches `done`, `failed`, or `terminated`, or after a human
review pause has returned control to the operator. For a review pause, verify the OGS process has
exited and `.resume.lock` is absent. Never copy a live run directory. An outcome-to-next-node gap is
not a supported snapshot point.

Back up the system source, `.ogs` project configuration, role packages, and the run's recovery
authority files. Include the bound coding workspace when role side effects there must be recoverable.
Do not copy provider CLI credentials into the project backup; provision them separately for the
restore account. Encrypt backups according to the data classification of prompts and artifacts.

Restore into a new directory, inspect the project and run with Doctor, and resume only after the
strict plan fingerprint matches. A mismatch is a stop condition; do not bypass it by editing the
fingerprint. If a crash occurred before an external command's outcome was durably recorded, that
command may run again after resume. Use idempotent operations or reconcile external state manually.

## OS Process Recipes

Run scheduled work as a dedicated OS account with its own provider CLI setup and a fixed project
directory. OGS runs remain one-shot processes; OS restart policies must not blindly rerun
`ogs run start`, since that creates a new run.

Example systemd one-shot service:

```ini
[Unit]
Description=OGSystem bounded workflow

[Service]
Type=oneshot
User=ogs
WorkingDirectory=/srv/production-app
Environment=PATH=/usr/local/bin:/usr/bin
ExecStart=/usr/local/bin/ogs run start --system system.mmd --input scheduled-run --ogs-dir /srv/production-app
StandardOutput=journal
StandardError=journal
```

Attach a systemd timer for scheduled new runs. Do not configure automatic restart for this unit.
For Windows Task Scheduler, set the same project directory as **Start in**, run as the account
holding the provider CLI credentials, and capture stdout/stderr to an operator-managed log location.
For an interrupted run, inspect its run ID and explicitly invoke `ogs run resume <run-id>` after the
recovery checks above.
