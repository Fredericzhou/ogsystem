# OGSystem 1.0.0 Release Acceptance

Acceptance date: 2026-10-14
Delivery: local npm tarball; no registry upload
Tarball: `.release-artifacts/ogsystem-1.0.0.tgz`
SHA-256: `9094586C442A9AB64CE2ABFAF4040B05AD916577E11BF000243B0F0BE40151B1`

## OGS Application UAT

Both end-to-end projects were executed by their generated OGS applications from their own project
directories. The Visualizer was bound to `127.0.0.1` and read the persisted run details, graph, and
role I/O through its versioned API.

| Application | Run | Result |
| --- | --- | --- |
| Multi Debate (`examples/mulit-debate-ogs`) | `20261014-175122-bd5faccf` | `done`; 5/5 transitions succeeded. Proposer fanned out to critic and optimizer, the judge received both inputs at the join, and the summary role completed. Visualizer showed 7 nodes and 8 edges; judge role I/O contained both source role IDs. |
| WeChat Mini Program Factory (`examples/wechat-miniprogram-factory`) | `20261014-182746-67d1dadf` | `done`; 7 transitions, 0 failures. `TEST_FAIL` returned to coding, the second testing round emitted `TEST_PASS`, then seal completed. OGS test report passed with 12 checks; seal manifest verified 9 files. Visualizer role I/O showed testing loop 2 and `TEST_PASS`. |

Two additional factory runs were started concurrently in the same project directory:
`20261014-214216-191f4371` and `20261014-214216-47bfab56`. Both completed with 7 successful
transitions, separate run IDs and artifact directories, passing test reports, sealed manifests, and
their own distinct request inputs. No run data was removed.

## Framework Gates

| Gate | Result |
| --- | --- |
| `pnpm test` | Passed: 606 tests, 0 failures. |
| `pnpm run test:visualizer-browser` | Passed: 18 browser tests; 1 deployment-specific test skipped by its environment guard. The targeted context-map/quorum browser test also passed. |
| `pnpm run test:examples` | Passed, including parallel/join examples, compensation routing, and all gstacklike human-review scenarios. |
| `pnpm run test:runtime-regression` | Passed: 50 tests. |
| `pnpm run test:fault-injection` | Passed: 52 tests. |
| Package policy and docs command drift | Passed: 6 package-policy checks; command drift check clean. |
| `pnpm run smoke:package-install:npm` and `pnpm run smoke:package-install:pnpm` | Passed in isolated temporary installations. Each install created a project, ran it, and started its Visualizer. |
| `pnpm run test:doctor` | `ok`; no required dependency missing. The root model catalog is stale and should be refreshed before relying on its availability list. Online provider health checks were skipped. |
| Visualizer SSE lifecycle | Covered by the full suite: 100 quick open/close cycles returned active connection gauge to zero. |

## Limits And Follow-Up

- The WeChat Developer Tools CLI is installed, but its IDE HTTP service did not respond on port
  `61002`; `preview` timed out during IDE initialization. Native IDE compilation/preview is therefore
  not claimed as passed. The OGS factory's own 12-check test report and sealed artifact did pass.
- The root model catalog is stale; run `ogs models sync` in a project before production use and run
  `ogs doctor --online-check` when provider connectivity should be included in readiness checks.
- This release acceptance is for one local operator, one local project workspace, and a Visualizer
  bound to localhost. Cross-host and multi-operator operation are outside the supported profile.
- `0.3.0` project files and run data are not migrated by this release.
