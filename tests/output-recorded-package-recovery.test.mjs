import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// New isolated controls: production methods + real transport; no held test fixtures,
// network, provider, DB, or actual deliverable. Browser/disk custody is separate.
const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
function methods(text, className, names) {
  const file = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
  const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(declaration);
  return names.map(name => {
    const member = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === name);
    assert.ok(member, name);
    return member.getText(file).replace(/#([A-Za-z]\w*)/g, '_$1');
  }).join('\n');
}
function moduleFrom(text, globals = {}) {
  const exports = {};
  const context = { exports, module: { exports }, URL, Response, Headers, Blob, TextEncoder, TextDecoder,
    crypto: webcrypto, Uint8Array, ArrayBuffer, Set, Map, AbortController,
    require(name) {
      if (name === '../model/output-review-preview') return { readOutputReviewPreview() { throw Error('Preview outside scope'); } };
      throw Error(`Unexpected dependency: ${name}`);
    }, ...globals };
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context, { timeout: 5000 });
  return context.module.exports;
}
const readiness = moduleFrom(source('src/components/output-source-readiness.ts'));
const { readOutputRecordedPackage, outputPackageInventory } = moduleFrom(source('src/components/output-recorded-package.ts'));
const { OutputRequirementsClient } = moduleFrom(source('src/state/output-requirements-client.ts'));
const storeMethod = methods(source('src/state/store.ts'), 'FormaStore', ['outputRequirementCommand']);
const componentSource = source('src/components/forma-output-requirements.ts');
const controllerMethods = methods(componentSource, 'FormaOutputRequirements', [
  '#command', '#export', '#download', '#snapshot', '#captureView', '#viewScopeCurrent', '#viewCurrent',
  '#originalAcknowledgment', '#announce', '#retirePackage', '#clearPreparedPackage', '#savePreparedPackage', '#packageOwned', '#packageReady', '#packageRecovery',
]);
const doc = 'recovery-document';
const path = '/api/output-requirements/deliveries/recovery-manifest?documentId=recovery-document';
const command = (count = 1) => ({ action: 'export', eventId: 'recovery-event', manifestId: 'recovery-manifest',
  downloadUrl: path, downloadUrls: Array.from({ length: count }, (_, i) => path + (count > 1 ? `&part=${i + 1}` : '')), partCount: count });
const snapshot = () => ({ documentId: doc, projectId: 'recovery-project', revision: 'r1', sourceRevision: 's1', requirementRevision: 'q1',
  confirmedPlan: { revisionId: 'p1', sourceDigest: 's1', requirementsDigest: 'q1' },
  summary: { scope_known: true, delivery_ready: true }, permissions: { canDownload: true },
  sourceVerification: { status: 'verified', reasonCodes: [] }, capabilities: { limitationCodes: [] }, assets: [], results: [] });
const flatten = value => Array.isArray(value) ? value.map(flatten).join('') : typeof value === 'function' ? '[handler]' : String(value ?? '');
const html = (strings, ...values) => strings.map((s, i) => s + flatten(values[i])).join('');

async function fixture(options = {}) {
  const ledger = [], anchors = [], revoked = [], created = [];
  let outputReads = 0, sourceActive = true, authorizationActive = true, route = '/recovery', current = snapshot(), client;
  const sourceOwner = { generation: 1, key: 'recovery-source' }, authorization = { key: 'recovery-auth', projectId: 'recovery-project' };
  const response = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  const guards = { captureAuthorizationScope: () => authorization, captureSourceOwnership: () => sourceOwner,
    authorizationScopeActive: owner => authorizationActive && owner === authorization,
    sourceOwnershipActive: owner => sourceActive && owner === sourceOwner,
    sourceOwnershipScopeActive: owner => owner === sourceOwner };
  client = new OutputRequirementsClient({ captureScope: () => authorization, scopeActive: guards.authorizationScopeActive,
    captureSourceOwnership: guards.captureSourceOwnership, sourceOwnershipActive: guards.sourceOwnershipActive,
    sourceOwnershipScopeActive: guards.sourceOwnershipScopeActive,
    isSnapshot: (value, documentId, scope) => !!value && value.documentId === documentId && value.projectId === scope.projectId && !!value.confirmedPlan,
    notify() {},
    async fetch(url, init = {}) {
      ledger.push({ method: init.method ?? 'GET', path: url, signal: init.signal });
      if (init.method === 'POST') {
        assert.equal(JSON.parse(init.body).action, 'export');
        if (options.withheld) await client.ensure(doc, { force: true });
        return response({ ok: true, replayed: false, command: options.command ?? command(options.parts), snapshot: current });
      }
      if (url.startsWith('/api/output-requirements?')) {
        outputReads++;
        if (outputReads === 2) {
          if (options.refresh === 'failed') return new Response('{}', { status: 503 });
          if (options.refresh === 'superseded') client.invalidate(doc);
          if (options.refresh === 'private') return new Response('{}', { status: 410 });
          if (options.refresh === 'changed') current = { ...current, confirmedPlan: { ...current.confirmedPlan, revisionId: 'p2' } };
        }
        return response(current);
      }
      assert.ok(url.startsWith(path));
      return options.download ? options.download(init) : new Response('synthetic package bytes', { headers: { 'content-disposition': 'attachment; filename="recovery.zip"' } });
    },
  });
  const { StoreHarness } = moduleFrom(`export class StoreHarness { ${storeMethod} }`);
  const store = new StoreHarness();
  Object.assign(store, guards, { outputRequirements: client, route: { get: () => route }, refreshEvents: async () => {} });
  const { ControllerHarness } = moduleFrom(`export class ControllerHarness {
    documentId = '${doc}'; isConnected = true; _viewEpoch = 0; _busy = ''; _notice = ''; _noticeKind = 'status';
    _uncertainCommand = null; _preflight = null; _authorizationAcknowledged = false; _paidActivation = new Set();
    _allowPartial = false; _recordedPackage = null; _packageReceiptOnly = null; _packageDownload = null; _packageDownloadState = 'recorded'; _downloadUrls = new Set(); _packageBlobUrls = new Set(); _preparedPackage = null;
    _t(_key, fallback, values = {}) { return fallback.replace(/\\{(\\w+)\\}/g, (_, key) => String(values[key])); }
    _controlName(label) { return label; } _readinessMessage(gate) { return gate.reason; }
    _failure(result) { return result.error ?? result.status; } _unresolvedWrite() { return null; }
    _writeNotAttempted() { this._announce('not-attempted', true); } requestUpdate() {} append() {}
    ${controllerMethods}
  }`, { ...readiness, readOutputRecordedPackage, outputPackageInventory, html, nothing: '',
    URL: { createObjectURL: () => { const url = 'blob:synthetic-package' + (created.length || ''); created.push(url); return url; }, revokeObjectURL: url => revoked.push(url) },
    document: { createElement(tag) { assert.equal(tag, 'a'); return { click() { anchors.push(this.download); }, remove() {} }; } } });
  const controller = new ControllerHarness(); controller.store = store;
  await client.ensure(doc);
  const exportPackage = () => controller._export({ preventDefault() {} });
  const restore = async patch => { if (patch) current = { ...current, ...patch }; await client.ensure(doc, { force: true }); };
  const save = (prepared = controller._preparedPackage, options = {}) => { const event = { type: 'click', button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...options }; controller._savePreparedPackage(event, prepared); return event; };
  return { controller, client, ledger, anchors, revoked, created, save, exportPackage, restore,
    downloads: () => ledger.filter(row => row.path.startsWith(path)), posts: () => ledger.filter(row => row.method === 'POST'),
    route: value => { route = value; }, source: value => { sourceActive = value; }, authorization: value => { authorizationActive = value; } };
}

test('ACK descriptor accepts exact single/multipart links and rejects malformed or mixed identities', () => {
  assert.equal(readOutputRecordedPackage(command(), doc).paths[0], path);
  assert.equal(readOutputRecordedPackage(command(3), doc).paths.length, 3);
  assert.equal(readOutputRecordedPackage({ ...command(), downloadUrls: undefined, partCount: undefined }, doc).paths[0], path);
  const invalid = [null, {}, { ...command(), action: 'save' }, { ...command(), eventId: undefined }, { ...command(), manifestId: 9 },
    { ...command(), partCount: 2 }, { ...command(), downloadUrls: [] }, { ...command(), downloadUrls: 'bad' },
    { ...command(), downloadUrls: null }, { ...command(), downloadUrls: Array(1) },
    { ...command(), downloadUrl: path + '&part=1' },
    ...['https://evil.test' + path, path + '#', path + '&extra=1', path + '&documentId=other', path.replace(doc, 'other'),
      path.replace('recovery-manifest', 'other'), path + '&part=1', path + '\\bad', path + '\n'].map(p => ({ ...command(), downloadUrls: [p] })),
    { ...command(2), downloadUrls: [path + '&part=1', path + '&part=1'] },
    { ...command(2), downloadUrls: [path + '&part=2', path + '&part=1'] },
    { ...command(2), downloadUrls: [path + '&part=1', path + '&part=02'] },
    { ...command(), downloadUrls: Array(10000).fill(path), partCount: 10000 }];
  for (const value of invalid) assert.equal(readOutputRecordedPackage(value, doc), null, JSON.stringify(value).slice(0, 150));
  const original = command(); const record = readOutputRecordedPackage(original, doc);
  original.downloadUrls[0] = 'changed'; assert.equal(record.paths[0], path); assert.ok(Object.isFrozen(record.paths));
});

for (const refresh of ['failed', 'superseded']) test(`ACK + ${refresh} refresh: explicit original GET, no POST replay`, async () => {
  const f = await fixture({ refresh }); await f.exportPackage();
  const owner = f.controller._recordedPackage;
  assert.ok(owner); assert.equal(f.downloads().length, 0);
  assert.match(f.controller._packageRecovery(), /Prepare recorded package/);
  assert.match(f.controller._packageRecovery(), /aria-disabled=true/);
  await f.controller._download(path, 'package'); assert.equal(f.downloads().length, 0);
  await f.restore(); assert.equal(f.controller._recordedPackage, owner); assert.equal(f.downloads().length, 0);
  assert.match(f.controller._packageRecovery(), /aria-disabled=false/);
  await f.controller._download(path, 'package');
  assert.equal(f.downloads().length, 1); assert.equal(f.posts().length, 1); assert.deepEqual(f.anchors, []);
  assert.match(f.controller._packageRecovery(), /Save prepared package/);
  assert.equal(f.save().defaultPrevented, false);
  assert.match(f.controller._packageRecovery(), /Check your browser/);
  await f.exportPackage(); assert.equal(f.posts().length, 1);
});

test('ready export prepares one native save link; multipart does not auto-download', async () => {
  const single = await fixture(); await single.exportPackage(); assert.equal(single.anchors.length, 0);
  assert.ok(single.controller._preparedPackage); assert.equal(single.controller._packageDownloadState, 'prepared');
  const multi = await fixture({ parts: 2 }); await multi.exportPackage(); assert.equal(multi.downloads().length, 0);
  assert.match(multi.controller._packageRecovery(), /Prepare part 1 of 2/);
  assert.match(multi.controller._packageRecovery(), /Prepare part 2 of 2/);
  for (const part of multi.controller._recordedPackage.paths) await multi.controller._download(part, 'package');
  assert.equal(multi.downloads().length, 2); assert.equal(multi.posts().length, 1);
});

test('withheld ACK remains a receipt, never reconstructed package data', async () => {
  const f = await fixture({ withheld: true }); await f.exportPackage();
  assert.equal(f.controller._recordedPackage, null); assert.equal(f.downloads().length, 0);
  assert.match(f.controller._notice, /Export recorded, but package details are unavailable/);
  await f.restore(); assert.equal(f.controller._recordedPackage, null);
  assert.ok(f.controller._packageReceiptOnly); await f.exportPackage(); assert.equal(f.posts().length, 1);
});

for (const refresh of ['private', 'changed']) test(`${refresh} refresh cannot adopt old ACK package`, async () => {
  const f = await fixture({ refresh }); await f.exportPackage();
  assert.equal(f.controller._recordedPackage, null); assert.equal(f.downloads().length, 0);
});

test('malformed ACK gives receipt-only message without a download', async () => {
  const f = await fixture({ command: { ...command(), downloadUrls: [path.replace(doc, 'other')] } }); await f.exportPackage();
  assert.equal(f.controller._recordedPackage, null); assert.equal(f.downloads().length, 0);
  assert.match(f.controller._notice, /Export recorded/);
  assert.ok(f.controller._packageReceiptOnly); await f.exportPackage(); assert.equal(f.posts().length, 1);
});

test('new acceptance within the same plan permits an explicit fresh export, never rebases old links', async () => {
  const f = await fixture();
  await f.restore({ summary: { scope_known: true, delivery_ready: false } });
  f.controller._allowPartial = true; await f.exportPackage(); const old = f.controller._recordedPackage;
  assert.ok(old); const initialPosts = f.posts().length;
  await f.restore({ summary: { scope_known: true, delivery_ready: true }, results: [{ id: 'result2', acceptanceId: 'acceptance2', review: 'approved' }] });
  assert.equal(f.controller._packageOwned(old), false);
  assert.equal(f.controller._packageRecovery(), '');
  assert.equal(f.posts().length, initialPosts);
  await f.exportPackage(); assert.equal(f.posts().length, initialPosts + 1);
  assert.notEqual(f.controller._recordedPackage, old);
});

test('inventory ignores unrelated stream revision and row order; acceptance identity changes it', () => {
  const before = { ...snapshot(), results: [{ id: 'b', acceptanceId: 'a' }, { id: 'a', acceptanceId: 'b' }] };
  assert.equal(outputPackageInventory(before), outputPackageInventory({ ...before, revision: 'export-advanced', results: [...before.results].reverse() }));
  assert.notEqual(outputPackageInventory(before), outputPackageInventory({ ...before, results: [{ ...before.results[0], acceptanceId: 'new' }, before.results[1]] }));
});

for (const changed of ['route', 'source', 'authorization', 'document', 'plan', 'requirements', 'permission', 'privateRevision']) {
  test(`${changed} withdrawal prevents recovery and retires in-flight bytes`, async () => {
    let finish;
    const f = await fixture({ refresh: 'failed', download: () => new Promise(resolve => { finish = resolve; }) });
    await f.exportPackage(); await f.restore();
    const active = f.controller._download(path, 'package');
    assert.equal(f.downloads().length, 1);
    if (changed === 'route') f.route('/other');
    if (changed === 'source') f.source(false);
    if (changed === 'authorization') f.authorization(false);
    if (changed === 'document') f.controller.documentId = 'other';
    if (changed === 'plan') await f.restore({ confirmedPlan: { ...snapshot().confirmedPlan, revisionId: 'p2' } });
    if (changed === 'requirements') await f.restore({ requirementRevision: 'q2' });
    if (changed === 'permission') await f.restore({ permissions: { canDownload: false } });
    if (changed === 'privateRevision') f.client.resource(doc).privateRevision = 42;
    assert.equal(f.controller._packageOwned(f.controller._recordedPackage), false);
    finish(new Response('late bytes')); await active;
    assert.equal(f.anchors.length, 0); assert.equal(f.controller._recordedPackage, null);
  });
}

test('duplicate recovery clicks send one GET; successor owner cannot release old bytes', async () => {
  let finish;
  const f = await fixture({ refresh: 'failed', download: () => new Promise(resolve => { finish = resolve; }) });
  await f.exportPackage(); await f.restore();
  const active = f.controller._download(path, 'package');
  await f.controller._download(path, 'package'); assert.equal(f.downloads().length, 1);
  assert.match(f.controller._packageRecovery(), /aria-disabled=true/);
  const old = f.controller._recordedPackage; f.controller._retirePackage();
  assert.equal(f.downloads()[0].signal.aborted, true);
  f.controller._recordedPackage = { ...old, eventId: 'new-event' };
  finish(new Response('old bytes')); await active; assert.equal(f.anchors.length, 0);
});

test('GET failure retains exact recovery without another export', async () => {
  let attempts = 0;
  const f = await fixture({ download: () => ++attempts === 1 ? new Response('{}', { status: 503 }) : new Response('synthetic package') });
  await f.exportPackage(); const owner = f.controller._recordedPackage;
  assert.match(f.controller._packageRecovery(), /download did not finish/);
  await f.controller._download(path, 'package'); assert.equal(f.controller._recordedPackage, owner);
  assert.equal(f.anchors.length, 0); assert.ok(f.controller._preparedPackage); assert.equal(f.posts().length, 1);
});

test('retiring a recorded package releases its temporary Blob URLs', async () => {
  const f = await fixture(); await f.exportPackage();
  assert.equal(f.controller._packageBlobUrls.size, 1);
  f.controller._retirePackage();
  assert.deepEqual(f.revoked, ['blob:synthetic-package']);
  assert.equal(f.controller._packageBlobUrls.size, 0); assert.equal(f.controller._downloadUrls.size, 0);
  assert.equal(f.controller._preparedPackage, null);
});

test('native save reuses checked bytes without GET, export, allocation, or synthetic click', async () => {
  const f = await fixture(); await f.exportPackage();
  const prepared = f.controller._preparedPackage;
  assert.equal(prepared.path, path); assert.equal(prepared.filename, 'recovery.zip');
  assert.match(f.controller._packageRecovery(), /href=blob:synthetic-package download=recovery.zip/);
  assert.equal(f.save().defaultPrevented, false); assert.equal(f.save().defaultPrevented, false);
  await f.controller._download(path, 'package');
  assert.equal(f.controller._preparedPackage, prepared);
  assert.equal(f.downloads().length, 1); assert.equal(f.posts().length, 1);
  assert.equal(f.created.length, 1); assert.deepEqual(f.revoked, []); assert.deepEqual(f.anchors, []);
});

test('ordinary refresh keeps prepared bytes but removes href and blocks native save until ready', async () => {
  const f = await fixture(); await f.exportPackage(); const prepared = f.controller._preparedPackage;
  for (const state of ['loading', 'unavailable']) {
    f.client.resource(doc).state = state;
    assert.equal(f.save().defaultPrevented, true);
    assert.doesNotMatch(f.controller._packageRecovery(), /href=blob:/);
    assert.equal(f.controller._preparedPackage, prepared); assert.deepEqual(f.revoked, []);
  }
  await f.restore(); assert.equal(f.save().defaultPrevented, false);
  assert.equal(f.downloads().length, 1); assert.equal(f.created.length, 1);
});

test('browser fallback exposes only the exact prepared ACK path after an ordinary save request', async () => {
  const f = await fixture(); await f.exportPackage();
  assert.doesNotMatch(f.controller._packageRecovery(), /href=\/api\/output-requirements\/deliveries\//);
  f.save();
  const rendered=f.controller._packageRecovery();
  assert.ok(rendered.includes(`href=${path} target="_blank" rel="noopener" download=recovery.zip`));
  assert.match(rendered,/fresh server checks, without creating another export/);
  assert.equal(f.downloads().length,1);assert.equal(f.posts().length,1);
  for(const state of ['refreshing','unavailable']){
    f.client.resource(doc).state=state;
    assert.doesNotMatch(f.controller._packageRecovery(), /href=\/api\/output-requirements\/deliveries\//);
    assert.equal(f.save().defaultPrevented,true);
  }
});

test('both native link modes use the same synchronous owner guard', () => {
  const rendered=methods(componentSource,'FormaOutputRequirements',['#packageRecovery']);
  assert.equal((rendered.match(/@click=\$\{\(event: MouseEvent\) => this\._savePreparedPackage\(event, prepared\)\}/g)??[]).length,2);
  assert.equal((rendered.match(/@auxclick=\$\{\(event: MouseEvent\) => this\._savePreparedPackage\(event, prepared\)\}/g)??[]).length,2);
});

test('auxiliary and modified clicks do not claim or initiate native saving', async () => {
  const f = await fixture(); await f.exportPackage();
  for (const options of [{ type: 'auxclick', button: 1 }, { type: 'auxclick', button: 2 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) {
    assert.equal(f.save(f.controller._preparedPackage, options).defaultPrevented, true);
    assert.equal(f.controller._packageDownloadState, 'prepared');
  }
  assert.equal(f.downloads().length, 1); assert.equal(f.anchors.length, 0);
});

for (const changed of ['route', 'source', 'authorization', 'privateRevision', 'permission', 'busy', 'part', 'successor']) {
  test(`native save synchronously refuses a stale ${changed} link`, async () => {
    const f = await fixture(); await f.exportPackage(); const prepared = f.controller._preparedPackage;
    if (changed === 'route') f.route('/changed');
    if (changed === 'source') f.source(false);
    if (changed === 'authorization') f.authorization(false);
    if (changed === 'privateRevision') f.client.resource(doc).privateRevision++;
    if (changed === 'permission') await f.restore({ permissions: { canDownload: false } });
    if (changed === 'busy') f.controller._busy = 'other';
    if (changed === 'part') prepared.path += '&part=2';
    if (changed === 'successor') f.controller._preparedPackage = { ...prepared };
    assert.equal(f.save(prepared).defaultPrevented, true);
    assert.equal(f.downloads().length, 1); assert.equal(f.posts().length, 1); assert.equal(f.anchors.length, 0);
  });
}

test('multipart preparation retains only the latest checked part and retires old links', async () => {
  const f = await fixture({ parts: 2 }); await f.exportPackage();
  const paths = f.controller._recordedPackage.paths;
  await f.controller._download(paths[0], 'package'); const old = f.controller._preparedPackage;
  assert.match(f.controller._packageRecovery(), /Save prepared part 1 of 2/);
  await f.controller._download(paths[1], 'package');
  assert.equal(f.controller._preparedPackage.path, paths[1]); assert.equal(f.save(old).defaultPrevented, true);
  assert.equal(f.save().defaultPrevented, false); assert.deepEqual(f.revoked, [old.url]);
  assert.equal(f.controller._packageBlobUrls.size, 1); assert.equal(f.controller._downloadUrls.size, 1);
  assert.match(f.controller._packageRecovery(), /Save prepared part 2 of 2/);
  assert.doesNotMatch(f.controller._packageRecovery(), /Save prepared part 1 of 2/);
  assert.equal(f.posts().length, 1); assert.equal(f.downloads().length, 2);
});

test('lifecycle and full surface render wire the reviewed recovery methods', () => {
  assert.equal((componentSource.match(/this\.#retirePackage\(\)/g) ?? []).length >= 6, true);
  assert.match(componentSource, /if \(this\.#recordedPackage && !this\.#packageOwned\(this\.#recordedPackage\)\) this\.#retirePackage\(\)/);
  assert.equal((componentSource.match(/\$\{this\.#packageRecovery\(\)\}/g) ?? []).length, 2);
  assert.equal(componentSource.includes('#packageParts'), false);
});
