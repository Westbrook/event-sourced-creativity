import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('unconfirmed draft stays editable and saves corrected input only through its explicit save action',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-save-recovery',optimizeDeps:{noDiscovery:true,include:['lit','lit/async-directive.js','lit/directives/if-defined.js','lit/directives/keyed.js','lit/directives/live.js','lit/directives/repeat.js','lit/static-html.js','qrcode','signal-polyfill','signal-utils/subtle/reaction']},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still/action/new-project`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/@id/lit'),{StillApp}=await import('/src/still/app.ts'),{foldEvents}=await import('/src/model/events.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default.replaceAll('still-app','save-fixture');document.head.append(style);
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);}
    updated(){this.scheduleDockFit();}decide(){}currentRouteProblem(){return '';}missingWriting(){return null;}
    navigate(view,ids){window.destination={view,...ids};this.mode='';this.changed();}
    render(){return html`<div class="still-shell"><main>${this.renderCanvas()}</main>${this.renderDock()}${this.renderDockProbes()}</div>`;}
   }
   customElements.define('save-fixture',Fixture);const app=window.app=new Fixture();window.writes=0;window.checks=0;window.unlocks=0;
   app.loading=false;app.mode='new-project';app.titleDraft='';app.bodyDraft='';
   app.client={epoch:1,head:0,scopeKey:'owner',events:[],content:{},jobs:[],hasUnconfirmedWrite:true,pendingWriteId:'earlier',abilities:{author:true,generate:false,projectCreate:true,formats:[]},session:{policy:{accepted:true},projects:[]},position:{projectId:'',documentId:'',blockId:'',outputId:'',view:'projects',intent:'',recentActions:[]},projection:foldEvents([]),
    checkPendingSave:async()=>{window.checks++;return {confirmed:false,correlationId:'earlier'};},
    startNewSave:async id=>{if(id!=='earlier')throw Error('Wrong pending save');window.unlocks++;app.client.hasUnconfirmedWrite=false;app.client.pendingWriteId='';return {confirmed:!!window.confirmOnRetry,correlationId:id};},
    createProject:async name=>{window.writes++;window.savedName=name;return {projectId:'created'};}};
   app.draftBaseline=app.draftSignature();document.body.append(app);await app.updateComplete;
  });
  const button=name=>page.locator('.action-dock').getByRole('button',{name,exact:true}),name=page.getByRole('textbox',{name:'Name',exact:true});
  assert.equal(await name.isEnabled(),true);assert.match(await page.locator('main').innerText(),/keep editing this draft/);
  assert.equal(await page.evaluate(()=>window.app.preventsRouteChange()),false,'Recovery metadata alone is not an unsaved form');
  await name.fill('Mistyped name');await name.fill('Corrected project');
  assert.equal(await page.evaluate(()=>window.writes),0,'Editing never submits');
  assert.equal(await page.evaluate(()=>window.app.preventsRouteChange()),true,'Actual edits retain leave protection');
  await button('Check save').click();await button('Save draft').waitFor();
  assert.equal(await page.evaluate(()=>window.checks),1);assert.equal(await page.evaluate(()=>window.writes),0);assert.equal(await page.evaluate(()=>window.app.error),'');
  assert.equal(await name.inputValue(),'Corrected project');assert.equal(await name.isEnabled(),true);
  assert.equal(await button('Start new draft').count(),0);assert.match(await page.locator('main').innerText(),/could create a duplicate/);
  await name.fill('');await button('Save draft').click();
  await page.waitForFunction(()=>window.app.error==='Enter a name.');
  assert.equal(await page.evaluate(()=>window.unlocks),0,'Invalid input never discards the pending receipt');
  assert.equal(await page.evaluate(()=>window.app.client.hasUnconfirmedWrite),true);assert.equal(await name.isEnabled(),true);
  await name.fill('Corrected project');await button('Save draft').click();await page.waitForFunction(()=>window.writes===1);
  assert.equal(await page.evaluate(()=>window.savedName),'Corrected project');assert.equal(await page.evaluate(()=>window.unlocks),1);
  assert.deepEqual(await page.evaluate(()=>window.destination),{view:'documents',projectId:'created',documentId:''});
  // A receipt arriving between Check save and Save draft must stop the new POST.
  await page.evaluate(()=>{const app=window.app;app.mode='new-project';app.client.hasUnconfirmedWrite=true;app.client.pendingWriteId='earlier';app.titleDraft='Another correction';app.writeRecovery=undefined;window.confirmOnRetry=true;app.changed();});
  await button('Check save').click();await button('Save draft').click();await button('Save').waitFor();
  assert.equal(await page.evaluate(()=>window.writes),1,'Late confirmation does not duplicate the creation');
  assert.equal(await name.inputValue(),'Another correction');assert.equal(await name.isEnabled(),true);
  assert.match(await page.evaluate(()=>window.app.notice),/current draft has not been submitted/);
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
