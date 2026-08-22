import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { icon } from "../icons";
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
  #localizedCatalog = new Map<string, { messages: Readonly<Record<string, string>>; entries: ComponentCatalogEntry[]; choices: Array<{ label: string; value: string; description: string }> }>();

  #normalizeSearch(value: string) {
    return value.toLocaleLowerCase(this.i18n.locale)
      .normalize("NFD")
      .replace(/(\p{Script=Latin})\p{Mark}+/gu, "$1")
      .normalize("NFC");
  }

  #catalog() {
    const locale = this.i18n.locale;
    const existing = this.#localizedCatalog.get(locale);
    if (existing && existing.messages === this.i18n.messages) return existing;
    const translated = componentCatalog.map((entry) => {
      const title = this.i18n.t("component." + entry.tag + ".title", entry.title);
      const summary = this.i18n.t("component." + entry.tag + ".summary", entry.summary);
      const usage = locale.startsWith("en")
        ? entry.usage
        : this.i18n.t("component." + entry.tag + ".usage", this.i18n.t("catalog.usage." + entry.level, entry.usage));
      const searchText = this.#normalizeSearch([entry.tag, title, summary, usage, entry.keywords || "", entry.title, entry.summary, entry.level].join(" "));
      return { ...entry, title, summary, usage, searchText };
    });
    const value = {
      messages: this.i18n.messages,
      entries: translated,
      choices: [
        { label: this.i18n.t("sample.draft", "Draft"), value: "draft", description: this.i18n.t("sample.quick", "Quick creative exploration") },
        { label: this.i18n.t("sample.full", "Full quality"), value: "full", description: this.i18n.t("sample.share", "Ready to share") },
      ],
    };
    this.#localizedCatalog.set(locale, value);
    if (this.#localizedCatalog.size > 4) this.#localizedCatalog.delete(this.#localizedCatalog.keys().next().value || "");
    return value;
  }

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
  #clear() { this.#query = ""; this.#level = "all"; this.#message = this.i18n.t("catalog.cleared", "Showing every available component."); this.requestUpdate(); void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".component-library-search input")?.focus({ preventScroll: true })); }
  #demo(event: Event) {
    if (event instanceof CustomEvent && event.cancelable) event.preventDefault();
    const target = event.target as (HTMLElement & { label?: string; heading?: string; action?: string }) | null;
    const label = target?.label || target?.heading || target?.action || target?.getAttribute("label") || target?.getAttribute("heading") || target?.getAttribute("action") || target?.textContent?.trim() || event.type.replace("forma-", "");
    this.#message = this.i18n.t("catalog.previewAction", "Preview interaction: {label}. No project data was changed.", { label });
    this.requestUpdate();
  }

  async #copy(entry: ComponentCatalogEntry) {
    const success = await copyInterfaceText(entry.example);
    this.#message = success ? this.i18n.t("catalog.copied", "{title} example copied to the clipboard.", { title: entry.title }) : this.i18n.t("catalog.copyFailed", "Could not copy automatically. Select the example text and copy it manually.");
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
        this.#reflectedSlots.set(tag, [...reflected.values()].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
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
      if (this.isConnected) this.#manifestError = this.i18n.t("catalog.manifestError", "Complete API details could not be loaded. The component examples remain available.");
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
        return { name: typeof options.attribute === "string" ? options.attribute : fieldName.toLowerCase(), fieldName, type: { text: type } };
      })
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  }

  #preview(entry: ComponentCatalogEntry): TemplateResult | typeof nothing {
    if (!entry.preview) return nothing;
    const choices = this.#catalog().choices;
    switch (entry.tag) {
      case "forma-ui-locale": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-locale lang=${this.i18n.locale}><forma-ui-search .label=${this.i18n.t("catalog.searchLabel", "Search components")}></forma-ui-search></forma-ui-locale></form>`;
      case "forma-ui-theme": return html`<forma-ui-theme radius="soft"><forma-ui-badge .label=${this.i18n.t("sample.scopedTheme", "Scoped theme")} tone="accent"></forma-ui-badge></forma-ui-theme>`;
      case "forma-ui-button": return html`<forma-ui-cluster><forma-ui-button .label=${this.i18n.t("sample.saveDirection", "Save direction")} value="save-direction" icon-name="check" variant="primary"></forma-ui-button><forma-ui-button .label=${this.i18n.t("lab.unavailable", "Not available")} disabled></forma-ui-button></forma-ui-cluster>`;
      case "forma-ui-icon-button": return html`<forma-ui-icon-button icon-name="close" .label=${this.i18n.t("sample.closePreview", "Close preview")} value="close-preview"></forma-ui-icon-button>`;
      case "forma-ui-icon": return html`<forma-ui-icon name="spark" .label=${this.i18n.t("sample.creativeIdea", "Creative idea")}></forma-ui-icon>`;
      case "forma-ui-badge": return html`<forma-ui-cluster gap="small"><forma-ui-badge .label=${this.i18n.t("sample.ready", "Ready")} tone="positive"></forma-ui-badge><forma-ui-badge .label=${this.i18n.t("sample.review", "Needs review")} tone="warning"></forma-ui-badge></forma-ui-cluster>`;
      case "forma-ui-avatar": return html`<forma-ui-avatar name="Avery Park"></forma-ui-avatar>`;
      case "forma-ui-chip": return html`<forma-ui-chip .label=${this.i18n.t("sample.review", "Needs review")} value="review"></forma-ui-chip>`;
      case "forma-ui-status": return html`<forma-ui-status .label=${this.i18n.t("sample.saved", "Saved safely")} tone="positive"></forma-ui-status>`;
      case "forma-ui-progress": return html`<forma-ui-progress .label=${this.i18n.t("sample.preparingImages", "Preparing images")} value="72" show-value></forma-ui-progress>`;
      case "forma-ui-kbd": return html`<forma-ui-kbd keys="⌘ K" .label=${this.i18n.t("sample.commandAndK", "Command and K")}></forma-ui-kbd>`;
      case "forma-ui-divider": return html`<forma-ui-divider .label=${this.i18n.t("sample.optionalDetails", "Optional details")}></forma-ui-divider>`;
      case "forma-ui-skeleton": return html`<forma-ui-skeleton lines="2"></forma-ui-skeleton>`;
      case "forma-ui-link": return html`<forma-ui-link href="#forma-ui-link" .label=${this.i18n.t("pattern.openReference", "Open reference")}></forma-ui-link>`;
      case "forma-ui-field": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-field .label=${this.i18n.t("lab.direction", "Creative direction")} .value=${this.i18n.t("sample.quietOpening", "A quiet opening")} .help=${this.i18n.t("sample.describeOutcome", "Describe the outcome you want.")}></forma-ui-field></form>`;
      case "forma-ui-search": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-search .label=${this.i18n.t("sample.searchWork", "Search finished work")} .placeholder=${this.i18n.t("sample.tryLandscape", "Try landscape")}></forma-ui-search></form>`;
      case "forma-ui-textarea": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-textarea .label=${this.i18n.t("sample.supportingContext", "Supporting context")} rows="2" .value=${this.i18n.t("sample.keepObjectClear", "Keep the central object clear.")}></forma-ui-textarea></form>`;
      case "forma-ui-rich-text": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-rich-text .label=${this.i18n.t("sample.supportingContext", "Supporting context")} rows="4" .value=${this.i18n.t("sample.keepObjectClear", "Keep the central object clear.")}></forma-ui-rich-text></form>`;
      case "forma-ui-select": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-select .label=${this.i18n.t("sample.outputQuality", "Output quality")} value="draft" .options=${choices}></forma-ui-select></form>`;
      case "forma-ui-checkbox": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-checkbox .label=${this.i18n.t("sample.includeContext", "Include supporting context")} checked></forma-ui-checkbox></form>`;
      case "forma-ui-switch": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-switch .label=${this.i18n.t("sample.showDetails", "Show technical details")}></forma-ui-switch></form>`;
      case "forma-ui-radio-group": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-radio-group .label=${this.i18n.t("sample.generationQuality", "Generation quality")} name="library-demo-quality" value="draft" .options=${choices}></forma-ui-radio-group></form>`;
      case "forma-ui-number-field": return html`<form novalidate @submit=${(event:SubmitEvent)=>event.preventDefault()}><forma-ui-number-field .label=${this.i18n.t("sample.previewWidth", "Preview width")} value="1024" min="256" step="64"></forma-ui-number-field></form>`;
      case "forma-ui-metric": return html`<forma-ui-metric .label=${this.i18n.t("lab.outputs", "Finished outputs")} .value=${this.i18n.number(24)} .detail=${this.i18n.t("sample.share", "Ready to share")}></forma-ui-metric>`;
      case "forma-ui-segmented-control": return html`<forma-ui-segmented-control .label=${this.i18n.t("sample.previewQuality", "Preview quality")} value="draft" .options=${choices}></forma-ui-segmented-control>`;
      case "forma-ui-tabs": return html`<forma-ui-tabs .label=${this.i18n.t("sample.outputDetails", "Output details")} value="draft" .options=${choices}></forma-ui-tabs>`;
      case "forma-ui-breadcrumbs": return html`<forma-ui-breadcrumbs .items=${[{ label: this.i18n.t("shell.projects", "Projects"), value: "#forma-ui-breadcrumbs" }, { label: this.i18n.t("sample.campaign", "Summer campaign"), value: "#forma-ui-breadcrumbs" }]}></forma-ui-breadcrumbs>`;
      case "forma-ui-pagination": return html`<forma-ui-pagination .label=${this.i18n.t("sample.resultPages", "Result pages")} page="2" total="8"></forma-ui-pagination>`;
      case "forma-ui-toolbar": return html`<forma-ui-toolbar .label=${this.i18n.t("sample.documentActions", "Document actions")} .actions=${[{ label: this.i18n.t("sample.undo", "Undo"), value: "undo" }, { label: this.i18n.t("sample.redo", "Redo"), value: "redo" }]}></forma-ui-toolbar>`;
      case "forma-ui-notice": return html`<forma-ui-notice tone="positive" value="work-saved"><forma-ui-icon slot="leading" name="check"></forma-ui-icon><strong slot="heading">${this.i18n.t("sample.saved", "Your work is saved")}</strong><p>${this.i18n.t("sample.savedDetail", "Every change is available.")} <a href="#forma-ui-notice" @click=${(event: MouseEvent) => { event.preventDefault(); this.#demo(event); }}>${this.i18n.t("sample.viewHistory", "View history")}</a>.</p><forma-ui-button slot="actions" .label=${this.i18n.t("pattern.review", "Review")} value="review-history"></forma-ui-button></forma-ui-notice>`;
      case "forma-ui-disclosure": return html`<forma-ui-disclosure><span slot="summary">${this.i18n.t("sample.supportingDetails", "View supporting details")}</span><p>${this.i18n.t("sample.confirmBeforeSending", "Nothing is sent until you confirm.")}</p></forma-ui-disclosure>`;
      case "forma-ui-copy-button": return html`<forma-ui-copy-button .label=${this.i18n.t("sample.copySample", "Copy sample")} value="Forma component reference"></forma-ui-copy-button>`;
      case "forma-ui-list-item": return html`<forma-ui-list-item value="summer-campaign"><forma-ui-avatar slot="leading" name="Avery Park" initials="AP"></forma-ui-avatar><strong slot="heading">${this.i18n.t("sample.campaign", "Summer campaign")}</strong><p>${this.i18n.plural("pattern.directionsCount", 3, "{count} direction", "{count} directions")}</p><forma-ui-badge slot="trailing" .label=${this.i18n.t("sample.ready", "Ready")} tone="positive"></forma-ui-badge><forma-ui-button slot="trailing" .label=${this.i18n.t("sample.open", "Open")} value="open-campaign"></forma-ui-button></forma-ui-list-item>`;
      case "forma-ui-stack": return html`<forma-ui-stack gap="small"><forma-ui-badge .label=${this.i18n.t("sample.draft", "Draft")}></forma-ui-badge><forma-ui-status .label=${this.i18n.t("sample.readyFeedback", "Ready for feedback")} tone="positive"></forma-ui-status></forma-ui-stack>`;
      case "forma-ui-cluster": return html`<forma-ui-cluster gap="small"><forma-ui-badge .label=${this.i18n.t("sample.image", "Image")}></forma-ui-badge><forma-ui-badge .label=${this.i18n.t("sample.draft", "Draft")} tone="accent"></forma-ui-badge></forma-ui-cluster>`;
      case "forma-ui-surface": return html`<forma-ui-surface padded><forma-ui-metric .label=${this.i18n.t("sample.ideasWorthKeeping", "Ideas worth keeping")} .value=${this.i18n.number(12)}></forma-ui-metric></forma-ui-surface>`;
      case "forma-ui-popover": return html`<forma-ui-popover .label=${this.i18n.t("sample.projectOptions", "Project options")} .heading=${this.i18n.t("sample.manageProject", "Manage project")} .actions=${[{ label: this.i18n.t("sample.renameProject", "Rename project"), value: "rename" }, { label: this.i18n.t("sample.viewActivity", "View activity"), value: "activity" }]}></forma-ui-popover>`;
      case "forma-ui-dialog": return html`<forma-ui-dialog .trigger=${this.i18n.t("sample.openReview", "Open review")} .heading=${this.i18n.t("sample.keepDirectionQuestion", "Keep this direction?")} .detail=${this.i18n.t("sample.earlierWork", "Your earlier work remains available.")} .confirm=${this.i18n.t("sample.keepDirection", "Keep direction")}></forma-ui-dialog>`;
      case "forma-ui-card": return html`<forma-ui-card value="summer-campaign"><div slot="media" class="component-media-preview" role="img" aria-label=${this.i18n.t("sample.campaignImage", "Soft blue and warm summer campaign color study")}></div><span slot="eyebrow">${this.i18n.t("sample.campaign", "Summer campaign")}</span><h4 slot="heading">${this.i18n.t("sample.oneDirection", "One direction is ready")}</h4><p>${this.i18n.t("pattern.compareDirections", "Compare creative directions")}.</p><forma-ui-button slot="actions" .label=${this.i18n.t("pattern.review", "Review")} value="review-campaign"></forma-ui-button><forma-ui-button slot="actions" .label=${this.i18n.t("action.save")} value="save-campaign" variant="ghost"></forma-ui-button></forma-ui-card>`;
      case "forma-ui-empty-state": return html`<forma-ui-empty-state .heading=${this.i18n.t("lab.emptyHeading", "Begin with one clear intention")} .detail=${this.i18n.t("lab.emptyDetail", "A little context unlocks useful next steps.")} .action=${this.i18n.t("sample.createIdea", "Create an idea")} level="4"></forma-ui-empty-state>`;
      case "forma-ui-page-header": return html`<forma-ui-page-header value="creative-workspace"><span slot="eyebrow">${this.i18n.t("sample.creativeWorkspace", "Creative workspace")}</span><h4 slot="heading">${this.i18n.t("lab.creativeHeading", "Shape the work")}</h4><p>${this.i18n.t("sample.startOutcome", "Start with the outcome you want.")}</p><forma-ui-button slot="actions" .label=${this.i18n.t("sample.newIdea", "New idea")} value="new-idea" variant="primary"></forma-ui-button><forma-ui-button slot="actions" .label=${this.i18n.t("sample.browse", "Browse")} value="browse-projects"></forma-ui-button></forma-ui-page-header>`;
      default: return nothing;
    }
  }

  #documentation(id: string, fallback: string) {
    const translated = Boolean(this.i18n.messages[id]);
    return html`<span lang=${translated ? nothing : "en"} dir=${translated ? nothing : "ltr"}>${this.i18n.t(id, fallback)}</span>`;
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
      <section><h4>${this.i18n.t("catalog.markup", "Markup")}</h4>${this.i18n.locale.startsWith("en") ? nothing : html`<p>${this.i18n.t("catalog.canonicalExample", "Canonical developer examples remain in English.")}</p>`}<pre lang="en" dir="ltr"><code>${entry.example}</code></pre><button type="button" class="button secondary component-copy" @click=${() => this.#copy(entry)}>${this.i18n.t("catalog.copyExample", "Copy example")}</button>${entry.fallbackExample ? html`<details class="component-fallback-example"><summary>${this.i18n.t("catalog.fallback", "Attribute-only shorthand")}</summary><pre lang="en" dir="ltr"><code>${entry.fallbackExample}</code></pre></details>` : nothing}</section>
      ${slots.length ? html`<section><h4>${this.i18n.t("catalog.slots", "Content slots")}</h4><div class="component-api-table-wrap"><table><thead><tr><th scope="col">${this.i18n.t("catalog.slotColumn", "Slot")}</th><th scope="col">${this.i18n.t("catalog.contentColumn", "Accepted content")}</th></tr></thead><tbody>${slots.map((slot) => html`<tr><th scope="row">${slot.name ? html`<code dir="ltr">${slot.name}</code>` : this.i18n.t("catalog.defaultSlot", "Main content (default)")}</th><td>${slot.description ? this.#documentation("component." + entry.tag + ".slot." + (slot.name ? "named." + slot.name : "$default") + ".description", slot.description) : this.i18n.t("catalog.authoredContent", "Authored component content.")}</td></tr>`)}</tbody></table></div>${acceptsActions ? html`<p class="component-slot-guidance">${this.i18n.t("catalog.nativeBehavior", "Authored buttons and links keep their own native click and form behavior. Built-in attribute-based actions emit the component events documented below.")}</p>` : nothing}</section>` : nothing}
      <section><h4>${this.i18n.t("catalog.attributes", "Attributes")}</h4>${attributes.length ? html`<div class="component-api-table-wrap"><table><thead><tr><th>${this.i18n.t("catalog.attributeColumn", "Attribute")}</th><th>${this.i18n.t("catalog.typeColumn", "Type")}</th><th>${this.i18n.t("catalog.defaultColumn", "Default")}</th><th>${this.i18n.t("catalog.descriptionColumn", "Description")}</th></tr></thead><tbody>${attributes.map((attribute) => html`<tr><th scope="row"><code dir="ltr">${attribute.name}</code></th><td><code dir="ltr">${attribute.type?.text ?? "string"}</code></td><td><code dir="ltr">${attribute.default ?? "—"}</code></td><td>${attribute.description ? this.#documentation("component." + entry.tag + ".attribute." + attribute.name + ".description", attribute.description) : "—"}</td></tr>`)}</tbody></table></div>` : html`<p>${this.i18n.t("catalog.noAttributes", "No configurable HTML attributes are exposed.")}</p>`}</section>
      ${propertyOnly.length ? html`<section><h4>${this.i18n.t("catalog.properties", "JavaScript-only properties")}</h4><ul>${propertyOnly.map((property) => html`<li><code dir="ltr">.${property.name}</code> <code dir="ltr">${property.type?.text ?? "unknown"}</code></li>`)}</ul></section>` : nothing}
      ${events.length ? html`<section><h4>${this.i18n.t("catalog.events", "Events")}</h4><ul>${events.map((event) => html`<li><code dir="ltr">${event.name}</code> <code dir="ltr">${event.type?.text ?? "CustomEvent"}</code>${event.description ? this.#documentation("component." + entry.tag + ".event." + event.name + ".description", event.description) : nothing}</li>`)}</ul></section>` : nothing}
      ${tokens.length ? html`<section><h4>${this.i18n.t("catalog.tokens", "Theme tokens")}</h4><ul>${tokens.map((token) => html`<li><code dir="ltr">${token.name}</code>${token.description ? this.#documentation("component." + entry.tag + ".css." + token.name + ".description", token.description) : nothing}</li>`)}</ul></section>` : nothing}
      ${this.#manifestLoading && !declaration ? html`<p class="component-api-loading">${this.i18n.t("catalog.apiLoading", "Loading the complete API reference…")}</p>` : nothing}
      ${this.#manifestError ? html`<div class="component-api-error" role="alert"><p>${this.#manifestError}</p><button type="button" class="button secondary" @click=${(event: MouseEvent) => { (event.currentTarget as HTMLElement).closest("details")?.querySelector("summary")?.focus({ preventScroll: true }); this.#manifestError = ""; this.#manifestLoading = false; void this.#retryApi(); }}>${this.i18n.t("catalog.apiRetry", "Retry API details")}</button></div>` : nothing}
    </div>`;
  }

  async #retryApi() {
    this.#manifestLoading = true;
    this.requestUpdate();
    try { const manifest = await loadComponentManifest(); if (this.isConnected) this.#manifest = manifest; }
    catch { if (this.isConnected) this.#manifestError = this.i18n.t("catalog.manifestError", "Complete API details are still unavailable. The downloadable reference may help."); }
    finally { this.#manifestLoading = false; if (this.isConnected) this.requestUpdate(); }
  }

  #entry(entry: ComponentCatalogEntry) {
    const applicationComposition = entry.previewKind === "application-composition";
    const showsPreview = entry.preview || applicationComposition;
    return html`<article id=${entry.tag} tabindex="-1" class="component-reference-card" aria-labelledby=${`${entry.tag}-heading`}>
      <header><div><span class="component-level">${this.i18n.t("catalog.level." + entry.level, entry.level === "application" ? "Application pattern" : entry.level)}</span><h3 id=${`${entry.tag}-heading`}>${entry.title}</h3></div><a class="component-permalink" href=${`#${entry.tag}`} aria-label=${this.i18n.t("catalog.directLink", "Direct link to {title}", { title: entry.title })} @click=${(event: MouseEvent) => (event.currentTarget as HTMLElement).closest<HTMLElement>("article")?.focus({ preventScroll: true })}>${icon("link")}</a></header>
      <p class="component-summary">${entry.summary}</p>
      ${showsPreview ? html`<div class=${`component-preview${applicationComposition ? " component-application-preview" : ""}`} @forma-press=${this.#demo} @forma-action=${this.#demo} @forma-change=${this.#demo} @forma-navigate=${this.#demo} @forma-confirm=${this.#demo} @forma-dismiss=${this.#demo} @forma-toggle=${this.#demo}>${applicationComposition ? renderApplicationPatternPreview(entry.tag, this.i18n) : this.#preview(entry)}${applicationComposition ? html`<p class="component-pattern-caption">${this.i18n.t("catalog.applicationPreview", "Illustrative composition · application element not mounted")}</p>` : nothing}</div>` : html`<p class="component-connected-note">${this.i18n.t("catalog.noPreview", "Live loading announcement omitted to keep this reference quiet.")}</p>`}
      <div class="component-tag"><code dir="ltr">&lt;${entry.tag}&gt;</code><span>${entry.usage}</span></div>
      <details class="component-api" data-component-tag=${entry.tag} @toggle=${this.#openApi}><summary>${this.i18n.t("catalog.apiSummary", "API, content slots, events, and usage")}</summary>${this.#openApis.has(entry.tag) ? this.#api(entry) : nothing}</details>
    </article>`;
  }

  #theme() {
    return html`<section id="component-theme-playground" class="component-theme-playground" aria-labelledby="component-theme-heading"><header><div><h3 id="component-theme-heading">${this.i18n.t("catalog.themeHeading", "Make the system yours")}</h3><p>${this.i18n.t("catalog.themeDescription", "Change an isolated preview. Your browser still controls light and dark appearance, and no preference is saved.")}</p></div><button type="button" class="button ghost" @click=${() => { this.#preset = "original"; this.#density = "comfortable"; this.#radius = "default"; this.#message = this.i18n.t("catalog.themeResetDone", "Preview theme reset."); this.requestUpdate(); }}>${this.i18n.t("catalog.themeReset", "Reset preview")}</button></header>
      <fieldset class="component-theme-presets"><legend>${this.i18n.t("catalog.themeAccent", "Preview accent")}</legend>${(Object.keys(themePresets) as Array<keyof typeof themePresets>).map((preset) => { const label = this.i18n.t("catalog.theme" + preset[0].toUpperCase() + preset.slice(1), themePresets[preset].label); return html`<button type="button" aria-pressed=${String(this.#preset === preset)} @click=${() => { this.#preset = preset; this.#message = this.i18n.t("catalog.themeApplied", "{theme} applied to the preview only.", { theme: label }); this.requestUpdate(); }}>${label}</button>`; })}</fieldset>
      <form class="component-theme-settings" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label>${this.i18n.t("catalog.themeSpacing", "Spacing")}<select .value=${this.#density} @change=${(event: Event) => { this.#density = (event.target as HTMLSelectElement).value; this.requestUpdate(); }}><option value="comfortable">${this.i18n.t("catalog.densityComfortable", "Comfortable")}</option><option value="compact">${this.i18n.t("catalog.densityCompact", "Compact, 44px controls")}</option><option value="spacious">${this.i18n.t("catalog.densitySpacious", "Spacious")}</option></select></label><label>${this.i18n.t("catalog.themeShape", "Shape")}<select .value=${this.#radius} @change=${(event: Event) => { this.#radius = (event.target as HTMLSelectElement).value; this.requestUpdate(); }}><option value="default">${this.i18n.t("catalog.radiusDefault", "Default")}</option><option value="soft">${this.i18n.t("catalog.radiusSoft", "Soft")}</option><option value="square">${this.i18n.t("catalog.radiusSquare", "Square")}</option></select></label></form>
      <forma-ui-theme class="component-theme-preview" density=${this.#density} radius=${this.#radius} style=${themePresets[this.#preset].style} @forma-press=${this.#demo} @forma-change=${this.#demo}><forma-ui-cluster><forma-ui-button .label=${this.i18n.t("action.continue")} value="continue" variant="secondary" icon-name="arrow"></forma-ui-button><forma-ui-chip .label=${this.i18n.t("sample.selected", "Selected")} value="selected" selected></forma-ui-chip><forma-ui-badge .label=${this.i18n.t("sample.themePreview", "Theme preview")} tone="accent"></forma-ui-badge><forma-ui-status .label=${this.i18n.t("sample.ready", "Ready")} tone="positive"></forma-ui-status></forma-ui-cluster><forma-ui-progress .label=${this.i18n.t("sample.previewProgress", "Preview progress")} value="72" show-value></forma-ui-progress></forma-ui-theme>
      <p class="component-theme-contract">${this.i18n.t("catalog.themeContract", "Use inherited color, spacing, radius, focus-ring, and minimum-control-size tokens on any element or subtree.")} <code dir="ltr">--forma-color-*</code>, <code dir="ltr">--forma-space-*</code>, <code dir="ltr">--forma-radius-*</code>, <code dir="ltr">--forma-focus-ring-*</code>, <code dir="ltr">--forma-control-min-size</code>.</p>
    </section>`;
  }

  override render() {
    const entries = this.#catalog().entries;
    const needle = this.#normalizeSearch(this.#query.trim());
    const results = entries.filter((entry) => (this.#level === "all" || entry.level === this.#level)
      && (!needle || entry.searchText?.includes(needle)));
    const count = this.i18n.number(entries.filter((entry) => entry.tag.startsWith("forma-ui-")).length);
    const isolatedQuery = "\u2068" + this.#query + "\u2069";
    const status = needle
      ? this.i18n.plural("catalog.resultsFiltered", results.length, "{count} component available for “{query}”.", "{count} components available for “{query}”.", { query: isolatedQuery })
      : this.i18n.plural("catalog.results", results.length, "{count} component available.", "{count} components available.");
    return html`<section class="component-library" aria-labelledby="component-library-title">
      <header class="component-library-heading"><div><span>${this.i18n.t("catalog.eyebrow", "Reusable component library")}</span><h2 id="component-library-title">${this.i18n.t("catalog.heading", "Pieces you can understand, combine, and trust")}</h2><p>${this.i18n.t("catalog.description", "{count} native-first building blocks, plus production application patterns. Every component API is real; application previews safely compose shared interface patterns.", { count })}</p></div><div class="component-library-actions"><a class="button ghost" href="#component-theme-playground">${this.i18n.t("catalog.customize", "Customize theme")}</a><a class="button secondary component-manifest-link" href="/custom-elements.json" download="custom-elements.json">${this.i18n.t("catalog.manifest", "Download component manifest (JSON)")}</a></div></header>
      <search aria-label=${this.i18n.t("catalog.searchRegion", "Search the component library")}><form class="component-library-search" @submit=${(event:SubmitEvent)=>{event.preventDefault();this.requestUpdate();}}><forma-ui-search .label=${this.i18n.t("catalog.searchLabel", "Search components")} .placeholder=${this.i18n.t("catalog.searchPlaceholder", "Try buttons, dialogs, themes, or keyboard")} .value=${this.#query} @forma-input=${this.#filter}></forma-ui-search><button type="button" class="button ghost" @click=${this.#clear}>${this.i18n.t("catalog.clear", "Clear filters")}</button></form></search>
      <fieldset class="component-level-filters"><legend>${this.i18n.t("catalog.filterLegend", "Browse by atomic level")}</legend><div>${componentLevels.map((level) => html`<button type="button" aria-pressed=${String(this.#level === level.value)} @click=${() => this.#levelChange(level.value)}>${this.i18n.t("catalog.level." + level.value, level.label)}</button>`)}</div></fieldset>
      <p class="component-results-count" role="status" aria-live="polite" aria-atomic="true">${status}</p>
      <div class="component-interaction-status" role="status" aria-live="polite" aria-atomic="true">${this.#message}</div>
      ${results.length ? html`<div class="component-reference-grid">${repeat(results, (entry) => entry.tag, (entry) => this.#entry(entry))}</div>` : html`<div class="component-no-results"><h3>${this.i18n.t("catalog.noResultsTitle", "No matching components")}</h3><p>${this.i18n.t("catalog.noResultsDetail", "Try a different name, purpose, or atomic level.")}</p><button type="button" class="button secondary" @click=${this.#clear}>${this.i18n.t("catalog.showAll", "Show every component")}</button></div>`}
      ${this.#theme()}
    </section>`;
  }
}

if (!customElements.get("forma-component-catalog")) customElements.define("forma-component-catalog", FormaComponentCatalog);

declare global { interface HTMLElementTagNameMap { "forma-component-catalog": FormaComponentCatalog } }
