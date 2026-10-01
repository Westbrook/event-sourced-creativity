import { test as base, expect } from "@playwright/test";
import { createHash } from "node:crypto";

const origin = "http://127.0.0.1:4193";
const fixture = "/tests/fixtures/experience-runtime/reader.html";
const staticPaths = new Set([
  fixture, "/tests/fixtures/experience-runtime/reader.ts", "/tests/fixtures/experience-runtime/reader.css",
  "/src/experiences/results/short-story-reader.ts", "/src/experiences/results/short-story-reader.css", "/@vite/client",
]);
const literal = "\ufeff  # Heading\r\n\r\n<script>throw new Error('literal')</script>\n<img src=/reader-fixture-must-not-load onerror=alert(1)>\n[Label](https://example.invalid)\n& < > \" ' \n終わり  ";
const content = page => page.locator(".experience-short-story-content");
const control = (page, name) => page.getByRole("combobox", { name, exact: true });
const attach = (info, name, value) => info.attach(name, { body: JSON.stringify(value, null, 2), contentType: "application/json" });

const test = base.extend({ reader: [async ({ page, context }, use, info) => {
  const record = { permitted: [], forbidden: [], pageErrors: [], downloads: [], dialogs: [] };
  page.on("pageerror", error => record.pageErrors.push(error.message));
  page.on("download", () => record.downloads.push("unexpected"));
  page.on("dialog", async dialog => { record.dialogs.push(dialog.type()); await dialog.dismiss(); });
  await context.routeWebSocket("**/*", socket => { record.forbidden.push({ type: "websocket" }); socket.close(); });
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    const entry = { method: request.method(), path: url.pathname, type: request.resourceType() };
    const dependency = url.pathname.startsWith("/node_modules/") || url.pathname.startsWith("/@fs/") && url.pathname.includes("/node_modules/");
    if (url.origin === origin && request.method() === "GET" && (staticPaths.has(url.pathname) || dependency)
      && ["document", "script", "stylesheet"].includes(request.resourceType())
      && !decodeURIComponent(url.pathname).split("/").includes("..")) {
      record.permitted.push(entry); await route.continue(); return;
    }
    record.forbidden.push(entry); await route.abort("blockedbyclient");
  });
  try {
    await page.goto(fixture);
    await expect(content(page)).toHaveCount(1);
    await use();
  } finally {
    await attach(info, "network", record);
    expect(record.forbidden).toEqual([]);
    expect(record.pageErrors).toEqual([]);
    expect(record.downloads).toEqual([]);
    expect(record.dialogs).toEqual([]);
  }
}, { auto: true }] });

async function geometry(page, info, name) {
  const value = await page.evaluate(() => {
    const pre = document.querySelector(".experience-short-story-content"), article = pre.parentElement;
    const style = getComputedStyle(pre);
    return {
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth, scale: visualViewport.scale,
      textSize: getComputedStyle(document.documentElement).fontSize,
      content: { width: pre.clientWidth, scrollWidth: pre.scrollWidth, rect: pre.getBoundingClientRect().toJSON(),
        whiteSpace: style.whiteSpace, overflowY: style.overflowY, touchAction: style.touchAction,
        userSelect: style.userSelect, fontSize: style.fontSize, direction: style.direction },
      article: article.getBoundingClientRect().toJSON(),
      targets: [...document.querySelectorAll("select")].map(node => node.getBoundingClientRect().toJSON()),
    };
  });
  await attach(info, name, value);
  expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
  expect(value.content.scrollWidth).toBeLessThanOrEqual(value.content.width + 1);
  expect(value.article.left).toBeGreaterThanOrEqual(-1);
  expect(value.article.right).toBeLessThanOrEqual(value.clientWidth + 1);
  expect(value.content.whiteSpace).toBe("pre-wrap");
  expect(value.content.overflowY).toBe("visible");
  expect(value.content.touchAction).toBe("auto");
  expect(value.content.userSelect).not.toBe("none");
  for (const target of value.targets) { expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44); }
  return value;
}

test("actual reader preserves literal text and omits blank headings", async ({ page }, info) => {
  await control(page, "Sample").selectOption("literal");
  expect(await content(page).textContent()).toBe(literal);
  expect(await page.locator(".experience-short-story-title").textContent()).toBe("<em>Title</em>");
  await expect(page.locator("#reader-result script, #reader-result img, #reader-result a, #reader-result em")).toHaveCount(0);
  await expect(content(page).locator("*")).toHaveCount(0);
  await geometry(page, info, "literal-layout");
  await info.attach("literal", { body: await page.screenshot(), contentType: "image/png" });
  await control(page, "Sample").selectOption("blank");
  await expect(page.locator(".experience-short-story-title")).toHaveCount(0);
  expect(await content(page).textContent()).toBe("The last train arrived.\n\nThe platform was empty.  ");
});

test("320px reflow and 200 percent text resizing retain long and RTL content", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await control(page, "Sample").selectOption("long");
  const before = await geometry(page, info, "long-320");
  expect(await content(page).textContent()).toBe("LongLine".repeat(256));
  const original = await content(page).elementHandle();
  await control(page, "Text size").selectOption("200");
  const after = await geometry(page, info, "long-320-text-200");
  expect(parseFloat(after.content.fontSize)).toBeCloseTo(parseFloat(before.content.fontSize) * 2);
  expect(after.scale).toBe(1); // Text resizing, explicitly not browser zoom.
  expect(await content(page).evaluate((node, old) => node === old, original)).toBe(true);
  await content(page).scrollIntoViewIfNeeded();
  await info.attach("long-320-text-200", { body: await page.screenshot(), contentType: "image/png" });
  await control(page, "Sample").selectOption("rtl");
  await expect(page.locator("#reader-result")).toHaveAttribute("lang", "ar");
  expect((await geometry(page, info, "rtl-320-text-200")).content.direction).toBe("rtl");
  await content(page).scrollIntoViewIfNeeded();
  await info.attach("rtl-320-text-200", { body: await page.screenshot(), contentType: "image/png" });
  const text = await content(page).textContent();
  await page.setViewportSize({ width: 844, height: 390 });
  await geometry(page, info, "rtl-landscape-text-200");
  expect(await content(page).textContent()).toBe(text);
  await control(page, "Appearance").selectOption("dark");
  await content(page).scrollIntoViewIfNeeded();
  const appearance = await content(page).evaluate(node => ({ text: getComputedStyle(node).color,
    surface: getComputedStyle(node.parentElement).backgroundColor }));
  expect(appearance).toEqual({ text: "rgb(243, 243, 239)", surface: "rgb(25, 26, 24)" });
  expect(await content(page).textContent()).toBe(text);
  await attach(info, "dark-fixture-colors", appearance);
  await info.attach("rtl-landscape-dark", { body: await page.screenshot(), contentType: "image/png" });
  await original.dispose();
});

test("maximum narrative remains complete in the actual DOM", async ({ page }, info) => {
  await control(page, "Sample").selectOption("maximum");
  const text = await content(page).textContent();
  const expected = "\ufeff\r\n" + "界".repeat(170_663) + "終\n  ";
  expect(text).toBe(expected);
  expect(Buffer.byteLength(text)).toBe(512_000);
  await geometry(page, info, "maximum-layout");
  await attach(info, "maximum-text", { bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex"),
    expectedSha256: createHash("sha256").update(expected).digest("hex") });
  await info.attach("maximum", { body: await page.screenshot(), contentType: "image/png" });
});

test("native pointer text selection and keyboard controls remain available", async ({ page }, info) => {
  // A native mouse drag tests browser selection; it does not certify mobile
  // long-press handles, clipboard integration or assistive technology.
  await control(page, "Sample").selectOption("standard");
  await content(page).scrollIntoViewIfNeeded();
  const points = await content(page).evaluate(node => {
    const range = document.createRange();
    const text = [...node.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent.length >= 9);
    if (!text) throw new Error("Reader text node unavailable");
    range.setStart(text, 0); range.setEnd(text, 9);
    const box = range.getBoundingClientRect();
    return { start: { x: box.left + 1, y: box.top + box.height / 2 }, end: { x: box.right, y: box.top + box.height / 2 } };
  });
  await page.mouse.move(points.start.x, points.start.y); await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 8 }); await page.mouse.up();
  const selection = await page.evaluate(() => ({ text: getSelection().toString(),
    inside: document.querySelector(".experience-short-story-content").contains(getSelection().anchorNode) }));
  await attach(info, "native-mouse-selection", selection);
  expect(selection.inside).toBe(true); expect(selection.text.length).toBeGreaterThan(3);
  expect("The light in the station".includes(selection.text)).toBe(true);
  await control(page, "Sample").focus();
  await page.keyboard.press("Tab");
  await expect(control(page, "Text size")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(control(page, "Appearance")).toBeFocused();
  await info.attach("keyboard-focus", { body: await page.screenshot(), contentType: "image/png" });
});

test("page scrolling remains native with touch emulation", async ({ page, context, isMobile }, info) => {
  await control(page, "Sample").selectOption("long");
  const before = await page.evaluate(() => scrollY);
  if (isMobile) {
    const session = await context.newCDPSession(page);
    const x = 160, start = 690;
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: start }] });
    for (let step = 1; step <= 10; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: start - 38 * step }] });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
  } else {
    await page.mouse.move(640, 600); await page.mouse.wheel(0, 500);
  }
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 50);
  const after = await page.evaluate(() => ({ scrollY, contentScroll: document.querySelector(".experience-short-story-content").scrollTop,
    coarse: matchMedia("(pointer: coarse)").matches, maxTouchPoints: navigator.maxTouchPoints }));
  expect(after.contentScroll).toBe(0);
  if (isMobile) { expect(after.coarse).toBe(true); expect(after.maxTouchPoints).toBeGreaterThan(0); }
  await attach(info, "native-scroll", { mechanism: isMobile ? "CDP touch emulation" : "mouse wheel", before, after });
  await info.attach("scrolled", { body: await page.screenshot(), contentType: "image/png" });
});
