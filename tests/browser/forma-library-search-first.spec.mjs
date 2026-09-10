import { test, expect } from "@playwright/test";

// Reuses the same finite source and real Store/Library, never production records.
// Layout/discovery only: no claim about real role admission or routed arrival.
test("Library search puts matching content before next-action suggestions", async ({ page }, testInfo) => {
  const errors=[]; page.on("pageerror",error=>errors.push(String(error)));
  await page.route("**/*",route=>new URL(route.request().url()).origin==="http://127.0.0.1:4186"?route.continue():route.abort());
  await page.goto("http://127.0.0.1:4186/tests/presentation-responsive.fixture.html?isolated=library");
  const library=page.locator("forma-library"), query=page.getByRole("searchbox",{name:"Search project library"});
  await expect(query).toBeVisible();
  const links=()=>library.locator(".library-content a[href]").evaluateAll(nodes=>nodes.map(node=>node.getAttribute("href")));
  const before=await links();
  await query.fill("approved-research");
  const block=library.locator('a[href*="/library/block/approved-source"]');
  await expect(block).toHaveCount(1);
  const position=await block.boundingBox(), viewport=page.viewportSize();
  expect(position.y).toBeGreaterThanOrEqual(0);
  expect(position.y+position.height).toBeLessThanOrEqual(viewport.height);
  expect(await block.getAttribute("href")).toContain("document=11111111-1111-4111-8111-111111111111");
  const order=await library.evaluate(owner=>{
    const content=owner.querySelector(".library-content"), next=owner.querySelector(".lifecycle-next-actions");
    return {nextPresent:!!next,contentBeforeNext:!!next&&!!(content.compareDocumentPosition(next)&Node.DOCUMENT_POSITION_FOLLOWING)};
  });
  expect(order.nextPresent).toBe(true);
  expect(order.contentBeforeNext).toBe(true);
  const dpr=await page.evaluate(()=>devicePixelRatio);
  const png=await page.screenshot({path:testInfo.outputPath("library-search.png"),scale:"device"});
  expect(png.readUInt32BE(16)).toBe(Math.round(viewport.width*dpr));
  expect(png.readUInt32BE(20)).toBe(Math.round(viewport.height*dpr));
  await testInfo.attach("search-reach-geometry",{contentType:"application/json",body:JSON.stringify({position,viewport,order,
    dpr,encoded:{width:png.readUInt32BE(16),height:png.readUInt32BE(20)},outputScale:1,scope:"synthetic current layout; query input only; no routed arrival or provider activity"})});
  await query.fill("approved");
  const output=library.locator('a[href*="/library/artifact/responsive-shared-artifact"]');
  await expect(output).toHaveCount(1);
  expect(await library.evaluate(owner=>{
    const block=owner.querySelector('a[href*="/library/block/approved-source"]');
    const output=owner.querySelector('a[href*="/library/artifact/responsive-shared-artifact"]');
    return !!block&&!!output&&!!(block.compareDocumentPosition(output)&Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await query.fill("");
  expect(await links()).toEqual(before);
  expect((await page.evaluate(()=>globalThis.formaIsolatedPresentation.snapshot())).forbidden).toEqual([]);
  expect(errors).toEqual([]);
});

test("Library history stays in its slot across empty Kept and Recent", async ({ page }, testInfo) => {
  const errors=[]; page.on("pageerror",error=>errors.push(String(error)));
  await page.route("**/*",route=>new URL(route.request().url()).origin==="http://127.0.0.1:4186"?route.continue():route.abort());
  await page.goto("http://127.0.0.1:4186/tests/presentation-responsive.fixture.html?isolated=library");
  const kept=page.getByRole("button",{name:"Kept 0",exact:true});
  const recent=page.getByRole("button",{name:"Recent 1",exact:true});
  await expect(recent).toHaveAttribute("aria-pressed","true");
  await kept.scrollIntoViewIfNeeded();
  const history=await kept.evaluateHandle(button=>button.closest("forma-ui-segmented-control"));
  const before=await kept.boundingBox();
  await kept.click();
  await expect(kept).toHaveAttribute("aria-pressed","true");
  await expect(page.getByRole("heading",{name:"No kept outputs match",exact:true})).toBeVisible();
  expect(await kept.evaluate((button,original)=>button.closest("forma-ui-segmented-control")===original,history)).toBe(true);
  await expect(kept).toBeFocused();
  const empty=await kept.boundingBox();
  expect(Math.abs(empty.y-before.y)).toBeLessThanOrEqual(1);
  await page.keyboard.press("Shift+Tab");
  await expect(recent).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(recent).toHaveAttribute("aria-pressed","true");
  await expect(recent).toBeFocused();
  expect(await recent.evaluate((button,original)=>button.closest("forma-ui-segmented-control")===original,history)).toBe(true);
  const restored=await kept.boundingBox();
  expect(Math.abs(restored.y-before.y)).toBeLessThanOrEqual(1);
  const snapshot=await page.evaluate(()=>globalThis.formaIsolatedPresentation.snapshot());
  expect(snapshot.forbidden).toEqual([]);
  expect(snapshot.custody.events.some(event=>event.type==="ObjectExported")).toBe(false);
  const dpr=await page.evaluate(()=>devicePixelRatio),viewport=page.viewportSize();
  const png=await page.screenshot({path:testInfo.outputPath("library-history-stable.png"),scale:"device"});
  expect(png.readUInt32BE(16)).toBe(Math.round(viewport.width*dpr));
  expect(png.readUInt32BE(20)).toBe(Math.round(viewport.height*dpr));
  await testInfo.attach("history-slot-geometry",{contentType:"application/json",body:JSON.stringify({before,empty,restored,viewport,dpr,
    scope:"real Library/Store with synthetic corpus; pointer Kept and keyboard Recent; not the original CUA export incident"})});
  expect(errors).toEqual([]);
  await history.dispose();
});
