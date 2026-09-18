import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {after, test} from 'node:test';
import {outputTestDatabase, registerOutputSourceImports} from './output-execution-test-helpers.mjs';

// Native current HTTP/auth/storage/event paths, with disposable SQLite only.
// The sole production-result seam is the API's current-registration lookup in
// one test. Original validation, compiler, retained bytes and receipts are real.
const sourceImports = registerOutputSourceImports();
const intakeUrl = new URL('../src/experiences/intake.ts', import.meta.url).href;
const apiUrl = new URL('../worker/experience-intake-api.ts', import.meta.url).href;
const registrationUrl = 'forma-intake-boundary:current-registration';
const registrationKey = Symbol.for('forma.intake-http-boundary.registration');
assert.equal(Object.hasOwn(globalThis, registrationKey), false);
const registration = {changed: false, calls: 0};
globalThis[registrationKey] = registration;
const registrationHook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === apiUrl && specifier === '../src/experiences/intake.ts') {
      return {url: registrationUrl, shortCircuit: true};
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url !== registrationUrl) return nextLoad(url, context);
    return {format: 'module', shortCircuit: true, source: `
      export * from ${JSON.stringify(intakeUrl)};
      import {registeredExperience as current} from ${JSON.stringify(intakeUrl)};
      export async function registeredExperience(id) {
        const actual = await current(id);
        const state = globalThis[Symbol.for('forma.intake-http-boundary.registration')];
        state.calls++;
        return state.changed && actual ? {...actual, releaseHash: 'sha256:' + '0'.repeat(64)} : actual;
      }
    `};
  },
});
const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let forbiddenFetches = 0;
Object.defineProperty(globalThis, 'fetch', {configurable: true, writable: true, value() {
  forbiddenFetches++;
  throw Error('No network in ordinary intake HTTP boundary qualification');
}});
after(() => {
  registrationHook.deregister();
  sourceImports.deregister();
  delete globalThis[registrationKey];
  if (originalFetch) Object.defineProperty(globalThis, 'fetch', originalFetch);
  else delete globalThis.fetch;
  assert.equal(forbiddenFetches, 0, 'Even swallowed network attempts fail qualification');
});

const [{handleSession, POLICY_VERSION}, {handleExperienceIntake, authorizeExperienceIntake},
  {registeredExperience, initialValues}, {projectIntake}, {handleProjectIntake}] = await Promise.all([
  import('../worker/pilot-policy.ts'), import('../worker/experience-intake-api.ts'),
  import('../src/experiences/intake.ts'), import('../src/model/project-intake.ts'),
  import('../worker/project-intake.ts'),
]);
const origin = 'https://intake.example.invalid';
const owner = 'ordinary-intake-boundary-owner';
const headers = {'oai-authenticated-user-id': owner, 'oai-authenticated-user-email': `${owner}@example.invalid`};
const writes = f => f.sqlite.prepare('SELECT total_changes() AS n').get().n;
function snapshot(f) {
  const schema = f.sqlite.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
  const tables = schema.filter(row => row.type === 'table');
  return {schema, rows: Object.fromEntries(tables.map(({name}) => [name,
    f.sqlite.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]))};
}
async function unchanged(f, run) {
  const before = snapshot(f), changes = writes(f);
  const result = await run();
  assert.equal(writes(f), changes, 'Rejected/recovered operation must execute no SQLite row writes');
  assert.deepEqual(snapshot(f), before, 'All native rows and schema stay unchanged');
  return result;
}
async function fixture(t) {
  const f = outputTestDatabase();
  t.after(() => f.sqlite.close());
  let forbiddenMedia = 0;
  const noMedia = () => { forbiddenMedia++; throw Error('No media in ordinary intake HTTP boundary qualification'); };
  for (const method of ['get', 'head', 'put', 'delete', 'list']) t.mock.method(f.env.MEDIA, method, noMedia);
  t.mock.method(f.env.ASSETS, 'fetch', noMedia);
  t.after(() => assert.equal(forbiddenMedia, 0, 'Even swallowed media attempts fail qualification'));
  const session = await handleSession(new Request('http://localhost/api/session', {headers}), f.env);
  assert.equal(session.status, 200);
  f.sqlite.prepare("UPDATE users SET consent_version=?,role='creator' WHERE user_id=?").run(POLICY_VERSION, owner);
  f.env.FORMA_RETENTION_DAYS = '2';
  f.call = (path, {method = 'POST', body, raw, extra = {}} = {}) => handleExperienceIntake(new Request(`${origin}/api/experiences/${path}`, {
    method, headers: {...headers, ...(method === 'POST' ? {origin, 'content-type': 'application/json'} : {}), ...extra},
    ...(body === undefined && raw === undefined ? {} : {body: raw === undefined ? JSON.stringify(body) : raw}),
    ...(raw instanceof ReadableStream ? {duplex: 'half'} : {}),
  }), f.env);
  return f;
}
async function request() {
  const release = await registeredExperience('image'), values = initialValues(release);
  values.subject = {value: 'A blue heron beside a stone bridge', provenance: 'authored'};
  values.ratio = {value: {width: 1, height: 1}, provenance: 'authored'};
  return {intentId: crypto.randomUUID(), experienceId: 'image', releaseHash: release.releaseHash, values};
}
async function prepare(f, input) {
  const response = await f.call('drafts', {body: input ?? await request()});
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).plan;
}
async function rejection(response, status, error) {
  assert.equal(response.status, status, await response.clone().text());
  const result = await response.json();
  assert.equal(result.error, error);
  assert.equal(result.plan, undefined);
  assert.equal(result.appended, undefined);
}

test('ordinary intake origin refusals precede authorization, storage and event work', async t => {
  const f = await fixture(t), input = await request();
  let prepares = 0;
  const originalPrepare = f.DB.prepare;
  t.mock.method(f.DB, 'prepare', function (...args) { prepares++; return originalPrepare.apply(this, args); });
  for (const extra of [{origin: 'https://foreign.example.invalid'}, {'sec-fetch-site': 'cross-site'}]) {
    const before = prepares;
    await unchanged(f, async () => rejection(await f.call('drafts', {body: input, extra}), 403, 'same_origin_required'));
    assert.equal(prepares, before, 'Origin refusal occurs before any native DB preparation');
  }
});

test('ordinary intake accepts exactly 32 KiB and rejects byte overflow, type and malformed JSON without writes', async t => {
  const f = await fixture(t), input = await request();
  input.values.subject.value = '灯'.repeat(200);
  const json = JSON.stringify(input);
  assert.ok(Buffer.byteLength(json) > json.length, 'Fixture distinguishes UTF-8 bytes from character count');
  const atLimit = json + ' '.repeat(32768 - Buffer.byteLength(json));
  assert.equal(Buffer.byteLength(atLimit), 32768);
  const positive = await f.call('drafts', {raw: atLimit});
  assert.equal(positive.status, 200, await positive.clone().text());
  assert.equal((await positive.json()).status, 'prepared');
  const invalid = [
    {raw: atLimit + ' '},
    {body: input, extra: {'content-length': '32769'}},
    {body: input, extra: {'content-type': 'text/plain'}},
    {raw: '{'},
    {raw: new Uint8Array([0xc3, 0x28])},
  ];
  for (const options of invalid) await unchanged(f, async () => rejection(await f.call('drafts', options), 400, 'request_invalid'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
});

test('ordinary intake bounds streamed bytes without waiting for a never-settling cancellation', async t => {
  const f = await fixture(t);
  let cancelled = 0, pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      if (pulls === 1) controller.enqueue(new Uint8Array(16384));
      else if (pulls === 2) controller.enqueue(new Uint8Array(16385));
      else return new Promise(() => {});
    },
    cancel() { cancelled++; return new Promise(() => {}); },
  });
  let timer;
  try {
    await unchanged(f, async () => {
      const response = await Promise.race([
        f.call('drafts', {raw: stream, extra: {'content-length': '1'}}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Overflow rejection awaited cancellation or an unfinished tail')), 1000); }),
      ]);
      await rejection(response, 400, 'request_invalid');
    });
    assert.equal(cancelled, 1);
    assert.ok(pulls <= 3, 'The body reader stops at overflow instead of consuming the tail');
    assert.equal(stream.locked, false, 'Reader lock is released despite pending cancellation');
  } finally { clearTimeout(timer); }
});

test('ordinary prepare rejects caller authority and unknown experiences before retaining anything', async t => {
  const f = await fixture(t), input = await request();
  for (const body of [
    {...input, events: []}, {...input, ownerId: 'another-owner'}, {...input, grantId: 'invented-grant'},
    {...input, experienceId: 'unregistered-output'},
  ]) await unchanged(f, async () => rejection(await f.call('drafts', {body}), 400, 'experience_request_invalid'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM private_content').get().n, 0);
});

test('ordinary commit rejects extra/coerced envelopes and stale approval without native writes', async t => {
  const f = await fixture(t), plan = await prepare(f), path = `drafts/${plan.draftId}/commit`;
  for (const body of [
    {}, [], null, {draftHash: [plan.draftHash]}, {draftHash: plan.draftHash, events: []},
    {draftHash: plan.draftHash, ownerId: owner}, {draftHash: plan.draftHash, grantId: 'invented-grant'},
  ]) await unchanged(f, async () => rejection(await f.call(path, {body}), 400, 'request_invalid'));
  await unchanged(f, async () => rejection(await f.call(path, {body: {draftHash: 'stale'}}), 409, 'experience_review_stale'));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM event_client_receipts').get().n, 0);
});

test('current registration drift refuses commit but preserves the native original receipt', async t => {
  const f = await fixture(t), plan = await prepare(f), path = `drafts/${plan.draftId}`;
  const committed = await f.call(`${path}/commit`, {body: {draftHash: plan.draftHash}});
  assert.equal(committed.status, 200, await committed.clone().text());
  const original = await committed.json();
  assert.equal(original.status, 'complete');
  assert.equal(original.documentId, plan.documentId);
  assert.equal(original.appended.length, plan.events.length);
  const actualRelease = await registeredExperience('image');
  assert.equal(actualRelease.releaseHash, plan.release.releaseHash);
  registration.changed = true;
  try {
    const beforeLookups = registration.calls;
    await unchanged(f, async () => rejection(await f.call(`${path}/commit`, {body: {draftHash: plan.draftHash}}), 409, 'experience_release_changed'));
    assert.equal(registration.calls, beforeLookups + 1, 'Only the real commit current-registration lookup is perturbed');
    const response = await unchanged(f, () => f.call(`${path}/receipt`, {method: 'GET'}));
    assert.equal(response.status, 200);
    const retained = await response.json();
    assert.equal(retained.status, 'complete');
    assert.equal(retained.documentId, plan.documentId);
    assert.equal(retained.projectId, plan.projectId);
    assert.equal(retained.draftHash, plan.draftHash);
    assert.deepEqual(retained.appended, original.appended);
    assert.equal(registration.calls, beforeLookups + 1, 'Historical receipt never reinterprets the current registration');
  } finally { registration.changed = false; }
});

test('ordinary public project-intake grammar rejects a real mini-app plan and admits its own empty-canvas shape', async t => {
  const f = await fixture(t), plan = await prepare(f);
  assert.equal(projectIntake(plan.events), null);
  const auth = await authorizeExperienceIntake(new Request(`${origin}/api/experiences/drafts`, {headers}), f.env);
  assert.ok(!(auth instanceof Response));
  await unchanged(f, async () => rejection(await handleProjectIntake(f.env, auth, {
    action: 'project_intake', intakeAction: 'commit', events: plan.events,
  }), 400, 'invalid_project_intake'));
  const projectId = crypto.randomUUID(), documentId = crypto.randomUUID();
  const events = [
    {type: 'ProjectCreated', payload: {project_id: projectId, name: 'Ordinary project', state: 'active'}},
    {type: 'DocumentCreated', payload: {project_id: projectId, document_id: documentId, handle: 'ordinary-document', title: 'Ordinary Document'}},
    {type: 'EmptyCanvasChosen', payload: {project_id: projectId, document_id: documentId, source_surface: 'projects'}},
  ];
  const parsed = projectIntake(events);
  assert.ok(parsed);
  assert.equal(parsed.projectId, projectId);
  assert.equal(parsed.documentId, documentId);
  assert.equal(parsed.events.length, 3);
  // Positive public commit uses the parser's real normalized client receipt IDs.
  const response = await handleProjectIntake(f.env, auth, {action: 'project_intake', intakeAction: 'commit', events});
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.equal(result.status, 'complete');
  assert.equal(result.projectId, projectId);
  assert.equal(result.documentId, documentId);
  assert.deepEqual(result.appended.map(event => event.type), events.map(event => event.type));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 3);
});
