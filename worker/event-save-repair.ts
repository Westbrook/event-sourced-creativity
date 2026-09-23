import {GenerationPreparationError} from './generation-preparation-error.ts';
import manifest from './memory-schema-repair-manifest.json' with {type:'json'};
import {memoryDigest} from '../src/model/scoped-memory.ts';
import {inspectMemorySchemaRepair, MEMORY_SCHEMA_REPAIR_CATALOG_SQL} from './memory-schema-repair.ts';
import {EVENT_WRITE_COLUMNS, eventWriteBindings, makeEvent} from './event-write-primitives.ts';

type Row={type:string;name:string;tbl_name:string;sql:string|null};
type Authority={sql:string;bindings:unknown[]};
export const EVENT_SAVE_REPAIR_ID='empty-memory-trigger-isolation-v1';
const guard='__forma_event_save_repair_guard';
const receipt='__forma_event_save_repair_receipts';
const receiptDDL=`CREATE TABLE ${receipt}(repair_id TEXT PRIMARY KEY NOT NULL,source_manifest TEXT NOT NULL,applied_at TEXT NOT NULL)`;
const canonical=(sql:string|null)=>sql?.trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'')??null;
const equal=(a:Row|undefined,b:Row)=>a?.type===b.type&&a.name===b.name&&a.tbl_name===b.tbl_name&&canonical(a.sql)===canonical(b.sql);
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const objects=manifest.objects as Row[];
// The historical manifest and migration receipts stay immutable. Only the new,
// provably empty Memory subsystem is isolated; baseline privacy and the two
// containment/nesting tables and their triggers are retained.
export const EVENT_SAVE_REPAIR_REMOVED=objects.filter(r=>r.type==='trigger'&&r.name.startsWith('memory_'));
export const EVENT_SAVE_REPAIR_TABLES=manifest.tables.filter(t=>t.startsWith('memory_'));
export const EVENT_SAVE_REPAIR_BARRIERS:Row[]=EVENT_SAVE_REPAIR_TABLES.map(table=>({
 type:'trigger',name:`event_save_isolation_${table}`,tbl_name:table,
 sql:`CREATE TRIGGER event_save_isolation_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'memory_inactive_save_repair'); END`,
}));
const removed=new Set(EVENT_SAVE_REPAIR_REMOVED.map(r=>r.name));
const retained=objects.filter(r=>!removed.has(r.name));
const isolatedNames=new Set(EVENT_SAVE_REPAIR_BARRIERS.map(r=>r.name));
const catalogSQL=MEMORY_SCHEMA_REPAIR_CATALOG_SQL.replace('ORDER BY name',`AND name!='${guard}' ORDER BY name`);
const snapshotSQL=`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${catalogSQL}))`;
const settingsSQL=`(SELECT foreign_keys FROM pragma_foreign_keys)=1 AND (SELECT defer_foreign_keys FROM pragma_defer_foreign_keys)=0 AND (SELECT ignore_check_constraints FROM pragma_ignore_check_constraints)=0 AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)`;
const emptySQL=EVENT_SAVE_REPAIR_TABLES.map(t=>`NOT EXISTS(SELECT 1 FROM ${quote(t)})`).join(' AND ');
const fail=(code:string):never=>{throw Error('event_save_repair_'+code);};
async function rows(db:D1Database,sql:string){const r=await db.prepare(sql).all<Record<string,unknown>>();if(r.success!==true||!Array.isArray(r.results))fail('read_unconfirmed');return r.results;}
const receiptObject:Row={type:'table',name:receipt,tbl_name:receipt,sql:receiptDDL};
const checkCatalog=(expected:Row[])=>({sql:`(SELECT COUNT(*) FROM (${catalogSQL}))=json_array_length(?) AND NOT EXISTS(
 SELECT 1 FROM (${catalogSQL}) actual LEFT JOIN json_each(?) expected ON json_extract(expected.value,'$.name')=actual.name
 WHERE expected.key IS NULL OR actual.type IS NOT json_extract(expected.value,'$.type') OR actual.tbl_name IS NOT json_extract(expected.value,'$.tbl_name') OR actual.sql IS NOT json_extract(expected.value,'$.sql'))`,bindings:[JSON.stringify(expected),JSON.stringify(expected)]});
export const EVENT_SAVE_COMPILE_PROBE=`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) SELECT 'probe','creative:probe',1,'now','now','user:probe','probe','probe',NULL,NULL,1,'ProjectCreated','{}','probe','probe',NULL,'{}' WHERE 0`;

/** Inspection reads metadata and empty-table witnesses only. No save or DDL. */
export async function inspectEventSaveRepair(db:D1Database){
 const observed=await rows(db,`SELECT ${snapshotSQL} AS snapshot,${settingsSQL} AS settings,EXISTS(SELECT 1 FROM sqlite_schema WHERE name='${guard}') AS reserved`);
 if(observed.length!==1||typeof observed[0].snapshot!=='string'||observed[0].snapshot.length>2_000_000||observed[0].settings!==1)fail('inventory');
 const snapshot=observed[0].snapshot as string,catalog=JSON.parse(snapshot) as Row[],byName=new Map(catalog.map(r=>[r.name,r]));
 const blocked:string[]=[];
 if(observed[0].reserved!==0||catalog.some(r=>r.name==='__forma_memory_schema_repair_guard'))blocked.push('reserved-guard');
 const isolated=catalog.some(r=>isolatedNames.has(r.name)||r.name===receipt);
 if(!isolated){
  const original=await inspectMemorySchemaRepair(db);
  if(original.snapshot!==snapshot||original.summary.status!=='complete')blocked.push('original-schema-not-complete');
 }else{
  for(const r of [...retained,...EVENT_SAVE_REPAIR_BARRIERS,receiptObject])if(!equal(byName.get(r.name),r))blocked.push(r.name);
  for(const r of EVENT_SAVE_REPAIR_REMOVED)if(byName.has(r.name))blocked.push(r.name);
  const allowed=new Set([...objects.map(r=>r.name),...isolatedNames,receipt]);
  for(const r of catalog)if(!allowed.has(r.name)&&(r.tbl_name===receipt||manifest.tables.includes(r.tbl_name)||['trigger','view'].includes(r.type)&&[receipt,...manifest.tables].some(t=>new RegExp('\\b'+t+'\\b','iu').test(r.sql??''))))blocked.push(r.name);
  for(const [table,expected] of Object.entries(manifest.dependencies)){
   const actual=await rows(db,`SELECT name,upper(type) AS type,pk,hidden FROM pragma_table_xinfo('${table}') ORDER BY cid`);
   if(JSON.stringify(actual)!==JSON.stringify(expected))blocked.push('dependency:'+table);
  }
  if(equal(byName.get(receipt),receiptObject)){
   const records=await rows(db,`SELECT repair_id,source_manifest,applied_at FROM ${receipt} LIMIT 2`);
   if(records.length!==1||records[0].repair_id!==EVENT_SAVE_REPAIR_ID||records[0].source_manifest!==manifest.sha256||typeof records[0].applied_at!=='string')blocked.push('receipt');
  }
 }
 if(EVENT_SAVE_REPAIR_TABLES.every(t=>byName.has(t))){const empty=await rows(db,`SELECT ${emptySQL} AS empty`);if(empty.length!==1||empty[0].empty!==1)blocked.push('populated-memory');}
 else blocked.push('missing-memory-table');
 const proof=await memoryDigest(EVENT_SAVE_REPAIR_ID+'\n'+snapshot);
 return{catalog,snapshot,proof,summary:{repair:EVENT_SAVE_REPAIR_ID,status:blocked.length?'blocked':isolated?'complete':'ready',blocked:[...new Set(blocked)],removedTriggers:EVENT_SAVE_REPAIR_REMOVED.length,protectedEmptyTables:EVENT_SAVE_REPAIR_TABLES.length,memory:'disabled-until-separately-qualified' as const}};
}

/** Compile the real write shape without changing data. EXPLAIN is used rather
 * than a dummy write so GET diagnostics never enter a write transaction. */
export async function inspectEventSaveCompilation(db:D1Database){
 try{await rows(db,'EXPLAIN '+EVENT_SAVE_COMPILE_PROBE);return{status:'pass' as const};}
 catch(error){return{status:'failed' as const,error:error instanceof Error&&error.message.includes('triggers nested too deep')?'triggers nested too deep':'save_probe_unavailable'};}
}

async function rollbackProbe(db:D1Database,snapshot:string,authority:Authority,withEvents:boolean){
 const token=crypto.randomUUID(),stream='creative:event-save-probe-'+token,ids:string[]=[];
 const statements=[db.prepare(`CREATE TABLE ${guard}(proof INTEGER NOT NULL CHECK(proof=1))`),
  db.prepare(`INSERT INTO ${guard} SELECT CASE WHEN (${authority.sql}) THEN 1 ELSE 0 END`).bind(...authority.bindings)];
 if(withEvents){
  for(const [index,type] of ['ProjectCreated','DocumentCreated','BlockCreated','BudgetReservationReconciled'].entries()){
   const event=makeEvent(stream,index+1,'worker:save-probe','save-probe',token,type,{project_id:token,document_id:token,block_id:token,name:'Synthetic rollback probe',text:'Synthetic rollback probe'});
   ids.push(event.eventId);const values=eventWriteBindings(event);
   statements.push(db.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${values.map(()=>'?').join(',')})`).bind(...values));
  }
  // A success-shaped statement must actually persist the envelopes, private
  // bodies and empty staging table before the intentional failure.
  statements.push(db.prepare(`INSERT INTO ${guard} SELECT CASE WHEN
   (SELECT count(*) FROM events WHERE stream_id=?)=4 AND
   (SELECT count(*) FROM event_private_payloads WHERE private_event_id IN(?,?,?,?) AND redacted_at IS NULL)=4 AND
   NOT EXISTS(SELECT 1 FROM event_write_stage WHERE stream_id=?) THEN 1 ELSE 0 END`).bind(stream,...ids,stream));
 }
 statements.push(db.prepare(`INSERT INTO ${guard} VALUES(NULL)`));
 let exact=false;
 try{await db.batch(statements);}catch(error){exact=error instanceof Error&&error.message.includes(`NOT NULL constraint failed: ${guard}.proof`);}
 if(!exact)fail(withEvents?'save_probe_failed':'rollback_unqualified');
 const after=await rows(db,`SELECT ${snapshotSQL} AS snapshot,EXISTS(SELECT 1 FROM sqlite_schema WHERE name='${guard}') AS residue`);
 if(after.length!==1||after[0].snapshot!==snapshot||after[0].residue!==0)fail('rollback_unqualified');
 if(withEvents){
  const count=await db.prepare('SELECT (SELECT count(*) FROM events WHERE stream_id=?)+(SELECT count(*) FROM event_write_stage WHERE stream_id=?)+(SELECT count(*) FROM event_private_payloads WHERE private_event_id IN(?,?,?,?)) AS n').bind(stream,stream,...ids).first<{n:number}>();
  if(count?.n!==0)fail('probe_residue');
 }
}

/** Fixed, exact-schema, empty-only maintenance. No arbitrary SQL or user rows
 * are accepted. A database barrier protects every disconnected Memory table. */
export async function applyEventSaveRepair(db:D1Database,proof:string,authority:Authority){
 const plan=await inspectEventSaveRepair(db);
 if(plan.proof!==proof||plan.summary.status==='blocked')fail('precondition');
 if(plan.summary.status!=='complete'){
  await rollbackProbe(db,plan.snapshot,authority,false);
  const expected=plan.catalog.filter(r=>!removed.has(r.name)).concat(EVENT_SAVE_REPAIR_BARRIERS,receiptObject);
  const final=checkCatalog(expected);
  // Keep independent predicates in separate statements in the same atomic
  // batch. Combining the authorization query with all empty-table witnesses
  // exceeds hosted D1's expression depth100, even though each check fits.
  const assert=(sql:string,bindings:unknown[]=[])=>db.prepare(`INSERT INTO ${guard} SELECT CASE WHEN (${sql}) THEN 1 ELSE 0 END`).bind(...bindings);
  const batch=[db.prepare(`CREATE TABLE ${guard}(proof INTEGER NOT NULL CHECK(proof=1))`),
   assert(`${snapshotSQL}=?`,[plan.snapshot]),assert(settingsSQL),assert(emptySQL),assert(authority.sql,authority.bindings),
   // Install barriers before disconnecting any lifecycle protection.
   ...EVENT_SAVE_REPAIR_BARRIERS.map(r=>db.prepare(r.sql!)),
   ...EVENT_SAVE_REPAIR_REMOVED.map(r=>db.prepare(`DROP TRIGGER ${quote(r.name)}`)),
   db.prepare(receiptDDL),
   db.prepare(`INSERT INTO ${receipt} VALUES(?,?,?)`).bind(EVENT_SAVE_REPAIR_ID,manifest.sha256,new Date().toISOString()),
   // The same hosted engine must compile the full ordinary save shape before
   // committing the change; a failure rolls back all DDL and the receipt.
   db.prepare(EVENT_SAVE_COMPILE_PROBE),
   assert(final.sql,final.bindings),assert(settingsSQL),assert(emptySQL),assert('NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check LIMIT 1)'),
   db.prepare(`DROP TABLE ${guard}`)];
  const result=await db.batch(batch);
  if(result.length!==batch.length||result.some(r=>r.success!==true))fail('batch_unconfirmed');
 }
 const after=await inspectEventSaveRepair(db);
 if(after.summary.status!=='complete')fail('postcondition');
 await rollbackProbe(db,after.snapshot,authority,true);
 return{...after.summary,applied:plan.summary.status!=='complete',rollbackQualified:true,saveProbe:'four-synthetic-events-persisted-and-rolled-back'};
}


/** A negative-boundary compatibility witness for ordinary content only.
 * This does not qualify Memory operations or reactivate the isolated graph.
 * Every consuming SELECT/cleanup statement rechecks the whole captured catalog,
 * settings, receipt and empty-table witnesses; a stale proof cannot widen access.
 */
export async function readIsolatedMemoryContentBoundary(db:D1Database) {
 const plan=await inspectEventSaveRepair(db);
 if(plan.summary.status!=='complete')throw new GenerationPreparationError('isolation_profile_unqualified',plan.proof);
 // D1 bounds compound SELECT terms. Balance independent emptiness predicates
 // to stay within both its compound-select and expression-depth limits.
 const every=(terms:string[]):string=>terms.length===1?terms[0]!: `(${every(terms.slice(0,Math.floor(terms.length/2)))} AND ${every(terms.slice(Math.floor(terms.length/2)))})`;
 const empty=every(EVENT_SAVE_REPAIR_TABLES.map(table=>`NOT EXISTS(SELECT 1 FROM ${quote(table)} LIMIT 1)`));
 return {sql:`(${snapshotSQL}=? AND ${settingsSQL} AND ${empty}
  AND NOT EXISTS(SELECT 1 FROM sqlite_schema WHERE name IN('__forma_memory_schema_repair_guard','__forma_event_save_repair_guard'))
  AND (SELECT count(*) FROM ${receipt})=1
  AND EXISTS(SELECT 1 FROM ${receipt} WHERE repair_id=? AND source_manifest=? AND typeof(applied_at)='text'))`,
  bindings:[plan.snapshot,EVENT_SAVE_REPAIR_ID,manifest.sha256]};
}

/** Fixed observation capability for the standalone current-source reader.
 * These are the unchanged reads used by the isolated boundary, never repair DDL. */
export const EVENT_SAVE_BOUNDARY_READ_QUERIES = Object.freeze([
 `SELECT ${snapshotSQL} AS snapshot,${settingsSQL} AS settings,EXISTS(SELECT 1 FROM sqlite_schema WHERE name='${guard}') AS reserved`,
 ...Object.keys(manifest.dependencies).map(table=>`SELECT name,upper(type) AS type,pk,hidden FROM pragma_table_xinfo('${table}') ORDER BY cid`),
 `SELECT repair_id,source_manifest,applied_at FROM ${receipt} LIMIT 2`,
 `SELECT ${emptySQL} AS empty`,
]);
