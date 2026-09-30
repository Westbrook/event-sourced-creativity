import test from 'node:test';
import assert from 'node:assert/strict';
import {toolbarBrowsers,mountToolbarFixture,fixtureServer,fixtureURL,ready} from './helpers/still-toolbar.mjs';

// Desktop Firefox's emulated tap emits pointer events without a click. Use its
// native mouse lane; Chromium and WebKit exercise retained touch focus.
const point=(locator,engine)=>engine==='firefox'?locator.click():locator.tap();

async function projectsFixture(page,url,engine){
 await mountToolbarFixture(page,url);await ready(page);
 await page.evaluate(()=>{
  const template=window.app.client.events.find(event=>event.type==='ProjectCreated');
  window.app.client.events=[...window.app.client.events,...Array.from({length:8},(_,i)=>({...template,eventId:`project-${i}`,sequence:i+4,payload:{project_id:`project-${i}`,name:`Fictional project ${i+2}`}}))];
  window.app.client.head=window.app.client.events.length;
  window.app.navigate('projects',{projectId:'',documentId:''});
 });await ready(page);
 await point(page.locator('.toolbar-motion-live').getByRole('button',{name:'Next page',exact:true}),engine);
 await page.waitForFunction(()=>window.app.page===1);await ready(page);
}

async function fits(page){
 await page.waitForFunction(()=>{
  const dock=document.querySelector('.action-dock');
  const toolbar=dock?.querySelector('en-toolbar');
  if(!toolbar)return false;
  const frame=toolbar.shadowRoot.querySelector('[part=base]').getBoundingClientRect();
  const buttons=[...toolbar.querySelectorAll('en-button')].map(node=>node.getBoundingClientRect());
  return frame.left>=0&&frame.right<=innerWidth+1&&buttons.every(box=>box.left>=frame.left-1&&box.right<=frame.right+1);
 },null,{timeout:2500});
}

for(const [name,engine] of toolbarBrowsers)test(`${name}: settled Projects toolbar reflows after orientation changes`,async t=>{
 const server=await fixtureServer();let browser;
 try{
  browser=await engine.launch({headless:true});
  for(const focus of [name==='firefox'?'mouse':'touch','none','keyboard'])await t.test(`landscape four-button toolbar to portrait and back (${focus})`,async()=>{
   const page=await browser.newPage({viewport:{width:844,height:390},hasTouch:true});page.setDefaultTimeout(10000);
   try{
    await projectsFixture(page,fixtureURL(server),name);
    const live=page.locator('.toolbar-motion-live');
    assert.equal(await live.getByRole('button').count(),4);
    if(focus==='none')await point(page.locator('main h1'),name);
    if(focus==='keyboard'){
     await point(page.locator('main h1'),name);
     for(let i=0;i<30;i++){
      await page.keyboard.press('Tab');
      if(await page.evaluate(()=>document.activeElement?.dataset.actionId==='ui:next-page'))break;
     }
     assert.equal(await page.evaluate(()=>document.activeElement?.dataset.actionId),'ui:next-page');
    }
    const before=await page.evaluate(()=>({requests:window.requests.length,page:window.app.page,focus:document.activeElement?.dataset.actionId}));
    if(focus!=='none')assert.equal(before.focus,'ui:next-page','rotation starts with retained paging focus');
    await page.setViewportSize({width:390,height:844});
    try{await fits(page);}catch(error){throw new Error(await page.evaluate(()=>JSON.stringify({fit:window.app.dockFit,active:document.activeElement?.outerHTML,limit:window.app.toolbarLimit})),{cause:error});}
    assert.equal(await page.locator('.toolbar-motion-root').getAttribute('data-toolbar-phase'),'ready');
    assert.equal(await page.evaluate(()=>window.app.page),before.page);
    assert.equal(await page.evaluate(()=>window.requests.length),before.requests,'rotation does not fetch new decisions');
    assert.ok(await live.getByRole('button').count()<4);
    if(focus!=='none'){
     const active=await page.evaluate(()=>({id:document.activeElement?.dataset.actionId,elementId:document.activeElement?.id}));
     assert.ok(active.id===before.focus||active.id==='ui:more'||active.elementId==='still-compact-menu',JSON.stringify(active));
    }
    await page.setViewportSize({width:844,height:390});await fits(page);
    await page.waitForFunction(()=>document.querySelectorAll('.action-dock en-toolbar > en-button').length===4);
   }finally{await page.close();}
  });
 }finally{await browser?.close();await server.close();}
});
