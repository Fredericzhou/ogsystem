# Installable CLI Release Notes (2026-04-20)

Status: delivered  
Scope: packaging, install workflow, project scaffolding, operator documentation

## Summary

This release turns OGSystem from a source-checkout-oriented runtime into an installable CLI package.

Primary user-facing change:

- install with `npm install -g ogsystem` or `pnpm add -g ogsystem`
- run with `ogs`, `ogs-doctor`, `ogs-nl2mmd`, `ogs-visualizer`, and `ogs-lint-system`
- create self-contained projects with `ogs project init/create`

## Delivered Changes

### 1. Published CLI packaging

- `package.json` now exposes `bin` entrypoints for installed CLI use.
- published tarballs include `dist/`, `og-roles/`, `og-models/`, `schemas/`, and helper scripts.
- repository-only `pnpm` enforcement was narrowed so published package installs no longer fail under `npm`.

### 2. Self-contained project scaffolding

- `ogs project init`
- `ogs project create <name> --template <...>`

Both commands now scaffold bundled `og-roles/` and `og-models/` into the target project.

This removes the old requirement that generated projects point back to a cloned framework repository.

### 3. Operator-facing command alignment

- runtime resume hints now print `ogs ...`
- generated `repro.sh` scripts now replay runs with `ogs ...`
- helper CLIs (`doctor`, `nl2mmd`, `visualizer`, `lint`) now have installable command names

### 4. Runtime path cleanup

- active runtime/config discovery is now `.ogs/` only
- legacy `.ogsystem/` fallback behavior was removed from active runtime loading
- version-controlled `.ogsystem/*` sample files were removed to reduce operator confusion

### 5. Documentation cleanup

Active docs now prefer installed CLI commands first and treat `pnpm run ...` as source-repository equivalents.

Updated documents:

- `README.md`
- `docs/README.md`
- `docs/usage-manual.md`
- `docs/DECISIONS.md`
- `docs/todo-backlog.md`

## Validation

Validated in this release:

- `pnpm test` passes
- `pnpm pack` produces a tarball with installed CLI entrypoints and bundled resources
- local tarball install succeeds with `npm install <tarball>`
- installed `ogs help` runs successfully after npm install
- packaged CLI smoke test scaffolds and dry-runs a generated project

## Migration Notes

- prefer `.ogs/` for runtime config, user profile, laws, and run artifacts
- stop relying on `.ogsystem/` paths in local scripts or docs
- prefer installed `ogs*` commands in operator docs, examples, and support instructions

## Follow-up Work

Remaining productization items are now operational rather than structural:

- CI install-state smoke coverage for packed artifacts
- release/version upgrade policy
- optional cross-platform single-file distribution strategy
