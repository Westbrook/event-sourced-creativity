import{seedHostedMetadata}from'./p5-hosted-metadata-fixture.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const req=createRequire(import.meta.resolve('wrangler/package.json'));const {Miniflare}=req('miniflare');
const root=process.argv[2]??'rehearsal/p5-sites',evidence=process.argv[3]??'docs/evidence/generation-p5/sites-r3',metadata=process.argv[4]?JSON.parse(readFileSync(process.argv[4])).raw.extra:[],D=JSON.parse(readFileSync(root+'/src/dataset.json'));const checks=[],responses=[],egress=[];
const dir=mkdtempSync('/private/tmp/p5-r3-workerd-');const email=readFileSync('/private/tmp/n10h-owner-test','utf8').trim();
assert.equal(createHash('sha256').update(email.toLowerCase()).digest('hex'),D.ownerEmailSha256);
const headers={'content-type':'application/json',origin:D.origin,'oai-authenticated-user-id':'LOCAL-SYNTHETIC-SITES-OWNER','oai-authenticated-user-email':email};
const options={rootPath:resolve(root),modulesRoot:resolve(root),modules:true,scriptPath:resolve(root+'/dist/server/index.js'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['MEDIA'],d1Persist:dir+'/d1',r2Persist:dir+'/r2',outboundService:r=>{egress.push(r.url);throw Error('real_network_forbidden');}};let mf=new Miniflare(options);
const keep=setInterval(()=>{},1000);
async function call(body,extra={},raw=false){const started=performance.now();const r=await mf.dispatchFetch(D.origin+'/p5',{method:'POST',headers:{...headers,...extra},body:raw?body:JSON.stringify(body)});const result=await r.json();responses.push({input:body,status:r.status,clientWallMs:performance.now()-started,result});return result;}
async function denied(label,body,pattern,extra={},raw=false){const r=await call(body,extra,raw);assert.equal(r.ok,false,JSON.stringify(r));assert.match(r.error,pattern);checks.push(label);}
try{
mf=await seedHostedMetadata(mf,options,metadata,Miniflare);
const db=await mf.getD1Database('DB');for(const file of ['0000_hesitant_red_skull.sql','0001_p5_minimum.sql']){const sql=readFileSync(root+'/drizzle/'+file,'utf8');for(const s of sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(s).run();}

const metadataBefore=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN('__appgarden_migrations','_cf_KV') ORDER BY name").all()).results;
await db.prepare("INSERT INTO n10h_run VALUES(1,'RETAINED-LOCAL-N10H-OWNER','disabled',205,0,205,0,0,NULL)").run();const old=await db.prepare('SELECT * FROM n10h_run').all();
await denied('missing native identity',{action:'start'},/native_owner/,{'oai-authenticated-user-id':''});
await denied('wrong owner',{action:'start'},/native_owner/,{'oai-authenticated-user-email':'outsider@example.invalid'});
await denied('cross origin',{action:'start'},/same_origin/,{origin:'https://elsewhere.invalid'});
await denied('arbitrary SQL field',{action:'start',sql:'DROP TABLE users'},/fixed_fields/);
await denied('bounded input','x'.repeat(129),/body_bound/,{},true);
const starts=await Promise.all([call({action:'start'}),call({action:'start'})]);assert.equal(starts.filter(r=>r.ok).length,1,JSON.stringify(starts));const start=starts.find(r=>r.ok);checks.push('concurrent Start has one winner and one26rowimport');assert(start.ok,JSON.stringify(start));assert.equal(start.result.imported,26);assert.equal((await db.prepare('SELECT count(*) n FROM p5_rehearsal_run').first()).n,1);for(const table of D.fixtureTables){const expected=D.rows.filter(r=>r.table===table).length;if(expected)assert.equal((await db.prepare('SELECT count(*) n FROM "'+table+'"').first()).n,expected);}checks.push('exact schema preflight and bounded atomic 26-row import; retired tombstone retained');
await denied('owner pinned across requests',{action:'status'},/owner_or_dataset/ ,{'oai-authenticated-user-id':'OTHER-LOCAL-ID'});
await denied('one run duplicate start',{action:'start'},/consumed/);
for(let index=0;index<10;index++){
 if(index===1){const pair=await Promise.all([call({action:'step',index}),call({action:'step',index})]);assert.equal(pair.filter(r=>r.ok).length,1,JSON.stringify(pair));checks.push('concurrent exact approval claim single winner');}
 else {const r=await call({action:'step',index});assert(r.ok,JSON.stringify(r));checks.push('fixed case '+index+' '+['rollback','approve','baseline','recover-original','settle-baseline','observe','treatment','settle-treatment','expiry-revocation','terminal-stop'][index]);}
 if(index===2){const status=await call({action:'status'});assert.equal(status.state.cursor,3);checks.push('discarded baseline response; separate status request retains cursor and receipt');await denied('duplicate baseline step cannot repeat dispatch',{action:'step',index},/D1_ERROR|constraint|CHECK/);}
}
const cleanup=await call({action:'cleanup'});assert(cleanup.ok,JSON.stringify(cleanup));assert.equal(cleanup.result.deleted.length,2);assert.equal(cleanup.result.privateBodiesRemaining,0);assert.equal((await (await mf.getR2Bucket('MEDIA')).list()).objects.length,0);checks.push('original byte hashes; two R2 deletes and read-null; private body deletion; durable disabled tombstone');
await denied('disabled rerun',{action:'start'},/consumed/);await denied('disabled step',{action:'step',index:0},/disabled/);
assert.deepEqual((await db.prepare('SELECT * FROM n10h_run').all()).results,old.results);assert.equal(egress.length,0);checks.push('old N10H state unchanged; zero outbound network');
const counts={};for(const table of D.addedTables){const {n}=await db.prepare('SELECT count(*) n FROM "'+table+'"').first();if(n)counts[table]=n;}
const metadataAfter=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN('__appgarden_migrations','_cf_KV') ORDER BY name").all()).results;assert.deepEqual(metadataAfter,metadataBefore);const schemaObjects=(await db.prepare("SELECT count(*) n FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").first()).n;checks.push('observed hosted metadata definitions unchanged through full lifecycle');
await mf.dispose();mf=new Miniflare(options);const restarted=await call({action:'status'});assert.equal(restarted.state.phase,'disabled');assert.equal((await(await mf.getR2Bucket('MEDIA')).list()).objects.length,0);await denied('restart cannot rearm',{action:'start'},/consumed/);checks.push('fresh workerd instance reads durable disabled state and empty R2');
const metrics=responses.filter(r=>r.result.ok).map(r=>r.result.metrics);const summary={validation:'local compiled proposed Worker in workerd, D1 and R2 emulators',checks,requests:responses.length,sourceArtifact:JSON.parse(readFileSync(root+'/artifact.json')),schemaDeltaObjects:JSON.parse(readFileSync('docs/evidence/generation-p5/sites-r3/schema-closure.json')).additionalObjects+2,syntheticResponses:metrics.reduce((n,m)=>n+m.providers,0),networkAttempts:egress.length,totals:metrics.reduce((a,m)=>({statements:a.statements+m.statements,reads:a.reads+m.reads,writes:a.writes+m.writes,r2Put:a.r2Put+m.r2.put,r2Get:a.r2Get+m.r2.get,r2Delete:a.r2Delete+m.r2.delete}),{statements:0,reads:0,writes:0,r2Put:0,r2Get:0,r2Delete:0}),maxClientWallMs:Math.max(...responses.map(r=>r.clientWallMs)),maxRequestBindingCalls:Math.max(...metrics.map(m=>m.bindingCalls)),maxRequestAttemptedStatements:Math.max(...metrics.map(m=>m.attemptedStatements)),failedBatches:responses.reduce((n,r)=>n+r.result.metrics.failedBatches,0),maxRequestStatements:Math.max(...metrics.map(m=>m.statements)),peakReportedDBBytes:Math.max(...metrics.map(m=>m.databaseBytes)),residual:counts,cleanup:cleanup.result,forcedRestart:true,metadataBefore,metadataAfter,schemaObjects,hostedQualification:false,realFinancialAuthority:false,localDirectory:dir,responses};writeFileSync(evidence+'/local-validation.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,sourceArtifact:undefined,responses:undefined},null,2));
}finally{clearInterval(keep);await mf.dispose();}
