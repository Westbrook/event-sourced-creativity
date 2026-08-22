import { html } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { FormaIconName } from "./icons";
import { creativeNextActions } from "../model/workspace-intelligence";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactDefinition } from "../model/document-artifacts";
import "./icons-authoring";
import "./icons-canvas";
import "./icons-formatting";
import "./icons-history";
import "./icons-media";
import "./icons-navigation";
import "./area-navigation";
import "./design-primitives";
import "./design-system/component-catalog";
import "./design-system/component-catalog.css";

const palette = [
  { id: "canvas", label: "Canvas", token: "--paper" }, { id: "surface", label: "Surface", token: "--panel" }, { id: "quiet", label: "Quiet surface", token: "--panel-2" },
  { id: "text", label: "Text", token: "--ink" }, { id: "muted", label: "Muted text", token: "--muted" }, { id: "accent", label: "Accent", token: "--accent" },
  { id: "positive", label: "Positive", token: "--positive" }, { id: "warning", label: "Warning", token: "--warning" }, { id: "danger", label: "Danger", token: "--danger" },
];

const iconFamilies: ReadonlyArray<{
  key: string;
  label: string;
  icons: ReadonlyArray<{ name: FormaIconName; label: string }>;
}> = [
  { key: "navigation", label: "Navigation", icons: [{ name: "home", label: "Home" }, { name: "folder", label: "Folder" }, { name: "grid", label: "Library" }, { name: "back", label: "Back" }] },
  { key: "authoring", label: "Creative actions", icons: [{ name: "spark", label: "Create" }, { name: "edit", label: "Edit" }, { name: "undo", label: "Undo" }, { name: "redo", label: "Redo" }] },
  { key: "formatting", label: "Text formatting", icons: [{ name: "bold", label: "Bold" }, { name: "italic", label: "Italic" }, { name: "bullets", label: "List" }, { name: "link", label: "Link" }] },
  { key: "media", label: "Creative outputs", icons: [{ name: "image", label: "Image" }, { name: "story", label: "Story" }, { name: "slides", label: "Slides" }, { name: "video", label: "Video" }] },
  { key: "canvas", label: "Canvas tools", icons: [{ name: "select", label: "Select" }, { name: "marquee", label: "Marquee" }, { name: "scope", label: "Scope" }, { name: "focal-point", label: "Focal point" }] },
  { key: "states", label: "Feedback and access", icons: [{ name: "check", label: "Complete" }, { name: "warning", label: "Warning" }, { name: "lock", label: "Locked" }, { name: "unlock", label: "Unlocked" }] },
  { key: "operations", label: "Operations", icons: [{ name: "clock", label: "History" }, { name: "replay", label: "Replay" }, { name: "branch", label: "Branch" }, { name: "flask", label: "Experiment" }] },
];

/** Living, route-addressable component documentation built from production primitives. */
export class FormaDesignSystemLab extends FormaElement {
  #fieldValue = "";
  #example: "creative" | "canvas" | "operations" | "laboratory" = "creative";

  override render() {
    const projection = this.store.projection.get();
    const actions = creativeNextActions({ blocks: projection.blocks, outputs: projection.outputs, artifacts: projection.artifacts });
    return html`<section class="admin-page administrative-page design-system-lab">
      <header class="page-header page-header--admin"><div class="page-header-copy"><span>${this.i18n.t("shell.laboratory", "Laboratory")}</span><h1>${this.i18n.t("lab.heading", "Design system")}</h1><p>${this.i18n.t("lab.description", "A living inventory of accessible product foundations, reusable interface parts, and outcome-led workflows.")}</p></div><div class="page-header-actions"><forma-ui-badge .label=${this.i18n.t("lab.production", "Production components")} tone="positive"></forma-ui-badge></div></header>
      <forma-area-navigation area="laboratory" active="design-system"></forma-area-navigation>
      <div class="design-lab-content">
        <forma-component-catalog></forma-component-catalog>
        <section class="design-lab-section"><header><div><span>${this.i18n.t("lab.foundationLabel", "01 · Foundations")}</span><h2>${this.i18n.t("lab.foundationHeading", "The work comes first")}</h2><p>${this.i18n.t("lab.foundationDescription", "A semantic, preference-reactive palette; browser-scaled typography; and one spacing system across every application.")}</p></div></header>
          <div class="design-palette">${palette.map((item) => { const label = this.i18n.t(`palette.${item.id}`, item.label); return html`<article><span class="design-swatch" style=${`--swatch-color:var(${item.token})`} aria-label=${label}></span><b>${label}</b><code dir="ltr">${item.token}</code></article>`; })}</div>
          <div class="design-foundation-grid"><article><h3>${this.i18n.t("lab.typography", "Typography")}</h3><p class="design-type-display">${this.i18n.t("lab.clarity", "Clarity without noise")}</p><p class="design-type-body">${this.i18n.t("lab.typographyDetail", "Readable body copy respects browser preferences. Component labels and supporting explanations start at 0.875rem.")}</p><small>${this.i18n.t("lab.captionDetail", "Captions explain state; they never replace content.")}</small></article><article><h3>${this.i18n.t("lab.spacing", "Spacing")}</h3><div class="design-spacing-scale">${[1, 2, 3, 4, 5, 6, 8, 12].map((step) => html`<div><span style=${`--space-example:var(--space-${step})`}></span><code dir="ltr">--space-${step}</code></div>`)}</div></article></div>
          <section class="design-icon-system" aria-labelledby="design-icon-system-heading">
            <header><div><h3 id="design-icon-system-heading">${this.i18n.t("lab.iconHeading", "One unmistakable visual language")}</h3><p>${this.i18n.t("lab.iconDescription", "Phosphor Regular gives every action the same precise, quietly expressive silhouette. Icons arrive with their existing page and never replace an accessible name.")}</p></div><div class="design-icon-sizes" role="group" aria-label=${this.i18n.t("lab.iconSizes", "Icon sizes: {small}, {medium}, and {large} pixels", { small: this.i18n.number(16), medium: this.i18n.number(20), large: this.i18n.number(24) })}>${(["small", "medium", "large"] as const).map((size) => html`<span><forma-ui-icon name="spark" .size=${size}></forma-ui-icon><small>${this.i18n.number(size === "small" ? 16 : size === "medium" ? 20 : 24)}</small></span>`)}</div></header>
            <div class="design-icon-families">${iconFamilies.map((family) => html`<article><h4>${this.i18n.t(`lab.iconFamily.${family.key}`, family.label)}</h4><ul>${family.icons.map((item) => html`<li><forma-ui-icon .name=${item.name}></forma-ui-icon><span>${this.i18n.t(`lab.icon.${item.name}`, item.label)}</span><code dir="ltr">${item.name}</code></li>`)}</ul></article>`)}</div>
          </section>
        </section>
        <section class="design-lab-section"><header><div><span>${this.i18n.t("lab.atomsLabel", "02 · Atoms")}</span><h2>${this.i18n.t("lab.atomsHeading", "Small, predictable decisions")}</h2><p>${this.i18n.t("lab.atomsDescription", "Every control has a visible state, an accessible name, and a stable layout.")}</p></div></header>
          <div class="design-example-row"><forma-ui-button .label=${this.i18n.t("lab.primary", "Primary action")} value="primary" variant="primary" icon-name="spark"></forma-ui-button><forma-ui-button .label=${this.i18n.t("lab.secondary", "Secondary action")} value="secondary"></forma-ui-button><forma-ui-button .label=${this.i18n.t("lab.quiet", "Quiet action")} value="quiet" variant="ghost"></forma-ui-button><forma-ui-button .label=${this.i18n.t("lab.unavailable", "Unavailable")} disabled></forma-ui-button><forma-ui-button .label=${this.i18n.t("lab.saving", "Saving")} busy></forma-ui-button></div>
          <div class="design-example-row"><forma-ui-badge .label=${this.i18n.t("sample.ready", "Ready")} tone="positive"></forma-ui-badge><forma-ui-badge .label=${this.i18n.t("sample.draft", "Draft")} tone="accent"></forma-ui-badge><forma-ui-badge .label=${this.i18n.t("sample.review", "Needs review")} tone="warning"></forma-ui-badge><forma-ui-badge .label=${this.i18n.t("lab.error", "Could not finish")} tone="danger"></forma-ui-badge></div>
        </section>
        <section class="design-lab-section"><header><div><span>${this.i18n.t("lab.moleculesLabel", "03 · Molecules")}</span><h2>${this.i18n.t("lab.moleculesHeading", "Meaning before decoration")}</h2><p>${this.i18n.t("lab.moleculesDescription", "Fields, search, metrics, and disclosure patterns stay understandable wherever they appear.")}</p></div></header>
          <div class="design-molecule-grid"><form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-field .label=${this.i18n.t("lab.direction", "Creative direction")} .value=${this.#fieldValue} .placeholder=${this.i18n.t("sample.quietOpening", "An atmospheric opening")} .help=${this.i18n.t("lab.directionHelp", "Explain the outcome, not the underlying system.")} @forma-input=${(event: CustomEvent<{ value: string }>) => { this.#fieldValue = event.detail.value; }}></forma-ui-field></form><form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-field .label=${this.i18n.t("lab.audience", "Audience")} .placeholder=${this.i18n.t("lab.audiencePlaceholder", "Client team, festival audience…")} .help=${this.i18n.t("lab.audienceHelp", "Optional; previously used values appear when available.")}></forma-ui-field></form><form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-field .label=${this.i18n.t("lab.projectName", "Project name")} value="" .error=${this.i18n.t("lab.projectError", "Add a name before continuing.")} required></forma-ui-field></form></div>
          <div class="design-metric-grid"><forma-ui-metric .label=${this.i18n.t("shell.navigation.projects", "Projects")} .value=${this.i18n.number(projection.projects.length)} .detail=${this.i18n.t("lab.projectsDetail", "Independent creative workspaces")}></forma-ui-metric><forma-ui-metric .label=${this.i18n.t("lab.decisions", "Reusable decisions")} .value=${this.i18n.number(projection.libraryBlocks.length)} .detail=${this.i18n.t("lab.decisionsDetail", "Available across the current project")}></forma-ui-metric><forma-ui-metric .label=${this.i18n.t("lab.outputs", "Finished outputs")} .value=${this.i18n.number(projection.libraryOutputs.length + projection.libraryArtifacts.length)} .detail=${this.i18n.t("lab.outputsDetail", "Images, stories, scenes, slides, and motion")}></forma-ui-metric></div>
          <forma-ui-disclosure class="design-disclosure"><span slot="summary">${this.i18n.t("lab.disclosure", "Progressive disclosure")}</span><p>${this.i18n.t("lab.disclosureDetail", "Diagnostics and technical receipts remain available without competing with the primary creative task.")}</p></forma-ui-disclosure>
        </section>
        <section class="design-lab-section"><header><div><span>${this.i18n.t("lab.organismsLabel", "04 · Organisms")}</span><h2>${this.i18n.t("lab.organismsHeading", "Reusable product patterns")}</h2><p>${this.i18n.t("lab.organismsDescription", "Output choices and context-aware next steps belong to the same system across Document, Canvas, and Library.")}</p></div></header>
          <div class="design-output-catalog">${DOCUMENT_ARTIFACT_KINDS.map((kind) => { const definition = documentArtifactDefinition(kind); return html`<article><span aria-hidden="true">${icon(kind === "video" ? "video" : kind === "slides" ? "slides" : kind === "storyboard" ? "storyboard" : kind === "scene" ? "scene" : "story")}</span><div><h3>${this.i18n.t(`artifact.${kind}.label`, definition.label)}</h3><p>${this.i18n.t(`artifact.${kind}.description`, definition.description)}</p></div></article>`; })}</div>
          ${actions.length ? html`<div class="design-next-actions"><h3>${this.i18n.t("lab.relevant", "Relevant to your current document")}</h3>${actions.map((action) => html`<article><div><b>${this.i18n.t(`next.${action.id}.label`, action.label)}</b><p>${this.i18n.t(`next.${action.id}.reason`, action.reason, { count: this.i18n.number(action.evidence) })}</p></div><forma-ui-badge .label=${this.i18n.plural("lab.supporting", action.evidence, "{count} supporting signal", "{count} supporting signals")}></forma-ui-badge></article>`)}</div>` : html`<forma-ui-empty-state .heading=${this.i18n.t("lab.emptyHeading", "Begin with a clear intention")} .detail=${this.i18n.t("lab.emptyDetail", "A small amount of context unlocks relevant next steps without showing unnecessary controls.")} .action=${this.i18n.t("lab.emptyAction", "Create a project")} @forma-action=${() => this.store.setRoute("/projects")}></forma-ui-empty-state>`}
        </section>
        <section class="design-lab-section"><header><div><span>${this.i18n.t("lab.templatesLabel", "05 · Templates")}</span><h2>${this.i18n.t("lab.templatesHeading", "One product, multiple working modes")}</h2><p>${this.i18n.t("lab.templatesDescription", "Each application exposes the same durable work through the vocabulary appropriate to its active task.")}</p></div></header>
          <div class="design-template-switch" role="group" aria-label=${this.i18n.t("lab.exampleApplication", "Example application")}>${(["creative", "canvas", "operations", "laboratory"] as const).map((id) => html`<button type="button" aria-pressed=${this.#example === id ? "true" : "false"} @click=${() => { this.#example = id; this.requestUpdate(); }}>${this.i18n.t(`shell.${id}`, id)}</button>`)}</div>
          <article class="design-template-preview"><header><div><small>${this.i18n.t(`shell.${this.#example}`, this.#example)}</small><h3>${this.i18n.t(`lab.${this.#example}Heading`, this.#example === "creative" ? "Shape the work" : this.#example === "canvas" ? "Arrange the possibilities" : this.#example === "operations" ? "Understand system health" : "Explore and verify")}</h3><p>${this.i18n.t(`lab.${this.#example}Detail`, this.#example === "creative" ? "Documents, reusable context, and every output format." : this.#example === "canvas" ? "Spatial thinking over the same projects, decisions, and finished work." : this.#example === "operations" ? "Private governance, trustworthy diagnostics, and actionable reporting." : "Isolated, safe experiments using the exact same product primitives.")}</p></div><forma-ui-button .label=${this.i18n.t("action.continue", "Continue")} value="continue" variant="primary" icon-name="arrow" @forma-press=${() => this.store.setRoute(this.#example === "creative" ? "/" : this.#example === "canvas" ? "/canvas" : this.#example === "operations" ? "/operations" : "/laboratory")}></forma-ui-button></header></article>
        </section>
      </div>
    </section>`;
  }
}

if (!customElements.get("forma-design-system-lab")) customElements.define("forma-design-system-lab", FormaDesignSystemLab);
