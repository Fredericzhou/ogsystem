import type { Locale, MessageKey } from "./i18n/index.js";

type PageShellTranslator = (key: MessageKey) => string;

export type PageShellBodyOptions = {
  workdir: string;
  locale: Locale;
  t: PageShellTranslator;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderPageShellBody({ workdir, locale, t }: PageShellBodyOptions): string {
  return `<body>
  <div id="sidebar-overlay" class="sidebar-overlay"></div>
  <div class="app">
    <aside id="sidebar" class="sidebar">
      <div class="brand">
        <h1>${escapeHtml(t("app.title"))}</h1>
        <span>${escapeHtml(t("app.local"))}</span>
      </div>
      <div class="stack">
        <input id="search" class="search" placeholder="${escapeHtml(t("search.placeholder"))}" />
        <div id="run-list" class="run-list"></div>
      </div>
    </aside>
    <main class="content">
      <div id="flash" class="flash hidden"></div>
      <section class="hero">
        <div class="hero-copy">
          <div class="split-inline">
            <button id="sidebar-toggle" class="button subtle sidebar-toggle">${escapeHtml(t("hero.runs"))}</button>
            <p class="hint">${escapeHtml(t("hero.subtitle"))}</p>
          </div>
          <h2 id="selected-title">${escapeHtml(t("hero.selectRun"))}</h2>
          <p id="selected-subtitle" class="truncate">${escapeHtml(t("hero.selectRunHint"))}</p>
        </div>
        <div class="hero-toolbar">
          <div class="actions hero-actions hero-actions-primary">
            <button id="start-run" class="button primary">${escapeHtml(t("action.run"))}</button>
            <button id="resume-run" class="button">${escapeHtml(t("action.resume"))}</button>
            <button id="stop-run" class="button warn">${escapeHtml(t("action.stop"))}</button>
          </div>
          <div class="actions hero-actions hero-actions-secondary">
            <button id="project-home" class="button subtle">${escapeHtml(t("action.project"))}</button>
            <button id="project-export" class="button subtle">${escapeHtml(t("action.export"))}</button>
          </div>
          <div class="hero-utilities">
            <label class="field locale-field">
              <span>${escapeHtml(t("app.locale"))}</span>
              <select id="locale-select" class="select">
                <option value="en"${locale === "en" ? " selected" : ""}>English</option>
                <option value="zh-CN"${locale === "zh-CN" ? " selected" : ""}>中文</option>
              </select>
            </label>
          </div>
        </div>
      </section>
      <div class="global-status">
        <div class="pill">${escapeHtml(t("app.workdir"))} <code id="workdir">${escapeHtml(workdir)}</code></div>
        <div class="actions">
          <button id="refresh" class="button subtle">${escapeHtml(t("action.refresh"))}</button>
          <button id="reindex" class="button subtle">${escapeHtml(t("action.reindex"))}</button>
          <div id="live" class="live">${escapeHtml(t("state.idle"))}</div>
        </div>
      </div>
      <nav id="console-tabs" class="console-tabs" aria-label="Visualizer sections"></nav>
      <section class="grid" id="action-form-section" hidden>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.actionForm"))}</h3></header>
          <div class="body">
            <div id="action-form" class="form-shell"><div class="hint">${escapeHtml(t("form.emptyHint"))}</div></div>
          </div>
        </article>
      </section>
      <section id="console-panel-project" class="console-panel grid" data-console-panel="project" hidden>
        <article class="card span-12">
          <header>
            <div class="card-header">
              <div class="header-copy">
                <h3>${escapeHtml(t("section.projectWizard"))}</h3>
                <div class="hint">${escapeHtml(t("projectWizard.subtitle"))}</div>
              </div>
            </div>
          </header>
          <div class="body">
            <div id="project-wizard" class="project-overview-grid grid">${escapeHtml(t("state.loadingProject"))}</div>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.projectOverview"))}</h3></header>
          <div class="body">
            <div id="project-summary" class="structure-list">${escapeHtml(t("state.loadingProject"))}</div>
          </div>
        </article>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.projectReadiness"))}</h3></header>
          <div class="body">
            <div id="project-readiness" class="structure-list">${escapeHtml(t("state.loadingProjectReadiness"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-build" class="console-panel grid" data-console-panel="build" hidden>
        <article class="card span-12">
          <header>
            <div class="card-header build-header">
              <div class="header-copy">
                <h3 id="workbench-title">${escapeHtml(t("section.mermaidWorkbench"))}</h3>
                <div id="workbench-meta" class="hint">${escapeHtml(t("workbench.defaultMeta"))}</div>
              </div>
              <div class="build-control-bar">
                <div id="workbench-tabs" class="segmented"></div>
                <div id="workbench-status" class="toolbar-group"></div>
                <div id="workbench-actions" class="actions"></div>
              </div>
            </div>
          </header>
          <div class="body">
            <div class="editor-shell">
              <div id="workbench-view-tabs" class="segmented workbench-view-tabs"></div>
              <div id="workbench-body"></div>
            </div>
          </div>
        </article>
      </section>
      <section id="console-panel-debug" class="console-panel grid operate-workspace" data-console-panel="debug">
        <div id="operate-tabs" class="segmented operate-tabs span-12"></div>
        <article class="card span-12 operate-panel operate-overview">
          <header><h3>${escapeHtml(t("section.runSnapshot"))}</h3></header>
          <div class="body">
            <div class="stat-grid" id="stats"></div>
          </div>
        </article>
        <article class="card span-12 operate-panel operate-overview">
          <header><h3>${escapeHtml(t("section.timeline"))}</h3></header>
          <div class="body">
            <div class="row timeline-controls">
              <select id="timeline-role" class="select">
                <option value="">${escapeHtml(t("timeline.allRoles"))}</option>
              </select>
              <input id="timeline-type" class="select" placeholder="${escapeHtml(t("timeline.eventType"))}" />
              <select id="timeline-status" class="select">
                <option value="">${escapeHtml(t("timeline.allStatuses"))}</option>
                <option value="pending">${escapeHtml(t("status.pending"))}</option>
                <option value="paused">${escapeHtml(t("status.paused"))}</option>
                <option value="running">${escapeHtml(t("status.running"))}</option>
                <option value="stopped">${escapeHtml(t("status.stopped"))}</option>
                <option value="done">${escapeHtml(t("status.done"))}</option>
                <option value="failed">${escapeHtml(t("status.failed"))}</option>
                <option value="waiting_review">${escapeHtml(t("status.waitingReview"))}</option>
              </select>
              <input id="timeline-branch" class="select" placeholder="${escapeHtml(t("timeline.branchId"))}" />
              <input id="timeline-review" class="select" placeholder="${escapeHtml(t("timeline.reviewId"))}" />
              <input id="timeline-error" class="select" placeholder="${escapeHtml(t("timeline.errorCode"))}" />
              <button id="timeline-apply" class="button subtle">${escapeHtml(t("action.applyFilters"))}</button>
              <button id="timeline-clear" class="button subtle">${escapeHtml(t("action.clearFilters"))}</button>
            </div>
            <div id="timeline" class="timeline"></div>
          </div>
        </article>
        <article class="card span-12 operate-panel operate-graph">
          <header><h3>${escapeHtml(t("section.graphView"))}</h3></header>
          <div class="body debug-graph-body">
            <div id="graph-view" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="state" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
        <article class="card span-12 operate-panel operate-recovery">
          <header>
            <div class="row">
              <h3>${escapeHtml(t("section.failureTriage"))}</h3>
              <div id="failure-controls" class="actions"></div>
            </div>
          </header>
          <div class="body">
            <div id="failure-summary" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="failure-detail" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="failure-next-checks" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
        <article class="card span-6 operate-panel operate-reviews">
          <header><h3>${escapeHtml(t("section.reviewQueue"))}</h3></header>
          <div class="body">
            <div id="reviews" class="timeline"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="review-actions" class="actions"></div>
            <div id="review-detail" class="structure-list">${escapeHtml(t("state.noReviewSelected"))}</div>
          </div>
        </article>
        <article class="card span-6 operate-panel operate-recovery">
          <header>
            <div class="row">
              <h3>${escapeHtml(t("section.resumeReadiness"))}</h3>
              <div id="resume-controls" class="actions"></div>
            </div>
          </header>
          <div class="body">
            <div id="resume-readiness" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
            <div id="resume-diagnostics" class="timeline"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
      </section>
      <section id="console-panel-ops" class="console-panel grid" data-console-panel="ops" hidden>
        <article class="card span-12 operate-panel operate-overview">
          <header><h3>${escapeHtml(t("section.opsSummary"))}</h3></header>
          <div class="body">
            <div id="ops-summary" class="structure-list">${escapeHtml(t("state.loadingOpsSummary"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-validate-release" class="console-panel grid" data-console-panel="validate-release" hidden>
        <article class="card span-12">
          <header>
            <div class="card-header">
              <div class="header-copy">
                <h3>${escapeHtml(t("section.validateRelease"))}</h3>
                <div class="hint">${escapeHtml(t("release.subtitle"))}</div>
              </div>
              <div class="actions">
                <button id="release-export" class="button primary">${escapeHtml(t("action.exportProject"))}</button>
              </div>
            </div>
          </header>
          <div class="body">
            <div id="release-gate" class="structure-list">${escapeHtml(t("release.loading"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-config" class="console-panel grid" data-console-panel="config" hidden>
        <article class="card span-12">
          <header><h3>${escapeHtml(t("section.configExplain"))}</h3></header>
          <div class="body">
            <div id="binding-explain" class="structure-list">${escapeHtml(t("state.loadingBindingResolution"))}</div>
            <div id="role-packages" class="structure-list">${escapeHtml(t("state.loadingRolePackages"))}</div>
            <div id="contract-explain" class="structure-list">${escapeHtml(t("state.loadingContracts"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-logs" class="console-panel grid" data-console-panel="logs" hidden>
        <article class="card span-12 operate-panel operate-logs">
          <header>
            <div class="toolbar-row">
              <div class="toolbar-group">
                <h3>${escapeHtml(t("section.logs"))}</h3>
                <div id="logs-controls" class="actions"></div>
              </div>
              <div class="log-toolbar">
                <select id="log-role" class="select">
                <option value="">${escapeHtml(t("timeline.allRoles"))}</option>
                </select>
                <select id="log-page-size" class="select">
                  <option value="100">100</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                  <option value="">${escapeHtml(t("logs.all"))}</option>
                </select>
                <input id="log-tail" class="select" type="number" min="1" placeholder="${escapeHtml(t("logs.tail"))}" />
                <input id="log-since" class="select" type="datetime-local" />
              </div>
            </div>
          </header>
          <div class="body">
            <div id="logs-filters" class="hint"></div>
            <div id="logs" class="structure-list">${escapeHtml(t("state.noRunSelected"))}</div>
          </div>
        </article>
      </section>
      <section id="console-panel-artifacts" class="console-panel grid" data-console-panel="artifacts" hidden>
        <article class="card span-12 operate-panel operate-artifacts">
          <header><h3>${escapeHtml(t("section.artifacts"))}</h3></header>
          <div class="body">
            <div id="detail" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
          </div>
        </article>
      </section>
    </main>
  </div>
  <script src="/assets/studio-graph.js"></script>
`;
}
