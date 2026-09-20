import { beginMemoryPrivacyMutation } from './memory-privacy-mutation.ts';
import { projectContainmentId as id, type ProjectContainmentView, PROJECT_CONTAINMENT_DEPTH, PROJECT_CONTAINMENT_LIMIT } from '../model/project-containment';
const endpoint='/api/projects/containment';
export function parseProjectContainment(value:unknown,projectId:string):ProjectContainmentView|null {
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='accessInherited,ancestors,ancestryComplete,canReparent,candidates,parentId,projectId,revision,version'
    ||v.version!=='project-containment-v1'||v.projectId!==projectId||!/^sha256:[a-f0-9]{64}$/u.test(String(v.revision))
    ||typeof v.ancestryComplete!=='boolean'||typeof v.canReparent!=='boolean'||v.accessInherited!==false
    ||!Array.isArray(v.ancestors)||v.ancestors.length>=PROJECT_CONTAINMENT_DEPTH||!Array.isArray(v.candidates)||v.candidates.length>PROJECT_CONTAINMENT_LIMIT
    ||[v.ancestors,v.candidates].some(items=>items.some(item=>!id(item)||item===projectId)||new Set(items).size!==items.length)
    ||v.parentId!==(v.ancestors[0]??null)||!v.canReparent&&v.candidates.length>0)return null;
  return structuredClone(v) as ProjectContainmentView;
}
async function body(response:Response){
 if(!response.ok||response.redirected||response.headers.get('content-type')?.split(';')[0]!=='application/json'||!response.body)throw new Error('containment_unavailable');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',bytes=0;
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>131072){await reader.cancel();throw new Error('containment_capacity');}text+=decoder.decode(part.value,{stream:true});}return JSON.parse(text+decoder.decode());}
 finally{reader.releaseLock();}
}
export async function readProjectContainment(projectId:string,signal:AbortSignal):Promise<ProjectContainmentView>{
 const response=await fetch(endpoint+'?projectId='+encodeURIComponent(projectId),{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 const result=parseProjectContainment(await body(response),projectId);if(!result||signal.aborted)throw new Error('containment_unavailable');return result;
}
export async function saveProjectContainment(view:ProjectContainmentView,parentId:string|null,signal:AbortSignal):Promise<void>{
 if(!parseProjectContainment(view,view.projectId)||!view.canReparent||parentId!==null&&!view.candidates.includes(parentId))throw new Error('containment_unavailable');
 if(signal.aborted)throw new Error('containment_unavailable');
 const finishMutation=beginMemoryPrivacyMutation();
 try{
 const response=await fetch(endpoint,{method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
 headers:{'content-type':'application/json'},body:JSON.stringify({projectId:view.projectId,parentId,revision:view.revision})});
 const result=await body(response);
 if(signal.aborted||!result||Object.keys(result).sort().join(',')!=='refreshRequired,saved,version'||result.version!=='project-containment-v1'||result.saved!==true||result.refreshRequired!==true)throw new Error('containment_unconfirmed');
 }finally{finishMutation();}
}
