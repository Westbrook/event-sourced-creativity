import { ASSISTANT_STATE_EVENT_SQL } from "../src/model/assistant-event-views.ts";
import { foldCanvasEvents } from "../src/canvas/model.ts";
import { foldEvents, type CreativeBlock, type CreativeEvent, type CreativeProjection } from "../src/model/events.ts";
import { consentHash, type ConsequentialBinding } from "./consequential-consent.ts";
import { hasCapability, requireConsent, requireUser, type ProjectExecutionScope } from "./pilot-policy.ts";
import { readProjectEventPage, readProjectRequestContext, resolveOwnerExecutionScope } from "./project-access.ts";
import { serializeEvent, streamHead, type WorkerEnv } from "./runtime.ts";

export const contextSourceHash=(projectId:string,documentId:string,target:CreativeBlock|undefined,projection:CreativeProjection,events:CreativeEvent[])=>consentHash({
  projectId,documentId,target,blocks:projection.libraryBlocks,relations:projection.libraryBlockRelations,documents:projection.documents,
  rights:events.filter((event)=>["RightsAsserted","ReferenceIngested"].includes(event.type)).map((event)=>({id:event.eventId,payload:event.payload})),
});

/** Read history and human authorship do not inherit paid-generation eligibility, text limits, or target mutability. */
export async function prepareContextAuthority(request:Request,env:WorkerEnv,body:Record<string,unknown>,authority:"read"|"author"){
  const deny=(error:string,status=403)=>Response.json({error},{status,headers:{"cache-control":"private, no-store"}});
  const auth=await requireUser(request,env,"viewer",{account:"principal"});if(auth.response||!auth.user)return auth.response??deny("authentication_required",401);
  const principal=auth.user,consent=requireConsent(principal);if(consent)return consent;
  const projectId=String(body.projectId??""),documentId=String(body.documentId??""),blockId=String(body.blockId??""),canvasId=String(body.canvasId??"")||null;
  if(!projectId||!documentId||!blockId||[projectId,documentId,blockId,canvasId??""].some((id)=>id.length>120))return deny("context_scope_required",400);
  const selected=await readProjectRequestContext(request,env,principal);if(selected.response)return selected.response;
  const shared=selected.context;if(shared&&shared.projectId!==projectId)return deny("context_project_denied");
  let scope:ProjectExecutionScope|undefined=shared?{organizationId:shared.organizationId,projectAccessId:shared.projectAccessId,actorUserId:principal.userId,projectId,ownerUserId:shared.ownerUserId}:undefined;
  const streamId=shared?`creative:${shared.ownerUserId}`:principal.streamId,sourceHead=await streamHead(env,streamId);
  const events:CreativeEvent[]=[];
  if(shared){let after=0;for(;;){const page=await readProjectEventPage(env,shared,after,5000,false);events.push(...page.events.filter((event)=>event.type!=="ProjectResourceRestricted"));if(!page.hasMore)break;if(page.nextAfter<=after)return deny("context_project_history_unavailable",503);after=page.nextAfter;}}
  else events.push(...(await env.DB.prepare(`SELECT event.*,secret.private_json FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.redacted_at IS NULL WHERE event.stream_id=? AND event.type IN(${ASSISTANT_STATE_EVENT_SQL}) ORDER BY event.sequence`).bind(principal.userId,streamId).all<Record<string,unknown>>()).results.map(serializeEvent));
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
  if(target&&((target.scope==="canvas"?target.canvasId:null)!==canvasId))return deny("context_canvas_required",409);
  if(authority==="author"&&(!target||target.removed||target.locked||!projection.documents.some((document)=>document.id===documentId&&!document.removed)))return deny("context_changes_source_protected",409);
  if(canvasId&&authority==="author"&&!foldCanvasEvents(events,projectId,canvasId).canvases.some((canvas)=>canvas.id===canvasId))return deny("context_canvas_unavailable",409);
  if(!target)return deny("context_block_not_found",404);
  const sourceHash=await contextSourceHash(projectId,documentId,target,projection,events);
  const binding:ConsequentialBinding={version:"human-context-authoring-v1",intentHash:sourceHash,operation:"context-proposal",actorUserId:principal.userId,permissionEpoch:principal.access.permissionEpoch,streamId,projectId,documentId,canvasId,blockId,sourceHash,period:new Date().toISOString().slice(0,7),scope:scope??null,contextSessionId:shared?.contextId??null,pilotCohortId:null,steps:[],publicQuery:"",request:{}};
  return{principal,binding,sourceHead,projection,target,shared,scope,events};
}
