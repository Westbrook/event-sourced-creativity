import type { CreativeEvent } from '../src/model/events.ts';

type Row = Record<string, unknown>;
export const HISTORICAL_CENSUS_LIMIT = 40_000;
export const HISTORICAL_CENSUS_CHUNK = 1000;
const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,239}$/u.test(v);
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
const understood = new Set(['ProjectCreated','ProjectOpened','ProjectRenamed','ProjectStateChanged','DocumentCreated','DocumentOpened','DocumentRenamed','DocumentRenderRequested','DocumentRenderCompleted','DocumentRenderFailed','DocumentArtifactEdited','DocumentForked','DocumentRemoved','DocumentRestored','BlockCreated','BlockRenamed','BlockPropertyEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockDocumentAttached','BlockDocumentDetached','BlockRehomed','BlockRemoved','BlockRestored','BlockRelationAdded','BlockRelationRemoved']);
const metadataFailures = {
 event_boundary: ['event_boundary_mismatch'], private_presence: ['private_absent'], private_unredacted: ['private_redacted'],
 private_owner_valid: ['private_owner_missing','private_owner_invalid'], private_owner_matches: ['private_owner_mismatch'],
 private_binding: ['private_binding_failure'], personal_scope: ['nonpersonal_event'],
 private_json_text: ['private_json_unavailable'], private_json_valid: ['private_json_malformed'],
} as const;
const bodyChecks = ['event_type_supported','loaded_custody_matches','envelope_objects','public_private_ref','operational_identities','creation_identity','history_binding'] as const;

/** Only server-resolved prefix identities enter here. CASE short-circuits before
 * inspecting JSON on a redacted, foreign, invalid-owner or nonpersonal sidecar.
 * Returned values are enum scalars in input order, never identity or content. */
export function historicalCensusQuery(rows: Row[], owner: string, stream: string, before: number) {
 if (!rows.length || rows.length > HISTORICAL_CENSUS_CHUNK || rows.some(r => !identifier(r.event_id) || !Number.isSafeInteger(r.sequence) || Number(r.sequence) >= before || r.stream_id !== stream)) throw Error('generation_source_census_selector_invalid');
 return {sql: `WITH selected AS (SELECT CAST(key AS INTEGER) AS ordinal,value AS id FROM json_each(?))
 SELECT json_group_array(state) AS states FROM (SELECT selected.ordinal,CASE
 WHEN event.event_id IS NULL THEN 'event_boundary_mismatch'
 WHEN secret.private_event_id IS NULL THEN 'private_absent'
 WHEN secret.redacted_at IS NOT NULL THEN 'private_redacted'
 WHEN secret.owner_id IS NULL OR secret.owner_id='' THEN 'private_owner_missing'
 WHEN typeof(secret.owner_id)!='text' OR length(secret.owner_id)>240 OR substr(secret.owner_id,1,1) NOT GLOB '[A-Za-z0-9]' OR secret.owner_id GLOB '*[^A-Za-z0-9._:-]*' THEN 'private_owner_invalid'
 WHEN secret.owner_id!=? THEN 'private_owner_mismatch'
 WHEN secret.private_event_id!=event.event_id THEN 'private_binding_failure'
 WHEN EXISTS(SELECT 1 FROM project_event_scopes scoped WHERE scoped.event_id=event.event_id) THEN 'nonpersonal_event'
 WHEN typeof(secret.private_json)!='text' THEN 'private_json_unavailable'
 WHEN NOT json_valid(secret.private_json) THEN 'private_json_malformed'
 ELSE 'custody_ok' END AS state
 FROM selected LEFT JOIN events event ON event.event_id=selected.id AND event.stream_id=? AND event.sequence<?
 LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id ORDER BY selected.ordinal)`,bindings:[JSON.stringify(rows.map(r=>r.event_id)),owner,stream,before]};
}

/** Diagnostic only. Never used to grant a candidate or rescue a refused proof. */
export function summarizeHistoricalCensus(rows: Row[], events: CreativeEvent[], states: string[], owner: string, before: number) {
 const prefix=rows.filter(r=>Number(r.sequence)<before && /^(Project|Document|Block)/u.test(String(r.type)));
 const examined=Math.min(prefix.length,HISTORICAL_CENSUS_LIMIT);
 if(states.length!==examined)throw Error('generation_source_census_observation_incomplete');
 const checks=Object.fromEntries([...Object.keys(metadataFailures),...bodyChecks].map(k=>[k,{evaluated:0,failed:0,notEvaluated:prefix.length}]));
 const failures: Record<string,number>={};let passed=0;
 const byId=new Map(events.map(e=>[e.eventId,e]));
 const check=(key:string,good:boolean)=>{checks[key]!.evaluated++;checks[key]!.notEvaluated--;if(!good)checks[key]!.failed++;return good;};
 const reject=(code:string)=>{failures[code]=(failures[code]??0)+1;};
 for(let i=0;i<examined;i++){
  const row=prefix[i]!,state=states[i]!;let failed=false;
  if(state!=='custody_ok'&&!Object.values(metadataFailures).some(v=>(v as readonly string[]).includes(state)))throw Error('generation_source_census_observation_invalid');
  for(const [key,codes] of Object.entries(metadataFailures))if(!check(key,!(codes as readonly string[]).includes(state))){reject(state);failed=true;break;}
  if(failed)continue;
  if(!check('event_type_supported',understood.has(String(row.type)))){reject('event_type_unsupported');continue;}
  // No body access before all custody predicates succeed. A mismatch between
  // the safe loaded history and newer metadata is never interpreted as passing.
  if(!check('loaded_custody_matches',row.owner_id===owner&&row.private_event_id===row.event_id&&row.redacted_at==null&&typeof row.private_json==='string')){reject('loaded_custody_mismatch');continue;}
  let body:Record<string,unknown>|null,publicBody:Record<string,unknown>|null;
  try{body=object(JSON.parse(row.private_json as string));publicBody=object(JSON.parse(String(row.payload)));}catch{check('envelope_objects',false);reject('loaded_envelope_malformed');continue;}
  if(!check('envelope_objects',Boolean(body&&publicBody))){reject('envelope_not_objects');continue;}
  if(!check('public_private_ref',publicBody!._private_ref===row.event_id)){reject('public_private_ref_mismatch');continue;}
  if(!check('operational_identities',['block_id','document_id','project_id'].every(k=>Object.hasOwn(body!,k)===Object.hasOwn(publicBody!,k)&&body![k]===publicBody![k]&&(body![k]==null||identifier(body![k]))))){reject('operational_identity_inconsistent');continue;}
  const type=String(row.type);
  if(!check('creation_identity',!((type==='DocumentCreated'||type==='DocumentForked')&&!identifier(body!.document_id)||type==='BlockCreated'&&!identifier(body!.block_id)))){reject('creation_identity_missing');continue;}
  const event=byId.get(String(row.event_id));
  if(!check('history_binding',Boolean(event&&event.type===type&&event.sequence===Number(row.sequence)))){reject('history_binding_mismatch');continue;}
  passed++;
 }
 return {schemaVersion:'forma-historical-census-diagnostic-v1',boundary:'server-resolved-lifecycle-prefix-before-original-request',total:prefix.length,examined,unexamined:prefix.length-examined,complete:examined===prefix.length,truncated:examined!==prefix.length,limit:HISTORICAL_CENSUS_LIMIT,
  firstFailureCounts:failures,identityChecksPassed:passed,checks,qualification:'not-assessed',limitations:['First failures are mutually exclusive; later predicates are not evaluated.','Counts do not establish subject relevance, missing approval or irrecoverability.','Identity checks are not the subject-origin, lifecycle or producer-approval proof.']};
}
