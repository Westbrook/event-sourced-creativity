import { html, nothing, render } from "lit";
import "forma:public-controls.css";
import "./style.css";
import { FormaPresentationalElement } from "../components/presentational-element";
import type { FormaExperienceSurface } from "./view.ts";
import { definitions, fixtureCatalog } from "./catalog.ts";
import { registeredExperience } from "./intake.ts";
import { ExperienceIntakeRuntime } from "./intake-runtime.ts";
import { classifyExperienceRoute } from "./routes.ts";

/** Shared locale presentation only; this element owns no intake or navigation state. */
class FormaExperienceNavigation extends FormaPresentationalElement {
  static properties = { activeId: {}, chooser: { type: Boolean }, message: {} };
  activeId = "";
  chooser = false;
  message = "";
  override render() {
    return html`<nav class="experience-navigation" aria-label=${this.i18n.system("Outputs")}>${definitions.map(definition => html`<a href=${`/make/${definition.id}`} aria-current=${this.activeId === definition.id ? "page" : nothing}>${this.i18n.system(fixtureCatalog.outputs[definition.outputContractRef].label)}</a>`)}</nav>
      ${this.chooser ? html`<main class="experience experience-chooser"><h1>${this.i18n.system("Choose an output")}</h1><p>${this.i18n.system("Document setup · No generation")}</p></main>` : nothing}
      ${this.message ? html`<p class="experience experience-host-status" role="status">${this.i18n.system(this.message)}</p>` : nothing}`;
  }
}

const navigation = document.querySelector<HTMLElement>("#experience-navigation")!;
const content = document.querySelector<HTMLElement>("#experience-host")!;
let epoch = 0;
let active = false;
let runtime: ExperienceIntakeRuntime | undefined;
let surface: FormaExperienceSurface | undefined;
let unsubscribe: (() => void) | undefined;

function retire() {
  const owner = ++epoch;
  active = false;
  const retiredRuntime = runtime, retiredSurface = surface, release = unsubscribe;
  runtime = undefined; surface = undefined; unsubscribe = undefined;
  let failed = false;
  // Each captured resource is independent; one faulty cleanup cannot skip the others.
  try { release?.(); } catch { failed = true; }
  try { retiredSurface?.remove(); } catch { failed = true; }
  try { if (retiredSurface) retiredSurface.runtime = undefined; } catch { failed = true; }
  if (epoch === owner) try { render(nothing, content); } catch { failed = true; }
  if (epoch === owner) try { render(nothing, navigation); } catch { failed = true; }
  try { retiredRuntime?.dispose(); } catch { failed = true; }
  return { owner, failed };
}

function unavailable(owner: number) {
  if (epoch !== owner) return;
  active = true;
  try {
    const status = customElements.get("forma-experience-navigation")
      ? document.createElement("forma-experience-navigation") as FormaExperienceNavigation
      : document.createElement("p");
    if (epoch !== owner) return;
    if (status instanceof FormaExperienceNavigation) status.message = "Experience unavailable";
    else { status.className = "experience experience-host-status"; status.setAttribute("role", "status"); status.textContent = "Experience unavailable"; }
    if (epoch === owner) render(status, navigation);
  } catch { /* Retired content stays withdrawn even when status rendering fails. */ }
}

function failed(owner: number) {
  if (epoch !== owner) return;
  const retired = retire();
  if (epoch === retired.owner) unavailable(retired.owner);
}

function launch() {
  const retired = retire();
  if (epoch !== retired.owner) return;
  if (retired.failed) { unavailable(retired.owner); return; }
  active = true;
  // The terminal catch owns even failures before bootstrap reaches its local try.
  void bootstrap(retired.owner).catch(() => failed(retired.owner));
}

async function bootstrap(owner: number) {
  let address = location.href;
  const current = () => active && epoch === owner && location.href === address;
  // Preserve the complete raw address, including otherwise invisible empty ?/# delimiters.
  const route = classifyExperienceRoute(address);
  let chrome: FormaExperienceNavigation | undefined;
  try {
    await import("../components/design-system/locale-bootstrap.ts");
    if (!current()) return;
    if (!customElements.get("forma-experience-navigation")) customElements.define("forma-experience-navigation", FormaExperienceNavigation);
    if (!current()) return;
    chrome = document.createElement("forma-experience-navigation") as FormaExperienceNavigation;
    if (!current()) return;
    chrome.activeId = route?.kind === "fresh" || route?.kind === "recover" ? route.experienceId : "";
    chrome.chooser = route?.kind === "chooser";
    chrome.message = route?.kind === "invalid" || !route ? "Invalid experience address" : "";
    render(chrome, navigation);
    if (!current() || !route || route.kind === "invalid" || route.kind === "chooser") return;
    if (route.kind === "retained") {
      // Ask the server for the shipped reader; never mount it in the setup host.
      location.replace(address);
      return;
    }
    chrome.message = route.kind === "recover" ? "Checking result" : "Loading Document setup";
    let admitted: ExperienceIntakeRuntime;
    if (route.kind === "fresh") {
      const release = await registeredExperience(route.experienceId);
      if (!current()) return;
      if (!release) { chrome.message = "Experience unavailable"; return; }
      admitted = new ExperienceIntakeRuntime(release);
    } else {
      admitted = new ExperienceIntakeRuntime({ experienceId: route.experienceId, id: route.id, byIntent: route.byIntent });
    }
    if (!current()) { admitted.dispose(); return; }
    runtime = admitted;
    await import("./view.ts");
    if (!current() || runtime !== admitted) { admitted.dispose(); return; }
    const mounted = document.createElement("forma-experience") as FormaExperienceSurface;
    mounted.runtime = admitted;
    if (!current() || runtime !== admitted) { mounted.runtime = undefined; admitted.dispose(); return; }
    surface = mounted;
    render(mounted, content);
    if (!current() || runtime !== admitted || surface !== mounted) return;
    chrome.message = "";
    const notify = () => {
      if (!current() || runtime !== admitted || surface !== mounted) return;
      const next = new URL(address);
      if (admitted.draftId) { next.searchParams.set("draft", admitted.draftId); next.searchParams.delete("intent"); }
      else if (admitted.intentId) { next.searchParams.set("intent", admitted.intentId); next.searchParams.delete("draft"); }
      else { next.searchParams.delete("draft"); next.searchParams.delete("intent"); }
      const href = next.href;
      if (href === address) return;
      try {
        history.replaceState(null, "", next.pathname + next.search);
        address = href;
      } catch {
        // This binding cannot safely retain its original recovery address.
        if (!current() || runtime !== admitted || surface !== mounted) return;
        retire();
      }
    };
    const release = admitted.subscribe(notify);
    if (!current() || runtime !== admitted || surface !== mounted) { release(); return; }
    unsubscribe = release;
    if (route.kind === "recover") {
      await admitted.recover();
      if (!current() || runtime !== admitted || surface !== mounted) return;
    }
  } catch { if (current()) failed(owner); }
}

window.addEventListener("pagehide", () => retire());
window.addEventListener("pageshow", () => { if (!active) launch(); });
window.addEventListener("popstate", () => launch());
window.addEventListener("hashchange", () => launch());
launch();
