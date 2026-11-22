# V2 Team Role Contract Training Gate

Status: engineering and browser evidence only. This record is not a workflow-operator or Product
Owner content review, does not train a TeamVersion, and does not close a UAT scenario.

## Scope

- Prevent training a TeamVersion whose Role Contracts omit responsibility, required input, or output
  semantics.
- Give readiness and Studio users the specific blocker instead of reporting a generic training state.
- Ensure built-in Team templates materialize valid V2 Role Contract records.

## Engineering Evidence

- Training runs every Role Contract through the Runtime Role Package validator, then rejects a Team
  Package when any Role Contract lacks responsibility ownership or contribution, input preconditions,
  or output postconditions/decision criteria. Malformed condition ASTs fail closed.
- Training readiness reports `roleContractReady` and per-Role `roleContractIssues` separately from
  Sandbox baseline and human accuracy review state.
- Runtime confirmation now revalidates the same Role Contracts for persisted `trained` and
  `archived` TeamVersions before Project mounting or Task execution. Legacy versions with empty or
  malformed contracts fail closed and must be replaced by a newly trained version.
- The four built-in cases materialize non-empty responsibility, input, and output contracts for
  every Role. Generated manifests pass the Runtime `validateRolePackageManifest` validator.
- Focused tests: `classic-case-v2.test.mjs` and `team-accuracy-gate.test.mjs`, 9/9 passed.
- The stability boundary regression also covers a legacy trained version with an incomplete Role
  Contract and rejects it before execution.
- `pnpm build` passed; `node --check` and `git diff --check` passed.

## Browser Evidence

- Isolated Team Site: `http://127.0.0.1:4206`, backed by `/tmp/ogs-team-accuracy-uat-20261121`.
- View: `/studio/teams/new-team-d81fab2d/train`, management consulting draft, 390 x 844 viewport.
- API readiness identified the correct state: Role Contracts ready, Sandbox baseline incomplete, no
  accuracy review, training blocked.
- The page showed the missing Sandbox baseline as the blocker and kept the Train button disabled.
- Document body width matched the 390px viewport; no browser console or page errors were observed.
- Temporary built-in TeamVersion IDs: software `new-team-af8cc220`, debate
  `new-team-67def0cb`, management consulting `new-team-d81fab2d`, cross-backend
  `new-team-b69cb4e4`. All remained drafts in the isolated project store.

## Limits And Follow-up

The machine checks establish that each Role declares an output contribution, requires its projected
input object, and returns an output object. They cannot determine whether the chosen team, role
boundaries, assumptions, analysis, or collaboration output is correct for a business objective.
Those require review of representative Sandbox runs against the target workflow, with accountable
workflow-operator and Product Owner sign-off. No Sandbox run was performed in this isolated browser
check. Existing TeamVersions with empty Role Contracts remain blocked until corrected, re-digested,
and run through a fresh baseline and accuracy review.
