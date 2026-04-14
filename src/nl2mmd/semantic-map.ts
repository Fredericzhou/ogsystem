/**
 * @fileoverview Search/ranking and semantic hint extraction for NL2MMD prompts.
 * File Set: nl2mmd-context
 * Responsibilities:
 * - Build reusable search index over role/model catalogs.
 * - Rank query matches and extract fixed intent hints from user text.
 * Boundaries:
 * - Heuristic assistance only; no DSL validation.
 */
import type {
  Nl2MmdCatalogSearchResult,
  Nl2MmdContext,
  Nl2MmdModelSummary,
  Nl2MmdRoleSummary,
  Nl2MmdSemanticHint
} from "./types.js";

type SearchField<T> = {
  getter: (item: T) => string | string[] | undefined;
  weight: number;
};

type WeightedHaystack = {
  text: string;
  weight: number;
};

type IndexedCatalogItem<T> = {
  item: T;
  haystacks: WeightedHaystack[];
};

type SearchIndex = {
  roles: IndexedCatalogItem<Nl2MmdRoleSummary>[];
  models: IndexedCatalogItem<Nl2MmdModelSummary>[];
};

const ROLE_SEARCH_FIELDS: SearchField<Nl2MmdRoleSummary>[] = [
  { getter: (item) => item.roleId, weight: 5 },
  { getter: (item) => item.name, weight: 4 },
  { getter: (item) => item.tags, weight: 3 },
  { getter: (item) => item.outputEvents, weight: 2 },
  { getter: (item) => item.description, weight: 1 }
];

const MODEL_SEARCH_FIELDS: SearchField<Nl2MmdModelSummary>[] = [
  { getter: (item) => item.modelId, weight: 5 },
  { getter: (item) => item.model, weight: 4 },
  { getter: (item) => item.tags, weight: 2 },
  { getter: (item) => item.reasoningEffort, weight: 1 }
];

const searchIndexCache = new WeakMap<Nl2MmdContext, SearchIndex>();

function normalize(text: string): string {
  return text.toLowerCase();
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fff._:-]+/i)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function buildIndex<T>(args: {
  items: T[];
  fields: SearchField<T>[];
}): IndexedCatalogItem<T>[] {
  return args.items.map((item) => {
    const haystacks = args.fields.flatMap((field) => {
      const value = field.getter(item);
      if (Array.isArray(value)) {
        return value.map((entry) => ({
          text: normalize(entry),
          weight: field.weight
        }));
      }
      return value
        ? [
            {
              text: normalize(value),
              weight: field.weight
            }
          ]
        : [];
    });
    return {
      item,
      haystacks
    };
  });
}

function getSearchIndex(context: Nl2MmdContext): SearchIndex {
  const cached = searchIndexCache.get(context);
  if (cached) {
    return cached;
  }

  const next: SearchIndex = {
    roles: buildIndex({
      items: context.roleCatalog,
      fields: ROLE_SEARCH_FIELDS
    }),
    models: buildIndex({
      items: context.modelCatalog,
      fields: MODEL_SEARCH_FIELDS
    })
  };
  searchIndexCache.set(context, next);
  return next;
}

function rankMatches<T>(args: {
  query: string;
  index: IndexedCatalogItem<T>[];
}): Array<Nl2MmdCatalogSearchResult<T>> {
  const query = normalize(args.query).trim();
  const tokens = tokenize(query);
  if (!query) {
    return [];
  }

  const ranked: Array<Nl2MmdCatalogSearchResult<T>> = [];
  for (const entry of args.index) {
    let score = 0;
    const reasons: string[] = [];
    for (const haystack of entry.haystacks) {
      const factor = haystack.weight;
      if (haystack.text === query) {
        score += 20 * factor;
        reasons.push(`exact:${query}`);
      } else if (haystack.text.includes(query)) {
        score += 10 * factor;
        reasons.push(`contains:${query}`);
      }
      for (const token of tokens) {
        if (haystack.text === token) {
          score += 6 * factor;
          reasons.push(`exact:${token}`);
        } else if (haystack.text.includes(token)) {
          score += 2 * factor;
          reasons.push(`contains:${token}`);
        }
      }
    }

    if (score > 0) {
      ranked.push({
        item: entry.item,
        score,
        reason: Array.from(new Set(reasons)).slice(0, 3).join(", ")
      });
    }
  }

  ranked.sort((left, right) => right.score - left.score);
  return ranked;
}

export function searchRoles(
  context: Nl2MmdContext,
  query: string,
  limit = 8
): Array<Nl2MmdCatalogSearchResult<Nl2MmdRoleSummary>> {
  const index = getSearchIndex(context);
  return rankMatches({
    query,
    index: index.roles
  }).slice(0, limit);
}

export function searchModels(
  context: Nl2MmdContext,
  query: string,
  limit = 8
): Array<Nl2MmdCatalogSearchResult<Nl2MmdModelSummary>> {
  const index = getSearchIndex(context);
  return rankMatches({
    query,
    index: index.models
  }).slice(0, limit);
}

type HintRule = {
  pattern: RegExp;
  hint: Nl2MmdSemanticHint;
};

const HINT_RULES: HintRule[] = [
  {
    pattern: /并行|同时|多路|多个专家|多学科|fan[ -]?out|parallel/i,
    hint: {
      kind: "routing_mode",
      label: "parallel_split",
      detail: 'Detected parallel intent. Consider `role.mode.<roleId>=parallel_split`.'
    }
  },
  {
    pattern: /汇总|汇聚|聚合|合并|统一评审|总审|收敛|join|all[_ -]?of/i,
    hint: {
      kind: "join_mode",
      label: "all_of",
      detail: 'Detected merge intent. Consider `join.mode.<roleId>=all_of` plus `join.sources.<roleId>=...`.'
    }
  },
  {
    pattern: /循环|重试|反复|再次|回到|rebuttal|retry|loop/i,
    hint: {
      kind: "loop_hint",
      label: "loop.max",
      detail: "Detected loop intent. Add `loop.max.<roleId>=N` and make the loop-back edge explicit."
    }
  },
  {
    pattern: /入口|开始|受理|接收|intake|entry/i,
    hint: {
      kind: "entry_hint",
      label: "entry.role",
      detail: "Detected entry intent. Make one role the unique input target and `entry.role`."
    }
  },
  {
    pattern: /输出|结束|总结|报告|final|summary|report/i,
    hint: {
      kind: "terminal_hint",
      label: "output",
      detail: "Detected terminal intent. Ensure one explicit path ends with `--> output`."
    }
  },
  {
    pattern: /模型|推理|快一点|低成本|高质量|fast|cheap|deep|reasoning/i,
    hint: {
      kind: "model_lookup",
      label: "model.bind",
      detail: "Detected model-selection intent. Prefer local curated `model.bind.<roleId>=<modelId>`."
    }
  },
  {
    pattern: /兼容|旧版|老流程|profile|exec\.bind/i,
    hint: {
      kind: "binding_policy",
      label: "exec.bind",
      detail: "Detected compatibility intent. Use `exec.bind` only if legacy profiles/tools are required."
    }
  }
];

export function detectSemanticHints(message: string): Nl2MmdSemanticHint[] {
  const hints: Nl2MmdSemanticHint[] = [];
  for (const rule of HINT_RULES) {
    if (rule.pattern.test(message)) {
      hints.push(rule.hint);
    }
  }
  return Array.from(
    new Map(hints.map((item) => [`${item.kind}:${item.label}`, item])).values()
  );
}
