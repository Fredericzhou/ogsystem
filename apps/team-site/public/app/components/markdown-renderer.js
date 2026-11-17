import DOMPurify from "dompurify";
import { marked } from "marked";

const renderer = new marked.Renderer();
renderer.html = ({ text }) => text.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
})[character]);

export function renderStudioMarkdown(source) {
  const html = marked.parse(String(source || ""), { gfm: true, breaks: false, renderer });
  return DOMPurify.sanitize(html, {
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ["style"],
    USE_PROFILES: { html: true }
  });
}
