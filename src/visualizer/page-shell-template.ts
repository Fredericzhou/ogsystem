import { escapeHtml } from "./html-escape.js";
import type { Locale, MessageKey } from "./i18n/index.js";

type PageShellTranslator = (key: MessageKey) => string;

export type PageShellBodyOptions = {
  workdir: string;
  locale: Locale;
  t: PageShellTranslator;
};

export function renderPageShellBody({ workdir, locale, t }: PageShellBodyOptions): string {
  return `<body>
  <div id="sidebar-overlay" class="sidebar-overlay"></div>
  <div class="app">
    <div class="shell content">
      <aside id="sidebar" class="sidebar">
        <div class="stack">
          <input id="search" class="search" placeholder="${escapeHtml(t("search.placeholder"))}" aria-label="${escapeHtml(t("search.placeholder"))}" />
          <div id="run-list" class="run-list"></div>
        </div>
      </aside>
      <header class="top-nav">
        <div class="top-nav-row top-nav-row-primary">
          <div class="top-nav-brand">
            <div class="brand-lockup">
              <h1>${escapeHtml(t("app.title"))}</h1>
              <span>${escapeHtml(t("app.local"))}</span>
            </div>
            <div class="top-nav-meta">
              <button id="sidebar-toggle" class="button subtle sidebar-toggle" aria-controls="sidebar" aria-expanded="false">${escapeHtml(t("hero.runs"))}</button>
              <div class="pill">${escapeHtml(t("app.workdir"))} <code id="workdir">${escapeHtml(workdir)}</code></div>
            </div>
          </div>
          <div class="top-nav-center">
            <nav id="console-tabs" class="console-tabs" aria-label="${escapeHtml(t("app.sections"))}"></nav>
            <div class="hero-utilities">
              <button id="refresh" class="button subtle">${escapeHtml(t("action.refresh"))}</button>
              <label class="field locale-field">
                <span>${escapeHtml(t("app.locale"))}</span>
                <select id="locale-select" class="select">
                  <option value="en"${locale === "en" ? " selected" : ""}>English</option>
                  <option value="zh-CN"${locale === "zh-CN" ? " selected" : ""}>中文</option>
                </select>
              </label>
            </div>
          </div>
          <div class="top-nav-actions">
            <div class="actions hero-actions hero-actions-primary">
              <button id="hero-validate" class="button primary">${escapeHtml(t("action.validate"))}</button>
              <button id="hero-save" class="button subtle">${escapeHtml(t("action.save"))}</button>
              <button id="resume-run" class="button">${escapeHtml(t("action.resume"))}</button>
              <button id="stop-run" class="button warn">${escapeHtml(t("action.stop"))}</button>
              <button id="hero-reindex" class="button subtle">${escapeHtml(t("action.reindex"))}</button>
              <button id="hero-release-export" class="button primary">${escapeHtml(t("action.exportProject"))}</button>
            </div>
          </div>
        </div>
      </header>
      <main class="main-stage">
        <div id="flash" class="flash hidden" role="status" aria-live="polite" aria-atomic="true"></div>
        <div class="stage-stack">
          <section class="grid" id="action-form-section" hidden role="dialog" aria-modal="true" aria-labelledby="action-form-title">
            <article class="card span-12">
              <header><h3 id="action-form-title">${escapeHtml(t("section.actionForm"))}</h3></header>
              <div class="body">
                <div id="action-form" class="form-shell"><div class="hint">${escapeHtml(t("form.emptyHint"))}</div></div>
              </div>
            </article>
          </section>
          <section id="console-panel-project" class="console-panel grid" data-console-panel="project" role="tabpanel" aria-labelledby="console-tab-project" hidden>
            <article class="card span-12">
              <header><h3>${escapeHtml(t("section.projectOverview"))}</h3></header>
              <div class="body">
                <div id="project-wizard">${escapeHtml(t("state.loadingProject"))}</div>
              </div>
            </article>
          </section>
          <section id="console-panel-build" class="console-panel grid" data-console-panel="build" role="tabpanel" aria-labelledby="console-tab-design" hidden>
              <article class="card span-12">
                <div class="body">
                  <div class="workbench-state-cache" hidden aria-hidden="true">
                    <h3 id="workbench-title">${escapeHtml(t("section.mermaidWorkbench"))}</h3>
                    <div id="workbench-meta" class="hint">${escapeHtml(t("workbench.defaultMeta"))}</div>
                    <div id="workbench-tabs" class="segmented build-mode-tabs"></div>
                    <div id="workbench-actions" class="actions"></div>
                  </div>
                  <div id="workbench-body" class="build-ide-shell build-ide-body"></div>
                </div>
              </article>
            </section>
          <section id="console-panel-debug" class="console-panel grid operate-workspace" data-console-panel="debug" role="presentation" hidden>
            <div id="operate-tabs" class="segmented operate-tabs span-12" role="tablist" aria-label="${escapeHtml(t("operate.tablist"))}"></div>
            <section id="operate-tabpanel-overview" class="grid span-12" role="tabpanel" aria-labelledby="operate-tab-overview">
              <article class="card span-12 operate-panel operate-overview">
                <header><h3>${escapeHtml(t("section.runSnapshot"))}</h3></header>
                <div class="body">
                  <div class="stat-grid" id="stats"></div>
                </div>
              </article>
              <article class="card span-12 operate-panel operate-overview">
                <header><div class="toolbar-row"><h3>${escapeHtml(t("section.timeline"))}</h3><div class="actions"><button id="timeline-conversation" class="button subtle" type="button">${escapeHtml(t("timeline.conversation"))}</button></div></div></header>
                <div class="body">
                  <div class="row timeline-controls">
                    <select id="timeline-role" class="select">
                      <option value="">${escapeHtml(t("timeline.allRoles"))}</option>
                    </select>
                    <input id="timeline-type" class="select" placeholder="${escapeHtml(t("timeline.eventType"))}" aria-label="${escapeHtml(t("timeline.eventType"))}" />
                    <select id="timeline-status" class="select">
                      <option value="">${escapeHtml(t("timeline.allStatuses"))}</option>
                      <option value="pending">${escapeHtml(t("status.pending"))}</option>
                      <option value="paused">${escapeHtml(t("status.paused"))}</option>
                      <option value="running">${escapeHtml(t("status.running"))}</option>
                      <option value="stopped">${escapeHtml(t("status.stopped"))}</option>
                      <option value="terminated">${escapeHtml(t("status.terminated"))}</option>
                      <option value="done">${escapeHtml(t("status.done"))}</option>
                      <option value="failed">${escapeHtml(t("status.failed"))}</option>
                      <option value="waiting_review">${escapeHtml(t("status.waitingReview"))}</option>
                    </select>
                    <input id="timeline-branch" class="select" placeholder="${escapeHtml(t("timeline.branchId"))}" aria-label="${escapeHtml(t("timeline.branchId"))}" />
                    <input id="timeline-review" class="select" placeholder="${escapeHtml(t("timeline.reviewId"))}" aria-label="${escapeHtml(t("timeline.reviewId"))}" />
                    <input id="timeline-error" class="select" placeholder="${escapeHtml(t("timeline.errorCode"))}" aria-label="${escapeHtml(t("timeline.errorCode"))}" />
                    <select id="timeline-channel" class="select" aria-label="${escapeHtml(t("timeline.channel"))}">
                      <option value="">${escapeHtml(t("timeline.allChannels"))}</option>
                      <option value="main">${escapeHtml(t("timeline.channelMain"))}</option>
                      <option value="error">${escapeHtml(t("timeline.channelError"))}</option>
                      <option value="loop">${escapeHtml(t("timeline.channelLoop"))}</option>
                      <option value="join">${escapeHtml(t("timeline.channelJoin"))}</option>
                      <option value="feedback">${escapeHtml(t("timeline.channelFeedback"))}</option>
                    </select>
                    <button id="timeline-apply" class="button subtle">${escapeHtml(t("action.applyFilters"))}</button>
                    <button id="timeline-clear" class="button subtle">${escapeHtml(t("action.clearFilters"))}</button>
                  </div>
                  <div id="timeline" class="timeline"></div>
                </div>
              </article>
            </section>
            <section id="operate-tabpanel-graph" class="grid span-12" role="tabpanel" aria-labelledby="operate-tab-graph" hidden>
              <article class="card span-12 operate-panel operate-graph">
                <header><h3>${escapeHtml(t("section.graphView"))}</h3></header>
                <div class="body debug-graph-body operate-graph-shell">
                  <section class="operate-graph-main">
                    <div id="graph-view" class="structure-list operate-graph-view"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
                  </section>
                  <aside class="operate-graph-sidebar">
                    <div id="state" class="structure-list operate-graph-state"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
                  </aside>
                </div>
              </article>
            </section>
            <section id="operate-tabpanel-recovery" class="grid span-12" role="tabpanel" aria-labelledby="operate-tab-recovery" hidden>
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
            <section id="operate-tabpanel-reviews" class="grid span-12" role="tabpanel" aria-labelledby="operate-tab-reviews" hidden>
              <article class="card span-6 operate-panel operate-reviews">
                <header><h3>${escapeHtml(t("section.reviewQueue"))}</h3></header>
                <div class="body">
                  <div id="reviews" class="timeline"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
                  <div id="review-actions" class="actions"></div>
                  <div id="review-detail" class="structure-list">${escapeHtml(t("state.noReviewSelected"))}</div>
                </div>
              </article>
            </section>
          </section>
          <section id="console-panel-ops" class="console-panel grid" data-console-panel="ops" role="region" aria-labelledby="console-tab-operate" hidden>
            <article class="card span-12 operate-panel operate-overview">
              <header><h3>${escapeHtml(t("section.opsSummary"))}</h3></header>
              <div class="body">
                <div id="ops-summary" class="structure-list">${escapeHtml(t("state.loadingOpsSummary"))}</div>
              </div>
            </article>
          </section>
          <section id="console-panel-validate-release" class="console-panel grid" data-console-panel="validate-release" role="tabpanel" aria-labelledby="console-tab-release" hidden>
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
          <section id="console-panel-config" class="console-panel grid" data-console-panel="config" role="region" aria-label="${escapeHtml(t("section.configExplain"))}" hidden>
            <article class="card span-12">
              <header><h3>${escapeHtml(t("section.configExplain"))}</h3></header>
              <div class="body">
                <div id="binding-explain" class="structure-list">${escapeHtml(t("state.loadingBindingResolution"))}</div>
                <div id="role-packages" class="structure-list">${escapeHtml(t("state.loadingRolePackages"))}</div>
                <div id="contract-explain" class="structure-list">${escapeHtml(t("state.loadingContracts"))}</div>
              </div>
            </article>
          </section>
          <section id="console-panel-logs" class="console-panel grid" data-console-panel="logs" role="tabpanel" aria-labelledby="operate-tab-logs" hidden>
            <article class="card span-12 operate-panel operate-logs">
              <header>
                <div class="toolbar-row">
                  <div class="toolbar-group">
                    <h3>${escapeHtml(t("section.logs"))}</h3>
                    <div id="logs-controls" class="actions"></div>
                  </div>
                  <div class="log-toolbar">
                    <select id="log-role" class="select" aria-label="${escapeHtml(t("logs.roleLogs"))}">
                    <option value="">${escapeHtml(t("timeline.allRoles"))}</option>
                    </select>
                    <select id="log-page-size" class="select" aria-label="Log page size">
                      <option value="100">100</option>
                      <option value="500">500</option>
                      <option value="1000">1000</option>
                    </select>
                    <select id="logs-all" class="select" aria-label="Log scope">
                      <option value="">${escapeHtml(t("logs.all"))}</option>
                    </select>
                    <input id="log-tail" class="select" type="number" min="1" placeholder="${escapeHtml(t("logs.tail"))}" aria-label="${escapeHtml(t("logs.tail"))}" />
                    <input id="log-since" class="select" type="datetime-local" aria-label="Log since" />
                  </div>
                </div>
              </header>
              <div class="body">
                <div id="logs-filters" class="hint"></div>
                <div id="logs" class="structure-list">${escapeHtml(t("state.noRunSelected"))}</div>
              </div>
            </article>
          </section>
          <section id="console-panel-artifacts" class="console-panel grid" data-console-panel="artifacts" role="tabpanel" aria-labelledby="operate-tab-artifacts" hidden>
            <article class="card span-12 operate-panel operate-artifacts">
              <header><h3>${escapeHtml(t("section.artifacts"))}</h3></header>
              <div class="body">
                <div id="detail" class="structure-list"><div class="hint">${escapeHtml(t("state.noRunSelected"))}</div></div>
              </div>
            </article>
          </section>
        </div>
      </main>
      <footer class="status-bar global-status">
        <div class="global-status-primary">
          <div id="global-status-context" class="global-status-context pill">${escapeHtml(t("state.idle"))}</div>
          <div id="global-status-diagnostics" class="global-status-diagnostics hint"></div>
          <div id="workbench-status" class="toolbar-group global-status-workbench-status"></div>
        </div>
        <div class="actions global-status-actions">
          <div id="live" class="live">${escapeHtml(t("state.idle"))}</div>
        </div>
      </footer>
    </div>
  </div>
  <script src="/assets/studio-graph.js"></script>
`;
}
