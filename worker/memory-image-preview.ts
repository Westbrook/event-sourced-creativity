import type { WorkerEnv } from './runtime.ts';
import { preparePrivateContent,readAccountBudgets,pilotExecutionAllowance,type BudgetReservationGuard,type PilotUser } from './pilot-policy.ts';
import { consentHash,canonicalConsent,quoteConsequentialExecution,claimConsequentialExecution,reserveConsequentialSteps,beginConsequentialStep,settleConsequentialStep,completeConsequentialExecution,failConsequentialExecution,reconcileConsequentialUsage,proveConsequentialStepNotSubmitted,executionContentCustodyGuard,type ConsequentialBinding,type ConsequentialPreview,type ExecutionRow } from './consequential-consent.ts';
import { generateCreativeImage } from './image-adapter.ts';
import { outputImageBudget } from './output-image-budget.ts';
import { inspectOutputAsset } from '../src/model/output-asset-inspection.ts';
import { derivationResults,derivationVerified,derivationAssertion,memoryDerivationSchema } from './memory-derivation-store.ts';
import { memoryDerivationJsonUniqueKeys } from './memory-derivation-result.ts';
import { priceImageUsageBreakdownMicrousd } from './replay-cost.ts';

const VERSION='memory-image-preview-v1',SIZE='1024x1024',MAX_BYTES=700000;
/** Native specialist source owner supplies exact same-transaction predicates.
 * Neither these predicates nor a source handle are accepted from HTTP. */
export type MemoryImageSource={principal:PilotUser;binding:ConsequentialBinding;parentExecutionId:string;parentResultRef:string;
 sourceHead:number;expiresAt:string;validUntil:string;prompt:string;canPurchase:()=>boolean;assertions:()=>D1PreparedStatement[];check:()=>void};
type Source=()=>Promise<MemoryImageSource>;
type PreviewRequest={version:typeof VERSION;parentExecutionId:string;parentBindingHash:string;parentResultRef:string;prompt:string;model:string;size:typeof SIZE;quality:'high';format:'jpeg';compression:80;budget:NonNullable<ReturnType<typeof outputImageBudget>>};
type Retained={row:ExecutionRow;binding:ConsequentialBinding;preview:ConsequentialPreview;request:PreviewRequest;serialized:string};
const response=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store','x-content-type-options':'nosniff',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'}});
const id=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9_-]{8,80}$/u.test(v);
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
function fence(source:MemoryImageSource){return {sql:`EXISTS(SELECT 1 FROM memory_derivation_asset_edges edge JOIN private_content content ON content.content_id=edge.target_id
 WHERE edge.target_kind='content' AND edge.target_id=? AND edge.owner_user_id=? AND edge.state='active' AND edge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND content.owner_id=edge.owner_user_id AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[source.parentResultRef,source.principal.userId]};}
function edge(env:WorkerEnv,source:MemoryImageSource,contentId:string){return env.DB.prepare(`INSERT INTO memory_derivation_asset_edges(source_kind,source_id,target_kind,target_id,owner_user_id,created_at,expires_at,state,retired_at)
 SELECT 'content',?,'content',content_id,owner_id,strftime('%Y-%m-%dT%H:%M:%fZ','now'),MIN(expires_at,?),'active',NULL FROM private_content WHERE content_id=? AND owner_id=?`)
 .bind(source.parentResultRef,source.expiresAt,contentId,source.principal.userId);}
function childProof(value:Retained){const custody=executionContentCustodyGuard(value.binding,'content');return {sql:`EXISTS(SELECT 1 FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.consent_ref
 JOIN memory_derivation_asset_edges edge ON edge.target_kind='content' AND edge.target_id=content.content_id
 WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.binding_hash=? AND execution.consent_ref=? AND content.content=?
 AND edge.source_kind='content' AND edge.source_id=? AND edge.owner_user_id=execution.actor_user_id AND edge.state='active' AND edge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND content.kind='execution-consent' AND content.owner_id=execution.actor_user_id AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql})`,bindings:[value.row.execution_id,value.binding.actorUserId,value.row.binding_hash,value.row.consent_ref,value.serialized,value.request.parentResultRef,...custody.bindings]};}
const assertion=(env:WorkerEnv,proof:BudgetReservationGuard)=>env.DB.prepare(`SELECT CASE WHEN (${proof.sql}) THEN 1 ELSE json('assistant_memory_image_changed') END AS verified`).bind(...proof.bindings);
async function read(env:WorkerEnv,source:MemoryImageSource,statement:D1PreparedStatement,value?:Retained){
 const db=env.DB,checks=[...source.assertions(),...(value?[assertion(env,childProof(value))]:[])],rows=structuredClone(await db.batch<Record<string,unknown>>([...checks,statement]));source.check();
 if(env.DB!==db||!derivationResults(rows,checks.length+1)||!rows.slice(0,checks.length).every(derivationVerified)||rows.at(-1)!.results.length>1)throw Error('assistant_memory_image_unavailable');return rows.at(-1)!.results[0]??null;
}
async function retained(env:WorkerEnv,source:MemoryImageSource,executionId:string):Promise<Retained>{
 const custody=executionContentCustodyGuard(source.binding,'content');
 const row=await read(env,source,env.DB.prepare(`SELECT execution.*,content.content AS serialized FROM consequential_executions execution JOIN private_content content ON content.content_id=execution.consent_ref
 JOIN memory_derivation_asset_edges edge ON edge.target_kind='content' AND edge.target_id=content.content_id
 WHERE execution.execution_id=? AND execution.actor_user_id=? AND execution.operation='assistant-specialist' AND content.kind='execution-consent' AND content.owner_id=execution.actor_user_id
 AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content.content AS BLOB))<=131072
 AND edge.source_kind='content' AND edge.source_id=? AND edge.owner_user_id=execution.actor_user_id AND edge.state='active' AND edge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql} LIMIT 2`)
 .bind(executionId,source.principal.userId,source.parentResultRef,...custody.bindings));
 if(!row||typeof row.serialized!=='string')throw Error('assistant_memory_image_unavailable');const {serialized,...execution}=row,parsed=JSON.parse(serialized),binding=parsed.binding as ConsequentialBinding,preview=parsed.preview as ConsequentialPreview,request=binding.request as PreviewRequest;
 if(binding.version!==VERSION||binding.operation!=='assistant-specialist'||binding.actorUserId!==source.principal.userId||binding.projectId!==source.binding.projectId||binding.documentId!==source.binding.documentId
 ||canonicalConsent(binding.scope)!==canonicalConsent(source.binding.scope)||await consentHash(binding)!==execution.binding_hash||binding.intentHash!==execution.intent_hash||preview.executionId!==executionId||preview.bindingHash!==execution.binding_hash
 ||request.version!==VERSION||request.parentExecutionId!==source.parentExecutionId||request.parentResultRef!==source.parentResultRef||request.parentBindingHash!==await consentHash(source.binding)||request.prompt!==source.prompt
 ||request.size!==SIZE||request.quality!=='high'||request.format!=='jpeg'||request.compression!==80||canonicalConsent(request.budget)!==canonicalConsent(outputImageBudget(request.model,SIZE,new TextEncoder().encode(request.prompt).length))
 ||binding.steps.length!==1||binding.steps[0]!.model!==request.model||binding.steps[0]!.maximumMicrousd!==request.budget.maximumMicrousd)throw Error('assistant_memory_image_changed');
 return {row:execution as unknown as ExecutionRow,binding,preview,request,serialized};
}
async function body(env:WorkerEnv,source:MemoryImageSource,value:Retained,kind:'provider-response'|'context-proposal'){
 const custody=executionContentCustodyGuard(value.binding,'content');
 return read(env,source,env.DB.prepare(`SELECT content.content_id,content.content${kind==='provider-response'?`,(SELECT json_object('status',step.status,'tokens',step.verified_tokens,'cost',step.verified_microusd,'requestId',step.provider_request_id) FROM consequential_execution_steps step WHERE step.execution_id=json_extract(content.content,'$.executionId') AND step.step_index=0) AS accounting`:''} FROM private_content content JOIN memory_derivation_asset_edges edge ON edge.target_id=content.content_id AND edge.target_kind='content'
 WHERE content.owner_id=? AND content.kind=? AND content.redacted_at IS NULL AND content.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content.content AS BLOB))<=1100000
 AND edge.source_kind='content' AND edge.source_id=? AND edge.owner_user_id=content.owner_id AND edge.state='active' AND edge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND json_extract(content.content,'$.version')=? AND json_extract(content.content,'$.executionId')=? AND json_extract(content.content,'$.bindingHash')=?
 ${kind==='context-proposal'?'AND content.content_id=?':''} AND ${custody.sql} LIMIT 2`).bind(source.principal.userId,kind,source.parentResultRef,VERSION,value.row.execution_id,value.row.binding_hash,...(kind==='context-proposal'?[value.row.result_ref]:[]),...custody.bindings),value);
}
async function decodedImage(raw:string,model:string){
 if(new TextEncoder().encode(raw).length>1024*1024||!memoryDerivationJsonUniqueKeys(raw))throw Error('assistant_memory_image_receipt');
 const parsed=JSON.parse(raw),usage=parsed.usage;
 if(!usage||!['input_tokens','output_tokens','total_tokens'].every(k=>Number.isSafeInteger(usage[k])&&usage[k]>=0)||usage.total_tokens!==usage.input_tokens+usage.output_tokens||usage.output_tokens<1
 ||!usage.input_tokens_details||!['text_tokens','image_tokens'].every(k=>Number.isSafeInteger(usage.input_tokens_details[k])&&usage.input_tokens_details[k]>=0)
 ||usage.input_tokens_details.text_tokens+usage.input_tokens_details.image_tokens!==usage.input_tokens||usage.input_tokens_details.image_tokens!==0)throw Error('assistant_memory_image_usage');
 const cost=priceImageUsageBreakdownMicrousd(model,{inputTokens:usage.input_tokens,outputTokens:usage.output_tokens,totalTokens:usage.total_tokens,textInputTokens:usage.input_tokens_details.text_tokens,imageInputTokens:0},false).totalMicrousd;
 if(!Array.isArray(parsed.data)||parsed.data.length!==1||typeof parsed.data[0]?.b64_json!=='string'||parsed.data[0].b64_json.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/u.test(parsed.data[0].b64_json))throw Error('assistant_memory_image_bytes');
 const encoded=parsed.data[0].b64_json;if(encoded.length>Math.ceil(MAX_BYTES/3)*4)throw Error('assistant_memory_image_bytes');
 const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>MAX_BYTES)throw Error('assistant_memory_image_bytes');
 const inspected=await inspectOutputAsset(bytes,'preview.jpg');if(inspected.status!=='inspected'||inspected.mimeType!=='image/jpeg'||inspected.facts.width!==1024||inspected.facts.height!==1024)throw Error('assistant_memory_image_invalid');
 return {encoded,sha256:inspected.sha256!,mimeType:'image/jpeg' as const,width:1024,height:1024,totalTokens:usage.total_tokens,cost};
}
async function publish(env:WorkerEnv,source:MemoryImageSource,value:Retained){
 if(value.row.result_ref)return value.row;const receipt=await body(env,source,value,'provider-response');if(!receipt)return value.row;
 const saved=JSON.parse(String(receipt.content)),image=await decodedImage(saved.raw,value.request.model);
 const paid=typeof receipt.accounting==='string'?JSON.parse(receipt.accounting):null;
 if(!paid||!['usage-recorded','settled'].includes(paid.status)||paid.tokens!==image.totalTokens||paid.cost!==image.cost||paid.requestId!==saved.requestId||image.cost>value.request.budget.maximumMicrousd)throw Error('assistant_memory_image_unavailable');
 const consent=childProof(value),proof={sql:`(${consent.sql}) AND EXISTS(SELECT 1 FROM consequential_execution_steps step JOIN private_content raw ON raw.content_id=?
 JOIN memory_derivation_asset_edges edge ON edge.target_kind='content' AND edge.target_id=raw.content_id
 WHERE step.execution_id=? AND step.step_index=0 AND step.status IN('usage-recorded','settled') AND step.verified_tokens=? AND step.verified_microusd=? AND step.provider_request_id IS ?
 AND raw.owner_id=? AND raw.kind='provider-response' AND raw.redacted_at IS NULL AND raw.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
 AND edge.source_kind='content' AND edge.source_id=? AND edge.state='active' AND edge.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,bindings:[...consent.bindings,String(receipt.content_id),value.row.execution_id,image.totalTokens,image.cost,saved.requestId,source.principal.userId,source.parentResultRef]};
 const completed=await completeConsequentialExecution(env,source.principal,value.binding,value.row.execution_id,{version:VERSION,executionId:value.row.execution_id,bindingHash:value.row.binding_hash,mode:'private-review',independentEvidence:false,image},proof,{
  precommit:()=>source.assertions(),publish:contentId=>[edge(env,source,contentId),env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('assistant_memory_image_unavailable') END AS verified")]});source.check();return completed;
}
async function display(env:WorkerEnv,source:MemoryImageSource,value:Retained){
 const saved=await body(env,source,value,'context-proposal');let result:unknown;
 if(saved){const parsed=JSON.parse(String(saved.content));if(value.row.status!=='completed'||parsed.mode!=='private-review'||parsed.independentEvidence!==false)throw Error('assistant_memory_image_unavailable');result=parsed;}
 const out=response({version:VERSION,executionId:value.row.execution_id,status:value.row.status,validUntil:source.validUntil,...(result?{result}:{}),noAutomaticRetry:true});source.check();return out;
}
export async function handleMemoryImagePreview(request:Request,env:WorkerEnv,control:Record<string,unknown>,sourceFactory:Source):Promise<Response>{
 let executing:string|null=null,actorId:string|null=null,dispatched=false,claimedHash:string|null=null;
 try{
  const action=control.previewAction;if(!['quote','execute','retrieve','resume'].includes(String(action))||action!=='quote'&&(!id(control.previewExecutionId)||action==='execute'&&!hash(control.approvedPreviewHash)))return response({error:'assistant_memory_image_request'},400);
  const requestDb=env.DB,started=Date.now(),monotonic=performance.now();let source=await sourceFactory();actorId=source.principal.userId;
  const refresh=async()=>{if(env.DB!==requestDb||Date.now()<started||performance.now()<monotonic||performance.now()-monotonic>=120000)throw Error('assistant_memory_image_changed');
   // Reuse compiled predicates only inside their original short lease. Every
   // transmission/publication still replays them in its own DB transaction.
   try{source.check();return source;}catch{/* A long image call needs fresh native source proof, not an extended handle. */}
   const next=await sourceFactory();if(next.parentResultRef!==source.parentResultRef||next.prompt!==source.prompt||await consentHash(next.binding)!==await consentHash(source.binding))throw Error('assistant_memory_image_changed');source=next;return next;};
  if(action==='quote'){
   const model=env.OPENAI_IMAGE_MODEL??'gpt-image-2.5-sunburst',budget=outputImageBudget(model,SIZE,new TextEncoder().encode(source.prompt).length);if(!budget)throw Error('assistant_memory_image_pricing');
   const data:PreviewRequest={version:VERSION,parentExecutionId:source.parentExecutionId,parentBindingHash:await consentHash(source.binding),parentResultRef:source.parentResultRef,prompt:source.prompt,model,size:SIZE,quality:'high',format:'jpeg',compression:80,budget};
   const binding:ConsequentialBinding={...source.binding,version:VERSION,intentHash:await consentHash([VERSION,source.parentExecutionId,source.parentResultRef]),period:new Date().toISOString().slice(0,7),request:data,
    steps:[{name:'private-image',provider:'OpenAI',model,inputTokens:budget.maximumInputTokens,outputTokens:budget.maximumOutputTokens,maximumMicrousd:budget.maximumMicrousd,toolCalls:0}]};
   const quote=await quoteConsequentialExecution(env,source.principal,binding,{...data,disclosure:'One private image, no authoring or publication. Text safety review precedes the paid image request. Allowance is an estimate, not a provider-enforced charge cap.'},source.sourceHead,Infinity,fence(source),(executionId,ref)=>[...source.assertions(),edge(env,source,ref),env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('assistant_memory_image_unavailable') END AS verified")]);
   const current=await retained(env,source,quote.executionId);let available:number|null=null;try{const budget=await readAccountBudgets(env,source.principal.userId,source.binding.scope?.organizationId);available=Math.min(budget.costBudgets.user.remainingMicrousd,budget.costBudgets.workspace.remainingMicrousd);}catch{/* Unknown capacity never authorizes spending. */}
   await read(env,source,env.DB.prepare('SELECT 1 AS verified'),current);
   const out=response({version:VERSION,executionId:quote.executionId,validUntil:source.validUntil,quote:{...current.preview,status:current.row.status,canExecute:source.canPurchase()&&Boolean(env.OPENAI_API_KEY)&&['','openai'].includes((env.FORMA_IMAGE_PROVIDER??'openai').trim().toLowerCase())&&available!==null&&available>=quote.maximumMicrousd&&current.row.status==='quoted'},noAutomaticRetry:true});source.check();return out;
  }
  let value=await retained(env,source,control.previewExecutionId as string);
  if(action==='retrieve')return await display(env,source,value);
  if(action==='resume'){await reconcileConsequentialUsage(env,actorId,value.row.execution_id,{atomicSpecialistPair:true});value={...value,row:await publish(env,source,value)};return await display(env,source,value);}
  const allowance=await pilotExecutionAllowance(env,actorId,source.binding.scope??undefined);
  if(allowance.pilot||!source.canPurchase()||!env.OPENAI_API_KEY||value.row.binding_hash!==control.approvedPreviewHash||value.request.model!==(env.OPENAI_IMAGE_MODEL??'gpt-image-2.5-sunburst')||!['','openai'].includes((env.FORMA_IMAGE_PROVIDER??'openai').trim().toLowerCase()))throw Error('assistant_memory_image_approval');
  const claim=await claimConsequentialExecution(env,source.principal,value.binding,value.row.execution_id,control.approvedPreviewHash as string,source.sourceHead,source.assertions(),childProof(value));if(claim.error)throw Error('assistant_memory_image_approval');
  if(claim.reused)return await display(env,source,await retained(env,source,value.row.execution_id));executing=value.row.execution_id;claimedHash=value.row.binding_hash;
  await reserveConsequentialSteps(env,source.principal,value.binding,executing,childProof(value),{atomicSpecialistPair:true});
  const abort=new AbortController();let rejectDeadline:(error:Error)=>void=()=>{};const deadline=new Promise<never>((_resolve,reject)=>{rejectDeadline=reject;}),cancel=()=>{abort.abort();rejectDeadline(Error('assistant_memory_image_cancelled'));};request.signal.addEventListener('abort',cancel,{once:true});const timer=setTimeout(cancel,120000);
  try{
   if(request.signal.aborted)cancel();
   await Promise.race([generateCreativeImage(env,actorId,{}, {},{preparedPrompt:value.request.prompt,size:SIZE,quality:'high',outputFormat:'jpeg',outputCompression:80,partialImages:0,references:[],signal:abort.signal,providerClientRequestId:executing,
    onBeforeSourceTransmission:async()=>{await refresh();if(!source.canPurchase()||!env.OPENAI_API_KEY)throw Error('assistant_memory_image_approval');await read(env,source,env.DB.prepare('SELECT 1 AS verified'),value);},
    onBeforeProviderAttempt:async attempt=>{await refresh();if(!source.canPurchase()||!env.OPENAI_API_KEY||value.request.model!==(env.OPENAI_IMAGE_MODEL??'gpt-image-2.5-sunburst')||!['','openai'].includes((env.FORMA_IMAGE_PROVIDER??'openai').trim().toLowerCase())||attempt.model!==value.request.model||attempt.maximumInputTokens!==value.request.budget.maximumInputTokens||attempt.maximumOutputTokens!==value.request.budget.maximumOutputTokens)throw Error('assistant_memory_image_changed');await beginConsequentialStep(env,source.principal,value.binding,executing!,0,source.sourceHead,childProof(value),{preconditions:source.assertions()});},
    onBeforeProviderDispatch:()=>{source.check();if(abort.signal.aborted)throw Error('assistant_memory_image_cancelled');dispatched=true;},
    onProviderSubmission:async receipt=>{if(receipt.status==='rejected'){await settleConsequentialStep(env,actorId!,executing!,0,0,0,receipt.providerRequestId??null,{atomicSpecialistPair:true});}else if(receipt.status==='completed'){if(!Number.isSafeInteger(receipt.costMicrousd)||!Number.isSafeInteger(receipt.totalTokens))throw Error('assistant_memory_image_usage');await settleConsequentialStep(env,actorId!,executing!,0,receipt.totalTokens!,receipt.costMicrousd!,receipt.providerRequestId??null,{atomicSpecialistPair:true});}},
    privateImageReceipt:{signal:abort.signal,onReceipt:async(raw,requestId)=>{await refresh();const content=await preparePrivateContent(env,actorId!,'provider-response',JSON.stringify({version:VERSION,executionId:executing,bindingHash:value.row.binding_hash,raw,requestId}),value.binding.scope??undefined);
      const checks=[...source.assertions(),assertion(env,childProof(value))],statements=[...checks,...content.statements,edge(env,source,content.contentId),env.DB.prepare("SELECT CASE WHEN changes()=1 THEN 1 ELSE json('assistant_memory_image_unavailable') END AS verified")],rows=await env.DB.batch(statements);
      if(!derivationResults(rows,statements.length)||!rows.slice(0,checks.length).every(derivationVerified)||!derivationVerified(rows.at(-1)!))throw Error('assistant_memory_image_unavailable');source.check();}}
   }),deadline]);
  }finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);abort.abort();}
  await refresh();value={...value,row:await publish(env,source,value)};return await display(env,source,value);
 }catch{
  if(executing&&actorId){if(!dispatched&&claimedHash)try{await proveConsequentialStepNotSubmitted(env,actorId,executing,0,claimedHash);}catch{/* Ambiguous acknowledgement stays held. */}try{await failConsequentialExecution(env,actorId,executing,'assistant_memory_image_unconfirmed');}catch{/* Never infer free usage or repurchase. */}}
  return response({error:'assistant_memory_image_unavailable',...(executing?{executionId:executing}:{}),noAutomaticRetry:true},409);
 }
}

/** Source-free ledger maintenance. Erasure cannot turn a verified charge into an
 * unknown hold, or authorize another provider request. Asset ancestry identifies
 * these child executions even after their private consent has been erased. */
export async function reconcileMemoryImageUsage(env:WorkerEnv){
 const schema=await memoryDerivationSchema(env);if(!schema.assetsPresent)return 0;
 const db=env.DB,rows=await db.batch<Record<string,unknown>>([derivationAssertion(env,schema.guard),db.prepare(`SELECT DISTINCT execution.execution_id,execution.actor_user_id
 FROM consequential_executions execution JOIN consequential_execution_steps step ON step.execution_id=execution.execution_id
 JOIN memory_derivation_asset_edges edge ON edge.target_kind='content' AND edge.target_id=execution.consent_ref AND edge.owner_user_id=execution.actor_user_id
 JOIN memory_derivation_consumer_contents parent ON parent.content_id=edge.source_id AND parent.role='result'
 WHERE edge.source_kind='content' AND execution.operation='assistant-specialist' AND (step.status='usage-recorded' OR step.status='not-submitted'
 AND (EXISTS(SELECT 1 FROM budget_reservations token WHERE token.reservation_id=step.token_reservation_id AND token.status='active')
 OR EXISTS(SELECT 1 FROM cost_budget_reservations cost WHERE cost.reservation_id=step.cost_reservation_id AND cost.status IN('active','executing'))))
 ORDER BY execution.execution_id LIMIT 16`)]);
 if(env.DB!==db||!derivationResults(rows,2)||!derivationVerified(rows[0]!)||rows[1]!.results.length>16)throw Error('assistant_memory_image_accounting');
 let count=0;for(const row of rows[1]!.results){if(!id(row.execution_id)||typeof row.actor_user_id!=='string')throw Error('assistant_memory_image_accounting');try{await reconcileConsequentialUsage(env,row.actor_user_id,row.execution_id,{atomicSpecialistPair:true});count++;}catch{/* Keep unresolved exact receipts for the next maintenance pass. */}}return count;
}
