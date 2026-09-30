import test from 'node:test';
import assert from 'node:assert/strict';
import {toolbarBrowsers,mountToolbarFixture,fixtureServer,fixtureURL,ready} from './helpers/still-toolbar.mjs';

for(const [name,engine] of toolbarBrowsers)test(`${name}: loading and live toolbar share their geometry`,async t=>{
 const server=await fixtureServer();let browser;
 try{
  browser=await engine.launch({headless:true});
  await t.test('mobile loading is circular',async()=>{
   const page=await browser.newPage({viewport:{width:390,height:844}});
   try{
    await mountToolbarFixture(page,fixtureURL(server));
    await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
    const box=await page.locator('.toolbar-motion-visual [data-state="loading"]').boundingBox();
    assert.ok(Math.abs(box.width-box.height)<.5,`loading must be circular: ${JSON.stringify(box)}`);
    await ready(page);
    await page.evaluate(()=>window.app.navigate('document'));
    await page.waitForFunction(()=>document.querySelector('.toolbar-motion-root')?.dataset.toolbarPhase==='loading');
    const returning=await page.locator('.toolbar-motion-visual [data-state="loading"]').boundingBox();
    assert.ok(Math.abs(returning.width-returning.height)<.5,`returned loading must be circular: ${JSON.stringify(returning)}`);
   }finally{await page.close();}
  });
  for(const width of [390,844])await t.test(`opening handoff has one painted toolbar and aligned bounds at ${width}px`,async()=>{
   const page=await browser.newPage({viewport:{width,height:844}});page.setDefaultTimeout(10000);
   try{
    await page.addInitScript(()=>{
     window.toolbarGeometry=[];
     const rect=node=>{const r=node?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null;};
     const sample=()=>{
      const root=document.querySelector('.toolbar-motion-root');
      const live=root?.querySelector('.toolbar-motion-live');
      const base=live?.querySelector('en-toolbar')?.shadowRoot?.querySelector('[part=base]');
      const shell=root?.querySelector('.toolbar-motion-shell');
      if(root&&base&&shell)window.toolbarGeometry.push({phase:root.dataset.toolbarPhase,livePainted:getComputedStyle(live).opacity!=='0',interactive:!live.inert,live:rect(base),shell:rect(shell),liveButtons:[...base.parentNode.host.querySelectorAll('en-button')].map(rect),snapshotButtons:[...shell.querySelectorAll('.toolbar-snapshot en-button')].map(rect)});
      requestAnimationFrame(sample);
     };requestAnimationFrame(sample);
    });
    await mountToolbarFixture(page,fixtureURL(server));await ready(page);
    const frames=await page.evaluate(()=>window.toolbarGeometry.filter(frame=>frame.phase==='opening'));
    assert.ok(frames.length>2,'sample the real opening frames');
    const handoff=frames.filter(frame=>frame.interactive);
    assert.ok(handoff.length>0,'observe the interactive end of construction');
    for(const frame of handoff){
     assert.ok(!frame.livePainted,`only the animation should paint until it is retired: ${JSON.stringify(frame)}`);
     for(const key of ['x','y','width','height'])assert.ok(Math.abs(frame.shell[key]-frame.live[key])<1,`${key} handoff mismatch: ${JSON.stringify(frame)}`);
     assert.equal(frame.snapshotButtons.length,frame.liveButtons.length);
     for(let i=0;i<frame.liveButtons.length;i++)for(const key of ['x','y','width','height'])assert.ok(Math.abs(frame.snapshotButtons[i][key]-frame.liveButtons[i][key])<1,`button ${i} ${key} handoff mismatch: ${JSON.stringify(frame)}`);
    }
    const final=await page.locator('.toolbar-motion-live en-toolbar').evaluate(node=>{const r=node.shadowRoot.querySelector('[part=base]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
    const last=frames.at(-1).shell;
    for(const key of ['x','y','width','height'])assert.ok(Math.abs(last[key]-final[key])<1,`${key} jumped at reveal: ${JSON.stringify({last,final})}`);
    assert.equal(await page.locator('.toolbar-motion-live').evaluate(node=>getComputedStyle(node).opacity),'1');
    assert.equal(await page.locator('.toolbar-motion-visual').evaluate(node=>node.childElementCount),0);
   }finally{await page.close();}
  });
 }finally{await browser?.close();await server.close();}
});
