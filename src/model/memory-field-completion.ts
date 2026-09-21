import { parseMemoryEditReview, type MemoryEditReview } from './memory-edit-review.ts';
import { parseSemanticMemoryAnswerPresentation } from './memory-answer.ts';
export type MemoryFieldCompletion={review:MemoryEditReview;bindingHash:string;validUntil:string;independentEvidence:false};
export type MemoryFieldTarget={projectId:string;documentId:string;blockId:string;revision:number;text:string;locale:string};
/** Saved completion only. A local draft is compared here, never serialized. */
export function parseMemoryFieldCompletion(raw:unknown,target:MemoryFieldTarget,now=Date.now()):MemoryFieldCompletion|null{
  try{
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='bindingHash,independentEvidence,review,validUntil')return null;
    const fields=Object.getOwnPropertyDescriptors(raw);
    if(Reflect.ownKeys(fields).some(key=>typeof key!=='string'||!fields[key]?.enumerable||!Object.hasOwn(fields[key]!,'value')))return null;
    const value=raw as MemoryFieldCompletion;
    if(!value.review||typeof value.review!=='object'||Object.values(Object.getOwnPropertyDescriptors(value.review)).some(field=>!field.enumerable||!Object.hasOwn(field,'value')))return null;
    if(value.independentEvidence!==false||typeof value.bindingHash!=='string'||!/^[a-f0-9]{64}$/u.test(value.bindingHash)
      ||!parseSemanticMemoryAnswerPresentation({version:'semantic-memory-answer-v1',validUntil:value.validUntil,independentEvidence:false},now))return null;
    const review=parseMemoryEditReview(value.review,{executionId:value.review.executionId,turnId:value.review.turnId,projectId:target.projectId,
      documentId:target.documentId,sourceHash:value.review.sourceHash,locale:target.locale});
    if(!review||review.edits.length!==1)return null;
    const edit=review.edits[0]!;
    return edit.blockId===target.blockId&&edit.field==='text'&&edit.revision===target.revision&&edit.beforeExcerpt===target.text
      ?{review,bindingHash:value.bindingHash,validUntil:value.validUntil,independentEvidence:false}:null;
  }catch{return null;}
}
