import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {registerOutputSourceImports} from "../output-server-test-helpers.mjs";
const resolution=registerOutputSourceImports();
const {createCalmFullPage}=await import("./calm-full-page-fixture.mjs");
const {outputInputDraft}=await import("../../src/model/output-authoring.ts");
const {foldEvents}=await import("../../src/model/events.ts");
const {documentContextBlockRoute}=await import("../../src/model/routes.ts");
resolution.deregister();

const json=body=>({method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
const pause=()=>new Promise(setImmediate);
const digest=value=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const targetId="synthetic-0";

// Complete production Store/Shell/Workspace/Context and actual routed Worker.
// The same-account peer client is isolated SQLite fixture data. It is not
// a browser/AT, two-account collaboration or generated-media certificate.
async function currentPage(t, locale, properties = {}, { blockType } = {}) {
  let f;
  const historyBefore = Object.getOwnPropertyDescriptor(globalThis, 'history');
  // Existing native-history port shape. It changes only this RAM location and
  // is never a replacement Store navigation or authoring implementation.
  Object.defineProperty(globalThis, 'history', { configurable: true, value: {
    pushState(_state, _title, route) {
      if (!f) return;
      const value = new URL(route, f.storeHost.location.origin);
      Object.assign(f.storeHost.location, { pathname: value.pathname, search: value.search, hash: value.hash });
    },
    replaceState(...args) { this.pushState(...args); },
  } });
  t.after(() => { if (historyBefore) Object.defineProperty(globalThis, 'history', historyBefore); else delete globalThis.history; });
  f = await createCalmFullPage(t, { locale });
  const host = f.storeHost, worker = host.worker;
  assert.equal(host.modules.get('src/state/store.ts').FormaStore, f.store.constructor, 'complete actual Store class');
  for (const name of ['saveOutputInput', 'outputInputEvents', 'appendBatch']) assert.equal(Object.hasOwn(f.store, name), false, 'no replacement ' + name);
  assert.equal(host.intercept, null, 'no fabricated HTTP acknowledgement');
  const routed = [];
  host.transport = async request => {
    const response = await worker.request(request.url, request.init);
    routed.push({ url: request.url, method: request.init.method ?? 'GET', status: response.status });
    return response;
  };
  f.patchProperties(0, {
    source_artifact_id: 'saved-scene-story', source_artifact_kind: 'short_story',
    label: 'Original structured title', artifact_markdown: 'Original manuscript A',
    artifact_summary: 'Original structured summary', artifact_item_count: 1,
    artifact_structure: { items: [{ source_artifact_item_id: 'story-part-0', title: 'Original section',
      body: 'Original body', notes: 'Original notes', image_prompt: '', context_group_ids: [], slide: null }], presentation: null },
    ...properties,
  });
  // Persist the full-page fixture's existing synthetic inputs through the
  // actual Worker append route before any interaction under test. No fake
  // acknowledgement or direct events-table rewrite supplies the evidence.
  // An optional target type still goes through the unchanged real Worker validation.
  const seed = f.store.events.get().filter(event => event.type === 'BlockCreated'
    && String(event.payload.block_id).startsWith('synthetic-')).map(event => ({
      type: event.type,
      payload: blockType !== undefined && event.payload.block_id === targetId
        ? { ...event.payload, type: blockType } : event.payload,
    }));
  const first = await (await worker.request('/api/events?after=0&limit=2000&content=1')).json();
  const seeded = await worker.request('/api/events', json({ action: 'batch', events: seed, expectedSequence: first.head, clientId: 'web:market-fixture-seed' }));
  assert.equal(seeded.status, 200, await seeded.clone().text());
  const refresh = async () => {
    const response = await worker.request('/api/events?after=0&limit=2000&content=1');
    assert.equal(response.status, 200);
    const body = await response.json();
    f.store.events.set(body.events); f.store.head.set(body.head);
    f.store.content.set({ ...f.store.content.get(), ...body.content });
    f.store.notify(); await f.settle();
    return body;
  };
  await refresh();
  const projection = f.store.projection.get();
  f.store.route.set(documentContextBlockRoute(projection.documentId, projection.documentTitle, targetId));
  const state = () => outputInputDraft(f.store.projection.get().libraryBlocks.find(block => block.id === targetId));
  assert.ok(state());
  // The unchanged positive is byte-normalized via the real original executor,
  // not failed because this fixture used a legacy artifact_structure shape.
  assert.equal(await f.store.saveOutputInput(targetId, state(), 'market-fixture-normalization'), true);
  await refresh();
  assert.equal(f.store.appendFailure.get(), '');
  const selector = () => f.find('input', row => row.owner.tag === 'forma-context-block'
    && row.owner.block.id === targetId && row.attributes.type === 'radio');
  const toggle = () => f.find('button', row => row.owner.tag === 'forma-context-block'
    && row.owner.block.id === targetId && String(row.attributes.class).includes('context-controls-toggle'));
  const owner = () => f.components().find(component => component.tag === 'forma-context-block' && component.block.id === targetId);
  const child = () => owner()?.querySelector('forma-output-input-editor');
  await f.act(selector(), 'change'); await f.act(toggle());
  assert.ok(child()); assert.deepEqual(child().draft, state());
  const authority = f.store.captureAuthorizationScope().key;
  const binding = { actor: f.store.session.get().user.userId, projectId: projection.projectId,
    documentId: projection.documentId, blockId: targetId, sourceArtifactId: 'saved-scene-story' };
  const unchangedAuthority = () => {
    assert.equal(f.store.captureAuthorizationScope().key, authority);
    const now = f.store.projection.get();
    assert.equal(now.projectId, binding.projectId); assert.equal(now.documentId, binding.documentId);
    assert.equal(f.store.session.get().user.userId, binding.actor);
    assert.equal(now.libraryBlocks.find(block => block.id === targetId).properties.source_artifact_id, binding.sourceArtifactId);
  };
  const financial = () => Object.fromEntries(['document_jobs', 'budget_counters', 'budget_reservations', 'cost_budget_counters', 'cost_budget_reservations']
    .map(table => [table, worker.sqlite.prepare('SELECT * FROM ' + table).all()]));
  const financialBefore = financial();
  const eventHead = () => Number(worker.sqlite.prepare('SELECT COALESCE(MAX(sequence),0) AS head FROM events WHERE stream_id=?').get(worker.streamId).head);
  const input = async (kind, value) => {
    const current = child(); assert.ok(current?.isConnected);
    const node = kind === 'title'
      ? f.find('input', row => row.owner === current && row.properties.value === current.draft.title)
      : f.find('textarea', row => row.owner === current.querySelector('forma-ui-rich-text'));
    assert.ok(node.port?.isConnected && !node.hiddenBy);
    await f.act(node, 'input', { target: { value }, currentTarget: { value } });
  };
  const peer = async (next = null) => {
    const desired = next ?? { ...state(), markdown: 'Current collaborator manuscript B' };
    const events = f.store.outputInputEvents(targetId, desired, 'market-authorized-peer-fixture');
    assert.ok(events.length);
    const response = await worker.request('/api/events', json({ action: events.length > 1 ? 'batch' : 'append',
      event: events[0], events, expectedSequence: f.store.head.get(), clientId: 'web:market-peer-fixture' }));
    assert.equal(response.status, 200, await response.clone().text());
    await refresh();
    assert.equal(state().markdown, desired.markdown);
    return response.status;
  };
  const saveVisible = async () => {
    const form = f.find('form', row => row.owner === owner() && String(row.attributes.class).split(/\s/u).includes('block-editor'));
    assert.ok(form.port?.isConnected && !form.hiddenBy, 'fresh current visible form, not a retained hidden handler');
    await f.act(form, 'submit'); await pause(); await f.settle();
    assert.equal(f.store.busy.get(), ''); assert.equal(f.store.appendFailure.get(), '');
  };
  return { f, host, worker, routed, refresh, state, toggle, owner, child, input, peer, saveVisible,
    binding, unchangedAuthority, financial, financialBefore, eventHead };
}

export {currentPage,json,pause,digest,targetId,foldEvents,outputInputDraft};
