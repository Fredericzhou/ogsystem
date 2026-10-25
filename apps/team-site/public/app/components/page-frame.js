import { esc } from "./dom.js";

export function pageFrame({ template, title, subtitle = "", back = "", status = "", actions = "", tabs = "", body = "" }) {
  const headerActions = status || actions ? `<div class="page-frame-actions">${status}${actions}</div>` : "";
  return `<section class="page-frame" data-template="${esc(template)}" data-fit>${back ? `<div class="page-frame-back">${back}</div>` : ""}<header class="page-frame-header page-heading"><div class="page-frame-title"><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${tabs ? `<nav class="page-frame-tabs" aria-label="${esc(title)}">${tabs}</nav>` : ""}${headerActions}</header><div class="page-frame-body" data-layout-scroll>${body}</div></section>`;
}

export function frameExistingPage(root, template, aside = "", tabs = "") {
  if (!root) return;
  if (root.querySelector(":scope > .page-frame")) {
    if (root.matches(".studio-design-page")) root.querySelector(":scope > .page-frame .page-frame-body")?.removeAttribute("data-layout-scroll");
    return;
  }
  const heading = root.querySelector(":scope > .page-heading");
  if (!heading) return;
  const frame = document.createElement("section");
  frame.className = "page-frame";
  frame.dataset.template = template;
  frame.dataset.fit = "";
  const body = document.createElement("div");
  body.className = "page-frame-body";
  if (!root.matches(".studio-design-page") && !root.querySelector(".studio-design-page")) body.dataset.layoutScroll = "";
  heading.classList.add("page-frame-header");
  const existingTabs = root.querySelector(":scope > .studio-workspace-nav");
  const tabMarkup = tabs || existingTabs?.outerHTML || "";
  if (tabMarkup) {
    const tabBar = document.createElement("nav");
    tabBar.className = "page-frame-tabs";
    tabBar.setAttribute("aria-label", heading.querySelector("h1")?.textContent?.trim() || "页面导航");
    tabBar.innerHTML = tabMarkup;
    heading.append(tabBar);
  }
  frame.append(heading);
  frame.append(body);
  if (template === "E") {
    const primary = document.createElement("div");
    primary.className = "page-frame-primary";
    for (const child of [...root.children]) if (child !== heading) primary.append(child);
    body.append(primary);
    if (aside) body.insertAdjacentHTML("beforeend", aside);
  } else {
    for (const child of [...root.children]) if (child !== heading && child !== existingTabs) body.append(child);
  }
  root.dataset.template = template;
  root.replaceChildren(frame);
}
