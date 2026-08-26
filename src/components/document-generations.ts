import { html, nothing } from "lit";
import { generationHistoryItemIsDraft, generationHistoryItems, generationHistoryMix, isDraftOutput, outputQualityLabel, type CreativeOutput, type GenerationHistoryItem } from "../model/events";
import { FormaElement, icon } from "./forma-element";
import "./output-visual";
import "./prompt-fan-visual";
import "./prompt-fan-review";
import "./generation-actions";
import "./document-artifacts";

const itemSelectionId = (item: GenerationHistoryItem) => item.kind === "fan" ? `fan:${item.id}` : item.id;
const itemQualityLabel = (item: GenerationHistoryItem) => item.kind === "fan" ? `${generationHistoryItemIsDraft(item) ? "Draft" : "Full-quality"} fan` : outputQualityLabel(item.output);

export class DocumentGenerations extends FormaElement {
  static properties = { view: { type: String }, presentation: { type: String } };
  view = "document";
  presentation: "full" | "compact" | "canvas" | "rail" = "full";
  #selectedId = "";
  #filter: "all" | "draft" | "full" = "all";
  #collapsed = false;

  #select(item: GenerationHistoryItem) {
    const id = itemSelectionId(item);
    this.#selectedId = id;
    this.store.patchUi({ selectedOutputId: id });
    if (this.store.ui.instrumentation && item.kind === "output" && !this.store.session.get()?.projectContext) void this.store.hot({ type: "ObjectViewed", payload: { object_id: item.id, source_surface: `${this.view}-results` } });
    this.requestUpdate();
  }

  #visual(item: GenerationHistoryItem, compact = false, interactive = false) {
    return item.kind === "fan"
      ? html`<forma-prompt-fan-visual .outputs=${item.outputs} .compact=${compact}></forma-prompt-fan-visual>`
      : html`<forma-output-visual .output=${item.output} .compact=${compact} .interactive=${interactive}></forma-output-visual>`;
  }

  #embedded(items: GenerationHistoryItem[], selected: GenerationHistoryItem | undefined, progress: ReturnType<typeof this.store.documentPreviewProgress>) {
    const presentation = this.presentation;
    const currentIndex = selected ? items.findIndex((item) => itemSelectionId(item) === itemSelectionId(selected)) : -1;
    const selectedOutput = selected?.kind === "output" ? selected.output : null;
    return html`<section class=${`document-generation-embedded document-generation-embedded--${presentation}`} aria-label="Current generation from this document">
      <div class="document-generation-embedded-media">
        ${progress
          ? html`<div class="streaming-preview"><img class="streaming-preview-image" src=${progress.mediaUrl} width=${progress.width} height=${progress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>`
          : selected
          ? this.#visual(selected, false, true)
          : html`<span class="document-generation-empty">${icon("image")}<b>No image yet</b><small>The document is ready to become a visual result.</small></span>`}
      </div>
      <div class="document-generation-embedded-copy">
        <div><span class="eyebrow">${progress ? this.i18n.system("Image arriving") : selected ? this.i18n.system(itemQualityLabel(selected)) : this.i18n.system("Document preview")}</span><h3>${progress ? this.i18n.system("A working image is already visible") : selected?.kind === "fan" ? this.i18n.system("Fan generation · {complete} of 4 ready", { complete: this.i18n.number(selected.complete) }) : selected ? currentIndex === 0 ? this.i18n.system("Latest {label}", { label: isDraftOutput(selected.output) ? this.i18n.system("draft") : this.i18n.system("full-quality image") }) : this.i18n.system("Selected {value} {count}", { value: this.i18n.system(outputQualityLabel(selected.output)).toLocaleLowerCase(this.i18n.locale), count: this.i18n.number(currentIndex + 1) }) : this.i18n.system("See the decisions working together")}</h3><p>${progress ? this.i18n.system("This early pass will be replaced automatically by the completed draft.") : selected?.kind === "fan" ? this.i18n.system("One generation containing four prompt-process results · {standaloneCount} promoted to stand alone.", { standaloneCount: this.i18n.number(selected.standaloneCount) }) : selected ? this.i18n.system("{label} from this document’s complete creative context · {model}", { label: isDraftOutput(selected.output) ? this.i18n.system("Fast exploration") : this.i18n.system("Full resolution"), model: selected.output.modelId }) : this.i18n.system("Generate an image without leaving this way of working.")}</p></div>
        ${items.length > 1 ? html`<div class="document-generation-switcher" role="group" aria-label="Choose a document generation">${items.map((item, index) => html`<button class=${itemSelectionId(item) === itemSelectionId(selected!) ? "selected" : ""} aria-pressed=${itemSelectionId(item) === itemSelectionId(selected!)} aria-label=${this.i18n.system("Show {value} {count}", { value: this.i18n.system(itemQualityLabel(item)).toLocaleLowerCase(this.i18n.locale), count: this.i18n.number(index + 1) })} @click=${() => this.#select(item)}>${item.kind === "fan" ? "×4" : generationHistoryItemIsDraft(item) ? "D" : "F"}${items.length - index}</button>`)}</div>` : nothing}
        ${selected?.kind === "fan" ? html`<forma-prompt-fan-review .fanId=${selected.id}></forma-prompt-fan-review>` : nothing}
        <forma-generation-actions source=${this.view} .selected=${selectedOutput} compact></forma-generation-actions>
      </div>
    </section>`;
  }

  override render() {
    const allOutputs = this.store.projection.get().outputs;
    const allItems = generationHistoryItems(allOutputs);
    const progress = this.store.documentPreviewProgress();
    const mix = generationHistoryMix(allOutputs);
    const items = allItems.filter((item) => this.#filter === "all" || (this.#filter === "draft" ? generationHistoryItemIsDraft(item) : !generationHistoryItemIsDraft(item)));
    const selected = items.find((item) => itemSelectionId(item) === (this.#selectedId || this.store.ui.selectedOutputId)) ?? items[0];
    const selectedOutput: CreativeOutput | null = selected?.kind === "output" ? selected.output : null;
    if (this.presentation !== "full") return html`<forma-document-artifacts compact source=${this.view}></forma-document-artifacts>${this.#embedded(items, selected, progress)}`;
    return html`<forma-document-artifacts source=${this.view}></forma-document-artifacts><section class=${`document-generations ${this.#collapsed ? "collapsed" : ""}`} aria-label="Generations from this document">
      <header><div><span class="eyebrow">Results from this document</span><h2>${mix.total ? (mix.total === 1 ? this.i18n.system("{total} generation · {drafts} draft · {full} full quality", { total: this.i18n.number(mix.total), drafts: this.i18n.number(mix.drafts), full: this.i18n.number(mix.full) }) : this.i18n.system("{total} generations · {drafts} draft · {full} full quality", { total: this.i18n.number(mix.total), drafts: this.i18n.number(mix.drafts), full: this.i18n.number(mix.full) })) : this.i18n.system("The document has no generations yet")}</h2><p>${mix.total ? this.i18n.system("A fan counts as one generation until you promote individual results from its comparison. Drafts and full-quality work share this same history in every view.") : this.i18n.system("Preview quickly or generate at full quality from the same durable context represented by this view.")}</p></div><div class="document-generation-header-actions"><button class="document-generation-collapse" aria-expanded=${!this.#collapsed} @click=${() => { this.#collapsed = !this.#collapsed; this.requestUpdate(); }}>${this.#collapsed ? this.i18n.system("Show images") : this.i18n.system("Collapse images")}</button><forma-generation-actions source=${this.view} .selected=${selectedOutput}></forma-generation-actions></div></header>
      ${this.#collapsed ? nothing : html`${mix.total ? html`<div class="generation-filter" role="group" aria-label="Filter generation quality">${(["all", "draft", "full"] as const).map((filter) => html`<button aria-pressed=${this.#filter === filter} @click=${() => { this.#filter = filter; this.#selectedId = ""; this.requestUpdate(); }}>${filter === "all" ? this.i18n.system("All {total}", { total: this.i18n.number(mix.total) }) : filter === "draft" ? this.i18n.system("Drafts {drafts}", { drafts: this.i18n.number(mix.drafts) }) : this.i18n.system("Full quality {full}", { full: this.i18n.number(mix.full) })}</button>`)}</div>` : nothing}
      ${progress || selected ? html`<div class="document-generation-layout"><div class=${`document-generation-feature ${selected?.kind === "fan" ? "fan" : ""}`}>${progress ? html`<div class="streaming-preview"><img class="streaming-preview-image" src=${progress.mediaUrl} width=${progress.width} height=${progress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div>` : selected ? this.#visual(selected, false, true) : nothing}<footer><span><b>${progress ? this.i18n.system("Working image arriving") : selected?.kind === "fan" ? this.i18n.system("{quality} · four prompt processes", { quality: this.i18n.system(itemQualityLabel(selected)) }) : `${this.i18n.system(outputQualityLabel(selected?.output))} · ${selected?.id}`}</b><small>${progress ? this.i18n.system("GPT Image is refining the completed draft now") : selected?.kind === "fan" ? this.i18n.system("{complete} of 4 ready · {standaloneCount} standalone", { complete: this.i18n.number(selected.complete), standaloneCount: this.i18n.number(selected.standaloneCount) }) : `${selected?.output.modelId}${selected?.output.promotedFromId ? ` · refined from ${selected.output.promotedFromId}` : ""}`}</small></span><em>${progress ? this.i18n.system("Streaming") : selected?.kind === "fan" ? this.i18n.system("Grouped comparison") : selected?.output.pinned ? this.i18n.system("Pinned") : selected?.output.saved ? this.i18n.system("Saved") : isDraftOutput(selected?.output) ? this.i18n.system("Fast exploration") : this.i18n.system("Version {value}", { value: this.i18n.number((selected?.output.variant ?? 0) + 1) })}</em></footer>${selected?.kind === "fan" ? html`<forma-prompt-fan-review .fanId=${selected.id}></forma-prompt-fan-review>` : nothing}</div><div class="document-generation-list" role="group" aria-label="Filtered document generations">${items.map((item, index) => html`<button class=${itemSelectionId(item) === itemSelectionId(selected!) ? "selected" : ""} aria-pressed=${itemSelectionId(item) === itemSelectionId(selected!)} @click=${() => this.#select(item)}><i>${this.#visual(item, true)}</i><span><b>${this.i18n.system(itemQualityLabel(item))} ${index === 0 ? this.i18n.system("· latest") : ""}</b><small>${item.kind === "fan" ? this.i18n.system("{complete}/4 · {standaloneCount} promoted", { complete: this.i18n.number(item.complete), standaloneCount: this.i18n.number(item.standaloneCount) }) : item.id}</small></span></button>`)}</div></div>` : mix.total ? html`<p class="generation-filter-empty">${this.i18n.system(this.#filter==="draft"?"No draft images yet.":"No full-quality images yet.")}</p>` : nothing}`}
    </section>`;
  }
}

if (!customElements.get("forma-document-generations")) customElements.define("forma-document-generations", DocumentGenerations);
declare global { interface HTMLElementTagNameMap { "forma-document-generations": DocumentGenerations } }
