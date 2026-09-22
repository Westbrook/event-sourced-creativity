import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium,expect} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
test('service failure dock checks readiness and requires explicit review without generating',async()=>{
 const server=await createServer({configFile:false,cacheDir:'/private/tmp/still-recovery-vite-cache',optimizeDeps:{noDiscovery:true,include:['lit','lit/async-directive.js','lit/directives/if-defined.js','lit/directives/keyed.js','lit/directives/live.js','lit/directives/repeat.js','lit/static-html.js','qrcode','signal-polyfill','signal-utils/subtle/reaction']},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/@id/lit'),{StillApp}=await import('/src/still/app.ts'),{foldEvents}=await import('/src/model/events.ts');
   await import('/src/still/vendor/tokens/default.css');await import('/src/still/theme.css');const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default.replaceAll('still-app','service-fixture');document.head.append(style);
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);}updated(){this.scheduleDockFit();}decide(){}currentRouteProblem(){return '';}
    begin(){}writeRoute(){}draftSignature(){return '';}generate(){throw Error('Review must not generate');}navigate(view){window.destination=view;}
    render(){return html`<div class="still-shell"><main>${this.renderGeneration()}</main>${this.renderDock()}${this.renderDockProbes()}</div>`;}
   }
   customElements.define('service-fixture',Fixture);const app=window.app=new Fixture();window.checks=0;window.reviews=[];window.ready=false;
   const job={jobId:'original',documentId:'doc',status:'failed',kind:'generate',members:[],result:{generationReceipt:{provider_request_status:'not_submitted',source_transmission_status:'not_transmitted',settled_cost_microusd:0,reservation_status:'released'}},errorDetail:{code:'operation_failed',category:'unknown',message:'memory_boundary_schema_unavailable'}};
   app.loading=false;app.client={epoch:1,scopeKey:'owner',events:[],content:{},jobs:[job],hasUnconfirmedWrite:false,pendingGeneration:null,abilities:{author:true,generate:true,formats:['image']},session:{policy:{accepted:true},projects:[]},position:{projectId:'project',documentId:'doc',outputId:'original',view:'generation',recentActions:[]},projection:{...foldEvents([]),documentId:'doc',documentTitle:'Quiet harbor'},prepareGeneration:format=>{window.reviews.push(format);return {format};},checkGenerationReadiness:async()=>{window.checks++;return {ready:window.ready,message:window.ready?'Storage preparation is ready. Review your current document.':'Storage preparation remains unavailable. No generation was started.'};}};
   document.body.append(app);await app.updateComplete;
  });
  const button=name=>page.locator('.action-dock').getByRole('button',{name,exact:true});
  await expect(button('Check service readiness')).toBeVisible();await expect(button('Review new paid request')).toHaveCount(0);
  await button('Check service readiness').click();await expect(page.locator('main')).toContainText('remains unavailable');assert.deepEqual(await page.evaluate(()=>window.reviews),[]);
  await page.evaluate(()=>window.ready=true);await button('Check service readiness').click();
  // On compact layouts, the explicit review may be in More; it remains a separate action.
  await page.evaluate(()=>{window.app.measuredDockLimit=5;window.app.changed();});await expect(button('Review new paid request')).toBeVisible();
  await mkdir('/private/tmp/still-recovery-browser',{recursive:true});await page.screenshot({path:'/private/tmp/still-recovery-browser/service-actions-desktop.png',fullPage:true});
  await button('Review new paid request').click();assert.deepEqual(await page.evaluate(()=>window.reviews),['image']);assert.equal(await page.evaluate(()=>window.checks),2);
  await page.evaluate(()=>{window.app.serviceReadyUntil=0;window.app.changed();});await expect(button('Review new paid request')).toHaveCount(0);
  await page.locator('main').click();await page.setViewportSize({width:390,height:844});await expect.poll(()=>page.evaluate(()=>window.app.measuredDockLimit)).toBeLessThanOrEqual(3);await expect(button('Check service readiness')).toBeVisible();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/private/tmp/still-recovery-browser/service-actions-mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
