import type { CreationIndexCoverage, CreationSearchPartition } from '../src/model/creation-search.ts';
import type { CreationSearchHit, CreationSearchIndex, HydratedCreationCandidate } from './creation-search.ts';
import { decisionHash } from './still-decision-store.ts';

/** Hashes below are exact lexical posting keys, NEVER semantic vectors. */
export const creationLexicalTerms = (text:string) => [...new Set(text.normalize('NFKC').toLocaleLowerCase('und').match(/[\p{L}\p{N}]+/gu) ?? [])].slice(0,4096);
export const searchPartitionKey = (p:Pick<CreationSearchPartition,'custody'|'projectId'>) => JSON.stringify([p.custody,p.projectId]);
export const CREATION_SEARCH_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS creation_search_partitions(partition_key TEXT PRIMARY KEY,custody TEXT NOT NULL,project_id TEXT NOT NULL,owner_id TEXT NOT NULL,project_access_id TEXT,content_version TEXT NOT NULL DEFAULT '',index_version INTEGER NOT NULL DEFAULT 0,expected INTEGER,backfill_cursor TEXT NOT NULL DEFAULT '',backfill_complete INTEGER NOT NULL DEFAULT 0,invalidated INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS creation_search_partition_owner ON creation_search_partitions(owner_id,project_id)`,
  `CREATE INDEX IF NOT EXISTS creation_search_partition_access ON creation_search_partitions(project_access_id)`,
  `CREATE TABLE IF NOT EXISTS creation_search_records(partition_key TEXT NOT NULL,source_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN('project','document','idea')),revision TEXT NOT NULL,content_hash TEXT NOT NULL,content_id TEXT NOT NULL,source_version TEXT NOT NULL,semantic_model TEXT,semantic_revision TEXT,tombstone INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(partition_key,source_id))`,
  `CREATE INDEX IF NOT EXISTS creation_search_source_version ON creation_search_records(partition_key,source_version,tombstone)`,
  `CREATE TABLE IF NOT EXISTS creation_search_terms(partition_key TEXT NOT NULL,term_hash TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(partition_key,term_hash,source_id))`,
  ...(['INSERT','UPDATE','DELETE'] as const).flatMap(op => {
    const sides = op==='INSERT'?['NEW']:op==='DELETE'?['OLD']:['OLD','NEW'];
    return [
      `CREATE TRIGGER IF NOT EXISTS creation_search_events_${op.toLowerCase()} AFTER ${op} ON events BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id=${s}.stream_id;`).join(' ')} END`,
      `CREATE TRIGGER IF NOT EXISTS creation_search_secrets_${op.toLowerCase()} AFTER ${op} ON event_private_payloads BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE 'creative:'||owner_id IN(SELECT stream_id FROM events WHERE event_id=${s}.private_event_id);`).join(' ')} END`,
      `CREATE TRIGGER IF NOT EXISTS creation_search_resources_${op.toLowerCase()} AFTER ${op} ON project_resource_scopes BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=${s}.project_access_id AND ${s}.resource_kind<>'content';`).join(' ')} END`,
      `CREATE TRIGGER IF NOT EXISTS creation_search_project_events_${op.toLowerCase()} AFTER ${op} ON project_event_scopes BEGIN ${sides.map(s=>`UPDATE creation_search_partitions SET invalidated=1,index_version=index_version+1 WHERE project_access_id=${s}.project_access_id;`).join(' ')} END`,
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
    const rows=await this.db.prepare(`SELECT r.source_id,r.kind,r.revision,r.content_hash,COUNT(*) AS matches FROM creation_search_terms t JOIN creation_search_records r ON r.partition_key=t.partition_key AND r.source_id=t.source_id JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE t.partition_key=? AND t.term_hash IN(SELECT value FROM json_each(?)) AND r.tombstone=0 AND p.invalidated=0 AND r.source_version=p.content_version GROUP BY r.source_id ORDER BY matches DESC,r.source_id LIMIT ?`).bind(searchPartitionKey(p),JSON.stringify(terms),Math.min(20,limit)).all<{source_id:string;kind:CreationSearchHit['kind'];revision:string;content_hash:string}>();
    signal.throwIfAborted();
    return rows.results.map((r,rank)=>({id:r.source_id,projectId:p.projectId,custody:p.custody,kind:r.kind,revision:r.revision,contentHash:r.content_hash,rank}));
  }
  async current(p:CreationSearchPartition,hits:CreationSearchHit[],signal:AbortSignal) {
    signal.throwIfAborted();if(!hits.length)return [];
    const rows=await this.db.prepare(`SELECT r.source_id,r.revision,r.content_hash FROM creation_search_records r JOIN creation_search_partitions p ON p.partition_key=r.partition_key WHERE r.partition_key=? AND r.source_id IN(SELECT value FROM json_each(?)) AND r.tombstone=0 AND p.invalidated=0 AND r.source_version=p.content_version AND p.content_version=? AND CAST(p.index_version AS TEXT)=?`).bind(searchPartitionKey(p),JSON.stringify(hits.map(h=>h.id)),p.contentVersion,p.indexVersion).all<{source_id:string;revision:string;content_hash:string}>();
    return hits.filter(h=>rows.results.some(r=>r.source_id===h.id&&r.revision===h.revision&&r.content_hash===h.contentHash));
  }
  async coverage(p:CreationSearchPartition):Promise<CreationIndexCoverage> {
    const row=await this.db.prepare(`SELECT p.expected,p.backfill_complete,p.invalidated,COUNT(CASE WHEN r.tombstone=0 AND r.source_version=p.content_version THEN 1 END) AS lexical,COUNT(CASE WHEN r.tombstone=0 AND r.source_version=p.content_version AND r.semantic_revision=r.revision AND (? IS NULL OR r.semantic_model=?) THEN 1 END) AS semantic FROM creation_search_partitions p LEFT JOIN creation_search_records r ON r.partition_key=p.partition_key WHERE p.partition_key=? GROUP BY p.partition_key`).bind(this.semanticModel??null,this.semanticModel??null,searchPartitionKey(p)).first<{expected:number|null;backfill_complete:number;invalidated:number;lexical:number;semantic:number}>();
    return {projectId:p.projectId,custody:p.custody,expected:row?.expected??null,lexical:row?.invalidated?0:row?.lexical??0,semantic:row?.invalidated?0:row?.semantic??0,backfillComplete:row?.backfill_complete===1&&row.invalidated===0};
  }
  /** Source pointer and posting replacement are published in one batch by background maintenance. */
  async recordStatements(p:CreationSearchPartition,source:HydratedCreationCandidate,contentId:string):Promise<D1PreparedStatement[]> {
    const key=searchPartitionKey(p),terms=await Promise.all(creationLexicalTerms(source.title+' '+source.text).map(t=>decisionHash(t)));
    return [this.db.prepare(`INSERT INTO creation_search_records(partition_key,source_id,kind,revision,content_hash,content_id,source_version,tombstone) VALUES(?,?,?,?,?,?,?,0) ON CONFLICT(partition_key,source_id) DO UPDATE SET kind=excluded.kind,revision=excluded.revision,content_hash=excluded.content_hash,content_id=excluded.content_id,source_version=excluded.source_version,tombstone=0,semantic_model=CASE WHEN creation_search_records.revision=excluded.revision AND creation_search_records.content_hash=excluded.content_hash THEN creation_search_records.semantic_model ELSE NULL END,semantic_revision=CASE WHEN creation_search_records.revision=excluded.revision AND creation_search_records.content_hash=excluded.content_hash THEN creation_search_records.semantic_revision ELSE NULL END`).bind(key,source.id,source.kind,source.revision,source.contentHash,contentId,p.contentVersion),this.db.prepare('DELETE FROM creation_search_terms WHERE partition_key=? AND source_id=?').bind(key,source.id),...Array.from({length:Math.ceil(terms.length/100)},(_,i)=>this.db.prepare(`INSERT INTO creation_search_terms(partition_key,term_hash,source_id) SELECT ?,value,? FROM json_each(?)`).bind(key,source.id,JSON.stringify(terms.slice(i*100,i*100+100))))];
  }
}
