export type SelectorSummary = {
  selectorKind: "global.task" | "global.user_profile" | "global.user_profile.path" | "global.human_review.current" | "global.human_review.current.comment" | "global.human_review.current.round" | "global.human_review.current.previous_output" | "global.human_review.current.previous_output.path" | "direct" | "direct.data.path" | "source" | "unsupported";
  sourceRoleId?: string;
  validPath: boolean;
  optional?: boolean;
};

export function listContextSelectorCandidates(args: {
  incomingRoleIds?: string[];
  joinMode?: string;
  joinMin?: number;
} = {}): string[] {
  const selectors = new Set([
    "global.task", "global.user_profile", "global.human_review.current.comment",
    "global.human_review.current.round", "global.human_review.current.previous_output.content"
  ]);
  const sources = Array.from(new Set(args.incomingRoleIds || []));
  if (args.joinMode) {
    if (args.joinMode !== "quorum_of" || Number(args.joinMin) >= sources.length) {
      for (const source of sources) {
        selectors.add(`source(${source}).content`);
        selectors.add(`source(${source}).event`);
        selectors.add(`source(${source}).data`);
        selectors.add(`source(${source}).artifact`);
      }
    }
  } else if (sources.length) {
    selectors.add("direct.content");
    selectors.add("direct.event");
    selectors.add("direct.data");
    selectors.add("direct.artifact");
  }
  return Array.from(selectors).sort((left, right) => left.localeCompare(right));
}

export function isValidSelectorPath(path: string): boolean {
  const isSegmentCharacter = (character: string) => {
    const code = character.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || character === "_";
  };
  return Boolean(path) && path.split(".").every((segment) => segment.length > 0 && Array.from(segment).every(isSegmentCharacter));
}

export function isValidSourceRoleId(roleId: string): boolean {
  const isCharacterAllowed = (character: string) => {
    const code = character.charCodeAt(0);
    return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || "_.:-".includes(character);
  };
  return Boolean(roleId) && Array.from(roleId).every(isCharacterAllowed);
}

export function summarizeContextSelector(selector: string): SelectorSummary {
  const optional = selector.endsWith("?");
  const value = optional ? selector.slice(0, -1) : selector;
  const optionalAllowed = value.startsWith("global.human_review.current") ||
    value === "direct.data" ||
    value === "direct.artifact" ||
    value.startsWith("direct.data.") ||
    /^source\([A-Za-z0-9._:-]+\)\.(?:content|event|data|artifact)(?:\.|$)/.test(value);
  if (optional && !optionalAllowed) return { selectorKind: "unsupported", validPath: false, optional };
  if (value === "global.task" || value === "global.user_profile") return { selectorKind: value, validPath: true, optional };
  if (value.startsWith("global.user_profile.")) return { selectorKind: "global.user_profile.path", validPath: isValidSelectorPath(value.slice("global.user_profile.".length)), optional };
  if (value === "global.human_review.current") return { selectorKind: value, validPath: true, optional };
  if (value === "global.human_review.current.comment" || value === "global.human_review.current.round" || value === "global.human_review.current.previous_output") return { selectorKind: value, validPath: true, optional };
  if (value.startsWith("global.human_review.current.previous_output.")) return { selectorKind: "global.human_review.current.previous_output.path", validPath: isValidSelectorPath(value.slice("global.human_review.current.previous_output.".length)), optional };
  if (["direct.content", "direct.event", "direct.data", "direct.artifact"].includes(value)) return { selectorKind: "direct", validPath: true, optional };
  if (value.startsWith("direct.data.")) return { selectorKind: "direct.data.path", validPath: isValidSelectorPath(value.slice("direct.data.".length)), optional };
  const sourceEnd = value.startsWith("source(") ? value.indexOf(").") : -1;
  if (sourceEnd > 7) {
    const sourceRoleId = value.slice(7, sourceEnd);
    const sourceValue = value.slice(sourceEnd + 2);
    const validSourceValue = ["content", "event", "data", "artifact"].includes(sourceValue)
      || (sourceValue.startsWith("data.") && isValidSelectorPath(sourceValue.slice("data.".length)));
    if (isValidSourceRoleId(sourceRoleId) && validSourceValue) return { selectorKind: "source", sourceRoleId, validPath: true, optional };
  }
  return { selectorKind: "unsupported", validPath: false, optional };
}

export type SchemaPropertyPath = {
  path: string;
  type: string;
  description: string;
};

/**
 * Extract flat dot-notation property paths from a JSON Schema.
 * If properties.data exists, paths are scoped inside data (for direct.data.* and source(*).data.*).
 * Otherwise top-level domain properties (excluding envelope event/content/artifacts/data) are extracted.
 */
export function extractSchemaPropertyPaths(schema: unknown): SchemaPropertyPath[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return [];
  const schemaRecord = schema as Record<string, unknown>;
  const properties = (schemaRecord.properties && typeof schemaRecord.properties === "object" && !Array.isArray(schemaRecord.properties))
    ? (schemaRecord.properties as Record<string, unknown>)
    : undefined;
  if (!properties) return [];

  const dataProperty = properties.data && typeof properties.data === "object" && !Array.isArray(properties.data)
    ? (properties.data as Record<string, unknown>)
    : undefined;
  const dataProperties = dataProperty?.properties && typeof dataProperty.properties === "object" && !Array.isArray(dataProperty.properties)
    ? (dataProperty.properties as Record<string, unknown>)
    : undefined;

  let targetProperties: Record<string, unknown> | undefined = dataProperties;
  if (!targetProperties) {
    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(properties)) {
      if (key !== "event" && key !== "content" && key !== "artifacts" && key !== "data") {
        filtered[key] = val;
      }
    }
    if (Object.keys(filtered).length > 0) {
      targetProperties = filtered;
    }
  }

  if (!targetProperties) return [];

  const results: SchemaPropertyPath[] = [];
  function walk(current: Record<string, unknown>, prefix = ""): void {
    for (const [key, val] of Object.entries(current)) {
      if (!isValidSelectorPath(key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const propRecord = val && typeof val === "object" && !Array.isArray(val) ? (val as Record<string, unknown>) : {};
      const type = typeof propRecord.type === "string" ? propRecord.type : (Array.isArray(propRecord.enum) ? "enum" : "any");
      const description = typeof propRecord.description === "string" ? propRecord.description : "";
      results.push({ path, type, description });
      if (propRecord.properties && typeof propRecord.properties === "object" && !Array.isArray(propRecord.properties)) {
        walk(propRecord.properties as Record<string, unknown>, path);
      }
    }
  }

  walk(targetProperties);
  return results;
}
