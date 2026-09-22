import { blockTypeDefinition, isBlockKind } from "./block-types.ts";
import { copyOutputRequirementBlock } from "./output-requirement-copy.ts";
import { ACTION_PARTICIPANT_RELATION, ACTION_REFERENCE_ROLES, CONTEXT_CONTAINS_RELATION, combinedContextMemberships, combinedContextRoleForBlockType, isContextCompositionRelation, normalizeActionBlockReferences, validateContextCompositionGraph } from "./combined-context.ts";
import { creativeContextRightsIssue } from "./context-health.ts";
import { researchBlockText, type ContextResearchSuggestion, type DecompositionProposal } from "./context-intelligence.ts";
import type { CreativeBlock, CreativeProjection, EventInput } from "./events.ts";

export type ContextProposalSelection={executionId:string;bindingHash:string;proposalId:string;edit?:{type?:string;subtype?:string;label?:string;text?:string;participants?:DecompositionProposal["participants"]}};
export type ApprovedContextProposal={key:string;executionId:string;proposalId:string;decomposition?:DecompositionProposal;research?:ContextResearchSuggestion;edit?:ContextProposalSelection["edit"]};
export type ContextChange={kind:"create"|"copy"|"link"|"group"|"participant"|"edit"|"place";label:string;text:string;type?:string;sourceId?:string;targetId?:string};
export type ContextApplicationPlan={events:EventInput[];changes:ContextChange[];blockIds:string[];relationCount:number};
const participantKey=(value:string)=>value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/gu,"").replace(/[^\p{L}\p{N}]+/gu,"-").replace(/(^-|-$)/gu,"");
const participantMentions=(text:string)=>[...text.normalize("NFC").matchAll(/@([\p{L}\p{M}\p{N}_/-]+)/gu)].map((match)=>participantKey(match[1].split("/").at(-1)??match[1]));
const slug=(value:string)=>participantKey(value).slice(0,44)||"decision";
const sameScope=(a:CreativeBlock,b:CreativeBlock)=>a.projectId===b.projectId&&a.scope===b.scope&&(a.scope==="document"?a.documentId===b.documentId:a.scope==="canvas"?a.canvasId===b.canvasId:true);
const protectedBlock=(block:CreativeBlock)=>block.removed||block.locked||block.type==="model3d"||Boolean(block.properties.model_url)||Boolean(block.properties.source_evidence_hash)||Object.keys(block.properties).some((key)=>key.startsWith("organization_context_package_")||key==="organization_context_source_block_id")||Boolean(creativeContextRightsIssue(block.properties));
const labelOf=(block:CreativeBlock)=>String(block.properties.label??block.handle??block.type);

/** Server-resolved proposals only. IDs and the exact entire plan are retained before human confirmation. */
export function buildContextApplicationPlan(input:{projection:CreativeProjection;target:CreativeBlock;proposals:ApprovedContextProposal[];createId?:()=>string}):ContextApplicationPlan{
  const {projection,target,proposals}=input,createId=input.createId??(()=>crypto.randomUUID());
  if(protectedBlock(target)||!proposals.length||proposals.length>48)throw new Error("context_changes_unavailable");
  const available=new Map(projection.libraryBlocks.filter((block)=>!block.removed&&block.projectId===target.projectId).map((block)=>[block.id,block]));
  const scope={project_id:target.projectId,scope:target.scope,...(target.scope==="document"?{document_id:target.documentId}:target.scope==="canvas"?{canvas_id:target.canvasId}:{})};
  const events:EventInput[]=[],relations:EventInput[]=[],changes:ContextChange[]=[],blockIds:string[]=[];
  const roots=new Map<string,string>(),newProposals=new Map<string,DecompositionProposal>(),copied=new Map<string,string>();
  const liveRelations=projection.libraryBlockRelations.filter((relation)=>!relation.removed&&relation.projectId===target.projectId);
  const position=()=>`z${String(projection.libraryBlocks.length+blockIds.length+1).padStart(8,"0")}`;
  const addRelation=(from:string,to:string,kind:string,properties:Record<string,unknown>)=>relations.push({type:"BlockRelationAdded",payload:{...scope,relation_id:createId(),from_block_id:from,to_block_id:to,kind,properties,source_surface:"approved-context-proposal"}});
  let order=liveRelations.filter((relation)=>isContextCompositionRelation(relation.kind)&&relation.fromBlockId===target.id).reduce((maximum,relation)=>Math.max(maximum,Number(relation.properties.member_order??0)+1),0);
  const groupName=labelOf(target);
  if(!target.properties.context_group){
    const group={name:groupName,target:groupName,role:combinedContextRoleForBlockType(target.type),application:"isolate",relativity:Math.max(.5,Math.min(1,Number(target.properties.weight??.8)))};
    events.push({type:"BlockPropertyEdited",payload:{...scope,block_id:target.id,property_path:"context_group",old_value:null,new_value:group,source_surface:"approved-context-proposal"}});
    changes.push({kind:"group",label:groupName,text:"isolate",type:group.role,targetId:target.id});
  }
  for(const item of proposals){
    if(item.decomposition){
      const original=item.decomposition,edit=item.edit??{},proposal={...original,...edit};
      if(!isBlockKind(proposal.type)||(proposal.type==="reference"||proposal.type==="model3d")||!blockTypeDefinition(proposal.type)?.subtypes.includes(proposal.subtype)
        ||!proposal.text?.trim()||!proposal.label?.trim()||proposal.text.length>1800||proposal.label.length>160)throw new Error("context_changes_invalid_edit");
      if(proposal.type==="action"){
        const mentions=participantMentions(proposal.text);
        const handles=proposal.participants.map((participant)=>participantKey(participant.handle.split("/").at(-1)??participant.handle));
        const words=participantKey(proposal.text);
        if(proposal.participants.length>8||proposal.participants.some((participant)=>!participant.handle.trim()||!ACTION_REFERENCE_ROLES.includes(participant.role))
          ||mentions.some((handle)=>!handles.includes(handle))||handles.some((handle)=>!(`-${words}-`).includes(`-${handle}-`)))throw new Error("context_changes_participants_review_required");
      }
      newProposals.set(item.key,proposal as DecompositionProposal);roots.set(item.key,createId());
    }else if(item.research?.blockId){
      if(item.edit)throw new Error("context_changes_existing_edit_forbidden");
      const existing=available.get(item.research.blockId);if(!existing||protectedBlock(existing))throw new Error("context_changes_source_protected");
      if(sameScope(target,existing))roots.set(item.key,existing.id);
      else{
        const pending=[existing.id],closure=new Set<string>();
        for(const id of pending){
          if(closure.has(id))continue;const block=available.get(id);if(!block||protectedBlock(block))throw new Error("context_changes_dependency_unavailable");
          closure.add(id);if(closure.size>100)throw new Error("context_changes_too_large");
          for(const relation of liveRelations)if(relation.fromBlockId===id)pending.push(relation.toBlockId);
          for(const reference of normalizeActionBlockReferences(block.properties.block_references))pending.push(reference.block_id);
          if(typeof block.properties.context_set_root_id==="string"&&block.properties.context_set_root_id)pending.push(block.properties.context_set_root_id);
          const groups=new Set(combinedContextMemberships(block.properties).map((membership)=>membership.contextSetId));
          if(groups.size)for(const candidate of available.values())if(combinedContextMemberships(candidate.properties).some((membership)=>groups.has(membership.contextSetId)))pending.push(candidate.id);
        }
        for(const id of closure)if(!copied.has(id))copied.set(id,createId());
        roots.set(item.key,copied.get(existing.id)!);
      }
    }else if(item.research){
      if(item.research.area!=="learned"||(item.research.type==="reference"||item.research.type==="model3d"))throw new Error("context_changes_review_only");
      if(item.edit&&(Object.keys(item.edit).some(key=>key!=="label")||typeof item.edit.label!=="string"||!item.edit.label.trim()||item.edit.label.trim().length>160))throw new Error("context_changes_invalid_edit");
      roots.set(item.key,createId());
    }else throw new Error("context_changes_proposal_missing");
  }

  // Copy the complete explicit dependency closure. Do not synthesize new isolation metadata for the copied set.
  const contextIds=new Map<string,string>(),contextId=(value:unknown)=>{if(typeof value!=="string"||!value)return value;if(!contextIds.has(value))contextIds.set(value,createId());return contextIds.get(value);};
  const deferred:EventInput[]=[];
  for(const [sourceId,id]of copied){
    const source=available.get(sourceId)!,copiedBlock=copyOutputRequirementBlock(source,id,copied);
    const properties:Record<string,unknown>={...copiedBlock.properties,authority:"authored",copied_from_block_id:sourceId};
    for(const key of ["context_set_id","reference_set_id"])if(properties[key])properties[key]=contextId(properties[key]);
    if(typeof properties.context_set_root_id==="string"){
      const root=copied.get(properties.context_set_root_id);if(!root)throw new Error("context_changes_dependency_unavailable");properties.context_set_root_id=root;
    }
    const remapMembership=(value:unknown)=>{if(!value||typeof value!=="object"||Array.isArray(value))return value;const membership=value as Record<string,unknown>;return{...membership,...(membership.contextSetId?{contextSetId:contextId(membership.contextSetId)}:{}),...(membership.context_set_id?{context_set_id:contextId(membership.context_set_id)}:{})};};
    if(Array.isArray(properties.combined_context_memberships))properties.combined_context_memberships=properties.combined_context_memberships.map(remapMembership);
    if(properties.combined_context)properties.combined_context=remapMembership(properties.combined_context);
    const references=normalizeActionBlockReferences(properties.block_references).map((reference)=>({...reference,block_id:copied.get(reference.block_id)!}));
    if(references.some((reference)=>!reference.block_id))throw new Error("context_changes_dependency_unavailable");
    if(references.length){properties.block_references=[];deferred.push({type:"BlockPropertyEdited",payload:{...scope,block_id:id,property_path:"block_references",old_value:[],new_value:references,source_surface:"approved-context-proposal"}});}
    events.push({type:"BlockCreated",payload:{...scope,block_id:id,type:copiedBlock.type,handle:`${source.handle}-copy-${id.slice(0,6)}`,position:position(),properties,source_surface:"approved-context-proposal"}});blockIds.push(id);
    changes.push({kind:"copy",label:labelOf(source),text:researchBlockText(source),type:source.type,sourceId,targetId:id});
  }
  for(const relation of liveRelations)if(copied.has(relation.fromBlockId)&&copied.has(relation.toBlockId)){
    const properties={...relation.properties,copied_from_relation_id:relation.id};if("context_set_id"in properties)properties.context_set_id=contextId(properties.context_set_id);
    addRelation(copied.get(relation.fromBlockId)!,copied.get(relation.toBlockId)!,relation.kind,properties);
    changes.push({kind:relation.kind===ACTION_PARTICIPANT_RELATION?"participant":"link",label:labelOf(available.get(relation.fromBlockId)!),text:labelOf(available.get(relation.toBlockId)!),type:relation.kind,sourceId:relation.fromBlockId,targetId:relation.toBlockId});
  }
  for(const item of proposals){
    const proposal=newProposals.get(item.key),suggestion=item.research&&item.edit?.label!==undefined?{...item.research,label:item.edit.label.trim()}:item.research,id=roots.get(item.key)!;
    if(proposal||suggestion&&!suggestion.blockId){
      const detail=proposal??suggestion!,references:Array<{block_id:string;handle:string;role:string}>=[];
      if(proposal?.type==="action")for(const participant of proposal.participants){
        const sought=participantKey(participant.handle.split("/").at(-1)??participant.handle);
        const proposed=[...newProposals].filter(([key,candidate])=>key!==item.key&&participantKey(candidate.label)===sought);
        const existing=[...available.values()].filter((candidate)=>sameScope(target,candidate)&&!protectedBlock(candidate)&&participantKey(candidate.handle.split("/").at(-1)??candidate.handle)===sought);
        if(proposed.length+existing.length!==1)throw new Error("context_changes_participant_unresolved");
        const match=proposed[0];references.push(match?{block_id:roots.get(match[0])!,handle:`${match[1].type}/${slug(match[1].label)}`,role:participant.role}:{block_id:existing[0].id,handle:existing[0].handle,role:participant.role});
      }
      if(suggestion?.type==="action"){
        references.push({block_id:target.id,handle:target.handle,role:target.type==="environment"?"location":target.type==="subject"?"actor":"target"});
        for(const sought of participantMentions(suggestion.text)){
          const matches=[...available.values()].filter((block)=>sameScope(target,block)&&!protectedBlock(block)&&(participantKey(block.handle.split("/").at(-1)??block.handle)===sought||participantKey(labelOf(block))===sought));
          if(matches.length!==1)throw new Error("context_changes_participant_unresolved");const block=matches[0];references.push({block_id:block.id,handle:block.handle,role:block.type==="environment"?"location":block.type==="subject"?"counterparty":"target"});
        }
      }
      const normalized=normalizeActionBlockReferences(references);
      events.push({type:"BlockCreated",payload:{...scope,block_id:id,type:detail.type,handle:`${detail.type}/${slug(detail.label)}`,position:position(),properties:{label:detail.label,text:detail.text,subtype:detail.subtype,intent:"include",weight:.8,authority:"authored",context_detail:true,source_execution_id:item.executionId,source_proposal_id:item.proposalId,...(proposal?{source_excerpt:proposal.sourceExcerpt,human_edited:Boolean(item.edit),...(!proposal.addendum?{source_block_id:target.id}:{})}:{...(suggestion?.sourceUrl?{source_url:suggestion.sourceUrl}:{}),human_edited:Boolean(item.edit)}),...(normalized.length?{block_references:[]}:{}),created_from:"approved-context-proposal"},source_surface:"approved-context-proposal"}});blockIds.push(id);
      changes.push({kind:"create",label:detail.label,text:detail.text,type:detail.type,targetId:id});
      if(normalized.length){deferred.push({type:"BlockPropertyEdited",payload:{...scope,block_id:id,property_path:"block_references",old_value:[],new_value:normalized,source_surface:"approved-context-proposal"}});for(const reference of normalized){addRelation(id,reference.block_id,ACTION_PARTICIPANT_RELATION,{participant_role:reference.role,handle:reference.handle});changes.push({kind:"participant",label:detail.label,text:reference.handle,type:reference.role,targetId:reference.block_id});}}
    }
    if(id===target.id)throw new Error("context_composition_cycle");
    addRelation(target.id,id,CONTEXT_CONTAINS_RELATION,{member_order:order++,relation_label:proposal?.label??suggestion?.label??"",relativity:1});
    changes.push({kind:"link",label:groupName,text:proposal?.label??suggestion?.label??"",type:CONTEXT_CONTAINS_RELATION,sourceId:target.id,targetId:id});
  }
  events.push(...deferred,...relations);
  if(blockIds.length>100||events.length>512)throw new Error("context_changes_too_large");
  const issue=validateContextCompositionGraph({blocks:projection.libraryBlocks,relations:projection.libraryBlockRelations,events});if(issue)throw new Error(issue.code);
  return{events,changes,blockIds,relationCount:relations.length};
}
