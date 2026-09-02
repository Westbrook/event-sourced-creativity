import { model3dMimeType } from "../model/model3d-assets";
import { referenceCompositionSources, type ReferenceCompositionRecipe } from "../model/reference-composition";
import "./reference-compositor";
import type { ReferenceCompositor } from "./reference-compositor";
import { html, nothing } from "lit";
import { hasBlockingNavigationDialog, navigateInApp, type CommandDeparture, type NavigationPresentationContext } from "./command-departure";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import { FormaElement, icon } from "./forma-element";
import { provenanceActorMessage } from "./design-system/localization";
import { blockIconName } from "./icon-semantics";
import { ensureModalDialog } from "./modal-dialog";
import { contextControlName } from "./context-controls";
import { contextDiff, generationHistoryItems, outputQualityLabel, type GenerationHistoryItem, shortEventType, type CreativeBlock, type EventInput } from "../model/events";
import { sampleImageFile } from "../model/image-sample";
import { DEFAULT_REFERENCE_FINDINGS, REFERENCE_FINDING_OPTIONS, type ImageSample, type ReferenceFindingKind } from "../model/extractors";
import { retrieveFewShotExemplars, type RetrievedExemplar } from "../model/indexing";
import { workspaceQuickEditNeedsTarget } from "../model/workspace-local-proposal";
import { WorkspaceLocalProposal, type WorkspaceQuickEditScope } from "./workspace-local-proposal";
import { workspaceLocalProposalCopy } from "./design-system/localized-workspace-proposal";
import { BLOCK_GROUPS, BLOCK_INTENTS, BLOCK_TYPES, blockIntentFor, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import { localizedSpatialScopeLabel } from "./design-system/localized-spatial-scope";
import { DEFAULT_IMAGE_FORMAT, IMAGE_FORMAT_PRESETS, imageFormatForPreset, type ImageFormat } from "../model/image-format";
import { documentContextBlockFromRoute, documentIdFromRoute, documentViewFromRoute, routePathname, withDocumentInRoute } from "../model/routes";
import type { AssistantToolRequest } from "../model/assistant-route-policy";
import { inferDocumentArtifactKind } from "../model/document-output-intent";
import { combinedContextGroups, isContextCompositionRelation } from "../model/combined-context";
import { creativeActionSourceRevision, creativeNextActions, creativeNextTargetAvailable, creativePreparationChoice, creativePreparationTargetAvailable, followCreativeNextTarget, type CreativeNextAction, type CreativeMedium, type CreativeNextTarget, type CreativePreparationStage } from "../model/workspace-intelligence";
import type { OutputVisual } from "./output-visual";
import { outputComparisonHistory } from "../model/output-comparison";
import { nextActionFacts } from "../state/next-action-context";
import { artifactDeliveryFor } from "../state/artifact-delivery-context";
import { artifactDeliveryFactsProof } from "../model/artifact-delivery-facts";
import { DOCUMENT_ARTIFACT_KINDS, documentArtifactDefinition } from "../model/document-artifacts";
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
import { renderLifecycleNextActionCards } from "./next-action-cards";
import { openCreativeNextActionDestination } from "./creative-next-action-navigation";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";

type BlockDraft = { type: BlockKind|""; subtype: string; text: string; colors: string[]; imageFormat: ImageFormat; outputKind: ReturnType<typeof inferDocumentArtifactKind>; documentId: string; documentTitle: string };

export class FormaWorkspace extends FormaElement {
  #prompt = "";
  #asking=false;
  #formatChoiceOpen=false;#formatReturnFocus:HTMLElement|null=null;#preparationRoute="";
  #formatTarget:Extract<CreativeNextTarget,{kind:"configure"}>|null=null;
  #formatRequired:((stage:CreativePreparationStage)=>boolean)|null=null;
  // One pending native presentation only; existing draft/viewer fields remain the owners.
  #nextOpening:{current:(stage:CreativePreparationStage)=>boolean;retire:()=>void;ready:boolean}|null=null;
  #nextOutputTarget:Extract<CreativeNextTarget,{kind:"output"}>|null=null;
  #blockDraft: BlockDraft | null = null;
  #documentName: string | null = null;
  #documentNameRevision = 0;
  #proposalResumeKey="";
  // Content-free ownership only; related private text is always derived from the current Store.
  #quickEditReferenceInspection:{eventId:string;resolve:()=>{item:RetrievedExemplar;label:string}|null}|null=null;
  #localProposal=new WorkspaceLocalProposal({
    scope:()=>this.#quickEditScope(),changed:()=>this.requestUpdate(),applied:()=>this.store.refreshEvents(),
    request:(body)=>this.store.guardedFetch("/api/workspace/quick-edit",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)},workspaceLocalProposalCopy(this.i18n.locale).title),
  });
  #referenceComposition:{id:string;current:()=>boolean}|null=null;
  #compositionSaving=false;
  #uploadCurrent:()=>boolean=()=>false;
  #uploading = false; #pendingUpload: File | null = null; #uploadDocumentId = ""; #rightsConfirmed = false;
  #referenceFindingKinds = new Set<ReferenceFindingKind>(DEFAULT_REFERENCE_FINDINGS);
  #projectSettings=false;#projectName="";#projectState="active";#deleteDocument=false;
  #linkedBlockId="";
  #linkedBlockNavigation:OutputNavigationFocusLease|null=null;
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
  #assistantTool=(event:Event)=>{
    const request=(event as CustomEvent<AssistantToolRequest>).detail;if(request.mode!=="quick-edit")return;
    const session=this.store.session.get(),projection=this.store.projection.get();
    if(!session||session.projectContext||request.actorUserId!==session.user.userId||request.projectId!==projection.projectId||request.documentId!==projection.documentId||request.canvasId)return;
    event.preventDefault();
    // Preparation may finish after another ordinary pane/focus choice. Retain
    // its actual result, but never acquire a new presentation grant on arrival.
    const focus=captureOutputNavigationFocus(this.ownerDocument),source=this.store.captureSourceOwnership();
    const route=this.store.route.get(),scope=this.#quickEditScope();
    const current=()=>this.isConnected&&this.store.route.get()===route&&this.store.sourceOwnershipActive(source)
      &&this.#quickEditScope()?.key===scope?.key&&this.store.projection.get().documentId===request.documentId&&focus.current();
    this.#prompt=request.message;
    void this.#suggestQuickAction().then((accepted)=>{
      if(accepted&&current())this.#selectWorkbenchPane("write");
      // The assistant's original gesture owns the single close/focus handoff.
      // A retained preview is still successful when presentation was superseded.
      request.resolve(accepted);
    }).catch(()=>request.resolve(false)).finally(()=>focus.dispose());
  };

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


  /** Panel-only navigation. The existing Output controller still owns exact focus and all decisions. */
  revealOutputNavigation(documentId:string,current:()=>boolean):boolean{
    const projection=this.store.projection.get(),session=this.store.session.get(),context=session?.projectContext;
    const permissions=context?.permissions??session?.capabilities??[];
    if(!this.isConnected||!current()||!session||!this.store.captureAuthorizationScope()||!permissions.includes("project.read")
      ||projection.documentId!==documentId||!projection.documents.some(value=>value.id===documentId&&value.projectId===projection.projectId&&!value.removed)
      ||context&&context.projectId!==projection.projectId||this.#blockDraft||this.#proposal||this.#formatChoiceOpen||this.#artifactViewerOpen
      ||document.querySelector("dialog[open]")||document.querySelector(".output-requirement-form")||document.querySelector(".output-plan-review"))return false;
    if(this.#workbenchPane!=="write")this.#selectWorkbenchPane("write");
    return true;
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

  #revealDocumentActionFocus(event: FocusEvent, current: () => boolean, group: "actions" | "panes" = "actions") {
    const path = event.composedPath(), target = path[0], toolbar = event.currentTarget, container = path[2];
    const selector = group === "panes" ? ".document-workbench-tasks" : ".document-actions";
    if (!this.isConnected || !current()
      || !(target instanceof HTMLElement) || !(toolbar instanceof HTMLElement) || !(container instanceof HTMLElement)
      || target.tagName !== "BUTTON" || toolbar.tagName !== "DIV"
      || !target.isConnected || !toolbar.isConnected || !container.isConnected
      || target.ownerDocument !== this.ownerDocument || toolbar.ownerDocument !== this.ownerDocument
      || container.ownerDocument !== this.ownerDocument || path[1] !== toolbar
      || toolbar.closest(group === "panes" ? ".studio-main" : ".page-header--document") !== container
      || group === "actions" && !toolbar.classList.contains("page-header-actions")
      || target.closest("forma-workspace") !== this || toolbar.closest("forma-workspace") !== this
      || target.closest(selector) !== toolbar || !toolbar.contains(target)
      || target.closest("[hidden], [inert], [aria-hidden='true']")
      || target.matches(":disabled") || !target.matches(":focus-visible")
      || target.ownerDocument.activeElement !== target) return;
    const toolbars = this.querySelectorAll<HTMLElement>(selector);
    if (toolbars.length !== 1 || toolbars[0] !== toolbar) return;
    // Preserve the native destination; reveal it in its existing action strip.
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
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
    this.#localProposal.reset();this.#proposalResumeKey="";
    this.#inspectorObserver?.disconnect();
    this.#inspectorObserved=undefined;
    super.disconnectedCallback();
  }

  protected override updated() {
    this.#syncQuickEditReview();
    if(this.#referenceComposition&&!this.#referenceComposition.current()){this.#referenceComposition=null;this.#compositionSaving=false;this.requestUpdate();}
    const opening=this.#nextOpening;
    if(opening&&!opening.current(opening.ready?"editing":"opening")){this.#nextOpening=null;opening.retire();}
    if(this.#formatTarget&&(!creativeNextTargetAvailable(this.#formatTarget,this.#nextFacts(this.#formatTarget))
      ||this.#formatRequired&&!this.#formatRequired("opening")))void this.#closeFormatChoice(false);
    if(this.#nextOutputTarget&&!creativeNextTargetAvailable(this.#nextOutputTarget,this.#nextFacts(this.#nextOutputTarget))){this.#nextOutputTarget=null;this.requestUpdate();}
    this.querySelectorAll<HTMLDialogElement>("dialog.workspace-modal").forEach((dialog)=>{
      // Retirement above may precede the render that removes this exact dialog.
      if(dialog.matches(".block-composer-dialog")&&!this.#blockDraft)return;
      ensureModalDialog(dialog);
    });
    if(opening&&this.#nextOpening===opening&&this.querySelector<HTMLDialogElement>(".block-composer-dialog,.comparison-modal,.next-format-dialog")?.open)opening.ready=true;
    const preparationUrl=new URL(this.store.route.get(),location.origin),preparation=preparationUrl.searchParams.get("prepare");
    if(preparation&&this.#preparationRoute!==this.store.route.get()&&this.store.routeDataReady()){
      this.#preparationRoute=this.store.route.get();
      const facts=nextActionFacts(this.store,this.store.projection.get().documentId);
      if(preparation==="context"&&facts.canAuthor)this.openContextComposer();
      else if(facts.canConfigure&&(preparation==="choose"||preparation==="image"||DOCUMENT_ARTIFACT_KINDS.includes(preparation as typeof DOCUMENT_ARTIFACT_KINDS[number])))void this.#prepareFormat({kind:"configure",projectId:facts.projectId,documentId:facts.documentId,canvasId:null,authorityKey:facts.authorityKey,sourceRevision:creativeActionSourceRevision(facts),medium:preparation==="choose"?null:preparation as CreativeMedium});
    }else if(!preparation)this.#preparationRoute="";
    const studio=this.querySelector(".studio-main");
    if(studio&&studio!==this.#inspectorObserved){
      this.#inspectorObserver?.disconnect();
      this.#inspectorObserver??=new ResizeObserver(this.#syncInspectorPosture);
      this.#inspectorObserver.observe(studio);
      this.#inspectorObserved=studio;
    }
    const linkedRoute=this.store.route.get(),linkedBlockId=documentContextBlockFromRoute(linkedRoute)??"";
    const navigation=this.store.captureWorkspaceNavigationFocus(linkedRoute);
    if(linkedBlockId&&(linkedBlockId!==this.#linkedBlockId||Boolean(navigation&&navigation.focus!==this.#linkedBlockNavigation))
      &&(!navigation||navigation.current())){
      this.#linkedBlockId=linkedBlockId;this.#linkedBlockNavigation=navigation?.focus??null;
      if(this.#workbenchPane!=="write")this.#selectWorkbenchPane("write");
      this.store.patchUi({focusBlockId:linkedBlockId});
      const documentId=this.store.projection.get().documentId;
      const authorization=this.store.captureAuthorizationScope();
      const linkedSource=this.store.projection.get().libraryBlocks.find(block=>block.id===linkedBlockId)?.sourceEvents.join("\u0000");
      const routeCurrent=()=>{
        const projection=this.store.projection.get(),session=this.store.session.get();
        return this.isConnected&&this.store.route.get()===linkedRoute&&projection.documentId===documentId
          &&this.store.ui.focusBlockId===linkedBlockId&&this.#workbenchPane==="write"
          &&!this.#blockDraft&&!this.#proposal&&!this.#formatChoiceOpen&&!this.#artifactViewerOpen
          &&this.store.authorizationScopeActive(authorization)
          &&(session?.projectContext?.permissions??session?.capabilities??[]).includes("project.read")
          &&linkedSource!==undefined&&projection.libraryBlocks.find(block=>block.id===linkedBlockId&&!block.removed)?.sourceEvents.join("\u0000")===linkedSource
          &&!this.ownerDocument.querySelector("dialog[open]");
      };
      const focus=navigation?.focus??captureOutputNavigationFocus(this.ownerDocument,{
        ownedRouteFocus:outputNavigationOwnedRouteFocus(this.ownerDocument,this.store,{documentId,blockId:linkedBlockId},routeCurrent),
      });
      const current=()=>routeCurrent()&&(navigation?navigation.current():focus.current());
      window.requestAnimationFrame(()=>{
        try{
          if(!current())return;
          const targets=[...this.querySelectorAll<HTMLElement>("[data-block-id]")].filter(target=>
            target.isConnected&&target.getAttribute("data-block-id")===linkedBlockId);
          if(targets.length!==1)return;
          const target=targets[0];
          focus.run(target,()=>{
            if(!current())return false;
            target.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"});
            if(!current())return false;
            target.focus({preventScroll:true});
            return current();
          });
        }finally{if(!navigation)focus.dispose();}
      });
    }else if(!linkedBlockId){this.#linkedBlockId="";this.#linkedBlockNavigation=null;}
    const linkedOutput=this.store.route.get().includes("#output-title");
    if(linkedOutput&&!this.#linkedOutputAnchor){
      this.#linkedOutputAnchor=true;
      if(this.#workbenchPane==="write")this.#selectWorkbenchPane("result");
    }else if(!linkedOutput)this.#linkedOutputAnchor=false;
  }

  #beginBlock() {
    if(this.#blockDraft)return;
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
  openContextComposer():void;
  openContextComposer(options:{current:(stage:CreativePreparationStage)=>boolean;focus?:OutputNavigationFocusLease}):Promise<boolean>;
  openContextComposer(options?:{current:(stage:CreativePreparationStage)=>boolean;focus?:OutputNavigationFocusLease}):void|Promise<boolean>{
    if(options){
      const facts=nextActionFacts(this.store,this.store.projection.get().documentId,null,{lifecycle:true});
      return this.#openOwnedNextAction({id:"add-context",label:"",reason:"",title:"",priority:0,evidence:0,target:{
        kind:"context",projectId:facts.projectId,documentId:facts.documentId,canvasId:null,authorityKey:facts.authorityKey,
        sourceGeneration:facts.sourceGeneration,sourceRevision:creativeActionSourceRevision(facts),
      }},options);
    }
    if(this.store.projection.get().documentId){if(this.#workbenchPane!=="write")this.#selectWorkbenchPane("write");this.#beginBlock();}
  }
  #closeBlock(){this.querySelector<HTMLDialogElement>(".block-composer-dialog")?.close();this.#blockDraft=null;this.requestUpdate();}
  async #addBlock(event: SubmitEvent) {
    event.preventDefault(); const draft = this.#blockDraft; const text = draft?.text.trim(); if (!draft?.type || draft.type === "reference" || draft.type === "model3d" || !text) return;
    const blockId = crypto.randomUUID(); const slug = text.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,42) || `study-${this.store.head.get()+1}`;
    const properties = draft.type === "output" ? {text,subtype:draft.subtype||suggestedSubtype(draft.type),authority:"authored"} : draft.type === "palette" ? {label:text,colors:draft.colors,subtype:draft.subtype||suggestedSubtype(draft.type),weight:.64,authority:"authored"} : {text,subtype:draft.subtype||suggestedSubtype(draft.type),weight:.64,authority:"authored",...(draft.type==="format"&&this.#formatDraftUsesImageFrame(draft)?{image_format:draft.imageFormat}:{}),...(draft.type==="audio"?{audio_role:draft.subtype.toLowerCase().replace(/\s+/g,"_"),inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{}),...(draft.type==="subject"&&["Character headshot","Character sheet"].includes(draft.subtype)?{character_context:true,context_group:{name:text,target:text,role:"character",application:"isolate",relativity:.9}}:{})};
    const appended = await this.store.append({ type: "BlockCreated", payload: { block_id: blockId, document_id:draft.documentId, type: draft.type, handle: `${draft.type}/${slug}`, position: `z${String(this.store.head.get()+1).padStart(4,"0")}`, properties } },{rebaseAttempts:6});
    if (appended.length) { this.#closeBlock(); this.store.patchUi({ focusBlockId: blockId }); }
  }
  #openReferenceComposition(){
    const source=this.store.captureSourceOwnership(),documentId=this.store.projection.get().documentId,route=this.store.route.get(),id=crypto.randomUUID();
    const current=()=>this.isConnected&&this.#referenceComposition?.id===id&&this.store.sourceOwnershipActive(source)
      &&this.store.projection.get().documentId===documentId&&this.store.route.get()===route;
    this.#referenceComposition={id,current};this.requestUpdate();
  }
  #closeReferenceComposition(event?:Event){
    if(this.#compositionSaving)return;
    const compositor=this.querySelector<ReferenceCompositor>("forma-reference-compositor");
    if(event&&event.currentTarget!==compositor)return;
    compositor?.closeForOwner();this.#referenceComposition=null;this.requestUpdate();
  }
  async #saveReferenceComposition(event:CustomEvent<{blob:Blob;recipe:ReferenceCompositionRecipe;label:string}>){
    const origin=this.#referenceComposition;if(!origin?.current()||this.#compositionSaving||event.currentTarget!==this.querySelector("forma-reference-compositor"))return;
    this.#compositionSaving=true;this.requestUpdate();
    try{const saved=await this.store.saveReferenceComposition(event.detail,origin.current);if(saved&&origin.current()){this.#compositionSaving=false;this.#closeReferenceComposition();}}
    finally{if(this.#referenceComposition===origin){this.#compositionSaving=false;this.requestUpdate();}}
  }
  #queueUpload(event: Event|File) {
    const file=event instanceof File?event:(event.target as HTMLInputElement).files?.[0];if(!file)return;
    const source=this.store.captureSourceOwnership(),route=this.store.route.get();
    this.#uploadCurrent=()=>this.isConnected&&this.store.sourceOwnershipActive(source)&&this.store.route.get()===route&&this.#pendingUpload===file;
    this.#pendingUpload = file; this.#uploadDocumentId=this.#blockDraft?.documentId??this.store.projection.get().documentId; this.#rightsConfirmed = false; this.#referenceFindingKinds = new Set(DEFAULT_REFERENCE_FINDINGS); this.requestUpdate();
  }
  #resetFileInputs() { this.querySelectorAll<HTMLInputElement>('input[type="file"]').forEach((input)=>{input.value="";}); }
  #cancelUpload() { this.#pendingUpload = null; this.#uploadDocumentId=""; this.#rightsConfirmed = false; this.#resetFileInputs(); this.requestUpdate(); }
  async #confirmUpload() {
    const file = this.#pendingUpload; if (!file || !this.#rightsConfirmed) return;
    this.#uploading = true; this.requestUpdate();
    try {
      if(model3dMimeType(file)){
        const saved=await this.store.uploadModel3dFile(file,()=>this.#uploadCurrent()&&this.#rightsConfirmed,{documentId:this.#uploadDocumentId,rightsConfirmed:true});
        if(saved&&this.#uploadCurrent()){this.#pendingUpload=null;this.#uploadDocumentId="";this.#rightsConfirmed=false;this.#closeBlock();this.#resetFileInputs();}
        this.#uploading=false;this.requestUpdate();return;
      }
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
      ${!draft.type?html`<div class="block-type-catalog">${BLOCK_GROUPS.map((group)=>{const options=BLOCK_TYPES.filter((option)=>option.group===group.id);return html`<section class="block-type-group" aria-labelledby=${`block-group-${group.id}`}><header><div><h4 id=${`block-group-${group.id}`}>${this.i18n.system(group.label)}</h4><p>${this.i18n.system(group.description)}</p></div><span>${options.length} ${options.length===1?this.i18n.system("type"):this.i18n.system("types")}</span></header><div class="block-type-grid">${options.map((option)=>html`<forma-ui-choice-card compact .label=${this.i18n.system(option.label)} .detail=${this.i18n.system(option.description)} .iconName=${blockIconName(option.type)} .value=${option.type} @forma-action=${()=>{draft.type=option.type;draft.subtype=option.subtypes[0];if(option.type==="format")draft.text=this.#formatDraftText(draft);this.requestUpdate();void this.updateComplete.then(()=>this.querySelector<HTMLElement>(".block-composer textarea,.block-composer input")?.focus());}}></forma-ui-choice-card>`)}</div></section>`;})}</div>`:html`<fieldset class="subtype-picker"><legend>System-suggested subtype</legend>${selected?.subtypes.map((subtype)=>html`<label><input type="radio" name="block-subtype" .value=${subtype} .checked=${draft.subtype===subtype} @change=${()=>{draft.subtype=subtype;this.requestUpdate();}}><span>${this.i18n.system(subtype)}</span></label>`)}</fieldset>${draft.type==="model3d"?html`<div class="reference-choice"><span>${icon("layers")}</span><div><b>${this.i18n.t("model3d.upload.choose","Choose a 3D model")}</b><small>${this.i18n.t("model3d.upload.detail","Upload a self-contained GLB up to 64 MB, then save the view that should guide generation.")}</small></div><label class="button primary">${this.i18n.t("model3d.upload.choose","Choose a 3D model")}<input type="file" accept=".glb,model/gltf-binary" @change=${this.#queueUpload}></label></div>`:draft.type==="reference"?html`<div class="reference-choice"><span>${icon("image")}</span><div><b>Choose an image or source document</b><small>Images, PDF, text, Markdown, CSV, JSON, and Office documents stay private; rights are confirmed before upload.</small></div><label class="button primary">Choose source<input type="file" accept="image/*,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx" @change=${this.#queueUpload}></label></div>`:draft.type==="palette"?html`<label class="block-draft-copy">Palette name<input maxlength="120" placeholder=${selected?.prompt && this.i18n.system(selected.prompt)} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><div class="draft-palette">${draft.colors.map((color,index)=>html`<label><input type="color" .value=${color} @input=${(event:InputEvent)=>{draft.colors=draft.colors.map((value,position)=>position===index?(event.target as HTMLInputElement).value:value);this.requestUpdate();}}><span style=${`--swatch:${color}`}></span><small>${color}</small></label>`)}</div>`:html`${draft.type==="audio"?html`<div class="reference-choice"><span>${icon("audio")}</span><div><b>${this.i18n.t("audio.reference.private","Private audio reference")}</b><small>${this.i18n.t("audio.upload.rightsNotice","I also confirm this recording contains no sensitive information. Upload remains private; creative influence, accompaniment, and provider transfer each require separate approval.")}</small></div><label class="button primary">${this.i18n.t("artifact.audio.label","Audio")}<input type="file" accept="audio/*" @change=${this.#queueUpload}></label></div>`:nothing}${draft.type==="format"&&this.#formatDraftUsesImageFrame(draft)?html`<div class="block-draft-format"><label>${draft.outputKind==="storyboard"?"Storyboard frame":"Image frame"}<select @change=${(event:Event)=>{const preset=String((event.target as HTMLSelectElement).value);draft.imageFormat=imageFormatForPreset(preset);draft.text=this.#formatDraftText(draft,preset);this.requestUpdate();}}>${IMAGE_FORMAT_PRESETS.map((preset)=>html`<option value=${preset.id}>${preset.id} · ${this.i18n.system(preset.label)} · ${preset.dimensions.width} × ${preset.dimensions.height}</option>`)}</select></label><span>${draft.imageFormat.dimensions.width} × ${draft.imageFormat.dimensions.height} px</span></div>`:nothing}<label class="block-draft-copy">${selected?.label} content<textarea rows="3" placeholder=${selected?.prompt && this.i18n.system(selected.prompt)} .value=${draft.text} @input=${(event:InputEvent)=>{draft.text=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label>`}`}
      <footer><button type="button" class="button ghost" @click=${this.#closeBlock}>Cancel</button>${draft.type&&draft.type!=="reference"&&draft.type!=="model3d"?html`<button type="submit" class="button primary" ?disabled=${!draft.text.trim()}>Add ${selected?.label.toLowerCase()}</button>`:nothing}</footer></form></dialog>`;
  }
  async #ask() {
    const session=this.store.session.get(),draft=this.#prompt,prompt=draft.trim();if(!prompt||this.#asking||!(session?.provider.plannerConfigured??session?.provider.configured)||session.projectContext&&!session.projectContext.permissions.includes("project.output.request"))return;
    const projection=this.store.projection.get(),source=this.store.captureSourceOwnership();
    if(this.store.documentJobActive("chat",projection.documentId)){this.store.toast(this.i18n.t("chat.activeRequestUnsent"));return;}
    const route=this.store.route.get(),pane=this.#workbenchPane,focus=captureOutputNavigationFocus(this.ownerDocument);
    const sourceCurrent=()=>this.isConnected&&this.store.route.get()===route&&this.store.sourceOwnershipActive(source)
      &&this.store.projection.get().projectId===projection.projectId&&this.store.projection.get().documentId===projection.documentId;
    const presentationCurrent=()=>sourceCurrent()&&this.#prompt===draft&&this.#workbenchPane===pane&&!this.#blockDraft&&!this.#formatChoiceOpen
      &&!this.#artifactViewerOpen&&!this.#pendingUpload&&!this.ownerDocument.querySelector("dialog[open]")&&focus.current();
    this.#asking=true;this.requestUpdate();try{
      // The original queue admission is still useful after the requester
      // continues elsewhere. Its acknowledgement is not a new UI gesture.
      if(await this.store.chat(prompt,false)&&sourceCurrent()){
        const handoff=presentationCurrent();
        if(this.#prompt===draft)this.#prompt="";
        this.store.toast(`${this.i18n.t("activity.kind.chat")} · ${this.i18n.t("activity.inProgress")} · ${this.i18n.t("shell.navigation.activity")}`);
        // Chat responses hydrate only on the actor-private conversation view;
        // keep this uninterrupted handoff, without erasing a newer draft or
        // overriding a newer pane, dialog, route, authority or focus choice.
        if(handoff)this.store.setRoute(withDocumentInRoute("/studio/chat",projection.documentId,projection.documentTitle));
      }
    }finally{focus.dispose();this.#asking=false;this.requestUpdate();}
  }
  #quickEditScope(): WorkspaceQuickEditScope | null {
    const session=this.store.session.get(),authorization=this.store.captureAuthorizationScope(),projection=this.store.projection.get();
    if(!this.isConnected||!session||session.projectContext||!authorization||!this.store.routeDataReady()||!projection.projectId||!projection.documentId)return null;
    return{key:authorization.key,projectId:projection.projectId,documentId:projection.documentId};
  }
  #syncQuickEditReview(){
    const scope=this.#quickEditScope(),key=scope?JSON.stringify(scope):"";
    if(key===this.#proposalResumeKey)return;
    if(this.#proposalResumeKey)this.#prompt="";
    this.#proposalResumeKey=key;
    if(!this.#localProposal.value){this.#localProposal.reset();if(scope)void this.#localProposal.resume();}
  }
  get #proposal(){const state=this.#localProposal.value;return state&&(state.intent||state.applied||state.notice)?state:null;}
  async #suggestQuickAction(){
    if(this.#asking||this.store.session.get()?.projectContext)return false;
    const projection=this.store.projection.get(),focused=this.store.ui.focusBlockId;
    const target=workspaceQuickEditNeedsTarget(this.#prompt)?projection.blocks.find((block)=>block.id===focused&&block.type==="palette"&&!block.removed)?.id??null:null;
    return this.#localProposal.start(this.#prompt,target);
  }
  #editQuickEdit(prompt:string,targetBlockId:string|null){this.#prompt=prompt;this.#localProposal.edit(prompt,workspaceQuickEditNeedsTarget(prompt)?targetBlockId:null);}
  #proposalPreview(){
    const state=this.#proposal;if(!state)return nothing;
    const copy=workspaceLocalProposalCopy(this.i18n.locale),canAuthor=this.store.session.get()?.capabilities?.includes("project.author")??false;
    const palettes=this.store.projection.get().blocks.filter((block)=>block.type==="palette"&&!block.removed);
    const editable=!state.pending&&!state.uncertain&&!state.applied;
    const notice=state.notice==="target"?copy.targetNotice:copy[state.notice as keyof typeof copy]??"";
    const referenceSource=this.isConnected?this.store.captureSourceOwnership():null;
    const referenceRoute=this.isConnected?this.store.route.get():"";
    const referencePreviewId=state.previewId,referenceApprovalHash=state.approvalHash;
    const referenceDocumentId=documentIdFromRoute(referenceRoute);
    const referenceView=documentViewFromRoute(referenceRoute)==="document"
      || /^\/creative\/create(?:\/[^/]+)*$/u.test(routePathname(referenceRoute));
    // References are not inputs to the deterministic edit or its approval. A
    // later activation re-derives them; neither an excerpt nor a result list is cached.
    const currentReferences=()=>{
      const current=this.#proposal,preview=current?.preview,projection=this.store.projection.get();
      if(!this.isConnected||!referenceSource||!referenceView||!this.store.sourceOwnershipActive(referenceSource)
        ||referenceDocumentId!==null&&referenceDocumentId!==projection.documentId
        ||this.store.route.get()!==referenceRoute||!this.store.routeDataReady()
        ||!this.store.session.get()?.capabilities?.includes("project.read")||this.store.session.get()?.projectContext
        ||!current||current.pending||current.uncertain||current.applied||current.stale||!preview?.localReview
        ||current.previewId!==referencePreviewId||current.approvalHash!==referenceApprovalHash
        ||preview.previewId!==referencePreviewId||preview.approvalHash!==referenceApprovalHash
        ||preview.projectId!==projection.projectId||preview.documentId!==projection.documentId
        ||preview.localReview.sourceHead!==this.store.head.get()||!(Date.parse(preview.expiresAt)>Date.now()))return[];
      return retrieveFewShotExemplars(this.store.events.get(),preview.localReview.prompt,this.store.content.get(),{limit:3,projectId: this.store.projection.get().projectId})
        .filter(item=>item.citations.length>0&&item.citations.every(id=>this.store.events.get().some(event=>event.eventId===id)));
    };
    const references=currentReferences();
    const comparableReference=(value:string)=>value.normalize("NFKC").replace(/\p{Cf}/gu,"").replace(/\s+/gu," ").trim().toLowerCase();
    const referenceKind=(item:RetrievedExemplar)=>{
      const currentCopy=workspaceLocalProposalCopy(this.i18n.locale);
      return item.kind==="accepted-proposal"?currentCopy.referenceAccepted:item.kind==="authored-correction"?currentCopy.referenceCorrection:currentCopy.referenceKept;
    };
    const referenceName=(item:RetrievedExemplar,index:number,items:RetrievedExemplar[])=>{
      const name=referenceKind(item),unique=new Set(items.map(value=>comparableReference(referenceKind(value)))).size===items.length;
      return unique?name:this.i18n.t("context.controls.disambiguated","{ordinal} · {name}",{ordinal:this.i18n.number(index+1),name});
    };
    const inspectReference=(exemplarId:string,eventId:string)=>{
      const resolve=()=>{
        const items=currentReferences(),index=items.findIndex(item=>item.exemplarId===exemplarId&&item.citations.includes(eventId));
        return index<0?null:{item:items[index]!,label:referenceName(items[index]!,index,items)};
      };
      if(!resolve())return;
      this.#quickEditReferenceInspection={eventId,resolve};
      this.store.patchUi({selectedEventId:eventId,inspectorOpen:true});
    };
    return html`<div class="proposal-preview" aria-busy=${state.pending}><div>
      <span class="eyebrow">${copy.title}</span><small>${copy.free}</small>
      ${state.preview?.localReview?html`<bdi>${state.preview.localReview.documentTitle}</bdi>`:nothing}
      ${state.draft||editable?html`<label>${copy.draft}<textarea rows="3" maxlength="1200" .value=${state.draft} ?disabled=${!editable||!canAuthor}
        @input=${(event:InputEvent)=>this.#editQuickEdit((event.target as HTMLTextAreaElement).value,this.#proposal?.targetBlockId??null)}></textarea></label>`:nothing}
      ${workspaceQuickEditNeedsTarget(state.draft)?html`<label>${copy.target}<select .value=${state.targetBlockId??""} ?disabled=${!editable||!canAuthor}
        @change=${(event:Event)=>this.#editQuickEdit(this.#proposal?.draft??"",(event.target as HTMLSelectElement).value||null)}>
        <option value="">${copy.chooseTarget}</option>${palettes.map((block)=>html`<option value=${block.id}>${contextControlName(candidate=>`\u2068${String(candidate.properties.label??candidate.handle)}\u2069`,block,palettes,this.i18n)}</option>`)}
      </select></label>${!palettes.length?html`<small>${copy.noTarget}</small>`:nothing}`:nothing}
      ${state.preview?.changes.map((change)=>html`<p><bdi>${change.label}</bdi> · <bdi>${change.text}</bdi></p>`)}
      ${references.length?html`<details class="proposal-corpus"><summary>${copy.related}</summary><p>${copy.referenceOnly}</p>
        ${references.map((item,index)=>{const exemplarId=item.exemplarId,eventId=exemplarId.slice(exemplarId.indexOf(":")+1);
          const label=referenceName(item,index,references);
          return html`<article><p><bdi>${item.summary}</bdi></p><button type="button" class="button ghost compact" data-quick-edit-reference=${exemplarId}
            @click=${()=>inspectReference(exemplarId,eventId)}>${copy.inspectReference}: <bdi>${label}</bdi></button></article>`;
        })}
      </details>`:nothing}
      ${state.pending||notice?html`<p role="status">${state.pending?copy.pending:notice}</p>`:nothing}
      ${!state.applied&&!state.uncertain?html`<small>${copy.unchanged}</small>`:nothing}
    </div>
    ${state.uncertain?html`<button type="button" class="button secondary" ?disabled=${state.pending} @click=${()=>this.#localProposal.check()}>${copy.check}</button>`:html`
      <button type="button" class="button ghost" ?disabled=${state.pending} @click=${this.#rejectProposal}>${state.applied?copy.done:copy.decline}</button>
      ${!state.applied?state.stale?html`<button type="button" class="button primary" ?disabled=${state.pending||!canAuthor} @click=${()=>this.#localProposal.preview(true)}>${copy.fresh}</button>`:state.preview?html`<button type="button" class="button primary" ?disabled=${state.pending||!canAuthor} @click=${this.#acceptProposal}>${state.notice==="retryable"?copy.retryAccept:copy.accept}</button>`:html`<button type="button" class="button primary" ?disabled=${state.pending||!canAuthor||!state.draft.trim()||workspaceQuickEditNeedsTarget(state.draft)&&!state.targetBlockId} @click=${()=>this.#localProposal.preview()}>${copy.preview}</button>`:nothing}
    `}
    </div>`;
  }
  async #acceptProposal(){await this.#localProposal.accept();}
  async #rejectProposal(){await this.#localProposal.dismiss();}
  #openProjectSettings(){const projection=this.store.projection.get();this.#projectName=projection.projectName;this.#projectState=projection.projectState;this.#projectSettings=true;this.requestUpdate();}
  #closeProjectSettings(){this.querySelector<HTMLDialogElement>(".project-settings-dialog")?.close();this.#projectSettings=false;this.requestUpdate();}
  #openDeleteDocument(){if(this.store.projection.get().documents.length<=1){this.store.toast("Create another document before removing the project’s final document.");return;}this.#deleteDocument=true;this.requestUpdate();}
  #closeDeleteDocument(){this.querySelector<HTMLDialogElement>(".studio-document-delete-dialog")?.close();this.#deleteDocument=false;this.requestUpdate();}
  async #confirmDeleteDocument(){const appended=await this.store.removeDocument(this.store.projection.get().documentId);if(appended.length)this.#closeDeleteDocument();}
  async #saveProject(event:SubmitEvent){event.preventDefault();const projection=this.store.projection.get();const name=this.#projectName.trim();if(!name)return;const changes:EventInput[]=[];if(name!==projection.projectName)changes.push({type:"ProjectRenamed",payload:{project_id:projection.projectId,old_name:projection.projectName,new_name:name}});if(this.#projectState!==projection.projectState)changes.push({type:"ProjectStateChanged",payload:{project_id:projection.projectId,state:this.#projectState,previous_state:projection.projectState}});if(changes.length){const appended=await this.store.appendBatch(changes);if(!appended.length)return;}this.#closeProjectSettings();}
  #beginDocumentRename(title: string) {
    const store = this.store, { projectId, documentId } = store.projection.get(), route = store.route.get();
    const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
    const focus = captureOutputNavigationFocus(this.ownerDocument), revision = ++this.#documentNameRevision;
    this.#documentName = title;
    let retired = false;
    const current = () => !retired && this.isConnected && this.store === store && store.route.get() === route
      && store.projection.get().projectId === projectId && store.projection.get().documentId === documentId
      && store.sourceOwnershipActive(source) && Boolean(authorization && store.authorizationScopeActive(authorization))
      && this.#documentNameRevision === revision && this.#documentName === title;
    const unsubscribe = store.subscribe(() => { if (!current()) retired = true; });
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!current()) return;
      const field = this.querySelector<HTMLInputElement>(".document-title-editor input");
      // Preserve select-only behavior; this gesture does not manufacture focus.
      if (field && field.value === title) focus.run(field, () => { field.select(); return true; });
    }, () => undefined).finally(() => { unsubscribe(); focus.dispose(); });
  }
  async #renameDocument(event: SubmitEvent, documentId: string, currentTitle: string) {
    event.preventDefault();
    const raw = this.#documentName, title = raw?.trim(), revision = this.#documentNameRevision;
    if (!title) return;
    const store = this.store, projectId = store.projection.get().projectId, route = store.route.get();
    const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
    const current = (expectedRoute = route) => this.isConnected && this.store === store && store.route.get() === expectedRoute
      && store.sourceOwnershipActive(source) && store.authorizationScopeActive(authorization)
      && store.projection.get().projectId === projectId && store.projection.get().documentId === documentId;
    if (!current()) return;
    if (title === currentTitle) { this.#documentNameRevision++; this.#documentName = null; this.requestUpdate(); return; }
    const appended = await store.append({ type: "DocumentRenamed", payload: { document_id: documentId, old_title: currentTitle, new_title: title } });
    if (!appended.length || (!current() && !current(withDocumentInRoute(route, documentId, title)))) return;
    if (this.#documentNameRevision === revision && this.#documentName === raw) {
      this.#documentNameRevision++; this.#documentName = null; this.requestUpdate();
    } else if (this.#documentName !== null) {
      store.toast(this.i18n.t("guided.save.newerEditsKept", "The earlier submission was saved. Your newer edits are still here."));
    }
  }
  #compare() {
    this.#nextOpening=null; // A new explicit comparison owns its own existing pair.
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
    if(change.status==="added")return{title:this.i18n.system("{label} added",{label}),detail:text,scope:this.i18n.system("Applies to {scope}",{scope})};
    if(change.status==="removed")return{title:this.i18n.system("{label} removed",{label}),detail:text,scope:this.i18n.system("Previously applied to {scope}",{scope})};
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
    return{title:this.i18n.system("{label} updated",{label}),detail:actions.length?`${actions.join("; ")}.`:text,scope:this.i18n.system("Now applies to {scope}",{scope:afterScope})};
  }

  #comparison() {
    const events = this.store.events.get(); const ids = this.store.ui.comparisonOutputIds.split("|").filter(Boolean); const projection=this.store.projection.get();const all = projection.libraryOutputs.filter((output)=>output.documentId===projection.documentId&&!output.discarded&&output.provider!=="simulation"&&output.mediaUrl);
    const requested = [...new Set(ids)].map((id) => all.find((output) => output.id === id)).filter((output): output is NonNullable<typeof output> => Boolean(output)); const comparison=outputComparisonHistory(events,requested,{projectId:projection.projectId,documentId:projection.documentId});const outputs=comparison.outputs,diff=comparison.diff;
    if(outputs.length!==2)return html`<dialog class="modal workspace-modal" closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({compareOpen:false});}} aria-label=${this.i18n.t("next.exact.compare-images.label","Compare these images")} @cancel=${()=>this.store.patchUi({compareOpen:false})} @close=${()=>this.store.patchUi({compareOpen:false})}><div class="modal-card"><p role="status">${this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document.")}</p><button type="button" class="button secondary" @click=${()=>this.store.patchUi({compareOpen:false})}>${this.i18n.t("action.close","Close")}</button></div></dialog>`;
    return html`<dialog class="modal workspace-modal comparison-modal" tabindex="-1" closedby="any" aria-labelledby="compare-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.store.patchUi({compareOpen:false});}} @cancel=${(event:Event)=>{event.preventDefault();this.store.patchUi({compareOpen:false});}} @close=${()=>{if(this.store.ui.compareOpen)this.store.patchUi({compareOpen:false});}}><div class="modal-card wide comparison-card"><button class="icon-button modal-close" aria-label="Close comparison" @click=${() => this.store.patchUi({ compareOpen:false })}>${icon("close")}</button><span class="eyebrow">Side-by-side comparison</span><h2 id="compare-title">Compare two creative results</h2><p>${this.i18n.t("next.exact.comparison.caveat","This compares document history when each result was saved. It does not establish the submitted inputs or what caused the images to differ.")}</p><div class="comparison-grid">${outputs.map((o,i) => html`<div><div class="output-art"><forma-output-visual .output=${o} .interactive=${true}></forma-output-visual></div><b>${comparison.available&&!comparison.tied?this.i18n.system(i?"Current result":"Previous result"):this.i18n.t(i?"next.exact.comparison.second":"next.exact.comparison.first",i?"Result B":"Result A")}</b><small>${this.i18n.system(outputQualityLabel(o))} · ${o.width??1536} × ${o.height??1024}</small></div>`)}</div><section class="diff-list" aria-labelledby="comparison-changes-title"><header><div><span class="eyebrow">What changed</span><h3 id="comparison-changes-title">${this.i18n.t("next.exact.comparison.heading","Recorded document changes between these results")}</h3></div>${comparison.available?html`<strong>${diff.length} change${diff.length===1?"":"s"}</strong>`:nothing}</header>${!comparison.available?html`<p>${this.i18n.t("next.exact.comparison.unavailable","Historical comparison evidence is unavailable for one or both results. You can still inspect the saved images.")}</p>`:diff.length ? diff.map((change) => {const description=this.#comparisonChange(change);return html`<article class=${`diff-change ${change.status}`}><span class=${`status-dot ${change.status}`} aria-hidden="true"></span><div><b>${description.title}</b><p>${description.detail}</p><small>${description.scope}</small></div><em>${this.i18n.system(change.status)}</em></article>`;}) : html`<p>${this.i18n.t("next.exact.comparison.empty","No document changes were recorded between these receipts.")}</p>`}</section></div></dialog>`;
  }
  #inspector() {
    const selected=this.store.ui.selectedEventId,inspection=this.#quickEditReferenceInspection;
    const event=selected?this.store.events.get().find(e=>e.eventId===selected):this.store.events.get().at(-1);
    const reference=inspection?.eventId===selected?inspection.resolve():null;
    if(selected&&(!event||inspection?.eventId===selected&&!reference))return html`<aside class="inspector-panel" aria-label=${this.i18n.t("workspace.provenance.inspector","Creative history")}>
      <p role="status">${workspaceLocalProposalCopy(this.i18n.locale).referenceUnavailable}</p>
      <button type="button" class="button secondary" @click=${()=>{this.#quickEditReferenceInspection=null;this.store.patchUi({inspectorOpen:false,selectedEventId:""});}}>${this.i18n.t("workspace.provenance.close","Close creative history")}</button>
    </aside>`;
    if(!event)return nothing;
    const session=this.store.session.get(),engineering=session?.capabilities?.includes("engineering.events.read")===true;
    const author=this.i18n.t(provenanceActorMessage(event.actor,session?.impersonation?.actor.userId??session?.user?.userId));
    return html`<aside class="inspector-panel" aria-label=${this.i18n.t("workspace.provenance.inspector","Creative history")}><header><div><span class="eyebrow">${this.i18n.t("workspace.provenance.source","Saved creative history")}</span><h2>${reference?reference.label:shortEventType(event.type)}</h2></div><button class="icon-button" aria-label=${this.i18n.t("workspace.provenance.close","Close creative history")} @click=${() => this.store.patchUi({ inspectorOpen:false })}>${icon("close")}</button></header>${reference?html`<section class="provenance-reference-context"><h3>${workspaceLocalProposalCopy(this.i18n.locale).referenceContext}</h3><p dir="auto">${reference.item.summary}</p><small>${workspaceLocalProposalCopy(this.i18n.locale).referenceOnly}</small></section>`:html`<p>${this.i18n.t("workspace.provenance.description","This creative decision is saved to your private document and remains available for future results.")}</p>`}<dl><dt>${this.i18n.t("workspace.provenance.author","Recorded actor")}</dt><dd>${author}</dd><dt>${this.i18n.t("workspace.provenance.saved","Saved")}</dt><dd>${this.i18n.date(new Date(event.occurredAt),{dateStyle:"medium",timeStyle:"short"})}</dd><dt>${this.i18n.t("workspace.provenance.change","Creative change")}</dt><dd>${shortEventType(event.type)}</dd></dl>${engineering?html`<details class="provenance-technical"><summary>${this.i18n.t("workspace.provenance.technical","Technical details for engineering")}</summary><dl><dt>Sequence</dt><dd>#${event.sequence}</dd><dt>Actor</dt><dd>${event.actor}</dd><dt>Client</dt><dd>${event.clientId}</dd><dt>Correlation</dt><dd>${event.correlationId}</dd></dl><pre>${JSON.stringify(event.payload,null,2)}</pre><div class="inspector-actions"><button @click=${() => navigateInApp(this,navigation=>navigation.route("/engineering/events"))}>${this.i18n.t("workspace.provenance.engineering","Open Engineering Diagnostics")} ${icon("arrow")}</button><button @click=${() => navigator.clipboard.writeText(event.eventId)}>${this.i18n.t("workspace.provenance.copy","Copy technical event ID")}</button></div></details>`:nothing}</aside>`;
  }

  #lifecycleOpening=0;
  #contextWorkDepartures():CommandDeparture[] {
    return [...this.querySelectorAll("forma-context-block")]
      .filter(child=>child.isConnected&&FormaElement.hasStoreIdentity(child,this.store))
      .map(child=>child.captureCommandDeparture());
  }
  #nextActionBlocked(departure=false,context?:NavigationPresentationContext){
    if(this.#nextOpening||this.#blockDraft||this.#proposal||this.#formatChoiceOpen
      ||this.#artifactViewerOpen&&![...this.querySelectorAll("forma-document-artifacts")].some(viewer=>
        viewer.isConnected&&viewer.closest("forma-workspace")===this&&FormaElement.hasStoreIdentity(viewer,this.store)
        &&viewer.allowsNavigationPresentation(context))
      ||this.#documentName!==null||this.#pendingUpload||this.#uploading||this.#asking
      ||hasBlockingNavigationDialog(this.ownerDocument,context)
      ||this.ownerDocument.querySelector(".output-requirement-form,.output-plan-review"))return true;
    if(this.#contextWorkDepartures().some(child=>child.blocked()))return true;
    return [...this.querySelectorAll("forma-output-requirements")]
      .some(controller=>controller.isConnected&&FormaElement.hasStoreIdentity(controller,this.store)
        &&(departure?controller.commandDepartureBlocked:controller.navigationBlocked));
  }
  captureCommandDeparture():CommandDeparture {
    const pane=this.#workbenchPane,documentId=this.#inspectorDocumentId,contexts=this.#contextWorkDepartures();
    return {element:this,current:()=>{
      if(!this.isConnected||this.#workbenchPane!==pane||this.#inspectorDocumentId!==documentId)return false;
      const current=this.#contextWorkDepartures();
      return current.length===contexts.length&&contexts.every(child=>child.current()&&current.some(value=>value.element===child.element));
    },blocked:context=>Boolean(this.#prompt||this.#nextActionBlocked(true,context)),reason:()=>"next.lifecycle.currentWorkOpen"};
  }
  /** Rendered recommendations use the complete shared route adapter; local receivers below never recurse into it. */
  async #followLifecycleAction(action:CreativeNextAction){
    const projection=this.store.projection.get(),route=this.store.route.get(),pane=this.#workbenchPane;
    if(!this.isConnected||!this.store.routeDataReady()||action.target.documentId!==projection.documentId
      ||action.target.projectId!==projection.projectId)return false;
    if(this.#prompt||this.#nextActionBlocked()){
      this.store.toast(this.i18n.t("next.lifecycle.currentWorkOpen","Save or discard local edits, clear unsent text, or check the current request before continuing. Closing a panel may retain work; wait if the request is running."));
      return false;
    }
    const request=++this.#lifecycleOpening;
    const originCurrent=()=>this.isConnected&&request===this.#lifecycleOpening&&this.store.route.get()===route
      &&this.#workbenchPane===pane&&this.store.projection.get().projectId===action.target.projectId
      &&this.store.projection.get().documentId===action.target.documentId&&!this.#prompt&&!this.#nextActionBlocked();
    let opened=false,navigationRefusal="";
    try{opened=await openCreativeNextActionDestination(this.store,this.ownerDocument,action,{
      origin:this,originCurrent,navigationCurrent:()=>request===this.#lifecycleOpening,
      onRefusal:reason=>{navigationRefusal=reason;},
    });}catch{ /* Unavailable is not a completed handoff. */ }
    if(!opened&&navigationRefusal!=="current-work"&&originCurrent())this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
    return opened;
  }

  #nextFacts(target?:CreativeNextTarget|null){
    return nextActionFacts(this.store,this.store.projection.get().documentId,null,
      target?.sourceGeneration===undefined?{}:{lifecycle:true});
  }
  /** Existing preparation entry, with caller ownership retained through its native opening. */
  async openOutputPreparation(target:Extract<CreativeNextTarget,{kind:"configure"}>,
    options:{current:(stage:CreativePreparationStage)=>boolean;focus?:OutputNavigationFocusLease}):Promise<boolean>{
    return this.openCreativeNextAction({id:"configure-output",label:"",reason:"",title:"",priority:0,evidence:0,target},options);
  }
  /** Same existing local executor. Cross-surface routing remains the stateless opening helper's job. */
  async openCreativeNextAction(action:CreativeNextAction,
    options:{current:(stage:CreativePreparationStage)=>boolean;focus?:OutputNavigationFocusLease}):Promise<boolean>{
    if(this.#prompt)return false;
    return this.#openOwnedNextAction(action,options);
  }
  /** Context's explicit command may coexist with Ask text; all other admission checks stay shared. */
  async #openOwnedNextAction(action:CreativeNextAction,
    options:{current:(stage:CreativePreparationStage)=>boolean;focus?:OutputNavigationFocusLease}):Promise<boolean>{
    if(!this.isConnected||!options.current("opening")||this.#nextActionBlocked())return false;
    let block:BlockDraft|null=null;
    const pair=action.target.kind==="compare"?action.target.outputIds.join("|"):"";
    const opening={current:options.current,ready:false,retire:()=>{
      if(block&&this.#blockDraft===block){this.#blockDraft=null;this.querySelector<HTMLDialogElement>(".block-composer-dialog")?.close();}
      if(this.#formatTarget===action.target)void this.#closeFormatChoice(false);
      if(this.#nextOutputTarget===action.target){this.#nextOutputTarget=null;this.requestUpdate();}
      if(pair&&this.store.ui.compareOpen&&this.store.ui.comparisonOutputIds===pair){
        this.store.patchUi({compareOpen:false});this.querySelector<HTMLDialogElement>(".comparison-modal")?.close();
      }
      this.requestUpdate();
    }};
    this.#nextOpening=opening;
    const required=(stage:CreativePreparationStage)=>this.#nextOpening===opening
      ?options.current(opening.ready?"editing":stage):opening.ready&&options.current("editing");
    try{
      const pending=this.#followNextAction(action,{...options,current:required,contextOpened:()=>{block=this.#blockDraft;}});
      const followed=await pending;
      if(!followed||!options.current("editing"))return false;
      opening.ready=true;return true;
    }finally{
      if(this.#nextOpening===opening){this.#nextOpening=null;if(!opening.ready)opening.retire();}
    }
  }
  async #followNextAction(action:CreativeNextAction,options?:{current:(stage:CreativePreparationStage)=>boolean;focus?:OutputNavigationFocusLease;contextOpened?:()=>void}){
    const current=(stage:CreativePreparationStage="opening")=>(!options||options.current(stage))
      &&(action.target.kind==="configure"?creativePreparationTargetAvailable(action.target,this.#nextFacts(action.target),stage)
        :stage==="editing"||creativeNextTargetAvailable(action.target,this.#nextFacts(action.target)));
    try{
      if(!current())return false;
      const followed=await followCreativeNextTarget(action.target,()=>this.#nextFacts(action.target),{
        context:async()=>{this.openContextComposer();options?.contextOpened?.();if(!options)return;
          await this.updateComplete;return current("editing")&&Boolean(this.querySelector<HTMLDialogElement>(".block-composer-dialog")?.open);},
        configure:(target)=>this.#prepareFormat(target,options?.current,options?.focus),
        output:(target)=>this.#openNextOutput(target,options?.current),
        artifact:(target)=>this.querySelector("forma-document-artifacts")!.openArtifactById(target.artifactId,{
          expectedRevision:target.revision,...(options?{current:(stage:CreativePreparationStage)=>current(stage)}:{})}),
        "artifact-delivery":(target)=>{
          const artifact=this.store.projection.get().libraryArtifacts.find(value=>value.id===target.artifactId&&value.documentId===target.documentId);
          if(!artifact)return false;const delivery=artifactDeliveryFor(this.store,artifact);
          if(artifactDeliveryFactsProof(delivery)!==target.proof||delivery.revision!==target.revision||delivery.intent!==target.intent)return false;
          const host=this.querySelector("forma-document-artifacts");return host?host.openArtifactById(target.artifactId,{
            expectedRevision:target.revision,...(delivery.contentSha256?{expectedContentSha256:delivery.contentSha256}:{}),
            intent:target.intent,...(options?{current:(stage:CreativePreparationStage)=>current(stage)}:{})}):false;
        },
        job:async(target)=>{const host=this.querySelector("forma-document-artifacts");if(!host)return false;
          if(!options)return host.openJobById(target.jobId);
          let opened=false;const result=await host.openJobById(target.jobId,{current:()=>current(opened?"editing":"opening")});
          opened=result===true;return opened;},
        compare:async(target)=>{this.store.patchUi({compareOpen:true,comparisonOutputIds:target.outputIds.join("|")});if(!options)return;
          await this.updateComplete;return current("editing")&&this.store.ui.comparisonOutputIds===target.outputIds.join("|")
            &&Boolean(this.querySelector<HTMLDialogElement>(".comparison-modal")?.open);},
      });
      if(!followed&&(!options||options.current("editing")))this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
      return followed;
    }catch{
      if(!options||options.current("editing"))this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
      return false;
    }
  }
  async #openNextOutput(target:Extract<CreativeNextTarget,{kind:"output"}>,required?:(stage:CreativePreparationStage)=>boolean){
    const current=()=>!required||required("opening");
    if(!current()||!creativeNextTargetAvailable(target,this.#nextFacts(target)))return false;
    this.#nextOutputTarget=target;this.requestUpdate();await this.updateComplete;
    if(!current()||!creativeNextTargetAvailable(target,this.#nextFacts(target)))return false;
    const viewer=this.querySelector<OutputVisual>(".next-output-viewer");
    if(!viewer||viewer.output?.id!==target.outputId)return false;
    await viewer.updateComplete;
    const exact=()=>creativeNextTargetAvailable(target,this.#nextFacts(target))&&viewer===this.querySelector(".next-output-viewer")&&viewer.output?.id===target.outputId;
    if(!current()||!exact())return false;
    if(!required){viewer.openImageViewer();return true;}
    if(!viewer.openImageViewer(undefined,{current:()=>current()&&exact()}))return false;
    await viewer.updateComplete;
    return required("editing")&&exact()&&Boolean(viewer.querySelector<HTMLDialogElement>(`[aria-labelledby="generated-image-title-${target.outputId}"]`)?.open);
  }
  async #prepareFormat(target:Extract<CreativeNextTarget,{kind:"configure"}>,required?:(stage:CreativePreparationStage)=>boolean,focus?:OutputNavigationFocusLease){
    const current=(stage:CreativePreparationStage)=>(!required||required(stage))&&creativePreparationTargetAvailable(target,this.#nextFacts(target),stage);
    if(!current("opening"))return false;
    if(!target.medium){
      this.#formatTarget=target;this.#formatRequired=required??null;this.#formatReturnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
      this.#formatChoiceOpen=true;this.requestUpdate();
      if(!required)return true;
      await this.updateComplete;return current("editing")&&Boolean(this.querySelector<HTMLDialogElement>(".next-format-dialog")?.open);
    }
    await this.#closeFormatChoice(false);if(!current("opening"))return false;
    this.#selectWorkbenchPane("result");await this.updateComplete;if(!current("opening"))return false;
    const pane=this.querySelector<HTMLElement>('[data-workbench-pane="result"]');
    if(focus){if(!pane||!focus.run(pane,()=>{if(!current("opening"))return false;pane.focus({preventScroll:true});return current("opening");}))return false;}
    else pane?.focus({preventScroll:true});
    if(target.medium==="image"){const host=this.querySelector("forma-generation-actions");return host?await host.openConfiguration(current):false;}
    const host=this.querySelector("forma-document-artifacts");return host?await host.openRender(target.medium,target.documentId,{current}):false;
  }
  async #chooseFormat(medium:CreativeMedium){
    const original=this.#formatTarget,required=this.#formatRequired;
    const target=creativePreparationChoice(original,medium,this.#nextFacts(original));
    if(required&&!required("opening")){await this.#closeFormatChoice(false);return;}
    const focus=required?captureOutputNavigationFocus(this.ownerDocument,{ownedRouteFocus:element=>{
      const dialog=element.closest("dialog");
      return Boolean(target&&required("editing")&&this.contains(element)
        &&(this.#workbenchPane==="result"&&element===this.querySelector<HTMLElement>('[data-workbench-pane="result"]')
          ||dialog&&dialog.matches(target.medium==="image"?".generation-details-dialog":".document-artifact-create")));
    }}):null;
    try{
      const current=required?(stage:CreativePreparationStage)=>required(stage)&&(stage==="editing"||Boolean(focus?.current())):undefined;
      if(!target||!await this.#prepareFormat(target,current,focus??undefined)){
        if(this.#formatTarget&&this.#formatTarget!==original)return;
        await this.#closeFormatChoice();this.store.toast(this.i18n.t("next.exact.unavailable","This exact action changed or is no longer available. Review the current document."));
      }
    }finally{focus?.dispose();}
  }
  async #closeFormatChoice(restoreFocus=true){
    if(!this.#formatChoiceOpen&&!this.#formatTarget)return;
    const opener=this.#formatReturnFocus,required=this.#formatRequired;
    const focus=restoreFocus&&required?captureOutputNavigationFocus(this.ownerDocument):null;
    this.#formatReturnFocus=null;this.#formatTarget=null;this.#formatRequired=null;this.#formatChoiceOpen=false;
    this.querySelector<HTMLDialogElement>(".next-format-dialog")?.close();this.requestUpdate();await this.updateComplete;
    try{if(restoreFocus&&(!required||required("editing"))){
      const fallback=this.querySelector<HTMLElement>(`[data-workbench-pane="${this.#workbenchPane}"]`),target=opener?.isConnected&&opener.getClientRects().length?opener:fallback;
      if(target){if(focus)focus.run(target,()=>{target.focus({preventScroll:true});return true;});else target.focus({preventScroll:true});}
    }}finally{focus?.dispose();}
  }
  #formatChoiceDialog(){return this.#formatChoiceOpen?html`<dialog class="modal workspace-modal next-format-dialog" aria-labelledby="next-format-title" closedby="any" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)void this.#closeFormatChoice();}} @cancel=${(event:Event)=>{event.preventDefault();void this.#closeFormatChoice();}} @close=${()=>void this.#closeFormatChoice()}><div class="modal-card"><h2 id="next-format-title">${this.i18n.t("next.exact.formats","Choose the next output")}</h2><p>${this.i18n.t("next.exact.configure-output.reason","Choose and review this document’s output settings. Nothing is generated yet.")}</p><div class="exact-next-actions">${(["image",...DOCUMENT_ARTIFACT_KINDS] as const).map((kind)=>html`<forma-ui-choice-card .compact=${true} .label=${kind==="image"?this.i18n.t("artifact.image.label","Image"):this.i18n.system(documentArtifactDefinition(kind).label)} .value=${kind} icon-name="arrow" @forma-action=${()=>void this.#chooseFormat(kind)}></forma-ui-choice-card>`)}</div><button type="button" class="button secondary" @click=${()=>void this.#closeFormatChoice()}>${this.i18n.t("action.close","Close")}</button></div></dialog>`:nothing;}

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

  #contextBlocks(blocks: readonly CreativeBlock[]) {
    return keyed(this.store.captureAuthorizationScope()?.key, html`${repeat(blocks, (block) => `${block.projectId}:${block.documentId}:${block.id}`, (block) => html`<forma-context-block .block=${block}></forma-context-block>`)}`);
  }

  override render() {
    const p = this.store.projection.get();const history=generationHistoryItems(p.outputs);const selectedItem=history.find((item)=>(item.kind==="fan"?`fan:${item.id}`:item.id)===this.store.ui.selectedOutputId)??history[0];const output=selectedItem?.kind==="output"?selectedItem.output:undefined;const previewProgress=this.store.documentPreviewProgress(p.documentId);const canCompare=history.filter((item)=>item.kind==="output").length>=2;const contextGroups=new Set(p.blocks.map((block)=>blockTypeDefinition(block.type)?.group).filter(Boolean));const facts=p.blocks.map((block)=>({block_id:block.id,type:block.type,role:block.type,handle:block.handle,active:Number(block.properties.weight??.5)>0,properties:block.properties}));const relationships=p.blockRelations.map((relation)=>({relation_id:relation.id,from_block_id:relation.fromBlockId,to_block_id:relation.toBlockId,kind:relation.kind,properties:relation.properties}));const combinedGroups=combinedContextGroups({facts,relationships});const nestedBlockIds=new Set(p.blockRelations.filter((relation)=>isContextCompositionRelation(relation.kind)).map((relation)=>relation.toBlockId));const rootBlocks=p.blocks.filter((block)=>!nestedBlockIds.has(block.id));const visibleBlocks=rootBlocks.length?rootBlocks:p.blocks;const documentInsight=contextGroups.size>=4?this.i18n.t("workspace.insight.complete","{count} independently editable decisions are working together. Each can still be refined or reused on its own.",{count:this.i18n.number(p.blocks.length)}):this.i18n.t("workspace.insight.partial","This document currently covers {covered} of {total} creative areas. Add another perspective only when it helps the work.",{covered:this.i18n.number(contextGroups.size),total:this.i18n.number(5)});const nextFacts=this.store.routeDataReady()?nextActionFacts(this.store,p.documentId,null,{lifecycle:true}):null;const nextActions=nextFacts?creativeNextActions(nextFacts):[];
    const actionStore = this.store, actionSource = actionStore.captureSourceOwnership(), actionRoute = actionStore.route.get();
    const projectContext=this.store.session.get()?.projectContext;
    const canAuthor=!projectContext||projectContext.permissions.includes("project.author");
    const canGenerate=!projectContext||projectContext.permissions.includes("project.output.request");
    const chatActive=this.store.documentJobActive("chat",p.documentId),chatWaiting=chatActive&&!this.#asking;
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
    const artifactGallery=html`<forma-document-artifacts compact source="document" .documentId=${p.documentId} @document-artifact-open=${()=>{if(this.#workbenchPane==="write")this.#selectWorkbenchPane("result");}} @document-artifact-viewer-open=${()=>this.#setArtifactViewerOpen(true)} @document-artifact-close=${()=>this.#setArtifactViewerOpen(false)}></forma-document-artifacts>`;
    const visualResult=previewProgress?html`<div class="output-card primary streaming-output-card" data-forma-content="primary"><div class="output-art"><div class="streaming-preview"><img class="streaming-preview-image" src=${previewProgress.mediaUrl} width=${previewProgress.width} height=${previewProgress.height} alt="Early image preview still being refined"><span>Early preview · finalizing</span></div></div><div class="output-info"><div><span class="output-quality draft">Draft arriving</span><b>The plan is becoming visible</b><small>The finished draft will appear here automatically.</small></div></div></div>`:selectedItem?.kind==="fan"?html`<article class="output-card primary prompt-fan-output-card" data-forma-content="primary"><forma-prompt-fan-visual .outputs=${selectedItem.outputs}></forma-prompt-fan-visual><div class="output-info"><div><span class=${`output-quality ${selectedItem.purpose==="ideate"?"draft":"full"}`}>${selectedItem.purpose==="ideate"?this.i18n.system("Draft fan"):this.i18n.system("Full-quality fan")}</span><b>One generation · four prompt processes</b><small>${selectedItem.complete} of 4 ready · ${selectedItem.standaloneCount} promoted to stand alone</small></div></div><forma-prompt-fan-review .fanId=${selectedItem.id}></forma-prompt-fan-review></article>`:output ? html`<forma-output-card data-forma-content="primary" .output=${output} .primary=${true}></forma-output-card>` : p.artifacts.length ? nothing : html`<div class="empty-output" data-forma-empty-state><span>${icon("image")}</span><h3>${p.blocks.length ? this.i18n.system("Context is ready") : this.i18n.system("A genuinely blank canvas")}</h3><p>${p.blocks.length ? this.i18n.system("Your creative decisions are ready to become an image or another finished result.") : this.i18n.system("Nothing has been added yet. Start only when you are ready.")}</p></div>`;
    return html`${this.#formatChoiceDialog()}${this.#nextOutputTarget&&creativeNextTargetAvailable(this.#nextOutputTarget,this.#nextFacts(this.#nextOutputTarget))?html`<forma-output-visual class="next-output-viewer" .viewerOnly=${true} .output=${p.libraryOutputs.find((candidate)=>candidate.id===this.#nextOutputTarget?.outputId)}></forma-output-visual>`:nothing}<section class="workspace-page" data-workbench="document">
      <forma-project-rail surface="studio" destination="/" @edit-project=${()=>this.#openProjectSettings()}></forma-project-rail>
      <div class="studio-main">
        <div class="studio-header-stack">
          <div class="document-bar page-header page-header--document"><div class="page-header-copy"><span class="eyebrow">${p.projectName} / Document</span>${this.#documentName===null||!canAuthor?html`<div class="document-title-row"><h1>${p.documentTitle}</h1>${canAuthor?html`<button class="icon-button" aria-label=${this.i18n.system("Rename {documentTitle}", { documentTitle: p.documentTitle })} title="Rename document" @click=${()=>this.#beginDocumentRename(p.documentTitle)}>${icon("edit")}</button>`:nothing}</div>`:html`<form class="document-title-editor" @submit=${(event:SubmitEvent)=>this.#renameDocument(event,p.documentId,p.documentTitle)}><label class="sr-only" for="document-title-input">Document name</label><input id="document-title-input" maxlength="80" .value=${this.#documentName} @input=${(event:InputEvent)=>{this.#documentName=(event.target as HTMLInputElement).value;this.#documentNameRevision++;this.requestUpdate();}}><button type="button" class="button ghost compact" @click=${()=>{this.#documentNameRevision++;this.#documentName=null;this.requestUpdate();}}>Cancel</button><button type="submit" class="button primary compact" ?disabled=${!this.#documentName.trim()}>Save name</button></form>`}</div><div class="document-actions page-header-actions" @focusin=${(event: FocusEvent) => this.#revealDocumentActionFocus(event, () => this.store === actionStore && actionStore.sourceOwnershipActive(actionSource) && actionStore.route.get() === actionRoute && actionStore.projection.get().projectId === p.projectId && actionStore.projection.get().documentId === p.documentId)}>${canAuthor?html`<button class="icon-button labeled" ?disabled=${!this.store.canUndo()} title=${this.store.canUndo()?this.i18n.system("Undo the latest reversible authored change"):this.i18n.system("No reversible authored change")} @click=${() => this.store.undo()}>${icon("undo")}<span>Undo</span></button><button class="icon-button labeled" ?disabled=${!this.store.canRedo()} title=${this.store.canRedo()?this.i18n.system("Redo the last undone change"):this.i18n.system("Nothing has been undone in this session")} @click=${() => this.store.redo()}>${icon("redo")}<span>Redo</span></button>`:nothing}<button class="button secondary compact" ?disabled=${!canCompare} title=${canCompare?this.i18n.system("Compare the two latest outputs"):this.i18n.system("Generate one more output to compare")} @click=${this.#compare}>${icon("compare")} Compare</button>${canAuthor?html`<button class="icon-button labeled danger-quiet" ?disabled=${p.documents.length<=1} title=${p.documents.length<=1?this.i18n.system("Create another document before removing the final document"):this.i18n.system("Remove this document")} @click=${this.#openDeleteDocument}>${icon("trash")}<span>Remove</span></button>`:nothing}</div></div>
          <forma-studio-mode-nav active="document"></forma-studio-mode-nav>
        </div>
        <div class="document-workbench-tasks" data-has-reviews=${String(documentReviews.length>0)} role="group" aria-label=${this.i18n.t("workbench.inspector","Document overview")} @keydown=${this.#navigateWorkbenchPanes} @focusin=${(event: FocusEvent) => this.#revealDocumentActionFocus(event, () => this.store === actionStore && actionStore.sourceOwnershipActive(actionSource) && actionStore.route.get() === actionRoute && actionStore.projection.get().projectId === p.projectId && actionStore.projection.get().documentId === p.documentId, "panes")}>
          ${(["write","result","review"] as const).map((pane)=>{const attention=pane==="review"?documentReviews.length:pane==="result"?failedTasks.length:0;return html`<button type="button" class="button ghost compact" data-workbench-pane=${pane} aria-pressed=${String(this.#workbenchPane===pane)} aria-controls=${pane==="write"?"document-context-panel":"document-results-panel"} @click=${()=>this.#selectWorkbenchPane(pane)}>${pane==="write"?this.i18n.t("studio.family.write","Write"):pane==="result"?this.i18n.t("workbench.creativeResults","Creative results"):this.i18n.t("activity.review","Review")}${attention?html`<span class="document-workbench-task-count" aria-label=${this.i18n.number(attention)}>${this.i18n.number(attention)}</span>`:nothing}</button>`;})}
        </div>
        <div class="studio-grid" data-inspector-open=${String(this.#workbenchInspectorOpen)} data-workbench-mode=${this.#workbenchPane}>
          <section id="document-context-panel" class="context-column" aria-labelledby="context-title" ?hidden=${this.#narrowWorkbench&&this.#workbenchPane!=="write"}><div class="section-heading"><div><span class="eyebrow">${p.blocks.length?p.blocks.length===1?this.i18n.system("1 creative decision"):`${this.i18n.number(p.blocks.length)} ${this.i18n.system("creative decisions")}`:this.i18n.system("Ready when you are")}</span><h2 id="context-title">Creative context</h2></div><span class="health-pill" title=${health.issues.length?health.issues.map((issue)=>this.#healthIssueCopy(issue,"label")).join(" · "):this.i18n.system("Objective, audience, delivery, rights, and evidence are complete")}><i></i> ${this.i18n.number(health.score)}/100</span></div>
            ${this.#proposal?html`<aside class="document-quick-edit-review" tabindex="-1" aria-live="polite" aria-label=${this.i18n.t("assistant.mode.quickEdit")}>${this.#proposalPreview()}</aside>`:nothing}
            ${blockingIssue?html`<aside class="document-workbench-critical" role="status"><span>${this.#healthIssueCopy(blockingIssue,"label")}</span>${canAuthor?html`<button type="button" class="button secondary compact" @click=${()=>this.#repairContext(blockingIssue)}>${this.i18n.t("context.health.severity.warning","Review")}</button>`:nothing}</aside>`:nothing}
            ${p.blocks.length ? html`<div class="block-list" data-forma-content="primary">${this.#contextBlocks(visibleBlocks)}</div>` : html`<div class="blank-context" data-forma-empty-state><span>${icon("plus")}</span><h3>This document is empty</h3><p>${canAuthor?this.i18n.system("Add a typed context block, upload a reference, or ask Forma only when you are ready. Nothing is created on your behalf."):this.i18n.system("There are no creative decisions in this shared document yet.")}</p>${canAuthor?html`<button class="button primary" @click=${this.#beginBlock}>Add context</button>`:nothing}</div>`}
            <forma-output-requirements .documentId=${p.documentId}></forma-output-requirements>
            ${notifications.length?html`<aside class="context-next-actions project-followup-actions" aria-label=${this.i18n.t("notifications.actions","Automatic project follow-up")}>${notifications.map((notification)=>html`<button type="button" @click=${()=>{void this.store.acknowledgeProjectNotification(notification.id);if(notification.artifactId){const artifact=this.querySelector("forma-document-artifacts") as HTMLElement&{openArtifactById?:(id:string)=>Promise<unknown>};void artifact?.openArtifactById?.(notification.artifactId);}}}><span><b>${this.i18n.t(`notifications.${notification.kind}.label`,this.i18n.system(notification.kind.replaceAll("_"," ")))}</b><small>${notification.kind==="changes_requested"&&notification.message?notification.message:this.i18n.t(`notifications.${notification.kind}.detail`,this.i18n.system(notification.message))}</small></span>${icon("arrow")}</button>`)}</aside>`:nothing}
            ${p.blocks.length&&health.issues.length?html`<aside class="context-next-actions context-health-actions" aria-label=${this.i18n.t("context.health.actions","Actionable context health")}>${health.issues.slice(0,3).map((issue)=>html`<button type="button" ?disabled=${!canAuthor} @click=${()=>this.#repairContext(issue)}><span><b>${this.i18n.t(`context.health.severity.${issue.severity}`,issue.severity)} · ${this.#healthIssueCopy(issue,"label")}</b><small>${this.#healthIssueCopy(issue,"detail")}</small></span>${icon("arrow")}</button>`)}</aside>`:nothing}
            ${renderLifecycleNextActionCards(nextActions,this.i18n,(action)=>void this.#followLifecycleAction(action),{projectName:p.projectName,documentTitle:p.documentTitle,scopeUnknown:nextFacts?.lifecycle?.output.scopeKnown!==true})}
            ${combinedGroups.length?html`<details class="document-combined-contexts"><summary><span>${icon("branch")} <b>${combinedGroups.length} Combined Context${combinedGroups.length===1?"":"s"}</b></span><small>Review how decisions travel together</small></summary><div>${combinedGroups.map((group)=>html`<article><header><span><b>${group.name}</b><small>${group.role.replaceAll("_"," ")} · ${group.application.replaceAll("_"," ")}</small></span><strong>${Math.round(group.relativity*100)}%</strong></header><p>Applies only to <b>${group.target}</b></p><small>${group.members.length} ordered decision${group.members.length===1?"":"s"}: ${group.members.map((member)=>member.label).join(" · ")}</small></article>`)}</div></details>`:nothing}
            ${canAuthor?this.#blockComposer():nothing}
            ${canAuthor&&p.blocks.length?html`<button class="add-block" @click=${this.#beginBlock}>${icon("plus")} Add context</button>`:nothing}
            ${canAuthor&&referenceCompositionSources(p.blocks,this.store.events.get()).length>0?html`<button class="button secondary compact reference-composition-open" @click=${this.#openReferenceComposition}>${icon("layers")} ${this.i18n.t("model3d.composition.open","Compose reference scene")}</button>`:nothing}
            ${p.blocks.length?html`<div class="document-insight"><span>${icon("branch")}</span><p>${documentInsight}</p>${canAuthor?html`<button @click=${()=>navigateInApp(this,navigation=>navigation.route("/studio/board"))}>See spatially ${icon("arrow")}</button>`:nothing}</div>`:nothing}
            <details class="context-provenance"><summary>How these decisions are preserved</summary><div class="compile-bridge"><span>${icon("branch")}</span><div><b>Traceable creative history</b><small>${p.latestCompile ? this.i18n.system("The latest result retains its exact creative inputs") : this.i18n.system("Every decision will remain available with its next result")}</small></div><button @click=${() => {this.#quickEditReferenceInspection=null;this.store.patchUi({ inspectorOpen:true,selectedEventId:"" });}}>Inspect</button></div></details>
          </section>
          <section id="document-results-panel" class="output-column" aria-labelledby="output-title" ?hidden=${this.#narrowWorkbench&&this.#workbenchPane==="write"&&!this.#artifactViewerOpen}><div class="section-heading"><div><span class="eyebrow">${this.store.session.get()?.provider.configured ? `${this.i18n.system("Images, stories, presentations & motion")} · ${this.i18n.t("artifact.audio.label", "Audio")}` : this.store.session.get()?.provider.model3dConfigured ? this.i18n.t("model3d.label","3D model") : this.store.session.get()?.provider.plannerConfigured ? this.i18n.t("assistant.previewUnavailable") : this.i18n.system("Connect a provider to begin")}</span><h2 id="output-title">Your results</h2></div><div class="output-heading-actions"><button class="text-button" ?disabled=${!canCompare} title=${canCompare?this.i18n.system("Compare output history"):this.i18n.system("Generate one more output to compare")} @click=${this.#compare}>Compare history</button><button type="button" class="button secondary compact document-inspector-toggle" aria-controls="document-workbench-inspector" aria-expanded=${this.#workbenchInspectorOpen} @click=${()=>this.#toggleWorkbenchInspector()}>${this.i18n.t(this.#workbenchInspectorOpen?"workbench.hideInspector":"workbench.showInspector",this.#workbenchInspectorOpen?"Hide overview":"Show overview")}</button></div></div>
            ${canAuthor&&canGenerate?html`<section class="document-result-generation" aria-label=${this.i18n.system("Generation choices")}><forma-generation-actions source="document" .selected=${output??null} compact></forma-generation-actions></section>`:nothing}
            ${this.#workbenchPane==="review"?html`<section class="document-workbench-review" aria-label=${this.i18n.t("workbench.reviewQueue","Review queue")}>${documentReviews.length?documentReviews.map((review)=>html`<article data-forma-content="primary"><b dir="auto">${review.artifactTitle}</b><button type="button" class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>navigation.openAssignedReview(review))}>${this.i18n.t("activity.openReview","Open assigned review")}</button></article>`):html`<p data-forma-empty-state>${this.i18n.t("workbench.noTasks","No active tasks")}</p>`}</section>`:nothing}
            ${artifactFirst?nothing:visualResult}
            ${artifactGallery}
            ${artifactFirst?visualResult:nothing}
            ${history.length > 1 ? html`<div class="output-filmstrip" aria-label="Previous generations">${history.slice(1,5).map((item:GenerationHistoryItem)=>{const id=item.kind==="fan"?`fan:${item.id}`:item.id;return html`<button class="mini-output ${this.store.ui.selectedOutputId===id?"selected":""}" aria-label=${item.kind==="fan"?this.i18n.system("Select fan generation"):this.i18n.system("Select {id}", { id: item.id })} aria-pressed=${this.store.ui.selectedOutputId===id} @click=${() => { this.store.patchUi({ selectedOutputId:id }); if (!projectContext&&item.kind==="output"&&this.store.ui.instrumentation) void this.store.hot({type:"ObjectViewed",payload:{object_id:item.id}}); }}>${item.kind==="fan"?html`<forma-prompt-fan-visual .outputs=${item.outputs} .compact=${true}></forma-prompt-fan-visual>`:html`<forma-output-visual .output=${item.output} .compact=${true}></forma-output-visual>`}</button>`;})}</div>` : nothing}
            ${canAuthor?html`<form class="reference-picker-form" @submit=${(event:SubmitEvent)=>event.preventDefault()}><label class="dropzone" @dragover=${(event:DragEvent)=>event.preventDefault()} @drop=${(event:DragEvent)=>{event.preventDefault();const file=event.dataTransfer?.files[0];if(file)this.#queueUpload(file);}}><input type="file" accept="image/*,audio/*,.glb,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx" @change=${this.#queueUpload}><span>${icon("plus")}</span><b>${this.#uploading ? this.i18n.system("Uploading…") : this.i18n.t("model3d.upload.any","Choose an image, 3D model, audio recording, or source document")}</b><small>${this.i18n.t("audio.reference.private","Private audio reference")} · ${this.i18n.system("Private, rights-confirmed evidence with a verifiable content hash.")}</small></label></form>`:nothing}
          </section>
          <aside id="document-workbench-inspector" class="document-workbench-inspector" ?hidden=${!this.#workbenchInspectorOpen} aria-labelledby="document-workbench-inspector-heading" @keydown=${(event:KeyboardEvent)=>{if(this.#compactInspector&&event.key==="Escape"){event.preventDefault();this.#toggleWorkbenchInspector(false);}}}><header>${this.#compactInspector?html`<button type="button" class="icon-button document-inspector-close" aria-label=${this.i18n.t("workbench.hideInspector","Hide overview")} @click=${()=>this.#toggleWorkbenchInspector(false)}>${icon("close")}</button>`:nothing}<span class="eyebrow">${p.projectName}</span><h2 id="document-workbench-inspector-heading">${this.i18n.t("workbench.inspector","Document overview")}</h2><p dir="auto">${p.documentTitle}</p></header><section><h3>${this.i18n.t("workbench.contextHealth","Context health")}</h3><strong>${this.i18n.number(health.score)}/100</strong><small>${this.i18n.number(p.blocks.length)} ${this.i18n.system("creative decisions")}</small>${health.issues.length?html`<ul>${health.issues.slice(0,3).map((issue)=>html`<li>${this.#healthIssueCopy(issue,"label")}</li>`)}</ul>`:nothing}</section><section><h3>${this.i18n.t("workbench.activeTasks","Active tasks")}</h3>${documentTasks.length?html`<ul>${documentTasks.map((job)=>html`<li><span>${this.i18n.t(`activity.kind.${job.kind}`,job.kind)}</span><small>${this.i18n.t(`activity.status.${job.status}`,job.status)}</small></li>`)}</ul>`:html`<small>${this.i18n.t("workbench.noTasks","No active tasks")}</small>`}</section><section><h3>${this.i18n.t("workbench.reviewQueue","Review queue")}</h3>${documentReviews.length?html`<ul>${documentReviews.map((review)=>html`<li><b dir="auto">${review.artifactTitle}</b><button type="button" class="button secondary compact" @click=${()=>void navigateInApp(this,navigation=>navigation.openAssignedReview(review))}>${this.i18n.t("activity.openReview","Open assigned review")}</button></li>`)}</ul>`:html`<small>${this.i18n.number(0)}</small>`}</section><section><h3>${this.i18n.t("workbench.creativeResults","Creative results")}</h3><strong>${this.i18n.number(history.length+p.artifacts.length)}</strong><button type="button" class="button secondary compact" @click=${()=>navigateInApp(this,navigation=>navigation.route("/deliver"))}>${this.i18n.t("shell.navigation.deliver","Deliver")} ${icon("arrow")}</button></section><button type="button" class="button ghost compact" @click=${()=>navigateInApp(this,navigation=>navigation.route("/activity"))}>${this.i18n.t("shell.navigation.activity","Activity")} ${icon("arrow")}</button></aside>
        </div>
      </div>
      ${this.store.ui.inspectorOpen ? this.#inspector() : nothing}
      ${!assistantActive&&canAuthor&&canGenerate?html`<div class="composer-dock">
        <div class="composer"><form class="composer-command" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#prompt.trim())void this.#ask();}}><label class="sr-only" for="creative-command">Describe a change or ask Forma</label><textarea id="creative-command" rows="1" aria-describedby=${chatWaiting?"creative-command-status":nothing} placeholder="Ask a question, explain an objective, or describe a change…" .value=${this.#prompt} @input=${(e: InputEvent) => { this.#prompt = (e.target as HTMLTextAreaElement).value;this.requestUpdate(); }} @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing&&!e.metaKey&&!e.ctrlKey&&!e.altKey) { e.preventDefault(); const submitter=(e.currentTarget as HTMLTextAreaElement).form?.querySelector<HTMLButtonElement>('button[type="submit"]');if(submitter&&!submitter.disabled)submitter.form?.requestSubmit(submitter); } }}></textarea><label class="icon-button add-ref" title=${this.i18n.t("model3d.upload.anyAdd","Add a licensed image, 3D model, audio recording, or source document")}><input type="file" accept="image/*,audio/*,.glb,.pdf,.txt,.md,.csv,.json,.docx,.pptx,.xlsx" @change=${this.#queueUpload}>${icon("plus")}</label>${!projectContext?html`<button type="button" class="button ghost compact" title=${this.i18n.t("assistant.mode.quickEditDetail")} ?disabled=${!this.#prompt.trim()||this.#asking} @click=${()=>{this.#selectWorkbenchPane("write");void this.#suggestQuickAction();}}>Quick edit</button>`:nothing}<button type="submit" class="button secondary ask" aria-describedby=${chatWaiting?"creative-command-status":nothing} title=${chatWaiting?this.i18n.t("chat.activeRequestUnsent"):this.store.session.get()?.provider.plannerConfigured??this.store.session.get()?.provider.configured?this.i18n.t("assistant.mode.creativeChatSubmit"):this.i18n.t("assistant.creativeUnavailable")} ?disabled=${!this.#prompt.trim()||this.#asking||chatActive||!(this.store.session.get()?.provider.plannerConfigured??this.store.session.get()?.provider.configured)}>${this.#asking?this.i18n.system("Asking Forma…"):chatWaiting?this.i18n.t("chat.waitForReply"):this.i18n.system("Ask Forma")}</button>${chatWaiting?html`<span id="creative-command-status" class="sr-only">${this.i18n.t("chat.activeRequestUnsent")}</span>`:nothing}</form></div>
      </div>`:nothing}
      ${this.store.ui.compareOpen ? this.#comparison() : nothing}
      ${this.#projectSettings&&!projectContext?html`<dialog class="modal workspace-modal project-settings-dialog" closedby="any" aria-labelledby="project-settings-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeProjectSettings();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeProjectSettings();}} @close=${()=>{if(this.#projectSettings){this.#projectSettings=false;this.requestUpdate();}}}><form class="modal-card project-settings-form" @submit=${this.#saveProject}><button type="button" class="icon-button modal-close" aria-label="Close project settings" @click=${this.#closeProjectSettings}>${icon("close")}</button><span class="eyebrow">Project settings</span><h2 id="project-settings-title">Edit ${p.projectName}</h2><label>Project name<input maxlength="80" required .value=${this.#projectName} @input=${(event:InputEvent)=>{this.#projectName=(event.target as HTMLInputElement).value;this.requestUpdate();}}></label><label>Project state<select .value=${this.#projectState} @change=${(event:Event)=>{this.#projectState=(event.target as HTMLSelectElement).value;}}><option value="active">Active</option><option value="archived">Archived</option><option value="paused">Paused</option></select><small>State changes are reversible events; they never delete project history.</small></label><footer><button type="button" class="button ghost" @click=${this.#closeProjectSettings}>Cancel</button><button class="button primary" ?disabled=${!this.#projectName.trim()}>Save project</button></footer></form></dialog>`:nothing}
      ${this.#deleteDocument?html`<dialog class="modal workspace-modal document-delete-dialog studio-document-delete-dialog" closedby="any" aria-labelledby="studio-delete-document-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeDeleteDocument();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeDeleteDocument();}} @close=${()=>{if(this.#deleteDocument){this.#deleteDocument=false;this.requestUpdate();}}}><div class="modal-card document-delete-card"><button class="icon-button modal-close" aria-label="Cancel document removal" @click=${this.#closeDeleteDocument}>${icon("close")}</button><span class="eyebrow">Removal can be undone</span><h2 id="studio-delete-document-title">Remove “${p.documentTitle}”?</h2><p>The document, its creative decisions, and its results will leave your active project. Another document opens automatically, and Undo can bring this one back.</p><div class="document-delete-summary"><span>${icon("trash")}</span><div><b>${p.documentTitle}</b><small>${p.blocks.length} creative decision${p.blocks.length===1?"":"s"} · ${history.length+p.artifacts.length} result${history.length+p.artifacts.length===1?"":"s"}</small></div></div><footer><button class="button ghost" @click=${this.#closeDeleteDocument}>Cancel</button><button class="button danger" @click=${this.#confirmDeleteDocument}>Remove document</button></footer></div></dialog>`:nothing}
      ${this.#referenceComposition?html`<forma-reference-compositor .sources=${referenceCompositionSources(p.blocks,this.store.events.get())} .disabled=${this.#compositionSaving} @composition-capture=${this.#saveReferenceComposition} @composition-close=${this.#closeReferenceComposition}></forma-reference-compositor>`:nothing}
      ${this.#pendingUpload ? html`<dialog class="modal workspace-modal upload-rights-modal" closedby="any" aria-modal="true" aria-labelledby="upload-rights-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget && !this.#uploading) this.#cancelUpload(); }} @cancel=${(event: Event) => { event.preventDefault(); if (!this.#uploading) this.#cancelUpload(); }} @close=${() => { if (this.#pendingUpload && !this.#uploading) { this.#pendingUpload = null; this.#uploadDocumentId = ""; this.#rightsConfirmed = false; this.requestUpdate(); } }}>
        <form class="modal-card reference-upload-card" @submit=${(event:SubmitEvent)=>{event.preventDefault();if(this.#rightsConfirmed&&!this.#uploading)void this.#confirmUpload();}}>
          <button type="button" class="icon-button modal-close" aria-label="Cancel upload" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>${icon("close")}</button>
          <span class="eyebrow">Reference setup · before upload</span><h2 id="upload-rights-title">${model3dMimeType(this.#pendingUpload)?this.i18n.t("model3d.upload.review","Review this 3D model"):audioMimeType(this.#pendingUpload.type)?this.i18n.t("audio.reference.private","Private audio reference"):this.#pendingUpload.type.startsWith("image/")?this.i18n.system("Choose what this image should contribute"):this.i18n.system("Verify this source document")}</h2>
          <div class="upload-file-receipt"><span>${icon(audioMimeType(this.#pendingUpload.type)?"audio":"image")}</span><div><b>${this.#pendingUpload.name}</b><small>${(this.#pendingUpload.size / 1_048_576).toFixed(1)} MB · ${this.#pendingUpload.type || this.i18n.system("document")}</small></div></div>
          ${model3dMimeType(this.#pendingUpload)?html`<p>${this.i18n.t("model3d.upload.privacy","The original model stays private. Choose and save a view before using it as an image reference; the mesh itself is not sent to image or video generators.")}</p>`:audioMimeType(this.#pendingUpload.type)?html`<p>${this.i18n.t("audio.use.inform.description","Use only your written description to shape images, stories, presentations, video, and music.")}</p><div class="reference-extraction-note"><span>${icon("info")}</span><p>${this.i18n.t("audio.upload.rightsNotice","I also confirm this recording contains no sensitive information. Upload remains private; creative influence, accompaniment, and provider transfer each require separate approval.")}</p></div>`:this.#pendingUpload.type.startsWith("image/")?html`<p>Forma can prepare several kinds of visual evidence. They remain suggestions on the Reference block until you explicitly add one as a document decision.</p><fieldset class="reference-extraction-options"><legend>Prepare findings automatically</legend>${REFERENCE_FINDING_OPTIONS.map((option) => html`<label><input type="checkbox" .checked=${this.#referenceFindingKinds.has(option.kind)} @change=${(event: Event) => { const checked = (event.target as HTMLInputElement).checked; if (checked) this.#referenceFindingKinds.add(option.kind); else this.#referenceFindingKinds.delete(option.kind); this.requestUpdate(); }}><span><b>${this.i18n.system(option.label)}</b><small>${this.i18n.system(option.description)}</small></span></label>`)}</fieldset><div class="reference-extraction-note"><span>${icon("info")}</span><p>Image analysis uses a small deterministic sample for visual structure; it does not identify people, objects, or meaning. You can change the prepared findings later.</p></div>`:html`<p>Selectable text from PDF, Word, PowerPoint, Excel, Markdown, CSV, JSON, and text sources is securely extracted by Forma into bounded, anchored project evidence. Scanned or encrypted documents may still require an accessible source excerpt; OCR is not available.</p><div class="reference-extraction-note"><span>${icon("info")}</span><p>The original bytes remain in private storage; their SHA-256 content hash and every cited excerpt are verified together with the rights receipt.</p></div>`}
          <label class="rights-check"><input type="checkbox" .checked=${this.#rightsConfirmed} @change=${(event: Event) => { this.#rightsConfirmed = (event.target as HTMLInputElement).checked; this.requestUpdate(); }}><span><b>I own this source or have a license that permits this use.</b><small>In a controlled pilot, I also confirm this source contains no sensitive information. This assertion is recorded with the reference and does not transfer ownership.</small></span></label>
          <footer><button type="button" class="button ghost" ?disabled=${this.#uploading} @click=${this.#cancelUpload}>Cancel</button><button type="submit" class="button primary" ?disabled=${!this.#rightsConfirmed || this.#uploading}>${this.#uploading ? this.i18n.system("Uploading securely…") : this.i18n.system("Confirm & add reference")}</button></footer>
        </form>
      </dialog>` : nothing}
    </section>`;
  }
}
if (!customElements.get("forma-workspace")) customElements.define("forma-workspace", FormaWorkspace);
