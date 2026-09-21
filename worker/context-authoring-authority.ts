import type { AssistantContextReadObserver } from "./assistant-context-source.ts";
import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { consentHash, executionAuthorityCurrent, executionAdmissionGuard, type ConsequentialBinding } from "./consequential-consent.ts";
import { hasCapability, requireConsent, requireUser, type PilotUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { readProjectEventPage, readProjectRequestContext, readProjectSourceEvents, resolveOwnerExecutionScope } from "./project-access.ts";
import { serializeEvent, streamHead, type WorkerEnv } from "./runtime.ts";

export const contextSourceHash=(projectId:string,documentId:string,target:CreativeBlock|undefined,projection:CreativeProjection,events:CreativeEvent[])=>consentHash({
  projectId,documentId,target,blocks:projection.libraryBlocks,relations:projection.libraryBlockRelations,documents:projection.documents,
  rights:events.filter((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)).map((event)=>({id:event.eventId,payload:event.payload})),
});


/** Capture the exact already-read private bytes for atomic provider admission. */
async function personalSourceEvents(env:WorkerEnv,owner:string,stream:string,sourceObserver?:AssistantContextReadObserver){
  const descriptor={sql:`SELECT event.*,secret.private_json,secret.owner_id AS private_owner_id,secret.project_id AS private_project_id,secret.document_id AS private_document_id FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL WHERE event.stream_id=? AND event.type IN(${ASSISTANT_STATE_EVENT_SQL}) ORDER BY event.sequence`,bindings:[owner,stream]};
  const statement=env.DB.prepare(descriptor.sql).bind(...descriptor.bindings),rows=await statement.all<Record<string,unknown>>();
  sourceObserver?.([statement],[rows],[descriptor]);
  return rows.results.map(serializeEvent);
}

/** Read history and human authorship do not inherit paid-generation eligibility, text limits, or target mutability. */
async function prepareCreativeAuthority(request:Request,env:WorkerEnv,body:Record<string,unknown>,authority:"read"|"author",targetKind:"block"|"document",sourceObserver?:AssistantContextReadObserver){
  const deny=(error:string,status=403)=>Response.json({error},{status,headers:{"cache-control":"private, no-store"}});
  const auth=await requireUser(request,env,"viewer",{account:"principal"});if(auth.response||!auth.user)return auth.response??deny("authentication_required",401);
  const principal=auth.user,consent=requireConsent(principal);if(consent)return consent;
  const projectId=String(body.projectId??""),documentId=String(body.documentId??""),blockId=String(body.blockId??""),canvasId=String(body.canvasId??"")||null;
  if(!projectId||!documentId||targetKind==="block"&&!blockId||[projectId,documentId,blockId,canvasId??""].some((id)=>id.length>120))return deny("context_scope_required",400);
  const selected=await readProjectRequestContext(request,env,principal);if(selected.response)return selected.response;
  const shared=selected.context;if(shared&&shared.projectId!==projectId)return deny("context_project_denied");
  let scope:ProjectExecutionScope|undefined=shared?{organizationId:shared.organizationId,projectAccessId:shared.projectAccessId,actorUserId:principal.userId,projectId,ownerUserId:shared.ownerUserId}:undefined;
  const streamId=shared?`creative:${shared.ownerUserId}`:principal.streamId,sourceHead=await streamHead(env,streamId);
  const events:CreativeEvent[]=[];
  if(shared&&targetKind==="document")events.push(...await readProjectSourceEvents(env,scope!,{sourceObserver}));
  else if(shared){let after=0;for(;;){const page=await readProjectEventPage(env,shared,after,5000,false);events.push(...page.events.filter((event)=>event.type!=="ProjectResourceRestricted"));if(!page.hasMore)break;if(page.nextAfter<=after)return deny("context_project_history_unavailable",503);after=page.nextAfter;}}
  else events.push(...await personalSourceEvents(env,principal.userId,streamId,sourceObserver));
  const projection=foldEvents(events,Number.POSITIVE_INFINITY,documentId,projectId);
  const history=authority==="read"?foldEvents(events.filter((event)=>!["DocumentRemoved","BlockRemoved"].includes(event.type)),Number.POSITIVE_INFINITY,documentId,projectId):projection;
  if(history.projectId!==projectId||!history.documents.some((document)=>document.id===documentId&&document.projectId===projectId))return deny("context_document_denied");
  if(!shared){const custody=await resolveOwnerExecutionScope(env,principal,documentId,projectId,authority);if(custody.denied)return deny("context_custody_unavailable");scope=custody.scope;}
  const capability=authority==="author"?"project.author":"project.read";
  if(!(scope?hasCapability(principal,capability,scope):principal.access.capabilities.includes(capability)))return deny("context_project_denied");
  if(canvasId&&!(scope?hasCapability(principal,"project.canvas.use",scope):principal.access.canvasAccess))return deny("context_canvas_denied");
  const currentTarget=projection.libraryBlocks.find((block)=>block.id===blockId&&block.projectId===projectId),historical=history.libraryBlocks.find((block)=>block.id===blockId&&block.projectId===projectId);
  const target=currentTarget??(historical?{...historical,removed:true}:undefined);
  if(target?.scope==="document"&&target.documentId!==documentId)return deny("context_block_not_found",404);
  if(targetKind==="block"&&target&&((target.scope==="canvas"?target.canvasId:null)!==canvasId))return deny("context_canvas_required",409);
  if(authority==="author"&&(targetKind==="block"&&(!target||target.removed||target.locked)||!projection.documents.some((document)=>document.id===documentId&&!document.removed)))return deny("context_changes_source_protected",409);
  if(canvasId&&authority==="author"&&!foldCanvasEvents(events,projectId,canvasId).canvases.some((canvas)=>canvas.id===canvasId&&canvas.projectId===projectId))return deny("context_canvas_unavailable",409);
  if(targetKind==="block"&&!target)return deny("context_block_not_found",404);
  const sourceHash=await contextSourceHash(projectId,documentId,target,projection,events);
  const binding:ConsequentialBinding={version:"human-context-authoring-v1",intentHash:sourceHash,operation:"context-proposal",actorUserId:principal.userId,permissionEpoch:principal.access.permissionEpoch,streamId,projectId,documentId,canvasId,blockId,sourceHash,period:new Date().toISOString().slice(0,7),scope:scope??null,contextSessionId:shared?.contextId??null,pilotCohortId:null,steps:[],publicQuery:"",request:{}};
  return{principal,binding,sourceHead,projection,target,shared,scope,events};
}

export async function prepareContextAuthority(request:Request,env:WorkerEnv,body:Record<string,unknown>,authority:"read"|"author"){
  const prepared=await prepareCreativeAuthority(request,env,body,authority,"block");
  if(prepared instanceof Response)return prepared;
  if(!prepared.target)return Response.json({error:"context_block_not_found"},{status:404});
  return{...prepared,target:prepared.target};
}

/** Document-level operations work without inventing a target block or unlocking authored facts. */
export async function prepareDocumentAuthority(request:Request,env:WorkerEnv,body:Record<string,unknown>,authority:"read"|"author",sourceObserver?:AssistantContextReadObserver){
  return prepareCreativeAuthority(request,env,{...body,blockId:""},authority,"document",sourceObserver);
}

/** A durable executor rechecks its original real session/custody, then reads exact canonical history. */
export async function readDocumentExecutionAuthority(env:WorkerEnv,principal:PilotUser,binding:ConsequentialBinding,sourceObserver?:AssistantContextReadObserver){
  if(principal.userId!==binding.actorUserId)throw new Error("context_authorization_changed");
  const scope=binding.scope??undefined;
  if(!(scope?hasCapability(principal,"project.author",scope)&&hasCapability(principal,"project.output.request",scope):principal.access.capabilities.includes("project.author")&&principal.access.capabilities.includes("project.output.request")))throw new Error("context_authorization_changed");
  // Head and initial authorization are read in one native snapshot. This is
  // not a cached access decision: the final exact-head authority check remains.
  const guard=executionAdmissionGuard(principal,binding,null);
  const admitted=await env.DB.prepare(`SELECT (SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?) AS head WHERE ${guard.sql}`)
    .bind(binding.streamId,...guard.bindings).first<{head:number}>();
  if(!admitted||!Number.isSafeInteger(admitted.head)||admitted.head<0)throw new Error("context_authorization_changed");
  const sourceHead=admitted.head;
  const events=scope?await readProjectSourceEvents(env,scope,{sourceObserver}):await personalSourceEvents(env,principal.userId,binding.streamId,sourceObserver);
  const projection=foldEvents(events,Infinity,binding.documentId,binding.projectId);
  if(!projection.documents.some((item)=>item.id===binding.documentId&&item.projectId===binding.projectId&&!item.removed))throw new Error("context_document_denied");
  if(binding.canvasId&&(!(scope?hasCapability(principal,"project.canvas.use",scope):principal.access.canvasAccess)||!foldCanvasEvents(events,binding.projectId,binding.canvasId).canvases.some((item)=>item.id===binding.canvasId&&item.projectId===binding.projectId)))throw new Error("context_canvas_unavailable");
  if(!await executionAuthorityCurrent(env,principal,binding,sourceHead))throw new Error("context_authorization_changed");
  return{principal,binding,sourceHead,projection,scope,events};
}
