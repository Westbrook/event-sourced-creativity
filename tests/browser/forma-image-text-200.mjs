// Run: node tests/browser/forma-image-text-200.mjs
// Optional: FIREFOX_EXECUTABLE_PATH, FORMA_TEXT200_BASELINE (default HEAD),
// FORMA_TEXT200_STYLE_SHA256, FORMA_TEXT200_OUTPUT_DIR (new directory),
// FORMA_TEXT200_PORT, PYTHON. Defaults to the unchanged Image case.
// FORMA_TEXT200_CASE=model3d-invalid requires explicit FORMA_TEXT200_VIEW_SHA256.
// Exactly one fresh native text2/full1 profile; no case retries.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm, rename, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { firefox } from '@playwright/test';
import { createServer, version as viteVersion } from 'vite';

const root = fileURLToPath(new URL('../..', import.meta.url));
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding:'utf8' }).trim();
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const within = (path, directory) => { if (!directory) return false; const value = relative(directory, path); return !value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value); };
const selectedCase = process.env.FORMA_TEXT200_CASE ?? 'image';
assert.ok(['image', 'model3d-invalid'].includes(selectedCase), 'Only image or model3d-invalid is admitted');
const caseId = selectedCase === 'image' ? 'image-native-text200' : 'model3d-invalid-native-text200';
const casePath = selectedCase === 'image' ? 'tests/browser/forma-image-text-200.py' : 'tests/browser/forma-model3d-invalid-text-200.py';
const viewPath = 'src/experiences/view.ts';
const viewSha256 = process.env.FORMA_TEXT200_VIEW_SHA256 ?? null;
assert.ok(selectedCase === 'model3d-invalid' ? /^[a-f0-9]{64}$/.test(viewSha256 ?? '') : viewSha256 === null,
  'model3d-invalid requires an explicit view SHA-256; Image admits no view successor');
const output = process.env.FORMA_TEXT200_OUTPUT_DIR ? resolve(process.env.FORMA_TEXT200_OUTPUT_DIR)
  : await mkdtemp(resolve(tmpdir(), `forma-${selectedCase}-text200-evidence-`));
if (process.env.FORMA_TEXT200_OUTPUT_DIR) await mkdir(output, { recursive:false });
await mkdir(resolve(output, 'pinned-bytes'));
let runtime;
const runToken = randomUUID();
const baseline = git('rev-parse', `${process.env.FORMA_TEXT200_BASELINE ?? 'HEAD'}^{commit}`);
const head = git('rev-parse', 'HEAD');
const sourceStatus = git('status', '--short');
const baselineTree = new Map(git('ls-tree', '-rz', baseline).split('\0').filter(Boolean).map(line => {
  const [metadata, path] = line.split('\t'); return [path, metadata.split(' ')[2]];
}));
const tests = ['tests/browser/forma-image-text-200.mjs', 'tests/browser/firefox-text-zoom.py', casePath];
const declaredTests = new Map(await Promise.all(tests.map(async path => [path, sha256(await readFile(resolve(root, path)))])));
const stylePath = 'src/experiences/style.css';
const styleSha256 = process.env.FORMA_TEXT200_STYLE_SHA256 ?? sha256(await readFile(resolve(root, stylePath)));
const dependencies = await realpath(resolve(root, 'node_modules'));
const port = Number(process.env.FORMA_TEXT200_PORT ?? 59388);
assert.ok(Number.isInteger(port) && port > 1023 && port < 65536, 'Use a dedicated unprivileged loopback port');
const baseURL = `http://127.0.0.1:${port}`;
let executable = resolve(process.env.FIREFOX_EXECUTABLE_PATH ?? firefox.executablePath());
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src blob:; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const receipt = { status:'running', startedAt:new Date().toISOString(), root, head, baseline,
  sourceStatus, styleSha256, viewSha256, case:caseId, selectedCase, declaredTests:Object.fromEntries(declaredTests), node:process.version,
  vite:viteVersion, baseURL, csp, executable, output, runToken,
  scope:`One English ${selectedCase} synthetic native Firefox text200 profile; settled focus/control/text-line bounds only, no glyph-ink, full focus-outline, OS, physical-device or AT claim`,
  errors:[], requests:[], forbidden:[], files:[], finalizationErrors:[] };
let server, child, timer, snapshotTimer, childLog, childLogDone, revision = 0, queue = Promise.resolve();
const records = new Map(), loadedInputs = new Set();
async function pin(path) {
  path = path.split('?')[0];
  const bytes = await readFile(path), hash = sha256(bytes), repoPath = within(path, root) ? relative(root, path).split(sep).join('/') : null;
  let scope;
  if (repoPath === stylePath) { assert.equal(hash, styleSha256, 'Declared Image style bytes changed'); scope = 'declared-style-successor'; }
  else if (repoPath === viewPath && viewSha256) { assert.equal(hash, viewSha256, 'Declared invalid-focus view bytes changed'); scope = 'declared-view-successor'; }
  else if (declaredTests.has(repoPath)) { assert.equal(hash, declaredTests.get(repoPath), `Test source bytes changed: ${repoPath}`); scope = 'declared-test-source'; }
  else if (repoPath && baselineTree.has(repoPath)) { assert.equal(blobHash(bytes), baselineTree.get(repoPath), `Loaded repository input differs from baseline: ${repoPath}`); scope = 'baseline-identical'; }
  else {
    assert.ok(within(path, runtime) || within(await realpath(path), dependencies), `Unadmitted loaded input: ${path}`);
    scope = within(path, runtime) ? 'optimized-runtime' : 'installed-dependency';
  }
  // Revalidate on every use; reoptimization may change a path's bytes in place.
  const key = `${path}\0${hash}`;
  if (!records.has(key)) {
    const retained = `pinned-bytes/${hash}`;
    await writeFile(resolve(output, retained), bytes);
    records.set(key, { path, relative:repoPath, scope, sha256:hash, bytes:bytes.length, retained });
  }
}
async function snapshot() {
  if (server) for (const module of server.environments.client.moduleGraph.idToModuleMap.values()) {
    if (module.file) try { loadedInputs.add(module.file.split('?')[0]); await pin(module.file); }
    catch (error) { receipt.errors.push({ stage:'snapshot-pin', path:module.file, error:String(error) }); }
  }
  await writeGraph();
}
async function writeGraph() {
  receipt.files = [...records.values()].sort((a, b) => a.path.localeCompare(b.path));
  receipt.loadedInputs = [...loadedInputs].sort();
  const graph = { revision:++revision, at:new Date().toISOString(), head, baseline, styleSha256, viewSha256, case:caseId,
    files:receipt.files, loadedInputs:receipt.loadedInputs, errors:receipt.errors, requests:receipt.requests, forbidden:receipt.forbidden };
  const temporary = resolve(output, `graph-${revision}.json.tmp`);
  await writeFile(temporary, `${JSON.stringify(graph, null, 2)}\n`);
  await rename(temporary, resolve(output, 'graph.json'));
}
async function guardedPin(path) {
  if (path.startsWith('\0')) return;
  try { await pin(path); }
  catch (error) {
    receipt.errors.push({ stage:'source-guard', path, error:String(error) });
    try { await snapshot(); } catch (writeError) { receipt.errors.push({ stage:'guard-receipt', error:String(writeError) }); }
    throw error;
  }
}
const guard = { name:'forma-text200-source-boundary', enforce:'pre',
  async transform(_code, id) { await guardedPin(id); if (!id.startsWith('\0')) loadedInputs.add(id.split('?')[0]); return null; },
  async transformIndexHtml(_html, context) { await guardedPin(context.filename); },
  configureServer(instance) { instance.middlewares.use((request, response, next) => {
    const path = new URL(request.url, baseURL).pathname;
    const item = { method:request.method, path }; receipt.requests.push(item);
    if (!['GET', 'HEAD'].includes(request.method) || path.startsWith('/api/')) {
      receipt.forbidden.push(item); response.statusCode = 403; response.end('Static text200 fixture refuses backend/mutation request'); return;
    }
    next();
  }); },
};
function killGroup(pid, signal = 'SIGKILL') {
  if (!Number.isSafeInteger(pid) || pid <= 1) return;
  try { process.kill(-pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function killOwnedBrowser() {
  const ownership = resolve(output, 'profile', 'browser-process.json');
  if (existsSync(ownership)) {
    const value = JSON.parse(await readFile(ownership, 'utf8'));
    assert.equal(value.runToken, runToken); assert.equal(value.ownerPythonPid, child.pid);
    assert.equal(value.executable, executable); assert.equal(value.pid, value.processGroup);
    assert.equal(value.profile, resolve(output, 'profile', 'disposable-profile'));
    if (value.state === 'cleaned') return;
    assert.equal(value.state, 'active');
    // Check the live leader's unique profile before killing a potentially stale PID.
    let command;
    try { command = execFileSync('ps', ['-ww', '-p', String(value.pid), '-o', 'args='], { encoding:'utf8' }); }
    catch (error) {
      if (error.status !== 1) throw error;
      try { process.kill(-value.processGroup, 0); }
      catch (probeError) { if (probeError.code === 'ESRCH') return; throw probeError; }
      throw new Error('Owned Firefox leader exited but its process group remains; cleanup cannot be verified');
    }
    assert.ok(command.includes(executable) && command.includes(value.profile), 'Browser PID no longer belongs to this private profile');
    killGroup(value.processGroup);
  }
}
try {
  assert.ok(existsSync(executable), 'Set FIREFOX_EXECUTABLE_PATH to the installed Firefox executable');
  executable = await realpath(executable); receipt.executable = executable;
  runtime = await mkdtemp(resolve(tmpdir(), `forma-${selectedCase}-text200-runtime-`)); receipt.runtime = runtime;
  for (const path of [...tests, stylePath, viewPath, 'package.json', 'pnpm-lock.yaml',
    'tests/experience-display-browser/index.html', 'tests/experience-display-browser/fixture.mjs',
    'tests/experience-display-browser/vite.config.mjs', 'tests/model3d-native/vite.config.mjs']) await guardedPin(resolve(root, path));
  // The existing pure static config keeps its Vite version/client-byte guard and excludes application backends.
  const { default:config } = await import(pathToFileURL(resolve(root, 'tests/experience-display-browser/vite.config.mjs')));
  server = await createServer({ ...config, configFile:false, publicDir:false, cacheDir:resolve(runtime, 'vite-cache'),
    plugins:[guard, ...config.plugins], optimizeDeps:{ entries:['tests/experience-display-browser/index.html'] },
    server:{ ...config.server, port, strictPort:true, headers:{ 'Content-Security-Policy':csp, 'Referrer-Policy':'no-referrer' } } });
  await server.listen(); await snapshot();
  snapshotTimer = setInterval(() => { queue = queue.then(snapshot).catch(error => { receipt.errors.push({ stage:'periodic-snapshot', error:String(error) }); }); }, 300);
  const configPath = resolve(output, 'run-config.json');
  await writeFile(configPath, JSON.stringify({ firefox:executable, baseURL, baseline, styleSha256, viewSha256, case:caseId, runToken, graph:resolve(output, 'graph.json') }, null, 2)+'\n');
  const args = ['-B', resolve(root, casePath), resolve(output, 'profile'), configPath];
  receipt.child = { executable:process.env.PYTHON ?? 'python3', args, wallCapSeconds:60 };
  const started = performance.now();
  const logPath = resolve(output, 'python.log');
  childLog = createWriteStream(logPath, { flags:'wx' });
  childLogDone = new Promise(done => {
    childLog.once('finish', done);
    childLog.once('error', error => { receipt.errors.push({ stage:'child-log', error:String(error) }); done(); });
  });
  child = spawn(receipt.child.executable, args, { detached:true, stdio:['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(childLog, { end:false }); child.stderr.pipe(childLog, { end:false });
  child.once('close', () => childLog.end());
  receipt.childLog = logPath;
  timer = setTimeout(() => {
    receipt.child.supervisorFired = true;
    // The browser owns a separate group; terminate both exact owned groups.
    killOwnedBrowser().catch(error => receipt.errors.push({ stage:'supervisor-browser', error:String(error) }))
      .finally(() => killGroup(child.pid));
  }, 60000);
  const result = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); });
  clearTimeout(timer); timer = undefined;
  receipt.child = { ...receipt.child, ...result, elapsedSeconds:(performance.now()-started)/1000 };
  receipt.profile = JSON.parse(await readFile(resolve(output, 'profile', 'receipt.json'), 'utf8'));
  assert.equal(result.code, 0, 'Native Firefox case failed; inspect preserved Python receipt/log');
  assert.equal(receipt.child.supervisorFired, undefined, 'Parent browser deadline fired');
  assert.equal(receipt.profile.status, 'pass', 'Native Firefox receipt did not pass cleanup');
  assert.ok(receipt.child.elapsedSeconds < 60, 'Python profile exceeded the 60-second parent cap');
  receipt.status = 'passed-pending-finalization';
} catch (error) {
  receipt.status = 'failed'; receipt.error = { message:String(error), stack:error.stack }; process.exitCode = 1;
} finally {
  clearTimeout(timer); clearInterval(snapshotTimer);
  const failed = (stage, error) => { receipt.finalizationErrors.push({ stage, error:String(error) }); receipt.status = 'failed'; process.exitCode = 1; };
  for (const [stage, action] of [
    ['owned-browser', killOwnedBrowser], ['owned-python', () => { if (child?.exitCode === null && child?.signalCode === null) killGroup(child.pid); }],
    ['child-log', async () => { childLog?.end(); await childLogDone; }],
    ['pending-snapshot', () => queue], ['retain-before-close', snapshot],
    ['server-close', () => server?.close()], ['retain-after-close', snapshot],
    ['loaded-product-graph', () => {
      if (receipt.status !== 'passed-pending-finalization') return;
      for (const path of [stylePath, viewPath, 'src/experiences/entry.ts', 'tests/experience-display-browser/fixture.mjs'])
        assert.ok(loadedInputs.has(resolve(root, path)), `Required product/fixture source was not loaded: ${path}`);
    }],
    ['verify-retained-bytes', async () => { for (const record of records.values()) assert.equal(sha256(await readFile(resolve(output, record.retained))), record.sha256); }],
    ['runtime-remove', () => runtime ? rm(runtime, { recursive:true, force:true }) : undefined],
    ['private-profile-remove', () => rm(resolve(output, 'profile', 'disposable-profile'), { recursive:true, force:true })],
    ['source-identity', async () => {
      assert.equal(git('rev-parse', 'HEAD'), head); assert.equal(git('status', '--short'), sourceStatus);
      for (const path of [...tests, stylePath, viewPath]) await pin(resolve(root, path));
    }],
  ]) try { await action(); } catch (error) { failed(stage, error); }
  try { await writeGraph(); } catch (error) { failed('final-graph', error); }
  receipt.runtimeDeleted = !runtime || !existsSync(runtime);
  if (receipt.errors.length || receipt.forbidden.length) failed('source-or-network-guard', new Error('Source/network guard recorded failures'));
  if (receipt.status === 'passed-pending-finalization') receipt.status = 'pass';
  receipt.endedAt = new Date().toISOString();
  await writeFile(resolve(output, 'receipt.json'), JSON.stringify(receipt, null, 2)+'\n');
  console.log(JSON.stringify({ status:receipt.status, case:caseId, output, baseline, styleSha256, viewSha256, error:receipt.error?.message }));
}
