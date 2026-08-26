import { html, nothing } from "lit";
import { FormaElement, icon } from "./forma-element";
import { blockIconName } from "./icon-semantics";
import { ensureModalDialog } from "./modal-dialog";
import { contextDiff, foldEvents, generationHistoryItems, outputQualityLabel, type GenerationHistoryItem, shortEventType, type CreativeBlock, type EventInput } from "../model/events";
import { sampleImageFile } from "../model/image-sample";
import { DEFAULT_REFERENCE_FINDINGS, REFERENCE_FINDING_OPTIONS, type ImageSample, type ReferenceFindingKind } from "../model/extractors";
import { retrieveFewShotExemplars, type RetrievedExemplar } from "../model/indexing";
import { BLOCK_GROUPS, BLOCK_INTENTS, BLOCK_TYPES, blockIntentFor, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import { localizedSpatialScopeLabel } from "./design-system/localized-spatial-scope";
import { DEFAULT_IMAGE_FORMAT, IMAGE_FORMAT_PRESETS, imageFormatForPreset, type ImageFormat } from "../model/image-format";
import { documentContextBlockFromRoute, withDocumentInRoute } from "../model/routes";
import type { AssistantToolRequest } from "../model/assistant-route-policy";
import { inferDocumentArtifactKind } from "../model/document-output-intent";
import { combinedContextGroups, isContextCompositionRelation } from "../model/combined-context";
import { creativeNextActions, describeCreativeProposal, type CreativeNextAction } from "../model/workspace-intelligence";
import { runReadyImageGeneration } from "../model/generation-intent";
import { assessCreativeContext, type ContextHealthIssue } from "../model/context-health";
import { scopedFormaActivity } from "../model/activity";
import type { SourceDocumentExtraction } from "../model/source-documents";
import { localizedSourceExtractionMessage } from "./design-system/localized-runtime-copy";
import { audioMimeType } from "../model/audio";
import { browserAudioDuration } from "../model/audio-browser";
import "./context-block";
import "./output-card";
import "./project-rail";
import "./studio-navigation";
import "./generation-actions";
import "./design-system/choice-card";
import "./prompt-fan-visual";
import "./prompt-fan-review";
import "./document-artifacts";

type BlockDraft = { type: BlockKind|""; subtype: string; text: string; colors: string[]; imageFormat: ImageFormat; outputKind: ReturnType<typeof inferDocumentArtifactKind>; documentId: string; documentTitle: string };

export class FormaWorkspace extends FormaElement {
  #prompt = "";
  #asking=false;
  #blockDraft: BlockDraft | null = null;
  #documentName: string | null = null;
  #proposal: { prompt: string; events: EventInput[]; proposalId?: string; exemplars: RetrievedExemplar[] } | null = null;
  #uploading = false; #pendingUpload: File | null = null; #uploadDocumentId = ""; #rightsConfirmed = false;
  #referenceFindingKinds = new Set<ReferenceFindingKind>(DEFAULT_REFERENCE_FINDINGS);
  #projectSettings=false;#projectName="";#projectState="active";#deleteDocument=false;
  #linkedBlockId="";
  #linkedOutputAnchor=false;
  #workbenchInspectorOpen=true;
  #inlineInspectorOpen=true;
  #inlineInspectorPreference:boolean|null=null;
  #inspectorDocumentId="";
  #drawerInspectorOpen=false;
  #compactInspector=false;
  #narrowWorkbench=false;
  #artifactViewerOpen=false;
  #workbenchPane:"write"|"result"|"review"="write";
  #inspectorObserver?:ResizeObserver;
  #inspectorObserved?:Element;
  #assistantTool=(event:Event)=>{const request=(event as CustomEvent<AssistantToolRequest>).detail;if(request.mode!=="quick-edit")return;const session=this.store.session.get();const projection=this.store.projection.get();if(!session||session.projectContext||request.actorUserId!==session.user.userId||request.projectId!==projection.projectId||request.documentId!==projection.documentId||request.canvasId)return;event.preventDefault();this.#prompt=request.message;void this.#suggestQuickAction().then((accepted)=>{if(accepted){this.#selectWorkbenchPane("write");void this.updateComplete.then(()=>{const review=this.querySelector<HTMLElement>(".document-quick-edit-review");review?.scrollIntoView({block:"nearest",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});review?.focus({preventScroll:true});});}request.resolve(accepted);}).catch(()=>request.resolve(false));};

  #syncInspectorPosture=(entries:ResizeObserverEntry[])=>{
    const width=entries[0]?.contentRect.width;
    if(!width)return;
    const rootSize=Number.parseFloat(getComputedStyle(document.documentElement).fontSize)||16;
    const compact=width<70*rootSize;
    const narrow=width<46*rootSize;
    if(compact===this.#compactInspector&&narrow===this.#narrowWorkbench)return;
    const inspectorChanged=compact!==this.#compactInspector;
    const restoreFocus=this.querySelector("#document-workbench-inspector")?.contains(document.activeElement)??false;
    this.#narrowWorkbench=narrow;
    if(inspectorChanged){
      this.#compactInspector=compact;
      this.#workbenchInspectorOpen=compact?this.#drawerInspectorOpen:this.#inlineInspectorOpen;
    }
    this.requestUpdate();
    if(inspectorChanged&&restoreFocus)void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".document-inspector-toggle")?.focus({preventScroll:true}));
  };

  #toggleWorkbenchInspector(open=!this.#workbenchInspectorOpen){
    this.#workbenchInspectorOpen=open;
    if(this.#compactInspector)this.#drawerInspectorOpen=open;
    else {this.#inlineInspectorOpen=open;this.#inlineInspectorPreference=open;}
    this.requestUpdate();
    if(this.#compactInspector)void this.updateComplete.then(()=>{
      this.querySelector<HTMLElement>(open?".document-inspector-close":".document-inspector-toggle")?.focus({preventScroll:true});
    });
  }

  #selectWorkbenchPane(pane:"write"|"result"|"review"){
    this.#workbenchPane=pane;
    this.requestUpdate();
  }

  #setArtifactViewerOpen(open:boolean){
    if(this.#artifactViewerOpen===open)return;
    this.#artifactViewerOpen=open;
    if(open&&this.#workbenchPane==="write"){
      this.#selectWorkbenchPane("result");
      return;
    }
    this.requestUpdate();
  }

  #navigateWorkbenchPanes(event:KeyboardEvent){
    const panes=["write","result","review"] as const;
    const direction=getComputedStyle(this).direction==="rtl"?-1:1;
    let index=panes.indexOf(this.#workbenchPane);
    if(event.key==="Home")index=0;
    else if(event.key==="End")index=panes.length-1;
    else if(event.key==="ArrowRight")index=(index+direction+panes.length)%panes.length;
    else if(event.key==="ArrowLeft")index=(index-direction+panes.length)%panes.length;
    else return;
    event.preventDefault();
    const pane=panes[index];
    this.#selectWorkbenchPane(pane);
    void this.updateComplete.then(()=>this.querySelector<HTMLElement>(`[data-workbench-pane="${pane}"]`)?.focus({preventScroll:true}));
  }

  override connectedCallback(){
    super.connectedCallback();
    window.addEventListener("forma-assistant-tool-request",this.#assistantTool);
  }

  override disconnectedCallback(){
    window.removeEventListener("forma-assistant-tool-request",this.#assistantTool);
    this.#inspectorObserver?.disconnect();
    this.#inspectorObserved=undefined;
    super.disconnectedCallback();
  }

  protected override updated() {
    this.querySelectorAll<HTMLDialogElement>("dialog.workspace-modal").forEach((dialog)=>ensureModalDialog(dialog));
    const studio=this.querySelector(".studio-main");
    if(studio&&studio!==this.#inspectorObserved){
      this.#inspectorObserver?.disconnect();
      this.#inspectorObserver??=new ResizeObserver(this.#syncInspectorPosture);
      this.#inspectorObserver.observe(studio);
      this.#inspectorObserved=studio;
    }
    const linkedBlockId=documentContextBlockFromRoute(this.store.route.get())??"";
    if(linkedBlockId&&linkedBlockId!==this.#linkedBlockId){
      this.#linkedBlockId=linkedBlockId;
      if(this.#workbenchPane!=="write")this.#selectWorkbenchPane("write");
      this.store.patchUi({focusBlockId:linkedBlockId});
      window.requestAnimationFrame(()=>{
        const target=this.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(linkedBlockId)}"]`);
        target?.scrollIntoView({behavior:"smooth",block:"center"});
        target?.focus({preventScroll:true});
      });
    }else if(!linkedBlockId)this.#linkedBlockId="";
    const linkedOutput=this.store.route.get().includes("#output-title");
    if(linkedOutput&&!this.#linkedOutputAnchor){
      this.#linkedOutputAnchor=true;
      if(this.#workbenchPane==="write")this.#selectWorkbenchPane("result");
    }else if(!linkedOutput)this.#linkedOutputAnchor=false;
  }

  #beginBlock() {
    const projection=this.store.projection.get();
    this.#blockDraft = {type:"",subtype:"",text:"",colors:["#27252b","#e9a073","#e8d7bd","#8a6571"],imageFormat:DEFAULT_IMAGE_FORMAT,outputKind:inferDocumentArtifactKind(projection.blocks,projection.documentTitle),documentId:projection.documentId,documentTitle:projection.documentTitle}; this.requestUpdate();
  }
  #formatDraftUsesImageFrame(draft:BlockDraft){return draft.outputKind===null||draft.outputKind==="storyboard";}
  #formatDraftText(draft:BlockDraft,preset="3:2"){
    const dimensions=`${draft.imageFormat.dimensions.width} × ${draft.imageFormat.dimensions.height}`;
    switch(draft.outputKind){
      case "slides":return "Create a presentation that follows the authored slide outline and preserves the intended message.";
      case "storyboard":return `Create a storyboard with ${preset} frames at ${dimensions} pixels.`;
      case "video":return "Create a video that follows the authored creative direction and intended message.";
      case "audio":return "Create an audio production that follows the authored creative direction and intended message.";
      case "scene":return "Create a scene that follows the authored narrative and creative direction.";
      case "short_story":return "Create a written story that follows the authored message and creative direction.";
      default:return `Create for a ${preset} image at ${dimensions} pixels.`;
    }
  }
  /** Shared entry point: choosing a command never creates placeholder content. */
  openContextComposer(){if(this.store.projection.get().documentId){if(this.#workbenchPane!=="write")this.#selectWorkbenchPane("write");this.#beginBlock();}}
  #closeBlock(){this.querySelector<HTMLDialogElement>(".block-composer-dialog")?.close();this.#blockDraft=null;this.requestUpdate();}
  async #addBlock(event: SubmitEvent) {
    event.preventDefault(); const draft = this.#blockDraft; const text = draft?.text.trim(); if (!draft?.type || draft.type === "reference" || !text) return;
    const blockId = crypto.randomUUID(); const slug = text.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,42) || `study-${this.store.head.get()+1}`;
    const properties = draft.type === "palette" ? {label:text,colors:draft.colors,subtype:draft.subtype||suggestedSubtype(draft.type),weight:.64,authority:"authored"} : {text,subtype:draft.subtype||suggestedSubtype(draft.type),weight:.64,authority:"authored",...(draft.type==="format"&&this.#formatDraftUsesImageFrame(draft)?{image_format:draft.imageFormat}:{}),...(draft.type==="audio"?{audio_role:draft.subtype.toLowerCase().replace(/\s+/g,"_"),inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{}),...(draft.type==="subject"&&["Character headshot","Character sheet"].includes(draft.subtype)?{character_context:true,context_group:{name:text,target:text,role:"character",application:"isolate",relativity:.9}}:{})};
    const appended = await this.store.append({ type: "BlockCreated", payload: { block_id: blockId, document_id:draft.documentId, type: draft.type, handle: `${draft.type}/${slug}`, position: `z${String(this.store.head.get()+1).padStart(4,"0")}`, properties } },{rebaseAttempts:6});
    if (appended.length) { this.#closeBlock(); this.store.patchUi({ focusBlockId: blockId }); }
  }
  #queueUpload(event: Event|File) {
    const file=event instanceof File?event:(event.target as HTMLInputElement).files?.[0];if(!file)return;
    this.#pendingUpload = file; this.#uploadDocumentId=this.#blockDraft?.documentId??this.store.projection.get().documentId; this.#rightsConfirmed = false; this.#referenceFindingKinds = new Set(DEFAULT_REFERENCE_FINDINGS); this.requestUpdate();
  }
  #resetFileInputs() { this.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input)=>{input.value="";}); }
  #cancelUpload() { this.#pendingUpload = null; this.#uploadDocumentId=""; this.#rightsConfirmed = false; this.#resetFileInputs(); this.requestUpdate(); }
  async #confirmUpload() {
    const file = this.#pendingUpload; if (!file || !this.#rightsConfirmed) return;
    this.#uploading = true; this.requestUpdate();
    try {
      const isImage=file.type.toLowerCase().startsWith("image/");const isAudio=Boolean(audioMimeType(file.type));
      let sample: ImageSample | null = null;
      if(isImage)try { sample = await sampleImageFile(file); } catch { /* Upload remains useful when this browser cannot sample an image. */ }
      const localDuration=isAudio?await browserAudioDuration(file):null;
      const form = new FormData(); form.append("file", file); form.append("rightsConfirmed", "true"); form.append("nonSensitiveConfirmed", "true"); const response = await this.store.guardedFetch("/api/media", { method: "POST", body: form },"upload this licensed reference"); const media = await response.json() as { key?: string; url?: string; contentHash?: string; mimeType?:string; size?:number; durationSeconds?:number; extraction?:SourceDocumentExtraction; sourceEvidenceHash?:string; error?: string };
      if (!response.ok) throw new Error(media.error ?? "Upload failed");
      const extraction=!isImage&&!isAudio?media.extraction??null:null;
      if(!isImage&&!isAudio&&(!extraction||!media.sourceEvidenceHash||!media.contentHash))throw new Error("The source could not be verified against its uploaded contents.");
      const readableText=extraction?.text??"";
      const ref = crypto.randomUUID(); const block = crypto.randomUUID();
      const findingKinds=isImage?[...this.#referenceFindingKinds]:[];const documentId=this.#uploadDocumentId||this.store.projection.get().documentId;
      const appended=await this.store.appendBatch([
        { type: "ReferenceIngested", payload: { reference_id: ref, source_type: isAudio?"audio-upload":isImage?"upload":"document-upload", source_ref: media.url, content_hash: media.contentHash??media.key, source_mime_type:media.mimeType??file.type, rights_class: "asserted" } },
        { type: "RightsAsserted", payload: { reference_id: ref, rights_class: "owned_or_licensed", assertion_method: "explicit-upload-confirmation" } },
        { type: "BlockCreated", payload: { block_id: block, document_id:documentId, type: isAudio?"audio":"reference", handle: `${isAudio?"audio":"reference"}/${file.name.replace(/\W+/g,"-").toLowerCase()}`, position: `z${this.store.head.get()}`, properties: { reference_id: ref, label: file.name, media_url: media.url, media_type:media.mimeType??file.type, source_mime_type:media.mimeType??file.type, source_content_hash:media.contentHash, source_citation:`${file.name} · SHA-256 ${media.contentHash??"not recorded"}`, ...(extraction?{text:readableText,source_citations:extraction.segments.map((segment)=>({anchor:segment.anchor,excerpt:segment.text})),source_segment_count:extraction.segments.length,source_excerpt_truncated:extraction.truncated,source_kind:extraction.sourceKind,source_evidence_hash:media.sourceEvidenceHash}:{}), subtype:isAudio?"Score":"Mood", weight: .72, authority: "authored",...(isAudio?{audio_role:"score",rights_class:"owned_or_licensed",duration_seconds:media.durationSeconds??localDuration,size_bytes:media.size??file.size,description:"",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{pixel_reference_mode:"context_only",extraction_preferences:findingKinds,extraction_status:sample?"pending":extraction?.status??"unavailable",...(extraction?.status==="unavailable"?{extraction_message:extraction.message}:{})}) } } },
      ],{rebaseAttempts:6});
      if(!appended.length){this.#uploading=false;this.requestUpdate();return;}
      if(sample&&!this.store.session.get()?.projectContext)await this.store.extractReference(block,ref,sample,findingKinds);
      else if(isAudio)this.store.toast(this.i18n.t("audio.reference.private","Private audio reference"));
      else if(!isImage){const detail=extraction?localizedSourceExtractionMessage(extraction,this.i18n):this.i18n.system(readableText?"Its rights, anchored citations, and content hash were recorded.":"Readable source text could not be extracted.");this.store.toast(this.i18n.t(`source.extraction.notice.${readableText?"ready":"unavailable"}`,"",{detail}));}
      else if(!sample||this.store.session.get()?.projectContext)this.store.toast("Reference stored; image findings can be analyzed later from the block.");
      this.#pendingUpload = null; this.#uploadDocumentId=""; this.#rightsConfirmed = false; this.#blockDraft = null; this.#resetFileInputs();
    } catch (error) { this.store.toast(error instanceof Error ? error.message : "Upload failed"); }
    this.#uploading = false; this.requestUpdate();
  }
  #blockComposer() {
    const draft = this.#blockDraft; if (!draft) return nothing; const selected = blockTypeDefinition(draft.type);
    return html`<dialog class="modal workspace-modal block-composer-dialog" closedby="any" aria-labelledby="block-composer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeBlock();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeBlock();}} @close=${()=>{if(this.#blockDraft){this.#blockDraft=null;this.requestUpdate();}}}><form class="modal-card wide block-composer" @submit=${this.#addBlock}><button type="button" class="icon-button modal-close" aria-label="Close authored block dialog" @click=${this.#closeBlock}>${icon("close")}</button><header><div><span class="sr-only">New authored block · ${draft.documentTitle}</span><h3 id="block-composer-title">${selected?this.i18n.system(selected.label):this.i18n.system("Add context")}</h3><p>${selected?this.i18n.system(selected.description):this.i18n.system("Choose a block type")}</p></div>${selected?html`<button type="button" class="text-button" @click=${()=>{draft.type="";this.requestUpdate();}}>Choose another type</button>`:nothing}</header>
      ${!draft.type?html`<div class="block-type-catalog">${BLOCK_GROUPS.map((group)=>{const options=BLOCK_TYPES.filter((option)=>option.group===group.id);return html`<section class="block-type-group" aria-labelledby=${`block-group-${group.id}`}><header><div><h4 id=${`block-group-${group.id}`}>${this.i18n.system(group.label)}</h4><p>${this.i18n.system(group.description)}</p></div><span>${options.length} ${options.length===1?this.i18n.system("type"):this.i18n.system("types")}</span></header><div class="block-type-grid">${options.map((option)=>html`<forma-ui-choice-card compact .label=${this.i18n.system(option.label)} .detail=${this.i18n.system(option.description)} .iconName=${blockIconName(option.type)} .value=${option.type} @forma-action=${()=>{draft.type=option.type;draft.subtype=option.subtypes[0];if(option.type==="format")draft.text=this.#formatDraftText(draft);this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".block-composer textarea,.block-composer input")?.focus());}}></forma-ui-choice-card>`)}</div></section>`;})}</div>`:html`<fieldset class="subtype-picker"><legend>System-suggested subtype</legend>${selected?.subtypes.map((subtype)=>html`<label><input type="radio" name="block-subtype" .value=${subtype} .checked=${draft.subtype===subtype} @change=${()=>{draft.subtype=subtype;this.requestUpdate();}}><span>${this.i18n.system(subtype)}</span></label>`)}</fieldset>${draft.type==="reference"?html`<div class="reference-choice"><span>${icon("image")}</span><div><b>Choose an image or source document</b><small>Images, PDF, text, Markdown, CSV, JSON, and Office documents stay private; rights are confirmed before upload.</small></div><label class="button primary">Choose source<input type="file" accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx" @change=${this.#queueUpload}></label></div>`:draft.type==="palette"?html`<label class="block-draft-copy">Palette name<input maxlength="120" placeholder=${selected?.prompt && this.i18n.system(selected.prompt)} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><div class="draft-palette">${draft.colors.map((color,index)=>html`<label><input type="color" .value=${color} @input=${(event:InputEvent)=>{draft.colors=draft.colors.map((value,position)=>position===index?(event.target as HTMLInputElement).value:value);this.requestUpdate();}}><span style=${`--swatch:${color}`}></span><small>${color}</small></label>`)}</div>`:html`${draft.type==="audio"?html`<div class="reference-choice"><span>${icon("audio")}</span><div><b>${this.i18n.t("audio.reference.private","Private audio reference")}</b><small>${this.i18n.t("audio.upload.rightsNotice","I also confirm this recording contains no sensitive information. Upload remains private; creative influence, accompaniment, and provider transfer each require separate approval.")}</small></div><label class="button primary">${this.i18n.t("artifact.audio.label","Audio")}<input type="file" accept="audio/*" @change=${this.#queueUpload}></label></div>`:nothing}${draft.type==="format"&&this.#formatDraftUsesImageFrame(draft)?html`<div class="block-draft-format"><label>${draft.outputKind==="storyboard"?"Storyboard frame":"Image frame"}<select @change=${(event:Event)=>{const preset=String((event.target as HTMLSelectElement).value);draft.imageFormat=imageFormatForPreset(preset);draft.text=this.#formatDraftText(draft,preset);this.requestUpdate();}}>${IMAGE_FORMAT_PRESETS.map((preset)=>html`<option value=${preset.id}>${preset.id} · ${this.i18n.system(preset.label)} · ${preset.dimensions.width} × ${preset.dimensions.height}</option>`)}</select></label><span>${draft.imageFormat.dimensions.width} × ${draft.imageFormat.dimensions.height} px</span></div>`:nothing}<label class="block-draft-copy">${selected?.label} content<textarea rows="3" placeholder=${selected?.prompt && this.i18n.system(selected.prompt)} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>`}`}
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
    const session=this.store.session.get();const prompt=this.#prompt.trim();if(!prompt||this.#asking||!(session?.provider.plannerConfigured??session?.provider.configured)||session.projectContext&&!session.projectContext.permissions.includes("project.output.request"))return;
    this.#asking=true;this.requestUpdate();try{
      const projection=this.store.projection.get();
      if(await this.store.chat(prompt,false)){
        this.#prompt="";
        // Chat responses hydrate only on the actor-private conversation view;
        // take the requester there so their paid answer is actually visible.
        this.store.setRoute(withDocumentInRoute("/studio/chat",projection.documentId,projection.documentTitle));
      }
    }finally{this.#asking=false;this.requestUpdate();}
  }
  async #suggestQuickAction(){
    const prompt=this.#prompt.trim();if(!prompt||this.#asking||this.store.session.get()?.projectContext)return false;
    const events=this.#proposedEvents(prompt);
    const exemplars = retrieveFewShotExemplars(this.store.events.get(), prompt, this.store.content.get(), { limit: 3, projectId: this.store.projection.get().projectId });
    const exemplarRefs = exemplars.map((item) => ({ exemplar_id: item.exemplarId, evidence_refs: item.citations, similarity: Number(item.score.toFixed(3)), kind: item.kind }));
    const proposal = await this.store.propose(prompt, events, exemplarRefs);if(!proposal)return false;this.#proposal = { prompt, events, proposalId: proposal.eventId, exemplars }; this.#prompt = ""; this.requestUpdate();return true;
  }

  #proposalPreview(){if(!this.#proposal)return nothing;return html`<div class="proposal-preview"><div><span class="eyebrow">Suggested change · waiting for your approval</span><b>${describeCreativeProposal(this.#proposal.events).join(" + ")}</b><small>Your document stays unchanged until you accept.</small>${this.#proposal.exemplars.length ? html`<div class="proposal-corpus"><span>${icon("branch")} ${this.#proposal.exemplars.length} related decision${this.#proposal.exemplars.length===1?"":"s"}</span>${this.#proposal.exemplars.map((item)=>html`<button title="Inspect the related creative decision" @click=${()=>{this.store.patchUi({selectedEventId:item.citations[0],inspectorOpen:true});}}>${item.label} · ${Math.round(item.score*100)}% related</button>`)}</div>` : html`<small class="corpus-empty">This is a new direction for your work.</small>`}</div><button class="button ghost" @click=${this.#rejectProposal}>Decline</button><button class="button primary" @click=${this.#acceptProposal}>Accept change</button></div>`;}
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
    const out = generationHistoryItems(this.store.projection.get().outputs).filter((item) => item.kind === "output").slice(0,2).map((item) => item.output); if (out.length < 2) return this.store.toast("Promote a fan result or generate one more stand-alone output to compare.");
    const ids = out.map((o) => o.id);if(!this.store.session.get()?.projectContext)void this.store.append({ type: "ComparisonOpened", payload: { object_ids: ids, source_surface: "studio" } });this.store.patchUi({ compareOpen: true, comparisonOutputIds: ids.join("|") });
  }

  #decisionText(block:CreativeBlock|undefined){
    if(!block)return this.i18n.system("this decision");
    const value=String(block.properties.text??block.properties.label??block.handle).trim();
    return value.length>110?`${value.slice(0,107)}…`:value;
  }

  #comparisonChange(change:ReturnType<typeof contextDiff>[number]){
    const block=change.after??change.before;
    if(!block)return{title:this.i18n.system("Document decision updated"),detail:this.i18n.system("A decision changed between these two results."),scope:""};
    const label=this.i18n.system(blockTypeDefinition(block.type)?.label??shortEventType(block.type));
    const text=this.#decisionText(block);
    const scope=localizedSpatialScopeLabel(block.properties.spatial_scope,this.i18n);
    if(change.status==="added")return{title:this.i18n.system("{label} added",{label}),detail:this.i18n.system("Added “{text}” before generating the current result.",{text}),scope:this.i18n.system("Applies to {scope}",{scope})};
    if(change.status==="removed")return{title:this.i18n.system("{label} removed",{label}),detail:this.i18n.system("Removed “{text}” before generating the current result.",{text}),scope:this.i18n.system("Previously applied to {scope}",{scope})};
    const before=change.before!;const after=change.after!;const actions:string[]=[];
    const beforeText=this.#decisionText(before);const afterText=this.#decisionText(after);
    if(beforeText!==afterText)actions.push(this.i18n.system("wording changed from “{before}” to “{after}”",{before:beforeText,after:afterText}));
    const beforeIntent=blockIntentFor(before.type,before.properties);const afterIntent=blockIntentFor(after.type,after.properties);
    if(beforeIntent!==afterIntent)actions.push(this.i18n.system("intent changed from {before} to {after}",{before:this.i18n.system(BLOCK_INTENTS.find((intent)=>intent.id===beforeIntent)?.label??beforeIntent),after:this.i18n.system(BLOCK_INTENTS.find((intent)=>intent.id===afterIntent)?.label??afterIntent)}));
    const beforeWeight=Number(before.properties.weight??.5);const afterWeight=Number(after.properties.weight??.5);
    if(beforeWeight!==afterWeight)actions.push(this.i18n.system("influence changed from {before}% to {after}%",{before:this.i18n.number(Math.round(beforeWeight*100)),after:this.i18n.number(Math.round(afterWeight*100))}));
    const beforeScope=localizedSpatialScopeLabel(before.properties.spatial_scope,this.i18n);const afterScope=localizedSpatialScopeLabel(after.properties.spatial_scope,this.i18n);
    if(beforeScope!==afterScope)actions.push(this.i18n.system("affected area moved from {before} to {after}",{before:beforeScope,after:afterScope}));
    const beforeSubtype=String(before.properties.subtype??"");const afterSubtype=String(after.properties.subtype??"");
    if(beforeSubtype!==afterSubtype&&afterSubtype)actions.push(this.i18n.system("starting point changed from {before} to {after}",{before:beforeSubtype?blockTypeDefinition(before.type)?.subtypes.includes(beforeSubtype)?this.i18n.system(beforeSubtype):beforeSubtype:this.i18n.system("unspecified"),after:blockTypeDefinition(after.type)?.subtypes.includes(afterSubtype)?this.i18n.system(afterSubtype):afterSubtype}));
    if(JSON.stringify(before.properties.colors??[])!==JSON.stringify(after.properties.colors??[]))actions.push(this.i18n.system("its color palette changed"));
    if(JSON.stringify(before.properties.image_format??null)!==JSON.stringify(after.properties.image_format??null))actions.push(this.i18n.system("its image dimensions or aspect ratio changed"));
    if(before.locked!==after.locked)actions.push(this.i18n.system(after.locked?"the decision was protected from changes":"the decision was made editable"));
    if(before.position!==after.position)actions.push(this.i18n.system("its order in the plan changed"));
    if(before.handle!==after.handle)actions.push(this.i18n.system("its name changed from {before} to {after}",{before:before.handle,after:after.handle}));
    return{title:this.i18n.system("{label} updated",{label}),detail:actions.length?`${actions.join("; ")}.`:this.i18n.system("Updated “{text}” before generating the current result.",{text}),scope:this.i18n.system("Now applies to {scope}",{scope:afterScope})};
  }

  #comparison() {
    const events = this.store.events.get(); const ids = this.store.ui.comparisonOutputIds.split("|").filter(Boolean); const all = this.store.projection.get().libraryOutputs;
    const requested = ids.map((id) => all.find((output) => output.id === id)).filter((output): output is NonNullable<typeof output> => Boolean(output)); const outputs = requested.length >= 2 ? requested : all.slice(0,2);
    const completed = events.filter((event) => event.type === "GenerationCompleted" && (!outputs.length || outputs.some((output) => Array.isArray(event.payload.object_ids) && event.payload.object_ids.map(String).includes(output.id)))); const rightSeq = completed.at(-1)?.sequence ?? this.store.head.get(); const leftSeq = completed.at(-2)?.sequence ?? Math.max(1, rightSeq - 3);
    const left = foldEvents(events, leftSeq); const right = foldEvents(events, rightSeq); const diff = contextDiff(left, right);
    return html`<dialog class="modal workspace-modal comparison-modal" tabindex="-1" closedby="any" aria-labelledby="compare-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({compareOpen:false});}} @cancel=${(event:Event)=>{event.preventDefault();this.store.patchUi({compareOpen:false});}} @close=${()=>{if(this.store.ui.compareOpen)this.store.patchUi({compareOpen:false});}}><div class="modal-card wide comparison-card"><button class="icon-button modal-close" aria-label="Close comparison" @click=${() => this.store.patchUi({ compareOpen:false })}>${icon("close")}</button><span class="eyebrow">Side-by-side comparison</span><h2 id="compare-title">Compare two creative results</h2><p>See the exact creative decisions that changed between the previous result and the current one.</p><div class="comparison-grid">${outputs.map((o,i) => html`<div><div class="output-art"><forma-output-visual .output=${o} .interactive=${true}></forma-output-visual></div><b>${i ? this.i18n.system("Previous result") : this.i18n.system("Current result")}</b><small>${this.i18n.system(outputQualityLabel(o))} · ${o.width??1536} × ${o.height??1024}</small></div>`)}</div><section class="diff-list" aria-labelledby="comparison-changes-title"><header><div><span class="eyebrow">What changed</span><h3 id="comparison-changes-title">Creative decisions between these results</h3></div><strong>${diff.length} change${diff.length===1?"":"s"}</strong></header>${diff.length ? diff.map((change) => {const description=this.#comparisonChange(change);return html`<article class=${`diff-change ${change.status}`}><span class=${`status-dot ${change.status}`} aria-hidden="true"></span><div><b>${description.title}</b><p>${description.detail}</p><small>${description.scope}</small></div><em>${this.i18n.system(change.status)}</em></article>`;}) : html`<p>No creative decisions changed. This comparison isolates image-model variation from the same plan.</p>`}</section></div></dialog>`;
  }
  #inspector() {
    const event = this.store.events.get().find((e) => e.eventId === this.store.ui.selectedEventId) ?? this.store.events.get().at(-1);
    if (!event) return nothing;
    const engineering=this.store.session.get()?.capabilities?.includes("engineering.events.read")===true;
    const author=event.actor==="user"?this.i18n.t("workspace.provenance.you","You"):this.i18n.t("workspace.provenance.assistance","Approved creative assistance");
    return html`<aside class="inspector-panel" aria-label=${this.i18n.t("workspace.provenance.inspector","Creative history")}><header><div><span class="eyebrow">${this.i18n.t("workspace.provenance.source","Saved creative history")}</span><h2>${shortEventType(event.type)}</h2></div><button class="icon-button" aria-label=${this.i18n.t("workspace.provenance.close","Close creative history")} @click=${() => this.store.patchUi({ inspectorOpen:false })}>${icon("close")}</button></header><p>${this.i18n.t("workspace.provenance.description","This creative decision is saved to your private document and remains available for future results.")}</p><dl><dt>${this.i18n.t("workspace.provenance.author","Created by")}</dt><dd>${author}</dd><dt>${this.i18n.t("workspace.provenance.saved","Saved")}</dt><dd>${this.i18n.date(new Date(event.occurredAt),{dateStyle:"medium",timeStyle:"short"})}</dd><dt>${this.i18n.t("workspace.provenance.change","Creative change")}</dt><dd>${shortEventType(event.type)}</dd></dl>${engineering?html`<details class="provenance-technical"><summary>${this.i18n.t("workspace.provenance.technical","Technical details for engineering")}</summary><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd></dl><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${() => this.store.setRoute("/engineering/events")}>${this.i18n.t("workspace.provenance.engineering","Open Engineering Diagnostics")} ${icon("arrow")}</button><button @click=${() => navigator.clipboard.writeText(event.eventId)}>${this.i18n.t("workspace.provenance.copy","Copy technical event ID")}</button></div></details>`:nothing}</aside>`;
  }

  #followNextAction(action:CreativeNextAction){
    if(action.id==="add-context")return this.#beginBlock();
    if(action.id==="make-draft")return void runReadyImageGeneration(this.store,"preview",{sourceSurface:"document-next-step"});
    if(action.id==="refine-image")return void runReadyImageGeneration(this.store,"generate",{sourceSurface:"document-next-step",sourcePreviewId:this.store.projection.get().outputs.find((output)=>output.quality==="low"||output.purpose==="ideate")?.id});
    if(action.id==="compare-images")return this.#compare();
    if(action.id==="create-output")return void this.querySelector("forma-document-artifacts")?.openRender();
    if(action.id==="review-failure")return this.querySelector<HTMLElement>(".generation-failure-trigger")?.click();
    if(action.id==="resume-intent")return void this.querySelector<HTMLElement>("forma-document-artifacts, .generation-failure-trigger, .stage")?.scrollIntoView({behavior:"smooth",block:"center"});
    this.store.setRoute("/library");
  }

  #repairContext(issue:ContextHealthIssue){
    if(issue.blockIds.length){this.store.patchUi({focusBlockId:issue.blockIds[0]});return;}
    this.#beginBlock();
    const kinds:Record<string,BlockKind>={"missing-direction":"direction","missing-audience":"audience","missing-message":"message","missing-deliverable":"format","missing-boundary":"exclusion","missing-evidence":"reference"};
    const kind=kinds[issue.id];if(this.#blockDraft&&kind){this.#blockDraft.type=kind;this.#blockDraft.subtype=suggestedSubtype(kind);}
    this.requestUpdate();
  }

  #healthIssueCopy(issue:ContextHealthIssue,part:"label"|"detail"){
    const family=["source-rights","source-expired","source-excerpt","contradiction"].find((prefix)=>issue.id.startsWith(prefix+"-"))??issue.id;
    const source=issue.blockIds.length?this.store.projection.get().blocks.find((block)=>block.id===issue.blockIds[0]):undefined;
    const name=source?String(source.properties.label??source.handle):"";
    return this.i18n.t(`context.health.issue.${family}.${part}`,this.i18n.system(issue[part]),{name});
  }

  override render() {
    const p = this.store.projection.get();const history=generationHistoryItems(p.outputs);const selectedItem=history.find((item)=>(item.kind==="fan"?`fan:${item.id}`:item.id)===this.store.ui.selectedOutputId)??history[0];const output=selectedItem?.kind==="output"?selectedItem.output:undefined;const previewProgress=this.store.documentPreviewProgress(p.documentId);const canCompare=history.filter((item)=>item.kind==="output").length>=2;const contextGroups=new Set(p.blocks.map((block)=>blockTypeDefinition(block.type)?.group).filter(Boolean));const facts=p.blocks.map((block)=>({block_id:block.id,type:block.type,role:block.type,handle:block.handle,active:Number(block.properties.weight??.5)>0,properties:block.properties}));const relationships=p.blockRelations.map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties}));const combinedGroups=combinedContextGroups({facts,relationships});const nestedBlockIds=new Set(p.blockRelations.filter((relation)=>isContextCompositionRelation(relation.kind)).map((relation)=>relation.toBlockId));const rootBlocks=p.blocks.filter((block)=>!nestedBlockIds.has(block.id));const visibleBlocks=rootBlocks.length?rootBlocks:p.blocks;const documentInsight=contextGroups.size>=4?this.i18n.t("workspace.insight.complete","{count} independently editable decisions are working together. Each can still be refined or reused on its own.",{count:this.i18n.number(p.blocks.length)}):this.i18n.t("workspace.insight.partial","This document currently covers {covered} of {total} creative areas. Add another perspective only when it helps the work.",{covered:this.i18n.number(contextGroups.size),total:this.i18n.number(5)});const failures=this.store.documentJobs.get().filter((job)=>job.documentId===p.documentId&&job.status==="failed"&&!job.dismissedAt).length;const nextActions=creativeNextActions({blocks:p.blocks,outputs:p.outputs,artifacts:p.artifacts,failedOperations:failures,events:this.store.events.get(),documentId:p.documentId,projectId:p.projectId});
    const projectContext=this.store.session.get()?.projectContext;
    const canAuthor=!projectContext||projectContext.permissions.includes("project.author");
    const canGenerate=!projectContext||projectContext.permissions.includes("project.output.request");
    const assistantActive=Boolean(this.store.session.get()?.assistant?.enabled&&this.store.session.get()?.policy.accepted);
    const health=assessCreativeContext(p,this.store.events.get());
    const scopedActivity=scopedFormaActivity(this.store.session.get(),p,this.store.projectNotifications.get(),this.store.reviewInbox.get(),this.store.documentJobs.get());
    const notifications=scopedActivity.notifications.filter((notification)=>!notification.readAt&&(!notification.documentId||notification.documentId===p.documentId)).slice(0,4);
    const documentReviews=scopedActivity.reviews.filter((review)=>review.documentId===p.documentId);
    const documentTasks=scopedActivity.jobs.filter((job)=>job.documentId===p.documentId&&["queued","running","committing","failed","partial"].includes(job.status)&&!job.dismissedAt);
    const failedTasks=documentTasks.filter((job)=>["failed","partial"].includes(job.status));
    if(this.#inspectorDocumentId!==p.documentId){
      this.#inspectorDocumentId=p.documentId;
      const usefulOverview=Boolean(p.blocks.length||p.artifacts.length||history.length||documentReviews.length||documentTasks.length);
      this.#inlineInspectorOpen=this.#inlineInspectorPreference??usefulOverview;
      if(!this.#compactInspector)this.#workbenchInspectorOpen=this.#inlineInspectorOpen;
    }
    const blockingIssue=health.issues.find((issue)=>issue.severity==="blocking");
    const artifactFirst=!previewProgress&&(failedTasks.length>0&&!selectedItem||p.artifacts.length>0&&(!selectedItem||(!this.store.ui.selectedOutputId&&p.artifacts[0]!.sequence>=selectedItem.sequence)));
    const artifactGallery=html`<forma-document-artifacts compact source="document" @document-artifact-open=${()=>{if(this.#workbenchPane==="write")this.#selectWorkbenchPane("result");}} @document-artifact-viewer-open=${()=>this.#setArtifactViewerOpen(true)} @document-artifact-close=${()=>this.#setArtifactViewerOpen(false)}></forma-document-artifacts>`;
    const visualResult=previewProgress?html`<div class="output-card primary streaming-output-card" data-forma-content="primary"><div class="output-art"><div class="streaming-preview"><img class="streaming-preview-image" src=${previewProgress.mediaUrl} width=${previewProgress.width} height=${previewProgress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div></div><div class="output-info"><div><span class="output-quality draft">Draft arriving</span><b>The plan is becoming visible</b><small>The finished draft will appear here automatically.</small></div></div></div>`:selectedItem?.kind==="fan"?html`<article class="output-card primary prompt-fan-output-card" data-forma-content="primary"><forma-prompt-fan-visual .outputs=${selectedItem.outputs}></forma-prompt-fan-visual><div class="output-info"><div><span class=${`output-quality ${selectedItem.purpose==="ideate"?"draft":"full"}`}>${selectedItem.purpose==="ideate"?this.i18n.system("Draft fan"):this.i18n.system("Full-quality fan")}</span><b>One generation · four prompt processes</b><small>${selectedItem.complete} of 4 ready · ${selectedItem.standaloneCount} promoted to stand alone</small></div></div><forma-prompt-fan-review .fanId=${selectedItem.id}></forma-prompt-fan-review></article>`:output ? html`<forma-output-card data-forma-content="primary" .output=${output} .primary=${true}></forma-output-card>` : p.artifacts.length ? nothing : html`<div class="empty-output" data-forma-empty-state><span>${icon("image")}</span><h3>${p.blocks.length ? this.i18n.system("Context is ready") : this.i18n.system("A genuinely blank canvas")}</h3><p>${p.blocks.length ? this.i18n.system("Your creative decisions are ready to become an image or another finished result.") : this.i18n.system("Nothing has been added yet. Start only when you are ready.")}</p></div>`;
    return html`<section class="workspace-page" data-workbench="document">
      <forma-project-rail surface="studio" destination="/" @edit-project=${()=>this.#openProjectSettings()}></forma-project-rail>
      <div class="studio-main">
        <div class="studio-header-stack">
          <div class="document-bar page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${p.projectName} / Document</span>${this.#documentName===null||!canAuthor?html`<div class="document-title-row"><h1>${p.documentTitle}</h1>${canAuthor?html`<button class="icon-button" aria-label=${this.i18n.system("Rename {documentTitle}", { documentTitle: p.documentTitle })} title="Rename document" @click=${()=>this.#beginDocumentRename(p.documentTitle)}>${icon("edit")}</button>`:nothing}</div>`:html`<form class="document-title-editor" @submit=${(event:SubmitEvent)=>this.#renameDocument(event,p.documentId,p.documentTitle)}><label class="sr-only" for="document-title-input">Document name</label><input id="document-title-input" maxlength="80" .value=${this.#documentName} @input=${(event:InputEvent)=>{this.#documentName=(event.target as HTMLInputElement).value;this.requestUpdate();}}><button type="button" class="button ghost compact" @click=${()=>{this.#documentName=null;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary compact" ?disabled=${!this.#documentName.trim()}>Save name</button></form>`}</div><div class="document-actions page-header-actions">${canAuthor?html`<button class="icon-button labeled" ?disabled=${!this.store.canUndo()} title=${this.store.canUndo()?this.i18n.system("Undo the latest reversible authored change"):this.i18n.system("No reversible authored change")} @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button><button class="icon-button labeled" ?disabled=${!this.store.canRedo()} title=${this.store.canRedo()?this.i18n.system("Redo the last undone change"):this.i18n.system("Nothing has been undone in this session")} @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button>`:nothing}<button class="button secondary compact" ?disabled=${!canCompare} title=${canCompare?this.i18n.system("Compare the two latest outputs"):this.i18n.system("Generate one more output to compare")} @click=${this.#compare}>${icon("compare")} Compare</button>${canAuthor?html`<button class="icon-button labeled danger-quiet" ?disabled=${p.documents.length<=1} title=${p.documents.length<=1?this.i18n.system("Create another document before removing the final document"):this.i18n.system("Remove this document")} @click=${this.#openDeleteDocument}>${icon("trash")}<span>Remove</span></button>`:nothing}</div></div>
          <forma-studio-mode-nav active="document"></forma-studio-mode-nav>
        </div>
        <div class="document-workbench-tasks" data-has-reviews=${String(documentReviews.length>0)} role="group" aria-label=${this.i18n.t("workbench.inspector","Document overview")} @keydown=${this.#navigateWorkbenchPanes}>
          ${(["write","result","review"] as const).map((pane)=>{const attention=pane==="review"?documentReviews.length:pane==="result"?failedTasks.length:0;return html`<button type="button" class="button ghost compact" data-workbench-pane=${pane} aria-pressed=${String(this.#workbenchPane===pane)} aria-controls=${pane==="write"?"document-context-panel":"document-results-panel"} @click=${()=>this.#selectWorkbenchPane(pane)}>${pane==="write"?this.i18n.t("studio.family.write","Write"):pane==="result"?this.i18n.t("workbench.creativeResults","Creative results"):this.i18n.t("activity.review","Review")}${attention?html`<span class="document-workbench-task-count" aria-label=${this.i18n.number(attention)}>${this.i18n.number(attention)}</span>`:nothing}</button>`;})}
        </div>
        <div class="studio-grid" data-inspector-open=${String(this.#workbenchInspectorOpen)} data-workbench-mode=${this.#workbenchPane}>
          <section id="document-context-panel" class="context-column" aria-labelledby="context-title" ?hidden=${this.#narrowWorkbench&&this.#workbenchPane!=="write"}><div class="section-heading"><div><span class="eyebrow">${p.blocks.length?p.blocks.length===1?this.i18n.system("1 creative decision"):`${this.i18n.number(p.blocks.length)} ${this.i18n.system("creative decisions")}`:this.i18n.system("Ready when you are")}</span><h2 id="context-title">Creative context</h2></div><span class="health-pill" title=${health.issues.length?health.issues.map((issue)=>this.#healthIssueCopy(issue,"label")).join(" · "):this.i18n.system("Objective, audience, delivery, rights, and evidence are complete")}><i></i> ${this.i18n.number(health.score)}/100</span></div>
            ${assistantActive&&this.#proposal?html`<aside class="document-quick-edit-review" tabindex="-1" aria-live="polite" aria-label=${this.i18n.t("assistant.mode.quickEdit")}>${this.#proposalPreview()}</aside>`:nothing}
            ${blockingIssue?html`<aside class="document-workbench-critical" role="status"><span>${this.#healthIssueCopy(blockingIssue,"label")}</span>${canAuthor?html`<button type="button" class="button secondary compact" @click=${()=>this.#repairContext(blockingIssue)}>${this.i18n.t("context.health.severity.warning","Review")}</button>`:nothing}</aside>`:nothing}
            ${p.blocks.length ? html`<div class="block-list" data-forma-content="primary">${visibleBlocks.map((block) => html`<forma-context-block .block=${block}></forma-context-block>`)}</div>` : this.#blockDraft === null ? html`<div class="blank-context" data-forma-empty-state><span>${icon("plus")}</span><h3>This document is empty</h3><p>${canAuthor?this.i18n.system("Add a typed context block, upload a reference, or ask Forma only when you are ready. Nothing is created on your behalf."):this.i18n.system("There are no creative decisions in this shared document yet.")}</p>${canAuthor?html`<button class="button primary" @click=${this.#beginBlock}>Add context</button>`:nothing}</div>` : nothing}
            ${notifications.length?html`<aside class="context-next-actions project-followup-actions" aria-label=${this.i18n.t("notifications.actions","Automatic project follow-up")}>${notifications.map((notification)=>html`<button type="button" @click=${()=>{void this.store.acknowledgeProjectNotification(notification.id);if(notification.artifactId){const artifact=this.querySelector("forma-document-artifacts") as HTMLElement&{openArtifactById?:(id:string)=>Promise<unknown>};void artifact?.openArtifactById?.(notification.artifactId);}}}><span><b>${this.i18n.t(`notifications.${notification.kind}.label`,this.i18n.system(notification.kind.replaceAll("_"," ")))}</b><small>${notification.kind==="changes_requested"&&notification.message?notification.message:this.i18n.t(`notifications.${notification.kind}.detail`,this.i18n.system(notification.message))}</small></span>${icon("arrow")}</button>`)}</aside>`:nothing}
            ${p.blocks.length&&health.issues.length?html`<aside class="context-next-actions context-health-actions" aria-label=${this.i18n.t("context.health.actions","Actionable context health")}>${health.issues.slice(0,3).map((issue)=>html`<button type="button" ?disabled=${!canAuthor} @click=${()=>this.#repairContext(issue)}><span><b>${this.i18n.t(`context.health.severity.${issue.severity}`,issue.severity)} · ${this.#healthIssueCopy(issue,"label")}</b><small>${this.#healthIssueCopy(issue,"detail")}</small></span>${icon("arrow")}</button>`)}</aside>`:nothing}
            ${canAuthor&&p.blocks.length&&nextActions.length?html`<aside class="context-next-actions" aria-label=${this.i18n.t("next.heading","Suggested next steps")}>${nextActions.slice(0,2).filter((action)=>!projectContext||projectContext.permissions.includes("project.output.request")||!["make-draft","refine-image","create-output"].includes(action.id)).map((action)=>html`<button type="button" @click=${()=>this.#followNextAction(action)}><span><b>${this.i18n.t(`next.${action.id}.label`,this.i18n.system(action.label))}</b><small>${this.i18n.t(`next.${action.id}.reason`,this.i18n.system(action.reason),{count:this.i18n.number(action.evidence)})}</small></span>${icon("arrow")}</button>`)}</aside>`:nothing}
            ${combinedGroups.length?html`<details class="document-combined-contexts"><summary><span>${icon("branch")} <b>${combinedGroups.length} Combined Context${combinedGroups.length===1?"":"s"}</b></span><small>Review how decisions travel together</small></summary><div>${combinedGroups.map((group)=>html`<article><header><span><b>${group.name}</b><small>${group.role.replaceAll("_"," ")} · ${group.application.replaceAll("_"," ")}</small></span><strong>${Math.round(group.relativity*100)}%</strong></header><p>Applies only to <b>${group.target}</b></p><small>${group.members.length} ordered decision${group.members.length===1?"":"s"}: ${group.members.map((member)=>member.label).join(" · ")}</small></article>`)}</div></details>`:nothing}
            ${canAuthor?this.#blockComposer():nothing}
            ${canAuthor&&this.#blockDraft===null&&p.blocks.length?html`<button class="add-block" @click=${this.#beginBlock}>${icon("plus")} Add context</button>`:nothing}
            ${p.blocks.length?html`<div class="document-insight"><span>${icon("branch")}</span><p>${documentInsight}</p>${canAuthor?html`<button @click=${()=>this.store.setRoute("/studio/board")}>See spatially ${icon("arrow")}</button>`:nothing}</div>`:nothing}
            <details class="context-provenance"><summary>How these decisions are preserved</summary><div class="compile-bridge"><span>${icon("branch")}</span><div><b>Traceable creative history</b><small>${p.latestCompile ? this.i18n.system("The latest result retains its exact creative inputs") : this.i18n.system("Every decision will remain available with its next result")}</small></div><button @click=${() => this.store.patchUi({ inspectorOpen:true })}>Inspect</button></div></details>
          </section>
          <section id="document-results-panel" class="output-column" aria-labelledby="output-title" ?hidden=${this.#narrowWorkbench&&this.#workbenchPane==="write"&&!this.#artifactViewerOpen}><div class="section-heading"><div><span class="eyebrow">${this.store.session.get()?.provider.configured ? `${this.i18n.system("Images, stories, presentations & motion")} · ${this.i18n.t("artifact.audio.label", "Audio")}` : this.store.session.get()?.provider.plannerConfigured ? this.i18n.t("assistant.previewUnavailable") : this.i18n.system("Connect a provider to begin")}</span><h2 id="output-title">Your results</h2></div><div class="output-heading-actions"><button class="text-button" ?disabled=${!canCompare} title=${canCompare?this.i18n.system("Compare output history"):this.i18n.system("Generate one more output to compare")} @click=${this.#compare}>Compare history</button><button type="button" class="button secondary compact document-inspector-toggle" aria-controls="document-workbench-inspector" aria-expanded=${this.#workbenchInspectorOpen} @click=${()=>this.#toggleWorkbenchInspector()}>${this.i18n.t(this.#workbenchInspectorOpen?"workbench.hideInspector":"workbench.showInspector",this.#workbenchInspectorOpen?"Hide overview":"Show overview")}</button></div></div>
            ${assistantActive&&canAuthor&&canGenerate?html`<section class="document-result-generation" aria-label=${this.i18n.system("Generation choices")}><forma-generation-actions source="document" .selected=${output??null} compact></forma-generation-actions></section>`:nothing}
            ${this.#workbenchPane==="review"?html`<section class="document-workbench-review" aria-label=${this.i18n.t("workbench.reviewQueue","Review queue")}>${documentReviews.length?documentReviews.map((review)=>html`<article data-forma-content="primary"><b dir="auto">${review.artifactTitle}</b><button type="button" class="button secondary compact" @click=${()=>void this.store.openAssignedReview(review)}>${this.i18n.t("activity.openReview","Open assigned review")}</button></article>`):html`<p data-forma-empty-state>${this.i18n.t("workbench.noTasks","No active tasks")}</p>`}</section>`:nothing}
            ${artifactFirst?nothing:visualResult}
            ${artifactGallery}
            ${artifactFirst?visualResult:nothing}
            ${history.length > 1 ? html`<div class="output-filmstrip" aria-label="Previous generations">${history.slice(1,5).map((item:GenerationHistoryItem)=>{const id=item.kind==="fan"?`fan:${item.id}`:item.id;return html`<button class="mini-output ${this.store.ui.selectedOutputId===id?"selected":""}" aria-label=${item.kind==="fan"?this.i18n.system("Select fan generation"):this.i18n.system("Select {id}", { id: item.id })} aria-pressed=${this.store.ui.selectedOutputId===id} @click=${() => { this.store.patchUi({ selectedOutputId:id }); if (!projectContext&&item.kind==="output"&&this.store.ui.instrumentation) void this.store.hot({type:"ObjectViewed",payload:{object_id:item.id}}); }}>${item.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${item.outputs} .compact=${true}></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${item.output} .compact=${true}></forma-output-visual>`}</button>`;})}</div>` : nothing}
            ${canAuthor?html`<form class="reference-picker-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="dropzone" @dragover=${(event:DragEvent)=>event.preventDefault()} @drop=${(event:DragEvent)=>{event.preventDefault();const file=event.dataTransfer?.files[0];if(file)this.#queueUpload(file);}}><input type="file" accept="image/*,audio/*,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx" @change=${this.#queueUpload}><span>${icon("plus")}</span><b>${this.#uploading ? this.i18n.system("Uploading…") : this.i18n.t("audio.upload.choose","Choose an image, audio recording, or source document")}</b><small>${this.i18n.t("audio.reference.private","Private audio reference")} · ${this.i18n.system("Private, rights-confirmed evidence with a verifiable content hash.")}</small></label></form>`:nothing}
          </section>
          <aside id="document-workbench-inspector" class="document-workbench-inspector" ?hidden=${!this.#workbenchInspectorOpen} aria-labelledby="document-workbench-inspector-heading" @keydown=${(event:KeyboardEvent)=>{if(this.#compactInspector&&event.key==="Escape"){event.preventDefault();this.#toggleWorkbenchInspector(false);}}}><header>${this.#compactInspector?html`<button type="button" class="icon-button document-inspector-close" aria-label=${this.i18n.t("workbench.hideInspector","Hide overview")} @click=${()=>this.#toggleWorkbenchInspector(false)}>${icon("close")}</button>`:nothing}<span class="eyebrow">${p.projectName}</span><h2 id="document-workbench-inspector-heading">${this.i18n.t("workbench.inspector","Document overview")}</h2><p dir="auto">${p.documentTitle}</p></header><section><h3>${this.i18n.t("workbench.contextHealth","Context health")}</h3><strong>${this.i18n.number(health.score)}/100</strong><small>${this.i18n.number(p.blocks.length)} ${this.i18n.system("creative decisions")}</small>${health.issues.length?html`<ul>${health.issues.slice(0,3).map((issue)=>html`<li>${this.#healthIssueCopy(issue,"label")}</li>`)}</ul>`:nothing}</section><section><h3>${this.i18n.t("workbench.activeTasks","Active tasks")}</h3>${documentTasks.length?html`<ul>${documentTasks.map((job)=>html`<li><span>${this.i18n.t(`activity.kind.${job.kind}`,job.kind)}</span><small>${this.i18n.t(`activity.status.${job.status}`,job.status)}</small></li>`)}</ul>`:html`<small>${this.i18n.t("workbench.noTasks","No active tasks")}</small>`}</section><section><h3>${this.i18n.t("workbench.reviewQueue","Review queue")}</h3>${documentReviews.length?html`<ul>${documentReviews.map((review)=>html`<li><b dir="auto">${review.artifactTitle}</b><button type="button" class="button secondary compact" @click=${()=>void this.store.openAssignedReview(review)}>${this.i18n.t("activity.openReview","Open assigned review")}</button></li>`)}</ul>`:html`<small>${this.i18n.number(0)}</small>`}</section><section><h3>${this.i18n.t("workbench.deliveryReady","Ready to deliver")}</h3><strong>${this.i18n.number(history.length+p.artifacts.length)}</strong><button type="button" class="button secondary compact" @click=${()=>this.store.setRoute("/deliver")}>${this.i18n.t("shell.navigation.deliver","Deliver")} ${icon("arrow")}</button></section><button type="button" class="button ghost compact" @click=${()=>this.store.setRoute("/activity")}>${this.i18n.t("shell.navigation.activity","Activity")} ${icon("arrow")}</button></aside>
        </div>
      </div>
      ${this.store.ui.inspectorOpen ? this.#inspector() : nothing}
      ${!assistantActive&&canAuthor&&canGenerate?html`<div class="composer-dock">
        ${this.#proposalPreview()}
        <div class="composer"><form class="composer-command" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#prompt.trim())void this.#ask();}}><label class="sr-only" for="creative-command">Describe a change or ask Forma</label><textarea id="creative-command" rows="1" placeholder="Ask a question, explain an objective, or describe a change…" .value=${this.#prompt} @input=${(e: InputEvent) => { this.#prompt = (e.target as HTMLTextAreaElement).value;this.requestUpdate(); }} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing&&!e.metaKey&&!e.ctrlKey&&!e.altKey) { e.preventDefault(); const submitter=(e.currentTarget as HTMLTextAreaElement).form?.querySelector<HTMLButtonElement>('button[type="submit"]');if(submitter&&!submitter.disabled)submitter.form?.requestSubmit(submitter); } }}></textarea><label class="icon-button add-ref" title=${this.i18n.t("audio.upload.add","Add a licensed image, audio recording, or source document")}><input type="file" accept="image/*,audio/*,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx" @change=${this.#queueUpload}>${icon("plus")}</label>${!projectContext?html`<button type="button" class="button ghost compact" title="Propose one local rule-based edit without calling a model" ?disabled=${!this.#prompt.trim()||this.#asking} @click=${()=>void this.#suggestQuickAction()}>Quick edit</button>`:nothing}<button type="submit" class="button secondary ask" title=${this.store.session.get()?.provider.plannerConfigured??this.store.session.get()?.provider.configured?this.i18n.t("assistant.mode.creativeChatSubmit"):this.i18n.t("assistant.creativeUnavailable")} ?disabled=${!this.#prompt.trim()||this.#asking||!(this.store.session.get()?.provider.plannerConfigured??this.store.session.get()?.provider.configured)}>${this.#asking?this.i18n.system("Asking Forma…"):this.i18n.system("Ask Forma")}</button></form><forma-generation-actions source="document" .selected=${output??null} compact></forma-generation-actions></div>
      </div>`:nothing}
      ${this.store.ui.compareOpen ? this.#comparison() : nothing}
      ${this.#projectSettings&&!projectContext?html`<dialog class="modal workspace-modal project-settings-dialog" closedby="any" aria-labelledby="project-settings-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeProjectSettings();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeProjectSettings();}} @close=${()=>{if(this.#projectSettings){this.#projectSettings=false;this.requestUpdate();}}}><form class="modal-card project-settings-form" @submit=${this.#saveProject}><button type="button" class="icon-button modal-close" aria-label="Close project settings" @click=${this.#closeProjectSettings}>${icon("close")}</button><span class="eyebrow">Project settings</span><h2 id="project-settings-title">Edit ${p.projectName}</h2><label>Project name<input maxlength="80" required .value=${this.#projectName} @input=${(event:InputEvent)=>{this.#projectName=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><label>Project state<select .value=${this.#projectState} @change=${(event:Event)=>{this.#projectState=(event.target as HTMLSelectElement).value;}}><option value="active">Active</option><option value="archived">Archived</option><option value="paused">Paused</option></select><small>State changes are reversible events; they never delete project history.</small></label><footer><button type="button" class="button ghost" @click=${this.#closeProjectSettings}>Cancel</button><button class="button primary" ?disabled=${!this.#projectName.trim()}>Save project</button></footer></form></dialog>`:nothing}
      ${this.#deleteDocument?html`<dialog class="modal workspace-modal document-delete-dialog studio-document-delete-dialog" closedby="any" aria-labelledby="studio-delete-document-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeDeleteDocument();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeDeleteDocument();}} @close=${()=>{if(this.#deleteDocument){this.#deleteDocument=false;this.requestUpdate();}}}><div class="modal-card document-delete-card"><button class="icon-button modal-close" aria-label="Cancel document removal" @click=${this.#closeDeleteDocument}>${icon("close")}</button><span class="eyebrow">Removal can be undone</span><h2 id="studio-delete-document-title">Remove “${p.documentTitle}”?</h2><p>The document, its creative decisions, and its results will leave your active project. Another document opens automatically, and Undo can bring this one back.</p><div class="document-delete-summary"><span>${icon("trash")}</span><div><b>${p.documentTitle}</b><small>${p.blocks.length} creative decision${p.blocks.length===1?"":"s"} · ${history.length+p.artifacts.length} result${history.length+p.artifacts.length===1?"":"s"}</small></div></div><footer><button class="button ghost" @click=${this.#closeDeleteDocument}>Cancel</button><button class="button danger" @click=${this.#confirmDeleteDocument}>Remove document</button></footer></div></dialog>`:nothing}
      ${this.#pendingUpload ? html`<dialog class="modal workspace-modal upload-rights-modal" closedby="any" aria-modal="true" aria-labelledby="upload-rights-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget && !this.#uploading) this.#cancelUpload(); }} @cancel=${(event: Event) => { event.preventDefault(); if (!this.#uploading) this.#cancelUpload(); }} @close=${() => { if (this.#pendingUpload && !this.#uploading) { this.#pendingUpload = null; this.#uploadDocumentId = ""; this.#rightsConfirmed = false; this.requestUpdate(); } }}>
        <form class="modal-card reference-upload-card" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#rightsConfirmed&&!this.#uploading)void this.#confirmUpload();}}>
          <button type="button" class="icon-button modal-close" aria-label="Cancel upload" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>${icon("close")}</button>
          <span class="eyebrow">Reference setup · before upload</span><h2 id="upload-rights-title">${audioMimeType(this.#pendingUpload.type)?this.i18n.t("audio.reference.private","Private audio reference"):this.#pendingUpload.type.startsWith("image/")?this.i18n.system("Choose what this image should contribute"):this.i18n.system("Verify this source document")}</h2>
          <div class="upload-file-receipt"><span>${icon(audioMimeType(this.#pendingUpload.type)?"audio":"image")}</span><div><b>${this.#pendingUpload.name}</b><small>${(this.#pendingUpload.size / 1_048_576).toFixed(1)} MB · ${this.#pendingUpload.type || this.i18n.system("document")}</small></div></div>
          ${audioMimeType(this.#pendingUpload.type)?html`<p>${this.i18n.t("audio.use.inform.description","Use only your written description to shape images, stories, presentations, video, and music.")}</p><div class="reference-extraction-note"><span>${icon("info")}</span><p>${this.i18n.t("audio.upload.rightsNotice","I also confirm this recording contains no sensitive information. Upload remains private; creative influence, accompaniment, and provider transfer each require separate approval.")}</p></div>`:this.#pendingUpload.type.startsWith("image/")?html`<p>Forma can prepare several kinds of visual evidence. They remain suggestions on the Reference block until you explicitly add one as a document decision.</p><fieldset class="reference-extraction-options"><legend>Prepare findings automatically</legend>${REFERENCE_FINDING_OPTIONS.map((option) => html`<label><input type="checkbox" .checked=${this.#referenceFindingKinds.has(option.kind)} @change=${(event: Event) => { const checked = (event.target as HTMLInputElement).checked; if (checked) this.#referenceFindingKinds.add(option.kind); else this.#referenceFindingKinds.delete(option.kind); this.requestUpdate(); }}><span><b>${this.i18n.system(option.label)}</b><small>${this.i18n.system(option.description)}</small></span></label>`)}</fieldset><div class="reference-extraction-note"><span>${icon("info")}</span><p>Image analysis uses a small deterministic sample for visual structure; it does not identify people, objects, or meaning. You can change the prepared findings later.</p></div>`:html`<p>Selectable text from PDF, Word, PowerPoint, Excel, Markdown, CSV, JSON, and text sources is securely extracted by Forma into bounded, anchored project evidence. Scanned or encrypted documents may still require an accessible source excerpt; OCR is not available.</p><div class="reference-extraction-note"><span>${icon("info")}</span><p>The original bytes remain in private storage; their SHA-256 content hash and every cited excerpt are verified together with the rights receipt.</p></div>`}
          <label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event: Event) => { this.#rightsConfirmed = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}><span><b>I own this source or have a license that permits this use.</b><small>In a controlled pilot, I also confirm this source contains no sensitive information. This assertion is recorded with the reference and does not transfer ownership.</small></span></label>
          <footer><button type="button" class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>Cancel</button><button type="submit" class="button primary" ?disabled=${!this.#rightsConfirmed || this.#uploading}>${this.#uploading ? this.i18n.system("Uploading securely…") : this.i18n.system("Confirm & add reference")}</button></footer>
        </form>
      </dialog>` : nothing}
    </section>`;
  }
}
if (!customElements.get("forma-workspace")) customElements.define("forma-workspace", FormaWorkspace);
