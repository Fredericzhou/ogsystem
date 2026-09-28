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
      }
    }
  } else if (sources.length) {
    selectors.add("direct.content");
    selectors.add("direct.event");
    selectors.add("direct.data");
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
  if (optional && !value.startsWith("global.human_review.current")) return { selectorKind: "unsupported", validPath: false, optional };
  if (value === "global.task" || value === "global.user_profile") return { selectorKind: value, validPath: true, optional };
  if (value.startsWith("global.user_profile.")) return { selectorKind: "global.user_profile.path", validPath: isValidSelectorPath(value.slice("global.user_profile.".length)), optional };
  if (value === "global.human_review.current") return { selectorKind: value, validPath: true, optional };
  if (value === "global.human_review.current.comment" || value === "global.human_review.current.round" || value === "global.human_review.current.previous_output") return { selectorKind: value, validPath: true, optional };
  if (value.startsWith("global.human_review.current.previous_output.")) return { selectorKind: "global.human_review.current.previous_output.path", validPath: isValidSelectorPath(value.slice("global.human_review.current.previous_output.".length)), optional };
  if (["direct.content", "direct.event", "direct.data"].includes(value)) return { selectorKind: "direct", validPath: true, optional };
  if (value.startsWith("direct.data.")) return { selectorKind: "direct.data.path", validPath: isValidSelectorPath(value.slice("direct.data.".length)), optional };
  const sourceEnd = value.startsWith("source(") ? value.indexOf(").") : -1;
  if (sourceEnd > 7) {
    const sourceRoleId = value.slice(7, sourceEnd);
    const sourceValue = value.slice(sourceEnd + 2);
    const validSourceValue = ["content", "event", "data"].includes(sourceValue)
      || (sourceValue.startsWith("data.") && isValidSelectorPath(sourceValue.slice("data.".length)));
    if (isValidSourceRoleId(sourceRoleId) && validSourceValue) return { selectorKind: "source", sourceRoleId, validPath: true, optional };
  }
  return { selectorKind: "unsupported", validPath: false, optional };
}
