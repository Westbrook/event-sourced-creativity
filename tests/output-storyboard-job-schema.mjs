import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const C=process.env.FORMA_SOURCE_ROOT??fileURLToPath(new URL('..',import.meta.url));
const source=readFileSync(C+'/worker/runtime.ts','utf8');
const literal=source.match(/env\.DB\.prepare\(("(?:CREATE TABLE IF NOT EXISTS document_jobs )[^"\n]+")\)/u)?.[1];
assert(literal,'Actual runtime document_jobs schema is required');
const schema=JSON.parse(literal);
export function assertStoryboardJobSchema(sqlite){
 const names=sqlite.prepare('PRAGMA table_info(document_jobs)').all().map(row=>row.name);
 assert(names.includes('request_json')&&names.includes('job_id'));
 assert(!names.includes('output_slot_id'),'output_slot_id is a derived slot relation, never a physical job column');
 return names;
}
export function createStoryboardJobTable(sqlite){sqlite.exec(schema);assertStoryboardJobSchema(sqlite);}
export function insertStoryboardJob(sqlite,job){
 const columns=assertStoryboardJobSchema(sqlite),now=new Date().toISOString();
 const row={kind:'render_document',status:'running',source_surface:'outputs',requested_sequence:0,request_json:'{}',requested_at:now,updated_at:now,...job};
 const keys=Object.keys(row).filter(key=>columns.includes(key));
 sqlite.prepare('INSERT INTO document_jobs('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]));
}
