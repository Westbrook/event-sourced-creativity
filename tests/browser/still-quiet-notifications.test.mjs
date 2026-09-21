import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('quiet notifications retain review, dismissal and responsive toolbar separation',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-quiet-notifications',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(5000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js'),{StillApp}=await import('/src/still/app.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default.replaceAll('still-app','notification-fixture');document.head.append(style);
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);}updated(){this.dockObserver.observe(this.querySelector('.dock-stack'));this.scheduleDockFit();}focusContent(){window.focusReturned=true;}
    render(){return html`<div class=${this.developerVisible?'still-layout has-developer':'still-layout'}><div class="still-shell"><main><h1>A quiet scene.</h1><p>The content stays in place.</p></main><div class="dock-stack"><en-toast-region class="generation-notifications" max="2" label="Notifications">${this.notification('review',window.message,'warning',[{label:'Acknowledge & send',run:()=>window.sent++}])}${this.showSaved?this.notification('saved','Saved.','success',[]):null}${this.showThird?this.notification('third','Another update.','info',[]):null}</en-toast-region><footer class="action-dock"><en-toolbar label="Your next step"><en-button variant="secondary">Edit idea</en-button><en-button variant="ghost">More actions</en-button></en-toolbar></footer></div></div></div>`;}
   }
   customElements.define('notification-fixture',Fixture);window.message='Some ideas may prevent this generation. Review the flagged context and the exact prompt before continuing.';window.sent=0;window.app=new Fixture();window.app.client={scopeKey:'test',position:{documentId:'d'}};document.body.append(window.app);
  });
  const region=page.locator('en-toast-region'),review=region.getByRole('button',{name:'Review',exact:true});
  await review.waitFor();assert.equal(await region.getByText('Review needed',{exact:true}).count(),1);assert.equal(await region.getByText(await page.evaluate(()=>window.message),{exact:true}).isVisible(),false);
  const top=await page.locator('main').evaluate(el=>el.getBoundingClientRect().top);
  await review.click();await region.getByRole('button',{name:'Acknowledge & send'}).waitFor();assert.equal(await page.evaluate(()=>window.sent),0,'Review never submits a request');
  assert.equal(await page.locator('main').evaluate(el=>el.getBoundingClientRect().top),top);
  for(const width of [1100,390,320]){
   await page.setViewportSize({width,height:800});
   const rects=await page.evaluate(()=>{const toast=document.querySelector('en-toast').shadowRoot.querySelector('[part=base]').getBoundingClientRect(),toolbar=document.querySelector('.action-dock').getBoundingClientRect();return {left:toast.left,right:toast.right,bottom:toast.bottom,toolbarTop:toolbar.top,width:innerWidth};});
   assert.ok(rects.left>=0&&rects.right<=rects.width);assert.ok(rects.bottom<=rects.toolbarTop,'notification stays above toolbar');
  }
  await page.screenshot({path:'/private/tmp/still-quiet-notification-mobile.png'});
  const closeBounds=await region.getByRole('button',{name:'Dismiss message'}).boundingBox(),reviewBounds=await region.getByRole('button',{name:'Close',exact:true}).boundingBox();assert.ok(Math.abs(closeBounds.y-reviewBounds.y)<3,'dismissal stays in the quiet line');
  await region.getByRole('button',{name:'Acknowledge & send'}).focus();await page.keyboard.press('Escape');await review.waitFor();assert.equal(await region.getByRole('button',{name:'Acknowledge & send'}).isVisible(),false);
  await page.screenshot({path:'/private/tmp/still-quiet-notification-collapsed.png'});
  await page.setViewportSize({width:1200,height:800});await page.emulateMedia({colorScheme:'dark'});
  await page.evaluate(()=>document.querySelector('.still-layout').classList.add('has-developer'));
  const alignment=await page.evaluate(()=>{const notice=document.querySelector('en-toast').shadowRoot.querySelector('[part=base]').getBoundingClientRect(),dock=document.querySelector('.action-dock').getBoundingClientRect();return {notice:notice.x+notice.width/2,dock:dock.x+dock.width/2,right:dock.right};});assert.ok(Math.abs(alignment.notice-alignment.dock)<2);assert.ok(alignment.right<1000);
  await page.screenshot({path:'/private/tmp/still-quiet-notification-desktop-dark.png'});
  await review.click();await region.getByRole('button',{name:'Acknowledge & send'}).click();assert.equal(await page.evaluate(()=>window.sent),1);assert.equal(await page.locator('en-toast').count(),0);
  await page.evaluate(()=>{window.app.showSaved=true;window.app.showThird=true;window.app.changed();});await region.getByText('Saved.',{exact:true}).waitFor();
  assert.equal(await page.locator('en-toast[swipe]').count(),2);await region.getByRole('button',{name:'Dismiss message'}).first().click();await page.waitForFunction(()=>document.querySelectorAll('en-toast').length===1);assert.equal(await region.getByText('Another update.',{exact:true}).isVisible(),true);
 }finally{await browser?.close();await server.close();}
});
