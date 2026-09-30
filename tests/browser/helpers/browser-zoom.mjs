import { expect } from "@playwright/test";

export async function browserMetrics(page) {
  return page.evaluate(() => ({
    width: innerWidth, height: innerHeight,
    outerWidth, outerHeight, dpr: devicePixelRatio,
    visualScale: visualViewport?.scale ?? null,
    visualWidth: visualViewport?.width ?? null,
    documentWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
}

/** API read-back AND actual layout changes; never substitute pinch scale or CSS zoom. */
export async function applyBrowserZoom(page, context, factor, onReceipt = async () => {}) {
  let worker = context.serviceWorkers().find(item => item.url().startsWith("chrome-extension://"));
  worker ??= await context.waitForEvent("serviceworker", { predicate: item => item.url().startsWith("chrome-extension://"), timeout: 15_000 });
  const command = async zoom => worker.evaluate(
    async input => globalThis.formaTestBrowserZoom(input), { url: page.url(), factor: zoom });
  const reset = await command(1);
  await expect.poll(async () => (await browserMetrics(page)).visualScale).toBe(1);
  const before = await browserMetrics(page);
  const result = await command(factor);
  await expect.poll(async () => (await browserMetrics(page)).dpr).toBeCloseTo(before.dpr * factor, 5);
  const after = await browserMetrics(page);
  await onReceipt(`browser-zoom-${factor * 100}`, { mechanism: "chrome.tabs.setZoom", reset, result, before, after });
  expect(reset.factor).toBe(1);
  // Native Chromium reports requested 400% as 3.9999999999999996. Keep raw
  // readback in the receipt and independently verify DPR/reflow/visualScale.
  expect(result.factor).toBeCloseTo(factor, 12);
  expect(result.settings).toMatchObject({ mode: "automatic", scope: "per-tab" });
  expect(result.url).toBe(page.url());
  expect(after.visualScale, "pinch/visual scaling is not desktop browser zoom").toBe(1);
  expect(Math.abs(after.width * factor - before.width)).toBeLessThanOrEqual(factor);
  expect(Math.abs(after.height * factor - before.height)).toBeLessThanOrEqual(factor);
  expect(after.dpr / before.dpr).toBeCloseTo(factor, 5);
  return { before, after, result };
}

