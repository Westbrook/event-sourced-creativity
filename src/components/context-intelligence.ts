import { html, nothing, type TemplateResult } from "lit";
import { BLOCK_TYPES, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import { researchBlockText, type ContextResearchArea, type ContextResearchReport, type ContextResearchSuggestion, type DecompositionPlan, type DecompositionProposal } from "../model/context-intelligence";
import type { CreativeBlock } from "../model/events";
import type { CapturedAuthorizationScope } from "../state/store";
import { documentContextBlockFromRoute, documentContextBlockRoute, documentIdFromRoute } from "../model/routes";
import type { FormaOutputRequirementCard } from "./forma-output-requirement-card";
import { captureOutputNavigationFocus, outputNavigationOwnedRouteFocus } from "./output-navigation-focus";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import { contextConsentAction, contextConsentFailure, type ContextConsentAction } from "../model/context-consent-state";
import { consequentialPreview } from "./consequential-preview";
import type { ConsequentialPreview } from "../../worker/consequential-consent";
import type { AuthoringPreview } from "../../worker/authoring-commits";
import type { ContextProposalSelection } from "../model/context-proposal-application";
import { mergeContextAddendum, recoverContextReview } from "../model/context-review-state";
import { ACTION_REFERENCE_ROLES, type ActionReferenceRole } from "../model/combined-context";
import "./context-intelligence.css";

type Workflow="decompose"|"research";
type OutputEditorHandoff={authorization:CapturedAuthorizationScope;request:number;route:string;projectId:string;documentId:string;currentDocumentId:string;blockId:string;canvasId:string};

/** Approval-first, account-scoped context intelligence shared by document, library, and board blocks. */
export class ContextIntelligence extends FormaElement{
  static properties={block:{attribute:false},surface:{type:String},compact:{type:Boolean}};
  block!:CreativeBlock;
  surface="document";
  compact=false;
  #mode:Workflow|null=null;
  #open=false;
  #working=false;
  #error=false;
  #plan:DecompositionPlan|null=null;
  #report:ContextResearchReport|null=null;
  #selected=new Set<string>();
  #addition="";
  #additionType:BlockKind="subject";
  #request=0;
  #quote:(ConsequentialPreview&{providerAvailable:boolean})|null=null;
  #publicQuery="";
  #quoteAddition="";
  #quoteAdditionType:BlockKind="subject";
  #executionUncertain=false;
  #consentNotice="";
  #billingPending=false;
  #proposalSources=new Map<string,ContextProposalSelection&{original?:DecompositionProposal}>();
  #changes:AuthoringPreview|null=null;
  #saving=false;
  #savePending=false;
  #changeError="";
  #recovering=false;
  #recoveryFailed=false;
  #saveApplied=false;
  #changesStale=false;
  #outputEditorHandoff:OutputEditorHandoff|null=null;

  protected override updated(){
    if(this.#outputEditorHandoff&&!this.#outputHandoffCurrent(this.#outputEditorHandoff)){this.#outputEditorHandoff=null;this.requestUpdate();}
    const dialog=this.renderRoot.querySelector<HTMLDialogElement>(".context-intelligence-dialog");
    if(this.#open&&dialog&&!dialog.open)ensureModalDialog(dialog);
    if(!this.#open&&dialog?.open)dialog.close();
  }

  // Dismissal never dismisses the actor-private server review. Re-entry discovers it before any analysis.
  #close(){if(this.#saving)return;this.#outputEditorHandoff=null;this.#changes=null;this.#savePending=false;this.#changeError="";this.#recovering=false;this.#recoveryFailed=false;this.#saveApplied=false;this.#changesStale=false;this.#proposalSources.clear();this.#request+=1;this.#open=false;this.#mode=null;this.#working=false;this.#error=false;this.#plan=null;this.#report=null;this.#quote=null;this.#publicQuery="";this.#quoteAddition="";this.#executionUncertain=false;this.#billingPending=false;this.#consentNotice="";this.#selected.clear();this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();this.requestUpdate();}

  #outputHandoffTarget(authorization:CapturedAuthorizationScope,request:number):OutputEditorHandoff{
    const projection=this.store.projection.get();
    return{authorization,request,route:this.store.route.get(),projectId:this.block.projectId,documentId:this.block.documentId,currentDocumentId:projection.documentId,blockId:this.block.id,canvasId:this.block.canvasId};
  }
  #outputTargetCurrent(target:OutputEditorHandoff){
    const projection=this.store.projection.get(),session=this.store.session.get(),permissions=session?.projectContext?.permissions??session?.capabilities??[];
    const block=projection.libraryBlocks.find(candidate=>candidate.id===target.blockId);
    return this.store.authorizationScopeActive(target.authorization)&&permissions.includes("project.read")&&permissions.includes("project.author")
      &&projection.projectId===target.projectId&&projection.documents.some(document=>document.id===target.documentId&&document.projectId===target.projectId)
      &&Boolean(block&&!block.removed&&!block.locked&&block.type==="output"&&block.scope==="document"
        &&block.projectId===target.projectId&&block.documentId===target.documentId&&block.canvasId===target.canvasId);
  }
  #outputHandoffCurrent(target:OutputEditorHandoff){
    return this.isConnected&&this.#open&&target.request===this.#request&&target.route===this.store.route.get()
      &&this.store.projection.get().documentId===target.currentDocumentId&&this.block.id===target.blockId
      &&this.block.documentId===target.documentId&&this.block.projectId===target.projectId&&this.block.canvasId===target.canvasId&&this.#outputTargetCurrent(target);
  }
  async #openOutputEditor(target:OutputEditorHandoff){
    if(this.#outputEditorHandoff!==target||this.#working||this.#saving||!this.#outputHandoffCurrent(target))return;
    const targetDocument=this.store.projection.get().documents.find(candidate=>candidate.id===target.documentId)!;
    const destination=documentContextBlockRoute(target.documentId,targetDocument.title,target.blockId);
    const sourceEvents=this.block.sourceEvents.join("\u0000");
    this.#close();
    const request=this.#request;
    let arrivedRoute="";
    const targetCurrent=()=>!this.#open&&request===this.#request&&this.#outputTargetCurrent(target)
      &&this.store.projection.get().libraryBlocks.find(block=>block.id===target.blockId)?.sourceEvents.join("\u0000")===sourceEvents
      &&!document.querySelector("dialog[open]");
    const originalCurrent=()=>this.isConnected&&targetCurrent()&&this.store.route.get()===target.route
      &&this.store.projection.get().documentId===target.currentDocumentId;
    const destinationCurrent=()=>targetCurrent()&&(!arrivedRoute||this.store.route.get()===arrivedRoute)
      &&documentIdFromRoute(this.store.route.get())===target.documentId
      &&documentContextBlockFromRoute(this.store.route.get())===target.blockId
      &&this.store.projection.get().documentId===target.documentId;
    // Native close may restore its own opener synchronously; no await or new
    // user gesture occurs between that owned close and this focus baseline.
    const focus=captureOutputNavigationFocus(this.ownerDocument,{
      ownedRouteFocus:outputNavigationOwnedRouteFocus(this.ownerDocument,this.store,target,destinationCurrent),
    });
    try{
      if(!await this.store.openDocument(target.documentId,destination,this.surface,{current:originalCurrent,focus}))return;
      for(let attempts=0;attempts<24;attempts++){
        await new Promise<void>(resolve=>window.requestAnimationFrame(()=>resolve()));
        if(!focus.current()||!targetCurrent())return;
        if(!destinationCurrent()){if(!arrivedRoute&&originalCurrent())continue;return;}
        const route=this.store.route.get(),navigation=this.store.captureWorkspaceNavigationFocus(route,focus);
        const current=()=>destinationCurrent()&&Boolean(navigation?.current());
        if(!current())return;
        if(!arrivedRoute){arrivedRoute=route;this.store.patchUi({focusBlockId:target.blockId});}
        const card=[...document.querySelectorAll<FormaOutputRequirementCard>("forma-output-requirement-card")].find(candidate=>{
          const snapshot=candidate.snapshot;
          return candidate.isConnected&&snapshot?.requirementId===target.blockId&&snapshot.scope.projectId===target.projectId
            &&snapshot.scope.documentId===target.documentId&&snapshot.scope.authorizationScopeKey===target.authorization.key
            &&snapshot.canEdit&&!candidate.readOnlyReason&&candidate.getClientRects().length>0;
        });
        const edit=card&&[...card.querySelectorAll<HTMLButtonElement>(".output-requirement-header button")].find(button=>!button.disabled
          &&button.textContent?.trim()===this.i18n.t("output.requirement.edit")&&button.getClientRects().length>0);
        if(edit){
          focus.run(edit,()=>{
            if(!current()||!edit.isConnected)return false;
            edit.scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth",block:"center"});
            if(!current()||!edit.isConnected)return false;
            edit.focus({preventScroll:true});
            return current();
          });
          return;
        }
      }
    }catch{/* No fallback editor or mutation is started after a failed navigation. */}
    finally{focus.dispose();}
  }

  async #requestAnalysis(kind:Workflow,action:"quote"|ContextConsentAction,addedText=""){
    const authorization=this.store.captureAuthorizationScope(),projection=this.store.projection.get();
    if(!authorization||!projection.projectId||!projection.documentId)return null;
    const current=++this.#request,blockId=this.block.id;
    let response:Response,result:{quote?:ConsequentialPreview&{providerAvailable:boolean};plan?:DecompositionPlan;report?:ContextResearchReport;error?:string;status?:string;submission?:string;providerAvailable?:boolean;billingStatus?:string;executionId?:string;bindingHash?:string};
    try{
      response=await this.store.guardedFetch(`/api/context/${kind}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,blockId,documentId:this.block.documentId||projection.documentId,projectId:this.block.projectId||projection.projectId,canvasId:this.block.canvasId??null,publicQuery:this.#publicQuery,...(addedText?{addedText,addedType:this.#quoteAdditionType}:{}),...(action!=="quote"&&this.#quote?{executionId:this.#quote.executionId,approvedBindingHash:this.#quote.bindingHash}:{})})},kind==="decompose"?this.i18n.t("context.intelligence.decompose"):this.i18n.t("context.intelligence.research"));
      if(!this.store.authorizationScopeActive(authorization)||current!==this.#request||this.block.id!==blockId)return null;
      result=await response.json();
    }catch(error){
      if(!this.store.authorizationScopeActive(authorization)||current!==this.#request||this.block.id!==blockId)return null;
      if(action!=="quote")this.#consentFailure({transport:true});throw error;
    }
    if(!this.store.authorizationScopeActive(authorization)||current!==this.#request||this.block.id!==blockId)return null;
    if(!response.ok||result.status==="reserved"){if(action!=="quote"){
      if(result.quote)this.#quote=result.quote;
      this.#consentFailure(result);
    }throw new Error(result.error??"context_intelligence_failed");}
    return result;
  }

  #consentFailure(outcome:Parameters<typeof contextConsentFailure>[1]){
    const next=contextConsentFailure(this.#quote,outcome);this.#quote=next.quote;this.#executionUncertain=next.uncertain;this.#consentNotice=next.notice;
  }

  async #begin(kind:Workflow){
    if(this.#working)return;
    this.#outputEditorHandoff=null;this.#mode=kind;this.#open=true;this.#error=false;this.#plan=null;this.#report=null;this.#quote=null;this.#publicQuery="";this.#quoteAddition="";this.#executionUncertain=false;this.#billingPending=false;this.#selected.clear();this.#recovering=true;this.#recoveryFailed=false;this.requestUpdate();
    await this.#resumeReview();
  }

  async #resumeReview(){
    this.#recovering=true;this.#recoveryFailed=false;
    const status=await this.#requestChanges("resume");
    if(!this.#open)return;
    this.#recovering=false;this.#recoveryFailed=!status;
    if(status==="none"){
      if(this.block.locked&&this.#mode==="decompose")this.#changeError="context_changes_source_protected";
      else await this.#preview();
    }
    this.requestUpdate();
  }

  async #preview(){
    if(!this.#mode)return;
    this.#working=true;this.#error=false;this.#consentNotice="";this.requestUpdate();
    try{const result=await this.#requestAnalysis(this.#mode,"quote",this.#quoteAddition);if(result?.quote){this.#quote=result.quote;this.#executionUncertain=["reserved","submitting","uncertain"].includes(result.quote.status);this.#error=this.#executionUncertain;}}
    catch{this.#error=true;}finally{this.#working=false;this.requestUpdate();}
  }

  async #execute(){
    const kind=this.#mode,quote=this.#quote;if(!kind||!quote||this.#working)return;
    this.#working=true;this.#error=false;this.requestUpdate();
    try{
      const result=await this.#requestAnalysis(kind,contextConsentAction(quote.status,quote.providerAvailable).action,this.#quoteAddition);if(!result)return;
      if(!result.executionId||!result.bindingHash)throw new Error("context_intelligence_identity_missing");
      const executionId=result.executionId,bindingHash=result.bindingHash;
      const retain=(proposal:DecompositionProposal)=>{
        const id=`${executionId}:${proposal.id}`;
        this.#proposalSources.set(id,{executionId,bindingHash,proposalId:proposal.id,original:proposal});
        return{...proposal,id};
      };
      if(kind==="decompose"&&result.plan){
        const received=result.plan.proposals.map(retain);
        if(this.#quoteAddition&&this.#plan){
          const merged=mergeContextAddendum(this.#plan,received);this.#plan=merged.plan;
          for(const id of merged.addedIds)this.#selected.add(id);
          this.#addition="";this.#quoteAddition="";
        }else{this.#plan={...result.plan,proposals:received};for(const proposal of received)this.#selected.add(proposal.id);}
      }else if(kind==="research"&&result.report){
        const retainSuggestion=(suggestion:ContextResearchSuggestion)=>{
          const id=`${executionId}:${suggestion.id}`;this.#proposalSources.set(id,{executionId,bindingHash,proposalId:suggestion.id});
          if(suggestion.area!=="learned"||suggestion.type!=="reference")this.#selected.add(id);
          return{...suggestion,id};
        };
        this.#report={...result.report,inferred:result.report.inferred.map(retainSuggestion),related:result.report.related.map(retainSuggestion),learned:result.report.learned.map(retainSuggestion)};
      }else throw new Error("context_intelligence_invalid_response");
      this.#changes=null;
      this.#quote=null;this.#billingPending=result.billingStatus==="pending";
    }catch{this.#error=true;}
    finally{this.#working=false;this.requestUpdate();}
  }

  #invalidateChanges(){if(this.#saving||this.#savePending||this.#saveApplied)return;this.#changes=null;this.#changeError="";this.#changesStale=false;}
  async #addBlock(event:SubmitEvent){
    event.preventDefault();const source=this.#addition.trim();if(!source||!this.#plan||this.#working||this.#savePending||this.#saveApplied)return;
    this.#invalidateChanges();this.#quoteAddition=source;this.#quoteAdditionType=this.#additionType;this.#quote=null;await this.#preview();
  }
  #updateProposal(id:string,key:"type"|"subtype"|"text"|"label",value:string){
    if(!this.#plan||this.#working||this.#savePending||this.#saveApplied)return;this.#invalidateChanges();
    const update=(proposal:DecompositionProposal)=>proposal.id!==id?proposal:{...proposal,[key]:value,...(key==="type"?{subtype:suggestedSubtype(value)}:{})} as DecompositionProposal;
    this.#plan={...this.#plan,proposals:this.#plan.proposals.map(update),addenda:this.#plan.addenda.map(update)};this.requestUpdate();
  }
  #updateParticipants(id:string,participants:DecompositionProposal["participants"]){
    if(!this.#plan||this.#working||this.#savePending||this.#saveApplied)return;this.#invalidateChanges();
    const update=(proposal:DecompositionProposal)=>proposal.id===id?{...proposal,participants}:proposal;
    this.#plan={...this.#plan,proposals:this.#plan.proposals.map(update),addenda:this.#plan.addenda.map(update)};this.requestUpdate();
  }
  #toggle(id:string,checked:boolean){if(this.#working||this.#savePending||this.#saveApplied)return;this.#invalidateChanges();if(checked)this.#selected.add(id);else this.#selected.delete(id);this.requestUpdate();}
  #selections():ContextProposalSelection[]{
    return[...this.#selected].map((id)=>{
      const retained=this.#proposalSources.get(id);if(!retained)throw new Error("context_changes_source_missing");
      const {original,...selection}=retained,proposal=[...(this.#plan?.proposals??[]),...(this.#plan?.addenda??[])].find((item)=>item.id===id);
      if(original&&proposal&&(["type","subtype","label","text"].some((key)=>original[key as keyof DecompositionProposal]!==proposal[key as keyof DecompositionProposal])||JSON.stringify(original.participants)!==JSON.stringify(proposal.participants)))
        selection.edit={type:proposal.type,subtype:proposal.subtype,label:proposal.label,text:proposal.text,participants:proposal.participants};
      return selection;
    });
  }
  async #requestChanges(action:"preview"|"apply"|"retrieve"|"resume"|"dismiss"):Promise<string|undefined>{
    const authorization=this.store.captureAuthorizationScope(),projection=this.store.projection.get(),preview=this.#changes;
    if(!authorization||this.#working||!["preview","resume"].includes(action)&&!preview)return;
    const request=++this.#request,blockId=this.block.id,target=this.#outputHandoffTarget(authorization,request);this.#outputEditorHandoff=null;this.#working=true;this.#changeError="";
    if(action==="apply"){this.#saving=true;this.#savePending=true;}this.requestUpdate();
    try{
      const response=await this.store.guardedFetch("/api/context/apply",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action,projectId:this.block.projectId||projection.projectId,documentId:this.block.documentId||projection.documentId,canvasId:this.block.canvasId??null,blockId,
        ...(action==="preview"?{selections:this.#selections()}:action==="resume"?{}:{previewId:preview!.previewId,approvalHash:preview!.approvalHash})
      })},this.i18n.t("context.changes.preview"));
      const result=await response.json() as {status?:string;preview?:AuthoringPreview;error?:string;blockId?:string;stale?:boolean};
      if(!this.store.authorizationScopeActive(authorization)||request!==this.#request||blockId!==this.block.id)return;
      if(!response.ok){
        if(result.error==="output_requirement_endpoint_required"&&result.blockId===target.blockId&&this.#outputHandoffCurrent(target))this.#outputEditorHandoff=target;
        if(result.status==="not-applied"){this.#savePending=false;this.#changesStale=true;}
        if(result.status==="applying")this.#savePending=true;
        throw new Error(result.error??"context_changes_unavailable");
      }
      if(result.status==="dismissed"){this.#close();return result.status;}
      if(result.preview){
        this.#changes=result.preview;
        if(action==="resume"||action==="retrieve"){
          const recovered=recoverContextReview(result.preview);this.#mode=recovered.mode;this.#plan=recovered.plan;this.#report=recovered.report;this.#proposalSources=recovered.sources;this.#selected=recovered.selected;
        }
        this.requestUpdate();await this.updateComplete;this.renderRoot.querySelector<HTMLElement>(".context-change-preview h3")?.focus();
      }
      if(result.status==="applied"){
        this.#saveApplied=true;this.#savePending=false;this.#changesStale=false;
        await this.store.refreshEvents();
        if(!this.store.authorizationScopeActive(authorization)||request!==this.#request)return;
        return result.status;
      }
      this.#savePending=result.status==="applying";
      this.#changesStale=Boolean(result.stale);
      if(result.stale)this.#changeError="context_changes_stale";
      return result.status??(result.preview?"review":undefined);
    }catch(error){if(this.store.authorizationScopeActive(authorization)&&request===this.#request)this.#changeError=error instanceof Error?error.message:"context_changes_unavailable";}
    finally{
      if(this.store.authorizationScopeActive(authorization)&&request===this.#request){this.#saving=false;this.#working=false;this.requestUpdate();}
    }
  }
  #changesView(){
    const preview=this.#changes;if(!preview)return nothing;
    return html`<section class="context-change-preview" aria-labelledby=${`context-change-title-${this.block.id}`}>
      <h3 tabindex="-1" id=${`context-change-title-${this.block.id}`}>${this.i18n.t("context.changes.title")}</h3>
      <p role="status">${this.i18n.t(this.#saveApplied?"context.changes.applied":this.#savePending?"context.changes.applying":"context.changes.summary","",{blocks:this.i18n.number(preview.blockCount),relations:this.i18n.number(preview.relationCount)})}</p>
      <p>${this.i18n.t(this.#saveApplied?"context.changes.appliedHint":"context.changes.atomic")}</p>
      <ol>${preview.changes.map((change)=>html`<li><b>${this.i18n.t(`context.changes.${change.kind}`)} · <span dir="auto">${change.label}</span></b>${change.type?html`<small>${this.i18n.system(change.type)}</small>`:nothing}<p dir="auto">${change.kind==="group"?this.i18n.t("context.changes.isolate"):change.text}</p></li>`)}</ol>
      <details><summary>${this.i18n.t("context.changes.destination")}</summary><p>${preview.projectId} / ${preview.documentId}${preview.canvasId?` / ${preview.canvasId}`:""}</p><p>${preview.sourceHash}</p><p>${preview.expiresAt}</p><pre dir="ltr">${JSON.stringify(preview.events,null,2)}</pre></details>
    </section>`;
  }
  #proposalNumber(id:string){return this.i18n.number([...(this.#plan?.proposals??[]),...(this.#plan?.addenda??[])].findIndex((item)=>item.id===id)+1);}

  #proposal(proposal:DecompositionProposal):TemplateResult{
    const definition=blockTypeDefinition(proposal.type),number=this.#proposalNumber(proposal.id),disabled=this.#working||this.#savePending||this.#saveApplied;
    return html`<article class=${`context-intelligence-proposal${proposal.addendum?" addendum":""}`}>
      <header><label><input type="checkbox" .checked=${this.#selected.has(proposal.id)} ?disabled=${disabled} @change=${(event:Event)=>this.#toggle(proposal.id,(event.currentTarget as HTMLInputElement).checked)}>
        <span>${this.i18n.t("context.changes.include","",{number,label:proposal.label})}</span></label></header>
      <label><span>${this.i18n.t("context.changes.label","",{number})}</span><input class="context-intelligence-label" maxlength="160" ?disabled=${disabled} .value=${proposal.label} @input=${(event:InputEvent)=>this.#updateProposal(proposal.id,"label",(event.currentTarget as HTMLInputElement).value)}></label>
      <div class="context-intelligence-fields">
        <label><span>${this.i18n.t("context.changes.type","",{number})}</span><select ?disabled=${disabled} .value=${proposal.type} @change=${(event:Event)=>this.#updateProposal(proposal.id,"type",(event.currentTarget as HTMLSelectElement).value)}>${BLOCK_TYPES.filter((item)=>item.type!=="reference").map((item)=>html`<option value=${item.type}>${this.i18n.system(item.label)}</option>`)}</select></label>
        <label><span>${this.i18n.t("context.changes.subtype","",{number})}</span><select ?disabled=${disabled} .value=${proposal.subtype} @change=${(event:Event)=>this.#updateProposal(proposal.id,"subtype",(event.currentTarget as HTMLSelectElement).value)}>${definition?.subtypes.map((subtype)=>html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}</select></label>
      </div>
      <label><span>${this.i18n.t("context.changes.text","",{number})}</span><textarea rows="3" maxlength="1800" dir="auto" ?disabled=${disabled} .value=${proposal.text} @input=${(event:InputEvent)=>this.#updateProposal(proposal.id,"text",(event.currentTarget as HTMLTextAreaElement).value)}></textarea></label>
      <small dir="auto">${proposal.sourceExcerpt}</small>
      ${proposal.type==="action"?html`<fieldset class="context-intelligence-participants" ?disabled=${disabled}><legend>${this.i18n.t("context.changes.participants","",{number})}</legend><p>${this.i18n.t("context.changes.participantHint")}</p>
        ${proposal.participants.map((participant,index)=>html`<div class="context-participant-row"><label><span>${this.i18n.t("context.changes.participantHandle","",{number,index:this.i18n.number(index+1)})}</span><input maxlength="96" dir="auto" .value=${participant.handle} @input=${(event:InputEvent)=>this.#updateParticipants(proposal.id,proposal.participants.map((item,at)=>at===index?{...item,handle:(event.currentTarget as HTMLInputElement).value}:item))}></label>
        <label><span>${this.i18n.t("context.changes.participantRole","",{number,index:this.i18n.number(index+1)})}</span><select .value=${participant.role} @change=${(event:Event)=>this.#updateParticipants(proposal.id,proposal.participants.map((item,at)=>at===index?{...item,role:(event.currentTarget as HTMLSelectElement).value as ActionReferenceRole}:item))}>${ACTION_REFERENCE_ROLES.map((role)=>html`<option value=${role}>${this.i18n.t(`context.changes.role.${role}`)}</option>`)}</select></label>
        <button type="button" class="button ghost" aria-label=${this.i18n.t("context.changes.participantRemove","",{number,index:this.i18n.number(index+1)})} @click=${()=>this.#updateParticipants(proposal.id,proposal.participants.filter((_,at)=>at!==index))}>${icon("close")}</button></div>`)}
        <button type="button" class="button secondary" ?disabled=${disabled||proposal.participants.length>=8} @click=${()=>this.#updateParticipants(proposal.id,[...proposal.participants,{handle:"",role:"actor"}])}>${this.i18n.t("context.changes.participantAdd","",{number})}</button></fieldset>`:nothing}
    </article>`;
  }

  #researchSuggestion(suggestion:ContextResearchSuggestion):TemplateResult{
    const reviewOnly=suggestion.area==="learned"&&suggestion.type==="reference"&&!suggestion.blockId;
    const suggestions=[...(this.#report?.inferred??[]),...(this.#report?.related??[]),...(this.#report?.learned??[])],number=this.i18n.number(suggestions.findIndex((item)=>item.id===suggestion.id)+1);
    const knownSubtype=blockTypeDefinition(suggestion.type)?.subtypes.includes(suggestion.subtype);
    return html`<article class="context-intelligence-proposal context-intelligence-research-item"><header><label><input type="checkbox" .checked=${this.#selected.has(suggestion.id)} ?disabled=${reviewOnly||this.block.locked||this.#working||this.#savePending||this.#saveApplied} aria-label=${this.i18n.t("context.changes.include","",{number,label:suggestion.label})} @change=${(event:Event)=>this.#toggle(suggestion.id,(event.currentTarget as HTMLInputElement).checked)}><b>${this.i18n.system(blockTypeDefinition(suggestion.type)?.label??suggestion.type)}</b><small>${knownSubtype?this.i18n.system(suggestion.subtype):suggestion.subtype}</small></label></header>${suggestion.imageUrl?html`<img class="context-intelligence-reference-image" src=${suggestion.imageUrl} alt=${suggestion.text} loading="lazy" referrerpolicy="no-referrer">`:nothing}<p dir="auto">${suggestion.text}</p>${suggestion.reason?html`<small dir="auto">${suggestion.reason}</small>`:nothing}${suggestion.sourceUrl?html`<a href=${suggestion.sourceUrl} target="_blank" rel="noopener noreferrer">${this.i18n.t("context.intelligence.webSource")}</a>`:nothing}${suggestion.license?html`<small dir="auto">${suggestion.license}${suggestion.attribution?` · ${suggestion.attribution}`:""}</small>`:nothing}</article>`;
  }

  #section(area:ContextResearchArea,suggestions:ContextResearchSuggestion[]):TemplateResult{
    const description=area==="inferred"?"context.intelligence.inferredDescription":area==="related"?"context.intelligence.relatedDescription":"context.intelligence.learnedDescription";
    return html`<section class="context-intelligence-report-section"><header><div><h3>${this.i18n.t(`context.intelligence.${area}`)}</h3><p>${this.i18n.t(description)}</p></div><span>${this.i18n.number(suggestions.length)}</span></header>${suggestions.length?suggestions.map((suggestion)=>this.#researchSuggestion(suggestion)):html`<p>${this.i18n.t("context.intelligence.empty")}</p>`}</section>`;
  }

  #consentView(){
    if(this.#outputEditorHandoff||this.#recovering||this.#recoveryFailed||this.#changes||this.#saveApplied||this.block.locked&&this.#mode==="decompose"||(this.#plan||this.#report)&&!this.#quoteAddition)return nothing;
    const quote=this.#quote;
    return html`<section class="context-consent" aria-labelledby=${`context-consent-title-${this.block.id}`}><h3 id=${`context-consent-title-${this.block.id}`}>${this.i18n.t("context.consent.title")}</h3><p>${this.i18n.t("context.consent.description")}</p>
      ${this.#quoteAddition?html`<p dir="auto">${this.#quoteAddition}</p>`:nothing}
      ${this.#mode==="research"?html`<label><span>${this.i18n.t("context.consent.publicQuery")}</span><input aria-label=${this.i18n.t("context.consent.publicQuery")} aria-describedby=${`context-public-hint-${this.block.id}`} maxlength="140" .value=${this.#publicQuery} ?disabled=${this.#working||Boolean(this.#quote&&["reserved","submitting","uncertain"].includes(this.#quote.status))} @input=${(event:InputEvent)=>{this.#publicQuery=(event.currentTarget as HTMLInputElement).value;this.#quote=null;this.requestUpdate();}}><small id=${`context-public-hint-${this.block.id}`}>${this.i18n.t("context.consent.publicHint")}</small></label>`:nothing}
      ${quote?consequentialPreview(quote,this.i18n):nothing}
      ${!quote?html`<button type="button" class="button secondary" ?disabled=${this.#working} @click=${()=>void this.#preview()}>${this.i18n.t("context.consent.preview")}</button>`:nothing}
    </section>`;
  }

  #dialog(){
    if(!this.#open||!this.#mode)return nothing;
    const decomposition=this.#mode==="decompose",title=this.i18n.t(decomposition?"context.intelligence.review":"context.intelligence.research");
    const outputEditor=this.#outputEditorHandoff&&this.#outputHandoffCurrent(this.#outputEditorHandoff)?this.#outputEditorHandoff:null;
    return html`<dialog class="context-intelligence-dialog" closedby="any" aria-labelledby=${`context-intelligence-title-${this.block.id}`} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}}><article><header class="context-intelligence-dialog-header"><div><h2 id=${`context-intelligence-title-${this.block.id}`}>${title}</h2><p>${this.i18n.t(decomposition?"context.intelligence.decomposeDescription":"context.intelligence.researchDescription")}</p></div><button type="button" class="icon-button" aria-label=${this.i18n.t("action.close")} ?disabled=${this.#saving} @click=${()=>this.#close()}>${icon("close")}</button></header><div class="context-intelligence-body"><section class="context-intelligence-source"><span>${this.i18n.t("context.intelligence.source")}</span><p dir="auto">${this.#changes?.review?.sourceText??researchBlockText(this.block)}</p></section>${this.#consentView()}${this.#working?html`<p class="context-intelligence-status" role="status">${this.i18n.t("context.intelligence.working")}</p>`:nothing}${this.#error?html`<p class="context-intelligence-error" role="alert">${this.i18n.t(this.#executionUncertain?"context.consent.uncertain":this.#consentNotice==="refresh"?"context.consent.refresh":this.#consentNotice==="not-submitted"?"context.consent.notSubmitted":"context.intelligence.failed")}</p>`:nothing}${this.#billingPending?html`<p class="context-intelligence-status" role="status">${this.i18n.t("context.consent.billingPending")}</p>`:nothing}${decomposition&&this.#plan?html`<section class="context-intelligence-report-section"><header><div><h3>${this.i18n.t("context.intelligence.proposals")}</h3><p>${this.i18n.t("context.intelligence.noChanges")}</p></div><span>${this.i18n.number(this.#plan.proposals.length)}</span></header>${this.#plan.proposals.length?this.#plan.proposals.map((proposal)=>this.#proposal(proposal)):html`<p>${this.i18n.t("context.intelligence.empty")}</p>`}</section>${this.#plan.addenda.length?html`<section class="context-intelligence-report-section"><header><div><h3>${this.i18n.t("context.intelligence.addendum")}</h3><p>${this.i18n.t("context.intelligence.addendumDescription")}</p></div><span>${this.i18n.number(this.#plan.addenda.length)}</span></header>${this.#plan.addenda.map((proposal)=>this.#proposal(proposal))}</section>`:nothing}<form class="context-intelligence-add" @submit=${(event:SubmitEvent)=>void this.#addBlock(event)}><label><span>${this.i18n.t("context.intelligence.add")}</span><input required maxlength="1800" ?disabled=${this.#working||this.#savePending||this.#saveApplied} .value=${this.#addition} placeholder=${this.i18n.t("context.intelligence.addPlaceholder")} @input=${(event:InputEvent)=>{this.#addition=(event.currentTarget as HTMLInputElement).value;}}></label><select aria-label=${this.i18n.t("context.changes.addType")} ?disabled=${this.#working||this.#savePending||this.#saveApplied} .value=${this.#additionType} @change=${(event:Event)=>{this.#additionType=(event.currentTarget as HTMLSelectElement).value as BlockKind;}}>${BLOCK_TYPES.filter((item)=>item.type!=="reference").map((item)=>html`<option value=${item.type}>${this.i18n.system(item.label)}</option>`)}</select><button type="submit" class="button secondary compact" aria-label=${this.i18n.t("context.changes.addPreview")} ?disabled=${this.#working||this.#savePending||this.#saveApplied}>${icon("plus")}</button></form>`:nothing}${!decomposition&&this.#report?html`${this.#section("inferred",this.#report.inferred)}${this.#section("related",this.#report.related)}${this.#section("learned",this.#report.learned)}${this.#report.learned.some((suggestion)=>suggestion.type==="reference")?html`<p class="context-intelligence-reference-notice">${this.i18n.t("context.intelligence.referenceNotice")}</p>`:nothing}`:nothing}${this.#changesView()}${this.#changeError?html`<p role="alert" class="context-intelligence-error">${this.i18n.t(this.#savePending?"context.changes.uncertain":this.#recoveryFailed?"context.changes.recoveryFailed":/participant/.test(this.#changeError)?"context.changes.participantError":this.#changesStale?"context.changes.stale":"context.changes.failed")}</p>`:nothing}</div><footer>
      <button type="button" class="button ghost" ?disabled=${this.#saving} @click=${()=>this.#close()}>${this.i18n.t(this.#savePending||this.#saveApplied?"action.close":"action.cancel")}</button>
      ${!outputEditor&&this.#quote?html`<button type="button" class="button primary" ?disabled=${this.#working||contextConsentAction(this.#quote.status,this.#quote.providerAvailable).disabled} @click=${()=>void this.#execute()}>${this.i18n.t(contextConsentAction(this.#quote.status,this.#quote.providerAvailable).label)}</button>`:nothing}
      ${outputEditor?html`<button type="button" class="button primary" ?disabled=${this.#working||this.#saving} @click=${()=>void this.#openOutputEditor(outputEditor)}>${this.i18n.t("output.requirement.edit")}</button>`:nothing}
      ${!outputEditor&&this.#recoveryFailed?html`<button type="button" class="button primary" ?disabled=${this.#working} @click=${()=>void this.#resumeReview()}>${this.i18n.t("context.changes.resume")}</button>`:nothing}
      ${this.#changes&&!this.#savePending?html`<button type="button" class=${this.#saveApplied?"button primary":"button ghost"} ?disabled=${this.#working} @click=${()=>void this.#requestChanges("dismiss")}>${this.i18n.t(this.#saveApplied?"context.changes.done":"context.changes.dismiss")}</button>`:nothing}
      ${!outputEditor&&!this.#quote&&!this.#saveApplied&&(this.#plan||this.#report)?html`<button type="button" class="button primary" ?disabled=${this.#working||Boolean(this.#quoteAddition)||!this.#savePending&&(!this.#selected.size||this.block.locked)} @click=${()=>void this.#requestChanges(this.#savePending?"retrieve":this.#changes&&!this.#changesStale?"apply":"preview")}>${this.i18n.t(this.#savePending?"context.changes.retrieve":this.#changes&&!this.#changesStale?"context.changes.confirm":"context.changes.preview")}</button>`:nothing}
    </footer></article></dialog>`;
  }

  override render(){
    if(!this.block||this.block.properties.organization_context_package_binding_id||this.block.properties.source_evidence_hash)return nothing;
    return html`<div class=${`context-intelligence-actions${this.compact?" compact":""}`}><button type="button" class="button ghost compact" ?disabled=${this.#working} @click=${()=>void this.#begin("decompose")}>${icon("branch")}${this.i18n.t("context.intelligence.decompose")}</button><button type="button" class="button ghost compact" ?disabled=${this.#working} @click=${()=>void this.#begin("research")}>${icon("search")}${this.i18n.t("context.intelligence.research")}</button></div>${this.#dialog()}`;
  }
}

if (!customElements.get("forma-context-intelligence")) customElements.define("forma-context-intelligence",ContextIntelligence);
declare global{interface HTMLElementTagNameMap{"forma-context-intelligence":ContextIntelligence}}
