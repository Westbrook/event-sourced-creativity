import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
import {chromium} from '@playwright/test';

test('Show all uses document scrolling with bounded, reachable virtual rows',async t=>{
 const server=await createServer({configFile:false,cacheDir:'node_modules/.vite-document-list',optimizeDeps:{noDiscovery:true},server:{host:'127.0.0.1',port:0},plugins:[{name:'fixture',configureServer(s){s.middlewares.use('/fixture',(_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><html><body></body></html>');});}}]});let browser;
 try{
  await server.listen();browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(5000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fixture`);
  await page.evaluate(async()=>{
   const {LitElement,html}=await import('/node_modules/lit/index.js');
   await import('/src/still/all-list.ts');
   const style=document.createElement('style');style.textContent=(await import('/src/still/style.css?raw')).default.replaceAll('still-app','scroll-fixture');document.head.append(style);
   class Fixture extends LitElement{
    createRenderRoot(){return this;}
    render(){return html`<div class="still-shell"><header class="masthead"><a href="#" class="wordmark header-stamp">still.</a></header><main><section class="library-page"><h1>Every idea in this project<br>belongs here</h1><p class="empty-copy">A heading and introductory text above the collection.</p><still-all-list class="work-list" .items=${this.items} .renderItem=${(row,i)=>html`<a class="work-row" href=${'#'+row.id}><span class="work-number">${i+1}</span><span><strong>Item ${i}</strong><small>${row.text}</small></span></a>`}></still-all-list></section></main><footer class="dock-stack"><div class="action-dock"><button style="height:48px">Show less</button></div></footer></div>`;}
   }
   customElements.define('scroll-fixture',Fixture);window.fixture=new Fixture();
   window.items=Array.from({length:1000},(_,i)=>({id:'item-'+i,text:'Variable height row content. '.repeat(1+i%9)}));window.fixture.items=window.items;
   document.body.append(window.fixture);await window.fixture.updateComplete;window.list=document.querySelector('still-all-list');await window.list.updateComplete;
  });
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const bounded=async()=>assert.ok(await page.locator('[data-en-virtual-key]').count()<65);
  const reset=async()=>{await page.evaluate(async()=>{document.activeElement?.blur();window.fixture.items=window.items;window.fixture.requestUpdate();await window.fixture.updateComplete;window.scrollTo({top:0,behavior:'instant'});});await frame();};
  const end=async()=>{
   for(let i=0;i<8;i++){await page.evaluate(()=>window.scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'}));await frame();}
   await page.locator('[data-en-virtual-key="item-999"]').waitFor();await bounded();
  };
  const visibleLast=async()=>{
   const rects=await page.evaluate(()=>({last:document.querySelector('[data-en-virtual-key="item-999"]').getBoundingClientRect().toJSON(),dock:document.querySelector('.dock-stack').getBoundingClientRect().toJSON(),height:innerHeight,innerScroll:document.querySelector('.all-list-viewport').scrollTop}));
   assert.ok(rects.last.bottom<=rects.dock.top+1,JSON.stringify(rects));assert.ok(rects.last.top>=0);assert.equal(rects.innerScroll,0);
  };
  await t.test('initial render stays at the document top without a nested scrollport',async()=>{
   await frame();assert.equal(await page.evaluate(()=>scrollY),0);await bounded();
   assert.deepEqual(await page.locator('.all-list-viewport').evaluate(el=>[getComputedStyle(el).overflowY,getComputedStyle(el).maxHeight]),['visible','none']);
  });
  await t.test('native document scrolling reaches the final row on desktop and mobile',async()=>{
   for(const size of [{width:1100,height:800},{width:390,height:650},{width:760,height:420}]){
    await page.setViewportSize(size);await reset();await end();await visibleLast();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   }
  });
  await t.test('programmatic reveal accounts for header and dock while keeping focus pinned',async()=>{
   await page.setViewportSize({width:1100,height:800});await reset();
   await page.getByRole('link',{name:/^1 Item 0 /}).focus();
   await page.evaluate(()=>window.list.viewport.scrollToKey('item-999',{block:'end',behavior:'instant'}));
   await page.waitForFunction(()=>{const last=document.querySelector('[data-en-virtual-key="item-999"]');return last&&last.getBoundingClientRect().bottom<=document.querySelector('.dock-stack').getBoundingClientRect().top+1&&last.getBoundingClientRect().top>0;});
   assert.match(await page.evaluate(()=>document.activeElement.textContent),/Item 0/);await bounded();
   await page.keyboard.press('Tab');assert.match(await page.evaluate(()=>document.activeElement.textContent),/Item 1/);
   await frame();
   const focused=await page.evaluate(()=>({row:document.activeElement.getBoundingClientRect().toJSON(),header:document.querySelector('.masthead').getBoundingClientRect().bottom,dock:document.querySelector('.dock-stack').getBoundingClientRect().top}));
   assert.ok(focused.row.top>=focused.header-1,JSON.stringify(focused));assert.ok(focused.row.bottom<=focused.dock+1,JSON.stringify(focused));
  });
  await t.test('row height and heading changes preserve the visible record',async()=>{
   await reset();await page.evaluate(()=>window.list.viewport.scrollToKey('item-500',{block:'start',behavior:'instant'}));
   await page.waitForFunction(()=>{const row=document.querySelector('[data-en-virtual-key="item-500"]');return row&&Math.abs(row.getBoundingClientRect().top-104)<2;});
   await page.waitForTimeout(200);
   // Put the visible start inside this row, beyond fractional scroll rounding at its edge.
   await page.evaluate(()=>window.scrollBy(0,2));await frame();
   const before=await page.locator('[data-en-virtual-key="item-500"]').boundingBox();
   await page.evaluate(()=>{document.querySelector('h1').style.paddingBottom='80px';document.querySelector('[data-en-virtual-key="item-499"]').style.height='400px';});await frame();await frame();
   const after=await page.locator('[data-en-virtual-key="item-500"]').boundingBox();assert.ok(Math.abs(after.y-before.y)<2,JSON.stringify({before,after}));await bounded();
  });
  await t.test('a taller toolbar and smooth reveal keep the target clear of sticky content',async()=>{
   await reset();await page.evaluate(()=>{document.querySelector('.dock-stack').style.paddingTop='140px';});await frame();
   await page.evaluate(()=>window.list.viewport.scrollToKey('item-999',{block:'end',behavior:'smooth'}));
   await page.waitForFunction(()=>{const row=document.querySelector('[data-en-virtual-key="item-999"]');return row&&Math.abs(row.getBoundingClientRect().bottom-document.querySelector('.dock-stack').getBoundingClientRect().top)<2;});
   await bounded();await visibleLast();
   await page.evaluate(()=>document.querySelector('.dock-stack').style.removeProperty('padding-top'));
  });
  await t.test('removing a focused item recovers focus to the list region',async()=>{
   await reset();await page.getByRole('link',{name:/^1 Item 0 /}).focus();
   await page.evaluate(async()=>{window.fixture.items=window.items.slice(1);window.fixture.requestUpdate();await window.fixture.updateComplete;});await frame();
   assert.equal(await page.evaluate(()=>document.activeElement.className),'all-list-viewport');await bounded();
  });
  await t.test('switching to a short list and disconnecting restores root anchoring',async()=>{
   await reset();await page.evaluate(async()=>{window.fixture.items=window.items.slice(0,12);window.fixture.requestUpdate();await window.fixture.updateComplete;});await frame();
   assert.equal(await page.locator('.all-list-rows > li').count(),12);assert.equal(await page.evaluate(()=>document.documentElement.style.overflowAnchor),'');
   await reset();assert.equal(await page.evaluate(()=>document.documentElement.style.overflowAnchor),'none');
   await page.evaluate(()=>window.fixture.remove());await frame();assert.equal(await page.evaluate(()=>document.documentElement.style.overflowAnchor),'');
  });
  await t.test('the shared controller still supports an element scrollport',async()=>{
   await page.evaluate(async()=>{
    const {LitElement,html}=await import('/node_modules/lit/index.js');
    const {VirtualCollection}=await import('/src/still/vendor/primitives/state/virtual-collection.js');
    const {VirtualCollectionController}=await import('/src/still/vendor/primitives/interactions/virtual-collection.js');
    const {virtualListRows}=await import('/src/still/vendor/primitives/templates/virtual-collection.js');
    class ElementList extends LitElement{
     rows=new VirtualCollection({items:window.items,key:row=>row.id,estimateSize:50,overscan:3});
     controller=new VirtualCollectionController(this,this.rows,{viewport:()=>this.querySelector('section'),content:()=>this.querySelector('ul')});
     createRenderRoot(){return this;}
     render(){return html`<section style="height:400px;overflow:auto"><ul style="margin:0;padding:0;list-style:none">${virtualListRows(this.rows,{renderItem:row=>html`<a style="display:block;height:50px" href="#">${row.id}</a>`})}</ul></section>`;}
    }
    customElements.define('element-list',ElementList);window.elementList=new ElementList();document.body.append(window.elementList);await window.elementList.updateComplete;
   });
   await frame();await page.evaluate(()=>window.elementList.controller.scrollToKey('item-999',{block:'end',behavior:'instant'}));
   await page.waitForFunction(()=>{const row=document.querySelector('[data-en-virtual-key="item-999"]');return row&&row.getBoundingClientRect().bottom<=400;});
   assert.equal(await page.evaluate(()=>scrollY),0);assert.ok(await page.locator('[data-en-virtual-key]').count()<30);
   assert.ok(await page.locator('section').evaluate(el=>el.scrollTop)>1000);
  });
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await server.close();}
});
