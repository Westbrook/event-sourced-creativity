import { test, expect, attachJSON, applyBrowserZoom, browserMetrics, captureViewport } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";

const surfaces = ["memory", "sessions", "collection", "taste", "workspace", "settings-projects", "settings-activity"];
// Deliberate representative coverage, not the Cartesian product or a claim of
// all-locale physical-device/AT coverage. The real zoom fixture is unchanged.
const profiles = [
  { name: "EN 320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1 } },
  { name: "FR 390", geometry: { viewport: { width: 390, height: 844 }, zoom: 1, locale: "fr" } },
  { name: "AR 320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "ar" } },
  { name: "JA 768", geometry: { viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja" } },
  { name: "EN 1280", geometry: { viewport: { width: 1280, height: 900 }, zoom: 1 } },
  { name: "EN 1920", geometry: { viewport: { width: 1920, height: 1080 }, zoom: 1 } },
  { name: "EN short landscape", geometry: { viewport: { width: 844, height: 390 }, zoom: 1 } },
  { name: "FR true 200%", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" } },
  { name: "AR narrow container in wide window", narrow: true, geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "ar" } },
  { name: "EN coarse 320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1, hasTouch: true } },
];
const snapshot = page => page.evaluate(() => globalThis.formaIsolatedE6?.snapshot() ?? null);
const overlays = [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar"];

function typefacePolicy() {
  const stack = value => value.split(",").map(family => family.trim().replace(/["']/g, ""));
  const root = getComputedStyle(document.documentElement), bodyStack = stack(getComputedStyle(document.body).fontFamily);
  return { language: document.documentElement.lang, direction: document.documentElement.dir, bodyStack,
    firstFamily: bodyStack[0], sansStack: stack(root.getPropertyValue("--sans")),
    formaStack: stack(root.getPropertyValue("--forma-font-family")),
    manropeLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, "") === "Manrope" && face.status === "loaded"),
    limit: "Declared computed typeface policy and font readiness; no individual glyph or all-platform fallback claim." };
}

function workspaceComposition(shell) {
  const app = shell.querySelector(":scope > .app-shell.application-creative");
  const main = app?.querySelector(":scope > #main-content"), application = main?.querySelector(":scope > forma-creative-application");
  const owners = application?.querySelectorAll(":scope > forma-workspace") ?? [];
  const trigger = owners[0]?.querySelector("forma-project-rail .rail-collapse-toggle");
  const panel = owners[0]?.querySelector("forma-project-rail .rail-content[popover]");
  const inline = shell.getBoundingClientRect().width, block = document.documentElement.clientHeight || innerHeight;
  const short = block <= 600, expectedPosture = short && inline > block ? "rail" : inline < 768 ? "compact" : inline < 1200 ? "rail" : "expanded";
  const posture = app?.getAttribute("data-nav-posture"), nativePanel = posture === "compact" || matchMedia("(max-width: 47.99rem)").matches;
  return { shellConnected: shell.isConnected, appConnected: Boolean(app?.isConnected), ownerCount: owners.length,
    busy: main?.getAttribute("aria-busy"), inline, block, posture, expectedPosture,
    postureReady: posture === expectedPosture && app?.getAttribute("data-short-height") === String(short),
    nativePanel, triggerTarget: trigger?.getAttribute("popovertarget"), panelId: panel?.id ?? null,
    nativeRailReady: Boolean(trigger && (nativePanel ? trigger.getAttribute("popovertarget") && trigger.getAttribute("popovertarget") === panel?.id
      && panel.getAttribute("popover") === "auto" : !trigger.hasAttribute("popovertarget"))),
    limit: "Actual shell and Creative owner composition with synthetic Store data; no real account or route-load evidence." };
}

function memoryContainment(owner) {
  const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right, width: rect.width }; };
  const page = owner.querySelector(":scope > .memory-page"), layout = page?.querySelector(":scope > .memory-layout");
  const main = layout?.querySelector(":scope > main"), preference = main?.querySelector(":scope > .preference-author > form");
  const condition = main?.querySelector(":scope > section > .condition-author"), failures = [], owners = [];
  const inspect = (name, node, parent) => {
    if (!node || !parent) { failures.push(name + ":missing-owner"); return; }
    const rect = box(node), parentRect = box(parent);
    owners.push({ name, rect, parent: parentRect, clientWidth: node.clientWidth, scrollWidth: node.scrollWidth,
      overflowX: getComputedStyle(node).overflowX });
    if (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1) failures.push(name + ":outside-owning-inline-box");
    if (node.scrollWidth > node.clientWidth + 1) failures.push(name + ":ordinary-owner-horizontal-overflow");
  };
  inspect("page", page, owner.closest("#e6-root"));
  inspect("hero", page?.querySelector(":scope > .page-header"), page);
  inspect("layout", layout, page); inspect("main", main, layout);
  for (const [index, section] of [...(main?.querySelectorAll(":scope > section") ?? [])].entries()) inspect("main-section-" + index, section, main);
  for (const [name, form] of [["preference", preference], ["condition", condition]]) {
    inspect(name + "-form", form, form?.parentElement);
    for (const [index, child] of [...(form?.children ?? [])].entries()) {
      inspect(name + "-form-child-" + index, child, form);
      for (const [controlIndex, control] of [...child.querySelectorAll("input,select,button")].entries()) inspect(name + "-control-" + index + "-" + controlIndex, control, child);
    }
  }
  // The shared row oracle covers Latin words. Also observe complete ordinary
  // Arabic action words here; Japanese line breaking is deliberately separate.
  const arabicWords = [];
  const actions = owner.querySelectorAll(".page-header-actions > button,.preference-author .platform-form-actions > button,.condition-author .platform-form-actions > button,.memory-layout > main > section > .section-heading > button");
  for (const button of actions) {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) for (const match of text.textContent.matchAll(/\p{Script=Arabic}+/gu)) {
      if (match[0].length < 2 || match[0].length > 20) continue;
      const range = document.createRange(); range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
      const lines = [...new Set([...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => Math.round(rect.top * 10) / 10))];
      arabicWords.push({ text: match[0], lines });
      if (lines.length > 1) failures.push("ordinary-arabic-action-word-split-across-lines");
    }
  }
  return { schema: "forma-e6-memory-containment-r1", owners, arabicWords, failures,
    limit: "Representative ordinary Memory owner/form inline boxes and action words only; no whole-page ink, focus, condition execution or all-script claim." };
}

function headerContainment(header) {
  const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top,
    right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
  const visible = node => Boolean(node?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
  const outside = (rect, owner) => rect.left < owner.left - 1 || rect.right > owner.right + 1
    || rect.top < owner.top - 1 || rect.bottom > owner.bottom + 1;
  const headerBox = box(header), viewport = { left: 0, top: 0, right: document.documentElement.clientWidth,
    bottom: document.documentElement.clientHeight }, failures = [], owners = [];
  const selectors = [":scope > .brand", ":scope > forma-ui-workspace-switcher", ":scope > .application-context",
    ":scope > .top-actions > .locale-picker-form", ":scope > .top-actions > .forma-global-search",
    ":scope > .top-actions > .button.secondary", ":scope > .top-actions > .avatar"];
  for (const selector of selectors) {
    const nodes = [...header.querySelectorAll(selector)];
    for (const node of nodes) {
      const rendered = visible(node), rect = box(node); owners.push({ selector, rendered, rect });
      if (rendered && (outside(rect, headerBox) || outside(rect, viewport))) failures.push(selector + ":visible-owner-outside-header-or-viewport");
    }
  }
  const active = owners.filter(owner => owner.rendered), overlaps = [];
  for (let first = 0; first < active.length; first++) for (let second = first + 1; second < active.length; second++) {
    const a = active[first], b = active[second];
    const width = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
    const height = Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top);
    if (width > 1 && height > 1) { overlaps.push({ first: a.selector, second: b.selector, width, height }); failures.push("visible-header-owners-overlap"); }
  }
  const identity = header.querySelector(":scope > .application-context > b"), identityVisible = visible(identity);
  const fragments = [], words = [];
  if (identityVisible) {
    const rect = box(identity), owningBox = box(identity.parentElement), style = getComputedStyle(identity);
    if (!identity.textContent.trim()) failures.push("visible-application-identity-empty");
    if (outside(rect, owningBox) || outside(rect, headerBox) || outside(rect, viewport)) failures.push("visible-application-identity-outside-owner");
    if ([style.overflowX, style.overflowY].some(value => ["hidden", "clip"].includes(value))
      || style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") failures.push("visible-application-identity-truncation-style");
    const walker = document.createTreeWalker(identity, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(text);
      fragments.push(...[...range.getClientRects()].filter(part => part.width && part.height).map(part => ({ left: part.left, top: part.top, right: part.right, bottom: part.bottom })));
      for (const match of text.textContent.matchAll(/[\p{Script=Latin}\p{Script=Arabic}]+/gu)) {
        if (match[0].length < 2 || match[0].length > 20) continue;
        range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
        const lines = [...new Set([...range.getClientRects()].filter(part => part.width && part.height).map(part => Math.round(part.top * 10) / 10))];
        words.push({ text: match[0], lines }); if (lines.length > 1) failures.push("ordinary-application-identity-word-split");
      }
    }
    if (!fragments.length || fragments.some(part => outside(part, rect) || outside(part, owningBox) || outside(part, headerBox) || outside(part, viewport))) failures.push("visible-application-identity-label-outside-owner");
  }
  const duplicateLabels = [...header.querySelectorAll(":scope > .brand > span:last-child,.command-label,.command-trigger > kbd,.locale-switcher > span")]
    .map(node => ({ text: node.textContent, className: node.className, rendered: visible(node), rect: box(node) }));
  return { schema: "forma-e6-header-containment-r1", header: headerBox, viewport, owners, overlaps,
    identity: { rendered: identityVisible, text: identity?.textContent ?? null, rect: identity ? box(identity) : null, fragments, words },
    duplicateLabels, failures,
    limit: "Visible header owner boxes and current application identity text ranges only; intentional hidden duplicate labels and bounded description truncation retain existing policy. No all-glyph, all-identity, pixel-ink or AT claim." };
}

function modalTitleLayout(form, { titleSelector, expectedResource, resourceInTitle }) {
  const box = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, top: rect.top,
    right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }; };
  const outside = (rect, owner) => rect.left < owner.left - 1 || rect.right > owner.right + 1
    || rect.top < owner.top - 1 || rect.bottom > owner.bottom + 1;
  const dialog = form.closest("dialog"), titles = form.querySelectorAll(titleSelector), closes = form.querySelectorAll(":scope > button.modal-close");
  const failures = [], fragments = [], words = [], collisions = [], titleBlockOverhang = [];
  if (titles.length !== 1 || closes.length !== 1) return { failures: ["missing-or-duplicate-modal-title-close"], titleCount: titles.length, closeCount: closes.length };
  const title = titles[0], close = closes[0], titleStyle = getComputedStyle(title), closeStyle = getComputedStyle(close);
  const titleBox = box(title), closeBox = box(close), formBox = box(form);
  const viewport = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
  const outlineExtent = closeStyle.outlineStyle === "none" ? 0 : Math.max(0, parseFloat(closeStyle.outlineWidth) + parseFloat(closeStyle.outlineOffset));
  const closeEnvelope = { left: closeBox.left - outlineExtent, top: closeBox.top - outlineExtent,
    right: closeBox.right + outlineExtent, bottom: closeBox.bottom + outlineExtent };
  const text = title.textContent, labelledBy = dialog?.getAttribute("aria-labelledby");
  if (!dialog?.matches(":modal") || !title.id || labelledBy !== title.id) failures.push("title-not-current-native-dialog-name-owner");
  if (!text.trim()) failures.push("empty-modal-title");
  if (resourceInTitle && !text.includes(expectedResource)) failures.push("full-resource-name-missing-from-title");
  if (!(close instanceof HTMLButtonElement) || close.type !== "button" || close.disabled || !close.getAttribute("aria-label")?.trim()) failures.push("invalid-native-close-owner");
  if (document.activeElement !== close || !close.matches(":focus-visible")) failures.push("close-not-natively-focused-for-observation");
  if (closeBox.width < 44 || closeBox.height < 44) failures.push("native-close-below-44px-floor");
  if (outside(titleBox, formBox) || outside(titleBox, viewport)) failures.push("modal-title-outside-form-or-viewport");
  if ([titleStyle.overflowX, titleStyle.overflowY].some(value => ["hidden", "clip"].includes(value))
    || titleStyle.textOverflow === "ellipsis" || titleStyle.webkitLineClamp !== "none") failures.push("modal-title-truncation-style");
  const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const style = getComputedStyle(node.parentElement);
    if (!node.parentElement.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      || style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") failures.push("modal-title-hidden-text-owner");
    const range = document.createRange(); range.selectNodeContents(node);
    for (const part of range.getClientRects()) if (part.width && part.height) {
      const rect = { left: part.left, top: part.top, right: part.right, bottom: part.bottom };
      fragments.push({ text: node.textContent, ...rect });
      // A visible text block's font metrics can extend beyond its line box.
      // Keep that raw overhang; only its inline allocation and real containing
      // form/viewport bound paint. Native Close collisions remain independent.
      const above = Math.max(0, titleBox.top - rect.top), below = Math.max(0, rect.bottom - titleBox.bottom);
      if (above || below) titleBlockOverhang.push({ text: node.textContent, above, below });
      if (rect.left < titleBox.left - 1 || rect.right > titleBox.right + 1
        || outside(rect, formBox) || outside(rect, viewport)) failures.push("modal-title-fragment-outside-owning-box");
      for (const [owner, bounds] of [["native-close-body", closeBox], ["native-close-focus-envelope", closeEnvelope]]) {
        const width = Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left);
        const height = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top);
        if (width > 1 && height > 1) { collisions.push({ owner, text: node.textContent, width, height, rect, bounds }); failures.push("modal-title-overlaps-" + owner); }
      }
    }
    for (const match of node.textContent.matchAll(/[\p{Script=Latin}\p{Script=Arabic}]+/gu)) {
      if (match[0].length < 2 || match[0].length > 20) continue;
      range.setStart(node, match.index); range.setEnd(node, match.index + match[0].length);
      const lines = [...new Set([...range.getClientRects()].filter(part => part.width && part.height).map(part => Math.round(part.top * 10) / 10))];
      words.push({ text: match[0], lines }); if (lines.length > 1) failures.push("ordinary-modal-title-word-split");
    }
  }
  if (!fragments.length) failures.push("modal-title-has-no-text-fragments");
  return { schema: "forma-e6-modal-title-close-r2", title: { selector: titleSelector, id: title.id, text, rect: titleBox,
    styles: { fontSize: titleStyle.fontSize, lineHeight: titleStyle.lineHeight, overflowX: titleStyle.overflowX, overflowY: titleStyle.overflowY,
      textOverflow: titleStyle.textOverflow, lineClamp: titleStyle.webkitLineClamp } },
    close: { name: close.getAttribute("aria-label"), rect: closeBox, focusEnvelope: closeEnvelope, outlineExtent },
    form: formBox, viewport, labelledBy, expectedResource, resourceInTitle, fragments, words, titleBlockOverhang, collisions, failures,
    limit: "Current native modal title inline text allocation and form/viewport containment against actual focused Close body/envelope; non-clipping line-box block overhang remains diagnostic. No all-glyph ink, screenshot masking, field-value paint or AT claim; full raw resource names are separately retained." };
}

// Bounded layout diagnostics follow the retained modal/PC measurement pattern.
// The existing calibrated focus observer, not these boxes, owns paint, clipping
// and hit acceptance. Only declared actual button peers are compared.
function controlLayout(row, { selector, floor, peerRow = true }) {
  const doc = row.ownerDocument, win = doc.defaultView, failures = [];
  const bounds = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right,
    bottom: r.bottom, width: r.width, height: r.height }; };
  const controls = [...row.querySelectorAll(selector)].map(node => {
    const rect = bounds(node), style = win.getComputedStyle(node), fragments = [], words = [];
    const walker = doc.createTreeWalker(node, win.NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.textContent.trim() || text.parentElement.closest('[aria-hidden="true"],.forma-icon,script,style')) continue;
      const range = doc.createRange(); range.selectNodeContents(text);
      fragments.push(...[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
      // Ordinary short alphabetic words must not become letter columns. CJK
      // line breaking and deliberately long authored identifiers are separate.
      for (const match of text.textContent.matchAll(/\p{Script=Latin}{2,14}/gu)) {
        range.setStart(text, match.index); range.setEnd(text, match.index + match[0].length);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
        const lines = [...new Set(rects.map(r => Math.round(r.top * 10) / 10))];
        words.push({ text: match[0], lines });
        if (lines.length > 1) failures.push("short-word-split-across-lines");
      }
    }
    if (!(node instanceof win.HTMLButtonElement || node instanceof win.HTMLInputElement
      || node instanceof win.HTMLSelectElement || node instanceof win.HTMLAnchorElement)) failures.push("not-an-actual-native-control");
    if (rect.height < floor || rect.width < floor) failures.push("native-control-below-target-floor");
    if (node.scrollWidth > node.clientWidth + 1) failures.push("control-horizontal-overflow");
    if (fragments.some(r => r.left < rect.left - 1 || r.right > rect.right + 1)) failures.push("label-outside-native-inline-box");
    if (node instanceof win.HTMLButtonElement || node instanceof win.HTMLAnchorElement) {
      if (!node.textContent.trim() || !fragments.length) failures.push("button-has-no-visible-label-fragments");
      if (fragments.some(r => r.top < rect.top - 1 || r.bottom > rect.bottom + 1)) failures.push("label-outside-native-block-box");
      if (node.scrollHeight > node.clientHeight + 1) failures.push("control-vertical-overflow");
      if (style.textOverflow !== "clip" || style.webkitLineClamp !== "none"
        || [style.overflowX, style.overflowY].some(value => ["hidden", "clip"].includes(value))) failures.push("label-truncation-style");
      const labels = [node, ...node.querySelectorAll("*")].filter(item => !item.closest('[aria-hidden="true"],.forma-icon'));
      if (labels.some(item => { const value = win.getComputedStyle(item); return value.display === "none" || value.visibility !== "visible"
        || Number(value.opacity) === 0 || value.textOverflow === "ellipsis" || value.webkitLineClamp !== "none"; })) failures.push("hidden-or-truncated-label-owner");
    }
    return { tag: node.tagName, type: node.getAttribute("type"), text: node.textContent, rect,
      disabled: node.matches(":disabled"), name: node.getAttribute("aria-label"), fragments, words,
      styles: { minHeight: style.minHeight, whiteSpace: style.whiteSpace, overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak, fontSize: style.fontSize, lineHeight: style.lineHeight,
        overflowX: style.overflowX, overflowY: style.overflowY, textOverflow: style.textOverflow, lineClamp: style.webkitLineClamp } };
  });
  const sameRowPairs = [], style = win.getComputedStyle(row), expectedGap = Number.parseFloat(style.columnGap);
  if (peerRow) for (let a = 0; a < controls.length; a++) for (let b = a + 1; b < controls.length; b++) {
    const first = controls[a].rect, second = controls[b].rect;
    if (first.top >= second.bottom || second.top >= first.bottom) continue;
    const difference = Math.abs(first.height - second.height), gap = Math.max(first.left, second.left) - Math.min(first.right, second.right);
    sameRowPairs.push({ a, b, difference, gap, expectedGap });
    if (difference > 1) failures.push("same-row-native-peers-have-different-heights");
    if (Number.isFinite(expectedGap) && gap < expectedGap - 1) failures.push("same-row-peer-gap-lost");
  }
  return { schema: "forma-e6-native-row-layout-r1", current: row.isConnected, row: bounds(row),
    direction: style.direction, flexDirection: style.flexDirection, controls, sameRowPairs, floor, failures,
    limit: "Layout boxes and text ranges only; no glyph-ink, AT, full-copy paint or all-platform claim. Wrapped rows are independent." };
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ geometry: profile.geometry });
  for (const surface of surfaces) test(`Isolated E6 ${surface}: actual native controls with synthetic no-effect data`,
    async ({ page, context, geometry }, testInfo) => {
      const apiBypasses = [], errors = [], downloads = [], observations = [], focusReturns = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("download", download => downloads.push(download.suggestedFilename()));
      // The default guard allows local GETs: this second pre-navigation boundary
      // is required so even a forgotten fetch/XHR/beacon cannot reach an API.
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method())) {
          apiBypasses.push({ method: request.method(), origin: url.origin, path: url.pathname });
          await route.abort("blockedbyclient"); return;
        }
        await route.fallback();
      });
      const language = geometry.locale ?? "en-US", floor = geometry.hasTouch ? 48 : 44;
      let baseline, owner, originalOwner, beforeURL, primaryFailure;
      const secondaryFailures = [];
      const custody = async () => {
        const current = await snapshot(page);
        expect(current.custody).toEqual(baseline.custody);
        expect(current.sourceActive).toBe(true); expect(current.owner).toEqual(baseline.owner);
        expect(current.forbidden).toEqual([]); expect(page.url()).toBe(beforeURL);
        expect(await owner.evaluate((node, retained) => node === retained && node.isConnected, originalOwner)).toBe(true);
        expect(apiBypasses).toEqual([]); expect(downloads).toEqual([]);
      };
      const focus = async (target, stage) => {
        await tabTo(page, target, 160);
        await verifyFocus(page, target, testInfo, stage, { overlaySelectors: overlays });
        await custody();
      };
      const row = async (target, selector, stage, { peerRow = true, count = 2, minimumFloor = floor } = {}) => {
        await expect(target).toHaveCount(1);
        const observation = await target.evaluate(controlLayout, { selector, floor: minimumFloor, peerRow });
        observations.push({ stage, ...observation }); await attachJSON(testInfo, stage + "-layout", observation);
        expect(observation.controls).toHaveLength(count);
        expect(observation.failures, stage).toEqual([]);
      };
      const modalTitle = async (dialog, form, titleSelector, expectedResource, resourceInTitle, stage) => {
        const title = form.locator(titleSelector), close = form.locator(":scope > button.modal-close");
        await expect(title).toHaveCount(1); await expect(close).toHaveCount(1);
        await expect(title).toBeVisible(); await expect(close).toHaveAccessibleName(/\S/);
        const text = await title.textContent(); expect(text?.trim()).toBeTruthy();
        await expect(dialog).toHaveAttribute("aria-labelledby", await title.getAttribute("id"));
        await expect(dialog).toHaveAccessibleName(text);
        let focusFailure = null, observation, measurementFailure = null;
        try { await focus(close, stage + "-native-close-unactivated"); } catch (error) { focusFailure = error; }
        try {
          observation = await form.evaluate(modalTitleLayout, { titleSelector, expectedResource, resourceInTitle });
          observations.push({ stage, ...observation }); await attachJSON(testInfo, stage, observation);
        } catch (error) { measurementFailure = error; }
        if (focusFailure && measurementFailure) throw new AggregateError([focusFailure, measurementFailure], stage + ": native focus and title observation failed");
        if (focusFailure) throw focusFailure;
        if (measurementFailure) throw measurementFailure;
        expect(observation.title.text).toBe(text); expect(observation.failures, stage).toEqual([]); await custody();
      };
      const observeReturn = async stage => {
        // E6 CSS does not redefine preexisting dialog/form focus ownership.
        // Record the native outcome without manufacturing a return promise.
        const outcome = await page.evaluate(() => ({ tag: document.activeElement?.tagName,
          className: document.activeElement?.getAttribute("class"), connected: document.activeElement?.isConnected,
          focusVisible: document.activeElement?.matches(":focus-visible"), modalCount: document.querySelectorAll(":modal").length }));
        focusReturns.push({ stage, ...outcome }); await attachJSON(testInfo, stage, outcome);
        await captureViewport(page, testInfo, stage); await custody();
      };
      testInfo.annotations.push({ type: "scope", description: "Synthetic actual-component geometry only. No live account/API, mutation, provider, authorization, AT or production acceptance." });
      try {
        const response = await page.goto(`/tests/e6-noncanvas.fixture.html?surface=${surface}&locale=${language}${profile.narrow ? "&container=narrow" : ""}${process.env.FORMA_E6_BASELINE === "1" ? "&baseline=1" : ""}`,
          { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);
        await expect.poll(() => snapshot(page)).toMatchObject({ schema: "forma-isolated-e6-r1", surface,
          apiIsolationBeforeOwner: true, sourceActive: true, owner: { connected: true, actualRegistryInstance: true } });
        expect((await snapshot(page)).foundation).toBe(process.env.FORMA_E6_BASELINE === "1"
          ? "/__e6_baseline-responsive-foundation.css" : "/src/responsive-foundation.css");
        await expect(page.locator("forma-shell")).toHaveCount(surface === "workspace" ? 1 : 0);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
        await page.evaluate(() => document.fonts.ready);
        const scriptStack = language === "ar" ? ["ui-sans-serif", "system-ui", "sans-serif"]
          : language === "ja" ? ["Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", "ui-sans-serif", "system-ui", "sans-serif"] : null;
        const expectedTypeface = scriptStack ? { bodyStack: scriptStack, sansStack: scriptStack, formaStack: scriptStack }
          : { firstFamily: "Manrope", manropeLoaded: true };
        await attachJSON(testInfo, "e6-typeface-policy", { expected: expectedTypeface, observed: await page.evaluate(typefacePolicy) });
        await expect.poll(() => page.evaluate(typefacePolicy)).toMatchObject(expectedTypeface);
        await applyBrowserZoom(page, context, geometry.zoom, testInfo);
        if (geometry.viewport) {
          const metrics = await browserMetrics(page);
          expect({ width: metrics.width, height: metrics.height }).toEqual(geometry.viewport);
        }
        if (geometry.hasTouch) expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0)).toBe(true);
        if (profile.narrow) expect(await page.locator("#e6-root").evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(400);
        if (surface === "workspace") {
          const shell = page.locator("#e6-root > forma-shell");
          await expect.poll(() => shell.evaluate(workspaceComposition)).toMatchObject({ shellConnected: true, appConnected: true,
            ownerCount: 1, busy: "false", postureReady: true, nativeRailReady: true });
          await attachJSON(testInfo, "e6-actual-workspace-composition", await shell.evaluate(workspaceComposition));
          owner = shell.locator(":scope > .app-shell > #main-content > forma-creative-application > forma-workspace");
        } else owner = page.locator("#e6-root > :first-child");
        await expect(owner).toHaveCount(1); originalOwner = await owner.elementHandle(); beforeURL = page.url();
        baseline = await snapshot(page); expect(baseline.forbidden).toEqual([]);
        if (surface === "memory") {
          await captureViewport(page, testInfo, "e6-memory-initial-viewport");
          const containment = await owner.evaluate(memoryContainment);
          observations.push({ stage: "e6-memory-ordinary-containment", ...containment });
          await attachJSON(testInfo, "e6-memory-ordinary-containment", containment);
          const forms = owner.locator(".preference-author > form,.condition-author");
          const formValues = () => forms.locator("input,select").evaluateAll(nodes => nodes.map(node => ({ tag: node.tagName,
            type: node.getAttribute("type"), value: node.value, checked: node instanceof HTMLInputElement ? node.checked : null })));
          await expect(forms).toHaveCount(2); const retainedValues = await formValues(); expect(retainedValues).toHaveLength(6);
          await attachJSON(testInfo, "e6-memory-raw-form-values", { values: retainedValues,
            scope: "Unactivated pristine preference/condition forms; extra geometry guards use the existing44px baseline. Coarse48px acceptance stays on the E6 belief peers." });
          const group = owner.locator(".memory-page .belief-actions");
          await focus(group.locator(":scope > button").first(), "e6-memory-save-unactivated");
          await row(group, ":scope > button", "e6-memory-peers");
          await focus(group.locator(":scope > button").last(), "e6-memory-dismiss-unactivated");
          const ordinaryControl = { peerRow: false, count: 1, minimumFloor: 44 };
          await row(owner.locator(".page-header-actions"), ":scope > button", "e6-memory-hero-control", ordinaryControl);
          for (const [name, form] of [["preference", forms.first()], ["condition", forms.last()]]) {
            await row(form, ":scope > label > input,:scope > label > select", "e6-memory-" + name + "-fields", { peerRow: false, count: 3, minimumFloor: 44 });
            const actions = form.locator(":scope > .platform-form-actions"), buttons = actions.locator(":scope > button");
            await expect(buttons).toHaveCount(2); await expect(buttons.first()).toBeDisabled(); await expect(buttons.last()).toBeDisabled();
            await row(actions, ":scope > button", "e6-memory-" + name + "-action", { peerRow: true, count: 2, minimumFloor: 44 });
          }
          await row(owner.locator(".memory-layout > main > section > .section-heading").filter({ has: page.locator(":scope > button") }),
            ":scope > button", "e6-memory-condition-check-control", ordinaryControl);
          expect(containment.failures).toEqual([]); expect(await formValues()).toEqual(retainedValues); await custody();
        } else if (surface === "sessions") {
          const brief = owner.locator(".brief-block"), briefActions = brief.locator(".brief-actions");
          const briefCopy = async () => brief.evaluate(node => ({ title: node.querySelector("h3")?.textContent,
            summary: node.querySelector("p")?.textContent, source: node.querySelector("small")?.textContent,
            destination: { view: node.querySelector(".brief-actions > button")?.getAttribute("data-destination-view"),
              target: node.querySelector(".brief-actions > button")?.getAttribute("data-target-ref"),
              label: node.querySelector(".brief-view-path")?.textContent } }));
          const briefs = baseline.custody.events.filter(event => event.type === "BriefComposed");
          expect(briefs).toHaveLength(1); expect(briefs[0].payload.items).toHaveLength(1);
          const seededBrief = briefs[0].payload.items[0];
          expect(seededBrief).toMatchObject({ title: expect.any(String), summary: expect.any(String),
            source_event_refs: [expect.any(String)], destination: { view: "context-block", ref_id: "e6-source", document_view: "document" } });
          await expect(brief).toHaveCount(1); const retainedBrief = await briefCopy();
          expect(retainedBrief).toMatchObject({ title: seededBrief.title, summary: seededBrief.summary,
            destination: { view: seededBrief.destination.view, target: seededBrief.destination.ref_id } });
          expect(retainedBrief.source?.trim()).toBeTruthy(); expect(retainedBrief.destination.label?.trim()).toBeTruthy();
          await attachJSON(testInfo, "e6-sessions-retained-brief", retainedBrief);
          await focus(briefActions.locator(":scope > button").first(), "e6-sessions-resume-unactivated");
          await row(briefActions, ":scope > button", "e6-sessions-brief-peers");
          await focus(briefActions.locator(":scope > button").last(), "e6-sessions-not-now-unactivated");
          expect(await briefCopy()).toEqual(retainedBrief);
          const opener = owner.locator(".blank-choice");
          await focus(opener, "e6-sessions-blank-open"); await page.keyboard.press("Enter");
          const form = owner.locator(".blank-document-form"), input = form.locator("input");
          await expect(input).toBeFocused();
          await verifyFocus(page, input, testInfo, "e6-sessions-native-name", { overlaySelectors: overlays });
          const raw = await input.inputValue();
          await row(form, ":scope > input", "e6-sessions-input-floor", { peerRow: false, count: 1 });
          await focus(form.locator(".blank-document-discard"), "e6-sessions-cancel");
          await row(form.locator(":scope > div"), ":scope > button", "e6-sessions-peers");
          await focus(form.locator("button[type=submit]"), "e6-sessions-submit-unactivated");
          await expect(input).toHaveValue(raw);
          const scout = owner.locator(".scout-gate > button"); await focus(scout, "e6-scout-unactivated");
          await row(owner.locator(".scout-gate"), ":scope > button", "e6-scout-floor", { peerRow: false, count: 1 });
          expect(await briefCopy()).toEqual(retainedBrief);
        } else if (surface === "collection") {
          const trigger = owner.locator('.tree-more[popovertarget]');
          await focus(trigger, "e6-collection-native-menu-trigger"); await page.keyboard.press("Enter");
          const menu = owner.locator('.tree-menu[popover]:popover-open'); await expect(menu).toHaveCount(1);
          await focus(menu.locator(":scope > button").first(), "e6-collection-rename"); await page.keyboard.press("Enter");
          const dialog = owner.locator("dialog.collection-dialog:modal"), input = dialog.locator(".collection-form input");
          await expect(menu).toHaveCount(0); await expect(input).toBeFocused();
          await verifyFocus(page, input, testInfo, "e6-collection-native-input", { overlaySelectors: overlays });
          const raw = await input.inputValue();
          const seededCollections = baseline.custody.events.filter(event => event.type === "CollectionCreated");
          expect(seededCollections).toHaveLength(1); expect(seededCollections[0].payload.handle?.trim()).toBeTruthy();
          expect(raw).toBe(seededCollections[0].payload.handle);
          await expect(dialog.locator("#collection-dialog-title")).toHaveText(await owner.evaluate(node => node.i18n.system("Rename collection")));
          await modalTitle(dialog, dialog.locator(".collection-form"), ":scope > #collection-dialog-title", raw, false, "e6-collection-title-close");
          await row(dialog.locator(".collection-form"), "label > input", "e6-collection-input-floor", { peerRow: false, count: 1 });
          await focus(dialog.locator("footer > button").first(), "e6-collection-cancel");
          await row(dialog.locator("footer"), ":scope > button", "e6-collection-peers");
          await focus(dialog.locator("footer > button").last(), "e6-collection-save-unactivated"); await expect(input).toHaveValue(raw);
          await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await observeReturn("e6-collection-native-return");
        } else if (surface === "taste") {
          const trigger = owner.locator(".output-actions-popover .ui-popover-trigger");
          await focus(trigger, "e6-taste-native-menu-trigger"); await page.keyboard.press("Enter");
          const menu = owner.locator(".output-actions-popover .ui-popover-panel:popover-open");
          await expect(menu).toHaveCount(1);
          const taste = menu.locator(".output-secondary-actions > button[aria-expanded]");
          await focus(taste, "e6-taste-open"); await page.keyboard.press("Enter");
          const form = owner.locator(".output-critique"); await expect(form).toHaveCount(1); await expect(menu).toHaveCount(0);
          const signal = form.locator(".taste-signal");
          await focus(signal.locator(":scope > button").first(), "e6-taste-signal-unactivated");
          await row(signal, ":scope > button", "e6-taste-signal-floor");
          const input = form.locator(".taste-value > input"); await focus(input, "e6-taste-value");
          await row(form.locator(".taste-value"), ":scope > input", "e6-taste-input-floor", { peerRow: false, count: 1 });
          await expect(input).toHaveValue(""); await expect(form.locator("footer > button").last()).toBeDisabled();
          await focus(form.locator("footer > button").first(), "e6-taste-cancel");
          await row(form.locator("footer"), ":scope > button", "e6-taste-peers");
        } else if (surface === "workspace") {
          const shell = page.locator("#e6-root > forma-shell"), topbar = shell.locator(":scope > .app-shell > .topbar");
          const search = topbar.locator(".command-trigger.forma-global-search"), locale = topbar.locator("forma-ui-language-picker > .locale-switcher > select");
          const account = topbar.locator(".top-actions > .avatar"), accountPanel = topbar.locator("#account-popover[popover=auto]");
          const headerCopy = () => topbar.evaluate(node => ({ brand: node.querySelector(".brand")?.getAttribute("aria-label"),
            application: node.querySelector(".application-context > b")?.textContent,
            options: [...node.querySelectorAll(".locale-switcher > select > option")].map(option => ({ value: option.value,
              text: option.textContent, lang: option.lang, dir: option.dir, disabled: option.disabled })),
            preferences: [...node.querySelectorAll(".account-preferences input")].map(input => ({ type: input.type, checked: input.checked })) }));
          const retainedHeader = await headerCopy();
          expect(retainedHeader.brand?.trim()).toBeTruthy(); expect(retainedHeader.application?.trim()).toBeTruthy();
          expect(retainedHeader.options).toEqual([
            { value: "en", text: "English", lang: "en", dir: "ltr", disabled: false },
            { value: "fr", text: "Français", lang: "fr", dir: "ltr", disabled: false },
            { value: "ar", text: "العربية", lang: "ar", dir: "rtl", disabled: false },
            { value: "ja", text: "日本語", lang: "ja", dir: "ltr", disabled: false },
          ]);
          expect(retainedHeader.preferences).toEqual([{ type: "checkbox", checked: true }, { type: "checkbox", checked: false }]);
          await attachJSON(testInfo, "e6-retained-shell-header", retainedHeader);
          const headerLayout = await topbar.evaluate(headerContainment);
          observations.push({ stage: "e6-shell-header-containment", ...headerLayout });
          await attachJSON(testInfo, "e6-shell-header-containment", headerLayout);
          const nativeHeaderBox = async (target, stage) => {
            const observation = await target.evaluate(node => { const rect = node.getBoundingClientRect(); return {
              tag: node.tagName, width: rect.width, height: rect.height, connected: node.isConnected,
              disabled: node.matches(":disabled"), ariaLabel: node.getAttribute("aria-label"),
              floor: 44, limit: "Native body floor only; unchanged strict focus observer owns paint/hit. Icon-only accessible labels retain their existing policy." }; });
            observations.push({ stage, ...observation }); await attachJSON(testInfo, stage, observation);
            expect(["BUTTON", "SELECT"]).toContain(observation.tag); expect(observation.connected).toBe(true);
            expect(observation.disabled).toBe(false); expect(observation.width).toBeGreaterThanOrEqual(44); expect(observation.height).toBeGreaterThanOrEqual(44);
          };
          const searchName = await search.getAttribute("aria-label"); expect(searchName?.trim()).toBeTruthy();
          await expect(search).toHaveAccessibleName(searchName); await expect(search.locator(":scope > .command-label")).toHaveText(searchName);
          const iconOnlySearch = await topbar.evaluate(node => node.parentElement.getAttribute("data-nav-posture") === "compact" || matchMedia("(max-width: 1050px)").matches);
          if (iconOnlySearch) { await expect(search.locator(":scope > .command-label")).toBeHidden(); await expect(search.locator(":scope > kbd")).toBeHidden(); }
          else { await expect(search.locator(":scope > .command-label")).toBeVisible(); await expect(search.locator(":scope > kbd")).toBeVisible(); }
          await focus(search, "e6-shell-search-unactivated"); await nativeHeaderBox(search, "e6-shell-search-native-box");
          await expect(search).toHaveAttribute("aria-expanded", "false");
          const localeValue = language === "en-US" ? "en" : language;
          await expect(locale).toHaveValue(localeValue); await expect(locale).toHaveAccessibleName(/\S/);
          await focus(locale, "e6-shell-language-unchanged"); await nativeHeaderBox(locale, "e6-shell-language-native-box");
          await expect(locale).toHaveValue(localeValue);
          const accountName = await account.getAttribute("aria-label"); expect(accountName?.trim()).toBeTruthy();
          await expect(account).toHaveAccessibleName(accountName); await expect(account).toHaveAttribute("popovertarget", "account-popover");
          await focus(account, "e6-shell-account-trigger"); await nativeHeaderBox(account, "e6-shell-account-native-box");
          await page.keyboard.press("Enter"); await expect(accountPanel).toBeVisible(); await expect(accountPanel).toHaveJSProperty("popover", "auto");
          const share = accountPanel.locator(":scope > .account-share-action");
          expect(baseline.custody.session.projectContext ?? null).toBeNull();
          await expect(share).toHaveCount(1); await expect(share).toBeEnabled();
          await focus(share, "e6-shell-account-share-unactivated");
          await page.keyboard.press("Escape"); await expect(accountPanel).toBeHidden(); await expect(account).toBeFocused();
          await verifyFocus(page, account, testInfo, "e6-shell-account-native-return", { overlaySelectors: overlays }); await custody();
          expect(await headerCopy()).toEqual(retainedHeader); await expect(locale).toHaveValue(localeValue);
          expect(headerLayout.failures, "Visible header owners and application identity must fit their actual header").toEqual([]);
          const edit = owner.locator(".rail-project-edit"), expand = owner.locator(".rail-collapse-toggle");
          const railToolbar = owner.locator("forma-project-rail > .project-rail > .rail-toolbar");
          const railControl = { peerRow: false, count: 1, minimumFloor: 44 };
          const measureRailControl = async stage => {
            const label = await expand.evaluate(node => {
              const rail = node.closest(".project-rail"), app = node.closest(".application-creative"), text = node.querySelector(":scope > b");
              const style = getComputedStyle(text), rect = text.getBoundingClientRect(), range = document.createRange();
              range.selectNodeContents(text);
              const collapsed = rail.classList.contains("collapsed"), expanded = rail.classList.contains("expanded");
              const compact = app.getAttribute("data-nav-posture") === "compact", narrow = matchMedia("(max-width: 760px)").matches;
              return { collapsed, expanded, compact, narrow, ariaExpanded: node.getAttribute("aria-expanded"),
                expectedIconOnly: expanded || (collapsed && !compact && !narrow), text: text.textContent,
                name: node.getAttribute("aria-label"), hiddenFromAccessibility: Boolean(text.closest('[aria-hidden="true"],[hidden]')),
                rect: { width: rect.width, height: rect.height },
                styles: { position: style.position, width: style.width, height: style.height, clip: style.clip,
                  overflowX: style.overflowX, overflowY: style.overflowY, display: style.display, visibility: style.visibility, opacity: style.opacity },
                fragments: [...range.getClientRects()].map(part => ({ left: part.left, top: part.top, right: part.right, bottom: part.bottom })),
                limit: "The retained expanded rail and tall collapsed rail deliberately clip their direct b label to one pixel. Its full accessible name remains required; only the compact/narrow collapsed label is visible copy." };
            });
            observations.push({ stage: stage + "-label-policy", ...label }); await attachJSON(testInfo, stage + "-label-policy", label);
            expect(label.collapsed).not.toBe(label.expanded); expect(label.ariaExpanded).toBe(String(label.expanded));
            expect(label.text?.trim()).toBeTruthy(); expect(label.name).toBe(label.text); expect(label.hiddenFromAccessibility).toBe(false);
            await expect(expand).toHaveAccessibleName(label.text);
            expect(label.styles.display).not.toBe("none"); expect(label.styles.visibility).toBe("visible"); expect(Number(label.styles.opacity)).toBe(1);
            if (label.expectedIconOnly) {
              expect(label.styles).toMatchObject({ position: "absolute", width: "1px", height: "1px", clip: "rect(0px, 0px, 0px, 0px)",
                overflowX: "hidden", overflowY: "hidden" });
              expect(label.rect).toEqual({ width: 1, height: 1 });
              await nativeHeaderBox(expand, stage + "-icon-only-native-box");
            } else {
              expect(label.styles).toMatchObject({ position: "static", clip: "auto", overflowX: "visible", overflowY: "visible" });
              await row(railToolbar, ":scope > .rail-collapse-toggle", stage, railControl);
            }
          };
          const nativeRailId = await expand.getAttribute("popovertarget");
          if (nativeRailId) {
            const railPanel = owner.locator("forma-project-rail .rail-content[popover=auto]");
            await expect(railPanel).toHaveAttribute("id", nativeRailId);
            await focus(expand, "e6-project-rail-expand");
            await measureRailControl("e6-project-rail-closed-control");
            await page.keyboard.press("Enter");
            await expect(railPanel).toBeVisible();
            const railCopy = () => railPanel.evaluate(node => ({ text: node.textContent,
              destinations: [...node.querySelectorAll("a[href]")].map(link => ({ text: link.textContent, href: link.getAttribute("href"), current: link.getAttribute("aria-current") })) }));
            const retainedRail = await railCopy(); expect(retainedRail.text?.trim()).toBeTruthy();
            const currentRailLink = railPanel.locator(".rail-document-links a[aria-current=page]");
            await expect(currentRailLink).toContainText("Synthetic E6 document");
            await attachJSON(testInfo, "e6-retained-native-rail-copy", retainedRail);
            await expect(currentRailLink).toBeFocused();
            await verifyFocus(page, currentRailLink, testInfo, "e6-project-rail-current-link-ready", { overlaySelectors: overlays }); await custody();
            await page.keyboard.press("Escape"); await expect(railPanel).toBeHidden(); await expect(expand).toBeFocused();
            await verifyFocus(page, expand, testInfo, "e6-project-rail-native-return", { overlaySelectors: overlays }); await custody();
            await page.keyboard.press("Enter"); await expect(railPanel).toBeVisible(); expect(await railCopy()).toEqual(retainedRail);
            await expect(expand).toHaveAttribute("popovertarget", nativeRailId); await expect(railPanel).toHaveAttribute("id", nativeRailId);
            await expect(railPanel).toHaveJSProperty("popover", "auto");
            await measureRailControl("e6-project-rail-open-control");
          } else if (!await edit.isVisible()) {
            await focus(expand, "e6-project-rail-expand");
            await measureRailControl("e6-project-rail-inline-control");
            await page.keyboard.press("Enter");
          }
          expect(await headerCopy()).toEqual(retainedHeader); await custody();
          await focus(edit, "e6-project-settings-open"); await page.keyboard.press("Enter");
          const dialog = owner.locator("dialog.project-settings-dialog:modal"); await expect(dialog).toHaveCount(1);
          const form = dialog.locator(".project-settings-form");
          await focus(form.locator("input"), "e6-project-name");
          const raw = await form.locator("input").inputValue(), state = await form.locator("select").inputValue();
          const seededProjects = baseline.custody.events.filter(event => event.type === "ProjectCreated");
          expect(seededProjects).toHaveLength(1); expect(seededProjects[0].payload.name?.trim()).toBeTruthy();
          expect(raw).toBe(seededProjects[0].payload.name);
          await modalTitle(dialog, form, ":scope > #project-settings-title", raw, true, "e6-project-title-close");
          await row(form, "label > input,label > select", "e6-project-field-floors", { peerRow: false });
          await focus(form.locator("select"), "e6-project-state-unchanged");
          await focus(form.locator("footer > button").first(), "e6-project-cancel");
          await row(form.locator("footer"), ":scope > button", "e6-project-footer");
          await expect(form.locator("input")).toHaveValue(raw); await expect(form.locator("select")).toHaveValue(state);
          await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await observeReturn("e6-project-native-return");
          const file = owner.locator(".composer-command .add-ref > input[type=file]");
          await tabTo(page, file, 160); await expect(file).toBeFocused();
          await attachJSON(testInfo, "e6-upload-file-trigger", {
            disposition: "UNASSESSED_PAINT: native Tab reaches the real INPUT; its add-ref LABEL is outside the calibrated file-button proxy contract",
            native: await file.evaluate(node => ({ tag: node.tagName, type: node.type, active: document.activeElement === node,
              labelClass: node.parentElement?.className, connected: node.isConnected })),
          });
          // Only a new in-memory, explicitly synthetic text file reaches the
          // real local pre-upload UI. It is never uploaded or imported.
          await file.setInputFiles({ name: "synthetic-e6-source.txt", mimeType: "text/plain", buffer: Buffer.from("Synthetic E6 source; no real rights assertion.") });
          const upload = owner.locator("dialog.upload-rights-modal:modal"), rights = upload.locator(".rights-check input");
          await expect(upload).toHaveCount(1); await expect(rights).not.toBeChecked();
          await expect(upload.locator("footer > button[type=submit]")).toBeDisabled();
          await focus(upload.locator("footer > button").first(), "e6-upload-cancel");
          await row(upload.locator("footer"), ":scope > button", "e6-upload-footer");
          await expect(rights).not.toBeChecked(); await page.keyboard.press("Enter");
          await expect(upload).toHaveCount(0); await observeReturn("e6-upload-native-return");
          expect(await headerCopy()).toEqual(retainedHeader); await expect(locale).toHaveValue(localeValue);
        } else if (surface === "settings-projects") {
          const access = owner.locator(".workspace-settings-project-list > li > header > button");
          await focus(access, "e6-settings-view-access"); await page.keyboard.press("Enter");
          const nested = owner.locator(".workspace-settings-card > .workspace-settings-project-list > li > .workspace-settings-list > li");
          await expect(nested).toHaveCount(1);
          const role = nested.locator(":scope > div > select"), raw = await role.inputValue();
          await focus(role, "e6-settings-role-unchanged");
          const revoke = nested.locator(":scope > button"); await focus(revoke, "e6-settings-revoke-unactivated");
          await row(nested, ":scope > button", "e6-settings-sole-revoke", { peerRow: false, count: 1 });
          const single = await nested.evaluate(node => ({ buttons: node.querySelectorAll(":scope > button").length,
            copy: node.querySelector(":scope > div").getBoundingClientRect().height,
            revoke: node.querySelector(":scope > button").getBoundingClientRect().height,
            alignSelf: getComputedStyle(node.querySelector(":scope > button")).alignSelf }));
          await attachJSON(testInfo, "e6-settings-single-revoke-policy", single);
          expect(single.buttons).toBe(1); expect(single.alignSelf).not.toBe("stretch");
          await expect(role).toHaveValue(raw);
        } else {
          const peers = owner.locator(".workspace-settings-card > .workspace-settings-list > li").filter({ has: page.locator("button + button") });
          await expect(peers).toHaveCount(1);
          await focus(peers.locator(":scope > button").first(), "e6-settings-verify-unactivated");
          await row(peers, ":scope > button", "e6-settings-recovery-peers");
          await focus(peers.locator(":scope > button").last(), "e6-settings-restore-unactivated");
        }
        await custody();
      } catch (error) {
        primaryFailure = error;
      } finally {
        // Keep the first reached product/assertion failure if later evidence or
        // boundary checks also fail. Every cleanup and safety check still runs.
        const retain = async (stage, run) => {
          try { await run(); } catch (error) { secondaryFailures.push(new Error(stage, { cause: error })); }
        };
        let final = null;
        await retain("E6 final fixture snapshot failed", async () => { final = await snapshot(page); });
        await retain("E6 boundary evidence attachment failed", () => attachJSON(testInfo, "e6-synthetic-boundary", {
          surface, profile: profile.name, fixture: final, apiBypasses, errors, downloads, observations, focusReturns,
          limits: "Returns are observations, not new ownership promises. Actual screen reader, touch, forced colors, reduced motion and production remain unobserved." }));
        await retain("E6 owner handle cleanup failed", async () => { await originalOwner?.dispose(); });
        await retain("E6 API bypass boundary failed", () => expect(apiBypasses, "No API bypass may reach the preview").toEqual([]));
        await retain("E6 renderer exception boundary failed", () => expect(errors, "A renderer exception is not geometry acceptance").toEqual([]));
        await retain("E6 download boundary failed", () => expect(downloads).toEqual([]));
        await retain("E6 finite request boundary failed", () => { if (final) expect(final.forbidden).toEqual([]); });
      }
      if (primaryFailure && secondaryFailures.length) throw new AggregateError([primaryFailure, ...secondaryFailures], "E6 primary failure followed by cleanup or safety failures");
      if (primaryFailure) throw primaryFailure;
      if (secondaryFailures.length) throw new AggregateError(secondaryFailures, "E6 cleanup or safety failures");
    });
});
