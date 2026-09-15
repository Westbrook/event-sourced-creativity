import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
const { build } = createRequire(import.meta.resolve('wrangler'))('esbuild');

const { Miniflare, Log, LogLevel } = createRequire(import.meta.resolve('wrangler'))('miniflare');

test('actual Worker Video transport dispatches once and refuses every redirect without following it', { timeout: 60_000 }, async t => {
  const built = await build({ stdin: { resolveDir: new URL('..', import.meta.url).pathname,
    contents: `import { requestOutputVideoResponse } from './worker/output-video-execution.ts';
      export default { async fetch(request) {
        const status = Number(new URL(request.url).searchParams.get('status') || 200);
        let legacyRejected = false;
        try { new Request('https://provider.invalid/legacy', {redirect:'error'}); }
        catch { legacyRejected = true; }
        const stages = ['claimed', 'checkpointed', 'pending'];
        try {
          const result = await requestOutputVideoResponse('https://provider.invalid/' + status,
            {method:'POST', headers:{authorization:'Bearer synthetic-only'}, body:'fixture'},
            () => { stages.push('authorized'); }, 1024, () => { stages.push('dispatch'); });
          return Response.json({legacyRejected, stages, status:result.status, body:await result.text()});
        } catch (error) { return Response.json({legacyRejected, stages, error:error.message}); }
      }};` }, bundle:true, write:false, format:'esm', platform:'browser', target:'es2022' });
  const requests = [];
  const mf = new Miniflare({ modules:true, compatibilityDate:'2026-05-22', compatibilityFlags:['nodejs_compat'],
    host:'127.0.0.1', port:0, log:new Log(LogLevel.NONE), script:built.outputFiles[0].text,
    // All outbound requests are served here. No provider credentials or network.
    outboundService(request) {
      requests.push({url:request.url, method:request.method, redirect:request.redirect});
      assert.equal(new URL(request.url).hostname, 'provider.invalid');
      const status = Number(new URL(request.url).pathname.slice(1));
      return new Response(status === 304 ? null : 'fixture', {status,
        headers: status >= 300 && status < 400 ? {location:'https://must-not-follow.invalid/'} : {}});
    },
  });
  t.after(() => mf.dispose());
  const stages = ['claimed', 'checkpointed', 'pending', 'authorized', 'dispatch'];
  const good = await (await mf.dispatchFetch('https://qualification.invalid/?status=200')).json();
  assert.deepEqual(good, {legacyRejected:true, stages, status:200, body:'fixture'});
  for (let status = 300; status < 400; status++) {
    const result = await (await mf.dispatchFetch('https://qualification.invalid/?status=' + status)).json();
    assert.deepEqual(result, {legacyRejected:true, stages, error:'output_video_redirect_refused'});
  }
  assert.equal(requests.length, 101);
  // The service boundary reconstructs Request metadata; prove no redirect
  // follow from the exact outbound URLs instead of its redirect property.
  assert.deepEqual(requests.map(request => request.url), [200, ...Array.from({length:100}, (_, i) => 300 + i)].map(status => 'https://provider.invalid/' + status));
  assert.ok(requests.every(request => request.method === 'POST'));
  t.diagnostic('Actual bundled production transport in local workerd; bookkeeping labels are synthetic, not a live database/authority or historical-outcome test.');
});
