import test from "node:test";
import assert from "node:assert/strict";

import {
  createTranslator,
  getDictionary,
  interpolate,
  isSupportedLocale,
  resolveLocaleFromAcceptLanguage,
  resolveLocaleFromQuery
} from "../dist/visualizer/i18n/index.js";

test("resolves zh-CN from query", () => {
  assert.equal(resolveLocaleFromQuery("?lang=zh-CN"), "zh-CN");
  assert.equal(resolveLocaleFromQuery(new URLSearchParams("lang=zh-CN")), "zh-CN");
});

test("maps zh query alias to zh-CN", () => {
  assert.equal(resolveLocaleFromQuery("?lang=zh"), "zh-CN");
  assert.equal(resolveLocaleFromQuery("zh"), "zh-CN");
});

test("falls back unsupported query locale to en", () => {
  assert.equal(resolveLocaleFromQuery("?lang=fr"), "en");
  assert.equal(getDictionary("fr")["app.title"], "OGSystem Visualizer");
  assert.equal(isSupportedLocale("fr"), false);
});

test("resolves Accept-Language by q weight and aliases", () => {
  assert.equal(resolveLocaleFromAcceptLanguage("fr-CA, zh;q=0.8, en-US;q=0.7"), "zh-CN");
  assert.equal(resolveLocaleFromAcceptLanguage("en-US,en;q=0.9"), "en");
  assert.equal(resolveLocaleFromAcceptLanguage("fr-CA, de;q=0.9"), undefined);
});

test("keeps dictionary keys in parity", () => {
  const enKeys = Object.keys(getDictionary("en")).sort();
  const zhKeys = Object.keys(getDictionary("zh-CN")).sort();
  assert.deepEqual(zhKeys, enKeys);
});

test("translator returns pure text and preserves interpolated HTML-like text", () => {
  const t = createTranslator("en");
  const value = interpolate("Artifact {name} loaded", { name: "<img src=x onerror=alert(1)>" });
  assert.equal(value, "Artifact <img src=x onerror=alert(1)> loaded");
  assert.equal(t("app.title"), "OGSystem Visualizer");
});

test("translator uses zh-CN dictionary", () => {
  const t = createTranslator("zh-CN");
  assert.equal(t("nav.logs"), "日志");
  assert.equal(t("readiness.ready"), "就绪");
});
