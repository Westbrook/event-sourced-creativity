import { html, nothing } from "lit";
import { applicationAccessible, applicationDefinition, applicationIdFromRoute, APPLICATIONS, authorizedApplicationHome, navigationItemAccessible, navigationItemActive } from "../platform/applications";
import { platformSession } from "../platform/session-controller";
import { loadRouteComponent } from "../route-loader";
import { formaLocaleFamily, setFormaLocale } from "./design-system/localization";
import { FormaPresentationalElement } from "./presentational-element";
import { beginRoutePopulation,completeRoutePopulation,recordPopulationSource } from "../performance";
import "./design-system/navigation";
import "./design-system/language-picker";
import "./forma-platform-assistant.ts";

/** Internal task surfaces never import, initialize, observe, or hydrate creator work. */
export class FormaPlatformShell extends FormaPresentationalElement {
  #error = "";
  #loading = true;
  #unsubscribe?: () => void;
  #announcement="";
  #popstate = () => { void this.#load(); };
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
    this.#unsubscribe?.();
    window.removeEventListener("popstate", this.#popstate);
    window.visualViewport?.removeEventListener("resize", this.#syncKeyboard);
    window.visualViewport?.removeEventListener("scroll", this.#syncKeyboard);
    super.disconnectedCallback();
  }

  async #load() {
    this.#loading = true;
    beginRoutePopulation(location.pathname);
    this.requestUpdate();
    try {
      const application = applicationIdFromRoute(location.pathname);
      const session=await platformSession.load(application);
      const pathname=location.pathname.replace(/\/+$/,"")||"/";
      if(pathname===applicationDefinition(application).home){
        const destination=authorizedApplicationHome(application,{role:session.user.role,capabilities:session.capabilities,canvasAccess:session.canvas?.access});
        if(destination!==pathname){history.replaceState({},"",destination);beginRoutePopulation(destination);}
      }
      await loadRouteComponent(location.pathname);
      this.#error = "";
      recordPopulationSource("miss",0);
      this.#updateTitle();
    } catch (error) {
      this.#error = error instanceof Error ? error.message : "This workspace could not be opened.";
    } finally {
      this.#loading = false;
      this.requestUpdate();
      await this.updateComplete;
      this.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
      completeRoutePopulation(location.pathname);
      this.#announcement=document.title.replace(/\s— Forma$/,"");
      this.requestUpdate();
    }
  }

  #updateTitle(){
    const id=applicationIdFromRoute(location.pathname);
    const application=applicationDefinition(id);
    const session=platformSession.get();
    const access={role:session?.user.role,capabilities:session?.capabilities,canvasAccess:session?.canvas?.access};
    const task=application.navigation.find((item)=>navigationItemAccessible(item,access)&&navigationItemActive(id,item.id,location.pathname));
    const workspace=this.i18n.t(`shell.${id}`,application.label);
    const focal=location.pathname.endsWith("/focal-points");
    const heading=focal?this.i18n.t("knowledge.focal.heading","Focal-point comparison"):task?this.i18n.t(`shell.navigation.${task.id}`,task.label):"";
    document.title=heading?`${heading} — ${workspace} — Forma`:`${workspace} — Forma`;
  }

  #navigate(event: Event, path: string) {
    event.preventDefault();
    if (applicationIdFromRoute(path) !== applicationIdFromRoute(location.pathname)) {
      location.assign(path);
      return;
    }
    history.pushState({}, "", path);
    void this.#load();
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
      <header class="topbar platform-topbar"><a class="brand" href="/projects">Forma</a><div class="platform-context"><strong>${currentLabel}</strong><span>${this.i18n.t(`shell.description.${applicationId}`, application.description)}</span></div>
        <forma-ui-workspace-switcher .label=${this.i18n.t("navigation.availableWorkspaces", "Available workspaces")} .value=${applicationId} .destinations=${workspaces} @forma-navigate=${(event: CustomEvent<{ value: string; href: string }>) => this.#navigate(event, event.detail.href)}></forma-ui-workspace-switcher>
        <forma-ui-language-picker .label=${this.i18n.t("language.label")} .value=${formaLocaleFamily(this.i18n.locale)} @forma-change=${async (event: CustomEvent<{ value: string }>) => { await setFormaLocale(event.detail.value); this.#updateTitle(); this.#announcement=document.title.replace(/\s— Forma$/,""); this.requestUpdate(); }}></forma-ui-language-picker>
        <a class="button secondary compact" href="/settings">${this.i18n.t("shell.navigation.settings", "Settings")}</a>
      </header>
      <forma-ui-audience-navigation class="platform-navigation" .label=${currentLabel} .value=${activeTask} .destinations=${destinations} @forma-navigate=${(event: CustomEvent<{ value: string; href: string }>) => this.#navigate(event, event.detail.href)}></forma-ui-audience-navigation>
      <main id="main-content" tabindex="-1" aria-busy=${this.#loading ? "true" : "false"}>${this.#loading ? html`<section class="application-loading"><b>${this.i18n.t("shell.loading", "Opening your {application} workspace", { application: currentLabel })}</b></section>` : this.#error ? html`<section class="page-pad" role="alert"><h1>${this.i18n.t("shell.accessUnavailable", "Workspace unavailable")}</h1><p>${this.i18n.system(this.#error)}</p><a href="/projects">${this.i18n.t("shell.returnToProjects", "Return to your projects")}</a></section>` : this.#content()}</main>
      ${!this.#loading && !this.#error && session?.assistant?.enabled && session.assistant.host === "platform"
        ? html`<forma-platform-assistant .route=${location.pathname}></forma-platform-assistant>` : nothing}
      <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">${this.#announcement}</span>
    </div>`;
  }
}

if (!customElements.get("forma-platform-shell")) customElements.define("forma-platform-shell", FormaPlatformShell);
