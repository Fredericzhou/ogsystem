const INTERNAL_WORKSPACE_FILENAMES = new Set([
  ".gitattributes",
  ".gitignore",
  ".gitkeep",
  ".DS_Store"
]);

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"]);
const CODE_OR_TEXT_EXTENSIONS = new Set([
  "txt", "json", "yaml", "yml", "csv", "tsv", "xml", "html", "htm", "css",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java",
  "c", "h", "cpp", "hpp", "sh", "bash", "zsh", "sql", "toml", "ini", "env", "log", "mmd"
]);

function fileExtension(filePath) {
  const name = String(filePath || "").split("/").at(-1) || "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function isInternalWorkspaceFile(filePath) {
  const normalized = String(filePath || "").replace(/^\/+/, "");
  if (!normalized) return false;
  if (normalized.startsWith(".ogs/") || normalized.startsWith(".git/")) return true;
  const basename = normalized.split("/").at(-1) || "";
  return INTERNAL_WORKSPACE_FILENAMES.has(basename);
}

export function detectOutputPreviewKind(filePath, mediaType = "") {
  const mime = String(mediaType || "").toLowerCase();
  const ext = fileExtension(filePath);
  if (MARKDOWN_EXTENSIONS.has(ext) || mime.includes("markdown")) return "markdown";
  if (IMAGE_EXTENSIONS.has(ext) || mime.startsWith("image/")) return "image";
  if (CODE_OR_TEXT_EXTENSIONS.has(ext) || mime.startsWith("text/") || mime.includes("json") || mime.includes("yaml") || mime.includes("xml") || mime.includes("javascript")) {
    return "text";
  }
  return "binary";
}

function outputFilePriority(file) {
  const kind = detectOutputPreviewKind(file?.path, file?.mediaType);
  if (kind === "markdown") return 0;
  if (kind === "text") return 1;
  if (kind === "image") return 2;
  return 3;
}

export function partitionCollaborationOutputFiles(files) {
  const list = Array.isArray(files) ? files.filter((file) => file && typeof file.path === "string" && file.path.trim()) : [];
  const businessFiles = [];
  const systemFiles = [];
  for (const file of list) {
    if (isInternalWorkspaceFile(file.path)) systemFiles.push(file);
    else businessFiles.push(file);
  }
  const sortFiles = (items) => items.slice().sort((left, right) => {
    const priorityDiff = outputFilePriority(left) - outputFilePriority(right);
    if (priorityDiff !== 0) return priorityDiff;
    return String(left.path).localeCompare(String(right.path));
  });
  return {
    businessFiles: sortFiles(businessFiles),
    systemFiles: sortFiles(systemFiles)
  };
}

export function pickDefaultOutputFile(files) {
  const { businessFiles, systemFiles } = partitionCollaborationOutputFiles(files);
  return businessFiles[0] || systemFiles[0] || null;
}

export function defaultTaskRunMode(task) {
  if (!task || task.status !== "failed") return "dry-run";
  const attempts = Array.isArray(task.runAttempts) ? task.runAttempts : [];
  const currentAttempt = attempts.find((item) => item?.isCurrent) || attempts.at(-1);
  const candidate = currentAttempt?.mode || task.mode;
  return candidate === "sandbox" ? "sandbox" : "dry-run";
}

export function computeRunProgress(run) {
  const stateSnapshot = run?.state || {};
  const status = stateSnapshot.status || run?.status || "";
  const nodes = Object.values(stateSnapshot.nodes || {});
  const isFailed = status === "failed" || status === "cancelled";

  if (isFailed) {
    if (nodes.length) {
      const completed = nodes.filter((node) => node?.status === "completed").length;
      const ratio = Math.round((completed / nodes.length) * 100);
      return Math.max(0, Math.min(99, ratio));
    }
    const explicit = Number(stateSnapshot.progress ?? run?.progress);
    if (Number.isFinite(explicit)) return Math.max(0, Math.min(99, Math.round(explicit)));
    return 0;
  }

  const explicit = Number(stateSnapshot.progress ?? run?.progress);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)));
  const done = nodes.filter((node) => node?.status === "completed").length;
  return nodes.length ? Math.round((done / nodes.length) * 100) : 0;
}

const HUMANIZED_EVENT_LABELS = {
  "flow.activated": { zh: "流程已启动", en: "Flow started" },
  "flow.completed": { zh: "流程已完成", en: "Flow completed" },
  "flow.failed": { zh: "流程执行失败", en: "Flow failed" },
  "role.input_ready": { zh: "输入已就绪", en: "Input ready" },
  "role.started": { zh: "开始执行", en: "Started" },
  "role.completed": { zh: "执行完成", en: "Completed" },
  "role.failed": { zh: "执行失败", en: "Failed" },
  "role_waiting": { zh: "等待上游或审阅", en: "Waiting for input or review" },
  "result_committed": { zh: "已提交结果", en: "Result committed" },
  "workspace_integrated": { zh: "工作区结果已汇聚", en: "Workspace integrated" },
  "route_decision": { zh: "路由流转决策", en: "Route selected" },
  "start_dispatch_selected": { zh: "入口分发已选择", en: "Start dispatch selected" },
  "join_quorum_reached": { zh: "汇聚法定人数已达标", en: "Join quorum reached" },
  "join_activated": { zh: "汇聚节点已激活", en: "Join activated" },
  "join_late_arrival_ignored": { zh: "忽略迟到分支结果", en: "Late arrival ignored" },
  "join_timed_out": { zh: "汇聚等待超时", en: "Join timed out" },
  "join_conflict": { zh: "汇聚发生文件冲突", en: "Join merge conflict" },
  "loop_budget_decision": { zh: "循环返工判定", en: "Loop decision" },
  "loop_exhausted": { zh: "循环次数已达上限", en: "Loop budget exhausted" },
  "failure_handled": { zh: "触发失败处理", en: "Failure handled" },
  "human_review_requested": { zh: "等待人工审核", en: "Human review requested" },
  "human_review_decided": { zh: "人工审核已决定", en: "Human review decided" }
};

export function humanizeRunEvent(eventName, locale = "zh-CN") {
  const key = String(eventName || "").trim();
  const entry = HUMANIZED_EVENT_LABELS[key];
  if (entry) return locale === "en" ? entry.en : entry.zh;
  return key || (locale === "en" ? "Run update" : "运行更新");
}

export function projectLastUpdatedAt(project) {
  const candidates = [project?.updatedAt, project?.createdAt];
  for (const task of project?.taskRecords || []) {
    if (task?.deletedAt || task?.status === "deleted") continue;
    candidates.push(task.updatedAt, task.createdAt);
  }
  let latest = 0;
  for (const value of candidates) {
    const parsed = Date.parse(value || "");
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }
  return latest;
}

export function formatBytesCompact(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
