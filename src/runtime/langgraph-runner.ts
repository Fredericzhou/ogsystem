/**
 * @fileoverview Compatibility export for the graph runner entrypoint.
 * File Set: runtime-adapter
 * Responsibilities:
 * - Preserve legacy `runSystemWithLangGraph` naming.
 * Boundaries:
 * - Does not implement execution logic.
 */
export {
  runSystemWithGraphRunner,
  runSystemWithGraphRunner as runSystemWithLangGraph
} from "./graph-runner.js";
