import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { documentPath, tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";

// Actual Shell/Store/native browser; synthetic personal source and one synthetic
// HTTP denial. Not hosted authorization, native DB or provider qualification.
const origin = "http://127.0.0.1:4186";
const libraryPath = "/library?document=doc-atmosphere";
const deniedURL = origin + "/api/events?after=24&limit=5000&content=0";
const sourceError = "The current source is unavailable. Its saved operation references are retained.";
const primaryNavigation = '.application-creative > .application-task-navigation[data-primary-navigation="true"]';
const focusOptions = { overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", primaryNavigation] };
const profiles = [
  { name: "EN expanded", path: libraryPath, posture: "expanded", short: "false",
    geometry: { viewport: { width: 1280, height: 900 }, zoom: 1 } },
  { name: "EN normal-height rail", path: libraryPath, posture: "rail", short: "false",
    geometry: { viewport: { width: 1024, height: 900 }, zoom: 1 } },
  { name: "AR portrait320", path: libraryPath, posture: "compact", short: "false",
    geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "ar", hasTouch: true } },
  { name: "AR short landscape", path: libraryPath, posture: "rail", short: "true",
    geometry: { viewport: { width: 844, height: 390 }, zoom: 1, locale: "ar" } },
  { name: "FR genuine200", path: libraryPath, posture: "rail", short: "true",
    geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { name: "EN short workbench", path: documentPath, posture: "rail", short: "true",
    geometry: { viewport: { width: 844, height: 390 }, zoom: 1 } },
];

// Selected native Range fragments, not glyph-ink pixels. No mutation, focus or
// scrolling; original viewport captures remain necessary for visual review.
function bannerText(shell, region = "banner") {
  const doc = shell.ownerDocument, win = doc.defaultView;
  const box = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
  const main = region === "main";
  const banner = shell.querySelector(main ? ':scope > main#main-content > section.application-loading[role="status"]' : ":scope > .error-banner");
  const heading = banner?.querySelector(main ? ":scope > div > b" : ":scope > b");
  const retry = banner?.querySelector(main ? ":scope > div > button" : ":scope > button");
  const body = main ? banner?.querySelector(":scope > div > p") : banner;
  if (!banner || !heading || !retry || !body || banner.getAttribute("role") !== (main ? "status" : "alert"))
    throw new Error("Require actual Shell recovery region with its existing heading, explanation and Retry");
  const bars = shell.querySelectorAll(':scope > .application-task-navigation[data-primary-navigation="true"]');
  if (bars.length !== 1) throw new Error("Require the actual primary navigation owner");
  const nav = bars[0], navStyle = win.getComputedStyle(nav), navBox = box(nav.getBoundingClientRect());
  const nodes = [], walker = doc.createTreeWalker(banner, win.NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const parent = node.parentElement;
    const kind = heading.contains(parent) ? "heading" : retry.contains(parent) ? "retry" : (main ? body.contains(parent) : parent === banner) ? "body" : null;
    if (!kind) throw new Error("Unexpected nonempty alert text owner");
    const fragments = [], range = doc.createRange();
    range.selectNodeContents(node);
    for (const value of range.getClientRects()) {
      if (!(value.width > 0 && value.height > 0)) continue;
      const raw = box(value), clipped = [], unsupported = [];
      for (let at = parent; at; at = at.parentElement) {
        const s = win.getComputedStyle(at), r = at.getBoundingClientRect();
        if (s.display === "none" || s.visibility !== "visible" || Number(s.opacity) !== 1)
          unsupported.push("hidden ancestor " + at.tagName);
        if ([s.transform, s.translate, s.rotate, s.scale, s.perspective, s.filter, s.clipPath, s.maskImage]
          .some(v => v && v !== "none") || s.clip !== "auto" || !["", "normal", "1"].includes(s.zoom))
          unsupported.push("complex ancestor " + at.tagName);
        const x = /^(auto|scroll|hidden|clip|overlay)$/.test(s.overflowX);
        const y = /^(auto|scroll|hidden|clip|overlay)$/.test(s.overflowY);
        if ((x || y) && [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius, s.borderBottomRightRadius]
          .some(v => !/^0(?:px|%)?$/.test(v))) unsupported.push("rounded clipping " + at.tagName);
        const left = r.left + at.clientLeft, top = r.top + at.clientTop;
        if (x && (raw.left < left || raw.right > left + at.clientWidth)
          || y && (raw.top < top || raw.bottom > top + at.clientHeight)) clipped.push(at.tagName);
      }
      const dx = Math.min(1, raw.width / 4), dy = Math.min(1, raw.height / 4);
      const points = [[(raw.left + raw.right) / 2, (raw.top + raw.bottom) / 2],
        [raw.left + dx, raw.top + dy], [raw.right - dx, raw.bottom - dy]];
      const hits = points.map(([x, y]) => {
        const top = doc.elementFromPoint(x, y);
        return { x, y, tag: top?.tagName ?? null, className: top?.getAttribute("class") ?? null,
          owned: kind === "body" ? Boolean(top && (main ? body.contains(top) : top === banner)) : Boolean(top && (kind === "heading" ? heading : retry).contains(top)) };
      });
      const navOverlap = navStyle.position === "fixed" && raw.left < navBox.right && raw.right > navBox.left
        && raw.top < navBox.bottom && raw.bottom > navBox.top;
      fragments.push({ raw, clipped, unsupported, hits, navOverlap,
        inViewport: raw.left >= 0 && raw.top >= 0 && raw.right <= win.innerWidth && raw.bottom <= win.innerHeight });
    }
    range.detach();
    nodes.push({ kind, text: node.textContent.trim(), fragments });
  }
  return { region, banner: box(banner.getBoundingClientRect()), retry: box(retry.getBoundingClientRect()),
    nav: { box: navBox, position: navStyle.position }, nodes,
    viewport: { width: win.innerWidth, height: win.innerHeight }, direction: doc.documentElement.dir,
    horizontalOverflow: doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1,
    limit: "Text Range layout fragments and sampled native hits, not glyph-ink pixels or an exhaustive paint engine." };
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ geometry: profile.geometry });
  test("terminal Shell alert clears navigation and preserves native Retry focus", async ({ page, context, geometry, baseURL }, testInfo) => {
    expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("1");
    expect(testInfo.project.name).toBe("f-banner-rail");
    expect(baseURL).toBe(origin);
    let held, primary, failed = false;
    const pending = new Set(), ledger = { denied: [], forbidden: [], errors: [] };
    const matcher = url => url.origin === origin && url.pathname === "/api/events";
    const deny = route => {
      const work = (async () => {
        const request = route.request(), item = { url: request.url(), method: request.method(), body: request.postData(),
          resourceType: request.resourceType(), completed: false };
        try {
          if (item.url !== deniedURL || item.method !== "GET" || item.body !== null
            || item.resourceType !== "fetch" || ledger.denied.length !== 0) {
            ledger.forbidden.push(item); await route.abort("blockedbyclient"); return;
          }
          ledger.denied.push(item);
          await route.fulfill({ status: 403, headers: { "content-type": "application/json; charset=utf-8",
            "cache-control": "private, no-store", "x-forma-f-banner-denial": "r1" }, body: '{"error":"forbidden"}' });
          item.completed = true;
        } catch (error) {
          ledger.errors.push(String(error));
          try { await route.abort("blockedbyclient"); } catch (cleanup) { ledger.errors.push(String(cleanup)); }
        }
      })();
      pending.add(work);
      return work.finally(() => pending.delete(work));
    };
    try {
      await openForma(page, context, geometry, profile.path, testInfo);
      const shell = page.locator("forma-shell");
      const app = shell.locator(":scope > .application-creative");
      await expect(app).toHaveAttribute("data-nav-posture", profile.posture);
      await expect(app).toHaveAttribute("data-short-height", profile.short);
      await expect(app).toHaveAttribute("data-layout-intent", profile.path === documentPath ? "workbench" : "browse");
      const owner = page.locator(profile.path === documentPath ? "forma-workspace" : "forma-library");
      const opener = owner.locator(profile.path === documentPath ? ".document-title-row > button" : ".library-toolbar input");
      await expect(owner).toHaveCount(1); await expect(opener).toHaveCount(1);
      await tabTo(page, opener);
      held = await owner.evaluateHandle(element => {
        const store = element.store, shell = element.closest("forma-shell"), origin = element.ownerDocument.activeElement;
        if (!element.isConnected || !element.contains(origin) || !origin.matches(":focus-visible")
          || !store?.refreshEvents || !shell?.i18n) throw new Error("Require the native focused source owner and real Store");
        return { element, store, origin, shell, before: { events: store.events.get().length, head: store.head.get(),
          route: store.route.get(), documentId: store.projection.get().documentId },
          copy: { heading: shell.i18n.t("shell.streamUnavailable"), body: shell.i18n.t("shell.sourceUnavailable"),
            retry: shell.i18n.t("action.retry"), main: shell.i18n.t("shell.documentUnavailable"),
            mainBody: shell.i18n.t("shell.documentUnavailableDetail") } };
      });
      const before = await held.evaluate(value => ({ before: value.before, copy: value.copy }));
      expect(before.before).toEqual({ events: 23, head: 24, route: profile.path, documentId: "doc-atmosphere" });
      await attachJSON(testInfo, "f-before", before);
      await page.route(matcher, deny);
      const rejection = await held.evaluate(async value => {
        try { await value.store.refreshEvents(); return { rejected: false }; }
        catch (error) { return { rejected: true, message: String(error?.message) }; }
      });
      expect(rejection).toEqual({ rejected: true, message: "Event stream returned 403" });
      const main = app.locator(":scope > main#main-content");
      const mainStatus = main.locator(":scope > section.application-loading[role=status]");
      const mainRetry = mainStatus.locator("button");
      await expect(main).toHaveAttribute("aria-busy", "false");
      await expect(mainStatus.locator("b")).toHaveText(before.copy.main);
      await expect(mainRetry).toHaveAccessibleName(before.copy.retry);
      // Automatic source-owned handoff first: no Tab/focus/scroll repair.
      await verifyFocus(page, mainRetry, testInfo, "f-main-retry-arrival", focusOptions);
      const retired = await held.evaluate(value => ({ oldOwnerConnected: value.element.isConnected,
        oldControlConnected: value.origin.isConnected, sameStore: value.shell.store === value.store,
        events: value.store.events.get().length, head: value.store.head.get(), error: value.store.error.get(),
        route: value.store.route.get(), state: value.store.documentRouteState(), ready: value.store.routeDataReady() }));
      await attachJSON(testInfo, "f-retired", retired);
      expect(retired).toEqual({ oldOwnerConnected: false, oldControlConnected: false, sameStore: true,
        events: 0, head: 0, error: sourceError, route: profile.path, state: "unavailable", ready: false });
      const banner = app.locator(":scope > .error-banner"), retry = banner.locator(":scope > button");
      await expect(banner).toHaveAttribute("role", "alert");
      await expect(banner.locator(":scope > b")).toHaveText(before.copy.heading);
      await expect(retry).toHaveAccessibleName(before.copy.retry);
      const first = await app.evaluate(bannerText);
      const firstMain = await app.evaluate(bannerText, "main");
      await attachJSON(testInfo, "f-banner-main-focus", first);
      await attachJSON(testInfo, "f-main-copy-main-focus", firstMain);
      await captureViewport(page, testInfo, "f-banner-main-focus");
      // Verify the immediate preceding native action without invoking Retry.
      await page.keyboard.press("Shift+Tab");
      await verifyFocus(page, retry, testInfo, "f-banner-retry", focusOptions);
      const second = await app.evaluate(bannerText);
      const secondMain = await app.evaluate(bannerText, "main");
      await attachJSON(testInfo, "f-banner-retry-copy", second);
      await attachJSON(testInfo, "f-main-copy-banner-focus", secondMain);
      await captureViewport(page, testInfo, "f-banner-retry-copy");
      const assertText = observed => {
        const main = observed.region === "main";
        expect(observed.nodes.filter(node => node.kind === "heading").map(node => node.text).join(" ")).toBe(main ? before.copy.main : before.copy.heading);
        expect(observed.nodes.filter(node => node.kind === "body").map(node => node.text).join(" ")).toBe(main ? before.copy.mainBody : before.copy.body);
        expect(observed.nodes.filter(node => node.kind === "retry").map(node => node.text).join(" ")).toBe(before.copy.retry);
        expect(observed.horizontalOverflow).toBe(false);
        for (const node of observed.nodes) {
          expect(node.fragments.length).toBeGreaterThan(0);
          for (const fragment of node.fragments) {
            expect(fragment.inViewport).toBe(true); expect(fragment.navOverlap).toBe(false);
            expect(fragment.clipped).toEqual([]); expect(fragment.unsupported).toEqual([]);
            expect(fragment.hits.every(hit => hit.owned)).toBe(true);
          }
        }
      };
      for (const observed of [first, second, firstMain, secondMain]) assertText(observed);
      await page.keyboard.press("Tab");
      await verifyFocus(page, mainRetry, testInfo, "f-main-retry-return", focusOptions);
      const returnedMain = await app.evaluate(bannerText, "main");
      await attachJSON(testInfo, "f-main-copy-returned-focus", returnedMain);
      assertText(returnedMain);
    } catch (error) { primary = error; failed = true; }
    const errors = failed ? [primary] : [];
    if (failed && !page.isClosed()) {
      try { await captureViewport(page, testInfo, "f-failure-before-close", { assertStable: false }); }
      catch (error) { errors.push(error); }
    }
    // Settle the page-owned denial before its final receipt. Context/trace/profile
    // ownership remains in the unchanged canonical fixture.
    try { if (!page.isClosed()) await page.close(); } catch (error) { errors.push(error); }
    try { await Promise.all([...pending]); } catch (error) { errors.push(error); }
    try { await held?.dispose(); } catch (error) { errors.push(error); }
    try {
      await attachJSON(testInfo, "f-denial-page-phase", ledger);
      expect(ledger.errors).toEqual([]); expect(ledger.forbidden).toEqual([]);
      expect(ledger.denied).toEqual([{ url: deniedURL, method: "GET", body: null, resourceType: "fetch", completed: true }]);
    } catch (error) { errors.push(error); }
    if (errors.length > 1) throw new AggregateError(errors, "F banner observation and independent cleanup failures");
    if (errors.length) throw errors[0];
  });
});
