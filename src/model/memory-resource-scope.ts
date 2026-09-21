/** Library and Canvas are real resource scopes, never stand-in documents. A
 * Library is the owning project's collection of reusable resources; its native
 * identifier is that project's ID. Canvas uses its actual CanvasCreated ID. */
export type MemoryResourceSelector={kind:'library'|'canvas';projectId:string;resourceId:string};
export type MemoryResourceIdentity=MemoryResourceSelector & {version:'memory-resource-scope-v1';actorUserId:string;ownerUserId:string;
 organizationId:string|null;projectAccessId:string|null;partitionKey:string;resourceKey:string};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=240&&value.trim()===value&&value.isWellFormed()
 &&!Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127);
export function memoryResourceSelector(value:unknown):MemoryResourceSelector|null{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='kind,projectId,resourceId')return null;
 const v=value as Record<string,unknown>;if(!['library','canvas'].includes(String(v.kind))||!id(v.projectId)||!id(v.resourceId)||v.kind==='library'&&v.resourceId!==v.projectId)return null;
 return {kind:v.kind as MemoryResourceSelector['kind'],projectId:v.projectId,resourceId:v.resourceId};
}
/** Identity only; neither scope names, nesting nor linked documents grant access. */
export function memoryResourceIdentity(selection:MemoryResourceSelector,custody:{actorUserId:string;ownerUserId:string;organizationId:string|null;projectAccessId:string|null}):MemoryResourceIdentity|null{
 const selected=memoryResourceSelector(selection);if(!selected||!id(custody.actorUserId)||!id(custody.ownerUserId)
  ||!(custody.organizationId===null&&custody.projectAccessId===null&&custody.actorUserId===custody.ownerUserId||id(custody.organizationId)&&id(custody.projectAccessId)))return null;
 return {...selected,actorUserId:custody.actorUserId,ownerUserId:custody.ownerUserId,organizationId:custody.organizationId,projectAccessId:custody.projectAccessId,version:'memory-resource-scope-v1',partitionKey:JSON.stringify(['memory-partition-v1',custody.actorUserId,custody.ownerUserId,custody.organizationId,custody.projectAccessId]),
  resourceKey:JSON.stringify(['memory-resource-v1',custody.ownerUserId,custody.organizationId,custody.projectAccessId,selected.kind,selected.projectId,selected.resourceId])};
}
