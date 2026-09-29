import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { STILL_MODES, STILL_FORMATS } from '../src/still/routes.ts';

const routes=['/still','/still/','/still.html','/still?project=p&document=d&work=r',
  '/still/page/2','/still/project/p','/still/project/p/page/2','/still/project/p/document/d',
  '/still/project/p/document/d/block/b','/still/project/p/document/d/results',
  '/still/project/p/document/d/results/page/2','/still/project/p/document/d/result/r',
  '/still/project/p/document/d/result/r/item/2','/still/project/p/document/d/create',
  ...STILL_FORMATS.map(f=>`/still/project/p/document/d/create/${f}`),
  ...STILL_MODES.map(m=>`/still/project/p/document/d/block/b/action/${m}`),
  '/still/action/new-project','/still/action/workspaces','/still/project/p/action/new-document',
  '/still/project/project%20one/document/%E9%A0%85%E7%9B%AE?developer&progress-report'];

test('built Worker directly serves every Still route through its independent entry for GET and HEAD',async()=>{
  let seen=[];
  const env={ASSETS:{fetch:async request=>{seen.push({path:new URL(request.url).pathname,method:request.method});return new Response('<still-app></still-app>',{headers:{'content-type':'text/html; charset=utf-8'}});}}};
  const context={waitUntil(){throw new Error('Shell requests must not schedule work');}};
  for(const path of routes)for(const method of ['GET','HEAD']){
    seen=[];const response=await worker.fetch(new Request(`https://forma.test${path}`,{method}),env,context);
    assert.equal(response.status,200,`${method} ${path}`);assert.equal(response.headers.get('x-forma-application'),'still');
    assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('location'),null);
    assert.deepEqual(seen,[{path:'/still',method}]);assert.equal(await response.text(),method==='HEAD'?'':'<still-app></still-app>');
  }
  for(const path of ['/still/bogus','/still/bogus.js','/still/project/p/document','/still/project/%ZZ','/still/project/p/document/d/action/export']){
    seen=[];const response=await worker.fetch(new Request(`https://forma.test${path}`),env,context);assert.equal(response.status,404,path);assert.deepEqual(seen,[]);
  }
  seen=[];const post=await worker.fetch(new Request('https://forma.test/still/project/p/document/d/create/image',{method:'POST'}),env,context);
  assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');assert.deepEqual(seen,[]);
});

test('Still deep links share install metadata and every Home Screen asset is directly addressable',async()=>{
  const {readFile}=await import('node:fs/promises');
  const shell=await readFile(new URL('../dist/client/still.html',import.meta.url),'utf8');
  const manifest=JSON.parse(await readFile(new URL('../dist/client/assets/still/manifest.webmanifest',import.meta.url),'utf8'));
  const env={ASSETS:{fetch:async request=>{
    const path=new URL(request.url).pathname;
    const data=path==='/still'?shell:await readFile(new URL('../dist/client'+path,import.meta.url));
    return new Response(request.method==='HEAD'?null:data);
  }}};
  const context={waitUntil(){throw new Error('Install metadata must not schedule work');}};
  for(const path of ['/still','/still/action/new-project?developer=','/still/project/p/document/d']){
    const response=await worker.fetch(new Request('https://forma.test'+path),env,context);
    assert.equal(response.status,200);
    const html=await response.text();
    assert.match(html,/rel="apple-touch-icon"[^>]*href="\/assets\/still\/apple-touch-icon.png"/);
    assert.match(html,/rel="manifest"[^>]*href="\/assets\/still\/manifest.webmanifest"/);
    assert.match(html,/name="apple-mobile-web-app-capable" content="yes"/);
  }
  assert.equal(manifest.name,'Still');assert.equal(manifest.id,'/still');
  assert.equal(manifest.start_url,'/still');assert.equal(manifest.display,'standalone');
  assert.ok('/still'.startsWith(manifest.scope));assert.ok('/still/project/p'.startsWith(manifest.scope));
  assert.equal('/document/d'.startsWith(manifest.scope),false);
  const manifestResponse=await worker.fetch(new Request('https://forma.test/assets/still/manifest.webmanifest'),env,context);
  assert.deepEqual(await manifestResponse.json(),manifest);
  for(const icon of [{src:'/assets/still/apple-touch-icon.png',sizes:'180x180'},...manifest.icons]){
    const response=await worker.fetch(new Request('https://forma.test'+icon.src),env,context);
    assert.equal(response.status,200);
    const png=Buffer.from(await response.arrayBuffer());
    assert.equal(png.subarray(1,4).toString(),'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);
  }
  const forma=await readFile(new URL('../dist/client/index.html',import.meta.url),'utf8');
  assert.ok(!forma.includes('/assets/still/'));
});
