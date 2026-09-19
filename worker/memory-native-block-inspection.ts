import { AUTHORING_EVENT_COLUMNS } from './authoring-event-proof.ts';
import { eventWriteBindings, serializeEvent, type WorkerEnv } from './runtime.ts';
import { observeNativeMemoryBlockBindings } from './memory-native-blocks.ts';
import { AssistantContextReadWitness } from './assistant-context-source.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import type { LiveMemoryAuthority, LiveMemoryEnrollment } from './memory-live-authority.ts';
import { memoryCanonical, type MemorySqlGuard } from './memory-sql.ts';
import { derivationHash, derivationId, derivationInteger, derivationTime } from './memory-derivation-policy.ts';

const clock="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const receiptKeys=['block_id','project_id','document_id','source_event_ids','source_surface','capture_version','block_revision','state_sha256'].sort();
export function nativeBlockInspectionCandidates(e:LiveMemoryEnrollment){
  const personal=e.organization_id===null&&e.project_access_id===null&&e.actor_user_id===e.owner_user_id;
  return {joins:'FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id',
    condition:`event.type='BlockInspected' AND event.stream_id=? AND event.actor=? AND event.schema_version=1
      AND event.compensates_event_id IS NULL AND event.event_id NOT LIKE 'optimistic:%' AND event.client_id NOT LIKE '%optimistic%'
      AND (secret.owner_id,secret.project_id,secret.document_id,secret.redacted_at) IS (?,?,?,NULL)
      AND secret.created_at=event.recorded_at AND json_valid(event.payload) AND json_valid(secret.private_json)
      AND json_extract(event.payload,'$._private_ref')=event.event_id
      AND json_extract(secret.private_json,'$.capture_version')='native-block-inspection-v1'
      AND json_extract(secret.private_json,'$.project_id')=? AND json_extract(secret.private_json,'$.document_id')=?
      AND event.recorded_at>=? AND event.recorded_at<=${clock} AND event.occurred_at=event.recorded_at
      AND strftime('%Y-%m-%dT%H:%M:%fZ',event.recorded_at,'+'||?||' days')>${clock}
      AND NOT EXISTS(SELECT 1 FROM events negative WHERE negative.compensates_event_id=event.event_id)
      AND ${personal?`NOT EXISTS(SELECT 1 FROM project_event_scopes governed WHERE governed.event_id=event.event_id)`:
        `(SELECT COUNT(*) FROM project_event_scopes governed WHERE governed.event_id=event.event_id)=1
        AND EXISTS(SELECT 1 FROM project_event_scopes governed WHERE governed.event_id=event.event_id
          AND(governed.organization_id,governed.project_access_id,governed.project_id,governed.owner_user_id,governed.source_stream_id,governed.source_sequence,governed.actor_user_id)
            =(?,?,?,?,event.stream_id,event.sequence,?))`}`,
    bindings:['creative:'+e.owner_user_id,'user:'+e.actor_user_id,e.owner_user_id,e.project_id,e.document_id,e.project_id,e.document_id,e.enrolled_at,e.retention_days,
      ...(personal?[]:[e.organization_id,e.project_access_id,e.project_id,e.owner_user_id,e.actor_user_id])]};
}

/** Separate from the legacy extractive source set. Only actual native inspector
 * receipts and their exact historical field versions enter this actor's Memory.
 * The caller still owns enrollment/access admission and atomic final replay. */
export async function captureNativeBlockInspections(env:WorkerEnv,e:LiveMemoryEnrollment,a:LiveMemoryAuthority,
  range:{after:number;through:number;remembered:boolean},observer?:NativeMemoryContextObserver){
  const until=new Date(Date.now()+60_000).toISOString(),db=env.DB,key=memoryCanonical({e,a,range}),witness=observer??new AssistantContextReadWitness<null>(env),candidate=nativeBlockInspectionCandidates(e);
  const query={sql:`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json
      ${range.remembered?',remembered.expires_at AS remembered_until':''} ${candidate.joins}
      ${range.remembered?'JOIN memory_live_sources remembered ON remembered.event_id=event.event_id AND remembered.sequence=event.sequence AND remembered.enrollment_id=?':''}
      WHERE ${candidate.condition} AND event.sequence>? AND event.sequence<=? AND length(CAST(secret.private_json AS BLOB))<=65536
      ${range.remembered?'AND remembered.expires_at>'+clock:''} ORDER BY event.sequence LIMIT 33`,
    bindings:[...(range.remembered?[e.enrollment_id]:[]),...candidate.bindings,range.after,range.through]};
  const statement=db.prepare(query.sql).bind(...query.bindings),result=structuredClone(await statement.all<Record<string,unknown>>());
  const current=()=>env.DB===db&&memoryCanonical({e,a,range})===key;
  if(!current()||result.success!==true||'error' in result&&result.error!==undefined||!Array.isArray(result.results)||result.results.length>33)throw Error('block_inspection_unavailable');
  witness.observe([statement],[result],[query]);
  const rows=result.results.slice(0,32),events=rows.map(row=>serializeEvent(row));
  for(const [index,event] of events.entries()){
    const row=rows[index]!,p=event.payload;
    if(event.type!=='BlockInspected'||event.actor!=='user:'+e.actor_user_id||event.streamId!=='creative:'+e.owner_user_id
      ||Object.keys(p).sort().join(',')!==receiptKeys.join(',')||p.capture_version!=='native-block-inspection-v1'||p.source_surface!=='document-context-controls'
      ||p.project_id!==e.project_id||p.document_id!==e.document_id||!derivationId(p.block_id)||!derivationHash(p.state_sha256)
      ||!derivationInteger(p.block_revision,1,event.sequence-1)||!Array.isArray(p.source_event_ids)||!p.source_event_ids.length||p.source_event_ids.length>256
      ||p.source_event_ids.some(id=>!derivationId(id))||new Set(p.source_event_ids).size!==p.source_event_ids.length
      ||JSON.stringify(eventWriteBindings(event))!==JSON.stringify([...AUTHORING_EVENT_COLUMNS.map(name=>row[name]),row.owner_id,row.project_id,row.document_id,row.private_json]))throw Error('block_inspection_receipt_invalid');
  }
  const observed=events.map(event=>({eventId:event.eventId,sequence:event.sequence,eventType:event.type,blockPointer:String(event.payload.block_id),reference:true as const}));
  const bound=await observeNativeMemoryBlockBindings(env,e,observed,witness);
  const sources=events.flatMap((event,index)=>{
    const version=bound.entries.find(row=>row.eventId===event.eventId),payload=event.payload,row=rows[index]!;
    if(!version||version.revision!==payload.block_revision||version.stateSha256!==payload.state_sha256||JSON.stringify(version.eventIds)!==JSON.stringify(payload.source_event_ids))return [];
    const validUntil=[e.expires_at,new Date(Date.parse(event.recordedAt)+e.retention_days*86400000).toISOString(),...(range.remembered?[String(row.remembered_until)]:[])].sort()[0]!;
    if(!derivationTime(validUntil)||validUntil<=new Date().toISOString())return [];
    return [{eventId:event.eventId,sequence:event.sequence,recordedAt:event.recordedAt,validUntil,version}];
  });
  if(!current())throw Error('block_inspection_source_changed');
  const guards:MemorySqlGuard[]=[];
  if(!observer){
    const privateWitness=witness as AssistantContextReadWitness<null>;
    // The complete observed read set is translated by its own witness; callers
    // keep these native assertions in the same atomic source publication.
    privateWitness.before(until);privateWitness.seal(null);
    const proof=privateWitness.precommitStatements();
    return {sources,throughSequence:result.results.length>32?Number(result.results[32]!.sequence)-1:range.through,truncated:result.results.length>32,
      unavailableSourceCount:events.length-sources.length,guards,proof};
  }
  return {sources,throughSequence:result.results.length>32?Number(result.results[32]!.sequence)-1:range.through,truncated:result.results.length>32,
    unavailableSourceCount:events.length-sources.length,guards,proof:[] as D1PreparedStatement[]};
}
