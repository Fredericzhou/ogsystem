import { escapeHtml } from "./html-escape.js";
import { createTranslator, type Dictionary, type Locale } from "./i18n/index.js";
import { renderPageShellStyles } from "./page-shell-styles.js";
import { renderPageShellBody } from "./page-shell-template.js";

export type PageI18nOptions = {
  locale?: Locale;
  messages?: Dictionary;
};

function safeInlineJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderPageHtml(workdir: string, apiPrefix: string, i18n: PageI18nOptions = {}): string {
  const locale = i18n.locale ?? "en";
  const t = createTranslator(locale);
  const bootstrap = safeInlineJson({ apiPrefix, locale });
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t("app.title"))}</title>
  <style>
${renderPageShellStyles()}  </style>
</head>
${renderPageShellBody({ workdir, locale, t })}  <script>window.__OGS_VISUALIZER_BOOTSTRAP__ = ${bootstrap};</script>
  <script src="/assets/client-app.js"></script>
</body>
</html>`;
}
