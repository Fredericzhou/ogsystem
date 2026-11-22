# V2 Four-Team Coverage Engineering Evidence

Status: engineering evidence captured from the running Team Site on 2026-11-19. This record
does not close Release UAT scenario 18, replace desktop/mobile review, or provide workflow-operator
and product-owner sign-off.

## Scope

The four built-in TeamVersions each have a completed required Studio Sandbox baseline and a
completed formal Project/Task/Run path with a published Project Release. The records below were
read through the Team Site `/api/v2` boundary. The IDs and digests are retained so the evidence can
be independently re-read from the corresponding API resources.

## TeamVersion Baselines

| TeamVersion | Baseline scenario | Simulation | Baseline digest | Readiness |
| --- | --- | --- | --- | --- |
| `new-team-1bd7e229` | `classic-management-consulting`, revision 1 | `81b9ed54-d664-42c8-913e-8011046e0d88` | `c9b24453a09d8bbdd357b8cc602ddfab5db1716ed93e16076abcd47facf48bf6` | `ready: true`, `proof: baseline-sandbox` |
| `new-team-0b2feb81` | `classic-structured-debate`, revision 1 | `7bcf57ef-a329-436e-a715-7c2d0c3c14e6` | `fb963f8363b07667086e3a467ff23e2b59abdc616854b026bc592d708ae54103` | `ready: true`, `proof: baseline-sandbox` |
| `new-team-16ecab51` | `classic-cross-backend-review-loop`, revision 1 | `60f10475-d717-48eb-8641-b3fcdfc4fe17` | `599fb09b225bbdb91d3c06e339f8fe2cf0865e24635b355b60fda339de5b5e92` | `ready: true`, `proof: baseline-sandbox` |
| `new-team-6258e432` | `classic-software-team`, revision 1 | `6a004afd-e35d-40fb-a1ec-f72395c9c7f1` | `e5ae31030548bcb5ed7b094b879b10c281f564bec64eafb1332b551166b381f0` | `ready: true`, `proof: baseline-sandbox` |

All four baseline simulations returned `status: completed` and the expected Role set for their
scenario. The TeamVersion readiness responses returned `requiredScenarioCount: 1` and the same
TeamVersion core digest and digest version as the baseline records.

## Formal Project Runs and Releases

| TeamVersion | Project | Workspace | Task | Run | Release |
| --- | --- | --- | --- | --- | --- |
| `new-team-1bd7e229` | `v2-formal-management-consulting-20261119-78d35786` | `workspace-9bcd84f8da69c9222b972d78` | `20261119-093300-e3fd2cf9` | `20261119-093344-c9ee996e` | `release-20261119-093344-c9ee996e` (`published`) |
| `new-team-0b2feb81` | `v2-uat-structured-debate-1795057638883-d38a811b` | `workspace-fb33cc9d27c8c4f2d9d4e18f` | `20261119-110721-fd7ec183` | `20261119-110752-a8fabc5d` | `release-20261119-110752-a8fabc5d` (`published`) |
| `new-team-16ecab51` | `v2-formal-cross-backend-fixed2-mwmxgszv-6ac9440c` | `workspace-6d0ccc5af3c810e357dfb4ce` | `20261119-102515-00e92ec2` | `20261119-102515-dc926bb5` | `release-20261119-102515-dc926bb5` (`published`) |
| `new-team-6258e432` | `v2-formal-software-uat-20261119-21e3cdd3` | `workspace-cf790c71701caa8970e885e1` | `20261119-084808-b24517ed` | `20261119-084816-966ecb55` | `release-20261119-084816-966ecb55` (`published`) |

Each formal record reported `Task.status = completed`, `Run.status = completed`, and a Release
with `status = published`, `failureCode = null`, a materialization manifest digest, an output
digest, and a project download reference. The four Projects use distinct Project Workspaces, as
required by the Project boundary; this table is not evidence that a Workspace is shared across
Projects.

## Evidence Boundary

This record demonstrates engineering coverage and API persistence only. It does not prove the
manual scenario requirements for desktop/mobile captures, refresh comparison, Debug History review,
accessibility, Windows, or operator/product-owner sign-off. Release UAT scenario 18 therefore
remains `Not run` until the responsible reviewers inspect this ledger and attach their signatures.

## Live Revalidation

Read-only revalidation against the running Team Site on 2026-11-19T06:45Z confirmed that all four
listed baseline Simulation IDs remain present under their recorded TeamVersions, and all four
selected Project/Task/Run/Release records remain readable through `/api/v2`. Each selected Task and
Run is still `completed`; each selected Release is still `published` with the recorded Workspace ID.

The four Project Workspaces also remain distinct. Local checks found clean Git working trees and
`git lfs fsck` passed for each one. Their current canonical HEADs are:

| Team | Workspace | Current HEAD |
| --- | --- | --- |
| Management consulting | `workspace-9bcd84f8da69c9222b972d78` | `6774ca3a7a8d741572912f24f7683f33186ac77f` |
| Structured debate | `workspace-fb33cc9d27c8c4f2d9d4e18f` | `a053a58fb2bd4446441f3b70524ce7e30e68753d` |
| Cross-backend review | `workspace-6d0ccc5af3c810e357dfb4ce` | `5bdec59303ab20aa33d8caeaf9de315c3c3c02d5` |
| Software | `workspace-cf790c71701caa8970e885e1` | `bb4dc4b0ac6418920131057e4ae552546ede88bc` |

The debate Project now also contains a second completed Task/Run with a published Release, and the
software Project contains two additional completed Task/Runs and a second published Release beyond
the selected row above. The coverage matrix intentionally retains the original selected Run for
each team; these newer records are additional live history, not substitutions for the operator
review and sign-off required by Scenario 18.
