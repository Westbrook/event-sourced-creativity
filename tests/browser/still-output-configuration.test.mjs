import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Still selects types before configuring and explicitly submitting',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-output-configuration',optimizeDeps:{noDiscovery:true,include:['lit']},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1000,height:850}});page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/@id/lit'),{StillApp}=await import('/src/still/app.ts'),{StillClient}=await import('/src/still/client.ts'),{foldEvents}=await import('/src/model/events.ts');
   const css=(await import('/src/still/style.css?raw')).default;const style=document.createElement('style');style.textContent=css.replaceAll('still-app','output-fixture');document.head.append(style);
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);} updated(){this.scheduleDockFit();} decide(){} suggestFormats(){} currentRouteProblem(){return '';}
    navigate(view,ids){window.destination={view,...ids};this.changed();}
    render(){return html`<div class="still-shell"><main tabindex="-1">${this.renderCanvas()}</main>${this.renderDock()}${this.renderDockProbes()}</div>`;}
   }
   customElements.define('output-fixture',Fixture);
   const raw=[['ProjectCreated',{project_id:'p',name:'Quiet hour'}],['DocumentCreated',{project_id:'p',document_id:'d',title:'Observatory'}],['BlockCreated',{project_id:'p',document_id:'d',block_id:'b',type:'subject',handle:'Subject',position:'1',properties:{text:'An observatory in a quiet forest.',weight:1}}]];
   const events=raw.map(([type,payload],i)=>({type,payload,sequence:i+1,eventId:'e'+i,streamId:'test',occurredAt:'2026-09-22T12:00:00Z',actor:'user'}));
   const app=window.app=new Fixture();window.submissions=[];
   app.loading=false;app.mode='generate';app.routeMode='generate';app.client={epoch:1,head:events.length,scopeKey:'test',events,content:{},jobs:[],abilities:{author:true,generate:true,projectCreate:true,formats:['image','short_story','scene','slides','storyboard','video','audio','model3d']},session:{policy:{accepted:true},projects:[]},position:{projectId:'p',documentId:'d',blockId:'',outputId:'',view:'document',intent:'',recentActions:[]},projection:foldEvents(events,Infinity,'d','p'),prepareGeneration:StillClient.prototype.prepareGeneration,model3dAdaptation:StillClient.prototype.model3dAdaptation,async generate(draft){window.submissions.push(StillClient.prototype.generationPayload.call(this,draft));return {jobId:'fixture'};}};
   document.body.append(app);await app.updateComplete;
  });
  const dock=page.locator('.action-dock'),button=name=>dock.getByRole('button',{name,exact:true});
  const choose=async format=>{
   await page.getByRole('heading',{name:'Choose output',exact:true}).waitFor();await page.waitForTimeout(250);
   const visible=dock.locator(`en-toolbar > en-button[data-action-id="${format}"]`);
   if(await visible.count())await visible.click();else{await button('Other outputs').click();await dock.locator(`en-menu-item[action="${format}"]`).click();}
   await page.locator('.output-options').waitFor();
  };
  await choose('slides');assert.match(await page.locator('h1').textContent(),/Configure/);assert.equal(await page.evaluate(()=>window.submissions.length),0);
  await page.getByLabel('Number of slides',{exact:true}).fill('12');
  await page.getByRole('textbox',{name:'Audience · optional',exact:true}).fill('Curious students');
  await button('Back to types').click();await choose('slides');assert.equal(await page.getByLabel('Number of slides',{exact:true}).inputValue(),'12');assert.equal(await page.getByRole('textbox',{name:'Audience · optional',exact:true}).inputValue(),'Curious students');
  await page.getByLabel('Number of slides',{exact:true}).fill('16');await button('Generate').click();assert.equal(await page.evaluate(()=>window.submissions.length),0);assert.match(await page.evaluate(()=>window.app.error),/slides/);await page.getByLabel('Number of slides',{exact:true}).fill('12');
  await button('Generate').click();await page.waitForFunction(()=>window.submissions.length===1);assert.equal(await page.evaluate(()=>window.submissions[0].payload.itemCount),12);assert.equal(await page.evaluate(()=>window.submissions[0].payload.audience),'Curious students');
  for(const width of [1000,390]){
   await page.setViewportSize({width,height:850});
   for(const format of ['image','short_story','scene','slides','storyboard','video','audio','model3d']){
    await button('Back to types').click();await choose(format);assert.equal(await page.evaluate(()=>window.submissions.length),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`${format} at ${width}`);
    assert.equal(await button(format==='scene'?'Estimate cost':'Generate').count(),1);
   }
  }
  await button('Back to types').click();await choose('video');
  const select=page.locator('en-select[label="Frame"]');await select.getByRole('combobox').click();await page.getByRole('option',{name:'Portrait · 9:16',exact:true}).click();assert.equal(await page.evaluate(()=>window.app.generation.settings.videoSize),'720x1280');
  await page.screenshot({path:'/private/tmp/still-output-configuration.png',fullPage:true});
  await page.setViewportSize({width:1000,height:850});await page.screenshot({path:'/private/tmp/still-output-configuration-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
