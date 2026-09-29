// Disposable local compiled-Worker check. No managed Site, real account or provider.
import{createRequire}from'node:module';import{readFileSync,writeFileSync,readdirSync,mkdtempSync}from'node:fs';import{resolve}from'node:path';import{execFileSync}from'node:child_process';import{createHash}from'node:crypto';import assert from'node:assert/strict';
const require=createRequire(import.meta.resolve('wrangler/package.json'));const{Miniflare}=require('miniflare');const out='docs/evidence/generation-p5/forma-r36',dir=mkdtempSync('/private/tmp/p5-pair-workerd-');const config=JSON.parse(readFileSync('dist/server/wrangler.json'));const egress=[],receipts=[],checks=[];
const options={modules:true,scriptPath:resolve('dist/server/index.js'),modulesRoot:resolve('dist/server'),modulesRules:[{type:'ESModule',include:['**/*.js']},{type:'CompiledWasm',include:['**/*.wasm']}],compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,d1Databases:['DB'],r2Buckets:['MEDIA'],d1Persist:dir+'/d1',r2Persist:dir+'/r2',bindings:{},serviceBindings:{ASSETS:()=>new Response('ordinary-asset-canary')},outboundService:r=>{egress.push(r.url);throw Error('unexpected outbound');}};let mf=new Miniflare(options);const keep=setInterval(()=>{},1000);
const origin='https://forma-creative-studio.reve-ai-0869.chatgpt.site',path='/api/internal/generation-study/hold-classification';const headers={'oai-authenticated-user-id':'LOCAL-SYNTHETIC-HOLD-OWNER','oai-authenticated-user-email':'westbrook.johnson@reve.art'};
async function call(route=path,init={}){const r=await mf.dispatchFetch(origin+route,{...init,headers:{...headers,...init.headers}});const result=await r.json();receipts.push({route,status:r.status,result});return result;}
try{
 assert.equal((await call()).status,'disabled');checks.push('full compiled hold route default off before any schema/principal');
 await(await mf.getD1Database('DB')).prepare('SELECT 1').first();await mf.dispose();
 const walk=p=>readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):[p+'/'+e.name]);const files=walk(dir+'/d1').filter(p=>p.endsWith('.sqlite')&&!p.endsWith('/metadata.sqlite'));assert.equal(files.length,1);
 const policy=readFileSync('worker/policy-version.ts','utf8').match(/POLICY_VERSION\s*=\s*["']([^"']+)/)[1];
 const migrations=JSON.parse(readFileSync('build/memory-migration-release.json')).files.map(f=>'drizzle/'+f.path);
 execFileSync('python3',['-c',`import sqlite3,json,sys
p=json.load(sys.stdin);c=sqlite3.connect(p['file']);c.execute('PRAGMA foreign_keys=ON')
for f in p['inputs']:c.executescript(open(f).read())
c.execute("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,'admin',?,?,?,?)",['LOCAL-SYNTHETIC-HOLD-OWNER','westbrook.johnson@reve.art','PRIVATE-LOCAL-CANARY',p['policy'],'2026-09-28','2026-09-28','2026-09-28'])
c.execute("INSERT INTO cost_budget_reservations(reservation_id,owner_id,operation,period,reserved_microusd,status,created_at,updated_at) VALUES('PRIVATE-CANARY','LOCAL-SYNTHETIC-HOLD-OWNER','private-operation','2026-09',12345,'active','2026-09-28','2026-09-28')")
c.commit();c.close()
`],{input:JSON.stringify({file:files[0],inputs:migrations,policy}),encoding:'utf8'});
 options.bindings.FORMA_GENERATION_STUDY_HOLD_READ_ENABLED='1';mf=new Miniflare(options);const db=await mf.getD1Database('DB');
 const before=(await db.prepare('SELECT * FROM cost_budget_reservations').all()).results;const schemaBefore=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()).results;
 const first=await call();assert.equal(first.status,'observed-not-cleared',JSON.stringify(first));assert.equal(first.groups.cost.reservationCount,1);assert.equal(first.metrics.writes,0);assert.equal(first.uniqueOperations,null);assert(!/PRIVATE-CANARY|LOCAL-SYNTHETIC|12345|private-operation/.test(JSON.stringify(first)));checks.push('real local D1 metrics with fixed redacted aggregation; no identifiers, money or finality');
 assert.equal((await call(path+'?sql=DROP')).status,'unavailable');assert.equal((await call(path,{headers:{'oai-authenticated-user-id':''}})).status,'unavailable');checks.push('caller query and absent identity refuse');
 for(const action of ['approval','execute'])assert.equal((await call('/api/internal/generation-study/'+action,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,'disabled');
 assert.equal((await call('/api/internal/generation-study/qualification/custody',{method:'POST',body:'{}'})).status,'disabled');assert.equal((await call('/api/internal/generation-study/qualification')).status,'not-found');checks.push('paid/custody controls off; old qualification route retired');
 assert.equal(await(await mf.dispatchFetch(origin+'/robots.txt')).text(),'ordinary-asset-canary');checks.push('ordinary asset route intact');
 assert.deepEqual((await db.prepare('SELECT * FROM cost_budget_reservations').all()).results,before);assert.deepEqual((await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()).results,schemaBefore);assert.equal((await(await mf.getR2Bucket('MEDIA')).list()).objects.length,0);checks.push('catalog/holds unchanged; empty local R2');
 assert.equal(egress.length,0);checks.push('zero outbound attempts');
 writeFileSync(out+'/compiled-validation.json',JSON.stringify({method:'compiled full Worker with disposable local D1/R2; 41 released SQL files applied directly to synthetic local fixture; no native migration machinery or hosted fit certification',checks,requests:receipts.length,networkAttempts:egress.length,workerSha256:createHash('sha256').update(readFileSync('dist/server/index.js')).digest('hex'),firstReadMetrics:first.metrics,actualFormaQualified:false,receipts},null,2)+'\n');console.log(JSON.stringify({checks:checks.length,networkAttempts:egress.length,metrics:first.metrics}));
}finally{clearInterval(keep);await mf.dispose();}
