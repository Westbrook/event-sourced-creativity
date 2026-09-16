import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {registerHooks,stripTypeScriptTypes} from 'node:module';
const C=process.env.FORMA_SOURCE_ROOT;if(!C)throw Error('FORMA_SOURCE_ROOT required');
const root=new URL('../',import.meta.url).pathname;
registerHooks({resolve(specifier,context,next){
 if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:')){
  const url=new URL(specifier,context.parentURL);
  if(url.pathname.startsWith(root)&&!existsSync(url))return next(new URL('file://'+C+'/'+url.pathname.slice(root.length)).href,context);
 }
 return next(specifier,context);
}});
const {canonicalJson}=await import('../src/experiences/compiler.ts');
const {createStoryboardOutputContract}=await import('../src/model/output-storyboard-contract.ts');
const {ownerMediaNamespace}=await import('../src/model/media-ownership.ts');
const {captureExperienceStoryboardEvidence,captureExperienceStoryboardTarget,verifyExperienceStoryboardRead}=await import('../src/experiences/storyboard-native-result.ts');
const {captureExperienceNativeResult}=await import('../src/experiences/native-result-association.ts');
const {experienceResultGrantCurrent}=await import('../src/experiences/output-binding-client.ts');
const {outputTerms}=await import('../src/experiences/output-terms.ts');
const {createOutputFalImageContract}=await import('../src/model/output-fal-image-contract.ts');
const {documentRenderTokenReservation}=await import('../src/model/generation-budget.ts');
const {OUTPUT_NATIVE_EXECUTION_POLICY}=await import('../src/model/output-execution-policy.ts');
const {readStoryboardExecutionOffer,STORYBOARD_READY_REASON,STORYBOARD_TRANSFER}=await import('../src/model/output-storyboard-offer.ts');
const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('network forbidden');};test.after(()=>{globalThis.fetch=oldFetch;});
const sha=value=>createHash('sha256').update(value).digest('hex');
const sourceFile=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
// Unadmitted parser fixtures. No authorization, paid call, storage publication,
// server DTO substitution or browser/generation proof is made by these objects.
function fixture(){
 const now=Date.now(),expiresAt=new Date(now+60000).toISOString(),source={draftId:'experience-draft-'+'a'.repeat(64),draftHash:'sha256:'+'b'.repeat(64),releaseHash:'sha256:'+'c'.repeat(64),requestHash:'sha256:'+'d'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)};
 const contract=createStoryboardOutputContract(source),content={title:'The lantern',summary:'Home',content_markdown:'A lantern travels home.',presentation:null,
  items:Array.from({length:4},(_,i)=>({title:'Frame '+i,body:'Literal <b>灯笼</b> '+i,notes:'Keep the lantern',image_prompt:'Lantern '+i,slide:null,context_group_ids:[]}))};
 const raw=JSON.stringify(content),planSha256=sha(raw),bindingHash=sha(JSON.stringify({contract,plannerResponseId:'planner-original',planSha256}));
 const receipt={version:'output-storyboard-completion-v1',contract,jobId:'job',slotId:'slot',artifactId:'artifact',actorUserId:'owner',documentId:'doc',streamId:'creative:owner',correlationId:'corr',attempt:1,grantId:'grant',targetId:'target',planRevisionId:'revision',targetContractDigest:'target-digest',sourceDigest:'source-digest',plannerRequestDigest:'f'.repeat(64),plannerResponseId:'planner-original',planSha256,storyboardBindingSha256:bindingHash,frameCount:4,
  frames:Array.from({length:4},(_,i)=>({frameIndex:i,id:'artifact-frame-'+(i+1),mediaUrl:'/api/media/'+encodeURIComponent(ownerMediaNamespace('owner')+'/generated/artifact-frame-'+(i+1)+'.png'),sha256:'1'.repeat(64),byteLength:99,width:1536,height:1024,mimeType:'image/png',provider:'fal',model:'ideogram/v4',clientRequestId:'client-'+i,providerRequestId:'provider-'+i,storyboardBindingSha256:bindingHash})),providerCallCount:5,visualReview:'required'};
 const input={schema_version:1,artifact_kind:'storyboard',document_id:'doc',project_id:'project',artifact_id:'artifact',request:{source_surface:'outputs',production_mode:'manual',item_count:4},planner:{provider:'openai',response_id:'planner-original'},output_storyboard:receipt},rawInput=JSON.stringify(input);
 const settings={output_storyboard:receipt,storyboard_content_sha256:sha(raw),storyboard_input_sha256:sha(rawInput)};
 const expected={source,documentId:'doc',projectId:'project',artifactId:'artifact',ownerId:'owner',jobId:'job',slotId:'slot',grantId:'grant',targetId:'target',planRevisionId:'revision',targetContractDigest:'target-digest',sourceDigest:'source-digest',correlationId:'corr'};
 const dto={kind:'native-retained-output',schemaVersion:1,output:'storyboard',title:content.title,expiresAt,selection:{documentId:'doc',artifactId:'artifact',revision:0,contentSha256:sha(raw)},content:{frames:content.items.map((item,i)=>({id:receipt.frames[i].id,title:item.title,body:item.body,notes:item.notes,imagePrompt:item.image_prompt,image:{url:receipt.frames[i].mediaUrl,mediaType:'image/png',width:1536,height:1024}}))}};
 const identity={output:'storyboard',documentId:'doc',projectId:'project',ownerUserId:'owner',jobId:'job',correlationId:'corr',expiresAt:new Date(now+120000).toISOString()};
 const payload={document_id:'doc',project_id:'project',artifact_id:'artifact',artifact_kind:'storyboard',item_count:4,source_surface:'outputs',content_ref:'content',input_ref:'input',content_expires_at:expiresAt,input_expires_at:expiresAt,requested_by_user_id:'owner',planner_response_id:'planner-original',planner_model_id:'gpt-5.6-terra',provider:'fal',model_id:'ideogram/v4',media_url:null,media_type:null,presentation:null,settings,
  items:receipt.frames.map(f=>({id:f.id,media_url:f.mediaUrl,media_type:f.mimeType,width:f.width,height:f.height}))};
 const event={type:'DocumentRenderCompleted',eventId:'event',correlationId:'corr',streamId:'creative:owner',actor:'worker:renderer',payload};
 const artifact={id:'artifact',documentId:'doc',kind:'storyboard',itemCount:4,sourceEventId:'event',sourceSurface:'outputs',contentRef:'content',inputRef:'input',settings:structuredClone(settings)};
 const current={documentId:'doc',projectId:'project',documents:[{id:'doc',projectId:'project',removed:false}],artifacts:[artifact],outputs:[],events:[event]};
 const job={jobId:'job',documentId:'doc',sourceSurface:'outputs',kind:'render_document',status:'completed',result:{artifactId:'artifact',artifactKind:'storyboard',appendedEventIds:['event']}};
 const target={storyboard_contract:contract,media_kind:'document',quantity:{kind:'exact',unit:'document',value:1},source_scope:{kind:'document'},coverage:{kind:'document_context'},aspect_ratio:null,content_quantity:null,count_policy:null,variant_id:null,member_id:null,suggested_count:null};
 return {now,expiresAt,source,contract,content,raw,rawInput,receipt,input,settings,expected,dto,identity,payload,event,artifact,current,job,target};
}
test('four original frames bind exact ordered receipt, private strings and canonical reader selection',async()=>{
 const f=fixture(),candidate=captureExperienceNativeResult(f.identity,f.job,f.current,f.now);assert(candidate);assert.equal(candidate.expiresAt,f.expiresAt);assert.equal(candidate.inputRef,'input');
 assert.equal(await verifyExperienceStoryboardRead(candidate.storyboard,f.raw,f.rawInput,f.dto,f.expected,f.now),true);
 assert.deepEqual(captureExperienceStoryboardTarget(f.target,f.source),f.contract);assert(Object.isFrozen(candidate.storyboard.receipt.frames));assert.equal(candidate.storyboard.receipt.visualReview,'required');
});
test('closed receipt rejects malformed count, getters, inherited array methods and foreign ordered frame identity',()=>{
 let reads=0;
 for(const mutate of [f=>f.receipt.frames.pop(),f=>f.receipt.frames.reverse(),f=>f.receipt.frames[0].provider='openai',f=>f.receipt.frames[0].mediaUrl='/api/media/foreign',f=>f.receipt.frames[0].width=1024,
  f=>f.receipt.providerCallCount=4,f=>f.receipt.frames[1].clientRequestId=f.receipt.frames[0].clientRequestId,f=>f.receipt.frames[1].providerRequestId=f.receipt.plannerResponseId,
  f=>f.receipt.extra=true,f=>f.receipt.contract={...f.contract,source:{...f.source,requestHash:'bad'}},f=>Object.defineProperty(f.receipt,'planSha256',{enumerable:true,get(){reads++;return 'a'.repeat(64);}}),
  f=>Object.setPrototypeOf(f.receipt.frames,{map(){reads++;return [];}}),f=>{class Frames extends Array{};f.receipt.frames=Frames.from(f.receipt.frames);}]){
  const f=fixture();mutate(f);assert.equal(captureExperienceStoryboardEvidence(f.settings),null);
 }assert.equal(reads,0);
});
test('sparse own arrays cannot compact out-of-range numeric keys into a fourth frame',async()=>{
 const sparse=frames=>{const last=frames[3];delete frames[3];Object.defineProperty(frames,'4294967295',{value:last,enumerable:true});return frames;};
 const f=fixture();sparse(f.receipt.frames);assert.equal(f.receipt.frames.length,4);
 assert.equal(captureExperienceStoryboardEvidence(f.settings),null);
 const items=fixture();sparse(items.payload.items);assert.equal(captureExperienceNativeResult(items.identity,items.job,items.current,items.now),null);
 const dto=fixture();sparse(dto.dto.content.frames);
 assert.equal(await verifyExperienceStoryboardRead(captureExperienceStoryboardEvidence(dto.settings),dto.raw,dto.rawInput,dto.dto,dto.expected,dto.now),false);
});
test('association refuses edited, foreign, duplicate, incomplete and expired originals',()=>{
 for(const mutate of [f=>f.job.jobId='foreign',f=>f.job.status='running',f=>f.job.sourceSurface='document',f=>f.event.correlationId='foreign',f=>f.current.events.push(f.event),
 f=>f.artifact.inputRef='foreign',f=>f.artifact.settings.storyboard_input_sha256='0'.repeat(64),f=>f.payload.items.reverse(),f=>f.payload.items.pop(),f=>f.payload.item_count=3,
 f=>f.payload.input_expires_at=new Date(f.now).toISOString(),f=>f.payload.model_id='other',f=>f.payload.planner_response_id='foreign',f=>f.current.documents[0].removed=true,
 f=>f.current.events.push({type:'DocumentArtifactEdited',payload:{artifact_id:'artifact'}}),f=>Object.setPrototypeOf(f.payload.items,{some(){return false;}})]){
  const f=fixture();mutate(f);assert.equal(captureExperienceNativeResult(f.identity,f.job,f.current,f.now),null);
 }
});
test('reader refuses changed private/source/DTO evidence, before and after snapshot',async()=>{
 for(const mutate of [f=>f.raw+=' ',f=>f.rawInput+=' ',f=>f.expected.source.sourceBindingHash='sha256:'+'0'.repeat(64),f=>f.expected.jobId='foreign',f=>f.expected.slotId='foreign',
 f=>f.expected.targetId='foreign',f=>f.expected.planRevisionId='foreign',f=>f.dto.selection.revision=1,f=>f.dto.selection.contentSha256='0'.repeat(64),f=>f.dto.expiresAt=new Date(f.now).toISOString(),
 f=>f.dto.content.frames.reverse(),f=>f.dto.content.frames[0].body='Invented',f=>f.dto.content.frames[0].image.url='/other',f=>f.dto.kind='other',f=>f.dto.schemaVersion=2,
 f=>f.settings.storyboard_content_sha256='0'.repeat(64),f=>f.raw=' '.repeat(1048577)]){
  const f=fixture();mutate(f);const evidence=captureExperienceStoryboardEvidence(f.settings);
  assert.equal(await verifyExperienceStoryboardRead(evidence,f.raw,f.rawInput,f.dto,f.expected,f.now),false);
 }
 const f=fixture(),pending=verifyExperienceStoryboardRead(captureExperienceStoryboardEvidence(f.settings),f.raw,f.rawInput,f.dto,f.expected,f.now);
 f.dto.content.frames[0].body='Changed during hash';f.expected.source.requestHash='bad';assert.equal(await pending,true,'comparison uses captured own values, caller guards current source separately');
});
test('exact current Storyboard target rejects mixed or foreign contracts and quantity reinterpretation',()=>{
 for(const mutate of [f=>f.target.audio_contract={},f=>f.target.video_contract={},f=>f.target.scene_contract={},f=>f.target.narrative_contract={},
 f=>f.target.quantity.value=4,f=>f.target.media_kind='storyboard',f=>f.target.source_scope={kind:'project'},f=>f.target.member_id='member',f=>f.source.requestHash='sha256:'+'0'.repeat(64)]){
 const f=fixture();mutate(f);assert.equal(captureExperienceStoryboardTarget(f.target,f.source),null);}
});
test('completed retained Storyboard outlives spending only with original run and no permitted action',()=>{
 const now=Date.now(),state={output:'storyboard',status:'succeeded',disposition:'original_run_recorded',grant:{status:'completed'},permitted:{prepare:false,authorize:false,run:false,resumeRun:false,recoverResult:false},
 original:{expiresAt:new Date(now-1).toISOString(),jobExpiresAt:new Date(now+1000).toISOString(),run:{key:'run-key',eventId:'run-event'},jobStatus:'completed',slotStatus:'succeeded',grantStatus:'completed'}};
 assert.equal(experienceResultGrantCurrent(state,now),true);
 for(const mutate of [s=>s.original.run=null,s=>s.status='running',s=>s.disposition='original_authorized',s=>s.original.jobStatus='failed',s=>s.original.slotStatus='failed',
 s=>s.grant.status='revoked',s=>s.original.grantStatus='active',s=>s.original.jobExpiresAt=new Date(now).toISOString(),...['prepare','authorize','run','resumeRun','recoverResult'].map(key=>s=>s.permitted[key]=true)]){
 const value=structuredClone(state);mutate(value);assert.equal(experienceResultGrantCurrent(value,now),false);}
 assert.equal(outputTerms({}, {now,output:'storyboard',targetId:'target'}).available,false,'missing exact quote and source never enables paid terms');
});
export {fixture,sourceFile,stripTypeScriptTypes,canonicalJson};

test('actual state reconstructs original completed Storyboard read without granting new run or resume',async()=>{
 const now=Date.now(),future=new Date(now+60000).toISOString(),expired=new Date(now-1000).toISOString();
 function stateFixture(){
  const jobId='storyboard-'+'a'.repeat(64),contract=fixture().contract,fal=createOutputFalImageContract('ideogram/v4','1536x1024'),maximum=100+4*fal.maximumMicrousd;
  const quoted={targetId:'target',available:true,reasonCode:'output_storyboard_ready',reason:STORYBOARD_READY_REASON,transferCode:'output_transfer_storyboard_after_authorization',transferDescription:STORYBOARD_TRANSFER,provider:'fal',model:fal.model,route:'document-storyboard-four-frames-manual-v1',maximumMicrousd:maximum,maximumCalls:5,maximumTokens:documentRenderTokenReservation('storyboard',4,1),settings:{kind:'render_document',payload:{artifactKind:'storyboard',productionMode:'manual',itemCount:4,outputStoryboard:contract,outputStoryboardPlanner:{contract,requestDigest:'a'.repeat(64),maximumInputTokens:5000},outputFalImage:fal,outputTargetInstructions:'Four lantern frames',paidMediaConfirmed:true,budgetAcknowledged:true,preflightAcknowledged:true},calls:Array.from({length:5},(_,i)=>({stage:i?'image:frame:'+i:'planning:0:initial',provider:i?'fal':'openai',model:i?fal.model:fal.plannerModel,maximumMicrousd:i?fal.maximumMicrousd:100,maximumInputTokens:i?0:5000,maximumOutputTokens:i?0:4000})),executionPolicy:OUTPUT_NATIVE_EXECUTION_POLICY,preparationOnly:false,executionAvailable:true,explicitCostAndTransferApprovalRequired:true,original:{requestId:jobId,expiresAt:expired,draftId:contract.source.draftId,actorUserId:'owner',projectId:'project',documentId:'doc',sourceDigest:'source',requirementsDigest:'requirements'}}};
  const plan={revisionId:'revision',sourceDigest:'source',requirementsDigest:'requirements',targetContractDigests:{target:'target-digest'}};
  const preflight={id:'preflight',planRevisionId:'revision',sourceDigest:'source',requirementsDigest:'requirements',termsDigest:'terms',maximumMicrousd:maximum,maximumCalls:5,expiresAt:expired,targets:[quoted]};
  const slot={slotId:'slot',jobId:jobId,grantId:'grant',targetId:'target',planRevisionId:'revision',targetContractDigest:'target-digest',sourceDigest:'source',attemptOrdinal:0,previousSlotId:null,routeDigest:'route',status:'succeeded'};
  const grant={id:'grant',status:'completed',expiresAt:expired,planRevisionId:'revision',actorUserId:'owner',payerUserId:'owner',maximumMicrousd:maximum,maximumCalls:5,disclosure:preflight,pendingCalls:0,operations:[{id:'slot',jobId:jobId,targetId:'target',status:'succeeded',pendingCalls:0}]};
  const job={job_id:jobId,correlation_id:'corr',expires_at:future,status:'completed',result_json:'{}'};
  const evidence={slots:[slot],confirmedPlan:plan,preflight,row:{status:'completed',expires_at:expired,deadline_current:0}};
  const original={preflight:{receipt:{payload:{preflight}},envelope:{planRevisionId:'revision'}},
   authorize:{receipt:{key:'auth-key',eventId:'auth-event',payload:{grant_id:'grant',authorized_targets:[{target_id:'target',operation_slot_id:'slot',job_id:jobId,route_digest:'route'}]}},envelope:{preflightId:'preflight',termsDigest:'terms',explicitAuthorization:true,maximumMicrousd:maximum}},
   run:{receipt:{key:'run-key',eventId:'run-event',payload:{grant_id:'grant',job_ids:[jobId],existing_jobs_only:true}},envelope:{grantId:'grant',explicitRun:true}}};
  const statements=[],loaded={binding:{output:'storyboard',draftId:'draft',draftHash:'hash',releaseHash:'release',documentId:'doc',projectId:'project',streamId:'creative:owner'},recipe:{targetId:'target',spec:{deliverables:[{storyboard_contract:contract}]}},originals:original,
   trusted:{sourceDigest:'source',requirementsDigest:'requirements',scope:{key:'scope',actorUserId:'owner'},sourceAssertions:[],env:{DB:{prepare(sql){
    statements.push(sql);assert.match(sql,/^SELECT \* FROM document_jobs/u);
    return {bind(...args){assert.deepEqual(args,[jobId,'owner','creative:owner','doc']);return {first:async()=>job};}};
   }}}}};
  const source=sourceFile('worker/experience-output-api.ts'),body=source.slice(source.indexOf('async function state('),source.indexOf('\nasync function execute'));
  const deps={confirmed:async()=>plan,record:v=>Boolean(v&&typeof v==='object'&&!Array.isArray(v)),canonicalJson,readStoryboardExecutionOffer,phases:['save','confirm','preflight','authorize','run'],error:code=>{throw Error(code);},
   outputExperienceCommands:{readGrantEvidence:async()=>evidence,snapshot:async()=>({grants:[grant],permissions:{canRequest:true}})}};
  const state=new Function(...Object.keys(deps),stripTypeScriptTypes(body)+';return state;')(...Object.values(deps));
  return {loaded,plan,preflight,slot,grant,job,evidence,state,statements};
 }
 const f=stateFixture(),value=await f.state(f.loaded);assert.equal(value.status,'succeeded');assert.equal(value.disposition,'original_run_recorded');
 assert.deepEqual(value.permitted,{prepare:false,authorize:false,run:false,resumeRun:false,recoverResult:false});assert.equal(experienceResultGrantCurrent(value,now),true);assert.equal(f.loaded.trusted.sourceAssertions.length,1);
 for(const mutate of [f=>f.loaded.originals.authorize.envelope.explicitAuthorization=false,f=>f.slot.previousSlotId='old',f=>f.slot.jobId='foreign',
 f=>f.loaded.originals.run.receipt.payload.job_ids=['foreign'],f=>f.grant.operations[0].jobId='foreign',f=>f.job.expires_at=expired]){
  const f=stateFixture();mutate(f);await assert.rejects(f.state(f.loaded));
 }
 for(const recorded of [false,true]){
  const f=stateFixture();if(!recorded)delete f.loaded.originals.run;f.job.status=recorded?'running':'queued';f.slot.status=recorded?'running':'authorized';
  f.grant.operations[0].status=f.slot.status;f.grant.status=f.evidence.row.status='authorized';f.grant.expiresAt=f.evidence.row.expires_at=future;f.evidence.row.deadline_current=1;
  const value=await f.state(f.loaded);assert.equal(value.permitted.run,false);assert.equal(value.permitted.resumeRun,false);assert.equal(value.permitted.authorize,false);
 }
 // This runs the actual reconstruction function against finite lookup ports.
 // It does not prove original database admission or create the indexed receipts.
});


function hostMethod(name,end,deps={}){

 const host=sourceFile('src/components/forma-experience-host.ts'),start=host.indexOf('  '+name),stop=host.indexOf('  '+end,start);assert(start>=0&&stop>start);
 const body=host.slice(start,stop).replaceAll('this.#','this.').replaceAll('import(','loadModule(');
 const declaration=body.replace(/^(\s*)(async )?#(\w+)\(/u,(_,s,a,n)=>s+(a??'')+'function '+n+'(');
 return new Function(...Object.keys(deps),stripTypeScriptTypes(declaration)+';return '+name.match(/#(\w+)/u)[1]+';')(...Object.values(deps));
}
test('actual snapshot gate requires unchanged intake, one exact personal target and original grant',()=>{
 const check=hostMethod('#snapshotMatches(state: ExperienceNativeState)','#candidate(',{captureExperienceStoryboardTarget,bindingJson:canonicalJson});
 function setup(){
  const f=fixture(),grant={id:'grant',status:'completed'},plan={revisionId:'revision',sourceDigest:'source',requirementsDigest:'requirements',targetContractDigests:{target:'digest'},plan:{targets:[{id:'target',...f.target}]}};
  const resource={state:'ready',accessLost:false,privateUnavailable:false,snapshot:{documentId:'doc',projectId:'project',scope:{kind:'personal',actorUserId:'owner'},sourceVerification:{status:'verified'},permissions:{canRequest:true},sourceRevision:'source',requirementRevision:'requirements',confirmedPlan:plan,grants:[grant]}};
  const state={output:'storyboard',documentId:'doc',projectId:'project',plan:{revisionId:'revision',sourceDigest:'source',requirementsDigest:'requirements',targetId:'target',targetContractDigest:'digest'},original:{grantId:'grant'},grant};
  const context={binding:{ownerId:'owner',storyboardSource:f.source},store:{outputRequirements:{resource:()=>resource}}};
  return {state,resource,plan,context};
 }
 const positive=setup();assert.equal(check.call(positive.context,positive.state),true);
 for(const mutate of [f=>f.resource.snapshot.scope.kind='project',f=>f.resource.snapshot.scope.actorUserId='other',f=>f.resource.privateUnavailable=true,
  f=>f.resource.snapshot.sourceRevision='changed',f=>f.context.binding.storyboardSource={...f.context.binding.storyboardSource,requestHash:'sha256:'+'0'.repeat(64)},
  f=>f.plan.plan.targets.push(f.plan.plan.targets[0]),f=>f.plan.plan.targets[0].audio_contract={},f=>f.resource.snapshot.grants.push(f.state.grant),
  f=>f.resource.snapshot.grants=[{...f.state.grant,status:'revoked'}],f=>f.resource.snapshot.permissions.canRequest=false]){
  const f=setup();mutate(f);assert.equal(check.call(f.context,f.state),false);
 }
});

test('actual host read awaits original input and verified DTO; withdrawal at each boundary never publishes',async()=>{
 for(const boundary of ['none','content','hash','input','import','dto','verification']){
  const f=fixture(),candidate=captureExperienceNativeResult(f.identity,f.job,f.current,f.now),trace={reads:[],imports:[],verified:0,published:0},state={...f.expected,output:'storyboard',plan:{revisionId:'revision',targetId:'target',targetContractDigest:'target-digest',sourceDigest:'source-digest'},original:{jobId:'job',slotId:'slot',grantId:'grant',correlationId:'corr'}};
  let current=true,published,finished=false;
  const operation={wait:value=>value},binding={storyboardSource:f.source,ownerId:'owner',client:{identity:{output:'storyboard'}}};
  const render=()=>{throw Error('No DOM rendering in source control');};
  const context={binding,busy:false,readable:()=>current,visible:()=>current,baseCurrent:()=>current,beginOperation:()=>operation,operationCurrent:()=>!finished,finishOperation:()=>{finished=true;return true;},resetDecision(){},requestUpdate(){},refreshAndRead:async()=>{},state:()=>state,snapshotMatches:()=>current,candidate:()=>candidate,scheduleDeadline(){},ownerDocument:{location:{origin:'https://forma.test'}},
   clearResult(){this.reader?.abort();this.reader=undefined;published=undefined;},
   store:{outputRequirements:{ensure:async()=>{}},inspectOutputNativeJob:async()=>({status:'found',job:f.job,current:()=>current}),
    ensurePrivateContent:async ref=>{trace.reads.push(ref);if(boundary===(ref==='content'?'content':'input'))current=false;return ref==='content'?f.raw:f.rawInput;}}};
  Object.defineProperty(context,'result',{get:()=>published,set:value=>{published=value;trace.published++;}});
  const check=hostMethod('async #check(','#stopResultRead()',{
   bindingJson:canonicalJson,experienceResultGrantCurrent:()=>true,crypto:{subtle:{digest:async(...args)=>{const hash=await crypto.subtle.digest(...args);if(boundary==='hash')current=false;return hash;}}},
   loadModule:async path=>{trace.imports.push(path);if(boundary==='import')current=false;
    return path.includes('retained-short-story-client')?{readNativeRetainedOutput:async(selector,options)=>{assert.deepEqual(selector,{output:'storyboard',selection:f.dto.selection});assert.equal(options.current(),true);assert(options.signal instanceof AbortSignal);if(boundary==='dto')current=false;return f.dto;}}:{renderNativeRetainedStoryboard:render};},
   verifyExperienceStoryboardRead:async(...args)=>{trace.verified++;const valid=await verifyExperienceStoryboardRead(...args);if(boundary==='verification')current=false;return valid;}
  });
  await check.call(context);assert.equal(context.busy,false);
  if(boundary==='none'){assert.equal(trace.published,1);assert.equal(context.result.storyboard,f.dto);assert.equal(context.result.render,render);assert.equal(context.result.current(),true);current=false;assert.equal(context.result.current(),false);}
  else{assert.equal(trace.published,0,boundary);assert.equal(context.result,undefined,boundary);}
  if(['content','hash'].includes(boundary)){assert.deepEqual(trace.reads,['content']);assert.deepEqual(trace.imports,[]);}
  if(['input','import'].includes(boundary))assert.equal(trace.verified,0);
 }
});
test('actual host deadline survives spend expiry, then removes all private Storyboard nodes at retained expiry without input',()=>{
 let now=1000,next=0;const timers=new Map(),trace={aborts:0,removedSrc:0,removed:0,emptied:0,decisions:0};
 const clear=hostMethod('#clearResult()','#storySync =');
 const context={reader:{abort(){trace.aborts++;}},querySelectorAll:selector=>['forma-native-retained-audio','forma-model3d-viewer'].includes(selector)?[]:selector.startsWith('img')?Array.from({length:4},()=>({removeAttribute:name=>{assert.equal(name,'src');trace.removedSrc++;}})):[{replaceChildren(){trace.emptied++;},remove(){trace.removed++;}}],
 resetDecision(){trace.decisions++;},requestUpdate(){},clearResult(){clear.call(this);},state:()=>({grant:{expiresAt:new Date(1100).toISOString()}})};
 context.result={output:'storyboard',candidate:{expiresAt:new Date(1400).toISOString()},storyboard:{expiresAt:new Date(1250).toISOString()},current:()=>now<1250};
 const deadline=hostMethod('#scheduleDeadline()','#imageReady(',{Date:{now:()=>now,parse:Date.parse},setTimeout:(callback,delay)=>{const id=++next;timers.set(id,{callback,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)});
 context.scheduleDeadline=()=>deadline.call(context);context.scheduleDeadline();
 const tick=()=>{const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;timer.callback();};
 tick();assert.equal(now,1100);assert(context.result);assert.equal(trace.removed,0);
 tick();assert.equal(now,1250);assert.equal(context.result,undefined);assert.equal(trace.aborts,1);assert.equal(trace.removedSrc,4);assert.equal(trace.emptied,1);assert.equal(trace.removed,1);assert.equal(trace.decisions,2);
});
test('actual same-Document Edit selects original revision/hash and refuses a superseded read lease',async()=>{
 const {artifactFocusRoute}=await import('../src/model/routes.ts');
 const {withExperienceReportFlag}=await import('../src/experiences/host-route.ts');
 const f=fixture(),calls=[];let current=true,supersede=false;
 const result={output:'storyboard',storyboard:f.dto,current:()=>current},binding={plan:{documentId:'doc'},route:'/document/doc?progress-report'};
 const context={result,binding,busy:false,visible:()=>current};
 const edit=hostMethod('async #edit()','captureCommandDeparture()',{
  artifactFocusRoute,withExperienceReportFlag,navigateInApp:async(element,callback)=>{if(supersede)element.result={};return callback({current:()=>true,route:(path,options)=>{calls.push({path,options});return true;}});}
 });
 await edit.call(context);assert.equal(calls.length,1);const url=new URL(calls[0].path,'https://forma.test');assert.equal(url.searchParams.get('document'),'doc');assert(url.searchParams.has('progress-report'));assert(calls[0].path.includes(f.dto.selection.contentSha256));assert.deepEqual(calls[0].options,{documentFocus:false});
 supersede=true;await edit.call(context);assert.equal(calls.length,1);
 context.result=result;current=false;await edit.call(context);assert.equal(calls.length,1);
});
