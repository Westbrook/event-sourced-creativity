import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import type { CreativeBlock } from "../model/events";
import { DEFAULT_REFERENCE_FINDINGS, REFERENCE_FINDING_OPTIONS, type ReferenceFinding, type ReferenceFindingKind } from "../model/extractors";
import { sampleImageUrl } from "../model/image-sample";

const findingHandle = (finding: ReferenceFinding, sequence: number) => `${finding.blockType}/from-reference-${finding.kind}-${String(sequence).padStart(3, "0")}`;

export class ReferenceFindings extends FormaElement {
  static properties = { block: { attribute: false } };
  block!: CreativeBlock;
  #analyzing = false;

  #findings() {
    return Array.isArray(this.block.properties.reference_findings) ? this.block.properties.reference_findings as ReferenceFinding[] : [];
  }

  #preferences() {
    const stored = this.block.properties.extraction_preferences;
    return Array.isArray(stored) ? stored.filter((kind): kind is ReferenceFindingKind => REFERENCE_FINDING_OPTIONS.some((option) => option.kind === kind)) : DEFAULT_REFERENCE_FINDINGS;
  }

  async #setPreference(kind: ReferenceFindingKind, enabled: boolean) {
    const previous = this.#preferences();
    const next = enabled ? [...new Set([...previous, kind])] : previous.filter((item) => item !== kind);
    await this.store.append({ type: "BlockPropertyEdited", payload: { block_id: this.block.id, property_path: "extraction_preferences", old_value: previous, new_value: next, source_surface: "reference-findings" } });
  }

  async #analyze() {
    const mediaUrl = String(this.block.properties.media_url ?? "");
    const referenceId = String(this.block.properties.reference_id ?? "");
    if (!mediaUrl || !referenceId) return;
    this.#analyzing = true; this.requestUpdate();
    try {
      const sample = await sampleImageUrl(mediaUrl);
      await this.store.extractReference(this.block.id, referenceId, sample, this.#preferences());
    } catch {
      this.store.toast("This reference could not be analyzed in the current browser.");
    } finally {
      this.#analyzing = false; this.requestUpdate();
    }
  }

  async #adopt(finding: ReferenceFinding) {
    if (finding.kind === "palette") {
      this.dispatchEvent(new CustomEvent("reference-palette-request", { bubbles: true, composed: true }));
      return;
    }
    const projection = this.store.projection.get();
    const id = crypto.randomUUID();
    const appended = await this.store.append({
      type: "BlockCreated",
      payload: {
        block_id: id,
        document_id: projection.documentId,
        type: finding.blockType,
        handle: findingHandle(finding, this.store.head.get() + 1),
        position: `z${String(this.store.head.get() + 1).padStart(5, "0")}`,
        properties: {
          text: finding.value,
          subtype: finding.subtype,
          weight: .62,
          authority: "authored",
          source_reference_id: String(this.block.properties.reference_id ?? ""),
          source_reference_block_id: this.block.id,
          source_finding_kind: finding.kind,
          extraction_confidence: finding.confidence,
          extraction_basis: finding.basis,
        },
      },
    });
    if (appended.length) {
      this.store.patchUi({ focusBlockId: id });
      this.store.toast(this.i18n.system("{label} added as an editable document decision.",{label:finding.label}));
    }
  }

  override render() {
    if (!this.block) return nothing;
    const findings = this.#findings();const jobActive=this.store.documentJobActive("extract_reference");
    const preferences = new Set(this.#preferences());
    const analysisFormId = `reference-analysis-${this.block.id}`;
    const projection = this.store.projection.get();
    const adoptedKinds = new Set(projection.blocks.filter((block) => block.properties.source_reference_block_id === this.block.id).map((block) => String(block.properties.source_finding_kind)));
    return html`<section class="reference-findings" aria-labelledby=${`reference-findings-${this.block.id}`}>
      <form id=${analysisFormId} @submit=${(event:SubmitEvent)=>{event.preventDefault();if(!this.#analyzing&&!jobActive)void this.#analyze();}}></form>
      <header>
        <div><span class="eyebrow">Image findings · optional</span><h3 id=${`reference-findings-${this.block.id}`}>Use what this image teaches</h3><p>Choose what to prepare, then add only the findings that should guide this document.</p></div>
        <button type="submit" form=${analysisFormId} class="button secondary compact" ?disabled=${this.#analyzing||jobActive}>${icon("spark")} ${this.#analyzing||jobActive ? this.i18n.system("Analyzing safely…") : findings.length ? this.i18n.system("Analyze again") : this.i18n.system("Analyze image")}</button>
      </header>
      <fieldset class="reference-finding-preferences"><legend>Prepare from this reference</legend>${REFERENCE_FINDING_OPTIONS.map((option) => html`<label><input form=${analysisFormId} type="checkbox" .checked=${preferences.has(option.kind)} @change=${(event: Event) => void this.#setPreference(option.kind, (event.target as HTMLInputElement).checked)}><span><b>${this.i18n.system(option.label)}</b><small>${this.i18n.system(option.description)}</small></span></label>`)}</fieldset>
      ${findings.length ? html`<div class="reference-finding-grid">${findings.filter((finding) => preferences.has(finding.kind)).map((finding) => {
        const adopted = finding.kind !== "palette" && adoptedKinds.has(finding.kind);
        return html`<article>
          <header><span>${REFERENCE_FINDING_OPTIONS.find((option) => option.kind === finding.kind)?.label ?? finding.kind}</span><b>${Math.round(finding.confidence * 100)}% suggestion</b></header>
          <h4>${finding.label}</h4><p>${finding.value}</p><small>${finding.basis}</small>
          ${finding.kind === "palette" && finding.colors?.length ? html`<div class="palette-strip" aria-label="Extracted palette">${finding.colors.map((color) => html`<i style=${`--swatch:${color}`}></i>`)}</div>` : nothing}
          <button type="button" class="button ${adopted ? "ghost" : "secondary"} compact" ?disabled=${adopted} @click=${() => this.#adopt(finding)}>${adopted ? html`${icon("check")} Added to document` : finding.kind === "palette" ? html`Choose a palette ${icon("arrow")}` : html`Add as decision ${icon("arrow")}`}</button>
        </article>`;
      })}</div>` : html`<div class="reference-findings-empty"><b>No expanded findings yet</b><p>Analyze the image to prepare mood, composition, material, lighting, palette, and spatial suggestions.</p></div>`}
    </section>`;
  }
}

if (!customElements.get("forma-reference-findings")) customElements.define("forma-reference-findings", ReferenceFindings);

declare global { interface HTMLElementTagNameMap { "forma-reference-findings": ReferenceFindings } }
