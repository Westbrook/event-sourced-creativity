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

/** Explicit dependency injection; a URL, LLM definition or window event cannot register a host. */
export async function startExperience(root: HTMLElement, url: URL, adapter?: ExperienceNativeHostAdapter, signal?: AbortSignal, display = new ExperienceDisplay()) {
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
  // Server and client independently select the registered definition; a returned
  // self-consistent arbitrary catalog is not admitted as executable UI.
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (signal?.aborted) throw new Error("experience_disposed");
  signal?.addEventListener("abort", cancel, { once: true });
  let disposeRuntime: (() => void) | undefined, unsubscribe: (() => void) | undefined;
  try {
    const catalog = await fetch("/api/experiences/catalog", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal });
    if (!catalog.ok) { const failure = await catalog.json().catch(() => null) as { error?: unknown } | null; throw new Error(typeof failure?.error === "string" ? failure.error : "experience_catalog_unavailable"); }
    const listing = await catalog.json() as { version?: number; generation?: string; experiences?: unknown[] };
    if (listing.version !== 1 || listing.generation !== "unavailable" || !Array.isArray(listing.experiences) || !listing.experiences.some(item => canonicalJson(item) === canonicalJson(release))) throw new Error("experience_release_changed");
    if (abort.signal.aborted) throw new Error("experience_disposed");
    const runtime = new ExperienceIntakeRuntime(release), view = new ExperienceView(root, runtime, adapter, display);
    disposeRuntime = () => { view.dispose(); runtime.dispose(); };
    abort.signal.addEventListener("abort", disposeRuntime, { once: true });
    unsubscribe = runtime.subscribe(() => {
      const route = new URL(location.href);
      if (runtime.draftId) { route.searchParams.set("draft", runtime.draftId); route.searchParams.delete("intent"); }
      else if (runtime.intentId) { route.searchParams.set("intent", runtime.intentId); route.searchParams.delete("draft"); }
      else { route.searchParams.delete("intent"); route.searchParams.delete("draft"); }
      history.replaceState(null, "", route.pathname + route.search + route.hash);
    });
    if (selection.draftId) await runtime.resume(selection.draftId);
    else if (selection.intentId) await runtime.resume(selection.intentId, true);
    return () => { signal?.removeEventListener("abort", cancel); abort.abort(); unsubscribe?.(); disposeRuntime?.(); };
  } catch (error) {
    signal?.removeEventListener("abort", cancel); abort.abort(); unsubscribe?.(); disposeRuntime?.(); throw error;
  }
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
