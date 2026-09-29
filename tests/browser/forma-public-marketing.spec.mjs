import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { test, expect, attachJSON, browserMetrics, captureViewport, openPublicMarketing } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { measureFormaFocusVisibility } from "../helpers/forma-dom-focus-visibility.mjs";
import { marketingPath } from "../../src/marketing/profiles.ts";

// One chosen physical cell per current locale/profile identity, not a Cartesian
// geometry matrix. The five original medium-gutter boundaries remain separate.
const cells = [
  ["generic", "en", { viewport: { width: 320, height: 800 }, zoom: 1 }],
  ["generic", "fr", { viewport: { width: 390, height: 844 }, zoom: 1 }],
  ["generic", "ar", { viewport: { width: 1280, height: 900 }, zoom: 1 }],
  ["generic", "ja", { viewport: { width: 1920, height: 1080 }, zoom: 1 }],
  ["marketers", "en", { viewport: { width: 1280, height: 900 }, zoom: 1 }],
  ["marketers", "fr", { viewport: null, window: { width: 838, height: 884 }, zoom: 2 }],
  ["marketers", "ar", { viewport: { width: 320, height: 800 }, zoom: 1 }],
  ["marketers", "ja", { viewport: { width: 768, height: 900 }, zoom: 1 }],
  ["hollywood-filmmakers", "en", { viewport: { width: 844, height: 390 }, zoom: 1 }],
  ["hollywood-filmmakers", "fr", { viewport: { width: 768, height: 900 }, zoom: 1 }],
  ["hollywood-filmmakers", "ar", { viewport: { width: 390, height: 844 }, zoom: 1 }],
  ["hollywood-filmmakers", "ja", { viewport: { width: 1280, height: 900 }, zoom: 1 }],
  ["indie-filmmakers", "en", { viewport: { width: 1920, height: 1080 }, zoom: 1 }],
  ["indie-filmmakers", "fr", { viewport: { width: 320, height: 800 }, zoom: 1 }],
  ["indie-filmmakers", "ar", { viewport: null, window: { width: 838, height: 884 }, zoom: 2 }],
  ["indie-filmmakers", "ja", { viewport: { width: 390, height: 844 }, zoom: 1 }],
];
const copyKeys = ["demoChangeTitle", "demoChangeDisclosure", "demoChangeBefore", "demoChangeAfter", "demoChangeAffected", "demoChangeReview", "demoChangeStatus"];
const publicOverlays = [".forma-assistant-launcher", ":popover-open", ":modal", ".marketing-header", ".marketing-motion-toggle"];
const regionSelectors = copyKeys.map(key => `[data-public-change-demo] [data-copy="${key}"]`);
const previewRegionSelectors = ["#marketing-preview-title", "[data-preview-host] [data-preview-page]:not([hidden])"];
const catalog = async (profile, locale) => ({
  ...(await import(`../../src/marketing/locales/${locale}.ts`)).default,
  ...(profile === "generic" ? {} : (await import(`../../src/marketing/profiles/${profile}/${locale}.ts`)).default),
});
// Only the two positively witnessed javaScriptEnabled:false journeys use this
// local copy of verifyFocus. Its runner-side strict polling and diagnostics are
// retained; only the unsupported in-page frame callback has been omitted.
async function verifyNoScriptFocus(page, locator, testInfo, stage, options = {}) {
  let observation;
  try {
    await expect(locator, stage).toBeFocused();
    // Wait for actual layout/placement to settle, without repairing focus or scrolling.
    await expect(async () => {
      observation = await locator.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true, ...options });
      expect(observation.failures, stage).toEqual([]);
      expect(observation.unassessed, `${stage}: unsupported geometry is not a pass`).toEqual([]);
    }).toPass({ timeout: 3_000, intervals: [50, 100, 200] });
  } finally {
    if (!observation && await locator.count() === 1) {
      observation = await locator.evaluate(measureFormaFocusVisibility, { stage, requireFocusVisible: true, ...options });
    }
    await attachJSON(testInfo, stage, observation ?? { error: "No focus observation available" });
    await captureViewport(page, testInfo, stage);
  }
  const metrics = await browserMetrics(page);
  if (metrics.documentScrollWidth > metrics.documentWidth + 1) {
    // Diagnose the actual overflowing layout without changing native focus,
    // scroll, styles, or the assertion. A clipped child is not a page owner.
    const overflow = await page.evaluate(() => {
      const describe = element => {
        const style = getComputedStyle(element), bounds = element.getBoundingClientRect();
        return {
          tag: element.tagName, id: element.id, className: element.getAttribute("class"),
          bounds: bounds.toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          display: style.display, visibility: style.visibility, position: style.position,
          overflowX: style.overflowX, overflowY: style.overflowY, contain: style.contain,
          transform: style.transform, width: style.width, minWidth: style.minWidth, maxWidth: style.maxWidth,
          left: style.left, right: style.right, boxSizing: style.boxSizing,
        };
      };
      const width = document.documentElement.clientWidth, candidates = [];
      for (const element of document.querySelectorAll("*")) {
        const item = describe(element);
        if (item.display === "none") continue;
        const pseudos = ["::before", "::after"].flatMap(pseudo => {
          const style = getComputedStyle(element, pseudo);
          return style.display !== "none" && !["none", "normal"].includes(style.content) ? [{
            pseudo, position: style.position, width: style.width, height: style.height,
            left: style.left, right: style.right, top: style.top, bottom: style.bottom,
            transform: style.transform, bounds: "unmeasured generated box",
          }] : [];
        });
        const reasons = [];
        if (item.bounds.width && (item.bounds.left < -1 || item.bounds.right > width + 1)) reasons.push("outside-layout-viewport");
        if (item.scrollWidth > item.clientWidth + 1) reasons.push("own-scroll-overflow");
        if (["absolute", "fixed"].includes(item.position)) reasons.push("out-of-flow");
        if (pseudos.length) reasons.push("generated-box");
        if (!reasons.length) continue;
        const ancestors = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push(describe(parent));
        candidates.push({ ...item, reasons, pseudos, ancestors });
      }
      return { root: describe(document.documentElement), body: describe(document.body),
        viewport: { width, scrollX, scrollY }, candidates,
        boundary: "Read-only light-DOM candidates, not proof of which box expands the root; generated-box bounds remain unmeasured." };
    });
    await attachJSON(testInfo, stage + "-horizontal-overflow", { metrics, ...overflow });
  }
  expect(metrics.documentScrollWidth, `${stage}: page has horizontal overflow`).toBeLessThanOrEqual(metrics.documentWidth + 1);
  return observation;
}
const checkFocus = async (page, locator, info, stage, extra = {}, observe = verifyFocus) => {
  const { disclosureOpen = true, ...focusOptions } = extra;
  let currentRegions = regionSelectors;
  if (!Object.hasOwn(focusOptions, "regionSelectors")) {
    const disclosure = page.locator("details[data-public-change-demo]");
    await expect(disclosure).toHaveCount(1);
    const scope = await disclosure.evaluate((owner, keys) => ({
      connected: owner.isConnected, nativeDetails: owner instanceof HTMLDetailsElement, open: owner.open,
      directSummaries: owner.querySelectorAll(":scope > summary").length,
      exactSummary: owner.querySelectorAll(':scope > summary[data-copy="demoChangeTitle"]').length,
      copy: keys.map(key => { const nodes = owner.querySelectorAll(`[data-copy="${key}"]`);
        return { key, count: nodes.length, text: nodes[0]?.textContent ?? null }; }),
    }), copyKeys);
    await attachJSON(info, stage + "-disclosure-region-scope", { ...scope, expectedOpen: disclosureOpen,
      limit: disclosureOpen ? "All seven original copy regions remain selected in the open native disclosure."
        : "Only the direct native summary paints while closed; all seven raw copy strings remain recorded, without hidden-content paint claims." });
    expect(scope.connected && scope.nativeDetails, stage + ": current native disclosure").toBe(true);
    expect(scope.open, stage + ": expected disclosure phase").toBe(disclosureOpen);
    expect(scope.directSummaries).toBe(1); expect(scope.exactSummary).toBe(1);
    for (const row of scope.copy) expect(row.count, row.key + ": unique current copy owner").toBe(1);
    if (!disclosureOpen) currentRegions = ['details[data-public-change-demo] > summary[data-copy="demoChangeTitle"]'];
  }
  const result = await observe(page, locator, info, stage, { overlaySelectors: publicOverlays, regionSelectors: currentRegions, ...focusOptions });
  expect(result.focus.raw.width, stage + ": native width floor").toBeGreaterThanOrEqual(44);
  expect(result.focus.raw.height, stage + ": native height floor").toBeGreaterThanOrEqual(44);
  const label = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element), fragments = [];
    if (["A", "SUMMARY"].includes(element.tagName)) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement?.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const item of range.getClientRects()) if (item.width > 0 && item.height > 0) fragments.push(item.toJSON());
      }
    }
    return { tag: element.tagName, text: element.textContent, ariaLabel: element.getAttribute("aria-label"),
      selected: element instanceof HTMLSelectElement ? [...element.selectedOptions].map(option => ({ value: option.value, label: option.label })) : null,
      raw: rect.toJSON(), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
      textOverflow: style.textOverflow, fragments };
  });
  await attachJSON(info, stage + "-native-label", { ...label,
    limit: "Complete native anchor/summary text Range inline bounds, not glyph ink. Native select and icon controls retain their actual selected/accessible labels without a fabricated text-rectangle model." });
  if (["A", "SUMMARY"].includes(label.tag)) {
    expect(label.textOverflow).not.toBe("ellipsis"); expect(label.fragments.length).toBeGreaterThan(0);
    expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth + 1);
    for (const fragment of label.fragments) {
      expect(fragment.left, stage + ": full label left").toBeGreaterThanOrEqual(label.raw.left - 1);
      expect(fragment.right, stage + ": full label right").toBeLessThanOrEqual(label.raw.right + 1);
    }
  }
  return result;
};

async function gutters(page, info, stage) {
  const result = await page.evaluate(() => {
    const selectors = [".marketing-header", ".marketing-hero", ".marketing-section", ".marketing-footer"];
    const rows = selectors.map(selector => {
      const element = document.querySelector(selector), rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { selector, raw: rect.toJSON(), paddingLeft: parseFloat(style.paddingLeft), paddingRight: parseFloat(style.paddingRight),
        contentLeft: rect.left + parseFloat(style.paddingLeft), contentRight: rect.right - parseFloat(style.paddingRight),
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
    });
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
      token: getComputedStyle(document.documentElement).getPropertyValue("--marketing-gutter"),
      compact: matchMedia("(min-width: 761px) and (max-width: 960px)").matches, rows,
      limit: "Physical local viewport content edges; no notched-device safe-area emulation or all-profile geometry inference." };
  });
  await attachJSON(info, stage, result);
  expect(result.scrollWidth).toBeLessThanOrEqual(result.clientWidth + 1);
  for (const row of result.rows) {
    expect(Math.abs(row.contentLeft - result.rows[0].contentLeft), row.selector + " shared left content edge").toBeLessThanOrEqual(1);
    expect(Math.abs(row.contentRight - result.rows[0].contentRight), row.selector + " shared right content edge").toBeLessThanOrEqual(1);
    expect(row.scrollWidth, row.selector + " ordinary horizontal containment").toBeLessThanOrEqual(row.clientWidth + 1);
  }
}

async function copyReceipt(page, expected, info, stage) {
  const rows = await page.locator("[data-public-change-demo]").evaluate((owner, keys) => keys.map(key => {
    const nodes = owner.querySelectorAll(`[data-copy="${key}"]`), element = nodes[0];
    if (nodes.length !== 1) return { key, count: nodes.length };
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element), range = document.createRange();
    range.selectNodeContents(element);
    const fragments = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0).map(r => r.toJSON());
    const ancestors = [];
    for (let parent = element; parent && parent !== owner.parentElement; parent = parent.parentElement) {
      const css = getComputedStyle(parent); ancestors.push({ tag: parent.tagName, display: css.display, visibility: css.visibility,
        opacity: css.opacity, hidden: parent.hidden, inert: parent.inert, ariaHidden: parent.getAttribute("aria-hidden") });
    }
    return { key, count: nodes.length, text: element.textContent, raw: rect.toJSON(), fragments,
      visibleFragments: fragments.filter(r => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth).length,
      clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace, ancestors };
  }), copyKeys);
  await attachJSON(info, stage, { rows, limit: "Complete raw copy and native Range layout boxes, not glyph-ink pixels. Vertically offscreen fragments are recorded, not certified as currently visible." });
  for (const row of rows) {
    expect(row.count, row.key).toBe(1); expect(row.text, row.key + " exact current localized copy").toBe(expected[row.key]);
    expect(row.ancestors.every(x => x.display !== "none" && x.visibility === "visible" && Number(x.opacity) > 0 && !x.hidden && !x.inert && x.ariaHidden !== "true"), row.key + " ordinary visible policy").toBe(true);
    expect(row.textOverflow, row.key + " complete copy policy").not.toBe("ellipsis");
    expect(row.scrollWidth, row.key + " own horizontal containment").toBeLessThanOrEqual(row.clientWidth + 1);
    expect(row.fragments.length, row.key + " native text layout").toBeGreaterThan(0);
  }
}

const retainPreviewCustody = page => page.evaluateHandle(() => {
  const details = [...document.querySelectorAll("details[data-output-preview]")];
  const rows = details.map(owner => { const panel = owner.querySelector("[data-preview-panel]"); return { owner, panel,
    kind: owner.dataset.outputPreview, text: panel.textContent, pages: [...panel.querySelectorAll("[data-preview-page]")],
    summary: owner.querySelector("summary"), initialSummaryText: owner.querySelector("summary").textContent }; });
  const change = document.querySelector("[data-public-change-demo]"), changeText = change.textContent;
  return { inspect: kind => ({ count: rows.length, changeSame: change.isConnected && change.textContent === changeText,
    rows: rows.map(row => ({ kind: row.kind, samePanel: row.panel.isConnected,
      expectedOwner: row.panel.parentElement === (row.kind === kind ? document.querySelector("[data-preview-host]") : row.owner),
      sameText: row.panel.textContent === row.text, sameSummary: row.summary.isConnected && row.summary.parentElement === row.owner && row.summary.textContent === row.initialSummaryText,
      pages: row.pages.map(page => ({ connected: page.isConnected, contained: row.panel.contains(page), hidden: page.hidden })) })) }) };
});
const assertCustody = async (saved, info, stage, kind = null) => {
  const result = await saved.evaluate((state, value) => state.inspect(value), kind);
  await attachJSON(info, stage, result); expect(result.count).toBe(4); expect(result.changeSame).toBe(true);
  for (const row of result.rows) {
    expect(row.samePanel && row.expectedOwner && row.sameText && row.sameSummary, row.kind + " exact panel/text owner").toBe(true);
    expect(row.pages.every(p => p.connected && p.contained), row.kind + " exact original pages").toBe(true);
    if (row.kind === kind) expect(row.pages.filter(p => !p.hidden)).toHaveLength(1);
    else expect(row.pages.every(p => !p.hidden), row.kind + " restored inline pages").toBe(true);
  }
};

for (const width of [760, 761, 900, 960, 961]) test.describe(`E8 Welcome gutter ${width}`, () => {
  test.use({ geometry: { viewport: { width, height: 900 }, zoom: 1, locale: "en" } });
  test("the actual public header and ordinary body retain the same gutter", async ({ page, context, geometry }, info) => {
    await openPublicMarketing(page, context, geometry, "generic", "en", info);
    await gutters(page, info, "e8-gutter-arrival");
    const navigation = page.locator(".marketing-navigation > a").first();
    await tabTo(page, navigation); await checkFocus(page, navigation, info, "e8-gutter-native-navigation", { disclosureOpen: false });
    const picker = page.locator("[data-language-picker] forma-ui-language-picker select");
    await tabTo(page, picker); await checkFocus(page, picker, info, "e8-gutter-native-language", { disclosureOpen: false });
    const cta = page.locator(".marketing-header__actions > a.marketing-button--header");
    await tabTo(page, cta); await checkFocus(page, cta, info, "e8-gutter-primary-unactivated", { disclosureOpen: false });
    await expect(cta).toHaveAttribute("href", "/projects"); await gutters(page, info, "e8-gutter-after");
  });
});

for (const [profile, locale, shape] of cells) test.describe(`E8 fixed walkthrough ${profile}/${locale}`, () => {
  test.use({ geometry: { ...shape, locale } });
  test("an illustrative change reaches the same native previews and returns to its own link", async ({ page, context, geometry }, info) => {
    const messages = await catalog(profile, locale), path = marketingPath(profile, locale);
    await openPublicMarketing(page, context, geometry, profile, locale, info);
    await gutters(page, info, "e8-public-arrival-gutters");
    const disclosure = page.locator("details[data-public-change-demo]"), summary = disclosure.locator(":scope > summary");
    await expect(summary).toHaveText(messages.demoChangeTitle);
    await expect(disclosure).toHaveJSProperty("open", false);
    const saved = await retainPreviewCustody(page), journeyErrors = [];
    try {
      const motion = page.locator("#main-content > .marketing-page-controls > button[data-marketing-motion-toggle]");
      await expect(motion).toHaveCount(1);
      const heldMotion = await motion.elementHandle(), motionErrors = [];
      try {
        expect(heldMotion, "current native motion button handle").not.toBeNull();
        await tabTo(page, motion);
        for (const [index, stage, key, pressed, ambient] of [
          [0, "e8-motion-running", "motionPauseLabel", "false", "on"],
          [1, "e8-motion-paused", "motionResumeLabel", "true", "off"],
          [2, "e8-motion-resumed", "motionPauseLabel", "false", "on"],
        ]) {
          if (index > 0) await page.keyboard.press("Space");
          await expect(motion).toHaveAccessibleName(messages[key]);
          await expect(motion).toHaveText(messages[key]);
          await expect(motion).toHaveAttribute("aria-pressed", pressed);
          const witness = await heldMotion.evaluate(element => {
            const main = document.querySelector("#main-content"), row = element.parentElement;
            const style = getComputedStyle(element), range = document.createRange();
            range.selectNodeContents(element);
            const fragments = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => rect.toJSON());
            range.detach();
            return { connected: element.isConnected, nativeButton: element instanceof HTMLButtonElement,
              type: element.getAttribute("type"), currentUniqueButton: document.querySelectorAll("[data-marketing-motion-toggle]").length === 1
                && document.querySelector("[data-marketing-motion-toggle]") === element,
              focused: document.activeElement === element,
              firstMainRow: row?.matches(".marketing-page-controls") && row.parentElement === main && main.firstElementChild === row,
              animatedAncestor: !!element.closest("[data-reveal], .marketing-hero"), hidden: element.hidden,
              text: element.textContent, ariaLabel: element.getAttribute("aria-label"), pressed: element.getAttribute("aria-pressed"),
              copyKey: element.getAttribute("data-copy"), ariaCopyKey: element.getAttribute("data-copy-aria"),
              ambient: document.documentElement.dataset.marketingMotion,
              reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
              pointerCoarse: matchMedia("(pointer: coarse)").matches,
              raw: element.getBoundingClientRect().toJSON(), rowRaw: row.getBoundingClientRect().toJSON(), fragments,
              clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
              clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
              textOverflow: style.textOverflow, visibility: style.visibility, opacity: style.opacity };
          });
          await attachJSON(info, stage + "-native-control", { ...witness,
            expected: { text: messages[key], key, pressed, ambient, minimum: 44 },
            limit: "Same held native button and complete text Range boxes, not glyph ink or a new coarse-pointer matrix. Native Space pauses then resumes before the original walkthrough." });
          expect(witness.connected && witness.nativeButton && witness.currentUniqueButton && witness.focused).toBe(true);
          expect(witness.type).toBe("button"); expect(witness.firstMainRow).toBe(true);
          expect(witness.animatedAncestor).toBe(false); expect(witness.hidden).toBe(false); expect(witness.reducedMotion).toBe(false);
          expect(witness.text).toBe(messages[key]); expect(witness.ariaLabel).toBe(messages[key]);
          expect(witness.copyKey).toBe(key); expect(witness.ariaCopyKey).toBe(key);
          expect(witness.pressed).toBe(pressed); expect(witness.ambient).toBe(ambient);
          expect(witness.visibility).toBe("visible"); expect(Number(witness.opacity)).toBeGreaterThan(0);
          expect(witness.textOverflow).not.toBe("ellipsis"); expect(witness.fragments.length).toBeGreaterThan(0);
          expect(witness.scrollWidth).toBeLessThanOrEqual(witness.clientWidth + 1);
          expect(witness.scrollHeight).toBeLessThanOrEqual(witness.clientHeight + 1);
          for (const fragment of witness.fragments) {
            expect(fragment.left, stage + ": complete text left").toBeGreaterThanOrEqual(witness.raw.left - 1);
            expect(fragment.right, stage + ": complete text right").toBeLessThanOrEqual(witness.raw.right + 1);
            expect(fragment.top, stage + ": complete text top").toBeGreaterThanOrEqual(witness.raw.top - 1);
            expect(fragment.bottom, stage + ": complete text bottom").toBeLessThanOrEqual(witness.raw.bottom + 1);
          }
          await checkFocus(page, motion, info, stage, { disclosureOpen: false });
          expect(await heldMotion.evaluate(element => element.isConnected && document.activeElement === element
            && document.querySelector("[data-marketing-motion-toggle]") === element), stage + ": same held native focus after capture").toBe(true);
        }
      } catch (error) { motionErrors.push(error); }
      finally {
        try { await heldMotion?.dispose(); } catch (error) { motionErrors.push(error); }
      }
      if (motionErrors.length === 1) throw motionErrors[0];
      if (motionErrors.length > 1) throw new AggregateError(motionErrors, "Native motion observation and handle cleanup failed");
      await tabTo(page, summary); await checkFocus(page, summary, info, "e8-01-illustrative-summary", { disclosureOpen: false });
      await page.keyboard.press("Enter"); await expect(disclosure).toHaveJSProperty("open", true);
      await checkFocus(page, summary, info, "e8-02-open-summary");
      await copyReceipt(page, messages, info, "e8-02-full-illustrative-copy");
      await expect(disclosure.locator(":scope > p.context-demo__disclaimer")).toHaveText(messages.demoChangeDisclosure);
      await expect(disclosure.locator("bdi[data-copy=creativeBoundaryValue]")).toHaveText(messages.creativeBoundaryValue);
      const dialog = page.locator("dialog[data-marketing-preview-dialog]:modal"), close = page.locator("[data-marketing-preview-dialog] [data-preview-close]");
      for (const [index, kind, title] of [[0, "story", messages.storyHeading], [1, "presentation", messages.slideTitle]]) {
        const link = disclosure.locator(`a[data-demo-preview="${kind}"]`), owner = page.locator(`details[data-output-preview="${kind}"]`);
        await expect(link).toHaveAttribute("href", `#example-${kind}-preview`); await expect(link.locator("bdi")).toHaveText(title);
        await expect(owner.locator(":scope > summary")).toHaveAttribute("id", `example-${kind}-preview`);
        await tabTo(page, link); await checkFocus(page, link, info, `e8-${kind}-link`);
        await copyReceipt(page, messages, info, `e8-${kind}-copy-before`);
        await page.keyboard.press("Enter"); await expect(dialog).toHaveCount(1);
        await expect(page.locator("dialog:modal")).toHaveCount(1);
        await expect(close).toHaveAccessibleName(messages.previewClose);
        await checkFocus(page, close, info, `e8-${kind}-native-close`, { regionSelectors: previewRegionSelectors });
        const pages = dialog.locator(`[data-preview-panel="${kind}"] [data-preview-page]`), count = await pages.count();
        expect(count).toBeGreaterThan(1); await expect(pages.nth(0)).toBeVisible();
        await assertCustody(saved, info, `e8-${kind}-same-panel-open`, kind);
        await page.keyboard.press("PageDown"); await expect(pages.nth(1)).toBeVisible();
        await checkFocus(page, close, info, `e8-${kind}-native-page-forward`, { regionSelectors: previewRegionSelectors });
        await page.keyboard.press("Home"); await expect(pages.nth(0)).toBeVisible();
        await page.keyboard.press(locale === "ar" ? "ArrowLeft" : "ArrowRight"); await expect(pages.nth(1)).toBeVisible();
        await page.keyboard.press("End"); await expect(pages.nth(count - 1)).toBeVisible();
        await checkFocus(page, close, info, `e8-${kind}-native-last-page`, { regionSelectors: previewRegionSelectors });
        if (index === 0) await page.keyboard.press("Escape"); else await page.keyboard.press("Enter");
        await expect(dialog).toHaveCount(0); await checkFocus(page, link, info, `e8-${kind}-same-invoker-return`);
        await assertCustody(saved, info, `e8-${kind}-restored-original-pages`);
        expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(path);
      }
      // A real modified pointer gesture keeps native new-tab intent. It never
      // fabricates a ClickEvent or overrides the app controller/native methods.
      if (profile === "generic" && locale === "en") {
        const story = disclosure.locator('a[data-demo-preview="story"]');
        await tabTo(page, story, 80, "Shift+Tab"); await checkFocus(page, story, info, "e8-modified-link-before");
        const origin = new URL(page.url()).origin, expectedURL = origin + path + "#example-story-preview";
        const root = await realpath(new URL("../../", import.meta.url));
        const receiptSetting = process.env.FORMA_A11Y_PUBLIC_PREVIEW_RECEIPTS;
        expect(receiptSetting, "This public variant must bind its owned preview receipts").toBeTruthy();
        expect(isAbsolute(receiptSetting)).toBe(true);
        const receiptDirectory = await realpath(receiptSetting);
        expect(receiptDirectory).toBe(resolve(receiptSetting));
        const manifestBytes = await readFile(resolve(receiptDirectory, "../manifest.json"));
        const manifest = JSON.parse(manifestBytes), hash = bytes => createHash("sha256").update(bytes).digest("hex");
        const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        const [htmlBytes, workerBytes, helperBytes] = await Promise.all([
          readFile(resolve(root, "marketing.html")), readFile(resolve(root, "dist/server/index.js")),
          readFile(resolve(root, "tests/browser/helpers/public-marketing-network.mjs")),
        ]);
        expect(manifest).toMatchObject({ schema: "forma-public-preview-session-r1", root, origin, receiptDirectory,
          source: { html: "marketing.html", htmlSha256: hash(htmlBytes), htmlBytes: htmlBytes.length,
            worker: "dist/server/index.js", workerSha256: hash(workerBytes), workerBytes: workerBytes.length },
          helperPath: resolve(root, "tests/browser/helpers/public-marketing-network.mjs"), helperSha256: hash(helperBytes) });
        expect(manifest.servingSessionId).toMatch(uuid);
        expect(Number.isSafeInteger(manifest.pid) && manifest.pid > 0).toBe(true);
        expect(manifest.allowedDocuments.filter(item => item.path === path)).toEqual([{ path, profile, locale }]);
        expect(hash(JSON.stringify(manifest.source.serverTree))).toBe(manifest.source.serverTreeSha256);
        expect(manifest.source.serverTree).toContainEqual({ path: "dist/server/index.js", bytes: workerBytes.length, sha256: hash(workerBytes) });
        const responses = [], popupErrors = [];
        const onResponse = response => {
          const request = response.request();
          if (request.isNavigationRequest() && request.resourceType() === "document") responses.push(response);
        };
        let other, popupDocument;
        context.on("response", onResponse);
        try {
          const opened = context.waitForEvent("page");
          const [clicked, created] = await Promise.allSettled([story.click({ modifiers: ["ControlOrMeta"] }), opened]);
          if (created.status === "fulfilled") other = created.value;
          const gestureErrors = [clicked, created].filter(result => result.status === "rejected").map(result => result.reason);
          if (gestureErrors.length === 1) throw gestureErrors[0];
          if (gestureErrors.length > 1) throw new AggregateError(gestureErrors, "Modified click failed; page-wait error follows");
          expect(other).not.toBe(page); expect(other.context()).toBe(context);
          await other.waitForURL(expectedURL, { waitUntil: "domcontentloaded" });
          await other.waitForLoadState("domcontentloaded");
          await expect(other.locator("html")).toHaveAttribute("lang", locale);
          await expect(other.locator("html")).toHaveAttribute("dir", "ltr");
          await expect(other.locator("html")).toHaveAttribute("data-forma-experience", "marketing");
          await expect(other.locator("body")).toHaveAttribute("data-marketing-profile", profile);
          await expect(other.locator('link[rel="canonical"]')).toHaveAttribute("href", path);
          await expect(other.locator("forma-shell,.consent-modal,dialog:modal")).toHaveCount(0);
          await expect(other.locator("details[data-public-change-demo]")).toHaveCount(1);
          await expect(other.locator("details[data-output-preview]")).toHaveCount(4);
          await expect(other.locator("dialog#marketing-preview[data-marketing-preview-dialog]")).toHaveCount(1);
          const picker = other.locator("[data-language-picker] forma-ui-language-picker select");
          await expect(picker).toHaveValue(locale); await expect(picker).toBeEnabled();
          for (const kind of ["story", "presentation"]) {
            const link = other.locator('[data-public-change-demo] a[data-demo-preview="' + kind + '"]');
            await expect(link).toHaveAttribute("aria-controls", "marketing-preview");
            await expect(link).toHaveAttribute("aria-haspopup", "dialog");
          }
          const target = other.locator('details[data-output-preview="story"] > summary#example-story-preview');
          await expect(target).toHaveCount(1); await expect(target).toHaveAccessibleName(messages.previewStoryAction);
          popupDocument = await other.evaluateHandle(() => document);
          const initial = await other.evaluate(keys => {
            const target = document.querySelector('details[data-output-preview="story"] > summary#example-story-preview');
            const owner = target.parentElement, panel = owner.querySelector(':scope > article[data-preview-panel="story"]');
            return {
              url: location.href, readyState: document.readyState, title: document.title,
              language: document.documentElement.lang, direction: document.documentElement.dir,
              profile: document.body.dataset.marketingProfile, experience: document.documentElement.dataset.formaExperience,
              fragment: { id: target.id, tag: target.tagName, connected: target.isConnected,
                isTarget: target.matches(":target"), nativeOwner: owner instanceof HTMLDetailsElement,
                directSummary: owner.querySelector(":scope > summary") === target,
                ownerOpen: owner.open, sameInlinePanel: Boolean(panel && panel.parentElement === owner),
                pages: panel ? [...panel.querySelectorAll("[data-preview-pages] > section[data-preview-page]")].map(page => ({
                  kind: page.dataset.previewPage, connected: page.isConnected, hidden: page.hidden,
                })) : [], panelCopy: panel ? [...panel.querySelectorAll("[data-copy]")].map(node => ({
                  key: node.dataset.copy, text: node.textContent,
                })) : [], dialogHostChildren: document.querySelector("[data-preview-host]").childElementCount },
              active: { tag: document.activeElement?.tagName ?? null, id: document.activeElement?.id ?? null },
              copy: keys.map(key => { const nodes = document.querySelectorAll('[data-public-change-demo] [data-copy="' + key + '"]');
                return { key, count: nodes.length, text: nodes[0]?.textContent ?? null }; }),
              navigation: performance.getEntriesByType("navigation").map(entry => ({
                name: entry.name, type: entry.type, redirectCount: entry.redirectCount,
                encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize,
                serverTiming: entry.serverTiming.map(metric => ({ name: metric.name, duration: metric.duration, description: metric.description })),
              })),
            };
          }, copyKeys);
          // This cutoff follows the actual initial DOM and controller readiness.
          // It does not infer that an unobserved response never existed.
          const observed = responses.filter(response => response.request().frame() === other.mainFrame());
          expect(observed.length, "Exactly zero or one initial popup document response may be observed").toBeLessThanOrEqual(1);
          expect(initial.url).toBe(expectedURL); expect(["interactive", "complete"]).toContain(initial.readyState);
          expect(initial.fragment).toMatchObject({ id: "example-story-preview", tag: "SUMMARY", connected: true,
            isTarget: true, nativeOwner: true, directSummary: true, sameInlinePanel: true, dialogHostChildren: 0 });
          expect(initial.fragment.pages).toEqual(Array.from({ length: 3 }, () => ({ kind: "story", connected: true, hidden: false })));
          expect(initial.fragment.panelCopy.map(row => row.key)).toEqual(["formatStory", "storyHeading",
            "previewStoryPartOne", "previewStoryParagraphOne", "previewStoryParagraphTwo",
            "previewStoryPartTwo", "previewStoryParagraphThree", "previewStoryParagraphFour",
            "previewStoryPartThree", "previewStoryParagraphFive", "previewStoryParagraphSix"]);
          for (const row of initial.fragment.panelCopy) expect(row.text, row.key).toBe(messages[row.key]);
          for (const row of initial.copy) { expect(row.count, row.key).toBe(1); expect(row.text, row.key).toBe(messages[row.key]); }
          expect(initial.navigation).toHaveLength(1);
          const navigation = initial.navigation[0], navigationURL = new URL(navigation.name);
          expect(navigationURL.origin + navigationURL.pathname + navigationURL.search).toBe(origin + path);
          expect(["", "#example-story-preview"]).toContain(navigationURL.hash);
          expect(navigation.type).toBe("navigate"); expect(navigation.redirectCount).toBe(0);
          const timing = navigation.serverTiming.filter(metric => metric.name === "forma-public-ssr");
          let observedResponse = null, serverReceipt = null;
          if (observed.length === 1) {
            const response = observed[0], request = response.request(), headers = await response.allHeaders();
            const bytes = await response.body();
            observedResponse = { url: response.url(), status: response.status(), headers, method: request.method(),
              redirected: request.redirectedFrom() !== null, bodySha256: hash(bytes), bodyBytes: bytes.length };
            await attachJSON(info, "e8-modified-initial-response", observedResponse);
            const responseURL = new URL(observedResponse.url);
            expect(responseURL.origin + responseURL.pathname + responseURL.search + responseURL.hash).toBe(origin + path);
            expect(observedResponse).toMatchObject({ status: 200, method: "GET", redirected: false,
              bodySha256: hash(htmlBytes), bodyBytes: htmlBytes.length,
              headers: { "x-forma-route-family": "marketing", "content-language": locale } });
            expect(headers["content-type"]).toMatch(/^text\/html(?:;|$)/i);
            expect(headers["set-cookie"]).toBeUndefined();
            const hasReceiptMetric = /(?:^|,)\s*forma-public-ssr(?:\s*[;,]|\s*$)/i.test(headers["server-timing"] ?? "");
            expect(timing).toHaveLength(hasReceiptMetric ? 1 : 0);
          } else {
            expect(timing, "Missing response requires positive native initial-navigation receipt identity").toHaveLength(1);
          }
          if (timing.length === 1) {
            const id = timing[0].description; expect(id).toMatch(uuid);
            const receiptPath = resolve(receiptDirectory, id + ".json");
            expect(await realpath(receiptPath)).toBe(receiptPath);
            const receiptBytes = await readFile(receiptPath), receipt = JSON.parse(receiptBytes);
            serverReceipt = { path: receiptPath, sha256: hash(receiptBytes), receipt };
            await attachJSON(info, "e8-modified-server-receipt", serverReceipt);
            expect(receipt).toMatchObject({ schema: "forma-public-preview-ssr-r1", id,
              servingSessionId: manifest.servingSessionId, pid: manifest.pid,
              request: { method: "GET", origin, path, hasQuery: false }, source: manifest.source,
              helperSha256: hash(helperBytes), response: { status: 200, bodySha256: hash(htmlBytes), bodyBytes: htmlBytes.length },
              call: { method: "GET", origin, path, resourceType: "document", profile, locale, status: 200,
                routeFamily: "marketing", contentLanguage: locale, completed: true,
                assets: [{ origin, path: "/marketing", method: "GET" }], bindingsDenied: [],
                renderedSha256: hash(htmlBytes), renderedBytes: htmlBytes.length },
              nodeFetchBoundary: { preloadPresent: true, functionSourceMatches: true, preImportVerified: true } });
            expect(receipt.source).toEqual(manifest.source);
            expect(receipt.nodeFetchBoundary.path).toBe(manifest.nodeFetchBoundary.path);
            expect(receipt.nodeFetchBoundary.sha256).toBe(manifest.nodeFetchBoundary.sha256);
            expect(receipt.nodeFetchBoundary.checks.length).toBeGreaterThan(0);
            expect(receipt.nodeFetchBoundary.checks.every(check => check.identityPreserved && check.htmlAndBuiltServerTreeUnchanged)).toBe(true);
            expect(receipt.nodeFetchBoundary.checks.at(-1).phase).toBe("after-worker-SSR");
            const headers = receipt.response.originalHeaders, metric = 'forma-public-ssr;desc="' + id + '"';
            expect(headers).toMatchObject({ "x-forma-route-family": "marketing", "content-language": locale });
            expect(headers["content-type"]).toMatch(/^text\/html(?:;|$)/i); expect(headers["set-cookie"]).toBeUndefined();
            expect(/(?:^|,)\s*forma-public-ssr(?:\s*[;,]|\s*$)/i.test(headers["server-timing"] ?? "")).toBe(false);
            const servedTiming = headers["server-timing"] ? headers["server-timing"] + ", " + metric : metric;
            expect(receipt.response.headerDelta).toEqual({ "server-timing": metric });
            expect(receipt.response.servedHeaders).toEqual({ ...headers, "server-timing": servedTiming });
            if (observedResponse) {
              expect(observedResponse.headers["server-timing"]).toBe(servedTiming);
              expect(observedResponse.bodySha256).toBe(receipt.response.bodySha256);
              expect(observedResponse.bodyBytes).toBe(receipt.response.bodyBytes);
            }
          }
          if (navigation.decodedBodySize > 0) expect(navigation.decodedBodySize).toBe(htmlBytes.length);
          const contentEncoding = observedResponse?.headers["content-encoding"] ?? serverReceipt?.receipt.response.servedHeaders["content-encoding"];
          if (navigation.encodedBodySize > 0 && !contentEncoding) expect(navigation.encodedBodySize).toBe(htmlBytes.length);
          await attachJSON(info, "e8-modified-native-fragment", { original: page.url(), opened: other.url(),
            method: "native ControlOrMeta pointer activation",
            deliveryMode: observedResponse ? serverReceipt ? "observed-initial-response-and-server-receipt" : "observed-initial-response"
              : "native-navigation-server-receipt",
            observedInitialResponsesAtReadyCutoff: observed.length,
            manifest: { path: resolve(receiptDirectory, "../manifest.json"), sha256: hash(manifestBytes), ...manifest },
            observedResponse, serverReceipt, initial,
            limit: "Exact generic/en initial public document and native fragment DOM. A timing-only branch binds the received navigation UUID to server-rendered bytes; it does not independently hash browser response-body bytes. Raw closed-details copy is retained without a hidden-copy paint claim. Popup foreground focus, permanent geometry and preview-process terminal admission are not inferred." });
          await captureViewport(other, info, "e8-modified-native-fragment");
          expect(await popupDocument.evaluate(previous => previous === document), "Same initial popup document through capture").toBe(true);
          expect(other.url()).toBe(expectedURL);
          const afterResponses = responses.filter(response => response.request().frame() === other.mainFrame());
          expect(afterResponses.length).toBe(observed.length);
          for (const [index, response] of afterResponses.entries()) expect(response).toBe(observed[index]);
          expect(await readFile(resolve(receiptDirectory, "../manifest.json"))).toEqual(manifestBytes);
          if (serverReceipt) expect(hash(await readFile(serverReceipt.path))).toBe(serverReceipt.sha256);
        } catch (error) { popupErrors.push(error); }
        finally {
          context.off("response", onResponse);
          try { await popupDocument?.dispose(); } catch (error) { popupErrors.push(error); }
          try { await other?.close(); } catch (error) { popupErrors.push(error); }
        }
        if (popupErrors.length === 1) throw popupErrors[0];
        if (popupErrors.length > 1) throw new AggregateError(popupErrors, "Native popup proof failed; cleanup errors follow the primary error");
        await expect(page.locator("dialog:modal")).toHaveCount(0); await assertCustody(saved, info, "e8-modified-owner-retained");
      }
      await copyReceipt(page, messages, info, "e8-final-copy-custody");
      await captureViewport(page, info, "e8-final");
    } catch (error) { journeyErrors.push(error); }
    finally {
      try { await saved.dispose(); } catch (error) { journeyErrors.push(error); }
    }
    if (journeyErrors.length === 1) throw journeyErrors[0];
    if (journeyErrors.length > 1) throw new AggregateError(journeyErrors, "Public native journey failed; custody cleanup error follows");
  });
});

for (const locale of ["en", "ar"]) test.describe(`E8 native fragment fallback ${locale}`, () => {
  test.use({ publicJavaScript: false, geometry: { viewport: { width: 390, height: 844 }, zoom: 1, locale } });
  test("without enhancement the exact fragment reaches the original native disclosure", async ({ page, context, geometry, publicMarketing, publicJavaScript }, info) => {
    expect(publicMarketing, "Fallback uses the public context fixture").toBe(true);
    expect(publicJavaScript, "Fallback context must actually disable script execution").toBe(false);
    expect(page.context()).toBe(context);
    await attachJSON(info, "e8-fallback-context", { publicMarketing, publicJavaScript,
      mechanism: "Effective fixtures used by launchPersistentContext to set javaScriptEnabled:false; same owned page/context",
      limit: "Native script-disabled execution, not an injected showModal failure or a temporary style/script override." });
    const messages = await catalog("generic", locale);
    const checkNativeFocus = (target, stage, extra = {}) => checkFocus(page, target, info, stage, extra, verifyNoScriptFocus);
    await openPublicMarketing(page, context, geometry, "generic", locale, info, { enhanced: false });
    const change = page.locator("details[data-public-change-demo]"), summary = change.locator(":scope > summary");
    await tabTo(page, summary); await checkNativeFocus(summary, "e8-fallback-summary", { disclosureOpen: false });
    await page.keyboard.press("Enter"); await expect(change).toHaveJSProperty("open", true);
    await copyReceipt(page, messages, info, "e8-fallback-full-copy");
    const link = change.locator('a[data-demo-preview="story"]'), target = page.locator("#example-story-preview");
    const owner = page.locator('details[data-output-preview="story"]');
    const saved = await retainPreviewCustody(page);
    try {
      await tabTo(page, link); await checkNativeFocus(link, "e8-fallback-exact-link");
      await page.keyboard.press("Enter"); await expect(page).toHaveURL(new RegExp(`/welcome/${locale}#example-story-preview$`));
      await checkNativeFocus(target, "e8-fallback-native-fragment-summary");
      await page.keyboard.press("Enter"); await expect(owner).toHaveJSProperty("open", true);
      await checkNativeFocus(target, "e8-fallback-inline-open");
      await expect(owner.locator(":scope > [data-preview-panel=story]")).toBeVisible();
      await expect(page.locator("dialog:modal")).toHaveCount(0); await assertCustody(saved, info, "e8-fallback-original-owner");
      await page.keyboard.press("Enter"); await expect(owner).toHaveJSProperty("open", false);
      await checkNativeFocus(target, "e8-fallback-native-close");
      await tabTo(page, link, 80, "Shift+Tab"); await checkNativeFocus(link, "e8-fallback-link-reachable");
      await assertCustody(saved, info, "e8-fallback-closed-custody");
    } finally { await saved.dispose(); }
    await attachJSON(info, "e8-fallback-boundary", { enhanced: false, mechanism: "context javaScriptEnabled:false with current Worker-rendered source document, genuine native details/summary and fragment navigation", limit: "Progressive native fallback only; not an injected unsupported/throwing showModal result." });
  });
});
