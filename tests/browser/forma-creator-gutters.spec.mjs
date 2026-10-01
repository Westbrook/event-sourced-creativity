import {test, expect} from '@playwright/test';
import {installSyntheticNetwork} from './helpers/synthetic-network.mjs';

// Actual Shell/Store/pages with finite fictional responses. No backend writes,
// account admission, provider calls or production acceptance are exercised.
const pages = [
  {name:'Library', route:'/library?document=doc-atmosphere', body:'.library-toolbar', main:'.library-main'},
  {name:'Projects', route:'/projects', body:'.projects-grid', main:'.projects-page'},
  {name:'Project overview', route:'/studio/project', body:'.project-contents-toolbar', main:'.studio-main'},
  {name:'Document', route:'/document/doc-atmosphere/atmosphere-studies', body:'#context-title', main:'.studio-main'},
];
const viewports = [[320,800],[360,800],[681,991],[767,991],[768,991],[1024,991],[1280,991],[1600,991],[844,390]];
for (const target of pages) test(target.name + ' shares the Creator leading gutter', async ({page, context, baseURL}, testInfo) => {
  await installSyntheticNetwork(context, baseURL);
  await page.setViewportSize({width:1280,height:900});
  await page.goto(target.route, {waitUntil:'domcontentloaded'});
  await expect(page.locator(target.body)).toBeVisible();
  const observations=[];
  const measure=()=>page.evaluate(target=>{
    const rtl=document.documentElement.dir==='rtl', edge=r=>rtl?r.right:r.left;
    const point=selector=>{
      const element=[...document.querySelectorAll(selector)].find(e=>e.getClientRects().length);
      return element?edge(element.getBoundingClientRect()):null;
    };
    const text=selector=>{
      const element=document.querySelector(selector);
      if(!element?.getClientRects().length)return null;
      const node=[...element.childNodes].find(n=>n.nodeType===3&&n.textContent.trim());
      const range=document.createRange();range.selectNodeContents(node);return edge(range.getBoundingClientRect());
    };
    return {width:innerWidth,height:innerHeight,rtl,posture:document.querySelector('.application-creative').dataset.navPosture,
      main:point(target.main),title:point('h1'),body:point(target.body),logo:point('.brand-mark'),project:point('.rail-toolbar-monogram'),
      memory:point('.resource-memory > button'),family:text('.studio-mode-family'),task:text('.document-workbench-tasks > button'),
      overflow:document.documentElement.scrollWidth-innerWidth};
  },target);
  for(const [width,height] of viewports) {
    await page.setViewportSize({width,height});
    const inset=Math.max(16,Math.min(width*.016,20));
    const signed=number=>testInfo.project.use.locale==='ar'?-number:number;
    // Wait on actual responsive posture/layout, rather than an arbitrary delay.
    await expect.poll(async()=>{
      const result=await measure();return Math.abs(signed(result.body-result.main)-inset);
    }).toBeLessThan(1);
    await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)).length)).toBe(0);
    const result=await measure();
    expect(result.rtl).toBe(testInfo.project.use.locale==='ar');
    expect(result.overflow).toBeLessThanOrEqual(0);
    const titleOffset=target.name==='Document'&&height<600?50:0;
    expect(Math.abs(signed(result.title-result.body)-titleOffset)).toBeLessThan(1);
    for(const key of ['memory','family','task'])if(result[key]!==null)expect(Math.abs(result[key]-result.body),key).toBeLessThan(1);
    if(result.posture==='compact')expect(Math.abs(result.logo-result.body)).toBeLessThan(1);
    if(result.project!==null)expect(Math.abs(result.logo-result.project)).toBeLessThan(1);
    observations.push(result);
    if(target.name==='Library'&&[360,1280].includes(width))await page.screenshot({path:testInfo.outputPath(`library-${width}.png`)});
  }
  if(target.name==='Library') {
    await page.setViewportSize({width:360,height:800});
    await page.locator('.brand').focus();
    const button=page.locator('.resource-memory > button');
    for(let step=0;step<80&&!await button.evaluate(e=>e===document.activeElement);step++)await page.keyboard.press('Tab');
    await expect(button).toBeFocused();
    expect(await button.evaluate(e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none')).toBe(true);
    const bounds=await button.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(360);
    await page.keyboard.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded','true');
    const panel=page.locator('.resource-memory-panel');await expect(panel).toBeVisible();
    // Compact Library reserves a trailing navigation rail; compare its content
    // column, not the full viewport. Both panel edges must match search.
    const panelBounds=await panel.boundingBox(), searchBounds=await page.locator(target.body).boundingBox();
    expect(panelBounds.x).toBeCloseTo(searchBounds.x,0);
    expect(panelBounds.x+panelBounds.width).toBeCloseTo(searchBounds.x+searchBounds.width,0);
    await page.keyboard.press('Enter');await expect(button).toHaveAttribute('aria-expanded','false');
  }
  await testInfo.attach('leading-edges',{contentType:'application/json',body:JSON.stringify({observations,
    scope:'Fictional renderer/geometry and Library keyboard disclosure; no real-account or provider acceptance.'})});
});
