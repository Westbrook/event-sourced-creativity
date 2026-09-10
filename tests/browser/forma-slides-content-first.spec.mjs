import { test, expect } from "@playwright/test";

// Reuses the real document viewer and authored responsive fixture. Synthetic
// principal/read responses: this is keyboard/rendering proof, not production
// authorization, financial, provider, or assistive-technology acceptance.
test("ordinary Slides opening owns stable content focus and native evidence disclosure", async ({ page }, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === "http://127.0.0.1:4186" ? route.continue() : route.abort();
  });
  await page.goto("http://127.0.0.1:4186/tests/presentation-responsive.fixture.html?isolated=document");
  const card = page.getByRole("button", { name: /Shared protected presentation Slides/ });
  await card.click();
  const dialog = page.getByRole("dialog", { name: "Shared protected presentation", exact: true });
  const stage = dialog.locator(".presentation-deck-stage");
  await expect(stage).toBeFocused();
  expect(await stage.getAttribute("autofocus")).toBeNull();
  // No locator.focus()/locator.press(): every key uses the browser's active element.
  await expect(dialog.locator(".presentation-deck > .sr-only[role=status]")).toContainText("Slide 1 of 2");
  for (const [key, slide] of [["ArrowRight", 2], ["ArrowLeft", 1], ["End", 2], ["Home", 1]]) {
    await page.keyboard.press(key);
    await expect(dialog.locator(".presentation-deck > .sr-only[role=status]")).toContainText(`Slide ${slide} of 2`);
    await expect(stage).toBeFocused();
    expect(await stage.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  }
  const evidence = dialog.getByRole("button", { name: "Review production evidence", exact: true });
  const more = dialog.getByRole("button", { name: "More actions", exact: true });
  const rects = await Promise.all([evidence.boundingBox(), more.boundingBox()]);
  expect(rects.every(rect => rect && rect.height >= 44)).toBe(true);
  expect(Math.abs(rects[0].height - rects[1].height)).toBeLessThanOrEqual(1);
  const stageMetrics = await stage.evaluate(element => ({rect:element.getBoundingClientRect().toJSON(),
    outline:getComputedStyle(element).outline,offset:getComputedStyle(element).outlineOffset,dpr:devicePixelRatio}));
  expect(parseFloat(stageMetrics.offset)).toBeLessThan(0);
  await page.screenshot({path:testInfo.outputPath("slides-content-focus.png"),scale:"device"});
  await testInfo.attach("stage-focus-geometry", {contentType:"application/json",body:JSON.stringify(stageMetrics)});
  for (let step = 0; step < 16 && !(await evidence.evaluate(element => element === document.activeElement)); step++) {
    await page.keyboard.press("Tab");
  }
  await expect(evidence).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = dialog.locator(".artifact-viewer-evidence-popover [popover]");
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element => element.matches(":popover-open"))).toBe(true);
  expect(await evidence.getAttribute("popovertarget")).toBe(await panel.getAttribute("id"));
  const box = await panel.boundingBox(), viewport = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(evidence).toBeFocused();
  await expect(dialog).toBeVisible();
  const measured = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
    visualScale: visualViewport.scale, scrollWidth: document.documentElement.scrollWidth }));
  const png = await page.screenshot({ path: testInfo.outputPath("slides-footer-focus.png"), scale: "device" });
  const encoded = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
  expect(encoded.width).toBe(Math.round(measured.width * measured.dpr));
  expect(encoded.height).toBe(Math.round(measured.height * measured.dpr));
  await testInfo.attach("measured-capture-geometry", { contentType: "application/json", body: JSON.stringify({ measured, encoded, outputScale: 1 }) });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(card).toBeFocused();
  expect(await card.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  // Choose List through existing controls and reopen: ordinary opening must not
  // silently reset the reader's remembered posture to Slideshow.
  await page.keyboard.press("Enter");
  await expect(stage).toBeFocused();
  const list = dialog.getByRole("button", { name: "List", exact: true });
  if (!(await list.isVisible())) await dialog.getByRole("button", {name:"Slideshow controls",exact:true}).click();
  await list.click();
  await dialog.getByRole("button",{name:"Close",exact:true}).click();
  await expect(card).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("button",{name:"Present slide 1",exact:true})).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(stage).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(stage).toBeFocused();
  await expect(dialog.locator(".presentation-deck > .sr-only[role=status]")).toContainText("Slide 2 of 2");
  const observations = await page.evaluate(() => globalThis.formaIsolatedPresentation.snapshot());
  expect(observations.forbidden).toEqual([]);
  expect(errors).toEqual([]);
});
