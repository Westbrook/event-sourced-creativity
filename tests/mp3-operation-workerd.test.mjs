import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(new URL('../package.json', import.meta.url));
const wrangler = createRequire(require.resolve('wrangler'));
const { build } = wrangler('esbuild'), { Miniflare, Log, LogLevel } = wrangler('miniflare');
const entry = `import * as m from ${JSON.stringify(root + 'worker/selected-output-share-mp3-operation.ts')};
import * as p from ${JSON.stringify(root + 'worker/selected-output-share-mp3-projection.ts')};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export default { async fetch(request) {
 const action = new URL(request.url).pathname;
 if (action === '/status') { const op = m.acquireSelectedOutputShareMp3Operation(request.signal); if(op) m.finishSelectedOutputShareMp3Operation(op); return Response.json({idle:!!op}); }
 const c = new AbortController();
 const short = action === '/unread-timeout';
 const op = m.acquireSelectedOutputShareMp3Operation(c.signal, short ? {wallDeadline:Date.now()+50,monotonicDeadline:performance.now()+50} : undefined);
 if (!op) return new Response('busy',{status:503});
 if(action === '/late-qualification') {
  const source = new Uint8Array(await request.arrayBuffer());
  const expected = {sha256:request.headers.get('x-sha256'),byteLength:source.length,mimeType:'audio/mpeg',recipe:'forma.audio.instrumental-20@1'};
  const digest = crypto.subtle.digest.bind(crypto.subtle); let calls=0, resume;
  const gate = new Promise(resolve => {resume=resolve});
  crypto.subtle.digest = (...args) => ++calls===3 ? gate.then(()=>digest(...args)) : digest(...args);
  const pending = m.runSelectedOutputShareMp3Operation(op,()=>p.projectSelectedOutputShareMp3(source,expected,m.selectedOutputShareMp3OperationSignal(op)),p.disposeSelectedOutputShareMp3);
  while(calls<3) await sleep(0); c.abort(); let rejected=false; try{await pending}catch{rejected=true}
  m.finishSelectedOutputShareMp3Operation(op);
  const held = p.selectedOutputShareMp3ProjectionBusy() && !m.acquireSelectedOutputShareMp3Operation(new AbortController().signal);
  resume(); await p.selectedOutputShareMp3ProjectionDrained(); await sleep(0); crypto.subtle.digest=digest;
  const next=m.acquireSelectedOutputShareMp3Operation(new AbortController().signal); if(next)m.finishSelectedOutputShareMp3Operation(next);
  source.fill(0);return Response.json({rejected,held,reopened:!!next});
 }
 const bytes=new Uint8Array(3840044);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 m.ownSelectedOutputShareMp3ResponseBytes(op,bytes);
 const response=m.selectedOutputShareMp3Response(op,bytes,{status:200,headers:{'content-type':'audio/wav','content-length':String(bytes.length)}});
 if(action==='/response') return response;
 if(short) {await sleep(100);let rejected=false;try{await response.arrayBuffer()}catch{rejected=true}
  const next=m.acquireSelectedOutputShareMp3Operation(new AbortController().signal);if(next)m.finishSelectedOutputShareMp3Operation(next);
  return Response.json({rejected,zero:bytes.every(byte=>byte===0),reopened:!!next});}
 const reader=response.body.getReader(),first=await reader.read();
 const held=!m.acquireSelectedOutputShareMp3Operation(new AbortController().signal);
 await reader.cancel();const next=m.acquireSelectedOutputShareMp3Operation(new AbortController().signal);if(next)m.finishSelectedOutputShareMp3Operation(next);
 return Response.json({held,zero:bytes.every(byte=>byte===0),length:first.value.length,chunkIntact:first.value.every((byte,i)=>byte===i%251),reopened:!!next});
} };`;

test('actual workerd bounded response, cancellation, inherited deadline and late qualification drain', async () => {
  const built = await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', plugins: [{ name: 'static-wasm', setup(builder) {
      builder.onResolve({ filter: /\.wasm$/ }, () => ({ path: './decoder.wasm', external: true }));
    } }] });
  const directory = await mkdtemp(join(tmpdir(), 'forma-mp3-operation-workerd-')); let egress = 0;
  const mf = new Miniflare({ modules: [{ type: 'ESModule', path: directory + '/entry.mjs', contents: built.outputFiles[0].text },
    { type: 'CompiledWasm', path: directory + '/decoder.wasm', contents: await readFile(new URL('../worker/vendor/mpg123/decoder.wasm', import.meta.url)) }],
    modulesRoot: directory, compatibilityDate: '2026-05-22', compatibilityFlags: ['nodejs_compat'], log: new Log(LogLevel.NONE),
    outboundService() { egress++; throw Error('network_forbidden'); } });
  try {
    const response = await mf.dispatchFetch('https://synthetic.invalid/response');
    assert.equal(response.status, 200); const body = new Uint8Array(await response.arrayBuffer());
    assert.equal(body.length, 3_840_044); assert(body.every((byte, i) => byte === i % 251));
    assert.deepEqual(await (await mf.dispatchFetch('https://synthetic.invalid/status')).json(), { idle: true });
    assert.deepEqual(await (await mf.dispatchFetch('https://synthetic.invalid/cancel')).json(),
      { held: true, zero: true, length: 65_536, chunkIntact: true, reopened: true });
    assert.deepEqual(await (await mf.dispatchFetch('https://synthetic.invalid/unread-timeout')).json(),
      { rejected: true, zero: true, reopened: true });
    const source = await readFile(new URL('./fixtures/audio-share-mp3/stereo-20.mp3', import.meta.url));
    assert.deepEqual(await (await mf.dispatchFetch('https://synthetic.invalid/late-qualification', { method: 'POST', body: source,
      headers: { 'x-sha256': createHash('sha256').update(source).digest('hex') } })).json(), { rejected: true, held: true, reopened: true });
  } finally { await mf.dispose(); assert.equal(egress, 0); await rm(directory, { recursive: true, force: true }); }
});
