import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalJson } from '../src/experiences/compiler.ts';
import { registeredExperience, initialValues } from '../src/experiences/intake.ts';
import { createExperienceSceneAdapterRequest } from '../worker/experience-scene-adapter-contract.ts';
import { createOutputSceneRequestContract } from '../worker/output-scene-request.ts';
import { prepareOutputSceneAdapter, generateOutputSceneArtifact } from '../worker/output-scene-adapter.ts';

// In-memory unadmitted control-flow fixtures. Transport supplies bytes locally;
// no fetch, provider request, DB, native job, grant or completed journey exists.
const release = await registeredExperience('scene');
const intake = () => ({ intentId: '00000000-0000-4000-8000-000000000094', experienceId: 'scene', releaseHash: release.releaseHash,
  values: { ...initialValues(release), ...Object.fromEntries(Object.entries({ characterA: 'Alex', characterB: 'Alex', goalA: 'Stay', goalB: 'Leave',
    secret: 'The key is outside', location: 'Waiting room' }).map(([key, value]) => [key, { value, provenance: 'authored' }])) } });
const script = () => ({ schemaVersion: 1, format: 'forma-screenplay@1', heading: { setting: 'INT.', location: 'location', time: 'NIGHT' }, blocks: [
  { kind: 'action', text: 'A hand rests against the door.' }, { kind: 'dialogue', speaker: 'A', parenthetical: null, text: 'Stay.' },
  { kind: 'dialogue', speaker: 'B', parenthetical: null, text: 'I have to go.' },
] });
const candidate = () => ({ title: 'The door', summary: 'Two intentions meet.', screenplay: script() });
const envelope = (content = candidate()) => ({ id: 'unadmitted-response', model: 'gpt-5.6-terra', status: 'completed', incomplete_details: null,
  output: [{ id: 'unadmitted-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(content) }] }],
  usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
const hash = value => createHash('sha256').update(value).digest('hex');
async function setup({ body = envelope(), retentionFails = false, dispatchFails = false } = {}) {
  const source = intake(), spec = await createExperienceSceneAdapterRequest(source);
  const input = { document_title: 'The door', creative_context: { facts: [{ context_key: 'c1', text: 'A closed door.' }] }, combined_context_plan: [],
    audience: 'general', tone: 'derived from the document', scene_configuration: { medium: 'visual', source: 'manual', target_format: null, downstream_formats: [],
      alternate_medium: 'audio', context_continuity: 'same-authored-narrative-context', alternate_rendering: { medium: 'audio', preserve_authored_context: true } }, scene_intent: JSON.parse(spec.input) };
  const contract = await createOutputSceneRequestContract(source, input, 30000), log = [], submissions = [], retained = [], attempts = [];
  const option = { intake: source, contract, retainEnvelope: async receipt => { log.push('retain'); retained.push(receipt); if (retentionFails) throw Error('private storage unavailable'); return { responseRef: 'unadmitted-private-envelope' }; } };
  const selection = await prepareOutputSceneAdapter(option);
  const hooks = { onBeforeProviderAttempt: async attempt => { log.push('claim'); attempts.push(attempt); }, onProviderSubmission: async call => { log.push(call.status + ':' + (call.validationStatus ?? 'none')); submissions.push(call); },
    onBeforeProviderDispatch: () => { log.push('guard'); }, onProviderAttempt: async () => { log.push('attempt'); } };
  let dispatches = 0;
  const dispatch = async () => { dispatches++; log.push('dispatch'); if (dispatchFails) throw Error('uncertain connection'); return new Response(JSON.stringify(body), { status: 200, headers: { 'x-request-id': 'unadmitted-http-request' } }); };
  const run = (inputOverride = JSON.stringify(input)) => generateOutputSceneArtifact(selection, inputOverride, 'forma_' + 'a'.repeat(32), hooks, dispatch);
  return { option, selection, contract, input, log, submissions, retained, attempts, hooks, run, count: () => dispatches, rawEnvelope: JSON.stringify(body) };
}

test('Scene adapter captures one request and retains own raw response before emitting structure-valid layout-pending draft', async () => {
  const fixture = await setup(), result = await fixture.run();
  assert.deepEqual(fixture.log, ['claim', 'pending:none', 'guard', 'dispatch', 'retain', 'completed:pending', 'completed:valid', 'attempt']);
  assert.equal(fixture.count(), 1); assert.equal(fixture.retained[0].rawEnvelope, fixture.rawEnvelope);
  assert.equal(fixture.retained[0].candidateRaw, JSON.stringify(candidate())); assert.equal(fixture.retained[0].call.status, 'pending');
  assert.equal(fixture.attempts[0].scene.requestBody, fixture.retained[0].request.requestBody);
  const receipt = result.inputReceipt, call = receipt.provider_calls[0];
  assert.equal(call.responseRef, 'unadmitted-private-envelope'); assert.equal(call.providerRequestId, 'unadmitted-response');
  assert.equal(call.clientRequestId, fixture.attempts[0].clientRequestId); assert.equal(call.requestDigest, hash(fixture.attempts[0].scene.requestBody));
  assert.ok(call.costMicrousd > 0); assert.deepEqual(result.output.scene_screenplay, script());
  assert.equal(receipt.scene_envelope_sha256, hash(fixture.rawEnvelope)); assert.equal(receipt.scene_candidate_sha256, hash(JSON.stringify(candidate())));
  assert.equal(receipt.scene_screenplay_sha256, hash(canonicalJson(script()))); assert.equal(receipt.scene_body_sha256, hash(result.output.content_markdown));
  assert.equal(result.output.items[0].body, result.output.content_markdown); assert.equal(result.output.items.length, 1);
  assert.equal(receipt.validation.status, 'structure_valid_layout_pending'); assert.equal(receipt.validation.requirement_fulfilled, false);
  assert.deepEqual(receipt.validation.initial_issues, []); assert.deepEqual(receipt.validation.repair_issues, []);
  assert.deepEqual(receipt.validation.validation_history, [{ stage: 'initial', issue_count: 0, issues: [], provider_attempt: 1 }]);
  assert.equal(receipt.scene_layout.status, 'unqualified'); assert.equal(receipt.scene_layout.pageCount, null);
});

test('Scene structure failure retains original envelope and measured cost, with no repair or second dispatch', async () => {
  const content = candidate(); content.screenplay.blocks[2].speaker = 'A';
  const fixture = await setup({ body: envelope(content) });
  await assert.rejects(fixture.run(), error => error.detail.code === 'output_scene_structure_invalid' && error.detail.retryable === false && error.providerCallCount === 1);
  assert.equal(fixture.count(), 1); assert.equal(fixture.retained[0].rawEnvelope, fixture.rawEnvelope);
  assert.equal(fixture.submissions.at(-1).validationStatus, 'invalid'); assert.ok(fixture.submissions.at(-1).costMicrousd > 0);
  assert.ok(fixture.log.indexOf('retain') < fixture.log.indexOf('completed:invalid'));
});

test('Scene envelope failure retains received response before rejection and does not invent unknown cost', async () => {
  for (const change of [body => { body.output[0].role = 'tool'; }, body => { body.status = 'incomplete'; }, body => { delete body.usage; }]) {
    const body = envelope(); change(body); const fixture = await setup({ body });
    await assert.rejects(fixture.run(), error => error.detail.retryable === false);
    assert.equal(fixture.count(), 1); assert.equal(fixture.retained.length, 1); assert.equal(fixture.submissions.at(-1).validationStatus, 'invalid');
    if (!body.usage) assert.equal(fixture.submissions.at(-1).costMicrousd, undefined);
    else assert.ok(fixture.submissions.at(-1).costMicrousd > 0);
  }
});

test('Scene private retention failure still persists original source-free measured call evidence before failing', async () => {
  const fixture = await setup({ retentionFails: true });
  await assert.rejects(fixture.run(), error => error.detail.code === 'output_scene_response_retention_failed' && error.detail.retryable === false);
  assert.equal(fixture.count(), 1); const call = fixture.submissions.at(-1);
  assert.equal(call.providerRequestId, 'unadmitted-response'); assert.equal(call.responseRef, undefined); assert.ok(call.costMicrousd > 0);
  assert.equal(call.validationStatus, 'pending'); assert.ok(!fixture.log.includes('attempt'));
});

test('Scene final synchronous guard keeps its original identity and cannot become rejected zero-cost or dispatch', async () => {
  const fixture = await setup(), stop = Error('original current-source guard');
  fixture.hooks.onBeforeProviderDispatch = () => { throw stop; };
  await assert.rejects(fixture.run(), error => error === stop);
  assert.equal(fixture.count(), 0); assert.equal(fixture.submissions.length, 1);
  assert.equal(fixture.submissions[0].status, 'pending'); assert.equal(fixture.submissions[0].costMicrousd, undefined);
  const source = readFileSync(new URL('../worker/output-scene-adapter.ts', import.meta.url), 'utf8');
  assert.match(source, /hooks\.onBeforeProviderDispatch\(clientRequestId\);\s*\} catch \(error\)/);
  assert.match(source, /throw error;\s*\}\s*let response: Response;\s*try \{ response = await dispatch\(body, clientRequestId\);/);
});

test('Scene changed compiled input fails before call claim, while network uncertainty remains pending without resubmission', async () => {
  const changed = await setup(); changed.input.creative_context.facts[0].text = 'Changed';
  await assert.rejects(changed.run(JSON.stringify(changed.input)), error => error.detail.code === 'output_scene_current_input_changed');
  assert.equal(changed.count(), 0); assert.deepEqual(changed.log, []);
  const uncertain = await setup({ dispatchFails: true });
  await assert.rejects(uncertain.run(), error => error.detail.code === 'output_scene_submission_uncertain' && error.detail.retryable === false);
  assert.equal(uncertain.count(), 1); assert.equal(uncertain.submissions.length, 1); assert.equal(uncertain.submissions[0].status, 'pending');
});

test('actual Scene adapter selection guard is opt-in, function-owned and refuses managed, foreign-kind or Story routes', async () => {
  const fixture = await setup();
  assert.equal(await prepareOutputSceneAdapter(JSON.parse(JSON.stringify(fixture.option))), null);
  let getterRead = false; const hostile = { ...fixture.option }; Object.defineProperty(hostile, 'retainEnvelope', { enumerable: true, get() { getterRead = true; return fixture.option.retainEnvelope; } });
  assert.equal(await prepareOutputSceneAdapter(hostile), null); assert.equal(getterRead, false);
  const source = readFileSync(new URL('../worker/openai-adapter.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const sceneRequested='), end = source.indexOf('  const narrativePresent=', start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const guard = new AsyncFunction('env', 'kind', 'input', 'preparation', 'prepareOutputSceneAdapter', stripTypeScriptTypes(source.slice(start, end)) + '\nreturn sceneMini;');
  const options = { outputScene: fixture.option, productionMode: 'manual', itemCount: 1, ...fixture.hooks };
  assert.ok(await guard({}, 'scene', { options }, undefined, prepareOutputSceneAdapter));
  for (const [kind, patch] of [['short_story', {}], ['scene', { productionMode: 'managed' }], ['scene', { itemCount: 2 }],
    ['scene', { outputNarrative: {} }], ['scene', { sceneMedium: 'audio' }], ['scene', { onBeforeProviderDispatch: undefined }]]) {
    await assert.rejects(guard({}, kind, { options: { ...options, ...patch } }, undefined, prepareOutputSceneAdapter), /output_scene_execution_invalid/);
  }
  assert.equal(await guard({}, 'short_story', { options: {} }, undefined, () => { throw Error('not called'); }), null);
});

test('Scene streamed body cap cancels overflow and leaves the original call pending with unknown charge', async () => {
  for (const status of [200, 503]) {
    const f = await setup(); let reads = 0, cancelled = 0;
    const stream = new ReadableStream({pull(controller) { reads++; controller.enqueue(new Uint8Array(131073).fill(65)); }, cancel() { cancelled++; }});
    const response = new Response(stream, {status, headers: {'x-request-id':'bounded-response'}});
    response.text = () => { throw Error('Unbounded text read'); }; response.clone = () => { throw Error('Unbounded clone'); };
    await assert.rejects(generateOutputSceneArtifact(f.selection, JSON.stringify(f.input), 'forma_'+'a'.repeat(32), f.hooks, async()=>response),
      e=>e.detail.code==='output_scene_response_unreadable' && !e.detail.retryable);
    assert.equal(cancelled,1); assert(reads<=3); assert.equal(f.retained.length,0);
    assert.equal(f.submissions.length,2); const last=f.submissions.at(-1);
    assert.equal(last.status,'pending'); assert.equal(last.costMicrousd,undefined); assert.equal(last.validationStatus,'pending');
    assert.equal(last.httpRequestId,'bounded-response'); assert.equal(last.clientRequestId,f.submissions[0].clientRequestId);
  }
});

test('Scene capped reader handles exact bytes and compressed Content-Length without silently repairing invalid UTF-8', async()=>{
  for(const mode of ['chunks','compressed','invalid-utf8','length-mismatch','declared-oversize']){
    const f=await setup(); const bytes=new TextEncoder().encode(f.rawEnvelope), headers={}; let cancelled=0;
    if(mode==='compressed'){headers['content-length']='17';headers['content-encoding']='gzip';}
    if(mode==='length-mismatch')headers['content-length']='17';
    if(mode==='declared-oversize')headers['content-length']='262145';
    const stream=new ReadableStream({start(c){if(mode==='invalid-utf8')c.enqueue(Uint8Array.of(0xff));else{c.enqueue(bytes.slice(0,37));c.enqueue(bytes.slice(37));}if(mode!=='declared-oversize')c.close();},cancel(){cancelled++;}});
    const run=()=>generateOutputSceneArtifact(f.selection,JSON.stringify(f.input),'forma_'+'a'.repeat(32),f.hooks,async()=>new Response(stream,{headers}));
    if(mode==='chunks'||mode==='compressed'){const result=await run();assert.equal(result.inputReceipt.scene_envelope_sha256,hash(f.rawEnvelope));}
    else{await assert.rejects(run(),e=>e.detail.code==='output_scene_response_unreadable');assert.equal(f.submissions.at(-1).costMicrousd,undefined);assert.equal(f.retained.length,0);}
    if(mode==='declared-oversize')assert.equal(cancelled,1);
  }
});

test('actual shared transport defers Scene error bodies to the bounded caller without changing default classification',async()=>{
  const source=readFileSync(new URL('../worker/openai-adapter.ts',import.meta.url),'utf8');
  const start=source.indexOf('async function openAIRequest('),end=source.indexOf('\nconst responseText=',start);
  let fetches=0,clones=0,classifications=0;
  const transport=new Function('fetch','classifyProviderFailure','ProviderRequestError','OPENAI_REQUEST_MAX_ATTEMPTS','shouldAutomaticallyRetryProviderFailure','wait','providerRetryDelay',
    stripTypeScriptTypes(source.slice(start,end))+'; return openAIRequest;')(
    async()=>{fetches++;return{ok:false,clone(){clones++;return{async json(){return{error:'bounded elsewhere'}}}}}},()=>{classifications++;return{}},Error,3,()=>false,()=>{throw Error('retry')},()=>0);
  await transport('https://api.openai.com/v1/responses',{method:'POST'},undefined,'caller-bounded');
  assert.equal(fetches,1);assert.equal(clones,0);assert.equal(classifications,0);
  await transport('https://api.openai.com/v1/responses',{method:'POST'});
  assert.equal(fetches,2);assert.equal(clones,1);assert.equal(classifications,1);
  assert.match(source,/signal:input\.options\?\.signal,body\},undefined,"caller-bounded"\)/);
});


test('Scene local-stop hook receives the exact attempt only before dispatch; failed witness cannot replace the original error', async () => {
  for (const stage of ['onBeforeProviderAttempt', 'onProviderSubmission', 'onBeforeProviderDispatch']) {
    const fixture = await setup(), original = Error(stage), stopped = [];
    let captured;
    const claim = fixture.hooks.onBeforeProviderAttempt;
    fixture.hooks.onBeforeProviderAttempt = async attempt => { captured = attempt; await claim(attempt); if (stage === 'onBeforeProviderAttempt') throw original; };
    if (stage !== 'onBeforeProviderAttempt') fixture.hooks[stage] = () => { throw original; };
    fixture.hooks.onProviderNotDispatched = attempt => { stopped.push(attempt); throw Error('witness unavailable'); };
    await assert.rejects(fixture.run(), error => error === original);
    assert.deepEqual(stopped, [captured]); assert.equal(fixture.count(), 0);
  }
  for (const options of [{ dispatchFails: true }, { body: { ...envelope(), usage: undefined } }, { retentionFails: true }, {}]) {
    const fixture = await setup(options); let stops = 0;
    fixture.hooks.onProviderNotDispatched = () => { stops++; };
    try { await fixture.run(); } catch { /* The existing cases assert each actual failure. */ }
    assert.equal(fixture.count(), 1); assert.equal(stops, 0);
  }
});
