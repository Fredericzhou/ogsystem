# V2 No-Content-Change Release Lock/CAS Audit

> Evidence type: contract and implementation regression audit. This does not close Release UAT
> Scenario 19.

## Finding

The Workspace contract ties `ref_updated` and `published` to the canonical-ref compare-and-swap under
the canonical lock. A Release whose `releaseCommit` already equals `expectedCanonicalHead` still needs
that guarded boundary even though the ref value does not change. The previous coordinator path treated
this case as reconciliation and skipped the lock and CAS. The design also described reconciliation as
retrying a CAS, while the implementation correctly rejects CAS from reconciliation.

## Resolution

- Normal no-content-change Releases now acquire the canonical lock and perform a same-value guarded
  Git ref update before recording `ref_updated` and `published`.
- The post-CAS recovery branch is limited to a canonical head at `releaseCommit` that differs from the
  expected old head. Reconciliation does not perform a CAS when the canonical head remains unchanged.
- The canonical checkout is not reset when the old and new commits are identical, preserving local
  untracked files during a no-content-change Release.
- The machine contract explicitly defines the same-value CAS rule. The design now directs an unchanged
  expected head to resume normal Release processing rather than reconciliation.

## Verification

- `pnpm build` passed.
- `node --test tests/workspace-contracts.test.mjs tests/workspace-coordinator.test.mjs` passed: 27/27.
- The no-content-change Release regression asserts one lock claim, one guarded ref update, publication,
  and preservation of an untracked local file.
- `pnpm test` passed with exit code 0; Team Site reported 73/73.
- `pnpm run test:docs-command-drift` and `git diff --check` passed.

Scenario 19 remains open. Deterministic coordinator tests do not replace its Project/Task/Run fault
companions, recovery evidence, operator review, or product-owner sign-off.
