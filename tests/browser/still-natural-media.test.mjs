import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Still delivers images and videos at full size with intrinsic proportions and consistent Results crops',async t=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-natural-media',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/fixture',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body><still-app></still-app></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`);
  await page.evaluate(async()=>{
   const {html,render}=await import('/node_modules/lit/index.js');
   const {stillImage,stillImageStage,stillVideo,stillResultThumbnail}=await import('/src/still/media.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default+(await import('/src/components/video-cover.css?raw')).default;document.head.append(style);
   window.sizes=[{width:960,height:540},{width:540,height:960},{width:800,height:800}];
   window.videos=[];
   // Encode actual media in the browser so videoWidth/videoHeight come from the decoder.
   for(const size of window.sizes){
    const canvas=document.createElement('canvas');Object.assign(canvas,size);const context=canvas.getContext('2d');context.fillStyle='coral';context.fillRect(0,0,size.width,size.height);
    const stream=canvas.captureStream(10),chunks=[],recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    recorder.ondataavailable=event=>chunks.push(event.data);const stopped=new Promise(resolve=>recorder.onstop=resolve);
    recorder.start();await new Promise(resolve=>setTimeout(resolve,150));recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
    window.videos.push(URL.createObjectURL(new Blob(chunks,{type:'video/webm'})));
   }
   window.draw=(index,metadata)=>{
    const size=window.sizes[index],src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="coral"/></svg>`);
    const img=(className='')=>stillImage(src,'Test image',metadata,{className,loading:'eager'});
    render(html`<main style="max-width:1100px;margin:auto">
     <div data-case="stage">${stillImageStage('Delivered image',metadata,src)}</div>
     <div data-case="preview">${stillImageStage('Preview',metadata,src,true)}</div>
     <div data-case="grid" class="result-grid"><a class="result">${stillResultThumbnail(html`${img()}`,window.focus)}</a></div>
     <ul class="all-list-rows"><li data-case="list"><a class="result">${stillResultThumbnail(html`${img()}`,window.focus)}<span>Result</span></a></li></ul>
     <div data-case="reference">${img('context-reference')}</div>
     <div data-case="study">${img('reference-study')}</div>
     <article data-case="slide" class="slide">${img()}<div><h1>Slide image</h1><p>Caption remains outside the image.</p></div></article>
     <div data-case="video" class="media-stage">${stillVideo(window.videos[index],{mediaUrl:window.videos[index],items:[],settings:metadata??{}})}</div>
    </main>`,document.querySelector('still-app'));
   };
  });
  const check=async()=>{
   await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
   await page.waitForFunction(()=>document.querySelector('video')?.dataset.sizeSource==='intrinsic');
   const geometry=await page.locator('img,video').evaluateAll(elements=>elements.map(element=>{
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element),video=element.localName==='video';
    return {surface:element.closest('[data-case]').dataset.case,width:rect.width,height:rect.height,naturalWidth:video?element.videoWidth:element.naturalWidth,naturalHeight:video?element.videoHeight:element.naturalHeight,fit:style.objectFit,position:style.position,opacity:style.opacity,parentWidth:element.parentElement.getBoundingClientRect().width};
   }));
   for(const item of geometry){
    assert.ok(item.width>0&&item.height>0,JSON.stringify(item));
    // Both the element box and decoded media must have the same ratio: contain cannot hide bars.
    const thumbnail=['grid','list'].includes(item.surface);
    assert.ok(Math.abs(item.width/item.height-(thumbnail?4/3:item.naturalWidth/item.naturalHeight))<.002,JSON.stringify(item));
    assert.equal(item.fit,thumbnail?'cover':'contain',JSON.stringify(item));assert.ok(item.width<=item.parentWidth+1,JSON.stringify(item));
    if(item.surface==='slide'){assert.equal(item.position,'static');assert.equal(item.opacity,'1');}
   }
   const frame=await page.locator('[data-case="stage"] .image-frame').boundingBox(),image=await page.locator('[data-case="stage"] img').boundingBox();
   assert.ok(Math.abs(frame.width-image.width)<1&&Math.abs(frame.height-image.height)<1,JSON.stringify({frame,image}));
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  };
  await t.test('all image delivery surfaces and real decoded videos preserve portrait, landscape and square geometry',async()=>{
   for(const viewport of [{width:1200,height:800},{width:390,height:800},{width:760,height:400}]){
    await page.setViewportSize(viewport);
    for(let index=0;index<3;index++){
     await page.evaluate(index=>window.draw(index,window.sizes[index]),index);await check();
    }
   }
  });
  await t.test('missing and incorrect metadata yield to intrinsic dimensions on source replacement',async()=>{
   for(const metadata of [undefined,{width:2000,height:100}]){
    for(const index of [0,1,2,0]){await page.evaluate(({index,metadata})=>window.draw(index,metadata),{index,metadata});await check();}
   }
  });
  await t.test('saved focal points update decoded thumbnails without changing full-size images',async()=>{
   await page.evaluate(()=>{window.focus={x:.8,y:.25,confidence:1,method:'attention-region-v2',sampleWidth:32,sampleHeight:32};window.draw(1);});
   await check();
   assert.equal(await page.locator('[data-case="grid"] img').evaluate(image=>getComputedStyle(image).objectPosition),'80% 25%');
   await page.evaluate(()=>{window.focus={...window.focus,x:.2,y:.9};window.draw(1);});
   assert.equal(await page.locator('[data-case="grid"] img').evaluate(image=>getComputedStyle(image).objectPosition),'20% 90%');
   assert.equal(await page.locator('[data-case="stage"] img').evaluate(image=>getComputedStyle(image).objectPosition),'50% 50%');
  });
  await t.test('mixed image, pending, unavailable video and text cards reserve identical geometry',async()=>{
   await page.evaluate(async()=>{
    const {html,render}=await import('/node_modules/lit/index.js');
    const {stillResultThumbnail}=await import('/src/still/media.ts');
    const contents=[html`<div class="pending-thumbnail"><en-skeleton></en-skeleton><span>Image</span></div>`,html`<div class="result-word">Story</div>`,html`<forma-video-cover><span class="video-cover-placeholder">Video</span></forma-video-cover>`];
    const cards=()=>contents.map(content=>html`<a class="result">${stillResultThumbnail(content)}<span>Fall days</span></a>`);
    render(html`<div class="result-grid">${cards()}</div><ul class="all-list-rows">${cards()}</ul>`,document.querySelector('still-app'));
   });
   for(const width of [1200,390]){
    await page.setViewportSize({width,height:800});
    const sizes=await page.locator('.result-thumbnail').evaluateAll(frames=>frames.map(frame=>{const rect=frame.getBoundingClientRect(),child=frame.firstElementChild.getBoundingClientRect();return {ratio:rect.width/rect.height,height:rect.height,childHeight:child.height};}));
    for(const size of sizes){assert.ok(Math.abs(size.ratio-4/3)<.002);assert.ok(Math.abs(size.height-size.childHeight)<1,JSON.stringify(size));}
    assert.ok(Math.abs(sizes[0].height-sizes[1].height)<1);assert.ok(Math.abs(sizes[1].height-sizes[2].height)<1);
   }
  });
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
