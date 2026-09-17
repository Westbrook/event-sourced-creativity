import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
const url=new URL('./output-native-execution.test.mjs',import.meta.url),source=fs.readFileSync(url,'utf8');
const tree=ts.createSourceFile(url.pathname,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const code=(source.slice(0,source.indexOf('\ntest('))+'\n'+tree.statements.filter(n=>ts.isFunctionDeclaration(n)&&['png','saveImages'].includes(n.name?.text)).map(n=>n.getText(tree)).join('\n'))
 .replace(/(from\s+|import\s*\()(["'])([^"']+)\2/gu,(_,prefix,quote,spec)=>prefix+JSON.stringify(spec.startsWith('.')?new URL(spec,url).href:spec.startsWith('node:')?spec:import.meta.resolve(spec)))
 +'\nexport {fixture,saveDeck,saveImages,authorize,png,outputFor,handleDocumentJobs,handleOutputRequirements,outputDocumentExecutionBridge,streamHead,appendAuditEvent};';
const native=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const {OUTPUT_DURABLE_SCHEMA}=await import('../worker/output-durable-schema.ts');
const {createOutputDurableRuntime}=await import('../worker/output-durable-runtime.ts');
const {createNativeOutputDurableRuntime}=await import('../worker/output-durable-native.ts');
const {EXPIRED_DOCUMENT_JOB_REDACTION_SQL}=await import('../worker/document-jobs-api.ts');
async function fixture(t,{execute,wake=async()=>{},medium="slides",cold=false,enrollMedia=["slides","image"],allTargets=false}={}){
 const f=await native.fixture();t.after(()=>f.sqlite.close());if(medium==="image")Object.assign(f.env,{FORMA_IMAGE_PROVIDER:"fal-ideogram",FAL_KEY:"offline-test-only",FAL_IMAGE_MODEL:"ideogram/v4"});if(cold)f.env.DB=new Proxy(f.env.DB,{});for(const sql of OUTPUT_DURABLE_SCHEMA)f.sqlite.exec(sql);
 const runtime=execute?await createOutputDurableRuntime(f.env,{wake,execute},{enrollMedia}):await createNativeOutputDurableRuntime(f.env,wake,{enrollMedia});
 const plan=medium==="image"?await native.saveImages(f):await native.saveDeck(f),authorization=await native.authorize(f,plan.planId,allTargets?plan.targetIds:[plan.targetId??plan.targetIds[0]]);
 assert.equal(f.sqlite.prepare('SELECT count(*) n FROM output_durable_jobs').get().n,0,'authorization does not enroll');
 const body={documentId:f.documentId,expectedRevision:`output:${await native.streamHead(f.env,'creative:dev-local-creative')}`,clientMutationId:'durable-run',action:'run',grantId:authorization.grantId};
 const run=()=>native.handleOutputRequirements(new Request('http://localhost/api/output-requirements',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),runtime.env,'/api/output-requirements',{waitUntil(){assert.fail('no detached execution');}},native.outputDocumentExecutionBridge);
 const job=()=>f.sqlite.prepare('SELECT * FROM document_jobs').get();
 return {...f,runtime,run,job,delivery:()=>({version:1,jobId:job().job_id})};
}
test('atomic explicit Run survives a lost wake; synthetic native deck runs once without browser',async t=>{
 let calls=0,wakes=0;t.mock.method(globalThis,'fetch',async(url)=>{calls++;assert.equal(String(url),'https://api.openai.com/v1/responses');return Response.json({id:'durable-deck',model:'gpt-5.6-terra',output_text:JSON.stringify(native.outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const f=await fixture(t,{wake:async()=>{wakes++;throw Error('queue unavailable');}});
 await f.ok(await f.run());assert.equal(calls,0);assert.equal(wakes,1);
 assert.equal(JSON.parse(f.job().request_json).outputDurable,1);
 const browser=await native.handleDocumentJobs(new Request('http://localhost/api/document-jobs/'+f.job().job_id+'/run',{method:'POST'}),f.env,f.job().job_id+'/run');assert.equal(browser.status,409);assert.equal(calls,0);
 assert.deepEqual(await f.runtime.sweep(),{scanned:1,hinted:0});assert.equal(wakes,2);
 const result=await f.runtime.consume(f.delivery());assert.equal(result.phase,'ready',JSON.stringify({result,job:f.job()}));assert.equal(calls,1);
 const before=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();
 assert.equal((await f.runtime.consume(f.delivery())).phase,'ready');assert.equal(calls,1);assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls').all(),before);
 assert.equal((await f.runtime.inspect(f.job().job_id)).lease_token,null);
});
test('hanging Run and sweep hints stay bounded and do not block later due jobs', {timeout:10000}, async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('hints must not execute provider work'));
 let mode='run',firstJob;const seen=[],rejectLate=[];
 const f=await fixture(t,{medium:'image',allTargets:true,wake:delivery=>{
  seen.push(delivery.jobId);
  if(mode==='run'||mode==='sweep'&&delivery.jobId===firstJob)return new Promise((_,reject)=>rejectLate.push(reject));
  return Promise.resolve();
 }});
 await f.ok(await f.run());
 const rows=()=>f.sqlite.prepare('SELECT * FROM output_durable_jobs ORDER BY next_attempt_at,job_id').all();
 const before=rows();assert.equal(before.length,2);assert.equal(seen.length,2);assert.ok(before.every(row=>row.phase==='queued'&&row.lease_token===null));
 firstJob=before[0].job_id;mode='sweep';seen.length=0;
 const sweep=f.runtime.sweep();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(seen,before.map(row=>row.job_id),'healthy later row is hinted while the first hint remains pending');
 assert.deepEqual(await sweep,{scanned:2,hinted:1});assert.deepEqual(rows(),before,'timeouts leave every due row unchanged');
 for(const reject of rejectLate)reject(Error('late enqueue failure'));
 await new Promise(resolve=>setImmediate(resolve));
 mode='healthy';assert.deepEqual(await f.runtime.sweep(),{scanned:2,hinted:2});assert.deepEqual(rows(),before);
});
test('failed outbox insert rolls Run and queued slot back together',async t=>{
 const f=await fixture(t);f.sqlite.exec("CREATE TRIGGER reject_durable BEFORE INSERT ON output_durable_jobs BEGIN SELECT RAISE(ABORT,'outbox_write_failed'); END");
 const result=await f.run();assert.equal(result.status,500,await result.text());
 assert.equal(f.sqlite.prepare("SELECT count(*) n FROM events WHERE type='OutputExecutionRunRequested'").get().n,0);
 assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'authorized');assert.equal(JSON.parse(f.job().request_json).outputDurable,undefined);
});
test('duplicate delivery cannot enter the active lease; stale continuation cannot write',async t=>{
 let release,entered;const entering=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
 const f=await fixture(t,{execute:async env=>{entered();await gate;await env.DB.prepare("UPDATE document_jobs SET error_message='stale' WHERE job_id=?").bind(f.job().job_id).run();return{phase:'uncertain'};}});
 await f.ok(await f.run());const first=f.runtime.consume(f.delivery());await entering;
 assert.equal((await f.runtime.consume(f.delivery())).phase,'busy');
 f.sqlite.prepare('UPDATE output_durable_jobs SET lease_epoch=lease_epoch+1').run();release();await assert.rejects(first);assert.equal(f.job().error_message,null);
});
test('ownership survives retention redaction and runtime deactivation',async t=>{
 const f=await fixture(t);await f.ok(await f.run());f.sqlite.prepare('UPDATE document_jobs SET '+EXPIRED_DOCUMENT_JOB_REDACTION_SQL).run();
 assert.deepEqual(JSON.parse(f.job().request_json),{outputDurable:1});
 assert.throws(()=>f.sqlite.prepare("UPDATE document_jobs SET request_json='{}'").run(),/output_durable_owner_immutable/);
 const read=await native.handleDocumentJobs(new Request('http://localhost/api/document-jobs/'+f.job().job_id+'?inspection=1'),f.env,f.job().job_id);assert.equal(read.status,200);assert.equal((await read.json()).job.executionOwner,'durable');
});
test('candidate runtime fails closed when schema is missing or weakened',async t=>{
 const f=await native.fixture();t.after(()=>f.sqlite.close());await assert.rejects(()=>createNativeOutputDurableRuntime(f.env,async()=>{}),/output_durable_schema_unavailable/);
 for(const sql of OUTPUT_DURABLE_SCHEMA)f.sqlite.exec(sql);f.sqlite.exec('DROP TRIGGER output_durable_owner_immutable');await assert.rejects(()=>createNativeOutputDurableRuntime(f.env,async()=>{}),/output_durable_schema_unavailable/);
});

test('unknown paid acknowledgement stays held and never repeats a planner',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('connection lost after possible acceptance');});
 const f=await fixture(t);await f.ok(await f.run());const result=await f.runtime.consume(f.delivery());assert.equal(result.phase,'uncertain');assert.equal(calls,1);
 assert.equal((await f.runtime.consume(f.delivery())).phase,'uncertain');assert.equal(calls,1);
 assert.ok(f.sqlite.prepare("SELECT count(*) n FROM output_provider_calls WHERE status IN('pending','uncertain')").get().n>0);
 assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');
});
test('source revocation after Run prevents all provider transmission',async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('revoked source must not transmit'));
 const f=await fixture(t);await f.ok(await f.run());
 await native.appendAuditEvent(f.env,'creative:dev-local-creative','user','BlockPropertyEdited',{document_id:f.documentId,block_id:'source-0',property_path:'text',new_value:'Changed after Run'});
 const result=await f.runtime.consume(f.delivery());assert.notEqual(result.phase,'ready');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM output_provider_calls').get().n,0);
});
test('cold consumer qualifies baseline schemas before installing its fence',async t=>{
 const f=await fixture(t,{cold:true,execute:async env=>{await env.DB.prepare('SELECT 1').first();return{phase:'uncertain'};}});
 await f.ok(await f.run());assert.equal((await f.runtime.consume(f.delivery())).phase,'uncertain');
});
test('ready cannot be fabricated by a faulty execution port',async t=>{
 const f=await fixture(t,{execute:async()=>({phase:'ready'})});await f.ok(await f.run());await assert.rejects(()=>f.runtime.consume(f.delivery()));assert.notEqual((await f.runtime.inspect(f.job().job_id)).phase,'ready');
});
test('accepted Image recovers the exact provider request across independent deliveries',async t=>{
 let post=0,planner=0,reads=0,pending=true,readFault=true,width=1024,height=1024;
 t.mock.method(globalThis,'fetch',async(url,init={})=>{
  const address=String(url);
  if(address.endsWith('/responses')){planner++;return Response.json({id:'durable-image-plan',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Sheltered orchard',rationale:'Protect mature roots',scene:'Pear trees beside a sheltered orchard path',palette:['green','ochre'],next_moves:['Review tree spacing']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});}
  if(address.endsWith('/moderations'))return Response.json({id:'safety',results:[{flagged:false,categories:{}}]});
  if(address==='https://queue.fal.run/ideogram/v4'&&init.method==='POST'){
   post++;const body=JSON.parse(init.body);width=body.image_size.width;height=body.image_size.height;
   return Response.json({request_id:'durable-image-original',status:'IN_QUEUE'});
  }
  if(address.endsWith('/status?logs=1'))throw Error('initial status transport lost');
  if(address.endsWith('/status')){reads++;if(readFault){readFault=false;throw new TypeError('temporary GET network failure');}return Response.json({request_id:'durable-image-original',status:pending?'IN_PROGRESS':'COMPLETED'});}
  if(address==='https://queue.fal.run/ideogram/v4/requests/durable-image-original')return Response.json({images:[{url:'https://fal.media/durable-image.png',content_type:'image/png',width,height}],has_nsfw_concepts:[false]});
  if(address==='https://fal.media/durable-image.png')return new Response(native.png(width,height),{headers:{'content-type':'image/png'}});
  assert.fail('unexpected transport '+address);
 });
 const f=await fixture(t,{medium:'image'});await f.ok(await f.run());
 const due=()=>f.sqlite.prepare("UPDATE output_durable_jobs SET next_attempt_at='2000-01-01T00:00:00.000Z'").run();
 const first=await f.runtime.consume(f.delivery());assert.equal(first.phase,'awaiting_provider',JSON.stringify({first,job:f.job(),calls:f.sqlite.prepare('SELECT * FROM output_provider_calls').all()}));
 assert.equal(post,1);assert.equal(planner,1);due();assert.equal((await f.runtime.consume(f.delivery())).phase,'awaiting_provider');assert.equal(reads,1);due();assert.equal((await f.runtime.consume(f.delivery())).phase,'awaiting_provider');assert.equal(reads,2);
 pending=false;due();const final=await f.runtime.consume(f.delivery());assert.equal(final.phase,'ready',JSON.stringify({final,job:f.job()}));
 assert.equal(post,1);assert.equal(planner,1);assert.equal(reads,3);assert.equal(f.media.size,1);
 const captures=f.sqlite.prepare('SELECT * FROM output_provider_calls').all();await f.runtime.consume(f.delivery());assert.deepEqual(f.sqlite.prepare('SELECT * FROM output_provider_calls').all(),captures);assert.equal(post,1);assert.equal(planner,1);assert.equal(reads,3);
});

test('committed publication with unfinished job cannot duplicate publication or usage',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({id:'completion-window',model:'gpt-5.6-terra',output_text:JSON.stringify(native.outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const f=await fixture(t);await f.ok(await f.run());assert.equal((await f.runtime.consume(f.delivery())).phase,'ready');
 const before=f.sqlite.prepare("SELECT event_id,type FROM events WHERE type IN('GenerationUsageRecorded','DocumentRenderCompleted')").all(),media=f.media.size;
 f.sqlite.prepare("UPDATE document_jobs SET status='committing',lease_expires_at='2000-01-01T00:00:00.000Z'").run();
 f.sqlite.prepare("UPDATE output_durable_jobs SET phase='generating',next_attempt_at='2000-01-01T00:00:00.000Z'").run();
 const result=await f.runtime.consume(f.delivery());assert.equal(result.code,'output_durable_completion_reconciliation_required');assert.equal(calls,1);assert.equal(f.media.size,media);assert.deepEqual(f.sqlite.prepare("SELECT event_id,type FROM events WHERE type IN('GenerationUsageRecorded','DocumentRenderCompleted')").all(),before);
});
test('concurrent retention cannot be overwritten by stale-attempt closure',async t=>{
 const f=await fixture(t);await f.ok(await f.run());
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,lease_expires_at='2000-01-01T00:00:00.000Z',result_json=?").run(JSON.stringify({privateSentinel:'erased-source'}));
 const originalBatch=f.env.DB.batch;let erased=false;
 f.env.DB.batch=async statements=>{
  if(!erased&&statements.some(statement=>statement.sql.includes("error_message='execution_interrupted'"))){erased=true;f.sqlite.prepare('UPDATE document_jobs SET '+EXPIRED_DOCUMENT_JOB_REDACTION_SQL).run();}
  return originalBatch(statements);
 };
 await assert.rejects(()=>f.runtime.consume(f.delivery()));assert.equal(erased,true);assert.equal(f.job().result_json,null);assert.deepEqual(JSON.parse(f.job().request_json),{outputDurable:1});
});
test('cancel-requested delivery cannot start paid generation',async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('cancellation cannot start generation'));const f=await fixture(t);await f.ok(await f.run());f.sqlite.prepare("UPDATE output_durable_jobs SET phase='cancel_requested'").run();
 assert.equal((await f.runtime.consume(f.delivery())).code,'output_durable_cancellation_unavailable');assert.equal(f.job().attempt_count,0);
});

test('public generic admission cannot forge durable ownership even without a durable schema',async t=>{
 const f=await native.fixture();t.after(()=>f.sqlite.close());
 const response=await native.handleDocumentJobs(new Request('http://localhost/api/document-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'chat',documentId:f.documentId,payload:{message:'hello',outputDurable:{privateSource:'PRIVATE_SENTINEL'}}})}),f.env,'');
 assert.equal(response.status,400);assert.equal((await response.json()).error,'output_durable_marker_server_owned');assert.equal(f.sqlite.prepare('SELECT count(*) n FROM document_jobs').get().n,0);
});
test('retention canonicalizes malformed legacy markers without preserving private data',async t=>{
 const f=await fixture(t);f.sqlite.prepare("UPDATE document_jobs SET request_json=json_set(request_json,'$.outputDurable',json(?))").run(JSON.stringify({privateSource:'PRIVATE_SENTINEL'}));
 assert.throws(()=>f.sqlite.prepare("UPDATE document_jobs SET request_json='{}'").run(),/output_durable_owner_immutable/);
 f.sqlite.prepare('UPDATE document_jobs SET '+EXPIRED_DOCUMENT_JOB_REDACTION_SQL).run();assert.deepEqual(JSON.parse(f.job().request_json),{outputDurable:1});assert.equal(f.job().result_json,null);
});
test('notification acknowledgement remains available without transferring execution ownership',async t=>{
 const f=await fixture(t);await f.ok(await f.run());
 const response=await native.handleDocumentJobs(new Request('http://localhost/api/document-jobs/'+f.job().job_id+'/ack',{method:'POST'}),f.env,f.job().job_id+'/ack');assert.equal(response.status,200);assert.ok(f.job().notified_at);assert.equal(JSON.parse(f.job().request_json).outputDurable,1);assert.equal(f.job().attempt_count,0);
});

test('drain-only runtime policy never enrolls a new Run or falls back to browser dispatch',async t=>{
 t.mock.method(globalThis,'fetch',async()=>assert.fail('no execution in drain-only mode'));
 const f=await fixture(t,{enrollMedia:[]});assert.equal((await f.run()).status,409);assert.equal(f.sqlite.prepare('SELECT count(*) n FROM output_durable_jobs').get().n,0);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'authorized');
});
