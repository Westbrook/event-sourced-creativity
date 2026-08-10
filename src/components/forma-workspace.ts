import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { contextDiff, foldEvents, shortEventType, type EventInput } from "../model/events";
import { sampleImageFile } from "../model/image-sample";
import type { ImageSample } from "../model/extractors";
import { retrieveFewShotExemplars, type RetrievedExemplar } from "../model/indexing";
import "./context-block";
import "./collection-tree";
import "./output-card";

type BlockKind = "direction"|"subject"|"composition"|"style"|"lighting"|"exclusion"|"palette"|"reference";
type BlockDraft = { type: BlockKind|""; text: string; colors: string[] };
const BLOCK_KINDS: Array<{type:BlockKind;label:string;description:string}> = [
  {type:"direction",label:"Direction",description:"A broad creative intention"},{type:"subject",label:"Subject",description:"What the work depicts"},{type:"composition",label:"Composition",description:"Framing, balance, and spatial structure"},{type:"style",label:"Style",description:"Visual language and treatment"},
  {type:"lighting",label:"Lighting",description:"Light, atmosphere, and time"},{type:"exclusion",label:"Exclusion",description:"Something the work must avoid"},{type:"palette",label:"Palette",description:"An authored set of colors"},{type:"reference",label:"Reference",description:"An owned or licensed image"},
];

export class FormaWorkspace extends FormaElement {
  #prompt = "";
  #blockDraft: BlockDraft | null = null;
  #documentName: string | null = null;
  #proposal: { prompt: string; events: EventInput[]; proposalId?: string; exemplars: RetrievedExemplar[] } | null = null;
  #uploading = false; #pendingUpload: File | null = null; #rightsConfirmed = false;

  #beginBlock() {
    this.#blockDraft = {type:"",text:"",colors:["#27252b","#e9a073","#e8d7bd","#8a6571"]}; this.requestUpdate();
  }
  async #addBlock(event: SubmitEvent) {
    event.preventDefault(); const draft = this.#blockDraft; const text = draft?.text.trim(); if (!draft?.type || draft.type === "reference" || !text) return;
    const blockId = crypto.randomUUID(); const slug = text.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,42) || `study-${this.store.head.get()+1}`;
    const properties = draft.type === "palette" ? {label:text,colors:draft.colors,weight:.64,authority:"authored"} : {text,weight:.64,authority:"authored"};
    const appended = await this.store.append({ type: "BlockCreated", payload: { block_id: blockId, type: draft.type, handle: `${draft.type}/${slug}`, position: `z${String(this.store.head.get()+1).padStart(4,"0")}`, properties } });
    if (appended.length) { this.#blockDraft = null; this.store.patchUi({ focusBlockId: blockId }); this.requestUpdate(); }
  }
  #queueUpload(event: Event) {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; if (!file) return;
    this.#pendingUpload = file; this.#rightsConfirmed = false; this.requestUpdate();
  }
  #resetFileInputs() { this.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input)=>{input.value="";}); }
  #cancelUpload() { this.#pendingUpload = null; this.#rightsConfirmed = false; this.#resetFileInputs(); this.requestUpdate(); }
  async #confirmUpload() {
    const file = this.#pendingUpload; if (!file || !this.#rightsConfirmed) return;
    this.#uploading = true; this.requestUpdate();
    try {
      let sample: ImageSample | null = null;
      try { sample = await sampleImageFile(file); } catch { /* Upload remains useful when this browser cannot sample an image. */ }
      const form = new FormData(); form.append("file", file); form.append("rightsConfirmed", "true"); const response = await fetch("/api/media", { method: "POST", body: form }); const media = await response.json() as { key?: string; url?: string; error?: string };
      if (!response.ok) throw new Error(media.error ?? "Upload failed");
      const ref = crypto.randomUUID(); const block = crypto.randomUUID();
      await this.store.appendBatch([
        { type: "ReferenceIngested", payload: { reference_id: ref, source_type: "upload", source_ref: media.url, content_hash: media.key, rights_class: "asserted" } },
        { type: "RightsAsserted", payload: { reference_id: ref, rights_class: "owned_or_licensed", assertion_method: "explicit-upload-confirmation" } },
        { type: "BlockCreated", payload: { block_id: block, type: "reference", handle: `reference/${file.name.replace(/\W+/g,"-").toLowerCase()}`, position: `z${this.store.head.get()}`, properties: { reference_id: ref, label: file.name, media_url: media.url, weight: .72, authority: "authored", extraction_status: sample ? "pending" : "unavailable" } } },
      ]);
      if (sample) await this.store.extractReference(block, ref, sample); else this.store.toast("Reference stored; deterministic extraction is unavailable in this browser.");
      this.#pendingUpload = null; this.#rightsConfirmed = false; this.#blockDraft = null; this.#resetFileInputs();
    } catch (error) { this.store.toast(error instanceof Error ? error.message : "Upload failed"); }
    this.#uploading = false; this.requestUpdate();
  }
  #blockComposer() {
    const draft = this.#blockDraft; if (!draft) return nothing; const selected = BLOCK_KINDS.find((option)=>option.type===draft.type);
    const placeholders:Record<string,string>={direction:"Describe the overall direction…",subject:"What should the work depict?",composition:"Describe the framing or structure…",style:"Describe the visual style…",lighting:"Describe the light and atmosphere…",exclusion:"What should the work avoid?",palette:"Name this palette…"};
    return html`<form class="block-composer" @submit=${this.#addBlock}><header><div><span class="eyebrow">New authored block</span><h3>${selected?selected.label:"Choose a block type"}</h3><p>${selected?.description??"Each type compiles differently and remains independently editable."}</p></div>${selected?html`<button type="button" class="text-button" @click=${()=>{draft.type="";this.requestUpdate();}}>Choose another type</button>`:nothing}</header>
      ${!draft.type?html`<div class="block-type-grid">${BLOCK_KINDS.map((option)=>html`<button type="button" @click=${()=>{draft.type=option.type;this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".block-composer textarea,.block-composer input")?.focus());}}><span>${option.label.slice(0,2).toUpperCase()}</span><b>${option.label}</b><small>${option.description}</small></button>`)}</div>`:draft.type==="reference"?html`<div class="reference-choice"><span>${icon("image")}</span><div><b>Choose an image reference</b><small>Its bytes stay in private object storage; rights are confirmed before upload.</small></div><label class="button primary">Choose image<input type="file" accept="image/*" @change=${this.#queueUpload}></label></div>`:draft.type==="palette"?html`<label class="block-draft-copy">Palette name<input maxlength="120" placeholder=${placeholders.palette} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><div class="draft-palette">${draft.colors.map((color,index)=>html`<label><input type="color" .value=${color} @input=${(event:InputEvent)=>{draft.colors=draft.colors.map((value,position)=>position===index?(event.target as HTMLInputElement).value:value);this.requestUpdate();}}><span style=${`--swatch:${color}`}></span><small>${color}</small></label>`)}</div>`:html`<label class="block-draft-copy">${selected?.label} content<textarea rows="3" placeholder=${placeholders[draft.type]} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>`}
      <footer><button type="button" class="button ghost" @click=${()=>{this.#blockDraft=null;this.requestUpdate();}}>Cancel</button>${draft.type&&draft.type!=="reference"?html`<button type="submit" class="button primary" ?disabled=${!draft.text.trim()}>Add ${selected?.label.toLowerCase()}</button>`:nothing}</footer></form>`;
  }
  async #ask() {
    const prompt = this.#prompt.trim(); if (!prompt) return;
    const p = this.store.projection.get(); const palette = p.blocks.find((b) => b.type === "palette");
    const events: EventInput[] = /warm/i.test(prompt) && palette ? [{ type: "BlockPropertyEdited", payload: { block_id: palette.id, property_path: "temperature", old_value: palette.properties.temperature ?? "neutral", new_value: "warmer" } }] : [{ type: "BlockCreated", payload: { block_id: crypto.randomUUID(), type: "direction", handle: `direction/chat-${this.store.head.get()}`, position: `z${this.store.head.get()}`, properties: { text: prompt, authority: "authored", weight: .7 } } }];
    const exemplars = retrieveFewShotExemplars(this.store.events.get(), prompt, this.store.content.get(), { limit: 3 });
    const exemplarRefs = exemplars.map((item) => ({ exemplar_id: item.exemplarId, evidence_refs: item.citations, similarity: Number(item.score.toFixed(3)), kind: item.kind }));
    const proposal = await this.store.propose(prompt, events, exemplarRefs); this.#proposal = { prompt, events, proposalId: proposal?.eventId, exemplars }; this.#prompt = ""; this.requestUpdate();
  }
  async #acceptProposal() {
    if (!this.#proposal) return; const proposal = this.#proposal;
    await this.store.appendBatch([{ type: "ProposalAccepted", payload: { proposal_event_id: proposal.proposalId, expected_sequence: this.store.head.get() } }, ...proposal.events]); this.#proposal = null; this.requestUpdate();
  }
  async #rejectProposal() {
    if (!this.#proposal) return; await this.store.append({ type: "ProposalRejected", payload: { proposal_event_id: this.#proposal.proposalId, reason_ref: null } }); this.#proposal = null; this.requestUpdate();
  }
  #renameProject() {
    const p = this.store.projection.get(); const next = window.prompt("Rename project", p.projectName)?.trim();
    if (next && next !== p.projectName) void this.store.append({ type: "ProjectRenamed", payload: { project_id: p.projectId, old_name: p.projectName, new_name: next } });
  }
  #beginDocumentRename(title: string) {
    this.#documentName = title; this.requestUpdate();
    void this.updateComplete.then(() => this.querySelector<HTMLInputElement>(".document-title-editor input")?.select());
  }
  async #renameDocument(event: SubmitEvent, documentId: string, currentTitle: string) {
    event.preventDefault(); const title = this.#documentName?.trim(); if (!title) return;
    if (title === currentTitle) { this.#documentName = null; this.requestUpdate(); return; }
    const appended = await this.store.append({ type: "DocumentRenamed", payload: { document_id: documentId, old_title: currentTitle, new_title: title } });
    if (appended.length) { this.#documentName = null; this.requestUpdate(); }
  }
  #compare() {
    const out = this.store.projection.get().outputs.slice(0,2); if (out.length < 2) return this.store.toast("Generate one more output to compare.");
    const ids = out.map((o) => o.id); void this.store.append({ type: "ComparisonOpened", payload: { object_ids: ids, source_surface: "studio" } }); this.store.patchUi({ compareOpen: true, comparisonOutputIds: ids.join("|") });
  }

  #comparison() {
    const events = this.store.events.get(); const ids = this.store.ui.comparisonOutputIds.split("|").filter(Boolean); const all = this.store.projection.get().libraryOutputs;
    const requested = ids.map((id) => all.find((output) => output.id === id)).filter((output): output is NonNullable<typeof output> => Boolean(output)); const outputs = requested.length >= 2 ? requested : all.slice(0,2);
    const completed = events.filter((event) => event.type === "GenerationCompleted" && (!outputs.length || outputs.some((output) => Array.isArray(event.payload.object_ids) && event.payload.object_ids.map(String).includes(output.id)))); const rightSeq = completed.at(-1)?.sequence ?? this.store.head.get(); const leftSeq = completed.at(-2)?.sequence ?? Math.max(1, rightSeq - 3);
    const left = foldEvents(events, leftSeq); const right = foldEvents(events, rightSeq); const diff = contextDiff(left, right);
    return html`<dialog class="modal comparison-modal" tabindex="-1" open closedby="any" aria-labelledby="compare-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({compareOpen:false});}}><div class="modal-card wide"><button class="icon-button modal-close" aria-label="Close comparison" @click=${() => this.store.patchUi({ compareOpen:false })}>${icon("close")}</button><span class="eyebrow">Decision frontier · witnessed</span><h2 id="compare-title">Compare two event-derived states</h2><div class="comparison-grid">${outputs.map((o,i) => html`<div><div class="output-art variant-${o.variant % 4}"><span class="art-glow"></span><span class="art-frame"></span><span class="art-vase"></span><span class="art-table"></span></div><b>${i ? "Previous" : "Current"} · ${o.id}</b></div>`)}</div><div class="diff-list"><h3>Context diff</h3>${diff.length ? diff.map((d) => html`<div><span class="status-dot ${d.status}"></span><b>${d.id}</b><span>${d.status}</span></div>`) : html`<p>No block changes — this comparison isolates generator variance.</p>`}</div></div></dialog>`;
  }
  #inspector() {
    const event = this.store.events.get().find((e) => e.eventId === this.store.ui.selectedEventId) ?? this.store.events.get().at(-1);
    if (!event) return nothing;
    return html`<aside class="inspector-panel" aria-label="Provenance inspector"><header><div><span class="eyebrow">Projection source</span><h2>${shortEventType(event.type)}</h2></div><button class="icon-button" aria-label="Close inspector" @click=${() => this.store.patchUi({ inspectorOpen:false })}>${icon("close")}</button></header><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd><dt>Authority</dt><dd>${event.actor === "user" ? "authored" : "inferred / operational"}</dd></dl><h3>Folded payload</h3><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${() => this.store.setRoute("/admin/events")}>Open in event admin ${icon("arrow")}</button><button @click=${() => navigator.clipboard.writeText(event.eventId)}>Copy event ID</button></div></aside>`;
  }

  override render() {
    const p = this.store.projection.get(); const output = p.outputs[0];
    return html`<section class="workspace-page">
      <aside class="studio-sidebar">
        <div class="project-switcher"><span class="eyebrow">Current project</span><button @click=${this.#renameProject}><b>${p.projectName}</b><small>${p.projectState} · edit</small></button></div>
        <forma-collection-tree></forma-collection-tree>
        <div class="side-links"><button @click=${() => this.store.setRoute("/library")}>Reusable blocks <span>${p.blocks.length}</span></button><button @click=${() => this.store.setRoute("/library")}>Recent outputs <span>${p.outputs.length}</span></button><button @click=${() => this.store.setRoute("/library")}>Aesthetic families <span>${Math.max(1,p.families.length)}</span></button></div>
        <div class="stream-peek"><span class="live-dot"></span><div><b>Durable stream</b><small>#${this.store.head.get()} · ${this.store.loading.get() ? "syncing" : "caught up"}</small></div><button @click=${() => this.store.setRoute("/admin/events")}>Review</button></div>
      </aside>
      <div class="studio-main">
        <div class="document-bar"><div><span class="eyebrow">Document / ${p.documentId || "loading"}</span>${this.#documentName===null?html`<div class="document-title-row"><h1>${p.documentTitle}</h1><button class="icon-button" aria-label=${`Rename ${p.documentTitle}`} title="Rename document" @click=${()=>this.#beginDocumentRename(p.documentTitle)}>${icon("edit")}</button></div>`:html`<form class="document-title-editor" @submit=${(event:SubmitEvent)=>this.#renameDocument(event,p.documentId,p.documentTitle)}><label class="sr-only" for="document-title-input">Document name</label><input id="document-title-input" maxlength="80" .value=${this.#documentName} @input=${(event:InputEvent)=>{this.#documentName=(event.target as HTMLInputElement).value;this.requestUpdate();}}><button type="button" class="button ghost compact" @click=${()=>{this.#documentName=null;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary compact" ?disabled=${!this.#documentName.trim()}>Save name</button></form>`}</div><div class="document-actions"><button class="icon-button labeled" @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button><button class="icon-button labeled" @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button><button class="button secondary compact" @click=${this.#compare}>${icon("compare")} Compare</button></div></div>
        <div class="studio-grid">
          <section class="context-column" aria-labelledby="context-title"><div class="section-heading"><div><span class="eyebrow">Projection · sequence ${this.store.head.get()}</span><h2 id="context-title">Creative context</h2></div><span class="health-pill"><i></i> replayable</span></div>
            ${p.blocks.length ? html`<div class="block-list">${p.blocks.map((block) => html`<forma-context-block .block=${block}></forma-context-block>`)}</div>` : this.#blockDraft === null ? html`<div class="blank-context"><span>${icon("plus")}</span><h3>This document is empty</h3><p>Add a typed context block, upload a reference, or ask Forma only when you are ready. Nothing is created on your behalf.</p><button class="button primary" @click=${this.#beginBlock}>Add a context block</button></div>` : nothing}
            ${this.#blockComposer()}
            ${this.#blockDraft===null&&p.blocks.length?html`<button class="add-block" @click=${this.#beginBlock}>${icon("plus")} Add context block</button>`:nothing}
            <div class="compile-bridge"><span>${icon("branch")}</span><div><b>Deterministic context compiler</b><small>${p.latestCompile ? "Snapshot embedded at last generation" : "Ready to compile"} · citations intact</small></div><button @click=${() => this.store.patchUi({ inspectorOpen:true })}>Inspect</button></div>
          </section>
          <section class="output-column" aria-labelledby="output-title"><div class="section-heading"><div><span class="eyebrow">${this.store.session.get()?.provider.configured ? `Live · ${this.store.session.get()?.provider.model}` : "Provider awaiting secure key"}</span><h2 id="output-title">Output</h2></div><button class="text-button" @click=${this.#compare}>Compare history</button></div>
            ${output ? html`<forma-output-card .output=${output} .primary=${true}></forma-output-card>` : html`<div class="empty-output"><span>${icon("image")}</span><h3>${p.blocks.length ? "Context is ready" : "A genuinely blank canvas"}</h3><p>${p.blocks.length ? "Generate a replayable simulation from the current projection." : "No context or output has been inferred. Add only what you choose."}</p></div>`}
            ${p.outputs.length > 1 ? html`<div class="output-filmstrip" aria-label="Previous outputs">${p.outputs.slice(1,5).map((o) => html`<button class="mini-output variant-${o.variant % 4} ${this.store.ui.selectedOutputId===o.id?"selected":""}" aria-label="Select ${o.id}" aria-pressed=${this.store.ui.selectedOutputId===o.id} @click=${() => { this.store.patchUi({ selectedOutputId:o.id }); if (this.store.ui.instrumentation) void this.store.hot({type:"ObjectViewed",payload:{object_id:o.id}}); }}></button>`)}</div>` : nothing}
            <label class="dropzone"><input type="file" accept="image/*" @change=${this.#queueUpload}><span>${icon("plus")}</span><b>${this.#uploading ? "Uploading…" : "Drop or choose a reference"}</b><small>Stored in R2 after an explicit ownership or license assertion</small></label>
          </section>
        </div>
      </div>
      ${this.store.ui.inspectorOpen ? this.#inspector() : nothing}
      <div class="composer-dock">
        ${this.#proposal ? html`<div class="proposal-preview"><div><span class="eyebrow">Proposed events · inert until accepted</span><b>${this.#proposal.events.map((e) => shortEventType(e.type)).join(" + ")}</b><small>Expected sequence ${this.store.head.get()} · previewed with context diff</small>${this.#proposal.exemplars.length ? html`<div class="proposal-corpus"><span>${icon("branch")} ${this.#proposal.exemplars.length} cited corpus match${this.#proposal.exemplars.length===1?"":"es"}</span>${this.#proposal.exemplars.map((item)=>html`<button title=${item.citations.join(" · ")} @click=${()=>{this.store.patchUi({selectedEventId:item.citations[0],inspectorOpen:true});}}>${item.label} · ${Math.round(item.score*100)}%</button>`)}</div>` : html`<small class="corpus-empty">No accepted precedent yet; this proposal can become one after explicit acceptance.</small>`}</div><button class="button ghost" @click=${this.#rejectProposal}>Decline</button><button class="button primary" @click=${this.#acceptProposal}>Accept proposal</button></div>` : nothing}
        <div class="composer"><label class="sr-only" for="creative-command">Describe a change or ask Forma</label><textarea id="creative-command" rows="1" placeholder="Describe a change — “make the palette warmer”…" .value=${this.#prompt} @input=${(e: InputEvent) => { this.#prompt = (e.target as HTMLTextAreaElement).value; }} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.#ask(); } }}></textarea><label class="icon-button add-ref" title="Add reference"><input type="file" accept="image/*" @change=${this.#queueUpload}>${icon("plus")}</label><button class="button secondary ask" @click=${this.#ask}>Ask Forma</button><button class="button primary generate" ?disabled=${!!this.store.busy.get() || !this.store.session.get()?.provider.configured} title=${this.store.session.get()?.provider.configured ? "Generate with the live provider" : "Connect OPENAI_API_KEY to enable generation"} @click=${() => this.store.generate()}>${icon("spark")} ${this.store.busy.get()==="generate" ? "Generating…" : "Generate"}</button></div>
      </div>
      ${this.store.ui.compareOpen ? this.#comparison() : nothing}
      ${this.#pendingUpload?html`<dialog class="modal upload-rights-modal" open closedby="any" aria-modal="true" aria-labelledby="upload-rights-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget&&!this.#uploading)this.#cancelUpload();}}><div class="modal-card"><button class="icon-button modal-close" aria-label="Cancel upload" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>${icon("close")}</button><span class="eyebrow">Rights checkpoint · before upload</span><h2 id="upload-rights-title">Confirm you may use this image</h2><div class="upload-file-receipt"><span>${icon("image")}</span><div><b>${this.#pendingUpload.name}</b><small>${(this.#pendingUpload.size/1_048_576).toFixed(1)} MB · ${this.#pendingUpload.type||"image"}</small></div></div><p>Forma will store this file privately and may send it to the configured generation provider when it becomes part of compiled context.</p><label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event:Event)=>{this.#rightsConfirmed=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>I own this image or have a license that permits this use.</b><small>This assertion is recorded alongside the reference. It does not transfer ownership.</small></span></label><footer><button class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>Cancel</button><button class="button primary" ?disabled=${!this.#rightsConfirmed||this.#uploading} @click=${this.#confirmUpload}>${this.#uploading?"Uploading securely…":"Confirm & upload"}</button></footer></div></dialog>`:nothing}
    </section>`;
  }
}
customElements.define("forma-workspace", FormaWorkspace);
