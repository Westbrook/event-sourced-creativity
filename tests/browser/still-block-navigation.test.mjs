import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('focused idea toolbar preserves a working document return under adverse rankings and small limits',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-block-navigation',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1400,height:900}});page.setDefaultTimeout(5000);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js'),{StillApp}=await import('/src/still/app.ts'),{ACTIONS}=await import('/src/still/decisions.ts'),{foldEvents}=await import('/src/model/events.ts');
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);} updated(){} decide(){} currentRouteProblem(){return '';}
    navigate(view){window.destination=view;this.client.position={...this.client.position,view,blockId:''};this.changed();}
    render(){return html`<main></main>${this.renderDock()}`;}
   }
   customElements.define('nav-fixture',Fixture);
   const events=[['ProjectCreated',{project_id:'p',name:'P'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'D'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'Subject',properties:{text:'An idea',weight:1}}]].map(([type,payload],i)=>({type,payload,eventId:'e'+i,sequence:i+1,occurredAt:'2026-09-21T12:00:00Z'}));
   const app=window.app=new Fixture();app.loading=false;app.sharedPanelActive=true;app.density=5;
   app.client={epoch:1,head:3,scopeKey:'test',events,content:{},jobs:[],abilities:{author:true,generate:true,projectCreate:true,formats:['image']},session:{policy:{accepted:true}},position:{projectId:'p',documentId:'d',blockId:'b',outputId:'',view:'document',intent:'',recentActions:['completed:edit-block']},projection:foldEvents(events,Infinity,'d','p')};
   app.suggestions=['rename','edit-block','research-context','create'].map(id=>ACTIONS.find(a=>a.id===id));app.rankedActions=[...app.suggestions,ACTIONS.find(a=>a.id==='context')];app.decisionSource='jev';document.body.append(app);await app.updateComplete;
  });
  const dock=page.locator('.action-dock');
  await dock.getByRole('button',{name:'View document',exact:true}).waitFor();
  assert.equal(await dock.getByRole('button',{name:'Rename document',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>window.app.paletteOptions().some(a=>a.id==='rename')),true);
  for(const density of [3,2,1]){
   await page.evaluate(density=>{window.app.density=density;window.app.changed();},density);
   if(density>1)await dock.getByRole('button',{name:'View document',exact:true}).waitFor();
   else{await dock.getByRole('button',{name:'More actions',exact:true}).click();await dock.getByRole('menuitem',{name:'View document',exact:true}).click();}
  }
  assert.equal(await page.evaluate(()=>window.destination),'document');assert.equal(await page.evaluate(()=>window.app.client.position.blockId),'');
 }finally{await browser?.close();await server.close();}
});
