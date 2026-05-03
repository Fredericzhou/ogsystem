import { buildClientAppScript } from "./client-app.js";
import { createTranslator, getDictionary, type Dictionary, type Locale } from "./i18n/index.js";
import { renderPageShellStyles } from "./page-shell-styles.js";
import { renderPageShellBody } from "./page-shell-template.js";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type PageI18nOptions = {
  locale?: Locale;
  messages?: Dictionary;
};

export function renderPageHtml(workdir: string, apiPrefix: string, i18n: PageI18nOptions = {}): string {
  const locale = i18n.locale ?? "en";
  const messages = i18n.messages ?? getDictionary(locale);
  const t = createTranslator(locale);
  const clientScript = buildClientAppScript(apiPrefix, { locale, messages });
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(t("app.title"))}</title>
  <style>
${renderPageShellStyles()}  </style>
</head>
${renderPageShellBody({ workdir, locale, t })}  <script>
${clientScript}
  </script>
</body>
</html>`;
}
