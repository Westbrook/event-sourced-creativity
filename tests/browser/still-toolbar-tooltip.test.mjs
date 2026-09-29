import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('toolbar tooltips retire with their navigation context and buttons',async t=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-toolbar-tooltip',optimizeDeps:{noDiscovery:true,include:['lit']},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html}=await import('/@id/lit');
   const {StillApp}=await import('/src/still/app.ts');
   const {foldEvents}=await import('/src/model/events.ts');
   class Fixture extends StillApp{
    connectedCallback(){super.connectedCallback();this.onboarding=true;}
    async loadWorkspace(){}
    updated(){} decide(){} updatePageTitle(){}
    render(){return html`<main id="still-content" tabindex="-1">Content</main><div id="still-onboarding" class="action-dock"><en-toolbar>${this.actions.map(action=>this.button(action.label,()=>this.navigate('documents',{projectId:'next',documentId:''}),false,false,action.id))}</en-toolbar></div>`;}
   }
   customElements.define('tooltip-fixture',Fixture);
   const app=window.app=new Fixture();app.loading=false;app.onboarding=true;
   app.client={epoch:1,scopeKey:'test',position:{view:'projects',projectId:'',documentId:'',blockId:'',outputId:'',recentActions:[]},jobs:[],session:{policy:{accepted:true}},projection:foldEvents([])};
   app.actions=[{id:'documents',label:'Documents'}];
   document.body.append(app);await app.updateComplete;
  });
  const button=()=>page.locator('.action-dock en-button').first();
  const remember=()=>page.evaluate(()=>{window.oldTip=document.querySelector('en-tooltip');window.oldButton=window.oldTip.trigger;window.oldDescription=window.oldTip.querySelector('[slot="content"]').id;});
  const opened=()=>page.waitForFunction(()=>document.querySelector('en-tooltip').surface?.matches(':popover-open'));
  const retired=async()=>{
   assert.deepEqual(await page.evaluate(()=>[window.oldTip.isConnected,window.oldTip.open,window.oldTip.surface?.matches(':popover-open')]),[false,false,false]);
   assert.equal(await page.evaluate(()=>window.oldButton.getAttribute('aria-describedby')?.split(/\s+/).includes(window.oldDescription)??false),false);
  };
  const reset=async()=>{
   await page.mouse.move(1000,600);
   await page.evaluate(async()=>{document.querySelector('main').focus();const app=window.app;app.mode='';app.page=0;app.itemIndex=0;app.generation=null;app.onboarding=true;app.actions=[{id:'documents',label:'Documents'}];app.client.position={...app.client.position,view:'projects',projectId:'',documentId:'',blockId:'',outputId:''};app.changed();await app.updateComplete;});
  };
  await t.test('pointer navigation removes an open tooltip even when the action ID is reused',async()=>{
   await button().hover();await opened();await remember();
   // A consumer veto of ordinary dismissal must not keep removed help alive.
   await page.evaluate(()=>window.oldTip.addEventListener('en-change',event=>event.preventDefault()));
   await button().click();await retired();
   assert.equal(await page.evaluate(()=>window.app.client.position.view),'documents');
  });
  await t.test('keyboard navigation also closes and detaches its focused help',async()=>{
   await reset();await button().getByRole('button').focus();await opened();await remember();await page.keyboard.press('Enter');await retired();
  });
  await t.test('replacing an action in the same slot cannot inherit visible help',async()=>{
   await reset();await button().hover();await opened();await remember();
   await page.evaluate(async()=>{window.app.actions=[{id:'projects',label:'Projects'}];window.app.changed();await window.app.updateComplete;});
   await retired();assert.equal(await page.locator('en-tooltip').getAttribute('for'),'still-help-projects');
  });
  await t.test('navigation during the hover delay cancels the outgoing timer',async()=>{
   await reset();
   await page.evaluate(async()=>{const tip=document.querySelector('en-tooltip');tip.warmupGroup='';tip.showDelay=250;await tip.updateComplete;});
   await button().hover();await remember();
   assert.equal(await page.evaluate(()=>window.oldTip.open),false);
   await page.evaluate(()=>window.app.navigate('documents',{projectId:'next',documentId:''}));await retired();
   await page.waitForTimeout(350);await retired();
  });
  await t.test('workflow, selection, page and history changes retire help even for a shared button',async()=>{
   for(const change of ['mode','block','output','page','item','format','history']){
    await reset();
    if(change==='history')await page.evaluate(async()=>{window.app.client.position.view='documents';window.app.changed();await window.app.updateComplete;});
    await button().getByRole('button').focus();await opened();await remember();
    await page.evaluate(async change=>{
     const app=window.app;
     if(change==='mode')app.mode='rename';
     if(change==='block')app.client.position.blockId='selected';
     if(change==='output')app.client.position.outputId='result';
     if(change==='page')app.page=1;
     if(change==='item')app.itemIndex=1;
     if(change==='format')app.generation={format:'image'};
     if(change==='history'){history.replaceState({},'','/still');app.readRoute();}
     app.changed();await app.updateComplete;
    },change);
    await retired();
   }
  });
  await t.test('ordinary copy refresh preserves the open instance, while removing help closes it',async()=>{
   await reset();await button().getByRole('button').focus();await opened();await remember();
   const original=await page.locator('en-tooltip [slot="content"]').textContent();
   await page.evaluate(async()=>{window.app.onboardingHelp.help=()=> 'Updated help';window.app.changed();await window.app.updateComplete;});
   assert.equal(await page.evaluate(()=>document.querySelector('en-tooltip')===window.oldTip),true);
   assert.equal(await page.locator('en-tooltip [slot="content"]').textContent(),original);
   await page.evaluate(async()=>{window.app.onboarding=false;window.app.changed();await window.app.updateComplete;});await retired();
   assert.equal(await page.locator('en-tooltip').count(),0);
  });
  await t.test('removing the button releases its description and open help',async()=>{
   await reset();await button().getByRole('button').focus();await opened();await remember();
   await page.evaluate(async()=>{window.app.actions=[];window.app.changed();await window.app.updateComplete;});await retired();
   assert.equal(await page.evaluate(()=>window.oldButton.isConnected),false);
   assert.equal(await page.locator('en-tooltip').count(),0);
  });
  await t.test('More and Back retire help through the same teardown',async()=>{
   for(const more of [true,false]){
    await reset();await button().hover();await opened();await remember();
    await page.evaluate(more=>window.app.replaceToolbar(more),more);await retired();
   }
  });
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
