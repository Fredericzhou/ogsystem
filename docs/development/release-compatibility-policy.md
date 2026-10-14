# Released CLI Compatibility Policy

Status: active policy for the first released CLI

This policy applies to released `ogs` packages. Version `1.0.0` is the first stable release line.

## Release Lines And Supported Versions

- A release line is identified by `MAJOR.MINOR`; patch releases within that line are compatible
  maintenance releases.
- A released CLI supports the latest two minor lines of the current major release. For example,
  when `1.3` is current, `1.3` and `1.2` are supported; all patches in those lines are included.
- A new major release ends the compatibility promise for the previous major unless its release
  notes explicitly extend support.
- The current package version, `1.0.0`, is the first stable release. The previous `0.3.0`
  development-test version is outside the compatibility window and has no migration guarantee.
- `ogs --version` reports the installed version. `ogs help compatibility` reports this policy's
  effective release status and the unsupported-input boundary.

## Compatibility Window

The window applies to project inputs that the released CLI explicitly documents as compatible:

- Patch upgrades must accept the same project configuration, schema, CLI syntax, and run artifact
  contracts as the previous patch in that release line.
- A minor upgrade may add fields, commands, or syntax. It must continue to accept inputs from the
  immediately preceding supported minor line, either directly or through a documented migration.
- A future config or schema version, an unknown version, malformed JSON, or an input from an
  unsupported release line is rejected with an actionable error. The CLI does not guess or silently
  reinterpret it.
- Run resume remains strict: the stored plan fingerprint and recovery authority must match the
  runtime contract. A released CLI must not claim cross-version resume merely because a project
  config can be read. Semantic-compatible resume is a separate product decision and implementation.

## Deprecation And Removal

When a released CLI deprecates a command, option, config field, or schema field:

1. The replacement syntax is documented in the same release that first emits the warning.
2. The warning is written to `stderr` and includes the old input, the replacement, and the planned
   removal release. Machine-readable output on `stdout` is not polluted by the warning.
3. Removal occurs no earlier than the next minor release and 90 days after the first released
   deprecation notice, whichever is later. Security or data-integrity fixes may remove an input
   sooner, but the release notes must explain the exception.
4. Help output removes deprecated syntax only after removal. Until then, help marks it as
   deprecated and points to the replacement.

The required warning shape is:

~~~text
DEPRECATION: <old syntax> is deprecated; use <replacement> instead. It will be removed in <release>.
~~~

There are no released deprecated CLI inputs in `1.0.0`, so it does not emit a compatibility warning
for historical syntax that it never promised to support.

## Config And Schema Migrations

- Every persisted config or schema contract has an explicit version field where versioning is
  required. Unsupported future versions fail closed before execution or mutation.
- Patch releases may normalize compatible representations in memory, but must not silently rewrite
  user files or run artifacts.
- A minor or major migration must be an explicit, documented operation shipped with the release
  that needs it. The migration must validate before writing, be repeatable, preserve a backup or
  recoverable original, and write atomically.
- Migration output must identify the source version, target version, changed files, and any fields
  that require operator review. A migration never upgrades a run's recovery authority by guessing.
- Version `1.0.0` does not migrate `0.3.0` development-test projects or run data. Start with a fresh
  project; keep old run directories read-only for audit. Existing version checks and strict resume
  checks remain in force.

## Development-Test Versus Released Contract

The `0.3.0` development-test to `1.0.0` release boundary is intentionally explicit:

- The `0.3.0` build may have different CLI syntax, config/schema versions, generated project files,
  runtime artifacts, and Semantic IR v1 behavior from `1.0.0`.
- Version `1.0.0` fails closed for unsupported versions and resume fingerprint drift. Users should
  create a fresh project and run rather than assume migration is available.
- A released CLI may promise only the supported release lines and migration paths published with
  that release. Tests against `main` or `dist/` are development regression tests, not evidence of
  a released compatibility guarantee.
- README, the usage manual, this policy, and `ogs help compatibility` must be updated together when
  the release posture or compatibility boundary changes.

## CLI Summary

The installed CLI exposes the same short summary through `ogs help compatibility`:

~~~text
Released support: latest two minor lines of the current major release; all patches in those lines.
Current package: 1.0.0 released; no migration from 0.3.0 development-test projects or run data.
Unsupported inputs: future/unknown config or schema versions, malformed inputs, unsupported release
lines, and resume artifacts whose plan fingerprint or recovery authority does not match.
Deprecation warnings name the replacement and planned removal release; removal is at least one minor
release and 90 days after notice, whichever is later.
~~~
