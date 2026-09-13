import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { canonicalJson, digest } from '../src/experiences/compiler.ts';
import { scenePreflightFixture } from './helpers/scene-output-fixture.mjs';
import { sceneScreenplayText } from '../src/model/scene-screenplay.ts';
import { captureExperienceSceneEvidence, readExperienceNativeScene } from '../src/experiences/scene-native-result.ts';
import { captureExperienceNativeResult } from '../src/experiences/native-result-association.ts';
import { measureOutputSceneLayout } from '../worker/output-scene-layout.ts';

const sha = text => createHash('sha256').update(text).digest('hex');
// Unadmitted parser data only: these plain objects are neither original server
// authority nor provider/cost/full-journey evidence. No grant or command is made.
async function fixture() {
  const { outputScene: { contract, sceneContract, costPreview } } = await scenePreflightFixture();
  const now = Date.parse('2026-09-13T04:00:00.000Z'), expiresAt = '2026-09-13T04:04:00.000Z';
  const displaySource = { characters: [{id:'A', name:'Alex'}, {id:'B', name:'Alex'}], location:'Waiting room' };
  const screenplay = { schemaVersion:1, format:'forma-screenplay@1', heading:{setting:'INT.',location:'location',time:'NIGHT'}, blocks:[
    {kind:'action',text:'  A letter waits.\n\n<b>Literal ink</b>  '},
    {kind:'dialogue',speaker:'A',parenthetical:null,text:'I will stay.'},
    {kind:'dialogue',speaker:'B',parenthetical:'quietly',text:'Then I must leave.'},
  ]};
  const body = sceneScreenplayText(screenplay, displaySource), title = 'The door';
  const raw = JSON.stringify({title,summary:'Two people wait.',content_markdown:body,presentation:null,
    items:[{title,body,notes:'',image_prompt:'',context_group_ids:[],slide:null}],scene_screenplay:screenplay});
  const fields = {
    scene_output_contract:sceneContract,scene_output_contract_digest:await digest(sceneContract),scene_cost_binding_hash:costPreview.bindingHash,
    scene_adapter_specification_digest:contract.adapterRequestDigest,scene_source_request_digest:contract.sourceRequestDigest,
    scene_compiled_input_sha256:contract.compiledInputSha256,scene_request_sha256:'1'.repeat(64),scene_envelope_sha256:'2'.repeat(64),
    scene_candidate_sha256:'3'.repeat(64),scene_screenplay_sha256:sha(canonicalJson(screenplay)),scene_body_sha256:sha(body),
    scene_layout:{status:'unqualified',reason:'unsupported-profile',pageCount:null},
    validation:{status:'structure_valid_layout_unqualified',maximum_provider_calls:1,provider_call_count:1,
      provider_response_ids:['response-test'],repair_attempted:false,requirement_fulfilled:false},
  };
  const call = {clientRequestId:'forma-scene-00000000-0000-4000-8000-000000000001',provider:'openai',operation:'planning',model:costPreview.model,effectiveModel:costPreview.model,
    status:'completed',completionStatus:'completed',validationStatus:'valid',unitId:contract.stage,requestDigest:fields.scene_request_sha256,
    providerRequestId:'response-test',responseRef:'test-envelope-ref'};
  const input = {schema_version:1,artifact_id:'artifact-test',artifact_kind:'scene',document_id:costPreview.documentId,project_id:costPreview.projectId,
    request:{source_surface:'outputs',production_mode:'manual',item_count:1},planner:{provider:'openai',model:costPreview.model,response_id:'response-test',
      output_scene:contract,provider_calls:[call],...structuredClone(fields)}};
  const rawInput = JSON.stringify(input), settings = {...fields,scene_content_sha256:sha(raw),scene_input_sha256:sha(rawInput)};
  const expected = {documentId:costPreview.documentId,projectId:costPreview.projectId,artifactId:'artifact-test',providerResponseId:'response-test',expiresAt,
    source:sceneContract.source,costPreview,displaySource};
  const identity = {output:'scene',documentId:costPreview.documentId,projectId:costPreview.projectId,ownerUserId:costPreview.actorUserId,
    jobId:costPreview.requestId,correlationId:'correlation-test',expiresAt:costPreview.expiresAt};
  const payload = {document_id:identity.documentId,project_id:identity.projectId,artifact_id:expected.artifactId,artifact_kind:'scene',item_count:1,
    source_surface:'outputs',content_ref:'content-test',input_ref:'input-test',content_expires_at:expiresAt,input_expires_at:costPreview.expiresAt,
    requested_by_user_id:identity.ownerUserId,planner_response_id:expected.providerResponseId,provider:'openai',planner_model_id:costPreview.model,
    media_url:null,media_type:null,presentation:null,settings};
  const event = {type:'DocumentRenderCompleted',eventId:'event-test',correlationId:identity.correlationId,streamId:'creative:'+identity.ownerUserId,actor:'worker:renderer',payload};
  const artifact = {id:expected.artifactId,documentId:identity.documentId,kind:'scene',itemCount:1,sourceEventId:event.eventId,sourceSurface:'outputs',
    contentRef:payload.content_ref,inputRef:payload.input_ref,settings:structuredClone(settings)};
  const current = {documentId:identity.documentId,projectId:identity.projectId,documents:[{id:identity.documentId,projectId:identity.projectId,removed:false}],
    artifacts:[artifact],outputs:[],events:[event]};
  const job = {jobId:identity.jobId,documentId:identity.documentId,sourceSurface:'outputs',kind:'render_document',status:'completed',
    result:{artifactId:expected.artifactId,artifactKind:'scene',appendedEventIds:[event.eventId]}};
  return {now,raw,rawInput,input,settings,expected,identity,payload,event,artifact,current,job};
}

test('Scene association joins one original event, both references and their shorter expiry', async () => {
  const f=await fixture(), candidate=captureExperienceNativeResult(f.identity,f.job,f.current,f.now);
  assert.equal(candidate.output,'scene'); assert.equal(candidate.inputRef,'input-test'); assert.equal(candidate.expiresAt,f.expected.expiresAt);
  const result=await readExperienceNativeScene(f.raw,f.rawInput,candidate.scene,f.expected,f.now);
  assert.equal(result.content.qualification,'content-only'); assert.equal(result.layout.status,'unqualified');
  assert.match(result.content.body,/<b>Literal ink<\/b>/); assert.equal(result.content.selection.revision,0);
  assert.ok(Object.isFrozen(result)); assert.equal('requirementFulfilled' in result,false);
});

test('Scene cannot adopt edited, foreign, duplicate or expired native records', async () => {
  for (const mutate of [f=>f.job.jobId='other',f=>f.job.sourceSurface='document',f=>f.job.status='running',
    f=>f.event.correlationId='other',f=>f.current.events.push(f.event),f=>f.artifact.inputRef='other',
    f=>f.payload.input_expires_at=new Date(f.now).toISOString(),f=>f.payload.planner_response_id='',f=>f.payload.item_count=2,
    f=>f.payload.media_url='/elsewhere',f=>f.artifact.settings.scene_body_sha256='a'.repeat(64),
    f=>f.current.events.push({type:'DocumentArtifactEdited',payload:{artifact_id:f.artifact.id}})]) {
    const f=await fixture();mutate(f);assert.equal(captureExperienceNativeResult(f.identity,f.job,f.current,f.now),null);
  }
});

test('both private hashes, exact original source, execution contract and provider receipt are required', async () => {
  for (const mutate of [f=>f.raw+=' ',f=>f.rawInput+=' ',f=>f.expected.source={...f.expected.source,sourceBindingHash:'sha256:'+'0'.repeat(64)},
    f=>f.expected.costPreview={...f.expected.costPreview,bindingHash:'0'.repeat(64)},f=>f.expected.displaySource.location='Other room',
    f=>f.expected.providerResponseId='different',f=>f.input.document_id='different',f=>f.input.planner.provider_calls.push(f.input.planner.provider_calls[0]),
    f=>f.input.planner.provider_calls[0].requestDigest='0'.repeat(64),f=>f.input.planner.provider_calls[0].status='pending',
    f=>f.input.planner.output_scene={...f.input.planner.output_scene,input:'{}'},f=>f.input.planner.scene_body_sha256='0'.repeat(64)]) {
    const f=await fixture(), inputBefore=JSON.stringify(f.input);mutate(f);
    if(JSON.stringify(f.input)!==inputBefore){f.rawInput=JSON.stringify(f.input);f.settings.scene_input_sha256=sha(f.rawInput);}
    const evidence=captureExperienceSceneEvidence(f.settings);
    assert.equal(await readExperienceNativeScene(f.raw,f.rawInput,evidence,f.expected,f.now),null);
  }
});

test('layout claims must agree with fixed policy and cannot be copied into unqualified content', async () => {
  const f=await fixture();
  for(const change of [{validation:{...f.settings.validation,requirement_fulfilled:true}},
    {scene_layout:{status:'qualified',pageCount:1}}, {scene_output_contract_digest:'bad'}, {scene_content_sha256:'bad'}]) {
    assert.equal(captureExperienceSceneEvidence({...f.settings,...change}),null);
  }
  let calls=0;const settings={...f.settings};Object.defineProperty(settings,'scene_body_sha256',{enumerable:true,get(){calls++;return 'a'.repeat(64);}});
  assert.equal(captureExperienceSceneEvidence(settings),null);assert.equal(calls,0);
});

test('private read snapshots metadata before hashing and refuses oversized inputs', async () => {
  const f=await fixture(), evidence=captureExperienceSceneEvidence(f.settings), expected=structuredClone(f.expected);
  const pending=readExperienceNativeScene(f.raw,f.rawInput,evidence,expected,f.now);
  expected.displaySource.location='Changed';expected.expiresAt=new Date(f.now).toISOString();
  const result=await pending;assert.equal(result.content.selection.displaySource.location,'Waiting room');
  assert.equal(await readExperienceNativeScene(f.raw,' '.repeat(1_000_001),evidence,f.expected,f.now),null);
});

test('qualified server layout binds the same private screenplay and exact display labels', async () => {
  const f=await fixture(), font=readFileSync(new URL('../public/fonts/dm-mono/DMMono-Regular-55b4c98f.ttf',import.meta.url));
  const layout=await measureOutputSceneLayout(JSON.parse(f.raw).scene_screenplay,f.expected.displaySource,font.buffer.slice(font.byteOffset,font.byteOffset+font.byteLength));
  assert.equal(layout.status,'layout-candidate');assert.equal(layout.pageRangeSatisfied,true);
  const qualified={status:'qualified',profile:layout.profile,fontSha256:layout.fontSha256,metricsSha256:layout.metricsSha256,policySha256:layout.policySha256,
    screenplaySha256:layout.screenplaySha256,bodySha256:layout.bodySha256,displaySourceSha256:layout.displaySourceSha256,pagesSha256:layout.pagesSha256,pageCount:layout.pagination.pageCount};
  f.settings.scene_layout=qualified;f.settings.validation={...f.settings.validation,status:'structure_valid_layout_verified',requirement_fulfilled:true};
  f.input.planner.scene_layout=qualified;f.input.planner.validation=f.settings.validation;f.rawInput=JSON.stringify(f.input);f.settings.scene_input_sha256=sha(f.rawInput);
  const evidence=captureExperienceSceneEvidence(f.settings),result=await readExperienceNativeScene(f.raw,f.rawInput,evidence,f.expected,f.now);
  assert.equal(result.layout.status,'qualified');assert.equal(result.layout.pagesSha256,layout.pagesSha256);
  assert.equal(result.content.qualification,'content-only'); // Layout metadata never authorizes a job or fulfills a target here.
  const changed=structuredClone(f.expected);changed.displaySource.characters[0].name='Someone else';
  assert.equal(await readExperienceNativeScene(f.raw,f.rawInput,evidence,changed,f.now),null);
});

test('actual host joins private Scene reads, compares measured pages, retires prose and routes Edit by exact revision', () => {
  const host=readFileSync(new URL('../src/components/forma-experience-host.ts',import.meta.url),'utf8');
  const branch=host.slice(host.indexOf('if (candidate.output === "scene")'),host.indexOf('} else if (candidate.output === "short_story")'));
  assert.match(branch,/ensurePrivateContent\(candidate\.inputRef, \{ force: true \}\)/);
  assert.match(branch,/readExperienceNativeScene\(raw, input, candidate\.scene/);
  assert.match(branch,/readExperienceSceneFont/);assert.match(branch,/digest\(presentation\.packed\.pages\)/);
  assert.match(branch,/scene\.layout\.pagesSha256/);assert.match(branch,/if \(!visible\(\)\) throw/);
  assert.match(host,/result\.output === "scene" \? result\.scene\.content\.selection/);
  assert.match(host,/expectedRevision: 0, expectedContentSha256: selection!\.contentSha256/);
  assert.match(host,/\.retained-story-reader, \.native-retained-scene-reader/);
});

test('actual Scene host withdrawal during content hashing prevents the private input read, font or renderer import and result publication', async () => {
  const host = readFileSync(new URL('../src/components/forma-experience-host.ts', import.meta.url), 'utf8');
  const begin = host.indexOf('  async #check() {'), end = host.indexOf('  #scheduleDeadline()', begin);
  assert.ok(begin >= 0 && end > begin, 'extract the complete current host method');
  const method = host.slice(begin, end);
  const fence = '        if (!selected()) throw new Error("unavailable");\n        if (candidate.output === "scene")';
  assert.equal(method.split(fence).length, 2, 'the post-hash guard has one exact extraction site');

  async function withdrawnDuringHash(actualMethod) {
    let current = true, releaseHash, reachedHash;
    const waitingHash = new Promise(resolve => { releaseHash = resolve; });
    const hashStarted = new Promise(resolve => { reachedHash = resolve; });
    const trace = { privateReads: [], imports: [], verifierCalls: 0, publishedResults: 0, clears: 0 };
    const candidate = { output: 'scene', contentRef: 'content-test', inputRef: 'input-test', jobId: 'job-test', expiresAt: new Date(Date.now() + 60000).toISOString() };
    const state = { documentId: 'document-test', original: { jobId: candidate.jobId }, sceneCostPreview: { requestId: candidate.jobId } };
    const binding = { sceneSource: {}, plan: { request: { values: { characterA: {value: 'A'}, characterB: {value: 'B'}, location: {value: 'Room'} } } } };
    const operation = { wait: value => value };
    let published;
    const context = {
      binding, busy: false, readable: () => current, visible: () => current, baseCurrent: () => current,
      beginOperation: () => operation, operationCurrent: () => true, finishOperation: () => true,
      resetDecision() {}, requestUpdate() {}, refreshAndRead: async () => {}, state: () => state,
      snapshotMatches: () => true, candidate: () => candidate, scheduleDeadline() {},
      clearResult() { trace.clears++; published = undefined; },
      store: {
        outputRequirements: { ensure: async () => {} },
        inspectOutputNativeJob: async () => ({ status: 'found', job: {status: 'completed'}, current: () => current }),
        ensurePrivateContent: async ref => {
          trace.privateReads.push(ref);
          if (ref !== candidate.contentRef) throw Error('Unexpected private-input read');
          return '{}';
        },
      },
    };
    Object.defineProperty(context, 'result', {get: () => published, set(value) { published = value; trace.publishedResults++; }});
    // Execute the actual full host method with controlled async boundaries, not
    // its guard reimplemented in the fixture. No app modules or native runtime
    // are loaded: any font/renderer import is an observable hard-stop boundary.
    const extracted = stripTypeScriptTypes(actualMethod.replace('async #check()', 'async function check()')
      .replaceAll('this.#', 'this.').replaceAll('import(', 'loadModule('));
    const check = new Function('bindingJson', 'experienceResultGrantCurrent', 'crypto', 'loadModule', 'readExperienceNativeScene',
      extracted + '; return check;')(canonicalJson, () => true,
      {subtle: {digest: () => { reachedHash(); return waitingHash; }}},
      path => { trace.imports.push(path); throw Error('Unexpected font/renderer import'); },
      () => { trace.verifierCalls++; throw Error('Unexpected private Scene verification'); });
    const pending = check.call(context);
    await hashStarted;
    assert.deepEqual(trace.privateReads, [candidate.contentRef], 'the original content was read before withdrawal');
    current = false;
    releaseHash(new ArrayBuffer(32));
    await pending;
    assert.equal(context.busy, false);
    assert.equal(context.result, undefined);
    assert.deepEqual(trace.imports, []);
    assert.equal(trace.verifierCalls, 0);
    assert.equal(trace.publishedResults, 0);
    assert.equal(trace.clears, 2, 'the actual host catch retires the pending result');
    return trace;
  }

  const guarded = await withdrawnDuringHash(method);
  assert.deepEqual(guarded.privateReads, ['content-test']);
  // Mutation control only, not a product edit or claimed historical runtime:
  // remove just the new fence to prove the oracle detects the stale read.
  const withoutFence = method.replace(fence, '        if (candidate.output === "scene")');
  const missingGuard = await withdrawnDuringHash(withoutFence);
  assert.deepEqual(missingGuard.privateReads, ['content-test', 'input-test']);
});
