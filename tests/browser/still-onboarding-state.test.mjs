import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Developer Panel renders live onboarding state in host, detached and remote views',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-onboarding-state',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/__onboarding_state',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__onboarding_state`);
  await page.evaluate(async()=>{
   await import('/src/still/developer-console.ts');
   const {foldEvents}=await import('/src/model/events.ts');const {decisionDiagnostics}=await import('/src/still/diagnostics.ts');
   const position={projectId:'',documentId:'',blockId:'',outputId:'',view:'projects',intent:'',recentActions:[]};
   const current=decisionDiagnostics(foldEvents([]),position,{author:true,generate:false,projectCreate:true,formats:[]},{head:0,source:'local'});
   const panel=window.panel=document.createElement('still-developer-console');panel.context={view:'projects',mode:'',head:0,page:0,selectedFormat:'',onboarding:false,current};document.body.append(panel);await panel.updateComplete;
  });
  const row=page.getByRole('status',{name:'Onboarding state'});
  const set=async(status,extra={})=>page.evaluate(async({status,extra})=>{Object.assign(window.panel,extra);window.panel.context={...window.panel.context,onboarding:true,onboardingText:status};await window.panel.updateComplete;},{status,extra});
  assert.equal(await row.locator('en-badge[variant=success]').textContent(),'●Not Requested');assert.match(await row.textContent(),/Off/);
  await set({source:'pending'});assert.equal(await row.locator('en-badge[variant=success]').textContent(),'●Pending');assert.equal(await row.locator('.jev-timing').count(),0);
  await set({source:'model',tipCount:3,requestElapsedMs:1960,elapsedMs:500});assert.equal(await row.locator('en-badge[variant=success]').textContent(),'●Received');assert.equal(await row.locator('en-badge[variant=neutral]').count(),2);assert.match(await row.textContent(),/1.96 s total/);assert.match(await row.textContent(),/3 tooltips received/);
  await set({source:'model',tipCount:3,requestElapsedMs:0,cache:{layer:'browser',status:'hit',originalLatencyMs:1960}},{detached:true});assert.match(await row.textContent(),/0 ms browser cache/);
  await set({source:'local',reason:'unavailable',requestElapsedMs:8000},{remote:true});assert.equal(await row.locator('en-badge[variant=warning]').textContent(),'●Fallback');assert.match(await row.textContent(),/Local wording/);assert.equal(await row.locator('en-badge[variant=success]').count(),0);
  await set({source:'model',tipCount:3,requestElapsedMs:120,elapsedMs:95,timing:{authorizationMs:15,preparationMs:2,cacheReadMs:78,reservationMs:0,providerMs:0,settlementMs:0,cacheWriteMs:0,serverMs:95,cacheSource:'durable'}});
  await row.getByText('Request timing · durable cache',{exact:true}).click();
  assert.match(await row.locator('.onboarding-timing').textContent(),/Model response0 ms/);
  assert.match(await row.locator('.onboarding-timing').textContent(),/Server total95 ms/);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
