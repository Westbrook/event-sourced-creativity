import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('idea selection, manual file attachment and direct analysis use the shared toolbar without cost approval',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-idea-workflows',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1000,height:800}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/context/apply',r=>r.fulfill({json:{status:'start'}}));
  const analysisRequests=[];
  await page.route(/\/api\/context\/(?:decompose|research)$/,r=>{
   const body=r.request().postDataJSON();analysisRequests.push(body);
   const identity={executionId:'execution',bindingHash:'binding'};
   if(body.action==='quote')return r.fulfill({json:{quote:{...identity,projectId:'p',documentId:'d',blockId:'b',canvasId:null,publicQuery:body.publicQuery,status:'quoted',providerAvailable:true,canExecute:true}}});
   return r.fulfill({json:{...identity,...(r.request().url().endsWith('/decompose')?{plan:{sourceBlockId:'b',proposals:[{id:'part',label:'Brass handle',text:'brass handle',sourceExcerpt:'brass handle'}],addenda:[]}}:{report:{blockId:'b',inferred:[],related:[],learned:[{id:'fact',label:'Brass handle',text:'A useful sourced detail.',area:'learned',type:'setting'}]}})}});
  });
  await page.route('**/api/media',r=>r.fulfill({json:{url:'/api/media/fixture',name:'study.txt',mimeType:'text/plain',contentHash:'hash',kind:'document',sourceEvidenceHash:'evidence',extraction:{status:'ready',text:'Glazed ceramic.',sourceKind:'text',segments:[{anchor:'text',text:'Glazed ceramic.'}],truncated:false,message:''}}}));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js'),{StillApp}=await import('/src/still/app.ts'),{foldEvents}=await import('/src/model/events.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default.replaceAll('still-app','idea-fixture');document.head.append(style);
   class Fixture extends StillApp{connectedCallback(){LitElement.prototype.connectedCallback.call(this);}updated(){this.scheduleDockFit();}decide(){}currentRouteProblem(){return '';}missingWriting(){return null;}writeRoute(){}closeMode(){this.mode='';this.changed();}focusContent(){}render(){return html`<div class="still-shell"><main>${this.renderCanvas()}</main>${this.renderDock()}${this.renderDockProbes()}</div>`;}}
   customElements.define('idea-fixture',Fixture);const events=[['ProjectCreated',{project_id:'p',name:'Test'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Ceramics'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'Vessel',scope:'document',position:'1',properties:{text:'A glazed vessel with a brass handle.',weight:1}}]].map(([type,payload],i)=>({type,payload,sequence:i+1,eventId:'e'+i,occurredAt:'2026-09-21',streamId:'test',actor:'user'}));
   const app=window.app=new Fixture();window.writes=[];app.loading=false;app.mode='supply-reference';app.client={epoch:1,head:events.length,scopeKey:'test',events,content:{},jobs:[],abilities:{author:true,generate:true,projectCreate:true,formats:['image']},session:{policy:{accepted:true},projects:[]},position:{projectId:'p',documentId:'d',blockId:'',outputId:'',view:'document',intent:'',recentActions:[]},projection:foldEvents(events,Infinity,'d','p'),verifyScope:async()=>()=>{},refresh:async()=>{},pollJobs:async()=>{},append:async events=>window.writes.push(events)};document.body.append(app);await app.updateComplete;
  });
  const dock=page.locator('.action-dock'),button=name=>dock.getByRole('button',{name,exact:true});
  await page.getByRole('heading',{name:'Choose an idea'}).waitFor();await button('Continue').click();await page.getByRole('heading',{name:'Supply reference'}).waitFor();assert.equal(await button('Attach file').isDisabled(),true);assert.equal(await page.evaluate(()=>window.app.client.position.blockId),'b');
  await page.locator('input[type=file]').setInputFiles({name:'study.txt',mimeType:'text/plain',buffer:Buffer.from('Glazed ceramic.')});
  await page.getByRole('checkbox',{name:'I can use this file. It contains no sensitive personal data.'}).click();await button('Attach file').click();await page.waitForFunction(()=>window.writes.length===1);assert.equal(await page.evaluate(()=>window.writes[0].find(e=>e.type==='BlockCreated').payload.properties.text),'Glazed ceramic.');
  for(const [action,label] of [['split-context','Split idea'],['research-context','Research idea'],['find-references','Find reference']]){
   analysisRequests.length=0;
   await page.evaluate(action=>window.app.begin(action,false),action);await page.getByRole('heading',{name:label}).waitFor();
   if(action!=='split-context')assert.match(await page.getByRole('textbox',{name:'Public search topic · 140 characters max'}).inputValue(),/glazed vessel/);
   await page.setViewportSize({width:390,height:844});await button(label).click();await page.getByRole('heading',{name:'Brass handle'}).waitFor();
   assert.deepEqual(analysisRequests.map(r=>r.action),['quote','execute']);
   assert.equal(await page.getByText(/Review cost|Approve analysis|Maximum cost/).count(),0);
   assert.equal(await button('Select').count(),1,'Suggestions still require the user to select and apply them');
  }
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
