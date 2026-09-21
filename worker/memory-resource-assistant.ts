import { memoryResourceSelector,type MemoryResourceSelector } from '../src/model/memory-resource-scope.ts';
import { consentedTextPricing,assertConsentedTextPricing,maximumConsentedTextMicrousd,priceConsentedTextUsageMicrousd,type ConsentedTextPricing } from '../src/model/consented-text-pricing.ts';
import { prepareNativeMemoryResourceAuthority,prepareNativeMemoryResourceAuthorityForPrincipal,nativeMemoryResourceScopeInputs } from './memory-resource-authority.ts';
import { prepareNativeResourceAssistantContext,nativeResourceAssistantContextInputs } from './memory-resource-context.ts';
import { prepareNativeResourceAssistantRun,nativeResourceAssistantRunInputs,nativeResourceAssistantRunGuards,nativeResourceAssistantQuoteStatements,nativeResourceAssistantContentStatements,type NativeResourceAssistantRun } from './memory-resource-assistant-store.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { derivationExact,derivationHash,derivationConsentId } from './memory-derivation-policy.ts';
import { memoryDerivationJsonUniqueKeys } from './memory-derivation-result.ts';
import { memoryResourceSchema } from './memory-resource-settings.ts';
import { readNativeControlBody } from './native-control-body.ts';
import { requireUser,requireConsent,hasCapability,readAccountBudgets,pilotExecutionAllowance,preparePrivateContent,type PilotUser,type ProjectExecutionScope } from './pilot-policy.ts';
import { consentHash,canonicalConsent,quoteConsequentialExecution,claimConsequentialExecution,reserveConsequentialSteps,beginConsequentialStep,settleConsequentialStep,failConsequentialExecution,completeConsequentialExecution,reconcileConsequentialUsage,proveConsequentialStepNotSubmitted,executionContentCustodyGuard,type ConsequentialBinding,type ConsequentialPreview,type ExecutionRow } from './consequential-consent.ts';
import { buildAssistantProviderRequest,readBoundedAssistantProviderResponse,readAssistantProviderUsage,decodeAssistantProviderResult,MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES } from './assistant-provider.ts';
import type { MemorySqlGuard } from './memory-sql.ts';
import type { WorkerEnv } from './runtime.ts';

const VERSION='resource-memory-assistant-v1',MODEL='gpt-5.6-luna',MAX_OUTPUT=1200;
type Selection={principal:PilotUser;selector:MemoryResourceSelector;scope:ProjectExecutionScope|null};
type RequestData={version:typeof VERSION;resource:MemoryResourceSelector;contextId:string;snapshotSha256:string;question:string;locale:'en'|'fr'|'ar'|'ja';providerRequest:Record<string,unknown>;pricing:ConsentedTextPricing};
type Retained={row:ExecutionRow;binding:ConsequentialBinding;preview:ConsequentialPreview;request:RequestData;run:NativeResourceAssistantRun;serialized:string};
const reply=(value:Record<string,unknown>,status=200)=>Response.json({version:VERSION,...value},{status,headers:{'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
const enrolled=(value:string|undefined,userId:string)=>(value??'').split(',').map(v=>v.trim()).includes(userId);
const available=(env:WorkerEnv,principal:PilotUser)=>Boolean(env.OPENAI_API_KEY)&&enrolled(env.FORMA_ASSISTANT_INTERNAL_USER_IDS,principal.userId)&&enrolled(env.FORMA_ASSISTANT_PROVIDER_USER_IDS,principal.userId)
 &&(env.FORMA_ASSISTANT_ALLOWED_MODELS===undefined||enrolled(env.FORMA_ASSISTANT_ALLOWED_MODELS,MODEL));
const canPurchase=(principal:PilotUser,scope:ProjectExecutionScope|null)=>(['project.author','project.output.request'] as const).every(capability=>scope?hasCapability(principal,capability,scope):principal.access.capabilities.includes(capability));
const executionIdValid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v);
const questionValid=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.isWellFormed()&&Array.from(v).length<=2000;
function finalReply(env:WorkerEnv,run:NativeResourceAssistantRun,value:Record<string,unknown>){const out=reply(value);nativeResourceAssistantRunInputs(env,run);return out;}
const sourceScope=(identity:ReturnType<typeof nativeMemoryResourceScopeInputs>['identity']):ProjectExecutionScope|null=>identity.organizationId?{organizationId:identity.organizationId,projectAccessId:identity.projectAccessId!,projectId:identity.projectId,ownerUserId:identity.ownerUserId,actorUserId:identity.actorUserId}:null;
async function context(env:WorkerEnv,selection:Selection,contextId?:string){const authority=await prepareNativeMemoryResourceAuthorityForPrincipal(env,selection.principal,selection.selector,selection.scope);return {authority,context:await prepareNativeResourceAssistantContext(env,authority,contextId)};}
const runFence=(env:WorkerEnv,run:NativeResourceAssistantRun)=>{const i=nativeResourceAssistantRunInputs(env,run);return {sql:"EXISTS(SELECT 1 FROM memory_resource_assistant_runs run JOIN memory_resource_contexts context ON context.context_id=run.context_id WHERE run.execution_id=? AND run.actor_user_id=? AND run.context_id=? AND run.snapshot_sha256=? AND run.state='active' AND context.state='active' AND context.snapshot_sha256=run.snapshot_sha256 AND run.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[i.executionId,i.history.scope.actorUserId,i.contextId,i.snapshotSha256]};};
async function verifiedRead(env:WorkerEnv,run:NativeResourceAssistantRun,read:D1PreparedStatement,extra:MemorySqlGuard[]=[]){const db=env.DB,proof=[...nativeResourceAssistantRunGuards(env,run),...extra].map(g=>derivationAssertion(env,g)),frames=structuredClone(await db.batch<Record<string,unknown>>([...proof,read]));nativeResourceAssistantRunInputs(env,run);if(env.DB!==db||!derivationResults(frames,proof.length+1)||!frames.slice(0,proof.length).every(derivationVerified)||frames.at(-1)!.results.length>1)throw Error('resource_assistant_read');return frames.at(-1)!.results[0]??null;}
// Request-local reuse keeps the original short-lived source lease and exact
// quote bytes. Every subsequent transaction replays source, custody and consent
// predicates; no positive authorization cache or renewed source grant.
function consentGuard(value:Retained):MemorySqlGuard{
 const custody=executionContentCustodyGuard(value.binding,'content');
 return {condition:`EXISTS(SELECT 1 FROM consequential_executions execution JOIN memory_resource_assistant_contents link ON link.execution_id=execution.execution_id AND link.role='consent' JOIN private_content content ON content.content_id=link.content_id AND content.content_id=execution.consent_ref
  WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.consent_ref=? AND content.owner_id=execution.actor_user_id AND content.kind='execution-consent' AND content.content=? AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql})`,bindings:[value.row.execution_id,value.binding.actorUserId,value.row.binding_hash,value.row.consent_ref,value.serialized,...custody.bindings]};
}
const retainedGuards=(env:WorkerEnv,value:Retained)=>[...nativeResourceAssistantRunGuards(env,value.run),consentGuard(value)];
const retainedFence=(env:WorkerEnv,value:Retained)=>{const fence=runFence(env,value.run),consent=consentGuard(value);return {sql:'('+fence.sql+') AND ('+consent.condition+')',bindings:[...fence.bindings,...consent.bindings]};};
async function refreshRetained(env:WorkerEnv,value:Retained):Promise<Retained>{
 const row=await verifiedRead(env,value.run,env.DB.prepare('SELECT * FROM consequential_executions WHERE execution_id=? AND actor_user_id=?').bind(value.row.execution_id,value.binding.actorUserId),[consentGuard(value)]);
 if(!row||row.binding_hash!==value.row.binding_hash||row.consent_ref!==value.row.consent_ref)throw Error('resource_assistant_changed');return {...value,row:row as unknown as ExecutionRow};
}
async function roleContent(env:WorkerEnv,retained:Retained,role:'response'|'result'){
 const custody=executionContentCustodyGuard(retained.binding,'content'),kind=role==='response'?'provider-response':'context-proposal';
 return verifiedRead(env,retained.run,env.DB.prepare(`SELECT content.content_id,content.content FROM memory_resource_assistant_contents link JOIN private_content content ON content.content_id=link.content_id JOIN consequential_executions execution ON execution.execution_id=link.execution_id
  WHERE execution.binding_hash=? AND execution.consent_ref=? AND execution.actor_user_id=? AND ${role==='result'?"execution.status='completed' AND execution.result_ref=content.content_id":"execution.status IN('reserved','uncertain','failed','completed')"} AND link.execution_id=? AND link.role=? AND content.owner_id=? AND content.kind=? AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
  AND length(CAST(content.content AS BLOB))<=? AND ${custody.sql} LIMIT 2`).bind(retained.row.binding_hash,retained.row.consent_ref,retained.binding.actorUserId,retained.row.execution_id,role,retained.binding.actorUserId,kind,role==='response'?MAX_ASSISTANT_PROVIDER_RESPONSE_BYTES:16384,...custody.bindings),[consentGuard(retained)]);
}
async function retained(env:WorkerEnv,selection:Selection,id:string):Promise<Retained>{
 const source=await context(env,selection),run=await prepareNativeResourceAssistantRun(env,source.context,id),input=nativeResourceAssistantRunInputs(env,run);
 const custody=executionContentCustodyGuard({actorUserId:selection.principal.userId,scope:selection.scope},'content');
 const row=await verifiedRead(env,run,env.DB.prepare(`SELECT execution.*,content.content AS consent_content FROM consequential_executions execution JOIN memory_resource_assistant_contents link ON link.execution_id=execution.execution_id AND link.role='consent'
  JOIN private_content content ON content.content_id=execution.consent_ref AND content.content_id=link.content_id
  WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.operation='assistant-specialist' AND content.owner_id=execution.actor_user_id
   AND content.kind='execution-consent' AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content.content AS BLOB))<=131072 AND ${custody.sql} LIMIT 2`).bind(id,selection.principal.userId,...custody.bindings));
 if(!row||typeof row.consent_content!=='string')throw Error('resource_assistant_unavailable');const {consent_content:serialized,...execution}=row,parsed=JSON.parse(serialized),binding=parsed.binding as ConsequentialBinding,preview=parsed.preview as ConsequentialPreview,request=binding.request as RequestData;
 if(binding.version!==VERSION||binding.operation!=='assistant-specialist'||binding.actorUserId!==selection.principal.userId||binding.documentId!==''||binding.blockId!==''||binding.projectId!==selection.selector.projectId||binding.sourceHash!==input.snapshotSha256
  ||canonicalConsent(binding.scope)!==canonicalConsent(selection.scope)||await consentHash(binding)!==execution.binding_hash||preview.executionId!==id||preview.bindingHash!==execution.binding_hash
  ||!derivationExact(request,['version','resource','contextId','snapshotSha256','question','locale','providerRequest','pricing'])||request.version!==VERSION||request.contextId!==input.contextId||request.snapshotSha256!==input.snapshotSha256
  ||canonicalConsent(request.resource)!==canonicalConsent(selection.selector)||!questionValid(request.question)||!['en','fr','ar','ja'].includes(request.locale)||binding.steps.length!==1||binding.steps[0]?.model!==MODEL)throw Error('resource_assistant_consent_changed');
 assertConsentedTextPricing(request.pricing,MODEL);return {row:execution as unknown as ExecutionRow,binding,preview,request,run,serialized};
}
async function display(env:WorkerEnv,value:Retained){
 const result=await roleContent(env,value,'result'),input=nativeResourceAssistantRunInputs(env,value.run);let answer:string|undefined;
 if(result){const parsed=JSON.parse(String(result.content));if(!derivationExact(parsed,['version','executionId','bindingHash','reply','independentEvidence','mode'])||parsed.version!==VERSION||parsed.executionId!==value.row.execution_id||parsed.bindingHash!==value.row.binding_hash||parsed.independentEvidence!==false||parsed.mode!=='private-review'||typeof parsed.reply!=='string'||Array.from(parsed.reply).length>2400||value.row.status!=='completed'||result.content_id!==value.row.result_ref)throw Error('resource_assistant_result_changed');answer=parsed.reply;}
 return finalReply(env,value.run,{executionId:value.row.execution_id,status:value.row.status,validUntil:input.history.validUntil,asOf:input.history.asOf,scope:input.history.scope,...(answer?{result:{reply:answer,mode:'private-review',independentEvidence:false}}:{}),noAutomaticRetry:true});
}
async function publishRetainedResponse(env:WorkerEnv,selection:Selection,value:Retained){
 const raw=await roleContent(env,value,'response');if(!raw)return;
 if(!memoryDerivationJsonUniqueKeys(String(raw.content)))throw Error('resource_assistant_response_invalid');const body=JSON.parse(String(raw.content)),receipt=readAssistantProviderUsage(body,{model:MODEL}),cost=priceConsentedTextUsageMicrousd(value.request.pricing,receipt.usage);
 await settleConsequentialStep(env,selection.principal.userId,value.row.execution_id,0,receipt.usage.totalTokens,cost,receipt.responseId,{atomicSpecialistPair:true});
 const outputText=Array.isArray(body?.output)?body.output.find((item:Record<string,unknown>)=>item?.type==='message')?.content?.[0]?.text:undefined;
 if(typeof outputText==='string'&&!memoryDerivationJsonUniqueKeys(outputText))throw Error('resource_assistant_response_invalid');
 const parsed=decodeAssistantProviderResult(body,{model:MODEL,maximumInputTokens:value.binding.steps[0]!.inputTokens,maximumOutputTokens:MAX_OUTPUT,aliases:{}});if(parsed.actions.length)throw Error('resource_assistant_actions_denied');
 // Fresh exact scope and source capture after finance/provider work. A changed
 // or deleted selection cannot be replaced by a new selection implicitly.
 const fresh=await refreshRetained(env,value);
 await completeConsequentialExecution(env,selection.principal,fresh.binding,fresh.row.execution_id,{version:VERSION,executionId:fresh.row.execution_id,bindingHash:fresh.row.binding_hash,reply:parsed.reply,independentEvidence:false,mode:'private-review'},retainedFence(env,fresh),{
  precommit:()=>retainedGuards(env,fresh).map(g=>derivationAssertion(env,g)),publish:id=>nativeResourceAssistantContentStatements(env,fresh.run,id,'result')});
}
/** Dedicated native resource consumer: no document, event, authored output or
 * inherited conversation. Every provider request requires its own cost approval.
 * Never start/retry provider work from GET, recovery or a stored activity grant. */
export async function handleMemoryResourceAssistant(request:Request,env:WorkerEnv){
 const url=new URL(request.url),db=env.DB;if(request.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(request.headers.get('origin')!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')return reply({error:'same_origin_required'},403);
 let executing:string|undefined,actorId:string|undefined,undispatched:{id:string;hash:string}|undefined,fetchStarted=false;
 try{
  if([...url.searchParams.keys()].some(k=>!['kind','projectId','resourceId'].includes(k)||url.searchParams.getAll(k).length!==1))throw Error('selection');const selector=memoryResourceSelector(Object.fromEntries(url.searchParams));if(!selector)throw Error('selection');
  const parsed=await readNativeControlBody(request,16384);if(parsed.status!=='parsed')throw Error('body');const body=parsed.value,action=body.action;
  if(action==='controls'?!derivationExact(body,['action']):action==='quote'?!derivationExact(body,['action','contextId','question','locale'])||!derivationConsentId(body.contextId)||!questionValid(body.question)||!['en','fr','ar','ja'].includes(String(body.locale)):!['execute','retrieve','resume','reconcile'].includes(String(action))||!derivationExact(body,action==='execute'?['action','executionId','approvedBindingHash']:['action','executionId'])||!executionIdValid(body.executionId)||action==='execute'&&!derivationHash(body.approvedBindingHash))throw Error('body');
  const auth=await requireUser(request,env,'viewer',{account:'principal'}),principal=auth.user;if(auth.response||!principal||principal.fictional||principal.projectExecution||!['reconcile','controls'].includes(String(action))&&requireConsent(principal)||request.headers.get('cookie')?.split(';').some(c=>c.trim().startsWith('forma_impersonation=')))return reply({error:'principal_account_required'},403);actorId=principal.userId;
  const schema=await memoryResourceSchema(env);if(!schema.assistantRuns)throw Error('schema');
  if(env.DB!==db)throw Error('database_changed');
  if(action==='controls'){
   const rows=await db.prepare(`SELECT run.execution_id,run.state,run.created_at,run.expires_at,execution.status,json_extract(run.resource_key,'$[1]') AS owner_user_id
    FROM memory_resource_assistant_runs run JOIN consequential_executions execution ON execution.execution_id=run.execution_id
    WHERE run.actor_user_id=? AND execution.actor_user_id=run.actor_user_id AND json_extract(run.resource_key,'$[4]')=? AND json_extract(run.resource_key,'$[5]')=? AND json_extract(run.resource_key,'$[6]')=?
    ORDER BY run.created_at DESC,run.execution_id DESC LIMIT 17`).bind(principal.userId,selector.kind,selector.projectId,selector.resourceId).all<Record<string,unknown>>();
   if(env.DB!==db||!derivationResults([rows],1)||rows.results.length>17||rows.results.some(row=>!derivationExact(row,['execution_id','state','created_at','expires_at','status','owner_user_id'])))throw Error('inventory');
   return reply({accountingControlsOnly:true,sourceContentRead:false,runs:rows.results.slice(0,16),more:rows.results.length>16,noAutomaticRetry:true});
  }
  if(action==='reconcile'){
   const owned=await env.DB.prepare("SELECT run.execution_id FROM memory_resource_assistant_runs run JOIN consequential_executions execution ON execution.execution_id=run.execution_id WHERE run.execution_id=? AND run.actor_user_id=? AND execution.actor_user_id=run.actor_user_id AND execution.operation='assistant-specialist'").bind(body.executionId,principal.userId).first();if(!owned||env.DB!==db)throw Error('execution');
   await reconcileConsequentialUsage(env,principal.userId,body.executionId as string,{atomicSpecialistPair:true});
   const status=await env.DB.prepare('SELECT status FROM consequential_executions WHERE execution_id=? AND actor_user_id=?').bind(body.executionId,principal.userId).first<{status:string}>();
   if(env.DB!==db)throw Error('database_changed');return reply({executionId:body.executionId,status:status?.status??'unavailable',accountingOnly:true,providerCalled:false,noAutomaticRetry:true});
  }
  const authority=await prepareNativeMemoryResourceAuthority(request,env,selector),scopeInput=nativeMemoryResourceScopeInputs(env,authority),scope=sourceScope(scopeInput.identity),selection={principal,selector,scope};
  if(action==='quote'){
   const source=await prepareNativeResourceAssistantContext(env,authority,body.contextId as string),input=nativeResourceAssistantContextInputs(env,source),history=input.history;
   const allowance=await pilotExecutionAllowance(env,principal.userId,scope??undefined);
   // Pilot purchasing keeps its separate qualified workflow; no resource route
   // bypasses sponsor/pilot policy through a document-free fallback.
   if(allowance.pilot||!canPurchase(principal,scope))throw Error('purchase_policy');
   const view={user_request:body.question,locale:body.locale,resource_activity:{kind:selector.kind,asOf:history.asOf,windows:history.windows,coverage:history.coverage,openings:history.openings},
    memory_evidence:{treatment:'untrusted-interpretation',independentEvidence:false,guidance:'Metadata-only surface openings and authored action counts. Not reading, comprehension, preferences or reasons for behavior. Interpret cautiously, offer optional next steps, preserve uncertainty and current explicit instructions. No access to linked documents. Return an empty actions array. No edits, permissions, outputs or further purchases.'},blocks:[],relationships:[],recent_conversation:[]};
   const providerRequest=await buildAssistantProviderRequest(principal.userId,{model:MODEL,locale:String(body.locale),maximumOutputTokens:MAX_OUTPUT,view}),inputTokens=new TextEncoder().encode(JSON.stringify(providerRequest)).byteLength+4096,pricing=consentedTextPricing(MODEL);
   if(inputTokens>32768)throw Error('capacity');const maximumMicrousd=maximumConsentedTextMicrousd(pricing,inputTokens,MAX_OUTPUT),data:RequestData={version:VERSION,resource:selector,contextId:input.contextId,snapshotSha256:input.snapshotSha256,question:body.question as string,locale:body.locale as RequestData['locale'],providerRequest,pricing};
   const binding:ConsequentialBinding={version:VERSION,intentHash:await consentHash([VERSION,principal.userId,input.contextId,body.question,body.locale]),operation:'assistant-specialist',actorUserId:principal.userId,permissionEpoch:principal.access.permissionEpoch,streamId:'creative:'+scopeInput.identity.ownerUserId,projectId:selector.projectId,documentId:'',canvasId:selector.kind==='canvas'?selector.resourceId:null,blockId:'',sourceHash:input.snapshotSha256,period:new Date().toISOString().slice(0,7),scope,contextSessionId:null,pilotCohortId:null,steps:[{name:'resource-guidance',provider:'OpenAI',model:MODEL,inputTokens,outputTokens:MAX_OUTPUT,maximumMicrousd,toolCalls:0}],publicQuery:'',request:data};
   const quote=await quoteConsequentialExecution(env,principal,binding,{question:body.question,resourceActivity:view.resource_activity,modelRequest:providerRequest,authorship:'Private tentative review only. No authored work is changed.'},scopeInput.sourceHead,Infinity,{sql:'1',bindings:[]},(id,ref)=>nativeResourceAssistantQuoteStatements(env,source,id,ref)),saved=await retained(env,selection,quote.executionId);
   let availableMicrousd:number|null=null;try{const budgets=await readAccountBudgets(env,principal.userId,scope?.organizationId);availableMicrousd=Math.min(budgets.costBudgets.user.remainingMicrousd,budgets.costBudgets.workspace.remainingMicrousd);}catch{/* Unknown capacity cannot enable a purchase. */}
   await verifiedRead(env,saved.run,env.DB.prepare('SELECT 1 AS verified'));
   return finalReply(env,saved.run,{executionId:saved.row.execution_id,validUntil:nativeResourceAssistantRunInputs(env,saved.run).history.validUntil,quote:{...saved.preview,status:saved.row.status,providerAvailable:available(env,principal),availableMicrousd,canExecute:saved.row.status==='quoted'&&available(env,principal)&&availableMicrousd!==null&&availableMicrousd>=maximumMicrousd},noAutomaticRetry:true});
  }
  const value=await retained(env,selection,body.executionId as string);
  if(action==='retrieve')return await display(env,value);
  if(action==='resume'){await reconcileConsequentialUsage(env,principal.userId,value.row.execution_id,{atomicSpecialistPair:true});if(!value.row.result_ref)await publishRetainedResponse(env,selection,value);return await display(env,await refreshRetained(env,value));}
  if(value.row.binding_hash!==body.approvedBindingHash)return reply({error:'approval_changed'},409);
  if(!available(env,principal))throw Error('provider_unavailable');
  const allowance=await pilotExecutionAllowance(env,principal.userId,scope??undefined);if(allowance.pilot||value.binding.pilotCohortId||!canPurchase(principal,scope))throw Error('purchase_policy');
  const claim=await claimConsequentialExecution(env,principal,value.binding,value.row.execution_id,body.approvedBindingHash as string,scopeInput.sourceHead,retainedGuards(env,value).map(g=>derivationAssertion(env,g)),runFence(env,value.run));
  if(claim.error)throw Error('approval_changed');if(claim.reused)return await display(env,await refreshRetained(env,value));executing=value.row.execution_id;
  await reserveConsequentialSteps(env,principal,value.binding,executing,retainedFence(env,value),{atomicSpecialistPair:true});
  nativeResourceAssistantRunInputs(env,value.run);
  await beginConsequentialStep(env,principal,value.binding,executing,0,scopeInput.sourceHead,retainedFence(env,value),{separateSourceProof:true,additionalAssertions:retainedGuards(env,value).map(g=>({sql:g.condition,bindings:[...g.bindings]}))});
  undispatched={id:executing,hash:value.row.binding_hash};const providerBody=JSON.stringify(value.request.providerRequest);nativeResourceAssistantRunInputs(env,value.run);if(!available(env,principal))throw Error('provider_unavailable');
  const controller=new AbortController();let timeout:ReturnType<typeof setTimeout>|undefined;
  let raw:string;
  try{fetchStarted=true;raw=await Promise.race([fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:controller.signal,headers:{authorization:'Bearer '+env.OPENAI_API_KEY,'content-type':'application/json'},body:providerBody}).then(response=>{if(!response.ok)throw Error('provider_unconfirmed');return readBoundedAssistantProviderResponse(response,controller.signal);}),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(Error('provider_timeout'));},25000);})]);}
  finally{clearTimeout(timeout);controller.abort();}
  if(!memoryDerivationJsonUniqueKeys(raw))throw Error('provider_unconfirmed');const envelope=JSON.parse(raw),receipt=readAssistantProviderUsage(envelope,{model:MODEL}),cost=priceConsentedTextUsageMicrousd(value.request.pricing,receipt.usage);
  // Verified usage must survive source withdrawal. Publication remains a
  // separate atomic source-checked transaction; settlement never widens access.
  try{
   nativeResourceAssistantRunInputs(env,value.run);const content=await preparePrivateContent(env,principal.userId,'provider-response',raw,scope??undefined),proof=retainedGuards(env,value).map(g=>derivationAssertion(env,g)),statements=[...proof,...content.statements,...nativeResourceAssistantContentStatements(env,value.run,content.contentId,'response')],db=env.DB,checked=await db.batch(statements);
   if(env.DB!==db||!derivationResults(checked,statements.length)||!checked.slice(0,proof.length).every(derivationVerified)||!derivationVerified(checked.at(-1)!))throw Error('response_unconfirmed');nativeResourceAssistantRunInputs(env,value.run);
  }finally{await settleConsequentialStep(env,principal.userId,executing,0,receipt.usage.totalTokens,cost,receipt.responseId,{atomicSpecialistPair:true});}
  await publishRetainedResponse(env,selection,value);return await display(env,await refreshRetained(env,value));
 }catch{if(undispatched&&!fetchStarted&&actorId)try{await proveConsequentialStepNotSubmitted(env,actorId,undispatched.id,0,undispatched.hash);}catch{/* Unknown acknowledgement remains held. */}
  if(executing&&actorId)try{await failConsequentialExecution(env,actorId,executing,'resource_assistant_unconfirmed');}catch{/* Retain unknown submission/usage holds. No inferred release or retry. */}return reply({error:'resource_assistant_unavailable',...(executing?{executionId:executing}:{}),noAutomaticRetry:true},409);}
}

/** Source-free accounting remains necessary when learning/recall is disabled.
 * It cannot read a response, dispatch, release unknown usage or enroll anyone. */
export async function reconcileResourceAssistantUsage(env:WorkerEnv){
 const inventory=await env.DB.prepare("SELECT 1 AS present FROM sqlite_schema WHERE name='memory_resource_assistant_runs' AND type='table'").first();if(!inventory)return 0;
 const schema=await memoryResourceSchema(env);if(!schema.assistantRuns)return 0;
 const db=env.DB,frames=await db.batch<Record<string,unknown>>([derivationAssertion(env,schema),db.prepare(`SELECT DISTINCT run.execution_id,run.actor_user_id FROM memory_resource_assistant_runs run JOIN consequential_execution_steps step ON step.execution_id=run.execution_id
  WHERE step.status='usage-recorded' OR step.status='not-submitted' AND (EXISTS(SELECT 1 FROM budget_reservations tokens WHERE tokens.reservation_id=step.token_reservation_id AND tokens.owner_id=run.actor_user_id AND tokens.status='active') OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=step.cost_reservation_id AND cost.owner_id=run.actor_user_id AND cost.status IN('active','executing'))) ORDER BY run.execution_id LIMIT 16`)]);
 if(env.DB!==db||!derivationResults(frames,2)||!derivationVerified(frames[0]!)||frames[1]!.results.length>16)throw Error('resource_accounting_inventory');
 let completed=0;for(const row of frames[1]!.results){if(!derivationExact(row,['execution_id','actor_user_id'])||typeof row.execution_id!=='string'||typeof row.actor_user_id!=='string')throw Error('resource_accounting_inventory');try{await reconcileConsequentialUsage(env,row.actor_user_id,row.execution_id,{atomicSpecialistPair:true});completed++;}catch{/* Preserve the exact uncertain/usage-recorded rows for later recovery. */}}return completed;
}
