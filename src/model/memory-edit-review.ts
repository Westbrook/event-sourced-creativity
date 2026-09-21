import { memoryDigest } from "./scoped-memory.ts";
/** Private historical review, never an authoring capability or an autocomplete
 * draft. The excerpt belongs to the approved source, not necessarily today's
 * field. Applying a suggestion requires a separate, explicitly approved native authored-work transaction. */
export type MemoryEditReview = {
  version: 'memory-edit-review-v1'; executionId: string; turnId: string;
  projectId: string; documentId: string; sourceHash: string; locale: string;
  mode: 'review-only'; independentEvidence: false;
  edits: Array<{ blockId: string; field: 'text'; revision: number; beforeExcerpt: string; suggestedText: string }>;
};
export type MemoryEditReviewTarget = Pick<MemoryEditReview, 'executionId'|'turnId'|'projectId'|'documentId'|'sourceHash'|'locale'>;
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
const keys=(v:Record<string,unknown>,names:string[])=>{
  const fields=Object.getOwnPropertyDescriptors(v),own=Reflect.ownKeys(fields);
  return own.length===names.length&&own.every(k=>typeof k==='string'&&names.includes(k)
    &&fields[k]!.enumerable&&Object.hasOwn(fields[k]!,'value'));
};
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.isWellFormed()&&Array.from(v).length<=max;
const id=(v:unknown):v is string=>text(v,240)&&v.length>0;

/** Shared immutable resource/execution identity for private review kinds. */
export function memoryReviewTargetMatches(value:Record<string,unknown>,target:MemoryEditReviewTarget):boolean{
  return ['executionId','turnId','projectId','documentId'].every(k=>id(value[k]))
    &&typeof value.sourceHash==='string'&&/^[a-f0-9]{64}$/u.test(value.sourceHash)
    &&text(value.locale,35)&&Boolean(value.locale)&&Object.entries(target).every(([key,v])=>value[key]===v);
}

/** Validate at every presentation ingress and clone; no object from a response
 * may smuggle mutation fields or a different execution/resource into this view. */
export function parseMemoryEditReview(value:unknown,target:MemoryEditReviewTarget):MemoryEditReview|null{
  try{
  if(!object(value)||!keys(value,['version','executionId','turnId','projectId','documentId','sourceHash','locale','mode','independentEvidence','edits'])
    ||value.version!=='memory-edit-review-v1'||value.mode!=='review-only'||value.independentEvidence!==false
    ||!memoryReviewTargetMatches(value,target)
    ||!Array.isArray(value.edits)||value.edits.length<1||value.edits.length>12)return null;
  const seen=new Set<string>();
  const descriptors=Object.getOwnPropertyDescriptors(value.edits);
  if(Reflect.ownKeys(descriptors).length!==value.edits.length+1||Array.from({length:value.edits.length},(_,i)=>String(i))
    .some(k=>!descriptors[k]||!Object.hasOwn(descriptors[k]!,'value')))return null;
  for(const edit of value.edits){
    if(!object(edit)||!keys(edit,['blockId','field','revision','beforeExcerpt','suggestedText'])||!id(edit.blockId)||seen.has(edit.blockId)
      ||edit.field!=='text'||!Number.isSafeInteger(edit.revision)||Number(edit.revision)<1
      ||!text(edit.beforeExcerpt,1200)||!text(edit.suggestedText,600)||!edit.suggestedText.trim())return null;
    seen.add(edit.blockId);
  }
  return structuredClone(value) as MemoryEditReview;
  }catch{return null;}
}

/** Explicit promotion of one exact reviewed replacement, not blanket approval
 * for a model response or permission to publish private supporting sources. */
export async function memoryEditApprovalHash(review:MemoryEditReview,blockId:string):Promise<string|null>{
  const valid=parseMemoryEditReview(review,{executionId:review.executionId,turnId:review.turnId,
    projectId:review.projectId,documentId:review.documentId,sourceHash:review.sourceHash,locale:review.locale});
  const edit=valid?.edits.find(item=>item.blockId===blockId);
  return valid&&edit?memoryDigest(JSON.stringify(['memory-authored-text-v1',valid.executionId,valid.turnId,
    valid.projectId,valid.documentId,valid.sourceHash,valid.locale,edit.blockId,edit.field,edit.revision,edit.beforeExcerpt,edit.suggestedText])):null;
}
