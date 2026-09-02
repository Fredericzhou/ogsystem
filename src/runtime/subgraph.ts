export type SubgraphSpec = {
  id: string;
  version: string;
  source: string;
  inputs: string[];
  outputs: string[];
  namespace: string;
  checkpointNamespace: string;
  inputContract?: string;
  outputContract?: string;
};

export function validateSubgraphSpec(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["subgraph must be an object"];
  const item = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of ["id", "version", "source", "namespace", "checkpointNamespace"]) {
    if (typeof item[key] !== "string" || !(item[key] as string).trim()) errors.push(`${key} must be a non-empty string`);
  }
  for (const key of ["inputs", "outputs"]) {
    if (!Array.isArray(item[key]) || !(item[key] as unknown[]).every((entry) => typeof entry === "string" && entry.length > 0)) errors.push(`${key} must be an array of non-empty strings`);
  }
  if (item.namespace === item.checkpointNamespace) errors.push("namespace and checkpointNamespace must be distinct");
  return errors;
}

export function compileSubgraphSpec(value: unknown): SubgraphSpec {
  const errors = validateSubgraphSpec(value);
  if (errors.length) throw new Error(`[IR_SUBGRAPH_INVALID] ${errors.join("; ")}`);
  const item = value as Record<string, any>;
  return {
    id: item.id,
    version: String(item.version),
    source: item.source,
    inputs: [...item.inputs],
    outputs: [...item.outputs],
    namespace: item.namespace,
    checkpointNamespace: item.checkpointNamespace,
    ...(typeof item.inputContract === "string" ? { inputContract: item.inputContract } : {}),
    ...(typeof item.outputContract === "string" ? { outputContract: item.outputContract } : {})
  };
}
