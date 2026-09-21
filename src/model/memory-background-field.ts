import { derivationExact,derivationHash,derivationId,derivationInteger,derivationTime } from './memory-derivation-policy.ts';
import { memoryDigest } from './scoped-memory.ts';
import type { MemoryFieldTarget } from './memory-field-completion.ts';
/** Background jobs retain their own identity. They are not assistant turns or
 * paid specialist executions, and this private view cannot authorize a write. */
export type MemoryBackgroundField={
 version:'memory-background-field-v1';jobId:string;claimKey:string;outputHash:string;
 projectId:string;documentId:string;blockId:string;revision:number;sequence:number;textHash:string;
 beforeExcerpt:string;suggestedText:string;locale:string;validUntil:string;independentEvidence:false;
};
export function parseMemoryBackgroundField(raw:unknown,target:MemoryFieldTarget,now=Date.now()):MemoryBackgroundField|null{
 try{
  if(!derivationExact(raw,['version','jobId','claimKey','outputHash','projectId','documentId','blockId','revision','sequence','textHash','beforeExcerpt','suggestedText','locale','validUntil','independentEvidence'])
   ||raw.version!=='memory-background-field-v1'||!derivationHash(raw.jobId)||typeof raw.claimKey!=='string'||!/^derived:[a-f0-9]{64}$/u.test(raw.claimKey)
   ||!derivationHash(raw.outputHash)||!derivationHash(raw.textHash)||!derivationInteger(raw.sequence,1)||!derivationInteger(raw.revision,1)
   ||!['projectId','documentId','blockId'].every(key=>derivationId(raw[key]))||raw.projectId!==target.projectId||raw.documentId!==target.documentId||raw.blockId!==target.blockId
   ||raw.revision!==target.revision||raw.beforeExcerpt!==target.text||typeof raw.beforeExcerpt!=='string'||!raw.beforeExcerpt.isWellFormed()||Array.from(raw.beforeExcerpt).length>1200
   ||typeof raw.suggestedText!=='string'||!raw.suggestedText.isWellFormed()||!raw.suggestedText.trim()||Array.from(raw.suggestedText).length>600||raw.suggestedText===raw.beforeExcerpt
   ||raw.locale!==target.locale||!['en','fr','ar','ja'].includes(String(raw.locale))||raw.independentEvidence!==false
   ||!derivationTime(raw.validUntil)||Date.parse(raw.validUntil)<=now||Date.parse(raw.validUntil)>now+60000)return null;
  return structuredClone(raw) as MemoryBackgroundField;
 }catch{return null;}
}
export async function memoryBackgroundFieldApprovalHash(value:MemoryBackgroundField){
 const checked=parseMemoryBackgroundField(value,{projectId:value.projectId,documentId:value.documentId,blockId:value.blockId,revision:value.revision,text:value.beforeExcerpt,locale:value.locale});
 return checked?memoryDigest(JSON.stringify(['memory-background-authored-text-v1',checked.jobId,checked.claimKey,checked.outputHash,
  checked.projectId,checked.documentId,checked.blockId,checked.revision,checked.sequence,checked.textHash,checked.beforeExcerpt,checked.suggestedText,checked.locale])):null;
}
