# Runtime-Native Human Review

This example demonstrates the runtime-native human review path.

- Human review is declared on the role with `review.*` metadata.
- The runtime stops after the reviewed role finishes and persists a pending review request.
- Approval, rework, pause, and terminate decisions are applied through `ogs run review ...`, not by inserting a dedicated human-gate role node.

## Run

```bash
ogs run start \
  --system examples/runtime-native-human-review/system.mmd \
  --laws .ogs/laws.json \
  --input "请先产出一版方案草稿" \
  --dry-run
```

The first run stops in waiting-review state.

## Inspect Review

```bash
ogs run list
ogs run status <run-id>
ogs run review list <run-id>
ogs run review inspect <run-id> review.test-operator@1#1.r1
```

## Approve And Resume

```bash
ogs run review decide <run-id> review.test-operator@1#1.r1 --decision approve --comment "approved"
ogs run resume <run-id> --dry-run
```

## Rework

```bash
ogs run review decide <run-id> review.test-operator@1#1.r1 --decision rework --comment "请补充风险与边界条件"
ogs run resume <run-id> --dry-run
```

The rework branch can consume reviewer feedback through `global.human_review.current.*` selectors.

## Legacy Note

`examples/human-gate-workflow/` remains as a legacy compatibility example for role-node-based human gates. New systems should prefer this runtime-native review flow.
