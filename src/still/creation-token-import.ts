import type {TokenRun} from './vendor/elements/rich-document.js';
/** Paste is not authority. Foreign canonical targets become literal unresolved candidates. */
export function creationTokenImporter(scope:()=>{draftId:string;projectId:string|null}) {
 const temporaryTargets=new Map<string,string>();
 return (token:TokenRun):TokenRun|undefined=>{
  const current=scope(),raw=token.data;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
  const data=raw as Readonly<Record<string,unknown>>;
  if(token.type==='still-idea-reference'){
   if(data.schemaVersion!==1||data.kind!=='idea-reference'||!current.projectId||data.projectId!==current.projectId||typeof data.blockId!=='string'||!data.blockId)return;
   // Same-Project IDs retain chosen identity; /use freshly reauthorizes them before interpretation.
   return token;
  }
  if(token.type==='still-creation-declaration'){
   if(data.schemaVersion!==1||data.kind!=='declaration'||!current.draftId)return;
   if(data.draftId===current.draftId&&typeof data.targetId==='string'&&data.targetId.startsWith('temporary:'))return token;
   const key=typeof data.draftId==='string'&&typeof data.targetId==='string'&&data.targetId.startsWith('temporary:')?JSON.stringify([current.draftId,data.draftId,data.targetId]):crypto.randomUUID();
   let targetId=temporaryTargets.get(key);if(!targetId){targetId=`temporary:${crypto.randomUUID()}`;temporaryTargets.set(key,targetId);}
   return {...token,data:{schemaVersion:1,kind:'declaration',draftId:current.draftId,targetId}};
  }
  return token;
 };
}
