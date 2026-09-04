import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { documentPath, waitForExistingDocument, savedArticles, tabTo, verifyFocus, pressTo } from "./helpers/keyboard-journey.mjs";

// Supplement only after the retained unfiltered 73-case baseline/candidate cycle.
// Real source entry/Store, existing finite transport, native controls and zoom.
// No new events, saved names, collection fixtures, rights or provider actions.
const profiles = [
  { name: "EN coarse 390", geometry: { viewport: { width: 390, height: 844 }, zoom: 1, hasTouch: true }, language: "en-US" },
  { name: "FR true 200", geometry: { viewport: null, window: { width: 838, height: 884 }, zoom: 2, locale: "fr" }, language: "fr" },
  { name: "AR coarse 320", geometry: { viewport: { width: 320, height: 800 }, zoom: 1, locale: "ar", hasTouch: true }, language: "ar" },
  { name: "JA 768", geometry: { viewport: { width: 768, height: 900 }, zoom: 1, locale: "ja" }, language: "ja" },
];
const copy = {
  en: { rename: "Rename Atmosphere studies", name: "Document name", cancel: "Cancel", save: "Save name", clear: "Clear filter", direction: "ltr" },
  fr: { rename: "Renommer Atmosphere studies", name: "Nom du document", cancel: "Annuler", save: "Enregistrer le nom", clear: "Effacer le filtre", direction: "ltr" },
  ar: { rename: "إعادة تسمية Atmosphere studies", name: "اسم المستند", cancel: "إلغاء", save: "حفظ الاسم", clear: "مسح عامل التصفية", direction: "rtl" },
  ja: { rename: "Atmosphere studies の名前を変更", name: "ドキュメント名", cancel: "キャンセル", save: "名前を保存", clear: "フィルターをクリア", direction: "ltr" },
};
const documentHeaderObstacles = [".topbar",
  '.workspace-page[data-workbench="document"] > forma-project-rail',
  '.workspace-page[data-workbench="document"] > .studio-main > .studio-header-stack > forma-studio-mode-nav > .studio-mode-nav'];
const options = { overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ...documentHeaderObstacles],
  regionSelectors: [".output-recipe-entry", ".output-requirement-warning", "forma-ui-notice"], checkVisibleControls: true };
const retainedTitle = "Atmosphere studies";
const rawName = "  Café e\u0301 العربية 日本語 — unsent name  ";
const libraryPath = "/library?document=doc-atmosphere";
const clearSelector = ".library-main > .library-body > .collection-filter > button.button.ghost.compact";

async function profileWitness(page, geometry, expected, testInfo) {
  await expect(page.locator("html")).toHaveAttribute("lang", geometry.locale ?? "en-US");
  await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
  await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue((geometry.locale ?? "en").split("-")[0]);
  const measured = await page.evaluate(() => ({ language: document.documentElement.lang, direction: document.documentElement.dir,
    pointerCoarse: matchMedia("(pointer: coarse)").matches, hoverNone: matchMedia("(hover: none)").matches,
    maxTouchPoints: navigator.maxTouchPoints, targetToken: getComputedStyle(document.documentElement).getPropertyValue("--forma-control-min-size").trim() }));
  if (geometry.hasTouch) {
    expect(measured.pointerCoarse).toBe(true);
    expect(measured.maxTouchPoints).toBeGreaterThan(0);
  }
  await attachJSON(testInfo, "e7-profile", { ...measured,
    limits: "Chromium native geometry with declared touch capability; not a physical device or AT result. E7 owners retain their declared 44px floor; 48px is not declared for these controls." });
}

async function retainSource(owner) {
  return owner.evaluateHandle(element => {
    const store = element.store;
    if (!store?.events?.get || !store?.projection?.get || !store?.head?.get) throw new Error("Current component owner Store required for nonvacuous custody");
    const read = () => {
      const projection = store.projection.get();
      return { events: JSON.stringify(store.events.get()), eventCount: store.events.get().length, head: store.head.get(), projectId: projection.projectId,
        documentId: projection.documentId, documentTitle: projection.documentTitle,
        membership: JSON.stringify(projection.membership), collections: JSON.stringify(projection.collections), selectedOutputId: store.ui.selectedOutputId,
        libraryView: store.ui.libraryView, libraryOutputScope: store.ui.libraryOutputScope };
    };
    const original = read();
    return { original, inspect: () => ({ sameOwner: element.isConnected && element.store === store,
      raw: read(), focusCollectionId: store.ui.focusCollectionId, route: location.href }) };
  });
}
async function verifyCustody(saved, testInfo, stage) {
  const result = await saved.evaluate(state => ({ original: state.original, ...state.inspect() }));
  await attachJSON(testInfo, stage, result);
  expect(result.sameOwner).toBe(true);
  expect(result.original.eventCount).toBeGreaterThan(0);
  expect(result.original.head).toBeGreaterThan(0);
  expect(JSON.parse(result.original.events)).toHaveLength(result.original.eventCount);
  expect(JSON.parse(result.original.collections).find(item => item.id === "collection-studio")).toMatchObject({ id: "collection-studio", handle: "studio-launch" });
  expect(result.original.projectId).toBe("project-atmosphere");
  expect(result.original.documentId).toBe("doc-atmosphere");
  expect(result.original.documentTitle).toBe(retainedTitle);
  expect(result.raw).toEqual(result.original);
  return result;
}
async function finish(primaryError, ...handles) {
  const errors = primaryError ? [primaryError] : [];
  for (const handle of handles) try { await handle?.dispose(); } catch (error) { errors.push(error); }
  if (errors.length > 1) throw new AggregateError(errors, "E7 observation and custody cleanup failed");
  if (errors.length) throw errors[0];
}
async function retainRenameForm(form) {
  return form.evaluateHandle(element => {
    const field = element.querySelector(":scope > input#document-title-input");
    const cancel = element.querySelector(':scope > button[type="button"]'), save = element.querySelector(':scope > button[type="submit"]');
    const label = element.querySelector(':scope > label[for="document-title-input"]');
    if (!(element instanceof HTMLFormElement) || !(field instanceof HTMLInputElement)
      || !(cancel instanceof HTMLButtonElement) || !(save instanceof HTMLButtonElement) || !(label instanceof HTMLLabelElement))
      throw new Error("Require current native Rename form, field, label and two buttons");
    return { inspect: () => ({ connected: [element, field, cancel, save, label].map(node => node.isConnected),
      sameCurrentForm: document.querySelector("forma-workspace .document-title-editor") === element,
      sameCurrentControls: [...element.elements].length === 3 && [...element.elements].every((node, index) => node === [field, cancel, save][index]),
      controlTags: [...element.elements].map(node => node.tagName),
      ownedForms: [field, cancel, save].map(control => control.form === element),
      uniqueInputId: document.querySelectorAll('[id="document-title-input"]').length,
      associatedLabel: label.control === field && label.htmlFor === field.id && field.labels.length === 1 && field.labels[0] === label,
      value: field.value, maxLength: field.maxLength, labelRaw: label.textContent,
      buttonsRaw: [cancel.textContent, save.textContent] }) };
  });
}
async function verifyRenameForm(handle, rawValue, expected, testInfo, stage) {
  const witness = await handle.evaluate(state => state.inspect());
  await attachJSON(testInfo, stage, witness);
  expect(witness).toMatchObject({ connected: [true, true, true, true, true], sameCurrentForm: true, sameCurrentControls: true,
    controlTags: ["INPUT", "BUTTON", "BUTTON"], ownedForms: [true, true, true], uniqueInputId: 1,
    associatedLabel: true, value: rawValue, maxLength: 80, labelRaw: expected.name });
  expect(witness.buttonsRaw.map(text => text.trim())).toEqual([expected.cancel, expected.save]);
}

async function retainLibraryNativeRail(collection, expectedTarget) {
  return collection.evaluateHandle((element, targetId) => {
    const rail = element.closest("forma-project-rail"), library = rail?.closest("forma-library");
    const panel = element.closest(".rail-content[popover]"), tree = element.closest("forma-collection-tree");
    const trigger = rail?.querySelector(":scope > .project-rail > .rail-toolbar > .rail-collapse-toggle");
    if (!(element instanceof HTMLButtonElement) || !(trigger instanceof HTMLButtonElement)
      || !rail || !library || !panel || !tree || !targetId) throw new Error("Require actual Library native rail owners");
    return { inspect: () => ({
      sameLibraryRail: library.isConnected && rail.isConnected && library.querySelector("forma-project-rail") === rail,
      samePanel: panel.isConnected && rail.querySelector(":scope > .project-rail > .rail-content[popover]") === panel,
      sameTrigger: trigger.isConnected && rail.querySelector(":scope > .project-rail > .rail-toolbar > .rail-collapse-toggle") === trigger,
      nativeRelation: trigger.popoverTargetElement === panel && trigger.getAttribute("popovertarget") === targetId
        && trigger.getAttribute("aria-controls") === targetId && panel.id === targetId && panel.popover === "auto"
        && document.querySelectorAll(`[id="${CSS.escape(targetId)}"]`).length === 1,
      open: panel.matches(":popover-open"), expanded: trigger.getAttribute("aria-expanded"),
      collectionCurrent: element.isConnected && panel.contains(element) && panel.querySelector("forma-collection-tree") === tree
        && tree.querySelector('.collection-tree > li[data-collection-id="collection-studio"] > .tree-row > button.tree-name') === element,
      collectionRaw: element.textContent, collectionFocused: document.activeElement === element,
      collectionConnected: element.isConnected, treeConnected: tree.isConnected,
      currentTreeAbsent: panel.querySelector("forma-collection-tree") === null,
      triggerFocused: document.activeElement === trigger,
      collectionCurrentMarker: element.getAttribute("aria-current"), targetId,
    }) };
  }, expectedTarget);
}
async function verifyLibraryNativeRail(handle, testInfo, stage, open) {
  const witness = await handle.evaluate(state => state.inspect());
  await attachJSON(testInfo, stage, { ...witness,
    scope: open ? "At stage02 the entire other-control inventory is UNOBSERVED, including rail siblings and background; the focused native target, overlays and named regions stay strict."
      : "Source-owned collection selection dismissed the native panel and retired its lazy tree; no Escape or persistent selected menu item is inferred. All closed-state control and overlay checks remain active." });
  expect(witness).toMatchObject({ sameLibraryRail: true, samePanel: true, sameTrigger: true,
    nativeRelation: true, open, expanded: String(open), collectionRaw: "studio-launch" });
  if (open) expect(witness).toMatchObject({ collectionCurrent: true, collectionFocused: true,
    collectionConnected: true, treeConnected: true, currentTreeAbsent: false, triggerFocused: false });
  else expect(witness).toMatchObject({ collectionCurrent: false, collectionFocused: false,
    collectionConnected: false, treeConnected: false, currentTreeAbsent: true, triggerFocused: true });
  return witness;
}

// Read only the actual native controls. Fields keep their raw value separately;
// button text uses complete Range rectangles, including vertical fit.
function controlRow(element, selector) {
  const box = node => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const ownerBox = box(element), style = getComputedStyle(element), root = getComputedStyle(document.documentElement);
  const rootSize = parseFloat(root.fontSize), length = value => value.endsWith("rem") ? parseFloat(value) * rootSize : value.endsWith("px") ? parseFloat(value) : NaN;
  const floor = length(root.getPropertyValue("--forma-control-min-size").trim());
  const supporting = length(root.getPropertyValue("--forma-font-size-supporting").trim());
  const controls = [...element.querySelectorAll(selector)].map(control => {
    const s = getComputedStyle(control), raw = box(control), fragments = [], words = [], text = control.tagName === "BUTTON" ? control.textContent : null;
    if (text !== null) {
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim() || node.parentElement.closest("[aria-hidden='true'],svg,.forma-icon")) continue;
        const parentStyle = getComputedStyle(node.parentElement), range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) fragments.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom,
          visible: node.parentElement.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
          overflowX: parentStyle.overflowX, overflowY: parentStyle.overflowY, textOverflow: parentStyle.textOverflow, lineClamp: parentStyle.webkitLineClamp });
        range.detach();
        // Latin/Arabic ordinary words are indivisible; Japanese line breaking
        // does not use this whitespace-delimited word criterion.
        for (const match of node.textContent.matchAll(/[\p{Script=Latin}\p{M}]+|[\p{Script=Arabic}\p{M}]+/gu)) {
          const word = document.createRange(); word.setStart(node, match.index); word.setEnd(node, match.index + match[0].length);
          const rects = [...word.getClientRects()].filter(r => r.width > 0 && r.height > 0);
          words.push({ text: match[0], lineTops: [...new Set(rects.map(r => r.top))] }); word.detach();
        }
      }
    }
    return { tag: control.tagName, type: control.type, raw, text, value: control.value,
      clientWidth: control.clientWidth, scrollWidth: control.scrollWidth, fragments, words,
      fontSize: parseFloat(s.fontSize), lineHeight: parseFloat(s.lineHeight), display: s.display,
      visibility: s.visibility, opacity: s.opacity, overflowX: s.overflowX, overflowY: s.overflowY,
      textOverflow: s.textOverflow, lineClamp: s.webkitLineClamp };
  });
  return { owner: ownerBox, direction: style.direction, flexWrap: style.flexWrap, gap: parseFloat(style.columnGap), floor, supporting, controls };
}
function rowVerdict(row, expectedLabels, peers) {
  const failures = [], epsilon = 1 / 64;
  if (!(row.floor >= 44)) failures.push("missing-current-target-token");
  const buttons = row.controls.filter(control => control.tag === "BUTTON");
  if (JSON.stringify(buttons.map(control => control.text.trim())) !== JSON.stringify(expectedLabels)) failures.push("incomplete-or-replaced-native-labels");
  for (const control of row.controls) {
    if (control.raw.width + epsilon < row.floor || control.raw.height + epsilon < row.floor) failures.push("native-body-below-current-floor");
    if (control.raw.left < row.owner.left - epsilon || control.raw.right > row.owner.right + epsilon) failures.push("native-control-outside-owner-inline-box");
    if (control.tag !== "BUTTON") continue;
    if (!control.fragments.length || control.display === "none" || control.visibility !== "visible" || Number(control.opacity) !== 1
      || ["hidden", "clip"].includes(control.overflowX) || ["hidden", "clip"].includes(control.overflowY)
      || control.textOverflow === "ellipsis" || control.lineClamp !== "none") failures.push("hidden-or-truncated-native-label");
    for (const r of control.fragments) if (!r.visible || ["hidden", "clip"].includes(r.overflowX) || ["hidden", "clip"].includes(r.overflowY)
      || r.textOverflow === "ellipsis" || r.lineClamp !== "none" || r.left < control.raw.left - epsilon || r.right > control.raw.right + epsilon
      || r.top < control.raw.top - epsilon || r.bottom > control.raw.bottom + epsilon) failures.push("label-fragment-not-wholly-in-native-body");
    for (const word of control.words) if (word.lineTops.length !== 1) failures.push("ordinary-short-word-split");
  }
  if (peers) for (let first = 0; first < row.controls.length; first += 1) for (let second = first + 1; second < row.controls.length; second += 1) {
    const a = row.controls[first].raw, b = row.controls[second].raw;
    if (Math.abs(a.top - b.top) <= 1 && Math.abs(a.height - b.height) > 1) failures.push("same-row-native-peers-have-different-heights");
  }
  return failures;
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ geometry: profile.geometry });

  test("E7 localized native Rename form retains full controls and canceled raw title", async ({ page, context, geometry }, testInfo) => {
    const expected = copy[profile.language.split("-")[0]];
    await openForma(page, context, geometry, documentPath, testInfo);
    await waitForExistingDocument(page);
    await profileWitness(page, geometry, expected, testInfo);
    const owner = page.locator("forma-workspace"), header = owner.locator(".page-header--document");
    const heading = header.locator(".document-title-row > h1"), rename = header.locator(".document-title-row > button.icon-button");
    for (const selector of documentHeaderObstacles) await expect(page.locator(selector)).toHaveCount(1);
    await expect(heading).toHaveJSProperty("textContent", retainedTitle);
    await expect(rename).toHaveAccessibleName(expected.rename);
    const articles = await savedArticles(page), beforeURL = page.url();
    let saved, formOwner, primaryError;
    try {
      saved = await retainSource(owner);
      await tabTo(page, rename);
      const before = await verifyFocus(page, rename, testInfo, "e7-locale-01-display-rename", options);
      await page.keyboard.press("Enter");
      const form = header.locator("form.document-title-editor"), field = form.locator(":scope > input#document-title-input");
      const cancel = form.locator(':scope > button[type="button"]'), save = form.locator(':scope > button[type="submit"]');
      await expect(form).toHaveCount(1); await expect(field).toHaveAccessibleName(expected.name);
      await expect(field).toHaveAttribute("maxlength", "80"); await expect(field).toHaveValue(retainedTitle);
      await expect(cancel).toHaveAccessibleName(expected.cancel); await expect(save).toHaveAccessibleName(expected.save);
      formOwner = await retainRenameForm(form);
      await verifyRenameForm(formOwner, retainedTitle, expected, testInfo, "e7-locale-form-initial");
      await tabTo(page, field);
      await verifyFocus(page, field, testInfo, "e7-locale-02-name-input", options);
      await field.fill(rawName); await expect(field).toHaveValue(rawName);
      await pressTo(page, "Tab", cancel, testInfo, "e7-locale-03-cancel-unactivated", options);
      const formRow = await form.evaluate(controlRow, ":scope > input, :scope > button");
      await attachJSON(testInfo, "e7-locale-edit-row", formRow);
      await pressTo(page, "Tab", save, testInfo, "e7-locale-04-save-unactivated", options);
      await expect(save).toBeEnabled(); await expect(field).toHaveValue(rawName);
      await pressTo(page, "Shift+Tab", cancel, testInfo, "e7-locale-05-cancel-return", options);
      await verifyRenameForm(formOwner, rawName, expected, testInfo, "e7-locale-form-raw-before-cancel");
      await page.keyboard.press("Enter");
      await expect(form).toHaveCount(0); await expect(heading).toHaveJSProperty("textContent", retainedTitle);
      const retired = await formOwner.evaluate(state => state.inspect());
      await attachJSON(testInfo, "e7-locale-form-retired", retired);
      expect(retired.connected).toEqual([false, false, false, false, false]);
      expect(retired.sameCurrentForm).toBe(false); expect(retired.value).toBe(rawName);
      await tabTo(page, rename); // Reachability only; no invented automatic Cancel restoration.
      const after = await verifyFocus(page, rename, testInfo, "e7-locale-06-display-return", options);
      await verifyCustody(saved, testInfo, "e7-locale-source-custody");
      expect(page.url()).toBe(beforeURL); expect(await savedArticles(page)).toEqual(articles);
      const failures = rowVerdict(formRow, [expected.cancel, expected.save], true);
      for (const observation of [before, after]) {
        if (observation.focus.raw.width < 44 || observation.focus.raw.height < 44
          || observation.focus.visible.width < 44 || observation.focus.visible.height < 44) failures.push("display-rename-incomplete-44px-target");
      }
      await attachJSON(testInfo, "e7-locale-verdict", { failures, rawName, retainedTitle, originalArticles: articles,
        limit: "The original English display-title word/basis journey remains unchanged. This supplement checks translated native controls; no Save or durable rename was activated." });
      expect(failures).toEqual([]);
    } catch (error) { primaryError = error; }
    await finish(primaryError, formOwner, saved);
  });

  test("E7 existing collection Clear filter retains native label query and source custody", async ({ page, context, geometry }, testInfo) => {
    const expected = copy[profile.language.split("-")[0]];
    await openForma(page, context, geometry, libraryPath, testInfo);
    await profileWitness(page, geometry, expected, testInfo);
    const owner = page.locator("forma-library"), rail = owner.locator("forma-project-rail");
    await expect(owner).toHaveCount(1); await expect(owner.locator(".library-content .asset-card").first()).toBeVisible();
    const toggle = rail.locator(".rail-collapse-toggle");
    const collection = rail.locator('.collection-tree > li[data-collection-id="collection-studio"] > .tree-row > button.tree-name');
    let saved, nativeRailOwner, primaryError;
    try {
      saved = await retainSource(owner);
      const initial = await verifyCustody(saved, testInfo, "e7-filter-initial-source");
      expect(initial.focusCollectionId).toBe("");
      expect(JSON.parse(initial.original.membership)["doc-atmosphere"].collectionId).toBe("collection-studio");
      const nativeTarget = await toggle.getAttribute("popovertarget");
      if (!await collection.isVisible()) {
        await tabTo(page, toggle); await verifyFocus(page, toggle, testInfo, "e7-filter-01-rail-trigger", options);
        await page.keyboard.press("Enter");
        await expect(collection).toBeVisible();
        if (nativeTarget) {
          const panel = rail.locator(".rail-content[popover]:popover-open");
          await expect(panel).toHaveCount(1);
          await expect(panel).toHaveAttribute("id", nativeTarget);
          const current = panel.locator('a[aria-current="page"]');
          const initial = await current.count() ? current.first() : panel.locator("a[href]").first();
          // Observe the real component's queued open-focus completion before Tab.
          await expect(initial).toBeFocused();
        }
      }
      await expect(collection).toHaveJSProperty("textContent", "studio-launch");
      await tabTo(page, collection);
      if (nativeTarget) {
        nativeRailOwner = await retainLibraryNativeRail(collection, nativeTarget);
        const openWitness = await verifyLibraryNativeRail(nativeRailOwner, testInfo, "e7-filter-open-native-owners", true);
        expect(openWitness.collectionFocused).toBe(true);
      }
      // Existing View/Assistant policy: an owned open native top layer intentionally
      // covers background controls. Its entire other-control inventory is unobserved
      // here; keep this target and all overlays/regions strict. Inline rails keep it.
      await verifyFocus(page, collection, testInfo, "e7-filter-02-existing-collection",
        nativeRailOwner ? { ...options, checkVisibleControls: false } : options);
      if (nativeRailOwner) await verifyLibraryNativeRail(nativeRailOwner, testInfo, "e7-filter-focused-native-owners", true);
      await page.keyboard.press("Enter");
      const clear = owner.locator(clearSelector), banner = clear.locator("..");
      await expect(clear).toHaveCount(1); await expect(clear).toHaveAccessibleName(expected.clear);
      const selected = await verifyCustody(saved, testInfo, "e7-filter-selected-source");
      expect(selected.focusCollectionId).toBe("collection-studio"); expect(selected.route).toBe(initial.route);
      expect(await banner.locator(":scope > div > b").textContent()).toContain("studio-launch");
      if (nativeRailOwner) {
        // The owned route commit already closes the native rail and retires its
        // collection tree. Observe that transition; do not send Escape to a closed panel.
        await expect(rail.locator(".rail-content[popover]:popover-open")).toHaveCount(0);
        await expect(collection).toHaveCount(0);
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(toggle).toBeFocused();
        await verifyLibraryNativeRail(nativeRailOwner, testInfo, "e7-filter-selected-native-owners", false);
        await verifyFocus(page, toggle, testInfo, "e7-filter-03-native-rail-return", options);
        await verifyLibraryNativeRail(nativeRailOwner, testInfo, "e7-filter-dismissed-native-owners", false);
      } else await expect(collection).toHaveAttribute("aria-current", "true");
      const query = owner.locator(".library-toolbar forma-ui-search input"), rawQuery = "Atmosphere";
      await expect(query).toHaveCount(1);
      await tabTo(page, query); await query.fill(rawQuery); await expect(query).toHaveValue(rawQuery);
      const beforeURL = page.url(), beforeBanner = await banner.textContent();
      await tabTo(page, clear);
      const focused = await verifyFocus(page, clear, testInfo, "e7-filter-04-clear-unactivated", options);
      const row = await banner.evaluate(controlRow, ":scope > button");
      await attachJSON(testInfo, "e7-filter-native-row", { row, bannerRawText: beforeBanner, query: rawQuery });
      await page.keyboard.press("Enter");
      await expect(clear).toHaveCount(0); await expect(owner.locator(".collection-filter")).toHaveCount(0);
      await attachJSON(testInfo, "e7-filter-native-dismissal", await page.evaluate(() => ({
        tag: document.activeElement?.tagName, id: document.activeElement?.id,
        className: document.activeElement?.getAttribute("class"), connected: document.activeElement?.isConnected,
        limit: "Clear removes its own control. Record actual focus; the source promises no automatic return target." })));
      await captureViewport(page, testInfo, "e7-filter-after-clear");
      await expect(query).toHaveValue(rawQuery);
      // R10 showed scroll movement between strict measurement and capture; R11
      // recorded a pending scroll with no observed scrollend after positions stopped.
      // Prefer the observed end; only the fixed deadline admits persistent sampled
      // stability with a missing-end receipt. The strict capture interval stays exact.
      const queryScroll = await query.evaluateHandle(element => {
        const doc = element.ownerDocument, win = doc.defaultView, ancestors = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
        const targets = [...new Set([doc.scrollingElement, ...ancestors].filter(Boolean))];
        const positions = () => targets.map(node => ({ tag: node.tagName, id: node.id, left: node.scrollLeft, top: node.scrollTop }));
        const initial = positions(), pending = new Set();
        let scrollEvents = 0, scrollEnds = 0, frame = 0, timer;
        const onScroll = event => {
          const target = event.target === doc ? doc.scrollingElement : event.target;
          if (!targets.includes(target)) return;
          if (event.type === "scroll") { pending.add(target); scrollEvents += 1; }
          else { pending.delete(target); scrollEnds += 1; }
        };
        doc.addEventListener("scroll", onScroll, true);
        doc.addEventListener("scrollend", onScroll, true);
        return {
          inspect: () => ({ positions: positions(), scrollEvents, scrollEnds, pendingTargets: pending.size,
            sameFocusedControl: element.isConnected && doc.activeElement === element }),
          wait: () => new Promise(resolve => {
            const started = win.performance.now();
            let previous = JSON.stringify(positions()), unchangedFrames = 0, sampledFrames = 0;
            let lastUnstableAt = started, settled = false;
            const read = () => ({ positions: positions(), sameFocusedControl: element.isConnected && doc.activeElement === element,
              observedAt: win.performance.now() });
            const finish = (ready, basis, deadlineReached, observation) => {
              if (settled) return;
              settled = true;
              win.cancelAnimationFrame(frame); win.clearTimeout(timer);
              resolve({ ready, basis, deadlineReached,
                scrollEndState: pending.size ? "scrollend-unobserved-for-pending-targets"
                  : scrollEvents ? "observed-scrollend" : "no-observed-scroll-events",
                elapsedMs: observation.observedAt - started, initial, final: observation.positions,
                scrollEvents, scrollEnds, pendingTargets: pending.size, sampledFrames, unchangedFrames,
                stableForMs: observation.observedAt - lastUnstableAt,
                sameFocusedControl: observation.sameFocusedControl });
            };
            const completedBasis = () => scrollEvents ? "observed-scrollend-and-position-stability"
              : "no-observed-scroll-events-and-position-stability";
            const sample = () => {
              if (settled) return;
              const observation = read(), current = JSON.stringify(observation.positions);
              sampledFrames += 1;
              if (current === previous && observation.sameFocusedControl) unchangedFrames += 1;
              else { unchangedFrames = 0; lastUnstableAt = observation.observedAt; }
              previous = current;
              if (unchangedFrames >= 2 && pending.size === 0) finish(true, completedBasis(), false, observation);
              else frame = win.requestAnimationFrame(sample);
            };
            timer = win.setTimeout(() => {
              if (settled) return;
              const observation = read(), current = JSON.stringify(observation.positions);
              // This fresh deadline read cannot manufacture another animation frame.
              if (current !== previous || !observation.sameFocusedControl) {
                unchangedFrames = 0; lastUnstableAt = observation.observedAt;
              }
              const ready = unchangedFrames >= 2 && observation.sameFocusedControl;
              const basis = !ready ? "deadline-without-stable-focused-target"
                : pending.size ? "deadline-position-stability-with-scrollend-unobserved" : completedBasis();
              finish(ready, basis, true, observation);
            }, 2000); // Event-observation deadline; only fresh sampled stability admits a missing-end fallback.
            frame = win.requestAnimationFrame(sample);
          }),
          dispose: () => {
            win.cancelAnimationFrame(frame); win.clearTimeout(timer);
            doc.removeEventListener("scroll", onScroll, true);
            doc.removeEventListener("scrollend", onScroll, true);
          },
        };
      });
      let queryScrollError, queryReadiness;
      try {
        await tabTo(page, query);
        queryReadiness = await queryScroll.evaluate(state => state.wait());
        await attachJSON(testInfo, "e7-filter-05-native-scroll-readiness", queryReadiness);
        expect(queryReadiness.ready && queryReadiness.sameFocusedControl,
          "Observed ancestor positions must stabilize with the same Search input focused before strict measurement and capture").toBe(true);
        await verifyFocus(page, query, testInfo, "e7-filter-05-search-reachable", options);
      } catch (error) { queryScrollError = error; }
      const queryScrollErrors = queryScrollError ? [queryScrollError] : [];
      try {
        const afterCapture = await queryScroll.evaluate(state => state.inspect());
        await attachJSON(testInfo, "e7-filter-05-native-scroll-after-capture", { readiness: queryReadiness ?? null, afterCapture,
          limit: "Read-only retained ancestor positions, scroll events, unmatched pending state and native focus across strict observation/capture when reached; missing scrollend remains unobserved. No recapture or settling retry." });
        if (queryReadiness?.ready) {
          expect(afterCapture.sameFocusedControl).toBe(true);
          expect(afterCapture.pendingTargets, "Retain unmatched scrollend state without clearing it synthetically").toBe(queryReadiness.pendingTargets);
          expect(afterCapture.positions, "Ancestor scroll positions must not move during the strict observation and capture").toEqual(queryReadiness.final);
          expect([afterCapture.scrollEvents, afterCapture.scrollEnds], "No further native scroll event may occur during measurement and capture")
            .toEqual([queryReadiness.scrollEvents, queryReadiness.scrollEnds]);
        }
      } catch (error) { queryScrollErrors.push(error); }
      try { await queryScroll.evaluate(state => state.dispose()); } catch (error) { queryScrollErrors.push(error); }
      try { await queryScroll.dispose(); } catch (error) { queryScrollErrors.push(error); }
      if (queryScrollErrors.length > 1) throw new AggregateError(queryScrollErrors, "E7 native scroll readiness, capture witness and cleanup failed");
      if (queryScrollErrors.length === 1) throw queryScrollErrors[0];
      const after = await verifyCustody(saved, testInfo, "e7-filter-final-source");
      expect(after.focusCollectionId).toBe(""); expect(page.url()).toBe(beforeURL); await expect(query).toHaveValue(rawQuery);
      const failures = rowVerdict(row, [expected.clear], false);
      if (!(row.supporting > 0) || row.controls[0].fontSize < row.supporting) failures.push("clear-filter-retains-micro-font");
      if (focused.focus.visible.width < 44 || focused.focus.visible.height < 44) failures.push("clear-filter-target-not-wholly-visible");
      await attachJSON(testInfo, "e7-filter-verdict", { failures, rawQuery, beforeBanner, after,
        limit: "Only the original local collection filter is cleared. No filing, import/export, collection edits, output selection or provider action occurred." });
      expect(failures).toEqual([]);
    } catch (error) { primaryError = error; }
    await finish(primaryError, nativeRailOwner, saved);
  });
});
