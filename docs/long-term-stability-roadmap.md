# OGSystem Long-Term Stability Roadmap

Date: 2026-04-10
Status: active planning

## 1. Summary

Current state: OGSystem has a solid runnable runtime core, but is not yet at long-term product stability level.

Main gap: not feature completeness, but reliability system completeness:

- SLO/SLA and error governance
- observability and run-time diagnostics
- release gate and compatibility policy
- recovery drills and operability

## 2. P0 Must-Do (2-4 weeks)

1. Define SLO/SLA
- success rate
- P95/P99 latency
- timeout ratio
- resume success ratio
- session reuse ratio

2. Introduce typed error model
- unify error categories and codes
- replace free-form runtime-only strings where possible
- make errors monitorable and alertable

3. Harden model output policy
- structured-output fallback path
- bounded corrective retry policy
- timeout fallback and terminal failure snapshots

4. Complete recovery consistency
- enforce `state.json.graphState` + `sessions.json` consistency checks
- guarantee resume idempotency
- prevent duplicate execution on resume

5. Minimum observability baseline
- run-level metrics
- role-level metrics
- structured logs with stable fields
- key lifecycle events

6. Release gate
- build + test + regression examples + doctor preflight required before release

7. Config compatibility strategy
- config versioning
- migration script/check
- deprecation window policy

## 3. P1 Stability Operations (1-2 quarters)

1. Fault-injection test set
- timeout
- flaky upstream/provider
- missing structured output
- malformed JSON
- file-system partial failure

2. Long-running regression suite
- deterministic fixtures
- resume/retry path coverage
- scheduled daily/weekly run

3. Capacity and performance baselines
- max concurrent runs
- branch fan-out limits
- write amplification and disk growth
- CPU/memory profile under load

4. Artifact lifecycle policy
- retention window
- cleanup and archive jobs
- audit preservation policy

5. Security baseline
- secrets handling
- least-privilege runtime
- command/tool allow-list
- sensitive data redaction

6. Runtime progress visualization
- terminal watch mode
- lightweight timeline UI from run artifacts

7. Stable API/CLI contract
- versioned input/output contract
- compatibility regression tests

## 4. P2 Productization and Team Process

1. Release management
- semantic versioning
- changelog
- upgrade guide
- rollback playbook

2. Operations playbook
- on-call SOP
- incident response
- recovery procedure
- regular recovery drills

3. Quality governance
- defect severity policy
- RCA template
- reliability weekly report

4. Model governance
- model version pinning
- staged rollout
- fallback switch
- cost/quality dashboard

5. Multi-environment standardization
- dev/staging/prod isolation
- baseline config templates
- environment parity checks

## 5. Top 3 Priorities Right Now

1. Turn structured-output failures and timeouts into fully controlled policies.
2. Turn resume capability into measurable reliability (with drills, not only code support).
3. Turn runnable runtime into releasable product (gates + observability + operability).

## 6. Suggested 30/60/90-Day Milestones

### Day 0-30

- SLO draft and initial dashboards
- error code taxonomy v1
- release gate in CI
- resume consistency checks + tests

### Day 31-60

- fault injection suite v1
- artifact retention and cleanup job
- terminal watch command
- on-call/runbook first version

### Day 61-90

- staging reliability drill cadence
- model rollout and rollback policy
- compatibility matrix and upgrade guide
- product-level readiness review
