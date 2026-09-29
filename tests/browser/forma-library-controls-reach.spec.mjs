import { test, expect, attachJSON, openForma, captureViewport } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { installLibraryControlsReachNetwork, libraryPath, editorPath, blockId, queryText, authoredText } from "./helpers/library-controls-reach-network.mjs";
import { observeLibraryControl, libraryCardIdentity, librarySectionLayout, libraryInspectionCopy } from "./helpers/library-controls-reach-observation.mjs";
import { controlRow, rowVerdict } from "./helpers/e9-peer-observation.mjs";

const cases = [
  { name: "EN 1280×720", variant: "ordinary", geometry: { viewport: { width: 1280, height: 720 }, zoom: 1, locale: "en-US" },
    queryLabel: "Search project library", all: "All", back: "Back to Library", direction: "Direction", controls: name => `Controls for \u2068${name}\u2069` },
  { name: "EN 320 long name", variant: "longEnglish", nativeReadingScroll: true, geometry: { viewport: { width: 320, height: 900 }, zoom: 1, locale: "en-US" },
    queryLabel: "Search project library", all: "All", back: "Back to Library", direction: "Direction", controls: name => `Controls for \u2068${name}\u2069` },
  { name: "AR 320 long name", variant: "longArabic", nativeReadingScroll: true, geometry: { viewport: { width: 320, height: 900 }, zoom: 1, locale: "ar" },
    queryLabel: "البحث في مكتبة المشروع", all: "الكل", back: "العودة إلى المكتبة", direction: "التوجه", controls: name => `عناصر التحكم في \u2068${name}\u2069` },
];

async function preserveFailureThroughCleanup(operation, cleanup) {
  let result, primary, failed = false;
  try { result = await operation(); }
  catch (error) { primary = error; failed = true; }
  try { await cleanup(); }
  catch (error) {
    if (failed) throw new AggregateError([primary, error], 'Original failure followed by handle cleanup failure');
    throw error;
  }
  if (failed) throw primary;
  return result;
}

function assertReach(observation, label, accessibleLabel) {
  const { bounds, clip, fragments } = observation;
  expect(observation.nativeButton).toBe(true);
  expect(observation.type).toBe("button");
  expect(observation.enabled).toBe(true);
  expect(observation.painted).toBe(true);
  expect(observation.text).toBe(label);
  expect(observation.ariaLabel).toBe(accessibleLabel);
  expect(observation.unsupported, "Unknown coordinates do not qualify reach").toEqual([]);
  expect(observation.hiddenText, "The complete Controls label must remain painted without ellipsis or line clamp").toEqual([]);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.left).toBeGreaterThanOrEqual(clip.left);
  expect(bounds.right).toBeLessThanOrEqual(clip.right);
  expect(bounds.top).toBeGreaterThanOrEqual(clip.top);
  expect(bounds.bottom).toBeLessThanOrEqual(clip.bottom);
  expect(observation.samples.every(sample => sample.owned), "All nine pre-action samples must belong to the exact native Controls button").toBe(true);
  expect(fragments.length).toBeGreaterThan(0);
  for (const fragment of fragments) {
    expect(fragment.left).toBeGreaterThanOrEqual(bounds.left - .5);
    expect(fragment.right).toBeLessThanOrEqual(bounds.right + .5);
    expect(fragment.top).toBeGreaterThanOrEqual(bounds.top - .5);
    expect(fragment.bottom).toBeLessThanOrEqual(bounds.bottom + .5);
  }
  expect(observation.document.scrollWidth).toBeLessThanOrEqual(observation.document.width + 1);
}

function reachDiagnosis(observation, label, accessibleLabel) {
  const { bounds, clip } = observation;
  const checks = {
    nativeEnabledPaintedButton: observation.nativeButton && observation.type === "button" && observation.enabled && observation.painted,
    completeExpectedNames: observation.text === label && observation.ariaLabel === accessibleLabel,
    supportedCoordinates: observation.unsupported.length === 0,
    targetFloor: bounds.width >= 44 && bounds.height >= 44,
    entireBodyInClip: bounds.left >= clip.left && bounds.right <= clip.right && bounds.top >= clip.top && bounds.bottom <= clip.bottom,
    nineOwnedSamples: observation.samples.length === 9 && observation.samples.every(sample => sample.owned),
    completeVisibleText: observation.hiddenText.length === 0 && observation.fragments.length > 0
      && observation.fragments.every(fragment => fragment.left >= bounds.left - .5 && fragment.right <= bounds.right + .5
        && fragment.top >= bounds.top - .5 && fragment.bottom <= bounds.bottom + .5),
    noPageHorizontalOverflow: observation.document.scrollWidth <= observation.document.width + 1,
  };
  return { reach: Object.values(checks).every(Boolean), checks };
}

function assertIdentity(identity, profile, controlLabel, accessibleLabel, searched) {
  expect(identity.previewCount).toBe(1);
  // routes.ts intentionally omits the optional ASCII slug for this Arabic
  // name. Fixed per-profile expectations still bind the complete exact href.
  expect(identity.href).toBe(`/library/block/${blockId}${profile.previewSlug ? '/' + profile.previewSlug : ''}?document=doc-atmosphere`);
  expect(new URL(identity.href, "http://127.0.0.1:4186").searchParams.get("document")).toBe("doc-atmosphere");
  expect(identity.previewCopy).toBe(authoredText);
  expect(identity.titleCount).toBe(1);
  expect(identity.title).toBe(profile.label);
  expect(identity.paragraphCount).toBe(1);
  expect(identity.paragraph).toBe(authoredText);
  expect(identity.controlsCount).toBe(1);
  expect(identity.controlId).toBe(blockId);
  expect(identity.controlText).toBe(controlLabel);
  expect(identity.controlLabel).toBe(accessibleLabel);
  expect(identity.titleBeforePreview).toBe(searched);
  expect(identity.controlsBeforePreview).toBe(searched);
}

for (const profileCase of cases) test.describe(profileCase.name, () => {
  test.use({ geometry: profileCase.geometry });
  const title = profileCase.nativeReadingScroll
    ? "query and counted native reading scroll reach complete Controls; keyboard Back preserves All and visible focus"
    : "query reaches exact Controls without scrolling and keyboard Back restores All and visible focus";
  test(title, async ({ page, context, geometry, baseURL }, testInfo) => {
    expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("1");
    expect(baseURL).toBe("http://127.0.0.1:4186");
    const { receipt, profile, expectedStoreEvents } = await installLibraryControlsReachNetwork(context, profileCase.variant);
    const errors = []; page.on("pageerror", error => errors.push(String(error)));
    let custody, primaryFailure = false;
    const failures = [];
    try {
      await openForma(page, context, geometry, libraryPath, testInfo);
      const library = page.locator("forma-library");
      const query = library.getByRole("searchbox", { name: profileCase.queryLabel, exact: true });
      const all = library.locator(".library-toolbar forma-ui-segmented-control").getByRole("button", { name: profileCase.all, exact: true });
      const controls = library.locator(`button[data-context-controls-id="${blockId}"]`);
      const card = library.locator(`article.asset-card:has(button[data-context-controls-id="${blockId}"])`);
      const label = profileCase.controls(profile.label);
      // Independent exact catalogue expectation for this unique declared name:
      // context.controls.contextNamed is "{label} — {type}: {handle}" in EN/AR;
      // system.auto.r6us5m.9 translates Direction to التوجه. Do not call the
      // production disambiguator or infer the expected name from actual DOM.
      const accessibleLabel = `${label} — ${profileCase.direction}: \u2068${profile.handle}\u2069`;
      await expect(query).toHaveValue("");
      await expect(all).toHaveAttribute("aria-pressed", "true");
      await expect(controls).toHaveCount(1);
      await expect(controls).toHaveAccessibleName(accessibleLabel);
      await expect(card).toHaveCount(1);
      custody = await library.evaluateHandle(owner => {
        const store = owner.store;
        const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
        return { read: () => ({ connected: owner.isConnected, sameStore: owner.store === store,
          sourceActive: store.sourceOwnershipActive(source), authorizationActive: store.authorizationScopeActive(authorization),
          raw: { events: store.events.get(), optimisticEvents: store.optimisticEvents.get(), head: store.head.get(),
            content: store.content.get(), session: store.session.get(), jobs: store.documentJobs.get(),
            blocks: store.projection.get().libraryBlocks },
          route: store.route.get(), view: store.ui.libraryView,
          projectId: store.projection.get().projectId, documentId: store.projection.get().documentId }) };
      });
      const original = await custody.evaluate(held => held.read());
      expect(original).toMatchObject({ connected: true, sameStore: true, sourceActive: true, authorizationActive: true,
        route: libraryPath, view: "all", projectId: "project-atmosphere", documentId: "doc-atmosphere" });
      expect(receipt.responses.some(response => response.path === receipt.storeAdmission.exactResponsePath),
        "Fresh Library source must use its declared workspace response").toBe(true);
      expect(original.raw.events).toEqual(expectedStoreEvents);
      expect(original.raw.head).toBe(24);
      expect(original.raw.optimisticEvents).toEqual([]);
      const heading = library.locator('.library-content > section:has(> .asset-grid) > .section-heading');
      const openEditorLabel = geometry.locale === 'ar' ? 'فتح محرر العناصر' : 'Open Block editor';
      const checkSection = async (stage, diagnose = false) => {
        await expect(heading).toHaveCount(1);
        const row = await heading.evaluate(controlRow, ':scope > button');
        const layout = await library.evaluate(librarySectionLayout);
        await attachJSON(testInfo, stage, { row, layout });
        expect(row.controls).toHaveLength(1);
        await expect(heading.locator(':scope > button')).toHaveAccessibleName(openEditorLabel);
        expect(rowVerdict(row, [openEditorLabel], false), 'Full ordinary words and native body fit the actual Library lane').toEqual([]);
        expect(layout.launcher).not.toBeNull();
        if (layout.overlaps && diagnose) {
          const overlapFailure = new Error('Ask covers Open Block editor before the diagnostic; recovery cannot qualify this journey');
          try {
          // Failure-only causal probe: this synthetic scheduling event is never
          // counted as user reach, and recovery never permits a subsequent click.
          const heldFocus = await page.evaluateHandle(() => document.activeElement);
          const beforeCustody = await custody.evaluate(held => held.read());
          await captureViewport(page, testInfo, 'ask-overlap-before-diagnostic');
          try {
            await page.evaluate(() => window.dispatchEvent(new Event('resize')));
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await attachJSON(testInfo, 'ask-resize-diagnostic', { before: layout,
              after: await library.evaluate(librarySectionLayout), beforeCustody,
              afterCustody: await custody.evaluate(held => held.read()),
              sameNativeFocus: await heldFocus.evaluate(element => element === document.activeElement),
              stimulus: 'One synthetic resize event; no viewport, scroll, focus, style or source setter. Original overlap remains a failure.' });
            await captureViewport(page, testInfo, 'ask-overlap-after-diagnostic');
          } finally { await heldFocus.dispose(); }
          } catch (error) {
            throw new AggregateError([overlapFailure, error], 'Original overlap followed by diagnostic failure');
          }
          throw overlapFailure;
        }
        expect(layout.overlaps, 'Ask must not cover Open Block editor; diagnostic recovery is not acceptance').toBe(false);
        return layout;
      };
      await checkSection('empty-query-section-heading');
      const originalLinks = await library.locator(".library-content a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")));
      const initialCard = await card.evaluate(libraryCardIdentity);
      assertIdentity(initialCard, profile, label, accessibleLabel, false);
      const initialScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
      expect(initialScroll).toEqual({ x: 0, y: 0 });

      // Desktop retains its exact query-fill + click criterion. Narrow reading
      // receives a separately labeled, finite native-wheel qualification only.
      await query.fill(queryText);
      const inputLedger = [{ kind: "fill", target: "primary Library query", value: queryText }];
      await expect(query).toHaveValue(queryText);
      await expect(card).toHaveCount(1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const searchedCard = await card.evaluate(libraryCardIdentity);
      assertIdentity(searchedCard, profile, label, accessibleLabel, true);
      const noScroll = await controls.evaluate(observeLibraryControl);
      const initialReach = reachDiagnosis(noScroll, label, accessibleLabel);
      const initialStage = profileCase.nativeReadingScroll ? "query-controls-initial-no-scroll" : "query-controls-before-click";
      await attachJSON(testInfo, initialStage, { ...noScroll, initialScroll, searchedCard, initialReach,
        inputLedger: [...inputLedger], qualification: profileCase.nativeReadingScroll ? "narrow native reading, not a two-input acceptance claim" : "strict desktop two-input reach",
        boundary: "Initial query result before any reading scroll or Controls activation. Retained r4 narrow initial-reach failure is not reclassified by a later reading qualification." });
      await captureViewport(page, testInfo, initialStage);
      await checkSection('searched-section-heading', true);
      expect({ x: noScroll.document.scrollX, y: noScroll.document.scrollY }).toEqual(initialScroll);
      expect(noScroll.ancestors.every(ancestor => ancestor.scrollTop === 0 && ancestor.scrollLeft === 0)).toBe(true);
      let preClick = noScroll;
      let wheelInputs = 0;
      if (profileCase.nativeReadingScroll) {
        const maximumWheelInputs = 4;
        for (; wheelInputs < maximumWheelInputs && !reachDiagnosis(preClick, label, accessibleLabel).reach; wheelInputs += 1) {
          // A pointer-position record is distinct from each delivered wheel.
          // No locator scroll, DOM scroll/focus, forced click or style mutation.
          const x = geometry.viewport.width / 2, y = geometry.viewport.height * .75;
          const deltaY = preClick.bounds.top < preClick.clip.top ? -240 : 240;
          await page.mouse.move(x, y);
          inputLedger.push({ kind: "pointer-position", x, y, purpose: "place native wheel over the visible Library reading surface" });
          await page.mouse.wheel(0, deltaY);
          inputLedger.push({ kind: "native-wheel", number: wheelInputs + 1, deltaX: 0, deltaY });
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          preClick = await controls.evaluate(observeLibraryControl);
          const stage = `narrow-reading-wheel-${wheelInputs + 1}`;
          await attachJSON(testInfo, stage, { ...preClick, initialReach, currentReach: reachDiagnosis(preClick, label, accessibleLabel),
            wheelInputs: wheelInputs + 1, maximumWheelInputs, inputLedger: [...inputLedger] });
          await captureViewport(page, testInfo, stage);
          await expect(query).toHaveValue(queryText);
          await expect(all).toHaveAttribute("aria-pressed", "true");
          expect(await card.evaluate(libraryCardIdentity)).toEqual(searchedCard);
          expect((await custody.evaluate(held => held.read())).raw).toEqual(original.raw);
        }
        await attachJSON(testInfo, "query-controls-before-click", { ...preClick, initialReach,
          currentReach: reachDiagnosis(preClick, label, accessibleLabel), wheelInputs, inputLedger: [...inputLedger],
          qualification: "Bounded native-scroll reading with complete label/body and unchanged source; no narrow two-input reach credit." });
        await captureViewport(page, testInfo, "query-controls-before-click");
      }
      assertReach(preClick, label, accessibleLabel);
      const click = { kind: "raw-pointer-click", target: blockId,
        x: preClick.bounds.x + preClick.bounds.width / 2, y: preClick.bounds.y + preClick.bounds.height / 2 };
      await page.mouse.click(click.x, click.y);
      inputLedger.push(click);

      await expect(page).toHaveURL(baseURL + editorPath);
      const editor = library.locator("forma-library-block-editor");
      await expect(editor).toHaveCount(1);
      await expect(editor.locator(".library-block-inspection")).toHaveCount(1);
      const contextBlock = editor.locator("forma-context-block");
      await expect(contextBlock).toHaveCount(1);
      const inspection = await contextBlock.evaluate(element => ({ readOnly: element.readOnly, surface: element.surface,
        block: element.block, articleId: element.querySelector("article[data-block-id]")?.getAttribute("data-block-id"),
        copy: element.querySelector(".block-copy")?.textContent,
        authoringFields: element.querySelectorAll("textarea,input:not([readonly]),button.handle,.block-editor").length }));
      expect(inspection).toMatchObject({ readOnly: true, surface: "library", articleId: blockId, copy: authoredText,
        block: { id: blockId, documentId: "doc-atmosphere", projectId: "project-atmosphere", scope: "document",
          handle: profile.handle, properties: { label: profile.label, text: authoredText } }, authoringFields: 0 });
      expect((await custody.evaluate(held => held.read())).raw).toEqual(original.raw);
      await attachJSON(testInfo, "exact-read-only-arrival", { inspection,
        inputsToArrival: inputLedger, wheelInputs,
        reachQualification: profileCase.nativeReadingScroll ? "narrow counted native reading; no two-input reach claim" : "desktop strict two-input reach without scrolling",
        limit: "Source inspection only; no Fork, Use, Save, upload, export or provider control is activated." });
      await captureViewport(page, testInfo, "exact-read-only-arrival");

      const observeCopy = async () => ({ ...await library.evaluate(libraryInspectionCopy),
        launcherControl: await page.locator('.application-creative > forma-creative-assistant > forma-assistant-panel > .forma-assistant-launcher').evaluate(observeLibraryControl) });
      const arrivalCopy = await observeCopy();
      await attachJSON(testInfo, 'read-only-arrival-copy', arrivalCopy);
      const assertCopy = reading => {
        expect(reading.ownerCounts).toEqual({ panels: 1, launchers: 1, inspections: 1, contexts: 1, copies: 1 });
        expect(reading).toMatchObject({ connected: true, readOnly: true, surface: 'library', blockId, copy: authoredText,
          nativeLauncher: true, launcherEnabled: true, direction: { attribute: 'auto', computed: 'ltr' },
          unsupported: [], hidden: [], posture: { open: false } });
        expect(reading.visibleCount).toBeGreaterThan(0);
        expect(reading.launcher.left).toBeGreaterThanOrEqual(0);
        expect(reading.launcher.top).toBeGreaterThanOrEqual(0);
        expect(reading.launcher.right).toBeLessThanOrEqual(geometry.viewport.width);
        expect(reading.launcher.bottom).toBeLessThanOrEqual(geometry.viewport.height);
        expect(reading.scrollWidth).toBeLessThanOrEqual(reading.width + 1);
        const control = reading.launcherControl;
        // Fixed catalogue expectations from assistant-messages.ts; the compact
        // icon retains the same native name as the full text launcher.
        expect(control.ariaLabel).toBe(geometry.locale === 'ar' ? 'اسأل Forma' : 'Ask Forma');
        expect(control).toMatchObject({ nativeButton: true, enabled: true, painted: true, unsupported: [], hiddenText: [] });
        expect(control.bounds.width).toBeGreaterThanOrEqual(44);
        expect(control.bounds.height).toBeGreaterThanOrEqual(44);
        expect(control.interiorSamples).toHaveLength(9);
        expect(control.interiorSamples.every(sample => sample.owned), 'Nine interior native hits preserve the full-size rectangular or circular launcher').toBe(true);
      };
      assertCopy(arrivalCopy);
      if (arrivalCopy.overlaps.length) {
        const overlapFailure = new Error('Collapsed Ask launcher covers authored read-only paragraph; diagnostic recovery cannot qualify arrival');
        const heldFocus = await page.evaluateHandle(() => document.activeElement);
        await preserveFailureThroughCleanup(async () => {
        try {
          const beforeCustody = await custody.evaluate(held => held.read());
          await page.evaluate(() => window.dispatchEvent(new Event('resize')));
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          await attachJSON(testInfo, 'read-only-arrival-resize-diagnostic', { before: arrivalCopy,
            after: await observeCopy(), beforeCustody,
            afterCustody: await custody.evaluate(held => held.read()),
            sameNativeFocus: await heldFocus.evaluate(element => element === document.activeElement),
            stimulus: 'One synthetic resize scheduling event; no viewport, scroll, focus, DOM, style or source setter. Initial overlap remains failure.' });
          await captureViewport(page, testInfo, 'read-only-arrival-after-diagnostic');
        } catch (error) { throw new AggregateError([overlapFailure, error], 'Original paragraph overlap followed by diagnostic failure'); }
        throw overlapFailure;
        }, () => heldFocus.dispose());
      }
      expect(arrivalCopy.overlaps, 'Every currently visible authored glyph must remain clear of the collapsed launcher').toEqual([]);

      // Native keyboard return supplies an actual :focus-visible ring. This is
      // explicitly not a claim about pointer-Back focus-visible heuristics.
      const back = editor.getByRole("button", { name: profileCase.back, exact: true });
      await tabTo(page, back, 80);
      await expect(back).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(baseURL + libraryPath);
      await expect(editor).toHaveCount(0);
      await expect(query).toHaveValue(queryText);
      await expect(all).toHaveAttribute("aria-pressed", "true");
      await expect(controls).toHaveCount(1);
      await verifyFocus(page, controls, testInfo, "same-owner-back-controls-focus", {
        overlaySelectors: [".topbar", ".page-header--library", ".application-task-navigation", ".forma-assistant-launcher", ":popover-open", ":modal"],
        regionSelectors: [], checkVisibleControls: false,
      });
      const returnedControl = await controls.evaluate(observeLibraryControl);
      assertReach(returnedControl, label, accessibleLabel);
      await checkSection('returned-section-heading');
      const returnedCard = await card.evaluate(libraryCardIdentity);
      expect(returnedCard).toEqual(searchedCard);
      const returned = await custody.evaluate(held => held.read());
      expect(returned).toEqual(original);
      await attachJSON(testInfo, "same-owner-roundtrip", { original, returned, returnedControl, returnedCard,
        limit: "Exact owner, source, query and originating All plus keyboard-Back focus/ring clearance. No pointer-Back, stale-owner race, C04/C10 or live C14 acceptance is inferred." });

      // A separate reader exercise follows the completed discovery/Back gate.
      // Its inputs never earn discovery credit or alter the original roundtrip.
      const readerInputs = [], seenGlyphs = new Set();
      const readerClick = { kind: 'raw-pointer-click', target: blockId,
        x: returnedControl.bounds.x + returnedControl.bounds.width / 2,
        y: returnedControl.bounds.y + returnedControl.bounds.height / 2 };
      await page.mouse.click(readerClick.x, readerClick.y);
      readerInputs.push(readerClick);
      await expect(page).toHaveURL(baseURL + editorPath);
      await expect(editor.locator('.library-block-inspection')).toHaveCount(1);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const readerCustody = await custody.evaluate(held => held.read());
      expect(readerCustody).toMatchObject({ connected: true, sameStore: true, sourceActive: true, authorizationActive: true,
        route: editorPath, projectId: 'project-atmosphere', documentId: 'doc-atmosphere' });
      expect(readerCustody.raw).toEqual(original.raw);
      const readerFocus = await page.evaluateHandle(() => document.activeElement);
      let reading;
      await preserveFailureThroughCleanup(async () => {
        const expectedGlyphCount = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(authoredText)]
          .filter(part => part.segment.trim()).length;
        for (let step = 0; step <= 6; step++) {
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          reading = await observeCopy();
          await attachJSON(testInfo, `reader-observation-${step}`, { reading, inputs: [...readerInputs] });
          assertCopy(reading);
          expect(reading.glyphCount).toBe(expectedGlyphCount);
          if (reading.overlaps.length) {
            const overlapFailure = new Error('Collapsed launcher obscures the separate reader exercise; diagnostic recovery is not acceptance');
            try {
              await captureViewport(page, testInfo, `reader-overlap-${step}-before-diagnostic`);
              const beforeCustody = await custody.evaluate(held => held.read());
              await page.evaluate(() => window.dispatchEvent(new Event('resize')));
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
              await attachJSON(testInfo, `reader-resize-diagnostic-${step}`, { before: reading, after: await observeCopy(),
                beforeCustody, afterCustody: await custody.evaluate(held => held.read()),
                sameNativeFocus: await readerFocus.evaluate(element => element === document.activeElement), inputs: [...readerInputs],
                stimulus: 'One synthetic resize scheduling event; original reading overlap remains failure with no further user action.' });
              await captureViewport(page, testInfo, `reader-overlap-${step}-after-diagnostic`);
            } catch (error) { throw new AggregateError([overlapFailure, error], 'Original reader overlap followed by diagnostic failure'); }
            throw overlapFailure;
          }
          expect(reading.overlaps, 'Collapsed Ask must remain clear of every visible glyph during ordinary reading').toEqual([]);
          // Repeated settled observation must not expose placement oscillation.
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          expect(await observeCopy()).toEqual(reading);
          expect(await custody.evaluate(held => held.read())).toEqual(readerCustody);
          expect(await readerFocus.evaluate(element => element === document.activeElement)).toBe(true);
          const glyphs = Map.groupBy(reading.fragments, fragment => fragment.glyphId);
          for (const [id, fragments] of glyphs) if (fragments.every(fragment => fragment.fullyInClip && fragment.hitOwned && !fragment.launcherOverlap)) seenGlyphs.add(id);
          const stage = `read-only-paragraph-reading-${step}`;
          await attachJSON(testInfo, stage, { reading, inputs: [...readerInputs], seenGlyphCount: seenGlyphs.size, expectedGlyphCount,
            qualification: 'Separate native reading after the original Controls/Back gate. Each counted glyph is fully in clip and has an owned center hit. No focus/scroll setters or discovery credit.' });
          await captureViewport(page, testInfo, stage);
          if (seenGlyphs.size === expectedGlyphCount) break;
          expect(step, 'Six bounded reading wheels must expose every authored glyph').toBeLessThan(6);
          const x = geometry.viewport.width / 2, y = geometry.viewport.height * .65;
          await page.mouse.move(x, y);
          readerInputs.push({ kind: 'pointer-position', x, y, purpose: 'ordinary paragraph reading' });
          await page.mouse.wheel(0, 240);
          readerInputs.push({ kind: 'native-wheel', number: step + 1, deltaX: 0, deltaY: 240 });
        }
        expect(seenGlyphs.size).toBe(expectedGlyphCount);
      }, () => readerFocus.dispose());
      await tabTo(page, back, 80);
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(baseURL + libraryPath);
      await expect(controls).toBeFocused();
      await expect(query).toHaveValue(queryText);
      await expect(all).toHaveAttribute('aria-pressed', 'true');
      expect((await custody.evaluate(held => held.read())).raw).toEqual(original.raw);

      // Empty-query branch returns its exact original preview/title/action and
      // every original Library href in order, including full authored text.
      await query.fill("");
      await expect(all).toHaveAttribute("aria-pressed", "true");
      await expect(query).toHaveValue("");
      await expect.poll(() => card.evaluate(libraryCardIdentity)).toEqual(initialCard);
      expect(await library.locator(".library-content a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).toEqual(originalLinks);
      expect((await custody.evaluate(held => held.read())).raw).toEqual(original.raw);
      // Read the unchanged empty-query section with explicitly counted wheels.
      // This happens only after the completed discovery/Back journey above.
      const emptyReading = [];
      let emptyLayout = await checkSection('cleared-query-section-heading');
      for (let step = 0; step < 6 && (emptyLayout.action.top < 180 || emptyLayout.action.bottom > geometry.viewport.height - 16); step++) {
        const deltaY = Math.max(-600, Math.min(600, emptyLayout.action.top - geometry.viewport.height * .55));
        await page.mouse.move(geometry.viewport.width / 2, geometry.viewport.height * .75);
        await page.mouse.wheel(0, deltaY);
        emptyReading.push({ kind: 'native-wheel', number: step + 1, deltaX: 0, deltaY });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        emptyLayout = await library.evaluate(librarySectionLayout);
      }
      await checkSection('empty-query-section-reading');
      const emptyAction = await heading.locator(':scope > button').evaluate(observeLibraryControl);
      await attachJSON(testInfo, 'empty-query-section-reading-inputs', { inputs: emptyReading, action: emptyAction });
      await captureViewport(page, testInfo, 'empty-query-section-reading');
      expect(emptyAction.samples.every(sample => sample.owned)).toBe(true);
      expect(emptyAction.bounds.top).toBeGreaterThanOrEqual(emptyAction.clip.top);
      expect(emptyAction.bounds.bottom).toBeLessThanOrEqual(emptyAction.clip.bottom);
      await expect(query).toHaveValue('');
      expect((await custody.evaluate(held => held.read())).raw).toEqual(original.raw);
      expect(errors).toEqual([]);
    } catch (error) {
      primaryFailure = true;
      failures.push(error);
    } finally {
      // Every cleanup gets its own attempt. Preserve the original failure as
      // the first error even if evidence capture, attachment or disposal fails.
      const attempt = async (phase, operation) => {
        try { await operation(); }
        catch (error) { failures.push(new Error(`Library regression cleanup: ${phase}`, { cause: error })); }
      };
      if (custody) {
        let finalCustody = { unavailable: "Final custody capture did not complete; no unchanged-source conclusion is available from this attachment." };
        await attempt("capture final custody", async () => { finalCustody = await custody.evaluate(held => held.read()); });
        await attempt("attach final custody", () => attachJSON(testInfo, "final-custody-even-on-failure", finalCustody));
        await attempt("dispose custody handle", () => custody.dispose());
      }
      await attempt("attach explicit network receipt", () => attachJSON(testInfo, "library-controls-explicit-network", receipt));
      await attempt("attach page errors", () => attachJSON(testInfo, "library-controls-page-errors", errors));
      await attempt("assert forbidden requests", () => {
        expect(receipt.forbidden, "Only exact retained offline fonts and finite declared API responses may resolve").toEqual([]);
      });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, primaryFailure
      ? "Library regression failed; cleanup failures follow the original failure"
      : "Library regression cleanup failures");
  });
});
