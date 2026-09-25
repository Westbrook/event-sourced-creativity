import {readFileSync,writeFileSync,cpSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {fixture,consentHash} from '../tests/generation-p4-fixture.mjs';
import {outputTestDatabase} from '../tests/output-execution-test-helpers.mjs';
import {createSitesStudyApi,SITES_STUDY_PREFIX} from '../worker/generation-study-api.ts';
import {hash} from '../evals/generation-reliability/core.mjs';
import {png} from '../tests/output-asset-fixtures.mjs';
import assert from 'node:assert/strict';
const out='rehearsal/p5-sites', old='/private/tmp/forma-n10h-sites/next-tasks/n10h-sites/v35/rehearsal';
const after=[];const f=await fixture({after:fn=>after.push(fn)},{classification:'actual',configure:async(p,records)=>{for(const r of records.filter(r=>r.body.kind==='account')){r.body.credentialBinding=hash('OFFLINE-NON-CREDENTIAL');r.body.projectHeader=hash('OFFLINE-project');r.ref.contentHash=await consentHash(r.body);}}});
const catalog=f.sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all();
const initial=[];for(const t of catalog.filter(x=>x.type==='table')){const rows=f.sqlite.prepare('SELECT * FROM "'+t.name+'"').all();if(rows.length)initial.push({table:t.name,rows});}
const retainedSQL=readFileSync(old+'/drizzle/0000_hesitant_red_skull.sql','utf8');
const retained=new DatabaseSync(':memory:');retained.exec(retainedSQL);const retainedNames=new Set(retained.prepare('SELECT name FROM sqlite_schema WHERE sql IS NOT NULL').all().map(x=>x.name));
// Complete exact study contracts; optional memory families remain truly absent.
const optional=/\b(?:memory_[a-z0-9_]+|scene_source_[a-z0-9_]+|organization_project_nesting|project_containment)\b/i;
const omittedTriggers=catalog.filter(x=>x.type==='trigger'&&optional.test(x.sql));
const eligible=catalog.filter(x=>!omittedTriggers.includes(x));
const wanted=new Set(catalog.filter(x=>/^(generation_study_|authoring_study_)/.test(x.name)).map(x=>x.name));
for(const item of initial)wanted.add(item.table);
// Original reconciliation joins these exact native reservation scope tables.
for(const name of ['project_budget_reservation_scopes','pilot_cost_reservation_scopes'])wanted.add(name);
const reasons={};const traces=new Set();const attempts=[];
function closure(){let changed=true;while(changed){changed=false;for(const row of eligible){if(wanted.has(row.name)||wanted.has(row.tbl_name)){if(!wanted.has(row.tbl_name)){wanted.add(row.tbl_name);reasons[row.tbl_name]="trigger/index parent of "+row.name;changed=true;}if(!wanted.has(row.name)){wanted.add(row.name);changed=true;}for(const fk of row.type==='table'?f.sqlite.prepare('PRAGMA foreign_key_list("'+row.name+'")').all():[]){if(!wanted.has(fk.table)){wanted.add(fk.table);reasons[fk.table]='foreign key from '+row.name;changed=true;}}if(row.type==='trigger'||row.type==='view'){for(const match of row.sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|REFERENCES)\s+["`]?([a-z][a-z0-9_]*)/gi)){if(catalog.some(x=>x.name===match[1])&&!wanted.has(match[1])){wanted.add(match[1]);reasons[match[1]]='DDL dependency from '+row.name;changed=true;}}}}}}}
let successful;
for(let i=0;i<100;i++){
 closure();const f2=outputTestDatabase();let missing=null;const queries=[];
 const originalPrepare=f2.DB.prepare;f2.DB.prepare=(sql)=>{traces.add(sql);queries.push(sql);const s=originalPrepare(sql);const wrap=s=>{for(const m of ['first','all','run']){const base=s[m].bind(s);s[m]=async()=>{try{return await base();}catch(e){if(/no such table: (?:main\.)?([\w]+)/.test(e.message))missing=RegExp.$1;throw e;}};}const bind=s.bind.bind(s);s.bind=(...v)=>wrap(bind(...v));return s;};return wrap(s);};
 const batch=f2.DB.batch.bind(f2.DB);f2.DB.batch=async(ss)=>{try{return await batch(ss);}catch(e){if(/no such table: (?:main\.)?([\w]+)/.test(e.message))missing=RegExp.$1;throw e;}};
 try{
 f2.sqlite.exec(retainedSQL);for(const row of catalog.filter(x=>wanted.has(x.name)&&!retainedNames.has(x.name)))f2.sqlite.exec(row.sql+';');
 for(const {table,rows} of initial)for(const row of rows){const keys=Object.keys(row);f2.sqlite.prepare('INSERT INTO "'+table+'" ('+keys.map(k=>'"'+k+'"').join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));}
 f2.sqlite.function('strftime',{varargs:true},format=>format==='%Y-%m'?'2026-09':'2026-09-24T12:00:00.000Z');
 const env={...f.env,DB:f2.DB,MEDIA:f2.env.MEDIA,OPENAI_PROJECT:'OFFLINE-project',FORMA_GENERATION_STUDY_ENABLED:'1'};
 const config={entries:[{proposal:f.proposal,account:{accountId:hash('P4-SYNTHETIC-account'),region:'us'},credentialSha256:hash('OFFLINE-NON-CREDENTIAL'),projectHeaderSha256:hash('OFFLINE-project')}]};
 const api=createSitesStudyApi(config);const call=async(action,body={})=>{const r=await api(new Request(env.FORMA_GENERATION_STUDY_ORIGIN+SITES_STUDY_PREFIX+action,{method:'POST',headers:{origin:env.FORMA_GENERATION_STUDY_ORIGIN,'content-type':'application/json','oai-authenticated-user-id':'mock-owner','oai-authenticated-user-email':'owner@example.test'},body:JSON.stringify({proposalId:f.proposal.proposalId,...body})}),env);return r.headers.get('content-type')?.startsWith('image/')?{bytes:(await r.arrayBuffer()).byteLength}:r.json();};
 const preview=await call('approval',{action:'preview'});assert.equal(preview.committable,true,JSON.stringify(preview));assert.equal((await call('approval',f.command(preview))).status,'committed');
 const result=await call('execute',{arm:'baseline'});assert.equal(result.reason,'original_charge_unreconciled',JSON.stringify(result));assert((await call('recover',{arm:'baseline'})).bytes>0);await call('stop');
 successful={config,queryCount:queries.length,objects:wanted.size};attempts.push({iteration:i,result:'pass',...successful,config:undefined});f2.sqlite.close();break;
 }catch(e){attempts.push({iteration:i,missing,error:e.message.slice(0,250)});f2.sqlite.close();if(!missing)throw new Error(JSON.stringify(attempts.at(-1)));assert(catalog.some(x=>x.name===missing),'unknown '+missing);wanted.add(missing);reasons[missing]='actual adapter prepare/execute missing table';}
}
assert(successful,'no closure');closure();const added=catalog.filter(x=>wanted.has(x.name)&&!retainedNames.has(x.name));
cpSync(old+'/drizzle',out+'/drizzle',{recursive:true});
const control=`CREATE TABLE p5_rehearsal_run (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, dataset TEXT NOT NULL, phase TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, started INTEGER NOT NULL, requests INTEGER NOT NULL DEFAULT 0, report TEXT, retained_hash TEXT NOT NULL, reads INTEGER NOT NULL DEFAULT 0, writes INTEGER NOT NULL DEFAULT 0);\nCREATE TABLE p5_rehearsal_guard (ok INTEGER NOT NULL CHECK(ok=1));`;
writeFileSync(out+'/drizzle/0001_p5_minimum.sql',added.map(x=>x.sql+';').join('\n--> statement-breakpoint\n')+'\n--> statement-breakpoint\n'+control.replace('\n','\n--> statement-breakpoint\n')+'\n');
const journal=JSON.parse(readFileSync(out+'/drizzle/meta/_journal.json'));journal.entries.push({idx:1,version:'6',when:1790337600000,tag:'0001_p5_minimum',breakpoints:true});writeFileSync(out+'/drizzle/meta/_journal.json',JSON.stringify(journal,null,2)+'\n');
const rows=initial.flatMap(({table,rows})=>rows.map(row=>({sql:'INSERT INTO "'+table+'" ('+Object.keys(row).map(k=>'"'+k+'"').join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')',values:Object.values(row),table})));
const schemaDB=new DatabaseSync(':memory:');schemaDB.exec(retainedSQL);schemaDB.exec(readFileSync(out+'/drizzle/0001_p5_minimum.sql','utf8'));
const schema=schemaDB.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
const manifest={version:'p5-sites-r3-synthetic-only',target:'appgprj_6ab5929a74288191bf37ed429f7a7e20',origin:'https://forma-n10h-synthetic-20260924.reve-ai-0869.chatgpt.site',expiry:'2026-10-01T00:00:00.000Z',ownerEmailSha256:JSON.parse(readFileSync(old+'/src/manifest.json')).ownerEmailSha256,config:successful.config,rows,schema,fixtureTables:schema.filter(x=>x.type==='table'&&!/^(n10h_|p5_rehearsal_)/.test(x.name)).map(x=>x.name),addedTables:added.filter(x=>x.type==='table').map(x=>x.name),pngBase64:Buffer.from(png({width:1536,height:1024})).toString('base64')};
manifest.datasetId=hash(manifest);writeFileSync(out+'/src/dataset.json',JSON.stringify(manifest,null,2)+'\n');
writeFileSync('docs/evidence/generation-p5/sites-r3/schema-closure.json',JSON.stringify({method:'Iterate unchanged actual adapter against retained schema plus exact study contracts; add only missing execution dependencies, FK closure, and all canonical indexes/triggers of included tables. Optional memory schema remains genuinely absent under unchanged negative guards.',retainedObjects:retainedNames.size,fullBaselineObjects:catalog.length,optionalProfile:'No optional memory, scene-source, nesting or containment feature triggers installed. Their canonical table references are absent rather than spoofed. Existing adapter qualification code unchanged. This is a dedicated synthetic minimal profile, not Forma schema equivalence.',omittedOptionalTriggers:omittedTriggers.map(x=>x.name),additionalObjects:added.length,additionalTables:added.filter(x=>x.type==='table').map(x=>x.name),controlObjects:2,reasons,attempts,queries:[...traces],schemaSha256:hash(schema),datasetId:manifest.datasetId,rows:rows.length,pngBytes:Buffer.from(manifest.pngBase64,'base64').length},null,2)+'\n');
console.log(JSON.stringify({addedObjects:added.length,tables:manifest.addedTables,rows:rows.length,attempts:attempts.map(({config,...a})=>a)}));
for(const fn of after.reverse())await fn();
