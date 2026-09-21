import type { AssistantContext } from './conversation-context.ts';

export type MemoryFieldRequest={blockId:string;field:'text';revision:number;textHash:string};
/** Only saved-field identity crosses this boundary; never an editor draft. */
export function parseMemoryFieldRequest(value:unknown):MemoryFieldRequest|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const fields=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(fields).length!==4||!['blockId','field','revision','textHash'].every(key=>fields[key]?.enumerable&&Object.hasOwn(fields[key]!,'value')))return null;
 const row=value as MemoryFieldRequest;
 return typeof row.blockId==='string'&&row.blockId.length>0&&row.blockId.length<=240&&row.blockId.isWellFormed()
  &&row.field==='text'&&Number.isSafeInteger(row.revision)&&row.revision>0&&typeof row.textHash==='string'&&/^[a-f0-9]{64}$/u.test(row.textHash)
  ?{blockId:row.blockId,field:'text',revision:row.revision,textHash:row.textHash}:null;
}
export async function memoryFieldTextHash(text:string):Promise<string>{
 if(typeof text!=='string'||!text.isWellFormed())throw Error('assistant_field_request_invalid');
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function memoryFieldRequestCurrent(context:AssistantContext,target:MemoryFieldRequest):Promise<boolean>{
 const matches=context.decisionAtoms.filter(atom=>atom.id===target.blockId),atom=matches[0];
 return matches.length===1&&Boolean(atom&&!atom.locked&&!atom.immutable&&!atom.protected&&atom.providerEligible
  &&atom.providerVisibility==='editable'&&atom.intent!=='prohibit'&&!['reference','model3d'].includes(atom.type)
  &&atom.version===target.revision&&Array.from(atom.text).length<=1200&&await memoryFieldTextHash(atom.text)===target.textHash);
}
