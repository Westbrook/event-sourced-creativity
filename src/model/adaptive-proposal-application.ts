import { blockTypeDefinition, isBlockKind, suggestedSubtype, type AdaptiveStructure, type BlockKind } from "./block-types.ts";
import { creativeContextRightsIssue } from "./context-health.ts";
import { protectedAssistantDecision } from "./conversation-context.ts";
import type { ContextChange } from "./context-proposal-application.ts";
import type { CreativeProjection, EventInput } from "./events.ts";

export type AdaptiveProposalSelection={
  proposalId:string;targetBlockId?:string;
  edit?:{type?:BlockKind;subtype?:string;label?:string;text?:string};
  placement?:{x:number;y:number;w:number;h:number};
};
export type AdaptiveProposalReview={
  executionId:string;bindingHash:string;selectionKey:string;originalSourceHash:string;currentSourceHash:string;sourceChanged:boolean;
  selections:AdaptiveProposalSelection[];interpretation:string;originalSuggestions:Array<{proposalId:string;type:BlockKind;subtype:string;label:string;text:string;reason:string;relationshipTo:string}>;
};

/** Canonical save metadata only. This never contains the erased private preview or human-edited wording. */
export type AdaptiveProposalReceipt={
  previewId:string;approvalHash:string;executionId:string;bindingHash:string;selectionKey:string;
  blockIds:string[];canvasItemIds:string[];relationCount:0;createdAt:string;dismissed:boolean;
};
export type AdaptiveProposalReceiptPage={
  status:"receipts";projectId:string;documentId:string;canvasId:string|null;executionId:string;bindingHash:string;
  receipts:AdaptiveProposalReceipt[];nextCursor:string|null;pageSize:20;readOnly:true;canApply:false;noPayment:true;noAutomaticRetry:true;
};


/** Destination-only discovery never chooses or rehydrates one of the original paid proposals. */
export type AdaptiveProposalDestinationReceiptPage=Omit<AdaptiveProposalReceiptPage,"executionId"|"bindingHash">&{
  discovery:"destination";executionId:null;bindingHash:null;
};

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const identifier=(value:unknown)=>typeof value==="string"&&/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,119}$/u.test(value);
function fail(code:string):never{throw new Error(code);}

/** Immutable JSON-pointer identities refer only to the retained provider structure, never browser text. */
export function adaptiveProposalOptions(structure:AdaptiveStructure){
  return[{proposalId:"/active_decision",type:structure.active_decision.type,subtype:suggestedSubtype(structure.active_decision.type),
    label:structure.active_decision.label,text:structure.active_decision.prompt,reason:structure.active_decision.why,relationshipTo:""},
    ...structure.suggested_blocks.map((item,index)=>({proposalId:"/suggested_blocks/"+index,type:item.type,subtype:item.subtype,label:item.label,text:item.instruction,reason:item.reason,relationshipTo:item.relationship_to}))];
}
export function adaptiveProposalSelections(value:unknown):AdaptiveProposalSelection[]{
  if(!Array.isArray(value)||!value.length||value.length>7)fail("adaptive_changes_selection_required");
  const selections:AdaptiveProposalSelection[]=[],selected=new Set<string>(),targets=new Set<string>();
  for(const input of value){
    const item=object(input);
    if(Object.keys(item).some(key=>!["proposalId","targetBlockId","edit","placement"].includes(key))
      ||typeof item.proposalId!=="string"||!/^\/(?:active_decision|suggested_blocks\/[0-5])$/u.test(item.proposalId)
      ||selected.has(item.proposalId)||item.targetBlockId!==undefined&&!identifier(item.targetBlockId))fail("adaptive_changes_invalid_selection");
    if(item.targetBlockId&&targets.has(String(item.targetBlockId)))fail("adaptive_changes_duplicate_target");
    const edit=item.edit===undefined?undefined:object(item.edit),placement=item.placement===undefined?undefined:object(item.placement);
    if(item.edit!==undefined&&(!item.edit||Array.isArray(item.edit)||typeof item.edit!=="object")
      ||edit&&Object.entries(edit).some(([key,value])=>!["type","subtype","label","text"].includes(key)||typeof value!=="string"
        ||value.length>(key==="text"?16_000:key==="label"?160:120)||!value.trim()))fail("adaptive_changes_invalid_edit");
    if(edit?.type!==undefined&&(typeof edit.type!=="string"||!isBlockKind(edit.type)||edit.type==="reference"||edit.type==="model3d"))fail("adaptive_changes_invalid_edit");
    if(placement&&(Object.keys(placement).length!==4||Object.keys(placement).some(key=>!["x","y","w","h"].includes(key))
      ||Object.values(placement).some(value=>typeof value!=="number"||!Number.isFinite(value)||Math.abs(value)>1_000_000)
      ||Number(placement.w)<1||Number(placement.h)<1)||item.placement!==undefined&&(!item.placement||typeof item.placement!=="object"||Array.isArray(item.placement)))fail("adaptive_changes_invalid_placement");
    selected.add(item.proposalId);if(item.targetBlockId)targets.add(String(item.targetBlockId));
    selections.push({proposalId:item.proposalId,...(item.targetBlockId?{targetBlockId:String(item.targetBlockId)}:{}),
      ...(edit?{edit:edit as AdaptiveProposalSelection["edit"]}:{}),...(placement?{placement:placement as AdaptiveProposalSelection["placement"]}:{})});
  }
  return selections;
}

/** Human approval creates by default. It never guesses which same-type authored fact should be overwritten. */
export function buildAdaptiveProposalApplication(input:{projection:CreativeProjection;documentId:string;canvasId:string|null;
  structure:AdaptiveStructure;executionId:string;bindingHash:string;selections:AdaptiveProposalSelection[];createId?:()=>string}){
  const selections=adaptiveProposalSelections(input.selections),options=new Map(adaptiveProposalOptions(input.structure).map(item=>[item.proposalId,item]));
  const createId=input.createId??(()=>crypto.randomUUID()),events:EventInput[]=[],changes:ContextChange[]=[],blockIds:string[]=[],canvasItemIds:string[]=[];
  const scope={project_id:input.projection.projectId,scope:input.canvasId?"canvas":"document",
    ...(input.canvasId?{canvas_id:input.canvasId}:{document_id:input.documentId})};
  const position=()=>`z${String(input.projection.libraryBlocks.length+events.length+1).padStart(12,"0")}`;
  for(const selection of selections){
    const original=options.get(selection.proposalId);if(!original)fail("adaptive_changes_proposal_missing");
    const proposal={...original,...selection.edit};
    if(!isBlockKind(proposal.type)||proposal.type==="reference"||proposal.type==="model3d"||!blockTypeDefinition(proposal.type)?.subtypes.includes(proposal.subtype)
      ||!proposal.label.trim()||proposal.label.length>160||!proposal.text.trim()||proposal.text.length>16_000)fail("adaptive_changes_invalid_edit");
    if(selection.targetBlockId){
      if(selection.placement)fail("adaptive_changes_placement_requires_create");
      const target=input.projection.libraryBlocks.find(block=>block.id===selection.targetBlockId&&block.projectId===input.projection.projectId&&!block.removed);
      if(!target||target.type!==proposal.type||(input.canvasId?target.scope!=="canvas"||target.canvasId!==input.canvasId:target.scope!=="document"||target.documentId!==input.documentId))
        fail("adaptive_changes_target_unavailable");
      if(protectedAssistantDecision(target)||creativeContextRightsIssue(target.properties)
        ||Object.keys(target.properties).some(key=>key.startsWith("organization_context_package_")||key==="organization_context_source_block_id"
          ||key==="source_evidence_hash"||key==="source_artifact_id"||key==="source_output_id"))fail("adaptive_changes_target_protected");
      for(const[key,value]of Object.entries({text:proposal.text,label:proposal.label,subtype:proposal.subtype})){
        if(target.properties[key]!==value)events.push({type:"BlockPropertyEdited",payload:{...scope,block_id:target.id,property_path:key,
          old_value:target.properties[key]??null,new_value:value,source_surface:"approved-adaptive-proposal"}});
      }
      blockIds.push(target.id);changes.push({kind:"edit",type:proposal.type,label:proposal.label,text:proposal.text,targetId:target.id});
      continue;
    }
    if(Boolean(input.canvasId)!==Boolean(selection.placement))fail("adaptive_changes_placement_required");
    const blockId=createId();blockIds.push(blockId);
    events.push({type:"BlockCreated",payload:{...scope,block_id:blockId,type:proposal.type,
      handle:proposal.type+"/"+proposal.label.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-|-$/gu,"").slice(0,60),position:position(),
      properties:{text:proposal.text,label:proposal.label,subtype:proposal.subtype,weight:.75,authority:"authored",created_from:"approved-adaptive-proposal",
        accepted_from_execution_id:input.executionId,accepted_from_binding_hash:input.bindingHash,accepted_from_proposal_id:selection.proposalId,
        ...(proposal.type==="audio"?{audio_role:"score",inform_generation:false,include_in_output:false,allow_provider_audio_transfer:false}:{})}}});
    changes.push({kind:"create",type:proposal.type,label:proposal.label,text:proposal.text,targetId:blockId});
    if(input.canvasId){
      const itemId=createId();canvasItemIds.push(itemId);
      events.push({type:"CanvasItemPlaced",payload:{project_id:input.projection.projectId,canvas_id:input.canvasId,item_id:itemId,
        source_kind:proposal.type==="sketch"?"sketch":"block",source_id:blockId,title:proposal.label,body:proposal.text,block_type:proposal.type,
        frame:{...selection.placement!,rot:0,z:position()},source_surface:"approved-adaptive-proposal"}});
      changes.push({kind:"place",type:proposal.type,label:proposal.label,text:JSON.stringify(selection.placement),sourceId:blockId,targetId:itemId});
    }
  }
  if(!events.length)fail("adaptive_changes_no_changes");
  return{events,changes,blockIds,canvasItemIds,relationCount:0};
}
