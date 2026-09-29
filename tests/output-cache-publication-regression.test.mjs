import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OutputRequirementsClient } from '../src/state/output-requirements-client.ts';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(`${root}/package.json`);
const ts = require('typescript');
const sources = {};
function method(path, className, name) {
  const source = readFileSync(`${root}/${path}`, 'utf8');
  sources[path] = createHash('sha256').update(source).digest('hex');
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const cls = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  const member = cls?.members.find(node => node.name?.getText(ast) === name);
  assert.ok(member, `Missing exact production method ${className}.${name}`);
  return member.getText(ast);
}
const publish = method('src/state/store.ts', 'FormaStore', '#publishAppended');
const command = method('src/state/store.ts', 'FormaStore', 'outputRequirementCommand');
const updated = method('src/components/forma-output-requirements.ts', 'FormaOutputRequirements', 'updated');
const emitted = ts.transpileModule(`
class StoreProbe {
  outputRequirements; session = { get: () => null };
  #sourceRetired = false; #sourcePublishedRead = 0; #sourceReadSequence = 0; #focalBackfillTimer;
  #nativeImageMutation(fn) { return fn(); }
  #reconcileNativeImageScopes() {}
  #snapshotIdentity() { throw new Error('Unexpected analytics action'); }
  #backfillImageFocalPoints() { throw new Error('Unexpected media maintenance'); }
  captureSourceOwnership() { return 'fixture-source'; }
  captureAuthorizationScope() { return 'fixture-scope'; }
  authorizationScopeActive(scope) { return scope === 'fixture-scope'; }
  sourceOwnershipActive(source) { return source === 'fixture-source'; }
  async refreshEvents() { throw new Error('No successful save is scripted'); }
  ${publish}
  ${command}
  publish(events) { return this.#publishAppended(events, {}, true); }
  publishLocal(events) { return this.#publishAppended(events, undefined, true); }
  retire() { this.#sourceRetired = true; }
  sourceFence() { return this.#sourcePublishedRead; }
}
class ViewProbe {
  documentId = 'fixture-document'; store;
  #loading = false; #sourceRefreshing = false;
  #refresh() { return this.store.outputRequirements.ensure(this.documentId); }
  ${updated}
}
globalThis.probeClasses = { StoreProbe, ViewProbe };
`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const context = {};
runInNewContext(emitted, context);
const { StoreProbe, ViewProbe } = context.probeClasses;

function fixture(onNotify = () => {}) {
  const queue = [], observed = [];
  const scope = { key: 'fixture-scope', projectId: 'fixture-project' };
  const store = new StoreProbe();
  store.outputRequirements = new OutputRequirementsClient({
    captureScope: () => scope, scopeActive: value => value === scope,
    isSnapshot: value => value?.documentId === 'fixture-document' && /^output:\d+$/.test(value?.revision),
    notify() { onNotify(store); },
    async fetch(path, init) {
      observed.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
      assert.ok(queue.length, 'Every request must have an explicit local response; no network is allowed');
      return queue.shift()();
    },
  });
  const view = new ViewProbe(); view.store = store;
  const snapshot = revision => ({ documentId: 'fixture-document', revision: `output:${revision}` });
  return { store, view, queue, observed, snapshot };
}

const results = [];
for (const [label, events] of [
  ['unrelated committed event', [{ type: 'GenerationFailed', sequence: 101 }]],
  ['head-only publication has no fresh event bodies', []],
]) {
  const f = fixture();
  f.queue.push(() => Response.json(f.snapshot(100)));
  await f.store.outputRequirements.ensure('fixture-document');
  f.store.publish(events);
  assert.equal(f.store.outputRequirements.resource('fixture-document').state, 'refreshing');
  f.queue.push(() => Response.json(f.snapshot(101)));
  f.view.updated();
  await f.store.outputRequirements.ensure('fixture-document');
  assert.equal(f.observed.length, 2, 'Lifecycle and explicit ensure share one refresh');
  assert.equal(f.store.outputRequirements.resource('fixture-document').snapshot.revision, 'output:101');
  assert.equal(f.observed.filter(request => request.method === 'POST').length, 0);
  assert.equal(f.queue.length, 0);
  results.push({ label, publicationInvalidatesOldCache: true, lifecycleRefreshVerified: true, automaticWrites: 0 });
}

// The existing transport's invalidation fence correctly rejects an older delayed read.
const delayed = fixture(); let releaseOld;
delayed.queue.push(() => new Promise(resolve => { releaseOld = resolve; }));
const old = delayed.store.outputRequirements.ensure('fixture-document');
delayed.store.outputRequirements.invalidate();
delayed.queue.push(() => Response.json(delayed.snapshot(101)));
await delayed.store.outputRequirements.ensure('fixture-document');
releaseOld(Response.json(delayed.snapshot(100))); await old;
assert.equal(delayed.store.outputRequirements.resource('fixture-document').snapshot.revision, 'output:101');
results.push({ label: 'existing invalidation fence', delayedOldReadCannotReplaceNewerSnapshot: true });

{
  const retired = fixture();
  retired.queue.push(() => Response.json(retired.snapshot(100)));
  await retired.store.outputRequirements.ensure('fixture-document');
  retired.store.retire(); retired.store.publish([{type:'GenerationFailed', sequence:101}]);
  assert.equal(retired.store.outputRequirements.resource('fixture-document').state, 'ready');
  assert.equal(retired.observed.length, 1, 'Retired publisher cannot initiate a cache refresh');
  results.push({label:'retired source publication', invalidationSuppressed:true});

  const fences = [];
  const local = fixture(store => fences.push(store.sourceFence()));
  local.queue.push(() => Response.json(local.snapshot(100)));
  await local.store.outputRequirements.ensure('fixture-document'); fences.length = 0;
  local.store.publishLocal([{type:'GenerationFailed', sequence:101}]);
  assert.deepEqual(fences, [1], 'Local source-read fence precedes synchronous subscriber notification');
  results.push({label:'local publication ordering', sourceFenceBeforeNotification:true});

  const pending = fixture(); let releaseWrite;
  pending.queue.push(() => Response.json(pending.snapshot(100)));
  await pending.store.outputRequirements.ensure('fixture-document');
  pending.queue.push(() => new Promise(resolve => { releaseWrite = resolve; }));
  const write = pending.store.outputRequirements.command('fixture-document', {
    action:'save', expectedRevision:'output:100', clientMutationId:'fixture-pending', spec:{fixture:true},
  }, 'fixture save');
  while (!releaseWrite) await new Promise(resolve => setImmediate(resolve));
  pending.store.publish([{type:'GenerationFailed', sequence:101}]);
  assert.equal(pending.store.outputRequirements.retainedWrite('fixture-document').status, 'pending');
  releaseWrite(Response.json({ok:true,replayed:false,command:{action:'save',eventId:'fixture-event'},snapshot:pending.snapshot(102)}));
  const acknowledgment = await write;
  assert.equal(acknowledgment.status, 'saved');
  const retained = pending.store.outputRequirements.retainedWrite('fixture-document');
  assert.equal(retained.status, 'acknowledged');
  assert.equal(retained.receipt.clientMutationId, 'fixture-pending');
  assert.equal(pending.observed.filter(request => request.method === 'POST').length, 1);
  assert.equal(pending.store.outputRequirements.resource('fixture-document').state, 'refreshing');
  results.push({label:'pending command', exactAcknowledgmentSurvivesInvalidation:true, automaticReplay:false});

  const duplicate = fixture();
  duplicate.queue.push(() => Response.json(duplicate.snapshot(100)));
  await duplicate.store.outputRequirements.ensure('fixture-document');
  duplicate.store.publish([]); duplicate.store.publish([]);
  duplicate.queue.push(() => Response.json(duplicate.snapshot(100)));
  duplicate.view.updated(); duplicate.view.updated();
  await duplicate.store.outputRequirements.ensure('fixture-document');
  assert.equal(duplicate.observed.length, 2);
  results.push({label:'duplicate empty publications before refresh', conservativeInvalidation:true, coalescedRefresh:true});
}

console.log(JSON.stringify({ results, productionMethodSources: sources,
  limitations: ['Isolated exact-method fixture plus real transport; not the whole Store or browser.',
    'Head-only publication exercises its empty-event boundary; it does not reproduce the full source-read pipeline.',
    'Synthetic local responses and minimal snapshot validator; no provider, database or network access.',
    'Does not establish the historical cause of either production409. No production mutation or browser acceptance.',
    'Exercises the local source correction; full Store integration, types and build remain separate checks.'] }, null, 2));
