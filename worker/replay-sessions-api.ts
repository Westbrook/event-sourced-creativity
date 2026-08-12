import { buildLiveReplayEvents, type LiveReplayPlan } from "../src/model/live-replay.ts";
import { generateCreativeImage, generateLiveReplayPlan } from "./openai-adapter.ts";
import { storeGeneratedImage } from "./media-api.ts";
import { appendAuditEvent, ensureSchema, uuidV7, type WorkerEnv } from "./runtime.ts";
import { releaseBudget, requireConsent, requireUser, reserveBudget, settleBudget } from "./pilot-policy.ts";

const APPROVAL_PHRASE="I know what I'm doing";
const CONFIRMATION_VERSION="live-replay-v1";
const RESERVED_TOKENS=72_000;

type SessionRow=Record<string,unknown>;
const bool=(value:unknown)=>value===true;
const automationDeclared=(request:Request)=>["x-forma-automation","x-forma-test-run","x-forma-agent-run"].some((name)=>request.headers.get(name)==="true");
const enabled=(env:WorkerEnv)=>env.FORMA_LIVE_REPLAY_ENABLED!=="false";
const parseJson=<T>(value:unknown,fallback:T):T=>{try{return value?JSON.parse(String(value)) as T:fallback;}catch{return fallback;}};

const summary=(row:SessionRow)=>({
  sessionId:String(row.session_id),status:String(row.status),title:String(row.title),summary:String(row.summary),seed:String(row.seed),eventCount:Number(row.event_count),imageCount:Number(row.image_count),
  previewMediaUrl:row.preview_media_url?String(row.preview_media_url):null,finalMediaUrl:row.final_media_url?String(row.final_media_url):null,plannerModel:row.planner_model?String(row.planner_model):null,imageModel:row.image_model?String(row.image_model):null,
  usage:parseJson<Record<string,unknown>>(row.usage_json,{}),error:row.error_message?String(row.error_message):null,createdAt:String(row.created_at),completedAt:row.completed_at?String(row.completed_at):null,
});

async function listSessions(request:Request,env:WorkerEnv){
  const auth=await requireUser(request,env,"admin");if(auth.response||!auth.user)return auth.response!;
  const result=await env.DB.prepare("SELECT * FROM replay_sessions WHERE owner_id=? ORDER BY created_at DESC LIMIT 50").bind(auth.user.userId).all<SessionRow>();
  return Response.json({sessions:result.results.map(summary),liveGeneration:{enabled:enabled(env),configured:Boolean(env.OPENAI_API_KEY),approvalPhrase:APPROVAL_PHRASE,confirmationVersion:CONFIRMATION_VERSION,operations:["one structured planning response","one low-quality GPT Image draft","one high-quality GPT Image edit using the draft as reference"],savedForReuse:true}});
}

async function readSession(request:Request,env:WorkerEnv,sessionId:string){
  const auth=await requireUser(request,env,"admin");if(auth.response||!auth.user)return auth.response!;
  const row=await env.DB.prepare("SELECT * FROM replay_sessions WHERE session_id=? AND owner_id=?").bind(sessionId,auth.user.userId).first<SessionRow>();if(!row)return Response.json({error:"replay_session_not_found"},{status:404});
  return Response.json({session:summary(row),events:parseJson(row.events_json,[]),plan:parseJson(row.plan_json,null)});
}

async function grantApproval(request:Request,env:WorkerEnv){
  const auth=await requireUser(request,env,"admin");if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  if(!enabled(env))return Response.json({error:"live_replay_disabled"},{status:403});if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});
  if(automationDeclared(request))return Response.json({error:"direct_user_approval_required"},{status:403});
  const body=await request.json() as {phrase?:string;costAcknowledged?:boolean;directUserApproval?:boolean;confirmationVersion?:string;seed?:string;initiator?:string};
  const seed=String(body.seed??"").trim().slice(0,1200);
  if(body.phrase!==APPROVAL_PHRASE||!bool(body.costAcknowledged)||!bool(body.directUserApproval)||body.confirmationVersion!==CONFIRMATION_VERSION||body.initiator!=="direct-user")return Response.json({error:"explicit_live_replay_approval_required"},{status:428});
  const approvalId=uuidV7();const requestedAt=new Date();const expiresAt=new Date(requestedAt.getTime()+5*60_000);
  await env.DB.prepare("INSERT INTO replay_approvals (approval_id,owner_id,confirmation_version,seed,requested_at,expires_at,consumed_at) VALUES (?,?,?,?,?,?,NULL)").bind(approvalId,auth.user.userId,CONFIRMATION_VERSION,seed,requestedAt.toISOString(),expiresAt.toISOString()).run();
  await appendAuditEvent(env,auth.user.streamId,"user","LiveReplayApprovalGranted",{approval_id:approvalId,confirmation_version:CONFIRMATION_VERSION,expires_at:expiresAt.toISOString(),provider_operations:3,reusable_session:true});
  return Response.json({approvalId,expiresAt:expiresAt.toISOString(),reservedTokenCeiling:RESERVED_TOKENS});
}

const snapshotFor=(plan:LiveReplayPlan)=>({
  document_title:plan.document_title,user_goal:plan.user_goal,reference:plan.reference,
  facts:plan.blocks.map((block,index)=>({
    block_id:`live-block-${index+1}`,type:block.type,role:block.type,handle:`${block.type}/${block.label}`,intent:block.intent,
    effect:block.intent==="prohibit"?"must_not_include":block.intent==="avoid"?"deemphasize":"include",active:true,
    properties:{
      text:block.instruction,label:block.label,subtype:block.subtype,weight:block.weight,
      spatial_scope:block.applies_to==="document"
        ? {schema_version:1,kind:"document",coordinate_space:"document-normalized",feather:0,falloff:"hard",polarity:"inside"}
        : {schema_version:1,kind:"region",coordinate_space:"document-normalized",region:block.applies_to,instruction:`the ${block.applies_to} portion of the composition`,feather:.14,falloff:"contextual",polarity:"inside"},
    },
  })),
  standing_constraints:[plan.memory.preference],as_of:{source:"provider-backed-replay",complete:true},
});

async function createSession(request:Request,env:WorkerEnv){
  const auth=await requireUser(request,env,"admin");if(auth.response||!auth.user)return auth.response!;const consent=requireConsent(auth.user);if(consent)return consent;
  if(!enabled(env))return Response.json({error:"live_replay_disabled"},{status:403});if(!env.OPENAI_API_KEY)return Response.json({error:"provider_not_configured"},{status:503});if(automationDeclared(request))return Response.json({error:"direct_user_approval_required"},{status:403});
  const body=await request.json() as {approvalId?:string;directUserApproval?:boolean;confirmationVersion?:string;initiator?:string};
  if(!body.approvalId||!bool(body.directUserApproval)||body.confirmationVersion!==CONFIRMATION_VERSION||body.initiator!=="direct-user")return Response.json({error:"one_time_approval_required"},{status:428});
  const now=new Date().toISOString();const consumed=await env.DB.prepare("UPDATE replay_approvals SET consumed_at=? WHERE approval_id=? AND owner_id=? AND confirmation_version=? AND consumed_at IS NULL AND expires_at>?").bind(now,body.approvalId,auth.user.userId,CONFIRMATION_VERSION,now).run();
  if(Number(consumed.meta.changes??0)!==1)return Response.json({error:"approval_missing_expired_or_consumed"},{status:428});
  const approval=await env.DB.prepare("SELECT seed FROM replay_approvals WHERE approval_id=? AND owner_id=?").bind(body.approvalId,auth.user.userId).first<{seed:string}>();const seed=approval?.seed??"";
  const sessionId=uuidV7();await env.DB.prepare("INSERT INTO replay_sessions (session_id,owner_id,status,title,summary,seed,event_count,image_count,created_at) VALUES (?,?,?,'Preparing provider-backed mock','Planning, generating, and saving a reusable replay fixture.',?,0,0,?)").bind(sessionId,auth.user.userId,"running",seed,now).run();
  const reservation=await reserveBudget(env,auth.user.userId,RESERVED_TOKENS);if(!reservation.ok){await env.DB.prepare("UPDATE replay_sessions SET status='failed',error_message=?,completed_at=? WHERE session_id=?").bind(`budget_${reservation.scope}_hard_cap_reached`,new Date().toISOString(),sessionId).run();return Response.json({error:"budget_hard_cap_reached",scope:reservation.scope},{status:429});}
  try{
    const planned=await generateLiveReplayPlan(env,auth.user.userId,seed);const snapshot=snapshotFor(planned.output);
    const previewGenerationId=uuidV7();const preview=await generateCreativeImage(env,auth.user.userId,snapshot,planned.output.draft,{quality:"low",size:"1024x1024"});const previewMedia=await storeGeneratedImage(env,auth.user.userId,`replay-${sessionId}-preview-${previewGenerationId}`,preview.bytes,preview.model);
    const finalGenerationId=uuidV7();const final=await generateCreativeImage(env,auth.user.userId,snapshot,planned.output.final,{quality:"high",size:"1536x1024",reference:{bytes:preview.bytes,mimeType:preview.mimeType}});const finalMedia=await storeGeneratedImage(env,auth.user.userId,`replay-${sessionId}-final-${finalGenerationId}`,final.bytes,final.model);
    const events=buildLiveReplayEvents(planned.output,{previewMediaUrl:previewMedia.url,finalMediaUrl:finalMedia.url,previewGenerationId,finalGenerationId,plannerModel:planned.model,imageModel:final.model,previewLatencyMs:preview.latencyMs,finalLatencyMs:final.latencyMs,createdAt:now},sessionId);
    const usage={inputTokens:planned.usage.inputTokens+preview.usage.inputTokens+final.usage.inputTokens,outputTokens:planned.usage.outputTokens+preview.usage.outputTokens+final.usage.outputTokens,totalTokens:planned.usage.totalTokens+preview.usage.totalTokens+final.usage.totalTokens,planningTokens:planned.usage.totalTokens,previewTokens:preview.usage.totalTokens,finalTokens:final.usage.totalTokens,reservedTokens:RESERVED_TOKENS,operations:3};
    await settleBudget(env,auth.user.userId,RESERVED_TOKENS,usage.totalTokens);const completedAt=new Date().toISOString();
    await env.DB.prepare("UPDATE replay_sessions SET status='complete',title=?,summary=?,event_count=?,image_count=2,preview_media_url=?,final_media_url=?,events_json=?,plan_json=?,usage_json=?,planner_model=?,image_model=?,completed_at=? WHERE session_id=?").bind(planned.output.title,planned.output.summary,events.length,previewMedia.url,finalMedia.url,JSON.stringify(events),JSON.stringify(planned.output),JSON.stringify(usage),planned.model,final.model,completedAt,sessionId).run();
    await appendAuditEvent(env,auth.user.streamId,"worker:replay","LiveReplaySessionCompleted",{replay_session_id:sessionId,event_count:events.length,image_count:2,planner_model:planned.model,image_model:final.model,reusable:true},body.approvalId);
    const row=await env.DB.prepare("SELECT * FROM replay_sessions WHERE session_id=?").bind(sessionId).first<SessionRow>();return Response.json({session:summary(row??{}),events,plan:planned.output});
  }catch(error){await releaseBudget(env,auth.user.userId,RESERVED_TOKENS);const message=error instanceof Error?error.message:"live_replay_generation_failed";const completedAt=new Date().toISOString();await env.DB.prepare("UPDATE replay_sessions SET status='failed',error_message=?,completed_at=? WHERE session_id=?").bind(message,completedAt,sessionId).run();await appendAuditEvent(env,auth.user.streamId,"worker:replay","LiveReplaySessionFailed",{replay_session_id:sessionId,error_class:message},body.approvalId);return Response.json({error:message,sessionId},{status:502});}
}

export async function handleReplaySessions(request:Request,env:WorkerEnv,sessionId=""){
  await ensureSchema(env);if(sessionId){if(request.method!=="GET")return new Response("Method not allowed",{status:405});return readSession(request,env,sessionId);}
  if(request.method==="GET")return listSessions(request,env);if(request.method==="POST")return createSession(request,env);return new Response("Method not allowed",{status:405});
}

export async function handleReplayApproval(request:Request,env:WorkerEnv){if(request.method!=="POST")return new Response("Method not allowed",{status:405});await ensureSchema(env);return grantApproval(request,env);}
