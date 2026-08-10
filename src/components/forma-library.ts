import { html, nothing } from "lit";
import { FormaElement, icon, downloadJson } from "./forma-element";
import { exportArchive, importArchive, type FormaArchive } from "../model/archive";
import { foldEvents } from "../model/events";
import "./collection-tree";
import "./output-card";

type LibraryView = "all"|"blocks"|"outputs"|"families";

export class FormaLibrary extends FormaElement {
  #query = ""; #view: LibraryView = "all"; #imported?: FormaArchive;
  #promote() {
    const id = crypto.randomUUID(); void this.store.append({ type: "CollectionCreated", payload: { collection_id: id, handle: "warm-nocturnes", parent_collection_id: null, position: `z${this.store.head.get()}`, source_claim_ref: "family:warm-nocturnes" } }); this.store.toast("Family promoted by your authored collection event.");
  }
  async #import(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
    try { this.#imported = importArchive(JSON.parse(await file.text())); this.requestUpdate(); }
    catch (error) { this.store.toast(error instanceof Error ? error.message : "Import failed"); }
  }
  #forkImport() {
    if (!this.#imported) return; const p = foldEvents(this.#imported.events); const documentId = crypto.randomUUID();
    const events = [{ type: "DocumentForked", payload: { document_id: documentId, source_stream_id: this.#imported.streamId, source_sequence: this.#imported.events.at(-1)?.sequence ?? 0, carried_block_ids: p.blocks.map((b)=>b.id) } }, ...p.blocks.map((b,i)=>({ type:"BlockCreated", payload:{ block_id:crypto.randomUUID(), type:b.type, handle:`${b.handle}-import`, position:`z${i}`, properties:b.properties }}))];
    void this.store.appendBatch(events); this.#imported=undefined; this.requestUpdate(); this.store.toast("Archive imported as a fork; original event identities remain in its source receipt.");
  }
  override render() {
    const p = this.store.projection.get(); const q = this.#query.toLowerCase(); const blocks = p.blocks.filter((b)=>!q||b.handle.toLowerCase().includes(q)); const outputs = p.outputs.filter((o)=>!q||o.id.toLowerCase().includes(q));
    return html`<section class="library-page page-pad"><header class="page-hero"><div><span class="eyebrow">Authored organization + inferred discovery</span><h1>Creative library</h1><p>Reuse blocks, file work deliberately, and promote useful inferred families without letting the system organize on your behalf.</p></div><div class="hero-actions"><label class="button secondary file-button">${icon("download")} Import archive<input type="file" accept="application/json" @change=${this.#import}></label><button class="button primary" @click=${()=>downloadJson("forma-full-graph.json",exportArchive(this.store.events.get()))}>${icon("share")} Export full graph</button></div></header>
      <div class="library-toolbar"><div class="searchbox">${icon("search")}<input placeholder="Search handles, outputs, and families" .value=${this.#query} @input=${(e:InputEvent)=>{this.#query=(e.target as HTMLInputElement).value;this.requestUpdate();}}></div><div class="segmented">${[["all","All"],["blocks","Blocks"],["outputs","Outputs"],["families","Families"]].map(([key,label])=>html`<button class=${this.#view===key?"active":""} @click=${()=>{this.#view=key as LibraryView;this.requestUpdate();}}>${label}</button>`)}</div></div>
      <div class="library-layout"><aside class="library-tree"><forma-collection-tree></forma-collection-tree><div class="library-principle"><span>${icon("info")}</span><p><b>No auto-filing.</b> Collections express authored intent. Search and families remain derived views.</p></div></aside><div class="library-content">
        ${this.#view==="all"||this.#view==="blocks"?html`<section><div class="section-heading"><div><span class="eyebrow">Portable context</span><h2>Reusable blocks</h2></div><span>${blocks.length}</span></div><div class="asset-grid">${blocks.map((b)=>html`<article class="asset-card"><div class="asset-preview ${b.type}">${b.type==="palette"&&Array.isArray(b.properties.colors)?(b.properties.colors as string[]).map(c=>html`<i style="background:${c}"></i>`):html`<span>${icon(b.type==="reference"?"image":"spark")}</span>`}</div><span class="block-type">${b.type}</span><h3>${b.handle}</h3><p>${String(b.properties.text??b.properties.label??"Reusable context primitive")}</p><div><small class="authority ${String(b.properties.authority??"authored")}">${String(b.properties.authority??"authored")}</small><button @click=${()=>this.store.append({type:"BlockCreated",payload:{...b,block_id:crypto.randomUUID(),handle:`${b.handle}-copy`,position:`z${this.store.head.get()}`}})}>Use a copy ${icon("arrow")}</button></div></article>`)}</div></section>`:nothing}
        ${this.#view==="all"||this.#view==="outputs"?html`<section><div class="section-heading"><div><span class="eyebrow">Terminal and provisional outcomes</span><h2>Recent outputs</h2></div><span>${outputs.length}</span></div><div class="library-output-grid">${outputs.map((o)=>html`<div class="library-output"><forma-output-card .output=${o}></forma-output-card><button class="library-toggle" @click=${()=>this.store.append({type:o.library?"RemovedFromLibrary":"AddedToLibrary",payload:{object_id:o.id,item_id:o.id}})}>${o.library?"Remove from library":"Add to library"}</button></div>`)}</div></section>`:nothing}
        ${this.#view==="all"||this.#view==="families"?html`<section><div class="section-heading"><div><span class="eyebrow">Inferred, correctable, decaying</span><h2>Aesthetic families</h2></div><span>${Math.max(1,p.families.length)}</span></div><article class="family-card"><div class="family-collage"><i class="variant-0"></i><i class="variant-1"></i><i class="variant-2"></i></div><div><span class="authority inferred">inferred · 81% confidence</span><h3>Warm nocturnes</h3><p>Low-light interiors, softened edges, and a narrow amber–plum temperature range. Evidence: 7 saves, 3 comparisons, 2 palette corrections.</p><div class="family-actions"><button class="button primary" @click=${this.#promote}>Keep as collection</button><button class="button ghost" @click=${()=>this.store.append({type:"ClaimSuperseded",payload:{claim_ref:"family:warm-nocturnes",previous_event_id:"family-seed",new_event_id:null}})}>Correct family</button></div></div></article></section>`:nothing}
      </div></div>
      ${this.#imported?html`<dialog class="modal" open aria-labelledby="import-title"><div class="modal-card"><button class="icon-button modal-close" @click=${()=>{this.#imported=undefined;this.requestUpdate();}}>${icon("close")}</button><span class="eyebrow">Lossless archive verified</span><h2 id="import-title">Import as a document fork?</h2><p>${this.#imported.events.length} immutable events from <code>${this.#imported.streamId}</code> passed format validation. Importing creates a new fork; it never reuses source event IDs.</p><div class="metric-grid"><div><b>${foldEvents(this.#imported.events).blocks.length}</b><span>blocks</span></div><div><b>${foldEvents(this.#imported.events).outputs.length}</b><span>outputs</span></div><div><b>${this.#imported.mediaManifest.length}</b><span>media receipts</span></div></div><button class="button primary" @click=${this.#forkImport}>Import as fork</button></div></dialog>`:nothing}
    </section>`;
  }
}
customElements.define("forma-library", FormaLibrary);
