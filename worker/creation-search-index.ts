import {CREATION_REPRESENTATION} from './creation-vectors.ts';
import type { CreationIndexCoverage, CreationSearchPartition } from '../src/model/creation-search.ts';
import type { CreationSearchHit, CreationSearchIndex, HydratedCreationCandidate } from './creation-search.ts';
import { decisionHash } from './still-decision-store.ts';

/** Hashes below are exact lexical posting keys, NEVER semantic vectors. */
export const creationLexicalTerms = (text:string) => [...new Set(text.normalize('NFKC').toLocaleLowerCase('und').match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0,4096);
export const searchPartitionKey = (p:Pick<CreationSearchPartition,'custody'|'projectId'>) => JSON.stringify([p.custody,p.projectId]);
/** Scope claims are routing hints, never authority. Invalidate every nonempty text
 * claim when sidecar metadata/private/public payload disagree; absent claims stay
 * broad for legacy implicit scope. OLD and NEW execute separately on update. */
function secretProjectPredicate(side:string){
  const body=`CASE WHEN json_valid(${side}.private_json) THEN ${side}.private_json ELSE '{}' END`;
  const publicBody="CASE WHEN json_valid(events.payload) THEN events.payload ELSE '{}' END";
  const claims=`json_array(${side}.project_id,json_extract(${body},'$.project_id'),json_extract(${publicBody},'$.project_id'))`;
  return `(events.type='BlockRehomed' OR substr(events.type,1,5)='Block' AND COALESCE(json_type(${body},'$.block_id'),json_type(${publicBody},'$.block_id'),'null')<>'text' OR EXISTS(SELECT 1 FROM creation_search_records r WHERE r.partition_key=creation_search_partitions.partition_key AND r.source_id IN(json_extract(${body},'$.block_id'),json_extract(${publicBody},'$.block_id'))) OR NOT EXISTS(SELECT 1 FROM json_each(${claims}) claim WHERE claim.type='text' AND claim.value<>'') OR creation_search_partitions.project_id IN(SELECT claim.value FROM json_each(${claims}) claim WHERE claim.type='text' AND claim.value<>''))`;
}
/** Canonical Block identity can outlive or contradict a Project routing hint.
 * Existing exact source identities must invalidate their former Project as well. */
function indexedBlockProject(side:string){
  return `(substr(${side}.type,1,5)='Block' AND json_type(${side}.payload,'$.block_id') IS NOT 'text' OR EXISTS(SELECT 1 FROM creation_search_records r WHERE r.partition_key=creation_search_partitions.partition_key AND r.source_id=json_extract(${side}.payload,'$.block_id')))`;
}
/** Removal immediately releases derived prose pointers; a fresh replay restores
 * canonical eligibility. Unaffected Idea records remain reusable. */
function withdrawBlockRecords(side:string){
  return `UPDATE creation_search_records SET tombstone=1 WHERE (kind IN('project','document') OR json_type(${side}.payload,'$.block_id') IS NOT 'text' OR source_id=json_extract(${side}.payload,'$.block_id')) AND ${side}.type IN('BlockCreated','BlockRemoved','BlockRehomed') AND partition_key IN(SELECT partition_key FROM creation_search_partitions WHERE 'creative:'||owner_id=${side}.stream_id AND (${indexedBlockProject(side)} OR ${side}.type='BlockRehomed' OR json_extract(${side}.payload,'$.project_id') IS NULL OR project_id=json_extract(${side}.payload,'$.project_id')));`;
}
/** Snapshots retain only currently eligible canonical entities. They are a guarded
 * optimization, never an authority source; history rewrites detach them immediately. */
const snapshotPurge=(predicate:string)=>`DELETE FROM creation_index_snapshots WHERE partition_key IN(SELECT partition_key FROM creation_search_partitions WHERE ${predicate}); DELETE FROM creation_index_snapshot_heads WHERE partition_key IN(SELECT partition_key FROM creation_search_partitions WHERE ${predicate});`;
export const CREATION_SEARCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS creation_index_snapshots(partition_key TEXT NOT NULL,entity_id TEXT NOT NULL,kind TEXT NOT NULL,content_id TEXT NOT NULL,PRIMARY KEY(partition_key,entity_id))`,
  `CREATE INDEX IF NOT EXISTS creation_index_snapshot_content ON creation_index_snapshots(content_id)`,
  `CREATE TABLE IF NOT EXISTS creation_index_snapshot_heads(partition_key TEXT PRIMARY KEY,generation INTEGER NOT NULL,head INTEGER NOT NULL,owner_head INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS creation_search_builds(partition_key TEXT NOT NULL,index_version INTEGER NOT NULL,page_end TEXT NOT NULL,content_id TEXT NOT NULL,PRIMARY KEY(partition_key,index_version,page_end))`,
  `CREATE TABLE IF NOT EXISTS creation_search_build_members(partition_key TEXT NOT NULL,index_version INTEGER NOT NULL,source_id TEXT NOT NULL,content_id TEXT NOT NULL,PRIMARY KEY(partition_key,index_version,source_id))`,
  `CREATE TABLE IF NOT EXISTS creation_search_build_ready(partition_key TEXT PRIMARY KEY,index_version INTEGER NOT NULL,expected INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS creation_search_jobs(partition_key TEXT PRIMARY KEY,actor_user_id TEXT NOT NULL,permission_epoch TEXT NOT NULL,next_run TEXT NOT NULL,lease_until TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT)`,
  `CREATE TABLE IF NOT EXISTS creation_search_partitions(partition_key TEXT PRIMARY KEY,custody TEXT NOT NULL,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,project_access_id TEXT,content_version TEXT NOT NULL DEFAULT '',index_version INTEGER NOT NULL DEFAULT 0,expected INTEGER,backfill_cursor TEXT NOT NULL DEFAULT '',backfill_complete INTEGER NOT NULL DEFAULT 0,invalidated INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS creation_search_partition_owner ON creation_search_partitions(owner_id,project_id)`,
  `CREATE INDEX IF NOT EXISTS creation_search_partition_access ON creation_search_partitions(project_access_id)`,
  `CREATE TABLE IF NOT EXISTS creation_search_records(partition_key TEXT NOT NULL,source_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('project','document','idea')),revision TEXT NOT NULL,content_hash TEXT NOT NULL,content_id TEXT NOT NULL,source_version TEXT NOT NULL,semantic_model TEXT,semantic_revision TEXT,tombstone INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(partition_key,source_id))`,
  `CREATE INDEX IF NOT EXISTS creation_search_source_version ON creation_search_records(partition_key,source_version,tombstone)`,
  `CREATE TABLE IF NOT EXISTS creation_search_terms(partition_key TEXT NOT NULL,term_hash TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(partition_key,term_hash,source_id))`,
  ...(['INSERT','UPDATE','DELETE'] as const).flatMap(op => {
    const sides = op==='INSERT'?['NEW']:op==='DELETE'?['OLD']:['OLD','NEW'];
    return [
      ...['events','secrets','resources','project_events'].map(kind=>`DROP TRIGGER IF EXISTS creation_search_${kind}_${op.toLowerCase()}`),
      ...['events','secrets','resources','project_events'].flatMap(kind=>[
        `DROP TRIGGER IF EXISTS creation_snapshot_${kind}_${op.toLowerCase()}`,
        kind==='events'?`CREATE TRIGGER creation_snapshot_events_${op.toLowerCase()} AFTER ${op} ON events BEGIN ${sides.map(side=>snapshotPurge(`'creative:'||owner_id=${side}.stream_id AND (${op==='INSERT'?`${side}.type IN('BlockCreated','BlockRemoved','BlockRehomed','DocumentRemoved','ProjectStateChanged')`:'1'})`)).join(' ')} END`:
        kind==='secrets'?`CREATE TRIGGER creation_snapshot_secrets_${op.toLowerCase()} AFTER ${op} ON event_private_payloads BEGIN ${sides.map(side=>snapshotPurge(`owner_id=${side}.owner_id AND (${op==='INSERT'?`EXISTS(SELECT 1 FROM events e JOIN creation_index_snapshot_heads h ON h.partition_key=creation_search_partitions.partition_key WHERE e.event_id=${side}.private_event_id AND e.sequence<=h.owner_head)`:'1'})`)).join(' ')} END`:
        kind==='resources'?`CREATE TRIGGER creation_snapshot_resources_${op.toLowerCase()} AFTER ${op} ON project_resource_scopes BEGIN ${sides.map(side=>snapshotPurge(`project_access_id=${side}.project_access_id AND ${side}.resource_kind<>'content'`)).join(' ')} END`:
        `CREATE TRIGGER creation_snapshot_project_events_${op.toLowerCase()} AFTER ${op} ON project_event_scopes BEGIN ${sides.map(side=>snapshotPurge(`project_access_id=${side}.project_access_id AND (${op==='INSERT'?`EXISTS(SELECT 1 FROM events e JOIN creation_index_snapshot_heads h ON h.partition_key=creation_search_partitions.partition_key WHERE e.event_id=${side}.event_id AND (e.sequence<=h.owner_head OR ${side}.project_sequence<=h.head OR e.type<>'BlockPropertyEdited' OR json_extract(e.payload,'$.property_path') IS NOT 'text'))`:'1'})`)).join(' ')} END`,
      ]),
      `CREATE TRIGGER IF NOT EXISTS creation_search_events_${op.toLowerCase()} AFTER ${op} ON events BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id=${s}.stream_id AND (substr(${s}.type,1,5)='Block' OR substr(${s}.type,1,8)='Document' OR substr(${s}.type,1,7)='Project') AND ${s}.type NOT IN('ProjectOpened','DocumentOpened') AND (${indexedBlockProject(s)} OR ${s}.type='BlockRehomed' OR json_extract(${s}.payload,'$.project_id') IS NULL OR project_id=json_extract(${s}.payload,'$.project_id')); ${withdrawBlockRecords(s)}`).join(' ')} END`,
      `CREATE TRIGGER IF NOT EXISTS creation_search_secrets_${op.toLowerCase()} AFTER ${op} ON event_private_payloads BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id IN(SELECT stream_id FROM events WHERE event_id=${s}.private_event_id AND (substr(type,1,5)='Block' OR substr(type,1,8)='Document' OR substr(type,1,7)='Project') AND type NOT IN('ProjectOpened','DocumentOpened') AND ${secretProjectPredicate(s)}) OR project_access_id IN(SELECT project_access_id FROM project_event_scopes WHERE event_id=${s}.private_event_id AND EXISTS(SELECT 1 FROM events WHERE event_id=${s}.private_event_id AND (substr(type,1,5)='Block' OR substr(type,1,8)='Document' OR substr(type,1,7)='Project') AND type NOT IN('ProjectOpened','DocumentOpened')));`).join(' ')} END`,
      `CREATE TRIGGER IF NOT EXISTS creation_search_resources_${op.toLowerCase()} AFTER ${op} ON project_resource_scopes BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=${s}.project_access_id AND ${s}.resource_kind<>'content';`).join(' ')} END`,
      `CREATE TRIGGER IF NOT EXISTS creation_search_project_events_${op.toLowerCase()} AFTER ${op} ON project_event_scopes BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=${s}.project_access_id AND EXISTS(SELECT 1 FROM events WHERE event_id=${s}.event_id AND substr(type,1,9)<>'Attention');`).join(' ')} END`,
    ];
  }),
] as const;
const initialized = new WeakSet<object>();
export async function ensureCreationSearchSchema(db:D1Database) { if(initialized.has(db))return; await db.batch(CREATION_SEARCH_SCHEMA.map(sql=>db.prepare(sql))); initialized.add(db); }
export class D1CreationSearchIndex implements CreationSearchIndex {
  constructor(readonly db:D1Database,readonly semanticModel?:string) {}
  async lexical(p:CreationSearchPartition,query:string,limit:number,signal:AbortSignal):Promise<CreationSearchHit[]> {
    signal.throwIfAborted();
    const terms = await Promise.all(creationLexicalTerms(query).slice(0,64).map(t=>decisionHash(t)));
    if(!terms.length)return [];
    const rows=await this.db.prepare(`SELECT r.source_id,r.kind,r.revision,r.content_hash,COUNT(*) AS matches FROM creation_search_terms t JOIN creation_search_records r ON r.partition_key=t.partition_key AND r.source_id=t.source_id JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE t.partition_key=? AND t.term_hash IN(SELECT value FROM json_each(?)) AND r.tombstone=0 AND p.invalidated=0 AND r.source_version=p.content_version AND EXISTS(SELECT 1 FROM private_content c WHERE c.content_id=r.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) GROUP BY r.source_id ORDER BY matches DESC,r.source_id LIMIT ?`).bind(searchPartitionKey(p),JSON.stringify(terms),Math.min(20,limit)).all<{source_id:string;kind:CreationSearchHit['kind'];revision:string;content_hash:string;matches:number}>();
    signal.throwIfAborted();
    return rows.results.map((r,rank)=>({id:r.source_id,projectId:p.projectId,custody:p.custody,kind:r.kind,revision:r.revision,contentHash:r.content_hash,rank,relevance:r.matches/terms.length}));
  }
  async current(p:CreationSearchPartition,hits:CreationSearchHit[],signal:AbortSignal) {
    signal.throwIfAborted();if(!hits.length)return [];
    const rows=await this.db.prepare(`SELECT r.source_id,r.revision,r.content_hash FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE r.partition_key=? AND r.source_id IN(SELECT value FROM json_each(?)) AND r.tombstone=0 AND p.invalidated=0 AND r.source_version=p.content_version AND EXISTS(SELECT 1 FROM private_content c WHERE c.content_id=r.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND p.content_version=? AND CAST(p.index_version AS TEXT)=?`).bind(searchPartitionKey(p),JSON.stringify(hits.map(h=>h.id)),p.contentVersion,p.indexVersion).all<{source_id:string;revision:string;content_hash:string}>();
    return hits.filter(h=>rows.results.some(r=>r.source_id===h.id&&r.revision===h.revision&&r.content_hash===h.contentHash));
  }
  async coverage(p:CreationSearchPartition):Promise<CreationIndexCoverage> {
    const row=await this.db.prepare(`SELECT p.expected,p.backfill_complete,p.invalidated,COUNT(CASE WHEN r.tombstone=0 AND r.source_version=p.content_version AND EXISTS(SELECT 1 FROM private_content c WHERE c.content_id=r.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) THEN 1 END) AS lexical,COUNT(CASE WHEN r.tombstone=0 AND r.source_version=p.content_version AND EXISTS(SELECT 1 FROM private_content c WHERE c.content_id=r.content_id AND c.redacted_at IS NULL AND c.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AND r.semantic_revision=r.revision AND (? IS NULL OR r.semantic_model=?) ${this.semanticModel===CREATION_REPRESENTATION.id?`AND EXISTS(SELECT 1 FROM creation_index_sources s WHERE s.partition_key=r.partition_key AND s.source_id=r.source_id AND s.revision=r.revision AND s.generation=p.index_version AND s.representation=r.semantic_model AND s.published=1 AND s.completed=s.expected AND s.expected>0 AND s.expires>unixepoch() AND s.expected=(SELECT COUNT(*) FROM creation_index_members m JOIN creation_index_objects o ON o.object_key=m.object_key AND o.state='active' AND o.expires>unixepoch() WHERE m.source_id=s.source_id AND m.revision=s.revision AND o.partition_key=s.partition_key AND o.generation=s.generation AND o.representation=s.representation))`:''} THEN 1 END) AS semantic FROM creation_search_partitions p LEFT JOIN creation_search_records r ON r.partition_key=p.partition_key WHERE p.partition_key=? GROUP BY p.partition_key`).bind(this.semanticModel??null,this.semanticModel??null,searchPartitionKey(p)).first<{expected:number|null;backfill_complete:number;invalidated:number;lexical:number;semantic:number}>();
    return {projectId:p.projectId,custody:p.custody,expected:row?.expected??null,lexical:row?.invalidated?0:row?.lexical??0,semantic:row?.invalidated?0:row?.semantic??0,backfillComplete:row?.backfill_complete===1&&row.invalidated===0&&row.expected!==null&&row.lexical>=row.expected};
  }
  /** Source pointer and posting replacement are published in one batch by background maintenance. */
  async recordStatements(p:CreationSearchPartition,source:HydratedCreationCandidate,contentId:string):Promise<D1PreparedStatement[]> {
    const key=searchPartitionKey(p),terms=await Promise.all(creationLexicalTerms(source.title+' '+source.text).map(t=>decisionHash(t)));
    return [this.db.prepare(`INSERT INTO creation_search_records(partition_key,source_id,kind,revision,content_hash,content_id,source_version,tombstone) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(partition_key,source_id) DO UPDATE SET kind=excluded.kind,revision=excluded.revision,content_hash=excluded.content_hash,content_id=excluded.content_id,source_version=excluded.source_version,tombstone=0,semantic_model=CASE WHEN creation_search_records.revision=excluded.revision AND creation_search_records.content_hash=excluded.content_hash AND creation_search_records.content_id=excluded.content_id THEN creation_search_records.semantic_model ELSE NULL END,semantic_revision=CASE WHEN creation_search_records.revision=excluded.revision AND creation_search_records.content_hash=excluded.content_hash AND creation_search_records.content_id=excluded.content_id THEN creation_search_records.semantic_revision ELSE NULL END`).bind(key,source.id,source.kind,source.revision,source.contentHash,contentId,p.contentVersion),this.db.prepare('DELETE FROM creation_search_terms WHERE partition_key=? AND source_id=?').bind(key,source.id),...Array.from({length:Math.ceil(terms.length/100)},(_,i)=>this.db.prepare(`INSERT INTO creation_search_terms(partition_key,term_hash,source_id) SELECT ?,value,? FROM json_each(?)`).bind(key,source.id,JSON.stringify(terms.slice(i*100,i*100+100))))];
  }
}
