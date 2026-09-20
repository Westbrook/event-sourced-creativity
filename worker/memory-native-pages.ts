import { DOCUMENT_VIEWS } from '../src/model/document-view-signals.ts';
import type { DocumentView } from '../src/model/routes.ts';
import type { WorkerEnv } from './runtime.ts';
import type { LiveMemoryEnrollment } from './memory-live-authority.ts';
import type { NativeMemoryContextObserver } from './memory-live-context.ts';
import type { NativeDerivationObservation } from './memory-derivation-sources.ts';
import { nativeMemoryDocumentIdentity } from './memory-native-scope.ts';
import { memoryCanonical } from './memory-sql.ts';
import { derivationExact } from './memory-derivation-policy.ts';
import { derivationResults } from './memory-derivation-store.ts';

export type NativeMemoryPageBindings={version:1;entries:{eventId:string;view:DocumentView;scopeKey:string}[];unresolved:number};
/** Native page identity is a view within a document, never the URL, title,
 * query string, draft, dwell time, or an inference about comprehension. */
export function nativeMemoryPageIdentity(enrollment:Parameters<typeof nativeMemoryDocumentIdentity>[0],view:unknown){
 const parent=nativeMemoryDocumentIdentity(enrollment);
 if(!parent||typeof view!=='string'||!DOCUMENT_VIEWS.includes(view as DocumentView))return null;
 const resource=JSON.stringify(['memory-resource-v1',parent.ownerUserId,parent.organizationId,parent.projectAccessId,'page',parent.projectId,parent.documentId,view]);
 return {view:view as DocumentView,scopeKey:memoryCanonical([parent.partitionKey,resource])};
}
/** The enclosing capture already certifies every original event and custody.
 * This additional witness differentiates canonical view visits without treating
 * an arbitrary payload's page label as a new independently authorized resource. */
export async function observeNativeMemoryPageBindings(env:WorkerEnv,enrollment:LiveMemoryEnrollment,observations:readonly NativeDerivationObservation[],observer:NativeMemoryContextObserver):Promise<NativeMemoryPageBindings>{
 const selected=observations.filter(row=>row.eventType==='DocumentViewVisited'),result:NativeMemoryPageBindings={version:1,entries:[],unresolved:selected.length};
 if(!selected.length)return result;
 if(selected.length>128||new Set(selected.map(row=>row.eventId)).size!==selected.length)throw Error('memory-page-capacity');
 const db=env.DB,query={sql:`SELECT event.event_id,event.sequence,CASE WHEN json_extract(event.payload,'$._private_ref') IS NULL THEN event.payload ELSE secret.private_json END AS payload FROM events event LEFT JOIN event_private_payloads secret ON secret.private_event_id=event.event_id JOIN json_each(?) chosen ON event.event_id=json_extract(chosen.value,'$.eventId')
  AND event.sequence=json_extract(chosen.value,'$.sequence') WHERE event.stream_id=? AND event.type='DocumentViewVisited' AND (event.actor=? OR ?=1 AND event.actor='user')
  AND event.schema_version=1 AND event.compensates_event_id IS NULL AND length(CAST(event.payload AS BLOB))<=16384
  AND (json_extract(event.payload,'$._private_ref') IS NULL OR json_extract(event.payload,'$._private_ref')=event.event_id AND secret.owner_id=?
    AND secret.project_id=? AND secret.document_id=? AND secret.redacted_at IS NULL AND secret.created_at=event.recorded_at AND length(CAST(secret.private_json AS BLOB))<=16384) ORDER BY event.sequence,event.event_id LIMIT 129`,
  bindings:[JSON.stringify(selected.map(row=>({eventId:row.eventId,sequence:row.sequence}))),'creative:'+enrollment.owner_user_id,'user:'+enrollment.actor_user_id,enrollment.organization_id===null?1:0,enrollment.owner_user_id,enrollment.project_id,enrollment.document_id]};
 const statement=db.prepare(query.sql).bind(...query.bindings),read=structuredClone(await statement.all<Record<string,unknown>>());
 if(env.DB!==db||!derivationResults([read],1)||read.results.length>selected.length||new TextEncoder().encode(JSON.stringify(read.results)).byteLength>192*1024)throw Error('memory-page-unavailable');
 observer.observe([statement],[read],[query]);
 for(const row of read.results){
  if(!derivationExact(row,['event_id','sequence','payload'])||typeof row.payload!=='string')throw Error('memory-page-row');
  try{
   const p=JSON.parse(row.payload);
   if(!derivationExact(p,['document_id','project_id','view','focused','route_family','source_surface'])||p.project_id!==enrollment.project_id||p.document_id!==enrollment.document_id
    ||typeof p.focused!=='boolean'||p.route_family!=='document'||p.source_surface!=='document-view-navigation')continue;
   const page=nativeMemoryPageIdentity(enrollment,p.view);if(!page)continue;
   result.entries.push({eventId:String(row.event_id),...page});
  }catch{/* Preserve the already-certified document action, never invent a page. */}
 }
 result.unresolved-=result.entries.length;return result;
}
