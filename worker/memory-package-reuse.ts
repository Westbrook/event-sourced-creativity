import type { WorkerEnv } from './runtime.ts';
import type { PilotUser } from './pilot-policy.ts';
import { liveMemoryAuthorityFromPrincipal,liveMemoryEnrollmentGuard,type LiveMemoryEnrollment } from './memory-live-authority.ts';
import type { NativeMemoryBlockBinding } from './memory-native-blocks.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import { derivationAssertion,derivationResults,derivationVerified } from './memory-derivation-store.ts';
import { memoryCanonical,type MemorySqlGuard } from './memory-sql.ts';
import { memoryDigest } from '../src/model/scoped-memory.ts';
import { observeNativePackageRights } from './memory-package-reference.ts';
import { creativeContextRightsIssue } from '../src/model/context-health.ts';

export type NativeReuseSourceEdge={targetBlockId:string;sourceBlockId:string;ownerUserId:string;projectId?:string;documentId?:string;expiresAt?:string};
const markers=['organization_context_package_id','organization_context_package_version_id','organization_context_package_binding_id','organization_context_source_block_id','organization_context_source_owner_id','organization_context_source_project_id','organization_context_source_document_id'];
const columns=['target_block_id','source_block_id','binding_id','package_id','version_id','content_sha256','authored_by','current_version_id','source_project_access_id','source_document_id','source_owner','source_project'];

/** A published package is authored shared knowledge, not personal preference.
 * Its native adoption can locate a separately enrolled original, but never
 * confers access or enrollment. Old packages without immutable owner identity
 * remain usable authored work and do not guess an owner for private recall.
 * Callers replay every observation and guard before exposing the discovery. */
export async function observeNativePackageReuse(env:WorkerEnv,actor:PilotUser,target:LiveMemoryEnrollment,
  blocks:readonly NativeMemoryBlockBinding[],sources:readonly LiveMemoryEnrollment[],observer:NativeMemoryContextObserver,
  guards:MemorySqlGuard[]):Promise<NativeReuseSourceEdge[]>{
  if(!target.organization_id||!blocks.length)return [];
  const db=env.DB,ids=[...new Set(blocks.map(block=>block.blockId))],events=[...new Set(blocks.flatMap(block=>block.eventIds))];
  if(ids.length>32||events.length>1024)throw Error('package_reuse_capacity');
  // Metadata only. Full published bytes wait for the original's independent
  // current access and recall grant. The source list is already range-qualified.
  const query={sql:`SELECT member.target_block_id,member.source_block_id,binding.binding_id,binding.package_id,version.version_id,
    original.content_sha256,created.actor AS authored_by,binding.version_id AS current_version_id,version.source_project_access_id,version.source_document_id,
    json_extract(content.content_json,'$.sourceIdentity.ownerUserId') AS source_owner,
    json_extract(content.content_json,'$.sourceIdentity.projectId') AS source_project
    FROM project_context_package_members member JOIN project_context_package_bindings binding
      ON binding.binding_id=member.binding_id AND binding.organization_id=member.organization_id
    JOIN events created ON created.stream_id=? AND created.type='BlockCreated'
      AND created.event_id IN(SELECT value FROM json_each(?)) AND json_extract(created.payload,'$.block_id')=member.target_block_id
    JOIN event_private_payloads adopted ON adopted.private_event_id=created.event_id AND adopted.owner_id=?
      AND adopted.project_id=? AND adopted.document_id=? AND adopted.redacted_at IS NULL
      AND json_extract(adopted.private_json,'$.properties.organization_context_package_binding_id')=binding.binding_id
    JOIN organization_context_package_versions version ON version.version_id=json_extract(adopted.private_json,'$.properties.organization_context_package_version_id')
      AND version.package_id=binding.package_id AND version.organization_id=binding.organization_id
    JOIN organization_context_package_sources original ON original.version_id=version.version_id AND original.organization_id=version.organization_id
      AND original.source_block_id=member.source_block_id AND original.source_project_access_id=version.source_project_access_id
    JOIN organization_context_packages package ON package.package_id=version.package_id AND package.organization_id=version.organization_id
    JOIN organization_context_package_contents content ON content.version_id=version.version_id AND content.organization_id=version.organization_id
    WHERE binding.organization_id=? AND binding.project_access_id=? AND binding.project_id=? AND binding.document_id=?
      AND binding.status='active' AND version.status='published' AND version.redacted_at IS NULL
      AND package.status='active' AND content.redacted_at IS NULL
      AND json_extract(content.content_json,'$.sourceIdentity.version')=1
      AND member.target_block_id IN(SELECT value FROM json_each(?)) ORDER BY member.target_block_id,binding.binding_id LIMIT 33`,
    bindings:['creative:'+target.owner_user_id,JSON.stringify(events),target.owner_user_id,target.project_id,target.document_id,target.organization_id,target.project_access_id,target.project_id,target.document_id,JSON.stringify(ids)]};
  const statement=db.prepare(query.sql).bind(...query.bindings),rows=structuredClone(await statement.all<Record<string,unknown>>());
  if(env.DB!==db||!derivationResults([rows],1)||rows.results.length>32||rows.results.some(row=>Object.keys(row).sort().join(',')!==[...columns].sort().join(',')
    ||columns.some(key=>typeof row[key]!=='string'||!row[key]||String(row[key]).length>240)))throw Error('package_reuse_metadata');
  observer.observe([statement],[rows],[query]);
  if(new Set(rows.results.map(row=>row.target_block_id)).size!==rows.results.length)throw Error('package_reuse_ambiguous');
  const edges:NativeReuseSourceEdge[]=[];let bytes=0;
  for(const row of rows.results){
    const candidates=sources.filter(source=>source.organization_id===target.organization_id&&source.project_access_id===row.source_project_access_id
      &&source.project_id===row.source_project&&source.owner_user_id===row.source_owner&&source.document_id===row.source_document_id);
    if(candidates.length!==1)continue;
    const source=candidates[0]!,authority=liveMemoryAuthorityFromPrincipal(env,source,actor);if(!authority)continue;
    const targetAuthority=liveMemoryAuthorityFromPrincipal(env,target,actor);if(!targetAuthority)throw Error('package_reuse_target_access');
    const access=[authority.guard,liveMemoryEnrollmentGuard(source,'recall'),targetAuthority.guard,liveMemoryEnrollmentGuard(target,'recall')];
    guards.push(...access);
    const history=blocks.filter(block=>block.blockId===row.target_block_id),eventIds=[...new Set(history.flatMap(block=>block.eventIds))];
    const body={sql:`SELECT version.content_sha256 AS package_sha256,content.content_json,event.event_id,event.actor,secret.private_json
      FROM organization_context_package_versions version JOIN organization_context_package_contents content
        ON content.version_id=version.version_id AND content.organization_id=version.organization_id
      JOIN events event ON event.stream_id=? AND event.type='BlockCreated' AND event.event_id IN(SELECT value FROM json_each(?))
      JOIN event_private_payloads secret ON secret.private_event_id=event.event_id AND secret.owner_id=? AND secret.project_id=? AND secret.document_id=? AND secret.redacted_at IS NULL
      WHERE version.version_id=? AND version.organization_id=? AND version.status='published' AND version.redacted_at IS NULL AND content.redacted_at IS NULL
        AND length(CAST(content.content_json AS BLOB))<=250000 AND length(CAST(secret.private_json AS BLOB))<=65536
        AND length(CAST(content.content_json AS BLOB))+length(CAST(secret.private_json AS BLOB))<=?
        AND json_extract(event.payload,'$.block_id')=? ORDER BY event.sequence LIMIT 2`,
      bindings:['creative:'+target.owner_user_id,JSON.stringify(eventIds),target.owner_user_id,target.project_id,target.document_id,String(row.version_id),target.organization_id,786432-bytes,String(row.target_block_id)]};
    const read=db.prepare(body.sql).bind(...body.bindings),proven=structuredClone(await db.batch<Record<string,unknown>>([...access.map(guard=>derivationAssertion(env,guard)),read]));
    if(env.DB!==db||!derivationResults(proven,access.length+1)||!proven.slice(0,access.length).every(derivationVerified))throw Error('package_reuse_source_access');
    const result=proven[access.length]!;
    if(result.results.length!==1||Object.keys(result.results[0]!).sort().join(',')!=='actor,content_json,event_id,package_sha256,private_json'
      ||!eventIds.includes(String(result.results[0]!.event_id)))throw Error('package_reuse_history');
    observer.observe([read],[result],[body]);const retained=result.results[0]!;
    if(typeof retained.content_json!=='string'||typeof retained.private_json!=='string'||retained.actor!==row.authored_by||!String(row.authored_by).startsWith('user:')
      ||await memoryDigest(retained.content_json)!==retained.package_sha256)throw Error('package_reuse_content');
    bytes+=new TextEncoder().encode(retained.content_json+retained.private_json).byteLength;if(bytes>786432)throw Error('package_reuse_capacity');
    const snapshot=JSON.parse(retained.content_json),created=JSON.parse(retained.private_json),identity=snapshot.sourceIdentity;
    if(snapshot.schema!==1||snapshot.organizationId!==target.organization_id||snapshot.sourceProjectAccessId!==source.project_access_id
      ||snapshot.sourceDocumentId!==source.document_id||identity?.version!==1||identity.ownerUserId!==source.owner_user_id
      ||identity.projectId!==source.project_id||identity.streamId!=='creative:'+source.owner_user_id||!Array.isArray(snapshot.blocks)||snapshot.blocks.length>128)throw Error('package_reuse_identity');
    const matches=snapshot.blocks.filter((block:{sourceBlockId?:unknown})=>block.sourceBlockId===row.source_block_id),block=matches[0];
    if(matches.length!==1||!block||block.contentSha256!==row.content_sha256
      ||creativeContextRightsIssue(block.properties,Date.now())||block.rightsExpiresAt&&(typeof block.rightsExpiresAt!=='string'||!Number.isFinite(Date.parse(block.rightsExpiresAt))||Date.parse(block.rightsExpiresAt)<=Date.now()))throw Error('package_reuse_block');
    const props={...created.properties};
    if(markers.some((key,index)=>props[key]!==[row.package_id,row.version_id,row.binding_id,row.source_block_id,source.owner_user_id,source.project_id,source.document_id][index]))throw Error('package_reuse_mapping');
    for(const key of markers)delete props[key];
    const referenceDeadline=await observeNativePackageRights(env,source,target,String(row.source_block_id),String(row.target_block_id),String(retained.event_id),block,created.properties,observer,access);
    if(block.source||block.type==='reference'){
      delete props.media_url;delete props.reference_id;
    }
    if(created.project_id!==target.project_id||created.document_id!==target.document_id||created.block_id!==row.target_block_id||created.scope!=='document'
      ||created.type!==block.type||created.handle!==block.handle||created.position!==block.position||memoryCanonical(props)!==memoryCanonical(block.properties))throw Error('package_reuse_adoption');
    if(block.rightsExpiresAt)observer.before(block.rightsExpiresAt);observer.before(source.expires_at);
    edges.push({targetBlockId:String(row.target_block_id),sourceBlockId:String(row.source_block_id),ownerUserId:source.owner_user_id,projectId:source.project_id,documentId:source.document_id,expiresAt:[source.expires_at,...(block.rightsExpiresAt?[block.rightsExpiresAt]:[]),...(referenceDeadline?[referenceDeadline]:[])].sort()[0]});
  }
  return edges;
}
