import { html, render } from "lit";
import "../../../src/styles.css";
import "../../../src/design-system.css";
import "./style.css";
import "./fixture.css";
import { definitions, fixtureCatalog } from "./catalog.ts";
import { compileExperience } from "./compiler.ts";
import { proposePatch } from "./patches.ts";
import { ExperienceRuntime } from "./runtime.ts";
import "./view.ts";
import type { FormaExperienceFixture } from "./view.ts";

const host = document.querySelector<FormaExperienceFixture>("forma-experience-fixture")!;
const controls = document.querySelector<HTMLElement>("#fixture-controls")!;
const runtimes = new Map<string, ExperienceRuntime>();
let selected = "image", experiment = "baseline", serial = 0;
let status = "";
async function select() {
  const token = ++serial;
  let runtime = runtimes.get(selected);
  if (!runtime) {
    const definition = definitions.find(item => item.id === selected)!;
    const compiled = await compileExperience(definition, fixtureCatalog);
    if (!compiled.ok) { status = "Definition unavailable"; drawControls(); return; }
    runtime = new ExperienceRuntime(compiled.release);
    runtimes.set(selected, runtime);
  }
  if (token !== serial) return;
  host.runtime = runtime;
  runtime.availability(experiment !== "incompatible" && experiment !== "unknown");
  if (experiment === "unknown") {
    const rejected = await compileExperience({ ...runtime.release.definition, outputContractRef: "unknown.single@1" }, fixtureCatalog);
    if (token !== serial) return;
    if (rejected.ok) throw new Error("unknown_output_was_not_rejected");
  }
  if (experiment === "reordered" || experiment === "stacked") {
    const proposal = await proposePatch(runtime.release, { schemaVersion: 1, baseReleaseHash: runtime.release.releaseHash, operations: experiment === "reordered" ? [{ kind: "reorder-decisions", ids: runtime.release.definition.decisions.map(item => item.id).reverse() }] : [{ kind: "set-layout", layout: "stacked-stage" }] }, fixtureCatalog);
    if (token !== serial) return;
    if (proposal.ok) runtime.previewPresentation(proposal.candidate);
  } else runtime.previewPresentation(runtime.release);
  status = experiment === "unknown" ? "Unknown output · Creation unavailable" : experiment === "incompatible" ? "Incompatible capability · Creation unavailable" : "Fixture · Local only";
  drawControls();
}
function drawControls() {
  render(html`<nav class="fixture-toolbar" aria-label="Fixture controls"><label>Output<select .value=${selected} @change=${(event: Event) => { selected = (event.target as HTMLSelectElement).value; void select(); }}>${definitions.map(item => html`<option value=${item.id}>${fixtureCatalog.outputs[item.outputContractRef].label}</option>`)}</select></label><label>Interface<select .value=${experiment} @change=${(event: Event) => { experiment = (event.target as HTMLSelectElement).value; void select(); }}><option value="baseline">Baseline</option><option value="reordered">Reordered</option><option value="stacked">Stacked</option><option value="incompatible">Incompatible capability</option><option value="unknown">Unknown output</option></select></label><label>Appearance<select @change=${(event: Event) => { document.documentElement.style.colorScheme = (event.target as HTMLSelectElement).value; }}><option value="light dark">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><span role="status">${status}</span></nav>`, controls);
}
drawControls();
void select();
window.addEventListener("pagehide", event => { if (!event.persisted) for (const runtime of runtimes.values()) runtime.dispose(); });
