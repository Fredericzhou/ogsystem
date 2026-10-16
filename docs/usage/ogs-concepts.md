# OGS Product Concepts

This is the short product vocabulary reference. The normative graph and runtime semantics remain
in [OGSystem core concepts](ogsystem-core-concepts.md).

## Boundaries

| Layer | Responsibility |
| --- | --- |
| **Framework** | Execute OGS systems and provide parser/compiler, CLI, and `nl2mmd`. |
| **Platform** | Add model adapters/catalog, installed role library, and Vis professional tooling. |
| **Product Site** | Let ordinary users create team assets, attach resources, run projects, and inspect results. |

The Platform is the reusable foundation. The Product Site does not fork the runtime or duplicate Vis
semantics; it calls the same Runtime Core through its product-facing APIs.

## Objects

```text
Team Asset  ->  Project  ->  Run
static          working       one execution
portable        resources      immutable run snapshot
```

- **Team Asset / team**: a static OGS team definition kept in the team library. It is the thing
  created by “召唤团队”, can be confirmed, imported, and exported, and contains no execution history.
- **Project**: a selected team plus workspace materials, task input, and the project's run history.
- **Run / 运行**: one execution created from a confirmed project. Its `RunPlan`, task, material
  snapshots, events, checkpoints, reviews, and side-effect ledger are fixed under `.ogs/runs`.

The public portable format is `single-project-v1`. It excludes framework source, credentials, model
catalogs, `.ogs/runs`, logs, checkpoints, reviews, and other runtime output. Mermaid remains the
team structure import/export and prompt-reference format, not a second runtime model.

## Stable Contracts

Do not rename these framework contracts when reorganizing product code:

- `.ogs/`: framework configuration and project runtime metadata;
- `og-roles/`: role packages used by a project;
- `system.mmd`: canonical OGS structure source;
- `.ogs/runs/`: execution artifacts and recovery state.
