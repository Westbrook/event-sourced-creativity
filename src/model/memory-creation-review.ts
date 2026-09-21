import { isBlockKind,blockTypeDefinition, type BlockKind } from './block-types.ts';
import { normalizeOutputRequirementCreation } from './output-requirement-creation.ts';
import { memoryDigest } from './scoped-memory.ts';
import { memoryReviewTargetMatches, type MemoryEditReviewTarget } from './memory-edit-review.ts';

/** Private preview only. The exact selected proposal must be separately promoted
 * to authored work; a review is never permission to generate, export or publish. */
export type MemoryCreationReview = MemoryEditReviewTarget & {
  version:'memory-creation-review-v1'|'memory-creation-review-v2'; mode:'review-only'; independentEvidence:false;
  creations:Array<{proposalId:string;blockType:BlockKind;intent:'include'|'avoid';text:string}>;
};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&!Array.isArray(value));
const exact=(value:object,names:string[])=>{
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  return keys.length===names.length&&keys.every(key=>typeof key==='string'&&names.includes(key)
    &&fields[key]!.enumerable&&Object.hasOwn(fields[key]!,'value'));
};
export function memoryCreationKind(value:unknown):value is BlockKind{
  // Output requirement contracts, uploaded evidence, media-transfer settings and protected constraints have
  // their own deliberate authoring flows, not plain-text Memory proposals.
  return typeof value==='string'&&isBlockKind(value)&&!['reference','model3d','audio','output','exclusion','brand','accessibility'].includes(value);
}
/** Native authoring uses this narrow separate operation, never the ordinary
 * creative-block bypass. The only spec allowed is the deterministic unconfirmed
 * interpretation of the exact approved prose; no supplied status or settings. */
export function memoryOutputCreation(payload:Record<string,unknown>):boolean{
 try{
  const p=payload.properties;
  if(payload.type!=='output'||!object(p)||!exact(p,['text','subtype','authority','created_from','source_chat_turn_id','output_spec'])
   ||typeof p.text!=='string'||!p.text.trim()||p.text!==p.text.trim()||!p.text.isWellFormed()||Array.from(p.text).length>600
   ||p.subtype!==blockTypeDefinition('output')?.subtypes[0]||p.authority!=='authored'||p.created_from!=='assistant'
   ||typeof p.source_chat_turn_id!=='string'||!p.source_chat_turn_id||p.source_chat_turn_id!==payload.source_chat_turn_id)return false;
  const {output_spec:spec,...original}=p;
  const normalized=normalizeOutputRequirementCreation({...payload,properties:original}).properties as Record<string,unknown>;
  return JSON.stringify(spec)===JSON.stringify(normalized.output_spec);
 }catch{return false;}
}
export function parseMemoryCreationReview(value:unknown,target:MemoryEditReviewTarget):MemoryCreationReview|null{
  try{
    if(!object(value)||!exact(value,['version','executionId','turnId','projectId','documentId','sourceHash','locale','mode','independentEvidence','creations'])
      ||!['memory-creation-review-v1','memory-creation-review-v2'].includes(String(value.version))||value.mode!=='review-only'||value.independentEvidence!==false)return null;
    // Share the exact target identity/Unicode contract with field reviews.
    if(!memoryReviewTargetMatches(value,target))return null;
    if(!Array.isArray(value.creations)||value.creations.length<1||value.creations.length>12)return null;
    const descriptors=Object.getOwnPropertyDescriptors(value.creations);
    if(Reflect.ownKeys(descriptors).length!==value.creations.length+1||Array.from({length:value.creations.length},(_,i)=>String(i))
      .some(key=>!descriptors[key]||!Object.hasOwn(descriptors[key]!,'value')))return null;
    const seen=new Set<string>();
    for(const item of value.creations){
      if(!object(item)||!exact(item,['proposalId','blockType','intent','text'])||typeof item.proposalId!=='string'
        ||!/^create-(?:[0-9]|1[01])$/u.test(item.proposalId)||seen.has(item.proposalId)
        ||!(memoryCreationKind(item.blockType)||value.version==='memory-creation-review-v2'&&item.blockType==='output'&&item.intent==='include')
        ||!['include','avoid'].includes(String(item.intent))||typeof item.text!=='string'||!item.text.isWellFormed()
        ||!item.text.trim()||item.text!==item.text.trim()||Array.from(item.text).length>600)return null;
      seen.add(item.proposalId);
    }
    return structuredClone(value) as MemoryCreationReview;
  }catch{return null;}
}
export async function memoryCreationApprovalHash(review:MemoryCreationReview,proposalId:string):Promise<string|null>{
  const valid=parseMemoryCreationReview(review,{executionId:review.executionId,turnId:review.turnId,projectId:review.projectId,
    documentId:review.documentId,sourceHash:review.sourceHash,locale:review.locale});
  const item=valid?.creations.find(candidate=>candidate.proposalId===proposalId);
  return valid&&item?memoryDigest(JSON.stringify([valid.version==='memory-creation-review-v2'?'memory-authored-create-v2':'memory-authored-create-v1',valid.executionId,valid.turnId,valid.projectId,
    valid.documentId,valid.sourceHash,valid.locale,item.proposalId,item.blockType,item.intent,item.text])):null;
}
