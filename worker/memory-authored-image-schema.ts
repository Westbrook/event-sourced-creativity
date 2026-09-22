import type {WorkerEnv} from './runtime.ts';
import type {BudgetReservationGuard} from './pilot-policy.ts';
import {memoryCanonical} from './memory-sql.ts';
import {memoryDigest} from '../src/model/scoped-memory.ts';

const family="name LIKE 'memory_authored_image_%' OR tbl_name='memory_authored_image_receipts' OR instr(lower(COALESCE(sql,'')),'memory_authored_image_receipts')>0";
const snapshot=`(SELECT json_group_array(json_object('name',name,'sql',sql,'tbl_name',tbl_name,'type',type)) FROM (SELECT name,sql,tbl_name,type FROM sqlite_schema WHERE ${family} ORDER BY name,type))`;
const digest='3ab660bf475df9d90aa5428b03487c7b2ab7bdceb2774b43ec58f4f32abfe91a';
function fail():never{throw Error('memory_authored_image_schema_unavailable');}
/** Optional schema absence is a no-op only before any authored-image material
 * exists. A partial/changed installation is never a healthy disabled feature.
 * This returns an exact predicate, not cached permission or schema authority. */
export async function memoryAuthoredImageSchema(env:WorkerEnv):Promise<{db:WorkerEnv['DB'];guard:BudgetReservationGuard}|null>{
 const db=env.DB,raw=structuredClone(await db.prepare(`SELECT ${snapshot} AS snapshot,EXISTS(SELECT 1 FROM private_content WHERE kind='authored-memory-image') AS material`).all<Record<string,unknown>>());
 if(env.DB!==db||raw.success!==true||('error' in raw&&raw.error!==undefined)||!Array.isArray(raw.results)||raw.results.length!==1)fail();
 const row=raw.results[0]!;if(Object.keys(row).sort().join(',')!=='material,snapshot'||typeof row.snapshot!=='string'||![0,1].includes(row.material as number)||row.snapshot.length>32768)fail();
 const rows=JSON.parse(row.snapshot as string) as unknown;
 if(!Array.isArray(rows))fail();
 if(rows.length===0){if(row.material!==0)fail();return null;}
 if(rows.length!==13||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='name,sql,tbl_name,type'
  ||typeof r.name!=='string'||typeof r.tbl_name!=='string'||!['table','index','trigger'].includes(r.type)||r.sql!==null&&typeof r.sql!=='string'))fail();
 if(await memoryDigest(memoryCanonical(rows.map(r=>({...r,sql:r.sql===null?null:r.sql.trim().replace(/;$/u,'').replace(/\bIF\s+NOT\s+EXISTS\s+/giu,'')}))))!==digest||env.DB!==db)fail();
 return {db,guard:{sql:`${snapshot}=? AND NOT EXISTS(SELECT 1 FROM sqlite_temp_schema)`,bindings:[row.snapshot as string]}};
}
