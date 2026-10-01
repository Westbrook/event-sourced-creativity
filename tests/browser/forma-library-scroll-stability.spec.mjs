import {test, expect} from '@playwright/test';
import {installSyntheticNetwork} from './helpers/synthetic-network.mjs';

// Real Library and assistant renderer with finite fictional responses. Scrolling,
// focus and opening/closing guidance do not submit a request or write account data.
for(const touch of [false,true]) test.describe(touch?'touch':'pointer',()=>{
  test.use({hasTouch:touch});
  for(const width of [320,360,390,664,681,767,768,1024,1280,1715,2048]) test(`Library width survives scroll at ${width}`,async({page,context,baseURL},testInfo)=>{
    await installSyntheticNetwork(context,baseURL);
    await page.setViewportSize({width,height:925});
    await page.goto('/library?document=doc-atmosphere',{waitUntil:'domcontentloaded'});
    await expect(page.locator('.library-output').first()).toBeVisible();
    const launcher=page.locator('.forma-assistant-launcher');
    await expect(page.locator('forma-assistant-panel')).toHaveAttribute('data-browse-launcher','true');
    const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const measure=()=>page.evaluate(()=>{
      const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
      return {scroll:scrollY,padding:getComputedStyle(document.querySelector('#main-content')).paddingInlineEnd,
        body:rect('.library-body'),header:rect('.page-header--library'),card:rect('.library-output'),
        nav:rect('.application-task-navigation'),topbar:rect('.topbar'),button:rect('.forma-assistant-launcher'),
        navPosition:getComputedStyle(document.querySelector('.application-task-navigation')).position,
        main:rect('#main-content'),viewportHeight:innerHeight,
        headerPosition:getComputedStyle(document.querySelector('.page-header--library')).position,
        overflow:document.documentElement.scrollWidth-innerWidth,lane:document.querySelector('forma-assistant-panel').dataset.browseLane};
    });
    // Initial responsive rail transitions finish before establishing the scroll baseline.
    await frame();
    await expect.poll(()=>page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime)).length)).toBe(0);
    const initial=await measure(),observations=[initial];
    expect(initial.padding).toBe('0px');
    const verify=sample=>{
      for(const key of ['body','header','card'])for(const dimension of ['x','width'])expect(sample[key][dimension],`${key}.${dimension}`).toBeCloseTo(initial[key][dimension],1);
      expect(sample.padding).toBe('0px');expect(sample.lane).toBeUndefined();expect(sample.overflow).toBeLessThanOrEqual(0);
      expect(sample.button.width).toBeGreaterThanOrEqual(touch?48:44);expect(sample.button.height).toBeGreaterThanOrEqual(touch?48:44);
      expect(sample.button.left).toBeGreaterThanOrEqual(sample.nav.left);expect(sample.button.right).toBeLessThanOrEqual(sample.nav.right);
      expect(sample.button.top).toBeGreaterThanOrEqual(Math.max(0,sample.nav.top,sample.topbar.bottom));
      expect(sample.button.bottom).toBeLessThanOrEqual(sample.nav.bottom);
      if(width<768){
        expect(sample.navPosition).toBe('fixed');expect(sample.nav.bottom).toBeCloseTo(sample.viewportHeight,1);
        expect(sample.main.width).toBeCloseTo(width,1);
      }else if(sample.headerPosition==='sticky')expect(sample.header.top).toBeGreaterThanOrEqual(sample.nav.bottom);
    };
    verify(initial);
    await page.mouse.move(width/2,700);
    for(const delta of [25,75,250,700,-400,-650]){
      const expected=await page.evaluate(delta=>Math.max(0,Math.min(scrollY+delta,document.documentElement.scrollHeight-innerHeight)),delta);
      await page.mouse.wheel(0,delta);await expect.poll(()=>page.evaluate(()=>scrollY)).toBe(expected);await frame();
      const sample=await measure();verify(sample);observations.push(sample);
    }
    // A known native link anchors traversal; the launcher's DOM identity and
    // accessible name stay intact when focus reaches it after the page content.
    await page.locator('.application-task-navigation a').first().focus();
    for(let step=0;step<160&&!await launcher.evaluate(e=>e===document.activeElement);step++)await page.keyboard.press('Tab');
    await expect(launcher).toBeFocused();
    expect(await launcher.evaluate(e=>e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none')).toBe(true);
    await page.keyboard.press('Enter');await expect(page.locator('.forma-assistant-panel[role="dialog"]')).toBeVisible();
    const open=await page.locator('.library-body').boundingBox();expect(open.x).toBeCloseTo(initial.body.x,1);expect(open.width).toBeCloseTo(initial.body.width,1);
    await page.keyboard.press('Escape');await expect(launcher).toBeFocused();await frame();verify(await measure());
    if([360,664,1715].includes(width)&&!touch)await page.screenshot({path:testInfo.outputPath('library-stable-navigation.png')});
    await testInfo.attach('scroll-widths',{contentType:'application/json',body:JSON.stringify({locale:testInfo.project.use.locale,touch,observations,scope:'Fictional renderer and native scroll/focus; no production or provider acceptance.'})});
  });
});
