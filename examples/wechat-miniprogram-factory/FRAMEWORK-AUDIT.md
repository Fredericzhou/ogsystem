# Framework Audit

## Verified Delivery

- Run `20261014-182746-67d1dadf` completed with status `done`.
- The first test returned `EMPTY_STATE_REQUIRED`; the next coding execution recorded that it applied the feedback.
- The second test passed all 12 structural and behavior checks. The seal role wrote `shared/seal-manifest.json` with SHA-256 for the source files.
- The behavior harness exercised task completion, local storage writes, and state restoration. The source is a native WeChat Mini Program project under `shared/miniprogram/`.
- SCC layout is covered by a pure geometry test and the X6 browser scenario: the frame contains role nodes and internal edge labels, avoids input/output boundaries, and keeps group dragging functional.

## Gaps Found

### Context Maps Across Different Incoming Events

The current optional selector suffix is limited to human-review values. It cannot express an optional `direct.data.findings` field when a role receives different payload shapes on the first pass and a QA rework pass. This project maps `direct.data` into one input field and checks for `findings` locally, which works but couples the coding tool to the sender's whole payload.

Structural improvement: allow explicit optional selectors on `direct.*` and `source(role).*`. Omit an unavailable optional field, preserve fail-closed behavior for required selectors, and add tests for absent fields, null values, malformed paths, rework loops, and resume replay.

### Sealed Artifact Promotion

The workflow seals a run-scoped artifact and records its checksums, but there is no standard promotion command to publish a passing sealed directory into a project release location. Copying files by hand weakens the link between a run's test evidence and the shipped source.

Structural improvement: add a project-level promotion operation that verifies the run is done, the seal manifest is present, every listed hash matches, and the referenced test report passed before atomically exporting the artifact with its run ID and manifest. Promotion must not mutate the run snapshot.

### Platform-Specific Verification

The current test role checks valid project JSON, source structure, JavaScript behavior, and storage behavior in Node. It does not compile the WXML/WXSS through WeChat DevTools or test a real device.

Structural improvement: support an optional `exec.bind` validation profile for the installed WeChat DevTools CLI. Record tool/version/device target in test evidence; keep the deterministic Node checks as the always-available baseline.

## Scope of This Seal

The seal proves the local acceptance criteria defined in this project. It does not claim WeChat platform review, real-device compatibility, or production publication.
