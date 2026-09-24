import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const wranglerPath=require.resolve('wrangler');
const {Miniflare}=require(require.resolve('miniflare',{paths:[wranglerPath]}));
const {build}=require(require.resolve('esbuild',{paths:[wranglerPath]}));

// Standalone TEST-ONLY worker: imports the real admission helper, has no production
// routes, secrets, external fetch, application bundle or deployment requirement.
// Native local D1 syntax/concurrency proof is not hosted billing qualification.
test('native local D1 atomically caps concurrent qualification calls and denies partial schema', {timeout:60000}, async t=>{
 const result=await build({stdin:{contents:`import {reserveCreationQualificationAttempt} from './worker/creation-qualification-budget.ts';
 export default {async fetch(request,env){try{
  const receipt=await reserveCreationQualificationAttempt(env,'openai:embeddings','text-embedding-3-small',JSON.stringify({input:'Synthetic text only'}));
  // Model dispatch is deliberately simulated after real durable admission.
  return Response.json({allowed:true,receipt,simulatedDispatch:true},{status:request.headers.has('x-test-lost-response')?503:200});
 }catch(error){return Response.json({allowed:false,code:error.code??'unexpected-error'},{status:429});}}};`,resolveDir:resolve('.'),sourcefile:'qualification-budget-test-entry.ts',loader:'ts'},bundle:true,format:'esm',platform:'browser',target:'es2022',write:false});
 const mf=new Miniflare({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-05-22',d1Databases:['DB'],bindings:{STILL_CREATION_QUALIFICATION_RUN_ID:'local-workerd-synthetic'}});
 t.after(()=>mf.dispose());
 const db=await mf.getD1Database('DB');
 const schema=await readFile(new URL('../../drizzle/candidates/still_creation_qualification_budget.sql',import.meta.url),'utf8');
 for(const sql of schema.split('--> statement-breakpoint'))await db.prepare(sql.trim()).run();
 await db.prepare(`INSERT INTO creation_qualification_runs(run_id,authorized,phase,starts_at,expires_at,authorization_sha256,pricing_sha256)
 VALUES('local-workerd-synthetic',1,'canary',unixepoch()-60,unixepoch()+3600,?,?)`).bind('a'.repeat(64),'b'.repeat(64)).run();
 for(const scope of ['full','canary'])for(const provider of ['*','openai:embeddings'])await db.prepare(`INSERT INTO creation_qualification_limits
 (run_id,scope,provider,model,max_calls,max_input_units,max_output_tokens,max_nano_usd,max_input_bytes_per_call,max_output_tokens_per_call,input_units_per_byte,input_nano_usd_per_unit,output_nano_usd_per_token)
 VALUES('local-workerd-synthetic',?,?,?,2,48000,0,1000000000,24000,0,1,20,0)`).bind(scope,provider,provider==='*'?'*':'text-embedding-3-small').run();
 const worker=await mf.getWorker();
 const dispatch=async(lost=false)=>{const response=await worker.fetch('http://qualification-test.invalid/',{headers:lost?{'x-test-lost-response':'true'}:{}});return{status:response.status,...await response.json()};};
 const overlap=await Promise.all(Array.from({length:12},()=>dispatch(true)));
 const admitted=overlap.filter(r=>r.allowed);assert.equal(admitted.length,2);assert.ok(admitted.every(r=>r.status===503),'failed simulated dispatches remain consumed');assert.equal(new Set(admitted.map(r=>r.receipt)).size,2);assert.ok(overlap.filter(r=>!r.allowed).every(r=>r.status===429));
 const rows=await db.prepare('SELECT used_calls,used_input_units,used_nano_usd FROM creation_qualification_limits').all();assert.equal(rows.results.length,4);assert.ok(rows.results.every(row=>row.used_calls===2&&row.used_input_units>0&&row.used_nano_usd===row.used_input_units*20));
 assert.equal((await db.prepare('SELECT count(*) n FROM creation_qualification_attempts').first()).n,2);
 assert.equal((await dispatch()).allowed,false,'retry remains charged even if a simulated response failed');
 // Give the disposable fixture extra authorization so revocation/expiry/schema
 // failures are isolated from exhaustion. Counters and spent attempts stay intact.
 await db.prepare('UPDATE creation_qualification_limits SET max_calls=10').run();
 await db.prepare("UPDATE creation_qualification_runs SET authorized=0 WHERE run_id='local-workerd-synthetic'").run();
 assert.equal((await dispatch()).allowed,false);
 await db.prepare("UPDATE creation_qualification_runs SET authorized=1,expires_at=unixepoch()-1 WHERE run_id='local-workerd-synthetic'").run();
 assert.equal((await dispatch()).allowed,false);
 // Missing/no-op trigger must be the actual reason for denial, not expiry/exhaustion.
 await db.prepare("UPDATE creation_qualification_runs SET expires_at=unixepoch()+3600").run();
 await db.prepare('DROP TRIGGER creation_qualification_consume').run();
 assert.equal((await dispatch()).allowed,false,'partial migration cannot dispatch');
 await db.prepare('CREATE TRIGGER creation_qualification_consume AFTER INSERT ON creation_qualification_attempts BEGIN SELECT 1; END').run();
 assert.equal((await dispatch()).allowed,false,'same-name unmetered trigger cannot dispatch');
 assert.equal((await db.prepare('SELECT count(*) n FROM creation_qualification_attempts').first()).n,2);
 console.log(JSON.stringify({evidence:'local-workerd-native-D1-only',concurrentRequests:12,admitted:2,attemptRows:2,allFourLimitsConsumed:true,exhaustionDenied:true,revocationDenied:true,expiryDenied:true,missingAndReplacedTriggerDenied:true,externalProviderCalls:0,hostedBillingQualified:false}));
});
