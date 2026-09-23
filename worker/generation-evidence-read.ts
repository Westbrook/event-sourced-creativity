import { qualifyAdvisoryCapture } from './advisory-moderation-evidence.ts';
import type { AdvisoryModerationCapture } from '../src/model/generation-readiness.ts';
import { readGenerationSourceEvidence } from './generation-source-evidence-read.ts';
import type { WorkerEnv } from './runtime.ts';
import { hostedIdentity, readNativeRetainedPrincipal, Unavailable } from './native-retained-text-custody.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
import { sponsorJobReadPredicate } from './experience-sponsor-job-read.ts';

export const GENERATION_EVIDENCE_PATH = '/api/generation-evidence';
export const GENERATION_EVIDENCE_PAGE = '/generation-evidence';
const headers = {'cache-control':'private, no-store',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const maxBytes = 2_200_000;
const object = (value: unknown): Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
const parse = (raw: string) => object(JSON.parse(raw));
const byteLength = (raw: string) => new TextEncoder().encode(raw).length;
const escape = (raw: string) => raw.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const sha256 = async (raw: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),n=>n.toString(16).padStart(2,'0')).join('');
const fail = () => new Unavailable('generation_evidence_unavailable');
type Job = {job_id:string;owner_id:string;stream_id:string;document_id:string;correlation_id:string;status:string;request_json:string;result_json:string;requested_at:string;completed_at:string|null;expires_at:string;attempt_count:number};
type Event = {event_id:string;sequence:number;type:string;payload:string;correlation_id:string;occurred_at:string;private_json:string|null};
type Content = {content_id:string;kind:string;content:string;created_at:string;expires_at:string};

/** Explicit personal-owner inspection only. No initializers, retention sweep,
 * recovery, accounting, or provider dispatch. Optional includeSource adds a
 * separately authenticated current-source and original-approval observation.
 * The caller selects an original requested event, never arbitrary content IDs.
 */
export async function handleGenerationEvidenceRead(request:Request,env:WorkerEnv):Promise<Response>{
  const url=new URL(request.url);
  const reply=(body:unknown,status=200)=>{
    const raw=JSON.stringify(body,null,2);
    if(byteLength(raw)>12_000_000)throw new Unavailable('generation_evidence_reply_capacity_exceeded');
    if(url.pathname===GENERATION_EVIDENCE_PAGE&&!url.searchParams.has('download')){
      const download=new URL(url);download.searchParams.set('download','1');
      const page=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Original generation evidence · Forma</title><style>body{font:16px/1.5 system-ui;margin:2rem;background:#faf9f6;color:#292724}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}aside{position:fixed;bottom:1rem;right:1rem;padding:.5rem;background:white;border:1px solid #ddd}</style><body><h1>Original generation evidence</h1><p>Private, read-only records retained for the selected attempt. Missing records remain missing. This view does not generate or reconcile anything.</p>${status===200?`<p><a href="${escape(download.pathname+download.search)}">Download private evidence</a></p>`:''}<pre id="evidence">${escape(raw)}</pre>${url.searchParams.has('progress-report')?'<aside aria-label="Developer tools"><a href="http://127.0.0.1:4187/">Progress Report</a></aside>':''}</body></html>`;
      if(byteLength(page)>12_000_000)throw new Unavailable('generation_evidence_reply_capacity_exceeded');
      return new Response(page,{status,headers:{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
    }
    return new Response(raw,{status,headers:{...headers,'content-type':'application/json; charset=utf-8',...(url.searchParams.has('download')?{'content-disposition':'attachment; filename="generation-evidence.json"'}:{})}});
  };
  if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
  const documentId=url.searchParams.get('documentId')??'',sequence=Number(url.searchParams.get('requestedSequence'));
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(documentId)||!Number.isSafeInteger(sequence)||sequence<1
    ||(url.searchParams.has('includeSource')&&url.searchParams.get('includeSource')!=='1')
    ||[...url.searchParams.keys()].some(key=>!['documentId','requestedSequence','download','progress-report','includeSource'].includes(key)))return reply({error:'invalid_evidence_selection'},400);
  const db=env.DB;
  try{
    const identity=hostedIdentity(request);if(!identity)return reply({error:'authentication_required'},401);
    const firstAuth=await readNativeRetainedPrincipal(env,identity);
    const stream=`creative:${identity.userId}`;
    const sponsor=await sponsorJobReadPredicate(env,{userId:identity.userId,streamId:stream});
    const readJob=()=>db.prepare(`SELECT job_id,owner_id,stream_id,document_id,correlation_id,status,request_json,result_json,requested_at,completed_at,expires_at,attempt_count FROM document_jobs
      WHERE owner_id=? AND stream_id=? AND document_id=? AND kind='generate' AND status IN('completed','failed','partial','canceled')
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND json_type(request_json,'$.memoryMode') IS NULL AND json_type(result_json,'$.memoryDocumentJobOrigin') IS NULL
      AND json_type(request_json,'$.outputDurable') IS NULL AND NOT (${sponsor})
      AND length(CAST(request_json AS BLOB))<=${maxBytes} AND length(CAST(result_json AS BLOB))<=${maxBytes}
      AND NOT EXISTS(SELECT 1 FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id)
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE (scope.resource_kind='job' AND scope.resource_id=document_jobs.job_id) OR (scope.resource_kind='document' AND scope.resource_id=document_jobs.document_id))
      AND EXISTS(SELECT 1 FROM events event WHERE event.stream_id=document_jobs.stream_id AND event.correlation_id=document_jobs.correlation_id
        AND event.sequence=? AND event.type='GenerationRequested' AND json_extract(event.payload,'$.document_id')=document_jobs.document_id
        AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event.event_id)) LIMIT 2`)
      .bind(identity.userId,stream,documentId,sequence).all<Job>();
    const jobs=await readJob();if(jobs.results.length!==1)throw fail();const job=jobs.results[0]!;
    const readEvents=()=>db.prepare(`SELECT event.event_id,event.sequence,event.type,event.payload,event.correlation_id,event.occurred_at,
      CASE WHEN secret.owner_id=? AND secret.document_id=? AND secret.redacted_at IS NULL AND length(CAST(secret.private_json AS BLOB))<=${maxBytes} THEN secret.private_json ELSE NULL END AS private_json
      FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
      WHERE event.stream_id=? AND event.correlation_id=? AND event.type IN('GenerationRequested','ContextCompiled','BudgetReserved','GenerationCompleted','GenerationFailed','GenerationUsageRecorded')
        AND length(CAST(event.payload AS BLOB))<=${maxBytes}
        AND NOT EXISTS(SELECT 1 FROM project_event_scopes scope WHERE scope.event_id=event.event_id)
      ORDER BY event.sequence LIMIT 33`).bind(identity.userId,documentId,stream,job.correlation_id).all<Event>();
    const events=(await readEvents()).results;
    if(!events.length||events.length>32)throw fail();
    const selected=events.find(event=>event.sequence===sequence&&event.type==='GenerationRequested');if(!selected)throw fail();
    const generationId=parse(selected.payload).generation_id;if(typeof generationId!=='string')throw fail();
    if(events.some(event=>parse(event.payload).generation_id!==generationId))throw fail();
    const checkpoint=parse(job.result_json),refs=new Map<string,string[]>();
    const jobRequest=parse(job.request_json),originalAdvisory=object(checkpoint.advisoryCapture);
    const readAdvisory=async()=>{
      if(!Object.keys(originalAdvisory).length)return undefined;
      const binding=object(originalAdvisory.adoptedBy);
      if(binding.preflightId!==jobRequest.preflightId||binding.requestKey!==jobRequest.requestKey)
        return {status:'unavailable' as const,reason:'job-binding-mismatch',refs:{}};
      return qualifyAdvisoryCapture(env,{userId:identity.userId,streamId:stream},originalAdvisory as AdvisoryModerationCapture,
        {documentId,documentRevision:String(jobRequest.documentRevision??'')});
    };
    const advisoryCapture=await readAdvisory();
    const unavailableAdvisoryRefs=new Set<string>();

    const add=(value:unknown,label:string)=>{if(typeof value!=='string'||!value)return;if(value.length>240)throw fail();refs.set(value,[...(refs.get(value)??[]),label]);};
    for(const [key,value] of Object.entries(object(checkpoint.generationEvidenceRefs))){
      // A cache-linked advisory record must still match its original binding and deadline.
      if(Object.hasOwn(object(originalAdvisory.refs),key)&&advisoryCapture?.refs[key]?.ref!==object(value).ref)unavailableAdvisoryRefs.add(String(object(value).ref));
      add(object(value).ref,`checkpoint:${key}`);
    }
    const receipt=object(checkpoint.generationReceipt);add(receipt.input_ref,'job:input');
    for(const event of events){const payload=event.private_json?parse(event.private_json):parse(event.payload);for(const key of ['output_ref','prompt_ref','input_ref'] as const)add(payload[key],`${event.type}:${key}`);}
    if(refs.size>32)throw fail();
    const exclusion=await nativeMemoryAnswerExclusion(env,{answerAlias:'private_content'});
    const readContent=()=>db.prepare(`SELECT content_id,kind,content,created_at,expires_at FROM private_content
      WHERE owner_id=? AND content_id IN(SELECT value FROM json_each(?)) AND redacted_at IS NULL
      AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=${maxBytes}
      AND kind IN('provider-output','provider-response','prompt','document-artifact-input')
      AND NOT EXISTS(SELECT 1 FROM project_resource_scopes scope WHERE scope.resource_kind='content' AND scope.resource_id=private_content.content_id)
      AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes scope WHERE scope.content_id=private_content.content_id)
      AND ${exclusion.sql} ORDER BY content_id`).bind(identity.userId,JSON.stringify([...refs.keys()].filter(id=>!unavailableAdvisoryRefs.has(id))),...exclusion.bindings).all<Content>();
    const contents=(await readContent()).results;
    if(byteLength(JSON.stringify({job,events,contents}))>12_000_000)throw fail();
    const sourceEvidence=url.searchParams.has('includeSource')?await readGenerationSourceEvidence(request,env,job,sequence):null;
    const records=await Promise.all(contents.map(async row=>({...row,sha256:await sha256(row.content),linkedFrom:refs.get(row.content_id)})));
    if(byteLength(JSON.stringify({job,events,records,source:sourceEvidence?.certificate}))>12_000_000)throw new Unavailable('generation_source_reply_capacity_exceeded');
    // Recheck original custody, bytes, expiry and principal after all reads. A
    // concurrent erasure, transfer or account-policy change cannot reuse them.
    if(env.DB!==db||JSON.stringify((await readJob()).results)!==JSON.stringify(jobs.results)
      ||JSON.stringify((await readEvents()).results)!==JSON.stringify(events)
      ||JSON.stringify((await readContent()).results)!==JSON.stringify(contents)
      ||(await readNativeRetainedPrincipal(env,identity)).principal.auth_json!==firstAuth.principal.auth_json||env.DB!==db)throw fail();
    if(JSON.stringify(await readAdvisory())!==JSON.stringify(advisoryCapture))throw fail();
    await sourceEvidence?.recheck();
    const sourceDiagnostic=sourceEvidence?.certificate.status==='unavailable'?sourceEvidence.certificate:null;
    const response=sourceDiagnostic?reply({error:sourceDiagnostic.error,diagnostic:sourceDiagnostic},409):reply({schemaVersion:'forma-original-generation-evidence-v1',retrievedAt:new Date().toISOString(),
      custody:{ownerId:identity.userId,streamId:stream,documentId,generationId,requestedSequence:sequence,jobExpiresAt:job.expires_at,scope:'personal',readOnly:true},
      limitations:['Only original retained bytes are returned; no historical source is reconstructed.','Application usage and settlement records are not independent verified incurred charges.','Current deployment configuration is not proof of the original account, payer, region or credential binding.'],
      job,events,records,...(advisoryCapture?{advisoryCapture}:{}),...(sourceEvidence?{sourceEvidence:sourceEvidence.certificate}:{}),
      unavailable:[...refs].filter(([id])=>!contents.some(row=>row.content_id===id)).map(([contentId,linkedFrom])=>({contentId,linkedFrom,status:'not-retained-or-not-authorized'}))});
    sourceEvidence?.checkDeadline();
    if([job.expires_at,...Object.values(advisoryCapture?.refs??{}).map(ref=>ref.expiresAt),...contents.map(row=>row.expires_at)].some(value=>Date.parse(value)<=Date.now()))throw fail();
    return response;
  }catch(error){if(error instanceof Error&&/^generation_source_[a-z_]+$/u.test(error.message))return reply({error:error.message},409);return reply({error:error instanceof Unavailable?error.message:'generation_evidence_unavailable'},error instanceof Unavailable?404:503);}
}
