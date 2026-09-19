import { memoryDigest } from '../src/model/scoped-memory.ts';
import { canonicalConsent, consentHash, executionContentCustodyGuard } from './consequential-consent.ts';
import { memoryCanonical } from './memory-sql.ts';
import { decodeNativeMemoryResourceEvent, type NativeMemoryBlockBindings } from './memory-native-blocks.ts';
import { derivationId, derivationTime } from './memory-derivation-policy.ts';
import type { LiveMemoryEnrollment } from './memory-live-authority.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import type { WorkerEnv } from './runtime.ts';
import type { RetainedAuthoringPreview } from './authoring-commits.ts';

type Observation={eventId:string;sequence:number;eventType:string;blockPointer:string|null};
type Row=Record<string,unknown>;
export type NativeMemoryReuseBindings={version:1;entries:{eventId:string;targetBlockId:string;targetScopeKey:string;sourceBlockId:string;
  sourceScope:'unresolved';previewRef:string;outcomeKey:string;receiptSha256:string;previewSha256:string;eventIds:string[];expiresAt:string}[];unresolved:number};
const columns=['event_id','stream_id','sequence','occurred_at','recorded_at','actor','client_id','correlation_id','causation_id','compensates_event_id','schema_version','type','payload'];

/** Certifies a committed copy INTO the enrolled document, not permission to read
 * the original source. A copied_from pointer alone is never evidence. The native
 * receipt, retained approval and complete committed footprint must still agree.
 * No copied prose becomes new human authorship or leaves this private witness.
 * Callers must replay it with the issued grant and both lifecycle schema proofs. */
export async function observeNativeMemoryReuseBindings(env:WorkerEnv,e:LiveMemoryEnrollment,observations:readonly Observation[],
  blocks:NativeMemoryBlockBindings,observer:NativeMemoryContextObserver):Promise<NativeMemoryReuseBindings>{
  const selected=observations.filter(row=>row.eventType==='BlockCreated'&&row.blockPointer!==null);
  const empty=():NativeMemoryReuseBindings=>({version:1,entries:[],unresolved:selected.length});
  if(!selected.length)return empty();
  const db=env.DB,stream='creative:'+e.owner_user_id,prefix='authoring:'+e.actor_user_id+':';
  const scope=e.organization_id===null?null:{organizationId:e.organization_id,projectAccessId:e.project_access_id!,projectId:e.project_id,ownerUserId:e.owner_user_id,actorUserId:e.actor_user_id};
  const custody=executionContentCustodyGuard({scope,actorUserId:e.actor_user_id},'saved');
  const footprint=`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at,
    (SELECT json_group_array(json_object('organization',s.organization_id,'access',s.project_access_id,'project',s.project_id,'owner',s.owner_user_id,
      'stream',s.source_stream_id,'sequence',s.source_sequence)) FROM project_event_scopes s WHERE s.event_id=event.event_id) AS custody,
    (SELECT COUNT(*) FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.compensates_event_id=event.event_id) AS compensated
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE event.stream_id=? AND event.correlation_id=?||receipt.preview_id ORDER BY event.sequence,event.event_id`;
  const jsonObject=(names:string[])=>`json_object(${names.map(column=>"'"+column+"',"+column).join(',')})`;
  const rowJson=`json_insert(${jsonObject(columns)},${['owner_id','project_id','document_id','private_json','redacted_at','custody','compensated'].map(column=>"'$."+column+"',"+column).join(',')})`;
  // Aggregate byte gates execute in the same native statement as hydration.
  // No arbitrarily large preview/footprint is brought into Worker memory first.
  const query={sql:`WITH candidates AS MATERIALIZED(SELECT DISTINCT substr(event.correlation_id,?) AS preview_id
    FROM events event WHERE event.stream_id=? AND event.event_id IN(SELECT value FROM json_each(?))
      AND event.type='BlockCreated' AND event.actor=? AND event.client_id='web:context-approval'
      AND substr(event.correlation_id,1,?)=? ORDER BY preview_id LIMIT 9),
    eligible AS MATERIALIZED(SELECT receipt.*,saved.expires_at,
      CASE WHEN length(CAST(saved.content AS BLOB))<=65536 THEN saved.content END AS preview_content,
      (SELECT COUNT(*) FROM events event WHERE event.stream_id=? AND event.correlation_id=?||receipt.preview_id) AS event_count,
      (SELECT COALESCE(SUM(length(CAST(event.payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0)
        FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
        WHERE event.stream_id=? AND event.correlation_id=?||receipt.preview_id) AS event_bytes
      FROM candidates JOIN authoring_commits receipt USING(preview_id) JOIN private_content saved ON saved.content_id=receipt.preview_id
      WHERE receipt.actor_user_id=? AND receipt.operation='context-proposal' AND receipt.verified=1
        AND receipt.project_id=? AND receipt.document_id=? AND receipt.canvas_id IS NULL
        AND receipt.organization_id IS ? AND receipt.project_access_id IS ?
        AND saved.owner_id=? AND saved.kind='authoring-preview' AND saved.redacted_at IS NULL
        AND saved.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ${custody.sql}
        ${scope?`AND EXISTS(SELECT 1 FROM private_content_retention_scopes retention LEFT JOIN organization_retention_policies policy ON policy.organization_id=retention.organization_id
          WHERE retention.content_id=saved.content_id AND retention.classification='governed-evidence'
            AND retention.policy_version=COALESCE(policy.version,0) AND retention.assigned_expires_at=saved.expires_at)`:''})
    SELECT receipt.*,(SELECT json_group_array(${rowJson}) FROM (${footprint})) AS footprint
      FROM eligible receipt WHERE (SELECT COUNT(*) FROM candidates)<=8 AND preview_content IS NOT NULL
        AND event_count BETWEEN 1 AND 128 AND event_bytes<=196608
        AND (SELECT SUM(event_bytes+COALESCE(length(CAST(preview_content AS BLOB)),0)) FROM eligible)<=786432
      ORDER BY receipt.preview_id`,bindings:[prefix.length+1,stream,JSON.stringify(selected.map(row=>row.eventId)),'user:'+e.actor_user_id,prefix.length,prefix,
      stream,prefix,stream,prefix,e.actor_user_id,e.project_id,e.document_id,e.organization_id,e.project_access_id,e.actor_user_id,...custody.bindings,stream,prefix]};
  const statement=db.prepare(query.sql).bind(...query.bindings),result=structuredClone(await statement.all<Row>());
  if(env.DB!==db||!result.success||!Array.isArray(result.results)||result.results.length>8)throw Error('memory-reuse-read');
  observer.observe([statement],[result],[query]);
  const entries:NativeMemoryReuseBindings['entries']=[];
  for(const row of result.results){
    try{
      const saved=JSON.parse(String(row.preview_content)) as RetainedAuthoringPreview,plan=saved.plan,b=plan.binding;
      if(saved.state!=='applied'||saved.approvalHash!==row.approval_hash||await consentHash(plan)!==row.approval_hash
        ||plan.operation!=='context-proposal'||b.operation!=='context-proposal'||b.actorUserId!==e.actor_user_id||b.streamId!==stream
        ||b.projectId!==e.project_id||b.documentId!==e.document_id||b.blockId!==row.block_id||b.canvasId!==null
        ||canonicalConsent(b.scope)!==canonicalConsent(scope)||canonicalConsent(plan.result)!==canonicalConsent(JSON.parse(String(row.result_json)))
        ||!derivationTime(row.expires_at)||!derivationTime(row.created_at)||!derivationTime(plan.expiresAt)||String(row.created_at)>plan.expiresAt
        ||!Array.isArray(plan.events)||!plan.events.length||!Array.isArray(plan.changes))continue;
      const rows=JSON.parse(String(row.footprint)) as Row[];
      if(rows.length!==plan.events.length||rows.length!==row.event_count||rows.at(-1)?.event_id!==row.last_event_id)continue;
      const events=rows.map((source,index)=>{
        const input=plan.events[index]!,kind=input.type.startsWith('BlockRelation')?'relation':'block',id=input.payload[kind+'_id'];
        if(!['BlockCreated','BlockPropertyEdited','BlockRelationAdded'].includes(input.type)||!derivationId(id))throw Error('unsupported');
        const event=decodeNativeMemoryResourceEvent(source,e,kind,id);
        if(event.type!==input.type||canonicalConsent(event.payload)!==canonicalConsent(input.payload)||event.actor!=='user:'+e.actor_user_id
          ||event.clientId!=='web:context-approval'||event.correlationId!==prefix+row.preview_id||event.recordedAt>plan.expiresAt
          ||event.sequence!==Number(rows[0]!.sequence)+index||event.sequence<=plan.sourceHead)throw Error('footprint');
        return event;
      });
      const outcomeKey=await memoryDigest(memoryCanonical(['native-approved-reuse-v1',e.actor_user_id,row.preview_id]));
      const receipt={...row};delete receipt.preview_content;delete receipt.footprint;delete receipt.event_count;delete receipt.event_bytes;
      const receiptSha256=await memoryDigest(memoryCanonical(receipt)),previewSha256=await memoryDigest(String(row.preview_content));
      for(const observation of selected){
        const target=blocks.entries.find(block=>block.eventId===observation.eventId&&block.blockId===observation.blockPointer);
        const event=events.find(event=>event.eventId===observation.eventId&&event.sequence===observation.sequence&&event.type==='BlockCreated');
        const properties=event?.payload.properties as Record<string,unknown>|undefined,sourceId=properties?.copied_from_block_id;
        if(!target||!event||!derivationId(sourceId)||sourceId===target.blockId||event.payload.source_surface!=='approved-context-proposal'
          ||plan.changes.filter(change=>change.kind==='copy'&&change.sourceId===sourceId&&change.targetId===target.blockId).length!==1)continue;
        entries.push({eventId:event.eventId,targetBlockId:target.blockId,targetScopeKey:target.scopeKey,sourceBlockId:sourceId,sourceScope:'unresolved',
          previewRef:String(row.preview_id),outcomeKey,receiptSha256,previewSha256,eventIds:events.map(event=>event.eventId),expiresAt:row.expires_at});
      }
    }catch{/* Unknown or changed native approval remains an ordinary document action. */}
  }
  for(const entry of entries)observer.before(entry.expiresAt);
  return {version:1,entries,unresolved:selected.length-entries.length};
}
