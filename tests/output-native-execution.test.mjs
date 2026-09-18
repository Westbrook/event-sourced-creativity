import assert from 'node:assert/strict';
import test from 'node:test';
import {deflateSync} from 'node:zlib';
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

test('Sunburst default and explicit model quote the versioned high-quality allowance and dispatch one exact text-only image',async context=>{
 for(const model of [undefined,'gpt-image-2.5-sunburst']){
  const transmissions=[];context.mock.method(globalThis,'fetch',async(url,request)=>{
   const path=String(url),body=JSON.parse(request.body);transmissions.push({path,body});
   if(path.endsWith('/responses'))return Response.json({id:'sunburst-direction',model:'gpt-5.6-terra',output_text:JSON.stringify({title:'Orchard',rationale:'Evening light',scene:'An orchard at sunset',palette:['green','gold'],next_moves:['Review']}),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
   if(path.endsWith('/moderations'))return Response.json({results:[{flagged:false,categories:{}}]});
   const [width,height]=body.size.split('x').map(Number);
   return Response.json({created:1,data:[{b64_json:png(width,height).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}});
  });
  const f=await fixture([{block_id:'source-sunburst-price',type:'message',properties:{text:'An orchard at sunset.'}}]);
  try{
   if(model===undefined)delete f.env.OPENAI_IMAGE_MODEL;else f.env.OPENAI_IMAGE_MODEL=model;
   const plan=await saveImages(f),targetIds=[plan.targetIds[0]];
   const preflight=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds}));
   const target=preflight.command.preflight.targets[0];assert.equal(target.available,true);assert.equal(target.model,'gpt-image-2.5-sunburst');
   const budget=target.settings.imageBudget;assert.equal(budget.version,'gpt-image-2.5-sunburst-doc-calculator-2026-09-18');assert.equal(budget.maximumReferenceImages,0);assert.equal(budget.quality,'high');
   assert.equal(target.settings.calls[1].maximumMicrousd,Math.max(900000,budget.maximumMicrousd),'existing admission floor is unchanged');
   assert.equal(transmissions.length,0);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
   const auth=await authorize(f,plan.planId,targetIds);assert.equal(transmissions.length,0);
   await f.ok(await f.startAndDrive({action:'run',grantId:auth.grantId}));
   assert.deepEqual(transmissions.map(t=>t.path),['https://api.openai.com/v1/responses','https://api.openai.com/v1/moderations','https://api.openai.com/v1/images/generations']);
   const wire=transmissions[2].body;assert.equal(wire.model,'gpt-image-2.5-sunburst');assert.equal(wire.quality,'high');assert.equal(wire.n,1);assert.equal(wire.size,target.settings.imageRender.size);assert.equal(wire.partial_images,undefined);assert.equal(wire.stream,undefined);assert.equal(wire.image,undefined);
   assert.deepEqual(transmissions[1].body.input,[{type:'text',text:wire.prompt}]);
   assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed');
  }finally{f.sqlite.close();context.mock.restoreAll();}
 }
});

test('Sunburst reference-pixel preflight remains unavailable without dispatch or job creation',async context=>{
 const calls=[];context.mock.method(globalThis,'fetch',async(...args)=>{calls.push(args);throw Error('No provider call expected');});
 const f=await fixture([{block_id:'reference-sunburst',type:'reference',properties:{text:'Keep this subject',pixel_reference_mode:'preserve_subject',reference_id:'required-reference'}}]);context.after(()=>f.sqlite.close());delete f.env.OPENAI_IMAGE_MODEL;
 await appendAuditEvent(f.env,stream,'user','RightsAsserted',{document_id:f.documentId,reference_id:'required-reference',rights_class:'owned'});
 const plan=await saveImages(f),preflight=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:plan.targetIds}));
 assert.ok(preflight.command.preflight.targets.every(t=>!t.available&&t.reasonCode==='output_native_reference_input_unpriced'));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);assert.deepEqual(calls,[]);
});
