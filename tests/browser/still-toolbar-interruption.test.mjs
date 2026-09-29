import test from 'node:test';
import assert from 'node:assert/strict';
import {toolbarBrowsers,mountToolbarFixture,fixtureServer,fixtureURL,ready,activePhase} from './helpers/still-toolbar.mjs';

for(const [name,engine] of toolbarBrowsers)test(`${name}: toolbar interruptions settle to current native controls`,async t=>{
 const server=await fixtureServer();let browser;
 try{
  browser=await engine.launch({headless:true});
  const check=async(label,exercise)=>t.test(label,async()=>{
   const page=await browser.newPage({viewport:{width:1100,height:800}});page.setDefaultTimeout(10000);
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   try{
    await mountToolbarFixture(page,fixtureURL(server));
    await exercise(page);
    await ready(page);
    assert.equal(await page.locator('.toolbar-motion-live').evaluate(node=>node.inert),false);
    assert.equal(await page.locator('.toolbar-motion-visual').evaluate(node=>node.childElementCount),0);
    assert.equal(await page.locator('.toolbar-motion-root').evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
    assert.deepEqual(errors,[]);
   }finally{await page.close();}
  });
  await check('navigation during opening retires the old destination',async page=>{
   await activePhase(page,'opening');
   await page.evaluate(()=>window.app.navigate('projects',{projectId:'',documentId:''}));
   await ready(page);
   assert.equal(await page.evaluate(()=>window.app.client.position.view),'projects');
   assert.equal(await page.getByRole('button',{name:'New project',exact:true}).count(),1);
  });
  await check('navigation during More paging supersedes its continuation',async page=>{
   await ready(page);await page.getByRole('button',{name:'More actions',exact:true}).click();
   await activePhase(page,'paging');
   await page.evaluate(()=>window.app.navigate('projects',{projectId:'',documentId:''}));
   await ready(page);
   assert.equal(await page.evaluate(()=>window.app.moreOpen),false);
   assert.equal(await page.evaluate(()=>window.app.client.position.view),'projects');
  });
  for(const phase of ['opening','paging'])await check(`resize during ${phase} releases a responsive toolbar`,async page=>{
   if(phase==='paging'){await ready(page);await page.getByRole('button',{name:'More actions',exact:true}).click();}
   await activePhase(page,phase);await page.setViewportSize({width:390,height:844});await ready(page);
   const box=await page.locator('.toolbar-motion-live en-toolbar').boundingBox();
   assert.ok(box.x>=0&&box.x+box.width<=391,JSON.stringify(box));
   assert.ok(await page.getByRole('button').count()>0);
  });
  for(const phase of ['opening','paging'])await check(`reduced motion enabled during ${phase} settles without a stuck inert toolbar`,async page=>{
   if(phase==='paging'){await ready(page);await page.getByRole('button',{name:'More actions',exact:true}).click();}
   await activePhase(page,phase);await page.emulateMedia({reducedMotion:'reduce'});await ready(page);
   assert.equal(await page.evaluate(()=>window.app.moreOpen),phase==='paging');
  });
  await check('disconnect during opening and reconnect restarts the lifecycle',async page=>{
   await activePhase(page,'opening');await page.evaluate(()=>window.app.remove());
   // Wait for cancellation cleanup to finish before reattaching the same owner.
   await page.waitForFunction(()=>!window.app.getAnimations({subtree:true}).some(a=>a.playState==='running'));
   await page.evaluate(()=>document.body.append(window.app));await ready(page);
   assert.equal(await page.locator('main h1').textContent(),'Observatory');
   assert.equal(await page.getByRole('group',{name:'Your next step'}).count(),1);
  });
  await check('native controls stay inert during construction; keyboard focus returns once',async page=>{
   const assertInert=async()=>{
    const state=await page.locator('.toolbar-motion-live').evaluate(node=>{node.querySelector('en-button')?.focus();return {inert:node.inert,focused:node.contains(document.activeElement)};});
    assert.deepEqual(state,{inert:true,focused:false});
    assert.equal(await page.locator('.toolbar-motion-visual').getByRole('button').count(),0);
    if(name==='chromium'){
     const cdp=await page.context().newCDPSession(page);
     try{
      const {root}=await cdp.send('DOM.getDocument');
      const {nodeId}=await cdp.send('DOM.querySelector',{nodeId:root.nodeId,selector:'.toolbar-motion-live'});
      const {nodes}=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});
      assert.ok(nodes.length>0&&nodes.every(node=>node.ignored),'native AX tree ignores inert live controls');
     }finally{await cdp.detach();}
    }
   };
   await activePhase(page,'opening');
   await assertInert();
   assert.equal(await page.locator('.toolbar-motion-status').getAttribute('aria-live'),'polite');
   await ready(page);
   const more=page.getByRole('button',{name:'More actions',exact:true});await more.focus();await page.keyboard.press('Enter');
   await activePhase(page,'paging');
   await assertInert();
   await ready(page);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.actionId),'ui:back');
   await page.keyboard.press('Enter');await ready(page);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.actionId),'ui:more');
   assert.equal(await page.locator('.toolbar-motion-status').textContent(),'Actions available.');
  });
 }finally{await browser?.close();await server.close();}
});
