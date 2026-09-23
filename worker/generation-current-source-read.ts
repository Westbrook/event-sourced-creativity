import { currentSourceConfiguration as configuration } from './generation-current-source-configuration.ts';
import type { WorkerEnv } from './runtime.ts';
import { hostedIdentity, authorizationQuery } from './native-retained-text-custody.ts';
import { principalAccessFromRow } from './access-policy.ts';
import { canonicalConsent } from './consequential-consent.ts';
import { serializeEvent } from './event-read-primitives.ts';
import { foldEvents } from '../src/model/events.ts';
import { authoritativeCreativeContext } from './context-authority.ts';
import { outputActiveSourceDeadlineAssertions } from './output-disclosure-proof.ts';
import { nativeMemoryAnswerExclusion } from './memory-native-boundary.ts';
import { currentReadSession, CURRENT_SOURCE_LIMITS as limits, currentBytes } from './generation-current-source-session.ts';
import { currentIdentifier, currentObject, CurrentSourceRefusal, refuseCurrent as fail, proveCurrentIncarnation, verifyCurrentEnvelope } from './generation-current-source-proof.ts';
import { readCurrentProducers } from './generation-current-source-producers.ts';

export const CURRENT_SOURCE_PATH='/api/generation-current-source';
type Row=Record<string,unknown>;
const headers={'cache-control':'private, no-store','content-type':'application/json; charset=utf-8',vary:'Cookie, oai-authenticated-user-id, oai-authenticated-user-email'};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
const parse=(v:unknown)=>currentObject(JSON.parse(String(v)));
// CASE is deliberate: rejected custody never reaches private JSON inspection.
const custody=`CASE WHEN secret.private_event_id IS NULL THEN 'private_absent'
 WHEN secret.redacted_at IS NOT NULL THEN 'private_redacted'
 WHEN secret.owner_id IS NULL OR secret.owner_id='' THEN 'private_owner_missing'
 WHEN typeof(secret.owner_id)!='text' OR length(secret.owner_id)>160 OR substr(secret.owner_id,1,1) NOT GLOB '[A-Za-z0-9]' OR secret.owner_id GLOB '*[^A-Za-z0-9._:-]*' THEN 'private_owner_invalid'
 WHEN secret.owner_id!=? THEN 'private_owner_mismatch'
 WHEN secret.private_event_id!=events.event_id THEN 'private_binding_failure'
 WHEN EXISTS(SELECT 1 FROM project_event_scopes s WHERE s.event_id=events.event_id) THEN 'nonpersonal_event'
 WHEN typeof(secret.private_json)!='text' THEN 'private_json_unavailable'
 WHEN length(CAST(secret.private_json AS BLOB))>${limits.cellBytes} OR length(CAST(events.payload AS BLOB))>${limits.cellBytes} THEN 'cell_capacity_exceeded'
 WHEN NOT json_valid(secret.private_json) OR NOT json_valid(events.payload) THEN 'envelope_json_invalid'
 ELSE 'custody_ok' END`;
const join='FROM events LEFT JOIN event_private_payloads secret ON secret.private_event_id=events.event_id';
const footprint=`SELECT count(*) AS total,COALESCE(MAX(sequence),0) AS head,
 COALESCE(SUM(length(CAST(payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0) AS bytes,
 COALESCE(MAX(MAX(length(CAST(payload AS BLOB)),length(CAST(COALESCE(secret.private_json,'') AS BLOB)))),0) AS largest ${join} WHERE stream_id=?`;


/** Standalone current observation: no old job, requested sequence, mutation,
 * source freeze, study grant, provider call or private-content selector. */
export async function handleCurrentSourceRead(request:Request,env:WorkerEnv):Promise<Response> {
 const url=new URL(request.url),document=url.searchParams.get('documentId');
 const json=(v:unknown,status:number)=>new Response(JSON.stringify(v),{status,headers});
 if(request.method!=='GET')return json({error:'method_not_allowed'},405);
 if(!currentIdentifier(document)||[...url.searchParams.keys()].some(k=>k!=='documentId')||url.searchParams.getAll('documentId').length!==1)return json({error:'invalid_current_source_selection'},400);
 const session=currentReadSession(env),deadlines:number[]=[];
 const captureConfig=()=>canonicalConsent({model:env.OPENAI_MODEL,image:env.OPENAI_IMAGE_MODEL,project:env.OPENAI_PROJECT,pilot:env.FORMA_PILOT_COHORT_ID,
   binding:(env as unknown as Row).FORMA_PREPARATION_CONFIG,credentialBinding:(env as unknown as Row).FORMA_PREPARATION_CREDENTIAL_BINDING});
 const configWitness=captureConfig();
 let stage='authentication',total:number|null=null,examined=0,bodyExamined=0,sourceComplete=false;
 let finalAuthority:(()=>Promise<void>)|undefined;
 const firstFailures:Record<string,number>={};
 const deadline=()=>{if(deadlines.some(d=>!Number.isFinite(d)||d<=Date.now()))fail('retention_expired');
   if(configWitness!==captureConfig())fail('configuration_changed');};
 const unavailable=(code:string)=>({schemaVersion:'forma-current-source-diagnostic-v1',status:'unavailable',error:code,stage,
  history:{scope:'custody-census',bodyExamined,bodyComplete:total!==null&&bodyExamined===total,total,examined,unexamined:total===null?null:Math.max(0,total-examined),complete:total!==null&&examined===total,truncated:total===null?null:examined<total,firstFailureCounts:firstFailures},
  sourceQualified:false,sourceCustodyComplete:sourceComplete,approvalQualified:false,eligibleForComparison:false,humanReviewed:false,executionAuthorized:false});
 let value:unknown,status=409;
 try {
  const identity=hostedIdentity(request);if(!identity||!currentIdentifier(identity.userId))fail('authentication_required');
  if(env.FORMA_PILOT_COHORT_ID?.trim())fail('pilot_scope_unsupported');
  const auth=authorizationQuery(env,identity),principal=(await session.read(`WITH ${auth.cte} SELECT auth_json FROM authorized`,auth.bindings))[0];
  if(!principal)fail('administrator_required');
  const observed=parse(principal.auth_json);if(observed.role!=='admin')fail('administrator_required');
  finalAuthority=async()=>{const latest=(await session.read(`WITH ${auth.cte} SELECT auth_json FROM authorized`,auth.bindings))[0];if(latest?.auth_json!==principal.auth_json)fail('authority_changed');};
  const access=await principalAccessFromRow(observed,'admin',{email:identity.email,source:identity.source,subject:identity.userId});
  if(access.identityPolicyDeniedCustody)fail('authority_unavailable');
  const owner=identity.userId,stream='creative:'+owner;
  const pilot=await session.read("SELECT 1 AS allowed WHERE NOT EXISTS(SELECT 1 FROM pilot_participants p JOIN pilot_cohorts c ON c.cohort_id=p.cohort_id WHERE p.user_id=? AND p.status='active' AND p.revoked_at IS NULL AND c.status IN('active','paused','closed'))",[owner]);
  if(pilot.length!==1)fail('pilot_scope_unsupported');
  stage='history_custody';
  const f=(await session.read(footprint,[stream]))[0];
  if(!f||!Number.isSafeInteger(f.total)||!Number.isSafeInteger(f.head))fail('history_unavailable');
  total=Number(f.total);
  if(total>limits.historyRows||Number(f.bytes)>limits.historyBytes||Number(f.largest)>limits.cellBytes)fail('history_capacity_exceeded');
  const boundary=Number(f.head);let after=0;
  let selectedProject:string|null=null;
  const selectedBlockIds:string[]=[];
  finalAuthority=async()=>{
   const latest=(await session.read(`WITH ${auth.cte},footprint AS (${footprint}) SELECT auth_json FROM authorized
 WHERE EXISTS(SELECT 1 FROM footprint WHERE total=? AND head=? AND bytes=? AND largest=?)
 AND NOT EXISTS(SELECT 1 FROM pilot_participants p JOIN pilot_cohorts c ON c.cohort_id=p.cohort_id WHERE p.user_id=? AND p.status='active' AND p.revoked_at IS NULL AND c.status IN('active','paused','closed'))
 AND NOT EXISTS(SELECT 1 FROM organization_projects WHERE owner_user_id=? AND project_id=?)
 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=?) OR (resource_kind='block' AND resource_id IN(SELECT value FROM json_each(?))))`,
 [...auth.bindings,stream,f.total,f.head,f.bytes,f.largest,owner,owner,selectedProject,document,JSON.stringify(selectedBlockIds)]))[0];
   if(latest?.auth_json!==principal.auth_json)fail('authority_or_source_changed');
  };
  const footprintGate='EXISTS(SELECT 1 FROM footprint WHERE total=? AND head=? AND bytes=? AND largest=?)';
  const footprintArgs=[f.total,f.head,f.bytes,f.largest];
  // Observe the complete stream before any private body crosses the DB boundary.
  while(examined<total){
   const page=await session.read(`WITH footprint AS (${footprint}) SELECT sequence,${custody} AS custody ${join} WHERE stream_id=? AND sequence>? AND sequence<=? AND ${footprintGate} ORDER BY sequence LIMIT ${limits.pageRows}`,[stream,owner,stream,after,boundary,...footprintArgs]);
   if(!page.length)fail('history_incomplete');
   for(const row of page){if(!Number.isSafeInteger(row.sequence)||Number(row.sequence)!==after+1)fail('history_order_invalid');after=Number(row.sequence);examined++;
    if(row.custody!=='custody_ok')firstFailures[String(row.custody)]=(firstFailures[String(row.custody)]??0)+1;}
  }
  if(examined!==total||after!==boundary)fail('history_incomplete');
  if(Object.keys(firstFailures).length)fail('history_custody_unavailable');
  stage='current_lifecycle';after=0;const raw:Row[]=[];
  while(raw.length<total){
   const page=await session.read(`WITH footprint AS (${footprint}),admitted AS (SELECT events.*,secret.project_id,secret.document_id,${custody} AS custody,
 CASE WHEN (${custody})='custody_ok' THEN secret.private_json ELSE NULL END AS private_json
 ${join} WHERE stream_id=? AND sequence>? AND sequence<=? AND ${footprintGate} ORDER BY sequence LIMIT ${limits.pageRows}) SELECT * FROM admitted`,[stream,owner,owner,stream,after,boundary,...footprintArgs]);
   if(!page.length)fail('history_incomplete');
   for(const row of page){if(row.custody!=='custody_ok'||!Number.isSafeInteger(row.sequence)||Number(row.sequence)!==after+1)fail('custody_changed');after=Number(row.sequence);raw.push(row);bodyExamined++;}
  }
  if(raw.length!==total||after!==boundary)fail('history_incomplete');
  const events=raw.map(row=>{const e=serializeEvent(row);verifyCurrentEnvelope(row,e);if(e.actor!=='user:'+owner)fail('event_actor_unavailable');return e;});
  const incarnation=proveCurrentIncarnation(events,document),project=incarnation.projectId;
  selectedProject=project;selectedBlockIds.push(...incarnation.blocks.map(e=>String(e.payload.block_id)));
  if(selectedBlockIds.length>128)fail('source_capacity_exceeded');
  const governed=await session.read('SELECT 1 AS present FROM organization_projects WHERE owner_user_id=? AND project_id=? LIMIT 1',[owner,project]);
  if(governed.length)fail('personal_scope_required');
  if((await session.read("SELECT 1 AS present FROM project_resource_scopes WHERE (resource_kind='document' AND resource_id=?) OR (resource_kind='block' AND resource_id IN(SELECT value FROM json_each(?))) LIMIT 1",[document,JSON.stringify(selectedBlockIds)])).length)fail('personal_scope_required');
  const projection=foldEvents(events,Infinity,document,project),context=authoritativeCreativeContext(events,{documentId:document,projectId:project});
  stage='current_source';
  if(context.snapshot.facts.length>128||context.snapshot.relationships.length>128)fail('source_capacity_exceeded');
  if(context.snapshot.pins.length||projection.blocks.some(b=>b.type==='reference'))fail('references_or_pins_unsupported');
  if(context.snapshot.facts.some(f=>f.authorship==='accepted-memory-assisted'||Object.keys(f.properties).some(k=>/memory|private_content|content_ref/iu.test(k))))fail('memory_or_private_pointer_unsupported');
  deadlines.push(...outputActiveSourceDeadlineAssertions({...context,snapshot:{...context.snapshot,facts:context.snapshot.facts.map(f=>({...f,active:true}))}}).map(d=>d.deadlineMs!));deadline();
  const refs=[...new Set([...context.snapshot.facts.flatMap(f=>f.source_event_refs),...context.snapshot.relationships.flatMap(r=>r.source_event_refs),...(projection.documents.find(d=>d.id===document)?.sourceEvents??[])])];
  if(refs.length>128||refs.some(id=>!events.some(e=>e.eventId===id)))fail('source_references_unavailable');
  sourceComplete=true;stage='approval_producers';
  const exclusion=await nativeMemoryAnswerExclusion(session.helperEnv,{answerAlias:'private_content'});
  const readContent=async(id:string,kind:string)=>{
   if(!currentIdentifier(id))fail('producer_reference_invalid');
   const row=(await session.read(`SELECT content_id,kind,content,created_at,expires_at FROM private_content WHERE content_id=? AND owner_id=? AND kind=?
 AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND length(CAST(content AS BLOB))<=${limits.cellBytes}
 AND NOT EXISTS(SELECT 1 FROM project_resource_scopes s WHERE s.resource_kind='content' AND s.resource_id=private_content.content_id)
 AND NOT EXISTS(SELECT 1 FROM private_content_retention_scopes s WHERE s.content_id=private_content.content_id) AND ${exclusion.sql}`,[id,owner,kind,...exclusion.bindings]))[0];
   if(!row)fail('producer_content_unavailable');deadlines.push(Date.parse(String(row.expires_at)));return row;
  };
  const selectedBlocks=new Set(incarnation.blocks.map(e=>String(e.payload.block_id)));
  const selectedRows=raw.filter((r,i)=>{const p=events[i].payload;return p.document_id===document||selectedBlocks.has(String(p.block_id))||refs.includes(String(r.event_id));});
  // Producer/edit evidence also carries historical source bytes. Clearing an
  // expiry on the current fact cannot extend disclosure of those retained bytes.
  const rightsFields=['source_expires_at','license_expires_at','rights_expires_at'];
  for(const row of selectedRows){
   const payload=parse(row.private_json),properties=payload.properties&&typeof payload.properties==='object'&&!Array.isArray(payload.properties)?payload.properties as Row:{};
   const values=rightsFields.map(k=>properties[k]);
   if(row.type==='BlockPropertyEdited'&&rightsFields.includes(String(payload.property_path)))values.push(payload.new_value,payload.old_value);
   for(const v of values){if(v===undefined||v===null||v==='')continue;if(typeof v!=='string'||!Number.isFinite(Date.parse(v)))fail('source_rights_unavailable');deadlines.push(Date.parse(v));}
  }
  deadline();
  const producers=await readCurrentProducers({events,facts:context.snapshot.facts,qualifiedSourceEvents:selectedRows,owner,stream,document,project,read:session.read,readContent});
  const sourceJson=JSON.stringify({...context.snapshot,document:{id:document,title:projection.documents.find(d=>d.id===document)!.title},standing_constraints:[]});
  const config=configuration(env);
  if(config.accountBinding)deadlines.push(Date.parse(String(config.accountBinding.expiresAt)));
  stage='final_recheck';
  value={schemaVersion:'forma-current-source-evidence-v1',status:'complete',authority:'current-personal-administrator',
   source:{json:sourceJson,sha256:await hash(sourceJson),byteLength:currentBytes(sourceJson),documentId:document,projectId:project,
    documentRevision:context.documentRevision,sourceBlockVersions:context.sourceBlockVersions,ownerHead:boundary,incarnation,
    sourceEvents:selectedRows,complete:true,deadlines},approval:producers,configuration:config,
   eligibility:{sourceAndApprovalQualified:true,eligibleForComparison:false,reasons:config.accountBinding?['retained_direction_not_qualified']:['retained_direction_and_configuration_not_qualified'],humanReviewed:false,executionAuthorized:false},
   limits,limitations:['Current observation, not historical reconstruction or a generation grant.','Environment labels are not a verified account/configuration binding.','Full stream unknown effects or custody gaps refuse; no relevance exception.']};status=200;
 }catch(error){value=unavailable(error instanceof CurrentSourceRefusal?error.message:'current_source_unavailable');}
 try {
  // Refusals also depend on captured evidence. A changed witness supersedes the
  // earlier reason; neither response exposes partially qualified private data.
  await session.recheck();await finalAuthority?.();deadline();
  const body=JSON.stringify(value);if(currentBytes(body)>limits.replyBytes)fail('reply_capacity_exceeded');deadline();
  return new Response(body,{status,headers});
 }catch(error){
  // A failed final witness invalidates the earlier diagnostic too. In
  // particular, revoked authority must not receive old census/qualification data.
  return json({schemaVersion:'forma-current-source-diagnostic-v1',status:'unavailable',stage:'final_recheck',
   error:error instanceof CurrentSourceRefusal?error.message:'current_source_recheck_unavailable',
   sourceQualified:false,approvalQualified:false,eligibleForComparison:false,humanReviewed:false,executionAuthorized:false},409);
 }
}
