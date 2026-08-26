import { html, nothing, type TemplateResult } from "lit";
import { BLOCK_TYPES, blockTypeDefinition, suggestedSubtype, type BlockKind } from "../model/block-types";
import { ACTION_PARTICIPANT_RELATION, CONTEXT_CONTAINS_RELATION, combinedContextRoleForBlockType, isContextCompositionRelation, normalizeActionBlockReferences } from "../model/combined-context";
import { appendDecompositionAddendum, researchBlockText, type ContextResearchArea, type ContextResearchReport, type ContextResearchSuggestion, type DecompositionPlan, type DecompositionProposal } from "../model/context-intelligence";
import type { CreativeBlock, EventInput } from "../model/events";
import { FormaElement, icon } from "./forma-element";
import { ensureModalDialog } from "./modal-dialog";
import "./context-intelligence.css";

type Workflow="decompose"|"research";
const slug=(value:string)=>value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu,"").replace(/[^a-z0-9]+/gu,"-").replace(/(^-|-$)/gu,"").slice(0,44)||"decision";

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

  protected override updated(){
    const dialog=this.renderRoot.querySelector<HTMLDialogElement>(".context-intelligence-dialog");
    if(this.#open&&dialog&&!dialog.open)ensureModalDialog(dialog);
    if(!this.#open&&dialog?.open)dialog.close();
  }

  #close(){this.#request+=1;this.#open=false;this.#mode=null;this.#working=false;this.#error=false;this.#plan=null;this.#report=null;this.#selected.clear();this.renderRoot.querySelector<HTMLDialogElement>("dialog")?.close();this.requestUpdate();}

  async #requestAnalysis(kind:Workflow,addedText=""){
    const authorization=this.store.captureAuthorizationScope(),projection=this.store.projection.get();
    if(!authorization||!projection.projectId||!projection.documentId)return null;
    const current=++this.#request,blockId=this.block.id;
    const response=await this.store.guardedFetch(`/api/context/${kind}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({blockId,documentId:this.block.documentId||projection.documentId,projectId:this.block.projectId||projection.projectId,...(addedText?{addedText,addedType:this.#additionType}:{})})},kind==="decompose"?this.i18n.t("context.intelligence.decompose"):this.i18n.t("context.intelligence.research"));
    if(!this.store.authorizationScopeActive(authorization)||current!==this.#request||this.block.id!==blockId)return null;
    const result=await response.json() as {plan?:DecompositionPlan;report?:ContextResearchReport;error?:string};
    if(!this.store.authorizationScopeActive(authorization)||current!==this.#request||this.block.id!==blockId)return null;
    if(!response.ok)throw new Error(result.error??"context_intelligence_failed");
    return result;
  }

  async #begin(kind:Workflow,auto=false){
    if(this.#working||this.block.locked&&kind==="decompose")return;
    this.#mode=kind;this.#open=!auto;this.#working=true;this.#error=false;this.#plan=null;this.#report=null;this.#selected.clear();this.requestUpdate();
    try{
      const result=await this.#requestAnalysis(kind);if(!result)return;
      if(kind==="decompose"&&result.plan){
        this.#plan=result.plan;for(const proposal of result.plan.proposals)this.#selected.add(proposal.id);
        if(auto){this.#working=false;await this.#applyDecomposition();return;}
      }else if(kind==="research"&&result.report){
        this.#report=result.report;
        for(const suggestion of [...result.report.inferred,...result.report.related,...result.report.learned])if(suggestion.area!=="learned"||suggestion.type!=="reference")this.#selected.add(suggestion.id);
      }else throw new Error("context_intelligence_invalid_response");
    }catch{this.#error=true;if(auto){this.#open=true;}}
    finally{this.#working=false;this.requestUpdate();}
  }

  #scope(target:CreativeBlock):Record<string,unknown>{
    return{project_id:target.projectId,...(target.scope==="library"?{scope:"library"}:target.scope==="canvas"?{scope:"canvas",canvas_id:target.canvasId}:{document_id:target.documentId,scope:"document"})};
  }

  #groupEvent(target:CreativeBlock):EventInput[]{
    if(target.properties.context_group)return[];
    const name=String(target.properties.label??target.handle??target.type).trim()||target.type;
    return[{type:"BlockPropertyEdited",payload:{...this.#scope(target),block_id:target.id,property_path:"context_group",old_value:null,new_value:{name,target:name,role:combinedContextRoleForBlockType(target.type),application:"isolate",relativity:Math.max(.5,Math.min(1,Number(target.properties.weight??.8)))},source_surface:`${this.surface}-context-intelligence`}}];
  }

  #relation(target:CreativeBlock,id:string,label:string,order:number):EventInput{
    return{type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),...this.#scope(target),from_block_id:target.id,to_block_id:id,kind:CONTEXT_CONTAINS_RELATION,properties:{member_order:order,relation_label:label,relativity:1},source_surface:`${this.surface}-context-intelligence`}};
  }

  #currentTarget(){return this.store.projection.get().libraryBlocks.find((block)=>block.id===this.block.id&&!block.removed&&!block.locked&&!block.properties.organization_context_package_binding_id);}

  #participants(proposal:DecompositionProposal,selected:DecompositionProposal[],ids:Map<string,string>){
    const projection=this.store.projection.get();
    return normalizeActionBlockReferences(proposal.participants.flatMap((participant)=>{
      const sought=slug(participant.handle.split("/").at(-1)??participant.handle);
      const proposed=selected.find((candidate)=>candidate.id!==proposal.id&&(slug(candidate.label)===sought||slug(candidate.text.replace(/^(?:a|an|the)\s+/iu,""))===sought));
      if(proposed){const id=ids.get(proposed.id);return id?[{block_id:id,handle:`${proposed.type}/${slug(proposed.label)}`,role:participant.role}]:[];}
      const existing=projection.libraryBlocks.find((candidate)=>candidate.projectId===this.block.projectId&&candidate.scope===this.block.scope&&candidate.documentId===this.block.documentId&&slug(candidate.handle.split("/").at(-1)??candidate.handle)===sought);
      return existing?[{block_id:existing.id,handle:existing.handle,role:participant.role}]:[];
    }));
  }

  async #applyDecomposition(){
    const target=this.#currentTarget(),plan=this.#plan,authorization=this.store.captureAuthorizationScope(),request=this.#request;
    if(!authorization||!target||!plan||plan.sourceBlockId!==target.id||researchBlockText(target)!==plan.sourceText){this.#error=true;this.requestUpdate();return;}
    const proposals=[...plan.proposals,...plan.addenda].filter((proposal)=>this.#selected.has(proposal.id));if(!proposals.length)return;
    const ids=new Map(proposals.map((proposal)=>[proposal.id,crypto.randomUUID()]));
    if(proposals.some((proposal)=>proposal.type==="action"&&this.#participants(proposal,proposals,ids).length!==proposal.participants.length)){this.#error=true;this.requestUpdate();return;}
    const previous=this.store.projection.get().libraryBlockRelations.filter((relation)=>isContextCompositionRelation(relation.kind)&&relation.fromBlockId===target.id).length;
    const events:EventInput[]=[...this.#groupEvent(target)];
    proposals.map((proposal,index)=>({proposal,index})).sort((left,right)=>Number(left.proposal.type==="action")-Number(right.proposal.type==="action")).forEach(({proposal,index})=>{
      const id=ids.get(proposal.id)!,references=proposal.type==="action"?this.#participants(proposal,proposals,ids):[];
      events.push({type:"BlockCreated",payload:{block_id:id,...this.#scope(target),type:proposal.type,handle:`${proposal.type}/${slug(proposal.label)}`,position:`z${String(this.store.head.get()+index+1).padStart(8,"0")}`,properties:{label:proposal.label,text:proposal.text,subtype:proposal.subtype,intent:"include",weight:.8,authority:"authored",context_detail:true,...(!proposal.addendum?{source_block_id:target.id}:{}),source_excerpt:proposal.sourceExcerpt,...(references.length?{block_references:references}:{})},source_surface:`${this.surface}-context-decomposition`}});
    });
    proposals.forEach((proposal,index)=>events.push(this.#relation(target,ids.get(proposal.id)!,proposal.label,previous+index)));
    proposals.filter((proposal)=>proposal.type==="action").forEach((proposal)=>{
      for(const reference of this.#participants(proposal,proposals,ids))events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),...this.#scope(target),from_block_id:ids.get(proposal.id),to_block_id:reference.block_id,kind:ACTION_PARTICIPANT_RELATION,properties:{participant_role:reference.role,handle:reference.handle},source_surface:`${this.surface}-context-decomposition`}});
    });
    this.#working=true;this.requestUpdate();
    if(!this.store.authorizationScopeActive(authorization)||request!==this.#request||this.#currentTarget()?.id!==target.id)return;
    const appended=await this.store.appendBatch(events,{rebaseAttempts:6});
    if(!this.store.authorizationScopeActive(authorization)||request!==this.#request||this.block.id!==target.id)return;
    if(appended.length)this.#close();else{this.#working=false;this.#error=true;this.requestUpdate();}
  }

  #wouldCreateCompositionCycle(targetId:string,candidateId:string){
    const seen=new Set<string>(),pending=[candidateId],relations=this.store.projection.get().libraryBlockRelations;
    for(const id of pending){if(id===targetId)return true;if(seen.has(id))continue;seen.add(id);for(const relation of relations)if(!relation.removed&&isContextCompositionRelation(relation.kind)&&relation.fromBlockId===id)pending.push(relation.toBlockId);}
    return false;
  }

  #researchParticipants(target:CreativeBlock,text:string){
    const projection=this.store.projection.get(),rootRole=target.type==="environment"?"location":target.type==="subject"?"actor":"target";
    const participants:Array<{block_id:string;handle:string;role:string}>=[{block_id:target.id,handle:target.handle,role:rootRole}];
    for(const match of text.matchAll(/@([\p{L}\p{N}_/-]+)/gu)){
      const sought=slug(match[1]?.split("/").at(-1)??"");
      const existing=projection.libraryBlocks.find((block)=>!block.removed&&block.id!==target.id&&block.projectId===target.projectId&&block.scope===target.scope&&block.documentId===target.documentId&&block.canvasId===target.canvasId&&(slug(block.handle.split("/").at(-1)??block.handle)===sought||slug(String(block.properties.label??""))===sought));
      if(existing)participants.push({block_id:existing.id,handle:existing.handle,role:existing.type==="environment"?"location":existing.type==="subject"?"counterparty":"target"});
    }
    return normalizeActionBlockReferences(participants);
  }

  async #addBlock(event:SubmitEvent){
    event.preventDefault();const source=this.#addition.trim(),plan=this.#plan;if(!source||!plan||this.#working)return;
    this.#working=true;this.#error=false;this.requestUpdate();
    try{
      const result=await this.#requestAnalysis("decompose",source);if(!result?.plan)return;
      const candidates=result.plan.proposals.length?result.plan.proposals:[{type:this.#additionType,subtype:suggestedSubtype(this.#additionType),label:source,text:source,source_excerpt:source,participants:[]}];
      const next=appendDecompositionAddendum(plan,source,candidates),added=next.addenda.slice(plan.addenda.length);
      this.#plan=next;for(const proposal of added)this.#selected.add(proposal.id);this.#addition="";
    }catch{this.#error=true;}finally{this.#working=false;this.requestUpdate();}
  }

  #updateProposal(id:string,key:"type"|"subtype"|"text"|"label",value:string){
    if(!this.#plan)return;
    const update=(proposal:DecompositionProposal)=>proposal.id!==id?proposal:{...proposal,[key]:value,...(key==="type"?{subtype:suggestedSubtype(value)}:{})} as DecompositionProposal;
    this.#plan={...this.#plan,proposals:this.#plan.proposals.map(update),addenda:this.#plan.addenda.map(update)};this.requestUpdate();
  }

  #toggle(id:string,checked:boolean){if(checked)this.#selected.add(id);else this.#selected.delete(id);this.requestUpdate();}

  async #applyResearch(){
    const target=this.#currentTarget(),report=this.#report,authorization=this.store.captureAuthorizationScope(),request=this.#request;if(!authorization||!target||!report||report.blockId!==target.id||this.#working)return;
    const active=()=>this.store.authorizationScopeActive(authorization)&&request===this.#request&&this.block.id===target.id&&this.#currentTarget()?.id===target.id;
    const selected=[...report.inferred,...report.related,...report.learned].filter((suggestion)=>this.#selected.has(suggestion.id)&&(suggestion.area!=="learned"||suggestion.type!=="reference"));if(!selected.length)return;
    this.#working=true;this.requestUpdate();
    const events:EventInput[]=[...this.#groupEvent(target)];
    let order=this.store.projection.get().libraryBlockRelations.filter((relation)=>isContextCompositionRelation(relation.kind)&&relation.fromBlockId===target.id).length;
    try{
      for(const suggestion of selected){
        if(!active())return;
        if(suggestion.blockId){
          let existing=this.store.projection.get().libraryBlocks.find((block)=>block.id===suggestion.blockId&&!block.locked&&!block.properties.organization_context_package_binding_id);if(!existing)continue;
          if(existing.id===target.id||this.#wouldCreateCompositionCycle(target.id,existing.id)||this.store.projection.get().libraryBlockRelations.some((relation)=>relation.fromBlockId===target.id&&relation.toBlockId===existing!.id))continue;
          if(target.scope==="document"&&(existing.scope!=="document"||existing.documentId!==target.documentId)){
            const copied=await this.store.copyLibraryBlockSet(existing.id,target.documentId,`${this.surface}-context-research`);if(!active())return;if(!copied)continue;
            existing=this.store.projection.get().libraryBlocks.find((block)=>block.id===copied.rootBlockId);if(!existing)continue;
          }else if(target.scope==="library"&&existing.scope!=="library"||target.scope==="canvas"&&(existing.scope!=="canvas"||existing.canvasId!==target.canvasId)){
            const id=crypto.randomUUID(),{block_references:_references,...copiedProperties}=existing.properties;events.push({type:"BlockCreated",payload:{block_id:id,...this.#scope(target),type:existing.type,handle:`${existing.handle}-copy-${id.slice(0,6)}`,position:`z${String(this.store.head.get()+events.length+1).padStart(8,"0")}`,properties:{...copiedProperties,authority:"authored",copied_from_block_id:existing.id},source_surface:`${this.surface}-context-research`}});
            events.push(this.#relation(target,id,suggestion.label,order++));continue;
          }
          events.push(this.#relation(target,existing.id,suggestion.label,order++));
        }else{
          const id=crypto.randomUUID(),references=suggestion.type==="action"?this.#researchParticipants(target,suggestion.text):[];events.push({type:"BlockCreated",payload:{block_id:id,...this.#scope(target),type:suggestion.type,handle:`${suggestion.type}/${slug(suggestion.text)}`,position:`z${String(this.store.head.get()+events.length+1).padStart(8,"0")}`,properties:{label:suggestion.label,text:suggestion.text,subtype:suggestion.subtype,intent:"include",weight:.75,authority:"authored",context_detail:true,...(suggestion.sourceUrl?{source_url:suggestion.sourceUrl}:{}),...(references.length?{block_references:references}:{}),created_from:"approved-context-research"},source_surface:`${this.surface}-context-research`}});events.push(this.#relation(target,id,suggestion.label,order++));
          for(const reference of references)events.push({type:"BlockRelationAdded",payload:{relation_id:crypto.randomUUID(),...this.#scope(target),from_block_id:id,to_block_id:reference.block_id,kind:ACTION_PARTICIPANT_RELATION,properties:{participant_role:reference.role,handle:reference.handle},source_surface:`${this.surface}-context-research`}});
        }
      }
      if(!active())return;
      const appended=events.some((event)=>event.type==="BlockCreated"||event.type==="BlockRelationAdded")?await this.store.appendBatch(events,{rebaseAttempts:6}):[];
      if(!active())return;
      if(appended.length)this.#close();else{this.#working=false;this.#error=true;this.requestUpdate();}
    }catch{this.#working=false;this.#error=true;this.requestUpdate();}
  }

  #proposal(proposal:DecompositionProposal):TemplateResult{
    const definition=blockTypeDefinition(proposal.type);
    return html`<article class=${`context-intelligence-proposal${proposal.addendum?" addendum":""}`}><header><label><input type="checkbox" .checked=${this.#selected.has(proposal.id)} aria-label=${this.i18n.t("context.intelligence.include")} @change=${(event:Event)=>this.#toggle(proposal.id,(event.currentTarget as HTMLInputElement).checked)}><input class="context-intelligence-label" .value=${proposal.label} @change=${(event:Event)=>this.#updateProposal(proposal.id,"label",(event.currentTarget as HTMLInputElement).value.trim())}></label></header><div class="context-intelligence-fields"><select aria-label=${this.i18n.t("field.setting")} .value=${proposal.type} @change=${(event:Event)=>this.#updateProposal(proposal.id,"type",(event.currentTarget as HTMLSelectElement).value)}>${BLOCK_TYPES.filter((item)=>item.type!=="reference").map((item)=>html`<option value=${item.type}>${this.i18n.system(item.label)}</option>`)}</select><select aria-label=${this.i18n.t("field.option")} .value=${proposal.subtype} @change=${(event:Event)=>this.#updateProposal(proposal.id,"subtype",(event.currentTarget as HTMLSelectElement).value)}>${definition?.subtypes.map((subtype)=>html`<option value=${subtype}>${this.i18n.system(subtype)}</option>`)}</select></div><textarea rows="2" .value=${proposal.text} @change=${(event:Event)=>this.#updateProposal(proposal.id,"text",(event.currentTarget as HTMLTextAreaElement).value.trim())}></textarea><small dir="auto">${proposal.sourceExcerpt}</small>${proposal.participants.length?html`<p class="context-intelligence-participants"><span>${this.i18n.t("context.intelligence.references")}</span>${proposal.participants.map((participant)=>html`<span>@${participant.handle}</span>`)}</p>`:nothing}</article>`;
  }

  #researchSuggestion(suggestion:ContextResearchSuggestion):TemplateResult{
    const reviewOnly=suggestion.area==="learned"&&suggestion.type==="reference"&&!suggestion.blockId;
    const knownSubtype=blockTypeDefinition(suggestion.type)?.subtypes.includes(suggestion.subtype);
    return html`<article class="context-intelligence-proposal context-intelligence-research-item"><header><label><input type="checkbox" .checked=${this.#selected.has(suggestion.id)} ?disabled=${reviewOnly||this.block.locked} aria-label=${this.i18n.t("context.intelligence.include")} @change=${(event:Event)=>this.#toggle(suggestion.id,(event.currentTarget as HTMLInputElement).checked)}><b>${this.i18n.system(blockTypeDefinition(suggestion.type)?.label??suggestion.type)}</b><small>${knownSubtype?this.i18n.system(suggestion.subtype):suggestion.subtype}</small></label></header>${suggestion.imageUrl?html`<img class="context-intelligence-reference-image" src=${suggestion.imageUrl} alt=${suggestion.text} loading="lazy" referrerpolicy="no-referrer">`:nothing}<p dir="auto">${suggestion.text}</p>${suggestion.reason?html`<small dir="auto">${suggestion.reason}</small>`:nothing}${suggestion.sourceUrl?html`<a href=${suggestion.sourceUrl} target="_blank" rel="noopener noreferrer">${this.i18n.t("context.intelligence.webSource")}</a>`:nothing}${suggestion.license?html`<small dir="auto">${suggestion.license}${suggestion.attribution?` · ${suggestion.attribution}`:""}</small>`:nothing}</article>`;
  }

  #section(area:ContextResearchArea,suggestions:ContextResearchSuggestion[]):TemplateResult{
    const description=area==="inferred"?"context.intelligence.inferredDescription":area==="related"?"context.intelligence.relatedDescription":"context.intelligence.learnedDescription";
    return html`<section class="context-intelligence-report-section"><header><div><h3>${this.i18n.t(`context.intelligence.${area}`)}</h3><p>${this.i18n.t(description)}</p></div><span>${this.i18n.number(suggestions.length)}</span></header>${suggestions.length?suggestions.map((suggestion)=>this.#researchSuggestion(suggestion)):html`<p>${this.i18n.t("context.intelligence.empty")}</p>`}</section>`;
  }

  #dialog(){
    if(!this.#open||!this.#mode)return nothing;
    const decomposition=this.#mode==="decompose",title=this.i18n.t(decomposition?"context.intelligence.review":"context.intelligence.research");
    return html`<dialog class="context-intelligence-dialog" closedby="any" aria-labelledby=${`context-intelligence-title-${this.block.id}`} @click=${(event:MouseEvent)=>{if(event.target===event.currentTarget)this.#close();}} @cancel=${(event:Event)=>{event.preventDefault();this.#close();}}><article><header class="context-intelligence-dialog-header"><div><h2 id=${`context-intelligence-title-${this.block.id}`}>${title}</h2><p>${this.i18n.t(decomposition?"context.intelligence.decomposeDescription":"context.intelligence.researchDescription")}</p></div><button type="button" class="icon-button" aria-label=${this.i18n.t("action.close")} @click=${()=>this.#close()}>${icon("close")}</button></header><main><section class="context-intelligence-source"><span>${this.i18n.t("context.intelligence.source")}</span><p dir="auto">${researchBlockText(this.block)}</p></section>${this.#working?html`<p class="context-intelligence-status" role="status">${this.i18n.t("context.intelligence.working")}</p>`:nothing}${this.#error?html`<p class="context-intelligence-error" role="alert">${this.i18n.t("context.intelligence.failed")}</p>`:nothing}${decomposition&&this.#plan?html`<section class="context-intelligence-report-section"><header><div><h3>${this.i18n.t("context.intelligence.proposals")}</h3><p>${this.i18n.t("context.intelligence.noChanges")}</p></div><span>${this.i18n.number(this.#plan.proposals.length)}</span></header>${this.#plan.proposals.length?this.#plan.proposals.map((proposal)=>this.#proposal(proposal)):html`<p>${this.i18n.t("context.intelligence.empty")}</p>`}</section>${this.#plan.addenda.length?html`<section class="context-intelligence-report-section"><header><div><h3>${this.i18n.t("context.intelligence.addendum")}</h3><p>${this.i18n.t("context.intelligence.addendumDescription")}</p></div><span>${this.i18n.number(this.#plan.addenda.length)}</span></header>${this.#plan.addenda.map((proposal)=>this.#proposal(proposal))}</section>`:nothing}<form class="context-intelligence-add" @submit=${(event:SubmitEvent)=>void this.#addBlock(event)}><label><span>${this.i18n.t("context.intelligence.add")}</span><input required .value=${this.#addition} placeholder=${this.i18n.t("context.intelligence.addPlaceholder")} @input=${(event:InputEvent)=>{this.#addition=(event.currentTarget as HTMLInputElement).value;}}></label><select aria-label=${this.i18n.t("field.setting")} .value=${this.#additionType} @change=${(event:Event)=>{this.#additionType=(event.currentTarget as HTMLSelectElement).value as BlockKind;}}>${BLOCK_TYPES.filter((item)=>item.type!=="reference").map((item)=>html`<option value=${item.type}>${this.i18n.system(item.label)}</option>`)}</select><button type="submit" class="button secondary compact" ?disabled=${this.#working}>${icon("plus")}</button></form>`:nothing}${!decomposition&&this.#report?html`${this.#section("inferred",this.#report.inferred)}${this.#section("related",this.#report.related)}${this.#section("learned",this.#report.learned)}${this.#report.learned.some((suggestion)=>suggestion.type==="reference")?html`<p class="context-intelligence-reference-notice">${this.i18n.t("context.intelligence.referenceNotice")}</p>`:nothing}`:nothing}</main><footer><button type="button" class="button ghost" @click=${()=>this.#close()}>${this.i18n.t("action.cancel")}</button>${decomposition?html`<button type="button" class="button secondary" ?disabled=${this.#working||!this.#plan?.proposals.length} title=${this.i18n.t("context.intelligence.autoHint")} @click=${()=>void this.#applyDecomposition()}>${this.i18n.t("context.intelligence.auto")}</button>`:nothing}<button type="button" class="button primary" ?disabled=${this.#working||!this.#selected.size||this.block.locked} @click=${()=>void(decomposition?this.#applyDecomposition():this.#applyResearch())}>${this.i18n.t("context.intelligence.apply")}</button></footer></article></dialog>`;
  }

  override render(){
    if(!this.block||this.block.properties.organization_context_package_binding_id||this.block.properties.source_evidence_hash)return nothing;
    return html`<div class=${`context-intelligence-actions${this.compact?" compact":""}`}><button type="button" class="button ghost compact" ?disabled=${this.block.locked||this.#working} @click=${()=>void this.#begin("decompose")}>${icon("branch")}${this.i18n.t("context.intelligence.decompose")}</button>${this.compact?nothing:html`<button type="button" class="button ghost compact" ?disabled=${this.block.locked||this.#working} title=${this.i18n.t("context.intelligence.autoHint")} @click=${()=>void this.#begin("decompose",true)}>${this.i18n.t("context.intelligence.auto")}</button>`}<button type="button" class="button ghost compact" ?disabled=${this.#working} @click=${()=>void this.#begin("research")}>${icon("search")}${this.i18n.t("context.intelligence.research")}</button></div>${this.#dialog()}`;
  }
}

if (!customElements.get("forma-context-intelligence")) customElements.define("forma-context-intelligence",ContextIntelligence);
declare global{interface HTMLElementTagNameMap{"forma-context-intelligence":ContextIntelligence}}
