import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('reloaded empty form checks its prior save, explicitly unlocks, then accepts a new name',async()=>{
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
    startNewSave:async id=>{if(id!=='earlier')throw Error('Wrong pending save');window.unlocks++;app.client.hasUnconfirmedWrite=false;app.client.pendingWriteId='';return {confirmed:false,correlationId:id};},
    createProject:async name=>{window.writes++;window.savedName=name;return {projectId:'created'};}};
   app.draftBaseline=app.draftSignature();document.body.append(app);await app.updateComplete;
  });
  const button=name=>page.locator('.action-dock').getByRole('button',{name,exact:true}),name=page.getByRole('textbox',{name:'Name',exact:true});
  assert.equal(await name.isDisabled(),true);assert.match(await page.locator('main').innerText(),/earlier save needs checking/);
  assert.equal(await page.evaluate(()=>window.app.preventsRouteChange()),false,'Persisted recovery metadata alone is not an unsaved form');
  await button('Check save').click();await button('Start new draft').waitFor();
  assert.equal(await page.evaluate(()=>window.checks),1);assert.equal(await page.evaluate(()=>window.writes),0);assert.equal(await page.evaluate(()=>window.app.error),'');
  assert.match(await page.locator('main').innerText(),/could create a duplicate/);
  await button('Start new draft').click();await button('Save').waitFor();assert.equal(await name.isEnabled(),true);assert.equal(await page.evaluate(()=>window.writes),0);assert.equal(await page.evaluate(()=>window.unlocks),1);
  await name.fill('Recovered project');assert.equal(await page.evaluate(()=>window.app.preventsRouteChange()),true,'A real draft still receives leave protection');
  await button('Save').click();await page.waitForFunction(()=>window.writes===1);assert.equal(await page.evaluate(()=>window.savedName),'Recovered project');assert.deepEqual(await page.evaluate(()=>window.destination),{view:'documents',projectId:'created',documentId:''});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
