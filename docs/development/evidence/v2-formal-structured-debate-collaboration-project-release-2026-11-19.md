# V2 Formal Structured Debate Collaboration Project Evidence

Status: engineering evidence only. This record does not replace browser Debug History and
refresh captures, workflow-operator or product-owner review, or the four-team UAT ledger.

## Execution identity

- Project: `v2-uat-structured-debate-1795057638883-d38a811b`
- Project Workspace: `workspace-fb33cc9d27c8c4f2d9d4e18f` (`git-lfs`)
- Task: `20261119-110721-fd7ec183`
- Run: `20261119-110752-a8fabc5d`
- TeamVersion: `new-team-0b2feb81` (structured debate)
- Mode: `sandbox`; final Task status: `completed`
- Project digest: `7b82c6f083758c515de583120f55315b9e35fc214b4bc5222c33fd58a114c3fb`
- Team core digest: `69c6b91e1274fdd1795ec3b5b5fad835ab6983ab8fbd9588753bc98b55785d9f`

## Runtime and Workspace evidence

- The Run completed with 54 public event records and a final event cursor of `2997`.
- The event set contains `role.started`, `role.input_ready`, `result_committed`,
  `join_activated`, `flow.activated`, and `workspace_integrated` records.
- Two branch rounds executed. The second round returned through `neutral-judge` after a
  `NEEDS_REWORK` decision from the first round.
- Both rounds recorded a `join_activated` event with `joinMode=all_of`,
  `requiredSourceCount=2`, and `satisfiedSources=["proponent","opponent"]`.
- The final Task output explicitly records the quorum result, the rework loop, evidence gaps,
  and a decision to hold the brief as an internal draft rather than recommend publication.

## Published Release

- Release: `release-20261119-110752-a8fabc5d`, status `published`
- `releaseCommit`: `304a42b702aaa7eface8b3d7e4f3e588dd36e6d0`
- `expectedCanonicalHead`: `b4c521be1122d184e4328096980d60f49b57f6bd`
- Materialization manifest digest: `sha256:83e370c3a904d204d33774d3f368b8c4d9c8308c331dc287169f75713a86832`
- Output digest: `sha256:0faf9b92e1b1c384fd323d4116e33c1b29b40a5fa6e41e0030f37e34cc3ab2ca`
- Download reference: `project://v2-uat-structured-debate-1795057638883-d38a811b/runs/20261119-110752-a8fabc5d/release`
- Materialized files: `.gitattributes`, `debate-brief.md`, and `workspace/index.json`.
- `debate-brief.md` is 1,932 bytes with digest
  `sha256:9de1dd08177c296d72fc8e092b062219f8adba41308aadb9b90dd8ca004dbfb1`.

This proves a real structured-debate Collaboration Project path and its Workspace Release
materialization. A subsequent Run in this same Project, recorded below, supplies the binary/media
Git LFS evidence. The four-team engineering ledger also records the required formal Project paths.
This record does not close the Debug History, browser refresh, ledger review, or sign-off requirements.

## Binary and Git LFS companion Run

The same Project then received a real PNG through the Project Materials API and ran a second
Sandbox Task:

- Material: `workspace/files/c39f0437-e244-42c4-a390-b524c379520e/fixtures/debate-fixture.png`
- Material SHA-256: `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`
- Task: `20261119-111830-dbebda01`
- Run: `20261119-111908-9ba238d1`; final status: `completed`
- Release: `release-20261119-111908-9ba238d1`; status: `published`
- `releaseCommit`: `a053a58fb2bd4446441f3b70524ce7e30e68753d`
- Materialization manifest digest: `sha256:557a385950d8e64ce6fffb80fc55852a4b111056d3f00c5c2fd2052e91826a7d`
- Output digest: `sha256:f7d4eb624383533b07725174f076cc007b88071929979942b156886cf7428e7d`
- LFS manifest entry: `sizeBytes=68`, `digest=sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`,
  `lfsObjectId=sha256:431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`
- Second Run event read returned 50 records and final cursor `1719`, including `join_activated`,
  `workspace_integrated`, and the two branch rounds.

This is real Git LFS and Release evidence for the Project. It is still engineering evidence until
the required browser captures and responsible-person sign-offs are recorded.
