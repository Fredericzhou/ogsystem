import { applyStateReducer, type StateReducerName } from "./state-reducer.js";
import type { ExecutionPlan, GraphState } from "./types.js";

/** Applies the declared business reducer once so execution and routing share the same state view. */
export function applySemanticBusinessState(args: {
  state: GraphState;
  plan: ExecutionPlan;
  roleId: string;
  data: unknown;
}): Record<string, unknown> | undefined {
  const schema = args.plan.semanticIR?.stateSchema;
  if (!schema?.reducers || !args.data || typeof args.data !== "object" || Array.isArray(args.data)) return undefined;
  const current = { ...(args.state.businessState ?? {}) };
  for (const [field, value] of Object.entries(args.data as Record<string, unknown>)) {
    const reducer = schema.reducers[field] as StateReducerName | undefined;
    if (!reducer) throw new Error(`State update field ${field} has no declared reducer`);
    const writers = schema.writableRolesByField?.[field];
    if (writers && !writers.includes(args.roleId)) throw new Error(`Role "${args.roleId}" cannot update state field ${field}`);
    current[field] = applyStateReducer(reducer, current[field], value);
  }
  return current;
}
