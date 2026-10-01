import assert from 'node:assert/strict';
import test from 'node:test';
import {deflateSync} from 'node:zlib';
import {outputTestDatabase,registerOutputSourceImports} from './output-execution-test-helpers.mjs';
import {snapshot,outputFor,flexible} from './output-presentation-fixtures.mjs';
registerOutputSourceImports();
const [
 {handleSession,POLICY_VERSION,reconcileFailedBudgetReservations,requireUser},
 {handleEvents}, {handleDocumentJobs}, {handleWorkspaces}, ,
 , {handleOutputRequirements},
 {outputDocumentExecutionBridge},
 {appendAuditEvent,streamHead,makeEvent,eventWriteBindings,EVENT_WRITE_COLUMNS}, {parseOutputRequirement}, {inspectOutputAsset},
]=await Promise.all([
 import('../worker/pilot-policy.ts'),import('../worker/events-api.ts'),import('../worker/document-jobs-api.ts'),
 import('../worker/workspaces-api.ts'),import('../worker/output-image-budget.ts'),import('../worker/output-private-execution.ts'),
 import('../worker/output-requirements-api.ts'),import('../worker/output-document-execution.ts'),import('../worker/runtime.ts'),
 import('../src/model/output-requirements.ts'),import('../src/model/output-asset-inspection.ts'),
]);

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
 for(const [index,fact]of facts.entries())await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:documentId,project_id:'project-atmosphere',block_id:fact.block_id,type:fact.type,handle:fact.block_id,position:String(index).padStart(3,'0'),properties:{...fact.properties,weight:1,...(fact.intent?{intent:fact.intent}:{})}});
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
 return {...f,documentId,request,send,ok,headers,organizationId,projectAccessId,contextId};
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


function meter(f) {
 const metrics={d1:0,r2:0,provider:0,queries:new Map()};
 const db=f.env.DB;
 const note=sql=>{metrics.d1++;const clean=sql.replace(/\s+/g,' ').slice(0,110);metrics.queries.set(clean,(metrics.queries.get(clean)??0)+1);};
 const wrapped=new WeakMap();
 const statement=(raw,sql)=>{const proxy=new Proxy(raw,{get(target,key){if(key==='bind')return(...args)=>statement(target.bind(...args),sql);if(['first','all','run','raw'].includes(key))return(...args)=>{note(sql);return target[key](...args);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});wrapped.set(proxy,raw);return proxy;};
 f.env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>statement(target.prepare(sql),sql);if(key==='batch')return inputs=>{note('BATCH '+inputs.filter(x=>!/output_atomic_assertions/.test(x.sql??'')).map(x=>x.sql?.replace(/\s+/g,' ').slice(0,65)).join('|'));return target.batch(inputs.map(x=>wrapped.get(x)??x));};return Reflect.get(target,key,target);}});
 const media=f.env.MEDIA;
 f.env.MEDIA=new Proxy(media,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;return(...args)=>{metrics.r2++;return value.apply(target,args);};}});
 const reset=()=>{metrics.d1=0;metrics.r2=0;metrics.provider=0;metrics.queries.clear();};
 const profile=async(label,action)=>{reset();const result=await action();console.log(JSON.stringify({label,d1:metrics.d1,r2:metrics.r2,provider:metrics.provider,topD1:[...metrics.queries].sort((a,b)=>b[1]-a[1])}));return result;};
 return{metrics,profile};
}
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



const {extractSourceDocument,sourceDocumentEvidence,sourceDocumentEvidenceDigest}=await import('../src/model/source-documents.ts');
const {ownerMediaNamespace}=await import('../src/model/media-ownership.ts');
const flushExecution=async()=>{for(let i=0;i<100;i++)await new Promise(resolve=>setImmediate(resolve));};
const direction={title:'Pear orchard',rationale:'Protect roots',scene:'Pear trees beside a sheltered orchard path',palette:['green'],next_moves:['Review tree spacing']};
async function addTextSource(f,{index=0,objectIndex=index,weight=0,pixels=false}={}){
 const owner='dev-local-creative',mimeType='text/plain',bytes=new TextEncoder().encode('Retain the established community stewardship source.');
 const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
 const extracted=await extractSourceDocument(new File([bytes],'source.txt',{type:mimeType}));
 const evidenceHash=await sourceDocumentEvidenceDigest(sourceDocumentEvidence(extracted,hash,mimeType));
 const key=`${ownerMediaNamespace(owner)}/source-budget-${objectIndex}.txt`;
 f.media.set(key,{bytes,contentType:mimeType,metadata:{ownerId:owner,sha256:hash,mimeType,sourceEvidenceSha256:evidenceHash}});
 await appendAuditEvent(f.env,stream,'user','BlockCreated',{document_id:f.documentId,project_id:'project-atmosphere',block_id:`budget-reference-${index}`,scope:'document',type:'reference',position:`r${index}`,properties:{weight,reference_id:`owned-source-${index}`,media_url:`/api/media/${encodeURIComponent(key)}`,pixel_reference_mode:pixels?'inspiration':'context_only',source_evidence_hash:evidenceHash,source_content_hash:hash,source_mime_type:mimeType,source_kind:extracted.sourceKind,extraction_status:extracted.status,text:extracted.text,source_citations:extracted.segments.map(segment=>({anchor:segment.anchor,excerpt:segment.text})),source_segment_count:extracted.segments.length,source_excerpt_truncated:extracted.truncated}});
 await appendAuditEvent(f.env,stream,'user','RightsAsserted',{document_id:f.documentId,project_id:'project-atmosphere',reference_id:`owned-source-${index}`,rights_class:'owned'});
 if(f.projectAccessId)assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:f.headers}),f.env)).status,200);
 return key;
}
function deckWithActiveReference(request){
 const draft=outputFor(),input=JSON.parse(JSON.parse(request.body).input);
 const passage=input.presentation_source.passages.find(p=>p.content.includes('Retain the established community stewardship source.'));
 assert.ok(passage?.sourceAlias,'the real provider input includes the active verified text reference');
 const item=structuredClone(draft.items[0]);item.title='Retained source';item.body='Retain the established community stewardship source.';item.slide.layout='closing';item.slide.source_order=10;item.slide.source_ids=[passage.sourceAlias];item.slide.citations=[{source_id:passage.sourceAlias,label:'Retained source',anchor:'Text source',excerpt:item.body}];item.slide.visual.value='Established community stewardship';
 draft.items.at(-1).slide.layout='statement';draft.items.push(item);draft.content_markdown+=`\n\n## ${item.title}\n${item.body}`;return draft;
}
function assertBudget(m,label){const total=m.metrics.d1+m.metrics.r2+m.metrics.provider;assert.ok(total<50,`${label}: ${m.metrics.d1}D1 +${m.metrics.r2}R2 +${m.metrics.provider}network =${total}, must remain below50 for this whole HTTP request`);}

for(const variant of[
 {kind:'slides',shared:false,repair:false,failure:null},
 {kind:'slides',shared:true,repair:true,failure:null},
 {kind:'slides',shared:true,repair:true,failure:null,activeSource:true},
 {kind:'slides',shared:true,repair:true,failure:'invalid'},
 {kind:'image',shared:false,repair:false,failure:null},
 {kind:'image',shared:true,repair:false,failure:null},
 {kind:'image',shared:true,repair:false,failure:null,activeSource:true},
 {kind:'image',shared:true,repair:false,failure:'unknown'},
 {kind:'image',shared:true,repair:false,failure:'moderation'},
])test(`whole HTTP with one source HEAD and three renewals: ${JSON.stringify(variant)}`,async t=>{
 const f=await fixture(variant.kind==='image'?[{block_id:'orchard',type:'message',properties:{text:'Protect the mature pear trees beside a sheltered orchard path.'}}]:undefined,{shared:variant.shared});
 t.after(()=>f.sqlite.close());await addTextSource(f,{weight:variant.activeSource?1:0});
 const plan=variant.kind==='image'?await saveImages(f):await saveDeck(f);
 const auth=await authorize(f,plan.planId,[variant.kind==='image'?plan.targetIds[0]:plan.targetId]);
 assert.deepEqual(auth.terms.targets[0].settings.executionPolicy,{maximumMilliseconds:240000,heartbeatMilliseconds:60000,maximumRenewals:3});
 await f.ok(await f.send({action:'run',grantId:auth.grantId}));
 const job=f.sqlite.prepare('SELECT job_id FROM document_jobs').get();const m=meter(f);
 const entered=Promise.withResolvers(),release=Promise.withResolvers();let plannerCalls=0,safetyCalls=0,imageCalls=0,monotonic=0;
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});t.mock.method(performance,'now',()=>monotonic);
 t.mock.method(globalThis,'fetch',async(url,request)=>{
  m.metrics.provider++;
  if(String(url).endsWith('/responses')){
   plannerCalls++;
   if(variant.kind==='slides'&&(variant.repair?plannerCalls===2:plannerCalls===1)||variant.kind==='image'&&variant.failure==='moderation'){entered.resolve();await release.promise;}
   return Response.json({id:`timed-planner-${plannerCalls}`,model:'gpt-5.6-terra',output_text:JSON.stringify(variant.kind==='image'?direction:variant.failure==='invalid'||variant.repair&&plannerCalls===1?{...outputFor(),items:[]}:variant.activeSource?deckWithActiveReference(request):outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  }
  if(String(url).endsWith('/moderations')){safetyCalls++;return Response.json({id:'timed-safety',results:[{flagged:variant.failure==='moderation',categories:{violence:variant.failure==='moderation'}}]});}
  assert.equal(String(url),'https://api.openai.com/v1/images/generations');imageCalls++;entered.resolve();await release.promise;
  if(variant.failure==='unknown')throw new Error('Acceptance may have occurred before connection loss');
  const[w,h]=JSON.parse(request.body).size.split('x').map(Number);
  return Response.json({data:[{b64_json:png(w,h).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}},{headers:{'x-request-id':'timed-image'}});
 });
 let execution;
 try{
  execution=m.profile('timed-'+JSON.stringify(variant),()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${job.job_id}/run`,{method:'POST',headers:f.headers}),f.env,`${job.job_id}/run`));
  await entered.promise;
  const lease=f.sqlite.prepare('SELECT lease_expires_at FROM document_jobs').get().lease_expires_at;
  for(let i=0;i<3;i++){monotonic+=60000;t.mock.timers.tick(60000);await flushExecution();assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'running');assert.equal(f.sqlite.prepare('SELECT lease_expires_at FROM document_jobs').get().lease_expires_at,lease,'a heartbeat cannot extend the accepted whole-attempt deadline');}
  release.resolve();const result=await execution;assert.equal(result.status,200,await result.clone().text());
  assertBudget(m,'three renewals, source, complete operation');
  assert.equal(safetyCalls,variant.kind==='image'?1:0,'native images add one safety request; Slides and their bounded repair add none');
  assert.equal(imageCalls,variant.kind==='image'&&variant.failure!=='moderation'?1:0,'a flagged safety check prevents image submission');
  assert.equal(m.metrics.provider,plannerCalls+safetyCalls+imageCalls,'the whole-request meter includes safety traffic');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls').get().n,plannerCalls+imageCalls,'the paid ledger counts generation calls, not automatic safety checks');
  const row=f.sqlite.prepare('SELECT status,error_message FROM document_jobs').get();assert.equal(row.status,variant.failure?'failed':'completed',JSON.stringify(row));
  assert.equal(m.metrics.r2,variant.kind==='image'&&!variant.failure?2:1,'one exact source HEAD plus a successful native image PUT only');
  const renewals=[...m.metrics.queries].filter(([q])=>q.includes('UPDATE document_jobs SET lease_expires_at')).reduce((sum,[,n])=>sum+n,0);assert.equal(renewals,3);
 }finally{release.resolve();t.mock.timers.reset();if(execution)await execution.catch(()=>{});await flushExecution();}
});

test('native source capacity preserves zero/one object, deduplicates references, and rejects two before any lookup or provider',async t=>{
 const f=await fixture();t.after(()=>f.sqlite.close());t.mock.method(globalThis,'fetch',()=>{throw new Error('Preflight never sends');});
 await addTextSource(f,{index:0,objectIndex:0});await addTextSource(f,{index:1,objectIndex:0});
 const plan=await saveDeck(f);const m=meter(f);
 const one=await m.profile('two-reference-claims-one-object',()=>f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId]}));assert.equal(one.status,200,await one.clone().text());assert.equal(m.metrics.r2,2,'one HEAD per fresh action/readback projection, never one per repeated reference claim');
 await addTextSource(f,{index:2,objectIndex:1});
 const updated=await f.ok(await f.send({action:'confirm',options:{count_policies:{[parseOutputRequirement({id:'output-assignment',type:'Output',subtype:'Executive summary',content:'1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document.'}).spec.deliverables.find(d=>d.media_kind==='slides').id]:flexible}}}));
 const denied=await m.profile('two-native-source-objects-denied',()=>f.send({action:'preflight',planRevisionId:updated.command.planRevisionId,targetIds:[plan.targetId]}));assert.equal(denied.status,409,await denied.clone().text());assert.equal((await denied.json()).errorCode,'context_source_evidence_capacity_exceeded');assert.equal(m.metrics.r2,0);assert.equal(m.metrics.provider,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
});

test('an explicit pixel reference cannot pass the unpriced native image route',async t=>{
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect the mature pear trees.'}}]);t.after(()=>f.sqlite.close());await addTextSource(f,{weight:1,pixels:true});const plan=await saveImages(f);
 const pre=await f.ok(await f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetIds[0]]}));assert.equal(pre.command.preflight.targets[0].available,false);assert.equal(pre.command.preflight.targets[0].reasonCode,'output_native_reference_input_unpriced');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,0);
});

for(const shared of[false,true])for(const lateKnown of[false,true])test(`four-minute timeout retains exposure and explicit financial-only reconciliation: shared=${shared},lateKnown=${lateKnown}`,async t=>{
 const f=await fixture(undefined,{shared});t.after(()=>f.sqlite.close());await addTextSource(f);
 const plan=await saveDeck(f),auth=await authorize(f,plan.planId,[plan.targetId]);await f.ok(await f.send({action:'run',grantId:auth.grantId}));
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get(),jobId=slot.job_id;
 const m=meter(f),entered=Promise.withResolvers(),release=Promise.withResolvers();let monotonic=0,networkCalls=0;
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});t.mock.method(performance,'now',()=>monotonic);
 t.mock.method(globalThis,'fetch',async()=>{m.metrics.provider++;networkCalls++;entered.resolve();await release.promise;
  if(!lateKnown)throw new Error('Provider outcome remains unknown');
  return Response.json({id:'late-known-response',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
 });
 const reconcile=()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/reconcile-output`,{method:'POST',headers:f.headers}),f.env,`${jobId}/reconcile-output`);
 let execution;
 try{
  execution=m.profile(`timeout-${shared?'shared':'personal'}`,()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/run`,{method:'POST',headers:f.headers}),f.env,`${jobId}/run`));
  await entered.promise;
  for(let i=0;i<4;i++){monotonic+=60000;t.mock.timers.tick(60000);await flushExecution();}
  const stopped=await execution;assert.equal(stopped.status,200,await stopped.clone().text());assertBudget(m,'timeout with three renewals and source verification');
  let job=f.sqlite.prepare('SELECT status,error_message,result_json FROM document_jobs').get();assert.equal(job.status,'failed');assert.equal(job.error_message,'output_execution_time_limit',JSON.stringify(job));
  const renewals=[...m.metrics.queries].filter(([q])=>q.includes('UPDATE document_jobs SET lease_expires_at')).reduce((sum,[,n])=>sum+n,0);assert.equal(renewals,3,'the fourth timer must stop, not renew, the operation');
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'executing');assert.equal(f.sqlite.prepare('SELECT status FROM output_operation_slots').get().status,'uncertain');
  const pending=await m.profile('explicit-receipt-check-before-response',reconcile);assert.equal(pending.status,200,await pending.clone().text());const pendingBody=await pending.json();assert.equal(pendingBody.reconciliation.status,'uncertain');assert.equal(pendingBody.reconciliation.reconciled,false);assertBudget(m,'one pending receipt check');assert.equal(m.metrics.provider,0);
  assert.equal(pendingBody.reconciliation.documentId,f.documentId);assert.equal(pendingBody.reconciliation.slotId,slot.slot_id);assert.equal(pendingBody.reconciliation.grantId,auth.grantId);assert.equal(pendingBody.reconciliation.jobId,jobId);
  // Simulate an expired, scrubbed private request; money convergence must not
  // require the old Document or reconstruct its deleted source/candidate body.
  f.sqlite.prepare("UPDATE document_jobs SET request_json='{}'").run();
  f.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE kind='document-artifact-input'").run(new Date().toISOString());
  f.sqlite.prepare("UPDATE output_execution_grants SET expires_at=?,status='revoked'").run(new Date(Date.now()-1).toISOString());
  release.resolve();await flushExecution();
  const nativeCandidates=f.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='provider-response' AND content<>''").get().n;assert.equal(nativeCandidates,0,'late provider response cannot revive private candidate after timeout');
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM events WHERE type IN('DocumentRenderCompleted','GenerationCompleted') AND json_extract(payload,'$.document_id')=?").get(f.documentId).n,0);
  const completed=await m.profile('explicit-receipt-check-after-response',reconcile);assert.equal(completed.status,200,await completed.clone().text());const completedBody=await completed.json();assertBudget(m,'one final receipt check');assert.equal(m.metrics.provider,0);
  assert.equal(completedBody.reconciliation.status,lateKnown?'known':'uncertain');
  const cost=f.sqlite.prepare('SELECT status,used_microusd,reserved_microusd FROM cost_budget_reservations').get();
  if(lateKnown){const call=f.sqlite.prepare('SELECT used_microusd,status FROM output_provider_calls').get();assert.equal(call.status,'settled');assert.equal(cost.status,'settled');assert.equal(cost.used_microusd,call.used_microusd);assert.ok(cost.used_microusd>0);assert.equal(f.sqlite.prepare('SELECT used_tokens,status FROM budget_reservations').get().used_tokens,200);}else{assert.equal(cost.status,'executing');assert.equal(cost.used_microusd,0);}
  assert.doesNotMatch(JSON.stringify(completedBody),/Community stewardship|plannerInput|artifactPlan|source_snapshot|source_citations|candidateRaw|Retain the established/);
  assert.equal(f.sqlite.prepare('SELECT request_json FROM document_jobs').get().request_json,'{}');
  const replay=await m.profile('explicit-receipt-check-idempotent',reconcile);assert.equal(replay.status,200,await replay.clone().text());assertBudget(m,'idempotent receipt replay');assert.equal(m.metrics.provider,0);assert.equal((await replay.json()).reconciliation.reconciled,false);assert.equal(networkCalls,1);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM document_jobs').get().n,1);
  if(shared){f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);const forbidden=await reconcile();assert.equal(forbidden.status,403);assert.equal(networkCalls,1);}
 }finally{release.resolve();t.mock.timers.reset();if(execution)await execution.catch(()=>{});await flushExecution();}
});

test('the actual native route keeps exact11 authoritative over a separate stale aim8',async t=>{
 const f=await fixture(snapshot(11).facts.filter(fact=>String(fact.type).toLowerCase()!=='output'));t.after(()=>f.sqlite.close());
 const spec=parseOutputRequirement({id:'exact-11-assignment',type:'Output',subtype:'Executive summary',content:'1 slideshow with 5-15 slides, one podcast episode outlining the document, a series of TikTok style videos outlining the various parts of the document.'}).spec;
 const deck=spec.deliverables.find(d=>d.media_kind==='slides');const exact11={kind:'exact',unit:'slide',value:11};
 await f.ok(await f.send({action:'save',blockId:spec.id,spec}));const confirmed=await f.ok(await f.send({action:'confirm',options:{count_policies:{[deck.id]:exact11},suggested_counts:{[deck.id]:8}}}));
 const target=confirmed.snapshot.confirmedPlan.plan.targets.find(t=>t.media_kind==='slides');assert.deepEqual(target.count_policy,exact11);assert.equal(target.suggested_count,8);
 const auth=await authorize(f,confirmed.command.planRevisionId,[target.id]);const settings=auth.terms.targets[0].settings.payload;assert.deepEqual(settings.slideCountPolicy,exact11);assert.equal(settings.itemCount,11);assert.equal(settings.requestedSlideCount,11);
 let calls=0,m;t.mock.method(globalThis,'fetch',async(_url,request)=>{calls++;if(m)m.metrics.provider++;const body=JSON.parse(request.body);assert.equal(body.text.format.schema.properties.items.minItems,11);assert.equal(body.text.format.schema.properties.items.maxItems,11);const input=JSON.parse(body.input);assert.deepEqual(input.presentation_source.slideCountPolicy,exact11);return Response.json({id:'exact11-response',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor(11)),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 await f.ok(await f.send({action:'run',grantId:auth.grantId}));const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();m=meter(f);
 const rendered=await m.profile('exact11-over-aim8-native-job',()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/run`,{method:'POST'}),f.env,`${slot.job_id}/run`));assert.equal(rendered.status,200,await rendered.clone().text());assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed',JSON.stringify(f.sqlite.prepare('SELECT error_message,result_json FROM document_jobs').get()));assert.equal(calls,1);
 const bound=await f.ok(await f.send({action:'bind',planRevisionId:confirmed.command.planRevisionId,targetId:target.id,nativeJobId:slot.job_id}));assert.equal(bound.snapshot.results[0].checksStatus,'passed');const download=await f.request(bound.snapshot.assets[0].downloadUrl);const facts=await inspectOutputAsset(new Uint8Array(await download.arrayBuffer()),'exact11.pptx');assert.equal(facts.facts.slideCount,11);
 const finalTarget=bound.snapshot.confirmedPlan.plan.targets.find(t=>t.id===target.id);assert.deepEqual(finalTarget.count_policy,exact11);assert.equal(finalTarget.suggested_count,8,'confirmation preserves suggestion metadata without turning it into authority');
});

for(const variant of[
 {kind:'slides',fault:'provider-ledger'},
 {kind:'slides',fault:'publication'},
 {kind:'slides',fault:'publication-lost-ack'},
 {kind:'slides',fault:'final-job-lost-ack'},
 {kind:'image',fault:'put-lost-ack'},
 {kind:'image',fault:'final-job-lost-ack'},
])test(`whole slow HTTP with source and operational fault: ${JSON.stringify(variant)}`,async t=>{
 const f=await fixture(variant.kind==='image'?[{block_id:'orchard',type:'message',properties:{text:'Protect the mature pear trees beside a sheltered orchard path.'}}]:undefined,{shared:true});t.after(()=>f.sqlite.close());await addTextSource(f);
 const plan=variant.kind==='image'?await saveImages(f):await saveDeck(f),auth=await authorize(f,plan.planId,[variant.kind==='image'?plan.targetIds[0]:plan.targetId]);await f.ok(await f.send({action:'run',grantId:auth.grantId}));
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get(),jobId=slot.job_id;
 let injected=false,paidCalls=0;
 const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{
  const hit=variant.fault==='provider-ledger'?paidCalls===2&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd')):
   variant.fault.startsWith('publication')?statements.some(s=>s.sql.includes('INSERT INTO event_write_stage')&&s.bindings.includes('DocumentRenderCompleted')):
   variant.fault==='final-job-lost-ack'?statements.some(s=>s.sql.startsWith('UPDATE document_jobs SET status=?,result_json=')&&s.bindings[0]==='completed'):false;
  if(!injected&&hit){injected=true;if(variant.fault==='final-job-lost-ack'||variant.fault==='publication-lost-ack')await batch(statements);throw new Error('injected operational failure, not provider failure');}
  return batch(statements);
 };
 if(variant.fault==='put-lost-ack'){const put=f.env.MEDIA.put.bind(f.env.MEDIA);f.env.MEDIA.put=async(...args)=>{await put(...args);injected=true;throw new Error('native PUT committed but acknowledgment lost');};}
 const m=meter(f),entered=Promise.withResolvers(),release=Promise.withResolvers();let monotonic=0;
 t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.now()});t.mock.method(performance,'now',()=>monotonic);
 t.mock.method(globalThis,'fetch',async(url,request)=>{
  m.metrics.provider++;
  if(String(url).endsWith('/moderations'))return Response.json({id:'fault-safety',results:[{flagged:false,categories:{}}]});
  paidCalls++;
  if(paidCalls===2){entered.resolve();await release.promise;}
  if(String(url).endsWith('/responses'))return Response.json({id:`fault-planner-${paidCalls}`,model:'gpt-5.6-terra',output_text:JSON.stringify(variant.kind==='image'?direction:paidCalls===1?{...outputFor(),items:[]}:outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});
  const[w,h]=JSON.parse(request.body).size.split('x').map(Number);return Response.json({data:[{b64_json:png(w,h).toString('base64')}],usage:{input_tokens:120,output_tokens:80,total_tokens:200,input_tokens_details:{text_tokens:120,image_tokens:0}}},{headers:{'x-request-id':'fault-image'}});
 });
 let execution;
 try{
  execution=m.profile(`fault-${JSON.stringify(variant)}`,()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/run`,{method:'POST',headers:f.headers}),f.env,`${jobId}/run`));await entered.promise;
  for(let i=0;i<3;i++){monotonic+=60000;t.mock.timers.tick(60000);await flushExecution();}
  release.resolve();const response=await execution;assert.equal(response.status,200,await response.clone().text());assert.equal(injected,true);assertBudget(m,'fault after source/paid response/three renewals');assert.equal(paidCalls,2);if(variant.fault==='publication-lost-ack')assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs').get().status,'completed','exact committed publication replay preserves the same successful job');
  const reconciled=await m.profile('fault-explicit-financial-reconciliation',()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/reconcile-output`,{method:'POST',headers:f.headers}),f.env,`${jobId}/reconcile-output`));assert.equal(reconciled.status,200,await reconciled.clone().text());assertBudget(m,'fault receipt reconciliation');assert.equal(m.metrics.provider,0);assert.equal(paidCalls,2);
  assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'settled');
 }finally{release.resolve();t.mock.timers.reset();if(execution)await execution.catch(()=>{});await flushExecution();}
});

for(const shared of[false,true])test(`121 authorized-only native jobs do not hide an older ordinary job before list pagination, shared=${shared}`,async t=>{
 const f=await fixture(undefined,{shared});t.after(()=>f.sqlite.close());Object.assign(f.env,{FORMA_USER_TOKEN_LIMIT:'100000000',FORMA_USER_COST_LIMIT_USD:'1000'});
 f.sqlite.prepare('UPDATE budget_scope_policies SET token_limit=100000000,microusd_limit=1000000000').run();
 let provider=0;t.mock.method(globalThis,'fetch',()=>{provider++;throw new Error('Listing and authorization cannot generate');});
 const ordinary=await handleDocumentJobs(new Request('http://localhost/api/document-jobs',{...init({kind:'render_document',documentId:f.documentId,sourceSurface:'document',payload:{artifactKind:'slides',productionMode:'manual',itemCount:9,requestedSlideCount:9,budgetAcknowledged:true,preflightAcknowledged:true}}),headers:{'content-type':'application/json',...f.headers}}),f.env,'');assert.equal(ordinary.status,202,await ordinary.clone().text());const ordinaryId=(await ordinary.json()).job.jobId;
 if(shared)assert.equal((await handleEvents(new Request('http://localhost/api/events',{headers:f.headers}),f.env)).status,200);
 const spec=parseOutputRequirement({id:'authorized-queue-plan',type:'Output',subtype:'Social media image',content:'Output images at aspect ratio "1:1".'}).spec;spec.deliverables[0].format_variants[0].quantity={kind:'exact',unit:'image',value:121};spec.deliverables[0].coverage={kind:'document_outline'};
 await f.ok(await f.send({action:'save',blockId:spec.id,spec}));const confirmation=await f.ok(await f.send({action:'confirm'}));const targetIds=confirmation.snapshot.confirmedPlan.plan.targets.map(target=>target.id);assert.equal(targetIds.length,121);
 for(let offset=0;offset<targetIds.length;offset+=16){const pre=await f.ok(await f.send({action:'preflight',planRevisionId:confirmation.command.planRevisionId,targetIds:targetIds.slice(offset,offset+16)})),terms=pre.command.preflight;await f.ok(await f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}));}
 assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM output_operation_slots WHERE status='authorized'").get().n,121);assert.equal(provider,0);
 const m=meter(f);const listing=await m.profile('cold-native-authorized-pagination-'+shared,()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs?document=${f.documentId}`,{headers:f.headers}),f.env,''));assert.equal(listing.status,200,await listing.clone().text());const jobs=(await listing.json()).jobs;assert.deepEqual(jobs.map(job=>job.jobId),[ordinaryId]);assertBudget(m,'ordinary queue stays visible before limit120');
 const first=f.sqlite.prepare('SELECT job_id FROM output_operation_slots LIMIT 1').get().job_id;const denied=await m.profile('authorized-only-cannot-drive-'+shared,()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${first}/run`,{method:'POST',headers:f.headers}),f.env,`${first}/run`));assert.equal(denied.status,202);assertBudget(m,'authorized-only native job is not started');assert.equal(provider,0);
 f.sqlite.prepare('UPDATE output_execution_grants SET expires_at=?').run(new Date(Date.now()-1).toISOString());const user=(await requireUser(new Request('http://localhost/api/session',{headers:f.headers}),f.env,'creator')).user;
 await m.profile('bounded-expiration-121-'+shared,()=>reconcileFailedBudgetReservations(f.env,user));assertBudget(m,'one bounded maintenance pass');assert.equal(provider,0);
 const firstReleased=f.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations WHERE status='released'").get().n;assert.ok(firstReleased>=1&&firstReleased<=2,'maintenance drains bounded no-call work, never all121 pairs in one request');
 await m.profile('bounded-expiration-next-'+shared,()=>reconcileFailedBudgetReservations(f.env,user));assertBudget(m,'next bounded maintenance pass');assert.ok(f.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations WHERE status='released'").get().n>firstReleased,'already settled older siblings cannot starve later work');
});

test('cold legacy GET initializes one composed schema and a failed initialization never installs a ready marker',async()=>{
 const {outputSchemaIsReady}=await import('../worker/output-schema-state.ts');
 for(const lostAck of[false,true]){const f=outputTestDatabase();try{let fail=true,calls=0;const original=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{calls++;if(fail){fail=false;if(lostAck)await original(statements);throw new Error('schema initialization failed');}return original(statements);};
  await assert.rejects(()=>handleDocumentJobs(new Request('http://localhost/api/document-jobs'),f.env,''));assert.equal(outputSchemaIsReady(f.DB),false);
  const retry=await handleDocumentJobs(new Request('http://localhost/api/document-jobs'),f.env,'');assert.equal(retry.status,200,await retry.clone().text());assert.equal(outputSchemaIsReady(f.DB),true);assert.ok(calls>=2);assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='output_operation_slots'").get().n,1);
 }finally{f.sqlite.close();}}
});

for(const shared of[false,true])test(`receipt reconciliation rejects other actors, leaves siblings untouched and survives a lost accounting acknowledgment, shared=${shared}`,async t=>{
 const f=await fixture([{block_id:'orchard',type:'message',properties:{text:'Protect the mature pear trees beside a sheltered orchard path.'}}],{shared});t.after(()=>f.sqlite.close());
 const plan=await saveImages(f),auth=await authorize(f,plan.planId,plan.targetIds);await f.ok(await f.send({action:'run',grantId:auth.grantId}));const slots=f.sqlite.prepare('SELECT slot.* FROM output_operation_slots slot JOIN document_jobs job ON job.job_id=slot.job_id ORDER BY job.requested_at,job.job_id').all(),target=slots[0],sibling=slots[1];
 let network=0,firstFault=false;t.mock.method(globalThis,'fetch',async(url)=>{network++;assert.ok(String(url).endsWith('/responses'));return Response.json({id:'sibling-isolated-known-charge',model:'gpt-5.6-terra',output_text:JSON.stringify(direction),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{if(!firstFault&&statements.some(s=>s.sql.includes('UPDATE output_provider_calls SET used_microusd'))){firstFault=true;throw new Error('receipt ledger write unavailable');}return batch(statements);};
 await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${target.job_id}/run`,{method:'POST',headers:f.headers}),f.env,`${target.job_id}/run`);assert.equal(firstFault,true);assert.equal(network,1);assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(target.job_id).status,'failed');
 const otherHeaders={'oai-authenticated-user-id':'different-receipt-actor','oai-authenticated-user-email':'different-receipt-actor@example.test'};
 await handleSession(new Request('http://localhost/api/session',{headers:otherHeaders}),f.env);f.sqlite.prepare('UPDATE users SET consent_version=? WHERE user_id=?').run(POLICY_VERSION,'different-receipt-actor');
 const denied=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${target.job_id}/reconcile-output`,{method:'POST',headers:{...f.headers,...otherHeaders}}),f.env,`${target.job_id}/reconcile-output`);assert.equal(denied.status,shared?403:404);assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations WHERE reservation_id=?').get(target.cost_reservation_id).status,'executing');
  const request=()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${target.job_id}/reconcile-output`,{...init({jobId:sibling.job_id,costReservationId:sibling.cost_reservation_id,usedMicrousd:0,usedTokens:0}),headers:{'content-type':'application/json',...f.headers}}),f.env,`${target.job_id}/reconcile-output`);
  if(shared){
   f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
   f.sqlite.prepare("UPDATE output_execution_grants SET status='revoked',expires_at=? WHERE grant_id=?").run(new Date(Date.now()-1).toISOString(),auth.grantId);
   const opened=await handleWorkspaces(new Request(`http://localhost/api/workspaces/${f.organizationId}/projects/${f.projectAccessId}/context`,{method:'POST'}),f.env,[f.organizationId,'projects',f.projectAccessId,'context']);
   assert.equal(opened.status,200,await opened.clone().text());f.headers.cookie=opened.headers.get('set-cookie').split(';')[0];
   assert.notEqual(decodeURIComponent(f.headers.cookie.split('=').slice(1).join('=')),f.contextId,'a fresh authorized selection can reconcile an old expired execution grant');
  }
 let lost=false;f.DB.batch=async statements=>{const result=await batch(statements);if(!lost&&statements.some(s=>s.sql.startsWith('UPDATE cost_budget_counters SET reserved_microusd=MAX'))){lost=true;throw new Error('account settlement committed but acknowledgment lost');}return result;};
 const m=meter(f);await assert.rejects(()=>m.profile('lost-ack-financial-check-'+shared,request));assert.equal(lost,true);assertBudget(m,'lost accounting acknowledgment');assert.equal(network,1);
 const replay=await m.profile('lost-ack-financial-check-replay-'+shared,request);assert.equal(replay.status,200,await replay.clone().text());const body=await replay.json();assert.equal(body.reconciliation.jobId,target.job_id);assert.equal(body.reconciliation.slotId,target.slot_id);assert.equal(body.reconciliation.reconciled,false);assertBudget(m,'canonical accounting replay');assert.equal(network,1);
 const paid=f.sqlite.prepare('SELECT used_microusd,status FROM cost_budget_reservations WHERE reservation_id=?').get(target.cost_reservation_id),call=f.sqlite.prepare('SELECT used_microusd FROM output_provider_calls WHERE slot_id=?').get(target.slot_id);assert.equal(paid.status,'settled');assert.equal(paid.used_microusd,call.used_microusd);assert.ok(paid.used_microusd>0,'client-supplied zero is not accounting evidence');assert.equal(f.sqlite.prepare('SELECT used_tokens FROM budget_reservations WHERE reservation_id=?').get(target.token_reservation_id).used_tokens,200);
 assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations WHERE reservation_id=?').get(sibling.cost_reservation_id).status,'active');assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(sibling.job_id).status,'queued');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM output_provider_calls WHERE slot_id=?').get(sibling.slot_id).n,0);
 const running=await handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${sibling.job_id}/reconcile-output`,{method:'POST',headers:f.headers}),f.env,`${sibling.job_id}/reconcile-output`);assert.equal(running.status,409);assert.equal(network,1);
});

for(const shared of[false,true])for(const fault of['head-race','partial-publication','changed-private-body','revoked-after-commit'])test(`canonical native publication acknowledgment refuses ${fault}, shared=${shared}`,async t=>{
 const f=await fixture(undefined,{shared});t.after(()=>f.sqlite.close());
 const plan=await saveDeck(f),auth=await authorize(f,plan.planId,[plan.targetId]);await f.ok(await f.send({action:'run',grantId:auth.grantId}));
 const slot=f.sqlite.prepare('SELECT * FROM output_operation_slots').get();let network=0,injected=false,completedEventId=null,allZeroObserved=false,m;const publicationRangeIds=[];
 t.mock.method(globalThis,'fetch',async()=>{network++;m.metrics.provider++;return Response.json({id:'canonical-proof-only',model:'gpt-5.6-terra',output_text:JSON.stringify(outputFor()),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{
  const completion=statements.find(statement=>statement.sql.includes('INSERT INTO event_write_stage')&&statement.bindings.includes('DocumentRenderCompleted'));
  if(injected||!completion)return batch(statements);injected=true;completedEventId=completion.bindings[0];publicationRangeIds.push(...statements.filter(statement=>statement.sql.includes('INSERT INTO event_write_stage')).map(statement=>statement.bindings[0]));
  if(fault==='head-race'||fault==='partial-publication'){
   // Concurrent ordinary open/refresh is outside this HTTP operation. It
   // advances a valid current projection after native code selected its head.
   const head=f.sqlite.prepare('SELECT MAX(sequence) AS n FROM events WHERE stream_id=?').get(stream).n;
   const count=fault==='head-race'?2:1;
   for(let offset=1;offset<=count;offset++){
    const opened=makeEvent(stream,head+offset,'user','concurrent-view','concurrent-view','DocumentOpened',{document_id:f.documentId,project_id:'project-atmosphere'});
    f.sqlite.prepare(`INSERT INTO event_write_stage(${EVENT_WRITE_COLUMNS}) VALUES(${eventWriteBindings(opened).map(()=>'?').join(',')})`).run(...eventWriteBindings(opened));
   }
   if(shared)f.sqlite.prepare('UPDATE project_migration_states SET last_owner_sequence=? WHERE project_access_id=?').run(head+count,f.projectAccessId);
   const results=await batch(statements);allZeroObserved=Number(results[statements.indexOf(completion)].meta.changes??0)===0;return results;
  }
  await batch(statements);
  if(fault==='changed-private-body')assert.equal(f.sqlite.prepare("UPDATE event_private_payloads SET private_json=json_set(private_json,'$.diagnostic','changed-after-commit') WHERE private_event_id=?").run(completedEventId).changes,1);
  else if(shared)f.sqlite.prepare('UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?').run(new Date().toISOString(),f.contextId);
  else f.sqlite.prepare("UPDATE users SET consent_version=NULL WHERE user_id='dev-local-creative'").run();
  throw new Error('publication acknowledgment lost after changed authority or envelope');
 };
 m=meter(f);const response=await m.profile('canonical-negative-'+fault,()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${slot.job_id}/run`,{method:'POST',headers:f.headers}),f.env,`${slot.job_id}/run`));
 assert.equal(response.status,200,await response.clone().text());assert.equal(injected,true);assert.equal(network,1);assertBudget(m,'bounded failed publication recovery');
 assert.equal(f.sqlite.prepare('SELECT status FROM document_jobs WHERE job_id=?').get(slot.job_id).status,'failed','partial, changed, stale or revoked publication must never be reported as committed success');
 assert.notEqual(f.sqlite.prepare('SELECT status FROM output_operation_slots WHERE slot_id=?').get(slot.slot_id).status,'succeeded');
  if(fault==='head-race'){assert.equal(allZeroObserved,true);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events WHERE event_id=?').get(completedEventId).n,0,'a genuine all-zero head conflict is not a committed acknowledgment');}
  if(fault==='partial-publication'){assert.ok(publicationRangeIds.length>=2);for(const eventId of publicationRangeIds)assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events WHERE event_id=?').get(eventId).n,0,'a partial range rolls back its exact completion and usage IDs; a later failure-charge audit is still allowed');}
 assert.equal(f.sqlite.prepare('SELECT status FROM cost_budget_reservations').get().status,'settled','known provider charges survive a publication failure');
});
