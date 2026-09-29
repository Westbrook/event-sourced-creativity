import{readFileSync}from'node:fs';import{DatabaseSync}from'node:sqlite';import assert from'node:assert/strict';
import{schemaRows}from'../../../../evals/generation-reliability/native-host/supplied-schema-contract.mjs';
import{AUTHORING_STUDY_SCHEMA}from'../../../../worker/authoring-study-schema.ts';
const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE budget_reservations(reservation_id TEXT);CREATE TABLE cost_budget_reservations(reservation_id TEXT)');
for(const name of ['generation-study.pending.sql','generation-study-supplied-v2.pending.sql','authoring-study-approval.pending.sql'])db.exec(readFileSync(new URL('../../../../db/'+name,import.meta.url),'utf8'));
const rows=db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'generation_study_*' OR name GLOB 'authoring_study_*' ORDER BY name").all().map(x=>({...x}));
const expected=[...schemaRows,...AUTHORING_STUDY_SCHEMA].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);assert.deepEqual(rows,expected);assert.equal(rows.length,49);
const m=JSON.parse(readFileSync(new URL('./dependencies.json',import.meta.url)));assert.deepEqual(m.currentOptionalSchema.objects.map(({type,name,table,sql})=>({type,name,tbl_name:table,sql})),expected);db.close();console.log('49/49 exact existing schema definitions match current supplied and authoring guards; no migration written.');
