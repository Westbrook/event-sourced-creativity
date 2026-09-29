import { test, expect } from "@playwright/test";
import { accountingResponse } from "../helpers/generation-accounting-fixture.mjs";

const origin = "http://127.0.0.1:4186", fixturePath = "/tests/generation-accounting.fixture.html";
const endpoint = `${origin}/api/admin/generation-accounting?jobId=job-1`;
const fontStylesheet = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap";
const labels = {
  en: { inspect: "Inspect accounting", receipt: "Accounting diagnostic receipt" },
  fr: { inspect: "Inspecter la comptabilité", receipt: "Justificatif de diagnostic comptable" },
  ar: { inspect: "فحص المحاسبة", receipt: "إيصال تشخيص المحاسبة" },
};

const pageErrorReceipts = new WeakMap();
function observePageErrors(page) {
  const receipt = { count: 0, samples: [] }; pageErrorReceipts.set(page, receipt);
  page.on("pageerror", error => {
    receipt.count++;
    if (receipt.samples.length < 3) receipt.samples.push({ name: String(error.name).slice(0,80), message: String(error.message).slice(0,320), stack: String(error.stack ?? "").split("\n").slice(0,6).join("\n").slice(0,1800) });
  });
  return receipt;
}
test.afterEach(async ({ page }, testInfo) => {
  const receipt = pageErrorReceipts.get(page);
  if (receipt?.count) await testInfo.attach("bounded-page-errors", { contentType: "application/json", body: JSON.stringify(receipt) });
});

async function isolate(context, value, denied = false) {
  const record = { accounting: [], forbidden: [], blockedFontImports: 0, blockedDevSockets: 0 };
  let release; const gate = new Promise(resolve => { release = resolve; });
  // All interception is installed before navigation or module import. No
  // response is obtained from a Worker, account or remote provider.
  await context.routeWebSocket("**/*", socket => {
    const url = new URL(socket.url());
    if (url.protocol === "ws:" && url.hostname === "127.0.0.1" && url.port === "4186" && url.pathname === "/" && socket.protocols().includes("vite-hmr")) record.blockedDevSockets++;
    else record.forbidden.push({ transport: "websocket", origin: url.origin, path: url.pathname });
    return socket.close({ code: 1000, reason: "Isolated fixture blocks sockets" });
  });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.href === endpoint && method === "GET") {
      record.accounting.push({ method, path: url.pathname, query: url.search });
      await gate;
      await route.fulfill({ status: denied ? 403 : 200, contentType: "application/json", headers: { "cache-control": "private, no-store" },
        body: JSON.stringify(denied ? { error: "SYNTHETIC_DENIAL_MUST_NOT_BE_REFLECTED" } : value) });
      return;
    }
    if (url.href === fontStylesheet && method === "GET") { record.blockedFontImports++; await route.abort("blockedbyclient"); return; }
    const staticPath = url.pathname === fixturePath || ["/src/", "/tests/", "/node_modules/", "/@vite/", "/@fs/", "/@id/"].some(prefix => url.pathname.startsWith(prefix));
    if (url.origin === origin && method === "GET" && staticPath && !["fetch", "xhr", "eventsource"].includes(request.resourceType())) { await route.continue(); return; }
    record.forbidden.push({ method, origin: url.origin, path: url.pathname, type: request.resourceType() });
    await route.abort("blockedbyclient");
  });
  return { record, release };
}

async function tabTo(page, target, maximum = 24) {
  for (let count = 0; count < maximum && !await target.evaluate(element => document.activeElement === element); count++) await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  expect(await target.evaluate(element => element.matches(":focus-visible"))).toBe(true);
}

async function openReceipt(page, locale) {
  await page.goto(`${fixturePath}?locale=${locale}`);
  await expect(page.locator("#accounting-fixture-ready")).toHaveText("Isolated accounting fixture ready");
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
  const opener = page.getByRole("button", { name: "Open synthetic receipt", exact: true });
  await tabTo(page, opener); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog"); await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(element => element.matches(":modal"))).toBe(true);
  await expect(page.locator("#accounting-fixture-reads")).toHaveText("0");
  const inspect = dialog.locator(".generation-accounting-preview > header > button");
  await expect(inspect).toHaveAccessibleName(labels[locale].inspect);
  return { opener, dialog, inspect };
}

async function geometryAndCapture(page, dialog, testInfo, name) {
  const metrics = await dialog.evaluate(element => {
    const body = element.querySelector(".generation-input-body"), section = element.querySelector(".generation-accounting-preview"), header = section.querySelector("header");
    const peers = [...element.querySelectorAll("section > header .button.secondary.compact")].map(button => ({ text: button.textContent, rect: button.getBoundingClientRect().toJSON() }));
    const box = body.getBoundingClientRect(), style = getComputedStyle(body), sectionBox = section.getBoundingClientRect();
    const focused = document.activeElement, focusStyle = getComputedStyle(focused);
    return { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visualScale: visualViewport?.scale ?? 1,
      documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bodyOverflow: body.scrollWidth - body.clientWidth, sectionOverflow: section.scrollWidth - section.clientWidth,
      dialog: element.getBoundingClientRect().toJSON(), body: box.toJSON(), bodyClip: { left: box.left + body.clientLeft, top: box.top + body.clientTop, right: box.left + body.clientLeft + body.clientWidth, bottom: box.top + body.clientTop + body.clientHeight }, section: sectionBox.toJSON(), header: header.getBoundingClientRect().toJSON(), leadWidth: header.querySelector("div").getBoundingClientRect().width,
      contentLeft: box.left + body.clientLeft + parseFloat(style.paddingLeft), contentRight: box.left + body.clientLeft + body.clientWidth - parseFloat(style.paddingRight), peers,
      focused: { tag: focused.tagName, visible: focused.matches(":focus-visible"), outlineStyle: focusStyle.outlineStyle, outlineWidth: focusStyle.outlineWidth, outlineOffset: focusStyle.outlineOffset, rect: focused.getBoundingClientRect().toJSON() } };
  });
  expect(metrics.dpr).toBe(2); expect(metrics.visualScale).toBe(1); // DPR/reflow, not true browser zoom.
  for (const overflow of [metrics.documentOverflow, metrics.bodyOverflow, metrics.sectionOverflow]) expect(overflow).toBeLessThanOrEqual(1);
  expect(metrics.dialog.x).toBeGreaterThanOrEqual(0); expect(metrics.dialog.x + metrics.dialog.width).toBeLessThanOrEqual(metrics.width + 1);
  expect(Math.abs(metrics.section.left - metrics.contentLeft)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.section.right - metrics.contentRight)).toBeLessThanOrEqual(1);
  expect(metrics.leadWidth).toBeGreaterThanOrEqual(Math.min(240, metrics.section.width) - 1);
  expect(metrics.peers.length).toBeGreaterThanOrEqual(2);
  for (const peer of metrics.peers) { expect(peer.rect.height).toBeGreaterThanOrEqual(44); expect(Math.abs(peer.rect.height - metrics.peers[0].rect.height)).toBeLessThanOrEqual(1); }
  expect(metrics.focused.visible).toBe(true); expect(metrics.focused.outlineStyle).not.toBe("none"); expect(parseFloat(metrics.focused.outlineWidth)).toBeGreaterThan(0);
  const extent = Math.max(0, parseFloat(metrics.focused.outlineWidth) + parseFloat(metrics.focused.outlineOffset));
  expect(metrics.focused.rect.left - extent).toBeGreaterThanOrEqual(metrics.bodyClip.left - 1);
  expect(metrics.focused.rect.right + extent).toBeLessThanOrEqual(metrics.bodyClip.right + 1);
  expect(metrics.focused.rect.top - extent).toBeGreaterThanOrEqual(metrics.bodyClip.top - 1);
  expect(metrics.focused.rect.bottom + extent).toBeLessThanOrEqual(metrics.bodyClip.bottom + 1);
  const captures = [];
  for (const scale of ["device", "css"]) {
    const png = await page.screenshot({ path: testInfo.outputPath(`${name}-${scale}.png`), scale, fullPage: false, animations: "disabled" });
    const encoded = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }, multiplier = scale === "device" ? metrics.dpr : 1;
    expect(encoded.width).toBe(Math.round(metrics.width * multiplier)); expect(encoded.height).toBe(Math.round(metrics.height * multiplier));
    captures.push({ scale, multiplier, encoded });
  }
  await testInfo.attach(`${name}-measured-geometry`, { contentType: "application/json", body: JSON.stringify({ metrics, captures, limits: "Synthetic account; fallback fonts; keyboard/DPR geometry, not browser zoom or assistive-technology certification." }) });
}

// Deliberately three different stress cases, not widths × locales × outcomes.
for (const scenario of [
  { name: "narrow Arabic", locale: "ar", viewport: { width: 360, height: 800 }, activate: "Space" },
  { name: "reported-width long French", locale: "fr", viewport: { width: 681, height: 991 }, activate: "Enter" },
  { name: "desktop English", locale: "en", viewport: { width: 1280, height: 900 }, activate: "Enter" },
]) test.describe(scenario.name, () => {
  test.use({ viewport: scenario.viewport });
  test("ordinary keyboard accounting read stays local, legible and returns focus", async ({ page, context }, testInfo) => {
    const errors = observePageErrors(page);
    const value = accountingResponse(); value.preview.unallowlisted = "SYNTHETIC_EXTRA_FIELD_MUST_NOT_ENTER_DOM";
    if (scenario.locale === "fr") { value.preview.calls[2].providerRequestId = "synthetic-video-" + "reference-".repeat(16); value.preview.calls[2].model = "synthetic-provider/" + "long-model-name-".repeat(9); }
    const network = await isolate(context, value);
    const { opener, dialog, inspect } = await openReceipt(page, scenario.locale);
    expect(network.record.accounting).toEqual([]);
    await tabTo(page, inspect); await page.keyboard.press(scenario.activate);
    await expect.poll(() => network.record.accounting.length).toBe(1);
    await expect(inspect).toHaveAttribute("aria-disabled", "true"); await expect(inspect).toBeFocused();
    await page.keyboard.press(scenario.activate); // Disabled-by-ARIA still focusable; handler must refuse duplicate dispatch.
    network.release();
    const receipt = dialog.getByRole("textbox", { name: labels[scenario.locale].receipt, exact: true });
    await expect(receipt).toBeVisible(); await expect(receipt).toHaveAttribute("readonly", ""); await expect(receipt).toHaveAttribute("dir", "ltr");
    const readyCapture = await page.screenshot({ path: testInfo.outputPath("accounting-ready-css.png"), scale: "css", fullPage: false, animations: "disabled" });
    expect(readyCapture.readUInt32BE(16)).toBe(scenario.viewport.width); expect(readyCapture.readUInt32BE(20)).toBe(scenario.viewport.height);
    const observed = JSON.parse(await receipt.inputValue());
    expect(observed.job.jobId).toBe("job-1"); expect(observed.accounting.totalReceiptCostMicrousd).toBeNull();
    expect(observed.mutationAvailable).toBe(false); expect(observed.providerCalls).toBe(0); expect(observed.ledgerWrites).toBe(0);
    expect(await receipt.inputValue()).not.toContain("SYNTHETIC_EXTRA_FIELD");
    await tabTo(page, receipt); await geometryAndCapture(page, dialog, testInfo, "accounting-receipt-focus");
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
    expect(await opener.evaluate(element => element.matches(":focus-visible"))).toBe(true);
    await expect(page.locator("#accounting-fixture-reads")).toHaveText("1"); await expect(page.locator("#accounting-fixture-blocked")).toHaveText("0");
    expect(network.record.accounting).toHaveLength(1); expect(network.record.forbidden).toEqual([]); expect(errors).toEqual({ count: 0, samples: [] });
    await testInfo.attach("isolated-network-receipt", { contentType: "application/json", body: JSON.stringify(network.record) });
  });
});

test.describe("denied synthetic accounting read", () => {
  test.use({ viewport: { width: 681, height: 991 } });
  test("denial preserves the original receipt and keyboard return", async ({ page, context }) => {
    const errors = observePageErrors(page);
    const network = await isolate(context, accountingResponse(), true);
    const { opener, dialog, inspect } = await openReceipt(page, "en");
    const original = dialog.locator(".generation-input-receipt"), before = await original.inputValue();
    expect(before).toContain("ORIGINAL_SYNTHETIC_RECEIPT_NO_ACCOUNT_DATA");
    await tabTo(page, inspect); await page.keyboard.press("Space"); await expect.poll(() => network.record.accounting.length).toBe(1); network.release();
    await expect(dialog.locator(".generation-accounting-preview [role=status]")).toContainText("Accounting details could not be loaded.");
    expect(await original.inputValue()).toBe(before); await expect(dialog.getByRole("textbox", { name: labels.en.receipt, exact: true })).toHaveCount(0);
    await expect(dialog).not.toContainText("SYNTHETIC_DENIAL_MUST_NOT_BE_REFLECTED"); await expect(inspect).toBeFocused();
    await page.keyboard.press("Escape"); await expect(dialog).toBeHidden(); await expect(opener).toBeFocused();
    await expect(page.locator("#accounting-fixture-blocked")).toHaveText("0"); expect(network.record.accounting).toHaveLength(1); expect(network.record.forbidden).toEqual([]); expect(errors).toEqual({ count: 0, samples: [] });
  });
});
