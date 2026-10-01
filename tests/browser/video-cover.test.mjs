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
      await page.setViewportSize({width:1000,height:800});
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
    await t.test('Library image, video, storyboard and native artifact previews share responsive frames and focal crops',async()=>{
      await page.setViewportSize({width:1000,height:800});
      await page.goto(origin+'/fixture');
      await page.evaluate(async source=>{
        const {html,render}=await import('/node_modules/lit/index.js');
        await Promise.all([import('/src/components/artifact-summary.ts'),import('/src/components/output-visual.ts'),import('/src/styles.css'),import('/src/design-system.css')]);
        const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1200;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#345';ctx.fillRect(0,0,800,1200);ctx.fillStyle='#fa3';ctx.fillRect(540,180,140,180);
        const url=canvas.toDataURL(),point={x:.75,y:.25,confidence:.9,method:'attention-region-v2',sampleWidth:24,sampleHeight:16};
        const output={id:'fictional-image',title:'Fictional portrait',mediaUrl:url,focalPoint:point,quality:'full'};
        const item={id:'fictional-frame',title:'Coastal light',body:'A fictional opening',mediaUrl:url,focalPoint:point};
        const artifacts=['video','storyboard','slides','audio','model3d','short_story','scene'].map(kind=>({kind,title:kind,summary:'Fictional preview',mediaUrl:kind==='video'?source:undefined,itemCount:2,items:kind==='storyboard'?[item,{...item,id:'local-focal',focalPoint:undefined}]:[item]}));
        render(html`<style>main{padding:20px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}body{margin:0}</style>
          <article class="library-output" data-kind="image"><div class="output-card"><div class="output-art"><forma-output-visual .output=${output} .readOnly=${true}></forma-output-visual></div></div></article>
          ${artifacts.map(artifact=>html`<article class="library-output" data-kind=${artifact.kind}><a class="library-artifact-open"><forma-artifact-summary .artifact=${artifact}></forma-artifact-summary></a></article>`)}
          <article class="library-output" data-kind="pending"><a class="library-artifact-open"><forma-artifact-summary .artifact=${{kind:'video',mediaUrl:'/pending-cover.mp4',title:'Pending video',items:[]}}></forma-artifact-summary></a></article>`,document.querySelector('main'));
      },source.url);
      await page.waitForFunction(()=>document.querySelector('[data-kind="video"] img')?.style.getPropertyValue('--focal-x')&&document.querySelectorAll('[data-kind="storyboard"] img')[1]?.style.getPropertyValue('--focal-x'));
      for(const width of [1440,768,390,320]){
        await page.setViewportSize({width,height:900});
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const frames=await page.locator('.library-output').evaluateAll(cards=>cards.map(card=>{
          const frame=card.querySelector('.output-art,.artifact-summary'),rect=frame.getBoundingClientRect();
          return {kind:card.dataset.kind,width:rect.width,height:rect.height,images:[...frame.querySelectorAll('img')].map(img=>({fit:getComputedStyle(img).objectFit,position:getComputedStyle(img).objectPosition,x:img.style.getPropertyValue('--focal-x'),y:img.style.getPropertyValue('--focal-y'),width:img.getBoundingClientRect().width,height:img.getBoundingClientRect().height}))};
        }));
        for(const frame of frames){assert.ok(Math.abs(frame.width/frame.height-1.5)<.005,`${width}: ${JSON.stringify(frame)}`);assert.ok(Math.abs(frame.width-frames[0].width)<1,`${frame.kind} has equal inset`);}
        for(const frame of frames.filter(frame=>['image','video','storyboard'].includes(frame.kind))){
          for(const img of frame.images){assert.equal(img.fit,'cover');assert.equal(img.position,`${img.x} ${img.y}`);}
          if(frame.kind==='image'||frame.kind==='storyboard')assert.equal(frame.images[0].position,'75% 25%');
          if(frame.kind==='video'){assert.ok(Math.abs(frame.images[0].width-frame.width)<1);assert.ok(Math.abs(frame.images[0].height-frame.height)<1);}
        }
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      }
      await page.screenshot({path:'/private/tmp/forma-library-media-parity.png',fullPage:true});
      // Thumbnail constraints must not crop the full image dialog.
      await page.locator('[data-kind="image"] forma-output-visual').evaluate(async visual=>{visual.interactive=true;await visual.updateComplete;});
      await page.locator('[data-kind="image"] .generated-output-trigger').click();
      await page.locator('dialog[open]').waitFor();
      assert.equal(await page.locator('dialog[open] img').evaluate(img=>getComputedStyle(img).objectFit),'contain');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(),0);
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
