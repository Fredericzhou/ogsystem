#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PROJECT_DIR}/../.." && pwd)"
INPUT_TEXT="构建一个html页面，要求显示hello world"

cli() {
  pnpm --dir "$REPO_ROOT" exec tsx src/runtime/cli.ts "$@"
}

json_eval_stdin() {
  local expr="$1"
  node --input-type=module -e '
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const data = JSON.parse(chunks.join(""));
    const expr = process.argv[1];
    const ok = Function("data", `return (${expr});`)(data);
    if (!ok) process.exit(1);
  ' "$expr"
}

json_eval_file() {
  local path="$1"
  local expr="$2"
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const data = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const expr = process.argv[2];
    const ok = Function("data", `return (${expr});`)(data);
    if (!ok) process.exit(1);
  ' "$path" "$expr"
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing required command: $command_name" >&2
    return 1
  fi
}

extract_run_id() {
  local output="$1"
  printf '%s\n' "$output" | sed -n 's/^\[run:start\] run=\([^ ]*\) .*/\1/p' | tail -n 1
}

run_start_case() {
  local title="$1"
  local system_path="$2"

  echo
  echo "==> ${title}"

  local output
  output="$(cli run start --system "$system_path" --input "$INPUT_TEXT" --workdir "$PROJECT_DIR" 2>&1)"
  printf '%s\n' "$output"

  local run_id
  run_id="$(extract_run_id "$output")"
  if [[ -z "$run_id" ]]; then
    echo "failed to extract run id from CLI output" >&2
    return 1
  fi

  printf '%s\n' "$run_id"
}

review_id_for() {
  local run_id="$1"
  cli run review list "$run_id" --workdir "$PROJECT_DIR" | node --input-type=module -e '
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const data = JSON.parse(chunks.join(""));
    process.stdout.write(`${data.reviews[0].reviewId}\n`);
  '
}

pending_review_id_for() {
  local run_id="$1"
  cli run status "$run_id" --workdir "$PROJECT_DIR" | node --input-type=module -e '
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const data = JSON.parse(chunks.join(""));
    if (typeof data.latestPendingReviewId !== "string") process.exit(1);
    process.stdout.write(`${data.latestPendingReviewId}\n`);
  '
}

run_dir_for() {
  local run_id="$1"
  printf '%s\n' "${PROJECT_DIR}/.ogs/runs/${run_id}"
}

request_path_for() {
  local run_id="$1"
  local review_id="$2"
  printf '%s/control/reviews/%s.request.json\n' "$(run_dir_for "$run_id")" "$review_id"
}

decision_path_for() {
  local run_id="$1"
  local review_id="$2"
  printf '%s/control/reviews/%s.decision.json\n' "$(run_dir_for "$run_id")" "$review_id"
}

assert_file_exists() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "expected file not found: $path" >&2
    return 1
  fi
}

assert_file_absent() {
  local path="$1"
  if [[ -e "$path" ]]; then
    echo "unexpected artifact exists: $path" >&2
    return 1
  fi
}

assert_file_contains() {
  local path="$1"
  local pattern="$2"
  if ! rg -q "$pattern" "$path"; then
    echo "expected pattern not found in $path: $pattern" >&2
    return 1
  fi
}

assert_file_not_contains() {
  local path="$1"
  local pattern="$2"
  if rg -q "$pattern" "$path"; then
    echo "unexpected pattern found in $path: $pattern" >&2
    return 1
  fi
}

assert_status() {
  local run_id="$1"
  local expr="$2"
  local json
  json="$(cli run status "$run_id" --workdir "$PROJECT_DIR")"
  printf '%s\n' "$json" | json_eval_stdin "$expr"
}

assert_review_inspect() {
  local run_id="$1"
  local review_id="$2"
  local expr="$3"
  local json
  json="$(cli run review inspect "$run_id" "$review_id" --workdir "$PROJECT_DIR")"
  printf '%s\n' "$json" | json_eval_stdin "$expr"
}

assert_decision_applied() {
  local run_id="$1"
  local review_id="$2"
  json_eval_file \
    "$(decision_path_for "$run_id" "$review_id")" \
    'typeof data.checkpointSequence === "number" &&
      data.checkpointSequence >= 1 &&
      typeof data.appliedAt === "string" &&
      typeof data.reconciledAt === "string"'
}

assert_state_error() {
  local run_id="$1"
  local expected="$2"
  node --input-type=module -e '
    import { readFileSync } from "node:fs";
    const data = JSON.parse(readFileSync(process.argv[1], "utf8"));
    const expected = process.argv[2];
    if (data.graphState.error !== expected) process.exit(1);
  ' "$(run_dir_for "$run_id")/state.json" "$expected"
}

assert_summary_failed_count() {
  local run_id="$1"
  local minimum="$2"
  json_eval_file \
    "$(run_dir_for "$run_id")/summary.json" \
    "data.failedCount >= ${minimum}"
}

assert_role_execution_failed() {
  local run_id="$1"
  local role_id="$2"
  local matched
  matched="$(find "$(run_dir_for "$run_id")/roles/${role_id}/executions" -name execution-outcome.json -print 2>/dev/null | head -n 1)"
  if [[ -z "$matched" ]]; then
    echo "missing execution-outcome.json for role ${role_id}" >&2
    return 1
  fi
  json_eval_file "$matched" 'data.status === "failed"'
}

assert_role_execution_exists() {
  local run_id="$1"
  local role_id="$2"
  if ! find "$(run_dir_for "$run_id")/roles/${role_id}/executions" -mindepth 1 -maxdepth 1 -type d | rg -q .; then
    echo "missing executions for role ${role_id}" >&2
    return 1
  fi
}

require_command rg
require_command pnpm

happy_run_id="$(
  run_start_case \
    "Happy path enters waiting review" \
    "${PROJECT_DIR}/system.mmd" \
    | tail -n 1
)"
happy_review_id="$(review_id_for "$happy_run_id")"
happy_run_dir="$(run_dir_for "$happy_run_id")"

assert_status "$happy_run_id" 'data.status === "stopped" && data.pendingReviewCount === 1 && data.hasWaitingHumanReview === true && data.latestPendingReviewId === "review.ship@1#4.r1"'
assert_file_exists "$(request_path_for "$happy_run_id" "$happy_review_id")"
assert_review_inspect "$happy_run_id" "$happy_review_id" 'data.currentStatus === "pending" && data.currentState.status === "pending" && data.requestSnapshot.selectedEvent === "READY_TO_DEPLOY"'
assert_file_absent "${happy_run_dir}/shared/index.html"

cli run review decide "$happy_run_id" "$happy_review_id" \
  --decision approve \
  --comment "approved" \
  --actor reviewer \
  --workdir "$PROJECT_DIR" >/dev/null
cli run resume "$happy_run_id" --workdir "$PROJECT_DIR" >/dev/null

assert_status "$happy_run_id" 'data.status === "done" && data.pendingReviewCount === 0 && data.hasWaitingHumanReview === false && data.latestPendingReviewId === undefined'
assert_review_inspect "$happy_run_id" "$happy_review_id" 'data.decisionSnapshot.decision === "approve" && data.currentStatus === "resolved" && data.currentState.status === "resolved"'
assert_decision_applied "$happy_run_id" "$happy_review_id"
assert_file_exists "${happy_run_dir}/shared/index.html"
assert_file_contains "${happy_run_dir}/shared/index.html" '<h1>hello world</h1>'
assert_file_not_contains "${happy_run_dir}/shared/index.html" 'You are Ship Deploy'
assert_file_not_contains "${happy_run_dir}/shared/index.html" 'Allowed events'
assert_file_not_contains "${happy_run_dir}/shared/index.html" 'Input:'
json_eval_file \
  "${happy_run_dir}/roles/ship/result.json" \
  'typeof data.data.releaseCandidate === "object" && typeof data.data.deploy === "object"'
json_eval_file \
  "${happy_run_dir}/roles/retro/result.json" \
  'typeof data.data.retrospective === "object"'
json_eval_file \
  "${happy_run_dir}/roles/learn/result.json" \
  'typeof data.data.lessons === "object"'

rework_run_id="$(
  run_start_case \
    "Rework feedback projection" \
    "${PROJECT_DIR}/scenarios/approval-rework.mmd" \
    | tail -n 1
)"
rework_review_id="$(review_id_for "$rework_run_id")"
rework_run_dir="$(run_dir_for "$rework_run_id")"

assert_status "$rework_run_id" 'data.status === "stopped" && data.pendingReviewCount === 1 && data.hasWaitingHumanReview === true && data.latestPendingReviewId === "review.ship@1#4.r1"'
assert_review_inspect "$rework_run_id" "$rework_review_id" 'data.currentStatus === "pending" && data.currentState.status === "pending"'

cli run review decide "$rework_run_id" "$rework_review_id" \
  --decision rework \
  --comment "请补充风险与边界条件" \
  --actor reviewer \
  --workdir "$PROJECT_DIR" >/dev/null
cli run resume "$rework_run_id" --workdir "$PROJECT_DIR" >/dev/null

assert_status "$rework_run_id" 'data.status === "stopped" && data.pendingReviewCount === 1 && data.hasWaitingHumanReview === true && data.latestPendingReviewId !== "review.ship@1#4.r1"'
assert_review_inspect "$rework_run_id" "$rework_review_id" 'data.decisionSnapshot.decision === "rework" && data.currentStatus === "resolved" && data.currentState.status === "resolved" && data.requestSnapshot.status === "pending"'
assert_decision_applied "$rework_run_id" "$rework_review_id"
assert_file_absent "${rework_run_dir}/shared/index.html"
assert_file_contains "${rework_run_dir}/roles/ship/inbox.md" '请补充风险与边界条件'
assert_file_contains "${rework_run_dir}/roles/ship/inbox.md" 'human_review_round'

rework_followup_review_id="$(pending_review_id_for "$rework_run_id")"
cli run review decide "$rework_run_id" "$rework_followup_review_id" \
  --decision approve \
  --comment "rework approved" \
  --actor reviewer \
  --workdir "$PROJECT_DIR" >/dev/null
cli run resume "$rework_run_id" --workdir "$PROJECT_DIR" >/dev/null

assert_status "$rework_run_id" 'data.status === "done" && data.pendingReviewCount === 0 && data.hasWaitingHumanReview === false && data.latestPendingReviewId === undefined'
assert_review_inspect "$rework_run_id" "$rework_followup_review_id" 'data.decisionSnapshot.decision === "approve" && data.currentStatus === "resolved" && data.currentState.status === "resolved"'
assert_decision_applied "$rework_run_id" "$rework_followup_review_id"

pause_run_id="$(
  run_start_case \
    "Pause keeps run waiting review" \
    "${PROJECT_DIR}/scenarios/review-pause.mmd" \
    | tail -n 1
)"
pause_review_id="$(review_id_for "$pause_run_id")"
pause_run_dir="$(run_dir_for "$pause_run_id")"

cli run review decide "$pause_run_id" "$pause_review_id" \
  --decision pause \
  --comment "hold" \
  --actor reviewer \
  --workdir "$PROJECT_DIR" >/dev/null
cli run resume "$pause_run_id" --workdir "$PROJECT_DIR" >/dev/null

assert_status "$pause_run_id" 'data.status === "stopped" && data.pendingReviewCount === 1 && data.hasWaitingHumanReview === true && data.latestPendingReviewId === "review.ship@1#4.r1"'
assert_review_inspect "$pause_run_id" "$pause_review_id" 'data.decisionSnapshot.decision === "pause" && data.currentStatus === "paused" && data.currentState.status === "paused"'
assert_decision_applied "$pause_run_id" "$pause_review_id"
assert_file_absent "${pause_run_dir}/shared/index.html"

terminate_run_id="$(
  run_start_case \
    "Terminate(run) maps to stopped" \
    "${PROJECT_DIR}/scenarios/review-terminate.mmd" \
    | tail -n 1
)"
terminate_review_id="$(review_id_for "$terminate_run_id")"
terminate_run_dir="$(run_dir_for "$terminate_run_id")"

cli run review decide "$terminate_run_id" "$terminate_review_id" \
  --decision terminate \
  --scope run \
  --comment "stop" \
  --actor reviewer \
  --workdir "$PROJECT_DIR" >/dev/null
cli run resume "$terminate_run_id" --workdir "$PROJECT_DIR" >/dev/null

assert_status "$terminate_run_id" 'data.status === "stopped" && data.pendingReviewCount === 0 && data.hasWaitingHumanReview === false && data.latestPendingReviewId === undefined'
assert_review_inspect "$terminate_run_id" "$terminate_review_id" 'data.decisionSnapshot.decision === "terminate" && data.decisionSnapshot.scope === "run" && data.currentStatus === "resolved" && data.currentState.status === "resolved"'
assert_decision_applied "$terminate_run_id" "$terminate_review_id"
assert_state_error "$terminate_run_id" 'human_review_terminate_run'
assert_file_absent "${terminate_run_dir}/shared/index.html"

deploy_fail_run_id="$(
  run_start_case \
    "Deploy failure still routes to compensation" \
    "${PROJECT_DIR}/scenarios/deploy-failure.mmd" \
    | tail -n 1
)"
deploy_fail_review_id="$(review_id_for "$deploy_fail_run_id")"
deploy_fail_run_dir="$(run_dir_for "$deploy_fail_run_id")"

cli run review decide "$deploy_fail_run_id" "$deploy_fail_review_id" \
  --decision approve \
  --comment "approved" \
  --actor reviewer \
  --workdir "$PROJECT_DIR" >/dev/null
SHIP_DEPLOY_FAIL=1 cli run resume "$deploy_fail_run_id" --workdir "$PROJECT_DIR" >/dev/null

assert_status "$deploy_fail_run_id" 'data.status === "done" && data.pendingReviewCount === 0 && data.hasWaitingHumanReview === false && data.latestPendingReviewId === undefined'
assert_review_inspect "$deploy_fail_run_id" "$deploy_fail_review_id" 'data.decisionSnapshot.decision === "approve" && data.currentStatus === "resolved" && data.currentState.status === "resolved"'
assert_decision_applied "$deploy_fail_run_id" "$deploy_fail_review_id"
assert_summary_failed_count "$deploy_fail_run_id" 1
assert_role_execution_failed "$deploy_fail_run_id" "ship-deploy"
assert_role_execution_exists "$deploy_fail_run_id" "error-handler-base"
assert_file_absent "${deploy_fail_run_dir}/shared/index.html"

echo
echo "All ogs-gstacklike runtime-native human review scenarios passed."
