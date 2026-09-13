import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
const hook=registerOutputSourceImports();
const {prepareOutputImageProviderHealth}=await import('../worker/output-image-provider-health.ts');
const {configuredImageHealthIdentity}=await import('../worker/generation-readiness.ts');
test.after(()=>hook.deregister());
function fixture(provider='openai',model='gpt-image-2'){
 const f=outputTestDatabase();f.sqlite.exec("CREATE TABLE output_atomic_assertions(token TEXT PRIMARY KEY,passed INTEGER CHECK(passed=1));CREATE TABLE provider_health(scope_key TEXT PRIMARY KEY,status TEXT,scope TEXT,message TEXT,observed_at TEXT,expires_at TEXT,retry_after_ms INTEGER,request_id TEXT);CREATE TABLE output_provider_calls(scope_key TEXT,slot_id TEXT,call_key TEXT,client_request_id TEXT,request_digest TEXT,provider TEXT,model TEXT,status TEXT,provider_response_id TEXT,used_microusd INTEGER);CREATE TABLE published(id TEXT);");
 Object.assign(f.env,provider==='fal'?{FORMA_IMAGE_PROVIDER:'fal',FAL_IMAGE_MODEL:model}:{OPENAI_IMAGE_MODEL:model,OPENAI_PROJECT:'project'});
 const input={job:{kind:'generate',job_id:'job',stream_id:'stream',correlation_id:'job:attempt:1',document_id:'doc',source_surface:'outputs'},slot:{scopeKey:'scope',slotId:'slot'},events:[{eventId:'event',type:'GenerationCompleted',actor:'worker:generator',streamId:'stream',correlationId:'job:attempt:1',payload:{document_id:'doc',source_surface:'outputs',simulation:false,media_type:'image/png',source_content_hash:'a'.repeat(64),provider_submission_id:'client',provider_request_id:'response',provider,model_id:model}}],routes:[{stage:'image:initial',provider,model}],claimedCalls:new Map([['client',{callKey:'image:initial',provider,model,operation:'image',pending:true,dispatched:true,settled:true,requestDigest:'digest'}]]),observedReceipts:new Map([['client',{clientRequestId:'client',provider,operation:'image',model,status:'completed',providerRequestId:'response',costMicrousd:42}]])};
 f.sqlite.prepare('INSERT INTO output_provider_calls VALUES (?,?,?,?,?,?,?,?,?,?)').run('scope','slot','image:initial','client','digest',provider,model,'settled','response',42);
 return{...f,input};
}
for(const provider of ['openai','fal'])test(provider+' exact dispatched and settled native image marks only matching health with request ID',async()=>{
 const f=fixture(provider,provider==='fal'?'ideogram/v4':'gpt-image-2');try{const sidecars=prepareOutputImageProviderHealth(f.env,f.input);assert.equal(sidecars.length,3);await f.DB.batch([f.DB.prepare("INSERT INTO published VALUES ('event')"),...sidecars]);const rows=f.sqlite.prepare('SELECT * FROM provider_health').all();assert.equal(rows.length,1);assert.equal(rows[0].scope_key,provider==='fal'?'fal:ideogram/v4':'openai:project:gpt-image-2');assert.equal(rows[0].request_id,'response');assert.equal(rows[0].status,'healthy');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM output_atomic_assertions').get().n,0);}finally{f.sqlite.close();}
});
test('configured scope retains existing aliases/defaults without treating fallback route as proof',()=>{
 for(const name of ['fal','fal-ideogram','ideogram'])assert.deepEqual(configuredImageHealthIdentity({FORMA_IMAGE_PROVIDER:name}),{provider:'fal',model:'ideogram/v4'});
 assert.deepEqual(configuredImageHealthIdentity({}),{provider:'openai',model:'gpt-image-2'});
 const f=fixture();try{f.env.FORMA_IMAGE_PROVIDER='fal';assert.equal(prepareOutputImageProviderHealth(f.env,f.input).length,0);}finally{f.sqlite.close();}
});
const negatives=[
 ['document completion',x=>{x.job.kind='render_document';x.events[0].type='DocumentRenderCompleted';}],
 ['generic generated document',x=>x.job.kind='render_document'],['wrong event type',x=>x.events[0].type='DocumentRenderCompleted'],
 ['simulation',x=>x.events[0].payload.simulation=true],['wrong actor',x=>x.events[0].actor='worker:scout'],
 ['wrong stream',x=>x.events[0].streamId='other'],['wrong correlation',x=>x.events[0].correlationId='other'],
 ['wrong Document',x=>x.events[0].payload.document_id='other'],['non-output source',x=>x.job.source_surface='studio'],
 ['non-image media',x=>x.events[0].payload.media_type='audio/mpeg'],['missing image hash',x=>delete x.events[0].payload.source_content_hash],
 ['reused/adopted inherited receipt only',x=>x.claimedCalls.clear()],['unclaimed submission',x=>x.events[0].payload.provider_submission_id='other'],
 ['no pending boundary',x=>x.claimedCalls.get('client').pending=false],['undispatched',x=>x.claimedCalls.get('client').dispatched=false],
 ['unsettled',x=>x.claimedCalls.get('client').settled=false],['no settlement witness',x=>delete x.claimedCalls.get('client').settled],
 ['planning call',x=>x.claimedCalls.get('client').operation='planning'],['video call',x=>x.claimedCalls.get('client').operation='video'],
 ['audio call',x=>x.claimedCalls.get('client').operation='audio'],['3d call',x=>x.claimedCalls.get('client').operation='model3d'],
 ['storyboard frame',x=>x.claimedCalls.get('client').callKey='image:frame:0'],
 ['wrong route provider',x=>x.routes[0].provider='fal'],['wrong route model',x=>x.routes[0].model='other'],
 ['wrong event provider',x=>x.events[0].payload.provider='fal'],['wrong event model',x=>x.events[0].payload.model_id='other'],
 ['pending receipt',x=>x.observedReceipts.get('client').status='pending'],['accepted receipt',x=>x.observedReceipts.get('client').status='accepted'],
 ['rejected receipt',x=>x.observedReceipts.get('client').status='rejected'],['missing measured cost',x=>delete x.observedReceipts.get('client').costMicrousd],
 ['invalid measured cost',x=>x.observedReceipts.get('client').costMicrousd=-1],['wrong receipt request',x=>x.observedReceipts.get('client').providerRequestId='other'],
 ['wrong receipt model',x=>x.observedReceipts.get('client').model='other'],['missing request ID',x=>delete x.events[0].payload.provider_request_id],
 ['duplicate completion',x=>x.events.push(structuredClone(x.events[0]))]
];
for(const [name,change]of negatives)test(name+' leaves image health untouched',()=>{const f=fixture();try{change(f.input);assert.equal(prepareOutputImageProviderHealth(f.env,f.input).length,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM provider_health').get().n,0);}finally{f.sqlite.close();}});
for(const [column,value]of [['status','uncertain'],['provider','fal'],['model','other'],['request_digest','other'],['provider_response_id','other'],['used_microusd',43]])test('atomic publication rolls back when durable '+column+' no longer matches',async()=>{
 const f=fixture();try{const sidecars=prepareOutputImageProviderHealth(f.env,f.input);f.sqlite.prepare('UPDATE output_provider_calls SET '+column+'=?').run(value);await assert.rejects(()=>f.DB.batch([f.DB.prepare("INSERT INTO published VALUES ('event')"),...sidecars]));assert.equal(f.sqlite.prepare('SELECT count(*) n FROM published').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM provider_health').get().n,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM output_atomic_assertions').get().n,0);}finally{f.sqlite.close();}
});
test('sidecar wiring preserves existing personal rollback and project last-result ordering',()=>{
 const source=readFileSync(new URL('../worker/output-execution-control.ts',import.meta.url),'utf8');assert(source.includes('...prepareOutputImageProviderHealth(env,{job,slot,events,routes:settings.calls,claimedCalls,observedReceipts}),...prepareOutputNativeProjectPublicationStatements'));
 assert(source.includes("scope.kind===\"personal\"&&events.length?outputAssertionStatements"));assert(source.includes('publicationScopesComplete=Number(results.at(-1)?.meta.changes??0)===1'));
 assert(source.indexOf('call.settled=receipt.status==="completed"&&known')>source.indexOf('await settleOutputProviderCall(env,'));
});
