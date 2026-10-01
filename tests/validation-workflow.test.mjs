import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { planValidation, runStages } from '../scripts/lib/validation-plan.mjs';
import { census, classify, verifyInventory } from '../scripts/lib/validation-inventory.mjs';
import { executionOwnership } from '../scripts/lib/validation-ownership.mjs';
import { fingerprint, withLock, runProcess } from '../scripts/lib/validation-process.mjs';

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'forma-validation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => { mkdirSync(join(root, name, '..'), { recursive: true }); writeFileSync(join(root, name), value); };
  put('package.json', JSON.stringify({ scripts: { test: 'node run.mjs' } }));
  return { root, put };
}

test('inventory assigns TypeScript and nested browser files; new and removed cases cannot silently disappear', t => {
  const { root, put } = sandbox(t);
  put('tests/logic.test.ts', ''); put('tests/browser/native.test.mjs', ''); put('playwright.local.config.mjs', '');
  const found = census(root);
  const registry = { tests: Object.fromEntries(found.files.map(f => [f, classify(root, f)])), browserConfigs: found.configs, entrypoints: found.entrypoints, commands: found.commands };
  registry.execution = executionOwnership(root, found, registry.tests);
  assert.deepEqual(verifyInventory(root, registry), []);
  assert.equal(registry.tests['tests/logic.test.ts'], 'source'); assert.equal(registry.tests['tests/browser/native.test.mjs'], 'browser');
  put('tests/new.test.mjs', '');
  assert.match(verifyInventory(root, registry).join(), /Unregistered test/u);
  rmSync(join(root, 'tests/logic.test.ts'));
  assert.match(verifyInventory(root, registry).join(), /Removed test/u);
});

test('build prerequisites follow helper imports instead of only looking at the test filename', t => {
  const { root, put } = sandbox(t);
  put('tests/a.test.mjs', "import './helpers/a.mjs';");
  put('tests/helpers/a.mjs', "import './b.mjs';");
  put('tests/helpers/b.mjs', "const path = '../../dist/server/index.js';");
  assert.equal(classify(root, 'tests/a.test.mjs'), 'artifact');
  put('tests/isolated.test.mjs', "import {build} from 'esbuild'; await build({write:false});");
  assert.equal(classify(root, 'tests/isolated.test.mjs'), 'runtime');
  put('tests/computed.test.mjs', 'import(pathToFileURL(ROOT+"/tests/helpers/db.mjs").href);');
  put('tests/helpers/db.mjs', 'import {DatabaseSync} from "node:sqlite";');
  assert.equal(classify(root, 'tests/computed.test.mjs'), 'runtime');
});

test('fixture imports cannot silently register another suite', t => {
  const { root, put } = sandbox(t);
  put('tests/helper.test.mjs', "import './other.test.mjs';"); put('tests/other.test.mjs', '');
  const found = census(root);
  const registry = { tests: Object.fromEntries(found.files.map(f => [f, classify(root, f)])), browserConfigs: [], entrypoints: [], commands: found.commands };
  assert.match(verifyInventory(root, registry).join(), /Test module imported as a fixture/u);
});

test('types fail before any build/browser prerequisite or later process starts', async t => {
  const { root } = sandbox(t), started = [];
  const groups = [{ lane: 'source', files: ['a'] }, { lane: 'runtime', files: ['b'] }, { lane: 'artifact', files: ['c'] }];
  const plan = planValidation('test', groups, 2);
  assert.deepEqual(plan.map(s => s.id), ['types', 'lint', 'source', 'runtime', 'build', 'artifact']);
  await assert.rejects(runStages(plan, async step => {
    started.push(step.id);
    const result = await runProcess(process.execPath, ['-e', 'process.exit(2)'], { cwd: root, log: join(root, 'failure.log') });
    if (result.code) throw Error('type failure');
  }), /type failure/u);
  assert.deepEqual(started, ['types']);
  assert.equal(plan.filter(s => s.id === 'build').length, 1);
});

test('an interrupted process that exits zero cannot qualify a check', async t => {
  const { root } = sandbox(t);
  const result = await runProcess(process.execPath, ['-e', "process.on('SIGTERM',()=>process.exit(0)); setInterval(()=>{},1000)"], { cwd: root, log: join(root, 'interrupted.log'), timeoutMs: 200 });
  assert.equal(result.terminated, true); assert.notEqual(result.code, 0);
});

test('matching static receipts reuse successful checks and source changes invalidate them', async t => {
  const { root, put } = sandbox(t);
  const mark = `node -e "require('node:fs').appendFileSync('calls.log', 'checked\\n')"`;
  put('package.json', JSON.stringify({ type: 'module', scripts: { typecheck: mark, lint: mark } }));
  put('src/a.ts', 'export const a=1');
  for (const file of ['validation.mjs', 'lib/validation-plan.mjs', 'lib/validation-process.mjs', 'lib/validation-inventory.mjs', 'lib/validation-ownership.mjs']) put('scripts/' + file, readFileSync(new URL('../scripts/' + file, import.meta.url), 'utf8'));
  symlinkSync(new URL('../node_modules', import.meta.url), join(root, 'node_modules'), 'dir');
  const run = async mode => {
    const result = await runProcess(process.execPath, ['scripts/validation.mjs', mode], { cwd: root, log: join(root, mode + '.log'), env: { pnpm_config_verify_deps_before_run: 'false', FORMA_SOURCE_ROOT: undefined } });
    assert.equal(result.code, 0, readFileSync(join(root, mode + '.log'), 'utf8'));
  };
  await run('inventory:update'); await run('fast'); await run('fast');
  assert.equal(readFileSync(join(root, 'calls.log'), 'utf8'), 'checked\nchecked\n');
  put('src/a.ts', 'export const a=2'); await run('fast');
  assert.equal(readFileSync(join(root, 'calls.log'), 'utf8'), 'checked\n'.repeat(4));
});

test('build keys include source, lockfile and configuration; output tampering invalidates reuse', t => {
  const { root, put } = sandbox(t);
  put('src/a.ts', 'export const a=1'); put('pnpm-lock.yaml', 'version: 1'); put('dist/app.js', 'a=1');
  const first = fingerprint(root), output = fingerprint(root, { output: true });
  put('tests/new.test.mjs', '// test only'); assert.equal(fingerprint(root), first);
  put('src/a.ts', 'export const a=2'); assert.notEqual(fingerprint(root), first);
  const source = fingerprint(root); put('pnpm-lock.yaml', 'version: 2'); assert.notEqual(fingerprint(root), source);
  put('dist/app.js', 'corrupt'); assert.notEqual(fingerprint(root, { output: true }), output);
});

test('the build lock rejects concurrent writers and is released after failure', async t => {
  const { root } = sandbox(t), path = join(root, 'lock');
  await assert.rejects(withLock(path, async () => {
    await assert.rejects(withLock(path, () => assert.fail('second writer ran')), /in use/u);
    throw Error('interrupted build');
  }), /interrupted build/u);
  await withLock(path, async () => assert.ok(readFileSync(join(path, 'owner.json'), 'utf8')));
});

test('retired evaluation CLI fails without reading environment files or executing providers', async t => {
  const { root, put } = sandbox(t);
  put('retired.mjs', readFileSync(new URL('../scripts/run-image-adapter-cycle-search.mjs', import.meta.url), 'utf8'));
  const result = await runProcess(process.execPath, [join(root, 'retired.mjs'), '--approve-paid-eval=old'], { cwd: root, log: join(root, 'retired.log') });
  assert.equal(result.code, 1); assert.match(readFileSync(join(root, 'retired.log'), 'utf8'), /image_adapter_cycle_retired/u);
});

test('browser batches keep one compatible server and reject conflicting source/build lifecycles', () => {
  const config = new URL('../playwright.validation.config.mjs', import.meta.url).href;
  const script = `const {default:c}=await import(${JSON.stringify(config)}); console.log(JSON.stringify({servers:c.webServer.length,projects:c.projects.map(p=>p.name)}));`;
  const run = selected => spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 30000,
    env: { ...process.env, FORMA_BROWSER_CONFIGS: selected, FORMA_A11Y_SYNTHETIC_NETWORK: '1' } });
  const compatible = run('output-footer,context-return-reading');
  assert.equal(compatible.status, 0, compatible.stderr);
  assert.deepEqual(JSON.parse(compatible.stdout), { servers: 1, projects: ['output-footer','context-return-reading'] });
  const download = run('story-revision-download');
  assert.equal(download.status, 0, download.stderr);
  assert.deepEqual(JSON.parse(download.stdout), { servers: 0, projects: ['story-revision-download'] });
  const conflicting = run('content-first,output-footer');
  assert.equal(conflicting.status, 1); assert.match(conflicting.stderr, /Incompatible source\/built servers/u);
  const repeatedProject = run('content-first,deliver-containment');
  assert.equal(repeatedProject.status, 1); assert.match(repeatedProject.stderr, /Conflicting browser project identity: desktop/u);
});

test('download admission retains exact project, file and positive scenario boundaries', async () => {
  const { admittedBrowserDownload } = await import('./browser/helpers/download-admission.mjs');
  for (const [kind, title] of [
    ['audio','Audio declared reviewed original WAV downloads once and reopens as exact retained bytes'],
    ['slides','Slides declared reviewed revision one downloads one audience PowerPoint file'],
  ]) {
    const input = {project:`${kind}-reviewed-download`,file:`forma-${kind}-reviewed-download.spec.mjs`,title,synthetic:false};
    assert.equal(admittedBrowserDownload(input),true);
    for (const field of ['project','file','title']) assert.equal(admittedBrowserDownload({...input,[field]:'unreviewed'}),false);
  }
  assert.equal(admittedBrowserDownload({project:'arbitrary',file:'forma-memory-purposes.spec.mjs',title:'Memory purposes: explicit inactive controls in en',synthetic:false}),false);
});

test('real type errors surface a timed negative before dependent stages start', async t => {
  const { root, put } = sandbox(t), started = [];
  put('bad.ts', 'export const wrong: number = "injected failure";');
  const compiler = new URL('../node_modules/typescript/lib/tsc.js', import.meta.url).pathname;
  const result = await runProcess(process.execPath, [compiler, '--noEmit', '--skipLibCheck', '--target', 'es2022', join(root, 'bad.ts')], {
    cwd: root, log: join(root, 'types.log'), onFailure: () => started.push('negative'),
  });
  assert.notEqual(result.code, 0); assert.deepEqual(started, ['negative']);
  assert.ok(result.firstNegativeMs >= 0 && result.firstNegativeMs <= result.elapsedMs);
});

test('case reporter distinguishes nested leaves, parent results and explicit skipped coverage', async t => {
  const { root, put } = sandbox(t);
  put('cases.mjs', `import test from 'node:test'; test('parent',async t=>{await t.test('one',()=>{});await t.test('two',{skip:'fixture unavailable'},()=>{});});test('independent',()=>{});`);
  const reporter = new URL('../scripts/lib/validation-reporter.mjs', import.meta.url).pathname;
  const result = await runProcess(process.execPath, ['--test', '--test-reporter='+reporter, '--test-reporter-destination='+join(root,'cases.jsonl'), join(root,'cases.mjs')], {cwd:root,log:join(root,'reporter.log'),env:{NODE_TEST_CONTEXT:undefined}});
  assert.equal(result.code,0);
  const rows=readFileSync(join(root,'cases.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(rows.filter(row=>row.parent).map(row=>row.name),['parent']);
  assert.deepEqual(rows.filter(row=>!row.parent).map(row=>row.name),['one','two','independent']);
  assert.equal(rows.find(row=>row.name==='two').skip,'fixture unavailable');
});

test('expected compiler diagnostics in TAP comments are not early negatives', async t => {
  const { root } = sandbox(t), negatives = [];
  const result = await runProcess(process.execPath, ['-e', 'console.log("# bad.ts(1,1): error TS2322: expected fault probe\\nok 1 - rejects invalid types");'], {
    cwd: root, log: join(root, 'expected-diagnostic.log'), onFailure: () => negatives.push('negative'),
  });
  assert.equal(result.code, 0); assert.equal(result.firstNegativeMs, null);
  assert.deepEqual(negatives, []);
});
