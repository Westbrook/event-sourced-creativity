import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium,expect} from '@playwright/test';
import {scenarios} from './fixtures.mjs';
const directory=process.argv[2]??`/private/tmp/forma-g-browser-${Date.now()}`;await mkdir(directory,{recursive:true});
const sourceHashes=Object.fromEntries(await Promise.all(['src/still/rejection-page.ts','src/still/rejection-evidence.ts','src/still/client.ts','tests/still-rejection-browser/fixtures.mjs','tests/still-rejection-browser/fixture.mjs'].map(async path=>[path,createHash('sha256').update(await readFile(new URL('../../'+path,import.meta.url))).digest('hex')])));
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];const blocked=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4211'?route.continue():(blocked.push(route.request().url()),route.abort()));
const url='http://127.0.0.1:4211/tests/still-rejection-browser/index.html?progress-report';
try{
 await page.goto(url);await expect(page.getByRole('heading',{name:'Inspect generation failure',exact:true})).toBeVisible();
 await expect(page.locator('.rejection-page')).toContainText('The provider reported an output moderation refusal.');
 await expect(page.getByRole('heading',{name:'Stage outcomes and operation identity',exact:true})).toBeVisible();
 for(const name of scenarios){
  await page.locator('#scenario').selectOption(name);await expect(page.locator('.rejection-lead')).toBeVisible();
  await expect(page.locator('.rejection-page')).toContainText('Corrective scope');
  if(name==='expired-evidence'){await expect(page.locator('.rejection-page')).toContainText('Frozen source snapshot: expired');await expect(page.locator('.rejection-page')).toContainText('Provider response envelope: not recorded');}
 }
 await page.locator('#scenario').selectOption('mixed-routes');await expect(page.locator('.rejection-page')).toContainText('fal / fal-ai/ideogram/v3');
 await page.locator('#comparison-attempt').fill('comparison');await page.locator('#comparison-attempt').press('Enter');
 await expect(page.locator('.rejection-page')).toContainText('Exact retained prompt: changed');
 await expect(page.locator('.rejection-page')).toContainText('Per-operation model, quality, route and recorded settings: changed');
 const disclosure=page.getByText('Exact retained prompt: changed',{exact:true});await disclosure.focus();await page.keyboard.press('Enter');
 await expect(disclosure.locator('..')).toHaveAttribute('open','');await expect(disclosure.locator('..')).toContainText('Blue palette');
 await page.setViewportSize({width:1360,height:1000});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${directory}/desktop.png`,fullPage:true});await page.screenshot({path:`${directory}/desktop-top.png`});
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow');
 await page.screenshot({path:`${directory}/mobile.png`,fullPage:true});await page.screenshot({path:`${directory}/mobile-top.png`});
 const before=await page.evaluate(()=>window.fixtureRequests.length);
 await page.locator('details[id]').first().evaluate(el=>el.open=true);
 await page.getByRole('link',{name:'Link to this immutable source'}).first().click();
 assert.equal(await page.evaluate(()=>window.fixtureRequests.length),before,'evidence link must not reconcile');
 // A comparison source permalink reloads only authorized retained evidence.
 const sourceLink=await page.locator('details[id]').filter({hasText:'Attempt comparison · source prompt.'}).locator('a').getAttribute('href');
 assert.ok(sourceLink.includes('compareAttempt=comparison'));await page.goto(sourceLink);
 await expect(page.getByRole('heading',{name:'Comparison immutable sources'})).toBeVisible();
 await page.goto(url);await expect(page.getByRole('heading',{name:'Stage outcomes and operation identity'})).toBeVisible();
 // A stale comparison must not survive a new scope.
 await page.locator('#comparison-attempt').fill('slow');await page.locator('#comparison-attempt').press('Enter');
 await expect.poll(()=>page.evaluate(()=>typeof window.releaseSlow)).toBe('function');
 await page.locator('#scenario').selectOption('expired-evidence');await page.evaluate(()=>window.releaseSlow());
 await expect(page.locator('.rejection-page')).toContainText('Frozen source snapshot: expired');
 await expect(page.getByRole('heading',{name:'Comparison immutable sources'})).toHaveCount(0);
 // An authorization failure clears both original and comparison private data.
 await page.locator('#comparison-attempt').fill('denied');await page.locator('#comparison-attempt').press('Enter');
 await expect(page.locator('.rejection-page')).toContainText('Your authorization changed');
 await expect(page.locator('pre')).toHaveCount(0);
 const requests=await page.evaluate(()=>window.fixtureRequests);assert.ok(requests.every(r=>r.method==='GET'));
 assert.ok(!requests.some(r=>/reconcile|\/run|recover/.test(r.path)));assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
 await writeFile(`${directory}/result.json`,JSON.stringify({syntheticOnly:true,sourceHashes,scenarios,desktop:true,mobileViewport:'390x844',keyboardDisclosureAndComparison:true,navigationRace:true,authorizationRevocation:true,providerCalls:0,requests,errors,blocked},null,2));
 console.log(`Browser verification passed: ${directory}`);
}finally{await browser.close();}
