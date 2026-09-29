import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

// The real app, renderer, client projection and En controls. Only data/provider
// boundaries are fixtures; no account, job, provider or mutation is contacted.
export async function mountToolbarFixture(page, url){
 await page.route('**/api/**',route=>route.fulfill({status:503,json:{error:'fixture_only'}}));
 await page.goto(url);
 await page.evaluate(async()=>{const {mountStillMotionFixture}=await import('/tests/browser/fixtures/still-toolbar-motion.js');await mountStillMotionFixture();});
}

export async function fixtureServer(){
 const server=await createServer({configFile:false,cacheDir:'/private/tmp/still-motion-vite',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0,hmr:false},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});await server.listen();return server;
}

test('production toolbar keeps content immediate and coordinates final actions and motion',async t=>{
 const server=await fixtureServer();let browser;
 try{
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.stack));
  await mountToolbarFixture(page,`http://127.0.0.1:${server.httpServer.address().port}/still/project/p/document/d`);
  const root=page.locator('.toolbar-motion-root');
  const ready=()=>page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='ready');
  const live=page.locator('.toolbar-motion-live');
  await t.test('page content renders during the full first loading gesture',async()=>{
   await page.locator('main h1').waitFor();assert.equal(await page.locator('main h1').textContent(),'Observatory');
   assert.equal(await root.getAttribute('data-motion-active'),'');
   await ready();assert.equal(await live.evaluate(n=>n.inert),false);assert.ok(await live.getByRole('button').count()>1);
   assert.equal(await page.locator('.toolbar-motion-visual').evaluate(n=>n.children.length),0);
  });
  await t.test('More and Back narrow through a circle and preserve native controls',async()=>{
   await live.getByRole('button',{name:'More actions',exact:true}).click();
   await page.waitForFunction(()=>!!document.querySelector('.toolbar-motion-shell'));
   const min=await page.evaluate(()=>new Promise(resolve=>{let min=Infinity;const sample=()=>{const node=document.querySelector('.toolbar-motion-shell');if(node){min=Math.min(min,node.getBoundingClientRect().width);requestAnimationFrame(sample);}else resolve(min);};sample();}));
   assert.ok(min<80,`minimum paging width ${min}`);await ready();assert.equal(await page.evaluate(()=>window.app.moreOpen),true);
   await live.getByRole('button',{name:'Back',exact:true}).focus();await page.keyboard.press('Enter');await ready();assert.equal(await page.evaluate(()=>window.app.moreOpen),false);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.actionId),'ui:more');
  });
  await t.test('opening and dismissing Find action leaves page two available',async()=>{
   await live.getByRole('button',{name:'More actions',exact:true}).click();await ready();
   await live.getByRole('button',{name:/^Find action/}).click();await page.getByRole('dialog').waitFor();
   assert.equal(await page.evaluate(()=>window.app.moreOpen),true);await page.keyboard.press('Escape');
   assert.equal(await page.evaluate(()=>window.app.moreOpen),true);assert.equal(await root.getAttribute('data-toolbar-phase'),'ready');
  });
  await t.test('same-page action closes and waits for final actions; obsolete responses cannot replace them',async()=>{
   await page.evaluate(()=>{window.hold=true;window.app.navigate('document');});await page.waitForFunction(()=>window.app.toolbarDecisionPending);
   assert.equal(await page.locator('main h1').textContent(),'Observatory');
   await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
   assert.equal(await live.evaluate(n=>n.inert),true);
   await page.evaluate(()=>{window.obsolete=window.requests.at(-1);window.hold=false;window.app.navigate('projects',{projectId:'',documentId:''});});
   await ready();const labels=await live.textContent();
   await page.evaluate(()=>window.obsolete.resolve());await page.waitForTimeout(100);
   assert.equal(await live.textContent(),labels);assert.equal(await page.evaluate(()=>window.app.client.position.view),'projects');
  });
  await t.test('history opens actions for its destination through Loading',async()=>{
   await page.goBack();await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.hasAttribute('data-motion-active'));await ready();
   assert.equal(await page.locator('main h1').textContent(),'Observatory');
  });
  await t.test('a stalled Jev request reaches local fallback at the thirteenth left checkpoint',async()=>{
   await page.clock.install();
   await page.evaluate(()=>{window.hold=true;window.app.navigate('document');});
   await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
   const count=await page.evaluate(()=>window.requests.length);
   await page.clock.runFor(8150);
   assert.equal(await root.getAttribute('data-toolbar-phase'),'waiting');
   const mark=page.locator('.toolbar-motion-visual .toolbar-wordmark');assert.equal(await mark.count(),1);
   await page.clock.runFor(30400);await page.clock.runFor(350);await ready();
   assert.equal(await page.evaluate(()=>window.app.decisionSource),'fallback');
   const labels=await live.textContent();
   await page.evaluate(()=>{window.hold=false;window.requests.at(-1).resolve();});
   await page.clock.runFor(100);assert.equal(await live.textContent(),labels);
   assert.equal(await page.evaluate(()=>window.requests.length),count,'no automatic Jev retry');
  });
  await t.test('recovery arriving in Waiting opens only after the compact second-left checkpoint',async()=>{
   await page.evaluate(()=>{window.hold=true;window.app.navigate('document');});
   await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
   await page.clock.runFor(8250);
   await page.evaluate(()=>{window.app.error='The requested action could not finish.';window.hold=false;window.requests.at(-1).resolve();window.app.changed();});
   await page.waitForFunction(()=>!window.app.toolbarDecisionPending);
   await page.clock.runFor(2700);
   assert.equal(await root.getAttribute('data-toolbar-phase'),'waiting');assert.equal(await root.getAttribute('data-opening-pending'),'false');
   await page.clock.runFor(3650);await ready();
   assert.equal(await page.evaluate(()=>window.app.error),'The requested action could not finish.');
   await page.evaluate(()=>{window.app.error='';window.app.changed();});
  });
  await t.test('background generation completion refreshes actions while page content stays available',async()=>{
   await page.evaluate(()=>{
    window.app.client.jobs=[{jobId:'background',documentId:'d',status:'running',kind:'render_document',result:{artifactKind:'video'},requestedAt:'2026-09-28T00:00:00Z'}];
    window.app.client.pollJobs=async()=>{window.app.client.jobs=window.app.client.jobs.map(job=>({...job,status:'completed'}));};
    window.app.lastJobsPoll=0;void window.app.sync(true);
   });
   await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.hasAttribute('data-motion-active'));
   assert.equal(await page.locator('main h1').textContent(),'Observatory');await ready();
   assert.equal(await page.evaluate(()=>window.app.client.jobs[0].status),'completed');
  });
  await t.test('reduced motion retains readiness, inert controls and responsive fit',async()=>{
   await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});
   await page.evaluate(()=>window.app.navigate('document'));await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
   assert.equal(await live.evaluate(n=>n.inert),true);await ready();
   const box=await live.locator('en-toolbar').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
   assert.equal(await page.locator('.toolbar-motion-visual').evaluate(n=>n.children.length),0);
  });
  await t.test('form validation returns through Loading and keeps the original save handler',async()=>{
   await page.evaluate(()=>{window.hold=false;window.app.begin('rename');});await ready();
   const field=page.getByRole('textbox',{name:'Name',exact:true});await field.fill('');
   await live.getByRole('button',{name:'Save',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
   await ready();assert.equal(await page.evaluate(()=>window.app.error),'Enter a name.');
   assert.equal(await live.getByRole('button',{name:'Save',exact:true}).count(),1);
   await live.getByRole('button',{name:'Back',exact:true}).click();await ready();
   assert.equal(await page.evaluate(()=>window.app.mode),'');
  });
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
