import test from 'node:test';
import assert from 'node:assert/strict';
import {toolbarBrowsers,mountToolbarFixture,fixtureServer,fixtureURL,ready} from './helpers/still-toolbar.mjs';

async function focused(locator){
 return locator.evaluate(node=>node.matches(':focus-within'));
}

// Reach controls using real Tab events; never inject focus or scroll them into view.
async function tabTo(page,locator,key='Tab'){
 for(let step=0;step<40;step++){
  if(await focused(locator))return;
  await page.keyboard.press(key);
 }
 assert.fail(`Keyboard did not reach ${await locator.textContent()}`);
}

async function assertFocusVisible(locator){
 const state=await locator.evaluate(node=>{
  let active=document.activeElement;
  while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
  const style=getComputedStyle(active);
  return {within:node===active||node.shadowRoot?.contains(active),visible:active.matches(':focus-visible'),outline:parseFloat(style.outlineWidth)>0&&style.outlineStyle!=='none',shadow:style.boxShadow!=='none'};
 });
 assert.ok(state.within&&state.visible&&(state.outline||state.shadow),JSON.stringify(state));
}

for(const [name,engine] of toolbarBrowsers)test(`${name}: repeatable keyboard and reduced-motion toolbar journeys`,async t=>{
 const server=await fixtureServer();let browser;
 try{
  browser=await engine.launch({headless:true});
  for(const reducedMotion of ['no-preference','reduce'])await t.test(`Tab/Shift+Tab, More/Back and both Find action dismissal paths (${reducedMotion})`,async()=>{
   const page=await browser.newPage({viewport:{width:1100,height:800},reducedMotion});page.setDefaultTimeout(10000);
   const errors=[];page.on('pageerror',error=>errors.push(error.message));
   try{
    if(reducedMotion==='reduce')await page.addInitScript(()=>{
     window.toolbarAnimationFrames=[];
     const seen=new WeakSet();
     const sample=()=>{
      for(const animation of document.querySelector('.toolbar-motion-visual')?.getAnimations({subtree:true})??[]){
       if(seen.has(animation))continue;
       seen.add(animation);window.toolbarAnimationFrames.push({duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes()});
      }
      requestAnimationFrame(sample);
     };requestAnimationFrame(sample);
    });
    await mountToolbarFixture(page,fixtureURL(server));await ready(page);
    const live=page.locator('.toolbar-motion-live');
    const buttons=await live.getByRole('button').all();assert.ok(buttons.length>1);
    await tabTo(page,buttons[0]);
    for(let i=0;i<buttons.length;i++){
     assert.ok(await focused(buttons[i]),`forward Tab order at ${i}`);await assertFocusVisible(buttons[i]);
     if(i<buttons.length-1)await page.keyboard.press('Tab');
    }
    for(let i=buttons.length-2;i>=0;i--){await page.keyboard.press('Shift+Tab');assert.ok(await focused(buttons[i]),`reverse Tab order at ${i}`);}
    await tabTo(page,live.getByRole('button',{name:'More actions',exact:true}));await page.keyboard.press('Enter');await ready(page);
    const back=live.getByRole('button',{name:'Back',exact:true});assert.ok(await focused(back));await assertFocusVisible(back);
    const find=live.getByRole('button',{name:/^Find action/});
    const labelsBefore=await live.textContent();
    const requestsBefore=await page.evaluate(()=>window.requests.filter(request=>!request.body.palette).length);
    for(const dismissal of ['Escape','Close']){
     await tabTo(page,find);await page.keyboard.press('Enter');
     const dialog=page.getByRole('dialog');await dialog.waitFor();
     assert.ok(await focused(page.getByRole('combobox',{name:'Find an action',exact:true})));
     if(dismissal==='Escape')await page.keyboard.press('Escape');
     else{const close=dialog.getByRole('button',{name:/Close/});await tabTo(page,close,'Shift+Tab');await page.keyboard.press('Enter');}
     await dialog.waitFor({state:'hidden'});
     assert.ok(await focused(find),`${dismissal} returns focus to Find action`);
     assert.equal(await page.evaluate(()=>window.app.moreOpen),true);
     assert.equal(await live.textContent(),labelsBefore,'dialog dismissal preserves delivered toolbar actions');
     assert.equal(await page.locator('.toolbar-motion-root').getAttribute('data-toolbar-phase'),'ready');
     assert.equal(await page.evaluate(()=>window.requests.filter(request=>!request.body.palette).length),requestsBefore,'dismissal does not request replacement actions');
    }
    await tabTo(page,back,'Shift+Tab');await page.keyboard.press('Enter');await ready(page);
    assert.ok(await focused(live.getByRole('button',{name:'More actions',exact:true})));
    assert.equal(await live.evaluate(node=>node.inert),false);
    assert.equal(await page.locator('.toolbar-motion-visual').evaluate(node=>node.childElementCount),0);
    if(reducedMotion==='reduce'){
     const animations=await page.evaluate(()=>window.toolbarAnimationFrames);
     assert.ok(animations.length>0,'observe the actual reduced-motion transitions');
     for(const animation of animations){
      assert.ok(animation.duration<=120,`reduced duration: ${animation.duration}`);
      for(const frame of animation.frames)assert.ok(Object.keys(frame).every(key=>['offset','computedOffset','easing','composite','opacity'].includes(key)),`reduced motion only fades: ${JSON.stringify(frame)}`);
     }
    }
    assert.deepEqual(errors,[]);
   }finally{await page.close();}
  });
 }finally{await browser?.close();await server.close();}
});
