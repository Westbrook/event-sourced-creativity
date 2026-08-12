import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { contextDiff, foldEvents, shortEventType, type CreativeBlock, type EventInput } from "../model/events";
import { sampleImageFile } from "../model/image-sample";
import { DEFAULT_REFERENCE_FINDINGS, REFERENCE_FINDING_OPTIONS, type ImageSample, type ReferenceFindingKind } from "../model/extractors";
import { retrieveFewShotExemplars, type RetrievedExemplar } from "../model/indexing";
import { BLOCK_GROUPS, BLOCK_TYPES, blockIntentFor, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import { spatialScopeLabel } from "../model/spatial-scope";
import "./context-block";
import "./output-card";
import "./project-rail";
import "./studio-navigation";
import "./generation-actions";

type BlockDraft = { type: BlockKind|""; subtype: string; text: string; colors: string[] };

export class FormaWorkspace extends FormaElement {
  #prompt = "";
  #blockDraft: BlockDraft | null = null;
  #documentName: string | null = null;
  #proposal: { prompt: string; events: EventInput[]; proposalId?: string; exemplars: RetrievedExemplar[] } | null = null;
  #uploading = false; #pendingUpload: File | null = null; #rightsConfirmed = false;
  #referenceFindingKinds = new Set<ReferenceFindingKind>(DEFAULT_REFERENCE_FINDINGS);
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
    this.#pendingUpload = file; this.#rightsConfirmed = false; this.#referenceFindingKinds = new Set(DEFAULT_REFERENCE_FINDINGS); this.requestUpdate();
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
      const findingKinds=[...this.#referenceFindingKinds];
      await this.store.appendBatch([
        { type: "ReferenceIngested", payload: { reference_id: ref, source_type: "upload", source_ref: media.url, content_hash: media.key, rights_class: "asserted" } },
        { type: "RightsAsserted", payload: { reference_id: ref, rights_class: "owned_or_licensed", assertion_method: "explicit-upload-confirmation" } },
        { type: "BlockCreated", payload: { block_id: block, type: "reference", handle: `reference/${file.name.replace(/\W+/g,"-").toLowerCase()}`, position: `z${this.store.head.get()}`, properties: { reference_id: ref, label: file.name, media_url: media.url, subtype: "Mood", weight: .72, authority: "authored", extraction_preferences: findingKinds, extraction_status: sample ? "pending" : "unavailable" } } },
      ]);
      if (sample) await this.store.extractReference(block, ref, sample, findingKinds); else this.store.toast("Reference stored; image findings can be analyzed later from the block.");
      this.#pendingUpload = null; this.#rightsConfirmed = false; this.#blockDraft = null; this.#resetFileInputs();
    } catch (error) { this.store.toast(error instanceof Error ? error.message : "Upload failed"); }
    this.#uploading = false; this.requestUpdate();
  }
  #blockComposer() {
    const draft = this.#blockDraft; if (!draft) return nothing; const selected = blockTypeDefinition(draft.type);
    return html`<dialog class="modal workspace-modal block-composer-dialog" closedby="any" aria-labelledby="block-composer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeBlock();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeBlock();}} @close=${()=>{if(this.#blockDraft){this.#blockDraft=null;this.requestUpdate();}}}><form class="modal-card wide block-composer" @submit=${this.#addBlock}><button type="button" class="icon-button modal-close" aria-label="Close authored block dialog" @click=${this.#closeBlock}>${icon("close")}</button><header><div><span class="eyebrow">New authored block</span><h3 id="block-composer-title">${selected?selected.label:"Choose a block type"}</h3><p>${selected?.description??"Each type compiles differently and remains independently editable."}</p></div>${selected?html`<button type="button" class="text-button" @click=${()=>{draft.type="";this.requestUpdate();}}>Choose another type</button>`:nothing}</header>
      ${!draft.type?html`<div class="block-type-catalog">${BLOCK_GROUPS.map((group)=>{const options=BLOCK_TYPES.filter((option)=>option.group===group.id);return html`<section class="block-type-group" aria-labelledby=${`block-group-${group.id}`}><header><div><h4 id=${`block-group-${group.id}`}>${group.label}</h4><p>${group.description}</p></div><span>${options.length} ${options.length===1?"type":"types"}</span></header><div class="block-type-grid">${options.map((option)=>html`<button type="button" @click=${()=>{draft.type=option.type;draft.subtype=option.subtypes[0];this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".block-composer textarea,.block-composer input")?.focus());}}><span>${option.label.slice(0,2).toUpperCase()}</span><b>${option.label}</b><small>${option.description}</small></button>`)}</div></section>`;})}</div>`:html`<fieldset class="subtype-picker"><legend>System-suggested subtype</legend>${selected?.subtypes.map((subtype)=>html`<label><input type="radio" name="block-subtype" .value=${subtype} .checked=${draft.subtype===subtype} @change=${()=>{draft.subtype=subtype;this.requestUpdate();}}><span>${subtype}</span></label>`)}</fieldset>${draft.type==="reference"?html`<div class="reference-choice"><span>${icon("image")}</span><div><b>Choose an image reference</b><small>Its bytes stay in private object storage; rights are confirmed before upload.</small></div><label class="button primary">Choose image<input type="file" accept="image/*" @change=${this.#queueUpload}></label></div>`:draft.type==="palette"?html`<label class="block-draft-copy">Palette name<input maxlength="120" placeholder=${selected?.prompt} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><div class="draft-palette">${draft.colors.map((color,index)=>html`<label><input type="color" .value=${color} @input=${(event:InputEvent)=>{draft.colors=draft.colors.map((value,position)=>position===index?(event.target as HTMLInputElement).value:value);this.requestUpdate();}}><span style=${`--swatch:${color}`}></span><small>${color}</small></label>`)}</div>`:html`<label class="block-draft-copy">${selected?.label} content<textarea rows="3" placeholder=${selected?.prompt} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>`}`}
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

  #decisionText(block:CreativeBlock|undefined){
    if(!block)return "this decision";
    const value=String(block.properties.text??block.properties.label??block.handle).trim();
    return value.length>110?`${value.slice(0,107)}…`:value;
  }

  #comparisonChange(change:ReturnType<typeof contextDiff>[number]){
    const block=change.after??change.before;
    if(!block)return{title:"Document decision updated",detail:"A decision changed between these two results.",scope:""};
    const label=blockTypeDefinition(block.type)?.label??shortEventType(block.type);
    const text=this.#decisionText(block);
    const scope=spatialScopeLabel(block.properties.spatial_scope);
    if(change.status==="added")return{title:`${label} added`,detail:`Added “${text}” before generating the current result.`,scope:`Applies to ${scope.toLowerCase()}`};
    if(change.status==="removed")return{title:`${label} removed`,detail:`Removed “${text}” before generating the current result.`,scope:`Previously applied to ${scope.toLowerCase()}`};
    const before=change.before!;const after=change.after!;const actions:string[]=[];
    const beforeText=this.#decisionText(before);const afterText=this.#decisionText(after);
    if(beforeText!==afterText)actions.push(`wording changed from “${beforeText}” to “${afterText}”`);
    const beforeIntent=blockIntentFor(before.type,before.properties);const afterIntent=blockIntentFor(after.type,after.properties);
    if(beforeIntent!==afterIntent)actions.push(`intent changed from ${beforeIntent} to ${afterIntent}`);
    const beforeWeight=Number(before.properties.weight??.5);const afterWeight=Number(after.properties.weight??.5);
    if(beforeWeight!==afterWeight)actions.push(`influence changed from ${Math.round(beforeWeight*100)}% to ${Math.round(afterWeight*100)}%`);
    const beforeScope=spatialScopeLabel(before.properties.spatial_scope);const afterScope=spatialScopeLabel(after.properties.spatial_scope);
    if(beforeScope!==afterScope)actions.push(`affected area moved from ${beforeScope.toLowerCase()} to ${afterScope.toLowerCase()}`);
    const beforeSubtype=String(before.properties.subtype??"");const afterSubtype=String(after.properties.subtype??"");
    if(beforeSubtype!==afterSubtype&&afterSubtype)actions.push(`starting point changed from ${beforeSubtype||"unspecified"} to ${afterSubtype}`);
    if(JSON.stringify(before.properties.colors??[])!==JSON.stringify(after.properties.colors??[]))actions.push("its color palette changed");
    if(before.locked!==after.locked)actions.push(after.locked?"the decision was protected from changes":"the decision was made editable");
    if(before.position!==after.position)actions.push("its order in the plan changed");
    if(before.handle!==after.handle)actions.push(`its name changed from ${before.handle} to ${after.handle}`);
    return{title:`${label} updated`,detail:actions.length?`${actions.join("; ")}.`:`Updated “${text}” before generating the current result.`,scope:`Now applies to ${afterScope.toLowerCase()}`};
  }

  #comparison() {
    const events = this.store.events.get(); const ids = this.store.ui.comparisonOutputIds.split("|").filter(Boolean); const all = this.store.projection.get().libraryOutputs;
    const requested = ids.map((id) => all.find((output) => output.id === id)).filter((output): output is NonNullable<typeof output> => Boolean(output)); const outputs = requested.length >= 2 ? requested : all.slice(0,2);
    const completed = events.filter((event) => event.type === "GenerationCompleted" && (!outputs.length || outputs.some((output) => Array.isArray(event.payload.object_ids) && event.payload.object_ids.map(String).includes(output.id)))); const rightSeq = completed.at(-1)?.sequence ?? this.store.head.get(); const leftSeq = completed.at(-2)?.sequence ?? Math.max(1, rightSeq - 3);
    const left = foldEvents(events, leftSeq); const right = foldEvents(events, rightSeq); const diff = contextDiff(left, right);
    return html`<dialog class="modal workspace-modal comparison-modal" tabindex="-1" closedby="any" aria-labelledby="compare-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({compareOpen:false});}} @cancel=${(event:Event)=>{event.preventDefault();this.store.patchUi({compareOpen:false});}} @close=${()=>{if(this.store.ui.compareOpen)this.store.patchUi({compareOpen:false});}}><div class="modal-card wide comparison-card"><button class="icon-button modal-close" aria-label="Close comparison" @click=${() => this.store.patchUi({ compareOpen:false })}>${icon("close")}</button><span class="eyebrow">Decision frontier · witnessed</span><h2 id="compare-title">Compare two creative results</h2><p>See the exact creative decisions that changed between the previous result and the current one.</p><div class="comparison-grid">${outputs.map((o,i) => html`<div><div class="output-art"><forma-output-visual .output=${o} .interactive=${true}></forma-output-visual></div><b>${i ? "Previous result" : "Current result"}</b><small>${o.modelId} · generation event #${o.sequence}</small></div>`)}</div><section class="diff-list" aria-labelledby="comparison-changes-title"><header><div><span class="eyebrow">What changed</span><h3 id="comparison-changes-title">Creative decisions between these results</h3></div><strong>${diff.length} change${diff.length===1?"":"s"}</strong></header>${diff.length ? diff.map((change) => {const description=this.#comparisonChange(change);return html`<article class=${`diff-change ${change.status}`}><span class=${`status-dot ${change.status}`} aria-hidden="true"></span><div><b>${description.title}</b><p>${description.detail}</p><small>${description.scope}</small></div><em>${change.status}</em></article>`;}) : html`<p>No creative decisions changed. This comparison isolates image-model variation from the same plan.</p>`}</section></div></dialog>`;
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
            ${output ? html`<forma-output-card .output=${output} .primary=${true}></forma-output-card>` : html`<div class="empty-output"><span>${icon("image")}</span><h3>${p.blocks.length ? "Context is ready" : "A genuinely blank canvas"}</h3><p>${p.blocks.length ? "Generate an image from the current replayable projection." : "No context or output has been inferred. Add only what you choose."}</p></div>`}
            ${p.outputs.length > 1 ? html`<div class="output-filmstrip" aria-label="Previous outputs">${p.outputs.slice(1,5).map((o) => html`<button class="mini-output ${this.store.ui.selectedOutputId===o.id?"selected":""}" aria-label="Select ${o.id}" aria-pressed=${this.store.ui.selectedOutputId===o.id} @click=${() => { this.store.patchUi({ selectedOutputId:o.id }); if (this.store.ui.instrumentation) void this.store.hot({type:"ObjectViewed",payload:{object_id:o.id}}); }}><forma-output-visual .output=${o} .compact=${true}></forma-output-visual></button>`)}</div>` : nothing}
            <label class="dropzone"><input type="file" accept="image/*" @change=${this.#queueUpload}><span>${icon("plus")}</span><b>${this.#uploading ? "Uploading…" : "Drop or choose a reference"}</b><small>Stored in R2 after an explicit ownership or license assertion</small></label>
          </section>
        </div>
      </div>
      ${this.store.ui.inspectorOpen ? this.#inspector() : nothing}
      <div class="composer-dock">
        ${this.#proposal ? html`<div class="proposal-preview"><div><span class="eyebrow">Proposed events · inert until accepted</span><b>${this.#proposal.events.map((e) => shortEventType(e.type)).join(" + ")}</b><small>Expected sequence ${this.store.head.get()} · previewed with context diff</small>${this.#proposal.exemplars.length ? html`<div class="proposal-corpus"><span>${icon("branch")} ${this.#proposal.exemplars.length} cited corpus match${this.#proposal.exemplars.length===1?"":"es"}</span>${this.#proposal.exemplars.map((item)=>html`<button title=${item.citations.join(" · ")} @click=${()=>{this.store.patchUi({selectedEventId:item.citations[0],inspectorOpen:true});}}>${item.label} · ${Math.round(item.score*100)}%</button>`)}</div>` : html`<small class="corpus-empty">No accepted precedent yet; this proposal can become one after explicit acceptance.</small>`}</div><button class="button ghost" @click=${this.#rejectProposal}>Decline</button><button class="button primary" @click=${this.#acceptProposal}>Accept proposal</button></div>` : nothing}
        <div class="composer"><label class="sr-only" for="creative-command">Describe a change or ask Forma</label><textarea id="creative-command" rows="1" placeholder="Describe a change — “make the palette warmer”…" .value=${this.#prompt} @input=${(e: InputEvent) => { this.#prompt = (e.target as HTMLTextAreaElement).value; }} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.#ask(); } }}></textarea><label class="icon-button add-ref" title="Add reference"><input type="file" accept="image/*" @change=${this.#queueUpload}>${icon("plus")}</label><button class="button secondary ask" @click=${this.#ask}>Ask Forma</button><forma-generation-actions source="document" .selected=${output??null} compact></forma-generation-actions></div>
      </div>
      ${this.store.ui.compareOpen ? this.#comparison() : nothing}
      ${this.#projectSettings?html`<dialog class="modal workspace-modal project-settings-dialog" closedby="any" aria-labelledby="project-settings-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeProjectSettings();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeProjectSettings();}} @close=${()=>{if(this.#projectSettings){this.#projectSettings=false;this.requestUpdate();}}}><form class="modal-card project-settings-form" @submit=${this.#saveProject}><button type="button" class="icon-button modal-close" aria-label="Close project settings" @click=${this.#closeProjectSettings}>${icon("close")}</button><span class="eyebrow">Project settings</span><h2 id="project-settings-title">Edit ${p.projectName}</h2><label>Project name<input maxlength="80" required .value=${this.#projectName} @input=${(event:InputEvent)=>{this.#projectName=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><label>Project state<select .value=${this.#projectState} @change=${(event:Event)=>{this.#projectState=(event.target as HTMLSelectElement).value;}}><option value="active">Active</option><option value="archived">Archived</option><option value="paused">Paused</option></select><small>State changes are reversible events; they never delete project history.</small></label><footer><button type="button" class="button ghost" @click=${this.#closeProjectSettings}>Cancel</button><button class="button primary" ?disabled=${!this.#projectName.trim()}>Save project</button></footer></form></dialog>`:nothing}
      ${this.#deleteDocument?html`<dialog class="modal workspace-modal document-delete-dialog studio-document-delete-dialog" closedby="any" aria-labelledby="studio-delete-document-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeDeleteDocument();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeDeleteDocument();}} @close=${()=>{if(this.#deleteDocument){this.#deleteDocument=false;this.requestUpdate();}}}><div class="modal-card document-delete-card"><button class="icon-button modal-close" aria-label="Cancel document removal" @click=${this.#closeDeleteDocument}>${icon("close")}</button><span class="eyebrow">Reversible removal · event-sourced</span><h2 id="studio-delete-document-title">Remove “${p.documentTitle}”?</h2><p>The document, its blocks, and its outputs will leave active Studio and Library views. Another document will open automatically, and Undo can restore this one from the durable stream.</p><div class="document-delete-summary"><span>${icon("trash")}</span><div><b>${p.documentTitle}</b><small>${p.documentId}</small></div></div><footer><button class="button ghost" @click=${this.#closeDeleteDocument}>Cancel</button><button class="button danger" @click=${this.#confirmDeleteDocument}>Remove document</button></footer></div></dialog>`:nothing}
      ${this.#pendingUpload ? html`<dialog class="modal workspace-modal upload-rights-modal" closedby="any" aria-modal="true" aria-labelledby="upload-rights-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget && !this.#uploading) this.#cancelUpload(); }} @cancel=${(event: Event) => { event.preventDefault(); if (!this.#uploading) this.#cancelUpload(); }} @close=${() => { if (this.#pendingUpload && !this.#uploading) { this.#pendingUpload = null; this.#rightsConfirmed = false; this.requestUpdate(); } }}>
        <div class="modal-card reference-upload-card">
          <button class="icon-button modal-close" aria-label="Cancel upload" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>${icon("close")}</button>
          <span class="eyebrow">Reference setup · before upload</span><h2 id="upload-rights-title">Choose what this image should contribute</h2>
          <div class="upload-file-receipt"><span>${icon("image")}</span><div><b>${this.#pendingUpload.name}</b><small>${(this.#pendingUpload.size / 1_048_576).toFixed(1)} MB · ${this.#pendingUpload.type || "image"}</small></div></div>
          <p>Forma can prepare several kinds of visual evidence. They remain suggestions on the Reference block until you explicitly add one as a document decision.</p>
          <fieldset class="reference-extraction-options"><legend>Prepare findings automatically</legend>${REFERENCE_FINDING_OPTIONS.map((option) => html`<label><input type="checkbox" .checked=${this.#referenceFindingKinds.has(option.kind)} @change=${(event: Event) => { const checked = (event.target as HTMLInputElement).checked; if (checked) this.#referenceFindingKinds.add(option.kind); else this.#referenceFindingKinds.delete(option.kind); this.requestUpdate(); }}><span><b>${option.label}</b><small>${option.description}</small></span></label>`)}</fieldset>
          <div class="reference-extraction-note"><span>${icon("info")}</span><p>Image analysis uses a small deterministic sample for visual structure; it does not identify people, objects, or meaning. You can change the prepared findings later.</p></div>
          <label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event: Event) => { this.#rightsConfirmed = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}><span><b>I own this image or have a license that permits this use.</b><small>This assertion is recorded alongside the reference. It does not transfer ownership.</small></span></label>
          <footer><button class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>Cancel</button><button class="button primary" ?disabled=${!this.#rightsConfirmed || this.#uploading} @click=${this.#confirmUpload}>${this.#uploading ? "Uploading securely…" : "Confirm & add reference"}</button></footer>
        </div>
      </dialog>` : nothing}
    </section>`;
  }
}
customElements.define("forma-workspace", FormaWorkspace);
