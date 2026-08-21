import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { FormaPresentationalElement } from "../presentational-element";
import { renderApplicationPatternPreview } from "./application-pattern-previews";
import { copyInterfaceText } from "./clipboard";
import { componentCatalog, componentLevels, type ComponentCatalogEntry, type ComponentLevel } from "./catalog";
import "../design-primitives";
import "./atoms";
import "./forms";
import "./navigation";
import "./feedback";
import "./layout";

type ManifestMember = { kind: string; name: string; type?: { text: string }; attribute?: string; default?: string; description?: string };
type ManifestAttribute = { name: string; fieldName?: string; type?: { text: string }; default?: string; description?: string };
type ManifestEvent = { name: string; type?: { text: string }; description?: string };
type ManifestCssProperty = { name: string; syntax?: string; description?: string };
type ManifestSlot = { name: string; description?: string };
type ManifestDeclaration = { tagName?: string; name: string; summary?: string; description?: string; members?: ManifestMember[]; attributes?: ManifestAttribute[]; events?: ManifestEvent[]; cssProperties?: ManifestCssProperty[]; slots?: ManifestSlot[] };
type ManifestDocument = { modules?: Array<{ declarations?: ManifestDeclaration[] }> };
type ReactiveOptions = { attribute?: string | boolean; type?: unknown; reflect?: boolean };
type ReactiveConstructor = CustomElementConstructor & { elementProperties?: Map<PropertyKey, ReactiveOptions>; observedAttributes?: string[] };

let manifestPromise: Promise<Map<string, ManifestDeclaration>> | undefined;

async function loadComponentManifest() {
  manifestPromise ??= fetch("/custom-elements.json", { headers: { Accept: "application/json" } })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Component reference returned ${response.status}.`);
      const payload = await response.json() as ManifestDocument;
      return new Map((payload.modules ?? []).flatMap((module) => module.declarations ?? [])
        .filter((declaration) => declaration.tagName)
        .map((declaration) => [declaration.tagName!, declaration]));
    })
    .catch((error) => {
      manifestPromise = undefined;
      throw error;
    });
  return manifestPromise;
}

const choices = [
  { label: "Draft", value: "draft", description: "Quick creative exploration" },
  { label: "Full quality", value: "full", description: "Ready to share" },
];

const themePresets = {
  original: { label: "Forma blue", style: "" },
  violet: { label: "Violet", style: "--forma-color-accent:light-dark(#5a36a3,#c6a7ff);--forma-color-accent-text:light-dark(#5a36a3,#d5bbff);--forma-color-accent-subtle:light-dark(#f0ebfa,#30233f);--forma-color-on-accent:light-dark(#fff,#171717)" },
  forest: { label: "Forest", style: "--forma-color-accent:light-dark(#155d45,#80cba8);--forma-color-accent-text:light-dark(#15503c,#99dfbd);--forma-color-accent-subtle:light-dark(#eaf3ef,#20382e);--forma-color-on-accent:light-dark(#fff,#171717)" },
} as const;

/**
 * @tag forma-component-catalog
 * @summary Searchable, store-independent live component reference with canonical on-demand API metadata.
 * @cssprop {<color>} --forma-color-accent - Local catalog action and focus accent.
 * @cssprop {<length>} --forma-control-min-size - Minimum catalog interaction target size.
 */
export class FormaComponentCatalog extends FormaPresentationalElement {
  #query = "";
  #level: "all" | ComponentLevel = "all";
  #message = "";
  #manifest?: Map<string, ManifestDeclaration>;
  #manifestError = "";
  #manifestLoading = false;
  #preset: keyof typeof themePresets = "original";
  #density = "comfortable";
  #radius = "default";
  #openApis = new Set<string>();
  #reflectedSlots = new Map<string, ManifestSlot[]>();

  protected override firstUpdated() {
    let hash = "";
    try { hash = decodeURIComponent(window.location.hash.slice(1)); }
    catch { return; }
    if (!hash || !componentCatalog.some((item) => item.tag === hash)) return;
    const target = this.querySelector<HTMLElement>(`#${CSS.escape(hash)}`);
    target?.scrollIntoView({ block: "start" });
    target?.focus({ preventScroll: true });
  }

  #filter(event: CustomEvent<{ value: string }>) { this.#query = event.detail.value; this.requestUpdate(); }
  #levelChange(value: "all" | ComponentLevel) { this.#level = value; this.requestUpdate(); }
  #clear() { this.#query = ""; this.#level = "all"; this.#message = "Showing every available component."; this.requestUpdate(); void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".component-library-search input")?.focus({ preventScroll: true })); }
  #demo(event: Event) {
    if (event instanceof CustomEvent && event.cancelable) event.preventDefault();
    const target = event.target as HTMLElement | null;
    const label = target?.getAttribute("label") || target?.getAttribute("heading") || target?.getAttribute("action") || target?.textContent?.trim() || event.type.replace("forma-", "");
    this.#message = `Preview interaction: ${label}. No project data was changed.`;
    this.requestUpdate();
  }

  async #copy(entry: ComponentCatalogEntry) {
    const success = await copyInterfaceText(entry.example);
    this.#message = success ? `${entry.title} example copied to the clipboard.` : "Could not copy automatically. Select the example text and copy it manually.";
    this.requestUpdate();
  }

  async #openApi(event: Event) {
    const details = event.currentTarget as HTMLDetailsElement;
    const tag = details.dataset.componentTag;
    if (!tag) return;
    if (!details.open) { this.#openApis.delete(tag); this.requestUpdate(); return; }
    if (!this.#reflectedSlots.has(tag)) {
      const root = details.closest("article")?.querySelector(`.component-preview > ${tag}`)?.shadowRoot;
      if (root) {
        const reflected = new Map([...root.querySelectorAll("slot")].map((slot) => [slot.name, { name: slot.name }]));
        this.#reflectedSlots.set(tag, [...reflected.values()].sort((left, right) => left.name.localeCompare(right.name)));
      }
    }
    this.#openApis.add(tag);
    this.requestUpdate();
    if (this.#manifest || this.#manifestLoading) return;
    this.#manifestLoading = true;
    this.#manifestError = "";
    this.requestUpdate();
    try {
      const manifest = await loadComponentManifest();
      if (this.isConnected) this.#manifest = manifest;
    } catch {
      if (this.isConnected) this.#manifestError = "Complete API details could not be loaded. The component examples remain available.";
    } finally {
      this.#manifestLoading = false;
      if (this.isConnected) this.requestUpdate();
    }
  }

  #basicAttributes(tag: string): ManifestAttribute[] {
    const constructor = customElements.get(tag) as ReactiveConstructor | undefined;
    if (!constructor) return [];
    if (!constructor.elementProperties) return (constructor.observedAttributes ?? []).map((name) => ({ name, fieldName: name, type: { text: "string" } }));
    return [...constructor.elementProperties.entries()]
      .filter(([, options]) => options.attribute !== false)
      .map(([key, options]) => {
        const fieldName = String(key);
        const type = options.type === Boolean ? "boolean" : options.type === Number ? "number" : options.type === Array ? "Array" : options.type === Object ? "object" : "string";
        return { name: typeof options.attribute === "string" ? options.attribute : fieldName.toLocaleLowerCase(), fieldName, type: { text: type } };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  #preview(entry: ComponentCatalogEntry): TemplateResult | typeof nothing {
    if (!entry.preview) return nothing;
    switch (entry.tag) {
      case "forma-ui-theme": return html`<forma-ui-theme radius="soft"><forma-ui-badge label="Scoped theme" tone="accent"></forma-ui-badge></forma-ui-theme>`;
      case "forma-ui-button": return html`<forma-ui-cluster><forma-ui-button label="Save direction" icon-name="check" variant="primary"></forma-ui-button><forma-ui-button label="Not available" disabled></forma-ui-button></forma-ui-cluster>`;
      case "forma-ui-icon-button": return html`<forma-ui-icon-button icon-name="close" label="Close preview"></forma-ui-icon-button>`;
      case "forma-ui-icon": return html`<forma-ui-icon name="spark" label="Creative idea"></forma-ui-icon>`;
      case "forma-ui-badge": return html`<forma-ui-cluster gap="small"><forma-ui-badge label="Ready" tone="positive"></forma-ui-badge><forma-ui-badge label="Needs review" tone="warning"></forma-ui-badge></forma-ui-cluster>`;
      case "forma-ui-avatar": return html`<forma-ui-avatar name="Avery Park"></forma-ui-avatar>`;
      case "forma-ui-chip": return html`<forma-ui-chip label="Needs review" value="review"></forma-ui-chip>`;
      case "forma-ui-status": return html`<forma-ui-status label="Saved safely" tone="positive"></forma-ui-status>`;
      case "forma-ui-progress": return html`<forma-ui-progress label="Preparing images" value="72" show-value></forma-ui-progress>`;
      case "forma-ui-kbd": return html`<forma-ui-kbd keys="⌘ K" label="Command and K"></forma-ui-kbd>`;
      case "forma-ui-divider": return html`<forma-ui-divider label="Optional details"></forma-ui-divider>`;
      case "forma-ui-skeleton": return html`<forma-ui-skeleton lines="2"></forma-ui-skeleton>`;
      case "forma-ui-link": return html`<forma-ui-link href="#forma-ui-link" label="Open reference"></forma-ui-link>`;
      case "forma-ui-field": return html`<forma-ui-field label="Creative direction" value="A quiet opening" help="Describe the outcome you want."></forma-ui-field>`;
      case "forma-ui-search": return html`<forma-ui-search label="Search finished work" placeholder="Try landscape"></forma-ui-search>`;
      case "forma-ui-textarea": return html`<forma-ui-textarea label="Supporting context" rows="2" value="Keep the central object clear."></forma-ui-textarea>`;
      case "forma-ui-select": return html`<forma-ui-select label="Output quality" value="draft" .options=${choices}></forma-ui-select>`;
      case "forma-ui-checkbox": return html`<forma-ui-checkbox label="Include supporting context" checked></forma-ui-checkbox>`;
      case "forma-ui-switch": return html`<forma-ui-switch label="Show technical details"></forma-ui-switch>`;
      case "forma-ui-radio-group": return html`<forma-ui-radio-group label="Generation quality" name="library-demo-quality" value="draft" .options=${choices}></forma-ui-radio-group>`;
      case "forma-ui-number-field": return html`<forma-ui-number-field label="Preview width" value="1024" min="256" step="64"></forma-ui-number-field>`;
      case "forma-ui-metric": return html`<forma-ui-metric label="Finished outputs" value="24" detail="Ready to share"></forma-ui-metric>`;
      case "forma-ui-segmented-control": return html`<forma-ui-segmented-control label="Preview quality" value="draft" .options=${choices}></forma-ui-segmented-control>`;
      case "forma-ui-tabs": return html`<forma-ui-tabs label="Output details" value="draft" .options=${choices}></forma-ui-tabs>`;
      case "forma-ui-breadcrumbs": return html`<forma-ui-breadcrumbs .items=${[{ label: "Projects", value: "#forma-ui-breadcrumbs" }, { label: "Summer campaign", value: "#forma-ui-breadcrumbs" }]}></forma-ui-breadcrumbs>`;
      case "forma-ui-pagination": return html`<forma-ui-pagination label="Result pages" page="2" total="8"></forma-ui-pagination>`;
      case "forma-ui-toolbar": return html`<forma-ui-toolbar label="Document actions" .actions=${[{ label: "Undo", value: "undo" }, { label: "Redo", value: "redo" }]}></forma-ui-toolbar>`;
      case "forma-ui-notice": return html`<forma-ui-notice tone="positive"><forma-ui-icon slot="leading" name="check"></forma-ui-icon><strong slot="heading">Your work is saved</strong><p>Every change is available. <a href="#forma-ui-notice" @click=${(event: MouseEvent) => { event.preventDefault(); this.#demo(event); }}>View history</a>.</p><forma-ui-button slot="actions" label="Review"></forma-ui-button></forma-ui-notice>`;
      case "forma-ui-disclosure": return html`<forma-ui-disclosure><span slot="summary">View supporting details</span><p>Nothing is sent until <strong>you confirm</strong>.</p></forma-ui-disclosure>`;
      case "forma-ui-copy-button": return html`<forma-ui-copy-button label="Copy sample" value="Forma component reference"></forma-ui-copy-button>`;
      case "forma-ui-list-item": return html`<forma-ui-list-item><forma-ui-avatar slot="leading" name="Avery Park" initials="AP"></forma-ui-avatar><strong slot="heading">Summer campaign</strong><p>Three directions are ready.</p><forma-ui-badge slot="trailing" label="Ready" tone="positive"></forma-ui-badge><forma-ui-button slot="trailing" label="Open"></forma-ui-button></forma-ui-list-item>`;
      case "forma-ui-stack": return html`<forma-ui-stack gap="small"><forma-ui-badge label="Draft"></forma-ui-badge><forma-ui-status label="Ready for feedback" tone="positive"></forma-ui-status></forma-ui-stack>`;
      case "forma-ui-cluster": return html`<forma-ui-cluster gap="small"><forma-ui-badge label="Image"></forma-ui-badge><forma-ui-badge label="Draft" tone="accent"></forma-ui-badge></forma-ui-cluster>`;
      case "forma-ui-surface": return html`<forma-ui-surface padded><forma-ui-metric label="Ideas worth keeping" value="12"></forma-ui-metric></forma-ui-surface>`;
      case "forma-ui-popover": return html`<forma-ui-popover label="Project options" heading="Manage project" .actions=${[{ label: "Rename project", value: "rename" }, { label: "View activity", value: "activity" }]}></forma-ui-popover>`;
      case "forma-ui-dialog": return html`<forma-ui-dialog trigger="Open review" heading="Keep this direction?" detail="Your earlier work remains available." confirm="Keep direction"></forma-ui-dialog>`;
      case "forma-ui-card": return html`<forma-ui-card><div slot="media" class="component-media-preview" role="img" aria-label="Soft blue and warm summer campaign color study"></div><span slot="eyebrow">Summer campaign</span><h4 slot="heading">One direction is ready</h4><p>Compare <strong>three creative directions</strong>.</p><forma-ui-button slot="actions" label="Review"></forma-ui-button><forma-ui-button slot="actions" label="Save" variant="ghost"></forma-ui-button></forma-ui-card>`;
      case "forma-ui-empty-state": return html`<forma-ui-empty-state heading="Begin with one clear intention" detail="A little context unlocks useful next steps." action="Create an idea" level="4"></forma-ui-empty-state>`;
      case "forma-ui-page-header": return html`<forma-ui-page-header><span slot="eyebrow">Creative workspace</span><h4 slot="heading">Shape the work</h4><p>Start with <strong>the outcome you want</strong>.</p><forma-ui-button slot="actions" label="New idea" variant="primary"></forma-ui-button><forma-ui-button slot="actions" label="Browse"></forma-ui-button></forma-ui-page-header>`;
      default: return nothing;
    }
  }

  #api(entry: ComponentCatalogEntry) {
    const declaration = this.#manifest?.get(entry.tag);
    const attributes = declaration?.attributes ?? this.#basicAttributes(entry.tag);
    const properties = declaration?.members?.filter((member) => member.kind === "field") ?? [];
    const propertyOnly = properties.filter((member) => !member.attribute);
    const events = declaration?.events ?? [];
    const tokens = declaration?.cssProperties ?? [];
    const slots = declaration ? declaration.slots ?? [] : this.#reflectedSlots.get(entry.tag) ?? [];
    const acceptsActions = slots.some((slot) => slot.name === "actions" || slot.name === "trailing");
    return html`<div class="component-api-body">
      <section><h4>Markup</h4><pre><code>${entry.example}</code></pre><button type="button" class="button secondary component-copy" @click=${() => this.#copy(entry)}>Copy example</button>${entry.fallbackExample ? html`<details class="component-fallback-example"><summary>Attribute-only shorthand</summary><pre><code>${entry.fallbackExample}</code></pre></details>` : nothing}</section>
      ${slots.length ? html`<section><h4>Content slots</h4><div class="component-api-table-wrap"><table><thead><tr><th scope="col">Slot</th><th scope="col">Accepted content</th></tr></thead><tbody>${slots.map((slot) => html`<tr><th scope="row"><code>${slot.name || "Main content (default)"}</code></th><td>${slot.description ?? "Authored component content."}</td></tr>`)}</tbody></table></div>${acceptsActions ? html`<p class="component-slot-guidance">Authored buttons and links keep their own native click and form behavior. Built-in attribute-based actions emit the component events documented below.</p>` : nothing}</section>` : nothing}
      <section><h4>Attributes</h4>${attributes.length ? html`<div class="component-api-table-wrap"><table><thead><tr><th>Attribute</th><th>Type</th><th>Default</th><th>Description</th></tr></thead><tbody>${attributes.map((attribute) => html`<tr><th scope="row"><code>${attribute.name}</code></th><td><code>${attribute.type?.text ?? "string"}</code></td><td><code>${attribute.default ?? "—"}</code></td><td>${attribute.description ?? "—"}</td></tr>`)}</tbody></table></div>` : html`<p>No configurable HTML attributes are exposed.</p>`}</section>
      ${propertyOnly.length ? html`<section><h4>JavaScript-only properties</h4><ul>${propertyOnly.map((property) => html`<li><code>.${property.name}</code> <code>${property.type?.text ?? "unknown"}</code></li>`)}</ul></section>` : nothing}
      ${events.length ? html`<section><h4>Events</h4><ul>${events.map((event) => html`<li><code>${event.name}</code> <code>${event.type?.text ?? "CustomEvent"}</code>${event.description ? html`<span>${event.description}</span>` : nothing}</li>`)}</ul></section>` : nothing}
      ${tokens.length ? html`<section><h4>Theme tokens</h4><ul>${tokens.map((token) => html`<li><code>${token.name}</code>${token.description ? html`<span>${token.description}</span>` : nothing}</li>`)}</ul></section>` : nothing}
      ${this.#manifestLoading && !declaration ? html`<p class="component-api-loading">Loading the complete API reference…</p>` : nothing}
      ${this.#manifestError ? html`<div class="component-api-error" role="alert"><p>${this.#manifestError}</p><button type="button" class="button secondary" @click=${(event: MouseEvent) => { (event.currentTarget as HTMLElement).closest("details")?.querySelector("summary")?.focus({ preventScroll: true }); this.#manifestError = ""; this.#manifestLoading = false; void this.#retryApi(); }}>Retry API details</button></div>` : nothing}
    </div>`;
  }

  async #retryApi() {
    this.#manifestLoading = true;
    this.requestUpdate();
    try { const manifest = await loadComponentManifest(); if (this.isConnected) this.#manifest = manifest; }
    catch { if (this.isConnected) this.#manifestError = "Complete API details are still unavailable. The downloadable reference may help."; }
    finally { this.#manifestLoading = false; if (this.isConnected) this.requestUpdate(); }
  }

  #entry(entry: ComponentCatalogEntry) {
    const applicationComposition = entry.previewKind === "application-composition";
    const showsPreview = entry.preview || applicationComposition;
    return html`<article id=${entry.tag} tabindex="-1" class="component-reference-card" aria-labelledby=${`${entry.tag}-heading`}>
      <header><div><span class="component-level">${entry.level === "application" ? "Application pattern" : entry.level}</span><h3 id=${`${entry.tag}-heading`}>${entry.title}</h3></div><a class="component-permalink" href=${`#${entry.tag}`} aria-label=${`Direct link to ${entry.title}`} @click=${(event: MouseEvent) => (event.currentTarget as HTMLElement).closest<HTMLElement>("article")?.focus({ preventScroll: true })}>#</a></header>
      <p class="component-summary">${entry.summary}</p>
      ${showsPreview ? html`<div class=${`component-preview${applicationComposition ? " component-application-preview" : ""}`} @forma-press=${this.#demo} @forma-action=${this.#demo} @forma-change=${this.#demo} @forma-navigate=${this.#demo} @forma-confirm=${this.#demo} @forma-dismiss=${this.#demo} @forma-toggle=${this.#demo}>${applicationComposition ? renderApplicationPatternPreview(entry.tag) : this.#preview(entry)}${applicationComposition ? html`<p class="component-pattern-caption">Illustrative composition · application element not mounted</p>` : nothing}</div>` : html`<p class="component-connected-note">Live loading announcement omitted to keep this reference quiet.</p>`}
      <div class="component-tag"><code>&lt;${entry.tag}&gt;</code><span>${entry.usage}</span></div>
      <details class="component-api" data-component-tag=${entry.tag} @toggle=${this.#openApi}><summary>API, content slots, events, and usage</summary>${this.#openApis.has(entry.tag) ? this.#api(entry) : nothing}</details>
    </article>`;
  }

  #theme() {
    return html`<section id="component-theme-playground" class="component-theme-playground" aria-labelledby="component-theme-heading"><header><div><h3 id="component-theme-heading">Make the system yours</h3><p>Change an isolated preview. Your browser still controls light and dark appearance, and no preference is saved.</p></div><button type="button" class="button ghost" @click=${() => { this.#preset = "original"; this.#density = "comfortable"; this.#radius = "default"; this.#message = "Preview theme reset."; this.requestUpdate(); }}>Reset preview</button></header>
      <fieldset class="component-theme-presets"><legend>Preview accent</legend>${(Object.keys(themePresets) as Array<keyof typeof themePresets>).map((preset) => html`<button type="button" aria-pressed=${String(this.#preset === preset)} @click=${() => { this.#preset = preset; this.#message = `${themePresets[preset].label} applied to the preview only.`; this.requestUpdate(); }}>${themePresets[preset].label}</button>`)}</fieldset>
      <div class="component-theme-settings"><label>Spacing<select .value=${this.#density} @change=${(event: Event) => { this.#density = (event.target as HTMLSelectElement).value; this.requestUpdate(); }}><option value="comfortable">Comfortable</option><option value="compact">Compact, 44px controls</option><option value="spacious">Spacious</option></select></label><label>Shape<select .value=${this.#radius} @change=${(event: Event) => { this.#radius = (event.target as HTMLSelectElement).value; this.requestUpdate(); }}><option value="default">Default</option><option value="soft">Soft</option><option value="square">Square</option></select></label></div>
      <forma-ui-theme class="component-theme-preview" density=${this.#density} radius=${this.#radius} style=${themePresets[this.#preset].style} @forma-press=${this.#demo} @forma-change=${this.#demo}><forma-ui-cluster><forma-ui-button label="Continue" variant="secondary" icon-name="arrow"></forma-ui-button><forma-ui-chip label="Selected" selected></forma-ui-chip><forma-ui-badge label="Theme preview" tone="accent"></forma-ui-badge><forma-ui-status label="Ready" tone="positive"></forma-ui-status></forma-ui-cluster><forma-ui-progress label="Preview progress" value="72" show-value></forma-ui-progress></forma-ui-theme>
      <p class="component-theme-contract">Use inherited <code>--forma-color-*</code>, <code>--forma-space-*</code>, <code>--forma-radius-*</code>, <code>--forma-focus-ring-*</code>, and <code>--forma-control-min-size</code> tokens on any element or subtree.</p>
    </section>`;
  }

  override render() {
    const needle = this.#query.trim().toLocaleLowerCase();
    const results = componentCatalog.filter((entry) => (this.#level === "all" || entry.level === this.#level)
      && (!needle || entry.searchText?.includes(needle)));
    return html`<section class="component-library" aria-labelledby="component-library-title">
      <header class="component-library-heading"><div><span>Reusable component library</span><h2 id="component-library-title">Pieces you can understand, combine, and trust</h2><p>${componentCatalog.filter((entry) => entry.tag.startsWith("forma-ui-")).length} native-first building blocks, plus production application patterns. Every component API is real; application previews safely compose shared interface patterns.</p></div><div class="component-library-actions"><a class="button ghost" href="#component-theme-playground">Customize theme</a><a class="button secondary component-manifest-link" href="/custom-elements.json" download="custom-elements.json">Download component manifest (JSON)</a></div></header>
      <search class="component-library-search" aria-label="Search the component library"><forma-ui-search label="Search components" placeholder="Try buttons, dialogs, themes, or keyboard" .value=${this.#query} @forma-input=${this.#filter}></forma-ui-search><button type="button" class="button ghost" @click=${this.#clear}>Clear filters</button></search>
      <fieldset class="component-level-filters"><legend>Browse by atomic level</legend><div>${componentLevels.map((level) => html`<button type="button" aria-pressed=${String(this.#level === level.value)} @click=${() => this.#levelChange(level.value)}>${level.label}</button>`)}</div></fieldset>
      <p class="component-results-count" role="status" aria-live="polite" aria-atomic="true">${results.length} ${results.length === 1 ? "component" : "components"} available${needle ? ` for “${this.#query}”` : ""}.</p>
      <div class="component-interaction-status" role="status" aria-live="polite" aria-atomic="true">${this.#message}</div>
      ${results.length ? html`<div class="component-reference-grid">${repeat(results, (entry) => entry.tag, (entry) => this.#entry(entry))}</div>` : html`<div class="component-no-results"><h3>No matching components</h3><p>Try a different name, purpose, or atomic level.</p><button type="button" class="button secondary" @click=${this.#clear}>Show every component</button></div>`}
      ${this.#theme()}
    </section>`;
  }
}

if (!customElements.get("forma-component-catalog")) customElements.define("forma-component-catalog", FormaComponentCatalog);

declare global { interface HTMLElementTagNameMap { "forma-component-catalog": FormaComponentCatalog } }
