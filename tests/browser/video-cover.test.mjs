import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { createSceneCostFixture } from '../helpers/scene-cost-fixture.mjs';
import { coverMediaFixture } from '../helpers/video-cover-media.mjs';
import { storeGeneratedMedia } from '../../worker/media-api.ts';
import { inspectVideoCover } from '../../src/model/video-cover.ts';

test('actual MP4 capture saves WebP; Forma and Still preview reloads request no video bytes',async t=>{
  const h=await createSceneCostFixture(1);const media=coverMediaFixture();h.env.MEDIA=media.MEDIA;
  const mp4=new Uint8Array(await readFile(new URL('../../public/assets/marketing/quiet-coast-scene-4s.daf9e9e53cd8.mp4',import.meta.url)));
  const source=await storeGeneratedMedia(h.env,h.owner,'browser-cover',mp4,'fixture','video/mp4',{artifactRole:'document-video'});
  const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-video-cover',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/fixture',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body><main></main></body></html>');});}}]});
  let browser;
  try{
    await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1000,height:800}});
    const requests=[],errors=[];let failUploads=0;page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/media/**',async route=>{
      const req=route.request(),url=new URL(req.url());requests.push({method:req.method(),url:url.pathname+url.search});
      if(req.method()==='POST'&&failUploads-->0){await route.fulfill({status:503,body:'Temporary failure'});return;}
      const response=await h.request(url.pathname+url.search,{method:req.method(),headers:{...req.headers(),origin:'http://localhost'},...(req.method()==='POST'?{body:req.postDataBuffer()}: {})});
      await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    });
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    const mount=async(sourceUrl=source.url)=>{
      await page.goto(origin+'/fixture');
      await page.evaluate(async source=>{
        const {html,render}=await import('/node_modules/lit/index.js');
        await import('/src/components/artifact-summary.ts');
        const {stillVideoCover,stillResultThumbnail}=await import('/src/still/media.ts');
        const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default;document.head.append(style);
        const artifact={kind:'video',mediaUrl:source,title:'Saved video',items:[],summary:'Preview test'};
        render(html`<style>body{font:16px system-ui;background:#f4f1eb;color:#302f2b}main{max-width:850px;margin:40px auto;display:grid;grid-template-columns:1fr 1fr;gap:24px}.artifact-summary{height:240px}h2{font-size:20px}</style><section><h2>Forma project</h2><forma-artifact-summary .artifact=${artifact}></forma-artifact-summary></section><section><h2>Still result</h2><still-app><a class="result">${stillResultThumbnail(stillVideoCover(source,'Saved video'))}<span>Saved video</span></a></still-app></section>`,document.querySelector('main'));
      },sourceUrl);
      await page.waitForFunction(()=>document.querySelectorAll('forma-video-cover img').length===2,null,{timeout:30_000});
      await page.locator('forma-video-cover img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    };
    await t.test('first mount captures once and stores a real decodable WebP',async()=>{
      await mount();assert.equal(await page.locator('video').count(),0);
      assert.equal(requests.filter(r=>r.method==='POST').length,1);
      assert.equal(requests.filter(r=>r.method==='GET'&&!r.url.includes('?')).length,1);
      const cover=[...media.rows.values()].find(row=>row.customMetadata.source==='video-cover');assert.ok(cover);
      assert.equal(cover.contentType,'image/webp');const size=inspectVideoCover(cover.bytes);
      assert.ok(Math.max(size.width,size.height)<=960);assert.ok(cover.bytes.length<mp4.length);
      const dimensions=await page.locator('forma-video-cover img').first().evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));assert.deepEqual(dimensions,size);
    });
    await t.test('Still cover fills a 4:3 crop and calculates a focal point after asynchronous loading',async()=>{
      await page.waitForFunction(()=>document.querySelector('still-app img')?.style.getPropertyValue('--focal-x'));
      const geometry=await page.locator('still-app img').evaluate(img=>({fit:getComputedStyle(img).objectFit,ratio:img.clientWidth/img.clientHeight,frame:img.closest('.result-thumbnail').clientWidth/img.closest('.result-thumbnail').clientHeight}));
      assert.equal(geometry.fit,'cover');assert.ok(Math.abs(geometry.ratio-4/3)<.005);assert.ok(Math.abs(geometry.frame-4/3)<.005);
    });
    await t.test('subsequent page loads reuse only the server image',async()=>{
      requests.length=0;await mount();assert.equal(await page.locator('video').count(),0);
      assert.equal(requests.filter(r=>r.method==='POST'||!r.url.includes('?')).length,0);
      assert.ok(requests.every(r=>r.url.endsWith('?video-cover=webp')));
      await page.screenshot({path:'/private/tmp/forma-webp-video-covers.png',fullPage:true});
    });
    await t.test('a transient upload failure retries without a preview video element',async()=>{
      const retry=await storeGeneratedMedia(h.env,h.owner,'browser-cover-retry',mp4,'fixture','video/mp4');
      requests.length=0;failUploads=1;await mount(retry.url);
      assert.equal(requests.filter(r=>r.method==='POST').length,2);
      assert.equal(await page.locator('video').count(),0);
    });
    await t.test('historical MP4s without retained checksums backfill through the same browser capture',async()=>{
      const legacy=await storeGeneratedMedia(h.env,h.owner,'browser-legacy-cover',mp4,'fixture','video/mp4');
      delete media.rows.get(legacy.key).customMetadata.sha256;
      requests.length=0;await mount(legacy.url);
      assert.equal(requests.filter(r=>r.method==='POST').length,1);
      assert.ok([...media.rows.values()].some(row=>row.customMetadata.sourceKey===legacy.key&&row.contentType==='image/webp'));
      requests.length=0;await mount(legacy.url);
      assert.ok(requests.every(r=>r.method==='GET'&&r.url.endsWith('?video-cover=webp')));
    });
    await t.test('unsupported WebP encoding is rejected instead of saving a mislabeled PNG',async()=>{
      const rejected=await page.evaluate(async source=>{
        const {captureVideoCover}=await import('/src/media/video-cover.ts');
        const bytes=await (await fetch(source)).blob(),original=HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob=function(callback){callback(new Blob(['png'],{type:'image/png'}));};
        try{await captureVideoCover(bytes,AbortSignal.timeout(5000));return false;}catch(error){return error.message==='video_cover_webp_unavailable';}
        finally{HTMLCanvasElement.prototype.toBlob=original;}
      },source.url);
      assert.equal(rejected,true);
    });
    assert.deepEqual(errors,[]);
  }finally{await browser?.close();await server.close();h.close();}
});
