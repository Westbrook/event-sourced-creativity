import { readOutputVideoCompletedObservation, OUTPUT_VIDEO_TRANSPORT, outputVideoMediaPrice, type OutputVideoCompletedObservation } from "./output-video-execution.ts";
import { prepareOutputProviderFinancialCheckpoint, retainUnsettledOutputProviderObservation } from "./output-provider-financial-checkpoint.ts";
import { reconcileKnownOutputProviderReceipts } from "./output-execution-control.ts";
import { outputAssertionStatements, settleOutputProviderCall, OutputConflictError, type OutputScope, type OutputOperationSlot, type OutputSqlAssertion } from "./output-requirements-ledger.ts";
import { balancedOutputRetainedConjunction } from "./output-retained-witness.ts";
import type { PaidProviderSubmission } from "../src/model/provider-submission.ts";
import type { PilotUser } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";
import type { DocumentJobRow } from "./document-jobs-api.ts";

type Row=Record<string,string|number|null>;
const fields=["clientRequestId","provider","operation","model","status","providerRequestId","costMicrousd","inputTokens","outputTokens","totalTokens"] as const;
const projection=`(SELECT json_group_object(key,json(value)) FROM (SELECT entry.key,json_object(${fields.map(k=>`'${k}',json_extract(entry.value,'$.${k}')`).join(",")}) AS value FROM json_each(CASE WHEN json_type(job.result_json,'$.providerSubmissions')='object' THEN json_extract(job.result_json,'$.providerSubmissions') ELSE '{}' END) entry ORDER BY entry.key))`;
const columns=[
 "job.job_id","job.owner_id","job.stream_id","job.document_id","job.correlation_id","job.attempt_count",
 "slot.scope_key","slot.slot_id","slot.grant_id","slot.plan_revision_id","slot.target_id","slot.target_contract_digest","slot.source_digest","slot.route_digest","slot.provider","slot.model","slot.token_reservation_id","slot.cost_reservation_id","slot.maximum_microusd","slot.maximum_calls","slot.maximum_tokens",
 "grant_row.payer_user_id","grant_row.preflight_id","grant_row.authorization_event_id","grant_row.maximum_microusd","grant_row.maximum_calls",
 "plan.project_id","plan.plan_id","plan.revision","plan.requirements_digest","plan.source_digest","plan.resolver_version","plan.source_head","plan.target_count","plan.confirmed_event_id",
 "target.target_contract_digest","target.required","target.selected","target.ordinal",
 "tokens.period","tokens.reserved_tokens","cost.reserved_microusd","cost.allow_user_overage",
] as const;
const purchaseFrom=`FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
 JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
 JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
 JOIN output_plan_targets target ON target.scope_key=slot.scope_key AND target.plan_revision_id=slot.plan_revision_id AND target.target_id=slot.target_id
 JOIN budget_reservations tokens ON tokens.reservation_id=slot.token_reservation_id
 JOIN cost_budget_reservations cost ON cost.reservation_id=slot.cost_reservation_id`;
const purchaseRules=balancedOutputRetainedConjunction([
 "job.kind='render_document'","job.source_surface='outputs'","job.stream_id='creative:'||job.owner_id",
 "plan.scope_kind='personal'","plan.owner_user_id=job.owner_id","plan.document_id=job.document_id","plan.organization_id IS NULL","plan.project_access_id IS NULL","plan.source_digest=slot.source_digest",
 "grant_row.actor_user_id=job.owner_id","grant_row.payer_user_id=job.owner_id","grant_row.context_id IS NULL","grant_row.plan_revision_id=slot.plan_revision_id",
 "slot.attempt_ordinal=0","slot.previous_slot_id IS NULL","slot.provider='fal'","slot.maximum_calls=2","grant_row.maximum_calls=2","grant_row.maximum_microusd=slot.maximum_microusd",
 "target.media_kind='video'","target.target_contract_digest=slot.target_contract_digest","target.selected=1",
 "tokens.owner_id=grant_row.payer_user_id","cost.owner_id=tokens.owner_id","tokens.stream_id=job.stream_id","cost.stream_id=job.stream_id",
 "tokens.correlation_id=job.correlation_id","cost.correlation_id=job.correlation_id","tokens.period=cost.period","tokens.operation='document-render:video'","cost.operation=tokens.operation","cost.workspace_id='forma'",
 "tokens.reserved_tokens=slot.maximum_tokens","cost.reserved_microusd=slot.maximum_microusd",
 "(SELECT COUNT(*) FROM output_operation_slots sibling WHERE sibling.scope_key=slot.scope_key AND sibling.grant_id=slot.grant_id)=1",
 "NOT EXISTS(SELECT 1 FROM project_budget_reservation_scopes billing WHERE billing.reservation_id IN(tokens.reservation_id,cost.reservation_id))",
 "NOT EXISTS(SELECT 1 FROM pilot_cost_reservation_scopes fixed WHERE fixed.reservation_id=cost.reservation_id)",
 "NOT EXISTS(SELECT 1 FROM project_resource_scopes resource WHERE resource.resource_kind IN('job','document') AND resource.resource_id IN(job.job_id,job.document_id))",
 "NOT EXISTS(SELECT 1 FROM event_private_payloads body WHERE body.private_event_id=grant_row.authorization_event_id AND CASE WHEN json_valid(body.private_json) THEN json_type(body.private_json,'$.output_command_envelope.sponsor_entitlement') ELSE NULL END IS NOT NULL)",
]);
function fail():never{throw new OutputConflictError("output_video_original_financial_unavailable",409);}
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const id=(v:unknown)=>typeof v==="string"&&v.length>0;
const brand:unique symbol=Symbol("original-video-financial");
export type OriginalOutputVideoFinancialAuthority=Readonly<{[brand]:true}>;
type State={env:WorkerEnv;financialEnv:WorkerEnv;database:WorkerEnv["DB"];user:PilotUser;actor:string;jobId:string;streamId:string;correlationId:string;scopeKey:string;slotId:string;payer:string;tokenReservationId:string;costReservationId:string;purchase:OutputSqlAssertion;calls:OutputSqlAssertion[];media:Row;planner:Row;map:string;observed:PaidProviderSubmission|null;tokens:number;plannerCost:number};
const authorities=new WeakMap<object,State>();
function state(authority:OriginalOutputVideoFinancialAuthority,env:WorkerEnv):State{const value=authorities.get(authority);if(!value||value.env!==env||value.database!==env.DB)fail();return value;}
function mapAssertion(s:State,maps:string[]):OutputSqlAssertion{return{sql:`EXISTS(SELECT 1 FROM document_jobs job WHERE job.job_id=? AND job.owner_id=? AND COALESCE(json_extract(job.result_json,'$.providerSubmissionLegacyUncertain'),0)<>1 AND ${projection} IN(${maps.map(()=>"json(?)").join(",")}))`,bindings:[s.jobId,s.actor,...maps]};}
function mediaAssertion(s:State,cost:number|null):OutputSqlAssertion{return{sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='video:initial' AND ((?=1 AND status='uncertain' AND used_microusd IS NULL) OR (status='settled' AND used_microusd=?)))",bindings:[s.scopeKey,s.slotId,Number(s.media.status==="uncertain"),cost]};}
const originalAssertions=(s:State)=>[s.purchase,...s.calls];
async function assertAll(s:State,assertions:OutputSqlAssertion[]){if(s.env.DB!==s.database)fail();await s.database.batch(assertions.flatMap(a=>outputAssertionStatements(s.env,a)));if(s.env.DB!==s.database)fail();}

/** Independent original ordinary purchase, never a private-read or publication
 * lease. The projection captures monetary identity only and never reads bodies. */
export async function captureOriginalOutputVideoFinancialAuthority(env:WorkerEnv,user:PilotUser,scope:OutputScope,slot:OutputOperationSlot,job:DocumentJobRow):Promise<OriginalOutputVideoFinancialAuthority>{
 const actor=user.userId;
 if(scope.kind!=="personal"||scope.actorUserId!==actor||scope.ownerUserId!==actor||scope.organizationId||scope.projectAccessId||scope.contextId||job.owner_id!==actor||slot.jobId!==job.job_id||slot.scopeKey!==scope.key||slot.slotId!==job.output_slot_id||job.document_id!==scope.documentId)fail();
 const database=env.DB,initial=[job.job_id,actor,scope.key,slot.slotId];
 const rows=await database.prepare(`SELECT ${columns.map((c,i)=>`${c} AS c${i}`).join(",")} ${purchaseFrom} WHERE ${purchaseRules} AND job.job_id=? AND job.owner_id=? AND slot.scope_key=? AND slot.slot_id=?`).bind(...initial).all<Row>();
 if(env.DB!==database||rows.results.length!==1)fail();const row=rows.results[0]!,value=(c:typeof columns[number])=>row['c'+columns.indexOf(c)];
 const expected:Partial<Record<typeof columns[number],unknown>>={"job.stream_id":job.stream_id,"job.document_id":job.document_id,"job.correlation_id":job.correlation_id,"job.attempt_count":job.attempt_count,"slot.grant_id":slot.grantId,"slot.plan_revision_id":slot.planRevisionId,"slot.target_id":slot.targetId,"slot.target_contract_digest":slot.targetContractDigest,"slot.source_digest":slot.sourceDigest,"slot.route_digest":slot.routeDigest,"slot.model":OUTPUT_VIDEO_TRANSPORT.model,"slot.token_reservation_id":slot.tokenReservationId,"slot.cost_reservation_id":slot.costReservationId,"slot.maximum_microusd":slot.maximumMicrousd,"slot.maximum_tokens":slot.maximumTokens,"plan.project_id":scope.projectId};
 if(Object.entries(expected).some(([c,v])=>value(c as typeof columns[number])!==v)||!id(value("tokens.period"))||!integer(slot.maximumMicrousd)||slot.maximumMicrousd<=0||!integer(slot.maximumTokens)||slot.maximumTokens<=0)fail();
 const purchase:OutputSqlAssertion={sql:`EXISTS(SELECT 1 ${purchaseFrom} WHERE ${purchaseRules} AND ${balancedOutputRetainedConjunction(columns.map(c=>`${c} IS ?`))})`,bindings:columns.map(c=>value(c)!)};
 const read=await database.batch<Row>([...outputAssertionStatements(env,purchase),database.prepare("SELECT * FROM output_provider_calls WHERE scope_key=? AND slot_id=? ORDER BY call_key").bind(scope.key,slot.slotId),database.prepare(`SELECT ${projection} AS receipts FROM document_jobs job WHERE job.job_id=? AND job.owner_id=?`).bind(job.job_id,actor)]);
 if(env.DB!==database)fail();const calls=read.at(-2)!.results,raw=read.at(-1)!.results[0]?.receipts;
 const planner=calls.find(c=>c.call_key==="planning:0:initial"),media=calls.find(c=>c.call_key==="video:initial");
 if(calls.length!==2||!planner||!media||typeof raw!=="string"||new TextEncoder().encode(raw).length>65536)fail();
 const map=JSON.parse(raw) as Record<string,PaidProviderSubmission>;
 if(Object.keys(map).length!==2||calls.some(c=>!id(c.client_request_id)||!id(c.request_digest)||!id(c.provider_response_id)||!integer(c.reserved_microusd)||Number(c.reserved_microusd)<=0)||planner.stage_key!=="planning:0:initial"||planner.provider!=="openai"||planner.status!=="settled"||!integer(planner.used_microusd)||Number(planner.used_microusd)>Number(planner.reserved_microusd)||media.stage_key!=="video:initial"||media.provider!=="fal"||media.model!==OUTPUT_VIDEO_TRANSPORT.model||!["uncertain","settled"].includes(String(media.status))||media.reserved_microusd!==outputVideoMediaPrice().maximumMicrousd||Number(planner.reserved_microusd)+Number(media.reserved_microusd)>slot.maximumMicrousd)fail();
 const paidPlanner=map[String(planner.client_request_id)],paidMedia=map[String(media.client_request_id)];
 for(const [call,receipt,operation] of [[planner,paidPlanner,"planning"],[media,paidMedia,"video"]] as const){if(!receipt||receipt.clientRequestId!==call.client_request_id||receipt.provider!==call.provider||receipt.model!==call.model||receipt.providerRequestId!==call.provider_response_id||receipt.operation!==operation)fail();}
 if(paidPlanner!.status!=="completed"||paidPlanner!.costMicrousd!==planner.used_microusd||![paidPlanner!.inputTokens,paidPlanner!.outputTokens,paidPlanner!.totalTokens].every(integer)||Number(paidPlanner!.inputTokens)+Number(paidPlanner!.outputTokens)!==paidPlanner!.totalTokens||paidPlanner!.totalTokens!>slot.maximumTokens)fail();
 const known=paidMedia!.status==="completed"?Number(paidMedia!.costMicrousd):null;
 if(!["accepted","completed"].includes(paidMedia!.status)||known!==null&&(known!==outputVideoMediaPrice().maximumMicrousd||![paidMedia!.inputTokens,paidMedia!.outputTokens,paidMedia!.totalTokens].every(v=>v===0))||media.status==="settled"&&(known===null||media.used_microusd!==known)||media.status==="uncertain"&&media.used_microusd!==null)fail();
 const callAssertions:OutputSqlAssertion[]=[{sql:"(SELECT COUNT(*) FROM output_provider_calls WHERE scope_key=? AND slot_id=?)=2 AND (SELECT COUNT(*) FROM output_operation_routes WHERE scope_key=? AND slot_id=?)=2",bindings:[scope.key,slot.slotId,scope.key,slot.slotId]}];
 for(const call of calls){const immutable=["call_key","stage_key","provider","model","client_request_id","request_digest","provider_response_id","reserved_microusd",...(call===planner?["status","used_microusd"]:[])];callAssertions.push({sql:`EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND ${balancedOutputRetainedConjunction(immutable.map(c=>`${c} IS ?`))}) AND EXISTS(SELECT 1 FROM output_operation_routes WHERE scope_key=? AND slot_id=? AND stage_key=? AND provider=? AND model=? AND maximum_calls=1)`,bindings:[scope.key,slot.slotId,...immutable.map(c=>call[c]!),scope.key,slot.slotId,call.stage_key!,call.provider!,call.model!]});}
 const s:State={env,financialEnv:Object.freeze({...env,DB:database}),database,user:Object.freeze({...user}),actor,jobId:job.job_id,streamId:job.stream_id,correlationId:job.correlation_id,scopeKey:scope.key,slotId:slot.slotId,payer:String(value("grant_row.payer_user_id")),tokenReservationId:slot.tokenReservationId,costReservationId:slot.costReservationId,purchase,calls:callAssertions,media,planner,map:raw,observed:null,tokens:paidPlanner!.totalTokens!,plannerCost:Number(planner.used_microusd)};
 await assertAll(s,[...originalAssertions(s),mapAssertion(s,[raw]),mediaAssertion(s,known)]);
 const authority=Object.freeze({[brand]:true as const});authorities.set(authority,s);return authority;
}

/** A genuine transport observation proves completed response metadata, not
 * payer authority. Only the separately captured purchase permits this write. */
export async function recordOriginalOutputVideoCompletedObservation(authority:OriginalOutputVideoFinancialAuthority,env:WorkerEnv,observation:OutputVideoCompletedObservation){
 const s=state(authority,env),paid=readOutputVideoCompletedObservation(observation);
 if(paid.clientRequestId!==s.media.client_request_id||paid.provider!==s.media.provider||paid.operation!=="video"||paid.model!==s.media.model||paid.providerRequestId!==s.media.provider_response_id||paid.requestDigest!==s.media.request_digest||paid.status!=="completed"||paid.costMicrousd!==s.media.reserved_microusd||paid.inputTokens!==0||paid.outputTokens!==0||paid.totalTokens!==0)fail();
 const receipt:PaidProviderSubmission={clientRequestId:paid.clientRequestId,provider:paid.provider,operation:paid.operation,model:paid.model,status:paid.status,providerRequestId:paid.providerRequestId,costMicrousd:paid.costMicrousd,inputTokens:0,outputTokens:0,totalTokens:0};
 const map=JSON.parse(s.map);map[paid.clientRequestId]=receipt;const next=JSON.stringify(map);
 const guards=[...originalAssertions(s),mapAssertion(s,[s.map,next]),mediaAssertion(s,paid.costMicrousd)];
 const checkpoint=prepareOutputProviderFinancialCheckpoint(s.financialEnv,{scopeKey:s.scopeKey,slotId:s.slotId,callKey:"video:initial",jobId:s.jobId,ownerId:s.actor,streamId:s.streamId,correlationId:s.correlationId,receipt,patch:{}});
 try{await settleOutputProviderCall(s.financialEnv,{scopeKey:s.scopeKey,slotId:s.slotId,callKey:"video:initial",clientRequestId:paid.clientRequestId,providerResponseId:paid.providerRequestId,status:"settled",usedMicrousd:paid.costMicrousd,financialCheckpoint:checkpoint,assertions:guards});}
 catch(error){state(authority,env);try{await retainUnsettledOutputProviderObservation(s.financialEnv,checkpoint,guards);}catch{/* Conflicts cannot be rewritten as fallback evidence. */}throw error;}
 state(authority,env);s.map=next;s.observed=Object.freeze({...receipt});
 const finance=[...originalAssertions(s),mapAssertion(s,[next]),{sql:"EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=? AND call_key='video:initial' AND status='settled' AND used_microusd=?)",bindings:[s.scopeKey,s.slotId,paid.costMicrousd]}];
 const result=await reconcileKnownOutputProviderReceipts(s.financialEnv,{...s.user,userId:s.actor,billingUserId:s.payer,streamId:s.streamId},{jobId:s.jobId,assertions:finance});
 state(authority,env);if(result.status==="uncertain")fail();
 await assertAll(s,[...finance,{sql:"EXISTS(SELECT 1 FROM budget_reservations WHERE reservation_id=? AND owner_id=? AND status='settled' AND used_tokens=?) AND EXISTS(SELECT 1 FROM cost_budget_reservations WHERE reservation_id=? AND owner_id=? AND status='settled' AND used_microusd=?)",bindings:[s.tokenReservationId,s.payer,s.tokens,s.costReservationId,s.payer,s.plannerCost+paid.costMicrousd]}]);
 return originalOutputVideoFinancialState(authority,env);
}
export function originalOutputVideoFinancialState(authority:OriginalOutputVideoFinancialAuthority,env:WorkerEnv){const s=state(authority,env);return Object.freeze({payerUserId:s.payer,jobId:s.jobId,receipt:s.observed?Object.freeze({...s.observed,requestDigest:String(s.media.request_digest)}):null});}
