import type { WorkerEnv } from './runtime.ts';
import type { PilotUser } from './pilot-policy.ts';
import type { LiveMemoryEnrollment } from './memory-live-authority.ts';
import { liveMemoryAuthorityFromPrincipal,liveMemoryEnrollmentGuard } from './memory-live-authority.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { prepareNativeDerivationResult,nativeDerivationResultBinding,nativeDerivationResultGuards,nativeDerivationResultInputs,nativeDerivationResultReuseEvidence } from './memory-derivation-results.ts';
import { AssistantContextReadWitness } from './assistant-context-source.ts';
import { observeNativeMemoryBlockBindings } from './memory-native-blocks.ts';
import type { MemorySqlGuard } from './memory-sql.ts';

/** Explicit discovery filter, not a new recall boundary or ranking bonus.
 * A certified copy can locate an independently enrolled original inside the
 * already consented range. Saving that original uses the ordinary source-only
 * context consent: the discovery link is not durable inference ancestry. */
export async function prepareNativeReuseRecall(env:WorkerEnv,actor:PilotUser,target:LiveMemoryEnrollment,sources:readonly LiveMemoryEnrollment[]){
  const db=env.DB,witness=new AssistantContextReadWitness<{enrollments:string[]}>(env);
  const guards:MemorySqlGuard[]=[],enrollments=new Set<string>();
  let validUntil=target.expires_at;
  const copiesFor=async(enrollment:LiveMemoryEnrollment)=>{
    const query={sql:`SELECT j.job_id FROM memory_derivation_jobs j JOIN memory_derivation_grants g ON g.consent_id=j.consent_id
      JOIN memory_derivation_results r ON r.job_id=j.job_id WHERE g.enrollment_id=? AND g.enrollment_revision=? AND g.actor_user_id=?
      ORDER BY j.through_sequence DESC,j.job_id LIMIT 1`,bindings:[enrollment.enrollment_id,enrollment.revision,actor.userId]};
    const statement=db.prepare(query.sql).bind(...query.bindings),rows=structuredClone(await statement.all<Record<string,unknown>>());
    if(env.DB!==db||!derivationResults([rows],1)||rows.results.length>1||rows.results.some(row=>Object.keys(row).join(',')!=='job_id'||typeof row.job_id!=='string'||!/^[a-f0-9]{64}$/u.test(row.job_id)))throw Error('reuse_recall_inventory');
    witness.observe([statement],[rows],[query]);
    if(!rows.results.length)return [];
    const handle=await prepareNativeDerivationResult(env,actor.userId,String(rows.results[0]!.job_id));
    if(!handle)throw Error('reuse_recall_evidence_unavailable');
    const bound=nativeDerivationResultBinding(env,handle);
    if(bound.enrollment.enrollment_id!==enrollment.enrollment_id||bound.enrollment.revision!==enrollment.revision)throw Error('reuse_recall_target');
    guards.push(...nativeDerivationResultGuards(env,handle));
    validUntil=[validUntil,nativeDerivationResultInputs(env,handle).candidate.validUntil].sort()[0]!;
    return nativeDerivationResultReuseEvidence(env,handle);
  };
  const copies=await copiesFor(target),allIds=new Set(copies.map(copy=>copy.sourceBlockId));
  let ids=[...allIds];
  if(ids.length>16||sources.length>32)throw Error('reuse_recall_capacity');
  if(ids.length){
    // The authoring receipt certifies only this owner's native copy operation.
    // Equal IDs in another owner's stream must never be guessed as originals.
    const candidates=sources.filter(source=>source.owner_user_id===target.owner_user_id);
    if(candidates.length>8)throw Error('reuse_recall_capacity');
    const inspected=new Set<string>(),copyCache=new Map<string,Awaited<ReturnType<typeof copiesFor>>>();
    let probes=0;
    for(let depth=0;ids.length;depth++){
      if(depth>=4)throw Error('reuse_recall_capacity');
      const next=new Set<string>();
      for(const source of candidates){
        const pending=ids.filter(id=>!inspected.has(JSON.stringify([source.enrollment_id,id])));
        if(!pending.length)continue;if(++probes>24)throw Error('reuse_recall_capacity');
        for(const id of pending)inspected.add(JSON.stringify([source.enrollment_id,id]));
        const authority=liveMemoryAuthorityFromPrincipal(env,source,actor);if(!authority)continue;
        const access=[authority.guard,liveMemoryEnrollmentGuard(source,'recall')];
        const local=new AssistantContextReadWitness<{enrollment:string}>(env);
        const headQuery={sql:'SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?',bindings:['creative:'+source.owner_user_id]};
        const headStatement=db.prepare(headQuery.sql).bind(...headQuery.bindings);
        // Current public placement/custody is checked before any original body is
        // hydrated. An unrelated candidate cannot read another document's block.
        const placements={sql:`SELECT wanted.value AS block_id FROM json_each(?) wanted WHERE
          EXISTS(SELECT 1 FROM events event WHERE event.stream_id=? AND json_extract(event.payload,'$.block_id')=wanted.value
            AND event.sequence=(SELECT MAX(later.sequence) FROM events later WHERE later.stream_id=event.stream_id
              AND json_extract(later.payload,'$.block_id')=wanted.value AND later.type IN('BlockCreated','BlockRehomed','BlockRemoved','BlockRestored'))
            AND event.type IN('BlockCreated','BlockRehomed','BlockRestored') AND json_extract(event.payload,'$.document_id')=?
            AND json_extract(event.payload,'$.project_id')=?)
          AND (? IS NULL AND NOT EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.owner_user_id=? AND r.resource_kind='block' AND r.resource_id=wanted.value)
            OR ? IS NOT NULL AND (SELECT COUNT(*) FROM project_resource_scopes r WHERE r.owner_user_id=? AND r.resource_kind='block' AND r.resource_id=wanted.value)=1
              AND EXISTS(SELECT 1 FROM project_resource_scopes r WHERE r.owner_user_id=? AND r.resource_kind='block' AND r.resource_id=wanted.value
                AND r.organization_id=? AND r.project_access_id=? AND r.project_id=? AND (r.visibility='collaborative_output' OR r.visibility='actor_private' AND r.actor_user_id=?))) ORDER BY wanted.value`,
          bindings:[JSON.stringify(pending),'creative:'+source.owner_user_id,source.document_id,source.project_id,source.organization_id,source.owner_user_id,
            source.organization_id,source.owner_user_id,source.owner_user_id,source.organization_id,source.project_access_id,source.project_id,actor.userId]};
        const placementStatement=db.prepare(placements.sql).bind(...placements.bindings);
        // Only public metadata joins this fresh access check. All original-body
        // hydration still happens after the complete native acknowledgement.
        const checked=structuredClone(await db.batch([...access.map(guard=>derivationAssertion(env,guard)),headStatement,placementStatement]));
        if(env.DB!==db||!derivationResults(checked,4)||!checked.slice(0,2).every(derivationVerified))throw Error('reuse_recall_source_access');
        const head=checked[2]!,placed=checked[3]!;
        if(head.results.length!==1||Object.keys(head.results[0]!).join(',')!=='head'||!Number.isSafeInteger(head.results[0]!.head)||Number(head.results[0]!.head)<1)throw Error('reuse_recall_head');
        local.observe([headStatement],[head],[headQuery]);
        if(env.DB!==db||!derivationResults([placed],1)||placed.results.length>pending.length||new Set(placed.results.map(row=>row.block_id)).size!==placed.results.length||placed.results.some(row=>Object.keys(row).join(',')!=='block_id'||!pending.includes(String(row.block_id))))throw Error('reuse_recall_placement');
        local.observe([placementStatement],[placed],[placements]);
        const blocks=await observeNativeMemoryBlockBindings(env,source,placed.results.map(row=>String(row.block_id)).map(id=>({eventId:'reuse-original-reference',sequence:Number(head.results[0]!.head),blockPointer:id,eventType:'BlockInspected',reference:true})),local,
          ()=>{throw Error('reuse_recall_capacity');});
        local.before(source.expires_at);local.seal({enrollment:source.enrollment_id});
        guards.push(...access,...local.precommitGuards().map(g=>({condition:g.sql,bindings:g.bindings})));
        if(blocks.entries.length){
          enrollments.add(source.enrollment_id);validUntil=[validUntil,source.expires_at].sort()[0]!;
          // Only a separately certified, current intermediate result may extend
          // the path. Bare copied_from pointers and inaccessible intermediates do
          // not confer ancestry or authorize a hidden source read.
          let edges=copyCache.get(source.enrollment_id);
          if(!edges){edges=await copiesFor(source);copyCache.set(source.enrollment_id,edges);}
          for(const edge of edges)if(blocks.entries.some(block=>block.blockId===edge.targetBlockId)&&!allIds.has(edge.sourceBlockId)){
            allIds.add(edge.sourceBlockId);if(allIds.size>16)throw Error('reuse_recall_capacity');next.add(edge.sourceBlockId);
          }
        }
      }
      ids=[...next];
    }
  }
  witness.before(validUntil);witness.seal({enrollments:[...enrollments]});
  guards.push(...witness.precommitGuards().map(g=>({condition:g.sql,bindings:g.bindings})));
  if(env.DB!==db||Date.parse(validUntil)<=Date.now())throw Error('reuse_recall_expired');
  return {enrollments:[...enrollments],guards,validUntil};
}
