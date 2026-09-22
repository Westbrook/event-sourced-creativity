import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('sticky dock retains full width, bottom anchoring and final content clearance',async()=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-sticky-dock',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/still',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});
 let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/still`);
  await page.evaluate(async()=>{
   const {html,LitElement}=await import('/node_modules/lit/index.js'),{StillApp}=await import('/src/still/app.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default.replaceAll('still-app','sticky-fixture');document.head.append(style);
   class Fixture extends StillApp{
    connectedCallback(){LitElement.prototype.connectedCallback.call(this);}
    updated(){this.dockObserver.observe(this.querySelector('.dock-stack'));this.scheduleDockFit();}
    render(){
     const content=this.scene==='long'?html`<article class="writing"><h1>Writing</h1><div class="prose">${Array.from({length:30},()=>html`<p>A paragraph of creative work that must stay reachable above the toolbar.</p>`)}</div></article>`
      :this.scene==='list'?html`<article class="document-page"><h1>All ideas</h1><div class="all-list-viewport">${Array.from({length:40},(_,i)=>html`<a class="context-block" href="#idea"><p>Idea ${i+1}</p></a>`)}</div></article>`
      :this.scene==='image'?html`<figure class="image-frame known-size" style="--image-ratio:1"><div style="height:100%;background:#ddd">Image result</div></figure>`
      :this.scene==='video'?html`<div class="media-stage"><video width="1280" height="720" controls></video></div>`
      :this.scene==='form'?html`<section class="form-page"><h1>Edit writing</h1><en-textarea label="Writing" rows="16" value="Long form"></en-textarea></section>`
      :html`<section class="library-page"><h1>Projects</h1><p>No projects yet.</p></section>`;
     return html`<div class=${this.panel?'still-layout has-developer':'still-layout'}><div class="still-shell"><header class="masthead">still.</header><main>${content}<span data-end>End of content</span></main><div class="dock-stack"><en-toast-region class="generation-notifications" placement="inline" label="Notifications">${this.showNotice?this.notification('review','Some ideas need review before continuing. Read the details and choose the next step.','warning',[{label:'Review ideas',run:()=>{}}]):null}</en-toast-region><footer class="action-dock"><en-toolbar label="Your next step"><en-button>Save</en-button><en-button>Back</en-button></en-toolbar></footer></div></div>${this.panel?html`<aside class="developer-panel">Developer</aside>`:null}</div>`;
    }
   }
   customElements.define('sticky-fixture',Fixture);window.app=new Fixture();window.app.client={scopeKey:'test',position:{documentId:'d'}};document.body.append(window.app);
  });
  for(const width of [1440,1024,390,320])for(const panel of [false,true])for(const scene of ['short','long','list','image','video','form'])for(const showNotice of [false,true]){
   await page.setViewportSize({width,height:800});
   await page.evaluate(async options=>{Object.assign(window.app,options);window.app.expandedNotification=options.showNotice?'test:d:review':'';window.app.changed();await window.app.updateComplete;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));},{panel,scene,showNotice});
   const label=JSON.stringify({width,panel,scene,showNotice});
   for(const fraction of [0,.5,1]){
    await page.evaluate(f=>scrollTo(0,f*(document.documentElement.scrollHeight-innerHeight)),fraction);
    const box=await page.evaluate(()=>{
     const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
     return {dock:rect('.dock-stack'),shell:rect('.still-shell'),actions:rect('.action-dock'),end:rect('[data-end]'),viewport:innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,padding:getComputedStyle(document.querySelector('.still-shell')).paddingBottom};
    });
    assert.ok(Math.abs(box.dock.bottom-box.viewport)<1,label+' dock bottom');
    assert.ok(Math.abs(box.dock.left-box.shell.left)<1&&Math.abs(box.dock.right-box.shell.right)<1,label+' full width');
    const inset=width<=600?12:24;
    assert.ok(Math.abs(box.actions.left-box.shell.left-inset)<1&&Math.abs(box.shell.right-box.actions.right-inset)<1,label+' action width');
    assert.equal(box.padding,'0px');assert.ok(box.scrollWidth<=box.width,label+' horizontal overflow');
    if(fraction===1)assert.ok(box.end.bottom<=box.dock.top+1,label+' final content visible');
    if(scene==='short'&&!showNotice)assert.equal(box.scrollHeight,box.viewport,label+' no excess scrolling');
   }
   if(showNotice){
    assert.equal(await page.locator('.notification-detail').isVisible(),true,label+' expanded review');
    const positions=await page.evaluate(()=>({notice:document.querySelector('en-toast').shadowRoot.querySelector('[part=base]').getBoundingClientRect().bottom,toolbar:document.querySelector('.action-dock').getBoundingClientRect().top}));
    assert.ok(positions.notice<=positions.toolbar,label+' notification above actions');
   }
  }
  await page.screenshot({path:'/private/tmp/still-sticky-dock-mobile.png'});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
