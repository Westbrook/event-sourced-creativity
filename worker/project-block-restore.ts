import { AssistantContextReadWitness } from './assistant-context-source.ts';
import { decodeNativeMemoryBlockHistory } from './memory-native-blocks.ts';
import { derivationId, derivationInteger } from './memory-derivation-policy.ts';
import type { ProjectRequestContext } from './project-request-context.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { WorkerEnv } from './runtime.ts';

type Row=Record<string,unknown>;
type PreparedRestore=Readonly<{assertCurrent():void;precommitStatements():D1PreparedStatement[]}>;
type Restore={type?:string;payload?:Record<string,unknown>;compensatesEventId?:string|null};
const fields="'BlockCreated','BlockRehomed','BlockRenamed','BlockPropertyEdited','ChipEdited','BlockWeightSet','BlockLocked','BlockUnlocked','BlockRemoved','BlockRestored','ExtractionRequested','ExtractionCompleted','ExtractionFailed','ImageFocalPointCalculated'";

/** Restore an indexed-away Document block only by reversing its exact latest
 * retained same-author removal. Historical IDs are not current access grants.
 * Caller must keep its ordinary project/document authorization, original owner
 * head CAS and these exact private/custody snapshots around the atomic write.
 * No scope repair, source recreation, privilege grant or Memory enrollment. */
export async function prepareProjectBlockUndoRestore(env:WorkerEnv,context:ProjectRequestContext,principal:PilotUser,
  input:Restore,sourceHead:number):Promise<PreparedRestore|null>{
 try{
  const p=input.payload??{},blockId=p.block_id,documentId=p.document_id;
  if(input.type!=='BlockRestored'||!derivationId(blockId)||!derivationId(documentId)||!derivationId(input.compensatesEventId)
    ||!derivationInteger(sourceHead,1)||principal.fictional||context.principalUserId!==principal.userId
    ||p.project_id!==context.projectId||p.canvas_id||p.scope!==undefined&&p.scope!=='document')return null;
  const db=env.DB,witness=new AssistantContextReadWitness<null>(env),stream='creative:'+context.ownerUserId;
  const identity=JSON.stringify([context,principal]),started=Date.now(),monotonic=performance.now();
  const assertCurrent=()=>{const wall=Date.now()-started,elapsed=performance.now()-monotonic;
    if(env.DB!==db||JSON.stringify([context,principal])!==identity||!Number.isFinite(wall)||!Number.isFinite(elapsed)
      ||wall<0||elapsed<0||wall>=60_000||elapsed>=60_000)throw Error('block_restore_source_changed');};
  const where=`event.stream_id=? AND event.sequence<=? AND event.type IN(${fields}) AND json_extract(event.payload,'$.block_id')=?`;
  const bindings=[stream,sourceHead,blockId];
  const size={sql:`SELECT COUNT(*) AS count,COALESCE(SUM(length(CAST(event.payload AS BLOB))+length(CAST(COALESCE(secret.private_json,'') AS BLOB))),0) AS bytes
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE ${where}`,bindings};
  const sizeStatement=db.prepare(size.sql).bind(...bindings),measured=structuredClone(await sizeStatement.all<Row>());
  if(env.DB!==db||!measured.success||'error' in measured&&measured.error!==undefined||measured.results.length!==1||!derivationInteger(measured.results[0]!.count,1)
    ||!derivationInteger(measured.results[0]!.bytes)||Number(measured.results[0]!.count)>256||Number(measured.results[0]!.bytes)>196608)return null;
  witness.observe([sizeStatement],[measured],[size]);
  // Capture compensation edges only through the head already guarded by the
  // parent authoring transaction. Its newly appended inverse is not old input.
  const query={sql:`SELECT event.*,secret.owner_id,secret.project_id,secret.document_id,secret.private_json,secret.redacted_at,
    (SELECT json_group_array(json_object('organization',s.organization_id,'access',s.project_access_id,'project',s.project_id,
      'owner',s.owner_user_id,'stream',s.source_stream_id,'sequence',s.source_sequence)) FROM project_event_scopes s WHERE s.event_id=event.event_id) AS custody,
    (SELECT COUNT(*) FROM events compensation WHERE compensation.stream_id=event.stream_id AND compensation.sequence<=?
      AND compensation.compensates_event_id=event.event_id) AS compensated
    FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id
    WHERE ${where} AND (?,?)=(SELECT count,bytes FROM (${size.sql})) ORDER BY event.sequence,event.event_id LIMIT 257`,
    bindings:[sourceHead,...bindings,Number(measured.results[0]!.count),Number(measured.results[0]!.bytes),...bindings]};
  const statement=db.prepare(query.sql).bind(...query.bindings),read=structuredClone(await statement.all<Row>());
  if(env.DB!==db||!read.success||'error' in read&&read.error!==undefined||read.results.length!==measured.results[0]!.count
    ||new TextEncoder().encode(JSON.stringify(read.results)).byteLength>262144)return null;
  witness.observe([statement],[read],[query]);
  const events=decodeNativeMemoryBlockHistory(read.results,{actor_user_id:principal.userId,owner_user_id:context.ownerUserId,
    organization_id:context.organizationId,project_access_id:context.projectAccessId,project_id:context.projectId,document_id:documentId},blockId);
  const created=events[0],removed=events.at(-1);
  if(!created||created.type!=='BlockCreated'||events.filter(event=>event.type==='BlockCreated').length!==1
    ||created.payload.project_id!==context.projectId||created.payload.document_id!==documentId
    ||created.payload.scope!==undefined&&created.payload.scope!=='document'||created.payload.canvas_id||created.payload.library_block===true
    ||events.some(event=>event.type==='BlockRehomed')||!removed||removed.type!=='BlockRemoved'
    ||removed.eventId!==input.compensatesEventId||removed.actor!=='user:'+principal.userId
    ||removed.compensatesEventId!==null&&(created.payload.memory_authored_version!==1
      ||!events.some(event=>event.eventId===removed.compensatesEventId&&['BlockCreated','BlockRestored'].includes(event.type)
        &&event.actor===removed.actor&&event.payload.memory_authored_version===1)))return null;
  assertCurrent();witness.before(new Date(started+60_000).toISOString());witness.seal(null);
  return Object.freeze({assertCurrent,precommitStatements(){assertCurrent();return witness.precommitStatements();}});
 }catch{return null;}
}
