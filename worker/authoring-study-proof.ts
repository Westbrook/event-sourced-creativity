import {AUTHORING_STUDY_PAIR_SCHEMA} from './authoring-study-pair-schema.ts';
import type {StudyApprovalEnv,StudySqlGuard,StudyEvidenceReference} from './authoring-study-types.ts';
import {canonicalConsent,consentHash} from './consequential-consent.ts';
import {privateContentScopeGuard} from './pilot-policy.ts';
import {nativeMemoryAnswerExclusion} from './memory-native-boundary.ts';
import {AUTHORING_STUDY_SCHEMA} from './authoring-study-schema.ts';
export const studyFail=(code:string):never=>{throw Error('authoring_study_'+code);};
export const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const studyDate=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export const studyAmount=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export async function studySchemaGuard(env:StudyApprovalEnv,version:1|2=1):Promise<StudySqlGuard>{
 const query="SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name GLOB 'authoring_study_*' ORDER BY name";
 const rows=await env.DB.prepare(query).all();
 if(!rows.success||canonicalConsent(rows.results)!==canonicalConsent(version===2?AUTHORING_STUDY_PAIR_SCHEMA:AUTHORING_STUDY_SCHEMA))studyFail('schema_unavailable');
 return{sql:`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${query}))=?`,bindings:[JSON.stringify(rows.results)]};
}
export async function studyPrivateGuard(env:StudyApprovalEnv,owner:string){
 const personal=privateContentScopeGuard(owner),memory=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
 return{sql:`${personal.sql} AND ${memory.sql} AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)`,bindings:[...personal.bindings,...memory.bindings]};
}
export async function readStudyEvidence(env:StudyApprovalEnv,owner:string,proposal:string,refs:StudyEvidenceReference[],expiry:string){
 const scope=await studyPrivateGuard(env,owner),guards:StudySqlGuard[]=[],contents:unknown[]=[];
 for(const ref of refs){
  if(![ref.id,ref.authorityId,ref.contentRef,ref.contentHash].every(opaque))studyFail('evidence_reference');
  const e=await env.DB.prepare('SELECT * FROM authoring_study_evidence WHERE evidence_id=?').bind(ref.id).first<Record<string,unknown>>();
  const p=await env.DB.prepare(`SELECT * FROM private_content WHERE content_id=? AND owner_id=? AND kind='study-financial-evidence' AND redacted_at IS NULL AND expires_at>=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scope.sql}`).bind(ref.contentRef,owner,expiry,...scope.bindings).first<Record<string,unknown>>();
  if(!e||!p||e.proposal_id!==proposal||e.owner_id!==owner||e.kind!==ref.kind||e.content_ref!==ref.contentRef||e.content_hash!==ref.contentHash||e.authority_id!==ref.authorityId||e.status!=='verified'||typeof e.expires_at!=='string'||e.expires_at<expiry||!studyDate(e.expires_at)||typeof p.content!=='string'||p.content.length>65536)studyFail('evidence_unavailable');
  let body:unknown;try{body=JSON.parse(p!.content as string);}catch{studyFail('evidence_invalid');}
  if(await consentHash(body)!==ref.contentHash)studyFail('evidence_changed');
  contents.push(body);
  guards.push({sql:`EXISTS(SELECT 1 FROM authoring_study_evidence WHERE evidence_id=? AND proposal_id=? AND owner_id=? AND kind=? AND content_ref=? AND content_hash=? AND authority_id=? AND status='verified' AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='study-financial-evidence' AND content=? AND redacted_at IS NULL AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${scope.sql})`,bindings:[ref.id,proposal,owner,ref.kind,ref.contentRef,ref.contentHash,ref.authorityId,e!.expires_at,ref.contentRef,owner,p!.content,p!.expires_at,...scope.bindings]});
 }
 return{guards,contents};
}
export function studyConfigurationGuard(proposal:string,owner:string,configurationHash:string,expiry:string):StudySqlGuard{
 return{sql:"EXISTS(SELECT 1 FROM authoring_study_configurations WHERE proposal_id=? AND owner_id=? AND configuration_hash=? AND status='active' AND expires_at=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",bindings:[proposal,owner,configurationHash,expiry]};
}
/** Reused by P2 at EVERY supplied authority/I/O boundary for this version only. */
export async function authoringStudyExecutionGuards(env:StudyApprovalEnv,{owner,grantId,planId,reviewId,principal,version=1}:{owner:string;grantId:string;planId:string;reviewId:string;principal:string;version?:1|2}){
 const schema=await studySchemaGuard(env,version);
 const row=await env.DB.prepare('SELECT * FROM authoring_study_commits WHERE grant_id=? AND owner_id=? AND plan_id=? AND review_id=? AND principal_hash=? AND verified=1').bind(grantId,owner,planId,reviewId,principal).first<Record<string,string>>();
 if(!row||Number(row.version)!==version)return studyFail('receipt_unavailable');
 const refs=JSON.parse(row.evidence_json) as StudyEvidenceReference[];
 const evidence=await readStudyEvidence(env,owner,row.proposal_id,refs,row.expires_at);
 const guards=[schema,studyConfigurationGuard(row.proposal_id,owner,row.configuration_hash,row.expires_at),...evidence.guards,
  {sql:'EXISTS(SELECT 1 FROM authoring_study_commits WHERE preview_id=? AND receipt_json=? AND evidence_json=? AND verified=1 AND version=?)',bindings:[row.preview_id,row.receipt_json,row.evidence_json,version]}];
 const db=env.DB;
 const checks=await db.batch(guards.map(g=>db.prepare('SELECT 1 AS valid WHERE '+g.sql).bind(...g.bindings)));
 if(env.DB!==db||checks.some(r=>!r.success||r.results.length!==1))studyFail('execution_authority_changed');
 return guards;
}
