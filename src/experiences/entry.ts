import { html, render } from "lit";
import "../styles.css";
import "../design-system.css";
import "./style.css";
import "./view.ts";
import type { FormaExperienceSurface } from "./view.ts";
import { definitions, fixtureCatalog } from "./catalog.ts";
import { registeredExperience } from "./intake.ts";
import { ExperienceIntakeRuntime } from "./intake-runtime.ts";

const host = document.querySelector<FormaExperienceSurface>("forma-experience")!;
const nav = document.querySelector<HTMLElement>("#experience-navigation")!;
const url = new URL(location.href);
const id = url.pathname.split("/")[2] || "image";
let runtime: ExperienceIntakeRuntime | undefined;
render(html`<nav class="experience-navigation" aria-label="Outputs">${definitions.map(definition => html`<a href=${`/make/${definition.id}`} aria-current=${id === definition.id ? "page" : "false"}>${fixtureCatalog.outputs[definition.outputContractRef].label}</a>`)}</nav>`, nav);
async function start() {
  const release = await registeredExperience(id);
  if (!release) { host.textContent = "Experience unavailable"; return; }
  runtime = new ExperienceIntakeRuntime(release);
  host.runtime = runtime;
  runtime.subscribe(() => {
    const route = new URL(location.href);
    if (runtime!.draftId) { route.searchParams.set("draft", runtime!.draftId); route.searchParams.delete("intent"); }
    else if (runtime!.intentId) { route.searchParams.set("intent", runtime!.intentId); route.searchParams.delete("draft"); }
    else { route.searchParams.delete("intent"); route.searchParams.delete("draft"); }
    history.replaceState(null, "", route.pathname + route.search);
  });
  if (url.searchParams.get("draft")) await runtime.resume(url.searchParams.get("draft")!);
  else if (url.searchParams.get("intent")) await runtime.resume(url.searchParams.get("intent")!, true);
}
void start();
window.addEventListener("pagehide", event => { if (!event.persisted) runtime?.dispose(); });
