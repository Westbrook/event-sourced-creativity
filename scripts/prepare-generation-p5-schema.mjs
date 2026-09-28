import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const db=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync('drizzle/'+f,'utf8'));
// Used base fixture: a real unrelated row must survive additive installation.
db.exec("INSERT INTO users(user_id,email,display_name,role,created_at,updated_at) VALUES('p5-schema-canary','canary@example.test','SYNTHETIC','viewer','2026-09-25','2026-09-25')");
const expected=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())expected.exec(readFileSync('drizzle/'+f,'utf8'));
for(const file of ['generation-study.pending.sql','generation-study-supplied-v2.pending.sql','authoring-study-approval.pending.sql'])expected.exec(readFileSync('db/'+file,'utf8'));
const query="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name GLOB 'generation_study_*' OR name GLOB 'authoring_study_*' ORDER BY name";
const rows=expected.prepare(query).all(),rank={table:0,index:1,view:2,trigger:3};
const sql='-- P5 Sites additive final schema candidate. NOT a registered migration.\n-- Requires no existing generation_study_* or authoring_study_* objects.\n-- Execute via approved atomic D1 procedure only after full dependency preflight.\n-- No user/evidence/grant/consent/financial row is created. Never apply fixture upgrade SQL.\n'+[...rows].sort((a,b)=>rank[a.type]-rank[b.type]||a.name.localeCompare(b.name)).map(r=>r.sql+';').join('\n\n')+'\n';
const path='docs/evidence/generation-p5/sites-r1/schema-additive.sql';
if(process.argv.includes('--write'))writeFileSync(path,sql);else assert.equal(readFileSync(path,'utf8'),sql);
db.exec('BEGIN');db.exec(sql);db.exec('COMMIT');assert.deepEqual(db.prepare(query).all(),rows);assert.equal(db.prepare("SELECT display_name FROM users WHERE user_id='p5-schema-canary'").get().display_name,'SYNTHETIC');
assert.throws(()=>db.exec(sql),/already exists/);
// SQLite rollback observation only; D1 atomic DDL remains owner qualification.
const rollback=new DatabaseSync(':memory:');
for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())rollback.exec(readFileSync('drizzle/'+f,'utf8'));
rollback.exec('BEGIN');rollback.exec(sql);rollback.exec('ROLLBACK');assert.equal(rollback.prepare(query).all().length,0);
console.log(JSON.stringify({check:'additive final schema',objects:rows.length,noDropOrAlter:!/^\s*(DROP|ALTER)\b/im.test(sql),exactContracts:true,unrelatedRowPreserved:true,reapplyRefused:true,localRollback:true,managedD1Qualified:false}));
db.close();expected.close();rollback.close();
