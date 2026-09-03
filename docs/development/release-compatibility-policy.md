# Released CLI Compatibility Policy

Status: active policy for the first released CLI

This policy applies to released `ogs` packages. It does not turn the current development-test
build into a stable compatibility promise.

## Release Lines And Supported Versions

- A release line is identified by `MAJOR.MINOR`; patch releases within that line are compatible
  maintenance releases.
- A released CLI supports the latest two minor lines of the current major release. For example,
  when `1.3` is current, `1.3` and `1.2` are supported; all patches in those lines are included.
- A new major release ends the compatibility promise for the previous major unless its release
  notes explicitly extend support.
- The current package version, `0.3.0`, is a development-test release. There is no stable release
  line yet, and `0.3.0` is outside the released compatibility window.
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

There are no released deprecated CLI inputs in the current `0.3.0` development-test build, so it
does not emit a compatibility warning for historical syntax that it never promised to support.

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
- The current development-test CLI has no released migration command and provides no historical DSL,
  API, config, schema, or run-data migration guarantee. Existing version checks and strict resume
  checks remain implementation behavior, not a stable cross-release promise.

## Development-Test Versus Released Contract

The current `vNext-dev` / `0.3.0` boundary is intentionally explicit:

- Development-test builds may change CLI syntax, config/schema versions, generated project files,
  runtime artifacts, and Semantic IR v1 behavior between development changes.
- Development-test builds fail closed for unsupported versions and resume fingerprint drift; users
  should recreate a project or run rather than assume migration is available.
- A released CLI may promise only the supported release lines and migration paths published with
  that release. Tests against `main` or `dist/` are development regression tests, not evidence of
  a released compatibility guarantee.
- README, the usage manual, this policy, and `ogs help compatibility` must be updated together when
  the release posture or compatibility boundary changes.

## CLI Summary

The installed CLI exposes the same short summary through `ogs help compatibility`:

~~~text
Released support: latest two minor lines of the current major release; all patches in those lines.
Current package: 0.3.0 development-test; no stable release line or historical migration guarantee.
Unsupported inputs: future/unknown config or schema versions, malformed inputs, unsupported release
lines, and resume artifacts whose plan fingerprint or recovery authority does not match.
Deprecation warnings name the replacement and planned removal release; removal is at least one minor
release and 90 days after notice, whichever is later.
~~~
