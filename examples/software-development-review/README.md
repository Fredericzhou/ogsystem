# Software Development and Review

This example is a practical OGS workflow scaffold for a bounded change in an existing project. The architect sends backend, frontend, and QA work to parallel roles. A delivery lead joins their results and pauses for human approval. A reviewer can request up to two rework rounds.

The example does not promise that a run will make correct code changes or that proposed tests will pass. Those outcomes depend on the configured local coding CLI, model, project instructions, available tools, and operator verification. The `--dry-run` command checks OGS parsing and orchestration without invoking a model.

## Configure and run

Set `--workspace-dir` to the project being changed. The OGS control project and target workspace are separate. This example opts the Codex backend into `workspaceWrite` in `.ogs/runtime.json`; Codex is sandboxed to the selected target workspace. Other projects remain read-only by default. `exec.bind` is not used here.

```bash
ogs doctor --ogs-dir examples/software-development-review
ogs run start \
  --system examples/software-development-review/system.mmd \
  --ogs-dir examples/software-development-review \
  --workspace-dir /path/to/your/project \
  --input "Add a health endpoint and tests" \
  --dry-run
```

Before a real run, confirm that the selected CLI and model are available. Edit `.ogs/model-selection.json` if needed, then verify the target directory and the system instructions. To run with the default selection, omit `--dry-run`. Review the generated diff and run the project's real build and tests before approving.

## Review

The `delivery-lead` pauses the run and creates a native review request. Inspect it, then approve or request rework:

```bash
ogs run list --ogs-dir examples/software-development-review
ogs run status <run-id> --ogs-dir examples/software-development-review
ogs run review list <run-id> --ogs-dir examples/software-development-review
ogs run review inspect <run-id> <review-id> --ogs-dir examples/software-development-review
ogs run review decide <run-id> <review-id> --decision approve --comment "Accepted" --ogs-dir examples/software-development-review
ogs run resume <run-id> --ogs-dir examples/software-development-review
```

For rework, use `--decision rework` with a concrete change request, then resume. Review feedback is provided to the architect on the next bounded round. The operator remains responsible for inspecting the diff and running the project's real build and test commands before accepting the work.
