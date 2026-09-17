import "./style.css";
import "./report-return.css";
import "../components/design-system/language-picker.ts";
import { ExperienceDisplay, experienceLocale, EXPERIENCE_LOCALE_STORAGE_KEY } from "./display-locale.ts";
import { mountExperienceReportReturn, configuredExperienceReportUrl } from "./report-return.ts";
import { definitions, contextCatalog } from "./catalog.ts";
import { canonicalJson } from "./compiler.ts";
import { registeredExperience, parseExperienceEntryRoute } from "./intake.ts";
import { ExperienceIntakeRuntime } from "./intake-runtime.ts";
import { ExperienceView, issueText } from "./view.ts";
import { experienceNavigationAdapter } from "./navigation-adapter.ts";
import type { ExperienceNativeHostAdapter } from "./native-host.ts";
import { createSponsorImageHostSession, type SponsorImageEntrySelector, type SponsorImageHostSession } from "./sponsor-image-host-session.ts";
import type { SponsorImageFetcher } from "./sponsor-image-transport.ts";

/** Explicit dependency injection; a URL, LLM definition or window event cannot register a host. */
export async function startExperience(root: HTMLElement, url: URL, adapter?: ExperienceNativeHostAdapter, signal?: AbortSignal, display = new ExperienceDisplay()) {
  const document = root.ownerDocument;
  const message = (source: string) => {
    const text = display.bindText(document.createElement("p"), source); root.replaceChildren(text);
    return display.subscribe(() => display.refresh(text));
  };
  const selection = parseExperienceEntryRoute(url);
  if (!selection) throw new Error("experience_resume_invalid");
  const id = selection.output;
  if (!id) return message("Select output");
  const release = await registeredExperience(id);
  if (!release) return message("Unavailable");
  const abort = new AbortController(), fetcher = fetch;
  const send: SponsorImageFetcher = (path, init) => fetcher(path, init);
  const window = document.defaultView;
  let disposeRuntime: (() => void) | undefined, unsubscribe: (() => void) | undefined;
  let sponsor: SponsorImageHostSession | undefined, sponsorController: AbortController | undefined;
  let sponsorSelected = false, sponsorEpoch = 0, sponsorSuspended = false, sponsorOpening = false, pageHidden = false;
  let sponsorObserver: MutationObserver | undefined, route = url.href, disposed = false;
  const currentRoute = () => document.location.href;
  const visible = () => !pageHidden && root.isConnected && document.visibilityState !== "hidden" && !root.closest("[hidden],[inert]");
  const selector = (value: NonNullable<ReturnType<typeof parseExperienceEntryRoute>>): SponsorImageEntrySelector => value.draftId ? { draftId: value.draftId } : value.intentId ? { intentId: value.intentId } : { kind: "fresh" };
  const releaseView = () => { unsubscribe?.(); unsubscribe = undefined; disposeRuntime?.(); disposeRuntime = undefined; };
  const releaseSponsor = () => {
    sponsorEpoch++; sponsorController?.abort(); sponsorController = undefined;
    sponsor?.dispose(); sponsor = undefined; releaseView();
  };
  const retire = () => {
    if (disposed) return;
    disposed = true; abort.abort(); releaseSponsor();
    signal?.removeEventListener("abort", retire);
    document.removeEventListener("visibilitychange", selectionVisibility);
    document.removeEventListener("visibilitychange", sponsorVisibility);
    window?.removeEventListener("pagehide", retire);
    window?.removeEventListener("pagehide", sponsorPagehide);
    window?.removeEventListener("pageshow", sponsorPageshow);
    window?.removeEventListener("popstate", sponsorRouteChanged);
    window?.removeEventListener("hashchange", sponsorRouteChanged);
    window?.removeEventListener("forma-route-changed", sponsorRouteChanged);
    window?.removeEventListener("forma-authorization-changed", retire);
    window?.removeEventListener("forma-event-source-retired", retire);
    sponsorObserver?.disconnect(); sponsorObserver = undefined;
  };
  const updateRoute = (runtime: ExperienceIntakeRuntime, sponsorCycle?: number) => {
    if (disposed || sponsorCycle !== undefined && (sponsorEpoch !== sponsorCycle || currentRoute() !== route || !visible())) return;
    const next = new URL(location.href);
    if (runtime.draftId) { next.searchParams.set("draft", runtime.draftId); next.searchParams.delete("intent"); }
    else if (runtime.intentId) { next.searchParams.set("intent", runtime.intentId); next.searchParams.delete("draft"); }
    else { next.searchParams.delete("intent"); next.searchParams.delete("draft"); }
    history.replaceState(null, "", next.pathname + next.search + next.hash);
    if (sponsorCycle !== undefined) route = next.href;
  };
  const suspendSponsor = () => {
    if (!sponsorSelected || disposed) return;
    sponsorSuspended = true; releaseSponsor();
  };
  function sponsorRouteChanged() { if (currentRoute() !== route) retire(); }
  function selectionVisibility() { if (!visible()) retire(); }
  function sponsorVisibility() {
    if (!sponsorSelected || disposed) return;
    if (!root.isConnected || currentRoute() !== route) { retire(); return; }
    if (!visible()) suspendSponsor(); else resumeSponsor();
  }
  function sponsorPagehide() { pageHidden = true; suspendSponsor(); }
  function sponsorPageshow(event: PageTransitionEvent) { if (event.persisted) { pageHidden = false; resumeSponsor(); } }
  function resumeSponsor() {
    if (!sponsorSuspended || sponsorOpening || disposed || !visible() || currentRoute() !== route) return;
    void mountSponsor().catch(() => { if (!disposed && visible() && currentRoute() === route) root.replaceChildren(display.bindText(document.createElement("p"), "Unavailable")); });
  }
  async function mountSponsor(initial?: SponsorImageHostSession) {
    if (disposed || !visible() || currentRoute() !== route) { initial?.dispose(); sponsorSuspended = true; return; }
    const selected = parseExperienceEntryRoute(new URL(route));
    if (!selected || selected.output !== "image") throw new Error("experience_resume_invalid");
    sponsorOpening = true; sponsorSuspended = false;
    const cycle = ++sponsorEpoch;
    const controller = new AbortController(); sponsorController = controller;
    const session = initial ?? createSponsorImageHostSession(selector(selected), send, { signal: controller.signal });
    sponsor = session;
    const current = () => !disposed && sponsorEpoch === cycle && sponsor === session && !session.signal.aborted && visible() && currentRoute() === route;
    try {
      if (!initial && (await session.resolveMode()).mode !== "sponsor-image") throw new Error("sponsor_image_host_unavailable");
      const opened = await session.openSponsor();
      if (!current()) { session.dispose(); opened.runtime.dispose(); return; }
      const runtime = opened.runtime, view = new ExperienceView(root, runtime, adapter, display);
      disposeRuntime = () => { view.dispose(); runtime.dispose(); };
      unsubscribe = runtime.subscribe(() => {
        if (!current()) { suspendSponsor(); return; }
        updateRoute(runtime, cycle);
      });
      // Retained bootstrap already resumed and verified the original receipt.
      // It must not be resumed a second time through an ordinary endpoint.
      updateRoute(runtime, cycle);
    } catch (error) {
      session.dispose();
      if (!disposed && sponsorEpoch === cycle) throw error;
    } finally {
      sponsorOpening = false;
      if (sponsorSuspended && !disposed && visible()) queueMicrotask(resumeSponsor);
    }
  }
  if (signal?.aborted) throw new Error("experience_disposed");
  signal?.addEventListener("abort", retire, { once: true });
  try {
    if (id === "image") {
      const selecting = createSponsorImageHostSession(selector(selection), send, { signal: abort.signal });
      sponsor = selecting;
      // Retirement during metadata selection cannot be lost and then relabeled
      // as a fresh session when the delayed descriptor arrives.
      window?.addEventListener("popstate", sponsorRouteChanged);
      window?.addEventListener("hashchange", sponsorRouteChanged);
      window?.addEventListener("forma-route-changed", sponsorRouteChanged);
      window?.addEventListener("forma-authorization-changed", retire);
      window?.addEventListener("forma-event-source-retired", retire);
      window?.addEventListener("pagehide", retire);
      document.addEventListener("visibilitychange", selectionVisibility);
      if (!visible() || currentRoute() !== route) throw new Error("experience_disposed");
      const mode = await selecting.resolveMode();
      if (abort.signal.aborted) throw new Error("experience_disposed");
      document.removeEventListener("visibilitychange", selectionVisibility);
      window?.removeEventListener("pagehide", retire);
      if (mode.mode === "sponsor-image") {
        sponsorSelected = true;
        document.addEventListener("visibilitychange", sponsorVisibility);
        window?.addEventListener("pagehide", sponsorPagehide);
        window?.addEventListener("pageshow", sponsorPageshow);
        sponsorObserver = new MutationObserver(sponsorVisibility);
        sponsorObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "inert"] });
        await mountSponsor(selecting);
        return retire;
      }
      selecting.dispose(); sponsor = undefined;
      window?.removeEventListener("popstate", sponsorRouteChanged);
      window?.removeEventListener("hashchange", sponsorRouteChanged);
      window?.removeEventListener("forma-route-changed", sponsorRouteChanged);
      window?.removeEventListener("forma-authorization-changed", retire);
      window?.removeEventListener("forma-event-source-retired", retire);
    }
    // The ordinary branch retains its catalog, runtime, resume and host contract.
    const catalog = await fetch("/api/experiences/catalog", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal });
    if (!catalog.ok) { const failure = await catalog.json().catch(() => null) as { error?: unknown } | null; throw new Error(typeof failure?.error === "string" ? failure.error : "experience_catalog_unavailable"); }
    const listing = await catalog.json() as { version?: number; generation?: string; experiences?: unknown[] };
    if (listing.version !== 1 || listing.generation !== "unavailable" || !Array.isArray(listing.experiences) || !listing.experiences.some(item => canonicalJson(item) === canonicalJson(release))) throw new Error("experience_release_changed");
    if (abort.signal.aborted) throw new Error("experience_disposed");
    const runtime = new ExperienceIntakeRuntime(release), view = new ExperienceView(root, runtime, adapter, display);
    disposeRuntime = () => { view.dispose(); runtime.dispose(); };
    abort.signal.addEventListener("abort", disposeRuntime, { once: true });
    unsubscribe = runtime.subscribe(() => updateRoute(runtime));
    if (selection.draftId) await runtime.resume(selection.draftId);
    else if (selection.intentId) await runtime.resume(selection.intentId, true);
    return retire;
  } catch (error) { retire(); throw error; }
}
const navigation = document.querySelector<HTMLElement>("#experience-navigation"), root = document.querySelector<HTMLElement>("#experience-root");
if (navigation && root) {
  let saved: string | null = null;
  try { saved = localStorage.getItem(EXPERIENCE_LOCALE_STORAGE_KEY); } catch { /* Device preference storage may be unavailable. */ }
  const display = new ExperienceDisplay(experienceLocale(saved, navigator.languages, document.documentElement.lang));
  const url = new URL(location.href), nav = document.createElement("nav"); nav.className = "experience-navigation"; display.bindAttribute(nav, "aria-label", "Outputs");
  for (const definition of definitions) { const link = document.createElement("a"); link.href = `/experiences/${definition.id}`; if (url.searchParams.getAll("progress-report").length === 1) { const destination = new URL(link.href); destination.searchParams.set("progress-report", url.searchParams.get("progress-report")!); link.href = destination.href; } display.bindText(link, contextCatalog.outputs[definition.outputContractRef].label); if (url.pathname === link.pathname) link.setAttribute("aria-current", "page"); nav.append(link); }
  const language = document.createElement("forma-ui-language-picker"); language.className = "experience-language";
  display.bindAttribute(language, "label", "Language"); language.value = display.locale;
  navigation.replaceChildren(language, nav);
  let entryStatus = root.querySelector<HTMLElement>('[role="status"]');
  if (entryStatus) display.bindText(entryStatus, "Loading");
  const applyLocale = () => {
    document.documentElement.lang = display.locale; document.documentElement.dir = display.direction;
    document.title = display.translate("Forma · Outputs");
    display.bindAttribute(root, "aria-label", "Output setup"); display.refresh(navigation);
    language.value = display.locale;
    if (entryStatus && root.contains(entryStatus)) display.refresh(entryStatus);
  };
  applyLocale();
  const unsubscribeDisplay = display.subscribe(applyLocale);
  language.addEventListener("forma-change", (event: Event) => {
    const requested = (event as CustomEvent<{ value: string }>).detail?.value;
    if (!display.setLocale(requested)) return;
    try { localStorage.setItem(EXPERIENCE_LOCALE_STORAGE_KEY, display.locale); } catch { /* Device preference storage may be unavailable. */ }
    document.dispatchEvent(new CustomEvent("forma-locale-change", { detail: { locale: display.locale, direction: display.direction }, bubbles: true }));
  });
  const disposeReportReturn = mountExperienceReportReturn(document.body, url.href, configuredExperienceReportUrl);
  let dispose: (() => void) | undefined, retired = false;
  const lifetime = new AbortController();
  void startExperience(root, url, experienceNavigationAdapter(url.href, display), lifetime.signal, display).then(value => { if (retired) value(); else dispose = value; }).catch(error => {
    if (retired) return;
    entryStatus = display.bindText(document.createElement("p"), issueText(error instanceof Error ? error.message : "experience_unavailable")); root.replaceChildren(entryStatus);
  });
  // Retain a BFCache page; ordinary navigation cancels observations and removes private state.
  window.addEventListener("pagehide", event => { if (!event.persisted) { retired = true; lifetime.abort(); dispose?.(); unsubscribeDisplay(); disposeReportReturn(); } });
}
