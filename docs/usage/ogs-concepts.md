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

## User Flow

```text
Create team -> Confirm team -> Team library -> Select team -> Project workspace -> 运行
```

- **Create team** is authoring. Natural language and guided choices are the default path; Vis is
  the optional professional path for precise graph, model, tool, context, and debugging work.
- **Confirm team** validates and confirms the static structure and supported topology. It does not
  certify that model, tool, credential, or provider services are ready to execute.
- **Project workspace** is where a user adds materials and task input. Each 运行 fixes a `RunPlan`
  and immutable input snapshots before execution.

Confirmation and run readiness are separate states. Confirmation is tied to the semantic asset
digest and becomes stale after a semantic edit. The project workspace reports static Sandbox Run
readiness blockers and warnings; it does not probe provider connectivity or credentials.
Run preparation checks the current confirmation again, so a second human confirmation step is not
required.

The product site optimizes for ordinary users and result inspection. Vis optimizes for technical
users and exposes the graph, contracts, diagnostics, and advanced runtime evidence. A link between
the two surfaces changes the view, not the execution semantics.

## Objects

```text
Team Asset  ->  Project  ->  Run
static          working       one execution
portable        resources      immutable run snapshot
```

- **Team Asset / team**: a reusable static OGS collaboration definition kept in the team library.
  “Team” is the product metaphor; graph members are Responsibility Roles, not specific people or
  separately identified agents. The asset is confirmed before it can be used, imported and exported,
  and kept free of execution history.
- **Project**: a selected team plus workspace materials, task input, and the project's run history.
- **Run / 运行**: one execution created from a confirmed project. Its `RunPlan`, task, material
  snapshots, events, checkpoints, reviews, and side-effect ledger are fixed under `.ogs/runs`.

The public portable format is `single-project-v1`. It includes static role assets and project model
selection, while excluding framework source, credentials, model catalogs, `.ogs/runs`, logs,
checkpoints, reviews, and other runtime output. Model selection identifies the configured executor;
it does not make the executor the identity of a Responsibility Role. Mermaid remains the team
structure import/export and prompt-reference format, not a second runtime model.

## Stable Contracts

Do not rename these framework contracts when reorganizing product code:

- `.ogs/`: framework configuration and project runtime metadata;
- `og-roles/`: role packages used by a project;
- `system.mmd`: canonical OGS structure source;
- `.ogs/runs/`: execution artifacts and recovery state.
