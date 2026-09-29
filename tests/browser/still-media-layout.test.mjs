import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mediaLayoutServer} from '../helpers/still-media-layout-server.mjs';

test('native result pixels, full-bleed mobile media and aligned page headings',async()=>{
 const server=await mediaLayoutServer();let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/still-media-layout.html`);
  await page.waitForFunction(()=>window.draw);
  const draw=async options=>{await page.evaluate(options=>window.draw(options),options);await page.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));};
  const metrics=()=>page.evaluate(()=>{const box=s=>{const r=document.querySelector(s)?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null;};return {heading:box('h1'),image:box('main img'),frame:box('.image-frame'),info:box('.media-info'),model:box('still-model-view'),shell:box('.still-shell'),main:box('main'),viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};});
  const evidence=[];
  for(const viewport of [{width:1712,height:895},{width:1200,height:800},{width:760,height:400},{width:390,height:844},{width:320,height:568}])for(const panel of [false,true]){
   await page.setViewportSize(viewport);await draw({panel});const image=await metrics();
   const available=viewport.width<=1023?image.shell.width:image.main.width;
   assert.ok(Math.abs(image.image.width-Math.min(1536,available))<1,JSON.stringify({viewport,panel,image}));
   assert.ok(Math.abs(image.image.width/image.image.height-1.5)<.002);
   assert.ok(image.info.y>=image.image.bottom,'Dimensions follow image');
   assert.equal(image.overflow,false);
   if(viewport.width<=1023)assert.equal(image.image.x,0,'No mobile media gutter');
   if(viewport.width===1712&&!panel){assert.ok(image.image.y<210,'Media starts before 210px');evidence.push({viewport,panel,...image});}
   for(const scene of ['document','documents','ideas','results','short_story','slides','model3d','audio','video']){
    await draw({scene,panel});const other=await metrics();
    assert.ok(Math.abs(other.heading.x-image.heading.x)<1,scene+' heading left alignment');
    assert.ok(Math.abs(other.heading.y-image.heading.y)<1,scene+' heading top alignment');
    assert.equal(other.overflow,false,scene+' overflow');
    if(scene==='slides')assert.ok(Math.abs(other.image.width-Math.min(1536,available))<1,'Slide image uses available native width');
    if(scene==='model3d')assert.ok(Math.abs(other.model.width-available)<1,'3D viewer uses full width');
   }
   for(const size of [{width:200,height:120},{width:900,height:1600},{width:800,height:800}]){
    await draw({...size,panel});const actual=await metrics();assert.ok(Math.abs(actual.image.width-Math.min(size.width,available))<1,'Never upscale original');assert.ok(Math.abs(actual.image.width/actual.image.height-size.width/size.height)<.002);
   }
   await draw({scene:'pending',panel});const pending=await metrics();await draw({panel});const loaded=await metrics();
   assert.deepEqual(pending.frame,loaded.frame,'Known pending result reserves final geometry');
  }
  await page.setViewportSize({width:1712,height:895});
  for(const metadata of [{width:100,height:100},{}]){await draw({metadata});const actual=await metrics();assert.equal(actual.image.width,1536);assert.equal(actual.frame.width,1536);}
  // Reusing a decoded source while metadata changes must not enlarge or shrink it.
  await draw({width:200,height:120,metadata:{width:1536,height:1024}});assert.equal((await metrics()).image.width,200);
  await draw({width:200,height:120,metadata:{width:1920,height:1080}});assert.equal((await metrics()).image.width,200);
  await draw({});await page.screenshot({path:'/private/tmp/still-native-media-desktop.png'});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/private/tmp/still-native-media-mobile.png'});
  assert.deepEqual(errors,[]);console.log('Native layout measurements:',JSON.stringify(evidence));
 }finally{await browser?.close();await server.close();}
});
