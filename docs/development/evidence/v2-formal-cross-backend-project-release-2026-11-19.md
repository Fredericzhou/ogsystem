# V2 Formal Cross-Backend Project Release Evidence

Status: engineering evidence only. This record does not replace browser refresh review,
workflow-operator or product-owner sign-off, and does not close the four-team UAT row by itself.

## Execution Identity

- Project: `v2-formal-cross-backend-fixed2-mwmxgszv-6ac9440c`
- Project Workspace: `workspace-6d0ccc5af3c810e357dfb4ce` (`git-lfs`)
- Task: `20261119-102515-00e92ec2`
- Run: `20261119-102515-dc926bb5`
- TeamVersion: `new-team-16ecab51` (cross-backend review loop)
- Team core digest: `9d22e3d59de0ba372237774584630fcd36c0b1942ec60c97b476b1c05231b340`
- Mode: real `sandbox`; final Task and Run status: `completed`

## Backend and Workflow Evidence

- The Run plan records two Backend bindings: `codex` and `opencode`.
- Planner audit: Backend `codex`, model `gpt-6-luna`, status `ok`, selected event `READY`.
- Implementer audit: Backend `opencode`, model `codex-gateway/gpt-6-luna`, status `ok`, selected
  event `READY`, output `CROSS_BACKEND_HANDOFF_OK`.
- The Run summary records 2 transitions, 2 successful Role executions, 0 failures, 0 no-op
  executions, and no pending human review.
- The Planner Role commit recorded this immutable `WorkspaceRef`:

  ```json
  {
    "ogsContractVersion": 2,
    "schemaVersion": 1,
    "workspaceId": "workspace-6d0ccc5af3c810e357dfb4ce",
    "commit": "f1a9554f057ee34d5394e62707b4ce3ec2b53485",
    "path": "cross-backend-review.md",
    "digest": "sha256:f4736ad00d8f120a268c729ff51b9a6962f65a855d982682d3b9d8d16419e4e4"
  }
  ```

- Planner result commit: `f1a9554f057ee34d5394e62707b4ce3ec2b53485`, changed path
  `cross-backend-review.md`.
- Implementer result commit reused the base commit `492f8e42b647a879a908e6ddea933f3599d11fd7`
  with `changedPaths: []`.
- Final merge and canonical Workspace integration both verified clean at
  `5bdec59303ab20aa33d8caeaf9de315c3c3c02d5`; the final candidate set contains only the Planner
  commit, so the serial no-content-change Implementer cannot displace the file.
- The Run event read contained 229 durable event positions. Backend startup, Role result,
  Workspace integration, and commit provenance records were present; model transport events are
  not used as business evidence.

## Published Release

- Release: `release-20261119-102515-dc926bb5`, status `published`
- `releaseCommit`: `5bdec59303ab20aa33d8caeaf9de315c3c3c02d5`
- `expectedCanonicalHead`: `492f8e42b647a879a908e6ddea933f3599d11fd7`
- Materialization manifest digest: `sha256:5b2c533dfeff31b907f7e24f2f6c9d1ad61790e40f9deec34193cfb70f50121b`
- Output digest: `sha256:6e174d12318a96321bae92cc13191c341e8480893a91b2f3b9ea8a28f61ae4d1`
- Materialized files: `.gitattributes`, `cross-backend-review.md`, `workspace/index.json`
- Download reference: `project://v2-formal-cross-backend-fixed2-mwmxgszv-6ac9440c/runs/20261119-102515-dc926bb5/release`

The Project Task, Run, event, result, Release, and Release-file reads were performed through the
Team Site `/api/v2` boundary. The prior failed Run `20261119-094113-5cbcad4e` and the earlier
successful-but-incomplete Release remain historical diagnostic evidence and are not replaced by
this successful Run.

This is a successful final-contract engineering Project Release path. The four-team engineering
ledger also records formal Project Runs for all built-in teams. Human review, browser refresh
comparison, review of the four-team ledger, and the remaining companion-run acceptance requirements
remain open.
