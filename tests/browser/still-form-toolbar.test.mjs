import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Still form workflows use one responsive toolbar with their original commands',async t=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-form-toolbar',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:900,height:700}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/context/apply',route=>route.fulfill({json:{status:'start'}}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still/action/new-project`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js'),{StillApp}=await import('/src/still/app.ts'),{foldEvents}=await import('/src/model/events.ts');
   const css=(await import('/src/still/style.css?raw')).default;const style=document.createElement('style');style.textContent=css.replaceAll('still-app','form-fixture');document.head.append(style);
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);}
    updated(){this.scheduleDockFit();} decide(){} currentRouteProblem(){return '';} missingWriting(){return null;}
    closeMode(){this.mode='';this.changed();}
    navigate(view,ids){window.destination={view,...ids};this.mode='';this.changed();}
    render(){return html`<div class="still-shell"><main>${this.renderCanvas()}</main>${this.renderDock()}${this.renderDockProbes()}</div>`;}
   }
   customElements.define('form-fixture',Fixture);
   const raw=[['ProjectCreated',{project_id:'p',name:'Quiet hour'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Observatory'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'Subject',position:'1',properties:{text:'The subject',weight:1}}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'x',type:'style',handle:'Style',position:'2',properties:{text:'Quiet',weight:1}}],['DocumentCreated',{project_id:'p',document_id:'d2',title:'Another document'}],['BlockCreated',{project_id:'p',document_id:'d2',block_id:'b2',type:'subject',handle:'Other idea',position:'1',properties:{text:'Another idea',weight:1}}]];
   const events=raw.map(([type,payload],i)=>({type,payload,sequence:i+1,eventId:'e'+i,streamId:'test',occurredAt:'2026-09-21T12:00:00Z',actor:'user'}));
   const app=window.app=new Fixture();window.writes=[];
   app.loading=false;app.mode='new-project';app.client={epoch:1,head:events.length,scopeKey:'test',events,content:{},jobs:[],abilities:{author:true,generate:false,projectCreate:true,formats:[]},session:{policy:{accepted:true},projects:[]},position:{projectId:'p',documentId:'d',blockId:'b',outputId:'',view:'document',intent:'',recentActions:[]},projection:foldEvents(events,Infinity,'d','p'),verifyScope:async()=>()=>{},refresh:async()=>{},append:async events=>window.writes.push(events),createProject:async name=>{window.created={name};return {projectId:'created'};}};
   document.body.append(app);await app.updateComplete;
  });
  const dock=page.locator('.action-dock'),button=name=>dock.getByRole('button',{name,exact:true});
  const mode=async value=>{await page.evaluate(value=>{window.app.client.hasUnconfirmedWrite=false;window.app.mode=value;window.app.titleDraft='';window.app.bodyDraft='';window.app.changed();},value);await page.waitForFunction(value=>window.app.mode===value&&!!document.querySelector('.action-dock'),value);};
  await t.test('creation and editing commands leave the content and retain Save and Back',async()=>{
   for(const value of ['new-project','new-document','add-context','edit-block','rename','edit-artifact','intent','workspaces','reuse']){
    await mode(value);await button('Back').waitFor();assert.equal(await page.locator('main en-button').count(),0,value);assert.equal(await dock.locator('en-toolbar').count(),1);
    assert.equal(await button(value==='intent'?'Suggest actions':value==='workspaces'?'Open':value==='reuse'?'Copy idea':'Save').count(),1,value);
   }
   await mode('new-project');await button('Save').click();assert.equal(await page.evaluate(()=>window.app.error),'Enter a name.');assert.equal(await page.evaluate(()=>window.created),undefined);
   await page.getByRole('textbox',{name:'Name',exact:true}).fill('A new project');assert.equal(await page.getByRole('textbox',{name:'Idea',exact:true}).count(),0);
   await button('Save').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>!!window.created);assert.deepEqual(await page.evaluate(()=>window.created),{name:'A new project'});assert.deepEqual(await page.evaluate(()=>window.destination),{view:'documents',projectId:'created',documentId:''});
   await mode('rename');await page.evaluate(()=>{window.app.client.hasUnconfirmedWrite=true;window.app.changed();});await button('Check save').waitFor();await button('Back').click();assert.equal(await page.evaluate(()=>window.app.mode),'');
  });
  await t.test('creation submits the form from Save or Enter, preserving multiline and IME editing',async()=>{
   for(const value of ['new-project','new-document','add-context']){
    await mode(value);
    await page.evaluate(()=>{
     window.submits=0;window.creationCalls=0;
     document.querySelector('#still-create-form').addEventListener('submit',()=>window.submits++);
     const create=async()=>{window.creationCalls++;return {projectId:'p',documentId:'new'};};
     window.app.client.createProject=create;window.app.client.createDocument=create;
     window.app.client.blockEvent=()=>({type:'BlockCreated',payload:{block_id:'new',position:'3'}});
     window.app.client.append=async()=>{window.creationCalls++;};
    });
    assert.equal(await dock.locator('en-button[form="still-create-form"]').count(),1);
    const name=page.getByRole('textbox',{name:'Name',exact:true}),idea=page.getByRole('textbox',{name:'Idea',exact:true});
    await name.fill('A name');
    if(value==='new-project')assert.equal(await idea.count(),0);
    else {await idea.fill('First line');await idea.press('Enter');assert.match(await idea.inputValue(),/\n/);}
    assert.equal(await page.evaluate(()=>window.submits),0);
    await name.evaluate(el=>{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,composed:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,composed:true}));});
    assert.equal(await page.evaluate(()=>window.submits),0);
    if(value==='new-document')await button('Save').click();else await name.press('Enter');
    await page.waitForFunction(()=>window.creationCalls===1);
    assert.equal(await page.evaluate(()=>window.submits),1,value);
   }
   await mode('new-project');await page.getByRole('textbox',{name:'Name',exact:true}).fill('Only once');
   await page.evaluate(()=>{
    window.creationCalls=0;window.app.client.createProject=()=>{window.creationCalls++;return new Promise(resolve=>window.finishCreate=resolve);};
    const form=document.querySelector('#still-create-form');form.requestSubmit();form.requestSubmit();
   });
   assert.equal(await page.evaluate(()=>window.creationCalls),1);
   await page.evaluate(()=>window.finishCreate({projectId:'p',documentId:'new'}));await page.waitForFunction(()=>!window.app.busy);
   await mode('new-project');await page.getByRole('textbox',{name:'Name',exact:true}).fill('Overflow submit');
   await page.evaluate(()=>{window.app.sharedPanelActive=true;window.app.density=1;window.app.client.createProject=async()=>{window.creationCalls++;return {projectId:'p',documentId:'new'};};window.submits=0;document.querySelector('#still-create-form').addEventListener('submit',()=>window.submits++);window.app.changed();});
   await button('More actions').click();await dock.getByRole('menuitem',{name:'Save',exact:true}).click();await page.waitForFunction(()=>window.submits===1);
   await page.evaluate(()=>{window.app.sharedPanelActive=false;window.app.density=5;window.app.client.append=async events=>window.writes.push(events);window.app.changed();});
  });
  await t.test('group workflow updates toolbar across stages and keeps save recovery guards',async()=>{
   await mode('compose');await button('Continue').waitFor();assert.equal(await page.locator('main en-button').count(),0);
   await button('Continue').click();await button('Preview').waitFor();await button('Preview').click();await button('Save group').waitFor();
   await page.evaluate(()=>{window.app.client.hasUnconfirmedWrite=true;document.querySelector('still-context-flow').requestUpdate();});await button('Check save').waitFor();assert.equal(await button('Back').isDisabled(),true);
   await button('Check save').click();await page.waitForFunction(()=>window.writes.length===1);
  });
  await t.test('research and reference consent commands stay disabled until allowed',async()=>{
   await mode('research-context');await button('Review cost').waitFor();assert.equal(await page.locator('main en-button').count(),0);
   await page.evaluate(()=>{const flow=document.querySelector('still-context-flow');flow.phase='quote';flow.flow.quote={status:'quoted',provider:'Fixture',models:[],maximumMicrousd:0,providerCalls:1,searchCalls:0,providerAvailable:false};flow.requestUpdate();});
   await button('Approve analysis').waitFor();assert.equal(await button('Approve analysis').isDisabled(),true);
   await page.evaluate(()=>{const flow=document.querySelector('still-context-flow');flow.phase='intake';flow.intake={research:{label:'A reference',attribution:'Fixture',license:'CC0'}};flow.requestUpdate();});
   await button('Add reference').waitFor();assert.equal(await button('Add reference').isDisabled(),true);
   await page.evaluate(()=>{const flow=document.querySelector('still-context-flow');flow.rights=true;flow.requestUpdate();});await page.waitForFunction(()=>!document.querySelector('.action-dock en-button').disabled);
   await button('Back').click();await button('Close').waitFor();
  });
  await t.test('reuse destination flow and small action limits share the toolbar',async()=>{
   await mode('use-in');await button('Review').waitFor();assert.equal(await button('Review').isDisabled(),true);assert.equal(await page.locator('main en-button').count(),0);
   await page.evaluate(()=>{const flow=document.querySelector('still-use-in-flow');flow.destination=flow.destinations[0].id;flow.requestUpdate();});await page.waitForFunction(()=>!document.querySelector('.action-dock en-button').disabled);
   await button('Review').click();await page.waitForFunction(()=>document.querySelector('still-use-in-flow').phase==='review');assert.match(await dock.textContent(),/Link idea|Copy idea/);
   await button('Back').click();await button('Review').waitFor();
   await mode('new-project');await page.evaluate(()=>{window.app.sharedPanelActive=true;window.app.density=1;window.app.changed();});await button('More actions').waitFor();assert.equal(await dock.locator('en-toolbar > en-button').count(),1);assert.equal(await dock.locator('en-menu-item').count(),2);
   await button('More actions').click();await dock.getByRole('menuitem',{name:'Back',exact:true}).click();assert.equal(await page.evaluate(()=>window.app.mode),'');
   await page.setViewportSize({width:360,height:700});await mode('new-project');await page.evaluate(()=>{window.app.density=5;window.app.changed();});await button('Back').waitFor();
   assert.equal(await dock.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  });
  await t.test('workflow tooltips describe final saves, cancellation and real review steps',async()=>{
   await page.setViewportSize({width:900,height:700});
   await page.evaluate(()=>{window.app.onboarding=true;window.app.density=5;window.app.onboardingHelp.help=()=> 'Wrong generic next step';window.app.changed();});
   const help=label=>dock.locator('en-tooltip').filter({has:page.locator('[slot="content"]')}).evaluateAll((tips,label)=>{
    const tip=tips.find(t=>document.getElementById(t.getAttribute('for'))?.textContent.trim()===label);return tip?.textContent.trim();
   },label);
   for(const [value,save,back] of [
    ['new-project','Create this project. Add documents when you’re ready.','Return without creating a new project.'],
    ['new-document','Create this document in the current project and open it.','Return without creating a new document.'],
    ['add-context','Add this idea to the document so you can use it in your work.','Return without adding a new idea.'],
    ['rename','Save the document’s new name.','Return without changing the document’s name.'],
   ]){
    await mode(value);await button('Save').waitFor();assert.equal(await help('Save'),save);assert.equal(await help('Back'),back);
   }
   await page.evaluate(()=>{window.app.client.hasUnconfirmedWrite=true;window.app.changed();});await button('Check save').waitFor();assert.match(await help('Check save'),/earlier save completed/);assert.match(await help('Back'),/still unconfirmed/);
   await mode('compose');await button('Continue').click();await button('Preview').waitFor();assert.equal(await help('Back'),'Return to choosing the ideas in this group.');
   await page.evaluate(()=>{window.app.onboarding=false;delete window.app.onboardingHelp.help;window.app.changed();});
  });
  await t.test('empty projects invite document creation even when model suggestions omit it',async()=>{
   await page.evaluate(()=>{
    const app=window.app;app.mode='';app.client.position={...app.client.position,view:'documents',documentId:'',blockId:''};
    app.client.projection={...app.client.projection,documents:[],blocks:[]};
    app.suggestions=[];app.rankedActions=[];app.moreOpen=false;app.changed();
   });
   await button('New document').waitFor();
   assert.equal(await dock.locator('en-button[variant="primary"]').textContent(),'New document');
   assert.match(await page.locator('main').textContent(),/Create a document to collect your ideas/);
   await page.evaluate(()=>{window.app.client.abilities.author=false;window.app.changed();});
   await page.waitForFunction(()=>!Array.from(document.querySelectorAll('.action-dock en-button')).some(b=>b.textContent.trim()==='New document'));
   assert.match(await page.locator('main').textContent(),/No documents yet/);
  });
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
