import { derivationTime } from '../model/memory-derivation-policy.ts';
import { qualifiedProject,qualifiedProjectKey,type QualifiedProject,type OrganizationProjectNestingView } from '../model/organization-project-nesting.ts';
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
export async function readProjectContainment(projectId:string,signal:AbortSignal):Promise<ProjectHierarchyView>{
 const response=await fetch(endpoint+'?version=2&projectId='+encodeURIComponent(projectId),{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal});
 const raw=await body(response),result=parseOrganizationProjectNesting(raw,projectId)??parseProjectContainment(raw,projectId);if(!result||signal.aborted)throw new Error('containment_unavailable');return result;
}
export async function saveProjectContainment(view:ProjectHierarchyView,parentId:string|null,signal:AbortSignal):Promise<void>{
 const v2=view.version==='project-containment-v2';
 if(!(v2?parseOrganizationProjectNesting(view,view.project.projectId):parseProjectContainment(view,view.projectId))||!view.canReparent||parentId!==null&&!hierarchyCandidates(view).includes(parentId))throw new Error('containment_unavailable');
 if(signal.aborted)throw new Error('containment_unavailable');
 const finishMutation=beginMemoryPrivacyMutation();
 try{
 const response=await fetch(endpoint+(v2?'?version=2':''),{method:'PATCH',credentials:'same-origin',cache:'no-store',redirect:'error',signal,
 headers:{'content-type':'application/json'},body:JSON.stringify(v2?{version:view.version,project:view.project,parent:parentId===null?null:view.candidates.find(p=>qualifiedProjectKey(p)===parentId),revision:view.revision}:{projectId:view.projectId,parentId,revision:view.revision})});
 const result=await body(response);
 if(signal.aborted||!result||Object.keys(result).sort().join(',')!=='refreshRequired,saved,version'||result.version!==view.version||result.saved!==true||result.refreshRequired!==true)throw new Error('containment_unconfirmed');
 }finally{finishMutation();}
}

export function parseOrganizationProjectNesting(value:unknown,projectId:string):OrganizationProjectNestingView|null{
 try{
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='accessInherited,ancestors,ancestryComplete,canReparent,candidates,parent,project,revision,validUntil,version'
   ||v.version!=='project-containment-v2'||!qualifiedProject(v.project)||v.project.projectId!==projectId||!/^sha256:[a-f0-9]{64}$/u.test(String(v.revision))
   ||!derivationTime(v.validUntil)||Date.parse(v.validUntil)<=Date.now()||Date.parse(v.validUntil)>Date.now()+30000
   ||typeof v.ancestryComplete!=='boolean'||typeof v.canReparent!=='boolean'||v.accessInherited!==false
   ||!Array.isArray(v.ancestors)||v.ancestors.length>=PROJECT_CONTAINMENT_DEPTH||!Array.isArray(v.candidates)||v.candidates.length>PROJECT_CONTAINMENT_LIMIT
   ||[v.ancestors,v.candidates].some(list=>list.some(p=>!qualifiedProject(p)||qualifiedProjectKey(p)===qualifiedProjectKey(v.project as QualifiedProject))||new Set(list.map(qualifiedProjectKey)).size!==list.length)
   ||(v.parent===null?null:qualifiedProject(v.parent)?qualifiedProjectKey(v.parent):'invalid')!==(v.ancestors[0]?qualifiedProjectKey(v.ancestors[0]):null)
   ||!v.canReparent&&v.candidates.length)return null;
  return structuredClone(value) as OrganizationProjectNestingView;
 }catch{return null;}
}
export type ProjectHierarchyView=ProjectContainmentView|OrganizationProjectNestingView;
export const hierarchyParent=(view:ProjectHierarchyView)=>view.version==='project-containment-v2'?(view.parent?qualifiedProjectKey(view.parent):null):view.parentId;
export const hierarchyAncestors=(view:ProjectHierarchyView)=>view.version==='project-containment-v2'?view.ancestors.map(qualifiedProjectKey):view.ancestors;
export const hierarchyCandidates=(view:ProjectHierarchyView)=>view.version==='project-containment-v2'?view.candidates.map(qualifiedProjectKey):view.candidates;
