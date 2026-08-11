import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { contextDiff, foldEvents, shortEventType, type EventInput } from "../model/events";
import { sampleImageFile } from "../model/image-sample";
import type { ImageSample } from "../model/extractors";
import { retrieveFewShotExemplars, type RetrievedExemplar } from "../model/indexing";
import { BLOCK_TYPES, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import "./context-block";
import "./output-card";
import "./project-rail";
import "./studio-navigation";

type BlockDraft = { type: BlockKind|""; subtype: string; text: string; colors: string[] };
const BLOCK_KINDS = BLOCK_TYPES;

export class FormaWorkspace extends FormaElement {
  #prompt = "";
  #blockDraft: BlockDraft | null = null;
  #documentName: string | null = null;
  #proposal: { prompt: string; events: EventInput[]; proposalId?: string; exemplars: RetrievedExemplar[] } | null = null;
  #uploading = false; #pendingUpload: File | null = null; #rightsConfirmed = false;
  #projectSettings=false;#projectName="";#projectState="active";#deleteDocument=false;

  protected override updated() {
    this.querySelectorAll<HTMLDialogElement>("dialog.workspace-modal").forEach((dialog)=>{if(!dialog.open)dialog.showModal();});
  }

  #beginBlock() {
    this.#blockDraft = {type:"",subtype:"",text:"",colors:["#27252b","#e9a073","#e8d7bd","#8a6571"]}; this.requestUpdate();
  }
  #closeBlock(){this.querySelector<HTMLDialogElement>(".block-composer-dialog")?.close();this.#blockDraft=null;this.requestUpdate();}
  async #addBlock(event: SubmitEvent) {
    event.preventDefault(); const draft = this.#blockDraft; const text = draft?.text.trim(); if (!draft?.type || draft.type === "reference" || !text) return;
    const blockId = crypto.randomUUID(); const slug = text.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,42) || `study-${this.store.head.get()+1}`;
    const properties = draft.type === "palette" ? {label:text,colors:draft.colors,subtype:draft.subtype||suggestedSubtype(draft.type),weight:.64,authority:"authored"} : {text,subtype:draft.subtype||suggestedSubtype(draft.type),weight:.64,authority:"authored"};
    const appended = await this.store.append({ type: "BlockCreated", payload: { block_id: blockId, type: draft.type, handle: `${draft.type}/${slug}`, position: `z${String(this.store.head.get()+1).padStart(4,"0")}`, properties } });
    if (appended.length) { this.#closeBlock(); this.store.patchUi({ focusBlockId: blockId }); }
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
        { type: "BlockCreated", payload: { block_id: block, type: "reference", handle: `reference/${file.name.replace(/\W+/g,"-").toLowerCase()}`, position: `z${this.store.head.get()}`, properties: { reference_id: ref, label: file.name, media_url: media.url, subtype: "Mood", weight: .72, authority: "authored", extraction_status: sample ? "pending" : "unavailable" } } },
      ]);
      if (sample) await this.store.extractReference(block, ref, sample); else this.store.toast("Reference stored; deterministic extraction is unavailable in this browser.");
      this.#pendingUpload = null; this.#rightsConfirmed = false; this.#blockDraft = null; this.#resetFileInputs();
    } catch (error) { this.store.toast(error instanceof Error ? error.message : "Upload failed"); }
    this.#uploading = false; this.requestUpdate();
  }
  #blockComposer() {
    const draft = this.#blockDraft; if (!draft) return nothing; const selected = blockTypeDefinition(draft.type);
    return html`<dialog class="modal workspace-modal block-composer-dialog" closedby="any" aria-labelledby="block-composer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeBlock();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeBlock();}} @close=${()=>{if(this.#blockDraft){this.#blockDraft=null;this.requestUpdate();}}}><form class="modal-card wide block-composer" @submit=${this.#addBlock}><button type="button" class="icon-button modal-close" aria-label="Close authored block dialog" @click=${this.#closeBlock}>${icon("close")}</button><header><div><span class="eyebrow">New authored block</span><h3 id="block-composer-title">${selected?selected.label:"Choose a block type"}</h3><p>${selected?.description??"Each type compiles differently and remains independently editable."}</p></div>${selected?html`<button type="button" class="text-button" @click=${()=>{draft.type="";this.requestUpdate();}}>Choose another type</button>`:nothing}</header>
      ${!draft.type?html`<div class="block-type-grid">${BLOCK_KINDS.map((option)=>html`<button type="button" @click=${()=>{draft.type=option.type;draft.subtype=option.subtypes[0];this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".block-composer textarea,.block-composer input")?.focus());}}><span>${option.label.slice(0,2).toUpperCase()}</span><b>${option.label}</b><small>${option.description}</small></button>`)}</div>`:html`<fieldset class="subtype-picker"><legend>System-suggested subtype</legend>${selected?.subtypes.map((subtype)=>html`<label><input type="radio" name="block-subtype" .value=${subtype} .checked=${draft.subtype===subtype} @change=${()=>{draft.subtype=subtype;this.requestUpdate();}}><span>${subtype}</span></label>`)}</fieldset>${draft.type==="reference"?html`<div class="reference-choice"><span>${icon("image")}</span><div><b>Choose an image reference</b><small>Its bytes stay in private object storage; rights are confirmed before upload.</small></div><label class="button primary">Choose image<input type="file" accept="image/*" @change=${this.#queueUpload}></label></div>`:draft.type==="palette"?html`<label class="block-draft-copy">Palette name<input maxlength="120" placeholder=${selected?.prompt} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><div class="draft-palette">${draft.colors.map((color,index)=>html`<label><input type="color" .value=${color} @input=${(event:InputEvent)=>{draft.colors=draft.colors.map((value,position)=>position===index?(event.target as HTMLInputElement).value:value);this.requestUpdate();}}><span style=${`--swatch:${color}`}></span><small>${color}</small></label>`)}</div>`:html`<label class="block-draft-copy">${selected?.label} content<textarea rows="3" placeholder=${selected?.prompt} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>`}`}
      <footer><button type="button" class="button ghost" @click=${this.#closeBlock}>Cancel</button>${draft.type&&draft.type!=="reference"?html`<button type="submit" class="button primary" ?disabled=${!draft.text.trim()}>Add ${selected?.label.toLowerCase()}</button>`:nothing}</footer></form></dialog>`;
  }
  #proposedEvents(prompt:string):EventInput[]{
    const projection=this.store.projection.get();const palette=projection.blocks.find((block)=>block.type==="palette");const lower=prompt.toLowerCase();
    if(/warm|cool|temperature/.test(lower)&&palette)return[{type:"BlockPropertyEdited",payload:{block_id:palette.id,property_path:"temperature",old_value:palette.properties.temperature??"neutral",new_value:/cool/.test(lower)?"cooler":"warmer"}}];
    const type:BlockKind=/avoid|exclude|without|no\s/.test(lower)?"exclusion":/composit|framing|layout|balance/.test(lower)?"composition":/light|shadow|dusk|daylight/.test(lower)?"lighting":/palette|color|colour|hue/.test(lower)?"palette":/subject|depict|show|feature/.test(lower)?"subject":/style|texture|treatment|aesthetic/.test(lower)?"style":"direction";
    const blockId=crypto.randomUUID();const slug=prompt.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,38)||`chat-${this.store.head.get()}`;
    const properties=type==="palette"?{label:prompt,colors:["#27252b","#e9a073","#e8d7bd","#8a6571"],subtype:suggestedSubtype(type),authority:"authored",weight:.7}:{text:prompt,subtype:suggestedSubtype(type),authority:"authored",weight:.7};
    return[{type:"BlockCreated",payload:{block_id:blockId,document_id:projection.documentId,type,handle:`${type}/${slug}`,position:`z${this.store.head.get()}`,properties}}];
  }
  async #ask() {
    const prompt = this.#prompt.trim(); if (!prompt) return;
    const events=this.#proposedEvents(prompt);
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
  #openProjectSettings(){const projection=this.store.projection.get();this.#projectName=projection.projectName;this.#projectState=projection.projectState;this.#projectSettings=true;this.requestUpdate();}
  #closeProjectSettings(){this.querySelector<HTMLDialogElement>(".project-settings-dialog")?.close();this.#projectSettings=false;this.requestUpdate();}
  #openDeleteDocument(){if(this.store.projection.get().documents.length<=1){this.store.toast("Create another document before removing the project’s final document.");return;}this.#deleteDocument=true;this.requestUpdate();}
  #closeDeleteDocument(){this.querySelector<HTMLDialogElement>(".studio-document-delete-dialog")?.close();this.#deleteDocument=false;this.requestUpdate();}
  async #confirmDeleteDocument(){const appended=await this.store.removeDocument(this.store.projection.get().documentId);if(appended.length)this.#closeDeleteDocument();}
  async #saveProject(event:SubmitEvent){event.preventDefault();const projection=this.store.projection.get();const name=this.#projectName.trim();if(!name)return;const changes:EventInput[]=[];if(name!==projection.projectName)changes.push({type:"ProjectRenamed",payload:{project_id:projection.projectId,old_name:projection.projectName,new_name:name}});if(this.#projectState!==projection.projectState)changes.push({type:"ProjectStateChanged",payload:{project_id:projection.projectId,state:this.#projectState,previous_state:projection.projectState}});if(changes.length){const appended=await this.store.appendBatch(changes);if(!appended.length)return;}this.#closeProjectSettings();}
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
    return html`<dialog class="modal workspace-modal comparison-modal" tabindex="-1" closedby="any" aria-labelledby="compare-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({compareOpen:false});}} @cancel=${(event:Event)=>{event.preventDefault();this.store.patchUi({compareOpen:false});}} @close=${()=>{if(this.store.ui.compareOpen)this.store.patchUi({compareOpen:false});}}><div class="modal-card wide"><button class="icon-button modal-close" aria-label="Close comparison" @click=${() => this.store.patchUi({ compareOpen:false })}>${icon("close")}</button><span class="eyebrow">Decision frontier · witnessed</span><h2 id="compare-title">Compare two event-derived states</h2><div class="comparison-grid">${outputs.map((o,i) => html`<div><div class="output-art variant-${o.variant % 4}"><span class="art-glow"></span><span class="art-frame"></span><span class="art-vase"></span><span class="art-table"></span></div><b>${i ? "Previous" : "Current"} · ${o.id}</b></div>`)}</div><div class="diff-list"><h3>Context diff</h3>${diff.length ? diff.map((d) => html`<div><span class="status-dot ${d.status}"></span><b>${d.id}</b><span>${d.status}</span></div>`) : html`<p>No block changes — this comparison isolates generator variance.</p>`}</div></div></dialog>`;
  }
  #inspector() {
    const event = this.store.events.get().find((e) => e.eventId === this.store.ui.selectedEventId) ?? this.store.events.get().at(-1);
    if (!event) return nothing;
    return html`<aside class="inspector-panel" aria-label="Provenance inspector"><header><div><span class="eyebrow">Projection source</span><h2>${shortEventType(event.type)}</h2></div><button class="icon-button" aria-label="Close inspector" @click=${() => this.store.patchUi({ inspectorOpen:false })}>${icon("close")}</button></header><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd><dt>Authority</dt><dd>${event.actor === "user" ? "authored" : "inferred / operational"}</dd></dl><h3>Folded payload</h3><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${() => this.store.setRoute("/admin/events")}>Open in event admin ${icon("arrow")}</button><button @click=${() => navigator.clipboard.writeText(event.eventId)}>Copy event ID</button></div></aside>`;
  }

  override render() {
    const p = this.store.projection.get(); const output = p.outputs.find((item)=>item.id===this.store.ui.selectedOutputId)??p.outputs[0]; const canCompare=p.outputs.length>=2;const contextGroups=new Set(p.blocks.map((block)=>blockTypeDefinition(block.type)?.group).filter(Boolean));const documentInsight=contextGroups.size>=4?`Aha: ${p.blocks.length} independently editable decisions now compile into one output while every source remains inspectable.`:`This document resolves ${contextGroups.size} of 5 context areas. Switch views to discover whether the remaining gaps are intentional.`;
    return html`<section class="workspace-page">
      <forma-project-rail surface="studio" destination="/" @edit-project=${()=>this.#openProjectSettings()}></forma-project-rail>
      <div class="studio-main">
        <div class="document-bar page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${p.projectName} / Document</span>${this.#documentName===null?html`<div class="document-title-row"><h1>${p.documentTitle}</h1><button class="icon-button" aria-label=${`Rename ${p.documentTitle}`} title="Rename document" @click=${()=>this.#beginDocumentRename(p.documentTitle)}>${icon("edit")}</button></div>`:html`<form class="document-title-editor" @submit=${(event:SubmitEvent)=>this.#renameDocument(event,p.documentId,p.documentTitle)}><label class="sr-only" for="document-title-input">Document name</label><input id="document-title-input" maxlength="80" .value=${this.#documentName} @input=${(event:InputEvent)=>{this.#documentName=(event.target as HTMLInputElement).value;this.requestUpdate();}}><button type="button" class="button ghost compact" @click=${()=>{this.#documentName=null;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary compact" ?disabled=${!this.#documentName.trim()}>Save name</button></form>`}</div><div class="document-actions page-header-actions"><button class="icon-button labeled" ?disabled=${!this.store.canUndo()} title=${this.store.canUndo()?"Undo the latest reversible authored change":"No reversible authored change"} @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button><button class="icon-button labeled" ?disabled=${!this.store.canRedo()} title=${this.store.canRedo()?"Redo the last undone change":"Nothing has been undone in this session"} @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button><button class="button secondary compact" ?disabled=${!canCompare} title=${canCompare?"Compare the two latest outputs":"Generate one more output to compare"} @click=${this.#compare}>${icon("compare")} Compare</button><button class="icon-button labeled danger-quiet" ?disabled=${p.documents.length<=1} title=${p.documents.length<=1?"Create another document before removing the final document":"Remove this document"} @click=${this.#openDeleteDocument}>${icon("trash")}<span>Remove</span></button></div></div>
        <forma-studio-mode-nav active="document"></forma-studio-mode-nav>
        <div class="studio-grid">
          <section class="context-column" aria-labelledby="context-title"><div class="section-heading"><div><span class="eyebrow">Projection · sequence ${this.store.head.get()}</span><h2 id="context-title">Creative context</h2></div><span class="health-pill"><i></i> replayable</span></div>
            ${p.blocks.length ? html`<div class="block-list">${p.blocks.map((block) => html`<forma-context-block .block=${block}></forma-context-block>`)}</div>` : this.#blockDraft === null ? html`<div class="blank-context"><span>${icon("plus")}</span><h3>This document is empty</h3><p>Add a typed context block, upload a reference, or ask Forma only when you are ready. Nothing is created on your behalf.</p><button class="button primary" @click=${this.#beginBlock}>Add a context block</button></div>` : nothing}
            ${this.#blockComposer()}
            ${this.#blockDraft===null&&p.blocks.length?html`<button class="add-block" @click=${this.#beginBlock}>${icon("plus")} Add context block</button>`:nothing}
            ${p.blocks.length?html`<div class="document-insight"><span>${icon("branch")}</span><p>${documentInsight}</p><button @click=${()=>this.store.setRoute("/studio/board")}>See spatially ${icon("arrow")}</button></div>`:nothing}
            <div class="compile-bridge"><span>${icon("branch")}</span><div><b>Deterministic context compiler</b><small>${p.latestCompile ? "Snapshot embedded at last generation" : "Ready to compile"} · citations intact</small></div><button @click=${() => this.store.patchUi({ inspectorOpen:true })}>Inspect</button></div>
          </section>
          <section class="output-column" aria-labelledby="output-title"><div class="section-heading"><div><span class="eyebrow">${this.store.session.get()?.provider.configured ? `Live · ${this.store.session.get()?.provider.model}` : "Provider awaiting secure key"}</span><h2 id="output-title">Output</h2></div><button class="text-button" ?disabled=${!canCompare} title=${canCompare?"Compare output history":"Generate one more output to compare"} @click=${this.#compare}>Compare history</button></div>
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
      ${this.#projectSettings?html`<dialog class="modal workspace-modal project-settings-dialog" closedby="any" aria-labelledby="project-settings-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeProjectSettings();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeProjectSettings();}} @close=${()=>{if(this.#projectSettings){this.#projectSettings=false;this.requestUpdate();}}}><form class="modal-card project-settings-form" @submit=${this.#saveProject}><button type="button" class="icon-button modal-close" aria-label="Close project settings" @click=${this.#closeProjectSettings}>${icon("close")}</button><span class="eyebrow">Project settings</span><h2 id="project-settings-title">Edit ${p.projectName}</h2><label>Project name<input maxlength="80" required .value=${this.#projectName} @input=${(event:InputEvent)=>{this.#projectName=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><label>Project state<select .value=${this.#projectState} @change=${(event:Event)=>{this.#projectState=(event.target as HTMLSelectElement).value;}}><option value="active">Active</option><option value="archived">Archived</option><option value="paused">Paused</option></select><small>State changes are reversible events; they never delete project history.</small></label><footer><button type="button" class="button ghost" @click=${this.#closeProjectSettings}>Cancel</button><button class="button primary" ?disabled=${!this.#projectName.trim()}>Save project</button></footer></form></dialog>`:nothing}
      ${this.#deleteDocument?html`<dialog class="modal workspace-modal document-delete-dialog studio-document-delete-dialog" closedby="any" aria-labelledby="studio-delete-document-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeDeleteDocument();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeDeleteDocument();}} @close=${()=>{if(this.#deleteDocument){this.#deleteDocument=false;this.requestUpdate();}}}><div class="modal-card document-delete-card"><button class="icon-button modal-close" aria-label="Cancel document removal" @click=${this.#closeDeleteDocument}>${icon("close")}</button><span class="eyebrow">Reversible removal · event-sourced</span><h2 id="studio-delete-document-title">Remove “${p.documentTitle}”?</h2><p>The document, its blocks, and its outputs will leave active Studio and Library views. Another document will open automatically, and Undo can restore this one from the durable stream.</p><div class="document-delete-summary"><span>${icon("trash")}</span><div><b>${p.documentTitle}</b><small>${p.documentId}</small></div></div><footer><button class="button ghost" @click=${this.#closeDeleteDocument}>Cancel</button><button class="button danger" @click=${this.#confirmDeleteDocument}>Remove document</button></footer></div></dialog>`:nothing}
      ${this.#pendingUpload?html`<dialog class="modal workspace-modal upload-rights-modal" closedby="any" aria-modal="true" aria-labelledby="upload-rights-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget&&!this.#uploading)this.#cancelUpload();}} @cancel=${(event:Event)=>{event.preventDefault();if(!this.#uploading)this.#cancelUpload();}} @close=${()=>{if(this.#pendingUpload&&!this.#uploading){this.#pendingUpload=null;this.#rightsConfirmed=false;this.requestUpdate();}}}><div class="modal-card"><button class="icon-button modal-close" aria-label="Cancel upload" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>${icon("close")}</button><span class="eyebrow">Rights checkpoint · before upload</span><h2 id="upload-rights-title">Confirm you may use this image</h2><div class="upload-file-receipt"><span>${icon("image")}</span><div><b>${this.#pendingUpload.name}</b><small>${(this.#pendingUpload.size/1_048_576).toFixed(1)} MB · ${this.#pendingUpload.type||"image"}</small></div></div><p>Forma will store this file privately and may send it to the configured generation provider when it becomes part of compiled context.</p><label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event:Event)=>{this.#rightsConfirmed=(event.target as HTMLInputElement).checked;this.requestUpdate();}}><span><b>I own this image or have a license that permits this use.</b><small>This assertion is recorded alongside the reference. It does not transfer ownership.</small></span></label><footer><button class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>Cancel</button><button class="button primary" ?disabled=${!this.#rightsConfirmed||this.#uploading} @click=${this.#confirmUpload}>${this.#uploading?"Uploading securely…":"Confirm & upload"}</button></footer></div></dialog>`:nothing}
    </section>`;
  }
}
customElements.define("forma-workspace", FormaWorkspace);
