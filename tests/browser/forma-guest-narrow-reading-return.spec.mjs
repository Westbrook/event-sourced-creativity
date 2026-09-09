/** F narrow guest reading: reuse the accepted declared resource and reach
 * complete Story/Direction regions through native keyboard scrolling only.
 * One direct current 200 response; no replay of the accepted recovery repair.
 * Geometry is read-only, and originals still require independent visual QA.
 */
import { createHash } from "node:crypto";
import { test, expect, captureViewport, browserMetrics } from
  "./fixtures.mjs";
import { tabTo, verifyFocus } from
  "./helpers/keyboard-journey.mjs";
import { classifyTestRequest, localTestOrigin } from
  "./helpers/read-only-network.mjs";
import { syntheticNetworkEnabled } from
  "./helpers/synthetic-network.mjs";

const token = "f-guest-retry-skip-synthetic-r1";
const documentPath = `/share/${token}`;
const apiPath = `/api/shared/${token}`;
const documentTitle = "Synthetic guest recovery document";
const projectName = "Synthetic exact-resource guest project";
const direction = "  Keep this exact direction: café, 雨, and 🌱.  ";
const markdown = "# The Signal Garden\n\nMara saved the last signal before dawn.\n\n“Keep the gate open,” she wrote — café, 雨, and 🌱 intact.\n\nThe garden answered.\n";
const markdownSha256 = "33e0cda6f9ee579ee130bd446e1382c47a8793b3611b1160067644254a85b4b0";
const hash = value => createHash("sha256").update(value).digest("hex");
const provenance = Object.freeze({
  mode: "declared-synthetic-exact-resource-guest",
  authority: "Finite browser responses only; no real token, authentication, authorization, account, provider or production evidence",
  source: "The accepted Story file's exact 153-byte text is reused under separately declared guest document/artifact identities",
  application: "Delivered index.html → main.ts → public-share entry → SharedView; no Store, component, fetch, focus or route injection",
  scope: "One EN 320×844 desktop-keyboard guest: native Skip, full Story/Direction reading, same-control return; no recovery replay, touch, token rotation, physical AT or whole-F claim",
});
const projection = {
  projectName, documentTitle,
  blocks: [{ id: "guest-retry-direction", type: "direction", handle: "direction/guest-retry",
    properties: { label: "Retained guest direction", text: direction } }],
  outputs: [],
  artifacts: [{ id: "guest-retry-story", documentId: "guest-retry-document", kind: "short_story",
    title: "Synthetic retained Story", titleSource: "authored", summary: "Declared exact guest copy",
    contentRef: null, contentMarkdown: markdown, contentAvailable: true,
    itemCount: 1, mediaUrl: null, mediaType: null, provider: "synthetic", modelId: "synthetic",
    latency: 0, sequence: 1, library: false, sourceEventId: "guest-retry-source", sourceSurface: null,
    settings: {}, presentation: null,
    items: [{ id: "guest-retry-part", title: "The Signal Garden", body: markdown, notes: "",
      imagePrompt: "", mediaUrl: null, mediaType: null, width: null, height: null, focalPoint: null, slide: null }] }],
};
const reply = { projection, share: { expiresAt: "2026-12-31T23:59:59.000Z" } };
test.use({ geometry: { viewport: { width: 320, height: 844 }, zoom: 1, locale: "en-US" } });

async function attach(info, name, observation) {
  await info.attach(name, { body: JSON.stringify({ provenance, observation }, null, 2), contentType: "application/json" });
}

async function withGuest({ page, context, baseURL }, info, body) {
  expect(syntheticNetworkEnabled(baseURL)).toBe(true);
  const origin = localTestOrigin(baseURL);
  const log = { documents: [], reads: [], denied: [], pageErrors: [], handlerErrors: [], downloads: [], pendingAtClose: null };
  const pending = new Set();
  const pageError = error => log.pageErrors.push({ name: error.name, message: error.message });
  const download = item => log.downloads.push({ suggestedFilename: item.suggestedFilename() });
  page.on("pageerror", pageError); page.on("download", download);
  const serve = async route => {
    const request = route.request(), url = new URL(request.url());
    const api = /^\/api(?:\/|$)/u.test(url.pathname);
    const document = request.resourceType() === "document";
    if (!api && !document) return route.fallback();
    const input = { method: request.method(), url: request.url(), postData: request.postData(), resourceType: request.resourceType() };
    const allowed = url.origin === origin && request.method() === "GET" && !url.search
      && request.frame() === page.mainFrame() && classifyTestRequest(input, origin) === "read"
      && (document ? url.pathname === documentPath && request.isNavigationRequest() : url.pathname === apiPath);
    if (!allowed || document && log.documents.length || api && log.reads.length >= 1) {
      log.denied.push({ method: request.method(), path: url.pathname, type: request.resourceType(), reason: "outside exact document/one-GET guest contract" });
      return route.abort("blockedbyclient");
    }
    if (document) {
      log.documents.push({ path: url.pathname, mainFrame: true, classification: "read" });
      return route.continue();
    }
    const row = { path: url.pathname, sequence: log.reads.length + 1, method: "GET", completed: false, status: null };
    log.reads.push(row);
    row.status = 200;
    await route.fulfill({ status: row.status, contentType: "application/json",
      headers: { "cache-control": "private, no-store", "x-forma-guest-synthetic": "narrow-reading-r1" },
      body: JSON.stringify(reply) });
    row.completed = true;
  };
  const handler = route => {
    const task = serve(route); pending.add(task);
    void task.then(() => pending.delete(task), error => {
      pending.delete(task); log.handlerErrors.push({ name: error?.name ?? "Error", message: String(error?.message ?? error) });
    });
    return task;
  };
  const verify = () => {
    expect(log.documents).toEqual([{ path: documentPath, mainFrame: true, classification: "read" }]);
    expect(log.reads).toEqual([{ path: apiPath, sequence: 1, method: "GET", completed: true, status: 200 }]);
    expect(log.denied).toEqual([]); expect(log.pageErrors).toEqual([]);
    expect(log.handlerErrors).toEqual([]); expect(log.downloads).toEqual([]);
    expect(pending.size).toBe(0);
  };
  await context.route("**/*", handler);
  let complete = false;
  try {
    await body({ log });
    await expect.poll(() => pending.size).toBe(0);
    verify(); complete = true;
  } finally {
    await context.unroute("**/*", handler);
    await Promise.allSettled([...pending]);
    log.pendingAtClose = pending.size;
    await attach(info, "guest-narrow-reading-transport", log);
    page.off("pageerror", pageError); page.off("download", download);
    if (complete) verify();
  }
}

// One-region read-only observer. Range rectangles describe laid-out text;
// saved originals supply the separate visual review. Rounded overflow uses a
// conservative inner rectangle wholly inside the rounded padding box.
function readGuestRegion(element) {
  const doc = element.ownerDocument, win = doc.defaultView;
  const box = value => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height });
  const raw = box(element.getBoundingClientRect()), viewport = { width: win.innerWidth, height: win.innerHeight, dpr: win.devicePixelRatio };
  const describe = node => ({ tag: node.tagName, id: node.id, className: node.getAttribute("class") });
  const ancestors = [], unsupported = [], clipped = [], fragments = [];
  const walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = doc.createRange(); range.selectNodeContents(node);
    for (const value of range.getClientRects()) if (value.width > 0 && value.height > 0) fragments.push(box(value));
  }
  for (let node = element; node; node = node.parentElement) {
    const style = win.getComputedStyle(node), rect = box(node.getBoundingClientRect());
    const x = /^(hidden|clip|auto|scroll|overlay)$/u.test(style.overflowX), y = /^(hidden|clip|auto|scroll|overlay)$/u.test(style.overflowY);
    const radii = [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius];
    const numericRadii = radii.map(value => /^\d+(?:\.\d+)?px(?: \d+(?:\.\d+)?px)?$/u.test(value) ? Math.max(...value.split(" ").map(Number.parseFloat)) : null);
    const radius = Math.max(0, ...numericRadii.filter(value => value !== null));
    const borders = [style.borderLeftWidth, style.borderRightWidth, style.borderTopWidth, style.borderBottomWidth].map(Number.parseFloat);
    const clip = { left: rect.left + borders[0] + radius, right: rect.right - borders[1] - radius,
      top: rect.top + borders[2] + radius, bottom: rect.bottom - borders[3] - radius };
    const item = { ...describe(node), rect, overflowX: style.overflowX, overflowY: style.overflowY,
      clientWidth: node.clientWidth, clientHeight: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
      radii, borderWidths: borders, clipAxes: { x, y }, conservativeInnerClip: clip,
      documentScroller: node === doc.scrollingElement, clipComparison: node === doc.scrollingElement ? "viewport checked after native scrolling" : node === element ? "own text fragments" : "region and text fragments",
      display: style.display, visibility: style.visibility, opacity: style.opacity, whiteSpace: style.whiteSpace,
      overflowWrap: style.overflowWrap, textOverflow: style.textOverflow, fontFamily: style.fontFamily, lineHeight: style.lineHeight };
    ancestors.push(item);
    const reasons = [];
    if (style.display === "none" || style.visibility !== "visible" || Number(style.opacity) !== 1) reasons.push("hidden or translucent ancestry");
    if ([style.transform, style.translate, style.rotate, style.scale, style.perspective, style.filter, style.clipPath, style.maskImage].some(value => value && value !== "none")) reasons.push("unsupported transformed or filtered clipping");
    if (style.clip !== "auto" || /(^|\s)(paint|strict|content)(\s|$)/u.test(style.contain)) reasons.push("unsupported legacy clip or paint containment");
    if (style.zoom && style.zoom !== "normal" && Number(style.zoom) !== 1) reasons.push("CSS zoom");
    if ((x || y) && numericRadii.includes(null)) reasons.push("unsupported non-pixel rounded clip");
    if ((x || y) && style.overflowClipMargin && style.overflowClipMargin !== "0px" && (style.overflowX === "clip" || style.overflowY === "clip")) reasons.push("nondefault overflow clip margin");
    if (node !== doc.documentElement && node !== doc.body && (style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowY === "auto" || style.overflowY === "scroll")
      && (node.clientWidth < rect.width - borders[0] - borders[1] - 1 || node.clientHeight < rect.height - borders[2] - borders[3] - 1)) reasons.push("unmeasured scrollbar inset");
    if (reasons.length) unsupported.push({ element: describe(node), reasons });
    if ((x || y) && node !== doc.scrollingElement) for (const [index, target] of (node === element ? fragments : [raw, ...fragments]).entries()) {
      if (x && (target.left < clip.left - 1 || target.right > clip.right + 1) || y && (target.top < clip.top - 1 || target.bottom > clip.bottom + 1)) clipped.push({ ancestor: describe(node), target: node === element ? index : index === 0 ? "region" : index - 1, clip });
    }
  }
  const horizontal = raw.left >= -1 && raw.right <= viewport.width + 1
    && element.scrollWidth <= element.clientWidth + 1
    && fragments.every(rect => rect.left >= -1 && rect.right <= viewport.width + 1)
    && doc.documentElement.scrollWidth <= doc.documentElement.clientWidth + 1;
  const wholeViewport = raw.top >= -1 && raw.bottom <= viewport.height + 1 && horizontal;
  const hits = wholeViewport ? fragments.flatMap(rect => {
    const dx = Math.min(1, rect.width / 4), dy = Math.min(1, rect.height / 4), cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    return [[cx, cy], [rect.left + dx, cy], [rect.right - dx, cy], [cx, rect.top + dy], [cx, rect.bottom - dy]].map(([x, y]) => {
      const top = doc.elementFromPoint(x, y); return { x, y, top: top ? describe(top) : null, owned: Boolean(top && element.contains(top)) };
    });
  }) : [];
  const style = win.getComputedStyle(element);
  return { element: describe(element), text: element.textContent, raw, fragments, ancestors, unsupported, clipped, hits,
    horizontal, wholeViewport, viewport, scroll: { x: win.scrollX, y: win.scrollY },
    rootWidth: doc.documentElement.clientWidth, rootScrollWidth: doc.documentElement.scrollWidth,
    compatMode: doc.compatMode, documentScroller: describe(doc.scrollingElement),
    color: style.color, writingMode: style.writingMode, textShadow: style.textShadow,
    focus: describe(doc.activeElement), route: location.pathname + location.search + location.hash,
    token: doc.querySelector("forma-shared-view")?.token };
}

async function waitNativeScroll(page) {
  return page.evaluate(async () => {
    let previous = "", stable = 0;
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const current = `${scrollX}:${scrollY}`;
      stable = current === previous ? stable + 1 : 0; previous = current;
      if (stable >= 3) return { x: scrollX, y: scrollY, frames: frame + 1 };
    }
    throw new Error("Native document scrolling did not settle within 60 frames");
  });
}

async function revealGuestRegion(page, region, summary, info, stage) {
  const steps = []; let observation;
  try {
    for (let index = 0; index <= 64; index++) {
      observation = await region.evaluate(readGuestRegion);
      expect(observation.unsupported, stage + ": clipping must be measurable").toEqual([]);
      expect(observation.clipped, stage + ": ancestors must retain the complete region and text").toEqual([]);
      expect(observation.horizontal, stage + ": complete copy must fit horizontally").toBe(true);
      expect(observation.raw.height, stage + ": one full region must fit in the viewport").toBeLessThanOrEqual(observation.viewport.height - 16);
      if (observation.raw.top >= 8 && observation.raw.bottom <= observation.viewport.height - 8) return observation;
      expect(index, stage + ": native scrolling is bounded").toBeLessThan(64);
      const downward = observation.raw.bottom > observation.viewport.height - 8;
      const key = downward ? observation.raw.top > observation.viewport.height + 64 ? "PageDown" : "ArrowDown"
        : observation.raw.bottom < -64 ? "PageUp" : "ArrowUp";
      await page.keyboard.press(key); const settled = await waitNativeScroll(page);
      await expect(summary, "Reading must retain the same native disclosure focus").toBeFocused();
      steps.push({ key, before: { raw: observation.raw, scroll: observation.scroll }, settled });
      if (steps.length >= 4) expect(steps.slice(-4).every(step => step.before.scroll.x === step.settled.x && step.before.scroll.y === step.settled.y), stage + ": native keys must make progress").toBe(false);
    }
  } finally {
    await attach(info, stage + "-geometry", { observation, nativeKeys: steps });
    await captureViewport(page, info, stage);
  }
}

test("Guest narrow reading: native scrolling exposes complete Story and Direction and returns to the same control", async ({ page, context, baseURL }, info) => {
  expect(Buffer.byteLength(markdown, "utf8")).toBe(153); expect(hash(markdown)).toBe(markdownSha256);
  await withGuest({ page, context, baseURL }, info, async transport => {
    const response = await page.goto(documentPath, { waitUntil: "domcontentloaded" }); expect(response?.status()).toBe(200);
    const parent = page.locator("forma-public-share"), owner = parent.locator("forma-shared-view"), main = owner.locator("main#main-content");
    await expect(parent).toHaveCount(1); await expect(owner).toHaveCount(1);
    await expect(page.locator("forma-shell, forma-platform-shell, forma-assistant")).toHaveCount(0);
    await expect(main.getByRole("heading", { name: documentTitle, exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const readTypeface = () => page.evaluate(() => ({ language: document.documentElement.lang,
      bodyFont: getComputedStyle(document.body).fontFamily.split(",").map(family => family.trim().replace(/^["']|["']$/g, "")).join(", "),
      manropeLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, "") === "Manrope" && face.status === "loaded"),
      maxTouchPoints: navigator.maxTouchPoints }));
    await expect.poll(async () => { const typeface = await readTypeface(); return typeface.manropeLoaded && typeface.bodyFont.split(",")[0] === "Manrope"; }).toBe(true);
    const metrics = await browserMetrics(page), typeface = await readTypeface();
    await attach(info, "guest-narrow-reading-profile", { metrics, typeface });
    expect(metrics).toMatchObject({ width: 320, height: 844, dpr: 1, visualScale: 1 });
    expect(typeface.language).toMatch(/^en(?:-|$)/u); expect(typeface.maxTouchPoints).toBe(0);
    await expect(main).toBeFocused();
    const skip = parent.locator('a.skip-link[href="#main-content"]');
    await tabTo(page, skip, 12, "Shift+Tab"); await verifyFocus(page, skip, info, "guest-narrow-skip-focus");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new URL(documentPath + "#main-content", baseURL).href); await expect(main).toBeFocused();
    const summary = main.locator(".shared-artifact .shared-result-details > summary"), copy = main.locator("pre.shared-artifact-copy");
    const directionCopy = main.locator(".shared-direction article > p");
    await expect(summary).toHaveCount(1); await tabTo(page, summary, 12);
    await verifyFocus(page, summary, info, "guest-narrow-story-control-focus");
    const originalSummary = await summary.elementHandle(), originalMain = await main.elementHandle();
    const custody = async stage => {
      const current = await page.evaluate(({ savedSummary, savedMain }) => {
        const currentMain = document.querySelector("forma-public-share > forma-shared-view > main#main-content");
        const currentSummary = currentMain?.querySelector(".shared-artifact .shared-result-details > summary");
        return { route: location.pathname + location.search + location.hash, token: document.querySelector("forma-shared-view")?.token,
          sameMain: savedMain === currentMain && savedMain.isConnected, sameSummary: savedSummary === currentSummary && savedSummary.isConnected,
          summaryFocused: document.activeElement === savedSummary, title: document.title,
          documentTitle: currentMain?.querySelector(".shared-hero h1")?.textContent,
          projectName: currentMain?.querySelector(".shared-hero p bdi")?.textContent,
          story: currentMain?.querySelector("pre.shared-artifact-copy")?.textContent,
          direction: currentMain?.querySelector(".shared-direction article > p")?.textContent };
      }, { savedSummary: originalSummary, savedMain: originalMain });
      await attach(info, stage, { ...current, storySha256: hash(current.story), storyBytes: Buffer.byteLength(current.story, "utf8"), declaredArtifactId: projection.artifacts[0].id, declaredDocumentId: projection.artifacts[0].documentId });
      expect(current).toEqual({ route: documentPath + "#main-content", token, sameMain: true, sameSummary: true, summaryFocused: true,
        title: documentTitle + " — Shared review — Forma", documentTitle, projectName, story: markdown, direction });
      expect(hash(current.story)).toBe(markdownSha256); expect(transport.log.reads).toHaveLength(1);
    };
    try {
      await page.keyboard.press("Enter"); await expect(summary.locator("..")).toHaveAttribute("open", "");
      await expect(copy).toBeVisible(); await custody("guest-narrow-reading-open-custody");
      for (const [stage, region, exact] of [["guest-narrow-story-complete", copy, markdown], ["guest-narrow-direction-complete", directionCopy, direction]]) {
        const observed = await revealGuestRegion(page, region, summary, info, stage);
        expect(observed.text).toBe(exact); expect(observed.wholeViewport).toBe(true);
        expect(observed.fragments.length).toBeGreaterThan(0); expect(observed.hits.length).toBeGreaterThan(0);
        expect(observed.hits.every(hit => hit.owned), stage + ": text samples must be unobstructed").toBe(true);
        expect(observed.writingMode).toBe("horizontal-tb"); expect(observed.textShadow).toBe("none");
        expect(observed.color).not.toMatch(/^(?:transparent|rgba\([^,]+,[^,]+,[^,]+,\s*0\))$/u);
        await custody(stage + "-custody");
      }
      await revealGuestRegion(page, summary, summary, info, "guest-narrow-return-control");
      await verifyFocus(page, summary, info, "guest-narrow-return-control-focus");
      await custody("guest-narrow-return-custody");
      await page.keyboard.press("Enter"); await expect(summary.locator("..")).not.toHaveAttribute("open", "");
      await verifyFocus(page, summary, info, "guest-narrow-closed-control-focus");
      await custody("guest-narrow-closed-custody");
    } finally { await originalSummary?.dispose(); await originalMain?.dispose(); }
  });
});
