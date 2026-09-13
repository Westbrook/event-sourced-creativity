import "./style.css";
import "./report-return.css";
import { mountExperienceReportReturn, configuredExperienceReportUrl } from "./report-return.ts";
import { definitions, contextCatalog } from "./catalog.ts";
import { canonicalJson } from "./compiler.ts";
import { registeredExperience, parseExperienceEntryRoute } from "./intake.ts";
import { ExperienceIntakeRuntime } from "./intake-runtime.ts";
import { ExperienceView, issueText } from "./view.ts";
import { experienceNavigationAdapter } from "./navigation-adapter.ts";
import type { ExperienceNativeHostAdapter } from "./native-host.ts";

/** Explicit dependency injection; a URL, LLM definition or window event cannot register a host. */
export async function startExperience(root: HTMLElement, url: URL, adapter?: ExperienceNativeHostAdapter, signal?: AbortSignal) {
  const selection = parseExperienceEntryRoute(url);
  if (!selection) throw new Error("experience_resume_invalid");
  const id = selection.output;
  if (!id) { root.textContent = "Select output"; return () => {}; }
  const release = await registeredExperience(id);
  if (!release) { root.textContent = "Unavailable"; return () => {}; }
  // Server and client independently select the registered definition; a returned
  // self-consistent arbitrary catalog is not admitted as executable UI.
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (signal?.aborted) throw new Error("experience_disposed");
  signal?.addEventListener("abort", cancel, { once: true });
  const catalog = await fetch("/api/experiences/catalog", { credentials: "same-origin", cache: "no-store", redirect: "error", signal: abort.signal });
  if (!catalog.ok) { const failure = await catalog.json().catch(() => null) as { error?: unknown } | null; throw new Error(typeof failure?.error === "string" ? failure.error : "experience_catalog_unavailable"); }
  const listing = await catalog.json() as { version?: number; generation?: string; experiences?: unknown[] };
  if (listing.version !== 1 || listing.generation !== "unavailable" || !Array.isArray(listing.experiences) || !listing.experiences.some(item => canonicalJson(item) === canonicalJson(release))) throw new Error("experience_release_changed");
  if (abort.signal.aborted) throw new Error("experience_disposed");
  const runtime = new ExperienceIntakeRuntime(release), view = new ExperienceView(root, runtime, adapter);
  const disposeRuntime = () => { view.dispose(); runtime.dispose(); };
  abort.signal.addEventListener("abort", disposeRuntime, { once: true });
  const unsubscribe = runtime.subscribe(() => {
    const route = new URL(location.href);
    if (runtime.draftId) { route.searchParams.set("draft", runtime.draftId); route.searchParams.delete("intent"); }
    else if (runtime.intentId) { route.searchParams.set("intent", runtime.intentId); route.searchParams.delete("draft"); }
    else { route.searchParams.delete("intent"); route.searchParams.delete("draft"); }
    history.replaceState(null, "", route.pathname + route.search + route.hash);
  });
  if (selection.draftId) await runtime.resume(selection.draftId);
  else if (selection.intentId) await runtime.resume(selection.intentId, true);
  return () => { signal?.removeEventListener("abort", cancel); abort.abort(); unsubscribe(); disposeRuntime(); };
}

const navigation = document.querySelector<HTMLElement>("#experience-navigation"), root = document.querySelector<HTMLElement>("#experience-root");
if (navigation && root) {
  const url = new URL(location.href), nav = document.createElement("nav"); nav.className = "experience-navigation"; nav.setAttribute("aria-label", "Outputs");
  for (const definition of definitions) { const link = document.createElement("a"); link.href = `/experiences/${definition.id}`; if (url.searchParams.getAll("progress-report").length === 1) { const destination = new URL(link.href); destination.searchParams.set("progress-report", url.searchParams.get("progress-report")!); link.href = destination.href; } link.textContent = contextCatalog.outputs[definition.outputContractRef].label; if (url.pathname === link.pathname) link.setAttribute("aria-current", "page"); nav.append(link); }
  navigation.replaceChildren(nav);
  const disposeReportReturn = mountExperienceReportReturn(document.body, url.href, configuredExperienceReportUrl);
  let dispose: (() => void) | undefined, retired = false;
  const lifetime = new AbortController();
  void startExperience(root, url, experienceNavigationAdapter(url.href), lifetime.signal).then(value => { if (retired) value(); else dispose = value; }).catch(error => { if (!retired) root.textContent = issueText(error instanceof Error ? error.message : "experience_unavailable"); });
  // Retain a BFCache page; ordinary navigation cancels observations and removes private state.
  window.addEventListener("pagehide", event => { if (!event.persisted) { retired = true; lifetime.abort(); dispose?.(); disposeReportReturn(); } });
}
