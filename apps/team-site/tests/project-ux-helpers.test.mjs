import assert from "node:assert/strict";
import test from "node:test";
import {
  computeRunProgress,
  defaultTaskRunMode,
  detectOutputPreviewKind,
  humanizeRunEvent,
  partitionCollaborationOutputFiles,
  pickDefaultOutputFile,
  projectLastUpdatedAt
} from "../public/app/components/project-ux-helpers.js";

test("partitionCollaborationOutputFiles separates internal Git files and prioritizes business outputs", () => {
  const files = [
    { path: ".gitattributes", size: 320, mediaType: "text/plain" },
    { path: "assets/chart.png", size: 4096, mediaType: "image/png" },
    { path: "src/index.mjs", size: 1200, mediaType: "text/javascript" },
    { path: "docs/executive-brief.md", size: 2400, mediaType: "text/markdown" },
    { path: ".gitignore", size: 42, mediaType: "text/plain" }
  ];

  const { businessFiles, systemFiles } = partitionCollaborationOutputFiles(files);
  assert.deepEqual(businessFiles.map((file) => file.path), [
    "docs/executive-brief.md",
    "src/index.mjs",
    "assets/chart.png"
  ]);
  assert.deepEqual(systemFiles.map((file) => file.path), [
    ".gitattributes",
    ".gitignore"
  ]);
  assert.equal(pickDefaultOutputFile(files)?.path, "docs/executive-brief.md");
});

test("pickDefaultOutputFile falls back to system files only when no business output exists", () => {
  const files = [{ path: ".gitattributes", size: 320 }];
  assert.equal(pickDefaultOutputFile(files)?.path, ".gitattributes");
  assert.equal(pickDefaultOutputFile([]), null);
});

test("detectOutputPreviewKind distinguishes markdown, image, text, and binary files", () => {
  assert.equal(detectOutputPreviewKind("brief.md"), "markdown");
  assert.equal(detectOutputPreviewKind("diagram.png"), "image");
  assert.equal(detectOutputPreviewKind("report.json", "application/json"), "text");
  assert.equal(detectOutputPreviewKind("archive.zip", "application/zip"), "binary");
});

test("defaultTaskRunMode keeps dry-run for queued tasks and inherits previous mode on failed retry", () => {
  assert.equal(defaultTaskRunMode({ status: "queued" }), "dry-run");
  assert.equal(defaultTaskRunMode({
    status: "failed",
    runAttempts: [
      { attemptNumber: 1, mode: "dry-run", isCurrent: false },
      { attemptNumber: 2, mode: "sandbox", isCurrent: true }
    ]
  }), "sandbox");
  assert.equal(defaultTaskRunMode({
    status: "failed",
    runAttempts: [{ attemptNumber: 1, mode: "dry-run", isCurrent: true }]
  }), "dry-run");
});

test("computeRunProgress never reports 100% for failed runs", () => {
  const failedRun = {
    state: {
      status: "failed",
      nodes: {
        planner: { status: "completed" },
        implementer: { status: "failed" }
      }
    }
  };
  assert.equal(computeRunProgress(failedRun), 50);

  const failedAllExplicit = { state: { status: "failed", progress: 100 } };
  assert.equal(computeRunProgress(failedAllExplicit), 99);

  const completedRun = {
    state: {
      status: "completed",
      nodes: {
        planner: { status: "completed" },
        implementer: { status: "completed" }
      }
    }
  };
  assert.equal(computeRunProgress(completedRun), 100);
});

test("humanizeRunEvent maps engine event names to localized labels", () => {
  assert.equal(humanizeRunEvent("result_committed", "zh-CN"), "已提交结果");
  assert.equal(humanizeRunEvent("result_committed", "en"), "Result committed");
  assert.equal(humanizeRunEvent("custom_event", "en"), "custom_event");
});

test("projectLastUpdatedAt picks latest non-deleted task or project timestamp", () => {
  const ts = projectLastUpdatedAt({
    createdAt: "2026-11-18T00:00:00Z",
    taskRecords: [
      { createdAt: "2026-11-19T12:00:00Z", status: "completed" },
      { createdAt: "2026-11-21T12:00:00Z", status: "deleted", deletedAt: "2026-11-21T13:00:00Z" }
    ]
  });
  assert.equal(ts, Date.parse("2026-11-19T12:00:00Z"));
});
