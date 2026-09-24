import { readWorkspaceSourceCensus, type EventReadProof, type WorkerEnv } from './runtime.ts';
import { authoritativeCreativeContext } from './context-authority.ts';
import { publicEventPayload, PRIVATE_AUTHORED_EVENT_TYPES } from './event-privacy.ts';
import { evidenceSha256 } from './generation-evidence.ts';
import { canonicalConsent } from './consequential-consent.ts';
import type { AuthoredSourceStep } from '../src/model/events.ts';
import { memoryDerivationJsonUniqueKeys } from './memory-derivation-result.ts';
import { isMemoryAuthoredEvent } from '../src/model/memory-authorship.ts';

export const SOURCE_AUTHORITY_VERSION='personal-authored-workspace-v2';
export type SourceAuthorityReceipt={version:typeof SOURCE_AUTHORITY_VERSION;ownerId:string;streamId:string;projectId:string;documentId:string;
  documentRevision:string;sourceSha256:string;dependencies:Array<{eventId:string;sequence:number;sha256:string;projectId:string;documentId:string;custodyCreatedAt:string|null;lifetime:'erasable-authored-until-deleted-redacted-or-changed'}>};
const same=(a:unknown,b:unknown)=>canonicalConsent(a)===canonicalConsent(b);
const fail=(message:string):never=>{throw Error(message);};
const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('source_envelope_invalid');

/** Prospective, read-only producer at the canonical reader/resolver boundary.
 * All workspace-profile rows are dependencies, even unrelated manual history.
 * No event-family reconstruction, source-ref subset, or high-water authorization.
 * There is deliberately no stored historical repair or public raw-source reader. */
export async function readSourceAuthority(env:WorkerEnv,user:{userId:string;streamId:string},documentId:string,observeSemantics?:(kind:string,eligible:boolean)=>void,captureCensusProof?:(proof:EventReadProof)=>void) {
  const db=env.DB;
  if(user.streamId!=='creative:'+user.userId||env.FORMA_PILOT_COHORT_ID?.trim())fail('source_principal_unsupported');
  const census=await readWorkspaceSourceCensus(env,user.streamId,user.userId,rows=>{
    let previous=0,totalBytes=0;
    for(const row of rows){
      if(row.stream_id!==user.streamId||row.schema_version!==1||row.compensates_event_id
        ||!Number.isSafeInteger(row.sequence)||Number(row.sequence)<=previous||row.custody_scoped!==0)fail('source_identity_unsupported');
      previous=Number(row.sequence);
      if(typeof row.payload!=='string'||row.payload.length>65536)fail('source_capacity');
      if(!memoryDerivationJsonUniqueKeys(String(row.payload)))fail('source_envelope_invalid');
      const pub=object(JSON.parse(String(row.payload)));
      if(row.custody_id!==null){
        if(row.custody_id!==row.event_id||row.custody_owner!==user.userId||row.custody_redacted!==null
          ||typeof row.private_json!=='string'||row.private_json.length>65536||typeof row.custody_created!=='string'
          ||!Number.isFinite(Date.parse(row.custody_created)))fail('source_custody_unavailable');
        if(!memoryDerivationJsonUniqueKeys(String(row.private_json)))fail('source_envelope_invalid');
        const body=object(JSON.parse(String(row.private_json)));
        if(!same(pub,publicEventPayload(String(row.event_id),body,true).payload)
          ||row.custody_project!==(body.project_id??null)||row.custody_document!==(body.document_id??null))fail('source_envelope_mismatch');
      }else if(Object.hasOwn(pub,'_private_ref')||PRIVATE_AUTHORED_EVENT_TYPES.has(String(row.type)))fail('source_custody_unavailable');
      totalBytes+=JSON.stringify(row).length;if(totalBytes>512000)fail('source_capacity');
    }
  });
  captureCensusProof?.(census.proof);
  const steps:AuthoredSourceStep[]=[];
  const trusted=authoritativeCreativeContext(census.events,{documentId},step=>{observeSemantics?.(String(census.events[steps.length]?.type??''),step.eligible);steps.push(step);});
  if(steps.length!==census.rows.length||steps.some(s=>!s.eligible)||census.events.some(isMemoryAuthoredEvent))fail('source_semantics_unsupported');
  if(!trusted.projection.documents.some(d=>d.id===documentId&&!d.removed)||trusted.projection.documentId!==documentId
    ||!trusted.projection.projects.some(p=>p.id===trusted.projection.projectId&&p.state==='active'))fail('source_document_unavailable');
  if(trusted.snapshot.pins.length)fail('source_pins_unsupported');
  const source=JSON.stringify(trusted.snapshot);if(source.length>=28000)fail('source_snapshot_capacity');
  const projects=[...new Set(steps.map(s=>s.projectId))],resources=[...new Set([...projects,...steps.map(s=>s.documentId),...census.events.flatMap(e=>[e.eventId,String(e.payload.block_id??''),String(e.payload.generation_id??''),String(e.payload.object_id??''),...(Array.isArray(e.payload.object_ids)?e.payload.object_ids.map(String):[])])].filter(Boolean))];
  // Complete census includes scope/exclusion dependencies for every folded source,
  // not only the currently visible document. No organization/pilot custody admitted.
  const scope=db.prepare(`SELECT 1 AS allowed WHERE
    NOT EXISTS(SELECT 1 FROM organization_projects WHERE owner_user_id=? AND project_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM project_resource_scopes WHERE resource_id IN(SELECT value FROM json_each(?)))
    AND NOT EXISTS(SELECT 1 FROM pilot_participants p JOIN pilot_cohorts c ON c.cohort_id=p.cohort_id WHERE p.user_id=? AND p.status='active' AND p.revoked_at IS NULL AND c.status IN('active','paused','closed'))`)
    .bind(user.userId,JSON.stringify(projects),JSON.stringify(resources),user.userId);
  const scopeRows=await scope.all();if(!scopeRows.success||scopeRows.results.length!==1)fail('source_scope_unsupported');
  const dependencies:SourceAuthorityReceipt['dependencies']=[];
  for(let i=0;i<census.rows.length;i++){
    const row=census.rows[i]!,step=steps[i]!;
    dependencies.push({eventId:String(row.event_id),sequence:Number(row.sequence),sha256:await evidenceSha256(canonicalConsent(row)),
      projectId:step.projectId,documentId:step.documentId,custodyCreatedAt:row.custody_created as string|null,lifetime:'erasable-authored-until-deleted-redacted-or-changed'});
  }
  const receipt:SourceAuthorityReceipt={version:SOURCE_AUTHORITY_VERSION,ownerId:user.userId,streamId:user.streamId,
    projectId:trusted.projection.projectId,documentId,documentRevision:trusted.documentRevision,sourceSha256:await evidenceSha256(source),dependencies};
  const proof:EventReadProof={statements:[...census.proof.statements,scope],verify(results){
    census.proof.verify(results.slice(0,-1));const last=results.at(-1);if(!last?.success||!same(last.results,scopeRows.results))fail('source_scope_changed');
    if(env.DB!==db)fail('source_database_changed');}};
  proof.verify(await db.batch([...proof.statements]));
  return {receipt,snapshot:trusted.snapshot,proof};
}

export async function requalifySourceAuthority(env:WorkerEnv,receipt:SourceAuthorityReceipt) {
  if(receipt.version!==SOURCE_AUTHORITY_VERSION)fail('source_witness_missing');
  const current=await readSourceAuthority(env,{userId:receipt.ownerId,streamId:receipt.streamId},receipt.documentId);
  if(!same(current.receipt,receipt))fail('source_authority_changed');return current;
}
