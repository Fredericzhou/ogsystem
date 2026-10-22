import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseSystemFromMermaidSource } from "../../../dist/runtime/parse-mermaid.js";
import { authoringToCanvasDocument, importMermaidToAuthoring, loadStudioAuthoringDraft, serializeAuthoringToMermaid } from "../../../dist/visualizer/studio-authoring.js";
import { buildGraphViewModel } from "../../../dist/visualizer/graph-view-model.js";

async function readJson(path, read) {
  try { return JSON.parse(await read(path, "utf8")); } catch { return {}; }
}

export function createVisualizerProjectDesignProjector({
  read = readFile,
  parseSystem = parseSystemFromMermaidSource,
  importAuthoring = importMermaidToAuthoring,
  loadAuthoringDraft = loadStudioAuthoringDraft,
  serializeAuthoring = serializeAuthoringToMermaid,
  buildViewModel = buildGraphViewModel,
  toCanvas = authoringToCanvasDocument
} = {}) {
  return Object.freeze({
    async project(project, locale = "zh-CN") {
      const systemPath = join(project.workdir, "system.mmd");
      const systemSource = await read(systemPath, "utf8");
      parseSystem(systemSource);
      const design = await readJson(join(project.workdir, "system.design.json"), read);
      const modelSelection = await readJson(join(project.workdir, ".ogs", "model-selection.json"), read);
      const roleDisplayNames = new Map(
        Object.entries(design?.seats && typeof design.seats === "object" ? design.seats : {})
          .flatMap(([roleId, seat]) => {
            const title = seat && typeof seat === "object" && !Array.isArray(seat) ? seat.title : undefined;
            return typeof title === "string" && title.trim() ? [[roleId, title.trim()]] : [];
          })
      );
      const savedDraft = await loadAuthoringDraft(project.workdir);
      const canonicalAuthoring = importAuthoring({
        workdir: project.workdir,
        systemPath: "system.mmd",
        systemSource,
        roleDisplayNames,
        modelSelection
      });
      let authoring = canonicalAuthoring;
      if (savedDraft?.authoring && savedDraft.authoring.version === 1) {
        try {
          // Keep professional settings and layout only when the saved draft belongs to this topology.
          if (serializeAuthoring(savedDraft.authoring) === serializeAuthoring(canonicalAuthoring)) {
            authoring = savedDraft.authoring;
          }
        } catch {
          // Invalid or stale drafts fall back to the canonical Mermaid source.
        }
      }
      const boundaryLabels = locale === "en"
        ? { input: "Task", output: "Outcome" }
        : { input: "任务", output: "结果" };
      return {
        projectId: project.projectId,
        projectDigest: project.projectDigest,
        systemSource,
        authoring,
        canvas: toCanvas(authoring),
        viewModel: buildViewModel({
          authoring,
          mode: "design",
          presentation: { boundaryLabels }
        })
      };
    }
  });
}
