import {OutputConflictError,outputAssertionStatements,outputScopeAuthority,type OutputScope,type OutputSqlAssertion} from './output-command-core.ts';
import type {OutputOperationSlot} from './output-requirements-ledger.ts';
import {sceneSourceVersionAssertions,type SceneSourceVersion} from './scene-source-generation.ts';
import {SCENE_SOURCE_GENERATION_MAX} from '../db/scene-source-generations.ts';
import type {EventRow} from './event-write-primitives.ts';
import type {WorkerEnv} from './runtime.ts';

type Identity={scopeKey:string;slotId:string;grantId:string;planRevisionId:string;targetId:string;routeDigest:string;sourceDigest:string;
  jobId:string;ownerId:string;actorId:string;projectId:string;documentId:string;streamId:string;correlationId:string};
type Transition=Identity&{version:1;phase:'admission'|'run'|'execution';eventIds:string[];eventSequences:number[];predecessor:SceneSourceVersion};
export type SceneJobSourceWitness=Readonly<Transition&{successor:SceneSourceVersion}>;
const fail=():never=>{throw new OutputConflictError('output_scene_source_witness_unavailable',409);};
const rawLimit=16*1024;
const size=(value:string)=>new TextEncoder().encode(value).length;
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&size(value)<=512;
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

/** Internal personal-original Scene path only. The caller separately retains
 * exact source envelopes, route/consent, lease, rights and provider-call limits. */
function identity(scope:OutputScope,slot:OutputOperationSlot,correlationId:string):Identity{
  if(scope.kind!=='personal'||scope.ownerUserId!==scope.actorUserId||scope.contextId||scope.organizationId||scope.projectAccessId
    ||slot.scopeKey!==scope.key||slot.attemptOrdinal!==0||slot.previousSlotId)fail();
  const value={scopeKey:scope.key,slotId:slot.slotId,grantId:slot.grantId,planRevisionId:slot.planRevisionId,targetId:slot.targetId,
    routeDigest:slot.routeDigest,sourceDigest:slot.sourceDigest,jobId:slot.jobId,ownerId:scope.ownerUserId,actorId:scope.actorUserId,
    projectId:scope.projectId,documentId:scope.documentId,streamId:'creative:'+scope.ownerUserId,correlationId};
  if(!Object.values(value).every(identifier))fail();return value;
}
function custody(expected:Identity,protocol=1):OutputSqlAssertion{
  return{sql:`EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id
    JOIN output_plan_revisions plan ON plan.scope_key=slot.scope_key AND plan.plan_revision_id=slot.plan_revision_id
    JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id
    WHERE job.job_id=? AND job.owner_id=? AND job.stream_id=? AND job.document_id=? AND job.correlation_id=?
      AND job.kind='render_document' AND job.source_surface='outputs' AND json_extract(job.request_json,'$.artifactKind')='scene'
      AND job.scene_source_protocol=${protocol===0?0:1}
      AND job.status IN('queued','running','committing') AND job.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND (job.status='queued' OR job.lease_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND slot.scope_key=? AND slot.slot_id=? AND slot.grant_id=? AND slot.plan_revision_id=? AND slot.target_id=?
      AND slot.route_digest=? AND slot.source_digest=? AND slot.attempt_ordinal=0 AND slot.previous_slot_id IS NULL
      AND slot.status IN('authorized','queued','running') AND plan.scope_kind='personal' AND plan.owner_user_id=?
      AND plan.project_id=? AND plan.document_id=? AND plan.organization_id IS NULL AND plan.project_access_id IS NULL
      AND grant_row.plan_revision_id=slot.plan_revision_id AND grant_row.actor_user_id=? AND grant_row.context_id IS NULL
      AND grant_row.status IN('authorized','active') AND grant_row.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
    bindings:[expected.jobId,expected.ownerId,expected.streamId,expected.documentId,expected.correlationId,expected.scopeKey,expected.slotId,
      expected.grantId,expected.planRevisionId,expected.targetId,expected.routeDigest,expected.sourceDigest,expected.ownerId,expected.projectId,expected.documentId,expected.actorId]};
}
function parse(raw:string,expected:Identity):SceneJobSourceWitness{
  if(typeof raw!=='string'||size(raw)>rawLimit)fail();
  const value:SceneJobSourceWitness=(()=>{try{return JSON.parse(raw);}catch{return fail();}})();
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...Object.keys(expected),'version','phase','eventIds','eventSequences','predecessor','successor'].sort().join(',')
    ||value.version!==1||!['admission','run','execution'].includes(value.phase)
    ||Object.entries(expected).some(([key,v])=>value[key as keyof Identity]!==v)
    ||!Array.isArray(value.eventIds)||!value.eventIds.length||value.eventIds.length>(value.phase==='admission'?64:value.phase==='run'?1:8)||!value.eventIds.every(identifier)
    ||new Set(value.eventIds).size!==value.eventIds.length||!Array.isArray(value.eventSequences)||value.eventSequences.length!==value.eventIds.length
    ||value.eventSequences.some((v,i)=>!Number.isSafeInteger(v)||v<1||i>0&&v!==value.eventSequences[i-1]!+1))fail();
  try{sceneSourceVersionAssertions(value.predecessor);sceneSourceVersionAssertions(value.successor);}catch{fail();}
  if(value.predecessor.streamId!==expected.streamId||value.successor.streamId!==expected.streamId
    ||value.predecessor.projectAccessId!==undefined||value.successor.projectAccessId!==undefined
    ||value.predecessor.instanceNonce!==value.successor.instanceNonce||value.predecessor.epoch!==value.successor.epoch
    ||value.successor.streamGeneration<=value.predecessor.streamGeneration||value.successor.projectGeneration!==0)fail();
  Object.freeze(value.eventIds);Object.freeze(value.eventSequences);Object.freeze(value.predecessor);Object.freeze(value.successor);
  return Object.freeze(value);
}

/** No current-counter read: only a durable, exact job/slot-bound receipt. Its
 * successor must still be verified on every subsequent source read/write. */
export async function readSceneJobSourceWitness(env:WorkerEnv,scope:OutputScope,slot:OutputOperationSlot,correlationId:string){
  const expected=identity(scope,slot,correlationId),guard=custody(expected),authority=outputScopeAuthority(scope,'request');
  const result=await env.DB.batch<Record<string,unknown>>([
    ...outputAssertionStatements(env,authority),...outputAssertionStatements(env,guard),
    env.DB.prepare('SELECT scene_source_version_json AS receipt FROM document_jobs WHERE job_id=? AND owner_id=?').bind(expected.jobId,expected.ownerId),
  ]);
  if(!Array.isArray(result)||result.length!==5||Array.from({length:5},(_,i)=>i).some(i=>result[i]?.success!==true)
    ||!Array.isArray(result[4]!.results)||result[4]!.results.length!==1||typeof result[4]!.results[0]?.receipt!=='string')fail();
  return sceneJobSourceWitnessAssertions(scope,slot,correlationId,result[4]!.results[0]!.receipt as string);
}

/** Constructs predicates only, never authority from bytes. Consume these in
 * every source/consequence transaction, including after a committed successor. */
export function sceneJobSourceWitnessAssertions(scope:OutputScope,slot:OutputOperationSlot,correlationId:string,raw:string){
  const expected=identity(scope,slot,correlationId),witness=parse(raw,expected);
  return{raw,witness,assertions:[outputScopeAuthority(scope,'request'),custody(expected),
    {sql:'EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND scene_source_version_json=?)',bindings:[expected.jobId,expected.ownerId,raw]},...sceneSourceVersionAssertions(witness.successor)]};
}

/** Prefix and suffix must share the writer's ONE transaction. No event bodies
 * enter this receipt: IDs/sequences identify the exact attempted range, whose
 * stored public/private envelopes remain independently checked on lost ACK. */
export function prepareSceneJobSourceTransition(env:WorkerEnv,input:{scope:OutputScope;slot:OutputOperationSlot;correlationId:string;
  predecessor:SceneSourceVersion;previousRaw:string|null;phase:'admission'|'run'|'execution';events:readonly EventRow[]}){
  const expected=identity(input.scope,input.slot,input.correlationId),predecessor=Object.freeze({...input.predecessor});
  sceneSourceVersionAssertions(predecessor);
  if(predecessor.streamId!==expected.streamId||predecessor.projectAccessId!==undefined||!['admission','run','execution'].includes(input.phase)
    ||!input.events.length||input.events.length>(input.phase==='admission'?64:input.phase==='run'?1:8))fail();
  if(input.phase==='admission'){if(input.previousRaw!==null)fail();}
  else{if(typeof input.previousRaw!=='string'||!equal(parse(input.previousRaw,expected).successor,predecessor))fail();}
  if(input.phase==='run'&&(input.correlationId!==input.slot.jobId||!['admission','run'].includes(parse(input.previousRaw!,expected).phase)
    ||input.events[0]?.type!=='OutputExecutionRunRequested'||input.events[0]?.payload.grant_id!==input.slot.grantId
    ||!Array.isArray(input.events[0]?.payload.job_ids)||!(input.events[0]!.payload.job_ids as unknown[]).includes(input.slot.jobId)))fail();
  const transition:Transition={...expected,version:1,phase:input.phase,eventIds:input.events.map(e=>e.eventId),eventSequences:input.events.map(e=>e.sequence),predecessor};
  if(new Set(transition.eventIds).size!==input.events.length||input.events.some((event,i)=>!identifier(event.eventId)||event.streamId!==expected.streamId
    ||!Number.isSafeInteger(event.sequence)||event.sequence<1||i>0&&event.sequence!==input.events[i-1]!.sequence+1
    ||input.phase==='execution'&&event.correlationId!==expected.correlationId))fail();
  const raw=JSON.stringify(transition);if(size(raw)>rawLimit-1024)fail();
  const guard=custody(expected,input.phase==='admission'?0:1),runGuard:OutputSqlAssertion={sql:"EXISTS(SELECT 1 FROM document_jobs job JOIN output_operation_slots slot ON slot.job_id=job.job_id JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE job.job_id=? AND job.owner_id=? AND job.status='queued' AND job.attempt_count=0 AND slot.slot_id=? AND slot.scope_key=? AND slot.status='queued' AND grant_row.status='active')",bindings:[expected.jobId,expected.ownerId,expected.slotId,expected.scopeKey]},before=[outputScopeAuthority(input.scope,'request'),guard,...sceneSourceVersionAssertions(predecessor),
    {sql:'EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND scene_source_version_json IS ?)',bindings:[expected.jobId,expected.ownerId,input.previousRaw]}];
  // Admission creates its job/slot later in this same batch. Its caller already
  // has the source/authority prefix; only execution can precheck stored custody.
  const prefix=input.phase==='admission'?[outputScopeAuthority(input.scope,'request'),...sceneSourceVersionAssertions(predecessor)]:before;
  const update=env.DB.prepare(`UPDATE document_jobs SET scene_source_protocol=1,scene_source_version_json=json_set(?,'$.successor',json((SELECT json_object(
      'streamId',?,'instanceNonce',epoch.instance_nonce,'epoch',epoch.generation,'streamGeneration',generation.generation,'projectGeneration',0)
      FROM scene_source_epoch epoch JOIN scene_source_generations generation ON generation.scope_kind='stream' AND generation.scope_key=?
      WHERE epoch.singleton=1 AND epoch.schema_version=1 AND epoch.instance_nonce=? AND epoch.generation=?
        AND generation.generation>? AND generation.generation<${SCENE_SOURCE_GENERATION_MAX})))
    WHERE job_id=? AND owner_id=? AND scene_source_version_json IS ? AND (${guard.sql})
      AND (SELECT COUNT(*) FROM json_each(?) expected_event JOIN events event ON event.event_id=json_extract(expected_event.value,'$[0]')
        AND event.sequence=json_extract(expected_event.value,'$[1]') WHERE event.stream_id=?)=?`)
    .bind(raw,expected.streamId,expected.streamId,predecessor.instanceNonce,predecessor.epoch,predecessor.streamGeneration,expected.jobId,expected.ownerId,input.previousRaw,
      ...guard.bindings??[],JSON.stringify(transition.eventIds.map((id,index)=>[id,transition.eventSequences[index]])),expected.streamId,input.events.length);
  const after=[update,...outputAssertionStatements(env,{sql:"changes()=1 AND EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND json_type(scene_source_version_json,'$.successor')='object')",bindings:[expected.jobId]}),
    ...(input.phase==='run'?outputAssertionStatements(env,runGuard):[]),
    env.DB.prepare('SELECT scene_source_version_json AS receipt FROM document_jobs WHERE job_id=? AND owner_id=?').bind(expected.jobId,expected.ownerId)];
  let consumed=false;
  return{before:prefix,after,acknowledge(results:unknown){
    if(consumed)fail();consumed=true;
    if(!Array.isArray(results))return fail();
    if(results.length!==after.length||Array.from({length:after.length},(_,i)=>i).some(i=>results[i]?.success!==true)
      ||!Array.isArray(results.at(-1)?.results)||results.at(-1)!.results.length!==1||typeof results.at(-1)!.results[0]?.receipt!=='string')fail();
    const receipt=results.at(-1)!.results[0]!.receipt as string,witness=parse(receipt,expected),{successor,...actual}=witness;
    if(!equal(actual,transition))fail();return{raw:receipt,witness,successor};
  }};
}

/** Bind an admitted witness to the first execution claim, in that SAME claim
 * transaction. Only correlation metadata changes; no source counter is read or
 * renewed. The caller retains its exact row, reservation and zero-call guards. */
export function prepareSceneJobSourceClaim(env:WorkerEnv,input:{scope:OutputScope;slot:OutputOperationSlot;
  previousCorrelationId:string;correlationId:string;previousRaw:string}){
  const previous=identity(input.scope,input.slot,input.previousCorrelationId),expected=identity(input.scope,input.slot,input.correlationId);
  const witness=parse(input.previousRaw,previous);
  if(witness.phase!=='run'||input.previousCorrelationId!==input.slot.jobId||input.correlationId!==`${input.slot.jobId}:attempt:1`)fail();
  const raw=JSON.stringify({...witness,correlationId:input.correlationId});
  const before=[outputScopeAuthority(input.scope,'request'),custody(previous),...sceneSourceVersionAssertions(witness.successor),
    {sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND status='queued' AND attempt_count=0 AND scene_source_version_json=?)",bindings:[expected.jobId,expected.ownerId,input.previousRaw]},
    {sql:"EXISTS(SELECT 1 FROM output_operation_slots slot JOIN output_execution_grants grant_row ON grant_row.scope_key=slot.scope_key AND grant_row.grant_id=slot.grant_id WHERE slot.scope_key=? AND slot.slot_id=? AND slot.status='queued' AND grant_row.status='active')",bindings:[expected.scopeKey,expected.slotId]}];
  const guard=custody(expected),after=[env.DB.prepare(`UPDATE document_jobs SET scene_source_version_json=? WHERE job_id=? AND owner_id=?
    AND scene_source_version_json=? AND status='running' AND attempt_count=1 AND (${guard.sql})
    AND NOT EXISTS(SELECT 1 FROM output_provider_calls WHERE scope_key=? AND slot_id=?)`)
    .bind(raw,expected.jobId,expected.ownerId,input.previousRaw,...guard.bindings??[],expected.scopeKey,expected.slotId),
    ...outputAssertionStatements(env,{sql:'changes()=1'}),
    env.DB.prepare('SELECT scene_source_version_json AS receipt FROM document_jobs WHERE job_id=? AND owner_id=?').bind(expected.jobId,expected.ownerId)];
  let consumed=false;
  return{before,after,raw,acknowledge(results:unknown){
    if(consumed)fail();consumed=true;
    if(!Array.isArray(results)||results.length!==after.length||Array.from({length:after.length},(_,i)=>i).some(i=>results[i]?.success!==true)
      ||!Array.isArray(results.at(-1)?.results)||results.at(-1)!.results.length!==1||results.at(-1)!.results[0]?.receipt!==raw)fail();
    return{raw,witness:parse(raw,expected)};
  }};
}
