import { en } from "./en.js";
import { zhCN } from "./zh-CN.js";

export type Locale = "en" | "zh-CN";
export type MessageKey = keyof typeof en;

export type Dictionary = Record<MessageKey, string>;

const dictionaries: Record<Locale, Dictionary> = {
  en,
  "zh-CN": zhCN
};

const supportedLocales = new Set<Locale>(["en", "zh-CN"]);

export function isSupportedLocale(locale: unknown): locale is Locale {
  return locale === "en" || locale === "zh-CN";
}

export function getDictionary(locale: Locale | string | null | undefined): Dictionary {
  return dictionaries[toCanonicalLocale(locale) ?? "en"];
}

export function resolveLocaleFromQuery(query: string | URLSearchParams | null | undefined): Locale {
  return toCanonicalLocale(readQueryLocale(query)) ?? "en";
}

export function resolveLocaleFromAcceptLanguage(header: string | string[] | null | undefined): Locale | undefined {
  const value = Array.isArray(header) ? header.join(",") : header;
  if (!value) {
    return undefined;
  }

  const candidates = value
    .split(",")
    .map((part, index) => {
      const [rawLocale, ...params] = part.trim().split(";");
      const q = params
        .map((param) => param.trim())
        .find((param) => param.toLowerCase().startsWith("q="));
      const weight = q ? Number.parseFloat(q.slice(2)) : 1;
      return {
        index,
        locale: rawLocale,
        weight: Number.isFinite(weight) ? weight : 0
      };
    })
    .filter((candidate) => candidate.locale && candidate.weight > 0)
    .sort((left, right) => right.weight - left.weight || left.index - right.index);

  for (const candidate of candidates) {
    const locale = toCanonicalLocale(candidate.locale);
    if (locale) {
      return locale;
    }
  }

  return undefined;
}

export function createTranslator(locale: Locale | string | null | undefined) {
  const dict = getDictionary(locale);
  const fallback = getDictionary("en");

  return function t(
    key: MessageKey,
    vars?: Record<string, string | number | boolean | null | undefined>
  ): string {
    return interpolate(dict[key] ?? fallback[key] ?? key, vars);
  };
}

export function interpolate(
  template: string,
  vars?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!vars) {
    return template;
  }

  return template.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name: string) => {
    if (!Object.hasOwn(vars, name)) {
      return placeholder;
    }
    return String(vars[name] ?? "");
  });
}

function readQueryLocale(query: string | URLSearchParams | null | undefined): string | undefined {
  if (!query) {
    return undefined;
  }

  if (query instanceof URLSearchParams) {
    return query.get("lang") ?? undefined;
  }

  const value = query.trim();
  if (!value) {
    return undefined;
  }

  if (!value.includes("=") && !value.includes("?")) {
    return value;
  }

  try {
    const url = new URL(value);
    return url.searchParams.get("lang") ?? undefined;
  } catch {
    const search = value.startsWith("?") ? value.slice(1) : value;
    return new URLSearchParams(search).get("lang") ?? undefined;
  }
}

function toCanonicalLocale(locale: unknown): Locale | undefined {
  if (isSupportedLocale(locale)) {
    return locale;
  }

  if (typeof locale !== "string") {
    return undefined;
  }

  const normalized = locale.trim().replaceAll("_", "-").toLowerCase();
  if (!normalized || normalized === "*") {
    return undefined;
  }

  if (normalized === "en" || normalized.startsWith("en-")) {
    return "en";
  }

  if (normalized === "zh" || normalized.startsWith("zh-")) {
    return "zh-CN";
  }

  return supportedLocales.has(normalized as Locale) ? (normalized as Locale) : undefined;
}
