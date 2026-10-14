import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import vm from "node:vm";

const role = process.env.OGSYSTEM_ROLE_ID;
const shared = process.env.OGSYSTEM_SHARED_DIR;
if (!role || !shared) throw new Error("OGSYSTEM_ROLE_ID and OGSYSTEM_SHARED_DIR are required");

const chunks = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const prompt = Buffer.concat(chunks).toString("utf8");

function section(heading) {
  const marker = `\n${heading}:\n`;
  const start = prompt.lastIndexOf(marker);
  if (start < 0) return "";
  const contentStart = start + marker.length;
  const next = prompt.slice(contentStart).match(/\n[A-Z][A-Za-z ]+:\n/);
  return prompt.slice(contentStart, next?.index ? contentStart + next.index : undefined).trim();
}

function input() {
  try {
    const value = JSON.parse(section("Input"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function put(path, content) {
  const target = join(shared, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

function result(event, content, data = {}) {
  process.stdout.write(`${JSON.stringify({ event, content, data })}\n`);
}

const appRoot = join(shared, "miniprogram");

if (role === "requirements") {
  const requirements = {
    product: "\u8f7b\u4efb\u52a1",
    platform: "微信小程序原生框架",
    acceptance: [
      "Display three sample tasks and allow toggling completion",
      "Persist task state with wx storage",
      "Show an explicit empty state when the task list is empty",
      "Include valid app configuration, page assets, and usage notes"
    ],
    constraints: ["No cloud service or third-party packages", "Use native WeChat Mini Program APIs"]
  };
  await put("requirements.json", `${JSON.stringify(requirements, null, 2)}\n`);
  result("SPEC_READY", "Requirements are recorded as verifiable acceptance checks.", { requirements });
} else if (role === "design") {
  const design = {
    screens: [{ page: "pages/index/index", sections: ["标题与完成统计", "可切换任务列表", "空列表提示"] }],
    state: "Restore page state from wx storage and persist every task change.",
    files: ["app.js", "app.json", "pages/index/index.js", "pages/index/index.wxml", "pages/index/index.wxss", "pages/index/index.json"]
  };
  await put("design.json", `${JSON.stringify(design, null, 2)}\n`);
  result("DESIGN_READY", "Page structure, persistence, and source boundaries are defined.", { design });
} else if (role === "coding") {
  const previous = input().previous_output;
  const findings = previous?.findings;
  const feedback = Array.isArray(findings) ? findings : [];
  const fixesEmptyState = feedback.some((item) => String(item.code ?? item).includes("EMPTY_STATE_REQUIRED"));
  const files = {
    "app.js": `App({\n  onLaunch() {\n    const tasks = wx.getStorageSync('mini-program-tasks');\n    if (!Array.isArray(tasks)) wx.setStorageSync('mini-program-tasks', [\n      { id: 'scope', title: '整理本周目标', done: false },\n      { id: 'build', title: '完成开发与自测', done: false },\n      { id: 'release', title: '检查封版清单', done: false }\n    ]);\n  }\n});\n`,
    "app.json": `${JSON.stringify({ pages: ["pages/index/index"], window: { navigationBarTitleText: "\u8f7b\u4efb\u52a1", navigationBarBackgroundColor: "#ffffff", navigationBarTextStyle: "black", backgroundColor: "#f3f6f4" }, style: "v2", sitemapLocation: "sitemap.json" }, null, 2)}\n`,
    "sitemap.json": `${JSON.stringify({ desc: "Light Task Mini Program page index", rules: [{ action: "allow", page: "*" }] }, null, 2)}\n`,
    "project.config.json": `${JSON.stringify({ description: "Light Task WeChat Mini Program", miniprogramRoot: "./", compileType: "miniprogram", libVersion: "3.4.8", setting: { es6: true, minified: true }, appid: "touristappid" }, null, 2)}\n`,
    "pages/index/index.json": `${JSON.stringify({ navigationBarTitleText: "\u8f7b\u4efb\u52a1", enablePullDownRefresh: false }, null, 2)}\n`,
    "pages/index/index.js": `const INITIAL_TASKS = [\n  { id: 'scope', title: '整理本周目标', done: false },\n  { id: 'build', title: '完成开发与自测', done: false },\n  { id: 'release', title: '检查封版清单', done: false }\n];\n\nPage({\n  data: { tasks: [], completedCount: 0 },\n  onLoad() {\n    const stored = wx.getStorageSync('mini-program-tasks');\n    const tasks = Array.isArray(stored) ? stored : INITIAL_TASKS;\n    if (!Array.isArray(stored)) wx.setStorageSync('mini-program-tasks', tasks);\n    this.refresh(tasks);\n  },\n  refresh(tasks) {\n    this.setData({ tasks, completedCount: tasks.filter((task) => task.done).length });\n  },\n  toggleTask(event) {\n    const id = event.currentTarget.dataset.id;\n    const tasks = this.data.tasks.map((task) => task.id === id ? { ...task, done: !task.done } : task);\n    wx.setStorageSync('mini-program-tasks', tasks);\n    this.refresh(tasks);\n  }\n});\n`,
    "pages/index/index.wxml": `<view class="page">\n  <view class="heading">\n    <text class="eyebrow">DAILY CHECKLIST</text>\n    <text class="title">\u8f7b\u4efb\u52a1</text>\n    <text class="summary">\u5df2\u5b8c\u6210 {{completedCount}} / {{tasks.length}} \u9879</text>\n  </view>\n  <view class="task-list">\n    <button wx:for="{{tasks}}" wx:key="id" class="task {{item.done ? 'is-done' : ''}}" bindtap="toggleTask" data-id="{{item.id}}" aria-label="\u5207\u6362\u4efb\u52a1\u5b8c\u6210\u72b6\u6001">\n      <view class="checkmark">{{item.done ? '&#10003;' : ''}}</view>\n      <text class="task-title">{{item.title}}</text>\n    </button>\n  </view>\n${fixesEmptyState ? `  <view wx:if="{{tasks.length === 0}}" class="empty-state">\n    <text class="empty-title">\u6682\u65f6\u6ca1\u6709\u5f85\u529e</text>\n    <text class="empty-copy">\u65b0\u7684\u5b89\u6392\u4f1a\u663e\u793a\u5728\u8fd9\u91cc</text>\n  </view>\n` : ""}</view>\n`,
    "pages/index/index.wxss": `.page { min-height: 100vh; padding: 54rpx 36rpx; box-sizing: border-box; background: #f3f6f4; color: #20312c; }\n.heading { display: flex; flex-direction: column; gap: 12rpx; margin: 20rpx 0 42rpx; }\n.eyebrow { color: #527e6e; font-size: 22rpx; font-weight: 700; }\n.title { font-size: 52rpx; font-weight: 700; }\n.summary { color: #64756e; font-size: 27rpx; }\n.task-list { display: flex; flex-direction: column; gap: 18rpx; }\n.task { display: flex; align-items: center; width: 100%; padding: 26rpx 22rpx; border: 1rpx solid #dbe5df; border-radius: 12rpx; background: #fff; color: #20312c; text-align: left; }\n.task::after { border: 0; }\n.checkmark { display: flex; align-items: center; justify-content: center; width: 38rpx; height: 38rpx; margin-right: 20rpx; border: 2rpx solid #9caf9f; border-radius: 50%; color: #fff; }\n.is-done .checkmark { border-color: #35836a; background: #35836a; }\n.is-done .task-title { color: #718079; text-decoration: line-through; }\n.empty-state { display: flex; flex-direction: column; align-items: center; gap: 10rpx; padding: 72rpx 20rpx; color: #64756e; }\n.empty-title { color: #20312c; font-size: 30rpx; font-weight: 700; }\n.empty-copy { font-size: 25rpx; }\n`,
    "README.md": `# Light Task WeChat Mini Program\n\nOpen this directory in WeChat DevTools to preview. It uses native Mini Program APIs and has no cloud or third-party dependency.\n\n## Behavior\n\n- View three sample tasks and their completion count.\n- Tap a task to toggle it; changes persist in local storage.\n- An empty list displays an empty state.\n\nThe OGS delivery flow runs structural and interaction checks before sealing.\n`
  };
  for (const [path, content] of Object.entries(files)) await put(join("miniprogram", path), content);
  result("CODE_READY", "Mini Program source has been written to the run shared artifact.", {
    artifactPath: appRoot,
    feedbackApplied: fixesEmptyState,
    feedbackCodes: feedback.map((item) => item.code).filter(Boolean)
  });
} else if (role === "testing") {
  const report = await verifyMiniProgram(appRoot);
  await put("test-report.json", `${JSON.stringify(report, null, 2)}\n`);
  result(report.passed ? "TEST_PASS" : "TEST_FAIL", report.passed ? "Mini Program acceptance checks passed." : "Mini Program acceptance failed; structured findings were returned to coding.", { findings: report.findings, report });
} else if (role === "seal") {
  const testReport = await readFile(join(shared, "test-report.json"), "utf8").then(JSON.parse);
  if (!testReport.passed) throw new Error("Fail closed: test report is not passing");
  const files = await listFiles(appRoot);
  const manifest = {
    status: "sealed",
    artifact: "miniprogram/",
    testReport: "test-report.json",
    sealedAt: new Date().toISOString(),
    files: await Promise.all(files.map(async (path) => ({
      path: path.slice(appRoot.length + 1).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(await readFile(path)).digest("hex")
    })))
  };
  await put("seal-manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  result("SEALED", "The passing Mini Program is sealed with a SHA-256 source manifest.", { manifest });
} else {
  throw new Error(`Unsupported workflow role: ${role}`);
}

async function verifyMiniProgram(root) {
  const findings = [];
  const checks = [];
  const required = ["app.js", "app.json", "project.config.json", "pages/index/index.js", "pages/index/index.wxml", "pages/index/index.wxss", "pages/index/index.json", "README.md"];
  const source = new Map();
  for (const path of required) {
    try {
      source.set(path, await readFile(join(root, path), "utf8"));
      checks.push({ id: `file:${path}`, passed: true });
    } catch {
      checks.push({ id: `file:${path}`, passed: false });
      findings.push({ code: "REQUIRED_FILE_MISSING", path });
    }
  }
  let appConfig;
  try {
    appConfig = JSON.parse(source.get("app.json") ?? "{}");
    checks.push({ id: "app-json-valid", passed: Array.isArray(appConfig.pages) && appConfig.pages.includes("pages/index/index") });
  } catch {
    checks.push({ id: "app-json-valid", passed: false });
  }
  if (!checks.at(-1).passed) findings.push({ code: "APP_CONFIG_INVALID", path: "app.json" });

  const markup = source.get("pages/index/index.wxml") ?? "";
  if (!markup.includes("wx:for=") || !markup.includes("bindtap=\"toggleTask\"")) findings.push({ code: "TASK_LIST_INTERACTION_REQUIRED", path: "pages/index/index.wxml" });
  checks.push({ id: "task-list-interaction", passed: !findings.some((item) => item.code === "TASK_LIST_INTERACTION_REQUIRED") });
  const emptyStatePassed = /wx:if="\{\{tasks\.length\s*===\s*0\}\}"/.test(markup) && markup.includes("class=\"empty-state\"");
  checks.push({ id: "empty-state", passed: emptyStatePassed });
  if (!emptyStatePassed) findings.push({ code: "EMPTY_STATE_REQUIRED", path: "pages/index/index.wxml", message: "Add a visible empty-state block when tasks.length is zero." });

  const behaviorPassed = await testPageBehavior(source.get("pages/index/index.js") ?? "").catch((error) => {
    findings.push({ code: "TASK_STORAGE_BEHAVIOR_FAILED", message: error.message });
    return false;
  });
  checks.push({ id: "task-toggle-storage-behavior", passed: behaviorPassed });
  const passed = checks.every((check) => check.passed);
  return { passed, checks, findings, artifactPath: root, testedAt: new Date().toISOString() };
}

async function testPageBehavior(pageSource) {
  let definition;
  const storage = new Map();
  vm.runInNewContext(pageSource, {
    Page: (value) => { definition = value; },
    wx: {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, structuredClone(value))
    }
  }, { timeout: 1000 });
  if (!definition || typeof definition.onLoad !== "function" || typeof definition.toggleTask !== "function") throw new Error("Page lifecycle or toggle handler is missing");
  const page = { data: {}, setData(value) { Object.assign(this.data, value); } };
  Object.assign(page, definition);
  page.onLoad.call(page);
  if (page.data.tasks.length !== 3 || page.data.completedCount !== 0) throw new Error("Initial task state is incorrect");
  page.toggleTask.call(page, { currentTarget: { dataset: { id: "build" } } });
  if (page.data.completedCount !== 1 || storage.get("mini-program-tasks")[1].done !== true) throw new Error("Task toggle was not persisted");
  const reloaded = { data: {}, setData(value) { Object.assign(this.data, value); } };
  Object.assign(reloaded, definition);
  reloaded.onLoad.call(reloaded);
  if (reloaded.data.completedCount !== 1) throw new Error("Saved task state was not restored");
  return true;
}

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else files.push(path);
  }
  return files.sort();
}
