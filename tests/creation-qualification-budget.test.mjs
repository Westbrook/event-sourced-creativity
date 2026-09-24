import test from 'node:test';
import assert from 'node:assert/strict';
import {richDocumentFromRuns} from '../src/still/vendor/elements/rich-document.js';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {reserveCreationQualificationAttempt} from '../worker/creation-qualification-budget.ts';
import {embedCreationTexts,CREATION_REPRESENTATION as R} from '../worker/creation-vectors.ts';
import {assessCreationSplit,interpretCreationDraft} from '../worker/creation-interpret.ts';
import {configuredCreationReranker,configuredCreationLearnedSearch,deleteCreationLearnedSources,indexCreationLearnedSource} from '../worker/creation-search-providers.ts';
const schema=readFileSync(new URL('../drizzle/candidates/still_creation_qualification_budget.sql',import.meta.url),'utf8');
function fixture(t,{install=true,calls=10}={}){
 const sqlite=new DatabaseSync(':memory:');t.after(()=>sqlite.close());if(install)sqlite.exec(schema);
 const env={STILL_CREATION_QUALIFICATION_RUN_ID:'synthetic-only',DB:{prepare(sql){return{bind(...values){return{async first(){return sqlite.prepare(sql).get(...values)??null;}};}}}},OPENAI_API_KEY:'injected-not-a-key',JEV_API_KEY:'injected-not-a-key',STILL_CREATION_JEV_ENABLED:'true',STILL_CREATION_PROVIDER_CUSTODIES:'["personal:synthetic"]',STILL_CREATION_ORGANIZER_MODEL:'gpt-4.1-mini-2025-04-14'};
 if(install){sqlite.prepare('INSERT INTO creation_qualification_runs VALUES(?,1,?,unixepoch()-3600,unixepoch()+3600,?,?)').run('synthetic-only','canary','a'.repeat(64),'b'.repeat(64));
 for(const scope of ['full','canary'])for(const [provider,model,rate,out] of [['*','*',1,0],['openai:embeddings',R.model,20,0],['openai:organizer',env.STILL_CREATION_ORGANIZER_MODEL,400,1600],['jev','jev-latest',42,0]])sqlite.prepare(`INSERT INTO creation_qualification_limits(run_id,scope,provider,model,max_calls,max_input_units,max_output_tokens,max_nano_usd,max_input_bytes_per_call,max_output_tokens_per_call,input_units_per_byte,input_nano_usd_per_unit,output_nano_usd_per_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('synthetic-only',scope,provider,model,calls,1000000,200000,1000000000,180000,16384,1,rate,out);}
 return{env,sqlite};
}
const signal=()=>AbortSignal.timeout(30000);
const split={draftId:'d',draftRevision:1,nodeId:'i',semanticVersion:'s',contextVersion:'c',text:'Synthetic whole source',newlyExtracted:false,explicit:true,keptTogetherVersions:[]};
const scope={custodyKey:'personal:synthetic',projectId:'p',documentId:null};
const document=richDocumentFromRuns([{kind:'text',text:'Synthetic body'}]);
const draft={id:'d',revision:1,acknowledgedRevision:1,scope,entryKind:'idea',workingDocument:document,originalDocument:document,referenceSelections:[],markers:[],decisions:[]};
const context={sources:[],authority:{existingVersions:[]}};

test('default unset qualification does not touch D1; explicit missing/expired/unauthorized run prevents embedding dispatch',async t=>{
 const f=fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({model:R.model,data:[{index:0,embedding:Array(512).fill(1)}],usage:{total_tokens:1}});});
 await embedCreationTexts({...f.env,STILL_CREATION_QUALIFICATION_RUN_ID:undefined,DB:undefined},['Synthetic'],signal());assert.equal(calls,1);
 for(const mutation of ["UPDATE creation_qualification_runs SET authorized=0","UPDATE creation_qualification_runs SET authorized=1,expires_at=unixepoch()-1"]){f.sqlite.exec(mutation);await assert.rejects(embedCreationTexts(f.env,['Synthetic'],signal()),/qualification_budget/);}
 await assert.rejects(embedCreationTexts({...f.env,STILL_CREATION_QUALIFICATION_RUN_ID:'missing'},['Synthetic'],signal()),/qualification_budget/);
 assert.equal(calls,1);
 const absent=fixture(t,{install:false});await assert.rejects(embedCreationTexts(absent.env,['Synthetic'],signal()),/qualification_budget_unavailable/);assert.equal(calls,1);
});

test('atomic overlap admits only shared allowance; failed requests and restarts never refund reservations',async t=>{
 const f=fixture(t,{calls:2});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('lost response after dispatch');});
 const outcomes=await Promise.allSettled(Array.from({length:8},()=>embedCreationTexts(f.env,['Synthetic'],signal())));assert.equal(outcomes.filter(r=>r.status==='rejected').length,8);assert.equal(calls,2);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM creation_qualification_attempts').get().n,2);
 assert.deepEqual(f.sqlite.prepare("SELECT used_calls FROM creation_qualification_limits WHERE provider='*' ORDER BY scope").all().map(r=>r.used_calls),[2,2]);
 await assert.rejects(embedCreationTexts({...f.env},['Retry after restart'],signal()),/qualification_budget/);assert.equal(calls,2);
});

test('canary and full phases share one lifetime ceiling across embedding, organizer and Jev',async t=>{
 const f=fixture(t,{calls:3});f.sqlite.exec("UPDATE creation_qualification_limits SET max_calls=1 WHERE scope='canary' AND provider='*'");
 await reserveCreationQualificationAttempt(f.env,'openai:embeddings',R.model,'"á"');
 await assert.rejects(reserveCreationQualificationAttempt(f.env,'jev','jev-latest','{}'),/qualification_budget/);
 f.sqlite.exec("UPDATE creation_qualification_runs SET phase='full'");
 await reserveCreationQualificationAttempt(f.env,'openai:organizer',f.env.STILL_CREATION_ORGANIZER_MODEL,'{}',16384);
 await reserveCreationQualificationAttempt(f.env,'jev','jev-latest','{}');
 await assert.rejects(reserveCreationQualificationAttempt(f.env,'openai:embeddings',R.model,'{}'),/qualification_budget/);
 const full=f.sqlite.prepare("SELECT * FROM creation_qualification_limits WHERE scope='full' AND provider='*'").get();assert.equal(full.used_calls,3);assert.equal(full.used_input_units,8);assert.equal(full.used_output_tokens,16384);assert.equal(full.used_nano_usd,4*20+2*400+16384*1600+2*42);
});

test('exact model, serialized UTF8, per-call, aggregate token and nano-USD limits fail closed',async t=>{
 const f=fixture(t);
 await assert.rejects(reserveCreationQualificationAttempt(f.env,'openai:embeddings','wrong-model','{}'),/qualification_budget/);
 for(const edit of ["max_input_bytes_per_call=1","max_input_units=1","max_output_tokens=1","max_nano_usd=1","max_output_tokens_per_call=1"]){const before=f.sqlite.prepare('SELECT * FROM creation_qualification_limits').all();f.sqlite.exec("UPDATE creation_qualification_limits SET "+edit+" WHERE provider='openai:organizer'");await assert.rejects(reserveCreationQualificationAttempt(f.env,'openai:organizer',f.env.STILL_CREATION_ORGANIZER_MODEL,'é',2),/qualification_budget/);f.sqlite.exec('DELETE FROM creation_qualification_limits');for(const row of before)f.sqlite.prepare('INSERT INTO creation_qualification_limits VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));}
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM creation_qualification_attempts').get().n,0);
 assert.throws(()=>f.sqlite.exec("UPDATE creation_qualification_limits SET max_nano_usd=25000000001"));
 assert.throws(()=>f.sqlite.exec("UPDATE creation_qualification_limits SET max_nano_usd=5000000001 WHERE scope='canary'"));
});

test('real organizer, split and rerank dispatch paths consume the shared budget before HTTP',async t=>{
 const f=fixture(t,{calls:3});let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('provider error',{status:500});});
 await assert.rejects(interpretCreationDraft(f.env,draft,context),/provider_http_500/);
 assert.equal((await assessCreationSplit(f.env,split,scope.custodyKey)).status,'unavailable');
 await assert.rejects(configuredCreationReranker(f.env).rank({custody:scope.custodyKey},'synthetic',[],signal()),/provider_http_500/);
 await assert.rejects(interpretCreationDraft(f.env,draft,context),/qualification_budget/);
 assert.equal((await assessCreationSplit(f.env,split,scope.custodyKey)).status,'unavailable');
 await assert.rejects(configuredCreationReranker(f.env).rank({custody:scope.custodyKey},'synthetic',[],signal()),/qualification_budget/);
 assert.equal(calls,3);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM creation_qualification_attempts').get().n,3);
 const organizer=f.sqlite.prepare("SELECT * FROM creation_qualification_attempts WHERE provider='openai:organizer'").get();assert.equal(organizer.output_tokens,16384);assert.ok(organizer.input_units>1000,'reserves instructions/schema and full serialized envelope');
});

test('unmetered service inference is denied in qualification, but identity deletion remains available after exhaustion/expiry',async t=>{
 const f=fixture(t,{calls:0});let calls=0;const service={fetch:async()=>{calls++;return Response.json({});}};Object.assign(f.env,{STILL_CREATION_SEARCH:service,STILL_CREATION_SEARCH_MODEL:'legacy',STILL_CREATION_ORGANIZER:service});
 await assert.rejects(interpretCreationDraft(f.env,draft,context),/qualification_service_metering/);
 await assert.rejects(configuredCreationLearnedSearch(f.env).query({custody:scope.custodyKey},'q',20,signal()),/qualification_service_metering/);
 await assert.rejects(indexCreationLearnedSource(f.env,{custody:scope.custodyKey},{},signal()),/qualification_service_metering/);assert.equal(calls,0);
 f.sqlite.exec('UPDATE creation_qualification_runs SET starts_at=unixepoch()-3600,expires_at=unixepoch()-1');assert.equal(await deleteCreationLearnedSources(f.env,{custody:scope.custodyKey},['synthetic-id']),true);assert.equal(calls,1);
});


test('partial installation or replaced counter trigger cannot dispatch or reserve an uncharged attempt',async t=>{
 const f=fixture(t);let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('must not dispatch');});
 f.sqlite.exec('DROP TRIGGER creation_qualification_consume');
 await assert.rejects(embedCreationTexts(f.env,['Synthetic'],signal()),/qualification_budget/);
 f.sqlite.exec("CREATE TRIGGER creation_qualification_consume AFTER INSERT ON creation_qualification_attempts BEGIN SELECT 1; END");
 await assert.rejects(embedCreationTexts(f.env,['Synthetic'],signal()),/qualification_budget/);
 assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM creation_qualification_attempts').get().n,0);
});

test('actual maintenance fails closed without qualification admission while feature-off orphan cleanup still runs',async t=>{
 const {creationIndexFixture}=await import('./helpers/creation-index-fixture.mjs');
 const {appendAuditEvent}=await import('../worker/runtime.ts');
 const {CREATION_VECTOR_PREFIX}=await import('../worker/creation-vectors.ts');
 const f=await creationIndexFixture(t);f.env.STILL_CREATION_QUALIFICATION_RUN_ID='missing-admission';
 await appendAuditEvent(f.env,f.streamId,'user','ProjectCreated',{project_id:f.projectId,name:'Synthetic qualification'});
 for(let i=0;i<10;i++)await f.tick();
 assert.equal(f.calls.length,0);assert.ok(f.sqlite.prepare("SELECT 1 FROM creation_index_work WHERE state='held' AND error_class='qualification_budget_unavailable'").get());
 f.env.STILL_CREATION_INDEX_ENABLED='false';delete f.env.OPENAI_API_KEY;
 f.objects.set(CREATION_VECTOR_PREFIX+'qualification-orphan',{bytes:new Uint8Array(2048),customMetadata:{}});
 await f.tick();assert.equal(f.objects.size,0);assert.equal(f.calls.length,0);
});
