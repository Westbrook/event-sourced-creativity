import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';
test('Still navigation updates browser titles on push, hydration, rename, back and forward',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-page-title',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Still</title><body></body>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();
  const base=`http://127.0.0.1:${server.httpServer.address().port}`;
  await page.goto(base+'/still');
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js'),{StillApp}=await import('/src/still/app.ts'),{foldEvents}=await import('/src/model/events.ts');
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);window.addEventListener('popstate',this.popstate);this.readRoute();}
    updated(){this.updatePageTitle();} decide(){} focusContent(){}
    render(){return html`<button @click=${()=>this.navigate('documents',{projectId:'p',documentId:''})}>Open project</button><button @click=${()=>this.navigate('document',{projectId:'p',documentId:'d'})}>Open document</button><button @click=${()=>this.navigate('document',{blockId:'b'})}>Open idea</button>`;}
   }
   customElements.define('title-fixture',Fixture);
   const events=[['ProjectCreated',{project_id:'p',name:'Fiction'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Mockingbird'}],['BlockCreated',{project_id:'p',document_id:'d',scope:'document',block_id:'b',type:'subject',handle:'Atticus',properties:{label:'Atticus'}}]].map(([type,payload],i)=>({type,payload,eventId:'e'+i,sequence:i+1}));
   const app=window.app=new Fixture();app.loading=false;
   app.client={epoch:1,head:3,scopeKey:'test',events,content:{},jobs:[],pollJobs:async()=>{},abilities:{author:true,generate:true,projectCreate:true,formats:['image']},session:{policy:{accepted:true}},position:{projectId:'',documentId:'',blockId:'',outputId:'',view:'projects',intent:'',recentActions:[]},projection:foldEvents(events,Infinity,'d','p')};
   document.body.append(app);await app.updateComplete;
  });
  assert.equal(await page.title(),'Projects · Still');
  await page.getByRole('button',{name:'Open project',exact:true}).click();assert.equal(await page.title(),'Documents · Fiction · Still');
  await page.getByRole('button',{name:'Open document',exact:true}).click();assert.equal(await page.title(),'Mockingbird · Still');
  await page.getByRole('button',{name:'Open idea',exact:true}).click();assert.equal(await page.title(),'Atticus · Mockingbird · Still');
  await page.goBack();await page.waitForFunction(()=>document.title==='Mockingbird · Still');
  await page.goBack();await page.waitForFunction(()=>document.title==='Documents · Fiction · Still');
  await page.goForward();await page.waitForFunction(()=>document.title==='Mockingbird · Still');
  await page.evaluate(async()=>{const app=window.app;app.client.projection.documents[0].title='Revised story';app.changed();await app.updateComplete;});
  assert.equal(await page.title(),'Revised story · Still');
  await page.evaluate(async()=>{const app=window.app;app.client.session=null;app.changed();await app.updateComplete;});
  assert.equal(await page.title(),'Document · Still');
  await page.evaluate(async()=>{const app=window.app;app.client.session={policy:{accepted:true}};app.changed();await app.updateComplete;});
  assert.equal(await page.title(),'Revised story · Still');
 }finally{await browser?.close();await server.close();}
});
