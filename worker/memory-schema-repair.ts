import manifest from './memory-schema-repair-manifest.json' with {type:'json'};
import {memoryDigest} from '../src/model/scoped-memory.ts';

type Row={type:string;name:string;tbl_name:string;sql:string|null};
const guard='__forma_memory_schema_repair_guard';
const receipt='__forma_memory_schema_repair_receipts';
const receiptDDL=`CREATE TABLE ${receipt}(manifest_sha256 TEXT PRIMARY KEY NOT NULL,applied_at TEXT NOT NULL)`;
const canonical=(sql:string|null)=>sql===null?null:sql.trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'');
const equal=(a:Row,b:Row)=>a.type===b.type&&a.name===b.name&&a.tbl_name===b.tbl_name&&canonical(a.sql)===canonical(b.sql);
const catalogSQL=`SELECT type,name,tbl_name,sql FROM main.sqlite_schema WHERE name NOT LIKE 'sqlite_%' AND name!='${guard}' ORDER BY name`;
const snapshotSQL=`(SELECT json_group_array(json_object('type',type,'name',name,'tbl_name',tbl_name,'sql',sql)) FROM (${catalogSQL}))`;
const settingsSQL=`(SELECT foreign_keys FROM pragma_foreign_keys)=1 AND (SELECT defer_foreign_keys FROM pragma_defer_foreign_keys)=0 AND (SELECT ignore_check_constraints FROM pragma_ignore_check_constraints)=0 AND NOT EXISTS(SELECT 1 FROM temp.sqlite_schema)`;
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const objects=manifest.objects as Row[];
const variants=manifest.variants as Record<string,Row[]>;
const names=new Set(objects.map(r=>r.name));
const tables=new Set(manifest.tables);
const fail=(reason:string):never=>{throw Error('memory_schema_repair_'+reason);};
export const MEMORY_SCHEMA_REPAIR_MANIFEST=manifest.sha256;
export const MEMORY_SCHEMA_REPAIR_CATALOG_SQL=catalogSQL;

async function rows(db:D1Database,sql:string){
 const r=await db.prepare(sql).all<Record<string,unknown>>();
 if(r.success!==true||!Array.isArray(r.results)||r.results.length>2000)fail('inventory_unavailable');
 return r.results;
}
/** Fixed, source-pinned inspection only: no caller-selected SQL or row values. */
export async function inspectMemorySchemaRepair(db:D1Database){
 const raw=await rows(db,`SELECT ${snapshotSQL} AS snapshot,${settingsSQL} AS ready,EXISTS(SELECT 1 FROM sqlite_schema WHERE name='${guard}') AS reserved`);
 if(raw.length!==1||raw[0]!.ready!==1||raw[0]!.reserved!==0||typeof raw[0]!.snapshot!=='string'||raw[0]!.snapshot.length>2_000_000)fail('settings_or_inventory');
 const snapshot=raw[0]!.snapshot as string;
 const catalog=JSON.parse(snapshot) as Row[];
 if(!Array.isArray(catalog)||catalog.length>2000||catalog.some(r=>!r||typeof r.type!=='string'||typeof r.name!=='string'||typeof r.tbl_name!=='string'||r.sql!==null&&typeof r.sql!=='string'))fail('inventory_unavailable');
 const byName=new Map(catalog.map(r=>[r.name,r]));
 const blocked:string[]=[],missing:Row[]=[],replace:Row[]=[];
 for(const wanted of objects){const actual=byName.get(wanted.name);if(!actual){missing.push(wanted);continue;}if(equal(actual,wanted))continue;
  if(['trigger','index'].includes(wanted.type)&&variants[wanted.name]?.some(v=>equal(v,actual)))replace.push(wanted);else blocked.push(wanted.name);
 }
 for(const actual of catalog){
  if(names.has(actual.name))continue;
  if(actual.name===receipt){if(actual.type!=='table'||canonical(actual.sql)!==receiptDDL)blocked.push(receipt);continue;}
  if(actual.tbl_name===receipt||tables.has(actual.tbl_name)||['trigger','view'].includes(actual.type)&&[receipt,...manifest.tables].some(t=>new RegExp('\\b'+t+'\\b','iu').test(actual.sql??'')))blocked.push(actual.name);
 }
 // Check parent column contracts without hydrating any user records.
 for(const [table,expected] of Object.entries(manifest.dependencies)){
  const actual=await rows(db,`SELECT name,upper(type) AS type,pk,hidden FROM pragma_table_xinfo('${table}') ORDER BY cid`);
  if(JSON.stringify(actual)!==JSON.stringify(expected))blocked.push('dependency:'+table);
 }
 const present=manifest.tables.filter(n=>byName.get(n)?.type==='table');
 let populated=false;
 if(present.length){const found=await rows(db,`SELECT ${present.map(n=>`EXISTS(SELECT 1 FROM ${quote(n)} LIMIT 1)`).join(' OR ')} AS populated`);populated=found.length!==1||found[0]!.populated!==0;}
 if(populated)blocked.push('populated-memory-tables');
 if(byName.has(receipt)&&!blocked.includes(receipt)){
  const found=await rows(db,`SELECT manifest_sha256,applied_at FROM ${receipt} LIMIT 2`);
  if(found.some(r=>r.manifest_sha256!==manifest.sha256||typeof r.applied_at!=='string')||found.length>1)blocked.push('receipt');
 }
 const complete=!blocked.length&&!missing.length&&!replace.length;
 const proof=await memoryDigest(manifest.sha256+'\n'+snapshot);
 return {summary:{manifest:manifest.sha256,status:blocked.length?'blocked':complete?'complete':'ready',missing:missing.length,replacements:replace.length,blocked:[...new Set(blocked)],tables:manifest.tables.length,objects:objects.length,hostedDeploymentRunnerQualified:false},snapshot,catalog,missing,replace,present,proof};
}

/** Qualify rollback with isolated metadata/test data on the selected binding.
 * Only the reserved probe table is touched; the expected final statement fails.
 * An unrelated/network error or any retained object is not a passing receipt. */
async function qualifyRollback(db:D1Database,snapshot:string){
 let expectedFailure=false;
 try{await db.batch([
  db.prepare(`CREATE TABLE ${guard}(proof INTEGER NOT NULL CHECK(proof=1))`),
  db.prepare(`INSERT INTO ${guard} VALUES(1)`),
  db.prepare(`INSERT INTO ${guard} VALUES(NULL)`),
 ]);}catch(error){expectedFailure=error instanceof Error&&error.message.includes(`NOT NULL constraint failed: ${guard}.proof`);}
 if(!expectedFailure)fail('rollback_not_qualified');
 const verified=await rows(db,`SELECT ${snapshotSQL} AS snapshot,EXISTS(SELECT 1 FROM sqlite_schema WHERE name='${guard}') AS reserved`);
 if(verified.length!==1||verified[0]!.reserved!==0||verified[0]!.snapshot!==snapshot)fail('rollback_not_qualified');
}

/** A single D1 batch owns preconditions, all DDL, postconditions and its distinct
 * receipt. Original deployment/Drizzle migration history is never rewritten. */
export async function applyMemorySchemaRepair(db:D1Database,proof:string,authority:{sql:string;bindings:unknown[]}){
 const plan=await inspectMemorySchemaRepair(db);
 if(plan.proof!==proof||plan.summary.status==='blocked')fail('precondition');
 if(plan.summary.status==='complete')return plan.summary;
 await qualifyRollback(db,plan.snapshot);
 const statements:D1PreparedStatement[]=[];
 const add=(sql:string,...values:unknown[])=>statements.push(db.prepare(sql).bind(...values));
 add(`CREATE TABLE ${guard}(proof INTEGER NOT NULL CHECK(proof=1))`);
 const empty=plan.present.map(n=>`NOT EXISTS(SELECT 1 FROM ${quote(n)} LIMIT 1)`).join(' AND ')||'1';
 add(`INSERT INTO ${guard} SELECT CASE WHEN ${snapshotSQL}=? AND ${settingsSQL} AND ${empty} AND (${authority.sql}) THEN 1 ELSE NULL END`,plan.snapshot,...authority.bindings);
 const changed=new Set([...plan.missing,...plan.replace].map(r=>r.name));
 for(const r of plan.replace)add(`DROP ${r.type.toUpperCase()} ${quote(r.name)}`);
 // Install all tables before attached objects so no trigger can see a missing
 // target during installation. No user table is dropped or rewritten.
 for(const kind of ['table','index','trigger'])for(const r of objects)if(changed.has(r.name)&&r.type===kind){if(!r.sql)fail('manifest');add(r.sql!);}
 const expected=plan.catalog.filter(r=>!changed.has(r.name)).concat(objects.filter(r=>changed.has(r.name)));
 add(`INSERT INTO ${guard} SELECT CASE WHEN
  (SELECT count(*) FROM (${catalogSQL}))=json_array_length(?) AND NOT EXISTS(
   SELECT 1 FROM (${catalogSQL}) AS actual LEFT JOIN json_each(?) AS expected ON json_extract(expected.value,'$.name')=actual.name
   WHERE expected.key IS NULL OR actual.type IS NOT json_extract(expected.value,'$.type') OR actual.tbl_name IS NOT json_extract(expected.value,'$.tbl_name') OR actual.sql IS NOT json_extract(expected.value,'$.sql'))
  AND NOT EXISTS(SELECT 1 FROM pragma_foreign_key_check LIMIT 1) THEN 1 ELSE NULL END`,JSON.stringify(expected),JSON.stringify(expected));
 if(!plan.catalog.some(r=>r.name===receipt))add(receiptDDL);
 add(`INSERT INTO ${receipt}(manifest_sha256,applied_at) VALUES(?,?)`,manifest.sha256,new Date().toISOString());
 add(`DROP TABLE ${guard}`);
 const result=await db.batch(statements);
 if(result.length!==statements.length||result.some(r=>r.success!==true))fail('batch_unconfirmed');
 const after=await inspectMemorySchemaRepair(db);
 if(after.summary.status!=='complete')fail('postcondition');
 return {...after.summary,applied:true,rollbackQualified:true,statements:statements.length};
}
