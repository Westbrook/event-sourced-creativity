import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {toolbarBrowsers,mountToolbarFixture,fixtureServer,fixtureURL,ready,activePhase} from './helpers/still-toolbar.mjs';
import {applyBrowserZoom,browserMetrics} from './helpers/browser-zoom.mjs';

const extension=fileURLToPath(new URL('./zoom-extension',import.meta.url));
const includesChromium=toolbarBrowsers.some(([name])=>name==='chromium');

async function assertUsable(page){
 await ready(page);
 const live=page.locator('.toolbar-motion-live');
 assert.equal(await live.evaluate(node=>node.inert),false);
 assert.equal(await page.locator('.toolbar-motion-visual').evaluate(node=>node.childElementCount),0);
 const metrics=await browserMetrics(page);
 assert.ok(metrics.documentScrollWidth<=metrics.width+1,'no horizontal page overflow');
 const controls=live.getByRole('button');
 assert.ok(await controls.count()>0,'actions remain available');
 for(const node of [live.locator('en-toolbar'),...await controls.all()]){
  const box=await node.boundingBox();
  assert.ok(box&&box.width>0&&box.height>0&&box.x>=-1&&box.y>=-1&&box.x+box.width<=metrics.width+1&&box.y+box.height<=metrics.height+1,`toolbar/control stays inside zoomed viewport: ${JSON.stringify(box)} / ${JSON.stringify(metrics)}`);
 }
}

test('chromium: Still toolbar at true 200% browser zoom',{skip:!includesChromium},async t=>{
 const server=await fixtureServer();
 try{
  const check=async(label,width,exercise)=>t.test(label,async t=>{
   const profile=await mkdtemp(join(tmpdir(),'still-toolbar-zoom-'));let context;
   try{
    context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:null,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,`--window-size=${width},900`]});
    const page=context.pages()[0]??await context.newPage();page.setDefaultTimeout(10000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await mountToolbarFixture(page,fixtureURL(server));
    const zoom=()=>applyBrowserZoom(page,context,2,(_name,receipt)=>t.diagnostic(JSON.stringify(receipt)));
    await exercise(page,zoom);
    await assertUsable(page);
    assert.deepEqual(errors,[]);
   }finally{await context?.close();await rm(profile,{recursive:true,force:true});}
  });
  await check('zoomed More/Back and Find action retain native focus and page two',1280,async(page,zoom)=>{
   await ready(page);await zoom();await assertUsable(page);
   const live=page.locator('.toolbar-motion-live');
   await live.getByRole('button',{name:'More actions',exact:true}).focus();await page.keyboard.press('Enter');
   await assertUsable(page);assert.equal(await page.evaluate(()=>window.app.moreOpen),true);
   assert.equal(await page.evaluate(()=>document.activeElement?.dataset.actionId),'ui:back');
   await live.getByRole('button',{name:/^Find action/}).click();await page.getByRole('dialog').waitFor();
   await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.app.moreOpen),true);
   await live.getByRole('button',{name:'Back',exact:true}).focus();await page.keyboard.press('Enter');
   await assertUsable(page);assert.equal(await page.evaluate(()=>document.activeElement?.dataset.actionId),'ui:more');
  });
  await check('narrow zoomed actions and their overflow remain reachable',640,async(page,zoom)=>{
   await ready(page);await zoom();await assertUsable(page);
   await page.locator('.toolbar-motion-live').getByRole('button',{name:'More actions',exact:true}).click();
   // At this width the production toolbar uses its native overflow menu.
   await page.getByRole('menu').waitFor();
   assert.ok(await page.getByRole('menuitem').count()>0);
   await page.keyboard.press('Escape');
  });
  for(const phase of ['opening','paging'])await check(`zoom during ${phase} cancels snapshots and restores usable controls`,1280,async(page,zoom)=>{
   if(phase==='paging'){await ready(page);await page.getByRole('button',{name:'More actions',exact:true}).click();}
   await activePhase(page,phase);await zoom();await assertUsable(page);
   assert.equal(await page.evaluate(()=>window.app.moreOpen),phase==='paging');
   assert.equal(await page.locator('.toolbar-motion-root').evaluate(node=>node.getAnimations({subtree:true}).filter(a=>a.playState==='running').length),0);
  });
 }finally{await server.close();}
});
