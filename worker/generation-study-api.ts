import {createAuthoringStudyApproval} from './authoring-study-approval.ts';
import {canonicalConsent} from './consequential-consent.ts';
import {opaque,readStudyEvidence,studyFail} from './authoring-study-proof.ts';
import {cleanupStudyProposal} from './generation-study-cleanup.ts';
import type {StudyApprovalEnv,StudyApprovalProposal} from './authoring-study-types.ts';
import type {PilotUser} from './pilot-policy.ts';
import {memoryDerivationJsonUniqueKeys} from './memory-derivation-result.ts';
// @ts-expect-error Existing P2 host, including durable one-purchase state and recovery.
import {createNativeStudyHost} from '../evals/generation-reliability/native-host/host.mjs';
// @ts-expect-error Existing authenticated recovery; never bootstrap a principal.
import {authenticateStudy} from '../evals/generation-reliability/native-host/authority.mjs';
// @ts-expect-error Existing original operation identities and source-free account hash.
import {operationKey} from '../evals/generation-reliability/execution-plan.mjs';
// @ts-expect-error Existing canonical hashing and freezing.
import {hash,freeze} from '../evals/generation-reliability/core.mjs';

export const SITES_STUDY_PREFIX='/api/internal/generation-study/';
export type SitesStudyConfiguration={entries:readonly {proposal:StudyApprovalProposal;account:{accountId:string;region:'us'|'eu'|'global'};credentialSha256:string;projectHeaderSha256:string|null}[]};
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
const keys=(body:Record<string,unknown>,expected:string[])=>canonicalConsent(Object.keys(body).sort())===canonicalConsent(expected.sort());
async function command(request:Request){
 if(request.method!=='POST'||request.headers.get('content-type')?.split(';')[0]!=='application/json')studyFail('command_required');
 const reader=request.body?.getReader();if(!reader)studyFail('command_required');
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const r=await reader!.read();if(r.done)break;size+=r.value.byteLength;if(size>2048){void reader!.cancel().catch(()=>{});studyFail('command_too_large');}chunks.push(r.value);}}finally{reader!.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 if(!memoryDerivationJsonUniqueKeys(raw))studyFail('command_invalid');
 const body=JSON.parse(raw) as Record<string,unknown>;
 if(!body||Array.isArray(body)||!opaque(body.proposalId))studyFail('command_invalid');
 return body;
}
/** Selectors only. No HTTP proposal, SQL, evidence-issuer, charge-entry or flag API.
 * One compiled finite actual proposal at most; a fixture factory is test-local.
 * Environment flags cannot create authority when the compiled list is empty. */
export function createSitesStudyApi(configuration:SitesStudyConfiguration){
 const selected=freeze(structuredClone(configuration)) as SitesStudyConfiguration;
 const approval=createAuthoringStudyApproval({proposals:selected.entries.map(e=>e.proposal)});
 return async(request:Request,env:StudyApprovalEnv):Promise<Response>=>{
  const path=new URL(request.url).pathname,action=path.slice(SITES_STUDY_PREFIX.length);
  if(!path.startsWith(SITES_STUDY_PREFIX)||!['approval','execute','observe','recover','reconcile','stop','cleanup','cleanup-proposal'].includes(action))return response({status:'not-found'},404);
  if(action==='approval'&&env.FORMA_GENERATION_STUDY_APPROVAL_ENABLED!=='1'||action==='execute'&&env.FORMA_GENERATION_STUDY_ENABLED!=='1')return response({status:'disabled',newPurchases:0});
  // Original accounting and expiry cleanup remain reachable when purchase gates are off.
  if(selected.entries.length!==1)return response({status:'unconfigured',newPurchases:0},503);
  try{
   if(selected.entries.some(e=>e.proposal.classification!=='actual'))studyFail('actual_configuration_required');
   if(action==='approval')return approval(request,env);
   const body=await command(request),entry=selected.entries.find(e=>e.proposal.proposalId===body.proposalId);
   if(!entry)studyFail('proposal_unavailable');
   const p=entry!.proposal;
   const expected=action==='observe'?['proposalId','arm','safety','fidelity','finding','evidenceRef','resume']:['stop','cleanup-proposal'].includes(action)?['proposalId']:['proposalId','arm'];
   if(!keys(body,expected)||!['stop','cleanup-proposal'].includes(action)&&!['baseline','treatment'].includes(String(body.arm)))studyFail('command_invalid');
   if(action==='cleanup-proposal')return response(await cleanupStudyProposal(request,env,p));
   const a=await authenticateStudy(request,env,{recovery:true,supplied:true}) as {user:PilotUser};
   if(a.user.userId!==p.ownerId)studyFail('owner_mismatch');
   const trial=p.plan.manifest.trials.find(t=>t.id===body.arm);
   // Read only original policies; their seals and exact scopes are rechecked by P2 at I/O.
   const stored=await env.DB.prepare('SELECT policy_json FROM generation_study_financial_grants WHERE grant_id=? AND owner_id=?').bind(p.grantId,p.ownerId).all<{policy_json:string}>();
   if(!stored.success)studyFail('financial_unavailable');
   const financialPolicies=stored.results.map(r=>JSON.parse(r.policy_json));
   let hostEnv=env;
   if(action==='execute'){
    const key=env.OPENAI_API_KEY,project=env.OPENAI_PROJECT;
    if(!key||!opaque(entry!.credentialSha256)||hash(key)!==entry!.credentialSha256||(project?hash(project):null)!==entry!.projectHeaderSha256)studyFail('credential_binding_changed');
    for(const arm of p.arms){
     const refs=arm.evidence.filter(r=>r.kind==='account');if(refs.length!==1)studyFail('account_required');
     const records=await readStudyEvidence(env,p.ownerId,p.proposalId,refs,p.plan.packet.input.expiresAt);
     const account=records.contents[0] as {accountId?:string;region?:string;credentialBinding?:string;projectHeader?:string|null};
     if(account.accountId!==entry!.account.accountId||account.region!==entry!.account.region||account.credentialBinding!==entry!.credentialSha256||account.projectHeader!==entry!.projectHeaderSha256)studyFail('account_binding_changed');
    }
    // Pin credential/header values already checked for this one request.
    hostEnv={...env,OPENAI_API_KEY:key,OPENAI_PROJECT:project};
   }
   const host=createNativeStudyHost(hostEnv,{plan:p.plan,runtimeIdentity:p.runtimeIdentity,financialPolicies,financialAccount:entry!.account});
   const args={grantId:p.grantId,trialId:body.arm};
   if(action==='cleanup')return response(await host.cleanup(request,{operationId:operationKey(p.ownerId,p.plan,trial)}));
   if(action==='stop')return response(await host.control(request,{grantId:p.grantId,stopped:true}));
   if(action==='observe')return response(await host.observe(request,{...args,safety:body.safety,fidelity:body.fidelity,finding:body.finding,evidenceRef:body.evidenceRef,resume:body.resume}));
   if(action==='recover'){
    const result=await host.recover(request,args);
    if(result.bytes)return new Response(result.bytes,{headers:{'content-type':'image/png','cache-control':'private, no-store','content-disposition':'inline; filename="study-original.png"','x-study-operation':result.operationId,'x-study-accounting':result.accountingState}});
    return response(result);
   }
   if(action==='reconcile')return response(await host.reconcile(request,args));
   return response(await host.execute(request,args));
  }catch(error){
   const message=error instanceof Error?error.message:'';
   return response({status:'denied',error:/^(authoring_study_|study_)[a-z0-9_]+$/.test(message)?message:'study_request_denied',...(action==='execute'?{dispatchState:'inspect_original_operation'}:{newPurchases:0})},409);
  }
 };
}
