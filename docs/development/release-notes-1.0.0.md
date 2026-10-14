# OGSystem 1.0.0

`1.0.0` is the first stable release of the single-machine OGSystem runtime. This internal delivery
is a versioned npm tarball and is not published to a registry.

## Supported operating shape

- One local project directory and one operator.
- Run one active workflow at a time for the supported production profile. Separate run directories
  are isolated; resuming the same run concurrently is rejected by the run lock.
- Bind the Visualizer to `127.0.0.1` or `localhost`. Remote binding requires an identity provider
  and is outside this release's deployment profile.
- Node.js 20 or later. Workflow backends and credentials are managed by their own installed CLI.
- Run state and audit evidence are file based. Back up the project, `.ogs/`, and promoted output as
  one unit. Retention does not remove complete run directories.

## Compatibility boundary

The release uses Semantic IR v1 and the current versioned runtime contracts. It does not migrate
`0.3.0` development-test projects, configurations, schemas, or run directories. Create a fresh
project and new runs; retain old run data read-only when audit history is needed. Resume remains
strict about plan fingerprints and recovery authority.

## Delivery checks

The release gate includes build and unit tests, runtime fault and recovery tests, Visualizer browser
and API checks, the Multi Debate and mini-program factory UAT workflows, a same-tarball isolated
install, and repeated-run / Visualizer stream cleanup checks. See
[release-acceptance-1.0.0.md](release-acceptance-1.0.0.md) for exact commands and results.

## Not included

Cross-host execution, multiple operators, shared network storage, automatic run-directory garbage
collection, and migration of development-test artifacts are not supported by this release.
