import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('pending and completed images share responsive dimensions and unknown pending sizes follow viewport orientation',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-image-geometry',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body><still-app></still-app></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {render}=await import('/node_modules/lit/index.js'),{stillImageStage}=await import('/src/still/media.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default;document.head.append(style);
   window.show=(size,ready)=>{const src=ready?'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size.width}" height="${size.height}"><rect width="100%" height="100%" fill="gray"/></svg>`):undefined;render(stillImageStage('An image',size,src),document.querySelector('still-app'));};
  });
  for(const width of [1200,390]){
   await page.setViewportSize({width,height:800});
   for(const size of [{width:1536,height:1024},{width:1024,height:1536},{width:1024,height:1024}]){
    await page.evaluate(size=>window.show(size,false),size);
    const pending=await page.locator('.image-frame').boundingBox();
    assert.ok(Math.abs(pending.width/pending.height-size.width/size.height)<.01);
    assert.ok(pending.width<=width);assert.ok(pending.height<=480.1);
    await page.evaluate(size=>window.show(size,true),size);await page.locator('img').evaluate(img=>img.decode());
    const loaded=await page.locator('.image-frame').boundingBox();
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(pending[key]-loaded[key])<1,`${width} ${JSON.stringify(size)} ${key}`);
    assert.equal(await page.locator('img').getAttribute('width'),String(size.width));assert.equal(await page.locator('img').getAttribute('height'),String(size.height));
   }
  }
  await page.evaluate(()=>window.show({},false));
  assert.equal(await page.locator('en-skeleton[shape="rectangle"]').count(),1);
  for(const {width,ratio} of [{width:1200,ratio:4/3},{width:390,ratio:3/4},{width:1200,ratio:4/3}]){
   await page.setViewportSize({width,height:800});
   const pending=await page.locator('.image-frame.pending-size').boundingBox();
   assert.ok(Math.abs(pending.width/pending.height-ratio)<.01,`unknown pending image at ${width}px`);
   assert.ok(pending.width<=width);assert.ok(pending.height<=480.1);
  }
 }finally{await browser?.close();await server.close();}
});
