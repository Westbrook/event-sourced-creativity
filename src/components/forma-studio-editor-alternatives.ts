import { copyOutputRequirementBlock } from "../model/output-requirement-copy.ts";
import { html, noChange, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import "./context-intelligence";
import type { CreativeBlock, EventInput } from "../model/events";
import { BLOCK_GROUPS, BLOCK_INTENTS, BLOCK_TYPES, blockIntentFor, blockTypeDefinition, isBlockIntent, isBlockKind, suggestedSubtype, type AdaptiveStructure, type BlockKind } from "../model/block-types";
import type { AssistantToolRequest } from "../model/assistant-route-policy";
import type { CommandDeparture, NavigationPresentationContext } from "./command-departure";
import { FormaElement, icon } from "./forma-element";
import { blockIconName, realityCategoryIconName } from "./icon-semantics";
import { ensureModalDialog } from "./modal-dialog";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus } from "./output-navigation-focus";
import { AlternativeStudio } from "./forma-studio-alternatives";
import { navigateInApp, navigationPresentationMatches } from "./command-departure";
import { createAdaptiveProposalReview } from "./adaptive-proposal-review";
import { closeAdaptiveProposalDialog, renderAdaptiveProposalDialog } from "./adaptive-proposal-dialog";
import { documentContextBlockRoute, documentFocusFromRoute, withDocumentFocusInRoute } from "../model/routes";
import { localizedSpatialScopeLabel } from "./design-system/localized-spatial-scope";
import "./icons-authoring";
import "./icons-navigation";
import "./spatial-scope-editor";
import "./reference-pixel-policy";
import "./document-generations";
import "./generation-actions";
import "./design-system/choice-card";

type LayerInspectorSession={blockId:string;edited:boolean;revision:number;composing:boolean;saving:object|null;current():boolean};

type RealityCategory="intent"|"subject"|"space"|"light"|"look"|"delivery"|"rules";
type Reality={id:string;category:RealityCategory;type:BlockKind;subtype:string;label:string;description:string;text:string};

const REALITIES:Reality[]=[
  {id:"quiet-confidence",category:"intent",type:"direction",subtype:"Emotional outcome",label:"Quiet confidence",description:"Assured without becoming passive",text:"Create quiet confidence without feeling passive or over-resolved"},
  {id:"curious-audience",category:"intent",type:"audience",subtype:"Use context",label:"Curious passerby",description:"Reward a second, closer look",text:"Address a curious passerby who should discover more on a second look"},
  {id:"human-gesture",category:"subject",type:"subject",subtype:"Human presence",label:"Human gesture",description:"A candid figure with visible motion",text:"A candid human gesture with visible motion and natural posture"},
  {id:"hero-object",category:"subject",type:"subject",subtype:"Hero subject",label:"Hero object",description:"One unmistakable focal object",text:"One unmistakable hero object carries the visual hierarchy"},
  {id:"negative-space",category:"space",type:"composition",subtype:"Negative space",label:"Negative-space anchor",description:"Quiet space controls the frame",text:"Use deliberate negative space as the primary compositional anchor"},
  {id:"intimate-scale",category:"space",type:"scale",subtype:"Intimate",label:"Intimate scale",description:"Material detail rewards proximity",text:"Keep the subject at an intimate scale that rewards close looking"},
  {id:"eye-level",category:"space",type:"camera",subtype:"Viewpoint",label:"Human viewpoint",description:"Eye-level and physically believable",text:"Use an eye-level human viewpoint with believable perspective"},
  {id:"north-window",category:"light",type:"lighting",subtype:"Quality",label:"North-window daylight",description:"Soft, directional, and believable",text:"Soft directional north-window daylight with believable falloff"},
  {id:"sodium-night",category:"light",type:"lighting",subtype:"Color temperature",label:"Sodium-vapor night",description:"Warm pools in deep shadow",text:"Warm sodium-vapor pools of light surrounded by deep shadow"},
  {id:"archival-editorial",category:"look",type:"style",subtype:"Art direction",label:"Archival editorial",description:"Printed history, contemporary restraint",text:"Archival editorial language with contemporary restraint and subtle print texture"},
  {id:"tactile-paper",category:"look",type:"material",subtype:"Texture",label:"Tactile paper",description:"Fibrous and materially honest",text:"Tactile fibrous paper surfaces with materially honest imperfections"},
  {id:"measured-motion",category:"look",type:"motion",subtype:"Implied motion",label:"Measured motion",description:"Energy held just before release",text:"Imply measured motion through directional tension rather than blur"},
  {id:"editorial-type",category:"delivery",type:"typography",subtype:"Layout",label:"Editorial type field",description:"Type participates in the hierarchy",text:"Treat typography as an editorial field with a clear reading hierarchy"},
  {id:"portrait-social",category:"delivery",type:"format",subtype:"Aspect ratio",label:"Portrait social crop",description:"4:5 with protected message space",text:"Compose for a 4:5 portrait crop with protected space for messaging"},
  {id:"brand-restraint",category:"delivery",type:"brand",subtype:"Tone rule",label:"Brand restraint",description:"Recognizable without logo dependence",text:"Carry the brand through restraint, proportion, and material rather than logo scale"},
  {id:"no-readable-type",category:"rules",type:"exclusion",subtype:"Visual exclusion",label:"No accidental type",description:"Prevent invented letterforms",text:"Avoid pseudo-lettering, invented logos, and unintended readable typography"},
  {id:"protect-legibility",category:"rules",type:"accessibility",subtype:"Legibility",label:"Protect legibility",description:"Meaning survives small displays",text:"Keep essential meaning legible at small display sizes and common zoom levels"},
  {id:"avoid-symmetry",category:"rules",type:"exclusion",subtype:"Failure mode",label:"Avoid perfect symmetry",description:"Keep the frame from feeling diagrammatic",text:"Avoid perfect bilateral symmetry and overly diagrammatic balance"},
];

const layerLabel=(block:CreativeBlock)=>String(block.properties.artifact_markdown??block.properties.text??block.properties.label??block.handle);
const makeSlug=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,42)||"reality";
const navigateAlternativeView=(origin:AlternativeStudio,path:string)=>navigateInApp(origin,navigation=>navigation.route(path));

export class FormaRealityLayers extends AlternativeStudio {
  #category:"all"|RealityCategory="all";#dropActive=false;#selectedBlockId:string|null=null;#creating=false;
  #selectionCurrent:(()=>boolean)|null=null;
  #inspectorSession:LayerInspectorSession|null=null;
  #newType:BlockKind="direction";#newSubtype=suggestedSubtype("direction");#newHandle="";#newText="";#newWeight=.68;#newTypeSelected=false;
  #cleanNewType:BlockKind="direction";#cleanNewSubtype=suggestedSubtype("direction");
  #createRevision=0;#createSubmission=0;
  #pendingCreates:{current:()=>boolean;count:number;sequence:number}|null=null;
  override disconnectedCallback(){this.#createRevision++;this.#createSubmission++;this.#pendingCreates=null;this.#selectionCurrent=null;this.#selectedBlockId=null;this.#inspectorSession=null;super.disconnectedCallback();}
  #prepareLayerSelection(){
    const store=this.store,{projectId,documentId}=store.projection.get();
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    if(!source||!store.sourceOwnershipActive(source)||!authorization||!store.authorizationScopeActive(authorization)){
      this.#selectionCurrent=null;this.#selectedBlockId=null;this.#inspectorSession=null;return;
    }
    if(!this.#selectionCurrent?.()){
      this.#selectedBlockId=null;this.#inspectorSession=null;
      this.#selectionCurrent=()=>this.isConnected&&this.store===store
        &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId
        &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization);
    }
    if(store.loading.get()||!store.routeDataReady())return;
    const blocks=store.projection.get().blocks;
    if(this.#selectedBlockId===null||this.#selectedBlockId!==""&&!blocks.some(block=>block.id===this.#selectedBlockId))
      this.#selectedBlockId=blocks.at(-1)?.id??"";
  }
  #commandSelectedLayer(){
    // Guard reads never choose a new fallback. In particular, an initialized
    // empty inspector stays empty until its original Add/Create selects a result.
    return this.store.projection.get().blocks.find(block=>block.id===this.#selectedBlockId);
  }
  #layerInspectorSession(block:CreativeBlock|undefined):LayerInspectorSession|null{
    if(!block||block.type.toLowerCase()==="output"||block.type==="model3d"||block.type==="reference"&&Boolean(block.properties.reference_composition)){this.#inspectorSession=null;return null;}
    if(this.#inspectorSession?.current())return this.#inspectorSession;
    const store=this.store,{projectId,documentId}=store.projection.get();
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const identity=(value:CreativeBlock|undefined)=>JSON.stringify(value?[value.id,value.type,value.scope,
      value.properties.source_artifact_id??null,value.properties.source_artifact_item_id??null,value.properties.source_output_id??null]:[]);
    const original=identity(block);
    const session:LayerInspectorSession={blockId:block.id,edited:false,revision:0,composing:false,saving:null,current:()=>this.#inspectorSession===session
      &&this.isConnected&&this.store===store&&store.sourceOwnershipActive(source)
      &&Boolean(authorization&&store.authorizationScopeActive(authorization))
      &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId
      &&identity(this.#commandSelectedLayer())===original};
    this.#inspectorSession=session;return session;
  }
  #currentInspectorForm(session:LayerInspectorSession){
    const form=this.querySelector<HTMLFormElement>(".layer-inspector");
    return session.current()&&form?.isConnected&&form.getAttribute("data-layer-inspector")===session.blockId?form:null;
  }
  #editLayerInspector(event:Event,session:LayerInspectorSession,composing?:boolean){
    const field=event.currentTarget as HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement|null;
    const form=this.#currentInspectorForm(session),name=field?.getAttribute("name");
    if(!form||!field?.isConnected||field.closest("form")!==form||!name
      ||!["handle","instructions","subtype","weight"].includes(name)||field!==form.querySelector('[name="'+name+'"]'))return;
    session.edited=true;session.revision++;
    if(composing!==undefined)session.composing=composing;
    this.requestUpdate();
  }
  #normalizeLayerInspector(session:LayerInspectorSession){
    const form=this.#currentInspectorForm(session),block=this.#commandSelectedLayer();
    if(!form||!block||block.type.toLowerCase()==="output"||block.type==="model3d"||block.type==="reference"&&Boolean(block.properties.reference_composition))return false;
    const handle=form.querySelector<HTMLInputElement>('[name="handle"]');
    const instructions=form.querySelector<HTMLTextAreaElement>('[name="instructions"]');
    const subtype=form.querySelector<HTMLSelectElement>('[name="subtype"]');
    const weight=form.querySelector<HTMLInputElement>('[name="weight"]');
    if(!handle||!instructions||!subtype||!weight
      ||[handle,instructions,subtype,weight].some(field=>!field.isConnected||field.closest("form")!==form))return false;
    // The exact current native controls are the sole raw owner. No reset/defaults,
    // replacement draft cache, child cleanup or pending-request cancellation.
    handle.value=block.handle;instructions.value=layerLabel(block);
    subtype.value=String(block.properties.subtype??blockTypeDefinition(block.type)?.subtypes[0]??"");
    weight.value=String(this.#commandLayerWeight(Number(block.properties.weight??.5)));
    const output=weight.previousElementSibling as HTMLOutputElement|null;
    if(output?.tagName==="OUTPUT")output.value=String(Math.round(Number(weight.value)*100))+"%";
    session.edited=false;session.revision++;this.requestUpdate();return true;
  }
  #commandLayerIdentity(block=this.#commandSelectedLayer()){
    return JSON.stringify(block?[block.projectId,block.documentId,block.scope,block.id,block.type,block.sourceEvents]:[]);
  }
  #commandLayerWeight(value:number){
    // These actual range controls have min=0, max=1, step=.05. Compare the
    // native rendered value, without normalizing or writing the saved weight.
    return Math.round(Math.max(0,Math.min(1,Number.isFinite(value)?value:.5))*20)/20;
  }
  #inspectorWork(){
    if(this.#inspectorSession?.current()&&(this.#inspectorSession.saving||this.#inspectorSession.composing))return true;
    const block=this.#commandSelectedLayer();if(!block||block.type.toLowerCase()==="output"||block.type==="model3d"||block.type==="reference"&&Boolean(block.properties.reference_composition))return false;
    const form=this.querySelector<HTMLFormElement>(".layer-inspector");if(!form?.isConnected)return true;
    const handle=form.querySelector<HTMLInputElement>('[name="handle"]');
    const instructions=form.querySelector<HTMLTextAreaElement>('[name="instructions"]');
    const subtype=form.querySelector<HTMLSelectElement>('[name="subtype"]');
    const weight=form.querySelector<HTMLInputElement>('[name="weight"]');
    if(!handle||!instructions||!subtype||!weight)return true;
    return handle.value!==block.handle||instructions.value!==layerLabel(block)
      ||subtype.value!==String(block.properties.subtype??blockTypeDefinition(block.type)?.subtypes[0]??"")
      ||Number(weight.value)!==this.#commandLayerWeight(Number(block.properties.weight??.5));
  }
  #commandLayerWork(){
    if(Boolean(this.#pendingCreates&&this.#pendingCreates.count>0&&this.#pendingCreates.current())
      ||this.#creating||this.#newText!==""||this.#newHandle!==""||this.#newType!==this.#cleanNewType
      ||this.#newSubtype!==this.#cleanNewSubtype||this.#commandLayerWeight(this.#newWeight)!==this.#commandLayerWeight(.68))return true;
    return this.#inspectorWork();
  }
  #captureLayerSelection(){
    const store=this.store,{projectId,documentId}=store.projection.get(),route=store.route.get();
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const identity=this.#commandLayerIdentity(),children=this.captureAlternativeCommandChildren();
    const scopeCurrent=()=>this.isConnected&&this.store===store&&store.route.get()===route
      &&store.projection.get().projectId===projectId&&store.projection.get().documentId===documentId
      &&store.sourceOwnershipActive(source)&&Boolean(authorization&&store.authorizationScopeActive(authorization))
      &&this.#commandLayerIdentity()===identity;
    if(!this.#selectionCurrent?.()||!scopeCurrent()||!children.current())return null;
    if(this.#inspectorWork()||children.blocked()){
      store.toast(this.i18n.t("next.lifecycle.currentWorkOpen"));return null;
    }
    const focus=captureOutputNavigationFocus(this.ownerDocument);
    let retired=false,unsubscribe=()=>{};
    const dispose=()=>{retired=true;unsubscribe();focus.dispose();};
    const current=()=>!retired&&scopeCurrent()&&children.current()&&!this.#inspectorWork()
      &&!children.blocked()&&focus.current();
    unsubscribe=store.subscribe(()=>{if(!scopeCurrent())dispose();});
    return{current,dispose,select:(id:string)=>{
      if(!current()||!store.projection.get().blocks.some(block=>block.id===id
        &&block.projectId===projectId&&block.documentId===documentId))return false;
      this.#selectedBlockId=id;this.requestUpdate();return true;
    }};
  }
  #selectLayer(id:string){
    if(this.#commandSelectedLayer()?.id===id)return;
    const selection=this.#captureLayerSelection();if(!selection)return;
    try{selection.select(id);}finally{selection.dispose();}
  }
  #discardSelectedLayer(event:Event,session:LayerInspectorSession){
    const button=event.currentTarget as HTMLButtonElement|null,form=this.#currentInspectorForm(session);
    if(!form||!button?.isConnected||button.closest("form")!==form
      ||button!==form.querySelector(".layer-inspector-discard")||session.saving||session.composing||this.store.busy.get()
      ||Boolean(this.#pendingCreates&&this.#pendingCreates.count>0&&this.#pendingCreates.current()))return;
    this.#normalizeLayerInspector(session);
  }
  captureCommandDeparture():CommandDeparture{
    const children=this.captureAlternativeCommandChildren(),identity=this.#commandLayerIdentity();
    return{element:this,current:()=>children.current()&&this.#commandLayerIdentity()===identity,
      blocked:()=>this.#commandLayerWork()||children.blocked(),
      reason:()=>this.#commandLayerWork()?"next.lifecycle.currentWorkOpen":children.reason()};
  }
  protected override updated(){ensureModalDialog(this.querySelector<HTMLDialogElement>(".layer-create-dialog"));}
  #openCreate(){const selection=this.#captureLayerSelection();if(!selection)return;try{this.#createRevision++;this.#newTypeSelected=false;this.#creating=true;this.requestUpdate();}finally{selection.dispose();}}
  #closeCreate(){this.#createRevision++;this.querySelector<HTMLDialogElement>(".layer-create-dialog")?.close();this.#creating=false;this.#newTypeSelected=false;this.requestUpdate();}
  #chooseNewType(type: BlockKind) {
    if (!this.#creating || type === "model3d") return;
    const store = this.store, { projectId, documentId } = store.projection.get(), route = store.route.get();
    const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
    const focus = captureOutputNavigationFocus(this.ownerDocument), revision = ++this.#createRevision;
    this.#newType = type; this.#newSubtype = suggestedSubtype(type); this.#newTypeSelected = true;
    const subtype = this.#newSubtype;
    let retired = false;
    const current = () => !retired && this.isConnected && this.store === store && store.route.get() === route
      && store.projection.get().projectId === projectId && store.projection.get().documentId === documentId
      && store.sourceOwnershipActive(source) && Boolean(authorization && store.authorizationScopeActive(authorization))
      && this.#createRevision === revision && this.#creating && this.#newTypeSelected
      && this.#newType === type && this.#newSubtype === subtype;
    const unsubscribe = store.subscribe(() => { if (!current()) retired = true; });
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (!current()) return;
      const dialog = this.querySelector<HTMLDialogElement>(".layer-create-dialog");
      const field = this.querySelector<HTMLTextAreaElement>(".layer-create-form textarea");
      if (dialog?.open && field && dialog.contains(field)) focus.run(field, () => { field.focus(); return true; });
    }, () => undefined).finally(() => { unsubscribe(); focus.dispose(); });
  }
  async #activate(reality:Reality,source:"button"|"drop"){const p=this.store.projection.get();if(p.blocks.some((block)=>block.properties.reality_id===reality.id)){this.store.toast(this.i18n.system("{label} is already active.",{label:this.i18n.system(reality.label)}));return;}const selection=this.#captureLayerSelection();if(!selection)return;try{const id=crypto.randomUUID();const appended=await this.store.append({type:"BlockCreated",payload:{block_id:id,document_id:p.documentId,type:reality.type,handle:`${reality.type}/${makeSlug(reality.label)}`,position:`z${String(this.store.head.get()+1).padStart(5,"0")}`,properties:{text:this.i18n.system(reality.text),subtype:reality.subtype,weight:.68,authority:"authored",reality_id:reality.id,created_from:"reality-layers",activation_method:source,...(reality.type==="audio"?{audio_role:reality.subtype.toLowerCase().replace(/\s+/g,"_"),inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{})}}});if(appended.length&&selection.select(id)){this.store.patchUi({focusBlockId:id});this.requestUpdate();}}finally{selection.dispose();}}
  async #createLayer(event:SubmitEvent){
    event.preventDefault();
    const raw=this.#newText,rawHandle=this.#newHandle,type=this.#newType,subtype=this.#newSubtype,weight=this.#newWeight;
    const text=raw.trim();if(!text||type==="model3d"||!this.#creating||!this.#newTypeSelected)return;
    const store=this.store,p=store.projection.get(),route=store.route.get();
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const scopeCurrent=()=>this.isConnected&&this.store===store&&store.route.get()===route
      &&store.projection.get().projectId===p.projectId&&store.projection.get().documentId===p.documentId
      &&store.sourceOwnershipActive(source)&&Boolean(authorization&&store.authorizationScopeActive(authorization));
    if(!scopeCurrent())return;
    const selection=this.#captureLayerSelection();if(!selection)return;
    try{
    const revision=++this.#createRevision,submission=++this.#createSubmission;
    const id=crypto.randomUUID(),handle=rawHandle.trim()||`${type}/${makeSlug(text)}`;
    let pending=this.#pendingCreates;
    if(!pending||!pending.current()){
      let retired=false;
      pending={count:0,sequence:0,current:()=>{
        if(retired||this.#pendingCreates!==pending||!scopeCurrent()){retired=true;return false;}
        return true;
      }};
      this.#pendingCreates=pending;
    }
    const operation=pending,unsubscribe=store.subscribe(()=>{operation.current();});
    operation.count++;this.requestUpdate();
    try{
      const appended=await this.store.append({type:"BlockCreated",payload:{block_id:id,document_id:p.documentId,type:type,handle,position:`z${String(this.store.head.get()+1).padStart(5,"0")}`,properties:{text,subtype:subtype,weight:weight,authority:"authored",created_from:"reality-layers",activation_method:"custom-layer",...(type==="audio"?{audio_role:subtype.toLowerCase().replace(/\s+/g,"_"),inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{})}}});
      const committed=appended.find(event=>event.type==="BlockCreated"&&event.payload.block_id===id&&event.payload.document_id===p.documentId);
      if(!operation.current()||!committed
        ||!store.projection.get().blocks.some(block=>block.id===id&&block.type===type&&block.documentId===p.documentId&&block.projectId===p.projectId))return;
      // Order the clean baseline by actual positive Source sequence, not by
      // attempted submission or response-delivery order. No receipt body is kept.
      if(committed.sequence>operation.sequence){
        operation.sequence=committed.sequence;this.#cleanNewType=type;this.#cleanNewSubtype=subtype;
      }
      if(this.#createSubmission!==submission||this.#createRevision!==revision||!this.#creating||!this.#newTypeSelected||this.#newText!==raw
        ||this.#newHandle!==rawHandle||this.#newType!==type||this.#newSubtype!==subtype||this.#newWeight!==weight)return;
      if(!selection.select(id))return;this.#newHandle="";this.#newText="";this.#newWeight=.68;this.#closeCreate();
    }finally{
      unsubscribe();const current=operation.current();operation.count--;
      if(this.#pendingCreates===operation){
        if(operation.count===0)this.#pendingCreates=null;
        if(current)this.requestUpdate();
      }
    }
    }finally{selection.dispose();}
  }
  async #copyProjectBlock(block:CreativeBlock,source:"button"|"drop"){const sourceOwner=this.store.captureSourceOwnership();if(!this.store.sourceOwnershipActive(sourceOwner))return false;const selection=this.#captureLayerSelection();if(!selection)return false;try{const p=this.store.projection.get();if(block.properties.source_artifact_id){if(block.properties.source_artifact_item_id){this.store.toast(block.properties.source_artifact_kind==="video"?"Copy the complete video to keep every scene connected.":"Copy the complete storyboard to keep every frame connected.");return;}const copied=await this.store.copyLibraryBlockSet(block.id,p.documentId,"reality-layers");if(copied&&!("publication"in copied)&&this.store.sourceOwnershipActive(sourceOwner)){return selection.select(copied.rootBlockId);}return false;}const id=crypto.randomUUID();const copiedBlock=copyOutputRequirementBlock(block,id,new Map([[block.id,id]]));const appended=await this.store.append({type:"BlockCreated",payload:{block_id:id,document_id:p.documentId,type:copiedBlock.type,handle:`${block.handle}-layer-${String(this.store.head.get()+1).padStart(3,"0")}`,position:`z${String(this.store.head.get()+1).padStart(5,"0")}`,properties:{...copiedBlock.properties,authority:"authored",copied_from_block_id:block.id,created_from:"reality-layers",activation_method:source}}});if(this.store.sourceOwnershipActive(sourceOwner)&&appended.length){return selection.select(id);}return false;}finally{selection.dispose();}}
  async #duplicate(block:CreativeBlock){if(await this.#copyProjectBlock(block,"button"))this.store.toast("Layer duplicated with a new identity.");}
  #dragReality(event:DragEvent,reality:Reality){event.dataTransfer?.setData("application/x-forma-reality",JSON.stringify({kind:"preset",id:reality.id}));if(event.dataTransfer)event.dataTransfer.effectAllowed="copy";}
  #dragProjectBlock(event:DragEvent,block:CreativeBlock){event.dataTransfer?.setData("application/x-forma-reality",JSON.stringify({kind:"block",id:block.id}));if(event.dataTransfer)event.dataTransfer.effectAllowed="copy";}
  #dragLayer(event:DragEvent,id:string){event.dataTransfer?.setData("application/x-forma-layer",id);if(event.dataTransfer)event.dataTransfer.effectAllowed="move";}
  async #dropReality(event:DragEvent){event.preventDefault();this.#dropActive=false;const raw=event.dataTransfer?.getData("application/x-forma-reality");if(!raw){this.requestUpdate();return;}try{const data=JSON.parse(raw) as {kind:string;id:string};if(data.kind==="preset"){const reality=REALITIES.find((item)=>item.id===data.id);if(reality)await this.#activate(reality,"drop");}else{const block=this.store.projection.get().libraryBlocks.find((item)=>item.id===data.id);if(block)await this.#copyProjectBlock(block,"drop");}}catch{/* Ignore foreign drag payloads. */}this.requestUpdate();}
  async #commitLayerOrder(visual:CreativeBlock[]){const ordered=[...visual].reverse();const events:EventInput[]=ordered.map((block,index)=>({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"position",old_value:block.position,new_value:`l${String(index).padStart(4,"0")}`,source_surface:"reality-layers"}})).filter((input)=>input.payload.old_value!==input.payload.new_value);if(events.length)await this.store.appendBatch(events);}
  async #dropLayer(event:DragEvent,targetId:string){event.preventDefault();const sourceId=event.dataTransfer?.getData("application/x-forma-layer");if(!sourceId||sourceId===targetId)return;const visual=[...this.store.projection.get().blocks].reverse();const sourceIndex=visual.findIndex((block)=>block.id===sourceId);const targetIndex=visual.findIndex((block)=>block.id===targetId);if(sourceIndex<0||targetIndex<0)return;const [moved]=visual.splice(sourceIndex,1);visual.splice(targetIndex,0,moved);await this.#commitLayerOrder(visual);}
  async #moveLayer(id:string,delta:number){const visual=[...this.store.projection.get().blocks].reverse();const index=visual.findIndex((block)=>block.id===id);const target=index+delta;if(index<0||target<0||target>=visual.length){this.store.toast(delta<0?"This is already the top layer.":"This is already the bottom layer.");return;}const [moved]=visual.splice(index,1);visual.splice(target,0,moved);await this.#commitLayerOrder(visual);}
  async #toggle(block:CreativeBlock){const weight=Number(block.properties.weight??.5);await this.store.append({type:"BlockWeightSet",payload:{block_id:block.id,weight:weight>0?0:.68,previous_weight:weight,source_surface:"reality-layers"}});}
  async #remove(block:CreativeBlock){if(block.locked){this.store.toast("Unlock this layer before removing it.");return;}const removed=await this.store.removeOutputBlock({type:"BlockRemoved",payload:{block_id:block.id,source_surface:"reality-layers"}});if(removed.length&&this.#selectedBlockId===block.id)this.#selectedBlockId=null;}
  async #saveLayer(event:SubmitEvent,block:CreativeBlock){
    event.preventDefault();if(block.locked)return;
    const session=this.#inspectorSession,store=this.store,form=event.currentTarget as HTMLFormElement;
    if(!session||session.saving||session.composing||this.#currentInspectorForm(session)!==form
      ||this.#commandSelectedLayer()?.id!==block.id||this.#commandSelectedLayer()?.locked)return;
    const data=new FormData(event.currentTarget as HTMLFormElement);const handle=String(data.get("handle")??"").trim();const raw=String(data.get("instructions")??"");const text=block.properties.source_artifact_id||block.properties.source_output_id?raw:raw.trim();const subtype=String(data.get("subtype")??"");const intent=String(data.get("intent")??blockIntentFor(block.type,block.properties));const weight=Number(data.get("weight")??block.properties.weight??.5);const events:EventInput[]=[];if(handle&&handle!==block.handle)events.push({type:"BlockRenamed",payload:{block_id:block.id,old_handle:block.handle,new_handle:handle,reason:"reality-layer-inspector"}});const oldText=layerLabel(block);if((text||block.properties.source_artifact_id||block.properties.source_output_id)&&text!==oldText)events.push(...this.store.outputBlockTextEvents(block.id,text,"reality-layers"));const oldSubtype=String(block.properties.subtype??suggestedSubtype(block.type));if(subtype!==oldSubtype)events.push({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"subtype",old_value:oldSubtype,new_value:subtype,source_surface:"reality-layers"}});const oldIntent=blockIntentFor(block.type,block.properties);if(isBlockIntent(intent)&&(intent!==oldIntent||!block.properties.intent))events.push({type:"BlockPropertyEdited",payload:{block_id:block.id,property_path:"intent",old_value:oldIntent,new_value:intent,source_surface:"reality-layers"}});const oldWeight=Number(block.properties.weight??.5);if(weight!==oldWeight)events.push({type:"BlockWeightSet",payload:{block_id:block.id,weight,previous_weight:oldWeight,source_surface:"reality-layers"}});
    const canonicalMatches=()=>{
      const current=this.#commandSelectedLayer();
      return Boolean(current&&current.handle===handle&&layerLabel(current)===text
        &&String(current.properties.subtype??blockTypeDefinition(current.type)?.subtypes[0]??"")===subtype
        &&this.#commandLayerWeight(Number(current.properties.weight??.5))===weight);
    };
    if(!events.length){
      const same=canonicalMatches();
      if(same)this.#normalizeLayerInspector(session);
      store.toast(same?"Layer already matches those settings.":this.i18n.t("next.lifecycle.currentWorkOpen"));return;
    }
    const source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope(),route=store.route.get();
    const revision=session.revision,submission={},original=[...data.entries()];
    const scopeCurrent=()=>this.isConnected&&this.store===store&&store.route.get()===route
      &&store.sourceOwnershipActive(source)&&Boolean(authorization&&store.authorizationScopeActive(authorization))
      &&session.current()&&session.saving===submission;
    let retired=false;
    const current=()=>!retired&&scopeCurrent()&&this.#currentInspectorForm(session)===form;
    session.edited=true;session.saving=submission;
    const unsubscribe=store.subscribe(()=>{if(!scopeCurrent())retired=true;});
    this.requestUpdate();
    let complete=false;
    try{
      const appended=await this.store.appendBatch(events,{onAcknowledgment:receipt=>{
        complete=receipt.outcome==="observed"&&!receipt.privateUnavailable&&receipt.rejectedIndices.length===0
          &&receipt.action===(events.length>1?"batch":"append")&&receipt.committed.length===events.length
          &&receipt.owner.authorizationKey===authorization?.key&&receipt.owner.sourceGeneration===source?.generation;
      }});
      if(!complete||appended.length!==events.length||!current()||session.revision!==revision||session.composing)return;
      const fields=[...new FormData(form).entries()];
      if(original.length!==fields.length||!original.every(([name,value],index)=>fields[index][0]===name&&fields[index][1]===value)
        ||!canonicalMatches())return;
      this.#normalizeLayerInspector(session);
    }finally{
      unsubscribe();
      if(session.saving===submission){session.saving=null;if(session.current())this.requestUpdate();}
    }
  }
  #insight(blocks:CreativeBlock[]){const active=blocks.filter((block)=>Number(block.properties.weight??.5)>0);const groups=new Set(active.map((block)=>blockTypeDefinition(block.type)?.group).filter(Boolean));if(!active.length)return"Nothing is guiding the preview yet. Add one clear ingredient to establish a direction.";if(groups.size<3)return`${active.length} decision${active.length===1?"":"s"} shape the preview. Add a different kind of ingredient to see how choices support or compete with one another.`;return`${active.length} decisions across ${groups.size} creative areas now combine into one direction. Select any decision to fine-tune its influence.`;}

  override render() {
    this.#prepareLayerSelection();
    const projection = this.store.projection.get();
    const presets = this.#category === "all" ? REALITIES : REALITIES.filter((item) => item.category === this.#category);
    const activeRealityIds = new Set(projection.blocks.map((block) => String(block.properties.reality_id ?? "")));
    const projectBlocks = projection.libraryBlocks.filter((block) => block.documentId !== projection.documentId).slice(0, 8);
    const selected = this.#commandSelectedLayer(),inspector=this.#layerInspectorSession(selected);
    const selectedDefinition = selected ? blockTypeDefinition(selected.type) : undefined;
    const inspectorForm = inspector?.edited ? this.#currentInspectorForm(inspector) : null;
    const inspectorSubtype = inspectorForm?.querySelector<HTMLSelectElement>('[name="subtype"]');
    const retainedSubtypes = inspectorSubtype?.isConnected && inspectorSubtype.closest("form") === inspectorForm
      ? Array.from(inspectorSubtype.querySelectorAll<HTMLOptionElement>("option"))
        .filter(option => option.isConnected && option.closest("select") === inspectorSubtype).map(option => option.value) : [];
    const selectedSubtypes = [...new Set([...retainedSubtypes,
      String(selected?.properties.subtype ?? selectedDefinition?.subtypes[0] ?? ""), ...(selectedDefinition?.subtypes ?? [])])];
    const newDefinition = blockTypeDefinition(this.#newType)!;
    const active = projection.blocks.filter((block) => Number(block.properties.weight ?? .5) > 0);
    const activeGroups = new Set(active.map((block) => blockTypeDefinition(block.type)?.group));
    const recommendation = REALITIES.find((reality) => !activeRealityIds.has(reality.id) && !activeGroups.has(blockTypeDefinition(reality.type)?.group)) ?? REALITIES.find((reality) => !activeRealityIds.has(reality.id));
    const readiness = html`
      <section class="view-success-hero layers-success">
        <div class="view-success-copy">
          <span class="eyebrow">Compose by influence</span>
          <h2>Shape how the document’s decisions work together</h2>
          <p>Use the preview to test balance, emphasis, and omissions before asking for another result.</p>
        </div>
        <div class="view-readiness" aria-label="Active decisions">
          <span>Guiding the preview</span>
          <b>${active.length} of ${projection.blocks.length} decisions</b>
          <i style=${`--progress:${projection.blocks.length ? active.length / projection.blocks.length : 0}`}></i>
          <small>Muted decisions remain in the document and can be restored at any time.</small>
        </div>
        <aside class="next-best-action">
          <span>Suggested next ingredient</span>
          <b>${recommendation ? this.i18n.system(recommendation.label) : this.i18n.system("Review the current balance")}</b>
          <p>${recommendation ? this.i18n.system(recommendation.description) : this.i18n.system("Select a decision in the stack and check whether its influence matches its importance.")}</p>
          ${recommendation ? html`<button class="button secondary compact" @click=${() => this.#activate(recommendation, "button")}>Add to preview ${icon("arrow")}</button>` : nothing}
        </aside>
      </section>`;
    const body = html`
      <div class="reality-editor" data-forma-content="primary">
        <aside class="reality-shelf" aria-label="Creative ingredients">
          <header><div><span class="eyebrow">Add to this document</span><h3>Creative ingredients</h3></div><button class="new-layer-button" @click=${this.#openCreate}>${icon("plus")} Add context</button></header>
          <button type="button" class="button secondary compact" @click=${() => this.openModel3dUpload()}>${this.i18n.t("model3d.upload.label", "Upload an owned or licensed 3D model")}</button>
          <p class="section-note">${this.i18n.t("model3d.upload.detail", "Upload a self-contained GLB up to 64 MB, then save the view that should guide generation.")}</p>
          <nav class="reality-tools" aria-label="Ingredient categories">
            ${([ ["all","All"], ["intent","Intent"], ["subject","Subject"], ["space","Space"], ["light","Light"], ["look","Look"], ["delivery","Delivery"], ["rules","Rules"] ] as const).map(([id,label]) => html`<button class=${this.#category === id ? "active" : ""} aria-pressed=${this.#category === id} @click=${() => { this.#category = id; this.requestUpdate(); }}>${icon(realityCategoryIconName(id))}<span>${this.i18n.system(label)}</span></button>`)}
          </nav>
          <div class="reality-list">
            ${presets.map((reality) => {
              const isActive = activeRealityIds.has(reality.id);
              return html`<article class=${isActive ? "active" : ""} .draggable=${!isActive} @dragstart=${(event: DragEvent) => this.#dragReality(event, reality)}>
                <span class=${`reality-glyph ${reality.category}`}>${icon(blockIconName(reality.type))}</span>
                <div><b>${this.i18n.system(reality.label)}</b><small>${this.i18n.system(reality.description)}</small></div>
                <button ?disabled=${isActive} @click=${() => this.#activate(reality, "button")}>${isActive ? this.i18n.system("Added") : this.i18n.system("Add")}</button>
              </article>`;
            })}
          </div>
          ${projectBlocks.length ? html`<section class="project-reality-list"><span class="eyebrow">Reuse from this project</span>${projectBlocks.map((block) => html`<article .draggable=${true} @dragstart=${(event: DragEvent) => this.#dragProjectBlock(event, block)}><span class="reality-glyph project">${icon(blockIconName(block.type))}</span><div><b>${block.handle}</b><small>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? block.type))} · ${layerLabel(block)}</small></div><button @click=${() => this.#copyProjectBlock(block, "button")}>Copy</button></article>`)}</section>` : nothing}
        </aside>

        <main class="reality-stage">
          <div class="editor-toolbar" role="toolbar" aria-label="Document perspectives">
            <button class="active" aria-pressed="true">${icon("eye")}<span>Preview</span></button>
            <button @click=${() => navigateAlternativeView(this, "/studio/board")}>${icon("grid")}<span>Plan</span></button>
            <button @click=${() => navigateAlternativeView(this, "/")}>${icon("edit")}<span>Write</span></button>
            <span></span><b>${projection.documentTitle}</b>
          </div>
          <div class=${`reality-canvas ${this.#dropActive ? "drop-active" : ""} reality-canvas--${Math.min(5, projection.blocks.length)}`}
            @dragenter=${(event: DragEvent) => { if (event.dataTransfer?.types.includes("application/x-forma-reality")) { event.preventDefault(); this.#dropActive = true; this.requestUpdate(); } }}
            @dragover=${(event: DragEvent) => { if (event.dataTransfer?.types.includes("application/x-forma-reality")) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"; } }}
            @dragleave=${(event: DragEvent) => { if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)) { this.#dropActive = false; this.requestUpdate(); } }}
            @drop=${this.#dropReality}>
            <forma-document-generations view="layers" presentation="canvas"></forma-document-generations>
            <div class="canvas-context">${active.slice(0,8).map((block) => html`<button class=${selected?.id === block.id ? "selected" : ""} @click=${() => this.#selectLayer(block.id)}>${this.i18n.system(blockTypeDefinition(block.type)?.label ?? block.type)}<span>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? block.handle.split("/").at(-1)))}</span></button>`)}</div>
            <div class="canvas-drop-copy">${icon("plus")}<b>Add an ingredient here</b><span>Drop one from the left or use its Add button</span></div>
          </div>
          <footer><span class="canvas-guidance"><b>What this preview tells you</b><small>${this.#insight(projection.blocks)}</small></span><button class="button primary" ?disabled=${!projection.blocks.length} @click=${() => navigateAlternativeView(this, "/")}>Review the full document ${icon("arrow")}</button></footer>
        </main>

        <aside class="layers-panel" aria-label="Active document decisions">
          <header><div><span class="eyebrow">Complete document</span><h3>Decision stack</h3><small>Every decision is here. Higher items receive earlier attention.</small></div><button class="new-layer-button" @click=${this.#openCreate}>${icon("plus")} Add context</button></header>
          <ol>${[...projection.blocks].reverse().map((block) => {
            const isActive = Number(block.properties.weight ?? .5) > 0;
            return html`<li class=${`${isActive ? "" : "muted"} ${selected?.id === block.id ? "selected" : ""}`} .draggable=${!block.locked} @dragstart=${(event: DragEvent) => this.#dragLayer(event, block.id)} @dragover=${(event: DragEvent) => { if (event.dataTransfer?.types.includes("application/x-forma-layer")) event.preventDefault(); }} @drop=${(event: DragEvent) => this.#dropLayer(event, block.id)}>
              ${block.type.toLowerCase()==="output"?nothing:html`<button class="layer-visibility" aria-label=${isActive ? this.i18n.system("Mute {handle}", { handle: block.handle }) : this.i18n.system("Use {handle} in preview", { handle: block.handle })} aria-pressed=${isActive} @click=${() => this.#toggle(block)}>${icon(isActive ? "eye" : "hidden")}</button>`}
              <button class="layer-name" @click=${() => this.#selectLayer(block.id)}><b>${block.handle}</b><small>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? block.type))} · ${block.type.toLowerCase()==="output"?"":`${Math.round(Number(block.properties.weight ?? 0) * 100)}%`}</small></button>
              <span class="layer-order"><button aria-label=${this.i18n.system("Move {handle} up", { handle: block.handle })} @click=${() => this.#moveLayer(block.id, -1)}>${icon("up")}</button><button aria-label=${this.i18n.system("Move {handle} down", { handle: block.handle })} @click=${() => this.#moveLayer(block.id, 1)}>${icon("down")}</button></span>
              ${block.type.toLowerCase()==="output"?nothing:html`<button class="layer-remove" aria-label=${this.i18n.system("Remove {handle}", { handle: block.handle })} @click=${() => this.#remove(block)}>${icon("close")}</button>`}
            </li>`;
          })}</ol>
          ${selected?.type.toLowerCase()==="output"||selected?.type==="model3d"||selected?.type==="reference"&&Boolean(selected.properties.reference_composition) ? html`<forma-context-block .block=${selected}></forma-context-block>`  : selected&&inspector ? html`${keyed(inspector,html`<form class="layer-inspector" data-layer-inspector=${selected.id} @submit=${(event: SubmitEvent) => this.#saveLayer(event, selected)}>
            <header><span class="eyebrow">Fine-tune this decision</span><button type="button" @click=${() => this.store.append({ type: selected.locked ? "BlockUnlocked" : "BlockLocked", payload: { block_id: selected.id, locked_by: "user", source_surface: "reality-layers" } })}>${icon(selected.locked ? "lock" : "unlock")} ${selected.locked ? this.i18n.system("Unlock") : this.i18n.system("Protect")}</button></header>
            <label>Short name<input name="handle" ?disabled=${selected.locked} .value=${inspector.edited?noChange:selected.handle} @input=${(event:Event)=>this.#editLayerInspector(event,inspector)} @change=${(event:Event)=>this.#editLayerInspector(event,inspector)} @compositionstart=${(event:Event)=>this.#editLayerInspector(event,inspector,true)} @compositionend=${(event:Event)=>this.#editLayerInspector(event,inspector,false)}></label>
            <label>What it should do<textarea name="instructions" rows="4" ?disabled=${selected.locked} .value=${inspector.edited?noChange:layerLabel(selected)} @input=${(event:Event)=>this.#editLayerInspector(event,inspector)} @change=${(event:Event)=>this.#editLayerInspector(event,inspector)} @compositionstart=${(event:Event)=>this.#editLayerInspector(event,inspector,true)} @compositionend=${(event:Event)=>this.#editLayerInspector(event,inspector,false)}></textarea></label>
            <label>Role<select name="subtype" ?disabled=${selected.locked} .value=${inspector.edited?noChange:String(selected.properties.subtype ?? selectedDefinition?.subtypes[0] ?? "")} @change=${(event:Event)=>this.#editLayerInspector(event,inspector)}>${selectedSubtypes.map((subtype) => html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}</select></label>
            <label>Influence on the result <output>${inspector.edited?noChange:String(Math.round(this.#commandLayerWeight(Number(selected.properties.weight ?? .5)) * 100))+"%"}</output><input name="weight" type="range" min="0" max="1" step=".05" ?disabled=${selected.locked} .value=${inspector.edited?noChange:String(selected.properties.weight ?? .5)} @input=${(event: InputEvent) => { const output = (event.currentTarget as HTMLInputElement).previousElementSibling as HTMLOutputElement | null; if (output) output.value = `${Math.round(Number((event.target as HTMLInputElement).value) * 100)}%`; this.#editLayerInspector(event,inspector); }} @change=${(event:Event)=>this.#editLayerInspector(event,inspector)}></label>
            <footer class="platform-form-actions"><button type="button" class="button ghost compact" @click=${() => this.#duplicate(selected)}>Make a copy</button><button type="button" class="button ghost compact layer-inspector-discard" aria-label=${this.i18n.t("artifact.delivery.namedAction","{action} — {name}",{action:this.i18n.t("workspace.admin.discardPolicy","Discard unsaved changes"),name:"\u2068"+selected.handle+"\u2069"})} ?disabled=${Boolean(inspector.saving)||inspector.composing||Boolean(this.store.busy.get())||Boolean(this.#pendingCreates&&this.#pendingCreates.count>0&&this.#pendingCreates.current())} @click=${(event:Event)=>this.#discardSelectedLayer(event,inspector)}>${this.i18n.t("workspace.admin.discardPolicy","Discard unsaved changes")}</button><button class="button primary compact" ?disabled=${selected.locked||Boolean(inspector.saving)||inspector.composing}>Save decision</button></footer>
          </form>`)}<forma-context-intelligence .block=${selected} surface="layers" .compact=${true}></forma-context-intelligence>${selected.type === "reference" ? html`<forma-reference-pixel-policy .block=${selected} surface="layers" compact></forma-reference-pixel-policy>` : nothing}<forma-spatial-scope-editor .block=${selected} surface="layers"></forma-spatial-scope-editor>` : html`<div class="layer-empty">Add or select a decision to shape it here.</div>`}
        </aside>
      </div>
      ${readiness}

      ${this.#creating ? html`<dialog class="modal layer-create-dialog" closedby="any" aria-labelledby="new-layer-title" @click=${(event: MouseEvent) => { if (event.target === event.currentTarget) this.#closeCreate(); }} @cancel=${(event: Event) => { event.preventDefault(); this.#closeCreate(); }} @close=${() => { if (this.#creating) { this.#createRevision++; this.#creating = false; this.requestUpdate(); } }}>
        <form class="modal-card layer-create-form" @submit=${this.#createLayer}>
          <button type="button" class="icon-button modal-close" aria-label="Close new decision dialog" @click=${this.#closeCreate}>${icon("close")}</button>
          <h2 id="new-layer-title">${this.i18n.system(this.#newTypeSelected ? newDefinition.label : "Add context")}</h2><p>${this.i18n.system(this.#newTypeSelected ? newDefinition.description : "Choose a block type")}</p>
          ${this.#newTypeSelected ? html`<button type="button" class="text-button" @click=${() => { this.#createRevision++; this.#newTypeSelected = false; this.requestUpdate(); }}>Choose another type</button>
            <label>Block type<select .value=${this.#newType} @change=${(event: Event) => { const value = (event.target as HTMLSelectElement).value; if (isBlockKind(value) && value !== "model3d") { this.#createRevision++; this.#newType = value; this.#newSubtype = suggestedSubtype(value); this.requestUpdate(); } }}>${BLOCK_TYPES.filter((definition) => definition.type !== "model3d").map((definition) => html`<option value=${definition.type}>${this.i18n.system(definition.label)}</option>`)}</select><small>${this.i18n.system(newDefinition.description)}</small></label>
            <fieldset class="subtype-picker"><legend>Starting point</legend>${newDefinition.subtypes.map((subtype) => html`<label><input type="radio" name="new-layer-subtype" .value=${subtype} .checked=${this.#newSubtype === subtype} @change=${() => { this.#createRevision++; this.#newSubtype = subtype; this.requestUpdate(); }}><span>${this.i18n.system(subtype)}</span></label>`)}</fieldset>
            <label>What should it do?<textarea required rows="4" placeholder=${this.i18n.system(newDefinition.prompt)} .value=${this.#newText} @input=${(event: InputEvent) => { this.#createRevision++; this.#newText = (event.target as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea></label>
            <label>Short name <small>Optional—Forma can derive one.</small><input placeholder=${this.#newType + "/…"} .value=${this.#newHandle} @input=${(event: InputEvent) => { this.#createRevision++; this.#newHandle = (event.target as HTMLInputElement).value; }}></label>
            <label>Influence on the result <output>${Math.round(this.#newWeight * 100)}%</output><input type="range" min="0" max="1" step=".05" .value=${String(this.#newWeight)} @input=${(event: InputEvent) => { this.#createRevision++; this.#newWeight = Number((event.target as HTMLInputElement).value); this.requestUpdate(); }}></label>` : html`<div class="block-type-catalog layer-type-catalog">${BLOCK_GROUPS.map((group) => html`<section class="block-type-group" aria-labelledby=${`layer-block-group-${group.id}`}><header><div><h3 id=${`layer-block-group-${group.id}`}>${this.i18n.system(group.label)}</h3><p>${this.i18n.system(group.description)}</p></div></header><div class="block-type-grid">${BLOCK_TYPES.filter((definition) => definition.group === group.id && definition.type !== "model3d").map((definition) => html`<forma-ui-choice-card compact .label=${this.i18n.system(definition.label)} .detail=${this.i18n.system(definition.description)} .iconName=${blockIconName(definition.type)} .value=${definition.type} @forma-action=${() => this.#chooseNewType(definition.type)}></forma-ui-choice-card>`)}</div></section>`)}</div>`}
          <footer><button type="button" class="button ghost" @click=${this.#closeCreate}>Cancel</button>${this.#newTypeSelected ? html`<button class="button primary" ?disabled=${!this.#newText.trim()}>Add context</button>` : nothing}</footer>
        </form>
      </dialog>` : nothing}`;
    return this.shell("layers", "Reality layers", "Shape how every decision combines, then preview which choices carry the result.", body);
  }

  legacyRender(){const p=this.store.projection.get();const presets=this.#category==="all"?REALITIES:REALITIES.filter((item)=>item.category===this.#category);const activeRealityIds=new Set(p.blocks.map((block)=>String(block.properties.reality_id??"")));const projectBlocks=p.libraryBlocks.filter((block)=>block.documentId!==p.documentId).slice(0,8);const selected=p.blocks.find((block)=>block.id===this.#selectedBlockId)??p.blocks.at(-1);const selectedDefinition=selected?blockTypeDefinition(selected.type):undefined;const newDefinition=blockTypeDefinition(this.#newType)!;const body=html`<section class="reality-editor-intro"><div><span class="eyebrow">Interface 03 · layer-based composition</span><h2>Activate realities, then compose their influence</h2><p>Use familiar tools, an asset shelf, a canvas, and a layer stack. Every visual operation remains an ordinary replayable context change.</p></div><span><b>${p.blocks.filter((block)=>Number(block.properties.weight??.5)>0).length}</b> active layers</span></section>
    <div class="reality-editor">
      <aside class="reality-shelf" aria-label="Reality shelf"><header><div><span class="eyebrow">Reality shelf</span><h3>Ingredients</h3></div><button class="new-layer-button" @click=${()=>{this.#creating=true;this.requestUpdate();}}>${icon("plus")} New</button></header><nav class="reality-tools" aria-label="Reality categories">${([ ["all","All"],["intent","Intent"],["subject","Subject"],["space","Space"],["light","Light"],["look","Look"],["delivery","Delivery"],["rules","Rules"]] as const).map(([id,label])=>html`<button class=${this.#category===id?"active":""} aria-pressed=${this.#category===id} @click=${()=>{this.#category=id;this.requestUpdate();}}>${icon(realityCategoryIconName(id))}<span>${label}</span></button>`)}</nav><div class="reality-list">${presets.map((reality)=>{const active=activeRealityIds.has(reality.id);return html`<article class=${active?"active":""} .draggable=${!active} @dragstart=${(event:DragEvent)=>this.#dragReality(event,reality)}><span class=${`reality-glyph ${reality.category}`}>${icon(blockIconName(reality.type))}</span><div><b>${this.i18n.system(reality.label)}</b><small>${(blockTypeDefinition(reality.type)?.subtypes.includes(reality.subtype) ? this.i18n.system(reality.subtype) : reality.subtype)} · ${this.i18n.system(reality.description)}</small></div><button ?disabled=${active} @click=${()=>this.#activate(reality,"button")}>${active?this.i18n.system("Active"):this.i18n.system("Activate")}</button></article>`;})}</div>${projectBlocks.length?html`<section class="project-reality-list"><span class="eyebrow">From this project</span>${projectBlocks.map((block)=>html`<article .draggable=${true} @dragstart=${(event:DragEvent)=>this.#dragProjectBlock(event,block)}><span class="reality-glyph project">${icon(blockIconName(block.type))}</span><div><b>${block.handle}</b><small>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype??block.type))} · ${layerLabel(block)}</small></div><button @click=${()=>this.#copyProjectBlock(block,"button")}>Copy</button></article>`)}</section>`:nothing}</aside>
      <main class="reality-stage"><div class="editor-toolbar" role="toolbar" aria-label="Canvas tools"><button class="active" aria-pressed="true">${icon("eye")}<span>Compose</span></button><button @click=${()=>this.store.setRoute("/studio/board")}>${icon("grid")}<span>Arrange</span></button><button @click=${()=>this.store.setRoute("/")}>${icon("edit")}<span>Edit text</span></button><span></span><b>${p.documentTitle}</b></div><div class=${`reality-canvas ${this.#dropActive?"drop-active":""} reality-canvas--${Math.min(5,p.blocks.length)}`} @dragenter=${(event:DragEvent)=>{if(event.dataTransfer?.types.includes("application/x-forma-reality")){event.preventDefault();this.#dropActive=true;this.requestUpdate();}}} @dragover=${(event:DragEvent)=>{if(event.dataTransfer?.types.includes("application/x-forma-reality")){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect="copy";}}} @dragleave=${(event:DragEvent)=>{if(!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node)){this.#dropActive=false;this.requestUpdate();}}} @drop=${this.#dropReality}><div class="canvas-art"><i class="canvas-light"></i><i class="canvas-frame"></i><i class="canvas-subject"></i><i class="canvas-ground"></i><i class="canvas-grain"></i></div><div class="canvas-context">${p.blocks.filter((block)=>Number(block.properties.weight??.5)>0).slice(0,8).map((block)=>html`<button @click=${()=>{this.#selectedBlockId=block.id;this.requestUpdate();}}>${this.i18n.system(blockTypeDefinition(block.type)?.label??block.type)}<span>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype??block.handle.split("/").at(-1)))}</span></button>`)}</div><div class="canvas-drop-copy">${icon("plus")}<b>Drop a reality onto the document</b><span>or activate one from the shelf</span></div></div><footer><span>${this.#insight(p.blocks)}</span><button class="button primary" ?disabled=${!p.blocks.length} @click=${()=>this.store.setRoute("/")}>Continue in document Studio ${icon("arrow")}</button></footer></main>
      <aside class="layers-panel" aria-label="Context layers"><header><div><span class="eyebrow">Document</span><h3>Context layers</h3><small>Drag or use arrows to reorder</small></div><button class="new-layer-button" @click=${()=>{this.#creating=true;this.requestUpdate();}}>${icon("plus")} Add</button></header><ol>${[...p.blocks].reverse().map((block)=>{const active=Number(block.properties.weight??.5)>0;return html`<li class=${`${active?"":"muted"} ${selected?.id===block.id?"selected":""}`} .draggable=${!block.locked} @dragstart=${(event:DragEvent)=>this.#dragLayer(event,block.id)} @dragover=${(event:DragEvent)=>{if(event.dataTransfer?.types.includes("application/x-forma-layer"))event.preventDefault();}} @drop=${(event:DragEvent)=>this.#dropLayer(event,block.id)}>${block.type.toLowerCase()==="output"?nothing:html`<button class="layer-visibility" aria-label=${active?this.i18n.system("Deactivate {handle}", { handle: block.handle }):this.i18n.system("Activate {handle}", { handle: block.handle })} aria-pressed=${active} @click=${()=>this.#toggle(block)}>${active?icon("eye"):icon("hidden")}</button>`}<button class="layer-name" @click=${()=>{this.#selectedBlockId=block.id;this.requestUpdate();}}><b>${block.handle}</b><small>${block.type.toLowerCase()==="output"?"":this.i18n.system(BLOCK_INTENTS.find((intent)=>intent.id===blockIntentFor(block.type,block.properties))?.label??blockIntentFor(block.type,block.properties))} · ${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype??block.type))} · ${block.type.toLowerCase()==="output"?"":`${Math.round(Number(block.properties.weight??0)*100)}%`} · ${localizedSpatialScopeLabel(block.properties.spatial_scope,this.i18n)}</small></button><span class="layer-order"><button aria-label=${this.i18n.system("Move {handle} up", { handle: block.handle })} @click=${()=>this.#moveLayer(block.id,-1)}>${icon("up")}</button><button aria-label=${this.i18n.system("Move {handle} down", { handle: block.handle })} @click=${()=>this.#moveLayer(block.id,1)}>${icon("down")}</button></span>${block.type.toLowerCase()==="output"?nothing:html`<button class="layer-remove" aria-label=${this.i18n.system("Remove {handle}", { handle: block.handle })} @click=${()=>this.#remove(block)}>${icon("close")}</button>`}</li>`;})}</ol>${selected?.type.toLowerCase()==="output"||selected?.type==="model3d"||selected?.type==="reference"&&Boolean(selected.properties.reference_composition)?html`<forma-context-block .block=${selected}></forma-context-block>`:selected?html`<div class="layer-inspector-wrap"><form class="layer-inspector" @submit=${(event:SubmitEvent)=>this.#saveLayer(event,selected)}><header><span class="eyebrow">Selected reality</span><button type="button" @click=${()=>this.store.append({type:selected.locked?"BlockUnlocked":"BlockLocked",payload:{block_id:selected.id,locked_by:"user",source_surface:"reality-layers"}})}>${icon(selected.locked?"lock":"unlock")} ${selected.locked?this.i18n.system("Unlock"):this.i18n.system("Lock")}</button></header><label>Handle<input name="handle" ?disabled=${selected.locked} .value=${selected.handle}></label><label>Instructions<textarea name="instructions" rows="4" ?disabled=${selected.locked} .value=${layerLabel(selected)}></textarea></label><label>Subtype<select name="subtype" ?disabled=${selected.locked} .value=${String(selected.properties.subtype??selectedDefinition?.subtypes[0]??"")}>${selectedDefinition?.subtypes.map((subtype)=>html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}</select></label><label>Intent<select name="intent" ?disabled=${selected.locked}>${BLOCK_INTENTS.map((intent)=>html`<option value=${intent.id} ?selected=${intent.id===blockIntentFor(selected.type,selected.properties)}>${this.i18n.system(intent.label)} · ${this.i18n.system(intent.description)}</option>`)}</select></label><label>Influence <output>${Math.round(Number(selected.properties.weight??.5)*100)}%</output><input name="weight" type="range" min="0" max="1" step=".05" ?disabled=${selected.locked} .value=${String(selected.properties.weight??.5)} @input=${(event:InputEvent)=>{const output=(event.currentTarget as HTMLInputElement).previousElementSibling as HTMLOutputElement|null;if(output)output.value=`${Math.round(Number((event.target as HTMLInputElement).value)*100)}%`;}}></label><footer><button type="button" @click=${()=>this.#duplicate(selected)}>Duplicate</button><button class="button primary compact" ?disabled=${selected.locked}>Save layer</button></footer></form><forma-spatial-scope-editor .block=${selected} surface="layers"></forma-spatial-scope-editor></div>`:html`<div class="layer-empty">Activate or create a reality to begin.</div>`}</aside>
    </div>${this.#creating?html`<dialog class="modal layer-create-dialog" closedby="any" aria-labelledby="new-layer-title" @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#closeCreate();}} @cancel=${(event:Event)=>{event.preventDefault();this.#closeCreate();}} @close=${()=>{if(this.#creating){this.#creating=false;this.requestUpdate();}}}><form class="modal-card layer-create-form" @submit=${this.#createLayer}><button type="button" class="icon-button modal-close" aria-label="Close new layer dialog" @click=${this.#closeCreate}>${icon("close")}</button><span class="eyebrow">Custom reality · authored</span><h2 id="new-layer-title">Create a context layer</h2><p>Choose what kind of decision this layer owns, then give it precise instructions and influence.</p><label>Block type<select .value=${this.#newType} @change=${(event:Event)=>{const value=(event.target as HTMLSelectElement).value;if(isBlockKind(value)&&value!=="model3d"){this.#newType=value;this.#newSubtype=suggestedSubtype(value);this.requestUpdate();}}}>${BLOCK_TYPES.filter((definition)=>definition.type!=="model3d").map((definition)=>html`<option value=${definition.type}>${this.i18n.system(definition.label)}</option>`)}</select><small>${this.i18n.system(newDefinition.description)}</small></label><fieldset class="subtype-picker"><legend>System-suggested subtype</legend>${newDefinition.subtypes.map((subtype)=>html`<label><input type="radio" name="new-layer-subtype" .value=${subtype} .checked=${this.#newSubtype===subtype} @change=${()=>{this.#newSubtype=subtype;this.requestUpdate();}}><span>${this.i18n.system(subtype)}</span></label>`)}</fieldset><label>Instructions<textarea required rows="4" placeholder=${this.i18n.system(newDefinition.prompt)} .value=${this.#newText} @input=${(event:InputEvent)=>{this.#newText=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea></label><label>Handle <small>Optional—Forma can derive one.</small><input placeholder=${this.#newType+"/…"} .value=${this.#newHandle} @input=${(event:InputEvent)=>{this.#newHandle=(event.target as HTMLInputElement).value;}}></label>${this.#newType==="output"?nothing:html`<label>Initial influence <output>${Math.round(this.#newWeight*100)}%</output><input type="range" min="0" max="1" step=".05" .value=${String(this.#newWeight)} @input=${(event:InputEvent)=>{this.#newWeight=Number((event.target as HTMLInputElement).value);this.requestUpdate();}}></label>`}<footer><button type="button" class="button ghost" @click=${this.#closeCreate}>Cancel</button><button class="button primary" ?disabled=${!this.#newText.trim()}>Create layer</button></footer></form></dialog>`:nothing}`;return this.shell("layers","Reality layers","Compose creative context with the muscle memory of a traditional image editor.",body);}
}

type DecisionType="direction"|"audience"|"subject"|"environment"|"composition"|"style"|"lighting"|"exclusion";
type Decision={type:DecisionType;label:string;prompt:string;why:string};
const DECISIONS:Decision[]=[
  {type:"direction",label:"Purpose",prompt:"What should the image make possible?",why:"Purpose gives every later decision a reason to exist."},
  {type:"audience",label:"Audience",prompt:"Who needs to recognize themselves in this?",why:"Audience turns a broad purpose into a situated communication problem."},
  {type:"subject",label:"Reality",prompt:"What must exist in the frame?",why:"A concrete subject lets the scene become specific rather than generic."},
  {type:"environment",label:"World",prompt:"Where does this reality take place?",why:"Environment explains the physical and cultural world around the subject."},
  {type:"composition",label:"Structure",prompt:"How should the subject occupy the frame?",why:"Structure translates the scene into a visual reading order."},
  {type:"style",label:"Language",prompt:"What visual language should unify it?",why:"Language connects purpose, subject, and treatment."},
  {type:"lighting",label:"Atmosphere",prompt:"What light makes that language believable?",why:"Lighting makes the chosen language spatial and emotional."},
  {type:"exclusion",label:"Boundary",prompt:"What would break the direction?",why:"A named boundary protects the decisions already made."},
];

export class FormaAdaptivePath extends AlternativeStudio {
  #activeType:DecisionType|""="";#custom="";#intentPrompt="";#structure:AdaptiveStructure|null=null;
  #answerEdit:{dirty:boolean}|null=null;#answerIntent=0;
  #pendingAnswers:{current:()=>boolean;count:number}|null=null;
  #markAnswerEdit(type:DecisionType){
    if(!this.#activeType)this.#activeType=type;
    const decision=this.#currentDecision(),block=this.#activeType&&decision?this.#block(decision.type):undefined;
    this.#answerEdit={dirty:this.#custom!==(block?layerLabel(block):"")};
  }
  #proposalReview=createAdaptiveProposalReview(this.store,()=>({documentId:this.store.projection.get().documentId,canvasId:null}),()=>this.requestUpdate(),()=>this.i18n.t("adaptive.changes.title"));
  #proposalOpener?:HTMLElement;
  #commandAdaptiveIdentity(){
    const decision=this.#currentDecision(),block=decision?this.#block(decision.type):undefined;
    return JSON.stringify([this.#activeType,decision?.type??null,block?[block.projectId,block.documentId,block.scope,block.id,block.type,block.sourceEvents]:null,
      this.#proposalReview.presentationId,this.#proposalReview.executionId,this.#proposalReview.bindingHash]);
  }
  #commandAdaptiveWork(context?:NavigationPresentationContext){
    const decision=this.#currentDecision(),block=this.#activeType&&decision?this.#block(decision.type):undefined;
    const seed=block?layerLabel(block):"";
    const appliedPresentation=this.#proposalReview.phase==="applied"&&Boolean(this.#proposalReview.receipt)
      &&!this.#proposalReview.uncertain&&navigationPresentationMatches(context,this,this.querySelector(".adaptive-proposal-dialog"));
    return Boolean(this.#pendingAnswers&&this.#pendingAnswers.count>0&&this.#pendingAnswers.current())
      ||this.#custom!==seed||this.#intentPrompt!==""||this.#proposalReview.visible&&!appliedPresentation
      ||this.#proposalReview.busy||this.#proposalReview.dirty;
  }
  captureCommandDeparture():CommandDeparture{
    const children=this.captureAlternativeCommandChildren(),identity=this.#commandAdaptiveIdentity();
    return{element:this,current:()=>children.current()&&this.#commandAdaptiveIdentity()===identity,
      blocked:context=>this.#commandAdaptiveWork(context)||children.blocked(context),
      reason:()=>this.#commandAdaptiveWork()?"next.lifecycle.currentWorkOpen":children.reason()};
  }
  #rememberProposalOpener(){const active=this.ownerDocument?.activeElement;if(active instanceof HTMLElement)this.#proposalOpener=active;}
  #closeProposalReview(currentContext?:()=>boolean){closeAdaptiveProposalDialog(this,this.#proposalReview,this.#proposalOpener,()=>this.querySelector<HTMLElement>("h1"),currentContext);}
  #openProposalResult(kind:"block"|"canvas-item",id:string,event?:MouseEvent){
    if(kind!=="block"||!this.#proposalReview.canOpen(kind,id))return;
    const projection=this.store.projection.get(),block=projection.libraryBlocks.find(item=>item.id===id&&!item.removed&&item.projectId===projection.projectId&&item.scope==="document"&&item.documentId===projection.documentId);
    if(!block){this.store.toast(this.i18n.t("adaptive.changes.resultUnavailable"));return;}
    const trigger=event?.currentTarget as HTMLElement|null;if(!trigger)return;
    const element=this.querySelector<HTMLDialogElement>(".adaptive-proposal-dialog"),review=this.#proposalReview;
    const receipt=review.receipt,presentationId=review.presentationId,scope=review.ports.scope();
    const store=this.store,route=store.route.get(),source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const ownerDocument=this.ownerDocument,shell=this.closest("forma-shell"),opener=this.#proposalOpener?.isConnected?this.#proposalOpener:undefined;
    const blockIdentity=JSON.stringify([block.projectId,block.documentId,block.scope,block.id,block.type,block.sourceEvents]);
    const scopeCurrent=()=>review.phase==="applied"&&Boolean(receipt)&&review.receipt===receipt
      &&review.presentationId===presentationId&&!review.busy&&!review.dirty&&!review.uncertain
      &&review.ports.scope()?.owner===scope?.owner&&review.ports.scope()?.key===scope?.key
      &&store.sourceOwnershipActive(source)&&store.authorizationScopeActive(authorization)
      &&store.projection.get().projectId===projection.projectId&&store.projection.get().documentId===projection.documentId
      &&store.projection.get().libraryBlocks.some(item=>!item.removed
        &&JSON.stringify([item.projectId,item.documentId,item.scope,item.id,item.type,item.sourceEvents])===blockIdentity);
    const current=()=>review.visible&&review.canOpen(kind,id)&&scopeCurrent()
      &&this.querySelector(".adaptive-proposal-dialog")===element&&store.route.get()===route;
    if(!element||!scope||!current())return;
    const destination=withDocumentFocusInRoute(documentContextBlockRoute(projection.documentId,projection.documentTitle,id),documentFocusFromRoute(route));
    return navigateInApp(this,async navigation=>{
      if(!current()||!navigation.closePresentation(()=>this.#closeProposalReview(
        ()=>store.route.get()===route&&navigation.current())))return false;
      const destinationCurrent=()=>scopeCurrent()&&!review.visible&&store.route.get()===destination
        &&Boolean(store.captureWorkspaceNavigationFocus(destination,navigation.focus)?.routeCurrent());
      // Native close may keep the original opener focused until this same
      // Store-issued route lets the existing Workspace focus its linked block.
      if(!navigation.bindDestinationFocus(candidate=>destinationCurrent()&&candidate===opener
        &&Boolean(opener?.isConnected&&!opener.closest("[hidden],[inert]")&&!opener.matches(":disabled"))))return false;
      const linkedFocus=outputNavigationOwnedRouteFocus(ownerDocument,store,{documentId:projection.documentId,blockId:id},destinationCurrent);
      if(!await navigation.route(destination))return false;
      for(let attempt=0;attempt<24&&navigation.current()&&destinationCurrent();attempt++){
        await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
        if(!navigation.current()||!destinationCurrent())return false;
        const workspaces=[...ownerDocument.querySelectorAll<FormaElement>("forma-workspace")]
          .filter(workspace=>workspace.isConnected&&workspace.closest("forma-shell")===shell&&FormaElement.hasStoreIdentity(workspace,store));
        if(workspaces.length>1)return false;
        const active=ownerDocument.activeElement;
        if(workspaces.length===1&&active instanceof HTMLElement&&workspaces[0].contains(active)
          &&linkedFocus(active)&&active.getClientRects().length>0)return true;
      }
      return false;
    },{presentation:{owner:this,element,trigger,current,opener}});
  }
  protected override updated(){ensureModalDialog(this.querySelector<HTMLDialogElement>(".adaptive-proposal-dialog"));}
  #proposalDialog(){return renderAdaptiveProposalDialog(this.#proposalReview,this.i18n,{id:"adaptive-proposal-review-title",dialog:()=>this.querySelector<HTMLDialogElement>(".adaptive-proposal-dialog"),close:()=>this.#closeProposalReview(),open:(kind,id,event)=>void this.#openProposalResult(kind,id,event)});}
  #resumeProposalReview(){this.#rememberProposalOpener();void this.#proposalReview.resume();}
  #assistantTool=(event:Event)=>{const request=(event as CustomEvent<AssistantToolRequest>).detail;if(request.mode!=="plan-document")return;const session=this.store.session.get();const projection=this.store.projection.get();const projectId=session?.projectContext?.projectId??projection.projectId;const permitted=!session?.projectContext||session.projectContext.permissions.includes("project.author")&&session.projectContext.permissions.includes("project.output.request");if(!session||!permitted||request.actorUserId!==session.user.userId||request.projectId!==projectId||request.documentId!==projection.documentId||request.canvasId||this.store.planningConsent.get())return;event.preventDefault();void this.store.structureAdaptive(request.message,{documentId:projection.documentId,sourceSurface:"adaptive",projectScope:false}).then((accepted)=>{this.requestUpdate();request.resolve(Boolean(accepted));}).catch(()=>request.resolve(false));};
  override connectedCallback(){super.connectedCallback();window.addEventListener("forma-assistant-tool-request",this.#assistantTool);}
  override disconnectedCallback(){this.#answerIntent++;this.#answerEdit=null;this.#pendingAnswers=null;this.#proposalReview.suspend();window.removeEventListener("forma-assistant-tool-request",this.#assistantTool);super.disconnectedCallback();}
  #block(type:DecisionType){return this.store.projection.get().blocks.find((block)=>block.type===type);}
  #options(type:DecisionType){const direction=layerLabel(this.#block("direction")??({properties:{},handle:""} as CreativeBlock)).toLowerCase();const subject=layerLabel(this.#block("subject")??({properties:{},handle:""} as CreativeBlock)).toLowerCase();const values:Record<DecisionType,string[]>={direction:["Create quiet confidence without feeling passive","Make the familiar feel newly desirable","Build tension between precision and humanity"],audience:["A design-aware audience encountering this in passing","People who need warmth before they trust precision","A broad audience that should understand the idea without copy"],subject:(direction.includes("quiet")||direction.includes(this.i18n.system("Create quiet confidence without feeling passive").toLocaleLowerCase(this.i18n.locale)))?["One restrained hero object with subtle human evidence","A still figure caught between actions","A material detail that rewards close looking"]:["A singular hero subject with visible energy","Two realities in deliberate tension","A human-scale object shown in use"],environment:["A quiet interior with lived-in evidence","An abstract field grounded by one physical surface","A public threshold between inside and outside"],composition:(subject.includes("figure")||subject.includes(this.i18n.system("A still figure caught between actions").toLocaleLowerCase(this.i18n.locale)))?["Off-center figure with directional negative space","Close crop that preserves gesture","Layered foreground and distant release"]:["Monumental center with asymmetric counterweight","Intimate crop with one escaping edge","Editorial grid interrupted by the subject"],style:["Contemporary editorial restraint","Tactile documentary realism","Graphic modernism with material warmth"],lighting:["Soft directional daylight and long falloff","Hard side light with graphic shadow","Warm practical pools against cool ambient light"],exclusion:["Avoid generic luxury cues and empty polish","No accidental typography, marks, or logos","Avoid symmetry that makes the frame feel resolved too early"]};return values[type];}
  #currentDecision(){const p=this.store.projection.get();if(this.#activeType)return DECISIONS.find((decision)=>decision.type===this.#activeType)??null;const modelType=this.#structure?.active_decision.type;if(modelType&&DECISIONS.some((decision)=>decision.type===modelType)&&!p.blocks.some((block)=>block.type===modelType))return DECISIONS.find((decision)=>decision.type===modelType)??null;return DECISIONS.find((decision)=>!p.blocks.some((block)=>block.type===decision.type))??null;}
  async #commit(type:BlockKind,value:string,subtype=suggestedSubtype(type),paid?:{executionId:string;proposalIds:string[]}){if(paid){this.#rememberProposalOpener();this.#proposalReview.open(paid.executionId,paid.proposalIds);return;}return this.#commitManual(type,value,subtype);}
  async #commitManual(type:BlockKind,value:string,subtype:string){
    const text=value.trim();if(!text)return;const p=this.store.projection.get();const existing=p.blocks.find((block)=>block.type===type);let events:EventInput[]=[];if(existing){const oldValue=String(existing.properties.artifact_markdown??existing.properties.text??existing.properties.label??"");if(oldValue!==text)events.push(...this.store.outputBlockTextEvents(existing.id,text,"adaptive-path"));const oldSubtype=String(existing.properties.subtype??suggestedSubtype(type));if(oldSubtype!==subtype)events.push({type:"BlockPropertyEdited",payload:{block_id:existing.id,property_path:"subtype",old_value:oldSubtype,new_value:subtype,source_surface:"adaptive-path"}});}else events=[{type:"BlockCreated",payload:{block_id:crypto.randomUUID(),document_id:p.documentId,type,handle:`${type}/${makeSlug(text)}`,position:`z${String(this.store.head.get()+1).padStart(5,"0")}`,properties:{text,subtype,weight:.7,authority:"authored",created_from:"adaptive-path",related_block_ids:p.blocks.map((block)=>block.id),...(type==="audio"?{audio_role:"score",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{})}}}];if(!events.length){this.store.toast("That decision is already active.");return;}
    const store=this.store,route=store.route.get(),source=store.captureSourceOwnership(),authorization=store.captureAuthorizationScope();
    const scopeCurrent=()=>this.isConnected&&this.store===store&&store.route.get()===route
      &&store.projection.get().projectId===p.projectId&&store.projection.get().documentId===p.documentId
      &&store.sourceOwnershipActive(source)&&Boolean(authorization&&store.authorizationScopeActive(authorization));
    if(!scopeCurrent())return;
    // Own the actual rendered/submitted question before publishing its answer.
    // Re-deriving it after publication could move newer raw into the next question.
    if(!this.#activeType){const question=DECISIONS.find(decision=>decision.type===type);if(question)this.#activeType=question.type;}
    const raw=this.#custom,active=this.#activeType,edit=this.#answerEdit,intent=++this.#answerIntent;
    const targetId=existing?.id??String(events.find(event=>event.type==="BlockCreated")?.payload.block_id??"");
    let pending=this.#pendingAnswers;
    if(!pending||!pending.current()){
      let retired=false;
      pending={count:0,current:()=>{
        if(retired||this.#pendingAnswers!==pending||!scopeCurrent()){retired=true;return false;}
        return true;
      }};
      this.#pendingAnswers=pending;
    }
    // Existing scoped current/count ownership; raw remains in the current answer.
    const operation=pending,unsubscribe=store.subscribe(()=>{operation.current();});
    operation.count++;this.requestUpdate();
    try{
      const appended=await this.store.appendBatch(events);
      if(!appended.length||!operation.current()||this.#answerIntent!==intent||this.#activeType!==active)return;
      const committed=store.projection.get().blocks.find(block=>block.type===type);
      if(!targetId||!committed||committed.id!==targetId||layerLabel(committed)!==text
        ||String(committed.properties.subtype??suggestedSubtype(type))!==subtype)return;
      const untouched=this.#answerEdit===edit&&this.#custom===raw;
      // Like Guided, a native edit records whether it returned to the then-current
      // canonical answer. Restoring that clean value does not cancel pending A.
      const restored=this.#answerEdit!==edit&&this.#answerEdit?.dirty===false;
      if(untouched||restored){this.#answerIntent++;this.#activeType="";this.#custom="";this.#answerEdit=null;}
    }finally{
      unsubscribe();const current=operation.current();operation.count--;
      if(this.#pendingAnswers===operation){
        if(operation.count===0)this.#pendingAnswers=null;
        if(current)this.requestUpdate();
      }
    }
  }
  async #submitCustom(event:SubmitEvent,type:DecisionType){event.preventDefault();await this.#commit(type,this.#custom);}
  async #askForma(event:SubmitEvent){event.preventDefault();const prompt=this.#intentPrompt.trim();const session=this.store.session.get();const permitted=!session?.projectContext||session.projectContext.permissions.includes("project.author")&&session.projectContext.permissions.includes("project.output.request");if(!prompt||!session||!permitted||this.store.planningConsent.get())return;await this.store.structureAdaptive(prompt);this.requestUpdate();}
  #dismissStructure(){this.#structure=null;this.store.dismissAdaptiveStructure();this.requestUpdate();}
  override render() {
    const deliveredStructure=this.store.adaptiveStructureFor();if(deliveredStructure!==this.#structure)this.#structure=deliveredStructure??null;
    const projection = this.store.projection.get();
    const paidSource=this.store.adaptiveProposalSource(projection.documentId),paidId=paidSource?.executionId??"",paidProposalIds=["/active_decision",...(this.#structure?.suggested_blocks??[]).map((_item,index)=>"/suggested_blocks/"+index)];
    const completed = DECISIONS.filter((decision) => projection.blocks.some((block) => block.type === decision.type));
    const current = this.#currentDecision();
    const currentBlock = current ? projection.blocks.find((block) => block.type === current.type) : undefined;
    const progress = completed.length;
    const stage = progress < 3 ? "foundation" : progress < 6 ? "scene" : "resolution";
    const precedent = current ? completed.at(-1) : undefined;
    const pathBlocks = DECISIONS.map((decision) => projection.blocks.find((block) => block.type === decision.type)).filter((block): block is CreativeBlock => Boolean(block));
    const pathBlockIds = new Set(pathBlocks.map((block) => block.id));
    const supportingBlocks = projection.blocks.filter((block) => !pathBlockIds.has(block.id));
    const unlocks: Record<DecisionType, string> = {
      direction: "A standard for judging every later choice.", audience: "A real use context for message and tone.", subject: "A concrete scene instead of a generic idea.", environment: "Physical and cultural cues around the subject.", composition: "A clear reading order for the frame.", style: "A shared visual language for craft decisions.", lighting: "Believable atmosphere, depth, and focus.", exclusion: "A boundary that protects the direction during iteration.",
    };
    const readiness = html`
      <section class="view-success-hero adaptive-success">
        <div class="view-success-copy">
          <span class="eyebrow">A path shaped by your intent</span>
          <h2>Resolve the decision that will unlock the most progress</h2>
          <p>Forma uses what is already in the document to narrow the next question. You remain the author of every answer.</p>
        </div>
        <div class="view-readiness" aria-label="Decision path progress">
          <span>Core path</span><b>${progress} of ${DECISIONS.length} resolved</b><i style=${`--progress:${progress / DECISIONS.length}`}></i>
          <small>${current ? this.i18n.system("{label} is the next useful decision.", { label: this.i18n.system(current.label) }) : this.i18n.system("The core path is ready for review or generation.")}</small>
        </div>
        <aside class="next-best-action"><span>What success looks like next</span><b>${current ? this.i18n.system(unlocks[current.type]) : this.i18n.system("Generate, compare, and revise with a clear basis.")}</b><p>${current ? this.i18n.system(current.why) : this.i18n.system("All core decisions are present; supporting decisions still remain visible alongside them.")}</p></aside>
      </section>`;
    const session=this.store.session.get();
    const assistantActive=Boolean(session?.assistant?.enabled&&session.policy.accepted);
    const intent = assistantActive?nothing:html`
      <form class="adaptive-intent" @submit=${this.#askForma}>
        <div><label for="adaptive-intent-prompt">Describe the outcome—or the uncertainty slowing you down</label><textarea id="adaptive-intent-prompt" rows="3" placeholder="For example: We need this to feel credible to design leaders, but the current direction is polished without feeling human…" .value=${this.#intentPrompt} @input=${(event: InputEvent) => { this.#intentPrompt = (event.target as HTMLTextAreaElement).value; this.requestUpdate(); }}></textarea><small>Forma can suggest a route through the decisions. Nothing changes until you choose a suggestion.</small></div>
        <button class="button primary" ?disabled=${!this.#intentPrompt.trim() || !session || Boolean(session?.projectContext&&!session.projectContext.permissions.includes("project.author")) || Boolean(session?.projectContext&&!session.projectContext.permissions.includes("project.output.request")) || !!this.store.busy.get() || Boolean(this.store.planningConsent.get())}>${icon("spark")} ${this.store.documentJobActive("structure_adaptive") ? this.i18n.system("Finding a useful path safely…") : this.i18n.system("Plan my next decisions")}</button>
      </form>`;
    const suggestions = html`
      ${this.#structure ? html`<section class="adaptive-model-plan" tabindex="-1" aria-live="polite" aria-label=${this.i18n.t("assistant.reviewSuggestions")}>
        <header><div><span class="eyebrow">A suggested route · review before applying</span><h3>${this.#structure.interpretation}</h3></div><button @click=${this.#dismissStructure}>Not now</button></header>
        <div class="adaptive-model-actions"><button class="button secondary compact" ?disabled=${!paidId} @click=${()=>this.#commit("subject","",undefined,{executionId:paidId,proposalIds:["/active_decision"]})}>${this.i18n.t("adaptive.changes.reviewNext")}</button><button class="button secondary compact" ?disabled=${!paidId} @click=${()=>this.#commit("subject","",undefined,{executionId:paidId,proposalIds:paidProposalIds})}>${this.i18n.t("adaptive.changes.reviewAll")}</button></div><div class="adaptive-model-suggestions">${this.#structure.suggested_blocks.map((suggestion, proposalIndex) => html`<article><span>${this.i18n.system(blockTypeDefinition(suggestion.type)?.label ?? suggestion.type)} · ${(blockTypeDefinition(suggestion.type)?.subtypes.includes(suggestion.subtype) ? this.i18n.system(suggestion.subtype) : suggestion.subtype)}</span><h4>${suggestion.label}</h4><p>${suggestion.instruction}</p><small><b>Why it helps:</b> ${suggestion.reason}${suggestion.relationship_to ? " " + this.i18n.system("· Builds on {relationship_to}", { relationship_to: suggestion.relationship_to }) : ""}</small><button class="button secondary compact" ?disabled=${!paidId} @click=${() => this.#commit(suggestion.type, suggestion.instruction, suggestion.subtype,{executionId:paidId,proposalIds:["/suggested_blocks/"+proposalIndex]})}>${this.i18n.t("adaptive.changes.reviewSuggestion")} ${icon("arrow")}</button></article>`)}</div>
        ${this.#structure.hidden_until_later.length ? html`<footer><b>Not needed yet</b><span>${this.#structure.hidden_until_later.join(" · ")}</span></footer>` : nothing}
      </section>` : nothing}`;
    const body = html`${suggestions}<button class="text-button" type="button" @click=${this.#resumeProposalReview}>${this.i18n.t("adaptive.changes.resume")}</button>${this.#proposalDialog()}
      <div class=${`adaptive-workspace adaptive-stage--${stage}`} data-forma-content="primary">
        <nav class="decision-spine" aria-label="Creative decision path"><span class="eyebrow">Your decision path</span>${DECISIONS.map((decision, index) => {
          const block = projection.blocks.find((item) => item.type === decision.type);
          const isActive = current?.type === decision.type;
          const available = Boolean(block) || isActive;
          return html`<button class=${`${block ? "complete" : ""} ${isActive ? "active" : ""}`} ?disabled=${!available} @click=${() => { if (block) { this.#answerIntent++; this.#activeType = decision.type; this.#custom = layerLabel(block); this.#answerEdit = { dirty: false }; this.requestUpdate(); } }}><i>${block ? icon("check") : String(index + 1).padStart(2, "0")}</i><span><b>${this.i18n.system(decision.label)}</b><small>${block ? (typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? layerLabel(block))) : isActive ? this.i18n.system("Useful now") : this.i18n.system("Waits for context")}</small></span>${block ? html`<em>Review</em>` : nothing}</button>`;
        })}</nav>

        <main class="adaptive-focus">${current ? html`
          <header><span class="eyebrow">${precedent ? this.i18n.system("Next, because “{label}” is clear", { label: this.i18n.system(precedent.label) }) : this.i18n.system("Start with the purpose")}</span><h3>${this.i18n.system(current.prompt)}</h3><p>${this.#structure?.active_decision.type === current.type ? this.#structure.active_decision.why : this.i18n.system(current.why)}</p></header>
          <div class="decision-impact"><div><span>Why this is next</span><b>${this.i18n.system(current.why)}</b></div><div><span>What this unlocks</span><b>${this.i18n.system(unlocks[current.type])}</b></div></div>
          ${currentBlock ? html`<div class="adaptive-scope"><span>Where this decision applies</span><forma-spatial-scope-editor .block=${currentBlock} surface="adaptive"></forma-spatial-scope-editor><forma-context-intelligence .block=${currentBlock} surface="adaptive" compact></forma-context-intelligence></div>` : html`<p class="adaptive-scope-pending">Choose an answer first; then you can apply it to the whole document, a named area, a subject, or an exact shape.</p>`}
          <div class="adaptive-choices">${this.#options(current.type).map((option, index) => html`<forma-ui-choice-card .label=${this.i18n.system(option)} .detail=${`${this.i18n.system(current.label)} · ${this.i18n.system(suggestedSubtype(current.type))}`} .iconName=${blockIconName(current.type)} .value=${`${current.type}:${index}`} @forma-action=${() => this.#commit(current.type, this.i18n.system(option))}></forma-ui-choice-card>`)}</div>
          <form class="adaptive-custom" @submit=${(event: SubmitEvent) => this.#submitCustom(event, current.type)}><label for="adaptive-custom">Or write the answer in your own words</label><div><textarea id="adaptive-custom" rows="2" placeholder=${this.i18n.system("Describe the {value} precisely", { value: this.i18n.system(current.label).toLocaleLowerCase(this.i18n.locale) })} .value=${this.#custom} @input=${(event: InputEvent) => { this.#custom = (event.target as HTMLTextAreaElement).value; this.#markAnswerEdit(current.type); this.requestUpdate(); }}></textarea><button class="button primary" ?disabled=${!this.#custom.trim()}>Use my answer ${icon("arrow")}</button></div></form>
        ` : html`<section class="adaptive-ready"><span>${icon("check")}</span><div><span class="eyebrow">Core path resolved</span><h3>The document has enough structure to move forward</h3><p>Preview when you want fast evidence, or move a selected draft to full quality when the direction holds.</p></div><button class="button secondary" @click=${() => navigateAlternativeView(this, "/")}>Review full document</button><forma-generation-actions source="adaptive"></forma-generation-actions></section>`}</main>

        <aside class="adaptive-relations">
          <span class="eyebrow">Everything in this document</span>
          <div class="relationship-map">${DECISIONS.map((decision, index) => {
            const block = projection.blocks.find((item) => item.type === decision.type);
            return html`<div class=${block ? "resolved" : current?.type === decision.type ? "active" : "future"}><i>${block ? icon("check") : index + 1}</i><span><b>${this.i18n.system(decision.label)}</b><small>${block ? (typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? block.handle)) : current?.type === decision.type ? this.i18n.system("Open now") : this.i18n.system("Not yet needed")}</small></span></div>`;
          })}</div>
          ${supportingBlocks.length ? html`<section class="adaptive-supporting"><header><b>Supporting decisions</b><span>${supportingBlocks.length}</span></header><p>These remain part of the same document even though they do not control the next-question path.</p><ul>${supportingBlocks.map((block) => html`<li><button @click=${() => navigateAlternativeView(this, "/")}><span><b>${this.i18n.system(blockTypeDefinition(block.type)?.label ?? block.type)}</b><small>${(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype ?? block.handle))}</small></span><em>${layerLabel(block)}</em>${icon("arrow")}</button><forma-context-intelligence .block=${block} surface="adaptive" compact></forma-context-intelligence></li>`)}</ul></section>` : nothing}
          ${projection.outputs.length || progress >= 2 ? html`<section class="emergent-preview"><span class="eyebrow">What has become clearer</span><forma-document-generations view="adaptive" presentation="rail"></forma-document-generations><p>${progress < 6 ? this.i18n.system("Purpose and scene choices are specific enough to expose meaningful tensions.") : this.i18n.system("The document now connects intention, reality, expression, and boundary.")}</p></section>` : nothing}
        </aside>
      </div>
      ${intent}
      ${readiness}`;
    return this.shell("adaptive", "Adaptive path", "Let the document determine which decision deserves attention next—without hiding anything already decided.", body);
  }

  legacyRender(){const p=this.store.projection.get(),paidId=this.store.adaptiveProposalSource(p.documentId)?.executionId??"";const completed=DECISIONS.filter((decision)=>p.blocks.some((block)=>block.type===decision.type));const current=this.#currentDecision();const progress=completed.length;const stage=progress<3?"foundation":progress<6?"scene":"resolution";const precedent=current?completed.at(-1):undefined;const body=html`<section class="alternative-intro adaptive-intro"><div><span class="eyebrow">Interface 04 · intent-responsive decision space</span><h2>The interface follows both intent and decisions</h2><p>Describe the broader job in open language. Forma proposes which decisions deserve attention, while every proposed block remains inert until you choose it.</p></div><div class="adaptive-progress"><b>${progress}/${DECISIONS.length}</b><span>${current?this.i18n.system("{label} is the next useful decision", { label: this.i18n.system(current.label) }):this.i18n.system("Core context path resolved")}</span><i style=${`--progress:${progress/DECISIONS.length}`}></i></div></section>
    <form class="adaptive-intent" @submit=${this.#askForma}><div><label for="adaptive-intent-prompt">What are you trying to make—or where are you stuck?</label><textarea id="adaptive-intent-prompt" rows="3" placeholder="Describe the outcome, audience, constraints, uncertainty, or a tension you need the document to resolve…" .value=${this.#intentPrompt} @input=${(event:InputEvent)=>{this.#intentPrompt=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea><small>The model proposes structure; it cannot add or edit blocks until you apply a suggestion.</small></div><button class="button primary" ?disabled=${!this.#intentPrompt.trim()||!(this.store.session.get()?.provider.plannerConfigured??this.store.session.get()?.provider.configured)||Boolean(this.store.session.get()?.projectContext&&!this.store.session.get()?.projectContext?.permissions.includes("project.author"))||Boolean(this.store.session.get()?.projectContext&&!this.store.session.get()?.projectContext?.permissions.includes("project.output.request"))||!!this.store.busy.get()||this.store.documentJobActive("structure_adaptive")}>${icon("spark")} ${this.store.documentJobActive("structure_adaptive")?this.i18n.system("Structuring safely…"):this.i18n.system("Structure with Forma")}</button></form>
    ${this.#structure?html`<section class="adaptive-model-plan"><header><div><span class="eyebrow">Forma’s proposed structure · review first</span><h3>${this.#structure.interpretation}</h3></div><button @click=${this.#dismissStructure}>Dismiss</button></header><div class="adaptive-model-suggestions">${this.#structure.suggested_blocks.map((suggestion,proposalIndex)=>html`<article><span>${this.i18n.system(blockTypeDefinition(suggestion.type)?.label??suggestion.type)} · ${(blockTypeDefinition(suggestion.type)?.subtypes.includes(suggestion.subtype) ? this.i18n.system(suggestion.subtype) : suggestion.subtype)}</span><h4>${suggestion.label}</h4><p>${suggestion.instruction}</p><small>${suggestion.reason}${suggestion.relationship_to?" " + this.i18n.system("· Relates to {relationship_to}", { relationship_to: suggestion.relationship_to }):""}</small><button class="button secondary compact" ?disabled=${!paidId} @click=${()=>this.#commit(suggestion.type,suggestion.instruction,suggestion.subtype,{executionId:paidId,proposalIds:["/suggested_blocks/"+proposalIndex]})}>${this.i18n.t("adaptive.changes.reviewSuggestion")} ${icon("arrow")}</button></article>`)}</div>${this.#structure.hidden_until_later.length?html`<footer><b>Kept quiet for now</b><span>${this.#structure.hidden_until_later.join(" · ")}</span></footer>`:nothing}</section>`:nothing}
    <button class="text-button" type="button" @click=${this.#resumeProposalReview}>${this.i18n.t("adaptive.changes.resume")}</button>${this.#proposalDialog()}<div class=${`adaptive-workspace adaptive-stage--${stage}`}>
      <nav class="decision-spine" aria-label="Creative decision path"><span class="eyebrow">Document path</span>${DECISIONS.map((decision,index)=>{const block=p.blocks.find((item)=>item.type===decision.type);const active=current?.type===decision.type;const available=Boolean(block)||active;return html`<button class=${`${block?"complete":""} ${active?"active":""}`} ?disabled=${!available} @click=${()=>{if(block){this.#activeType=decision.type;this.#custom=layerLabel(block);this.requestUpdate();}}}><i>${block?icon("check"):String(index+1).padStart(2,"0")}</i><span><b>${this.i18n.system(decision.label)}</b><small>${block?(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype??layerLabel(block))):active?this.i18n.system("Decide now"):this.i18n.system("Emerges later")}</small></span>${block?html`<em>Revisit</em>`:nothing}</button>`;})}</nav>
      <main class="adaptive-focus">${current?html`<header><span class="eyebrow">${precedent?this.i18n.system("Because “{label}” is set", { label: this.i18n.system(precedent.label) }):this.i18n.system("Start with authored intent")}</span><h3>${this.i18n.system(current.prompt)}</h3><p>${this.#structure?.active_decision.type===current.type?this.#structure.active_decision.why:this.i18n.system(current.why)}</p></header><div class="adaptive-choices">${this.#options(current.type).map((option,index)=>html`<button @click=${()=>this.#commit(current.type,this.i18n.system(option))}><i>${String.fromCharCode(65+index)}</i><span><b>${this.i18n.system(option)}</b><small>${this.i18n.system(suggestedSubtype(current.type))} · apply as ${this.i18n.system(current.label).toLocaleLowerCase(this.i18n.locale)}</small></span>${icon("arrow")}</button>`)}</div><form class="adaptive-custom" @submit=${(event:SubmitEvent)=>this.#submitCustom(event,current.type)}><label for="adaptive-custom">Or author a precise answer</label><div><textarea id="adaptive-custom" rows="2" placeholder=${this.i18n.system("Describe the {value} in your own words", { value: this.i18n.system(current.label).toLocaleLowerCase(this.i18n.locale) })} .value=${this.#custom} @input=${(event:InputEvent)=>{this.#custom=(event.target as HTMLTextAreaElement).value;this.requestUpdate();}}></textarea><button class="button primary" ?disabled=${!this.#custom.trim()}>Commit ${icon("arrow")}</button></div></form>`:html`<section class="adaptive-ready"><span>${icon("check")}</span><div><span class="eyebrow">Decision path resolved</span><h3>The interface can now get out of the way</h3><p>Aha: the surface expanded only where intent required decisions, then collapsed into an actionable creative context you can still revisit.</p></div><button class="button secondary" @click=${()=>this.store.setRoute("/")}>Review full context</button><forma-generation-actions source="adaptive"></forma-generation-actions></section>`}</main>
      <aside class="adaptive-relations"><span class="eyebrow">What the interface now knows</span>${completed.length?html`<div class="relationship-map">${DECISIONS.map((decision,index)=>{const block=p.blocks.find((item)=>item.type===decision.type);return html`<div class=${block?"resolved":current?.type===decision.type?"active":"future"}><i>${block?icon("check"):index+1}</i><span><b>${this.i18n.system(decision.label)}</b><small>${block?(typeof block.properties.subtype === "string" && blockTypeDefinition(block.type)?.subtypes.includes(block.properties.subtype) ? this.i18n.system(block.properties.subtype) : String(block.properties.subtype??block.handle)):current?.type===decision.type?this.i18n.system("Related decision"):this.i18n.system("Waiting on context")}</small></span></div>`;})}</div>`:html`<div class="adaptive-empty"><b>No assumptions yet</b><p>The surface begins with open intent because a fixed questionnaire would make later controls generic.</p></div>`}${progress>=2?html`<section class="emergent-preview"><span class="eyebrow">Emergent preview</span><div class=${`adaptive-mini-art stage-${stage}`}><i></i><i></i><i></i></div><p>${progress<6?this.i18n.system("Intent and scene choices are now specific enough to reveal a meaningful preview."):this.i18n.system("The preview now reflects language and atmosphere as well as structure.")}</p></section>`:nothing}</aside>
    </div>`;return this.shell("adaptive","Adaptive path","Make related decisions through a surface that changes in response to both broad intent and accumulated context.",body);}
}

if (!customElements.get("forma-reality-layers")) customElements.define("forma-reality-layers",FormaRealityLayers);
if (!customElements.get("forma-adaptive-path")) customElements.define("forma-adaptive-path",FormaAdaptivePath);
