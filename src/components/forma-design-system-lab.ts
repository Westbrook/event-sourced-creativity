import { html } from "lit";
import { FormaElement, icon } from "./forma-element";
import { creativeNextActions } from "../model/workspace-intelligence";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactDefinition } from "../model/document-artifacts";
import "./area-navigation";
import "./design-primitives";
import "./design-system/component-catalog";
import "./design-system/component-catalog.css";

const palette = [
  { label: "Canvas", token: "--paper" }, { label: "Surface", token: "--panel" }, { label: "Quiet surface", token: "--panel-2" },
  { label: "Text", token: "--ink" }, { label: "Muted text", token: "--muted" }, { label: "Accent", token: "--accent" },
  { label: "Positive", token: "--positive" }, { label: "Warning", token: "--warning" }, { label: "Danger", token: "--danger" },
];

/** Living, route-addressable component documentation built from production primitives. */
export class FormaDesignSystemLab extends FormaElement {
  #fieldValue = "An atmospheric opening";
  #example = "Creative";

  override render() {
    const projection = this.store.projection.get();
    const actions = creativeNextActions({ blocks: projection.blocks, outputs: projection.outputs, artifacts: projection.artifacts });
    return html`<section class="admin-page administrative-page design-system-lab">
      <header class="page-header page-header--admin"><div class="page-header-copy"><span>Laboratory</span><h1>Design system</h1><p>A living inventory of accessible product foundations, reusable interface parts, and outcome-led workflows.</p></div><div class="page-header-actions"><forma-ui-badge label="Production components" tone="positive"></forma-ui-badge></div></header>
      <forma-area-navigation area="laboratory" active="design-system"></forma-area-navigation>
      <div class="design-lab-content">
        <forma-component-catalog></forma-component-catalog>
        <section class="design-lab-section"><header><div><span>01 · Foundations</span><h2>The work comes first</h2><p>A semantic, preference-reactive palette; browser-scaled typography; and one spacing system across every application.</p></div></header>
          <div class="design-palette">${palette.map((item) => html`<article><span class="design-swatch" style=${`--swatch-color:var(${item.token})`} aria-label=${item.label}></span><b>${item.label}</b><code>${item.token}</code></article>`)}</div>
          <div class="design-foundation-grid"><article><h3>Typography</h3><p class="design-type-display">Clarity without noise</p><p class="design-type-body">Readable body copy respects browser preferences. Component labels and supporting explanations start at 0.875rem.</p><small>Captions explain state; they never replace content.</small></article><article><h3>Spacing</h3><div class="design-spacing-scale">${[1, 2, 3, 4, 5, 6, 8, 12].map((step) => html`<div><span style=${`--space-example:var(--space-${step})`}></span><code>--space-${step}</code></div>`)}</div></article></div>
        </section>
        <section class="design-lab-section"><header><div><span>02 · Atoms</span><h2>Small, predictable decisions</h2><p>Every control has a visible state, an accessible name, and a stable layout.</p></div></header>
          <div class="design-example-row"><forma-ui-button label="Primary action" variant="primary" icon-name="spark"></forma-ui-button><forma-ui-button label="Secondary action"></forma-ui-button><forma-ui-button label="Quiet action" variant="ghost"></forma-ui-button><forma-ui-button label="Unavailable" disabled></forma-ui-button><forma-ui-button label="Saving" busy></forma-ui-button></div>
          <div class="design-example-row"><forma-ui-badge label="Ready" tone="positive"></forma-ui-badge><forma-ui-badge label="Draft" tone="accent"></forma-ui-badge><forma-ui-badge label="Needs review" tone="warning"></forma-ui-badge><forma-ui-badge label="Could not finish" tone="danger"></forma-ui-badge></div>
        </section>
        <section class="design-lab-section"><header><div><span>03 · Molecules</span><h2>Meaning before decoration</h2><p>Fields, search, metrics, and disclosure patterns stay understandable wherever they appear.</p></div></header>
          <div class="design-molecule-grid"><forma-ui-field label="Creative direction" .value=${this.#fieldValue} help="Explain the outcome, not the underlying system." @forma-input=${(event: CustomEvent<{ value: string }>) => { this.#fieldValue = event.detail.value; }}></forma-ui-field><forma-ui-field label="Audience" placeholder="Client team, festival audience…" help="Optional; previously used values appear when available."></forma-ui-field><forma-ui-field label="Project name" value="" error="Add a name before continuing." required></forma-ui-field></div>
          <div class="design-metric-grid"><forma-ui-metric label="Projects" .value=${String(projection.projects.length)} detail="Independent creative workspaces"></forma-ui-metric><forma-ui-metric label="Reusable decisions" .value=${String(projection.libraryBlocks.length)} detail="Available across the current project"></forma-ui-metric><forma-ui-metric label="Finished outputs" .value=${String(projection.libraryOutputs.length + projection.libraryArtifacts.length)} detail="Images, stories, scenes, slides, and motion"></forma-ui-metric></div>
          <forma-ui-disclosure class="design-disclosure"><span slot="summary">Progressive disclosure</span><p>Diagnostics and technical receipts remain available without competing with the primary creative task.</p></forma-ui-disclosure>
        </section>
        <section class="design-lab-section"><header><div><span>04 · Organisms</span><h2>Reusable product patterns</h2><p>Output choices and context-aware next steps belong to the same system across Document, Canvas, and Library.</p></div></header>
          <div class="design-output-catalog">${DOCUMENT_ARTIFACT_KINDS.map((kind) => { const definition = documentArtifactDefinition(kind); return html`<article><span aria-hidden="true">${icon(kind === "video" ? "video" : kind === "slides" ? "layers" : kind === "storyboard" ? "image" : "story")}</span><div><h3>${definition.label}</h3><p>${definition.description}</p></div></article>`; })}</div>
          ${actions.length ? html`<div class="design-next-actions"><h3>Relevant to your current document</h3>${actions.map((action) => html`<article><div><b>${action.label}</b><p>${action.reason}</p></div><forma-ui-badge .label=${`${action.evidence} supporting signal${action.evidence === 1 ? "" : "s"}`}></forma-ui-badge></article>`)}</div>` : html`<forma-ui-empty-state heading="Begin with a clear intention" detail="A small amount of context unlocks relevant next steps without showing unnecessary controls." action="Create a project" @forma-action=${() => this.store.setRoute("/projects")}></forma-ui-empty-state>`}
        </section>
        <section class="design-lab-section"><header><div><span>05 · Templates</span><h2>One product, multiple working modes</h2><p>Each application exposes the same durable work through the vocabulary appropriate to its active task.</p></div></header>
          <div class="design-template-switch" role="group" aria-label="Example application">${["Creative", "Canvas", "Operations", "Laboratory"].map((name) => html`<button type="button" aria-pressed=${this.#example === name ? "true" : "false"} @click=${() => { this.#example = name; this.requestUpdate(); }}>${name}</button>`)}</div>
          <article class="design-template-preview"><header><div><small>${this.#example}</small><h3>${this.#example === "Creative" ? "Shape the work" : this.#example === "Canvas" ? "Arrange the possibilities" : this.#example === "Operations" ? "Understand system health" : "Explore and verify"}</h3><p>${this.#example === "Creative" ? "Documents, reusable context, and every output format." : this.#example === "Canvas" ? "Spatial thinking over the same projects, decisions, and finished work." : this.#example === "Operations" ? "Private governance, trustworthy diagnostics, and actionable reporting." : "Isolated, safe experiments using the exact same product primitives."}</p></div><forma-ui-button label="Continue" variant="primary" icon-name="arrow" @forma-press=${() => this.store.setRoute(this.#example === "Creative" ? "/" : this.#example === "Canvas" ? "/canvas" : this.#example === "Operations" ? "/operations" : "/laboratory")}></forma-ui-button></header></article>
        </section>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-design-system-lab")) customElements.define("forma-design-system-lab", FormaDesignSystemLab);
