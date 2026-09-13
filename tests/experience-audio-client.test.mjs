import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createAudioOutputContract} from '../src/model/output-audio-contract.ts';
import {EXPERIENCE_AUDIO_INTENT} from '../src/experiences/contracts.ts';
import {captureExperienceAudioTarget} from '../src/experiences/audio-target.ts';
import {captureExperienceAudioEvidence,verifyExperienceAudioInput} from '../src/experiences/audio-native-result.ts';
import {captureExperienceNativeResult} from '../src/experiences/native-result-association.ts';
import {decodeExperienceBinding,ExperienceOutputBindingClient,experienceResultGrantCurrent,bindingJson} from '../src/experiences/output-binding-client.ts';
import {outputTerms} from '../src/experiences/output-terms.ts';
import {parseExperienceHostRoute,experienceHostRoute} from '../src/experiences/host-route.ts';
import {experienceOutputSettings} from '../src/experiences/native-host.ts';
const previousFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('AUDIO_CLIENT_TEST_EGRESS_DENIED');};
after(()=>{globalThis.fetch=previousFetch;});
const sha=value=>createHash('sha256').update(value).digest('hex'),clone=structuredClone;
function fixture(){
 const source={draftId:'experience-draft-'+'d'.repeat(64),draftHash:'sha256:'+'a'.repeat(64),releaseHash:'sha256:'+'b'.repeat(64),requestHash:'sha256:'+'c'.repeat(64),sourceBindingHash:'sha256:'+'e'.repeat(64)};
 const contract=createAudioOutputContract(source),model='fal-ai/stable-audio-3/medium/text-to-audio';
 const identity={...source,documentId:'document',projectId:'project',output:'audio',actorUserId:'actor'};
 const preview={version:'audio-mini-app-cost-v1',requestId:'audio-'+'a'.repeat(64),actorUserId:'actor',projectId:'project',documentId:'document',draftId:source.draftId,sourceDigest:'a'.repeat(64),requirementsDigest:'b'.repeat(64),expiresAt:'2099-01-01T00:00:00.000Z',maximumMicrousd:1037600,maximumCalls:3,maximumTokens:128000,planningModel:'gpt-5.6-terra',maximumPlanningCalls:2,maximumOutputTokens:3000,audioModel:model,maximumAudioCalls:1,durationSeconds:20,requireInstrumental:true,sourceFilesTransferred:0};
 const plan={revisionId:'plan',targetId:'target',targetContractDigest:'c'.repeat(64),sourceDigest:preview.sourceDigest,requirementsDigest:preview.requirementsDigest};
 const target={id:'target',media_kind:'audio',quantity:{kind:'exact',unit:'episode',value:1},audio_contract:contract,source_scope:{kind:'document'},coverage:{kind:'document_context'},aspect_ratio:null,content_quantity:null,count_policy:null,variant_id:null,member_id:null,suggested_count:null};
 const calls=['planning:0:initial','planning:0:repair'].map(stage=>({stage,provider:'openai',model:'gpt-5.6-terra',maximumMicrousd:500000,maximumInputTokens:30000,maximumOutputTokens:3000}));calls.push({stage:'audio:initial',provider:'fal',model,maximumMicrousd:37600});
 const original={requestId:preview.requestId,expiresAt:preview.expiresAt,draftId:source.draftId,actorUserId:'actor',projectId:'project',documentId:'document',sourceDigest:preview.sourceDigest,requirementsDigest:preview.requirementsDigest};
 const settings={kind:'render_document',payload:{productionMode:'manual',artifactKind:'audio',itemCount:1,audioProfile:EXPERIENCE_AUDIO_INTENT,audioProviderModel:model,audioEstimatedCostMicrousd:37600,outputTargetInstructions:'One instrumental track',outputAudio:contract},calls,preparationOnly:false,explicitCostAndTransferApprovalRequired:true,executionAvailable:true,costPreview:preview,executionPolicy:{maximumMilliseconds:240000,heartbeatMilliseconds:60000,maximumRenewals:3},original,constraints:{model},duration:{requestedSeconds:20,measuredSeconds:null}};
 const preflight={id:'quote',planRevisionId:'plan',termsDigest:'terms',sourceDigest:plan.sourceDigest,requirementsDigest:plan.requirementsDigest,createdAt:'2026-01-01T00:00:00.000Z',expiresAt:preview.expiresAt,maximumMicrousd:preview.maximumMicrousd,maximumCalls:3,operationAttempts:{target:{ordinal:0,previousSlotId:null}},targets:[{targetId:'target',available:true,reasonCode:'output_audio_ready_for_separate_approval',reason:'Fixed Audio',transferCode:'output_transfer_audio_not_yet_authorized',transferDescription:'After explicit approval',provider:'fal',model,route:'document-audio-timed-music-manual-v1',maximumMicrousd:preview.maximumMicrousd,maximumCalls:3,maximumTokens:128000,settings}]};
 const state={version:1,draftId:source.draftId,draftHash:source.draftHash,releaseHash:source.releaseHash,documentId:'document',projectId:'project',output:'audio',sourceSurface:'outputs',audioCostPreview:preview,status:'review',disposition:'prepared',current:{custody:'verified',source:'verified',sourceDigest:plan.sourceDigest,requirementsDigest:plan.requirementsDigest},stage:'preflight',plan,preflight,grant:null,original:null,permitted:{prepare:false,authorize:true,run:false,resumeRun:false}};
 const execution={scopeKey:'personal:actor:document',grantId:'grant',slotId:'slot',planRevisionId:'plan',targetId:'target',targetContractDigest:plan.targetContractDigest,sourceDigest:plan.sourceDigest};
 const body=JSON.stringify({prompt:'Quiet piano',duration:20,output_format:'mp3',enable_safety_checker:true,negative_prompt:'singing, vocals, spoken dialogue'});
 const receipt={schemaVersion:1,contract,plannerCallIds:['planner'],mediaCallId:'media',providerRequestId:'provider-media',requestDigest:sha(body),requestedSeconds:20,measuredSeconds:null,requirementFulfilled:false};
 const evidence=captureExperienceAudioEvidence({output_audio:contract,output_audio_execution:execution,output_audio_receipt:receipt,source_media_sha256:'f'.repeat(64)});
 const expected={documentId:'document',projectId:'project',artifactId:'artifact',jobId:preview.requestId,plannerResponseId:'provider-plan',usedMicrousd:38400,usedCalls:2,source,costPreview:preview,...Object.fromEntries(Object.entries(execution).filter(([k])=>k!=='scopeKey'))};
 const submitted=[{clientRequestId:'planner',operation:'planning',provider:'openai',model:'gpt-5.6-terra',effectiveModel:'gpt-5.6-terra',status:'completed',providerRequestId:'provider-plan',responseRef:'private-envelope',unitId:'planning:0:initial',costMicrousd:800,totalTokens:150,validationStatus:'valid',completionStatus:'completed'},
 {clientRequestId:'media',operation:'audio',provider:'fal',model,status:'completed',providerRequestId:'provider-media',unitId:'audio:initial',requestDigest:receipt.requestDigest,costMicrousd:37600,totalTokens:0}];
 const input={schema_version:1,artifact_id:'artifact',artifact_kind:'audio',document_id:'document',project_id:'project',output_audio:contract,output_audio_execution:execution,
 request:{item_count:1,source_surface:'outputs',production_mode:'manual',audio_profile:EXPERIENCE_AUDIO_INTENT,audio_image_block_id:null,audio_video_artifact_id:null,audio_video_provider_transfer:false,soundtrack_provider_transfer:false,soundtrack_block_ids:[]},
 output_audio_calls:submitted,output_audio_request:{contract,requestBody:body,clientRequestId:'media',requestDigest:receipt.requestDigest},planner:{provider:'openai',model:'gpt-5.6-terra',response_id:'provider-plan'},
 render:{provider:'fal',model,provider_job_id:'provider-media',submitted_prompt:'Quiet piano',parameters:{provider_parameters:{duration:20,output_format:'mp3',enable_safety_checker:true,negative_prompt:'singing, vocals, spoken dialogue'},goal:'timed_music',destination:'standalone',duration_seconds:20,image_reference_count:0,audio_waveform_submitted:false,semantic_audio_reference_count:0},
 image_reference:null,audio_waveform_submitted:false,source_audio_block_ids:[],source_audio_treatment:'none'}};
 return {identity,source,contract,preview,plan,target,state,evidence,execution,receipt,expected,input};
}
test('Audio route and fixed native settings preserve one original Document and reject foreign/duplicate selectors',()=>{
 const f=fixture(),route=experienceHostRoute('/document/document','audio',f.source.draftId);
 assert.equal(parseExperienceHostRoute(route).output,'audio');assert.equal(parseExperienceHostRoute(route).documentId,'document');
 assert.equal(parseExperienceHostRoute(route+'&experience=audio'),null);assert.equal(parseExperienceHostRoute('//foreign'+route),null);
 assert.deepEqual(experienceOutputSettings({release:{output:{output:'audio'}}}).audioProfile,EXPERIENCE_AUDIO_INTENT);
 assert.equal(captureExperienceAudioTarget(f.target,f.source).source.draftId,f.source.draftId);
 for(const altered of [{...f.target,scene_contract:{}},{...f.target,quantity:{kind:'exact',unit:'episode',value:2}},{...f.target,audio_contract:{...f.contract,durationSeconds:30}}])assert.equal(captureExperienceAudioTarget(altered,f.source),null);
});
test('actual host read stops before private input or player import when ownership withdraws across either await',async()=>{
 const f=fixture(),Actual=actualMethods(['check'],{bindingJson,experienceResultGrantCurrent:()=>true,verifyExperienceAudioInput});
 for(const boundary of ['hash','input']){
  const host=new Actual(),reads=[],state={...f.state,status:'succeeded',original:{jobStatus:'completed',jobId:f.preview.requestId},grant:{usedMicrousd:38400,usedCalls:2}};
  const binding={audioSource:f.source,ownerId:'actor'},candidate={output:'audio',jobId:f.preview.requestId,artifactId:'artifact',contentRef:'content',inputRef:'input',plannerResponseId:'provider-plan',audio:f.evidence,expiresAt:'2099-01-01T00:00:00.000Z'};
  let current=true;const operation={wait:async promise=>{const result=await promise;if(boundary==='hash'&&result instanceof ArrayBuffer)current=false;return result;}};
  Object.assign(host,{_binding:binding,_busy:false,_readable:()=>true,_visible:()=>current,_beginOperation:()=>operation,_operationCurrent:()=>true,
   _clearResult(){this._result=undefined;},_resetDecision(){},requestUpdate(){},_refreshAndRead:async()=>{},_state:()=>state,_snapshotMatches:()=>true,_candidate:()=>candidate,
   _baseCurrent:()=>true,_finishOperation:()=>true,_scheduleDeadline(){},_scheduleResultRead(){},
   store:{outputRequirements:{ensure:async()=>{}},inspectOutputNativeJob:async()=>({status:'found',current:()=>true,job:{status:'completed'}}),
    ensurePrivateContent:async ref=>{reads.push(ref);if(ref==='input'){current=false;return JSON.stringify(f.input);}return '{}';}}});
  await host._check();
  assert.deepEqual(reads,boundary==='hash'?['content']:['content','input']);assert.equal(host._result,undefined);assert.equal(host._status,'Result unavailable');
 }
});
test('Audio display accepts the exact three-call source-bound quote and refuses invented approval, model/cap/duration drift',()=>{
 const f=fixture(),options={now:Date.parse('2026-09-13T00:00:00.000Z'),output:'audio',targetId:'target',expectedAudioContract:f.contract,audioCostPreview:f.preview};
 const terms=outputTerms(f.state.preflight,options);assert.equal(terms.available,true);assert.equal(terms.targets[0].calls.length,3);
 for(const change of [s=>s.payload.budgetAcknowledged=true,s=>s.calls[2].model='foreign',s=>s.duration.measuredSeconds=20,s=>s.costPreview.documentId='foreign',s=>s.calls[0].maximumOutputTokens=6000]){
  const quote=clone(f.state.preflight);change(quote.targets[0].settings);assert.equal(outputTerms(quote,options).available,false);
 }
 assert.equal(outputTerms(f.state.preflight,{...options,now:Date.parse(f.preview.expiresAt)}).available,false);
});
test('exact Audio preview identity is mandatory and the client never manufactures either confirmation',async()=>{
 const f=fixture();assert.ok(decodeExperienceBinding(f.state,f.identity));
 for(const change of [s=>delete s.audioCostPreview,s=>s.audioCostPreview.actorUserId='foreign',s=>s.audioCostPreview.sourceDigest='f'.repeat(64),s=>s.sceneCostPreview=null]){
  const state=clone(f.state);change(state);assert.equal(decodeExperienceBinding(state,f.identity),null);
 }
 const calls=[],origin='https://forma.local';const request=async(path,init)=>{calls.push({path,init});const response=Response.json(f.state);Object.defineProperty(response,'url',{value:origin+path});return response;};
 const client=new ExperienceOutputBindingClient(f.identity,{origin,current:()=>true,request});
 const shown=await client.read();
 for(const approval of [undefined,{...f.preview,confirmed:true},{...f.preview,confirmed:true,providerTransferConfirmed:false}]){
  await client.command('authorize',shown,undefined,approval);assert.equal(calls.length,1);
 }
 await client.command('authorize',shown,undefined,{...f.preview,confirmed:true,providerTransferConfirmed:true});
 assert.equal(calls.length,2);assert.equal(calls[1].init.method,'POST');assert.equal(JSON.parse(calls[1].init.body).audioCostConsent.providerTransferConfirmed,true);
 client.dispose();
});
test('completed original Audio reads survive only spending expiry, never job expiry or paid permission revival',()=>{
 const f=fixture(),state={...f.state,status:'succeeded',disposition:'original_run_recorded',grant:{status:'completed'},permitted:{prepare:false,authorize:false,run:false,resumeRun:false},
 original:{expiresAt:'2026-01-01T00:00:00.000Z',jobExpiresAt:'2099-01-01T00:00:00.000Z',run:{key:'run',eventId:'event'},jobStatus:'completed',slotStatus:'succeeded',grantStatus:'completed'}};
 assert.equal(experienceResultGrantCurrent(state,Date.now()),true);
 assert.equal(experienceResultGrantCurrent({...state,permitted:{...state.permitted,run:true}},Date.now()),false);
 assert.equal(experienceResultGrantCurrent({...state,original:{...state.original,jobExpiresAt:'2026-01-01T00:00:00.000Z'}},Date.now()),false);
});
test('one original Audio input and media request verify without inferring duration or quality',async()=>{
 const f=fixture();assert.ok(f.evidence);assert.equal(await verifyExperienceAudioInput(JSON.stringify(f.input),f.evidence,f.expected),true);
 assert.equal(f.evidence.receipt.requirementFulfilled,false);assert.equal(f.evidence.receipt.measuredSeconds,null);
 for(const change of [i=>i.document_id='foreign',i=>i.output_audio_calls[1].providerRequestId='foreign',i=>i.output_audio_calls[0].status='accepted',
 i=>i.output_audio_calls.push(clone(i.output_audio_calls[0])),i=>i.output_audio_request.requestBody=i.output_audio_request.requestBody.replace('Quiet','Loud'),
 i=>i.render.parameters.provider_parameters.duration=30,i=>i.render.audio_waveform_submitted=true,i=>i.request.audio_video_artifact_id='foreign']){
  const input=clone(f.input);change(input);assert.equal(await verifyExperienceAudioInput(JSON.stringify(input),f.evidence,f.expected),false);
 }
 assert.equal(await verifyExperienceAudioInput(JSON.stringify(f.input),f.evidence,{...f.expected,slotId:'foreign'}),false);
 for(const patch of [{plannerResponseId:'foreign'},{usedMicrousd:37600},{usedCalls:3}])assert.equal(await verifyExperienceAudioInput(JSON.stringify(f.input),f.evidence,{...f.expected,...patch}),false);
});
test('metadata accessors, sparse or custom iterator arrays and invented fulfillment refuse without invoking them',()=>{
 const f=fixture(),settings={output_audio:f.contract,output_audio_execution:f.execution,output_audio_receipt:f.receipt,source_media_sha256:'f'.repeat(64)};
 let invoked=0;const accessor={...settings};Object.defineProperty(accessor,'output_audio_receipt',{enumerable:true,get(){invoked++;return f.receipt;}});
 assert.equal(captureExperienceAudioEvidence(accessor),null);assert.equal(invoked,0);
 const receipt={...f.receipt,plannerCallIds:['planner']};receipt.plannerCallIds[Symbol.iterator]=()=>{invoked++;throw Error('iterator');};
 assert.equal(captureExperienceAudioEvidence({...settings,output_audio_receipt:receipt}),null);assert.equal(invoked,0);
 assert.equal(captureExperienceAudioEvidence({...settings,output_audio_receipt:{...f.receipt,measuredSeconds:20,requirementFulfilled:true}}),null);
});
test('original Audio candidate joins one worker completion, current revision, exact input and owned media only',()=>{
 const f=fixture(),expiresAt='2099-01-01T00:00:00.000Z',identity={output:'audio',documentId:'document',projectId:'project',ownerUserId:'actor',jobId:f.preview.requestId,correlationId:'correlation',expiresAt};
 const settings={output_audio:f.contract,output_audio_execution:f.execution,output_audio_receipt:f.receipt,source_media_sha256:'f'.repeat(64)};
 const payload={artifact_id:'artifact',document_id:'document',project_id:'project',artifact_kind:'audio',source_surface:'outputs',content_ref:'content',input_ref:'input',item_count:1,requested_by_user_id:'actor',content_expires_at:expiresAt,input_expires_at:expiresAt,provider:'fal',model_id:f.preview.audioModel,provider_job_id:'provider-media',planner_model_id:'gpt-5.6-terra',planner_response_id:'provider-plan',media_url:'/api/media/owned.mp3',media_type:'audio/mpeg',presentation:null,used_reference_pixels:false,reference_inputs:[],settings};
 const event={type:'DocumentRenderCompleted',eventId:'event',correlationId:'correlation',streamId:'creative:actor',actor:'worker:renderer',payload};
 const artifact={id:'artifact',documentId:'document',kind:'audio',itemCount:1,sourceEventId:'event',sourceSurface:'outputs',contentRef:'content',inputRef:'input',mediaUrl:payload.media_url,settings};
 const job={jobId:identity.jobId,documentId:'document',sourceSurface:'outputs',status:'completed',kind:'render_document',result:{artifactId:'artifact',artifactKind:'audio',appendedEventIds:['event']}};
 const current={documentId:'document',projectId:'project',documents:[{id:'document',projectId:'project',removed:false}],events:[event],artifacts:[artifact],outputs:[]};
 assert.equal(captureExperienceNativeResult(identity,job,current).output,'audio');
 assert.equal(captureExperienceNativeResult(identity,job,{...current,events:[event,event]}),null);
 assert.equal(captureExperienceNativeResult(identity,job,{...current,events:[event,{type:'DocumentArtifactEdited',payload:{artifact_id:'artifact'}}]}),null);
 assert.equal(captureExperienceNativeResult(identity,job,{...current,artifacts:[{...artifact,inputRef:'foreign'}]}),null);
 assert.equal(captureExperienceNativeResult(identity,job,current,Date.parse(expiresAt)),null);
});
const require=createRequire(import.meta.url),ts=require('typescript'),hostSource=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8');
function actualMethods(names,bindings={}){
 const ast=ts.createSourceFile('host.ts',hostSource,ts.ScriptTarget.Latest,true),klass=ast.statements.find(s=>ts.isClassDeclaration(s)&&s.name?.text==='FormaExperienceHost');
 const methods=names.map(name=>{const member=klass.members.find(m=>m.name?.getText(ast)==='#'+name);assert.ok(member);return member.getText(ast).replace(/#/gu,'_');}).join('\n');
 const code=ts.transpileModule('class Actual {'+methods+'}',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return Function(...Object.keys(bindings),code+';return Actual;')(...Object.values(bindings));
}
test('actual host clearing synchronously retires player before detach and clears its private result lease',()=>{
 const Actual=actualMethods(['clearResult']),host=new Actual(),actions=[],leaf={set result(v){assert.equal(v,null);actions.push('retire-media');},remove(){actions.push('detach');}};
 host._reader={abort(){actions.push('abort-reader');}};host._result={private:'old'};host.querySelectorAll=selector=>selector==='forma-native-retained-audio'?[leaf]:[];
 host._clearResult();assert.deepEqual(actions,['abort-reader','retire-media','detach']);assert.equal(host._result,undefined);
});
test('actual host consent requires both current user decisions, original actor and preview',async()=>{
 const {audioMiniAppCostApprovalMatches}=await import('../src/model/audio-mini-app-consent.ts'),f=fixture(),Actual=actualMethods(['audioConsent'],{audioMiniAppCostApprovalMatches}),host=new Actual();
 host._binding={ownerId:'actor',plan:{draftId:f.source.draftId,documentId:'document',projectId:'project'}};host._audioApproval=true;host._approval=false;
 assert.equal(host._audioConsent(f.state),null);host._approval=true;assert.equal(host._audioConsent(f.state).providerTransferConfirmed,true);
 assert.equal(host._audioConsent({...f.state,audioCostPreview:{...f.preview,actorUserId:'foreign'}}),null);
});
