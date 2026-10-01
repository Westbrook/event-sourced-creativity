import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {compileSqliteExpressionDepth} from './helpers/d1-expression-depth.mjs';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {snapshot,outputFor,flexible} from './output-presentation-fixtures.mjs';
registerOutputSourceImports();
const [
 {handleSession,POLICY_VERSION,reconcileFailedBudgetReservations,requireUser},
 {handleEvents}, {handleDocumentJobs}, {handleWorkspaces}, {outputImageBudget},
 {reconcileOutputNativeStorage}, {handleOutputRequirements},
 {outputDocumentExecutionBridge,outputExactImageRender},
 {appendAuditEvent,streamHead,readWorkspaceEvents}, {parseOutputRequirement}, {inspectOutputAsset}, {releaseUndispatchedOutputReservations,loadOutputJobBinding,createOutputEventExecution},
]=await Promise.all([
 import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/document-jobs-api.ts'),
 import('../worker/workspaces-api.ts'),import('../worker/output-image-budget.ts'),import('../worker/output-private-execution.ts'),
 import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),import('../worker/runtime.ts'),
 import('../src/model/output-requirements.ts'),import('../src/model/output-asset-inspection.ts'),import('../worker/output-execution-control.ts'),
]);

const {estimateOpenAITextCallMaximumMicrousd}=await import('../worker/openai-text-cost.ts');
const BASE='/api/output-requirements';
const init=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const stream='creative:dev-local-creative';
async function fixture(facts=snapshot().facts.filter(fact=>String(fact.type).toLowerCase()!=='output'),{shared=false}={}){
 const f=outputTestDatabase();Object.assign(f.env,{OPENAI_API_KEY:'transport-test-only',OPENAI_MODEL:'gpt-5.6-terra',OPENAI_IMAGE_MODEL:'gpt-image-2'});
 assert.equal((await handleSession(new Request('http://localhost/api/session'),f.env)).status,200);
 f.sqlite.exec(readFileSync(new URL('../drizzle/0029_image_recovery_scan.sql',import.meta.url),'utf8'));
 f.sqlite.exec(readFileSync(new URL('../drizzle/0031_image_recovery_terminal_scan.sql',import.meta.url),'utf8'));
 f.sqlite.prepare('UPDATE users SET consent_version=?').run(POLICY_VERSION);
 assert.equal((await handleEvents(new Request('http://localhost/api/events'),f.env)).status,200);
 const documentId='native-output-fixture';
 await appendAuditEvent(f.env,stream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Community stewardship'});
 for(const [index,fact]of facts.entries())await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index),properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}});
 let command=0;let headers={},organizationId=null,projectAccessId=null,contextId=null;
 const workspace=async(path,body)=>handleWorkspaces(new Request(`http://localhost/api/workspaces${path.length?'/'+path.join('/'):''}`,body?init(body):{method:'POST'}),f.env,path);
 if(shared){
  const created=await workspace([],{name:'Native Output shared fixture'});assert.equal(created.status,201,JSON.stringify(await created.clone().json()));organizationId=(await created.json()).organizationId;
  const attached=await workspace([organizationId,'projects'],{projectId:'project-atmosphere'});assert.equal(attached.status,201,JSON.stringify(await attached.clone().json()));projectAccessId=(await attached.json()).projectAccessId;
  const opened=await workspace([organizationId,'projects',projectAccessId,'context']);assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
  headers={cookie:opened.headers.get('set-cookie').split(';')[0]};contextId=decodeURIComponent(headers.cookie.split('=').slice(1).join('='));
  const loaded=await handleEvents(new Request('http://localhost/api/events',{headers}),f.env);assert.equal(loaded.status,200,'the client loads its canonical shared history after opening a context');
 }

 const executionContext={waitUntil(){throw new Error('Paid output must use the existing foreground runner, not detached waitUntil');}};
 const request=async(path=BASE,body)=>handleOutputRequirements(new Request(`http://localhost${path}${body?'':`${path.includes('?')?'&':'?'}documentId=${documentId}`}`,{...(body?init(body):{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers}}),f.env,path.split('?')[0],executionContext,outputDocumentExecutionBridge);
 const send=async(body,key)=>request(BASE,{documentId,expectedRevision:`output:${await streamHead(f.env,stream)}`,clientMutationId:key??`native-command-${++command}`,...body});
 const ok=async response=>{const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;};
 // This is the existing browser job workflow: Start returns first, then a
 // list request discovers queued jobs and separate /run requests execute them.
 const driveJobs=async()=>{
  const listed=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs?document=${documentId}`,{headers}),f.env,'');
  if(!listed.ok)return listed;
  const jobs=(await listed.json()).jobs.filter(job=>job.status==='queued').sort((a,b)=>a.requestedAt.localeCompare(b.requestedAt)||a.jobId.localeCompare(b.jobId));
  for(const job of jobs)await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.jobId}/run`,{method:'POST',headers}),f.env,`${job.jobId}/run`);
 };
 const startAndDrive=async(body,key)=>{const response=await send(body,key);if(response.ok)await driveJobs();return response;};
 return {...f,documentId,request,send,ok,headers,organizationId,projectAccessId,contextId,driveJobs,startAndDrive};
}
async function saveDeck(f){
 const parsed=parseOutputRequirement({id:'output-assignment',type:'Output',subtype:'Executive summary',content:'1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document.'});
 assert.ok(parsed.spec);
 const deck=parsed.spec.deliverables.find(d=>d.media_kind==='slides');assert.ok(deck);
 await f.ok(await f.send({action:'save',blockId:parsed.spec.id,spec:parsed.spec}));
 const confirmation=await f.ok(await f.send({action:'confirm',options:{count_policies:{[deck.id]:flexible},suggested_counts:{[deck.id]:8}}}));
 const target=confirmation.snapshot.confirmedPlan.plan.targets.find(t=>t.media_kind==='slides');assert.equal(target.blocking_issues.length,0,JSON.stringify(target));
 return {planId:confirmation.command.planRevisionId,targetId:target.id};
}
async function authorize(f,planId,targetIds){
 const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:planId,targetIds}));
 const terms=preflight.command.preflight;assert.ok(terms.targets.every(t=>t.available),JSON.stringify(terms));
 const body={documentId:f.documentId,action:'authorize',expectedRevision:preflight.snapshot.revision,clientMutationId:'native-authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true};
 const accepted=await f.ok(await f.request(BASE,body));
 return {grantId:accepted.command.grantId,terms,accepted,body};
}

test('real grant/job/reservations create a nine-slide deck under5-15; exact native bytes require review and partial manifest preserves the rest',async context=>{
 const calls=[];context.mock.method(globalThis,'fetch',async(url,request)=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls.push(JSON.parse(request.body));return Response.json({id:'native-nine',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const f=await fixture();context.after(()=>f.sqlite.close());
 const plan=await saveDeck(f);assert.equal(calls.length,0);
 const auth=await authorize(f,plan.planId,[plan.targetId]);
 assert.equal(calls.length,0,'save/confirm/preflight/authorization does not transmit sources');
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n,1);
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();assert.equal(slot.status,'authorized');
 const accidentalRun=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/run`,{method:'POST'}),f.env,`${slot.job_id}/run`);assert.equal(accidentalRun.status,202);assert.equal(calls.length,0,'legacy route cannot start an unstarted Output grant');
 const run=await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));
 assert.equal(calls.length,1,JSON.stringify(run.snapshot.grants));
 assert.equal(f.sqlite.prepare('SELECT status,error_message FROM document_jobs').get().status,'completed',JSON.stringify(f.sqlite.prepare('SELECT status,error_message,result_json FROM document_jobs').get()));
 assert.equal(calls[0].text.format.schema.properties.items.minItems,5);assert.equal(calls[0].text.format.schema.properties.items.maxItems,15);
 const providerInput=JSON.parse(calls[0].input);assert.equal(providerInput.presentation_source.slideCountPolicy.kind,'flexible');
 assert.doesNotMatch(JSON.stringify(providerInput.creative_context),/podcast|TikTok|slideshow with/);
 assert.doesNotMatch(providerInput.output_requirements.instructions,/podcast|TikTok/,'selected target instructions must not include sibling work');
 const bound=await f.ok(await f.send({action:'bind',planRevisionId:plan.planId,targetId:plan.targetId,nativeJobId:slot.job_id}));
 assert.equal(bound.snapshot.results[0].checksStatus,'passed',JSON.stringify(bound.snapshot.results));assert.equal(bound.snapshot.results[0].review,'pending');
 const asset=bound.snapshot.assets[0];const downloaded=await f.request(asset.downloadUrl);assert.equal(downloaded.status,200);const bytes=new Uint8Array(await downloaded.arrayBuffer());
 assert.equal((await inspectOutputAsset(bytes,'native.pptx')).facts.slideCount,9);
 const reviewed=await f.ok(await f.send({action:'review',resultId:bound.command.resultId,decision:'approve',reviewedCoverage:true,reviewedRights:true}));
 assert.equal(reviewed.snapshot.results[0].review,'approved');
 const forbiddenComplete=await f.send({action:'export',planRevisionId:plan.planId});assert.equal(forbiddenComplete.status,409);
 const partial=await f.ok(await f.send({action:'export',planRevisionId:plan.planId,allowPartial:true}));
 const archive=await f.request(partial.command.downloadUrl);assert.equal(archive.status,200);assert.equal(archive.headers.get('x-output-delivery-completion'),'partial');assert.equal(new Uint8Array(await archive.arrayBuffer())[0],0x50);
 const replay=await f.ok(await f.request(BASE,auth.body));assert.equal(replay.replayed,true);assert.equal(replay.command.grantId,auth.grantId);assert.equal(calls.length,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
});

test('native exact image sizes preserve all five requested ratios without hidden crop',()=>{
 for(const ratio of[{width:1,height:1},{width:4,height:5},{width:9,height:16},{width:16,height:9},{width:191,height:100}]){const render=outputExactImageRender(ratio);assert.ok(render);const[w,h]=render.size.split('x').map(Number);assert.equal(w*ratio.height,h*ratio.width);}
});

function png(width,height,red=36){
 const crc=bytes=>{let c=0xffffffff;for(const byte of bytes){c^=byte;for(let bit=0;bit<8;bit++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0};
 const chunk=(name,data)=>{const type=Buffer.from(name),body=Buffer.concat([type,data]),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(body));return Buffer.concat([size,body,check]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const pixels=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*4+1)+1+x*4;pixels[p]=red;pixels[p+1]=120;pixels[p+2]=80;pixels[p+3]=255;}
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
async function saveImages(f){
 const parsed=parseOutputRequirement({id:'output-image-fixture',type:'Output',subtype:'Social media image',content:'Output images at aspect ratios "1:1" square, "4:5" feed, and "16:9" optionally.'});
 const spec=parsed.spec;assert.ok(spec);const image=spec.deliverables.find(d=>d.media_kind==='image');assert.ok(image);assert.equal(image.format_variants.length,3);
 image.quantity={kind:'exact',unit:'image',value:1};image.coverage={kind:'document_outline'};
 image.format_variants.forEach((variant,index)=>{variant.quantity={kind:'exact',unit:'image',value:1};variant.required=index<2;});
 await f.ok(await f.send({action:'save',blockId:spec.id,spec}));
 const confirmation=await f.ok(await f.send({action:'confirm'}));const plan=confirmation.snapshot.confirmedPlan.plan;
 assert.equal(plan.targets.filter(t=>t.required).length,2);assert.equal(plan.targets.filter(t=>!t.required&&!t.selected).length,1);
 assert.ok(plan.targets.filter(t=>t.required).every(t=>!t.blocking_issues.length),JSON.stringify(plan));
 return {planId:confirmation.command.planRevisionId,targetIds:plan.targets.filter(t=>t.required).map(t=>t.id),plan};
}

test('two required image targets preserve successful sibling, optional off, uncertain cost and durable replay after lost acknowledgment',async context=>{
 let plannerCalls=0,imageCalls=0,safetyCalls=0;const transmissions=[];
 context.mock.method(globalThis,'fetch',async(url,request)=>{
  transmissions.push({path:new URL(String(url)).pathname,body:JSON.parse(request.body),signal:request.signal});
  if(String(url)==='https://api.openai.com/v1/responses'){plannerCalls++;return Response.json({id:`direction-${plannerCalls}`,model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Sheltered orchard',rationale:'Protect mature roots',scene:'Pear trees beside a sheltered orchard path',palette:['green','ochre'],next_moves:['Review tree spacing']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});}
  if(String(url)==='https://api.openai.com/v1/moderations'){safetyCalls++;return Response.json({id:`safety-${safetyCalls}`,model:'omni-moderation-latest',results:[{flagged:false,categories:{}}]});}
  assert.equal(String(url),'https://api.openai.com/v1/images/generations');imageCalls++;
  if(imageCalls===2)throw new Error('lost provider acknowledgment after possible acceptance');
  const[width,height]=JSON.parse(request.body).size.split('x').map(Number);
  return Response.json({created:1,data:[{b64_json:png(width,height).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}},{headers:{'x-request-id':`image-${imageCalls}`}});
 });
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'The north orchard uses drip irrigation around the mature pear trees.'}}]);context.after(()=>f.sqlite.close());
 const plan=await saveImages(f);const auth=await authorize(f,plan.planId,plan.targetIds);
 assert.equal(plannerCalls+imageCalls+safetyCalls,0,'even advisory moderation waits for authorization and Start');
 assert.ok(auth.terms.targets.every(target=>target.maximumCalls===2));
 assert.ok(auth.terms.targets.every(target=>JSON.stringify(target.settings.calls.map(call=>call.stage))===JSON.stringify(['planning:initial','image:initial'])),'the authorized count covers generation stages only');
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));
 assert.equal(plannerCalls,2,JSON.stringify(f.sqlite.prepare("SELECT job_id,status,error_message,result_json FROM document_jobs").all()));assert.equal(imageCalls,2);
 const imageUsage=(await readWorkspaceEvents(f.env,stream)).find(event=>event.type==='GenerationUsageRecorded'&&event.payload.operation==='image-generation').payload;
 assert.equal(imageUsage.pricing_version,'openai-2026-07-30');assert.equal(imageUsage.provider_call_labels,undefined,'slideshow label changes do not relabel image pricing');
 const jobs=f.sqlite.prepare('SELECT * FROM document_jobs ORDER BY requested_at,job_id').all();assert.deepEqual(jobs.map(job=>job.status),['completed','failed'],JSON.stringify(jobs.map(job=>({status:job.status,error:job.error_message,result:JSON.parse(job.result_json)}))));
 const slots=jobs.map(job=>f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE job_id=?').get(job.job_id));assert.equal(slots[0].status,'succeeded');assert.equal(slots[1].status,'uncertain');
 const held=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(slots[1].cost_reservation_id);assert.equal(held.status,'executing');assert.equal(held.reserved_microusd,slots[1].maximum_microusd);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,4);
 assert.equal(safetyCalls,2,'each native image attempt has at most one additional safety request');
 assert.deepEqual(transmissions.map(request=>request.path),['/v1/responses','/v1/moderations','/v1/images/generations','/v1/responses','/v1/moderations','/v1/images/generations']);
 for(let index=0;index<transmissions.length;index+=3){
  const safety=transmissions[index+1],image=transmissions[index+2];
  assert.equal(safety.body.model,'omni-moderation-latest');
  assert.deepEqual(safety.body.input,[{type:'text',text:image.body.prompt}],'moderation receives the exact final prompt as text, with no reference pixels');
  assert.equal(safety.signal,image.signal,'the safety request shares the native attempt deadline');
  assert.ok(safety.signal instanceof AbortSignal);
  assert.equal(image.body.n,1);assert.equal(image.body.partial_images,undefined);
 }
 assert.equal(transmissions.length,plannerCalls+imageCalls+safetyCalls,'the ledger count is not a count of every network request');
 const before={plannerCalls,imageCalls,safetyCalls};
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));
 f.sqlite.prepare("UPDATE document_jobs SET request_json='{}' WHERE job_id=?").run(jobs[0].job_id);
 await f.ok(await f.request(BASE,auth.body));
 assert.deepEqual({plannerCalls,imageCalls,safetyCalls},before);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,2);
 const bound=await f.ok(await f.send({action:'bind',planRevisionId:plan.planId,targetId:slots[0].target_id,nativeJobId:jobs[0].job_id}));assert.equal(bound.snapshot.results[0].checksStatus,'passed');
 await f.ok(await f.send({action:'review',resultId:bound.command.resultId,decision:'approve',reviewedCoverage:true,reviewedRights:true}));
 const partial=await f.ok(await f.send({action:'export',planRevisionId:plan.planId,allowPartial:true}));const archive=await f.request(partial.command.downloadUrl);assert.equal(archive.status,200);assert.equal(archive.headers.get('x-output-delivery-completion'),'partial');
 assert.equal(partial.snapshot.confirmedPlan.plan.targets.filter(t=>t.required).length,2);assert.equal(partial.snapshot.confirmedPlan.plan.targets.filter(t=>!t.required&&!t.selected).length,1);
 assert.deepEqual({plannerCalls,imageCalls,safetyCalls},before);
 const published=f.sqlite.prepare('SELECT storage_key,publication_event_id FROM output_native_storage_writes').get();assert.ok(published.publication_event_id,'ordinary output publication and storage custody commit together');
 f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();const privateCleanup=await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative'});assert.equal(privateCleanup.pending,0);assert.equal(f.media.has(published.storage_key),true,'private-context erasure retains durably published ordinary output');
});

test('a source edit after atomic authorization blocks provider execution and preserves the original job identity',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Stale output must not transmit');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
 const before=f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id;
 await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'source-0',property_path:'text',new_value:'The source was revised after authorization.'});
 const run=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.equal(run.status,409);assert.equal(calls,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);assert.equal(f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id,before);
});

test('failed job insertion and zero-row job guard rollback authorization events, child reservations and slots together',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Atomic failure must not contact providers');});
 for(const zero of[false,true]){
  const f=await fixture();try{
   const plan=await saveDeck(f);
   const pre=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId]}));const terms=pre.command.preflight;
   const beforeEvents=f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n;
   f.sqlite.exec(`CREATE TRIGGER fail_native_job BEFORE INSERT ON document_jobs BEGIN SELECT RAISE(${zero?'IGNORE':"ABORT,'injected_job_write_failure'"}); END`);
   const response=await f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true});assert.ok(response.status>=400);
   for(const table of['output_execution_grants','output_operation_slots','document_jobs','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n,beforeEvents);
   assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='document-artifact-input'").get().n,0,'failed atomic authorization leaves no private source copy');
   assert.equal(f.sqlite.prepare('SELECT COALESCE(SUM(reserved_microusd),0) AS n FROM cost_budget_counters').get().n,0);
  }finally{f.sqlite.close();}
 }
 assert.equal(calls,0);
});

test('a provider overrun is recorded honestly and cannot buy a repair from remaining application authority',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;return Response.json({id:'actual-overrun',model:'gpt-5.6-terra',output_text:JSON.stringify({...outputFor(),items:[]}),usage:{input_tokens:1_000_000,output_tokens:1_000_000,total_tokens:2_000_000}});});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(calls,1);
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();const cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(slot.cost_reservation_id);
 assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants').get().status,'exceeded');
 assert.equal(cost.status,'settled');assert.ok(cost.used_microusd>slot.maximum_microusd,JSON.stringify(cost));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,1);
 assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');
});


test('shared native admission stores the exact selection and owns its job anchor before a real deck executes and binds',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;return Response.json({id:'shared-nine',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const f=await fixture(undefined,{shared:true});context.after(()=>f.sqlite.close());
 const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
 assert.equal(f.sqlite.prepare('SELECT context_id FROM output_execution_grants').get().context_id,f.contextId);
 const anchor=f.sqlite.prepare("SELECT event.type,resource.actor_user_id FROM project_resource_scopes resource JOIN events event ON event.event_id=resource.source_event_id WHERE resource.resource_kind='job' AND resource.resource_id=?").get(slot.job_id);
 assert.equal(anchor.type,'ProjectDocumentJobQueued');assert.equal(anchor.actor_user_id,'dev-local-creative');assert.equal(calls,0);
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(calls,1);
 const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.equal(job.status,'completed',JSON.stringify({status:job.status,error:job.error_message,result:job.result_json}));
 assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'succeeded');
 const bound=await f.ok(await f.send({action:'bind',planRevisionId:plan.planId,targetId:plan.targetId,nativeJobId:slot.job_id}));assert.equal(bound.snapshot.results[0].checksStatus,'passed');assert.equal(bound.snapshot.results[0].review,'pending');
});

test('revoking the original project selection stops Start and stops a second provider attempt after a known response',async context=>{
 for(const timing of['before-start','between-calls']){
  const f=await fixture(undefined,{shared:true});try{
   let calls=0;context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;
    f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
    return Response.json({id:'shared-invalid-count',model:'gpt-5.6-terra',output_text:JSON.stringify({...outputFor(),items:[]}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
   });
   const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
   if(timing==='before-start')f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
   const run=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.equal(calls,timing==='before-start'?0:1);
   if(timing==='before-start')assert.equal(run.status,403);else{assert.ok([200,403].includes(run.status));assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,1);}
  }finally{f.sqlite.close();context.mock.restoreAll();}
 }
});

test('legacy cancellation projects the same terminal slot and allows only an explicitly authorized alternative',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Cancelled work must not run');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
 const canceled=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/cancel`,{method:'POST'}),f.env,`${slot.job_id}/cancel`);assert.equal(canceled.status,200,JSON.stringify(await canceled.clone().json()));
 assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'cancelled');assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'released');
 const replay=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.ok([200,403].includes(replay.status));assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'cancelled');
 const offered=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId],alternativeOfSlotId:slot.slot_id}));assert.equal(offered.command.preflight.targets[0].available,true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
});

test('expired never-started authorization cancels its same job and releases only its unexposed reservations',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Expired work must not run');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);const jobId=f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id;
 f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=?').run('2000-01-01T00:00:00.000Z');
 const denied=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.equal(denied.status,403,JSON.stringify(await denied.clone().json()));assert.equal(calls,0);
 assert.deepEqual({...f.sqlite.prepare('SELECT job_id,status FROM document_jobs').get()},{job_id:jobId,status:'canceled'});assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'cancelled');
 for(const table of['cost_budget_reservations','budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT status FROM ${table}`).get().status,'released',table);
 const again=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.ok([200,403].includes(again.status));assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);assert.equal(calls,0);
});

test('image preflight rejects unknown rates and uses the documented size calculation with a finite prompt contract',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Price checks must not transmit');});
 const f=await fixture([{block_id:'source-image-price',type:'message',properties:{text:'A protected orchard at sunset.'}}]);context.after(()=>f.sqlite.close());const plan=await saveImages(f);
 f.env.OPENAI_IMAGE_MODEL='unpriced-image-model';const offered=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:plan.targetIds}));
 assert.ok(offered.command.preflight.targets.every(target=>!target.available&&/pricing/.test(target.reason)));assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
 assert.equal(outputImageBudget('gpt-image-2','1024x1024').estimatedOutputTokens,7024);
 assert.equal(outputImageBudget('gpt-image-2','1024x1024',32001),null);
 assert.equal(outputImageBudget('unknown','1024x1024'),null);
 assert.ok(outputImageBudget('gpt-image-2','3056x1600').maximumOutputTokens>8000);
});


test('erasure between source load and grant commit cannot recreate a private receipt, job or allowance',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Erased source must not transmit');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);
 const pre=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId]}));const terms=pre.command.preflight;
 const originalBatch=f.DB.batch.bind(f.DB);let erased=false;
 f.DB.batch=async statements=>{
  if(!erased&&statements.some(statement=>statement.sql.startsWith('INSERT INTO output_execution_grants'))){
   erased=true;
   f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated' AND json_extract(payload,'$.block_id')='source-0')").run(new Date().toISOString());
  }
  return originalBatch(statements);
 };
 const denied=await f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true});assert.ok(denied.status>=400,JSON.stringify(await denied.clone().json()));assert.equal(erased,true);
 for(const table of['output_execution_grants','output_operation_slots','document_jobs','cost_budget_reservations','budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='document-artifact-input'").get().n,0);assert.equal(calls,0);
});

test('a crash after Start commits resumes the same native job on identical command replay without readmission',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;return Response.json({id:'resume-after-run-commit',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
 const jobId=f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id;
 const body={documentId:f.documentId,action:'run',grantId:auth.grantId,clientMutationId:'lost-run-acknowledgement',expectedRevision:`output:${await streamHead(f.env,stream)}`};
 const dispatch=outputDocumentExecutionBridge.dispatch;let intercepted=false;
 outputDocumentExecutionBridge.dispatch=async input=>{if(!intercepted){intercepted=true;throw new Error('crash after durable run commit');}return dispatch(input);};
 try{
  const interrupted=await f.request(BASE,body);assert.ok(interrupted.status>=400);assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'queued');
  const resumed=await f.ok(await f.request(BASE,body));assert.equal(resumed.replayed,true);assert.equal(calls,0,'Start replay only exposes the same queued job');await f.driveJobs();assert.equal(calls,1);
  assert.deepEqual({...f.sqlite.prepare('SELECT job_id,status FROM document_jobs').get()},{job_id:jobId,status:'completed'});
  for(const table of['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations','output_provider_calls'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,1,table);
  await f.ok(await f.request(BASE,body));assert.equal(calls,1);
 }finally{outputDocumentExecutionBridge.dispatch=dispatch;}
});


test('a known invalid first response permits exactly one charged repair in the same admitted job',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;return Response.json({id:`known-repair-${calls}`,model:'gpt-5.6-terra',output_text:JSON.stringify(calls===1?{...outputFor(),items:[]}:outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(calls,2);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed');
 const paid=f.sqlite.prepare('SELECT stage_key,status FROM output_provider_calls ORDER BY created_at').all();assert.deepEqual(paid.map(row=>({...row})),[{stage_key:'planning:0:initial',status:'settled'},{stage_key:'planning:0:repair',status:'settled'}]);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM cost_budget_reservations').get().n,1);await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(calls,2);
});

test('a failed legacy pending checkpoint cannot refund the durable call, start a retry, or authorize cancellation',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('The failed checkpoint must prevent transmission');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
 f.sqlite.exec("CREATE TRIGGER fail_output_pending_checkpoint BEFORE UPDATE OF result_json ON document_jobs WHEN NEW.status='running' AND json_extract(NEW.result_json,'$.presentationProviderSubmission')='pending' AND EXISTS(SELECT 1 FROM output_provider_calls) BEGIN SELECT RAISE(ABORT,'injected_pending_checkpoint_failure'); END");
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(calls,0);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');
 assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
 const before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n;
 for(const action of['cancel','retry']){const denied=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/${action}`,{method:'POST'}),f.env,`${slot.job_id}/${action}`);assert.equal(denied.status,409,action);}
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,before);assert.equal(calls,0);
 f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=?').run('2000-01-01T00:00:00.000Z');const account=await requireUser(new Request('http://localhost/api/session'),f.env);await reconcileFailedBudgetReservations(f.env,account.user);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM budget_reservations').get().status,'active');
});

test('revocation during the paid response records cost but does not preserve the returned private candidate',async context=>{
 const f=await fixture();context.after(()=>f.sqlite.close());let calls=0;
 context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;
  f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
  f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=?").run(new Date().toISOString());
  f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=? WHERE private_event_id IN(SELECT event_id FROM events WHERE type='BlockCreated')").run(new Date().toISOString());
  f.sqlite.prepare("UPDATE document_jobs SET request_json='{}',result_json='{}'").run();
  return Response.json({id:'revoked-paid-response',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
 });
 const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
 const run=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.ok([200,403,409].includes(run.status));assert.equal(calls,1);
 const paid=f.sqlite.prepare('SELECT status,used_microusd FROM output_provider_calls').get();assert.equal(paid.status,'settled');assert.ok(paid.used_microusd>0);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE redacted_at IS NULL AND kind IN('provider-response','document-artifact')").get().n,0);
 const job=f.sqlite.prepare('SELECT request_json,result_json,status FROM document_jobs').get();assert.equal(job.request_json,'{}');assert.doesNotMatch(job.result_json,/The north orchard|document_snapshot|creative_context|"items"|"content_markdown"/);assert.equal(job.status,'failed');
});


test('ordinary budget reconciliation expires abandoned grants without any Start action',async context=>{
 const f=await fixture();context.after(()=>f.sqlite.close());let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('No Start was requested');});
 const plan=await saveDeck(f);await authorize(f,plan.planId,[plan.targetId]);const jobId=f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id;
 f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=?').run('2000-01-01T00:00:00.000Z');
 const auth=await requireUser(new Request('http://localhost/api/session'),f.env);assert.ok(auth.user);
 await reconcileFailedBudgetReservations(f.env,auth.user);
 assert.deepEqual({...f.sqlite.prepare('SELECT job_id,status FROM document_jobs').get()},{job_id:jobId,status:'canceled'});
 for(const table of['cost_budget_reservations','budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT status FROM ${table}`).get().status,'released');
 assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'cancelled');assert.equal(calls,0);
});


test('erasure after paid-response validation but before private candidate transaction cannot resurrect source or output',async context=>{
 const f=await fixture();context.after(()=>f.sqlite.close());let calls=0,erased=false;
 context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;return Response.json({id:'erase-before-candidate-commit',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);const originalBatch=f.DB.batch.bind(f.DB);
 f.DB.batch=async statements=>{
  if(!erased&&statements.some(statement=>statement.sql.startsWith('INSERT INTO private_content')&&statement.bindings.includes('provider-response'))){
   erased=true;f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
   f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=?").run(new Date().toISOString());
   f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=?").run(new Date().toISOString());
   f.sqlite.prepare("UPDATE document_jobs SET request_json='{}',result_json=json_object('providerSubmissions',json(json_extract(result_json,'$.providerSubmissions')),'providerSubmissionProtocol',1)").run();
  }
  return originalBatch(statements);
 };
 const run=await f.startAndDrive({action:'run',grantId:auth.grantId});assert.ok([200,403,409,410].includes(run.status),JSON.stringify(await run.clone().json()));assert.equal(erased,true);assert.equal(calls,1);
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE redacted_at IS NULL AND kind IN('provider-response','document-artifact')").get().n,0);
 const job=f.sqlite.prepare('SELECT request_json,result_json,status FROM document_jobs').get();assert.equal(job.request_json,'{}');assert.equal(job.status,'failed');assert.doesNotMatch(job.result_json,/document_snapshot|creative_context|"items"|"content_markdown"/);
 assert.equal(f.sqlite.prepare('SELECT status FROM output_provider_calls').get().status,'settled');
});

test('native storage receipts survive erasure, failed cleanup and a lost PUT acknowledgement without a false completion',async context=>{
 for(const lostAck of[false,true]){
  const f=await fixture([{block_id:'storage-race-source',type:'message',properties:{text:'A protected pear orchard in a warm evening light.'}}]);try{
   let calls=0;context.mock.method(globalThis,'fetch',async(url,request)=>{
    if(String(url).endsWith('/moderations'))return Response.json({id:'safe-storage-image',results:[{flagged:false,categories:{}}]});
    calls++;
    if(String(url).endsWith('/responses'))return Response.json({id:'storage-direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Pear orchard',rationale:'Protect roots',scene:'Pear trees along an orchard path',palette:['green'],next_moves:['Review tree spacing']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
    assert.equal(String(url),'https://api.openai.com/v1/images/generations');const[width,height]=JSON.parse(request.body).size.split('x').map(Number);return Response.json({data:[{b64_json:png(width,height).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}});
   });
   const plan=await saveImages(f);const auth=await authorize(f,plan.planId,[plan.targetIds[0]]);
   const put=f.env.MEDIA.put.bind(f.env.MEDIA),remove=f.env.MEDIA.delete.bind(f.env.MEDIA);
   f.env.MEDIA.put=async(...args)=>{
    const result=await put(...args);f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
    f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=?").run(new Date().toISOString());
    f.sqlite.prepare("UPDATE event_private_payloads SET private_json='{}',redacted_at=?").run(new Date().toISOString());
    if(lostAck)throw new Error('storage accepted bytes but acknowledgement was lost');return result;
   };
   f.env.MEDIA.delete=async()=>{throw new Error('injected storage cleanup failure');};
   await f.startAndDrive({action:'run',grantId:auth.grantId});assert.equal(calls,2);
   const receipt=f.sqlite.prepare('SELECT * FROM output_native_storage_writes').get();assert.equal(receipt.status,'cleanup_pending');assert.equal(receipt.write_acknowledged,Number(!lostAck));assert.equal(f.media.has(receipt.storage_key),true);
   assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_assets").get().n,0);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'failed');
   f.env.MEDIA.delete=remove;
   const object=f.media.get(receipt.storage_key);object.metadata.outputSha256='wrong-custody';
   const foreign=await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative'});assert.equal(foreign.pending,1);assert.equal(f.media.has(receipt.storage_key),true,'a different object at the same key cannot be deleted');object.metadata.outputSha256=receipt.content_sha256;
   const cleanup=await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative'});
   assert.equal(f.media.has(receipt.storage_key),false);assert.equal(cleanup.pending,Number(lostAck));
   assert.equal(f.sqlite.prepare('SELECT status FROM output_native_storage_writes').get().status,lostAck?'cleanup_pending':'deleted');
   assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,2);
  }finally{f.sqlite.close();context.mock.restoreAll();}
 }
});

test('personal erasure storage reconciliation neither marks nor deletes shared organization objects',async context=>{
 const f=await fixture(undefined,{shared:true});context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('No provider may run during cleanup');});
 const plan=await saveDeck(f);await authorize(f,plan.planId,[plan.targetId]);
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();
 const storageKey='shared-output-unpublished',hash='shared-output-custody-hash',now=new Date().toISOString();
 await f.env.MEDIA.put(storageKey,new Uint8Array([1,2,3]),{customMetadata:{outputNativeStorage:'1',outputScopeKey:slot.scope_key,outputSlotId:slot.slot_id,outputOwnerId:'dev-local-creative',outputDocumentId:f.documentId,outputSha256:hash}});
 f.sqlite.prepare("INSERT INTO output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,created_at,updated_at) VALUES(?,?,?,?,'written',1,?,?)").run(slot.scope_key,slot.slot_id,storageKey,hash,now,now);
 f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true}),{reconciled:0,pending:0});
 assert.equal(f.sqlite.prepare('SELECT status FROM output_native_storage_writes').get().status,'written');assert.equal(f.media.has(storageKey),true);
 f.sqlite.prepare("UPDATE output_native_storage_writes SET status='cleanup_pending'").run();
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true}),{reconciled:0,pending:0});assert.equal(f.media.has(storageKey),true);
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative'}),{reconciled:1,pending:0});assert.equal(f.media.has(storageKey),false);
});

test('native storage cleanup is bounded and reports remaining receipts for subsequent maintenance',async context=>{
 const f=await fixture();context.after(()=>f.sqlite.close());
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('No provider may run during cleanup');});
 const plan=await saveDeck(f);await authorize(f,plan.planId,[plan.targetId]);
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get(),now=new Date().toISOString();
 f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
 for(let index=0;index<3;index++){
  const key=`bounded-unpublished-${index}`,hash=`bounded-custody-${index}`;
  await f.env.MEDIA.put(key,new Uint8Array([index]),{customMetadata:{outputNativeStorage:'1',outputScopeKey:slot.scope_key,outputSlotId:slot.slot_id,outputOwnerId:'dev-local-creative',outputDocumentId:f.documentId,outputSha256:hash}});
  f.sqlite.prepare("INSERT INTO output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,created_at,updated_at) VALUES(?,?,?,?,'written',1,?,?)").run(slot.scope_key,slot.slot_id,key,hash,now,now);
 }
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true,limit:1}),{reconciled:1,pending:2});assert.equal(f.media.size,2);
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true,limit:1}),{reconciled:1,pending:1});
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true,limit:1}),{reconciled:1,pending:0});assert.equal(f.media.size,0);
 for(let index=0;index<2;index++){
  const key=`unknown-unpublished-${index}`,hash=`unknown-custody-${index}`;
  await f.env.MEDIA.put(key,new Uint8Array([index]),{customMetadata:{outputNativeStorage:'1',outputScopeKey:slot.scope_key,outputSlotId:slot.slot_id,outputOwnerId:'dev-local-creative',outputDocumentId:f.documentId,outputSha256:hash}});
  f.sqlite.prepare("INSERT INTO output_native_storage_writes(scope_key,slot_id,storage_key,content_sha256,status,write_acknowledged,created_at,updated_at) VALUES(?,?,?,?,'cleanup_pending',0,?,?)").run(slot.scope_key,slot.slot_id,key,hash,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z');
 }
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true,limit:1}),{reconciled:0,pending:2});assert.equal(f.media.size,1);
 assert.deepEqual(await reconcileOutputNativeStorage(f.env,{ownerUserId:'dev-local-creative',personalOnly:true,limit:1}),{reconciled:0,pending:2});assert.equal(f.media.size,0,'an unknown first receipt cannot starve deletion of later private bytes');
});


test('post-erasure reservation cleanup is bounded, skips settled rows, and keeps personal cleanup out of shared scope',async context=>{
 context.mock.method(globalThis,'fetch',async()=>{throw new Error('No provider may run during cleanup');});
 for(const shared of[false,true]){
  const f=await fixture(undefined,{shared});try{
   const plan=await saveImages(f);await authorize(f,plan.planId,plan.targetIds);
   f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked'").run();
   f.sqlite.prepare("UPDATE output_operation_slots SET status='cancelled'").run();
   f.sqlite.prepare("UPDATE document_jobs SET status='canceled'").run();
   if(shared){assert.deepEqual(await releaseUndispatchedOutputReservations(f.env,{ownerUserId:'dev-local-creative',personalOnly:true,limit:1}),{reconciled:0,pending:0});assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations WHERE status='active'").get().n,2);}
   const filter={ownerUserId:'dev-local-creative',personalOnly:!shared,limit:1};
   assert.deepEqual(await releaseUndispatchedOutputReservations(f.env,filter),{reconciled:1,pending:1});
   assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations WHERE status='released'").get().n,1);
   assert.deepEqual(await releaseUndispatchedOutputReservations(f.env,filter),{reconciled:1,pending:0});
   assert.deepEqual(await releaseUndispatchedOutputReservations(f.env,filter),{reconciled:0,pending:0});
   for(const table of['budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status='released'`).get().n,2);
  }finally{f.sqlite.close();}
 }
});

test('a known provider receipt survives a failed ledger settlement and ordinary maintenance converges without another provider request',async context=>{
 const f=await fixture();context.after(()=>f.sqlite.close());let calls=0,injected=false;
 context.mock.method(globalThis,'fetch',async url=>{assert.equal(String(url),'https://api.openai.com/v1/responses');calls++;return Response.json({id:'known-receipt-ledger-fault',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const plan=await saveDeck(f);const auth=await authorize(f,plan.planId,[plan.targetId]);
 const batch=f.DB.batch.bind(f.DB);
 f.DB.batch=async statements=>{
  if(!injected&&statements.some(statement=>/^UPDATE output_provider_calls SET used_microusd/.test(statement.sql))){injected=true;throw new Error('injected_known_receipt_ledger_failure');}
  return batch(statements);
 };
 await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(injected,true);assert.equal(calls,1);
 let job=f.sqlite.prepare('SELECT job_id,status,result_json FROM document_jobs').get();assert.equal(job.status,'failed');
 const recorded=Object.values(JSON.parse(job.result_json).providerSubmissions);assert.equal(recorded.length,1);assert.equal(recorded[0].status,'completed');assert.equal(recorded[0].providerRequestId,'known-receipt-ledger-fault');assert.ok(recorded[0].costMicrousd>0);
 assert.equal(f.sqlite.prepare('SELECT status FROM output_provider_calls').get().status,'pending');
 f.sqlite.prepare("UPDATE document_jobs SET request_json='{}'").run();
 const principal=await requireUser(new Request('http://localhost/api/session'),f.env);
 await reconcileFailedBudgetReservations(f.env,principal.user);
 assert.deepEqual({...f.sqlite.prepare('SELECT status,used_microusd FROM output_provider_calls').get()},{status:'settled',used_microusd:recorded[0].costMicrousd});
 assert.deepEqual({...f.sqlite.prepare('SELECT status,used_microusd FROM cost_budget_reservations').get()},{status:'settled',used_microusd:recorded[0].costMicrousd});
 assert.deepEqual({...f.sqlite.prepare('SELECT status,used_tokens FROM budget_reservations').get()},{status:'settled',used_tokens:200});
 assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'failed');
 const counters=f.sqlite.prepare('SELECT used_microusd,reserved_microusd FROM cost_budget_counters ORDER BY scope,scope_id').all();
 await reconcileFailedBudgetReservations(f.env,principal.user);
 await f.startAndDrive({action:'run',grantId:auth.grantId});
 assert.deepEqual(f.sqlite.prepare('SELECT used_microusd,reserved_microusd FROM cost_budget_counters ORDER BY scope,scope_id').all(),counters);assert.equal(calls,1);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
});


test('native slideshow quotes bind each workflow model, effort, cache policy, output cap and current price independently',async context=>{
 let network=0;context.mock.method(globalThis,'fetch',async()=>{network++;throw new Error('Quotes cannot contact providers');});
 const facts=snapshot().facts.filter(fact=>String(fact.type).toLowerCase()!=='output');
 facts[0].properties.text+=' Source details stay authorized.'.repeat(1_600);
 const f=await fixture(facts);context.after(()=>f.sqlite.close());const plan=await saveDeck(f);
 const offer=async()=>{const pre=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId]}));return pre.command.preflight.targets[0];};
 const defaults=await offer();assert.equal(defaults.available,true,JSON.stringify(defaults));
 assert.deepEqual(defaults.settings.calls.map(call=>call.stage),['planning:0:initial','planning:0:repair']);
 assert.ok(defaults.settings.calls.every(call=>call.presentationRoute.model==='gpt-5.6-terra'&&call.presentationRoute.reasoningEffort==='low'));
 Object.assign(f.env,{OPENAI_MODEL:'unpriced-non-slideshow-model',OPENAI_SLIDES_COMPOSITION_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:'medium',OPENAI_SLIDES_REPAIR_MODEL:'gpt-5.6-terra',OPENAI_SLIDES_REPAIR_REASONING_EFFORT:'high'});
 const offered=await offer();assert.equal(offered.available,true,JSON.stringify(offered));
 const [composition,repair]=offered.settings.calls;
 assert.equal(offered.model,'gpt-5.6-sol');
 assert.deepEqual([composition.presentationRoute.workflow,repair.presentationRoute.workflow],['slides.composition','slides.editorial_repair']);
 assert.deepEqual([composition.presentationRoute.reasoningEffort,repair.presentationRoute.reasoningEffort],['medium','high']);
 for(const call of offered.settings.calls){
  assert.equal(call.presentationRoute.cachePolicy,'disabled-explicit');assert.equal(call.presentationRoute.serviceTier,'default');
  assert.equal(call.presentationRoute.pricingVersion,'openai-text-2026-09-02');
  assert.equal(call.maximumOutputTokens,13_500,'the existing flexible count cap does not grow with model effort');
  assert.equal(call.maximumMicrousd,Math.max(500_000,estimateOpenAITextCallMaximumMicrousd(call.model,call.maximumInputTokens,call.maximumOutputTokens)));
 }
 assert.ok(composition.maximumMicrousd>repair.maximumMicrousd);
 assert.equal(offered.maximumMicrousd,composition.maximumMicrousd+repair.maximumMicrousd);
 f.env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT='ultra';const invalid=await offer();assert.equal(invalid.available,false);assert.equal(invalid.reasonCode,'presentation_model_configuration_invalid');
 assert.equal(network,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
});

test('effort-only slideshow route drift rejects the frozen authorization before admitting work',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Changed quote must not transmit');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f);
 const pre=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId]}));const terms=pre.command.preflight;
 f.env.OPENAI_SLIDES_REPAIR_REASONING_EFFORT='high';
 const denied=await f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true});
 assert.equal(denied.status,409,JSON.stringify(await denied.clone().json()));
 for(const table of['document_jobs','output_execution_grants','output_operation_slots','budget_reservations','cost_budget_reservations'])assert.equal(f.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0,table);
 assert.equal(calls,0);
});

test('native slideshow dispatch refuses metadata or cap drift before consuming a provider-call identity',async context=>{
 let calls=0;context.mock.method(globalThis,'fetch',async()=>{calls++;throw new Error('Unapproved settings must not transmit');});
 const f=await fixture();context.after(()=>f.sqlite.close());const plan=await saveDeck(f),auth=await authorize(f,plan.planId,[plan.targetId]);
 await f.ok(await f.send({action:'run',grantId:auth.grantId}));
 const lease=new Date(Date.now()+120_000).toISOString();
 f.sqlite.prepare("UPDATE document_jobs SET status='running',attempt_count=1,lease_expires_at=?").run(lease);
 const job=f.sqlite.prepare('SELECT * FROM document_jobs').get(),account=await requireUser(new Request('http://localhost/api/session'),f.env);
 const binding=await loadOutputJobBinding(f.env,account.user,job);assert.ok(binding);
 const execution=await createOutputEventExecution(f.env,account.user,job,binding);
 const quoted=auth.terms.targets[0].settings.calls[0];
 const valid={model:quoted.model,maximumInputTokens:100,maximumOutputTokens:quoted.maximumOutputTokens,clientRequestId:'unconsumed-route-test',logicalCallKey:quoted.stage,requestDigest:'route-test-digest',presentationRoute:quoted.presentationRoute};
 for(const change of [
  {presentationRoute:undefined},{maximumInputTokens:quoted.maximumInputTokens+1},{maximumOutputTokens:quoted.maximumOutputTokens+1},{maximumOutputTokens:quoted.maximumOutputTokens-1},
  ...[{reasoningEffort:'high'},{cachePolicy:'implicit'},{serviceTier:'fast'},{pricingVersion:'old-price'},{routingVersion:'old-route'},{workflow:'slides.editorial_repair'}].map(patch=>({presentationRoute:{...quoted.presentationRoute,...patch}})),
 ])await assert.rejects(execution.beforeProviderAttempt({...valid,...change}),{code:'output_provider_route_changed'});
 await assert.rejects(execution.beforeProviderAttempt({...valid,logicalCallKey:'planning:0:editorial-initial'}),{code:'output_provider_stage_not_authorized'});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,0);
 assert.equal(calls,0);
});


test('mixed slideshow success and failure label each charged model and current tariff without repricing',async context=>{
 for(const fail of[false,true]){
  const f=await fixture();let calls=0;const requests=[];
  try{
   Object.assign(f.env,{OPENAI_SLIDES_COMPOSITION_REASONING_EFFORT:'medium',OPENAI_SLIDES_REPAIR_MODEL:'gpt-5.6-sol',OPENAI_SLIDES_REPAIR_REASONING_EFFORT:'high'});
   context.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(String(url),'https://api.openai.com/v1/responses');const request=JSON.parse(init.body);requests.push(request);calls++;assert.ok(calls<=2);
    const input=calls===1?120:150,output=calls===1?80:95;
    return Response.json({id:`labels-${fail}-${calls}`,model:request.model,service_tier:'default',status:'completed',output_text:JSON.stringify(calls===1||fail?{...outputFor(),items:[]}:outputFor()),usage:{input_tokens:input,output_tokens:output,total_tokens:input+output,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:20}}});
   });
   const plan=await saveDeck(f),auth=await authorize(f,plan.planId,[plan.targetId]);await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));assert.equal(calls,2);
   const job=f.sqlite.prepare('SELECT * FROM document_jobs').get();assert.equal(job.status,fail?'failed':'completed',job.error_message);
   const events=await readWorkspaceEvents(f.env,stream),usage=events.find(event=>event.type==='GenerationUsageRecorded'&&event.payload.document_id===f.documentId&&event.payload.operation===`document-render:slides${fail?':failed-plan':''}`).payload;
   assert.equal(usage.cost_microusd,3_700);assert.equal(usage.planner_cost_microusd,3_700);
   assert.equal(usage.pricing_version,'openai-text-2026-09-02');assert.deepEqual(usage.pricing_versions,['openai-text-2026-09-02']);
   assert.deepEqual(usage.model_ids,['gpt-5.6-terra','gpt-5.6-sol']);assert.deepEqual(usage.requested_reasoning_efforts,['medium','high']);
   assert.equal(usage.cost_precision,'frozen-per-call-published-tariff');assert.equal(usage.cost_aggregation,'sum-of-frozen-per-call-costs');
   assert.deepEqual(usage.provider_call_labels.map(call=>[call.requested_model,call.effective_model,call.requested_reasoning_effort]),[['gpt-5.6-terra','gpt-5.6-terra','medium'],['gpt-5.6-sol','gpt-5.6-sol','high']]);
   const detail=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.job_id}`),f.env,job.job_id);assert.equal(detail.status,200);
   const visible=(await detail.json()).job.result.generationReceipt;assert.equal(visible.model,null);assert.deepEqual(visible.model_ids,usage.model_ids);assert.deepEqual(visible.requested_reasoning_efforts,['medium','high']);
   if(!fail){
    const completed=events.find(event=>event.type==='DocumentRenderCompleted'&&event.payload.document_id===f.documentId).payload;
    assert.equal(completed.model_id,'gpt-5.6-sol','the final complete artifact still identifies its own response model');
    assert.equal(completed.planner_model_id,null);assert.deepEqual(completed.planner_model_ids,usage.model_ids);
    const privateReceipt=JSON.parse(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(completed.input_ref).content);
    assert.equal(privateReceipt.planner.model,null);assert.deepEqual(privateReceipt.planner.model_ids,usage.model_ids);
   }
  }finally{context.mock.restoreAll();f.sqlite.close();}
 }
});


// Recovery tests use the same native fixture, SQL transactions, adapters and bucket as above.
// These gates schedule existing DB operations; they neither fabricate stages nor grant authority.
function imageRecoveryTransport(context){
 const sent=[];
 context.mock.method(globalThis,'fetch',async(url,request)=>{
  const address=String(url),body=JSON.parse(request.body);sent.push({address,body,signal:request.signal,clientRequestId:new Headers(request.headers).get('x-client-request-id')});
  if(address==='https://api.openai.com/v1/responses')return Response.json({id:'recovery-direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Retained orchard',rationale:'Protect roots',scene:'Pear trees beside a sheltered path',palette:['green'],next_moves:['Review spacing']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  if(address==='https://api.openai.com/v1/moderations')return Response.json({id:'recovery-safety',results:[{flagged:false,categories:{}}]});
  assert.equal(address,'https://api.openai.com/v1/images/generations','all unexpected network access fails');
  const[width,height]=body.size.split('x').map(Number);
  return Response.json({data:[{b64_json:png(width,height).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}},{headers:{'x-request-id':'recovery-image'}});
 });
 return{sent,counts:()=>({planner:sent.filter(item=>item.address.endsWith('/responses')).length,image:sent.filter(item=>item.address.endsWith('/images/generations')).length,moderation:sent.filter(item=>item.address.endsWith('/moderations')).length})};
}
async function imageRecoveryBounded(promise,release,label){
 let timer;
 try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{release();reject(new Error(`Recovery fixture did not reach ${label}`));},10_000);})]);}
 finally{clearTimeout(timer);}
}
function pauseImageRecovery(f,jobId,stage){
 const batch=f.DB.batch.bind(f.DB),active=new Set();let observed=null,paused=false,released=false;
 let releasePointer,releaseOld,reach;
 const pointerGate=new Promise(resolve=>{releasePointer=resolve;});
 const oldGate=new Promise(resolve=>{releaseOld=resolve;});
 const reached=new Promise(resolve=>{reach=resolve;});
 const row=()=>({...f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(jobId)});
 const release=()=>{released=true;releasePointer();releaseOld();};
 const oldHeartbeat=statement=>observed&&statement.sql.startsWith('UPDATE document_jobs SET lease_expires_at=?,updated_at=?')&&statement.bindings[2]===jobId&&statement.bindings[4]===observed.correlation_id;
 const execute=async statements=>{
  // Only old-attempt heartbeat writes wait; a successor's preclaim denial can legitimately finish the old correlation.
  if(paused&&!released&&statements.some(oldHeartbeat))await oldGate;
  const result=await batch(statements);
  const claim=statements.findIndex(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1")&&statement.bindings[5]===jobId);
  if(paused&&claim>=0&&Number(result[claim]?.meta.changes)===1&&row().correlation_id!==observed.correlation_id)release();
  if(!paused&&!released){
   const pointerIndex=statements.findIndex(statement=>statement.sql.includes("json_extract(result_json,'$.imageRecovery') IS ?")&&statement.bindings[2]===jobId);
   const pointer=pointerIndex<0?null:JSON.parse(statements[pointerIndex].bindings[0]).imageRecovery;
   const current=row(),checkpoint=JSON.parse(current.result_json??'{}');
   const anchor=stage==='unretained'&&current.status==='running'&&!checkpoint.imageRecovery
    &&f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE correlation_id=? AND type='GenerationRequested'").get(current.correlation_id).n===1
    &&f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls WHERE slot_id IN(SELECT slot_id FROM output_operation_slots WHERE job_id=?)').get(jobId).n===0;
   const pending=stage==='pending'&&current.status==='running'
    &&f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_provider_calls WHERE slot_id IN(SELECT slot_id FROM output_operation_slots WHERE job_id=?) AND status='pending'").get(jobId).n===1;
   if(pointer?.stage===stage||anchor||pending){
    if(pointer){assert.equal(Number(result[pointerIndex]?.meta.changes),1);assert.deepEqual(checkpoint.imageRecovery,pointer);}
    observed=current;paused=true;reach({job:observed,pointer:checkpoint.imageRecovery??null});await pointerGate;
   }
  }
  return result;
 };
 f.DB.batch=statements=>{const pending=execute(statements);active.add(pending);pending.then(()=>active.delete(pending),()=>active.delete(pending));return pending;};
 return{row,release,observed:()=>observed,
  async wait(run){return imageRecoveryBounded(Promise.race([reached,run.then(response=>{throw new Error(`Original run settled before ${stage} checkpoint (${response.status})`);})]),release,stage);},
  async drain(){while(active.size)await Promise.allSettled([...active]);},
  restore(){f.DB.batch=batch;},
 };
}
const imageRecoveryCompletionRows=f=>f.sqlite.prepare("SELECT event_id,correlation_id,payload FROM events WHERE type='GenerationCompleted' ORDER BY sequence").all().map(row=>({...row}));
async function withImageRecovery(context,{stage='planned',shared=false,twoTargets=false,sourceDeadline}={},exercise){
 const transport=imageRecoveryTransport(context);
 const f=await fixture([{block_id:'recovery-source',type:'message',properties:{text:'The pear orchard preserves mature roots beside a sheltered path.',...(sourceDeadline?{rights_expires_at:sourceDeadline}:{})}}],{shared});
 // The fixture can seed unrelated historical completions; preserve every projected field before any recovery setup.
 Object.defineProperty(f,'recoveryCompletionBaseline',{value:Object.freeze(imageRecoveryCompletionRows(f).map(row=>Object.freeze(row)))});
 let gate;const runs=[];let reads=0,puts=0;
 const get=f.env.MEDIA.get.bind(f.env.MEDIA),put=f.env.MEDIA.put.bind(f.env.MEDIA);
 f.env.MEDIA.get=async(...args)=>{reads++;return get(...args);};f.env.MEDIA.put=async(...args)=>{puts++;return put(...args);};
 try{
  const plan=await saveImages(f),auth=await authorize(f,plan.planId,twoTargets?plan.targetIds:[plan.targetIds[0]]);
  const slots=f.sqlite.prepare('SELECT * FROM output_operation_slots ORDER BY job_id').all();
  const slot=slots.map(value=>({...value,requested:f.sqlite.prepare('SELECT requested_at FROM document_jobs WHERE job_id=?').get(value.job_id).requested_at})).sort((a,b)=>a.requested.localeCompare(b.requested)||a.job_id.localeCompare(b.job_id))[0];
  const admission=()=>({jobs:f.sqlite.prepare('SELECT job_id,owner_id,stream_id,document_id FROM document_jobs ORDER BY job_id').all().map(value=>({...value})),slots:f.sqlite.prepare('SELECT slot_id,scope_key,job_id,grant_id,token_reservation_id,cost_reservation_id FROM output_operation_slots ORDER BY slot_id').all().map(value=>({...value})),grants:f.sqlite.prepare('SELECT grant_id,actor_user_id,scope_key FROM output_execution_grants ORDER BY grant_id').all().map(value=>({...value})),tokens:f.sqlite.prepare('SELECT reservation_id,owner_id,stream_id,operation,period,reserved_tokens FROM budget_reservations ORDER BY reservation_id').all().map(value=>({...value})),costs:f.sqlite.prepare('SELECT reservation_id,owner_id,stream_id,operation,period,reserved_microusd FROM cost_budget_reservations ORDER BY reservation_id').all().map(value=>({...value}))});
  const originalAdmission=admission();
  await f.ok(await f.send({action:'run',grantId:auth.grantId}));
  gate=pauseImageRecovery(f,slot.job_id,stage);
  const track=promise=>{promise.catch(()=>{});runs.push(promise);return promise;};
  const run=(id=slot.job_id,headers=f.headers)=>{const promise=track(handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${id}/run`,{method:'POST',headers}),f.env,`${id}/run`));const bounded=imageRecoveryBounded(promise,gate.release,'public runner settlement');bounded.catch(()=>{});return bounded;};
  const first=run(),saved=stage===null?(await first,null):await gate.wait(first);
  const expire=()=>{const current=gate.row();assert.equal(current.correlation_id,saved.job.correlation_id);assert.equal(f.sqlite.prepare('UPDATE document_jobs SET lease_expires_at=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND attempt_count=?').run('2000-01-01T00:00:00.000Z',slot.job_id,current.owner_id,current.correlation_id,current.attempt_count).changes,1);};
  const finish=async()=>{gate.release();await Promise.allSettled(runs);await gate.drain();};
  await exercise({f,slot,slots,plan,auth,transport,gate,saved,first,run,track,expire,finish,admission,originalAdmission,mediaCounts:()=>({reads,puts})});
 }finally{
  gate?.release();await Promise.allSettled(runs);await gate?.drain();gate?.restore();
  // This drains intercepted batches and public runners, not arbitrary private native timeout tails.
  // The controlled success cases separately require the joined original planner signal to remain unaborted.
  f.sqlite.close();context.mock.restoreAll();
 }
}
function recoveryCompletions(f){
 const baseline=f.recoveryCompletionBaseline;assert.ok(baseline,'completion baseline belongs to this recovery fixture');
 const rows=imageRecoveryCompletionRows(f),baselineIds=new Set(baseline.map(row=>row.event_id));
 assert.deepEqual(rows.filter(row=>baselineIds.has(row.event_id)),baseline,'every historical completion remains unchanged');
 return rows.filter(row=>!baselineIds.has(row.event_id));
}
const originalActor=(f,slot)=>f.sqlite.prepare('SELECT actor_user_id FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).actor_user_id;
const recoverySha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),byte=>byte.toString(16).padStart(2,'0')).join('');
const recoveryCalls=f=>f.sqlite.prepare('SELECT * FROM output_provider_calls ORDER BY slot_id,call_key').all().map(row=>({...row}));
const recoveryReservations=(f,slot)=>({token:{...f.sqlite.prepare('SELECT * FROM budget_reservations WHERE reservation_id=?').get(slot.token_reservation_id)},cost:{...f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(slot.cost_reservation_id)}});
function retainedImageStage(f,pointer){const row=f.sqlite.prepare("SELECT * FROM private_content WHERE content_id=? AND kind='provider-output'").get(pointer.contentId);assert.ok(row);return{row:{...row},envelope:JSON.parse(row.content)};}

test('Image recovery behavioral: fresh bound generation publishes once without replacement admission',async context=>{
 await withImageRecovery(context,{stage:null},async({f,slot,transport,run,finish,admission,originalAdmission,mediaCounts})=>{
  assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(slot.job_id).status,'completed');
  assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});assert.equal(mediaCounts().puts,1);
  const completed=recoveryCompletions(f);assert.equal(completed.length,1);
  assert.equal(recoveryCalls(f).length,2);assert.ok(recoveryCalls(f).every(call=>call.status==='settled'));
  await run();await finish();assert.deepEqual(recoveryCompletions(f),completed);assert.deepEqual(admission(),originalAdmission);
  assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
 });
});

test('Image recovery behavioral: planned and rendered stages resume the same admitted job and original reservations',async context=>{
 for(const shared of[false,true])for(const stage of['planned','rendered'])await withImageRecovery(context,{stage,shared},async({f,slot,transport,gate,saved,first,run,expire,finish,admission,originalAdmission,mediaCounts})=>{
  const retained=retainedImageStage(f,saved.pointer),beforeCalls=recoveryCalls(f),beforeMedia=mediaCounts();
  const anchorIds=[['GenerationRequested',retained.envelope.stage.requestedEventId],['ContextCompiled',retained.envelope.stage.compiledEventId],['BudgetReserved',retained.envelope.stage.budgetEventId]];
  const anchorRows=()=>anchorIds.map(([type,id])=>({type,id,event:f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(id)??null,private:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id)??null}));
  const originalAnchors=anchorRows();assert.equal(new Set(originalAnchors.map(anchor=>anchor.id)).size,3);
  for(const anchor of originalAnchors){assert.ok(anchor.event);assert.ok(anchor.private);assert.equal(anchor.event.type,anchor.type);assert.equal(anchor.event.stream_id,saved.job.stream_id);assert.equal(anchor.private.private_event_id,anchor.id);Object.freeze(anchor.event);Object.freeze(anchor.private);Object.freeze(anchor);}Object.freeze(originalAnchors);
  assert.equal(saved.job.status,'running');assert.equal(saved.job.attempt_count,1);
  assert.deepEqual(transport.counts(),{planner:1,image:stage==='rendered'?1:0,moderation:stage==='rendered'?1:0});
  const priorReservations=recoveryReservations(f,slot);
  assert.equal(priorReservations.token.correlation_id,saved.job.correlation_id);assert.equal(priorReservations.cost.correlation_id,saved.job.correlation_id);
  expire();const resumed=run();await imageRecoveryBounded(resumed,gate.release,'same-job recovery');await finish();
  const current=gate.row();assert.equal(current.status,'completed',JSON.stringify({shared,stage,error:current.error_message}));assert.equal(current.attempt_count,2);assert.notEqual(current.correlation_id,saved.job.correlation_id);
  assert.deepEqual(admission(),originalAdmission);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
  assert.deepEqual(anchorRows(),originalAnchors,'all three original public/private anchors survive recovery unchanged');
  const afterReservations=recoveryReservations(f,slot);assert.equal(afterReservations.token.correlation_id,current.correlation_id);assert.equal(afterReservations.cost.correlation_id,current.correlation_id);
  assert.equal(afterReservations.token.status,'settled');assert.equal(afterReservations.cost.status,'settled');
  assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(saved.pointer.contentId).content,retained.row.content,'the original captured stage is not rewritten');
  const completed=recoveryCompletions(f);assert.equal(completed.length,1);const payload=(await readWorkspaceEvents(f.env,stream)).find(event=>event.eventId===completed[0].event_id).payload;
  assert.equal(payload.generation_id,retained.envelope.stage.generationId);assert.equal(payload.planner_response_id,retained.envelope.stage.planned.responseId);
  const calls=recoveryCalls(f);assert.equal(calls.length,2);assert.deepEqual(calls.find(call=>call.call_key==='planning:initial'),beforeCalls.find(call=>call.call_key==='planning:initial'),'the paid planner identity and receipt remain exact');
  const image=calls.find(call=>call.call_key==='image:initial');assert.equal(payload.provider_submission_id,image.client_request_id);assert.equal(payload.provider_request_id,image.provider_response_id);
  const transmitted=transport.sent.find(item=>item.address.endsWith('/images/generations'));assert.equal(transmitted.clientRequestId,image.client_request_id);assert.equal(transmitted.body.model,image.model);
  assert.equal(image.request_digest,await recoverySha256({model:transmitted.body.model,prompt:transmitted.body.prompt,size:transmitted.body.size,quality:transmitted.body.quality,outputFormat:transmitted.body.output_format??'png',references:[]}));
  const checkpoint=JSON.parse(current.result_json),imageReceipt=checkpoint.providerSubmissions[image.client_request_id];assert.equal(imageReceipt.requestDigest,image.request_digest);assert.equal(imageReceipt.providerRequestId,image.provider_response_id);assert.equal(imageReceipt.costMicrousd,image.used_microusd);
  const writes=f.sqlite.prepare('SELECT * FROM output_native_storage_writes').all();assert.equal(writes.length,1);assert.equal(writes[0].publication_event_id,completed[0].event_id);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type='GenerationUsageRecorded' AND json_extract(payload,'$.generation_id')=?").get(payload.generation_id).n,1);
  if(stage==='rendered'){assert.deepEqual(calls,beforeCalls);assert.equal(mediaCounts().puts,beforeMedia.puts);assert.ok(mediaCounts().reads>beforeMedia.reads,'recovery reads and verifies the retained bucket bytes');}
  const settled=recoveryReservations(f,slot);await run();assert.deepEqual(recoveryReservations(f,slot),settled);assert.deepEqual(recoveryCompletions(f),completed);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
  assert.equal(gate.row().attempt_count,2);assert.equal(gate.row().correlation_id,current.correlation_id);assert.deepEqual(anchorRows(),originalAnchors,'terminal replay preserves all original anchor rows without another attempt');
  await first;const originalSignal=transport.sent.find(item=>item.address.endsWith('/responses')).signal;assert.ok(originalSignal instanceof AbortSignal);
  assert.equal(originalSignal.aborted,false,'the joined original run did not take either detached native heartbeat exit; its inner operation settled');
 });
});

test('Image recovery behavioral: concurrent public recoveries claim one successor attempt',async context=>{
 await withImageRecovery(context,{stage:'planned'},async({f,transport,gate,first,run,expire,finish,admission,originalAdmission})=>{
  expire();const contenders=await Promise.allSettled([run(),run()]);
  for(const result of contenders){if(result.status==='rejected')assert.match(String(result.reason),/CHECK constraint failed/u);else assert.ok([200,202].includes(result.value.status));}
  await finish();assert.equal(gate.row().status,'completed',gate.row().error_message);assert.equal(gate.row().attempt_count,2);
  assert.deepEqual(admission(),originalAdmission);assert.equal(recoveryCompletions(f).length,1);assert.equal(recoveryCalls(f).length,2);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
  await first;const originalSignal=transport.sent.find(item=>item.address.endsWith('/responses')).signal;assert.ok(originalSignal instanceof AbortSignal);assert.equal(originalSignal.aborted,false);
 });
});

test('Image recovery behavioral: stale claim snapshots and changed call sets roll back reservation handoff',async context=>{
 for(const changed of['job-snapshot','call-set'])await withImageRecovery(context,{stage:'planned'},async({f,slot,transport,gate,run,expire,admission,originalAdmission})=>{
  expire();const before=gate.row(),held=recoveryReservations(f,slot),batch=f.DB.batch.bind(f.DB);let injected=false,changedRow;
  f.DB.batch=async statements=>{
   if(!injected&&statements.some(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1")&&statement.bindings[5]===slot.job_id)){
    injected=true;
    if(changed==='job-snapshot')f.sqlite.prepare('UPDATE document_jobs SET updated_at=? WHERE job_id=?').run('2001-01-01T00:00:00.000Z',slot.job_id);
    else f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=? WHERE slot_id=? AND call_key='planning:initial'").run('f'.repeat(64),slot.slot_id);
    changedRow=gate.row();
   }
   return batch(statements);
  };
  await assert.rejects(run(),/CHECK constraint failed/u);assert.equal(injected,true);assert.equal(gate.row().attempt_count,before.attempt_count);assert.equal(gate.row().correlation_id,before.correlation_id);
  assert.equal(gate.row().result_json,changedRow.result_json);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(admission(),originalAdmission);
  assert.deepEqual(transport.counts(),{planner:1,image:0,moderation:0});assert.equal(recoveryCompletions(f).length,0);
 });
});

test('Image recovery behavioral: pointer publication rejects concurrent stage and pointer changes atomically',async context=>{
 for(const changed of['stage-body','pointer'])await withImageRecovery(context,{stage:'planned'},async({f,slot,transport,gate,saved,run,expire})=>{
  const original=retainedImageStage(f,saved.pointer),batch=f.DB.batch.bind(f.DB);let injected=false,retainedPointer;
  expire();
  f.DB.batch=async statements=>{
   const pointerWrite=statements.find(statement=>statement.sql.includes("json_extract(result_json,'$.imageRecovery') IS ?")&&statement.bindings[2]===slot.job_id);
   if(!injected&&pointerWrite&&JSON.parse(pointerWrite.bindings[0]).imageRecovery.stage==='rendered'){
    injected=true;
    if(changed==='stage-body')f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(original.row.content+' ',saved.pointer.contentId);
    else f.sqlite.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.imageRecovery.contentSha256',?) WHERE job_id=?").run('e'.repeat(64),slot.job_id);
    retainedPointer=JSON.parse(gate.row().result_json).imageRecovery;
   }
   return batch(statements);
  };
  const response=await run();assert.equal(response.status,200);assert.equal(gate.row().status,'failed');assert.equal(injected,true);
  assert.deepEqual(JSON.parse(gate.row().result_json).imageRecovery,retainedPointer,'failed transaction cannot replace the concurrently changed checkpoint');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='provider-output' AND json_valid(content) AND json_extract(content,'$.stage.rendered') IS NOT NULL").get().n,0,'a rolled-back pointer write cannot leave its rendered private body');
  assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});assert.equal(recoveryCompletions(f).length,0);
  assert.equal(recoveryCalls(f).length,2,'the already-paid image call is retained, not replaced');
 });
});

test('Image recovery behavioral: pending calls and unretained anchors keep the same hold and stop the background queue',async context=>{
 for(const stage of['pending','unretained'])await withImageRecovery(context,{stage,twoTargets:true},async({f,slot,slots,transport,gate,run,track,expire})=>{
  expire();const before=gate.row(),held=recoveryReservations(f,slot),calls=recoveryCalls(f),sent=transport.counts();
  await run();assert.equal(gate.row().attempt_count,before.attempt_count);assert.equal(gate.row().correlation_id,before.correlation_id);assert.equal(gate.row().status,'running');
  assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(transport.counts(),sent);
  const sibling=slots.find(value=>value.job_id!==slot.job_id),background=[];assert.ok(sibling);
  const stopped=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${sibling.job_id}/cancel`,{method:'POST',headers:f.headers}),f.env,`${sibling.job_id}/cancel`,{waitUntil(promise){background.push(track(promise));}});
  assert.equal(stopped.status,200);assert.equal(background.length,1);await imageRecoveryBounded(Promise.all(background),gate.release,'held queue exit');
  assert.equal(gate.row().status,'running');assert.equal(gate.row().attempt_count,before.attempt_count);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(transport.counts(),sent);
  // Hold assertions end here. Finally intentionally resumes the old execution; that phase may legitimately fail it.
  // No planner request exists at either gate, so there is no original-signal witness excluding a detached native tail.
 });
});

test('Image recovery behavioral: retained private stages and bucket bytes fail closed without replacement work',async context=>{
 for(const changed of['missing-stage','corrupt-stage','expired-stage','missing-media','corrupt-media'])await withImageRecovery(context,{stage:'rendered'},async({f,transport,gate,saved,run,expire})=>{
  const retained=retainedImageStage(f,saved.pointer),media=retained.envelope.stage.rendered.media,key=decodeURIComponent(media.url.slice('/api/media/'.length));
  const calls=recoveryCalls(f),sent=transport.counts();expire();
  if(changed==='missing-stage')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(saved.pointer.contentId);
  if(changed==='corrupt-stage')f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=?').run(retained.row.content+' ',saved.pointer.contentId);
  if(changed==='expired-stage')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run('2000-01-01T00:00:00.000Z',saved.pointer.contentId);
  if(changed==='missing-media')f.media.delete(key);
  if(changed==='corrupt-media'){const object=f.media.get(key);assert.ok(object);object.bytes=Uint8Array.from([0,1,2]);}
  const response=await run();assert.equal(response.status,200);assert.equal(gate.row().status,'failed');assert.deepEqual(transport.counts(),sent);assert.deepEqual(recoveryCalls(f),calls);
  assert.equal(recoveryCompletions(f).length,0);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_native_storage_writes WHERE publication_event_id IS NOT NULL").get().n,0);
 });
});

test('Image recovery behavioral: missing original anchors cannot create a replacement generation identity',async context=>{
 for(const shared of[false,true])await withImageRecovery(context,{stage:'planned',shared},async({f,transport,gate,saved,run,expire})=>{
  const retained=retainedImageStage(f,saved.pointer),calls=recoveryCalls(f);expire();
  // Break only the retained compiled-event reference; the append-only event and private-payload ledgers stay intact.
  const missingCompiledEventId=crypto.randomUUID();assert.equal(f.sqlite.prepare('SELECT 1 FROM events WHERE event_id=?').get(missingCompiledEventId),undefined);
  const envelope={...retained.envelope,stage:{...retained.envelope.stage,compiledEventId:missingCompiledEventId}};
  const content=JSON.stringify(envelope),contentSha256=await recoverySha256(envelope),beforeJob=gate.row(),checkpoint=JSON.parse(beforeJob.result_json);
  assert.deepEqual(checkpoint.imageRecovery,saved.pointer);
  const pointer={...checkpoint.imageRecovery,contentSha256},resultJson=JSON.stringify({...checkpoint,imageRecovery:pointer});
  const ledger=()=>({events:f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all().map(row=>({...row})),privatePayloads:f.sqlite.prepare('SELECT * FROM event_private_payloads ORDER BY private_event_id').all().map(row=>({...row}))});
  const authority=()=>({grants:f.sqlite.prepare('SELECT * FROM output_execution_grants ORDER BY grant_id').all().map(row=>({...row})),slots:f.sqlite.prepare('SELECT * FROM output_operation_slots ORDER BY slot_id').all().map(row=>({...row}))});
  const beforeLedger=ledger(),beforeAuthority=authority();
  // Both compare-and-swap writes are synchronous inside one real fixture SQLite transaction; either mismatch rolls back both.
  f.sqlite.exec('BEGIN IMMEDIATE');
  try{
   assert.equal(f.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=? AND owner_id=? AND kind='provider-output' AND content=?").run(content,retained.row.content_id,retained.row.owner_id,retained.row.content).changes,1);
   assert.equal(f.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND result_json=? AND json_extract(result_json,'$.imageRecovery.contentId')=? AND json_extract(result_json,'$.imageRecovery.contentSha256')=?").run(resultJson,beforeJob.job_id,beforeJob.owner_id,beforeJob.stream_id,beforeJob.correlation_id,beforeJob.attempt_count,beforeJob.result_json,saved.pointer.contentId,saved.pointer.contentSha256).changes,1);
   f.sqlite.exec('COMMIT');
  }catch(error){f.sqlite.exec('ROLLBACK');throw error;}
  const stored=retainedImageStage(f,pointer);
  assert.deepEqual(stored.row,{...retained.row,content});assert.deepEqual(stored.envelope,envelope);assert.equal(JSON.stringify(stored.envelope),stored.row.content);assert.equal(await recoverySha256(stored.envelope),pointer.contentSha256);
  assert.deepEqual(gate.row(),{...beforeJob,result_json:resultJson});assert.deepEqual(JSON.parse(gate.row().result_json).imageRecovery,pointer);
  assert.deepEqual(ledger(),beforeLedger);assert.deepEqual(authority(),beforeAuthority);assert.deepEqual(recoveryCalls(f),calls);
  assert.equal(f.sqlite.prepare('SELECT 1 FROM events WHERE event_id=?').get(missingCompiledEventId),undefined);
  const requests=f.sqlite.prepare("SELECT event_id FROM events WHERE type='GenerationRequested'").all();
  const response=await run();assert.equal(response.status,200);assert.equal(gate.row().status,'failed');assert.deepEqual(transport.counts(),{planner:1,image:0,moderation:0});assert.deepEqual(recoveryCalls(f),calls);
  // The outer event API preserves this exact anchor error; a digest/schema rejection or a later generic failure is not equivalent.
  const failedCheckpoint=JSON.parse(gate.row().result_json);assert.equal(gate.row().error_message,'image_recovery_anchor_unavailable');assert.equal(failedCheckpoint.errorDetail.code,'image_recovery_anchor_unavailable');assert.equal(failedCheckpoint.errorDetail.message,'image_recovery_anchor_unavailable');
  assert.deepEqual(failedCheckpoint.providerSubmissions,checkpoint.providerSubmissions);
  assert.deepEqual(f.sqlite.prepare("SELECT event_id FROM events WHERE type='GenerationRequested'").all(),requests);assert.equal(recoveryCompletions(f).length,0);assert.notEqual(gate.row().status,'completed');
 });
 // BudgetReserved is not a collaborative document-source event; these faults isolate the new exact private-anchor lookup.
 for(const changed of['redacted','owner','project','document'])await withImageRecovery(context,{stage:'planned',shared:true},async({f,transport,gate,saved,run,expire})=>{
  const retained=retainedImageStage(f,saved.pointer),anchorId=retained.envelope.stage.budgetEventId,calls=recoveryCalls(f),checkpoint=JSON.parse(gate.row().result_json);
  const event=f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(anchorId),privateRow=f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(anchorId);
  assert.ok(event);assert.ok(privateRow);assert.equal(event.type,'BudgetReserved');assert.equal(event.stream_id,saved.job.stream_id);
  assert.equal(privateRow.owner_id,saved.job.stream_id.slice('creative:'.length));assert.equal(privateRow.project_id,null);assert.equal(privateRow.document_id,null);assert.equal(privateRow.redacted_at,null);
  const events=()=>f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all().map(row=>({...row}));
  const beforeEvents=events(),requests=f.sqlite.prepare("SELECT event_id FROM events WHERE type='GenerationRequested'").all();
  const expectedPrivate={...privateRow,...(changed==='redacted'?{redacted_at:new Date().toISOString()}:changed==='owner'?{owner_id:'wrong-recovery-anchor-owner'}:changed==='project'?{project_id:'wrong-recovery-anchor-project'}:{document_id:'wrong-recovery-anchor-document'})};
  // One synchronous compare-and-swap changes private custody only; immutable history and the retained stage/pointer are not rewritten.
  assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=?,project_id=?,document_id=?,private_json=?,redacted_at=? WHERE private_event_id=? AND owner_id=? AND project_id IS NULL AND document_id IS NULL AND private_json=? AND created_at=? AND redacted_at IS NULL').run(expectedPrivate.owner_id,expectedPrivate.project_id,expectedPrivate.document_id,expectedPrivate.private_json,expectedPrivate.redacted_at,anchorId,privateRow.owner_id,privateRow.private_json,privateRow.created_at).changes,1);
  assert.deepEqual({...f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(anchorId)},expectedPrivate);
  assert.deepEqual(events(),beforeEvents);assert.deepEqual(retainedImageStage(f,saved.pointer),retained);assert.deepEqual(JSON.parse(gate.row().result_json),checkpoint);assert.deepEqual(recoveryCalls(f),calls);
  expire();const response=await run();assert.equal(response.status,200);const failed=gate.row(),failedCheckpoint=JSON.parse(failed.result_json);
  assert.equal(failed.status,'failed',changed);assert.equal(failed.error_message,'image_recovery_anchor_unavailable',changed);assert.equal(failedCheckpoint.errorDetail.code,'image_recovery_anchor_unavailable',changed);assert.equal(failedCheckpoint.errorDetail.message,'image_recovery_anchor_unavailable',changed);
  assert.deepEqual(transport.counts(),{planner:1,image:0,moderation:0});assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(failedCheckpoint.providerSubmissions,checkpoint.providerSubmissions);
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(anchorId),event);assert.deepEqual({...f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(anchorId)},expectedPrivate);
  assert.deepEqual(f.sqlite.prepare("SELECT event_id FROM events WHERE type='GenerationRequested'").all(),requests);assert.equal(recoveryCompletions(f).length,0);assert.notEqual(failed.status,'completed');
 });
});

test('Image recovery behavioral: actor, scope, source, retention and grant withdrawal block resumed work',async context=>{
 for(const changed of['actor','scope','source','retention','grant'])await withImageRecovery(context,{stage:'planned',shared:true},async({f,slot,transport,gate,saved,run,expire})=>{
  const calls=recoveryCalls(f),sent=transport.counts();expire();
  if(changed==='actor')f.sqlite.prepare("UPDATE users SET consent_version='withdrawn-consent' WHERE user_id=?").run(originalActor(f,slot));
  if(changed==='scope')f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
  if(changed==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'recovery-source',property_path:'text',new_value:'Changed after paid planning.'});
  if(changed==='retention')f.sqlite.prepare('UPDATE private_content SET redacted_at=?,content=? WHERE content_id=?').run(new Date().toISOString(),'',saved.pointer.contentId);
  if(changed==='grant')f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=?").run(slot.grant_id);
  const response=await run();
  if(changed==='actor'){assert.equal(response.status,428);assert.equal((await response.clone().json()).error,'pilot_terms_required');}
  else if(changed==='scope'){assert.equal(response.status,403);assert.equal((await response.clone().json()).error,'project_access_revoked');}
  else{assert.equal(response.status,200);assert.equal(gate.row().status,'failed');}
  assert.deepEqual(transport.counts(),sent);assert.deepEqual(recoveryCalls(f),calls);assert.equal(recoveryCompletions(f).length,0);assert.notEqual(gate.row().status,'completed');
 });
});

test('Image recovery behavioral: terminal reentry after withdrawal never republishes or buys work',async context=>{
 for(const changed of['actor','scope','source','retention','grant'])await withImageRecovery(context,{stage:null,shared:true},async({f,slot,transport,run,finish})=>{
  const completed=recoveryCompletions(f);assert.equal(completed.length,1);const calls=recoveryCalls(f),sent=transport.counts();
  if(changed==='actor')f.sqlite.prepare("UPDATE users SET consent_version='withdrawn-consent' WHERE user_id=?").run(originalActor(f,slot));
  if(changed==='scope')f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
  if(changed==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'recovery-source',property_path:'text',new_value:'Changed after completion.'});
  if(changed==='retention')f.sqlite.prepare("UPDATE private_content SET redacted_at=?,content='' WHERE kind='provider-output'").run(new Date().toISOString());
  if(changed==='grant')f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=?").run(slot.grant_id);
  const response=await run();
  if(changed==='actor'){assert.equal(response.status,428);assert.equal((await response.clone().json()).error,'pilot_terms_required');}
  else if(changed==='scope'){assert.equal(response.status,403);assert.equal((await response.clone().json()).error,'project_access_revoked');}
  else assert.equal(response.status,200);
  await finish();assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(slot.job_id).status,'completed');assert.deepEqual(recoveryCompletions(f),completed);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(transport.counts(),sent);
  // A terminal receipt remains historical evidence; these tests never reopen its grant or job.
 });
});


// Guard-successor cases retain the frozen recovery fixture above. Additional gates own their release.
function recoveryFinancialState(f){
 return{
  reservations:{tokens:f.sqlite.prepare('SELECT * FROM budget_reservations ORDER BY reservation_id').all().map(row=>({...row})),costs:f.sqlite.prepare('SELECT * FROM cost_budget_reservations ORDER BY reservation_id').all().map(row=>({...row}))},
  tokens:f.sqlite.prepare('SELECT scope,scope_id,period,used_tokens,reserved_tokens,hard_limit_tokens FROM budget_counters ORDER BY scope,scope_id,period').all().map(row=>({...row})),
  costs:f.sqlite.prepare('SELECT scope,scope_id,period,used_microusd,reserved_microusd,hard_limit_microusd FROM cost_budget_counters ORDER BY scope,scope_id,period').all().map(row=>({...row})),
 };
}
function recoveryPublicationBatch(statements,slot){
 const custodyIndex=statements.findIndex(statement=>statement.sql.startsWith('UPDATE output_native_storage_writes SET publication_event_id=?,updated_at=?')&&statement.bindings[2]===slot.scope_key&&statement.bindings[3]===slot.slot_id);
 if(custodyIndex<0)return null;
 const custody=statements[custodyIndex],completionId=custody.bindings[0];
 const eventIndices=statements.flatMap((statement,index)=>statement.sql.startsWith('INSERT INTO event_write_stage')&&['GenerationCompleted','GenerationUsageRecorded'].includes(statement.bindings[11])?[index]:[]);
 assert.equal(eventIndices.length,2);assert.equal(statements[eventIndices[0]].bindings[0],completionId);
 assert.equal(statements[eventIndices[0]].bindings[11],'GenerationCompleted');assert.equal(statements[eventIndices[1]].bindings[11],'GenerationUsageRecorded');
 return{custodyIndex,custody,eventIndices,eventIds:eventIndices.map(index=>statements[index].bindings[0]),completionId};
}
function recoveryPublicationState(f,publication){
 const rows=ids=>ids.map(id=>({id,event:f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(id)??null,private:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id)??null}));
 return{events:rows(publication.eventIds),storage:{...f.sqlite.prepare('SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=?').get(...publication.custody.bindings.slice(2,5))}};
}
function assertRecoveryRangeAbsent(state){assert.ok(state.events.every(item=>item.event===null&&item.private===null),'neither the completion nor usage private/public envelope survives');}

test('Image recovery behavioral: old caller cannot settle the successor allowance or financial counters',async context=>{
 for(const shared of[false,true])await withImageRecovery(context,{stage:'planned',shared},async({f,slot,transport,gate,saved,first,run,expire,finish})=>{
  const batch=f.DB.batch.bind(f.DB);let releaseClaim,settlementReached;
  const claimReturn=new Promise(resolve=>{releaseClaim=resolve;}),settlement=new Promise(resolve=>{settlementReached=resolve;});
  const release=()=>{claimHeld=false;releaseClaim();gate.release();};let claimHeld=false,successorCorrelation=null,financialRead=null,afterHandoff=null;const rollbacks=[];
  f.DB.batch=async statements=>{
   const claim=statements.find(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1")&&statement.bindings[5]===slot.job_id);
   if(!claimHeld&&claim){
    claimHeld=true;successorCorrelation=claim.bindings[0];const results=await batch(statements);
    assert.equal(Number(results[statements.indexOf(claim)].meta.changes),1);assert.equal(gate.row().correlation_id,successorCorrelation);
    afterHandoff=recoveryFinancialState(f);await claimReturn;return results;
   }
   const financial=claimHeld&&statements.some(statement=>statement.sql.startsWith('SELECT cost_budget_reservations.*')&&statement.sql.includes('AS output_correlation_id'));
   if(financial){
    const results=await batch(statements),cost=results.find(result=>result.results.some(row=>Object.hasOwn(row,'output_correlation_id')))?.results[0];
    assert.ok(cost);assert.equal(cost.output_correlation_id,successorCorrelation);assert.equal(cost.correlation_id,successorCorrelation);
    const calls=JSON.parse(cost.output_calls_json);assert.equal(calls.length,1);assert.equal(calls[0].stage,'planning:initial');assert.equal(calls[0].status,'settled');
    financialRead={correlation:cost.output_correlation_id,calls};return results;
   }
   const finalSettlement=claimHeld&&statements.some(statement=>statement.sql.startsWith('UPDATE budget_reservations SET used_tokens='))&&statements.some(statement=>statement.sql.startsWith('UPDATE cost_budget_reservations SET used_microusd='));
   if(finalSettlement){
    assert.ok(financialRead,'the old caller already read the successor-correlated planner-only allowance');assert.ok(afterHandoff);
    const identity=statements.find(statement=>statement.sql.includes('EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=?)'));
    assert.ok(identity);assert.deepEqual(identity.bindings.slice(1),[saved.job.job_id,saved.job.owner_id,saved.job.stream_id,saved.job.correlation_id,saved.job.attempt_count]);
    const before=recoveryFinancialState(f);assert.deepEqual(before,afterHandoff);
    try{const result=await batch(statements);assert.fail(`Old settlement unexpectedly committed ${result.length} statements`);}
    catch(error){assert.match(String(error),/CHECK constraint failed/u);const rollback={before,after:recoveryFinancialState(f)};assert.deepEqual(rollback.after,rollback.before);rollbacks.push(rollback);settlementReached(rollback);throw error;}
   }
   return batch(statements);
  };
  try{
   expire();const successor=run();
   await imageRecoveryBounded(Promise.race([settlement,first.then(()=>{if(!rollbacks.length)throw new Error('Original worker settled without attempting the guarded financial transaction');})]),release,'old caller settlement rollback');
   await imageRecoveryBounded(first,release,'original caller settlement completion');assert.ok(rollbacks.length>=1);assert.ok(rollbacks.every(item=>JSON.stringify(item.after)===JSON.stringify(item.before)));
   assert.equal(transport.sent.find(item=>item.address.endsWith('/responses')).signal.aborted,false,'original inner operation settled before the successor can continue');
   assert.equal(gate.row().attempt_count,2);assert.deepEqual(transport.counts(),{planner:1,image:0,moderation:0});
   const payer=f.sqlite.prepare('SELECT payer_user_id FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).payer_user_id,period=afterHandoff.reservations.tokens[0].period;
   const keys=[['user',payer],['workspace','forma'],...(shared?[['workspace',f.organizationId]]:[])];
   for(const [scope,id]of keys)for(const rows of[afterHandoff.tokens,afterHandoff.costs])assert.ok(rows.some(row=>row.scope===scope&&row.scope_id===id&&row.period===period),`missing ${scope}/${id} counter`);
   claimHeld=false;releaseClaim();const response=await imageRecoveryBounded(successor,release,'successor completion');assert.equal(response.status,200);await finish();assert.equal(gate.row().status,'completed',gate.row().error_message);
   const final=recoveryFinancialState(f),calls=recoveryCalls(f),receipts=Object.values(JSON.parse(gate.row().result_json).providerSubmissions);
   assert.equal(calls.length,2);assert.ok(calls.every(call=>call.status==='settled'));assert.equal(receipts.filter(receipt=>receipt.status==='completed').length,2);
   const usedTokens=receipts.filter(receipt=>receipt.status==='completed').reduce((sum,receipt)=>sum+receipt.totalTokens,0),usedMicrousd=calls.reduce((sum,call)=>sum+call.used_microusd,0);
   assert.equal(final.reservations.tokens.length,1);assert.equal(final.reservations.costs.length,1);
   assert.equal(final.reservations.tokens[0].used_tokens,usedTokens);assert.equal(final.reservations.costs[0].used_microusd,usedMicrousd);
   for(const reservation of[final.reservations.tokens[0],final.reservations.costs[0]]){assert.equal(reservation.status,'settled');assert.equal(reservation.correlation_id,successorCorrelation);}
   const owns=row=>row.period===period&&keys.some(([scope,id])=>row.scope===scope&&row.scope_id===id);
   assert.deepEqual(final.tokens,afterHandoff.tokens.map(row=>owns(row)?{...row,used_tokens:row.used_tokens+usedTokens,reserved_tokens:row.reserved_tokens-slot.maximum_tokens}:row));
   assert.deepEqual(final.costs,afterHandoff.costs.map(row=>owns(row)?{...row,used_microusd:row.used_microusd+usedMicrousd,reserved_microusd:row.reserved_microusd-slot.maximum_microusd}:row));
   const finalCounters={tokens:final.tokens,costs:final.costs};await run();const replay=recoveryFinancialState(f);assert.deepEqual({tokens:replay.tokens,costs:replay.costs},finalCounters);
   assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});assert.equal(recoveryCompletions(f).length,1);
   await first;assert.equal(transport.sent.find(item=>item.address.endsWith('/responses')).signal.aborted,false,'original inner operation settled without a detached heartbeat exit');
   // The real shared fixture covers organization/global/user counters; it does not create fixed pilot-cohort counters.
  }finally{release();await finish();}
 });
});

test('Image recovery behavioral: publication accepts its exact existing event link and rejects a different link',async context=>{
 for(const link of['same','different'])await withImageRecovery(context,{stage:'rendered'},async({f,slot,transport,gate,saved,run,expire,finish,mediaCounts})=>{
  const batch=f.DB.batch.bind(f.DB),beforeCalls=recoveryCalls(f),beforeMedia=mediaCounts(),retained=retainedImageStage(f,saved.pointer);let witnessed=null;
  f.DB.batch=async statements=>{
   const publication=recoveryPublicationBatch(statements,slot);if(!publication||witnessed)return batch(statements);
   witnessed={publication};
   if(link==='different'){
    const otherId=retained.envelope.stage.compiledEventId;assert.ok(f.sqlite.prepare('SELECT 1 FROM events WHERE event_id=?').get(otherId));assert.notEqual(otherId,publication.completionId);
    assert.equal(f.sqlite.prepare('UPDATE output_native_storage_writes SET publication_event_id=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND publication_event_id IS NULL').run(otherId,...publication.custody.bindings.slice(2,5)).changes,1);
    const before=recoveryPublicationState(f,publication);
    try{await batch(statements);assert.fail('Conflicting custody link unexpectedly committed');}
    catch(error){assert.match(String(error),/CHECK constraint failed/u);const after=recoveryPublicationState(f,publication);assertRecoveryRangeAbsent(after);assert.deepEqual(after.storage,before.storage);witnessed.after=after;throw error;}
   }
   const setupIndex=statements.findIndex(statement=>statement.sql.includes('(publication_event_id IS NULL OR publication_event_id=?)'));
   assert.ok(setupIndex>Math.max(...publication.eventIndices));assert.ok(setupIndex<publication.custodyIndex);
   // The event/private envelopes are real INSERTs in this transaction; this explicit setup covers the same-link SQL branch.
   const setup=f.DB.prepare('UPDATE output_native_storage_writes SET publication_event_id=? WHERE scope_key=? AND slot_id=? AND storage_key=? AND publication_event_id IS NULL AND EXISTS(SELECT 1 FROM events WHERE event_id=?)').bind(publication.completionId,...publication.custody.bindings.slice(2,5),publication.completionId);
   const expanded=await batch([...statements.slice(0,setupIndex),setup,...statements.slice(setupIndex)]);
   assert.equal(Number(expanded[setupIndex].meta.changes),1);
   const results=[...expanded.slice(0,setupIndex),...expanded.slice(setupIndex+1)];assert.equal(results.length,statements.length);
   assert.equal(Number(results[publication.custodyIndex].meta.changes),0,'same-event custody is already linked, so the guarded update is idempotent');
   assert.ok(publication.eventIndices.every(index=>Number(results[index].meta.changes)===1));const after=recoveryPublicationState(f,publication);
   assert.equal(after.storage.publication_event_id,publication.completionId);witnessed.after=after;return results;
  };
  try{
   expire();const response=await run();assert.equal(response.status,200);await finish();assert.ok(witnessed?.after);
   assert.equal(gate.row().status,link==='same'?'completed':'failed',gate.row().error_message);assert.equal(recoveryCompletions(f).length,link==='same'?1:0);
   assert.deepEqual(recoveryCalls(f),beforeCalls);assert.equal(mediaCounts().puts,beforeMedia.puts);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
   if(link==='same'){const published=recoveryCompletions(f);await run();assert.deepEqual(recoveryCompletions(f),published);}
  }finally{gate.release();await finish();}
 });
});

test('Image recovery behavioral: final publication rechecks retained stage and call-set custody after recovery read',async context=>{
 for(const mutation of['redact','expire','call-set'])await withImageRecovery(context,{stage:'rendered'},async({f,slot,transport,gate,saved,run,expire,finish,mediaCounts})=>{
  const batch=f.DB.batch.bind(f.DB),beforeCalls=recoveryCalls(f),beforeMedia=mediaCounts();let witnessed=null;
  f.DB.batch=async statements=>{
   const publication=recoveryPublicationBatch(statements,slot);if(!publication||witnessed)return batch(statements);
   witnessed={publication};assert.ok(mediaCounts().reads>beforeMedia.reads,'actual retained bytes were read before the final publication seam');
   if(mutation==='redact')assert.equal(f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),saved.pointer.contentId).changes,1);
   if(mutation==='expire')assert.equal(f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run('2000-01-01T00:00:00.000Z',saved.pointer.contentId).changes,1);
   if(mutation==='call-set')assert.equal(f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=? WHERE scope_key=? AND slot_id=? AND call_key='image:initial'").run('d'.repeat(64),slot.scope_key,slot.slot_id).changes,1);
   const before=recoveryPublicationState(f,publication);assertRecoveryRangeAbsent(before);assert.equal(before.storage.publication_event_id,null);
   try{await batch(statements);assert.fail('Withdrawn publication custody unexpectedly committed');}
   catch(error){assert.match(String(error),/CHECK constraint failed/u);const after=recoveryPublicationState(f,publication);assertRecoveryRangeAbsent(after);assert.deepEqual(after.storage,before.storage);witnessed.after=after;throw error;}
  };
  try{
   expire();const response=await run();assert.equal(response.status,200);await finish();assert.ok(witnessed?.after);assert.equal(gate.row().status,'failed');assert.equal(recoveryCompletions(f).length,0);
   const expectedCalls=beforeCalls.map(call=>mutation==='call-set'&&call.call_key==='image:initial'?{...call,request_digest:'d'.repeat(64)}:call);assert.deepEqual(recoveryCalls(f),expectedCalls);
   assert.equal(mediaCounts().puts,beforeMedia.puts);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
  }finally{gate.release();await finish();}
 });
 // Advance only this fixture database's clock after real event INSERTs; never edit the admitted source cutoff or production clocks.
 for(const shared of[false,true]){
  const sourceDeadline=new Date(Date.now()+30_000).toISOString(),cutoff=Date.parse(sourceDeadline);
  await withImageRecovery(context,{stage:'rendered',shared,sourceDeadline},async({f,slot,transport,gate,saved,run,expire,finish,mediaCounts})=>{
   const batch=f.DB.batch.bind(f.DB),beforeCalls=recoveryCalls(f),beforeMedia=mediaCounts(),retained=retainedImageStage(f,saved.pointer);
   const prototype=Object.getPrototypeOf(f.DB.prepare('SELECT 1')),descriptor=Object.getOwnPropertyDescriptor(prototype,'execute');
   const deadlineSql="INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN ((CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))<?) THEN 1 ELSE 0 END)";
   const clockErrors=[];let clockNow=null,witnessed=null;
   f.DB.batch=async statements=>{
    const publication=recoveryPublicationBatch(statements,slot);if(!publication||witnessed)return batch(statements);
    const firstInsert=publication.eventIndices[0],lastInsert=publication.eventIndices.at(-1);
    const deadlines=statements.flatMap((statement,index)=>statement.sql===deadlineSql&&statement.bindings.length===2&&statement.bindings[1]===cutoff?[index]:[]);
    const preIndices=deadlines.filter(index=>index<firstInsert),lateIndices=deadlines.filter(index=>index>lastInsert&&index<publication.custodyIndex);
    const witness={publication,preIndices,lateIndices,pre:[],inserts:[],before:recoveryPublicationState(f,publication),financialBefore:recoveryFinancialState(f)};witnessed=witness;
    assert.ok(preIndices.length>0,'the original cutoff is checked before any event write');assert.equal(lateIndices.length,1,'the original cutoff has a dedicated late publication CHECK');
    assertRecoveryRangeAbsent(witness.before);assert.equal(witness.before.storage.publication_event_id,null);assert.ok(mediaCounts().reads>beforeMedia.reads);
    const beforeTime=cutoff-1,afterTime=cutoff+1,job=gate.row(),grant=f.sqlite.prepare('SELECT * FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id);
    witness.otherDeadlines={lease:Date.parse(job.lease_expires_at),grant:Date.parse(grant.expires_at),retained:Date.parse(retained.row.expires_at)};
    for(const [name,value]of Object.entries(witness.otherDeadlines))assert.ok(Number.isFinite(value)&&value>afterTime,`${name} remains valid on both sides of the source cutoff`);
    assert.ok(Date.now()<beforeTime,'fixture setup reaches the boundary while the original source is still authorized');
    // This connection-local UDF supports only the authority SQL's exact now formats. Unsupported calls are recorded and fail the outer test.
    f.sqlite.function('strftime',{varargs:true},(format,value,...extra)=>{
     if(value!=='now'||extra.length||!['%s','%f','%Y-%m-%dT%H:%M:%fZ'].includes(format)){clockErrors.push({format,value,extra});throw new Error('unsupported recovery fixture SQL clock');}
     const time=clockNow??Date.now(),iso=new Date(time).toISOString();return format==='%s'?String(Math.floor(time/1000)):format==='%f'?iso.slice(17,23):iso;
    });
    clockNow=beforeTime;
    Object.defineProperty(prototype,'execute',{...descriptor,value:function(kind){
     const index=statements.indexOf(this);
     try{
      const result=descriptor.value.call(this,kind);
      if(preIndices.includes(index))witness.pre.push({index,time:clockNow,changes:result.meta.changes});
      if(publication.eventIndices.includes(index))witness.inserts.push({index,changes:Number(result.meta.changes)});
      if(index===lastInsert){witness.inserted=recoveryPublicationState(f,publication);clockNow=afterTime;}
      if(index===statements.length-1)clockNow=null;
      return result;
     }catch(error){if(index===lateIndices[0])witness.lateFailure={index,time:clockNow,sql:this.sql,bindings:[...this.bindings],error:String(error)};if(index>=0)clockNow=null;throw error;}
    }});
    let failure,results;
    try{results=await batch(statements);}
    catch(error){failure=error;}
    finally{clockNow=null;Object.defineProperty(prototype,'execute',descriptor);}
    // Capture after the real batch rollback; validation occurs outside the product invocation below.
    witness.after=recoveryPublicationState(f,publication);witness.financialAfter=recoveryFinancialState(f);witness.batchFailure=failure;
    if(failure)throw failure;return results;
   };
   try{
    expire();const response=await run();assert.equal(response.status,200);await finish();
    assert.deepEqual(clockErrors,[]);assert.ok(witnessed?.after);assert.match(String(witnessed.batchFailure),/CHECK constraint failed/u);
    assert.deepEqual(witnessed.pre.map(item=>item.index),witnessed.preIndices);assert.ok(witnessed.pre.every(item=>item.time===cutoff-1));
    assert.deepEqual(witnessed.inserts,witnessed.publication.eventIndices.map(index=>({index,changes:1})));
    assert.ok(witnessed.inserted.events.every(item=>item.event!==null&&item.private!==null),'both real public/private events existed inside the losing transaction');
    assert.equal(witnessed.lateFailure?.index,witnessed.lateIndices[0]);assert.equal(witnessed.lateFailure?.time,cutoff+1);assert.equal(witnessed.lateFailure?.sql,deadlineSql);assert.equal(witnessed.lateFailure?.bindings[1],cutoff);assert.match(witnessed.lateFailure?.error??'',/CHECK constraint failed/u);
    for(const value of Object.values(witnessed.otherDeadlines))assert.ok(value>cutoff+1);
    assertRecoveryRangeAbsent(witnessed.before);assertRecoveryRangeAbsent(witnessed.after);assert.deepEqual(witnessed.after.storage,witnessed.before.storage);assert.deepEqual(witnessed.financialAfter,witnessed.financialBefore);
    assert.equal(gate.row().status,'failed',JSON.stringify({shared,error:gate.row().error_message}));assert.equal(recoveryCompletions(f).length,0);assert.deepEqual(recoveryCalls(f),beforeCalls);assert.equal(mediaCounts().puts,beforeMedia.puts);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
    assert.deepEqual(retainedImageStage(f,saved.pointer),retained,'the original retained source proof was not altered to produce expiry');
   }finally{
    clockNow=null;Object.defineProperty(prototype,'execute',descriptor);gate.release();await finish();
    // The per-connection UDF is in real-time mode until the existing fixture finally closes this database; no built-in restoration is claimed.
   }
  });
 }
});

test('Image recovery behavioral: zero-event head loss leaves no completion custody receipt',async context=>{
 await withImageRecovery(context,{stage:'rendered'},async({f,slot,transport,gate,run,expire,finish,mediaCounts})=>{
  const batch=f.DB.batch.bind(f.DB),beforeCalls=recoveryCalls(f),beforeMedia=mediaCounts();let losing=null;
  f.DB.batch=async statements=>{
   const publication=recoveryPublicationBatch(statements,slot);if(!publication||losing)return batch(statements);
   losing={publication};const before=recoveryPublicationState(f,publication);assertRecoveryRangeAbsent(before);
   // Two real, source-neutral appends advance past both individual completion/usage INSERT head predicates.
   const opens=[];for(let index=0;index<publication.eventIndices.length;index++)opens.push(await appendAuditEvent(f.env,stream,'user','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'}));
   assert.equal(opens.length,2);const head=await streamHead(f.env,stream);assert.ok(publication.eventIndices.every(index=>head>Number(statements[index].bindings.at(-1))));
   const results=await batch(statements);losing.eventChanges=publication.eventIndices.map(index=>Number(results[index].meta.changes));losing.custodyChanges=Number(results[publication.custodyIndex].meta.changes);
   assert.deepEqual(losing.eventChanges,[0,0]);assert.equal(losing.custodyChanges,0);const state=recoveryPublicationState(f,publication);assertRecoveryRangeAbsent(state);assert.deepEqual(state.storage,before.storage);losing.state=state;
   return results;
  };
  try{
   expire();const response=await run();assert.equal(response.status,200);await finish();assert.ok(losing?.state);assert.deepEqual(losing.eventChanges,[0,0]);assert.equal(losing.custodyChanges,0);
   // The losing-batch witness is independent of downstream contention handling; the native append allows one attempt, not an automatic successful retry.
   assert.equal(recoveryCompletions(f).length,0);assert.equal(gate.row().status,'failed');assert.deepEqual(recoveryCalls(f),beforeCalls);assert.equal(mediaCounts().puts,beforeMedia.puts);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
  }finally{gate.release();await finish();}
 });
});


// Server-wakeup successor: use the existing real Output fixtures and their joined
// checkpoint gates above. Only external transport remains mocked; recovery is
// invoked directly without a browser, polling request, or replacement grant.
const {recoverServerImageJobs}=await import('../worker/document-jobs-api.ts');
const {documentJobMaxAttempts}=await import('../src/model/document-jobs.ts');
const wakeupJob=(f,id)=>({...f.sqlite.prepare('SELECT * FROM document_jobs WHERE job_id=?').get(id)});
const wakeupSlotCalls=(f,slot)=>recoveryCalls(f).filter(call=>call.slot_id===slot.slot_id);
const wakeupIdentities=f=>({
 jobs:f.sqlite.prepare('SELECT job_id,owner_id,stream_id,document_id FROM document_jobs ORDER BY job_id').all().map(row=>({...row})),
 slots:f.sqlite.prepare('SELECT slot_id,job_id,grant_id,scope_key,token_reservation_id,cost_reservation_id FROM output_operation_slots ORDER BY slot_id').all().map(row=>({...row})),
 grants:f.sqlite.prepare('SELECT grant_id,actor_user_id,scope_key FROM output_execution_grants ORDER BY grant_id').all().map(row=>({...row})),
 tokens:f.sqlite.prepare('SELECT reservation_id,owner_id,stream_id,operation,period,reserved_tokens FROM budget_reservations ORDER BY reservation_id').all().map(row=>({...row})),
 costs:f.sqlite.prepare('SELECT reservation_id,owner_id,stream_id,operation,period,reserved_microusd FROM cost_budget_reservations ORDER BY reservation_id').all().map(row=>({...row})),
});
async function queuedImageForSecondActor(f){
 const actor='wakeup-second-actor',actorStream=`creative:${actor}`,documentId='wakeup-second-document';
 const headers={'oai-authenticated-user-id':actor,'oai-authenticated-user-email':'wakeup-second@example.test'};
 const session=body=>handleSession(new Request('http://localhost/api/session',{...(body?init(body):{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers}}),f.env);
 assert.equal((await session()).status,200);
 // Seed this genuine stream before ConsentAccepted makes it nonempty.
 assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers}),f.env)).status,200);
 assert.equal((await session({action:'accept_terms',ownershipConfirmed:true,providerProcessingConfirmed:true})).status,200);
 await appendAuditEvent(f.env,actorStream,'user','DocumentCreated',{document_id:documentId,project_id:'project-atmosphere',title:'Second orchard'});
 await appendAuditEvent(f.env,actorStream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:'wakeup-second-source',type:'message',handle:'wakeup-second-source',position:'0',properties:{text:'A second orchard preserves established roots.',weight:1}});
 let command=0;
 const request=(path=BASE,body)=>handleOutputRequirements(new Request(`http://localhost${path}${body?'':`${path.includes('?')?'&':'?'}documentId=${documentId}`}`,{...(body?init(body):{}),headers:{...(body?{'content-type':'application/json'}:{}),...headers}}),f.env,path.split('?')[0],{waitUntil(){throw new Error('Second actor setup must not execute detached work');}},outputDocumentExecutionBridge);
 const second={documentId,request,ok:f.ok,send:async(body,key)=>request(BASE,{documentId,expectedRevision:`output:${await streamHead(f.env,actorStream)}`,clientMutationId:key??`second-command-${++command}`,...body})};
 const plan=await saveImages(second),auth=await authorize(second,plan.planId,[plan.targetIds[0]]);
 await second.ok(await second.send({action:'run',grantId:auth.grantId}));
 const slots=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE grant_id=?').all(auth.grantId);assert.equal(slots.length,1);
 const slot={...slots[0]},job=wakeupJob(f,slot.job_id);
 assert.equal(job.owner_id,actor);assert.equal(job.stream_id,actorStream);assert.equal(job.document_id,documentId);assert.equal(job.status,'queued');assert.equal(job.attempt_count,0);
 assert.equal(originalActor(f,slot),actor);
 return{actor,actorStream,documentId,slot,job};
}

test('Image server wakeup: browser-absent Start uses bounded selection and the original admitted identities',async context=>{
 const {readFile}=await import('node:fs/promises');
 const workerSource=await readFile(new URL('../worker/index.ts',import.meta.url),'utf8');
 const scheduled=workerSource.match(/async scheduled\([^\n]+\{([\s\S]*?)\n\s*\},/u)?.[1];assert.ok(scheduled,'the real Worker owns a scheduled wakeup');
 assert.deepEqual([...scheduled.matchAll(/\bawait\s+(\w+)\(([^)]*)\)/gu)].map(match=>[match[1],match[2].replaceAll(' ','')]),[['observeScheduledRetention','env,1_000'],['sweepExpiredDocumentProfileSuppressions','env,128'],['processReviewReminders','env,100'],['recoverServerImageJobs','env'],['recoverServerImageTerminalJobs','env']]);
 const unavailable=new Proxy({},{get(){throw new Error('zero-budget wakeup must not access any runtime port');}});
 assert.deepEqual(await recoverServerImageJobs(unavailable,{candidateLimit:0}),{inspected:0,attempted:0});
 assert.deepEqual(await recoverServerImageJobs(unavailable,{executionLimit:0}),{inspected:0,attempted:0});
 const transport=imageRecoveryTransport(context),f=await fixture([{block_id:'wakeup-source',type:'message',properties:{text:'An orchard shelters mature pear trees.'}}]);
 try{
  const plan=await saveImages(f),auth=await authorize(f,plan.planId,plan.targetIds);
  await f.ok(await f.send({action:'run',grantId:auth.grantId}));
  const slots=f.sqlite.prepare('SELECT * FROM output_operation_slots ORDER BY job_id').all().map(row=>({...row}));assert.equal(slots.length,2);
  const original=wakeupIdentities(f),queued=slots.map(slot=>wakeupJob(f,slot.job_id));assert.ok(queued.every(row=>row.status==='queued'&&row.attempt_count===0));
  assert.deepEqual(transport.counts(),{planner:0,image:0,moderation:0});
  assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:0,executionLimit:1}),{inspected:0,attempted:0});
  assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:25,executionLimit:0}),{inspected:0,attempted:0});
  assert.deepEqual(slots.map(slot=>wakeupJob(f,slot.job_id)),queued,'zero limits do not claim or mutate queued jobs');
  assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:1,executionLimit:5}),{inspected:1,attempted:1});
  assert.deepEqual(slots.map(slot=>wakeupJob(f,slot.job_id).status).sort(),['completed','queued']);
  assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});
  assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:NaN,executionLimit:Infinity}),{inspected:1,attempted:1},'invalid limits fall back to the one-execution default');
  assert.ok(slots.every(slot=>wakeupJob(f,slot.job_id).status==='completed'));
  assert.ok(slots.every(slot=>wakeupJob(f,slot.job_id).attempt_count===1));
  assert.deepEqual(transport.counts(),{planner:2,image:2,moderation:2});assert.deepEqual(wakeupIdentities(f),original);
  const complete=slots.map(slot=>wakeupJob(f,slot.job_id)),calls=recoveryCalls(f),settled=slots.map(slot=>recoveryReservations(f,slot));
  assert.deepEqual(await recoverServerImageJobs(f.env),{inspected:0,attempted:0});
  assert.deepEqual(slots.map(slot=>wakeupJob(f,slot.job_id)),complete);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(slots.map(slot=>recoveryReservations(f,slot)),settled);
 }finally{f.sqlite.close();}
});

test('Image server wakeup: retained planned and rendered work resumes without repeating paid stages',async context=>{
 for(const shared of[false,true])for(const stage of['planned','rendered'])await context.test(`${shared?'project':'personal'} ${stage}`,async child=>{
  await withImageRecovery(child,{stage,shared},async({f,slot,transport,gate,saved,first,track,expire,finish,admission,originalAdmission,mediaCounts})=>{
   const retained=retainedImageStage(f,saved.pointer),calls=recoveryCalls(f),media=mediaCounts();
   const ids=[retained.envelope.stage.requestedEventId,retained.envelope.stage.compiledEventId,retained.envelope.stage.budgetEventId];
   const anchors=()=>ids.map(id=>({event:f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(id),private:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id)}));
   const originalAnchors=anchors();assert.ok(originalAnchors.every(anchor=>anchor.event&&anchor.private));
   expire();const result=await imageRecoveryBounded(track(recoverServerImageJobs(f.env)),gate.release,'server wakeup recovery');assert.deepEqual(result,{inspected:1,attempted:1});
   await finish();const completed=gate.row();assert.equal(completed.status,'completed',completed.error_message);assert.equal(completed.attempt_count,2);
   assert.deepEqual(admission(),originalAdmission);assert.deepEqual(anchors(),originalAnchors);assert.equal(recoveryCompletions(f).length,1);
   assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});assert.deepEqual(recoveryCalls(f).find(call=>call.call_key==='planning:initial'),calls.find(call=>call.call_key==='planning:initial'));
   assert.equal(f.sqlite.prepare('SELECT content FROM private_content WHERE content_id=?').get(saved.pointer.contentId).content,retained.row.content);
   if(stage==='rendered'){assert.deepEqual(recoveryCalls(f),calls);assert.equal(mediaCounts().puts,media.puts);assert.ok(mediaCounts().reads>media.reads);}
   const settled=recoveryReservations(f,slot);assert.equal(settled.token.correlation_id,completed.correlation_id);assert.equal(settled.cost.correlation_id,completed.correlation_id);
   assert.equal(settled.token.status,'settled');assert.equal(settled.cost.status,'settled');
   const published=recoveryCompletions(f);assert.deepEqual(await recoverServerImageJobs(f.env),{inspected:0,attempted:0});assert.deepEqual(recoveryCompletions(f),published);assert.deepEqual(recoveryReservations(f,slot),settled);
   await first;assert.equal(transport.sent.find(item=>item.address.endsWith('/responses')).signal.aborted,false,'the original attempt is joined, not abandoned behind a timer');
  });
 });
});

test('Image server wakeup: current authority, native leases and the attempt cap exclude reentry',async context=>{
 await context.test('genuine non-Image Output',async child=>{
  child.mock.method(globalThis,'fetch',()=>{throw new Error('Image wakeup must not dispatch a non-Image provider');});
  const f=await fixture();
  try{
   const plan=await saveDeck(f),auth=await authorize(f,plan.planId,[plan.targetId]);await f.ok(await f.send({action:'run',grantId:auth.grantId}));
   const slot={...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE grant_id=?').get(auth.grantId)},before=wakeupJob(f,slot.job_id);
   assert.equal(before.kind,'render_document');assert.equal(JSON.parse(before.request_json).artifactKind,'slides');assert.equal(before.status,'queued');assert.equal(before.attempt_count,0);
   const identities=wakeupIdentities(f),held=recoveryReservations(f,slot),calls=recoveryCalls(f),grant={...f.sqlite.prepare('SELECT * FROM output_execution_grants WHERE grant_id=?').get(auth.grantId)};
   assert.deepEqual(await recoverServerImageJobs(f.env),{inspected:0,attempted:0});
   assert.deepEqual(wakeupJob(f,slot.job_id),before);assert.deepEqual({...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id)},slot);
   assert.deepEqual({...f.sqlite.prepare('SELECT * FROM output_execution_grants WHERE grant_id=?').get(auth.grantId)},grant);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(wakeupIdentities(f),identities);
  }finally{f.sqlite.close();}
 });
 for(const changed of['live-lease','attempt-cap','actor','context','context-expiry','grant','grant-expiry','source'])await context.test(changed,async child=>{
  await withImageRecovery(child,{stage:'planned',shared:true},async({f,slot,transport,gate,saved,expire})=>{
   if(changed!=='live-lease')expire();
   if(changed==='attempt-cap')f.sqlite.prepare('UPDATE document_jobs SET attempt_count=? WHERE job_id=?').run(documentJobMaxAttempts('generate'),slot.job_id);
   if(changed==='actor')f.sqlite.prepare("UPDATE users SET consent_version='withdrawn-consent' WHERE user_id=?").run(originalActor(f,slot));
   if(changed==='context')f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
   if(changed==='context-expiry')f.sqlite.prepare('UPDATE project_context_sessions SET expires_at=? WHERE context_id=?').run('2000-01-01T00:00:00.000Z',f.contextId);
   if(changed==='grant')f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=?").run(slot.grant_id);
   if(changed==='grant-expiry')f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=? WHERE grant_id=?').run('2000-01-01T00:00:00.000Z',slot.grant_id);
   if(changed==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'recovery-source',property_path:'text',new_value:'The source changed after the retained plan.'});
   const before=gate.row(),calls=recoveryCalls(f),held=recoveryReservations(f,slot),sent=transport.counts(),identities=wakeupIdentities(f),retained=retainedImageStage(f,saved.pointer);
   const result=await recoverServerImageJobs(f.env);assert.deepEqual(result,{inspected:['live-lease','attempt-cap','grant','grant-expiry'].includes(changed)?0:1,attempted:0},'SQL eligibility and current read-only authority each exclude the job before execution');
   assert.deepEqual(gate.row(),before);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(transport.counts(),sent);assert.deepEqual(wakeupIdentities(f),identities);assert.deepEqual(retainedImageStage(f,saved.pointer),retained);
   assert.equal(recoveryCompletions(f).length,0);
  });
 });
});

test('Image server wakeup: unresolved and missing retained stages do not spend the sole execution budget',async context=>{
 for(const heldKind of['pending','missing-stage','missing-pointer','malformed-anchor','scalar-anchor','array-anchor'])await context.test(heldKind,async child=>{
  await withImageRecovery(child,{stage:heldKind==='pending'?'pending':'planned'},async({f,slot,transport,gate,saved,expire})=>{
   expire();
   if(heldKind==='missing-stage')assert.equal(f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(saved.pointer.contentId).changes,1);
   if(heldKind==='missing-pointer')assert.equal(f.sqlite.prepare("UPDATE document_jobs SET result_json=json_remove(result_json,'$.imageRecovery') WHERE job_id=?").run(slot.job_id).changes,1);
   if(heldKind.endsWith('-anchor')){const retained=retainedImageStage(f,saved.pointer),privateJson=heldKind==='malformed-anchor'?'{':heldKind==='scalar-anchor'?'0':'[]';assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=?').run(privateJson,retained.envelope.stage.budgetEventId).changes,1);}
   const second=await queuedImageForSecondActor(f);
   const before=gate.row(),calls=wakeupSlotCalls(f,slot),held=recoveryReservations(f,slot),sent=transport.counts(),identities=wakeupIdentities(f);
   const evidence=()=>({stage:saved.pointer?f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(saved.pointer.contentId)??null:null,events:f.sqlite.prepare('SELECT * FROM events WHERE stream_id=? AND correlation_id=? ORDER BY sequence').all(saved.job.stream_id,saved.job.correlation_id),private:f.sqlite.prepare('SELECT body.* FROM event_private_payloads body JOIN events event ON event.event_id=body.private_event_id WHERE event.stream_id=? AND event.correlation_id=? ORDER BY event.sequence').all(saved.job.stream_id,saved.job.correlation_id)});const heldEvidence=evidence();
   const completionBaseline=imageRecoveryCompletionRows(f),baselineIds=new Set(completionBaseline.map(row=>row.event_id));
   assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:1,executionLimit:1}),{inspected:1,attempted:0});
   assert.equal(wakeupJob(f,second.slot.job_id).status,'queued');assert.deepEqual(transport.counts(),sent);
   const firstCursor={...f.sqlite.prepare("SELECT * FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").get()};assert.equal(firstCursor.last_requested_at,before.requested_at);assert.equal(firstCursor.last_job_id,before.job_id);
   assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:1,executionLimit:1}),{inspected:1,attempted:1},'the next bounded tick advances past the held prefix');
   const secondCursor={...f.sqlite.prepare("SELECT * FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").get()};assert.equal(secondCursor.last_requested_at,second.job.requested_at);assert.equal(secondCursor.last_job_id,second.job.job_id);assert.equal(secondCursor.version,firstCursor.version+1);
   assert.deepEqual(gate.row(),before);assert.deepEqual(wakeupSlotCalls(f,slot),calls);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(evidence(),heldEvidence);
   const completed=wakeupJob(f,second.slot.job_id);assert.equal(completed.status,'completed',completed.error_message);assert.equal(completed.attempt_count,1);assert.equal(completed.owner_id,second.actor);assert.equal(completed.stream_id,second.actorStream);
   assert.deepEqual(transport.counts(),{planner:sent.planner+1,image:sent.image+1,moderation:sent.moderation+1});assert.deepEqual(wakeupIdentities(f),identities);
   const completions=imageRecoveryCompletionRows(f);assert.deepEqual(completions.filter(row=>baselineIds.has(row.event_id)),completionBaseline);
   const fresh=completions.filter(row=>!baselineIds.has(row.event_id));assert.equal(fresh.length,1);assert.equal(fresh[0].correlation_id,completed.correlation_id);
   assert.equal(wakeupSlotCalls(f,second.slot).length,2);assert.ok(wakeupSlotCalls(f,second.slot).every(call=>call.status==='settled'));
   const settledSecond=recoveryReservations(f,second.slot),secondCalls=wakeupSlotCalls(f,second.slot);
   assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:1,executionLimit:1}),{inspected:1,attempted:0},'an exhausted suffix wraps once to the same unresolved first job');
   const wrapped={...f.sqlite.prepare("SELECT * FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").get()};assert.equal(wrapped.last_requested_at,before.requested_at);assert.equal(wrapped.last_job_id,before.job_id);assert.equal(wrapped.version,secondCursor.version+2,'reset and visited-candidate advancement each consume their exact cursor version');
   assert.deepEqual(gate.row(),before);assert.deepEqual(wakeupSlotCalls(f,slot),calls);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(wakeupJob(f,second.slot.job_id),completed);assert.deepEqual(recoveryReservations(f,second.slot),settledSecond);assert.deepEqual(wakeupSlotCalls(f,second.slot),secondCalls);assert.deepEqual(wakeupIdentities(f),identities);assert.deepEqual(evidence(),heldEvidence);assert.deepEqual(imageRecoveryCompletionRows(f),completions);assert.deepEqual(transport.counts(),{planner:sent.planner+1,image:sent.image+1,moderation:sent.moderation+1});
  });
 });
});

test('Image server wakeup: competing ticks and late CAS changes cannot purchase a replacement attempt',async context=>{
 await context.test('cursor CAS loser',async child=>{
  await withImageRecovery(child,{stage:'planned'},async({f,slot,transport,gate,expire})=>{
   expire();const before=gate.row(),calls=recoveryCalls(f),held=recoveryReservations(f,slot),identities=wakeupIdentities(f),sent=transport.counts();
   const prepare=f.DB.prepare.bind(f.DB);let raced=false,cursorBefore,cursorAfter,winnerChanges,loserChanges;
   f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!/^UPDATE\s+document_job_recovery_scan\b/u.test(sql))return statement;
    const bind=statement.bind.bind(statement);
    statement.bind=(...values)=>{
     const bound=bind(...values),run=bound.run.bind(bound);
     bound.run=async()=>{
      if(raced)return run();
      raced=true;cursorBefore={...f.sqlite.prepare("SELECT * FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").get()};
      // A competing owner executes the actual bound cursor CAS first. Returning
      // the second real result preserves D1's genuine zero-change stale outcome.
      winnerChanges=Number((await run()).meta.changes);assert.equal(winnerChanges,1);
      cursorAfter={...f.sqlite.prepare("SELECT * FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").get()};
      const losing=await run();loserChanges=Number(losing.meta.changes);return losing;
     };
     return bound;
    };
    return statement;
   };
   try{
    assert.deepEqual(await recoverServerImageJobs(f.env,{candidateLimit:1,executionLimit:1}),{inspected:0,attempted:0});assert.equal(raced,true);assert.equal(winnerChanges,1);assert.equal(loserChanges,0);
    assert.equal(cursorBefore.last_requested_at,'');assert.equal(cursorBefore.last_job_id,'');assert.equal(cursorBefore.version,0);
    assert.equal(cursorAfter.last_requested_at,before.requested_at);assert.equal(cursorAfter.last_job_id,before.job_id);assert.equal(cursorAfter.version,1);
    assert.deepEqual({...f.sqlite.prepare("SELECT * FROM document_job_recovery_scan WHERE cursor_key='image-output-v1'").get()},cursorAfter);
    assert.deepEqual(gate.row(),before);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(wakeupIdentities(f),identities);assert.deepEqual(transport.counts(),sent);assert.equal(recoveryCompletions(f).length,0);
   }finally{f.DB.prepare=prepare;}
  });
 });
 await context.test('duplicate ticks',async child=>{
  await withImageRecovery(child,{stage:'planned'},async({f,slot,transport,gate,first,track,expire,finish,admission,originalAdmission})=>{
   expire();const results=await imageRecoveryBounded(Promise.all([track(recoverServerImageJobs(f.env)),track(recoverServerImageJobs(f.env))]),gate.release,'competing server ticks');
   assert.ok(results.every(result=>result.inspected===0||result.inspected===1));assert.ok(results.every(result=>result.attempted===0||result.attempted===1));
   assert.ok(results.reduce((sum,result)=>sum+result.attempted,0)>=1);
   await finish();assert.equal(gate.row().status,'completed',gate.row().error_message);assert.equal(gate.row().attempt_count,2);assert.deepEqual(admission(),originalAdmission);
   assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});assert.equal(recoveryCompletions(f).length,1);assert.equal(recoveryCalls(f).length,2);
   assert.equal(recoveryReservations(f,slot).token.status,'settled');assert.equal(recoveryReservations(f,slot).cost.status,'settled');
   await first;assert.equal(transport.sent.find(item=>item.address.endsWith('/responses')).signal.aborted,false);
  });
 });
 for(const changed of['job-snapshot','call-set'])await context.test(changed,async child=>{
  await withImageRecovery(child,{stage:'planned'},async({f,slot,transport,gate,expire,admission,originalAdmission})=>{
   expire();const before=gate.row(),held=recoveryReservations(f,slot),batch=f.DB.batch.bind(f.DB);let injected=false,changedRow;
   f.DB.batch=async statements=>{
    if(!injected&&statements.some(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1")&&statement.bindings[5]===slot.job_id)){
     injected=true;
     if(changed==='job-snapshot')f.sqlite.prepare('UPDATE document_jobs SET updated_at=? WHERE job_id=?').run('2001-01-01T00:00:00.000Z',slot.job_id);
     else f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=? WHERE slot_id=? AND call_key='planning:initial'").run('f'.repeat(64),slot.slot_id);
     changedRow=gate.row();
    }
    return batch(statements);
   };
   const result=await recoverServerImageJobs(f.env);assert.deepEqual(result,{inspected:1,attempted:1},'a runner invocation is counted even when its later atomic claim loses');
   assert.equal(injected,true);assert.equal(gate.row().attempt_count,before.attempt_count);assert.equal(gate.row().correlation_id,before.correlation_id);assert.equal(gate.row().result_json,changedRow.result_json);
   assert.deepEqual(recoveryReservations(f,slot),held);assert.deepEqual(admission(),originalAdmission);assert.deepEqual(transport.counts(),{planner:1,image:0,moderation:0});assert.equal(recoveryCompletions(f).length,0);
  });
 });
});


// The fixture executes genuine D1 statements with the production limits applied
// at its existing Statement.execute port, including statements inside DB.batch.
test('Image server wakeup: a valid multi-block proof stays bounded per D1 statement',async context=>{
 const sourceText=[
  'Keep the mature pear trees and their existing root zones.',
  'Use the southern entrance for the main accessible path.',
  'Preserve the meadow beyond the eastern orchard boundary.',
  'Place seating where the western tree canopy provides shade.',
  'Collect roof water for dry-season irrigation.',
  'Keep service access separate from the central walking route.',
  'Plant low pollinator beds beside the north fence.',
  'Leave space around each tree for the autumn harvest.',
  'Use permeable paving where the main path meets the gate.',
  'Keep the view from the community building into the orchard.',
  'Use a gentle path gradient across the lower slope.',
  'Mark the kitchen garden with a short timber edge.',
  'Retain a quiet seating area away from the delivery entrance.',
  'Protect the existing stone wall along the eastern edge.',
  'Use low lighting directed toward the walking surface.',
  'Keep a clear turning area beside the accessible entrance.',
 ];
 // Retain large original private bodies, then use ordinary edits to keep the
 // current provider context short. Both event IDs remain in the selected proof.
 const facts=sourceText.map((text,index)=>({block_id:`wakeup-proof-source-${index+1}`,type:'message',properties:{text:text.padEnd(192_000,` ${text}`)}}));
 const transport=imageRecoveryTransport(context),f=await fixture(facts);
 let statementPrototype,execute,batch;
 try{
  for(const [index,fact]of facts.entries())await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,project_id:'project-atmosphere',block_id:fact.block_id,property_path:'text',new_value:sourceText[index]});
  const plan=await saveImages(f),auth=await authorize(f,plan.planId,[plan.targetIds[0]]);
  await f.ok(await f.send({action:'run',grantId:auth.grantId}));
  const slot={...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE grant_id=?').get(auth.grantId)},queued=wakeupJob(f,slot.job_id);
  assert.equal(queued.status,'queued');assert.equal(queued.attempt_count,0);assert.deepEqual(transport.counts(),{planner:0,image:0,moderation:0});
  const identities=wakeupIdentities(f),baseline=imageRecoveryCompletionRows(f),baselineIds=new Set(baseline.map(row=>row.event_id));
  const violations=[],executed=[],preclaimProofReads=[];
  statementPrototype=Object.getPrototypeOf(f.DB.prepare('SELECT 1'));execute=statementPrototype.execute;
  statementPrototype.execute=function(kind){
   const measured={bindings:this.bindings.length,sqlBytes:Buffer.byteLength(this.sql,'utf8')};
   if(measured.bindings>100||measured.sqlBytes>100000){violations.push(measured);throw new RangeError('D1 statement limit exceeded');}
   executed.push(measured);return execute.call(this,kind);
  };
  batch=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{
   const proof=statements.length>0&&statements.every(statement=>statement.sql.startsWith('SELECT CASE WHEN ('))&&wakeupJob(f,slot.job_id).attempt_count===0;
   const measured=proof?statements.map(statement=>({bindings:statement.bindings.length,sqlBytes:Buffer.byteLength(statement.sql,'utf8')})):null;
   const results=await batch(statements);
   if(proof)preclaimProofReads.push({statements:measured,resultCount:results.length,allCurrent:results.every(result=>result.success!==false&&Number(result.results[0]?.current)===1)});
   return results;
  };
  const {readOutputProofBatch}=await import('../worker/output-requirements-api.ts');
  const currentJob={sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND owner_id=? AND stream_id=? AND status='queued' AND correlation_id=?)",bindings:[queued.job_id,queued.owner_id,queued.stream_id,queued.correlation_id]};
  const proofState=()=>({job:wakeupJob(f,slot.job_id),slot:{...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id)},grant:{...f.sqlite.prepare('SELECT * FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id)},financial:recoveryFinancialState(f),calls:recoveryCalls(f),identities:wakeupIdentities(f),completions:imageRecoveryCompletionRows(f),providers:transport.counts()});
  const beforeProof=proofState();
  await assert.rejects(readOutputProofBatch(f.env,[{sql:"EXISTS(SELECT 1 FROM document_jobs WHERE job_id=? AND status='completed')",bindings:[queued.job_id]}]),{code:'output_source_changed_during_read'});
  assert.deepEqual(proofState(),beforeProof,'a genuinely false job predicate cannot change any admission, ledger or provider state');
  const fullBatch=f.DB.batch;let originalShortResults;
  f.DB.batch=async statements=>{const results=await fullBatch(statements);originalShortResults=results;return results.slice(0,-1);};
  try{
   await assert.rejects(readOutputProofBatch(f.env,[currentJob]),{code:'output_source_changed_during_read'});
   assert.equal(originalShortResults.length,1);assert.equal(originalShortResults[0].results[0].current,1,'the dropped item was a successful real proof read, not a fabricated failure result');
   assert.deepEqual(proofState(),beforeProof,'an incomplete proof batch cannot change any admission, ledger or provider state');
  }finally{f.DB.batch=fullBatch;}
  const read=await readOutputProofBatch(f.env,[currentJob],[f.DB.prepare('SELECT job_id,status FROM document_jobs WHERE job_id=?').bind(queued.job_id)]);
  assert.equal(read.length,1);assert.equal(read[0].success,true);assert.deepEqual(read[0].results.map(row=>({...row})),[{job_id:queued.job_id,status:'queued'}]);
  assert.deepEqual(proofState(),beforeProof,'trusted optional reads preserve the same read-only proof boundary');
  const result=await recoverServerImageJobs(f.env,{candidateLimit:1,executionLimit:1});
  assert.deepEqual(result,{inspected:1,attempted:1},JSON.stringify({violations,preclaimProofReads}));
  assert.deepEqual(violations,[]);assert.ok(executed.length>0,'the actual fixture execution port enforced the limits');
  const largeProof=preclaimProofReads.find(proof=>proof.statements.reduce((sum,statement)=>sum+statement.bindings,0)>100);
  assert.ok(largeProof,'the genuine multi-block preclaim proof must exceed the single-statement binding limit in aggregate');
  assert.ok(largeProof.statements.length>1);assert.equal(largeProof.resultCount,largeProof.statements.length);assert.equal(largeProof.allCurrent,true);
  assert.ok(largeProof.statements.every(statement=>statement.bindings<=100&&statement.sqlBytes<=100000));
  const completed=wakeupJob(f,slot.job_id);assert.equal(completed.status,'completed',completed.error_message);assert.equal(completed.attempt_count,1);assert.deepEqual(wakeupIdentities(f),identities);
  assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});const calls=wakeupSlotCalls(f,slot);assert.equal(calls.length,2);assert.ok(calls.every(call=>call.status==='settled'));
  const completions=imageRecoveryCompletionRows(f);assert.deepEqual(completions.filter(row=>baselineIds.has(row.event_id)),baseline);
  const fresh=completions.filter(row=>!baselineIds.has(row.event_id));assert.equal(fresh.length,1);assert.equal(fresh[0].correlation_id,completed.correlation_id);
  const reservations=recoveryReservations(f,slot);assert.equal(reservations.token.status,'settled');assert.equal(reservations.cost.status,'settled');assert.equal(reservations.token.correlation_id,completed.correlation_id);assert.equal(reservations.cost.correlation_id,completed.correlation_id);
 }finally{
  if(batch)f.DB.batch=batch;if(statementPrototype&&execute)statementPrototype.execute=execute;f.sqlite.close();
 }
});


// Acknowledgment reuses the existing real Image runner, database, bucket and gates.
// Only the final job projection write fails; completion/usage publication is genuine.
async function imageAcknowledgmentFailedProjection(h){
 const {f,slot,gate,first,finish}=h,batch=f.DB.batch.bind(f.DB);let published=null,terminalFault=null;
 const readPublication=publication=>({events:publication.eventIds.map(id=>({id,event:f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(id)??null,private:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id)??null})),storage:{...f.sqlite.prepare('SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=?').get(slot.scope_key,slot.slot_id,publication.storageKey)}});
 f.DB.batch=async statements=>{
  const eventIndices=statements.flatMap((statement,index)=>statement.sql.startsWith('INSERT INTO event_write_stage')&&statement.bindings[1]===h.saved.job.stream_id&&statement.bindings[7]===h.saved.job.correlation_id&&['GenerationCompleted','GenerationUsageRecorded'].includes(statement.bindings[11])?[index]:[]);
  if(eventIndices.length){
   assert.equal(published,null,'one actual completion/usage publication batch');
   assert.deepEqual(eventIndices.map(index=>statements[index].bindings[11]),['GenerationCompleted','GenerationUsageRecorded']);
   const custodyIndices=statements.flatMap((statement,index)=>statement.sql.startsWith('UPDATE output_native_storage_writes SET publication_event_id=(')&&statement.bindings[0]===slot.scope_key&&statement.bindings[1]===slot.slot_id&&statement.bindings[5]===slot.scope_key&&statement.bindings[6]===slot.slot_id?[index]:[]);
   assert.equal(custodyIndices.length,1,'the ordinary guarded publication carries its original slot custody write');
   const custodyIndex=custodyIndices[0],publication={eventIds:eventIndices.map(index=>statements[index].bindings[0]),storageKey:statements[custodyIndex].bindings[7]},expectedPrivate=eventIndices.map(index=>statements[index].bindings[16]);
   const results=await batch(statements);
   published={publication,state:readPublication(publication),expectedPrivate,changes:eventIndices.map(index=>Number(results[index].meta.changes)),custodyChanges:Number(results[custodyIndex].meta.changes)};
   return results;
  }
  const terminal=statements.find(statement=>statement.sql.startsWith('UPDATE document_jobs SET status=?,result_json=')&&statement.bindings[0]==='completed'&&statement.bindings[7]===slot.job_id&&statement.bindings[8]===h.saved.job.owner_id&&statement.bindings[9]===h.saved.job.correlation_id);
  if(terminal&&!terminalFault){
   terminalFault={job:gate.row(),bindings:[...terminal.bindings],published};
   throw new Error('image_acknowledgment_fixture_terminal_write_lost');
  }
  return batch(statements);
 };
 try{
  gate.release();const response=await first;assert.equal(response.status,200);await finish();
  assert.ok(terminalFault?.published,'the injected failure occurs only after real publication');
  assert.deepEqual(published.changes,[1,1]);assert.equal(published.custodyChanges,1);
  assert.ok(published.state.events.every(row=>row.event&&row.private));
  assert.deepEqual(published.state.events.map(row=>row.private.private_json),published.expectedPrivate,'the genuine original event batch retained both exact private payloads');
  assert.deepEqual(published.state.events.map(row=>row.event.correlation_id),[h.saved.job.correlation_id,h.saved.job.correlation_id]);
  assert.equal(published.state.storage.publication_event_id,published.publication.eventIds[0]);assert.equal(published.state.storage.slot_id,slot.slot_id);assert.equal(published.state.storage.storage_key,published.publication.storageKey);
  assert.deepEqual(readPublication(published.publication),published.state,'the ordinary failure handler preserves both published public/private events and storage custody');
  const failed=gate.row();assert.equal(failed.status,'failed');assert.equal(failed.attempt_count,h.saved.job.attempt_count);assert.equal(failed.correlation_id,h.saved.job.correlation_id);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed','the original grant is already terminal, not reopened by the test');
  assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id).status,'failed');
  assert.equal(recoveryReservations(f,slot).token.status,'settled');assert.equal(recoveryReservations(f,slot).cost.status,'settled');
  assert.ok(recoveryCalls(f).every(call=>call.status==='settled'));assert.equal(recoveryCompletions(f).length,1);
  return published;
 }finally{f.DB.batch=batch;}
}
function imageAcknowledgmentState(h){
 const {f,slot}=h,rows=sql=>f.sqlite.prepare(sql).all().map(row=>({...row}));
 return{
  job:{...h.gate.row()},otherJobs:rows('SELECT * FROM document_jobs ORDER BY job_id').filter(row=>row.job_id!==slot.job_id),admission:h.admission(),
  events:rows('SELECT * FROM events ORDER BY sequence'),privateEvents:rows('SELECT * FROM event_private_payloads ORDER BY private_event_id'),privateContent:rows('SELECT * FROM private_content ORDER BY content_id'),
  grants:rows('SELECT * FROM output_execution_grants ORDER BY scope_key,grant_id'),slots:rows('SELECT * FROM output_operation_slots ORDER BY scope_key,slot_id'),calls:recoveryCalls(f),storage:rows('SELECT * FROM output_native_storage_writes ORDER BY scope_key,slot_id,storage_key'),
  tokens:rows('SELECT * FROM budget_reservations ORDER BY reservation_id'),costs:rows('SELECT * FROM cost_budget_reservations ORDER BY reservation_id'),tokenCounters:rows('SELECT * FROM budget_counters ORDER BY scope,scope_id,period'),costCounters:rows('SELECT * FROM cost_budget_counters ORDER BY scope,scope_id,period'),
  projectBudgetScopes:rows('SELECT * FROM project_budget_reservation_scopes ORDER BY reservation_kind,reservation_id'),pilotCostScopes:rows('SELECT * FROM pilot_cost_reservation_scopes ORDER BY reservation_id'),
  selectedSessions:rows('SELECT * FROM project_context_sessions ORDER BY context_id'),projectResources:rows('SELECT * FROM project_resource_scopes ORDER BY resource_kind,resource_id'),
  media:[...f.media].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,bytes:Buffer.from(value.bytes),metadata:structuredClone(value.metadata),contentType:value.contentType})),
  providerCounts:h.transport.counts(),providerRequests:h.transport.sent.length,puts:h.mediaCounts().puts,
 };
}
function assertImageAcknowledgmentUnchanged(h,before,{job=true}={}){
 const after=imageAcknowledgmentState(h);
 if(!job){const retained={...before};delete after.job;delete retained.job;assert.deepEqual(after,retained,'acknowledgment changes no admission, slot, grant, event, private body, storage, money, session, media or provider row');}
 else assert.deepEqual(after,before,'refusal or idempotent acknowledgment changes no job or retained evidence');
}
function imageAcknowledgmentRequest(h,headers=h.f.headers){
 return imageRecoveryBounded(h.track(handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${h.slot.job_id}/recover`,{method:'POST',headers}),h.f.env,`${h.slot.job_id}/recover`)),h.gate.release,'acknowledgment-only recovery');
}
async function assertImageAcknowledgmentDenied(h,status,headers=h.f.headers){
 const before=imageAcknowledgmentState(h),response=await imageAcknowledgmentRequest(h,headers),body=await response.json();
 assert.equal(response.status,status,JSON.stringify(body));assert.equal(body.recovered,undefined);assert.equal(typeof body.error,'string');assertImageAcknowledgmentUnchanged(h,before);
 return body;
}
function assertImageAcknowledgmentCompleted(h,before,body){
 const row=h.gate.row(),checkpoint=JSON.parse(row.result_json),receipt=checkpoint.generationReceipt;
 assert.equal(body.recovered,true);assert.equal(body.job.jobId,h.slot.job_id);assert.equal(body.job.status,'completed');assert.equal(body.job.attemptCount,before.attempt_count);
 const projectionKeys=new Set(['status','result_json','error_message','completed_at','lease_expires_at','updated_at']);
 assert.deepEqual(Object.fromEntries(Object.entries(row).filter(([key])=>!projectionKeys.has(key))),Object.fromEntries(Object.entries(before).filter(([key])=>!projectionKeys.has(key))),'job identity, correlation, attempt, request and all non-projection fields are unchanged');
 assert.equal(row.status,'completed');assert.equal(row.error_message,null);assert.equal(row.lease_expires_at,null);assert.equal(checkpoint.stage,'completed');assert.equal(checkpoint.errorDetail,undefined);
 assert.deepEqual(checkpoint.imageRecovery,JSON.parse(before.result_json).imageRecovery);assert.deepEqual(checkpoint.providerSubmissions,JSON.parse(before.result_json).providerSubmissions);
 assert.equal(receipt.artifact_kind,'image');assert.equal(receipt.provider_request_status,'completed');assert.equal(receipt.source_transmission_status,'transmitted');assert.equal(receipt.reservation_status,'settled');
 assert.equal(receipt.actual_provider_call_count,recoveryCalls(h.f).length);assert.equal(receipt.settled_cost_microusd,recoveryReservations(h.f,h.slot).cost.used_microusd);
 assert.equal(receipt.failure_code,undefined);assert.equal(receipt.failure_category,undefined);assert.equal(receipt.failure_stage,undefined);
 const published=h.f.sqlite.prepare("SELECT event_id FROM events WHERE correlation_id=? AND type IN('GenerationCompleted','GenerationUsageRecorded') ORDER BY sequence").all(row.correlation_id).map(event=>event.event_id);
 assert.equal(published.length,2);assert.deepEqual(checkpoint.appendedEventIds,published);
 assert.equal(body.job.result.imageRecovery,undefined);assert.equal(body.job.result.providerSubmissions,undefined);
}

test('Image acknowledgment: real published completion repairs only the failed job projection and repeats without work',async context=>{
 for(const shared of[false,true])await withImageRecovery(context,{stage:'rendered',shared},async h=>{
  await imageAcknowledgmentFailedProjection(h);const before=imageAcknowledgmentState(h),reads=h.mediaCounts().reads;
  const response=await imageAcknowledgmentRequest(h);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
  assertImageAcknowledgmentCompleted(h,before.job,await response.json());assertImageAcknowledgmentUnchanged(h,before,{job:false});assert.ok(h.mediaCounts().reads>reads,'the retained image bytes are read, not rendered or stored again');
  assert.deepEqual(h.admission(),h.originalAdmission);const completed=imageAcknowledgmentState(h);
  for(let repeat=0;repeat<2;repeat++){const replay=await imageAcknowledgmentRequest(h);assert.equal(replay.status,200);assert.equal((await replay.json()).recovered,true);assertImageAcknowledgmentUnchanged(h,completed);}
  if(shared){
   const {f,slot}=h,job=h.gate.row(),pointer=JSON.parse(job.result_json).imageRecovery,stage=retainedImageStage(f,pointer),publication=recoveryCompletions(f),nativeSlot={...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id)};
   assert.equal(job.status,'completed');assert.equal(nativeSlot.status,'failed','the real ACK repairs only the job, not its failed original slot');assert.equal(originalActor(f,slot),job.owner_id);assert.equal(stage.envelope.identity.jobId,job.job_id);assert.equal(stage.envelope.identity.actorUserId,job.owner_id);assert.equal(stage.envelope.identity.slotId,slot.slot_id);assert.equal(stage.envelope.identity.grantId,slot.grant_id);assert.equal(publication.length,1);assert.equal(publication[0].correlation_id,job.correlation_id);
   const completionEvent=(await readWorkspaceEvents(f.env,job.stream_id)).find(event=>event.eventId===publication[0].event_id);assert.ok(completionEvent);assert.equal(completionEvent.type,'GenerationCompleted');assert.equal(completionEvent.correlationId,job.correlation_id);
   const publicationContentRefs=[completionEvent.payload.output_ref,completionEvent.payload.prompt_ref];assert.ok(publicationContentRefs.every(ref=>typeof ref==='string'&&ref.trim().length>0));assert.equal(new Set(publicationContentRefs).size,2);
   const publicationScopes=()=>publicationContentRefs.map(contentId=>{const row=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(f.projectAccessId,contentId);return row?{...row}:null;});
   const custody=()=>({publicationScopes:publicationScopes(),content:{...f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(pointer.contentId)},scope:{...f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(f.projectAccessId,pointer.contentId)},retention:{...f.sqlite.prepare('SELECT * FROM private_content_retention_scopes WHERE content_id=?').get(pointer.contentId)},storage:{...f.sqlite.prepare('SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id)}});
   const retained=custody();assert.deepEqual(retained.content,stage.row);assert.equal(retained.content.redacted_at,null);assert.ok(Date.parse(retained.content.expires_at)>Date.now());assert.equal(retained.scope.resource_id,pointer.contentId);assert.equal(retained.scope.actor_user_id,job.owner_id);assert.equal(retained.scope.visibility,'actor_private');assert.equal(retained.retention.content_id,pointer.contentId);assert.equal(retained.retention.actor_user_id,job.owner_id);assert.equal(retained.storage.publication_event_id,publication[0].event_id);
   assert.equal(retained.publicationScopes.length,2);for(const [index,row] of retained.publicationScopes.entries()){assert.ok(row,'both original publication content scopes exist before GET');assert.equal(row.project_access_id,f.projectAccessId);assert.equal(row.resource_kind,'content');assert.equal(row.resource_id,publicationContentRefs[index]);assert.equal(row.organization_id,f.organizationId);assert.equal(row.project_id,'project-atmosphere');assert.equal(row.owner_user_id,job.owner_id);assert.equal(row.actor_user_id,job.owner_id);assert.equal(row.visibility,'actor_private');assert.equal(row.source_event_id,null);}
   // Rebuild projection after the genuine failed-publication ACK, without
   // rewriting the original slot into the ordinary succeeded state.
   const opened=await appendAuditEvent(f.env,stream,'user','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'}),beforeProjection=imageAcknowledgmentState(h),media=h.mediaCounts(),head=f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(job.stream_id).head;
   const loaded=await handleEvents(new Request('http://localhost/api/events',{method:'GET',headers:f.headers}),f.env);assert.equal(loaded.status,200,JSON.stringify(await loaded.clone().json()));
   const withoutProjection=state=>{const {projectResources,...evidence}=state;return evidence;};assert.deepEqual(withoutProjection(imageAcknowledgmentState(h)),withoutProjection(beforeProjection),'projecting an ACK-completed job preserves its actual failed slot and all retained publication, private, finance, media and provider evidence');assert.deepEqual(custody(),retained);assert.deepEqual(JSON.parse(h.gate.row().result_json).imageRecovery,pointer);assert.deepEqual(h.mediaCounts(),media);assert.deepEqual(recoveryCompletions(f),publication);assert.deepEqual({...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id)},nativeSlot);
   const migration={...f.sqlite.prepare('SELECT * FROM project_migration_states WHERE project_access_id=?').get(f.projectAccessId)};assert.equal(migration.status,'active');assert.equal(migration.owner_user_id,job.owner_id);assert.equal(migration.last_owner_sequence,head);assert.equal(f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(job.stream_id).head,head);assert.equal(f.sqlite.prepare('SELECT * FROM project_event_scopes WHERE event_id=?').get(opened.eventId),undefined);
   const beforeReplay=imageAcknowledgmentState(h),replay=await imageAcknowledgmentRequest(h);assert.equal(replay.status,200,JSON.stringify(await replay.clone().json()));const body=await replay.json();assert.equal(body.recovered,true);assert.equal(body.job.status,'completed');assert.equal(body.job.jobId,job.job_id);assertImageAcknowledgmentUnchanged(h,beforeReplay);assert.deepEqual(custody(),retained);assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id).status,'failed');
  }
 });
});

test('Image acknowledgment: concurrent requests converge on the same published job without a successor attempt',async context=>{
 for(const boundary of['first-proof','media-await'])for(const changed of['none','grant','private-completion','session-expiry','nonprojection'])await withImageRecovery(context,{stage:'rendered',shared:true},async h=>{
  await imageAcknowledgmentFailedProjection(h);const {f,slot}=h,before=imageAcknowledgmentState(h),batch=f.DB.batch.bind(f.DB),get=f.env.MEDIA.get.bind(f.env.MEDIA),key=f.sqlite.prepare('SELECT storage_key FROM output_native_storage_writes WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id).storage_key;
  let releaseHeld,reachHeld,held=false,staleRead=null,completedProofReads=0,loser;
  const heldGate=new Promise(resolve=>{releaseHeld=resolve;}),reached=new Promise(resolve=>{reachHeld=resolve;});
  f.DB.batch=async statements=>{
   const index=statements.findIndex(statement=>statement.sql.startsWith('SELECT CASE WHEN (EXISTS(SELECT 1 FROM document_jobs WHERE job_id IS ?')&&statement.bindings[0]===slot.job_id),proof=index<0?null:statements[index];
   if(boundary==='first-proof'&&!held&&proof?.bindings[5]==='failed'){held=true;reachHeld();await heldGate;}
   const results=await batch(statements);
   if(proof?.bindings[5]==='failed'&&results[index]?.results?.[0]?.current===0)staleRead={result:structuredClone(results[index]),job:{...h.gate.row()},bindings:[...proof.bindings]};
   if(proof?.bindings[5]==='completed'&&results[index]?.results?.[0]?.current===1)completedProofReads++;
   return results;
  };
  f.env.MEDIA.get=async(...args)=>{
   const object=await get(...args);
   if(boundary==='media-await'&&args[0]===key&&!held){held=true;reachHeld();await heldGate;}
   return object;
  };
  try{
   loser=imageAcknowledgmentRequest(h);await imageRecoveryBounded(reached,releaseHeld,'the original losing ACK reaches its real held proof/media boundary');
   const winner=await imageAcknowledgmentRequest(h);assert.equal(winner.status,200,JSON.stringify(await winner.clone().json()));assertImageAcknowledgmentCompleted(h,before.job,await winner.json());assertImageAcknowledgmentUnchanged(h,before,{job:false});assert.equal(staleRead,null,'the losing real read has not returned before the winner completes');
   const winnerState=imageAcknowledgmentState(h),media=h.mediaCounts();
   if(changed==='grant')assert.equal(f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=? AND status='completed'").run(slot.grant_id).changes,1);
   if(changed==='private-completion')assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=? AND redacted_at IS NULL').run(new Date().toISOString(),recoveryCompletions(f)[0].event_id).changes,1);
   if(changed==='session-expiry')assert.equal(f.sqlite.prepare('UPDATE project_context_sessions SET expires_at=? WHERE context_id=? AND revoked_at IS NULL').run('2000-01-01T00:00:00.000Z',f.contextId).changes,1);
   if(changed==='nonprojection'){assert.notEqual(winnerState.job.notified_at,'2000-01-01T00:00:00.000Z');assert.equal(f.sqlite.prepare('UPDATE document_jobs SET notified_at=? WHERE job_id=? AND notified_at IS ?').run('2000-01-01T00:00:00.000Z',slot.job_id,winnerState.job.notified_at).changes,1);}
   const withdrawn=imageAcknowledgmentState(h);releaseHeld();const response=await loser,body=await response.json();
   assert.ok(staleRead,'the original SELECT really rejects the failed projection after the winner completes');assert.equal(staleRead.result.success,true);assert.equal(staleRead.result.results[0].current,0);assert.equal(staleRead.bindings[5],'failed');assert.equal(staleRead.job.status,'completed');assert.equal(staleRead.job.job_id,slot.job_id);assert.equal(staleRead.job.correlation_id,before.job.correlation_id);assert.equal(staleRead.job.attempt_count,before.job.attempt_count);
   if(changed==='none'){
    assert.equal(response.status,200,JSON.stringify(body));assertImageAcknowledgmentCompleted(h,before.job,body);assert.ok(completedProofReads>0,'the loser re-enters the full proof for the actual completed projection');assert.equal(h.mediaCounts().reads,media.reads+1,'the loser verifies the original private media again instead of returning the winner directly');assertImageAcknowledgmentUnchanged(h,winnerState);
   }else{
    assert.ok([403,409].includes(response.status),JSON.stringify(body));assert.equal(body.recovered,undefined);assert.equal(typeof body.error,'string');assertImageAcknowledgmentUnchanged(h,withdrawn);
    if(changed==='nonprojection'){assert.equal(body.error,'output_source_changed_during_read');assert.equal(completedProofReads,0,'a changed nonprojection identity is never adopted as a winner');}
   }
   assert.deepEqual(h.admission(),h.originalAdmission);assert.equal(h.mediaCounts().puts,media.puts);
  }finally{releaseHeld();if(loser)await Promise.allSettled([loser]);f.DB.batch=batch;f.env.MEDIA.get=get;}
 });
});

test('Image acknowledgment: completed jobs accept only the three existing live original-grant states without rewriting them',async context=>{
 for(const status of['authorized','active','completed'])await withImageRecovery(context,{stage:null},async h=>{
  const {f,slot}=h;assert.equal(h.gate.row().status,'completed');assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');
  const checkpoint=JSON.parse(h.gate.row().result_json);for(const key of['reservationId','costReservationId','costReservationMicrousd','costReservationPeriod'])assert.equal(Object.hasOwn(checkpoint,key),false,`the actual normal completed checkpoint omits legacy ${key}`);
  // Exercise the accepted grant-state boundary on genuine published work; no authority, event, deadline or reservation is recreated.
  if(status!=='completed')assert.equal(f.sqlite.prepare('UPDATE output_execution_grants SET status=? WHERE grant_id=?').run(status,slot.grant_id).changes,1);
  const before=imageAcknowledgmentState(h),response=await imageAcknowledgmentRequest(h);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const body=await response.json();
  assert.equal(body.recovered,true);assert.equal(body.job.status,'completed');assert.equal(body.job.jobId,slot.job_id);assertImageAcknowledgmentUnchanged(h,before);
 });
 await withImageRecovery(context,{stage:null,shared:true},async h=>{
  const {f,slot}=h,job=h.gate.row(),checkpoint=JSON.parse(job.result_json),pointer=checkpoint.imageRecovery,stage=retainedImageStage(f,pointer),completion=recoveryCompletions(f);
  assert.equal(job.status,'completed');assert.equal(originalActor(f,slot),job.owner_id);assert.equal(pointer.stage,'rendered');assert.equal(stage.envelope.identity.jobId,job.job_id);assert.equal(stage.envelope.identity.actorUserId,job.owner_id);assert.equal(stage.envelope.identity.slotId,slot.slot_id);assert.equal(stage.envelope.identity.grantId,slot.grant_id);assert.equal(completion.length,1);assert.equal(completion[0].correlation_id,job.correlation_id);
  const completionEvent=(await readWorkspaceEvents(f.env,job.stream_id)).find(event=>event.eventId===completion[0].event_id);assert.ok(completionEvent);assert.equal(completionEvent.type,'GenerationCompleted');assert.equal(completionEvent.correlationId,job.correlation_id);
  const publicationContentRefs=[completionEvent.payload.output_ref,completionEvent.payload.prompt_ref];assert.ok(publicationContentRefs.every(ref=>typeof ref==='string'&&ref.trim().length>0));assert.equal(new Set(publicationContentRefs).size,2);
  const publicationScopes=()=>publicationContentRefs.map(contentId=>{const row=f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(f.projectAccessId,contentId);return row?{...row}:null;});
  const stageCustody=()=>({publicationScopes:publicationScopes(),content:{...f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(pointer.contentId)},scope:{...f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(f.projectAccessId,pointer.contentId)},retention:{...f.sqlite.prepare('SELECT * FROM private_content_retention_scopes WHERE content_id=?').get(pointer.contentId)},storage:{...f.sqlite.prepare('SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id)}});
  const custody=stageCustody();assert.deepEqual(custody.content,stage.row);assert.equal(custody.content.redacted_at,null);assert.ok(Date.parse(custody.content.expires_at)>Date.now());assert.equal(custody.scope.resource_id,pointer.contentId);assert.equal(custody.scope.actor_user_id,job.owner_id);assert.equal(custody.scope.visibility,'actor_private');assert.equal(custody.retention.content_id,pointer.contentId);assert.equal(custody.retention.actor_user_id,job.owner_id);assert.equal(custody.storage.publication_event_id,completion[0].event_id);
  assert.equal(custody.publicationScopes.length,2);for(const [index,row] of custody.publicationScopes.entries()){assert.ok(row,'both original publication content scopes exist before GET');assert.equal(row.project_access_id,f.projectAccessId);assert.equal(row.resource_kind,'content');assert.equal(row.resource_id,publicationContentRefs[index]);assert.equal(row.organization_id,f.organizationId);assert.equal(row.project_id,'project-atmosphere');assert.equal(row.owner_user_id,job.owner_id);assert.equal(row.actor_user_id,job.owner_id);assert.equal(row.visibility,'actor_private');assert.equal(row.source_event_id,null);}
  // A genuine audit-only append forces projection after ordinary completion;
  // the existing retained stage is not replaced by a reconstructed capability.
  const opened=await appendAuditEvent(f.env,stream,'user','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'}),before=imageAcknowledgmentState(h),media=h.mediaCounts(),head=f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(job.stream_id).head;
  const originalPrepare=f.env.DB.prepare,retainedDepth={observed:0,sql:null,result:null,error:null};let loaded;
  f.env.DB.prepare=function(sql){
   if(typeof sql==='string'&&sql.startsWith('SELECT resource.resource_kind,resource.resource_id,resource.source_event_id,resource.actor_user_id,')&&sql.includes(' AS retained_image_document_id')){
    retainedDepth.observed++;
    if(retainedDepth.observed===1){retainedDepth.sql=sql;try{retainedDepth.result=compileSqliteExpressionDepth(f.sqlite,sql,{limit:100});}catch(error){retainedDepth.error=error;}}
   }
   return originalPrepare.call(this,sql);
  };
  try{loaded=await handleEvents(new Request('http://localhost/api/events',{method:'GET',headers:f.headers}),f.env);}finally{f.env.DB.prepare=originalPrepare;}
  assert.equal(retainedDepth.observed,1,'compile exactly the original retained-stage SELECT from this real GET');assert.equal(retainedDepth.error,null,String(retainedDepth.error));assert.equal(retainedDepth.result?.limit,100);assert.equal(retainedDepth.result?.ok,true,retainedDepth.result?.error);
  assert.equal(loaded.status,200,JSON.stringify(await loaded.clone().json()));
  const after=imageAcknowledgmentState(h),withoutProjection=state=>{const {projectResources,...retained}=state;return retained;};assert.deepEqual(withoutProjection(after),withoutProjection(before),'completed projection preserves original publication, private bytes, job, finance, media and provider evidence');assert.deepEqual(stageCustody(),custody);assert.deepEqual(JSON.parse(h.gate.row().result_json).imageRecovery,pointer);assert.deepEqual(h.mediaCounts(),media);assert.deepEqual(recoveryCompletions(f),completion);
  const migration={...f.sqlite.prepare('SELECT * FROM project_migration_states WHERE project_access_id=?').get(f.projectAccessId)};assert.equal(migration.status,'active');assert.equal(migration.owner_user_id,job.owner_id);assert.equal(migration.last_owner_sequence,head);assert.equal(f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(job.stream_id).head,head);assert.equal(f.sqlite.prepare('SELECT * FROM project_event_scopes WHERE event_id=?').get(opened.eventId),undefined);
  const beforeAck=imageAcknowledgmentState(h),response=await imageAcknowledgmentRequest(h);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));const body=await response.json();assert.equal(body.recovered,true);assert.equal(body.job.status,'completed');assert.equal(body.job.jobId,job.job_id);assertImageAcknowledgmentUnchanged(h,beforeAck);assert.deepEqual(stageCustody(),custody);
 });
});

test('Image acknowledgment: stale committing projection is repairable but a live lease or canceled projection is not',async context=>{
 for(const state of['stale-committing','live-committing','canceled'])await withImageRecovery(context,{stage:'rendered'},async h=>{
  await imageAcknowledgmentFailedProjection(h);const {f,slot}=h;
  // Only mutable job projection is changed. The original completion, grant, calls and financial/custody evidence remain genuine.
  const status=state==='canceled'?'canceled':'committing',lease=state==='live-committing'?new Date(Date.now()+60_000).toISOString():state==='stale-committing'?'2000-01-01T00:00:00.000Z':null;
  assert.equal(f.sqlite.prepare('UPDATE document_jobs SET status=?,lease_expires_at=? WHERE job_id=?').run(status,lease,slot.job_id).changes,1);
  if(state!=='stale-committing'){await assertImageAcknowledgmentDenied(h,409);return;}
  const before=imageAcknowledgmentState(h),response=await imageAcknowledgmentRequest(h);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));assertImageAcknowledgmentCompleted(h,before.job,await response.json());assertImageAcknowledgmentUnchanged(h,before,{job:false});
 });
});

test('Image acknowledgment: unpublished planned or rendered work cannot use recover to dispatch, publish or settle',async context=>{
 for(const stage of['planned','rendered'])await withImageRecovery(context,{stage},async h=>{
  assert.equal(recoveryCompletions(h.f).length,0);await assertImageAcknowledgmentDenied(h,409);assert.equal(recoveryCompletions(h.f).length,0);
  // The retained fixture finally releases the original runner after this assertion boundary; that is not acknowledgment work.
 });
});


test('Image acknowledgment: original grant, actor, consent and selected-session authority cannot be replaced or renewed',async context=>{
 for(const changed of['revoked-grant','exceeded-grant','expired-grant','consent','revoked-session','expired-session','different-session','different-actor','impersonation-cookie'])await withImageRecovery(context,{stage:null,shared:true},async h=>{
  const {f,slot}=h;let headers=f.headers,status=403;
  if(changed==='revoked-grant'||changed==='exceeded-grant')assert.equal(f.sqlite.prepare('UPDATE output_execution_grants SET status=? WHERE grant_id=?').run(changed==='revoked-grant'?'revoked':'exceeded',slot.grant_id).changes,1);
  if(changed==='expired-grant')assert.equal(f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=? WHERE grant_id=?').run('2000-01-01T00:00:00.000Z',slot.grant_id).changes,1);
  if(changed==='consent'){assert.equal(f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('withdrawn-consent',originalActor(f,slot)).changes,1);status=428;}
  if(changed==='revoked-session')assert.equal(f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId).changes,1);
  if(changed==='expired-session')assert.equal(f.sqlite.prepare('UPDATE project_context_sessions SET expires_at=? WHERE context_id=?').run('2000-01-01T00:00:00.000Z',f.contextId).changes,1);
  if(changed==='different-session'){
   const original={...f.sqlite.prepare('SELECT * FROM project_context_sessions WHERE context_id=?').get(f.contextId)},other=crypto.randomUUID();assert.equal(original.revoked_at,null);assert.ok(Date.parse(original.expires_at)>Date.now());
   // Duplicate only this test's current session identity to isolate selection, not expiry or a new financial grant.
   assert.equal(f.sqlite.prepare('INSERT INTO project_context_sessions(context_id,principal_user_id,organization_id,project_access_id,created_at,expires_at,revoked_at) SELECT ?,principal_user_id,organization_id,project_access_id,created_at,expires_at,revoked_at FROM project_context_sessions WHERE context_id=?').run(other,f.contextId).changes,1);
   assert.deepEqual({...f.sqlite.prepare('SELECT * FROM project_context_sessions WHERE context_id=?').get(f.contextId)},original);
   headers={cookie:`forma_project_context=${encodeURIComponent(other)}`};assert.notEqual(other,f.contextId);
  }
  if(changed==='different-actor'){
   headers={'oai-authenticated-user-id':'acknowledgment-other-actor','oai-authenticated-user-email':'acknowledgment-other@local.forma'};
   const bootstrap=await handleSession(new Request('http://localhost/api/session',{headers}),f.env);assert.equal(bootstrap.status,200);
   assert.equal(f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,headers['oai-authenticated-user-id']).changes,1);status=404;
  }
  if(changed==='impersonation-cookie'){
   // The existing selected-context reader rejects any impersonation cookie. This is that real boundary, not a seeded active-persona fixture.
   headers={cookie:`${f.headers.cookie}; forma_impersonation=acknowledgment-disallowed-context`};status=409;
  }
  await assertImageAcknowledgmentDenied(h,status,headers);
 });
});

test('Image acknowledgment: current source changes and the original job deadline forbid acknowledgment',async context=>{
 for(const changed of['source','job-expiry'])await withImageRecovery(context,{stage:null},async h=>{
  const {f,slot}=h;
  if(changed==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'recovery-source',property_path:'text',new_value:'Changed after the original image publication.'});
  else assert.equal(f.sqlite.prepare('UPDATE document_jobs SET expires_at=? WHERE job_id=?').run('2000-01-01T00:00:00.000Z',slot.job_id).changes,1);
  await assertImageAcknowledgmentDenied(h,409);
 });
});

test('Image acknowledgment: retained envelope, private witnesses and bucket bytes must remain exact',async context=>{
 for(const changed of['missing-envelope','redacted-envelope','expired-envelope','completion-redacted','usage-missing','anchor-owner','missing-media','corrupt-media','media-custody'])await withImageRecovery(context,{stage:null},async h=>{
  const {f,slot}=h,pointer=JSON.parse(h.gate.row().result_json).imageRecovery,retained=retainedImageStage(f,pointer),media=retained.envelope.stage.rendered.media,key=decodeURIComponent(media.url.slice('/api/media/'.length));
  const completion=recoveryCompletions(f)[0],usage=f.sqlite.prepare("SELECT event_id FROM events WHERE correlation_id=? AND type='GenerationUsageRecorded'").get(h.gate.row().correlation_id);assert.ok(completion);assert.ok(usage);
  const immutable=f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all().map(row=>({...row}));
  if(changed==='missing-envelope')assert.equal(f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(pointer.contentId).changes,1);
  if(changed==='redacted-envelope')assert.equal(f.sqlite.prepare("UPDATE private_content SET redacted_at=?,content='' WHERE content_id=?").run(new Date().toISOString(),pointer.contentId).changes,1);
  if(changed==='expired-envelope')assert.equal(f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run('2000-01-01T00:00:00.000Z',pointer.contentId).changes,1);
  if(changed==='completion-redacted')assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run(new Date().toISOString(),completion.event_id).changes,1);
  if(changed==='usage-missing')assert.equal(f.sqlite.prepare('DELETE FROM event_private_payloads WHERE private_event_id=?').run(usage.event_id).changes,1);
  if(changed==='anchor-owner')assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET owner_id=? WHERE private_event_id=?').run('different-acknowledgment-anchor-owner',retained.envelope.stage.budgetEventId).changes,1);
  if(changed==='missing-media')assert.equal(f.media.delete(key),true);
  if(changed==='corrupt-media'){const object=f.media.get(key);assert.ok(object);object.bytes=Uint8Array.from([0,1,2]);}
  if(changed==='media-custody'){const object=f.media.get(key);assert.ok(object);assert.equal(object.metadata.outputSlotId,slot.slot_id);object.metadata.outputSlotId='different-acknowledgment-slot';}
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all().map(row=>({...row})),immutable,'negative setup never rewrites or deletes immutable history');
  await assertImageAcknowledgmentDenied(h,409);
 });
});

test('Image acknowledgment: incomplete or mismatched financial and storage custody cannot be repaired or settled',async context=>{
 for(const changed of['token-active','cost-executing','cost-amount','call-uncertain','call-digest','storage-unacknowledged','storage-hash','storage-event','missing-cost-scope','mismatched-token-scope','checkpoint-reservationId-wrong','checkpoint-reservationId-null','checkpoint-costReservationId-wrong','checkpoint-costReservationId-null','checkpoint-costReservationMicrousd-wrong','checkpoint-costReservationMicrousd-null','checkpoint-costReservationPeriod-wrong','checkpoint-costReservationPeriod-null','budget-token-maximum','budget-cost-maximum'])await withImageRecovery(context,{stage:null,shared:changed==='missing-cost-scope'||changed==='mismatched-token-scope'},async h=>{
  const {f,slot}=h;
  if(changed==='missing-cost-scope'||changed==='mismatched-token-scope'){
   const token={...f.sqlite.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='tokens' AND reservation_id=?").get(slot.token_reservation_id)},cost={...f.sqlite.prepare("SELECT * FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").get(slot.cost_reservation_id)};
   for(const scope of[token,cost]){assert.equal(scope.organization_id,f.organizationId);assert.equal(scope.project_access_id,f.projectAccessId);assert.equal(scope.actor_user_id,originalActor(f,slot));assert.equal(scope.workspace_scope_id,f.organizationId);}
   if(changed==='missing-cost-scope')assert.equal(f.sqlite.prepare("DELETE FROM project_budget_reservation_scopes WHERE reservation_kind='usd' AND reservation_id=?").run(slot.cost_reservation_id).changes,1);
   else assert.equal(f.sqlite.prepare("UPDATE project_budget_reservation_scopes SET actor_user_id=? WHERE reservation_kind='tokens' AND reservation_id=?").run('different-acknowledgment-payer',slot.token_reservation_id).changes,1);
  }
  if(changed==='token-active')assert.equal(f.sqlite.prepare("UPDATE budget_reservations SET status='active' WHERE reservation_id=?").run(slot.token_reservation_id).changes,1);
  if(changed==='cost-executing')assert.equal(f.sqlite.prepare("UPDATE cost_budget_reservations SET status='executing' WHERE reservation_id=?").run(slot.cost_reservation_id).changes,1);
  if(changed==='cost-amount')assert.equal(f.sqlite.prepare('UPDATE cost_budget_reservations SET used_microusd=used_microusd+1 WHERE reservation_id=?').run(slot.cost_reservation_id).changes,1);
  if(changed.startsWith('checkpoint-')){
   const [,key,kind]=changed.split('-'),job=h.gate.row(),checkpoint=JSON.parse(job.result_json),originalPeriod=recoveryReservations(f,slot).cost.period;
   assert.equal(Object.hasOwn(checkpoint,key),false,'the negative setup adds a contradictory value to genuine legacy absence');
   const wrong={reservationId:`${slot.token_reservation_id}-mismatch`,costReservationId:`${slot.cost_reservation_id}-mismatch`,costReservationMicrousd:slot.maximum_microusd+1,costReservationPeriod:'1900-01'};
   assert.notEqual(wrong.costReservationPeriod,originalPeriod);assert.ok(Object.hasOwn(wrong,key));
   const changedJson=JSON.stringify({...checkpoint,[key]:kind==='null'?null:wrong[key]});
   assert.equal(f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=? AND result_json=?').run(changedJson,slot.job_id,job.result_json).changes,1);
  }
  if(changed==='budget-token-maximum'||changed==='budget-cost-maximum'){
   const pointer=JSON.parse(h.gate.row().result_json).imageRecovery,retained=retainedImageStage(f,pointer),eventId=retained.envelope.stage.budgetEventId,event={...f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(eventId)},body={...f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(eventId)},payload=JSON.parse(body.private_json),key=changed==='budget-token-maximum'?'reserved_tokens':'reserved_microusd',maximum=changed==='budget-token-maximum'?slot.maximum_tokens:slot.maximum_microusd;
   assert.equal(event.type,'BudgetReserved');assert.equal(event.stream_id,h.gate.row().stream_id);assert.equal(event.correlation_id,h.gate.row().correlation_id);assert.equal(body.redacted_at,null);assert.equal(payload[key],maximum);assert.ok(Number.isSafeInteger(maximum));
   const immutable=f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all().map(row=>({...row})),privateJson=JSON.stringify({...payload,[key]:maximum+1});
   assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET private_json=? WHERE private_event_id=? AND owner_id=? AND project_id IS ? AND document_id IS ? AND private_json=? AND created_at=? AND redacted_at IS NULL').run(privateJson,eventId,body.owner_id,body.project_id,body.document_id,body.private_json,body.created_at).changes,1);
   assert.deepEqual({...f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(eventId)},{...body,private_json:privateJson});
   assert.deepEqual(f.sqlite.prepare('SELECT * FROM events ORDER BY sequence').all().map(row=>({...row})),immutable,'negative setup changes only the original retained private budget witness, never immutable event history');assert.deepEqual(retainedImageStage(f,pointer),retained);
  }
  if(changed==='call-uncertain')assert.equal(f.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain' WHERE slot_id=? AND call_key='image:initial'").run(slot.slot_id).changes,1);
  if(changed==='call-digest')assert.equal(f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=? WHERE slot_id=? AND call_key='image:initial'").run('f'.repeat(64),slot.slot_id).changes,1);
  if(changed==='storage-unacknowledged')assert.equal(f.sqlite.prepare('UPDATE output_native_storage_writes SET write_acknowledged=0 WHERE scope_key=? AND slot_id=?').run(slot.scope_key,slot.slot_id).changes,1);
  if(changed==='storage-hash')assert.equal(f.sqlite.prepare('UPDATE output_native_storage_writes SET content_sha256=? WHERE scope_key=? AND slot_id=?').run('e'.repeat(64),slot.scope_key,slot.slot_id).changes,1);
  if(changed==='storage-event'){
   const pointer=JSON.parse(h.gate.row().result_json).imageRecovery,retained=retainedImageStage(f,pointer),otherEvent=retained.envelope.stage.budgetEventId;
   assert.ok(f.sqlite.prepare('SELECT event_id FROM events WHERE event_id=?').get(otherEvent),'the mismatched foreign key names an actual original event, not fabricated completion');
   assert.equal(f.sqlite.prepare('UPDATE output_native_storage_writes SET publication_event_id=? WHERE scope_key=? AND slot_id=?').run(otherEvent,slot.scope_key,slot.slot_id).changes,1);
  }
  await assertImageAcknowledgmentDenied(h,409);
 });
});

test('Image acknowledgment: authority and private witnesses are rechecked after the actual asynchronous media read',async context=>{
 for(const changed of['grant','completion-private'])await withImageRecovery(context,{stage:'rendered',shared:true},async h=>{
  await imageAcknowledgmentFailedProjection(h);const {f,slot}=h,key=f.sqlite.prepare('SELECT storage_key FROM output_native_storage_writes WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id).storage_key;
  const get=f.env.MEDIA.get.bind(f.env.MEDIA),completion=recoveryCompletions(f)[0];let withdrawn=null;
  f.env.MEDIA.get=async(...args)=>{
   const object=await get(...args);
   if(args[0]===key&&!withdrawn){
    assert.ok(object,'the boundary follows the genuine retained object read');
    if(changed==='grant')assert.equal(f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=?").run(slot.grant_id).changes,1);
    else assert.equal(f.sqlite.prepare('UPDATE event_private_payloads SET redacted_at=? WHERE private_event_id=?').run(new Date().toISOString(),completion.event_id).changes,1);
    withdrawn=imageAcknowledgmentState(h);
   }
   return object;
  };
  try{
   const response=await imageAcknowledgmentRequest(h),body=await response.json();assert.ok(withdrawn,'the actual media await was reached');assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.recovered,undefined);assert.equal(body.error,'output_source_changed_during_read');assertImageAcknowledgmentUnchanged(h,withdrawn);
  }finally{f.env.MEDIA.get=get;}
 });
});


test('Image acknowledgment: genuine chunked media is bounded and hashed incrementally while cleanup preserves original errors',async context=>{
 const limit=64*1024*1024,invalidSizes=new Map([['size-zero',0],['size-negative',-1],['size-fractional',1.5],['size-nan',NaN],['size-infinite',Infinity],['size-unsafe',Number.MAX_SAFE_INTEGER+1],['size-over-budget',limit+1]]);
 for(const variant of['valid','corrupt-chunk','read-error','read-undefined','extra-byte','short-stream','empty-chunk','non-byte-chunk',...invalidSizes.keys(),'size-at-budget','body-error','metadata-error','headers-error','reader-error','release-error'])await withImageRecovery(context,{stage:null},async h=>{
  const {f,slot}=h,before=imageAcknowledgmentState(h),key=f.sqlite.prepare('SELECT storage_key FROM output_native_storage_writes WHERE scope_key=? AND slot_id=?').get(slot.scope_key,slot.slot_id).storage_key,get=f.env.MEDIA.get.bind(f.env.MEDIA);
  const originalError=variant==='read-undefined'?undefined:new Error(`image_acknowledgment_fixture_${variant}_error`),cancelError=new Error('image_acknowledgment_fixture_cancel_error'),releaseError=new Error('image_acknowledgment_fixture_release_error');
  const thrown=['read-error','read-undefined','body-error','metadata-error','headers-error','reader-error','release-error'].includes(variant),cleanupFault=thrown||variant==='size-over-budget';
  const beforeReader=invalidSizes.has(variant)||['body-error','metadata-error','headers-error','reader-error'].includes(variant);
  const lifecycle=[];let wrapped=null,objectSize=null,emittedChunks=0,emittedBytes=0,readChunks=0,readBytes=0,readCalls=0,readerAttempts=0,readers=0,activeReads=0,maximumActiveReads=0,eof=false,flushed=false,cancelReason=null,cancelFailure=null,bodyCancel=null,bodyGets=0;
  f.env.MEDIA.get=async(...args)=>{
   const object=await get(...args);if(args[0]!==key)return object;
   assert.ok(object);assert.equal(wrapped,null,'one retained object read');assert.ok(object.size>=2,'the genuine fixture image supports at least two nonempty chunks');objectSize=object.size;
   const split=Math.max(1,Math.min(97,Math.floor(object.size/2)));
   // Transform only this returned read of the genuine bucket stream; stored bytes and metadata remain unchanged.
   const body=object.body.pipeThrough(new TransformStream({
    transform(chunk,controller){
     assert.ok(chunk instanceof Uint8Array);
     if(emittedChunks===0&&variant==='empty-chunk')controller.enqueue(new Uint8Array(0));
     if(emittedChunks===0&&variant==='non-byte-chunk')controller.enqueue('not-image-bytes');
     for(let offset=0;offset<chunk.byteLength;offset+=split){
      let part=chunk.subarray(offset,Math.min(offset+split,chunk.byteLength));
      if(variant==='corrupt-chunk'&&emittedChunks===0){part=part.slice();part[0]^=1;}
      if(variant==='short-stream'&&emittedBytes+part.byteLength===objectSize)part=part.subarray(0,part.byteLength-1);
      if(part.byteLength){emittedChunks++;emittedBytes+=part.byteLength;controller.enqueue(part);}
     }
    },
    flush(controller){
     flushed=true;
     if(variant==='read-error'||variant==='read-undefined')throw originalError;
     if(variant==='extra-byte'){emittedChunks++;emittedBytes++;controller.enqueue(Uint8Array.of(0));}
    },
   }));
   wrapped=body;const getReader=body.getReader.bind(body);bodyCancel=body.cancel.bind(body);
   Object.defineProperties(body,{
    cancel:{value:async reason=>{
     lifecycle.push('body-cancel-start');cancelReason=reason;
     try{await bodyCancel(reason);}catch(error){cancelFailure=error;}
     lifecycle.push('body-cancel-settled');if(cleanupFault)throw cancelError;
    }},
    getReader:{value:(...options)=>{
     readerAttempts++;if(variant==='reader-error')throw originalError;
     const reader=getReader(...options),read=reader.read.bind(reader),cancel=reader.cancel.bind(reader),release=reader.releaseLock.bind(reader);readers++;
     Object.defineProperties(reader,{
      read:{value:async()=>{
       readCalls++;activeReads++;maximumActiveReads=Math.max(maximumActiveReads,activeReads);
       try{const part=await read();if(part.done)eof=true;else{readChunks++;if(part.value instanceof Uint8Array)readBytes+=part.value.byteLength;}return part;}finally{activeReads--;}
      }},
      cancel:{value:async reason=>{
       lifecycle.push('cancel-start');cancelReason=reason;
       try{await cancel(reason);}catch(error){cancelFailure=error;}
       lifecycle.push('cancel-settled');if(cleanupFault)throw cancelError;
      }},
      releaseLock:{value:()=>{
       lifecycle.push('release-start');release();lifecycle.push('release-settled');if(cleanupFault)throw releaseError;
      }},
     });
     return reader;
    }},
   });
   const returned={...object,body,...(invalidSizes.has(variant)?{size:invalidSizes.get(variant)}:variant==='size-at-budget'?{size:limit}:{})};
   Object.defineProperty(returned,'body',{get(){bodyGets++;if(variant==='body-error')throw originalError;return body;}});
   if(variant==='metadata-error')Object.defineProperty(returned,'customMetadata',{get(){throw originalError;}});
   if(variant==='headers-error')returned.writeHttpMetadata=()=>{throw originalError;};
   return returned;
  };
  try{
   if(thrown)await assert.rejects(imageAcknowledgmentRequest(h),error=>{assert.equal(error,variant==='release-error'?releaseError:originalError,'cleanup never replaces the original thrown value');return true;});
   else{
    const response=await imageAcknowledgmentRequest(h),body=await response.json();
    if(variant==='valid'){assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.recovered,true);assert.equal(body.job.jobId,slot.job_id);assert.equal(body.job.status,'completed');}
    else{assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,'output_image_acknowledgment_unavailable');assert.equal(body.recovered,undefined);}
   }
   assert.ok(wrapped);assert.equal(bodyGets,1,'the body is captured once');assert.equal(activeReads,0);assert.equal(wrapped.locked,false,'the real stream reader lock is released');
   if(beforeReader){
    assert.equal(readers,0);assert.equal(readCalls,0,'size and custody admission precede the first read');assert.equal(maximumActiveReads,0);assert.equal(readerAttempts,variant==='reader-error'?1:0);
    assert.deepEqual(lifecycle,variant==='body-error'?[]:['body-cancel-start','body-cancel-settled']);
    if(thrown&&variant!=='body-error')assert.equal(cancelReason,originalError);
   }else{
    assert.equal(readers,1);assert.equal(readerAttempts,1);assert.equal(maximumActiveReads,1,'only one read is outstanding');
    if(variant==='valid'||variant==='corrupt-chunk'){
     assert.equal(eof,true);assert.equal(flushed,true);assert.ok(readChunks>1);assert.equal(readBytes,objectSize);assert.equal(emittedBytes,objectSize);assert.deepEqual(lifecycle,['release-start','release-settled']);
    }else{
     assert.deepEqual(lifecycle,variant==='release-error'?['release-start','release-settled','cancel-start','cancel-settled','release-start','release-settled']:['cancel-start','cancel-settled','release-start','release-settled']);
     if(variant==='read-error'||variant==='read-undefined'){assert.equal(eof,false);assert.equal(flushed,true);assert.ok(emittedChunks>1);assert.equal(emittedBytes,objectSize);assert.equal(cancelReason,originalError);assert.equal(cancelFailure,originalError);}
     if(variant==='extra-byte'){assert.equal(eof,false);assert.equal(readBytes,objectSize+1);assert.equal(readCalls,readChunks,'overflow is rejected without another read');}
     if(variant==='short-stream'){assert.equal(eof,true);assert.equal(readBytes,objectSize-1);}
     if(variant==='size-at-budget'){assert.equal(eof,true);assert.equal(readBytes,objectSize);assert.ok(readChunks>1,'the exact budget is admitted, then exact EOF size is required');}
     if(variant==='empty-chunk'||variant==='non-byte-chunk'){assert.equal(eof,false);assert.equal(readCalls,1);assert.equal(readBytes,0);}
     if(variant==='release-error'){assert.equal(eof,true);assert.equal(cancelReason,releaseError);}
    }
   }
   assertImageAcknowledgmentUnchanged(h,before);
  }finally{
   f.env.MEDIA.get=get;
   // The throwing getter exposed no body to production; the fixture owns this otherwise inaccessible stream.
   if(variant==='body-error'&&bodyCancel)await bodyCancel();
  }
 });
});



// Retained finalization uses the original principal and job, never the paid runner's claim or a reconstructed browser request.
const {finalizeRetainedImageJob}=await import('../worker/document-jobs-api.ts');
const finalizationRows=(f,table,key)=>f.sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all().map(row=>({...row}));
function finalizationSnapshot(f){
 return{jobs:finalizationRows(f,'document_jobs','job_id'),slots:finalizationRows(f,'output_operation_slots','slot_id'),grants:finalizationRows(f,'output_execution_grants','grant_id'),calls:recoveryCalls(f),financial:recoveryFinancialState(f),storage:finalizationRows(f,'output_native_storage_writes','scope_key,slot_id,storage_key'),privateContent:finalizationRows(f,'private_content','content_id'),events:finalizationRows(f,'events','sequence'),privateEvents:finalizationRows(f,'event_private_payloads','private_event_id'),...(f.projectAccessId?{projectEvents:finalizationRows(f,'project_event_scopes','event_id'),projectResources:finalizationRows(f,'project_resource_scopes','project_access_id,resource_kind,resource_id'),projectMigration:finalizationRows(f,'project_migration_states','project_access_id')}:{})};
}
function assertNoFinalizationPurchase(log){
 assert.equal(log.filter(sql=>sql.startsWith("UPDATE document_jobs SET status='running',attempt_count=attempt_count+1")).length,0,'finalization cannot claim another attempt');
 assert.equal(log.filter(sql=>sql.startsWith('UPDATE document_jobs SET lease_expires_at=')).length,0,'finalization cannot renew a lease');
 assert.equal(log.filter(sql=>/^INSERT(?: OR \w+)? INTO output_provider_calls\b/u.test(sql)).length,0,'finalization cannot reserve another paid call');
 assert.equal(log.filter(sql=>/^INSERT(?: OR \w+)? INTO (?:budget_reservations|cost_budget_reservations)\b/u.test(sql)).length,0,'finalization cannot create another allowance');
}
function assertFinalizedImageUsage(usage,slot,stage,receipts){
 assert.equal(usage.reservation_id,slot.token_reservation_id);assert.equal(usage.cost_reservation_id,slot.cost_reservation_id);assert.equal(usage.reserved_tokens,slot.maximum_tokens);assert.equal(usage.reserved_microusd,slot.maximum_microusd);
 assert.equal(usage.input_tokens,stage.planned.usage.inputTokens+stage.rendered.image.usage.inputTokens);assert.equal(usage.output_tokens,stage.planned.usage.outputTokens+stage.rendered.image.usage.outputTokens);assert.equal(usage.total_tokens,receipts.reduce((sum,receipt)=>sum+receipt.totalTokens,0));
 assert.equal(usage.total_tokens,stage.planned.usage.totalTokens+stage.rendered.image.usage.totalTokens);assert.equal(usage.planner_tokens,stage.planned.usage.totalTokens);assert.equal(usage.image_tokens,stage.rendered.image.usage.totalTokens);
 assert.equal(usage.cost_microusd,receipts.reduce((sum,receipt)=>sum+receipt.costMicrousd,0));assert.equal(usage.planner_cost_microusd,receipts.filter(receipt=>receipt.operation==='planning').reduce((sum,receipt)=>sum+receipt.costMicrousd,0));assert.equal(usage.image_cost_microusd,receipts.filter(receipt=>receipt.operation==='image').reduce((sum,receipt)=>sum+receipt.costMicrousd,0));
 const ordered=rows=>rows.sort((left,right)=>left.client_request_id.localeCompare(right.client_request_id));
 assert.deepEqual(ordered(usage.provider_call_receipts.map(receipt=>({client_request_id:receipt.client_request_id,request_digest:receipt.request_digest,provider:receipt.provider,model:receipt.model,operation:receipt.operation,provider_request_id:receipt.provider_request_id,cost_microusd:receipt.cost_microusd}))),ordered(receipts.map(receipt=>({client_request_id:receipt.clientRequestId,request_digest:receipt.requestDigest,provider:receipt.provider,model:receipt.model,operation:receipt.operation,provider_request_id:receipt.providerRequestId??null,cost_microusd:receipt.costMicrousd}))));
}
function assertFinalizationTransport(transport){assert.equal(transport.finalizationAttempts.length,3,'no additional fetch attempt may hide behind a caught transport or JSON assertion');assert.equal(transport.sent.length,3);assert.deepEqual(transport.counts(),{planner:1,image:1,moderation:1});}
async function withImageFinalization(context,{shared=false,state='failed',twoTargets=false,sourceDeadline,zeroUsage=false}={},exercise){
 const finalizationAttempts=[],transportContext={mock:{restoreAll:()=>context.mock.restoreAll(),method:(target,name,implementation)=>context.mock.method(target,name,async(...args)=>{
  const address=String(args[0]);finalizationAttempts.push(address);const response=await implementation(...args);
  if(!zeroUsage||!address.endsWith('/responses')&&!address.endsWith('/images/generations'))return response;
  const body=await response.json();body.usage={input_tokens:0,output_tokens:0,total_tokens:0,...(address.endsWith('/images/generations')?{input_tokens_details:{text_tokens:0,image_tokens:0}}:{})};
  return Response.json(body,{status:response.status,headers:response.headers});
 })}};
 await withImageRecovery(transportContext,{stage:'rendered',shared,twoTargets,sourceDeadline},async parts=>{
  Object.defineProperty(parts.transport,'finalizationAttempts',{value:finalizationAttempts});
  const {f,slot,gate,saved,first,track,finish}=parts,batch=f.DB.batch.bind(f.DB);
  let releasePublication,announce,publication=null;
  const publicationGate=new Promise(resolve=>{releasePublication=resolve;}),reached=new Promise(resolve=>{announce=resolve;});
  const release=()=>{releasePublication();gate.release();};
  f.DB.batch=async statements=>{
   const eventIndices=statements.flatMap((statement,index)=>statement.sql.startsWith('INSERT INTO event_write_stage')&&['GenerationCompleted','GenerationUsageRecorded'].includes(statement.bindings[11])&&statement.bindings[7]===saved.job.correlation_id?[index]:[]);
   const settlement=state==='committing-unsettled'&&statements.some(statement=>statement.sql.startsWith('UPDATE budget_reservations SET used_tokens='))&&statements.some(statement=>statement.sql.startsWith('UPDATE cost_budget_reservations SET used_microusd='));
   if(publication||(!eventIndices.length&&!settlement))return batch(statements);
   publication={eventIndices,eventIds:eventIndices.map(index=>statements[index].bindings[0]),job:gate.row(),raceEventIds:[]};announce(publication);await publicationGate;
   if(state==='failed'){
    // Two genuine source-neutral writes make the original publication lose its head, not its paid evidence.
    for(let index=0;index<2;index++)publication.raceEventIds.push((await appendAuditEvent(f.env,stream,'user','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'})).eventId);
    const after=()=>publication.eventIds.map(id=>({event:f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(id)??null,private:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id)??null}));
    try{const results=await batch(statements);publication.eventChanges=eventIndices.map(index=>Number(results[index].meta.changes));publication.after=after();return results;}catch(error){publication.failure=String(error);publication.after=after();throw error;}
   }
   return batch(statements);
  };
  try{
   gate.release();await imageRecoveryBounded(Promise.race([reached,first.then(()=>{throw new Error('original Image run ended before its committing publication gate');})]),release,'finalization fixture committing gate');
   assert.equal(publication.eventIndices.length,state==='committing-unsettled'?0:2);assert.equal(publication.job.status,'committing');assert.equal(publication.job.correlation_id,saved.job.correlation_id);assert.equal(publication.job.attempt_count,saved.job.attempt_count);
   assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id).status,'running');assert.equal(recoveryCompletions(f).length,0);
   if(state==='failed'){
    release();await imageRecoveryBounded(first,release,'natural failed publication');await finish();
    if(publication.failure!==undefined)assert.match(publication.failure,/CHECK constraint failed/u);else assert.deepEqual(publication.eventChanges,[0,0],'the actual two-event head loss committed no completion or usage');assert.ok(publication.after.every(item=>item.event===null&&item.private===null));assert.equal(gate.row().status,'failed');assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id).status,'failed');assert.equal(recoveryCompletions(f).length,0);
    if(shared){
     // The audit-only race writes deliberately skipped project sidecars. Exercise
     // the real authorized reader's synchronization before taking the test baseline.
     // This is a fixture prerequisite, not automatic server finalizer repair.
     const currentStageId=JSON.parse(gate.row().result_json).imageRecovery.contentId;assert.equal(currentStageId,saved.pointer.contentId);
     const currentStageRows=()=>({content:{...f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(currentStageId)},scope:{...f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(f.projectAccessId,currentStageId)},retention:{...f.sqlite.prepare('SELECT * FROM private_content_retention_scopes WHERE content_id=?').get(currentStageId)}});
     const liveStage=currentStageRows();assert.equal(originalActor(f,slot),saved.job.owner_id);assert.equal(liveStage.content.content_id,currentStageId);assert.equal(liveStage.content.owner_id,saved.job.owner_id);assert.equal(liveStage.content.kind,'provider-output');assert.equal(liveStage.content.redacted_at,null);assert.ok(liveStage.content.content.length>0);assert.ok(Date.parse(liveStage.content.expires_at)>Date.now());
     assert.equal(liveStage.scope.project_access_id,f.projectAccessId);assert.equal(liveStage.scope.resource_kind,'content');assert.equal(liveStage.scope.resource_id,currentStageId);assert.equal(liveStage.scope.organization_id,f.organizationId);assert.equal(liveStage.scope.project_id,'project-atmosphere');assert.equal(liveStage.scope.owner_user_id,saved.job.owner_id);assert.equal(liveStage.scope.actor_user_id,saved.job.owner_id);assert.equal(liveStage.scope.visibility,'actor_private');
     assert.equal(liveStage.retention.content_id,currentStageId);assert.equal(liveStage.retention.organization_id,f.organizationId);assert.equal(liveStage.retention.project_access_id,f.projectAccessId);assert.equal(liveStage.retention.project_id,'project-atmosphere');assert.equal(liveStage.retention.actor_user_id,saved.job.owner_id);assert.equal(liveStage.retention.classification,'transient-private');
     const retainedState=()=>{
      const retained=finalizationSnapshot(f);for(const key of['projectEvents','projectResources','projectMigration'])delete retained[key];
      return{...retained,currentStage:currentStageRows(),ownerHead:f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(saved.job.stream_id).head,
       media:[...f.media].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,bytes:Buffer.from(value.bytes),metadata:structuredClone(value.metadata),contentType:value.contentType})),mediaCounts:parts.mediaCounts(),providerCounts:parts.transport.counts(),providerRequests:parts.transport.sent.length};
     };
     const retained=retainedState(),response=await handleEvents(new Request('http://localhost/api/events',{method:'GET',headers:f.headers}),f.env);assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
     assert.deepEqual(retainedState(),retained,'only the real project projection changes; original events, paid evidence, jobs, finance, media and owner head remain exact');
     const migration={...f.sqlite.prepare('SELECT * FROM project_migration_states WHERE project_access_id=?').get(f.projectAccessId)};
     assert.equal(migration.organization_id,f.organizationId);assert.equal(migration.owner_user_id,saved.job.owner_id);assert.equal(migration.status,'active');assert.equal(migration.last_owner_sequence,retained.ownerHead);
     assert.equal(publication.raceEventIds.length,2);assert.equal(new Set(publication.raceEventIds).size,2);
     for(const eventId of publication.raceEventIds){
      const source={...f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(eventId)},scoped=f.sqlite.prepare('SELECT * FROM project_event_scopes WHERE event_id=?').get(eventId);
      assert.equal(source.event_id,eventId);assert.equal(source.type,'DocumentOpened');assert.equal(source.stream_id,saved.job.stream_id);assert.equal(scoped,undefined,'the real projector excludes audit-only DocumentOpened from PROJECT_EVENT_TYPES');
     }
    }
   }
   const account=await requireUser(new Request('http://localhost/api/session',{headers:f.headers}),f.env);assert.ok(account.user);
   const log=[],observedBatch=f.DB.batch.bind(f.DB);
   f.DB.batch=statements=>{log.push(...statements.map(statement=>statement.sql));return observedBatch(statements);};
   const finalize=(entry='direct')=>{
    const operation=entry==='direct'?finalizeRetainedImageJob(f.env,account.user,slot.job_id):handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/recover`,{method:'POST',headers:f.headers}),f.env,`${slot.job_id}/recover`);
    const promise=track(operation);return imageRecoveryBounded(promise,release,'provider-free Image finalization');
   };
   await exercise({...parts,finalize,account:account.user,release,log,originalPublication:publication});
  }finally{
   release();await finish();
   const originalSignal=parts.transport.sent.find(item=>item.address.endsWith('/responses')).signal;
   assert.ok(originalSignal instanceof AbortSignal);assert.equal(originalSignal.aborted,false,'the joined original operation did not leave through a detached native heartbeat exit');
  }
 });
}

test('Image recovery behavioral: retained finalization publishes the original committing or failed Image without a new attempt',async context=>{
 for(const shared of[false,true])for(const state of['committing','failed'])for(const entry of['direct','recover'])await withImageFinalization(context,{shared,state},async({f,slot,gate,saved,transport,mediaCounts,finalize,expire,release,finish,log})=>{
  if(state==='committing')expire();const before=gate.row(),retained=retainedImageStage(f,saved.pointer),calls=recoveryCalls(f),financial=recoveryFinancialState(f),media=mediaCounts();
  const requested={...f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(retained.envelope.stage.requestedEventId)};assert.equal(requested.actor,shared?`user:${before.owner_id}`:'user','the original requested event uses the actual scope-specific writer identity');
  f.env.OPENAI_MODEL='unavailable-current-planner';f.env.OPENAI_IMAGE_MODEL='unavailable-current-image';
  const result=await finalize(entry);
  if(entry==='direct'){assert.equal(result.finalized,true,JSON.stringify(result));assert.equal(result.job.status,'completed');}
  else{assert.equal(result.status,200,JSON.stringify(await result.clone().json()));assert.equal((await result.json()).job.status,'completed');}
  const completed=gate.row();assert.equal(completed.status,'completed');assert.equal(completed.attempt_count,before.attempt_count);assert.equal(completed.correlation_id,before.correlation_id);assert.equal(completed.job_id,before.job_id);assert.equal(completed.request_json,before.request_json);
  const events=recoveryCompletions(f);assert.equal(events.length,1);const all=await readWorkspaceEvents(f.env,stream),completion=all.find(event=>event.eventId===events[0].event_id),usage=all.filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===retained.envelope.stage.generationId);
  assert.equal(completion.payload.generation_id,retained.envelope.stage.generationId);assert.equal(completion.correlationId,before.correlation_id);assert.equal(completion.causationId,retained.envelope.stage.compiledEventId);assert.equal(usage.length,1);assert.equal(usage[0].causationId,completion.eventId);
  assertFinalizedImageUsage(usage[0].payload,slot,retained.envelope.stage,Object.values(JSON.parse(before.result_json).providerSubmissions));
  const storage=f.sqlite.prepare('SELECT * FROM output_native_storage_writes WHERE slot_id=?').get(slot.slot_id);assert.equal(storage.publication_event_id,completion.eventId);
  const nativeSlot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id);assert.equal(nativeSlot.status,'succeeded');assert.equal(nativeSlot.outcome_event_id,completion.eventId);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');
  for(const key of['output_ref','prompt_ref']){const content=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(completion.payload[key]);assert.ok(content);assert.ok(Date.parse(content.expires_at)<=Date.parse(retained.row.expires_at),'finalization does not extend retained data lifetime');}
  assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(recoveryFinancialState(f),financial);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
  release();await finish();assert.equal(gate.row().status,'completed');assert.deepEqual(recoveryCompletions(f),events);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(recoveryFinancialState(f),financial);
  assert.deepEqual((await readWorkspaceEvents(f.env,stream)).filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===retained.envelope.stage.generationId),usage,'the joined original caller cannot append a second usage event');
  const settled=finalizationSnapshot(f),repeat=await finalize();assert.equal(repeat.finalized,undefined);assert.ok([403,409].includes(repeat.status));assert.deepEqual(finalizationSnapshot(f),settled);assertNoFinalizationPurchase(log);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);
  assert.deepEqual({...f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(requested.event_id)},requested,'finalization and repeats preserve the original actor witness');
 });
});

test('Image recovery behavioral: concurrent finalizers publish once and leave an unfinished sibling grant active',async context=>{
 for(const shared of[false,true])await withImageFinalization(context,{shared,twoTargets:true},async({f,slot,slots,gate,transport,mediaCounts,finalize,log})=>{
  const sibling=slots.find(item=>item.slot_id!==slot.slot_id);assert.ok(sibling);const originalSibling={...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE slot_id=?').get(sibling.slot_id)},job=gate.row(),financial=recoveryFinancialState(f),calls=recoveryCalls(f),media=mediaCounts();
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'active');
  const results=await Promise.all([finalize(),finalize()]);assert.equal(results.filter(result=>result.finalized===true).length,1);assert.ok(results.filter(result=>!result.finalized).every(result=>[403,409].includes(result.status)));
  assert.equal(recoveryCompletions(f).length,1);assert.equal(gate.row().attempt_count,job.attempt_count);assert.equal(gate.row().correlation_id,job.correlation_id);assert.equal(gate.row().status,'completed');
  assert.deepEqual({...f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE slot_id=?').get(sibling.slot_id)},originalSibling);assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'active');
  assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(recoveryFinancialState(f),financial);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image recovery behavioral: finalization does not steal a live or indeterminate committing lease',async context=>{
 for(const shared of[false,true])for(const lease of['active','missing','invalid'])await withImageFinalization(context,{shared,state:'committing'},async({f,slot,gate,transport,mediaCounts,finalize,log})=>{
  if(lease!=='active'){const row=gate.row();assert.equal(f.sqlite.prepare('UPDATE document_jobs SET lease_expires_at=? WHERE job_id=? AND status=? AND correlation_id=? AND lease_expires_at IS ?').run(lease==='missing'?null:'not-a-timestamp',slot.job_id,'committing',row.correlation_id,row.lease_expires_at).changes,1);}
  const before=finalizationSnapshot(f),media=mediaCounts(),result=await finalize();assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status));assert.deepEqual(finalizationSnapshot(f),before);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image recovery behavioral: finalization preserves cancellation, administrator intent and withdrawn authority',async context=>{
 for(const fault of['canceled','administrator','actor','source','session','retention','grant','uncertain'])await withImageFinalization(context,{shared:true},async({f,slot,gate,saved,transport,mediaCounts,finalize,log})=>{
  const before=gate.row();
  // Intent tombstones are explicit negative-fixture CAS faults on genuinely failed paid evidence, not claims that /cancel accepted a committing job.
  if(fault==='canceled'||fault==='administrator'){
   const checkpoint=JSON.parse(before.result_json),code=fault==='canceled'?'canceled_by_user':'force_failed_by_admin',result=JSON.stringify({...checkpoint,errorDetail:{...checkpoint.errorDetail,code}});
   assert.equal(f.sqlite.prepare('UPDATE document_jobs SET status=?,error_message=?,result_json=? WHERE job_id=? AND status=? AND correlation_id=? AND result_json=?').run(fault==='canceled'?'canceled':'failed',code,result,slot.job_id,'failed',before.correlation_id,before.result_json).changes,1);
   if(fault==='canceled')assert.equal(f.sqlite.prepare("UPDATE output_operation_slots SET status='cancelled' WHERE slot_id=? AND status='failed'").run(slot.slot_id).changes,1);
  }
  if(fault==='actor')f.sqlite.prepare("UPDATE users SET consent_version='withdrawn-consent' WHERE user_id=?").run(originalActor(f,slot));
  if(fault==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'recovery-source',property_path:'text',new_value:'Withdrawn original source.'});
  if(fault==='session')f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
  if(fault==='retention')f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(),saved.pointer.contentId);
  if(fault==='grant')f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=?").run(slot.grant_id);
  if(fault==='uncertain')f.sqlite.prepare("UPDATE output_provider_calls SET status='uncertain' WHERE slot_id=? AND call_key='image:initial'").run(slot.slot_id);
  const withdrawn=finalizationSnapshot(f),media=mediaCounts(),result=await finalize();assert.equal(result.finalized,undefined,fault);assert.ok([403,409].includes(result.status),JSON.stringify({fault,result}));assert.deepEqual(finalizationSnapshot(f),withdrawn);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image recovery behavioral: finalization rejects unavailable or oversized retained media before replacement work',async context=>{
 for(const fault of['missing-stage','corrupt-stage','expired-stage','oversized-stage','oversized-job','excess-call','missing-media','corrupt-media','oversized-media','stream-oversized-media','metadata-throws','reader-throws'])for(const entry of(fault==='oversized-job'?['direct','recover']:['direct']))await withImageFinalization(context,{},async({f,slot,gate,saved,transport,mediaCounts,finalize,log})=>{
  const retained=retainedImageStage(f,saved.pointer),key=decodeURIComponent(retained.envelope.stage.rendered.media.url.slice('/api/media/'.length));let bodyReads=0,streamPulls=0,streamCancels=0,setupAttempts=0,oversizedStream;
  if(fault==='missing-stage')f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(saved.pointer.contentId);
  if(fault==='corrupt-stage')f.sqlite.prepare("UPDATE private_content SET content=content||' ' WHERE content_id=?").run(saved.pointer.contentId);
  if(fault==='expired-stage')f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=?').run('2000-01-01T00:00:00.000Z',saved.pointer.contentId);
  // Explicit retained-body resource faults preserve all ledger anchors and provider receipts; no authority or valid paid stage is fabricated.
  if(fault==='oversized-stage'){
   const content=JSON.stringify({...retained.envelope,finalization_fixture_padding:'x'.repeat(2_000_001)});assert.ok(new TextEncoder().encode(content).byteLength>2_000_000);
   assert.equal(f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=? AND content=?').run(content,saved.pointer.contentId,retained.row.content).changes,1);
  }
  if(fault==='oversized-job'){
   const job=gate.row(),originalBytes=new TextEncoder().encode(job.result_json).byteLength;assert.ok(originalBytes<=2_000_000);const result=job.result_json+' '.repeat(2_000_001-originalBytes);assert.equal(new TextEncoder().encode(result).byteLength,2_000_001);assert.deepEqual(JSON.parse(result),JSON.parse(job.result_json),'whitespace preserves the actual checkpoint value');
   assert.equal(f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND attempt_count=? AND result_json=?').run(result,job.job_id,job.owner_id,job.correlation_id,job.attempt_count,job.result_json).changes,1);
  }
  if(fault==='excess-call'){
   const original=recoveryCalls(f).find(call=>call.slot_id===slot.slot_id&&call.call_key==='image:initial');assert.ok(original);assert.equal(recoveryCalls(f).length,2);
   // An explicitly invalid third ledger row tests call-set rejection; it does not represent another provider request or fabricate a matching checkpoint receipt.
   assert.equal(f.sqlite.prepare(`INSERT INTO output_provider_calls(scope_key,slot_id,call_key,client_request_id,request_digest,stage_key,provider,model,reserved_microusd,status,created_at,used_microusd,provider_response_id,settled_at)
    SELECT scope_key,slot_id,?,?,request_digest,?,provider,model,reserved_microusd,status,created_at,used_microusd,provider_response_id,settled_at FROM output_provider_calls
    WHERE scope_key=? AND slot_id=? AND call_key=? AND client_request_id=? AND request_digest=?`).run('image:fixture-excess',`${original.client_request_id}:fixture-excess`,original.stage_key,original.scope_key,original.slot_id,original.call_key,original.client_request_id,original.request_digest).changes,1);
   assert.equal(recoveryCalls(f).length,3);
  }
  if(fault==='missing-media')f.media.delete(key);
  if(fault==='corrupt-media')f.media.get(key).bytes=new Uint8Array([0,1,2]);
  if(fault==='oversized-media'){
   const get=f.env.MEDIA.get.bind(f.env.MEDIA);oversizedStream=new ReadableStream({pull(){bodyReads++;throw new Error('oversized retained media must be rejected before consuming its body');},cancel(){streamCancels++;}},{highWaterMark:0});
   f.env.MEDIA.get=async requested=>{const object=await get(requested);return requested===key&&object?{...object,size:Number.MAX_SAFE_INTEGER,body:oversizedStream}:object;};
  }
  if(fault==='stream-oversized-media'){
   const get=f.env.MEDIA.get.bind(f.env.MEDIA);
   oversizedStream=new ReadableStream({pull(controller){streamPulls++;if(streamPulls>9){controller.error(new Error('the finalizer read beyond its declared verification work ceiling'));return;}controller.enqueue(new Uint8Array(8*1024*1024));},cancel(){streamCancels++;}},{highWaterMark:0});
   f.env.MEDIA.get=async requested=>{const object=await get(requested);return requested===key&&object?{...object,size:64*1024*1024,body:oversizedStream}:object;};
  }
  if(fault==='metadata-throws'||fault==='reader-throws'){
   const get=f.env.MEDIA.get.bind(f.env.MEDIA);oversizedStream=new ReadableStream({pull(){bodyReads++;throw new Error('failed media setup must not consume retained bytes');},cancel(){streamCancels++;}},{highWaterMark:0});
   if(fault==='reader-throws')Object.defineProperty(oversizedStream,'getReader',{value(){setupAttempts++;throw new Error('fixture reader acquisition failed');}});
   f.env.MEDIA.get=async requested=>{const object=await get(requested);return requested===key&&object?{...object,body:oversizedStream,...(fault==='metadata-throws'?{writeHttpMetadata(){setupAttempts++;throw new Error('fixture metadata setup failed');}}:{})}:object;};
  }
  const before=finalizationSnapshot(f),media=mediaCounts(),prototype=Object.getPrototypeOf(f.DB.prepare('SELECT 1')),descriptor=Object.getOwnPropertyDescriptor(prototype,'execute'),oversizedReturned=[],readCaptureErrors=[];
  if(fault==='oversized-job'||fault==='oversized-stage')Object.defineProperty(prototype,'execute',{...descriptor,value:function(kind){
   const result=descriptor.value.call(this,kind);
   // Observe the actual fixture query result, without a new read, replacement result or global parser instrumentation.
   try{for(const row of kind==='first'?(result?[result]:[]):kind==='all'?result.results:[])for(const[column,value]of Object.entries(row))if(typeof value==='string'){const bytes=new TextEncoder().encode(value).byteLength;if(bytes>2_000_000)oversizedReturned.push({column,bytes});}}
   catch(error){readCaptureErrors.push(String(error));}
   return result;
  }});
  let result;try{result=await finalize(entry);}finally{Object.defineProperty(prototype,'execute',descriptor);}
  assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status),JSON.stringify({fault,entry,result}));assert.equal(bodyReads,0);
  if(fault==='oversized-job'||fault==='oversized-stage'){assert.deepEqual(readCaptureErrors,[]);assert.deepEqual(oversizedReturned,[],'finalization may not materialize oversized retained or job JSON from the database');}
  if(fault==='stream-oversized-media'){assert.ok(streamPulls>0&&streamPulls<=9);assert.equal(streamCancels,1);assert.equal(oversizedStream.locked,false,'the failed verification releases its reader lock');}
  if(fault==='oversized-media'){assert.equal(streamCancels,1);assert.equal(oversizedStream.locked,false,'metadata rejection cancels without reading or locking the body');}
  if(fault==='metadata-throws'||fault==='reader-throws'){assert.equal(setupAttempts,1);assert.equal(streamCancels,1);assert.equal(oversizedStream.locked,false,'failed metadata or reader setup cancels the unconsumed stream');}
  if(fault==='oversized-stage'||fault==='oversized-job'||fault==='excess-call')assert.equal(mediaCounts().reads,media.reads,'oversized or excess proof data cannot reach media verification');
  assert.deepEqual(finalizationSnapshot(f),before);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);assert.equal(gate.row().job_id,slot.job_id);
 });
});

test('Image recovery behavioral: finalization rolls back every publication effect when its final job CAS loses',async context=>{
 for(const shared of[false,true])await withImageFinalization(context,{shared},async({f,slot,gate,transport,mediaCounts,finalize,log})=>{
  const batch=f.DB.batch.bind(f.DB),before=finalizationSnapshot(f),media=mediaCounts(),prototype=Object.getPrototypeOf(f.DB.prepare('SELECT 1')),descriptor=Object.getOwnPropertyDescriptor(prototype,'execute');let witness=null;
  f.DB.batch=async statements=>{
   const publication=recoveryPublicationBatch(statements,slot);if(!publication||witness)return batch(statements);
   const finalIndex=statements.findIndex(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='completed',result_json=?,error_message=NULL,completed_at=?,lease_expires_at=NULL,updated_at=?"));
   witness={publication,finalIndex,before:finalizationSnapshot(f),inserts:[]};
   if(finalIndex<=Math.max(...publication.eventIndices))throw new Error('finalization job CAS is not after the real publication INSERTs');
   Object.defineProperty(prototype,'execute',{...descriptor,value:function(kind){
    const index=statements.indexOf(this);
    // This explicitly labeled, transaction-local fault injects an exact snapshot change. It does not claim a second SQLite writer ran inside BEGIN IMMEDIATE.
    if(index===finalIndex){const row=gate.row(),changed=JSON.stringify({...JSON.parse(row.result_json),finalization_fixture_snapshot:'changed'});witness.setupChanges=f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND attempt_count=? AND result_json=?').run(changed,row.job_id,row.owner_id,row.stream_id,row.correlation_id,row.attempt_count,row.result_json).changes;witness.changed=gate.row();}
    try{const result=descriptor.value.call(this,kind);if(publication.eventIndices.includes(index))witness.inserts.push({index,changes:Number(result.meta.changes)});if(index===finalIndex)witness.casChanges=Number(result.meta.changes);return result;}
    catch(error){witness.failure={index,sql:this.sql,error:String(error)};throw error;}
   }});
   let results,failure;try{results=await batch(statements);}catch(error){failure=error;}finally{Object.defineProperty(prototype,'execute',descriptor);}
   witness.after=finalizationSnapshot(f);witness.publicationAfter=recoveryPublicationState(f,publication);witness.batchFailure=failure;if(failure)throw failure;return results;
  };
  try{
   const result=await finalize();assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status));assert.ok(witness?.after);assert.equal(witness.setupChanges,1);assert.equal(JSON.parse(witness.changed.result_json).finalization_fixture_snapshot,'changed');assert.equal(witness.casChanges,0);
   assert.deepEqual(witness.inserts,witness.publication.eventIndices.map(index=>({index,changes:1})));assert.ok(witness.failure.index>witness.finalIndex);assert.match(witness.failure.sql,/INSERT INTO output_atomic_assertions/u);assert.match(witness.failure.error,/CHECK constraint failed/u);assert.match(String(witness.batchFailure),/CHECK constraint failed/u);
   assertRecoveryRangeAbsent(witness.publicationAfter);assert.deepEqual(witness.after,witness.before);assert.deepEqual(finalizationSnapshot(f),before);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
  }finally{Object.defineProperty(prototype,'execute',descriptor);}
 });
});

test('Image recovery behavioral: finalization rechecks late withdrawal and project-head contention without partial completion',async context=>{
 for(const fault of['retention','session','call-set','project-head','final-project-head'])await withImageFinalization(context,{shared:true},async({f,slot,gate,saved,transport,mediaCounts,finalize,log})=>{
  const batch=f.DB.batch.bind(f.DB),media=mediaCounts(),prototype=Object.getPrototypeOf(f.DB.prepare('SELECT 1')),descriptor=Object.getOwnPropertyDescriptor(prototype,'execute');let witness=null;
  f.DB.batch=async statements=>{
   const publication=recoveryPublicationBatch(statements,slot);if(!publication||witness)return batch(statements);
   witness={publication};
   if(fault==='retention')witness.setupChanges=f.sqlite.prepare('UPDATE private_content SET redacted_at=? WHERE content_id=? AND redacted_at IS NULL').run(new Date().toISOString(),saved.pointer.contentId).changes;
   if(fault==='session')witness.setupChanges=f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=? AND revoked_at IS NULL').run(new Date().toISOString(),f.contextId).changes;
   if(fault==='call-set')witness.setupChanges=f.sqlite.prepare("UPDATE output_provider_calls SET request_digest=? WHERE slot_id=? AND call_key='image:initial'").run('e'.repeat(64),slot.slot_id).changes;
   if(fault==='project-head'){witness.openIds=[];for(let index=0;index<2;index++)witness.openIds.push((await appendAuditEvent(f.env,stream,'user','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'})).eventId);}
   witness.before=finalizationSnapshot(f);witness.mediaRead=mediaCounts().reads;
   if(fault==='final-project-head'){
    const projectIndex=statements.findIndex(statement=>statement.sql.startsWith('UPDATE project_migration_states SET last_owner_sequence=?,updated_at=?'));witness.projectIndex=projectIndex;witness.executed=[];
    if(projectIndex<=Math.max(...publication.eventIndices))throw new Error('strict final project head must follow real publication writes');
    Object.defineProperty(prototype,'execute',{...descriptor,value:function(kind){
     const index=statements.indexOf(this);
     if(index===projectIndex){
      witness.reached={state:finalizationSnapshot(f),publication:recoveryPublicationState(f,publication),job:gate.row()};
      // Explicit transaction-local final-head fault, not a claimed concurrent SQLite writer. Original publication SQL and result indices are untouched.
      witness.setupChanges=f.sqlite.prepare("UPDATE project_migration_states SET last_owner_sequence=last_owner_sequence+1 WHERE project_access_id=? AND organization_id=? AND owner_user_id=? AND status='active' AND last_owner_sequence=?").run(...this.bindings.slice(2,6)).changes;
     }
     try{const result=descriptor.value.call(this,kind);if(index>=0)witness.executed.push({index,sql:this.sql,changes:Number(result.meta.changes)});if(index===projectIndex)witness.projectChanges=Number(result.meta.changes);return result;}
     catch(error){if(index>projectIndex)witness.projectFailure={index,sql:this.sql,error:String(error)};throw error;}
    }});
   }
   let results,failure;try{results=await batch(statements);}catch(error){failure=error;}finally{Object.defineProperty(prototype,'execute',descriptor);}
   witness.after=finalizationSnapshot(f);witness.publicationAfter=recoveryPublicationState(f,publication);witness.batchFailure=failure;if(failure)throw failure;return results;
  };
  const result=await finalize();assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status),JSON.stringify({fault,result}));assert.ok(witness?.after);assert.ok(witness.mediaRead>media.reads,'retained media verification precedes the final publication boundary');
  if(fault==='project-head'){assert.equal(witness.openIds.length,2);assert.ok(witness.openIds.every(id=>f.sqlite.prepare('SELECT 1 FROM events WHERE event_id=?').get(id)));}else assert.equal(witness.setupChanges,1);
  if(fault==='final-project-head'){
   assert.ok(witness.reached);assert.equal(witness.projectChanges,0);assert.ok(witness.projectFailure.index>witness.projectIndex);assert.match(witness.projectFailure.sql,/changes\(\)=1 AND EXISTS\(SELECT 1 FROM project_migration_states/u);assert.match(witness.projectFailure.error,/CHECK constraint failed/u);
   assert.ok(witness.publication.eventIndices.every(index=>witness.executed.some(item=>item.index===index&&item.changes===1)));assert.ok(witness.reached.publication.events.every(item=>item.event!==null&&item.private!==null));assert.equal(witness.reached.job.status,'completed');assert.equal(witness.reached.publication.storage.publication_event_id,witness.publication.completionId);
   assert.ok(witness.executed.some(item=>item.sql.startsWith("UPDATE document_jobs SET status='completed',result_json=")&&item.changes===1));assert.ok(witness.reached.state.slots.some(item=>item.slot_id===slot.slot_id&&item.status==='succeeded'&&item.outcome_event_id===witness.publication.completionId));
   assert.ok(witness.reached.state.projectEvents.some(item=>item.event_id===witness.publication.completionId));assert.ok(witness.reached.state.projectResources.some(item=>item.source_event_id===witness.publication.completionId));assert.ok(witness.reached.state.privateContent.length>witness.before.privateContent.length);
  }
  assert.match(String(witness.batchFailure),/CHECK constraint failed/u);assertRecoveryRangeAbsent(witness.publicationAfter);assert.deepEqual(witness.after,witness.before);assert.deepEqual(finalizationSnapshot(f),witness.before);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image recovery behavioral: finalization denies other completion IDs already attached to its job or generation',async context=>{
 for(const shared of[false,true])for(const identity of['job','generation'])await withImageFinalization(context,{shared},async({f,slot,gate,saved,transport,mediaCounts,finalize,log})=>{
  const stage=retainedImageStage(f,saved.pointer).envelope.stage,job=gate.row();
  // A genuine immutable ledger append models conflicting publication evidence; no retained stage, call or allowance is fabricated.
  const conflicting=await appendAuditEvent(f.env,stream,'worker:generator','GenerationCompleted',{document_id:f.documentId,generation_id:identity==='generation'?stage.generationId:'different-finalization-generation',output_ref:'conflicting-output-reference',prompt_ref:'conflicting-prompt-reference'},identity==='job'?job.correlation_id:'different-finalization-correlation');
  const completions=recoveryCompletions(f);assert.equal(completions.length,1);assert.equal(completions[0].event_id,conflicting.eventId);
  const before=finalizationSnapshot(f),media=mediaCounts(),result=await finalize();assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status));assert.deepEqual(finalizationSnapshot(f),before);assert.deepEqual(recoveryCompletions(f),completions);assert.equal(gate.row().status,'failed');assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);assert.equal(gate.row().job_id,slot.job_id);
 });
});

test('Image recovery behavioral: finalization retains the late source-rights deadline after actual event insertion',async context=>{
 for(const shared of[false,true]){
  const sourceDeadline=new Date(Date.now()+30_000).toISOString(),cutoff=Date.parse(sourceDeadline);
  await withImageFinalization(context,{shared,sourceDeadline},async({f,slot,saved,transport,mediaCounts,finalize,log})=>{
   const batch=f.DB.batch.bind(f.DB),before=finalizationSnapshot(f),media=mediaCounts(),retained=retainedImageStage(f,saved.pointer),prototype=Object.getPrototypeOf(f.DB.prepare('SELECT 1')),descriptor=Object.getOwnPropertyDescriptor(prototype,'execute');
   const deadlineSql="INSERT INTO output_atomic_assertions(token,passed) VALUES(?,CASE WHEN ((CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER))<?) THEN 1 ELSE 0 END)";
   let clockNow=null,witness=null;const clockErrors=[];
   f.DB.batch=async statements=>{
    const publication=recoveryPublicationBatch(statements,slot);if(!publication||witness)return batch(statements);
    const firstInsert=publication.eventIndices[0],lastInsert=publication.eventIndices.at(-1),deadlines=statements.flatMap((statement,index)=>statement.sql===deadlineSql&&statement.bindings.length===2&&statement.bindings[1]===cutoff?[index]:[]),preIndices=deadlines.filter(index=>index<firstInsert),lateIndices=deadlines.filter(index=>index>lastInsert);
    witness={publication,preIndices,lateIndices,pre:[],inserts:[],before:finalizationSnapshot(f)};
    if(!preIndices.length||!lateIndices.length)throw new Error('finalization must keep the original source deadline before and after event writes');
    const grant=f.sqlite.prepare('SELECT * FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id);
    witness.otherDeadlines={grant:Date.parse(grant.expires_at),retained:Date.parse(retained.row.expires_at)};
    // This fixture-only SQLite clock crosses one original cutoff; no admitted source, lease, grant or private expiry is extended.
    f.sqlite.function('strftime',{varargs:true},(format,value,...extra)=>{
     if(value!=='now'||extra.length||!['%s','%f','%Y-%m-%dT%H:%M:%fZ'].includes(format)){clockErrors.push({format,value,extra});throw new Error('unsupported finalization fixture SQL clock');}
     const time=clockNow??Date.now(),iso=new Date(time).toISOString();return format==='%s'?String(Math.floor(time/1000)):format==='%f'?iso.slice(17,23):iso;
    });
    witness.reachedBefore=Date.now();clockNow=cutoff-1;
    Object.defineProperty(prototype,'execute',{...descriptor,value:function(kind){
     const index=statements.indexOf(this);
     try{
      const result=descriptor.value.call(this,kind);
      if(preIndices.includes(index))witness.pre.push({index,time:clockNow});
      if(publication.eventIndices.includes(index))witness.inserts.push({index,changes:Number(result.meta.changes)});
      if(index===lastInsert){witness.inserted=recoveryPublicationState(f,publication);clockNow=cutoff+1;}
      if(index===statements.length-1)clockNow=null;
      return result;
     }catch(error){if(lateIndices.includes(index))witness.lateFailure={index,time:clockNow,sql:this.sql,bindings:[...this.bindings],error:String(error)};if(index>=0)clockNow=null;throw error;}
    }});
    let results,failure;try{results=await batch(statements);}catch(error){failure=error;}finally{clockNow=null;Object.defineProperty(prototype,'execute',descriptor);}
    witness.after=finalizationSnapshot(f);witness.publicationAfter=recoveryPublicationState(f,publication);witness.batchFailure=failure;if(failure)throw failure;return results;
   };
   try{
    const result=await finalize();assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status));assert.deepEqual(clockErrors,[]);assert.ok(witness?.after);assert.ok(witness.reachedBefore<cutoff-1);assert.ok(witness.preIndices.length>0);assert.ok(witness.lateIndices.length>0);
    assert.deepEqual(witness.pre,witness.preIndices.map(index=>({index,time:cutoff-1})));assert.deepEqual(witness.inserts,witness.publication.eventIndices.map(index=>({index,changes:1})));assert.ok(witness.inserted.events.every(item=>item.event!==null&&item.private!==null));
    assert.ok(witness.lateIndices.includes(witness.lateFailure?.index));assert.equal(witness.lateFailure.time,cutoff+1);assert.equal(witness.lateFailure.sql,deadlineSql);assert.equal(witness.lateFailure.bindings[1],cutoff);assert.match(witness.lateFailure.error,/CHECK constraint failed/u);assert.match(String(witness.batchFailure),/CHECK constraint failed/u);
    for(const value of Object.values(witness.otherDeadlines))assert.ok(Number.isFinite(value)&&value>cutoff+1);
    assertRecoveryRangeAbsent(witness.publicationAfter);assert.deepEqual(witness.after,witness.before);assert.deepEqual(finalizationSnapshot(f),before);assert.deepEqual(retainedImageStage(f,saved.pointer),retained);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
   }finally{clockNow=null;Object.defineProperty(prototype,'execute',descriptor);}
   // The UDF remains in real-time mode until this fixture closes its connection; built-in restoration is not claimed.
  });
 }
});

test('Image recovery behavioral: finalization preserves a genuinely released zero-usage financial pair',async context=>{
 for(const shared of[false,true])await withImageFinalization(context,{shared,zeroUsage:true},async({f,slot,gate,saved,transport,mediaCounts,finalize,log})=>{
  const financial=recoveryFinancialState(f),calls=recoveryCalls(f),receipts=Object.values(JSON.parse(gate.row().result_json).providerSubmissions),media=mediaCounts();
  assert.equal(receipts.length,2);assert.ok(receipts.every(receipt=>receipt.status==='completed'&&receipt.totalTokens===0&&receipt.costMicrousd===0));assert.equal(calls.length,2);assert.ok(calls.every(call=>call.status==='settled'&&call.used_microusd===0));
  const token=financial.reservations.tokens.find(row=>row.reservation_id===slot.token_reservation_id),cost=financial.reservations.costs.find(row=>row.reservation_id===slot.cost_reservation_id);
  assert.ok(token);assert.ok(cost);assert.equal(token.status,'released');assert.equal(cost.status,'released');assert.equal(token.used_tokens,0);assert.equal(cost.used_microusd,0);
  const result=await finalize();assert.equal(result.finalized,true,JSON.stringify(result));assert.equal(gate.row().status,'completed');assert.equal(recoveryCompletions(f).length,1);assert.deepEqual(recoveryFinancialState(f),financial);assert.deepEqual(recoveryCalls(f),calls);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
  const stage=retainedImageStage(f,saved.pointer).envelope.stage,usage=(await readWorkspaceEvents(f.env,stream)).filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===stage.generationId);assert.equal(usage.length,1);assertFinalizedImageUsage(usage[0].payload,slot,stage,receipts);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');
 });
});

test('Image recovery behavioral: finalization settles the original active pair once before the delayed original caller resumes',async context=>{
 for(const shared of[false,true])await withImageFinalization(context,{shared,state:'committing-unsettled'},async({f,slot,gate,saved,transport,mediaCounts,finalize,expire,release,finish,log})=>{
  const before=recoveryFinancialState(f),calls=recoveryCalls(f),job=gate.row(),receipts=Object.values(JSON.parse(job.result_json).providerSubmissions),media=mediaCounts();
  assert.equal(receipts.length,2);assert.ok(receipts.every(receipt=>receipt.status==='completed'));assert.equal(calls.length,2);assert.ok(calls.every(call=>call.status==='settled'));
  const token=before.reservations.tokens.find(row=>row.reservation_id===slot.token_reservation_id),cost=before.reservations.costs.find(row=>row.reservation_id===slot.cost_reservation_id);assert.ok(token);assert.ok(cost);assert.equal(token.status,'active');assert.ok(['active','executing'].includes(cost.status));assert.equal(token.used_tokens,0);assert.equal(cost.used_microusd,0);
  const usedTokens=receipts.reduce((total,receipt)=>total+receipt.totalTokens,0),usedMicrousd=calls.reduce((total,call)=>total+call.used_microusd,0);assert.ok(usedTokens>0);assert.ok(usedMicrousd>0);
  const payer=f.sqlite.prepare('SELECT payer_user_id FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).payer_user_id,keys=[['user',payer],['workspace','forma'],...(shared?[['workspace',f.organizationId]]:[])];
  for(const[scope,id]of keys)for(const rows of[before.tokens,before.costs])assert.ok(rows.some(row=>row.scope===scope&&row.scope_id===id&&row.period===token.period));
  expire();const result=await finalize();assert.equal(result.finalized,true,JSON.stringify(result));assert.equal(gate.row().status,'completed');assert.equal(gate.row().attempt_count,job.attempt_count);assert.equal(gate.row().correlation_id,job.correlation_id);assert.equal(recoveryCompletions(f).length,1);
  const after=recoveryFinancialState(f),owns=row=>row.period===token.period&&keys.some(([scope,id])=>row.scope===scope&&row.scope_id===id);
  assert.deepEqual(after.tokens,before.tokens.map(row=>owns(row)?{...row,used_tokens:row.used_tokens+usedTokens,reserved_tokens:row.reserved_tokens-token.reserved_tokens}:row));assert.deepEqual(after.costs,before.costs.map(row=>owns(row)?{...row,used_microusd:row.used_microusd+usedMicrousd,reserved_microusd:row.reserved_microusd-cost.reserved_microusd}:row));
  const finalToken=after.reservations.tokens.find(row=>row.reservation_id===token.reservation_id),finalCost=after.reservations.costs.find(row=>row.reservation_id===cost.reservation_id);assert.equal(finalToken.status,'settled');assert.equal(finalToken.used_tokens,usedTokens);assert.equal(finalCost.status,'settled');assert.equal(finalCost.used_microusd,usedMicrousd);assert.equal(finalToken.correlation_id,job.correlation_id);assert.equal(finalCost.correlation_id,job.correlation_id);
  const stage=retainedImageStage(f,saved.pointer).envelope.stage,usage=(await readWorkspaceEvents(f.env,stream)).filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===stage.generationId);assert.equal(usage.length,1);assertFinalizedImageUsage(usage[0].payload,slot,stage,receipts);
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');
  const published=recoveryCompletions(f);release();await finish();assert.equal(gate.row().status,'completed');assert.deepEqual(recoveryFinancialState(f),after);assert.deepEqual(recoveryCompletions(f),published);assert.deepEqual(recoveryCalls(f),calls);assertNoFinalizationPurchase(log);
  assert.deepEqual((await readWorkspaceEvents(f.env,stream)).filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===stage.generationId),usage,'delayed settlement cannot append another usage event');
  const committed=finalizationSnapshot(f),repeat=await finalize();assert.equal(repeat.finalized,undefined);assert.ok([403,409].includes(repeat.status));assert.deepEqual(finalizationSnapshot(f),committed);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);
 });
});

test('Image recovery behavioral: finalization refuses altered original reservation amounts and terminal financial evidence',async context=>{
 for(const fault of['token-amount','cost-amount','token-used','cost-used','cost-period','mixed-pair'])await withImageFinalization(context,{shared:true},async({f,slot,transport,mediaCounts,finalize,log})=>{
  let changed;const token=f.sqlite.prepare('SELECT * FROM budget_reservations WHERE reservation_id=?').get(slot.token_reservation_id),cost=f.sqlite.prepare('SELECT * FROM cost_budget_reservations WHERE reservation_id=?').get(slot.cost_reservation_id);
  // Negative guard faults alter only existing genuine reservation evidence. They never fabricate a successful paid receipt or a new allowance.
  if(fault==='token-amount')changed=f.sqlite.prepare('UPDATE budget_reservations SET reserved_tokens=reserved_tokens-1 WHERE reservation_id=? AND reserved_tokens=? AND reserved_tokens>0').run(slot.token_reservation_id,token.reserved_tokens).changes;
  if(fault==='cost-amount')changed=f.sqlite.prepare('UPDATE cost_budget_reservations SET reserved_microusd=reserved_microusd-1 WHERE reservation_id=? AND reserved_microusd=? AND reserved_microusd>0').run(slot.cost_reservation_id,cost.reserved_microusd).changes;
  if(fault==='token-used')changed=f.sqlite.prepare('UPDATE budget_reservations SET used_tokens=used_tokens+1 WHERE reservation_id=? AND used_tokens=?').run(slot.token_reservation_id,token.used_tokens).changes;
  if(fault==='cost-used')changed=f.sqlite.prepare('UPDATE cost_budget_reservations SET used_microusd=used_microusd+1 WHERE reservation_id=? AND used_microusd=?').run(slot.cost_reservation_id,cost.used_microusd).changes;
  if(fault==='cost-period')changed=f.sqlite.prepare('UPDATE cost_budget_reservations SET period=? WHERE reservation_id=? AND period=?').run('1900-01',slot.cost_reservation_id,cost.period).changes;
  if(fault==='mixed-pair')changed=f.sqlite.prepare("UPDATE cost_budget_reservations SET status='active',used_microusd=0,settled_at=NULL WHERE reservation_id=? AND status='settled' AND used_microusd=? AND settled_at IS ?").run(slot.cost_reservation_id,cost.used_microusd,cost.settled_at).changes;
  assert.equal(changed,1);const before=finalizationSnapshot(f),media=mediaCounts(),result=await finalize();assert.equal(result.finalized,undefined);assert.ok([403,409].includes(result.status),JSON.stringify({fault,result}));assert.deepEqual(finalizationSnapshot(f),before);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image recovery behavioral: shared finalization requires a dense successful read-only authority result',async context=>{
 for(const fault of['normal','sparse','missing','false-success','missing-success'])await withImageFinalization(context,{shared:true},async({f,slot,gate,transport,mediaCounts,finalize,log})=>{
  const batch=f.DB.batch.bind(f.DB),before=finalizationSnapshot(f),media=mediaCounts();let witness=null;
  f.DB.batch=async statements=>{
   const proof=statements.length===1&&statements[0].sql.startsWith('SELECT CASE WHEN (')&&statements[0].sql.includes("resource.resource_kind='job' AND resource.resource_id=?")&&statements[0].bindings.includes(slot.job_id)&&statements[0].bindings.includes(f.projectAccessId);
   if(!proof||witness)return batch(statements);
   witness={sql:statements[0].sql,bindings:[...statements[0].bindings]};const real=await batch(statements);witness.real=real;
   // Fault only the returned vector from this genuine read-only authority batch, not its SQL, source data or successful proof value.
   let returned=real;
   if(fault==='sparse'){returned=real.slice();delete returned[0];}
   if(fault==='missing')returned=real.slice(0,0);
   if(fault==='false-success')returned=[{...real[0],success:false}];
   if(fault==='missing-success'){const value={...real[0]};delete value.success;returned=[value];}
   witness.returned=returned;return returned;
  };
  const result=await finalize();assert.ok(witness?.real);assert.equal(witness.real.length,1);assert.equal(witness.real[0].success,true);assert.equal(witness.real[0].results[0].current,1);assert.equal(witness.real[0].meta.changes,0);assert.ok(witness.sql.startsWith('SELECT CASE WHEN ('));assert.ok(witness.bindings.includes(slot.job_id));
  if(fault==='normal'){
   assert.equal(witness.returned,witness.real);assert.equal(result.finalized,true,JSON.stringify(result));assert.equal(gate.row().status,'completed');assert.equal(recoveryCompletions(f).length,1);assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');assert.deepEqual(recoveryFinancialState(f),before.financial);assert.deepEqual(recoveryCalls(f),before.calls);
  }else{
   if(fault==='sparse'){assert.equal(witness.returned.length,1);assert.equal(Object.hasOwn(witness.returned,0),false);}
   if(fault==='missing')assert.equal(witness.returned.length,0);
   if(fault==='false-success')assert.equal(witness.returned[0].success,false);
   if(fault==='missing-success')assert.equal(Object.hasOwn(witness.returned[0],'success'),false);
   assert.equal(result.finalized,undefined);assert.equal(result.error,'output_source_changed_during_read');assert.equal(result.status,409);assert.deepEqual(finalizationSnapshot(f),before);assert.equal(recoveryCompletions(f).length,0);assert.equal(mediaCounts().reads,media.reads,'invalid authority result cannot reach retained media');
  }
  assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image recovery behavioral: normal source capture and disclosure reject incomplete proof results',async context=>{
 for(const boundary of['capture','disclosure-authority','disclosure-body','disclosure-metadata'])for(const fault of['normal','sparse','false-success','missing-success'])await withImageFinalization(context,{shared:true},async({f,slot,gate,transport,mediaCounts,finalize,log})=>{
  const batch=f.DB.batch.bind(f.DB),before=finalizationSnapshot(f),financial=recoveryFinancialState(f),calls=recoveryCalls(f),media=mediaCounts();let witness=null;
  f.DB.batch=async statements=>{
   const capture=statements.length>2&&statements[0].sql.startsWith('SELECT private_event_id,private_json,project_id,document_id FROM event_private_payloads')&&statements[1].sql==='SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?'&&statements[2].sql.startsWith('SELECT CASE WHEN (');
   const metadataIndex=statements.findIndex(statement=>statement.sql.includes('(SELECT COALESCE(MAX(sequence),0) FROM events WHERE stream_id=?)=?'));
   const disclosure=metadataIndex>2&&statements.every(statement=>statement.sql.startsWith('SELECT CASE WHEN ('))&&statements[1].sql.includes('FROM project_context_sessions')&&statements[1].bindings.includes(f.contextId);
   if(witness||!(boundary==='capture'?capture:disclosure))return batch(statements);
   const index=boundary==='capture'?2:boundary==='disclosure-authority'?0:boundary==='disclosure-body'?2:metadataIndex;
   witness={index,metadataIndex,sql:statements.map(statement=>statement.sql),bindings:statements.map(statement=>[...statement.bindings])};const real=await batch(statements);witness.real=real;
   // These are real successful D1 reads. Alter only the selected result entry, keeping the vector length and all other entries intact.
   let returned=real;
   if(fault==='sparse'){returned=real.slice();delete returned[index];}
   if(fault==='false-success'){returned=real.slice();returned[index]={...real[index],success:false};}
   if(fault==='missing-success'){returned=real.slice();const value={...real[index]};delete value.success;returned[index]=value;}
   witness.returned=returned;return returned;
  };
  const result=boundary==='capture'?await finalize():await f.request();
  assert.ok(witness?.real);assert.equal(witness.real.length,witness.sql.length);assert.equal(witness.real[witness.index].success,true);assert.equal(witness.real[witness.index].results[0].current,1);assert.equal(witness.real[witness.index].meta.changes,0);assert.equal(witness.returned.length,witness.real.length);
  if(boundary==='capture'){assert.equal(witness.index,2);assert.ok(witness.sql[0].startsWith('SELECT private_event_id,private_json,project_id,document_id'));}
  else{assert.ok(witness.metadataIndex>2);assert.ok(witness.sql[1].includes('FROM project_context_sessions'));assert.ok(witness.bindings[1].includes(f.contextId));assert.ok(witness.sql[2].includes('event_private_payloads'),'the first body proof is retained private evidence, not another authority or metadata entry');}
  if(fault==='normal'){
   assert.equal(witness.returned,witness.real);
   if(boundary==='capture'){assert.equal(result.finalized,true,JSON.stringify(result));assert.equal(gate.row().status,'completed');assert.equal(recoveryCompletions(f).length,1);}else{assert.equal(result.status,200,JSON.stringify(await result.clone().json()));assert.equal(recoveryCompletions(f).length,0);}
  }else{
   if(fault==='sparse')assert.equal(Object.hasOwn(witness.returned,witness.index),false);
   if(fault==='false-success')assert.equal(witness.returned[witness.index].success,false);
   if(fault==='missing-success')assert.equal(Object.hasOwn(witness.returned[witness.index],'success'),false);
   const expected=boundary==='disclosure-authority'?{error:'output_execution_authority_revoked',status:403}:boundary==='disclosure-body'?{error:'output_private_evidence_unavailable',status:410}:{error:'output_source_changed_during_read',status:409};
   assert.equal(result.status,expected.status,JSON.stringify({boundary,fault}));const body=boundary==='capture'?result:await result.json();assert.equal(body.error,expected.error);assert.equal(recoveryCompletions(f).length,0);assert.equal(gate.row().status,'failed');assert.deepEqual(finalizationSnapshot(f),before);assert.equal(mediaCounts().reads,media.reads,'failed capture or disclosure proof cannot perform media verification');
  }
  assert.deepEqual(recoveryFinancialState(f),financial);assert.deepEqual(recoveryCalls(f),calls);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);assert.equal(gate.row().job_id,slot.job_id);
 });
});
// Terminal wakeup retains the accepted ACK/native fixture and its real transport.
// FINAL's exact suffix supplies the local withImageFinalization fixture and oracles.
// The 0031 fixture binding awaits its owner-generated migration in this composition.
const {recoverServerImageTerminalJobs}=await import('../worker/document-jobs-api.ts');
const imageTerminalCursor=f=>{const row=f.sqlite.prepare("SELECT * FROM document_job_terminal_recovery_scan WHERE cursor_key='image-terminal-v1'").get();return row?{...row}:null;};
const imageTerminalWakeup=(h,options)=>imageRecoveryBounded(h.track(recoverServerImageTerminalJobs(h.f.env,options)),h.gate.release,'terminal server wakeup');
function assertImageTerminalAcknowledged(h,before){
 const row=h.gate.row(),checkpoint=JSON.parse(row.result_json),previous=JSON.parse(before.result_json),projectionKeys=new Set(['status','result_json','error_message','completed_at','lease_expires_at','updated_at']);
 assert.equal(row.status,'completed');assert.equal(row.error_message,null);assert.equal(row.lease_expires_at,null);assert.equal(checkpoint.stage,'completed');assert.equal(checkpoint.errorDetail,undefined);
 assert.deepEqual(Object.fromEntries(Object.entries(row).filter(([key])=>!projectionKeys.has(key))),Object.fromEntries(Object.entries(before).filter(([key])=>!projectionKeys.has(key))),'terminal wakeup preserves every original job identity, attempt, correlation and request field');
 assert.deepEqual(checkpoint.imageRecovery,previous.imageRecovery);assert.deepEqual(checkpoint.providerSubmissions,previous.providerSubmissions);
 const published=h.f.sqlite.prepare("SELECT event_id FROM events WHERE correlation_id=? AND type IN('GenerationCompleted','GenerationUsageRecorded') ORDER BY sequence").all(row.correlation_id).map(event=>event.event_id);
 assert.equal(published.length,2);assert.deepEqual(checkpoint.appendedEventIds,published);
 assert.equal(checkpoint.generationReceipt.artifact_kind,'image');assert.equal(checkpoint.generationReceipt.provider_request_status,'completed');assert.equal(checkpoint.generationReceipt.reservation_status,'settled');
 assert.equal(checkpoint.generationReceipt.actual_provider_call_count,wakeupSlotCalls(h.f,h.slot).length);assert.equal(checkpoint.generationReceipt.settled_cost_microusd,recoveryReservations(h.f,h.slot).cost.used_microusd);
 assert.equal(checkpoint.generationReceipt.failure_code,undefined);assert.equal(checkpoint.generationReceipt.failure_category,undefined);assert.equal(checkpoint.generationReceipt.failure_stage,undefined);
}
async function imageTerminalPublishedPair(h){
 const {f,slot,slots,gate,first,run,finish}=h,secondSlot=slots.find(candidate=>candidate.job_id!==slot.job_id);assert.ok(secondSlot);assert.equal(slots.length,2);
 const batch=f.DB.batch.bind(f.DB),published=new Map(),terminalFaults=new Map(),originalSecond=wakeupJob(f,secondSlot.job_id);assert.equal(originalSecond.status,'queued');assert.equal(originalSecond.attempt_count,0);
 const readPublication=(target,publication)=>({events:publication.eventIds.map(id=>({id,event:f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(id)??null,private:f.sqlite.prepare('SELECT * FROM event_private_payloads WHERE private_event_id=?').get(id)??null})),storage:{...f.sqlite.prepare('SELECT * FROM output_native_storage_writes WHERE scope_key=? AND slot_id=? AND storage_key=?').get(target.scope_key,target.slot_id,publication.storageKey)}});
 // This is the ACK failure gate above applied to the two already admitted targets.
 // Every completion/private witness and paid settlement comes from its original runner.
 f.DB.batch=async statements=>{
  for(const target of[slot,secondSlot]){
   const job=wakeupJob(f,target.job_id),eventIndices=statements.flatMap((statement,index)=>statement.sql.startsWith('INSERT INTO event_write_stage')&&statement.bindings[1]===job.stream_id&&statement.bindings[7]===job.correlation_id&&['GenerationCompleted','GenerationUsageRecorded'].includes(statement.bindings[11])?[index]:[]);
   if(eventIndices.length){
    assert.equal(published.has(target.job_id),false);assert.deepEqual(eventIndices.map(index=>statements[index].bindings[11]),['GenerationCompleted','GenerationUsageRecorded']);
    const custodyIndices=statements.flatMap((statement,index)=>statement.sql.startsWith('UPDATE output_native_storage_writes SET publication_event_id=(')&&statement.bindings[0]===target.scope_key&&statement.bindings[1]===target.slot_id&&statement.bindings[5]===target.scope_key&&statement.bindings[6]===target.slot_id?[index]:[]);assert.equal(custodyIndices.length,1);
    const custodyIndex=custodyIndices[0],publication={eventIds:eventIndices.map(index=>statements[index].bindings[0]),storageKey:statements[custodyIndex].bindings[7]},expectedPrivate=eventIndices.map(index=>statements[index].bindings[16]);
    const results=await batch(statements),observed={publication,state:readPublication(target,publication),expectedPrivate};
    assert.deepEqual(eventIndices.map(index=>Number(results[index].meta.changes)),[1,1]);assert.equal(Number(results[custodyIndex].meta.changes),1);published.set(target.job_id,observed);return results;
   }
  }
  const terminal=statements.find(statement=>statement.sql.startsWith('UPDATE document_jobs SET status=?,result_json=')&&statement.bindings[0]==='completed'&&[slot.job_id,secondSlot.job_id].includes(statement.bindings[7]));
  if(terminal&&!terminalFaults.has(terminal.bindings[7])){
   const job=wakeupJob(f,terminal.bindings[7]);assert.ok(published.has(job.job_id));assert.equal(terminal.bindings[8],job.owner_id);assert.equal(terminal.bindings[9],job.correlation_id);terminalFaults.set(job.job_id,job);throw new Error('image_terminal_wakeup_fixture_projection_write_lost');
  }
  return batch(statements);
 };
 try{
  gate.release();assert.equal((await first).status,200);await finish();assert.equal((await run(secondSlot.job_id)).status,200);await finish();
  assert.equal(published.size,2);assert.equal(terminalFaults.size,2);assert.equal(recoveryCompletions(f).length,2);
  for(const target of[slot,secondSlot]){
   const job=wakeupJob(f,target.job_id),observed=published.get(target.job_id);assert.equal(job.status,'failed');assert.equal(job.attempt_count,1);assert.equal(job.correlation_id,terminalFaults.get(target.job_id).correlation_id);
   assert.ok(observed.state.events.every(row=>row.event&&row.private));assert.deepEqual(readPublication(target,observed.publication),observed.state);
   assert.deepEqual(observed.state.events.map(row=>row.private.private_json),observed.expectedPrivate);assert.deepEqual(observed.state.events.map(row=>row.event.correlation_id),[job.correlation_id,job.correlation_id]);
   assert.equal(observed.state.storage.publication_event_id,observed.publication.eventIds[0]);assert.equal(observed.state.storage.slot_id,target.slot_id);assert.equal(observed.state.storage.storage_key,observed.publication.storageKey);
   assert.equal(recoveryReservations(f,target).token.status,'settled');assert.equal(recoveryReservations(f,target).cost.status,'settled');assert.ok(wakeupSlotCalls(f,target).every(call=>call.status==='settled'));
  }
  assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');assert.deepEqual(h.admission(),h.originalAdmission);
  return{...h,slot:secondSlot,gate:{...gate,row:()=>wakeupJob(f,secondSlot.job_id)}};
 }finally{f.DB.batch=batch;}
}

test('Image terminal wakeup: browser-absent published acknowledgment obeys zero, candidate and finalization budgets without new work',async context=>{
 const unavailable=new Proxy({},{get(){throw new Error('zero-budget terminal wakeup must not access any runtime port');}});
 for(const options of[{candidateLimit:0},{finalizationLimit:0}])assert.deepEqual(await recoverServerImageTerminalJobs(unavailable,options),{inspected:0,attempted:0});
 for(const variant of[
  {label:'personal finalization budget',shared:false,options:{candidateLimit:1_000,finalizationLimit:1}},
  {label:'selected shared context and invalid defaults',shared:true,options:{candidateLimit:NaN,finalizationLimit:Infinity}},
  {label:'personal candidate budget',shared:false,options:{candidateLimit:1,finalizationLimit:5}},
 ])await context.test(variant.label,async child=>{
  await withImageRecovery(child,{stage:'rendered',shared:variant.shared,twoTargets:true},async h=>{
   const second=await imageTerminalPublishedPair(h),before=imageAcknowledgmentState(h),paidCursor=h.f.sqlite.prepare('SELECT * FROM document_job_recovery_scan ORDER BY cursor_key').all().map(row=>({...row}));
   assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:0,finalizationLimit:1}),{inspected:0,attempted:0});assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:25,finalizationLimit:0}),{inspected:0,attempted:0});assertImageAcknowledgmentUnchanged(h,before);
   assert.deepEqual(await imageTerminalWakeup(h,variant.options),{inspected:1,attempted:1});assertImageTerminalAcknowledged(h,before.job);assertImageAcknowledgmentUnchanged(h,before,{job:false});
   const remaining=imageAcknowledgmentState(second);assert.equal(remaining.job.status,'failed');assert.equal(imageTerminalCursor(h.f).last_job_id,h.slot.job_id);
   assert.deepEqual(await imageTerminalWakeup(second,{candidateLimit:1,finalizationLimit:5}),{inspected:1,attempted:1});assertImageTerminalAcknowledged(second,remaining.job);assertImageAcknowledgmentUnchanged(second,remaining,{job:false});
   const completed=imageAcknowledgmentState(h),reads=h.mediaCounts().reads;assert.deepEqual(await imageTerminalWakeup(h),{inspected:0,attempted:0});assertImageAcknowledgmentUnchanged(h,completed);assert.equal(h.mediaCounts().reads,reads,'successful terminal projections are not inspected again');
   assert.deepEqual(h.f.sqlite.prepare('SELECT * FROM document_job_recovery_scan ORDER BY cursor_key').all().map(row=>({...row})),paidCursor,'terminal work does not borrow the paid-run cursor');
   assert.deepEqual(h.admission(),h.originalAdmission);assert.deepEqual(h.transport.counts(),{planner:2,image:2,moderation:2});
  });
 });
});

test('Image terminal wakeup: current original authority and terminal candidate shape remain mandatory',async context=>{
 for(const changed of['consent','revoked-session','expired-session','revoked-grant','expired-grant','source','job-expiry'])await context.test(changed,async child=>{
  await withImageRecovery(child,{stage:'rendered',shared:true},async h=>{
   await imageAcknowledgmentFailedProjection(h);const {f,slot}=h;
   assert.equal(h.gate.row().owner_id,originalActor(f,slot));assert.equal(f.sqlite.prepare('SELECT principal_user_id FROM project_context_sessions WHERE context_id=?').get(f.contextId).principal_user_id,originalActor(f,slot));
   if(changed==='consent')assert.equal(f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run('withdrawn-consent',originalActor(f,slot)).changes,1);
   if(changed==='revoked-session')assert.equal(f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId).changes,1);
   if(changed==='expired-session')assert.equal(f.sqlite.prepare('UPDATE project_context_sessions SET expires_at=? WHERE context_id=?').run('2000-01-01T00:00:00.000Z',f.contextId).changes,1);
   if(changed==='revoked-grant')assert.equal(f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked' WHERE grant_id=?").run(slot.grant_id).changes,1);
   if(changed==='expired-grant')assert.equal(f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=? WHERE grant_id=?').run('2000-01-01T00:00:00.000Z',slot.grant_id).changes,1);
   if(changed==='source')await appendAuditEvent(f.env,stream,'user','BlockPropertyEdited',{document_id:f.documentId,block_id:'recovery-source',property_path:'text',new_value:'The original source changed before terminal wakeup.'});
   if(changed==='job-expiry')assert.equal(f.sqlite.prepare('UPDATE document_jobs SET expires_at=? WHERE job_id=?').run('2000-01-01T00:00:00.000Z',slot.job_id).changes,1);
   const before=imageAcknowledgmentState(h);assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:1,finalizationLimit:1}),{inspected:1,attempted:changed==='consent'?0:1},'principal rejection precedes invocation; a genuine ACK denial consumes its invocation budget');assertImageAcknowledgmentUnchanged(h,before);assert.equal(imageTerminalCursor(f).last_job_id,slot.job_id);
  });
 });
 for(const changed of['stale-committing','live-committing','canceled','completed','missing-pointer','malformed-pointer'])await context.test(changed,async child=>{
  await withImageRecovery(child,{stage:'rendered'},async h=>{
   await imageAcknowledgmentFailedProjection(h);const {f,slot}=h;
   if(changed.endsWith('-committing'))assert.equal(f.sqlite.prepare("UPDATE document_jobs SET status='committing',lease_expires_at=? WHERE job_id=?").run(changed==='stale-committing'?'2000-01-01T00:00:00.000Z':new Date(Date.now()+60_000).toISOString(),slot.job_id).changes,1);
   if(changed==='canceled'||changed==='completed')assert.equal(f.sqlite.prepare('UPDATE document_jobs SET status=? WHERE job_id=?').run(changed,slot.job_id).changes,1);
   if(changed==='missing-pointer')assert.equal(f.sqlite.prepare("UPDATE document_jobs SET result_json=json_remove(result_json,'$.imageRecovery') WHERE job_id=?").run(slot.job_id).changes,1);
   if(changed==='malformed-pointer')assert.equal(f.sqlite.prepare("UPDATE document_jobs SET result_json=json_set(result_json,'$.imageRecovery','not-a-pointer') WHERE job_id=?").run(slot.job_id).changes,1);
   const before=imageAcknowledgmentState(h),reads=h.mediaCounts().reads;
   if(changed==='stale-committing'){assert.deepEqual(await imageTerminalWakeup(h),{inspected:1,attempted:1});assertImageTerminalAcknowledged(h,before.job);assertImageAcknowledgmentUnchanged(h,before,{job:false});}
   else{assert.deepEqual(await imageTerminalWakeup(h),{inspected:changed==='canceled'||changed==='completed'?0:1,attempted:0});assertImageAcknowledgmentUnchanged(h,before);assert.equal(h.mediaCounts().reads,reads);}
  });
 });
});

test('Image terminal wakeup: a retained-pointer hold advances before a later real acknowledgment and wraps once',async context=>{
 await withImageRecovery(context,{stage:'rendered',twoTargets:true},async h=>{
  const second=await imageTerminalPublishedPair(h),{f,slot}=h,pointer=JSON.parse(h.gate.row().result_json).imageRecovery;assert.equal(pointer.stage,'rendered');
  assert.equal(f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(pointer.contentId).changes,1);
  const before=imageAcknowledgmentState(h),paidCursor=f.sqlite.prepare('SELECT * FROM document_job_recovery_scan ORDER BY cursor_key').all().map(row=>({...row}));
  assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:1,finalizationLimit:1}),{inspected:1,attempted:1});assertImageAcknowledgmentUnchanged(h,before);
  const firstCursor={...imageTerminalCursor(f)};assert.equal(firstCursor.last_requested_at,before.job.requested_at);assert.equal(firstCursor.last_job_id,slot.job_id);assert.equal(second.gate.row().status,'failed');
  const next=imageAcknowledgmentState(second);assert.deepEqual(await imageTerminalWakeup(second,{candidateLimit:1,finalizationLimit:1}),{inspected:1,attempted:1});assertImageTerminalAcknowledged(second,next.job);assertImageAcknowledgmentUnchanged(second,next,{job:false});
  const secondCursor={...imageTerminalCursor(f)};assert.equal(secondCursor.last_requested_at,next.job.requested_at);assert.equal(secondCursor.last_job_id,second.slot.job_id);assert.equal(secondCursor.version,firstCursor.version+1);
  const settled=imageAcknowledgmentState(h);assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:1,finalizationLimit:1}),{inspected:1,attempted:1},'an empty suffix wraps once and rechecks the original held row');assertImageAcknowledgmentUnchanged(h,settled);
  const wrapped=imageTerminalCursor(f);assert.equal(wrapped.last_requested_at,before.job.requested_at);assert.equal(wrapped.last_job_id,slot.job_id);assert.equal(wrapped.version,secondCursor.version+2,'the empty wrap and candidate visit each consume their own cursor CAS');
  assert.deepEqual(f.sqlite.prepare('SELECT * FROM document_job_recovery_scan ORDER BY cursor_key').all().map(row=>({...row})),paidCursor);assert.deepEqual(h.admission(),h.originalAdmission);assert.deepEqual(h.transport.counts(),{planner:2,image:2,moderation:2});
 });
});

test('Image terminal wakeup: a genuine cursor CAS loser stops before acknowledgment or media inspection',async context=>{
 for(const variant of['candidate-advance','empty-wrap','changed-requested-tuple','changed-job-tuple'])await context.test(variant,async child=>{
  await withImageRecovery(child,{stage:'rendered'},async h=>{
   await imageAcknowledgmentFailedProjection(h);const {f,slot}=h;
   if(variant==='empty-wrap'){
    const pointer=JSON.parse(h.gate.row().result_json).imageRecovery;assert.equal(f.sqlite.prepare('DELETE FROM private_content WHERE content_id=?').run(pointer.contentId).changes,1);assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:1,finalizationLimit:1}),{inspected:1,attempted:1});
   }
   const before=imageAcknowledgmentState(h),reads=h.mediaCounts().reads,prepare=f.DB.prepare.bind(f.DB);let raced=false,cursorBefore,cursorAfter,winnerChanges,loserChanges;
   f.DB.prepare=sql=>{
    const statement=prepare(sql);if(!/^UPDATE\s+document_job_terminal_recovery_scan\b/u.test(sql))return statement;
    const bind=statement.bind.bind(statement);statement.bind=(...values)=>{
     const bound=bind(...values),run=bound.run.bind(bound);bound.run=async()=>{
      if(raced)return run();raced=true;cursorBefore={...imageTerminalCursor(f)};
      if(variant==='changed-requested-tuple'||variant==='changed-job-tuple'){
       // Change exactly one stored tuple component, preserving the version to
       // prove the production CAS checks both tuple values as well as version.
       const column=variant==='changed-requested-tuple'?'last_requested_at':'last_job_id',replacement=variant==='changed-requested-tuple'?'1999-01-01T00:00:00.000Z':'competing-terminal-cursor';
       winnerChanges=f.sqlite.prepare(`UPDATE document_job_terminal_recovery_scan SET ${column}=? WHERE cursor_key='image-terminal-v1' AND version=? AND last_requested_at=? AND last_job_id=?`).run(replacement,cursorBefore.version,cursorBefore.last_requested_at,cursorBefore.last_job_id).changes;assert.equal(winnerChanges,1);
      }else winnerChanges=Number((await run()).meta.changes);
      assert.equal(winnerChanges,1);cursorAfter={...imageTerminalCursor(f)};
      // The losing result comes from the same actual bound SQL, never a stub.
      const losing=await run();loserChanges=Number(losing.meta.changes);return losing;
     };return bound;
    };return statement;
   };
   try{
    assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:1,finalizationLimit:1}),{inspected:0,attempted:0});assert.equal(raced,true);assert.equal(loserChanges,0);assert.deepEqual(imageTerminalCursor(f),cursorAfter);
    if(variant==='candidate-advance'){assert.equal(cursorBefore.last_requested_at,'');assert.equal(cursorBefore.last_job_id,'');assert.equal(cursorAfter.last_requested_at,before.job.requested_at);assert.equal(cursorAfter.last_job_id,slot.job_id);assert.equal(cursorAfter.version,cursorBefore.version+1);}
    if(variant==='empty-wrap'){assert.equal(cursorBefore.last_job_id,slot.job_id);assert.equal(cursorAfter.last_requested_at,'');assert.equal(cursorAfter.last_job_id,'');assert.equal(cursorAfter.version,cursorBefore.version+1);}
    if(variant.startsWith('changed-'))assert.equal(cursorAfter.version,cursorBefore.version);
    assertImageAcknowledgmentUnchanged(h,before);assert.equal(h.mediaCounts().reads,reads,'a cursor loser cannot inspect retained media');
   }finally{f.DB.prepare=prepare;}
  });
 });
});

test('Image acknowledgment terminal boundaries: unknown commit results and oversized retained job bodies cannot report recovery',async context=>{
 for(const variant of['short-results','sparse-results','guard-unsuccessful','read-unsuccessful'])await context.test(variant,async child=>{
  await withImageRecovery(child,{stage:'rendered'},async h=>{
   await imageAcknowledgmentFailedProjection(h);const before=imageAcknowledgmentState(h),batch=h.f.DB.batch.bind(h.f.DB);let committed=null;
   h.f.DB.batch=async statements=>{
    const write=statements.findIndex(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='completed',result_json=?")&&statement.bindings[3]===h.slot.job_id);
    const results=await batch(statements);if(write<0||committed)return results;
    assert.equal(results.length,statements.length);assert.equal(results[write].success,true);assert.equal(Number(results[write].meta.changes),1);assert.equal(results.at(-1).results[0].status,'completed');
    committed=imageAcknowledgmentState(h);
    // The real batch has committed. Only its returned transport envelope changes;
    // a missing/unsuccessful result does not prove a rollback or authorize a retry.
    if(variant==='short-results')return results.slice(1);
    const returned=[...results];
    if(variant==='sparse-results')delete returned[0];
    if(variant==='guard-unsuccessful')returned[0]={...returned[0],success:false};
    if(variant==='read-unsuccessful')returned[returned.length-1]={...returned.at(-1),success:false};
    return returned;
   };
   try{
    const response=await imageAcknowledgmentRequest(h),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,'output_image_acknowledgment_commit_unconfirmed');assert.equal(body.recovered,undefined);assert.ok(committed);
    assertImageTerminalAcknowledged(h,before.job);assertImageAcknowledgmentUnchanged(h,before,{job:false});assertImageAcknowledgmentUnchanged(h,committed);
    const reads=h.mediaCounts().reads;assert.deepEqual(await imageTerminalWakeup(h),{inspected:0,attempted:0});assertImageAcknowledgmentUnchanged(h,committed);assert.equal(h.mediaCounts().reads,reads);
   }finally{h.f.DB.batch=batch;}
  });
 });
 for(const shared of[false,true])for(const column of['request_json','result_json'])await context.test(`${shared?'shared':'personal'} oversized ${column}`,async child=>{
  await withImageRecovery(child,{stage:'rendered',shared},async h=>{
   await imageAcknowledgmentFailedProjection(h);const {f,slot}=h,original=JSON.parse(h.gate.row()[column]);
   const oversized=JSON.stringify({...original,terminalWakeupOversized:'x'.repeat(2_000_000)});assert.ok(Buffer.byteLength(oversized)>2_000_000);assert.equal(f.sqlite.prepare(`UPDATE document_jobs SET ${column}=? WHERE job_id=?`).run(oversized,slot.job_id).changes,1);
   const before=imageAcknowledgmentState(h),reads=h.mediaCounts().reads,prepare=f.DB.prepare.bind(f.DB),batch=f.DB.batch.bind(f.DB),observed=[],materialized=[],candidateReads=[],boundedReads=[];let phase='terminal';
   const observe=(sql,rows)=>{
    if(!/\b(?:FROM|JOIN)\s+document_jobs\b/u.test(sql))return;
    observed.push(sql);
    for(const row of rows)if(row&&typeof row==='object')for(const field of['request_json','result_json'])if(typeof row[field]==='string'&&Buffer.byteLength(row[field])>2_000_000)materialized.push({sql,field,bytes:Buffer.byteLength(row[field])});
   };
   f.DB.prepare=sql=>{
    const statement=prepare(sql),bind=statement.bind.bind(statement);statement.bind=(...values)=>{
     const bound=bind(...values),first=bound.first.bind(bound),all=bound.all.bind(bound);
     bound.first=async(...args)=>{const row=await first(...args);observe(sql,[row]);if(phase==='terminal'&&/^SELECT\s+\*/u.test(sql)&&/\bFROM\s+document_jobs\b/u.test(sql))boundedReads.push({sql,row});return row;};
     bound.all=async(...args)=>{const result=await all(...args);observe(sql,result.results);if(phase==='terminal'&&sql.includes('ORDER BY job.requested_at ASC,job.job_id ASC LIMIT ?'))candidateReads.push({sql,bindings:[...values],rows:result.results.map(row=>({...row}))});return result;};return bound;
    };return statement;
   };
   f.DB.batch=async statements=>{const results=await batch(statements);statements.forEach((statement,index)=>observe(statement.sql,results[index]?.results??[]));return results;};
   try{
    assert.deepEqual(await imageTerminalWakeup(h,{candidateLimit:1_000,finalizationLimit:1_000}),{inspected:1,attempted:0});assertImageAcknowledgmentUnchanged(h,before);
    assert.equal(candidateReads.length,1);assert.equal(candidateReads[0].bindings.at(-1),100,'candidate admission applies its hard cap to the real SQL query');assert.equal(candidateReads[0].rows.length,1);assert.equal(candidateReads[0].rows[0].job_id,slot.job_id);
    assert.doesNotMatch(candidateReads[0].sql,/\b(?:request_json|result_json|json_extract|json_valid|json_type)\b/u,'candidate discovery uses only scalar job metadata');assert.equal(Object.hasOwn(candidateReads[0].rows[0],'request_json'),false);assert.equal(Object.hasOwn(candidateReads[0].rows[0],'result_json'),false);
    assert.equal(boundedReads.length,1,'one visited candidate receives one bounded full-row read after cursor advancement');assert.equal(boundedReads[0].row,null);assert.match(boundedReads[0].sql,/length\(CAST\(request_json AS BLOB\)\)<=2000000/u);assert.match(boundedReads[0].sql,/length\(CAST\(result_json AS BLOB\)\)<=2000000/u);
    phase='http';
    const response=await imageAcknowledgmentRequest(h),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,'output_image_acknowledgment_unavailable');assert.equal(body.recovered,undefined);
    assert.ok(observed.length>0,'the actual native DB ports observed the bounded row probes');assert.deepEqual(materialized,[],'neither HTTP scope/discriminator reads nor terminal selection return an oversized private job body');assert.equal(h.mediaCounts().reads,reads);assertImageAcknowledgmentUnchanged(h,before);
   }finally{f.DB.prepare=prepare;f.DB.batch=batch;}
  });
 });
});

test('Image terminal wakeup: real retained finalization publishes the original failed Image without another paid attempt',async context=>{
 // This local fixture and its oracles come from the separately owned FINAL tail;
 // do not replace them with a successful callback or import a second test module.
 await withImageFinalization(context,{state:'failed',shared:false},async parts=>{
  const {f,slot,gate,saved,transport,mediaCounts,track,release,finish,log}=parts,before=gate.row(),retained=retainedImageStage(f,saved.pointer),calls=recoveryCalls(f),financial=recoveryFinancialState(f),media=mediaCounts(),identities=wakeupIdentities(f);
  assert.equal(before.status,'failed');assert.equal(recoveryCompletions(f).length,0);assert.equal(recoveryReservations(f,slot).token.status,'settled');assert.equal(recoveryReservations(f,slot).cost.status,'settled');
  f.env.OPENAI_MODEL='unavailable-current-planner';f.env.OPENAI_IMAGE_MODEL='unavailable-current-image';
  assert.deepEqual(await imageRecoveryBounded(track(recoverServerImageTerminalJobs(f.env)),release,'terminal sweep retained finalizer'),{inspected:1,attempted:1});
  const completed=gate.row();assert.equal(completed.status,'completed');assert.equal(completed.job_id,before.job_id);assert.equal(completed.attempt_count,before.attempt_count);assert.equal(completed.correlation_id,before.correlation_id);assert.equal(completed.request_json,before.request_json);
  const events=recoveryCompletions(f);assert.equal(events.length,1);const all=await readWorkspaceEvents(f.env,stream),completion=all.find(event=>event.eventId===events[0].event_id),usage=all.filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===retained.envelope.stage.generationId);
  assert.ok(completion);assert.equal(completion.payload.generation_id,retained.envelope.stage.generationId);assert.equal(completion.correlationId,before.correlation_id);assert.equal(completion.causationId,retained.envelope.stage.compiledEventId);assert.equal(usage.length,1);assert.equal(usage[0].causationId,completion.eventId);assertFinalizedImageUsage(usage[0].payload,slot,retained.envelope.stage,Object.values(JSON.parse(before.result_json).providerSubmissions));
  const nativeSlot=f.sqlite.prepare('SELECT * FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id);assert.equal(nativeSlot.status,'succeeded');assert.equal(nativeSlot.outcome_event_id,completion.eventId);assert.equal(f.sqlite.prepare('SELECT publication_event_id FROM output_native_storage_writes WHERE slot_id=?').get(slot.slot_id).publication_event_id,completion.eventId);assert.equal(f.sqlite.prepare('SELECT status FROM output_execution_grants WHERE grant_id=?').get(slot.grant_id).status,'completed');
  assert.deepEqual(wakeupIdentities(f),identities);assert.deepEqual(recoveryCalls(f),calls);assert.deepEqual(recoveryFinancialState(f),financial);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
  release();await finish();assert.deepEqual(recoveryCompletions(f),events);assert.deepEqual((await readWorkspaceEvents(f.env,stream)).filter(event=>event.type==='GenerationUsageRecorded'&&event.payload.generation_id===retained.envelope.stage.generationId),usage);
  const settled=finalizationSnapshot(f),reads=mediaCounts().reads;assert.deepEqual(await imageRecoveryBounded(track(recoverServerImageTerminalJobs(f.env)),release,'completed terminal finalizer exclusion'),{inspected:0,attempted:0});assert.deepEqual(finalizationSnapshot(f),settled);assert.equal(mediaCounts().reads,reads);assert.equal(mediaCounts().puts,media.puts);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});

test('Image terminal wakeup: retained explicit stop markers and stop audits prevent acknowledgment',async context=>{
 for(const marker of['administrator-message','user-failure-code','canceled-category'])await context.test(`retained explicit stop marker: ${marker}`,async child=>{
  await withImageRecovery(child,{stage:'rendered'},async h=>{
   await imageAcknowledgmentFailedProjection(h);const {f,slot}=h,original=imageAcknowledgmentState(h),job=h.gate.row(),checkpoint=JSON.parse(job.result_json);let errorMessage=job.error_message;
   // As in FINAL's existing intent fixture, this is an explicit negative job-row
   // CAS on a genuinely published pair, not a claim that /cancel accepts failed work.
   if(marker==='administrator-message')errorMessage='force_failed_by_admin';
   if(marker==='user-failure-code')checkpoint.errorDetail={...checkpoint.errorDetail,code:'canceled_by_user'};
   if(marker==='canceled-category')checkpoint.errorDetail={...checkpoint.errorDetail,category:'canceled'};
   assert.equal(f.sqlite.prepare("UPDATE document_jobs SET error_message=?,result_json=? WHERE job_id=? AND status='failed' AND correlation_id=? AND result_json=?").run(errorMessage,JSON.stringify(checkpoint),slot.job_id,job.correlation_id,job.result_json).changes,1);assertImageAcknowledgmentUnchanged(h,original,{job:false});
   const stopped=imageAcknowledgmentState(h),reads=h.mediaCounts().reads;assert.deepEqual(await imageTerminalWakeup(h),{inspected:1,attempted:0},'a retained explicit stop is visited without invoking acknowledgment or finalization');assertImageAcknowledgmentUnchanged(h,stopped);assert.equal(imageTerminalCursor(f).last_job_id,slot.job_id);
   const response=await imageAcknowledgmentRequest(h),body=await response.json();assert.equal(response.status,409,JSON.stringify(body));assert.equal(body.error,'output_image_acknowledgment_unavailable');assert.equal(body.recovered,undefined);assertImageAcknowledgmentUnchanged(h,stopped);assert.equal(h.mediaCounts().reads,reads);
  });
 });
 for(const auditType of['JobCanceled','JobForceFailed'])for(const boundary of['before-proof','before-final-CAS'])await context.test(`stop audit ${boundary}: ${auditType}`,async child=>{
  await withImageRecovery(child,{stage:'rendered'},async h=>{
   await imageAcknowledgmentFailedProjection(h);const {f,slot}=h,job=h.gate.row(),account=await requireUser(new Request('http://localhost/api/session',{headers:f.headers}),f.env);assert.ok(account.user);assert.equal(account.user.userId,originalActor(f,slot));
   // Use the actual stop-audit writer, actor, payload fields and original attempt.
   // The retained failed projection is unchanged while an original stop audit arrives.
   const appendStop=()=>appendAuditEvent(f.env,job.stream_id,'worker:scheduler',auditType,{job_id:job.job_id,document_id:job.document_id,kind:job.kind,previous_status:h.saved.job.status,requested_by:account.user.userId,requested_by_role:account.user.role,released_reservation_count:0},job.correlation_id);
   const media=h.mediaCounts(),batch=f.DB.batch.bind(f.DB);let stopped=null,deniedFinalBatch=false;
   if(boundary==='before-proof'){await appendStop();stopped=imageAcknowledgmentState(h);}
   else f.DB.batch=async statements=>{
    const terminal=statements.find(statement=>statement.sql.startsWith("UPDATE document_jobs SET status='completed',result_json=?")&&statement.bindings[3]===slot.job_id);
    if(!terminal||stopped)return batch(statements);
    assert.ok(h.mediaCounts().reads>media.reads,'the late audit follows the real retained-media proof');await appendStop();stopped=imageAcknowledgmentState(h);
    try{return await batch(statements);}catch(error){deniedFinalBatch=true;assert.match(String(error),/CHECK constraint failed/u);throw error;}
   };
   try{
    const response=await imageAcknowledgmentRequest(h),body=await response.json();assert.ok(stopped);
    assert.equal(response.status,boundary==='before-proof'?409:403,JSON.stringify(body));assert.equal(body.error,boundary==='before-proof'?'output_source_changed_during_read':'output_execution_authority_revoked');assert.equal(body.recovered,undefined);assert.equal(deniedFinalBatch,boundary==='before-final-CAS');assertImageAcknowledgmentUnchanged(h,stopped);assert.equal(h.gate.row().status,'failed');
    assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events WHERE stream_id=? AND type=? AND correlation_id=? AND json_extract(payload,\'$.job_id\')=?').get(job.stream_id,auditType,job.correlation_id,job.job_id).n,1);assert.equal(recoveryCompletions(f).length,1);
    const reads=h.mediaCounts().reads;if(boundary==='before-proof')assert.equal(reads,media.reads);
    assert.deepEqual(await imageTerminalWakeup(h),{inspected:1,attempted:1},'the genuine retained stop audit denies the next ACK proof without dispatching a paid retry');assertImageAcknowledgmentUnchanged(h,stopped);assert.equal(h.mediaCounts().reads,reads);assert.equal(h.mediaCounts().puts,media.puts);
   }finally{f.DB.batch=batch;}
  });
 });
});

test('Image retained finalization: a shared HTTP request preserves its selected context across the finalizer await',async context=>{
 await withImageFinalization(context,{shared:true,state:'failed'},async parts=>{
  const {f,slot,gate,transport,mediaCounts,finalize,log}=parts,originalSession={...f.sqlite.prepare('SELECT * FROM project_context_sessions WHERE context_id=?').get(f.contextId)},path=[f.organizationId,'projects',f.projectAccessId,'context'];
  assert.equal(originalSession.principal_user_id,originalActor(f,slot));assert.equal(originalSession.revoked_at,null);assert.ok(Date.parse(originalSession.expires_at)>Date.now());
  const before=imageAcknowledgmentState(parts),media=mediaCounts(),prepare=f.DB.prepare.bind(f.DB);assert.equal(before.job.status,'failed');assert.equal(recoveryCompletions(f).length,0);assert.equal(before.grants.find(grant=>grant.grant_id===slot.grant_id).context_id,f.contextId);
  let boundedReads=0,switched=null;
  f.DB.prepare=sql=>{
   const statement=prepare(sql);if(!sql.startsWith('SELECT *, (SELECT slot.slot_id FROM output_operation_slots slot WHERE slot.job_id=document_jobs.job_id) AS output_slot_id'))return statement;
   const bind=statement.bind.bind(statement);statement.bind=(...values)=>{
    const bound=bind(...values),first=bound.first.bind(bound);bound.first=async(...args)=>{
     const row=await first(...args);if(values[0]!==slot.job_id)return row;boundedReads++;assert.ok(row);assert.equal(row.job_id,slot.job_id);
     if(sql.includes("length(CAST(COALESCE(result_json,'') AS BLOB))<=2000000")){
      assert.equal(boundedReads,2,'the actual finalizer read follows the HTTP Image read and its original-context gate');assert.equal(switched,null);
      assert.deepEqual({...f.sqlite.prepare('SELECT * FROM project_context_sessions WHERE context_id=?').get(f.contextId)},originalSession,'the original selected session is still live at the finalizer read');
      const opened=await handleWorkspaces(new Request(`http://localhost/api/workspaces/${path.join('/')}`,{method:'POST'}),f.env,path);assert.equal(opened.status,200,JSON.stringify(await opened.clone().json()));
      const secondCookie=opened.headers.get('set-cookie').split(';')[0],secondContextId=decodeURIComponent(secondCookie.split('=').slice(1).join('='));assert.notEqual(secondContextId,f.contextId);
      const secondSession={...f.sqlite.prepare('SELECT * FROM project_context_sessions WHERE context_id=?').get(secondContextId)};assert.equal(secondSession.principal_user_id,originalSession.principal_user_id);assert.equal(secondSession.organization_id,f.organizationId);assert.equal(secondSession.project_access_id,f.projectAccessId);assert.equal(secondSession.revoked_at,null);assert.ok(Date.parse(secondSession.expires_at)>Date.now());const revoked={...f.sqlite.prepare('SELECT * FROM project_context_sessions WHERE context_id=?').get(f.contextId)};assert.equal(typeof revoked.revoked_at,'string');assert.ok(Number.isFinite(Date.parse(revoked.revoked_at)));assert.deepEqual({...revoked,revoked_at:null},originalSession);
      const issued=imageAcknowledgmentState(parts),expectedSessions=[...before.selectedSessions.map(session=>session.context_id===f.contextId?revoked:session),secondSession].sort((a,b)=>a.context_id.localeCompare(b.context_id));
      assert.deepEqual(issued,{...before,selectedSessions:expectedSessions},'genuine session issuance revokes the original session and creates its live successor without changing job, publication or finance');
      assert.equal(f.sqlite.prepare('UPDATE output_execution_grants SET context_id=? WHERE grant_id=? AND context_id=?').run(secondContextId,slot.grant_id,f.contextId).changes,1);switched=imageAcknowledgmentState(parts);
      assert.deepEqual(switched,{...issued,grants:issued.grants.map(grant=>grant.grant_id===slot.grant_id?{...grant,context_id:secondContextId}:grant)},'after genuine session issuance the race changes only the existing grant context binding');
     }
     return row;
    };return bound;
   };return statement;
  };
  try{
   const response=await finalize('recover'),body=await response.json();assert.equal(response.status,403,JSON.stringify(body));assert.equal(body.error,'output_execution_context_changed');assert.equal(body.finalized,undefined);assert.equal(body.recovered,undefined);assert.ok(switched);assert.equal(boundedReads,2);
   assertImageAcknowledgmentUnchanged(parts,switched);assert.equal(gate.row().status,'failed');assert.equal(recoveryCompletions(f).length,0);assert.deepEqual(mediaCounts(),media);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
  }finally{f.DB.prepare=prepare;}
 });
});


test('Image recovery behavioral: shared projection removes invalid retained-stage attribution without restoring private evidence',async context=>{
 for(const fault of['unbound','wrongpointer','expired','cancelled','redacted','malformed-json','unrelated-provider-output','mismatched-envelope'])await withImageFinalization(context,{shared:true},async parts=>{
  const {f,slot,gate,saved,transport,mediaCounts,log}=parts,job=gate.row(),checkpoint=JSON.parse(job.result_json),contentId=checkpoint.imageRecovery.contentId;
  assert.equal(job.status,'failed');assert.equal(contentId,saved.pointer.contentId);assert.equal(originalActor(f,slot),job.owner_id);
  const content={...f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(contentId)},scope={...f.sqlite.prepare("SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind='content' AND resource_id=?").get(f.projectAccessId,contentId)},retention={...f.sqlite.prepare('SELECT * FROM private_content_retention_scopes WHERE content_id=?').get(contentId)};
  assert.equal(content.content_id,contentId);assert.equal(content.owner_id,job.owner_id);assert.equal(content.redacted_at,null);assert.ok(content.content.length>0);assert.equal(scope.resource_id,contentId);assert.equal(scope.actor_user_id,job.owner_id);assert.equal(scope.visibility,'actor_private');assert.equal(retention.content_id,contentId);
  // These are explicit negative-fixture changes to the original job/private row;
  // no project capability, provider call, completion or replacement body is inserted.
  if(fault==='expired')assert.equal(f.sqlite.prepare('UPDATE private_content SET expires_at=? WHERE content_id=? AND owner_id=? AND content=? AND expires_at=? AND redacted_at IS NULL').run('2000-01-01T00:00:00.000Z',contentId,content.owner_id,content.content,content.expires_at).changes,1);
  else if(fault==='redacted')assert.equal(f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=? AND owner_id=? AND content=? AND expires_at=? AND redacted_at IS NULL").run(new Date().toISOString(),contentId,content.owner_id,content.content,content.expires_at).changes,1);
  else if(fault==='unrelated-provider-output'||fault==='mismatched-envelope'){
   const envelope=JSON.parse(content.content);assert.equal(envelope.identity.jobId,job.job_id);let changedContent;
   if(fault==='unrelated-provider-output'){changedContent=envelope.stage.planned.raw;assert.equal(typeof changedContent,'string');assert.ok(changedContent.length>0);assert.notEqual(changedContent,content.content);}
   else{
    // Keep the actual changed body's digest consistent, so the negative is its
    // mismatched original-job identity, not a fabricated successful proof result.
    const changed={...envelope,identity:{...envelope.identity,jobId:job.job_id+':projection-mismatch'}},digest=await recoverySha256(changed);changedContent=JSON.stringify(changed);
    const changedResult=JSON.stringify({...checkpoint,imageRecovery:{...checkpoint.imageRecovery,contentSha256:digest}});
    assert.equal(f.sqlite.prepare('UPDATE document_jobs SET result_json=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND attempt_count=? AND result_json=?').run(changedResult,job.job_id,job.owner_id,job.correlation_id,job.attempt_count,job.result_json).changes,1);
   }
   assert.equal(f.sqlite.prepare('UPDATE private_content SET content=? WHERE content_id=? AND owner_id=? AND content=? AND expires_at=? AND redacted_at IS NULL').run(changedContent,contentId,content.owner_id,content.content,content.expires_at).changes,1);
  }
  else{
   const changed={...checkpoint};let status=job.status,error=job.error_message,result;
   if(fault==='unbound')delete changed.imageRecovery;
   if(fault==='wrongpointer'){const missingId=contentId+':projection-missing';assert.equal(f.sqlite.prepare('SELECT 1 FROM private_content WHERE content_id=?').get(missingId),undefined);changed.imageRecovery={...checkpoint.imageRecovery,contentId:missingId};}
   if(fault==='cancelled'){status='canceled';error='canceled_by_user';changed.errorDetail={...checkpoint.errorDetail,code:error};}
   result=fault==='malformed-json'?'{':JSON.stringify(changed);
   assert.equal(f.sqlite.prepare('UPDATE document_jobs SET status=?,error_message=?,result_json=? WHERE job_id=? AND owner_id=? AND correlation_id=? AND attempt_count=? AND status=? AND request_json IS ? AND result_json IS ?').run(status,error,result,job.job_id,job.owner_id,job.correlation_id,job.attempt_count,job.status,job.request_json,job.result_json).changes,1);
  }
  const faulted={...f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(contentId)},opened=await appendAuditEvent(f.env,stream,'user','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'});
  const preservedState=()=>{
   const state=finalizationSnapshot(f);for(const key of['projectEvents','projectResources','projectMigration'])delete state[key];
   return{...state,privateContent:state.privateContent.filter(row=>row.content_id!==contentId),ownerHead:f.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(job.stream_id).head,
    media:[...f.media].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({key,bytes:Buffer.from(value.bytes),metadata:structuredClone(value.metadata),contentType:value.contentType})),mediaCounts:mediaCounts(),providerCounts:transport.counts(),providerRequests:transport.sent.length};
  };
  const before=preservedState(),response=await handleEvents(new Request('http://localhost/api/events',{method:'GET',headers:f.headers}),f.env);assert.equal(response.status,200,JSON.stringify({fault,body:await response.clone().json()}));
  assert.deepEqual(preservedState(),before,fault+': projection preserves all other original evidence and paid/media state');
  assert.equal(f.sqlite.prepare('SELECT * FROM project_resource_scopes WHERE project_access_id=? AND resource_kind=? AND resource_id=?').get(scope.project_access_id,scope.resource_kind,scope.resource_id),undefined,fault+': invalid current stage is not a project capability');
  const after=f.sqlite.prepare('SELECT * FROM private_content WHERE content_id=?').get(contentId);
  if(after){
   assert.deepEqual({...after,content:faulted.content,redacted_at:faulted.redacted_at,expires_at:faulted.expires_at},faulted,fault+': cleanup cannot rewrite private identity');assert.ok(Date.parse(after.expires_at)<=Date.parse(faulted.expires_at),fault+': cleanup cannot extend retention');
   if(faulted.redacted_at!==null){assert.notEqual(after.redacted_at,null);assert.equal(after.content,'');}
   else if(after.redacted_at!==null)assert.equal(after.content,'');else assert.equal(after.content,faulted.content);
  }
  const retainedPolicy=f.sqlite.prepare('SELECT * FROM private_content_retention_scopes WHERE content_id=?').get(contentId);if(retainedPolicy)assert.deepEqual({...retainedPolicy},retention,fault+': a surviving policy record is not rewritten');
  const source={...f.sqlite.prepare('SELECT * FROM events WHERE event_id=?').get(opened.eventId)};assert.equal(source.event_id,opened.eventId);assert.equal(source.type,'DocumentOpened');assert.equal(source.stream_id,job.stream_id);assert.equal(recoveryCompletions(f).length,0);assertFinalizationTransport(transport);assertNoFinalizationPurchase(log);
 });
});
