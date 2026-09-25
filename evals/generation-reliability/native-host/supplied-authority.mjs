import {canonical,hash} from '../core.mjs';
import {operationKey} from '../execution-plan.mjs';
import {PROTOCOL,validateSuppliedPlan} from '../p2/contract.mjs';
import {authenticateStudy,checkedBatch,assertion} from './authority.mjs';
import {imageFinancialScope,resolveFinancialPolicy} from './financial-policy.mjs';
import {privateContentScopeGuard} from '../../../worker/pilot-policy.ts';
import {nativeMemoryAnswerExclusion} from '../../../worker/memory-native-boundary.ts';
import {PRINCIPAL_WITH_ACCESS_SQL} from '../../../worker/access-policy.ts';
const fail=code=>{throw Error(code);};
export const SOURCE_KIND='supplied-study-source';
export const DIRECTION_KIND='agent-authored-study-direction';
export const reviewBinding=plan=>canonical({version:plan.version,planId:plan.id,packetId:plan.packet.id,candidateId:plan.candidate.id,input:plan.candidate.suppliedInputs,runtimeHash:hash(plan.runtimeIdentity),configurationHash:hash(plan.manifest.cells),inventoryHash:hash(plan.inventory),financialAuthority:'existing exact-operation financial grants required'});
export async function principalFingerprint(db,owner){return hash(await db.prepare(PRINCIPAL_WITH_ACCESS_SQL).bind(owner).first());}
async function suppliedReview(request,env,grantId,plan,{recovery=false}={}){
 validateSuppliedPlan(plan);
 const a=await authenticateStudy(request,env,{recovery,supplied:true}),{db,user}=a,b=plan.candidate.suppliedInputs;
 const principal=await principalFingerprint(db,user.userId),binding=reviewBinding(plan);
 const review={sql:"EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE review_id=? AND grant_id=? AND owner_id=? AND principal_hash=? AND binding_json=? AND expires_at=? AND status='authorized' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[b.reviewId,grantId,user.userId,principal,binding,b.expiresAt]};
 const grant=await db.prepare("SELECT * FROM generation_study_grants WHERE grant_id=? AND owner_id=? AND plan_id=? AND status='authorized' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(grantId,user.userId,plan.id).first();
 if(!grant||grant.source_ref!==b.sourceRef||grant.direction_ref!==b.directionRef||grant.source_hash!==b.sourceSha256||grant.direction_hash!==b.directionSha256||grant.runtime_hash!==hash(plan.runtimeIdentity)||grant.authority_version!==b.authorityVersion||grant.expires_at!==b.expiresAt)fail('study_supplied_grant');
 const g={sql:"EXISTS(SELECT 1 FROM generation_study_grants WHERE grant_id=? AND owner_id=? AND plan_id=? AND authority_version=? AND status='authorized' AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[grantId,user.userId,plan.id,b.authorityVersion,b.expiresAt]};
 if(!await db.prepare(`SELECT 1 WHERE ${review.sql}`).bind(...review.bindings).first())fail('study_supplied_review_unavailable');
 return {...a,grant,principal,guards:[a.guard,g,review]};
}
/** Local trusted intake consumes existing review and financial authority. It creates private copies only,
 * never grants/reviews, and has no HTTP route. Synthetic callers must seed explicitly marked fixture authority. */
export async function retainSuppliedStudyInputs(request,env,{grantId,plan,source,direction,financialPolicies,financialAccount}){
 const a=await suppliedReview(request,env,grantId,plan),b=plan.candidate.suppliedInputs,db=a.db;
 if(source!==JSON.stringify(plan.packet.suppliedSnapshot)||direction!==JSON.stringify(plan.packet.direction.value)||[source,direction].some(v=>Buffer.byteLength(v)>1048576))fail('study_supplied_bytes');
 for(const trial of plan.manifest.trials){
  const policy=financialPolicies?.find(p=>p.scope.operationId===operationKey(a.user.userId,plan,trial));
  if(!policy)fail('study_supplied_financial_required');
  a.guards.push((await resolveFinancialPolicy(env,{policy,scope:imageFinancialScope(plan,trial,a.user.userId,financialAccount),grantId,ownerId:a.user.userId})).guard);
 }
 const rows=[[b.sourceRef,SOURCE_KIND,source],[b.directionRef,DIRECTION_KIND,direction]];
 const statements=[];
 for(const [ref,kind,content] of rows){
  const prior=await db.prepare('SELECT * FROM private_content WHERE content_id=?').bind(ref).first();
  if(prior){if(prior.owner_id!==a.user.userId||prior.kind!==kind||prior.content!==content||prior.expires_at!==b.expiresAt||prior.redacted_at!==null)fail('study_supplied_existing_copy');}
  else statements.push(db.prepare("INSERT INTO private_content VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,NULL)").bind(ref,a.user.userId,kind,content,b.expiresAt));
 }
 const scope=privateContentScopeGuard(a.user.userId),memory=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
 for(const [ref,kind,content] of rows)statements.push(assertion(db,{sql:`EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND content=? AND expires_at=? AND redacted_at IS NULL AND ${scope.sql} AND ${memory.sql} AND NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='content' AND r.resource_id=private_content.content_id))`,bindings:[ref,a.user.userId,kind,content,b.expiresAt,...scope.bindings,...memory.bindings]}));
 if(env.DB!==db)fail('study_database_changed');
 await checkedBatch(env,a.guards,statements);
 return suppliedStudyInputs(request,env,grantId,plan);
}
export async function suppliedStudyInputs(request,env,grantId,plan,options={}){
 const a=await suppliedReview(request,env,grantId,plan,options),{db,user}=a,b=plan.candidate.suppliedInputs;
 const scope=privateContentScopeGuard(user.userId),memory=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
 const guards=[];const rows=[];
 for(const [ref,kind,sha] of [[b.sourceRef,SOURCE_KIND,b.sourceSha256],[b.directionRef,DIRECTION_KIND,b.directionSha256]]){
  const query=`SELECT * FROM private_content WHERE content_id=? AND owner_id=? AND kind=? AND expires_at=? AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=1048576 AND ${scope.sql} AND ${memory.sql} AND NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.resource_kind='content' AND r.resource_id=private_content.content_id)`;
  const bindings=[ref,user.userId,kind,b.expiresAt,...scope.bindings,...memory.bindings];
  const value=await db.prepare(query).bind(...bindings).first();
  if(!value||hash(value.content)!==sha)fail('study_supplied_input_unavailable');
  rows.push(value);guards.push({sql:`EXISTS(${query} AND content=?)`,bindings:[...bindings,value.content]});
 }
 return {...a,source:rows[0],direction:rows[1],expiresAt:b.expiresAt,guards:[...a.guards,...guards]};
}
export function pairGuard(plan,owner,grantId,trial){
 const b=plan.candidate.suppliedInputs,first=operationKey(owner,plan,plan.manifest.trials[0]);
 const guard={sql:"EXISTS(SELECT 1 FROM generation_study_supplied_reviews WHERE review_id=? AND grant_id=? AND hard_stop IS NULL)",bindings:[b.reviewId,grantId]};
 if(trial.id===plan.manifest.trials[1].id){
  guard.sql+=" AND EXISTS(SELECT 1 FROM generation_study_operations o JOIN generation_study_supplied_observations v USING(operation_id) JOIN generation_study_supplied_reviews r USING(review_id) WHERE o.operation_id=? AND o.plan_id=? AND o.status='completed' AND o.artifact_hash=v.artifact_hash AND o.receipt_hash=v.receipt_hash AND o.private_writes=9 AND v.review_id=? AND v.owner_id=? AND v.principal_hash=r.principal_hash AND v.safety='clear' AND v.fidelity IN('pass','expected-failure') AND v.protocol=? AND v.resume=1)";
  guard.bindings.push(first,plan.id,b.reviewId,owner,PROTOCOL);
 }
 return guard;
}
export async function stopSuppliedPair(db,plan,grantId,reason){
 await db.prepare('UPDATE generation_study_supplied_reviews SET hard_stop=COALESCE(hard_stop,?) WHERE review_id=? AND grant_id=?').bind(reason,plan.candidate.suppliedInputs.reviewId,grantId).run();
}
/** Explicit authenticated human observation. Never called automatically by execute/reconcile. */
export async function observeSuppliedArm(request,env,plan,{grantId,trialId,safety,fidelity,finding,evidenceRef,resume}){
 const a=await suppliedStudyInputs(request,env,grantId,plan,{recovery:true}),trial=plan.manifest.trials.find(t=>t.id===trialId);
 if(!trial||!['clear','unsafe'].includes(safety)||!['pass','expected-failure'].includes(fidelity)||(fidelity==='expected-failure'?!plan.packet.protocol.expectedFidelityFailures.includes(finding):finding!=='none')||typeof resume!=='boolean'||typeof evidenceRef!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(evidenceRef))fail('study_observation_invalid');
 const id=operationKey(a.user.userId,plan,trial),op=await a.db.prepare('SELECT * FROM generation_study_operations WHERE operation_id=?').bind(id).first();
 if(!op?.artifact_hash||!op.receipt_hash||op.private_writes!==9)fail('study_observation_original_required');
 const guard={sql:'EXISTS(SELECT 1 FROM generation_study_operations WHERE operation_id=? AND artifact_hash=? AND receipt_hash=? AND private_writes=9)',bindings:[id,op.artifact_hash,op.receipt_hash]};
 const statements=[a.db.prepare("INSERT INTO generation_study_supplied_observations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,plan.candidate.suppliedInputs.reviewId,a.user.userId,a.principal,op.artifact_hash,op.receipt_hash,PROTOCOL,safety,fidelity,finding,evidenceRef,resume?1:0)];
 // Unknown safety/fidelity cannot be recorded as clear. A stop is terminal even after later settlement.
 if(safety==='unsafe'||!resume)statements.push(a.db.prepare('UPDATE generation_study_supplied_reviews SET hard_stop=COALESCE(hard_stop,?) WHERE review_id=?').bind(safety==='unsafe'?'unsafe_output':'explicit_user_stop',plan.candidate.suppliedInputs.reviewId));
 await checkedBatch(env,[...a.guards,guard],statements);
 return {action:safety==='clear'&&resume?'observation_recorded':'stopped',operationId:id,requiresSettlement:true,newPurchases:0};
}
