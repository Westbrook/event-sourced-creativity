import { test, expect } from "@playwright/test";

const origin = "http://127.0.0.1:4186";
test("Deliver visual previews stay within their own tiles and leave peers clear", async ({ page, context }, testInfo) => {
  const forbidden = [], errors = []; let blockedFonts = 0, blockedHmr = 0;
  page.on("pageerror", error => { if (errors.length < 3) errors.push(String(error)); });
  await context.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    if (url.origin === "ws://127.0.0.1:4186" && url.pathname === "/" && socket.protocols().includes("vite-hmr")) blockedHmr++;
    else forbidden.push({ transport: "websocket", origin: url.origin, path: url.pathname });
    return socket.close({ code: 1000, reason: "Finite renderer fixture" });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === "GET" && url.origin === "https://fonts.googleapis.com" && url.pathname === "/css2") {
      blockedFonts++; return route.abort("blockedbyclient");
    }
    if (request.method() === "GET" && url.origin === origin
      && ["/src/", "/tests/", "/node_modules/", "/@vite/", "/@fs/", "/@id/"].some(prefix => url.pathname.startsWith(prefix))
      && !["fetch", "xhr", "eventsource"].includes(request.resourceType())) return route.continue();
    forbidden.push({ method: request.method(), origin: url.origin, path: url.pathname, type: request.resourceType() });
    return route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/tests/presentation-responsive.fixture.html?isolated=deliver`);
  const owner = page.locator("forma-deliver"), visuals = owner.locator(".forma-deliver-card--visual");
  const artifact = owner.locator(".forma-deliver-card:not(.forma-deliver-card--visual)");
  await expect(visuals).toHaveCount(2); await expect(artifact).toHaveCount(1);
  const initial = await page.evaluate(() => globalThis.formaIsolatedPresentation.snapshot());
  expect(initial.owner.actualRegistryInstance).toBe(true); expect(initial.sourceActive).toBe(true);
  expect(initial.custody.outputs).toHaveLength(2); expect(initial.custody.artifacts).toHaveLength(1);
  const tabTo = async target => {
    for (let index = 0; index < 100 && !await target.evaluate(node => document.activeElement === node); index++) await page.keyboard.press("Tab");
    await expect(target).toBeFocused();
    expect(await target.evaluate(node => node.matches(":focus-visible"))).toBe(true);
  };
  const capture = async name => {
    const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    const png = await page.screenshot({ path: testInfo.outputPath(`${name}-device.png`), scale: "device" });
    expect(png.readUInt32BE(16)).toBe(Math.round(metrics.width * metrics.dpr));
    expect(png.readUInt32BE(20)).toBe(Math.round(metrics.height * metrics.dpr));
    await page.screenshot({ path: testInfo.outputPath(`${name}-css.png`), scale: "css" });
    await testInfo.attach(`${name}-capture`, { contentType: "application/json", body: JSON.stringify({ ...metrics,
      encoded: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, scale: "device", limits: "DPR, not browser zoom; isolated actual renderer with fallback fonts" }) });
    expect(metrics.overflow).toBeLessThanOrEqual(1);
  };
  // Native Tab scrolls each real anchor into view. No click/export/route change.
  for (let index = 0; index < 2; index++) {
    const card = visuals.nth(index), preview = card.locator(":scope > .forma-deliver-preview"), image = preview.locator("img");
    await tabTo(preview); await expect(image).toBeVisible();
    await image.evaluate(async node => { await node.decode(); if (!node.complete || node.naturalWidth !== 400 || node.naturalHeight !== 240) throw new Error("Calibration image did not decode"); });
    const geometry = await card.evaluate(node => {
      const preview = node.querySelector(":scope > .forma-deliver-preview"), host = preview.querySelector("forma-output-visual"), image = host.querySelector("img");
      const copy = node.querySelector(".forma-deliver-copy"), footer = node.querySelector(":scope > footer");
      const box = element => element.getBoundingClientRect().toJSON();
      const previewBox = box(preview), copyBox = box(copy);
      const outsidePoint = { x: previewBox.left + previewBox.width / 2, y: previewBox.bottom + Math.min(5, (copyBox.top - previewBox.bottom) / 2) };
      const outsideHit = document.elementFromPoint(outsidePoint.x, outsidePoint.y);
      return { preview: box(preview), host: box(host), image: box(image), copy: box(copy), footer: box(footer), card: box(node),
        ownContainingBlock: host.offsetParent === preview, previewPosition: getComputedStyle(preview).position,
        previewOverflow: { x: getComputedStyle(preview).overflowX, y: getComputedStyle(preview).overflowY },
        hostOverflow: { x: getComputedStyle(host).overflowX, y: getComputedStyle(host).overflowY },
        outsidePoint, outsidePointInViewport: outsidePoint.y > 0 && outsidePoint.y < innerHeight,
        imageEscapedAtOutsidePoint: !!outsideHit && host.contains(outsideHit),
        overflow: node.scrollWidth - node.clientWidth, imageCount: host.querySelectorAll("img").length };
    });
    await testInfo.attach(`visual-${index}-geometry`, { contentType: "application/json", body: JSON.stringify(geometry) });
    await capture(`visual-${index}-preview-focus`);
    expect(geometry.ownContainingBlock).toBe(true); expect(geometry.previewPosition).toBe("relative");
    expect(geometry.imageCount).toBe(1); expect(geometry.overflow).toBeLessThanOrEqual(1);
    for (const box of [geometry.host]) {
      expect(box.left).toBeGreaterThanOrEqual(geometry.preview.left - 1); expect(box.right).toBeLessThanOrEqual(geometry.preview.right + 1);
      expect(box.top).toBeGreaterThanOrEqual(geometry.preview.top - 1); expect(box.bottom).toBeLessThanOrEqual(geometry.preview.bottom + 1);
    }
    // The existing grid image can retain its intrinsic ratio beyond the host.
    // Its positioned preview owns the crop: raw image-box fit is not owed.
    expect(geometry.previewOverflow).toEqual({ x: "hidden", y: "hidden" });
    expect(geometry.outsidePointInViewport).toBe(true); expect(geometry.imageEscapedAtOutsidePoint).toBe(false);
    expect(geometry.copy.top).toBeGreaterThanOrEqual(geometry.preview.bottom);
    expect(geometry.footer.top).toBeGreaterThanOrEqual(geometry.copy.bottom);
    const link = card.locator(":scope > footer > a"); await tabTo(link);
    const focus = await link.evaluate(node => {
      const r = node.getBoundingClientRect(), style = getComputedStyle(node), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return { rect: r.toJSON(), topHitOwned: !!hit && node.contains(hit), outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth), height: innerHeight, width: innerWidth };
    });
    await testInfo.attach(`visual-${index}-footer-native-focus`, { contentType: "application/json", body: JSON.stringify(focus) });
    await capture(`visual-${index}-footer-focus`);
    expect(focus.topHitOwned).toBe(true); expect(focus.outlineStyle).toBe("solid"); expect(focus.outlineWidth).toBeGreaterThan(0);
    // Native scroll offsets are integral while layout boxes are fractional.
    // This permits <1 CSS px rounding, not a complete focus-perimeter claim.
    expect(focus.rect.top).toBeGreaterThanOrEqual(-1); expect(focus.rect.bottom).toBeLessThanOrEqual(focus.height + 1);
  }
  const artifactGeometry = await artifact.evaluate(node => {
    const preview = node.querySelector(":scope > .forma-deliver-preview"), copy = node.querySelector(".forma-deliver-copy"), footer = node.querySelector(":scope > footer");
    return { summaryCount: preview.querySelectorAll("forma-artifact-summary").length, position: getComputedStyle(preview).position,
      preview: preview.getBoundingClientRect().toJSON(), copy: copy.getBoundingClientRect().toJSON(), footer: footer.getBoundingClientRect().toJSON(), overflow: node.scrollWidth - node.clientWidth };
  });
  expect(artifactGeometry.summaryCount).toBe(1); expect(artifactGeometry.position).toBe("static");
  expect(artifactGeometry.copy.top).toBeGreaterThanOrEqual(artifactGeometry.preview.bottom);
  expect(artifactGeometry.footer.top).toBeGreaterThanOrEqual(artifactGeometry.copy.bottom); expect(artifactGeometry.overflow).toBeLessThanOrEqual(1);
  const final = await page.evaluate(() => globalThis.formaIsolatedPresentation.snapshot());
  expect(final.custody.events).toEqual(initial.custody.events); expect(final.custody.route).toBe(initial.custody.route);
  expect(final.custody.optimisticEvents).toEqual([]); expect(final.forbidden).toEqual([]); expect(forbidden).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("retained-state-and-isolation", { contentType: "application/json", body: JSON.stringify({ reads: final.reads,
    suppressedTelemetry: final.suppressedTelemetry, forbidden, blockedFonts, blockedHmr, errors, artifactGeometry,
    limits: "Actual isolated Deliver/Store, two calibration images and one synthetic artifact. Native focus style/center only; full perimeter in the artificial scrollport is not accepted. No full Shell, live data, permission, generation or destination-arrival proof." }) });
});
