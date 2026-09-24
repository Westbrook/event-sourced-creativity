import type { WorkerEnv, EventReadProof } from './runtime.ts';
import type { GenerationReadiness } from '../src/model/generation-readiness.ts';
import type { PrivateGenerationEvidence } from '../src/model/generation-outcome-evidence.ts';
import type { SourceAdvisoryWitness } from './source-advisory-witness.ts';
import { hostedIdentity, readNativeRetainedPrincipal, opaque } from './native-retained-text-custody.ts';
import { qualifyAdvisoryCapture } from './advisory-moderation-evidence.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
import { evidenceSha256 } from './generation-evidence.ts';
import { requalifySourceAuthority } from './source-authority-receipt.ts';
import { memoryDerivationJsonUniqueKeys } from './memory-derivation-result.ts';
import { validModerationResults } from './moderation-response-validation.ts';
import { canonicalConsent } from './consequential-consent.ts';
import { sourceAdvisoryInputs } from '../src/model/source-advisory.ts';
import { sourceAdvisoryWitness } from './source-advisory-witness.ts';

export const SOURCE_ADVISORY_PATH='/api/source-advisory';
const headers={'cache-control':'private, no-store','content-type':'application/json; charset=utf-8','x-content-type-options':'nosniff',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const same=(a:unknown,b:unknown)=>canonicalConsent(a)===canonicalConsent(b);
class Refusal extends Error{}
function fail(code:string):never{throw new Refusal(code);}
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('capture_invalid');
type PreflightRow={preflight_id:string;owner_id:string;stream_id:string;document_id:string;request_key:string;result_json:string;created_at:string;expires_at:string};
type Envelope=PrivateGenerationEvidence&{sourceWitness?:SourceAdvisoryWitness;advisory:Record<string,unknown>};

/** Selected, hosted personal read. No initializers, source/retention writes,
 * preflight refresh, job, acknowledgement or provider capability is invoked. */
export async function handleSourceAdvisoryRead(request:Request,env:WorkerEnv):Promise<Response> {
 const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
 const url=new URL(request.url),documentId=url.searchParams.get('documentId'),preflightId=url.searchParams.get('preflightId');
 if(request.method!=='GET')return json({status:'unavailable',reason:'method_not_allowed'},405);
 if(!documentId||!preflightId||!opaque.test(documentId)||!opaque.test(preflightId)||[...url.searchParams.keys()].some(k=>!['documentId','preflightId'].includes(k))
   ||url.searchParams.getAll('documentId').length!==1||url.searchParams.getAll('preflightId').length!==1)return json({status:'unavailable',reason:'invalid_selection'},400);
 const db=env.DB,proofs:EventReadProof[]=[],deadlines:number[]=[];
 const configuration=()=>canonicalConsent({pilot:env.FORMA_PILOT_COHORT_ID,admins:env.FORMA_ADMIN_EMAILS});
 const config=configuration();
 const live=()=>{if(env.DB!==db||config!==configuration())fail('authority_changed');if(deadlines.some(d=>!Number.isFinite(d)||d<=Date.now()))fail('access_expired');};
 const deadline=(value:string)=>{deadlines.push(Date.parse(value));live();};
 const read=async<T extends Record<string,unknown>>(statement:D1PreparedStatement)=>{
  const result=await statement.all<T>();if(!result.success||!Array.isArray(result.results))fail('read_unavailable');live();
  const expected=canonicalConsent(result.results);proofs.push({statements:[statement],verify(results){
    if(results.length!==1||results[0]?.success!==true||canonicalConsent(results[0].results)!==expected)fail('authority_changed');}});
  return result.results;
 };
 try{
  const identity=hostedIdentity(request);if(!identity)fail('personal_principal_required');
  const principal=await readNativeRetainedPrincipal(env,identity!);
  const principalStatement=db.prepare(`WITH ${principal.auth.cte} SELECT auth_json FROM authorized`).bind(...principal.auth.bindings);
  const currentPrincipal=await read<{auth_json:string}>(principalStatement);
  if(currentPrincipal.length!==1||currentPrincipal[0]!.auth_json!==principal.principal.auth_json)fail('principal_changed');
  const user={userId:identity!.userId,streamId:'creative:'+identity!.userId};
  const readPreflight=async(id:string)=>{
    const rows=await read<PreflightRow>(db.prepare(`SELECT * FROM generation_preflights WHERE preflight_id=? AND owner_id=? AND stream_id=? AND document_id=? AND length(CAST(result_json AS BLOB))<=150000`).bind(id,user.userId,user.streamId,documentId));
    if(rows.length!==1)fail('preflight_unavailable');const row=rows[0]!;deadline(row.expires_at);
    const value=JSON.parse(row.result_json) as GenerationReadiness;
    if(value.preflightId!==id||value.documentId!==documentId||value.kind!=='generate'||(value.productionMode??'manual')!=='manual'
      ||value.canvasId||value.contextSetId||row.expires_at!==value.expiresAt||row.created_at!==value.checkedAt
      ||row.request_key!==`${value.version}:${value.requestKey}`)fail('preflight_binding_mismatch');
    return {row,value};
  };
  const selected=await readPreflight(preflightId),capture=selected.value.advisoryCapture,origin=capture?.origin;
  if(!capture||!origin||capture.sourceInspection!=='prospective-v1')fail('witness_unavailable');
  if((capture.adoptedBy??origin).preflightId!==preflightId||(capture.adoptedBy??origin).requestKey!==selected.value.requestKey)fail('adopter_binding_mismatch');
  const original=origin.preflightId===preflightId?selected:await readPreflight(origin.preflightId);
  if(original.value.requestKey!==origin.requestKey||original.value.documentRevision!==origin.documentRevision||selected.value.documentRevision!==origin.documentRevision
    ||origin.documentId!==documentId||!same(original.value.advisoryCapture?.origin,origin)||!same(original.value.advisoryCapture?.refs,capture.refs))fail('origin_binding_mismatch');
  const qualified=await qualifyAdvisoryCapture(env,user,capture,{documentId,documentRevision:selected.value.documentRevision});
  if(qualified.status!=='retained'||Object.keys(qualified.refs).length!==2||Object.keys(qualified.unavailableRefs??{}).length)fail('capture_unavailable');
  const entries=Object.entries(qualified.refs);if(new Set(entries.map(([,r])=>r.ref)).size!==2)fail('capture_invalid');
  const exclusion=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
  const contents=await read<{content_id:string;content:string;expires_at:string}>(db.prepare(`SELECT content_id,content,expires_at FROM private_content WHERE owner_id=? AND kind='provider-output'
    AND content_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
    AND length(CAST(content AS BLOB))<=500000
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_kind='content' AND resource_id=private_content.content_id)
    AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes WHERE content_id=private_content.content_id)
    AND ${exclusion.sql} ORDER BY content_id`).bind(user.userId,JSON.stringify(entries.map(([,r])=>r.ref)),...exclusion.bindings));
  if(contents.length!==2)fail('capture_unavailable');
  const envelopes:Envelope[]=[];
  for(const [id,ref] of entries){
    const row=contents.find(r=>r.content_id===ref.ref);if(!row||row.expires_at!==ref.expiresAt||await evidenceSha256(row.content)!==ref.sha256)fail('capture_digest_mismatch');deadline(ref.expiresAt);
    if(!memoryDerivationJsonUniqueKeys(row!.content))fail('capture_invalid');
    const envelope=JSON.parse(row!.content) as Envelope;
    if(envelope.schemaVersion!=='forma-private-generation-evidence-v1'||`${envelope.evidenceId}:${envelope.phase}`!==id||!same(envelope.advisory,{...origin,ownerId:user.userId,streamId:user.streamId}))fail('capture_binding_mismatch');
    envelopes.push(envelope);
  }
  const req=envelopes.find(e=>e.phase==='request'),res=envelopes.find(e=>e.phase==='response');
  if(!req||!res||req.evidenceId!==res.evidenceId||typeof req.requestBody!=='string'||typeof res.responseBody!=='string')fail('capture_incomplete');
  const requestEvidence=req!,responseEvidence=res!,witness=requestEvidence.sourceWitness;
  if(!witness||witness.version!=='source-advisory-witness-v1'||!same(witness,responseEvidence.sourceWitness))fail('witness_unavailable');
  deadline(witness!.expiresAt);
  if(witness!.createdAt!==original.row.created_at||witness!.expiresAt!==original.row.expires_at
    ||witness!.authority.ownerId!==user.userId||witness!.authority.streamId!==user.streamId||witness!.authority.projectId!==origin.projectId
    ||witness!.authority.documentId!==documentId||witness!.authority.documentRevision!==origin.documentRevision||witness!.authority.sourceSha256!==origin.sourceSha256)fail('witness_binding_mismatch');
  const authority=await requalifySourceAuthority(env,witness!.authority);proofs.push(authority.proof);
  const expectedInputs=sourceAdvisoryInputs(authority.snapshot);
  // Requalification checks association against the unchanged authoritative source;
  // it never creates or repairs a missing historical witness.
  const expectedWitness=await sourceAdvisoryWitness(authority.receipt,witness!.createdAt,witness!.expiresAt,expectedInputs.input,expectedInputs.mapping);
  if(!same(expectedWitness,witness))fail('input_manifest_mismatch');
  const requestBody=requestEvidence.requestBody!,responseBody=responseEvidence.responseBody!;
  if(await evidenceSha256(requestBody)!==requestEvidence.operation.requestSha256||requestEvidence.operation.requestSha256!==responseEvidence.operation.requestSha256
    ||await evidenceSha256(responseBody)!==responseEvidence.operation.responseSha256)fail('body_digest_mismatch');
  if(!memoryDerivationJsonUniqueKeys(requestBody))fail('request_invalid');
  const parsedRequest=object(JSON.parse(requestBody));
  if(Object.keys(parsedRequest).sort().join(',')!=='input,model'||typeof parsedRequest.model!=='string'||!same(parsedRequest.input,expectedInputs.input))fail('input_binding_mismatch');
  const a=requestEvidence.operation,b=responseEvidence.operation;
  if(a.provider!=='openai'||a.endpoint!=='https://api.openai.com/v1/moderations'||a.entryPath!=='still'||a.settings.advisoryOperation!=='snapshot'
    ||a.effectiveModel!==parsedRequest.model||a.requestedAlias!==parsedRequest.model
    ||!same({...a,returnedModel:null,requestId:null,responseId:null,responseSha256:null},{...b,returnedModel:null,requestId:null,responseId:null,responseSha256:null}))fail('operation_binding_mismatch');
  let body:Record<string,unknown>|null=null;
  try{if(memoryDerivationJsonUniqueKeys(responseBody))body=object(JSON.parse(responseBody));}catch{/* Raw invalid response remains an explicitly unknown result. */}
  const valid=validModerationResults(body,witness!.manifest.length);
  const knownIdentity=(value:unknown)=>typeof value==='string'?value:null;
  // Ambiguous/malformed JSON has no reliable returned body identity. Retain its
  // exact bytes but keep all inferred fields unknown. A uniquely parsed body must
  // still match the original observed envelope identity.
  if(body&&(knownIdentity(body.model)!==knownIdentity(b.returnedModel)||knownIdentity(body.id)!==knownIdentity(b.responseId)))fail('returned_identity_mismatch');
  const results=valid?(body!.results as Array<Record<string,unknown>>):null;
  const value={schemaVersion:'source-advisory-inspection-v1',status:'available',documentId,preflightId,originPreflightId:origin.preflightId,adopted:preflightId!==origin.preflightId,
    expiresAt:new Date(Math.min(...deadlines)).toISOString(),identity:{requestedModel:parsedRequest.model,returnedModel:knownIdentity(body?.model),requestId:knownIdentity(b.requestId),responseId:knownIdentity(body?.id)},
    validity:valid?'valid':'invalid',inputs:witness!.manifest.map((item,i)=>({...item,flagged:results?.[i]?.flagged??null,categories:results?.[i]?.categories??null,scores:results?.[i]?.category_scores??null})),
    raw:{requestBody,responseBody},limitations:'Positional association only; no causal phrase, classifier-quality claim, image-provider verdict or generation authorization.'};
  // One final read-only batch rechecks principal, selected/original rows, current
  // source census/scopes, schema-bound exclusions and exact retained bodies.
  const statements=proofs.flatMap(p=>[...p.statements]),final=await db.batch<Record<string,unknown>>(statements);let offset=0;
  if(final.length!==statements.length)fail('read_incomplete');
  for(const proof of proofs){proof.verify(final.slice(offset,offset+proof.statements.length));offset+=proof.statements.length;}
  live();return json(value);
 }catch(error){return json({schemaVersion:'source-advisory-inspection-v1',status:'unavailable',documentId,preflightId,
   reason:error instanceof Refusal?error.message:'authority_unavailable',rawAvailable:false},409);}
}
