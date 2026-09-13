import test from 'node:test';
import assert from 'node:assert/strict';
import { definitions, contextCatalog } from '../src/experiences/catalog.ts';
import { canonicalJson, compileExperience, digest } from '../src/experiences/compiler.ts';
import { experienceIds, registeredExperience, initialValues, validateIntakeRequest, buildExperiencePlan, experienceDocumentRoute } from '../src/experiences/intake.ts';
import { ExperienceIntakeRuntime } from '../src/experiences/intake-runtime.ts';
import { experienceOutputSettings } from '../src/experiences/native-host.ts';

const owner = 'test-owner';
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
async function requestFor(output) {
  const release = await registeredExperience(output), values = initialValues(release);
  if (output === 'image') {
    values.subject = { value: '  Copper lamp  ', provenance: 'authored' };
    values.ratio = { value: { width: 1, height: 1 }, provenance: 'authored' };
  }
  else { values.claim = { value: 'A claim', provenance: 'authored' }; values.evidence = { value: [{ id: 'e3', text: 'Third' }, { id: 'e1', text: 'First' }, { id: 'e2', text: 'Second' }], provenance: 'authored' }; }
  return { release, request: { intentId: crypto.randomUUID(), experienceId: output, releaseHash: release.releaseHash, values } };
}
const receiptFor = plan => ({ status: 'complete', generation: 'unavailable', draftId: plan.draftId, draftHash: plan.draftHash, documentId: plan.documentId, projectId: plan.projectId, documentRoute: experienceDocumentRoute(plan), head: plan.events.length, rejected: [], appended: plan.events.map((event, index) => ({ ...event, eventId: crypto.randomUUID(), streamId: plan.streamId, actor: 'user', clientId: 'web:experience-intake', correlationId: `experience-intake:${plan.projectId}`, schemaVersion: 1, compensatesEventId: null, sequence: index + 1 })) });
const authorImage = runtime => {
  runtime.change('subject', 'Copper lamp');
  runtime.change('ratio', { width: 1, height: 1 });
};

test('all eight registered experiences retain context qualification, not a generation grant', async () => {
  assert.deepEqual(experienceIds, ['image', 'slides', 'short-story', 'scene', 'model3d', 'storyboard', 'audio', 'video']);
  assert.equal(await registeredExperience('unregistered'), null);
  for (const id of experienceIds) { const release = await registeredExperience(id); assert.equal(release.qualification, 'context-authoring'); assert.equal(release.releaseHash, (await registeredExperience(id)).releaseHash); assert.ok(Object.isFrozen(release)); }
  const retired = { ...contextCatalog, version: 'forma-experience-fixture@1', qualification: 'fixture' };
  assert.equal((await compileExperience(definitions[0], retired)).ok, false);
});

test('compiler rejects capability keys and accessor values without invoking them', async () => {
  const value = structuredClone(definitions[0]); value.provider = 'unregistered';
  assert.equal((await compileExperience(value, contextCatalog)).ok, false);
  let invoked = false; Object.defineProperty(value, 'revision', { get() { invoked = true; return 1; }, enumerable: true });
  assert.equal((await compileExperience(value, contextCatalog)).ok, false); assert.equal(invoked, false);
});

test('canonical intake keeps typed authored provenance and immutable stable identities', async () => {
  const { request, release } = await requestFor('image');
  assert.ok(await validateIntakeRequest(request));
  const plan = await buildExperiencePlan(owner, request, release), again = await buildExperiencePlan(owner, request, release);
  assert.equal(canonicalJson(plan), canonicalJson(again));
  const subject = plan.events.find(event => event.payload.properties?.experience_binding === 'subject').payload.properties;
  assert.equal(subject.experience_value, '  Copper lamp  '); assert.equal(subject.authority, 'authored'); assert.equal(subject.experience_origin, 'authored');
  assert.equal(subject.experience_release, release.releaseHash);
  const altered = structuredClone(request); altered.values.subject.provenance = 'default'; assert.equal(await validateIntakeRequest(altered), null);
  altered.releaseHash = 'sha256:' + '0'.repeat(64); assert.equal(await validateIntakeRequest(altered), null);
});

test('Slides preserves evidence identity/order and settings require exactly five', async () => {
  const { request, release } = await requestFor('slides'), plan = await buildExperiencePlan(owner, request, release);
  assert.deepEqual(plan.events.find(event => event.payload.properties?.experience_binding === 'evidence').payload.properties.experience_value.map(item => item.id), ['e3', 'e1', 'e2']);
  assert.equal(plan.events.at(-1).payload.properties.text, '5 slides');
  assert.deepEqual(experienceOutputSettings(plan).slideCountPolicy, { kind: 'exact', unit: 'slide', value: 5 });
  assert.equal(experienceOutputSettings(plan).requestedSlideCount, 5);
});

test('intake completion validates exact ACK and does not represent a generated result', async () => {
  const release = await registeredExperience('image'); let plan; const calls = [];
  const runtime = new ExperienceIntakeRuntime(release, async function (url, init) { assert.equal(this, undefined, 'Fetcher must not receive the runtime as its receiver'); calls.push(url); if (url.endsWith('/drafts')) { plan = await buildExperiencePlan(owner, JSON.parse(init.body), release); return response({ status: 'prepared', plan }); } return response(receiptFor(plan)); });
  authorImage(runtime); await runtime.prepare(); assert.equal(runtime.state.phase, 'review'); await runtime.submit();
  assert.equal(runtime.state.phase, 'complete'); assert.equal(runtime.receipt.generation, 'unavailable'); assert.equal(runtime.committedPlan.draftHash, plan.draftHash);
  assert.equal(runtime.documentRoute, experienceDocumentRoute(plan)); assert.equal(calls.length, 2); runtime.dispose();
});

test('unknown commit outcome checks original receipt with no new intent or execution', async () => {
  const release = await registeredExperience('image'); let plan; const calls = [];
  const runtime = new ExperienceIntakeRuntime(release, async (url, init) => { calls.push(url); if (url.endsWith('/drafts')) { plan = await buildExperiencePlan(owner, JSON.parse(init.body), release); return response({ plan }); } if (url.endsWith('/commit')) throw new Error('connection_lost'); return response(receiptFor(plan)); });
  authorImage(runtime); await runtime.prepare(); const intent = runtime.intentId; await runtime.submit(); assert.equal(runtime.state.phase, 'uncertain'); await runtime.recover();
  assert.equal(runtime.state.phase, 'complete'); assert.equal(runtime.intentId, intent); assert.equal(calls.filter(path => path.endsWith('/commit')).length, 1); assert.ok(calls.at(-1).endsWith('/receipt')); runtime.dispose();
});

test('forged canonical event payload or generated claim cannot complete intake', async () => {
  for (const mutation of [value => { value.appended.at(-1).payload = { substituted: true }; }, value => { value.generation = 'complete'; }]) {
    const release = await registeredExperience('image'); let plan;
    const runtime = new ExperienceIntakeRuntime(release, async (url, init) => { if (url.endsWith('/drafts')) { plan = await buildExperiencePlan(owner, JSON.parse(init.body), release); return response({ plan }); } const receipt = structuredClone(receiptFor(plan)); mutation(receipt); return response(receipt); });
    authorImage(runtime); await runtime.prepare(); await runtime.submit(); assert.equal(runtime.state.phase, 'uncertain'); assert.equal(runtime.receipt, undefined); assert.equal(runtime.documentRoute, undefined); runtime.dispose();
  }
});

test('duplicate submit is single-flight; disposed late response cannot publish saved state', async () => {
  const release = await registeredExperience('image'); let plan, complete; let commits = 0;
  const runtime = new ExperienceIntakeRuntime(release, async (url, init) => { if (url.endsWith('/drafts')) { plan = await buildExperiencePlan(owner, JSON.parse(init.body), release); return response({ plan }); } commits++; return new Promise(resolve => { complete = resolve; }); });
  authorImage(runtime); await runtime.prepare(); const pending = runtime.submit(); await runtime.submit(); assert.equal(commits, 1); runtime.dispose(); complete(response(receiptFor(plan))); await pending; assert.equal(runtime.receipt, undefined); assert.notEqual(runtime.state.phase, 'complete');
});

test('resume only reads original plan/receipt and rejects hash mutation', async () => {
  const { request, release } = await requestFor('image'), plan = await buildExperiencePlan(owner, request, release), calls = [];
  const runtime = new ExperienceIntakeRuntime(release, async (url, init) => { calls.push({ url, method: init.method }); return response(url.endsWith('/receipt') ? receiptFor(plan) : { plan }); });
  await runtime.resume(plan.draftId); assert.equal(runtime.state.phase, 'complete'); assert.ok(calls.every(call => !call.method)); assert.equal(runtime.intentId, request.intentId); runtime.dispose();
  const bad = structuredClone(plan); bad.request.values.subject.value = 'Changed';
  const mismatch = new ExperienceIntakeRuntime(release, async () => response({ plan: bad })); await mismatch.resume(plan.draftId); assert.equal(mismatch.state.phase, 'uncertain'); assert.equal(mismatch.receipt, undefined); mismatch.dispose();
});


test('rehashed forged source plan cannot substitute deterministic canonical IDs or events', async () => {
  const { request, release } = await requestFor('image'), plan = structuredClone(await buildExperiencePlan(owner, request, release));
  plan.documentId = crypto.randomUUID();
  for (const event of plan.events) if (event.payload.document_id) event.payload.document_id = plan.documentId;
  const { draftHash, ...base } = plan; plan.draftHash = await digest(base);
  const runtime = new ExperienceIntakeRuntime(release, async () => response({ plan }));
  await runtime.resume(plan.draftId); assert.equal(runtime.state.phase, 'uncertain'); assert.equal(runtime.receipt, undefined); runtime.dispose();
});

test('invalid or ambiguous entry recovery cannot silently become a new draft', async () => {
  const { parseExperienceEntryRoute } = await import('../src/experiences/intake.ts');
  const draft = 'experience-draft-' + 'a'.repeat(64), url = value => new URL(value, 'https://forma.local');
  assert.deepEqual(parseExperienceEntryRoute(url('/experiences/slides?draft=' + draft)), { output: 'slides', draftId: draft });
  assert.deepEqual(parseExperienceEntryRoute(url('/experiences/video')), { output: 'video' });
  for (const value of ['/experiences/slides?draft=bad', '/experiences/slides?draft=', '/experiences/slides?draft=' + draft + '&draft=' + draft, '/experiences/slides?draft=' + draft + '&intent=' + crypto.randomUUID(), '/experiences/slides?job=caller', '/experiences?draft=' + draft, '/make/slides', '/experiences/unregistered', '/experiences/video?job=caller']) assert.equal(parseExperienceEntryRoute(url(value)), null);
});

test('Continue carries only closed host selectors and existing report return flag', async () => {
  const { experienceNavigationAdapter } = await import('../src/experiences/navigation-adapter.ts');
  const { parseExperienceHostRoute } = await import('../src/experiences/host-route.ts');
  const { request, release } = await requestFor('slides'), plan = await buildExperiencePlan(owner, request, release), receipt = receiptFor(plan);
  const elements = [], target = { ownerDocument: { createElement: () => ({}) }, replaceChildren(...items) { elements.splice(0, elements.length, ...items); } }, abort = new AbortController();
  const adapter = experienceNavigationAdapter('https://forma.local/experiences/slides?progress-report');
  const session = await adapter.mount(target, { plan, receipt, settings: experienceOutputSettings(plan) }, abort.signal);
  assert.equal(elements[0].textContent, 'Continue');
  const route = parseExperienceHostRoute(elements[0].href); assert.equal(route.output, 'slides'); assert.equal(route.documentId, plan.documentId); assert.equal(route.draftId, plan.draftId); assert.ok(route.documentRoute.includes('progress-report='));
  abort.abort(); assert.equal(elements.length, 0); session.dispose();
});

test('actual Video navigation adapter supplies Continue without a provider call or implicit approval', async () => {
  const {experienceNavigationAdapter}=await import('../src/experiences/navigation-adapter.ts');
  const {experienceOutputSettings}=await import('../src/experiences/native-host.ts');
  const {parseExperienceHostRoute}=await import('../src/experiences/host-route.ts');
  const plan={draftId:'experience-draft-'+'a'.repeat(64),release:{output:{output:'video'}}};
  const children=[],target={ownerDocument:{createElement:()=>({})},replaceChildren(...nodes){children.splice(0,children.length,...nodes);}};
  const controller=new AbortController(),old=globalThis.fetch;globalThis.fetch=()=>{throw Error('navigation must not dispatch');};
  try{
    const session=await experienceNavigationAdapter('/experiences/video?progress-report').mount(target,{plan,settings:experienceOutputSettings(plan),receipt:{documentRoute:'/document/video-doc'}},controller.signal);
    assert.equal(children.length,1);assert.equal(children[0].textContent,'Continue');assert.equal(parseExperienceHostRoute(children[0].href).output,'video');assert(children[0].href.includes('progress-report'));
    assert.equal(experienceOutputSettings(plan).videoResolution,'480p');controller.abort();assert.equal(children.length,0);session.dispose();
  }finally{globalThis.fetch=old;}
});
