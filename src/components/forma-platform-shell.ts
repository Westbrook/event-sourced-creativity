import { html, nothing } from "lit";
import type { CommandDeparture } from "./command-departure";
import { applicationAccessible, applicationDefinition, applicationIdFromRoute, APPLICATIONS, authorizedApplicationHome, navigationItemAccessible, navigationItemActive } from "../platform/applications";
import { platformSession } from "../platform/session-controller";
import { loadRouteComponent } from "../route-loader";
import { formaLocaleFamily, setFormaLocale } from "./design-system/localization";
import { FormaPresentationalElement } from "./presentational-element";
import { captureOutputNavigationFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import { beginRoutePopulation,completeRoutePopulation,recordPopulationSource } from "../performance";
import "./design-system/navigation";
import "./design-system/language-picker";
import "./forma-platform-assistant.ts";

type PlatformDeparture = Omit<CommandDeparture, "element"> & { readonly element: HTMLElement };
type PlatformDepartureOwner = HTMLElement & { captureCommandDeparture(): PlatformDeparture };

/** Internal task surfaces never import, initialize, observe, or hydrate creator work. */
export class FormaPlatformShell extends FormaPresentationalElement {
  #error = "";
  #loading = true;
  #unsubscribe?: () => void;
  #announcement="";
  #loadRevision = 0;
  #loadFocus: OutputNavigationFocusLease | null = null;
  #resourceRoute = "";
  #departureRefusal: PlatformDeparture | null = null;
  #popstate = () => {
    if (this.#resourceRoute !== location.pathname + location.search) void this.#load();
  };
  #syncKeyboard = () => {
    const viewport = window.visualViewport;
    const offset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    this.style.setProperty("--forma-keyboard-offset", `${Math.round(offset)}px`);
  };

  override connectedCallback() {
    super.connectedCallback();
    this.#unsubscribe = platformSession.subscribe(() => this.requestUpdate());
    window.addEventListener("popstate", this.#popstate);
    window.visualViewport?.addEventListener("resize", this.#syncKeyboard);
    window.visualViewport?.addEventListener("scroll", this.#syncKeyboard);
    this.#syncKeyboard();
    void this.#load();
  }

  override disconnectedCallback() {
    this.#retireLoad();
    this.#unsubscribe?.();
    window.removeEventListener("popstate", this.#popstate);
    window.visualViewport?.removeEventListener("resize", this.#syncKeyboard);
    window.visualViewport?.removeEventListener("scroll", this.#syncKeyboard);
    super.disconnectedCallback();
  }

  #retireLoad() {
    this.#departureRefusal = null;
    this.#loadRevision++;
    this.#loadFocus?.dispose();
    this.#loadFocus = null;
  }

  async #load() {
    if (!this.isConnected) return;
    this.#retireLoad();
    const revision = this.#loadRevision;
    const focus = captureOutputNavigationFocus(this.ownerDocument);
    this.#loadFocus = focus;
    let route = location.pathname + location.search;
    this.#resourceRoute = route;
    const current = () => this.isConnected && revision === this.#loadRevision
      && route === location.pathname + location.search;
    this.#loading = true;
    this.#error = "";
    this.#announcement = "";
    beginRoutePopulation(location.pathname);
    this.requestUpdate();
    try {
      const application = applicationIdFromRoute(location.pathname);
      const session = await platformSession.load(application);
      if (!current()) return;
      const pathname = location.pathname.replace(/\/+$/, "") || "/";
      if (pathname === applicationDefinition(application).home) {
        const destination = authorizedApplicationHome(application, { role: session.user.role, capabilities: session.capabilities, canvasAccess: session.canvas?.access });
        if (destination !== pathname) {
          history.replaceState({}, "", destination);
          route = location.pathname + location.search;
          this.#resourceRoute = route;
          beginRoutePopulation(destination);
        }
      }
      await loadRouteComponent(location.pathname);
      if (!current()) return;
      recordPopulationSource("miss", 0);
      this.#updateTitle();
    } catch (error) {
      if (!current()) return;
      this.#error = error instanceof Error ? error.message : "This workspace could not be opened.";
      this.#updateTitle();
    } finally {
      try {
        if (current()) {
          this.#loading = false;
          this.requestUpdate();
          await this.updateComplete;
          if (current()) {
            const main = this.querySelector<HTMLElement>("#main-content");
            if (main) focus.run(main, () => { main.focus({ preventScroll: true }); return true; });
            // Focus listeners may navigate synchronously. Completion belongs
            // only to the load that still owns this exact route and opening.
            if (current()) {
              completeRoutePopulation(location.pathname);
              this.#announcement = this.#error ? this.i18n.t("shell.accessUnavailable", "Workspace unavailable")
                : document.title.replace(/\s— Forma$/, "");
              this.requestUpdate();
            }
          }
        }
      } finally {
        focus.dispose();
        if (this.#loadFocus === focus) this.#loadFocus = null;
      }
    }
  }

  #updateTitle(){
    const id=applicationIdFromRoute(location.pathname);
    const application=applicationDefinition(id);
    const session=platformSession.get();
    const access={role:session?.user.role,capabilities:session?.capabilities,canvasAccess:session?.canvas?.access};
    const task=application.navigation.find((item)=>navigationItemAccessible(item,access)&&navigationItemActive(id,item.id,location.pathname));
    const workspace=this.i18n.t(`shell.${id}`,application.label);
    const focal=location.pathname.replace(/\/+$/, "").endsWith("/focal-points");
    const heading=focal?this.i18n.t("knowledge.focal.heading","Focal-point comparison"):task?this.i18n.t(`shell.navigation.${task.id}`,task.label):"";
    document.title=heading?`${heading} — ${workspace} — Forma`:`${workspace} — Forma`;
  }

  /** Admit only a current ordinary UI departure; never gate privacy or load retirement. */
  navigateFrom(origin: HTMLElement, path: string): boolean {
    if (!this.isConnected || !origin.isConnected || origin !== this
      && (!this.contains(origin) || origin.closest("forma-platform-shell") !== this)) return false;
    const route = location.pathname + location.search;
    // Selecting the current task is not a request to discard/reload its forms.
    if (path === route || path === route + location.hash) return true;
    const session = platformSession.get(), revision = this.#loadRevision;
    const authority = JSON.stringify([session?.user.userId, session?.audience, session?.permissionEpoch, session?.capabilities]);
    const owners = [...this.querySelectorAll<PlatformDepartureOwner>("forma-product-delivery,forma-platform-assistant,forma-access-management,forma-canvas-governance,forma-actual-replay")]
      .filter(owner => owner.isConnected && owner.closest("forma-platform-shell") === this);
    const captures = owners.map(owner => owner.captureCommandDeparture());
    let retired = false;
    const current = () => {
      if (retired) return false;
      const now = platformSession.get();
      if (!this.isConnected || !origin.isConnected || origin !== this && !this.contains(origin)
        || revision !== this.#loadRevision || route !== location.pathname + location.search || now !== session
        || authority !== JSON.stringify([now?.user.userId, now?.audience, now?.permissionEpoch, now?.capabilities])
        || captures.some(capture => !capture.current())) retired = true;
      return !retired;
    };
    if (!current()) return false;
    const blocked = captures.find(capture => capture.blocked());
    if (!current()) return false;
    if (blocked) {
      this.#departureRefusal = blocked;
      this.requestUpdate();
      return false;
    }
    this.#departureRefusal = null;
    // The intentional handoff is synchronous here. Existing #load owns the
    // ensuing session/module operation and its one native focus lease.
    if (applicationIdFromRoute(path) !== applicationIdFromRoute(location.pathname)) {
      this.#retireLoad();
      location.assign(path);
      return true;
    }
    history.pushState({}, "", path);
    void this.#load();
    return true;
  }

  #navigate(event: Event, path: string) {
    if (event.defaultPrevented) return;
    if ("button" in event) {
      const mouse = event as MouseEvent;
      if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return;
    }
    event.preventDefault();
    this.navigateFrom(this, path);
  }

  #content() {
    const application = applicationIdFromRoute(location.pathname);
    if (application === "operations") return html`<forma-operations-application></forma-operations-application>`;
    if (application === "product") return html`<forma-product-application></forma-product-application>`;
    if (application === "knowledge") return html`<forma-knowledge-application></forma-knowledge-application>`;
    if (application === "engineering") return html`<forma-engineering-application></forma-engineering-application>`;
    return nothing;
  }

  override render() {
    const refusal = this.#departureRefusal;
    const departureReason = refusal?.current() && refusal.blocked() ? this.i18n.t(refusal.reason()) : "";
    const applicationId = applicationIdFromRoute(location.pathname);
    const application = applicationDefinition(applicationId);
    const session = platformSession.get();
    const access = { role: session?.user.role, capabilities: session?.capabilities, canvasAccess: session?.canvas?.access };
    const available = session ? APPLICATIONS.filter((candidate) => session.availableApplications?session.availableApplications.some((application)=>application.id===candidate.id):applicationAccessible(candidate.id, access)) : [];
    const currentLabel = this.i18n.t(`shell.${applicationId}`, application.label);
    const workspaces = available.map((candidate) => ({ label: this.i18n.t(`shell.${candidate.id}`, candidate.label), value: candidate.id, href: session?.availableApplications?.find((application)=>application.id===candidate.id)?.href??authorizedApplicationHome(candidate.id,access), description: this.i18n.t(`shell.description.${candidate.id}`, candidate.description) }));
    const authorizedTasks = application.navigation.filter((item) => navigationItemAccessible(item, access));
    const destinations = authorizedTasks.map((item) => ({ label: this.i18n.t(`shell.navigation.${item.id}`, item.label), value: item.id, href: item.href, description: this.i18n.t(`shell.description.${item.id}`, item.description) }));
    const activeTask = authorizedTasks.find((item) => navigationItemActive(applicationId, item.id, location.pathname))?.id || "";
    return html`<div class="forma-platform-shell shell">
      <a class="skip-link" href="#main-content">${this.i18n.t("shell.skip")}</a>
      <header class="topbar platform-topbar"><a class="brand" href="/projects" @click=${(event: MouseEvent) => this.#navigate(event, "/projects")}>Forma</a><div class="platform-context"><strong>${currentLabel}</strong><span>${this.i18n.t(`shell.description.${applicationId}`, application.description)}</span></div>
        <forma-ui-workspace-switcher .label=${this.i18n.t("navigation.availableWorkspaces", "Available workspaces")} .value=${applicationId} .destinations=${workspaces} @forma-navigate=${(event: CustomEvent<{ value: string; href: string }>) => this.#navigate(event, event.detail.href)}></forma-ui-workspace-switcher>
        <forma-ui-language-picker .label=${this.i18n.t("language.label")} .value=${formaLocaleFamily(this.i18n.locale)} @forma-change=${async (event: CustomEvent<{ value: string }>) => { await setFormaLocale(event.detail.value); this.#updateTitle(); this.#announcement=document.title.replace(/\s— Forma$/,""); this.requestUpdate(); }}></forma-ui-language-picker>
        <a class="button secondary compact" href="/settings" @click=${(event: MouseEvent) => this.#navigate(event, "/settings")}>${this.i18n.t("shell.navigation.settings", "Settings")}</a>
      </header>
      <forma-ui-audience-navigation class="platform-navigation" .label=${currentLabel} .value=${activeTask} .destinations=${destinations} @forma-navigate=${(event: CustomEvent<{ value: string; href: string }>) => this.#navigate(event, event.detail.href)}></forma-ui-audience-navigation>
      ${departureReason ? html`<p class="platform-departure-notice page-pad" role="status" aria-live="polite">${departureReason}</p>` : nothing}
      <main id="main-content" tabindex="-1" aria-busy=${this.#loading ? "true" : "false"}>${this.#loading ? html`<section class="application-loading"><b>${this.i18n.t("shell.loading", "Opening your {application} workspace", { application: currentLabel })}</b></section>` : this.#error ? html`<section class="page-pad" role="alert"><h1>${this.i18n.t("shell.accessUnavailable", "Workspace unavailable")}</h1><p>${this.i18n.system(this.#error)}</p><a href="/projects">${this.i18n.t("shell.returnToProjects", "Return to your projects")}</a></section>` : this.#content()}</main>
      ${!this.#loading && !this.#error && session?.assistant?.enabled && session.assistant.host === "platform"
        ? html`<forma-platform-assistant .route=${location.pathname}></forma-platform-assistant>` : nothing}
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#announcement}</span>
    </div>`;
  }
}

if (!customElements.get("forma-platform-shell")) customElements.define("forma-platform-shell", FormaPlatformShell);
