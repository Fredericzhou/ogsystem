import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, FileTeamReviewStore, FileTeamRunStore, TeamReviewRuntime, TeamRuntime, validateTeamIr } from "../dist/team-ir/index.js";

async function loadFixture() {
  return JSON.parse(await readFile(new URL("../examples/team-ir-v2/classic-maker-checker.json", import.meta.url), "utf8"));
}

function compileFixture(fixture) {
  const diagnostics = validateTeamIr(fixture);
  assert.deepEqual(diagnostics.filter((item) => item.severity === "error"), []);
  return compileTeamIr(fixture);
}

test("classic Maker-Checker fixture compiles as a native Team IR v2 document", async () => {
  const fixture = await loadFixture();
  const plan = compileFixture(fixture);

  assert.equal(fixture.schemaVersion, 2);
  assert.equal(fixture.team.id, "classic-maker-checker");
  assert.equal(plan.loopsById.get("revision").maxRounds, 3);
  assert.equal(plan.reviewsByOutput.get("maker:DONE")[0].timeoutMs, 600000);
});

test("classic Maker-Checker reject, revise, and approve survives Run and Review Store reconstruction", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "team-ir-classic-maker-checker-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plan = compileFixture(await loadFixture());
  const runRoot = join(root, "runs");
  const reviewRoot = join(root, "reviews");
  let now = 100;
  const makeReviewRuntime = () => new TeamReviewRuntime({
    store: new FileTeamReviewStore(reviewRoot),
    now: () => now,
    authorizeReviewer: ({ reviewerId }) => reviewerId === "reviewer"
  });
  let calls = 0;
  const inputs = [];
  const bindings = {
    "binding:maker": {
      async invoke(invocation) {
        calls += 1;
        now += 5;
        inputs.push(invocation.input);
        return { kind: "completed", output: { event: "DONE", data: { answer: `draft-${calls}`, again: false } } };
      }
    }
  };
  const makeRuntime = () => new TeamRuntime({
    store: new FileTeamRunStore(runRoot),
    clock: { now: () => now, sleep: () => new Promise(() => {}) },
    bindings,
    reviewRuntime: makeReviewRuntime()
  });
  const runId = "maker-checker-release";

  await makeRuntime().createRun(plan, { runId, task: "review a draft", input: { request: "Prepare a release note." } });
  const waiting1 = await makeRuntime().executeRun(plan, runId);
  assert.equal(waiting1.status, "waiting_human_review");
  assert.equal(waiting1.waitingReview.loopRound, 1);
  assert.equal(waiting1.activeExecutionMs, 5);
  now += 6000;

  const review1 = await new FileTeamReviewStore(reviewRoot).load(`${runId}:maker-checker-review:run:1`);
  await makeReviewRuntime().decide({
    runId,
    reviewId: "maker-checker-review",
    loopRound: 1,
    revisionToken: review1.revisionToken,
    idempotencyKey: "reject-1",
    reviewerId: "reviewer",
    decision: "reject",
    feedback: { comments: "Add the release compatibility note." },
    plan
  });

  const waiting2 = await makeRuntime().executeRun(plan, runId);
  assert.equal(waiting2.status, "waiting_human_review");
  assert.equal(waiting2.waitingReview.loopRound, 2);
  assert.equal(waiting2.activeExecutionMs, 10);
  assert.equal(calls, 2, "resume should reuse round 1 output and execute only the revision");
  assert.deepEqual(inputs, [
    { request: "Prepare a release note." },
    { answer: "draft-1", comments: "Add the release compatibility note." }
  ]);
  now += 6000;

  const review2 = await new FileTeamReviewStore(reviewRoot).load(`${runId}:maker-checker-review:run:2`);
  await makeReviewRuntime().decide({
    runId,
    reviewId: "maker-checker-review",
    loopRound: 2,
    revisionToken: review2.revisionToken,
    idempotencyKey: "approve-2",
    reviewerId: "reviewer",
    decision: "approve",
    plan
  });

  const completed = await makeRuntime().executeRun(plan, runId);
  assert.equal(completed.status, "completed", JSON.stringify(completed.events.filter((item) => item.type === "run.failing")));
  assert.deepEqual(completed.result, { answer: "draft-2" });
  assert.equal(completed.loopStates.revision.rounds, 2);
  assert.equal(completed.activeExecutionMs, 10, "Review wait time must not consume active execution budget");
  assert.equal(calls, 2, "approve should finish from the completed output without replaying the Maker");
  assert.equal(completed.events.filter((item) => item.type === "run.waiting_human_review").length, 2);
  assert.equal((await new FileTeamReviewStore(reviewRoot).load(`${runId}:maker-checker-review:run:1`)).status, "rejected");
  assert.equal((await new FileTeamReviewStore(reviewRoot).load(`${runId}:maker-checker-review:run:2`)).status, "approved");
  assert.equal(completed.events.filter((item) => item.type === "run.review.rejected" && item.data?.loopRound === 1).length, 1);
  assert.equal(completed.events.filter((item) => item.type === "run.review.approved" && item.data?.loopRound === 2).length, 1);
});
