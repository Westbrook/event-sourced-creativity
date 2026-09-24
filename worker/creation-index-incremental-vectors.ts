import type {WorkerEnv} from './runtime.ts';
import type {IndexLease} from './creation-index-schema.ts';
import {privateIndexBodyGuard} from './creation-index-private.ts';
import type {Partition} from './creation-search-api.ts';
import {CREATION_REPRESENTATION as R} from './creation-vectors.ts';

/** Called only inside the canonical delta's authority/lease/snapshot-fenced atomic
 * materialization batch. A suspended shard is denied, but has not been retired.
 * Carry it only if EVERY member is still exact and the complete source fits that
 * shard. Multipart/mixed changes take ordinary copy/rebuild with the original
 * erasure deadline. Retired/expired objects can never be reactivated here. */
export function carryIncrementalVectors(env:WorkerEnv,l:IndexLease,p:Partition,version:string){
 const guard=privateIndexBodyGuard(p);
 return [
  env.DB.prepare(`UPDATE creation_index_objects AS o SET generation=?,state='active',erase_due=NULL WHERE o.partition_key=? AND o.state='suspended' AND o.representation=? AND o.expires>unixepoch() AND o.erase_due>unixepoch() AND o.byte_count=(SELECT COUNT(*)*2048 FROM creation_index_members WHERE object_key=o.object_key) AND o.byte_count>0 AND NOT EXISTS(SELECT 1 FROM creation_index_members m LEFT JOIN creation_search_records r ON r.partition_key=o.partition_key AND r.source_id=m.source_id AND r.revision=m.revision LEFT JOIN private_content c ON c.content_id=r.content_id LEFT JOIN creation_index_sources s ON s.partition_key=r.partition_key AND s.source_id=r.source_id AND s.representation=o.representation AND s.revision=m.revision AND s.generation=o.generation WHERE m.object_key=o.object_key AND (r.source_id IS NULL OR r.tombstone<>0 OR r.source_version<>? OR COALESCE((${guard.sql}),0)=0 OR s.source_id IS NULL OR s.expires<=unixepoch() OR s.expected IS NULL OR s.expected<>s.completed OR s.expected<>(SELECT COUNT(*) FROM creation_index_members same WHERE same.object_key=o.object_key AND same.source_id=m.source_id AND same.revision=m.revision)))`).bind(l.generation,l.partition_key,R.id,version,...guard.bindings),
  env.DB.prepare(`UPDATE creation_index_sources AS s SET generation=?,published=1 WHERE s.partition_key=? AND s.representation=? AND s.expires>unixepoch() AND s.expected=s.completed AND s.expected>0 AND EXISTS(SELECT 1 FROM creation_search_records r WHERE r.partition_key=s.partition_key AND r.source_id=s.source_id AND r.revision=s.revision AND r.source_version=? AND r.tombstone=0) AND s.expected=(SELECT COUNT(*) FROM creation_index_members m JOIN creation_index_objects o ON o.object_key=m.object_key WHERE o.partition_key=s.partition_key AND o.generation=? AND o.representation=s.representation AND o.state='active' AND o.expires>unixepoch() AND m.source_id=s.source_id AND m.revision=s.revision)`).bind(l.generation,l.partition_key,R.id,version,l.generation),
  env.DB.prepare("UPDATE creation_index_objects SET state='retired' WHERE partition_key=? AND state='suspended'").bind(l.partition_key),
 ];
}
