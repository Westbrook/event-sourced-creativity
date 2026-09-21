import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('Still list toolbar, palette, navigation and En Reve virtual collections',async t=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-still-lists',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body><style>.all-list-viewport{height:400px;overflow:auto}.all-list-rows{list-style:none;margin:0;padding:0}.all-list-rows a{display:block;padding:24px}</style></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);page.setDefaultNavigationTimeout(10000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js');const {StillApp}=await import('/src/still/app.ts');const {ACTIONS}=await import('/src/still/decisions.ts');
   class FixtureApp extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);}
    updated(){} scheduleDockFit(){} currentRouteProblem(){return '';}
    candidates(){return ACTIONS.filter(a=>['new-project','new-document','add-context'].includes(a.id));}
    decide(){} render(){return html`<main id="still-content">${this.renderCanvas()}</main>${this.renderDock()}${this.renderPalette()}`;}
   }
   customElements.define('fixture-app',FixtureApp);const app=window.app=new FixtureApp();
   app.loading=false;app.client={epoch:1,scopeKey:'test',session:{policy:{accepted:true},user:{role:'creator'}},abilities:{author:true,generate:false,projectCreate:true,formats:[]},position:{projectId:'',documentId:'',blockId:'',outputId:'',view:'projects',intent:'',recentActions:[]},jobs:[],events:[],jobsLoaded:true,pollJobs:async()=>{},projection:{projectId:'p0',projectName:'Project',documentId:'d0',documentTitle:'Ideas',projects:Array.from({length:7},(_,i)=>({id:'p'+i,name:'Project '+i,documentCount:7})),documents:Array.from({length:7},(_,i)=>({id:'d'+i,title:'Document '+i,projectId:'p0'})),blocks:Array.from({length:7},(_,i)=>({id:'b'+i,type:'subject',handle:'Idea '+i,properties:{text:'Idea content '+i},documentId:'d0',projectId:'p0'})),outputs:[],artifacts:[],blockRelations:[]}};
   app.suggestions=[ACTIONS.find(a=>a.id==='new-project')];app.rankedActions=app.candidates();document.body.append(app);await app.updateComplete;
   window.virtualItems=Array.from({length:1000},(_,i)=>({id:'item-'+i,content:html`<a href=${'#item-'+i}>Item ${i}</a>`}));
  });
  const button=name=>page.getByRole('button',{name,exact:true});
  await t.test('Show all is reserved in the second toolbar, then becomes Show less',async()=>{
   assert.equal(await page.locator('.work-row').count(),3);assert.equal(await button('Show all').count(),0);
   await button('More').click();await button('Show all').click();
   await page.waitForFunction(()=>document.querySelectorAll('.work-row').length===7);
   assert.equal(await button('Show less').count(),1);assert.equal(await button('More results').count(),0);
   const ids=await page.evaluate(()=>window.app.paletteOptions().map(a=>a.id));assert.ok(ids.includes('ui:show-less'));assert.ok(!ids.includes('ui:next-page'));assert.ok(!ids.includes('ui:previous-page'));
   await button('Show less').click();await page.waitForFunction(()=>document.querySelectorAll('.work-row').length===3);
   await button('Back').click();await button('More results').click();
   assert.equal(await page.locator('.work-row').first().textContent().then(s=>s.includes('Project 3')),true);
   assert.ok((await page.evaluate(()=>window.app.paletteOptions().map(a=>a.id))).includes('ui:previous-page'));
  });
  await t.test('leaving resets, while opt-in remembers separately by list type',async()=>{
   await button('More').click();await button('Show all').click();
   await page.locator('.work-row').first().click();await page.waitForFunction(()=>window.app.client.position.view==='documents');assert.equal(await page.locator('.work-row').count(),3);
   await page.evaluate(()=>window.app.navigate('projects',{projectId:'',documentId:''}));await page.waitForFunction(()=>document.querySelectorAll('.work-row').length===3);
   await page.evaluate(()=>window.app.setRememberLists({detail:{value:true}}));await button('More').click();await button('Show all').click();
   await page.locator('.work-row').first().click();await page.waitForFunction(()=>window.app.client.position.view==='documents');assert.equal(await page.locator('.work-row').count(),3);
   await page.evaluate(()=>window.app.navigate('projects',{projectId:'',documentId:''}));await page.waitForFunction(()=>document.querySelectorAll('.work-row').length===7);
  });
  await t.test('Ideas use the same controls, and a directly selected idea is never paginated away',async()=>{
   await page.evaluate(()=>window.app.navigate('document',{projectId:'p0',documentId:'d0'}));await page.waitForFunction(()=>document.querySelectorAll('.context-block').length===3);
   await button('More').click();await button('Show all').click();await page.waitForFunction(()=>document.querySelectorAll('.context-block').length===7);
   await page.evaluate(()=>window.app.navigate('document',{projectId:'p0',documentId:'d0',blockId:'b6'}));await page.waitForFunction(()=>document.querySelector('[aria-current="true"]')?.textContent.includes('Idea 6'));
   assert.ok(!(await page.evaluate(()=>window.app.paletteOptions().map(a=>a.id))).includes('ui:show-all'));
  });
  await t.test('Results and Palette switch modes without leaving pagination actions behind',async()=>{
   await page.evaluate(()=>{window.app.client.projection.outputs=Array.from({length:8},(_,i)=>({id:'r'+i,title:'Result '+i,sequence:i}));window.app.navigate('results',{projectId:'p0',documentId:'d0'});});
   await page.waitForFunction(()=>document.querySelectorAll('.result').length===3);
   await page.evaluate(()=>window.app.openFoundAction('ui:show-all',false));await page.waitForFunction(()=>document.querySelectorAll('.result').length===8);
   const ids=await page.evaluate(()=>window.app.paletteOptions().map(a=>a.id));assert.ok(ids.includes('ui:show-less'));assert.ok(!ids.includes('ui:next-page'));
   await page.evaluate(()=>window.app.openFoundAction('ui:show-less',false));await page.waitForFunction(()=>document.querySelectorAll('.result').length===3);
  });
  await t.test('large lists bound mounted rows, reach the final record and retain keyboard focus',async()=>{
   await page.evaluate(async()=>{window.app.remove();const list=window.list=document.createElement('still-all-list');list.items=window.virtualItems;list.renderItem=row=>row.content;document.body.append(list);await list.updateComplete;});
   await page.waitForFunction(()=>document.querySelectorAll('[data-en-virtual-key]').length>0);
   assert.ok(await page.locator('[data-en-virtual-key]').count()<50);
   await page.getByRole('link',{name:'Item 0',exact:true}).focus();
   await page.evaluate(()=>window.list.viewport.scrollToKey('item-999',{block:'end',behavior:'instant'}));
   await page.waitForFunction(()=>document.querySelector('[data-en-virtual-key="item-999"]'));
   assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Item 0');
   assert.ok(await page.locator('[data-en-virtual-key]').count()<60);
   assert.equal(await page.locator('[data-en-virtual-key="item-999"]').getAttribute('aria-posinset'),'1000');
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Item 1');
  });
 }finally{await browser?.close();await server.close();}
});
