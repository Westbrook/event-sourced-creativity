import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

// Run with node --test tests/browser/still-onboarding-copy.test.mjs.
// Uses the actual vendored En Reve tooltip and Lit, without app data or provider calls.
test('onboarding copy follows the committed tooltip lifecycle',async t=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-onboarding-copy',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'tooltip-fixture',configureServer(s){s.middlewares.use('/__onboarding_copy',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body><main></main></body></html>');});}}]});
 let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__onboarding_copy`);
  await page.evaluate(async()=>{
   const {html,render}=await import('/node_modules/lit/index.js');
   const {keyed}=await import('/node_modules/lit/directives/keyed.js');
   const {onboardingCopy}=await import('/src/still/onboarding-copy.ts');
   await import('/src/still/vendor/elements/define/tooltip.js');
   window.draw=(first,second,epoch=0)=>render(keyed(epoch,html`
    <button id="first">First</button><en-tooltip for="first" warmup-group="test"><span slot="content">${onboardingCopy(first)}</span></en-tooltip>
    <button id="second">Second</button><en-tooltip for="second" warmup-group="test"><span slot="content">${onboardingCopy(second)}</span></en-tooltip>`),document.querySelector('main'));
   window.draw('First fallback','Second fallback');
  });
  const text=()=>page.locator('en-tooltip [slot="content"]').allTextContents();
  const closed=()=>page.waitForFunction(()=>{const tip=document.querySelector('en-tooltip');return !tip.open&&!tip.surface?.matches(':popover-open');});
  await t.test('open copy is frozen; closed copy updates immediately; latest update wins',async()=>{
   await page.getByRole('button',{name:'First',exact:true}).focus();
   await page.waitForFunction(()=>document.querySelector('en-tooltip').surface?.matches(':popover-open'));
   await page.evaluate(()=>window.draw('First generated','Second generated'));
   assert.deepEqual(await text(),['First fallback','Second generated']);
   await page.evaluate(()=>window.draw('First newest','Second newest'));
   assert.deepEqual(await text(),['First fallback','Second newest']);
  });
  await t.test('a cancelled close keeps the original visible and accessible description',async()=>{
   await page.evaluate(()=>{const tip=document.querySelector('en-tooltip');tip.addEventListener('en-change',event=>event.preventDefault(),{once:true});tip.hide();});
   assert.equal(await page.locator('en-tooltip').first().evaluate(tip=>tip.open),true);
   assert.deepEqual(await text(),['First fallback','Second newest']);
   const description=await page.locator('#first').evaluate(button=>document.getElementById(button.getAttribute('aria-describedby'))?.textContent);
   assert.equal(description,'First fallback');
  });
  await t.test('Escape commits the newest copy for the next opening',async()=>{
   await page.keyboard.press('Escape');await closed();
   await page.waitForFunction(()=>document.querySelector('en-tooltip [slot="content"]').textContent==='First newest');
   await page.evaluate(()=>document.querySelector('en-tooltip').show());
   await page.waitForFunction(()=>document.querySelector('en-tooltip').surface?.matches(':popover-open'));
   assert.deepEqual(await text(),['First newest','Second newest']);
  });
  await t.test('silent programmatic closure also flushes without a parent render',async()=>{
   await page.evaluate(()=>{window.draw('After silent close','Second newest');document.querySelector('en-tooltip').open=false;});await closed();
   await page.waitForFunction(()=>document.querySelector('en-tooltip [slot="content"]').textContent==='After silent close');
  });
  await t.test('pointer-open copy waits for pointer departure',async()=>{
   await page.locator('#first').evaluate(button=>button.blur());
   await page.getByRole('button',{name:'First',exact:true}).hover();
   await page.waitForFunction(()=>document.querySelector('en-tooltip').surface?.matches(':popover-open'));
   await page.evaluate(()=>window.draw('After hover','Second newest'));
   assert.equal((await text())[0],'After silent close');
   await page.mouse.move(700,500);await closed();
   await page.waitForFunction(()=>document.querySelector('en-tooltip [slot="content"]').textContent==='After hover');
  });
  await t.test('replacing the toolbar discards held copy with the old tooltip',async()=>{
   await page.evaluate(()=>document.querySelector('en-tooltip').show());
   await page.waitForFunction(()=>document.querySelector('en-tooltip').surface?.matches(':popover-open'));
   await page.evaluate(()=>{window.draw('Obsolete pending','Second newest');window.draw('New toolbar','New alternative',1);});
   assert.deepEqual(await text(),['New toolbar','New alternative']);
  });
 }finally{await browser?.close();await server.close();}
});
