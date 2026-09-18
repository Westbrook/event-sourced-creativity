import type { AuthoringPreview } from "../../worker/authoring-commits";
import type { FormaStore } from "../state/store";
import { adaptiveProposalOptions, adaptiveProposalSelections, type AdaptiveProposalSelection, type AdaptiveProposalReceipt as CanonicalAdaptiveProposalReceipt } from "../model/adaptive-proposal-application";
import { blockTypeDefinition } from "../model/block-types";
import { creativeContextRightsIssue } from "../model/context-health";
import { isOutputContextType } from "../model/output-requirements";
import { captureOutputNavigation, outputNavigationMatches } from "../model/output-navigation";
import { documentContextBlockRoute, documentContextBlockFromRoute, documentIdFromRoute } from "../model/routes";
import type { FormaOutputRequirements } from "./forma-output-requirements";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus, type OutputNavigationFocusLease } from "./output-navigation-focus";
import { protectedAssistantDecision } from "../model/conversation-context";
import type { CreativeBlock, CreativeProjection } from "../model/events";

export type AdaptiveProposalScope={key:string;owner:string;actorUserId:string;projectId:string;documentId:string;canvasId:string|null;canAuthor:boolean};
export type AdaptiveProposalReadOperation={kind:"retrieve"}|{kind:"receipts"}|{kind:"choose";receipt:AdaptiveProposalReceipt};
export type AdaptiveProposalReadControl={temporaryFailure:()=>void;retire:()=>void;
  receiptAccepted:(receipt:AdaptiveProposalReceipt)=>boolean;
  pageAccepted:(receipts:AdaptiveProposalReceipt[],nextCursor:string|null,discovery:"proposal"|"destination")=>boolean};
type AdaptiveProposalReadPresentation=(operation:AdaptiveProposalReadOperation,read:(control?:AdaptiveProposalReadControl)=>Promise<void>)=>Promise<void>;
/** Only an exact applied-receipt handoff may carry its original read destination. */
export type AdaptiveProposalReadNavigation={
  readonly documentId:string;readonly canvasId:string;readonly scopeKey:string;readonly originalSelection:readonly string[];
  readonly readPresentation?:AdaptiveProposalReadPresentation;
};
export type AdaptiveProposalSource=NonNullable<ReturnType<FormaStore["adaptiveProposalSource"]>>;
export type AdaptiveProposalReceipt=Omit<CanonicalAdaptiveProposalReceipt,"createdAt"|"dismissed">&Partial<Pick<CanonicalAdaptiveProposalReceipt,"createdAt"|"dismissed">>;
type Handle=Pick<AdaptiveProposalReceipt,"previewId"|"approvalHash">;
type Original=ReturnType<typeof adaptiveProposalOptions>[number];
type Draft=AdaptiveProposalSelection&{createPlacement?:AdaptiveProposalSelection["placement"]};
type ParkedDraft={executionId:string;bindingHash:string;handle:Handle|null;selectionKey:string;uncertain:boolean;dirty:boolean;drafts:Draft[];ownEdits:Array<[string,AdaptiveProposalSelection["edit"]]>;receiptOnly:boolean;outputEndpointRequired:boolean;outputRefusedTargets:string[]};
type Phase="draft"|"review"|"uncertain"|"applying"|"applied"|"unavailable"|"receipts";
type Action="preview"|"apply"|"retrieve"|"resume"|"dismiss"|"receipts";
export type AdaptiveProposalPorts={
  scope:()=>AdaptiveProposalScope|null;source:(executionId?:string)=>AdaptiveProposalSource|null;
  captureRead:()=>ReturnType<FormaStore["captureAdaptiveProposalRead"]>;
  readOriginal:(executionId:string)=>Promise<unknown>;projection:()=>CreativeProjection;
  request:(body:Record<string,unknown>)=>Promise<Response>;refresh:()=>Promise<unknown>;changed:()=>void;
  readPresentation?:AdaptiveProposalReadPresentation;
  openOutputRequirement?:(blockId:string,ownership:{current:()=>boolean;retained:()=>boolean;close:()=>boolean})=>Promise<boolean>;
};
const identifier=(value:unknown):value is string=>typeof value==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/u.test(value);
const hash=(value:unknown):value is string=>typeof value==="string"&&/^[a-f0-9]{64}$/u.test(value);
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const clone=<T>(value:T):T=>structuredClone(value);
// This is the wire-contract fingerprint, not an approval. Only the server supplies approvalHash.
export function canonicalAdaptiveSelection(value:unknown):string{
  if(Array.isArray(value))return"["+value.map(canonicalAdaptiveSelection).join(",")+"]";
  if(value&&typeof value==="object")return"{"+Object.entries(value).filter(([,item])=>item!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+":"+canonicalAdaptiveSelection(item)).join(",")+"}";
  return JSON.stringify(value)??"null";
}
export async function adaptiveSelectionKey(scope:AdaptiveProposalScope,executionId:string,bindingHash:string,selections:AdaptiveProposalSelection[]){
  const value={version:"human-adaptive-proposal-v1",actor:scope.actorUserId,projectId:scope.projectId,documentId:scope.documentId,canvasId:scope.canvasId,executionId,bindingHash,selections};
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalAdaptiveSelection(value)));
  return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export function adaptiveProposalScope(store:FormaStore,documentId:string,canvasId:string|null=null,originalCanvasSelection?:readonly string[]):AdaptiveProposalScope|null{
  const authorization=store.captureAuthorizationScope(),session=store.session.get(),projection=store.projection.get();
  if(!authorization||!session||!store.authorizationScopeActive(authorization)||!projection.documents.some(item=>item.id===documentId&&item.projectId===projection.projectId)
    ||(canvasId?store.canvasProjection.get().selectedCanvasId!==canvasId||store.canvasPlanningDocumentId(originalCanvasSelection)!==documentId:projection.documentId!==documentId))return null;
  const context=session.projectContext,permissions=context?.permissions??session.capabilities??[];
  if(context&&context.projectId!==projection.projectId||!permissions.some(value=>value==="project.read"||value==="project.output.request")
    ||canvasId&&!session.canvas.access)return null;
  const owner=JSON.stringify([session.user.userId,session.audience,session.impersonation??null,context?.organizationId??null,context?.projectAccessId??null,projection.projectId,documentId,canvasId]);
  return{key:JSON.stringify([authorization.key,owner,[...permissions].sort(),session.policy.accepted]),owner,actorUserId:session.user.userId,
    projectId:projection.projectId,documentId,canvasId,canAuthor:originalCanvasSelection===undefined&&session.policy.accepted&&permissions.includes("project.author")&&(!canvasId||permissions.includes("project.canvas.use"))};
}

/** Component-lifetime presentation only. The existing endpoint owns every preview, atomic write and receipt. */
export class AdaptiveProposalReviewController{
  visible=false;busy=false;phase:Phase="draft";notice="";stale=false;dirty=false;uncertain=false;retryable=false;leaseExpired=false;refreshFailed=false;
  executionId="";bindingHash="";preview:AuthoringPreview|null=null;receipt:AdaptiveProposalReceipt|null=null;receipts:AdaptiveProposalReceipt[]=[];nextCursor:string|null=null;receiptDiscovery:"proposal"|"destination"="proposal";
  originals:Original[]=[];drafts:Draft[]=[];handle:Handle|null=null;
  #owner="";#scopeKey="";#request=0;#withdrawal=0;#selectionKey="";#previewSelections:AdaptiveProposalSelection[]|null=null;#originalVerified=false;#ownEdits=new Map<string,AdaptiveProposalSelection["edit"]>();
  #parkedDrafts=new Map<string,ParkedDraft>();
  #presentation=0;#receiptOnly=false;#outputEndpointRequired=false;#outputRefusedTargets=new Set<string>();#outputOpening=0;#outputOpeningRequest=0;
  get presentationId(){return this.#presentation;}
  get openingOutputRequirement(){return this.busy&&this.#outputOpeningRequest===this.#request;}
  #show(){if(!this.visible){this.visible=true;this.#presentation++;}}
  readonly ports:AdaptiveProposalPorts;
  constructor(ports:AdaptiveProposalPorts){this.ports=ports;}
  get canEdit(){return!this.busy&&!this.uncertain&&!this.receipt&&this.phase!=="receipts"&&Boolean(this.ports.scope()?.canAuthor)&&this.#originalVerified;}
  get outputEditorRequired(){return this.#outputEndpointRequired||this.drafts.some(draft=>this.outputTargetId(draft.proposalId)!==null);}
  get canPreview(){return this.canEdit&&!this.outputEditorRequired&&this.drafts.length>0&&Boolean(this.executionId&&this.bindingHash);}
  get canDismiss(){return!this.#receiptOnly&&!this.busy&&Boolean(this.handle)&&!this.receipt&&(!this.uncertain||this.leaseExpired);}
  get canApply(){return!this.#receiptOnly&&!this.outputEditorRequired&&!this.busy&&!this.dirty&&!this.stale&&Boolean(this.preview&&this.handle)&&Boolean(this.ports.scope()?.canAuthor)
    &&this.#originalVerified&&(!this.uncertain||this.retryable)&&this.phase!=="applied"&&Date.parse(this.preview!.expiresAt)>Date.now();}
  canOpen(kind:"block"|"canvas-item",id:string){this.synchronize();const scope=this.ports.scope();return scope?.owner===this.#owner&&scope.key===this.#scopeKey&&this.phase==="applied"&&Boolean(this.receipt&&(kind==="block"?this.receipt.blockIds:this.receipt.canvasItemIds).includes(id));}
  #changed(){this.ports.changed();}
  #privateUnavailable(){
    this.preview=null;this.originals=[];this.#originalVerified=false;this.receipt=null;this.receipts=[];this.nextCursor=null;
    // User-authored edits and content-free exact handles survive; retained provider text does not.
    this.#previewSelections=null;
    this.drafts=this.drafts.map(({proposalId,targetBlockId,placement,createPlacement})=>({proposalId,...(this.#ownEdits.has(proposalId)?{edit:clone(this.#ownEdits.get(proposalId))}:{}),...(targetBlockId?{targetBlockId}:{}),...(placement?{placement}:{}),...(createPlacement?{createPlacement}: {})}));
    this.phase="unavailable";this.notice="adaptive.changes.unavailable";this.stale=true;this.retryable=false;this.leaseExpired=false;
    // Content-free refusal identity follows the same parked human selection;
    // losing private source bytes must not turn that selection into a fresh edit.
  }
  synchronize(){
    const scope=this.ports.scope();
    if(!this.#owner)return;
    if(!scope||scope.owner!==this.#owner||scope.key!==this.#scopeKey){
      this.#request++;this.busy=false;this.#privateUnavailable();this.visible=false;
      if(scope?.owner===this.#owner)this.#scopeKey=scope.key;
      return;
    }
    const source=this.executionId?this.ports.source(this.executionId):null;
    if(source&&(source.withdrawalRevision>this.#withdrawal||source.bindingHash&&this.bindingHash&&source.bindingHash!==this.bindingHash)){
      this.#request++;this.busy=false;this.#withdrawal=source.withdrawalRevision;this.#privateUnavailable();
    }
  }
  // Transient host drafts only: changing boards cannot discard an uncertain handle.
  // No provider text, retry task, canonical record or browser persistence is stored here.
  #enterScope(scope:AdaptiveProposalScope){
    if(!this.#owner||this.#owner===scope.owner)return false;
    if(this.executionId&&(this.handle||this.uncertain||this.dirty||this.#ownEdits.size))this.#parkedDrafts.set(this.#owner,{executionId:this.executionId,bindingHash:this.bindingHash,handle:clone(this.handle),
      selectionKey:this.#selectionKey,uncertain:this.uncertain,dirty:this.dirty,drafts:clone(this.drafts),ownEdits:clone([...this.#ownEdits]),receiptOnly:this.#receiptOnly,outputEndpointRequired:this.#outputEndpointRequired,outputRefusedTargets:[...this.#outputRefusedTargets]});
    const saved=this.#parkedDrafts.get(scope.owner);this.#parkedDrafts.delete(scope.owner);this.#request++;this.#privateUnavailable();this.#capture(scope);
    this.executionId=saved?.executionId??"";this.bindingHash=saved?.bindingHash??"";this.handle=saved?.handle??null;this.#selectionKey=saved?.selectionKey??"";
    this.drafts=saved?.drafts??[];this.#ownEdits=new Map(saved?.ownEdits??[]);this.#receiptOnly=saved?.receiptOnly??false;this.#outputEndpointRequired=saved?.outputEndpointRequired??false;this.#outputRefusedTargets=new Set(saved?.outputRefusedTargets??[]);this.uncertain=saved?.uncertain??false;this.dirty=saved?.dirty??false;this.busy=false;return Boolean(saved);
  }
  #capture(scope:AdaptiveProposalScope){this.#owner=scope.owner;this.#scopeKey=scope.key;}
  #current(scope:AdaptiveProposalScope,request:number,withdrawal:number){
    const current=this.ports.scope(),source=this.executionId?this.ports.source(this.executionId):null;
    return this.#request===request&&current?.owner===scope.owner&&current.key===scope.key&&(!source||source.withdrawalRevision<=withdrawal&&(!source.bindingHash||!this.bindingHash||source.bindingHash===this.bindingHash));
  }
  #source(source:AdaptiveProposalSource|null){
    if(!source||source.executionId!==this.executionId||!hash(source.bindingHash)
      ||this.bindingHash&&this.bindingHash!==source.bindingHash)return false;
    // A surviving job binding is enough to find receipts, never to restore private text.
    this.bindingHash=source.bindingHash;this.#withdrawal=source.withdrawalRevision;
    if(!source.structure||!source.readable)return false;
    this.originals=clone(adaptiveProposalOptions(source.structure));this.#originalVerified=true;return true;
  }
  open(executionId:string,proposalIds:string[],placement?:AdaptiveProposalSelection["placement"]){
    this.synchronize();const scope=this.ports.scope();if(!scope||!identifier(executionId))return;
    const restored=this.#enterScope(scope);
    if(restored&&!this.handle&&!this.uncertain&&this.#source(this.ports.source(this.executionId))){this.phase="draft";this.stale=false;this.notice="";}
    if(this.#owner===scope.owner&&(this.busy||this.uncertain||this.handle&&!this.receipt&&this.phase!=="draft")){this.#show();this.#changed();return;}
    if(this.#owner===scope.owner&&this.executionId===executionId&&canonicalAdaptiveSelection(this.drafts.map(item=>item.proposalId))===canonicalAdaptiveSelection(proposalIds)&&!this.receipt){
      this.#show();this.#changed();return;
    }
    this.#capture(scope);this.#ownEdits.clear();this.#request++;this.#show();this.busy=false;this.phase="draft";this.notice="";this.stale=false;this.dirty=false;this.uncertain=false;this.retryable=false;this.leaseExpired=false;this.refreshFailed=false;
    this.executionId=executionId;this.bindingHash="";this.preview=null;this.handle=null;this.receipt=null;this.receipts=[];this.nextCursor=null;this.originals=[];this.#selectionKey="";this.#previewSelections=null;this.#originalVerified=false;this.#receiptOnly=false;this.#outputEndpointRequired=false;this.#outputRefusedTargets.clear();
    try{this.drafts=adaptiveProposalSelections(proposalIds.map((proposalId,index)=>({proposalId,...(scope.canvasId&&placement?{placement:{...placement,x:placement.x+index*24,y:placement.y+index*24}}:{})})))
      .map(item=>({...item,...(item.placement?{createPlacement:clone(item.placement)}:{})}));}
    catch{this.drafts=[];this.notice="adaptive.changes.invalid";}
    if(!this.#source(this.ports.source(executionId)))this.notice=this.bindingHash?"adaptive.changes.metadataOnly":"adaptive.changes.originalRequired";
    this.#changed();
  }
  close(){this.visible=false;this.#changed();}
  reopen(){this.synchronize();const scope=this.ports.scope();if(!scope||scope.owner!==this.#owner)return;this.#show();this.#changed();}
  suspend(){this.#request++;this.busy=false;if(this.uncertain)this.phase="uncertain";this.visible=false;}
  async retrieveOriginal(){
    this.synchronize();const scope=this.ports.scope();if(!scope||scope.owner!==this.#owner||this.busy||this.uncertain||this.handle||!this.executionId)return;
    const request=++this.#request,withdrawal=this.ports.source(this.executionId)?.withdrawalRevision??this.#withdrawal;
    this.busy=true;this.notice="";this.#changed();
    try{
      await this.ports.readOriginal(this.executionId);
      if(!this.#current(scope,request,withdrawal))return;
      if(!this.#source(this.ports.source(this.executionId)))throw new Error("original");
      this.phase="draft";this.stale=false;
    }catch{if(this.#current(scope,request,withdrawal)){this.#privateUnavailable();this.notice=this.bindingHash?"adaptive.changes.metadataOnly":"adaptive.changes.originalRequired";}}
    finally{if(this.#request===request){this.busy=false;this.#changed();}}
  }
  selections(){return adaptiveProposalSelections(this.drafts.map(({createPlacement,...selection})=>selection));}
  update(proposalId:string,key:"label"|"text"|"subtype"|"targetBlockId"|"x"|"y"|"w"|"h",value:string){
    this.synchronize();if(!this.canEdit)return;
    this.drafts=this.drafts.map(draft=>{
      if(draft.proposalId!==proposalId)return draft;
      if(key==="targetBlockId"){if(value!==(draft.targetBlockId??""))this.#outputEndpointRequired=false;const next={...draft};if(value){next.targetBlockId=value;delete next.placement;}else{delete next.targetBlockId;if(next.createPlacement)next.placement=clone(next.createPlacement);}return next;}
      if(["x","y","w","h"].includes(key)){if(!draft.placement)return draft;const placement={...draft.placement,[key]:Number(value)};return{...draft,placement,createPlacement:clone(placement)};}
      this.#ownEdits.set(proposalId,{...this.#ownEdits.get(proposalId),[key]:value});
      return{...draft,edit:{...draft.edit,[key]:value}};
    });
    this.preview=null;this.#previewSelections=null;this.dirty=true;this.stale=false;this.phase="draft";this.notice="";this.#changed();
  }
  /** Keep the selected identity visible, but never offer a generic edit of Output requirements. */
  outputTargetId(proposalId:string):string|null{
    const draft=this.drafts.find(item=>item.proposalId===proposalId),scope=this.ports.scope();
    if(!draft?.targetBlockId||!scope||scope.owner!==this.#owner||scope.key!==this.#scopeKey)return null;
    if(this.#outputRefusedTargets.has(draft.targetBlockId))return draft.targetBlockId;
    const original=this.originals.find(item=>item.proposalId===proposalId);
    if(isOutputContextType(draft.edit?.type??original?.type))return draft.targetBlockId;
    const block=this.ports.projection().libraryBlocks.find(item=>item.id===draft.targetBlockId&&item.projectId===scope.projectId&&!item.removed
      &&(scope.canvasId?item.scope==="canvas"&&item.canvasId===scope.canvasId:item.scope==="document"&&item.documentId===scope.documentId));
    return isOutputContextType(block?.type)?draft.targetBlockId:null;
  }
  canOpenOutputTarget(proposalId:string){
    return this.visible&&!this.busy&&!this.uncertain&&Boolean(this.ports.openOutputRequirement&&this.outputTargetId(proposalId));
  }
  async openOutputTarget(proposalId:string,close:()=>void):Promise<boolean>{
    this.synchronize();if(!this.canOpenOutputTarget(proposalId))return false;
    const scope=this.ports.scope()!,blockId=this.outputTargetId(proposalId)!,request=++this.#request,opening=++this.#outputOpening;
    const presentation=this.#presentation,executionId=this.executionId,bindingHash=this.bindingHash,receipt=this.receipt;
    const draft=canonicalAdaptiveSelection(this.drafts),handle=canonicalAdaptiveSelection(this.handle);
    const withdrawal=this.ports.source(executionId)?.withdrawalRevision??this.#withdrawal;
    let closed=false;
    const originalCurrent=()=>{const source=this.ports.source(executionId);return!source||!(source.withdrawalRevision>withdrawal||source.bindingHash&&source.bindingHash!==bindingHash);};
    const retained=()=>opening===this.#outputOpening&&presentation===this.#presentation&&this.executionId===executionId
      &&this.bindingHash===bindingHash&&this.receipt===receipt&&canonicalAdaptiveSelection(this.drafts)===draft&&canonicalAdaptiveSelection(this.handle)===handle&&originalCurrent();
    const current=()=>!closed&&this.visible&&!this.uncertain&&retained()&&this.#current(scope,request,withdrawal);
    this.#outputOpeningRequest=request;this.busy=true;this.notice="adaptive.changes.outputEditorRequired";this.#changed();
    try{
      return await this.ports.openOutputRequirement!(blockId,{current,retained:()=>closed&&!this.visible&&retained(),
        close:()=>{if(!current())return false;close();closed=!this.visible;return closed&&retained();}});
    }catch{return false;}
    finally{if(this.#request===request){this.busy=false;this.#changed();}}
  }
  targets(proposalId:string):CreativeBlock[]{
    const scope=this.ports.scope(),original=this.originals.find(item=>item.proposalId===proposalId);if(!scope||!original)return[];
    const type=this.drafts.find(item=>item.proposalId===proposalId)?.edit?.type??original.type,reserved=new Set(this.drafts.filter(item=>item.proposalId!==proposalId).map(item=>item.targetBlockId));
    return this.ports.projection().libraryBlocks.filter(block=>block.projectId===scope.projectId&&!block.removed&&!reserved.has(block.id)&&block.type===type&&!isOutputContextType(block.type)
      &&(scope.canvasId?block.scope==="canvas"&&block.canvasId===scope.canvasId:block.scope==="document"&&block.documentId===scope.documentId)
      &&!protectedAssistantDecision(block)&&!creativeContextRightsIssue(block.properties)
      &&!Object.keys(block.properties).some(key=>key.startsWith("organization_context_package_")||["organization_context_source_block_id","source_evidence_hash","source_artifact_id","source_output_id"].includes(key)));
  }
  resume(){
    const read=async(control?:AdaptiveProposalReadControl)=>{
    this.synchronize();const scope=this.ports.scope();if(!scope||this.busy)return;
    this.#enterScope(scope);this.#capture(scope);this.#show();
    if(!this.executionId){const source=this.ports.source();if(source&&identifier(source.executionId)&&hash(source.bindingHash)){this.executionId=source.executionId;this.#source(source);}}
    const metadataOnly=!this.handle&&!this.uncertain&&!this.#originalVerified&&hash(this.bindingHash);
    await this.request(this.handle?"retrieve":"resume",metadataOnly?{executionId:this.executionId,bindingHash:this.bindingHash}:{},control);
    };
    return this.ports.readPresentation?.({kind:"retrieve"},read)??read();
  }
  discoverReceipts(cursor?:string){
    const read=async(control?:AdaptiveProposalReadControl)=>{
    this.synchronize();if(!this.executionId||!hash(this.bindingHash)||this.handle&&this.uncertain||this.busy)return;
    await this.request("resume",{executionId:this.executionId,bindingHash:this.bindingHash,...(cursor?{cursor}:{})},control);
    };
    return this.ports.readPresentation?.({kind:"receipts"},read)??read();
  }
  discoverDestinationReceipts(cursor?:string){
    const read=async(control?:AdaptiveProposalReadControl)=>{
    this.synchronize();const scope=this.ports.scope();if(!scope||this.busy||this.uncertain)return;
    this.#enterScope(scope);this.#capture(scope);this.#show();await this.request("receipts",cursor?{cursor}:{},control);
    };
    return this.ports.readPresentation?.({kind:"receipts"},read)??read();
  }
  chooseReceipt(receipt:AdaptiveProposalReceipt){
    const read=async(control?:AdaptiveProposalReadControl)=>{
    if(this.busy||!this.receipts.some(item=>canonicalAdaptiveSelection(item)===canonicalAdaptiveSelection(receipt)))return;
    this.receipt=null;
    this.handle={previewId:receipt.previewId,approvalHash:receipt.approvalHash};this.#selectionKey=receipt.selectionKey;this.#previewSelections=null;this.#receiptOnly=true;this.originals=[];this.preview=null;this.#originalVerified=false;
    this.executionId=receipt.executionId;this.bindingHash=receipt.bindingHash;await this.request("retrieve",{},control);
    };
    return this.ports.readPresentation?.({kind:"choose",receipt},read)??read();
  }
  #receipt(value:Record<string,unknown>,expectedKey:string,destinationOnly=false):AdaptiveProposalReceipt{
    const ids=(candidate:unknown):candidate is string[]=>Array.isArray(candidate)&&candidate.every(identifier)&&new Set(candidate).size===candidate.length;
    if(!identifier(value.previewId)||!hash(value.approvalHash)||!identifier(value.executionId)||!hash(value.bindingHash)||!hash(value.selectionKey)
      ||!ids(value.blockIds)||!value.blockIds.length||!ids(value.canvasItemIds)||value.relationCount!==0
      ||!destinationOnly&&(this.executionId&&value.executionId!==this.executionId||this.bindingHash&&value.bindingHash!==this.bindingHash)||expectedKey&&value.selectionKey!==expectedKey)throw new Error("receipt");
    const blockIds=value.blockIds,canvasItemIds=value.canvasItemIds;
    if(this.#previewSelections&&(blockIds.length!==this.#previewSelections.length||this.#previewSelections.some((selection,index)=>selection.targetBlockId&&selection.targetBlockId!==blockIds[index])
      ||canvasItemIds.length!==(this.ports.scope()?.canvasId?this.#previewSelections.filter(item=>!item.targetBlockId).length:0)))throw new Error("receipt");
    return{previewId:value.previewId,approvalHash:value.approvalHash,executionId:value.executionId,bindingHash:value.bindingHash,selectionKey:value.selectionKey,blockIds:clone(blockIds),canvasItemIds:clone(canvasItemIds),relationCount:0,...(typeof value.createdAt==="string"?{createdAt:value.createdAt}:{}),...(typeof value.dismissed==="boolean"?{dismissed:value.dismissed}:{})};
  }
  async #preview(value:unknown,scope:AdaptiveProposalScope,expectedKey:string){
    const preview=record(value) as unknown as AuthoringPreview,review=preview.adaptiveReview;
    if(!identifier(preview.previewId)||!hash(preview.approvalHash)||!hash(preview.sourceHash)||preview.projectId!==scope.projectId||preview.documentId!==scope.documentId
      ||preview.canvasId!==scope.canvasId||preview.blockId!==""||!Array.isArray(preview.events)||!preview.events.length||!Array.isArray(preview.changes)||preview.relationCount!==0
      ||!Number.isFinite(Date.parse(preview.expiresAt))||!review||!identifier(review.executionId)||!hash(review.bindingHash)||!hash(review.selectionKey)
      ||!hash(review.originalSourceHash)||!hash(review.currentSourceHash)||review.sourceChanged!==(review.originalSourceHash!==review.currentSourceHash)
      ||this.executionId&&review.executionId!==this.executionId||this.bindingHash&&review.bindingHash!==this.bindingHash)throw new Error("preview");
    const selections=adaptiveProposalSelections(review.selections);
    if(preview.blockCount!==selections.length||await adaptiveSelectionKey(scope,review.executionId,review.bindingHash,selections)!==review.selectionKey
      ||expectedKey&&expectedKey!==review.selectionKey||!Array.isArray(review.originalSuggestions)||review.originalSuggestions.length!==selections.length
      ||review.originalSuggestions.some(item=>!selections.some(selection=>selection.proposalId===item.proposalId)||typeof item.label!=="string"||typeof item.text!=="string"||typeof item.reason!=="string"||!blockTypeDefinition(item.type)?.subtypes.includes(item.subtype)))throw new Error("preview");
    const originals=new Map(review.originalSuggestions.map(item=>[item.proposalId,item])),created=new Map<string,AdaptiveProposalSelection>(),placed=new Set<string>();
    if(originals.size!==selections.length)throw new Error("preview");
    for(const event of preview.events){
      const payload=record(event.payload);if(payload.project_id!==scope.projectId)throw new Error("destination");
      if(event.type==="BlockCreated"){
        const properties=record(payload.properties),selection=selections.find(item=>item.proposalId===properties.accepted_from_proposal_id&&!item.targetBlockId);
        const original=selection?originals.get(selection.proposalId):undefined,proposal=original?{...original,...selection?.edit}:null;
        if(!selection||!proposal||!identifier(payload.block_id)||created.has(payload.block_id)||payload.type!==proposal.type||payload.scope!==(scope.canvasId?"canvas":"document")
          ||(scope.canvasId?payload.canvas_id!==scope.canvasId||payload.document_id!==undefined:payload.document_id!==scope.documentId||payload.canvas_id!==undefined)
          ||properties.text!==proposal.text||properties.label!==proposal.label||properties.subtype!==proposal.subtype
          ||properties.accepted_from_execution_id!==review.executionId||properties.accepted_from_binding_hash!==review.bindingHash)throw new Error("destination");
        created.set(payload.block_id,selection);
      }else if(event.type==="BlockPropertyEdited"){
        const selection=selections.find(item=>item.targetBlockId===payload.block_id),original=selection?originals.get(selection.proposalId):undefined,proposal=original?{...original,...selection?.edit}:null;
        const property=payload.property_path as "text"|"label"|"subtype";
        if(!proposal||!["text","label","subtype"].includes(property)||payload.new_value!==proposal[property]
          ||payload.scope!==(scope.canvasId?"canvas":"document")||(scope.canvasId?payload.canvas_id!==scope.canvasId||payload.document_id!==undefined:payload.document_id!==scope.documentId||payload.canvas_id!==undefined))throw new Error("destination");
      }else if(event.type==="CanvasItemPlaced"){
        const selection=created.get(String(payload.source_id)),frame=record(payload.frame);
        if(!scope.canvasId||payload.canvas_id!==scope.canvasId||!selection?.placement||!identifier(payload.item_id)||placed.has(payload.item_id)
          ||(["x","y","w","h"] as const).some(key=>frame[key]!==selection.placement![key])||frame.rot!==0)throw new Error("destination");
        placed.add(payload.item_id);
      }else throw new Error("unexpected-change");
    }
    if(created.size!==selections.filter(item=>!item.targetBlockId).length||placed.size!==(scope.canvasId?created.size:0))throw new Error("destination");
    const available=new Map(this.originals.map(item=>[item.proposalId,item]));
    if(available.size&&review.originalSuggestions.some(item=>available.has(item.proposalId)&&canonicalAdaptiveSelection(item)!==canonicalAdaptiveSelection(available.get(item.proposalId))))throw new Error("original");
    return clone(preview);
  }
  async request(action:Action,extra:Record<string,unknown>={},readControl?:AdaptiveProposalReadControl):Promise<void>{
    this.synchronize();const scope=this.ports.scope();
    if(!scope||scope.owner!==this.#owner||this.busy||action==="preview"&&!this.canPreview||action==="apply"&&!this.canApply
      ||["apply","retrieve","dismiss"].includes(action)&&!this.handle||action==="dismiss"&&!this.canDismiss)return;
    const coldDefault=action==="resume"&&!this.executionId&&!this.handle&&!this.uncertain&&Object.keys(extra).length===0;
    const read=coldDefault?this.ports.captureRead?.()??null:null;
    if(coldDefault&&(!read||!Number.isSafeInteger(read.revision)||read.revision<0||typeof read.current!=="function"||read.current()!==true)){
      this.#privateUnavailable();this.#changed();return;
    }
    const request=++this.#request,withdrawal=this.ports.source(this.executionId)?.withdrawalRevision??read?.revision??this.#withdrawal,handle=action!=="preview"&&this.handle?clone(this.handle):null;
    const current=()=>this.#current(scope,request,withdrawal)&&(!read||read.current()===true);
    let expectedKey=this.#selectionKey,selections:AdaptiveProposalSelection[]|undefined;
    if(action==="preview"){try{selections=this.selections();}catch{this.notice="adaptive.changes.invalid";this.#changed();return;}}
    this.busy=true;this.notice="";this.retryable=false;this.leaseExpired=false;this.#changed();
    let transportPending=false;
    try{
      if(action==="preview"){
        expectedKey=await adaptiveSelectionKey(scope,this.executionId,this.bindingHash,selections!);
        if(!current())return;
        this.#previewSelections=clone(selections!);this.#selectionKey=expectedKey;this.handle=null;this.uncertain=true;this.phase="uncertain";
      }else if(action==="apply"||action==="dismiss"){this.uncertain=true;this.phase=action==="apply"?"applying":"uncertain";}
      transportPending=true;
      const response=await this.ports.request({action,projectId:scope.projectId,documentId:scope.documentId,canvasId:scope.canvasId,
        ...(action==="preview"?{executionId:this.executionId,bindingHash:this.bindingHash,selections}:(action==="resume"||action==="receipts")?extra:handle)});
      transportPending=false;
      if(!current())return;
      if([401,403,404,410].includes(response.status)){this.#privateUnavailable();this.notice="adaptive.changes.unavailable";return;}
      const result=record(await response.json());
      if(!current())return;
      if(readControl){
        if(response.ok&&result.status!==(action==="retrieve"?"applied":"receipts")){readControl.retire();return;}
        if(!response.ok){
          const temporary=[500,502,503,504].includes(response.status)&&typeof result.error==="string"&&Boolean(result.error)
            &&(result.status===undefined||result.status==="unavailable"||result.status==="applying")&&result.retentionUnavailable!==true
            &&!/denied|authorization|proposal_unavailable|source_unavailable/u.test(result.error);
          if(temporary)readControl.temporaryFailure();else readControl.retire();
        }
      }
      if(!response.ok){
        if(action==="preview"&&response.status===409&&typeof result.error==="string"&&["adaptive_changes_no_changes","adaptive_changes_target_unavailable","adaptive_changes_target_protected"].includes(result.error)&&result.status==="preview-not-created"
          &&result.selectionKey===expectedKey&&this.#selectionKey===expectedKey&&result.noPayment===true&&result.noAutomaticRetry===true
          &&Object.keys(result).length===5&&Object.keys(result).every(key=>["error","status","selectionKey","noPayment","noAutomaticRetry"].includes(key))){
          this.preview=null;this.uncertain=false;this.stale=false;this.phase="draft";this.notice=result.error==="adaptive_changes_no_changes"?"adaptive.changes.noChanges":"adaptive.changes.targetRefused";return;
        }
        const outputEndpointRequired=result.error==="output_requirement_endpoint_required";
        if(outputEndpointRequired){
          const submitted=action==="preview"?selections:this.#previewSelections;
          if(identifier(result.blockId)&&submitted?.some(item=>item.targetBlockId===result.blockId))this.#outputRefusedTargets.add(result.blockId);
          else this.#outputEndpointRequired=true;
        }
        if(result.status==="not-applied"){this.uncertain=false;this.stale=true;this.phase="review";this.notice=outputEndpointRequired?"adaptive.changes.outputEditorRequired":"adaptive.changes.stale";}
        else{this.uncertain=Boolean(this.handle)||this.uncertain;this.phase=this.uncertain?"uncertain":"unavailable";this.notice="adaptive.changes.checkRequired";}
        if(result.retentionUnavailable===true)this.#privateUnavailable();
        return;
      }
      if(result.status==="receipts"){
        const destinationOnly=action==="receipts";
        if(!destinationOnly&&(action!=="resume"||!extra.executionId)||result.readOnly!==true||result.canApply!==false||result.projectId!==scope.projectId||result.documentId!==scope.documentId||result.canvasId!==scope.canvasId
          ||(destinationOnly?result.executionId!==null||result.bindingHash!==null||result.discovery!=="destination":result.executionId!==this.executionId||result.bindingHash!==this.bindingHash)
          ||!Array.isArray(result.receipts)||result.pageSize!==20||result.receipts.length>20
          ||result.nextCursor!==null&&(typeof result.nextCursor!=="string"||!result.nextCursor))throw new Error("receipt-list");
        const approved=this.#previewSelections;this.#previewSelections=null;
        let receipts:AdaptiveProposalReceipt[];
        try{receipts=result.receipts.map(value=>{const row=record(value);if(typeof row.createdAt!=="string"||!Number.isFinite(Date.parse(row.createdAt))||typeof row.dismissed!=="boolean")throw new Error("receipt-list");return this.#receipt(row,"",destinationOnly);});if(new Set(receipts.map(item=>item.previewId)).size!==receipts.length)throw new Error("receipt-list");}finally{this.#previewSelections=approved;}
        if(readControl&&!readControl.pageAccepted(receipts,result.nextCursor as string|null,destinationOnly?"destination":"proposal"))return;
        this.receipts=receipts;
        this.nextCursor=result.nextCursor as string|null;this.receiptDiscovery=destinationOnly?"destination":"proposal";this.preview=null;this.phase="receipts";this.uncertain=false;this.notice=this.receipts.length?"":"adaptive.changes.noReceipts";return;
      }
      if(result.status==="none"){
        if(action!=="resume"||this.uncertain){this.notice="adaptive.changes.checkRequired";return;}
        this.phase="draft";this.notice="adaptive.changes.none";return;
      }
      if(result.status==="dismissed"){
        if(action!=="dismiss")throw new Error("dismissal");
        this.preview=null;this.handle=null;this.#previewSelections=null;this.#selectionKey="";this.uncertain=false;this.leaseExpired=false;this.stale=false;this.phase="draft";this.visible=false;return;
      }
      if(result.status==="applied"){
        if(action==="receipts"||action==="resume"&&extra.executionId)throw new Error("receipt_list_required");
        const receipt=this.#receipt(result,expectedKey);
        // Legacy resume may return its latest applied private preview. Without
        // an exact handle or selection, require the explicit receipt list instead.
        if(action==="resume"&&!handle&&!expectedKey){
          this.preview=null;this.receipt=null;this.originals=[];this.#originalVerified=false;this.#previewSelections=null;this.receipts=[];this.nextCursor=null;
          this.phase="draft";this.uncertain=false;this.notice="adaptive.changes.receiptDiscoveryRequired";return;
        }
        if(handle&&(receipt.previewId!==handle.previewId||receipt.approvalHash!==handle.approvalHash)
          &&!(result.requestedPreviewId===handle.previewId&&result.reusedPreviewId===receipt.previewId&&receipt.selectionKey===expectedKey))throw new Error("receipt-handle");
        if(readControl&&!readControl.receiptAccepted(receipt))return;
        this.receipt=receipt;this.handle={previewId:receipt.previewId,approvalHash:receipt.approvalHash};this.executionId=receipt.executionId;this.bindingHash=receipt.bindingHash;
        this.#selectionKey=receipt.selectionKey;this.uncertain=false;this.leaseExpired=false;this.phase="applied";this.stale=false;this.dirty=false;this.notice="adaptive.changes.applied";this.refreshFailed=false;this.#changed();
        try{await this.ports.refresh();}catch{if(current()){this.refreshFailed=true;this.notice="adaptive.changes.refreshFailed";}}
        return;
      }
      if(this.#receiptOnly)throw new Error("canonical_receipt_required");
      if(!["review","not-applied","applying"].includes(String(result.status)))throw new Error("status");
      if(result.preview){
        const preview=await this.#preview(result.preview,scope,expectedKey);
        if(!current())return;
        if(handle&&action!=="preview"&&(preview.previewId!==handle.previewId||preview.approvalHash!==handle.approvalHash))throw new Error("preview-handle");
        const review=preview.adaptiveReview!;
        this.preview=preview;this.handle={previewId:preview.previewId,approvalHash:preview.approvalHash};this.executionId=review.executionId;this.bindingHash=review.bindingHash;
        this.#selectionKey=review.selectionKey;this.#previewSelections=clone(review.selections);this.originals=clone(review.originalSuggestions);this.#originalVerified=true;this.#withdrawal=withdrawal;
        const keepDraft=this.dirty&&action!=="preview"&&this.drafts.length>0;
        if(!keepDraft){const placements=new Map(this.drafts.map(item=>[item.proposalId,item.createPlacement]));
          this.drafts=clone(review.selections).map(item=>{const placement=item.placement??placements.get(item.proposalId)??(scope.canvasId?{x:0,y:0,w:300,h:210}:undefined);
            return{...item,...(placement?{createPlacement:clone(placement)}:{})};});
        }
        this.dirty=keepDraft&&canonicalAdaptiveSelection(this.selections())!==canonicalAdaptiveSelection(review.selections);
        const known=this.ports.source(review.executionId);
        if(known&&known.withdrawalRevision>withdrawal){this.#withdrawal=known.withdrawalRevision;this.#privateUnavailable();return;}
      }else if(result.status!=="applying"||!handle||result.previewId!==handle.previewId)throw new Error("preview-missing");
      if(result.dismissed===true){
        if(!["retrieve","resume"].includes(action)||result.status!=="not-applied"||!result.preview)throw new Error("dismissal");
        this.preview=null;this.handle=null;this.#previewSelections=null;this.#selectionKey="";this.uncertain=false;this.leaseExpired=false;this.stale=false;this.phase="draft";this.notice="adaptive.changes.dismissed";return;
      }
      this.uncertain=result.status==="applying";this.leaseExpired=this.uncertain&&result.leaseExpired===true;this.retryable=this.leaseExpired&&result.retryable===true;
      this.phase=this.uncertain?"applying":"review";this.stale=result.stale===true||Boolean(this.preview&&Date.parse(this.preview.expiresAt)<=Date.now());
      this.notice=this.dirty?"adaptive.changes.draftChanged":this.stale?"adaptive.changes.stale":this.retryable?"adaptive.changes.retrySame":this.uncertain?"adaptive.changes.checkRequired":"";
    }catch{
      if(current()){
        if(readControl){if(transportPending)readControl.temporaryFailure();else readControl.retire();}
        this.phase=this.uncertain?"uncertain":"unavailable";this.notice="adaptive.changes.checkRequired";
      }
    }finally{
      if(this.#request===request){this.busy=false;if(!current())this.#privateUnavailable();this.#changed();}
    }
  }
}

/** Native hosts provide the destination and lifecycle; this port never appends client events. */
export function createAdaptiveProposalReview(store:FormaStore,destination:()=>{documentId:string;canvasId:string|null;receiptNavigation?:AdaptiveProposalReadNavigation},changed:()=>void,actionLabel:()=>string,prepare?:()=>Promise<boolean>){
  const currentDestination=()=>{
    const target=destination(),navigation=target.receiptNavigation;
    if(!navigation)return{...target,scope:adaptiveProposalScope(store,target.documentId,target.canvasId),readOnly:false};
    // Re-run the real resolver on the original exact selection, never the first
    // document or a cached authority. This context grants no authoring scope.
    const scope=adaptiveProposalScope(store,navigation.documentId,navigation.canvasId,navigation.originalSelection);
    return{documentId:navigation.documentId,canvasId:navigation.canvasId,scope:scope?.key===navigation.scopeKey?scope:null,readOnly:true};
  };
  return new AdaptiveProposalReviewController({
    scope:()=>currentDestination().scope,
    readPresentation:(operation,read)=>destination().receiptNavigation?.readPresentation?.(operation,read)??read(),
    source:executionId=>{const target=currentDestination();return target.readOnly&&!target.scope?null:store.adaptiveProposalSource(target.documentId,target.canvasId,executionId);},
    captureRead:()=>store.captureAdaptiveProposalRead(),
    readOriginal:executionId=>store.loadAdaptiveProposalOriginal(executionId),projection:()=>store.projection.get(),
    request:async body=>{
      const target=currentDestination(),scope=target.scope,read=["resume","retrieve","receipts"].includes(String(body.action));
      if(!scope||target.readOnly&&!read||body.projectId!==scope.projectId||body.documentId!==scope.documentId||body.canvasId!==scope.canvasId)throw new Error("adaptive_changes_scope_changed");
      if(prepare&&(body.action==="preview"||body.action==="apply")&&!await prepare())throw new Error("adaptive_changes_pending_writes");
      const current=currentDestination();if(current.scope?.key!==scope.key||current.readOnly&&!read)throw new Error("adaptive_changes_scope_changed");
      return store.guardedFetch("/api/context/adaptive/apply",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)},actionLabel());
    },
    openOutputRequirement:async(blockId,ownership)=>{
      const target=destination(),scope=adaptiveProposalScope(store,target.documentId,target.canvasId),authorization=store.captureAuthorizationScope();
      const route=store.route.get(),projection=store.projection.get(),client=store.outputRequirements;
      const block=projection.libraryBlocks.find(item=>item.id===blockId&&item.projectId===scope?.projectId&&item.documentId===scope?.documentId
        &&item.scope==="document"&&!item.removed&&isOutputContextType(item.type));
      if(!scope||!authorization||!client||!block||!ownership.current())return false;
      const sourceFocus=captureOutputNavigationFocus(document);
      let focus:OutputNavigationFocusLease|null=null;
      try{
        const blockIdentity=canonicalAdaptiveSelection(block),currentBlock=()=>store.projection.get().libraryBlocks
          .find(item=>item.id===blockId&&item.projectId===scope.projectId&&item.documentId===scope.documentId&&item.scope==="document"&&!item.removed);
        const sourceCurrent=()=>sourceFocus.current()&&ownership.current()&&store.route.get()===route&&store.authorizationScopeActive(authorization)
          &&store.projection.get()===projection&&canonicalAdaptiveSelection(currentBlock())===blockIdentity;
        if(client.resource(scope.documentId).state!=="ready")await client.ensure(scope.documentId);
        if(!sourceCurrent())return false;
        const resource=client.resource(scope.documentId),snapshot=resource.snapshot;
        if(resource.state!=="ready"||resource.accessLost||resource.privateUnavailable||!snapshot
          ||snapshot.projectId!==scope.projectId||snapshot.documentId!==scope.documentId||snapshot.scope.actorUserId!==scope.actorUserId
          ||snapshot.scope.projectAccessId!==(store.session.get()?.projectContext?.projectAccessId??null))return false;
        const reference=captureOutputNavigation(snapshot,authorization.key,"requirement",blockId);
        const document_=projection.documents.find(item=>item.id===scope.documentId&&item.projectId===scope.projectId&&!item.removed);
        if(!reference||!document_||!sourceCurrent())return false;
        // Only the owned native close may reset this gesture's focus baseline.
        // These three operations are synchronous: no newer input is adopted
        // across a read, route transition, animation frame or update boundary.
        sourceFocus.dispose();
        if(!ownership.close())return false;
        const retainedIdentity=()=>{
          const live=client.resource(scope.documentId),view=store.projection.get();
          return ownership.retained()&&store.authorizationScopeActive(authorization)
            &&view.projectId===scope.projectId
            &&view.documents.some(item=>item.id===scope.documentId&&item.projectId===scope.projectId&&!item.removed)
            &&canonicalAdaptiveSelection(currentBlock())===blockIdentity&&live.state==="ready"&&!live.accessLost&&!live.privateUnavailable
            &&outputNavigationMatches(reference,live.snapshot,store.captureAuthorizationScope()?.key??"")&&!document.querySelector("dialog[open]");
        };
        const destinationIdentity=()=>retainedIdentity()&&documentIdFromRoute(store.route.get())===scope.documentId
          &&documentContextBlockFromRoute(store.route.get())===blockId&&store.projection.get().documentId===scope.documentId;
        focus=captureOutputNavigationFocus(document,{
          // Deliberately excludes focus.current(): the shared predicate must
          // validate identity without recursively consulting its own lease.
          ownedRouteFocus:outputNavigationOwnedRouteFocus(document,store,reference,destinationIdentity),
        });
        const beforeTransition=()=>retainedIdentity()&&store.route.get()===route&&store.projection.get()===projection;
        if(!await store.transitionWorkspace(documentContextBlockRoute(scope.documentId,document_.title,blockId),{documentFocus:false,current:beforeTransition,focus}))return false;
        const arrived=store.route.get(),navigation=store.captureWorkspaceNavigationFocus(arrived,focus);
        const current=()=>destinationIdentity()&&store.route.get()===arrived&&Boolean(navigation?.current());
        // The intentional workspace transition may disconnect the old host.
        // Its exact destination and shared focus lease now own this opening.
        for(let attempt=0;attempt<24&&current();attempt++){
          await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));if(!current())return false;
          const controllers=[...document.querySelectorAll<FormaOutputRequirements>("forma-output-requirements")]
            .filter(item=>item.isConnected&&item.documentId===scope.documentId&&item.surface==="document"&&item.blockId===blockId);
          if(controllers.length>1)return false;
          if(controllers.length===1){await controllers[0].updateComplete;if(!current())return false;
            return await controllers[0].focusOutputReference(reference,{section:"inspect",current,focus});}
        }
        return false;
      }finally{sourceFocus.dispose();focus?.dispose();}
    },
    refresh:()=>store.refreshEvents(),changed,
  });
}
