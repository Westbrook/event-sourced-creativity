import { test, expect, attachJSON, applyBrowserZoom, browserMetrics } from "./fixtures.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { controlRow, rowVerdict } from "./helpers/e9-peer-observation.mjs";

// Reuse only the retained isolated E6 Taste fixture's existing image owner.
// Native Tab observes Open full image and More; neither action is activated.
// These ten profiles are the original E6 representative set, not a Cartesian
// product or a claim of physical-device, all-locale, or assistive-technology coverage.
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
// Positive source copy for the retained four locale families, not a value
// learned from the trigger under test. Scoped output names keep FSI/PDI.
const moreCopy = { en: "More actions", fr: "Plus d’actions", ar: "المزيد من الإجراءات", ja: "その他のアクション" };
const snapshot = page => page.evaluate(() => globalThis.formaIsolatedE6?.snapshot() ?? null);
const overlays = [".forma-assistant-launcher", ":popover-open", ":modal", ".topbar",
  "forma-output-card > article.output-card > .output-info > .output-actions > button.output-open",
  "forma-output-card > article.output-card > .output-info > .output-actions > forma-ui-popover.output-actions-popover > .ui-popover > button.ui-popover-trigger"];
const peerSelector = ":scope > button.output-open, :scope > forma-ui-popover.output-actions-popover > .ui-popover > button.ui-popover-trigger";

test.beforeEach(async ({ baseURL }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK, "Existing finite transport is a required E9 premise").toBe("1");
  expect(baseURL).toBe(testInfo.project.use.baseURL);
  expect(testInfo.project.use.baseURL).toBe("http://127.0.0.1:4186");
  expect(process.env.FORMA_E6_BASELINE ?? "0", "E9 requires current source CSS, not the historical E6 foundation override").toBe("0");
});

function typefacePolicy() {
  const stack = value => value.split(",").map(family => family.trim().replace(/["']/g, ""));
  const root = getComputedStyle(document.documentElement), bodyStack = stack(getComputedStyle(document.body).fontFamily);
  return { language: document.documentElement.lang, direction: document.documentElement.dir, bodyStack,
    firstFamily: bodyStack[0], sansStack: stack(root.getPropertyValue("--sans")),
    formaStack: stack(root.getPropertyValue("--forma-font-family")),
    manropeLoaded: [...document.fonts].some(face => face.family.replace(/["']/g, "") === "Manrope" && face.status === "loaded"),
    limit: "Declared computed typeface policy and font readiness; no individual glyph or all-platform fallback claim." };
}

function retainPeerOwners(row) {
  const owner = row.closest("forma-output-card"), card = row.closest("article.output-card");
  const open = row.querySelector(":scope > button.output-open");
  const art = card?.querySelector(":scope > button.output-art");
  const store = owner?.store, output = owner?.output;
  const popover = row.querySelector(":scope > forma-ui-popover.output-actions-popover");
  const wrapper = popover?.querySelector(":scope > .ui-popover");
  const more = wrapper?.querySelector(":scope > button.ui-popover-trigger");
  const panel = wrapper?.querySelector(":scope > section.ui-popover-panel[popover]");
  if (!owner || !card || !(open instanceof HTMLButtonElement) || !(more instanceof HTMLButtonElement)
    || !(art instanceof HTMLButtonElement) || !store?.projection?.get || !store?.asOf?.get || !output
    || !popover || !wrapper || !(panel instanceof HTMLElement)
    || row.querySelectorAll(":scope > button").length !== 1
    || row.querySelectorAll(":scope > forma-ui-popover.output-actions-popover").length !== 1)
    throw new Error("Require the original OutputCard row, one direct Open button and one nested native More trigger");
  const publicState = () => {
    const projection = store.projection.get(), presented = projection.presentedBriefItems, asOf = store.asOf.get();
    if (!(presented instanceof Set) || [...presented].some(value => typeof value !== "string")
      || !(Number.isFinite(asOf) || asOf === Number.POSITIVE_INFINITY))
      throw new Error("Require declared finite projection fields, presentedBriefItems Set<string> and public asOf");
    return {
      output: JSON.stringify(owner.output),
      projectedOutputs: JSON.stringify(projection.outputs.filter(candidate => candidate.id === output.id)),
      libraryOutputs: JSON.stringify(projection.libraryOutputs.filter(candidate => candidate.id === output.id)),
      projection: JSON.stringify({ ...projection, presentedBriefItems: { type: "Set<string>", values: [...presented] } }),
      source: { session: store.session.get(), route: store.route.get(), events: store.events.get(),
        optimisticEvents: store.optimisticEvents.get(), content: store.content.get(), head: store.head.get(), jobs: store.documentJobs.get() },
      asOf: Number.isFinite(asOf) ? { type: "finite", value: asOf } : { type: "positive-infinity" },
      selection: { selectedOutputId: store.ui.selectedOutputId, selectedEventId: store.ui.selectedEventId,
        comparisonOutputIds: store.ui.comparisonOutputIds, focusBlockId: store.ui.focusBlockId,
        focusCollectionId: store.ui.focusCollectionId, editingBlockId: store.ui.editingBlockId,
        instrumentation: store.ui.instrumentation },
    };
  };
  return { inspect: () => ({
    connected: [owner, card, row, open, popover, wrapper, more, panel, art].map(node => node.isConnected),
    sameStore: owner.store === store, sameOutput: owner.output === output,
    sameArt: card.querySelector(":scope > button.output-art") === art,
    artPressed: art.getAttribute("aria-pressed"), selectedCard: card.classList.contains("selected"),
    publicState: publicState(),
    sourceAccessibleName: popover.triggerAccessibleName, sourceHeading: popover.heading,
    sameOwner: document.querySelector("#e6-root > forma-output-card") === owner,
    sameCard: owner.querySelector(":scope > article.output-card") === card,
    sameRow: card.querySelector(":scope > .output-info > .output-actions") === row,
    sameOpen: row.querySelector(":scope > button.output-open") === open && open.parentElement === row,
    samePopover: row.querySelector(":scope > forma-ui-popover.output-actions-popover") === popover && popover.parentElement === row,
    sameWrapper: popover.querySelector(":scope > .ui-popover") === wrapper && wrapper.parentElement === popover,
    sameMore: wrapper.querySelector(":scope > button.ui-popover-trigger") === more && more.parentElement === wrapper,
    samePanel: wrapper.querySelector(":scope > section.ui-popover-panel[popover]") === panel,
    nativeRelation: more.popoverTargetElement === panel && more.getAttribute("aria-controls") === panel.id && panel.popover === "auto",
    outputId: card.getAttribute("data-output-id"),
    directButtons: row.querySelectorAll(":scope > button").length,
    nestedTriggers: row.querySelectorAll(":scope > forma-ui-popover.output-actions-popover > .ui-popover > button.ui-popover-trigger").length,
    rawLabels: [open.textContent, more.textContent],
    controls: [open, more].map(node => ({ tag: node.tagName, type: node.type, name: node.getAttribute("aria-label"), disabled: node.disabled })),
    expanded: more.getAttribute("aria-expanded"), panelOpen: panel.matches(":popover-open"),
    openPopovers: document.querySelectorAll(":popover-open").length,
    openDialogs: document.querySelectorAll("dialog[open],:modal").length,
  }) };
}

for (const profile of profiles) test.describe(profile.name, () => {
  test.use({ geometry: profile.geometry });
  test("E9 isolated OutputCard Open and More retain complete native peers without activation",
    async ({ page, context, geometry }, testInfo) => {
      const surface = "taste", language = geometry.locale ?? "en-US";
      const apiBypasses = [], errors = [], downloads = [], observations = [], nativeFailures = [], secondaryFailures = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("download", download => downloads.push(download.suggestedFilename()));
      // Preserve the retained isolated E6 pre-navigation boundary. Even an
      // unexpected fetch/XHR/beacon cannot reach a local API through the default GET guard.
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method())) {
          apiBypasses.push({ method: request.method(), origin: url.origin, path: url.pathname });
          await route.abort("blockedbyclient"); return;
        }
        await route.fallback();
      });
      let baseline, owner, originalOwner, beforeURL, peerOwners, initialPeers, labels, expectedMoreName, primaryFailure;
      const custody = async stage => {
        const current = await snapshot(page);
        expect(current.custody).toEqual(baseline.custody);
        expect(current.suppressedTelemetry).toEqual(baseline.suppressedTelemetry);
        expect(current.sourceActive).toBe(true); expect(current.owner).toEqual(baseline.owner);
        expect(current.forbidden).toEqual([]); expect(page.url()).toBe(beforeURL);
        expect(await owner.evaluate((node, retained) => node === retained && node.isConnected, originalOwner)).toBe(true);
        expect(apiBypasses).toEqual([]); expect(downloads).toEqual([]);
        const peers = await peerOwners.evaluate(state => state.inspect());
        await attachJSON(testInfo, stage + "-custody", { fixture: current, peers, expectedMoreName,
          limit: "Sampled actual public Store/output/projection/selection and native owners. The declared projection Set and asOf infinity are explicit. Private caches, other UI state, non-JSON payload objects and continuous invariance are not covered. Suppressed telemetry receipts detect attempted requests, not their payload." });
        expect(peers).toEqual(initialPeers);
        await expect(owner.locator(".output-actions-popover > .ui-popover > button.ui-popover-trigger"))
          .toHaveAccessibleName(expectedMoreName);
      };
      const retain = async (failures, stage, run) => {
        try { await run(); } catch (error) { failures.push(new Error(stage, { cause: error })); }
      };
      testInfo.annotations.push({ type: "scope", description: "Existing synthetic E6 image fixture, actual OutputCard and native focus only. Open and More are never activated. No live account/API, mutation, provider, authorization, AT or production acceptance." });
      try {
        const response = await page.goto(`/tests/e6-noncanvas.fixture.html?surface=${surface}&locale=${language}${profile.narrow ? "&container=narrow" : ""}${process.env.FORMA_E6_BASELINE === "1" ? "&baseline=1" : ""}`,
          { waitUntil: "domcontentloaded" });
        expect(response?.status()).toBe(200);
        await expect.poll(() => snapshot(page)).toMatchObject({ schema: "forma-isolated-e6-r1", surface,
          apiIsolationBeforeOwner: true, sourceActive: true, owner: { connected: true, actualRegistryInstance: true } });
        expect((await snapshot(page)).foundation).toBe(process.env.FORMA_E6_BASELINE === "1"
          ? "/__e6_baseline-responsive-foundation.css" : "/src/responsive-foundation.css");
        await expect(page.locator("forma-shell")).toHaveCount(0);
        await expect(page.locator("html")).toHaveAttribute("lang", language);
        await expect(page.locator("html")).toHaveAttribute("dir", language === "ar" ? "rtl" : "ltr");
        await page.evaluate(() => document.fonts.ready);
        const scriptStack = language === "ar" ? ["ui-sans-serif", "system-ui", "sans-serif"]
          : language === "ja" ? ["Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", "ui-sans-serif", "system-ui", "sans-serif"] : null;
        const expectedTypeface = scriptStack ? { bodyStack: scriptStack, sansStack: scriptStack, formaStack: scriptStack }
          : { firstFamily: "Manrope", manropeLoaded: true };
        await attachJSON(testInfo, "e9-outputcard-typeface-policy", { expected: expectedTypeface, observed: await page.evaluate(typefacePolicy) });
        await expect.poll(() => page.evaluate(typefacePolicy)).toMatchObject(expectedTypeface);
        await applyBrowserZoom(page, context, geometry.zoom, testInfo);
        if (geometry.viewport) {
          const metrics = await browserMetrics(page);
          expect({ width: metrics.width, height: metrics.height }).toEqual(geometry.viewport);
        }
        if (geometry.hasTouch) expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0)).toBe(true);
        if (profile.narrow) expect(await page.locator("#e6-root").evaluate(node => node.getBoundingClientRect().width)).toBeLessThan(400);
        owner = page.locator("#e6-root > forma-output-card");
        await expect(owner).toHaveCount(1); originalOwner = await owner.elementHandle(); beforeURL = page.url();
        baseline = await snapshot(page); expect(baseline.forbidden).toEqual([]);
        const seededOutputs = baseline.custody.events.filter(event => event.type === "GenerationCompleted");
        expect(seededOutputs).toHaveLength(1);
        expect(seededOutputs[0].payload).toMatchObject({ object_ids: ["e6-synthetic-output"], title: "Synthetic retained output",
          provider: "fixture", model_id: "fixture", quality: "high", purpose: "final", media_type: "image/svg+xml" });
        expect(seededOutputs[0].payload.media_url).toMatch(/^data:image\/svg\+xml,/);
        const row = owner.locator(":scope > article.output-card > .output-info > .output-actions");
        const peers = row.locator(peerSelector);
        await expect(row).toHaveCount(1); await expect(peers).toHaveCount(2);
        peerOwners = await row.evaluateHandle(retainPeerOwners);
        initialPeers = await peerOwners.evaluate(state => state.inspect());
        expect(initialPeers).toMatchObject({ connected: Array(9).fill(true), sameStore: true, sameOutput: true, sameArt: true,
          artPressed: "false", selectedCard: false, sameOwner: true, sameCard: true, sameRow: true,
          sameOpen: true, samePopover: true, sameWrapper: true, sameMore: true, samePanel: true, nativeRelation: true,
          outputId: "e6-synthetic-output", directButtons: 1, nestedTriggers: 1, expanded: "false", panelOpen: false,
          openPopovers: 0, openDialogs: 0 });
        expect(initialPeers.controls.map(control => ({ tag: control.tag, type: control.type, disabled: control.disabled })))
          .toEqual([{ tag: "BUTTON", type: "button", disabled: false }, { tag: "BUTTON", type: "button", disabled: false }]);
        const actual = initialPeers.publicState, retainedOutput = JSON.parse(actual.output), retainedProjection = JSON.parse(actual.projection);
        expect(actual.source).toEqual(baseline.custody);
        expect(actual.source.head).toBe(6); expect(actual.asOf).toEqual({ type: "positive-infinity" });
        expect(actual.selection).toEqual({ selectedOutputId: "", selectedEventId: "", comparisonOutputIds: "",
          focusBlockId: "", focusCollectionId: "", editingBlockId: "", instrumentation: true });
        expect(retainedOutput).toMatchObject({ id: "e6-synthetic-output", documentId: "11111111-1111-4111-8111-111111111111",
          title: "Synthetic retained output", sourceEventId: seededOutputs[0].eventId, sequence: seededOutputs[0].sequence,
          mediaUrl: seededOutputs[0].payload.media_url, quality: "high", purpose: "final" });
        expect(seededOutputs[0]).toMatchObject({ eventId: "e6-synthetic-event-6", sequence: 6 });
        expect(JSON.parse(actual.projectedOutputs)).toEqual([retainedOutput]);
        expect(JSON.parse(actual.libraryOutputs)).toEqual([retainedOutput]);
        expect(retainedProjection.outputs).toHaveLength(1); expect(retainedProjection.libraryOutputs).toHaveLength(1);
        expect(retainedProjection.documents).toHaveLength(1);
        expect(retainedProjection.documents[0]).toMatchObject({ id: retainedOutput.documentId, title: "Synthetic E6 document" });
        expect(retainedProjection).toMatchObject({ projectId: "22222222-2222-4222-8222-222222222222",
          documentId: retainedOutput.documentId, documentTitle: "Synthetic E6 document" });
        // The one retained output/document has no Take or collision qualifier.
        // Output naming includes the document in action context even when the
        // separate visible document qualifier is not needed for this one card.
        const actionContext = [retainedOutput.title, retainedProjection.documents[0].title].map(value => "\u2068" + value + "\u2069").join(" · ");
        expectedMoreName = moreCopy[language.split("-")[0]] + " — " + actionContext;
        expect(initialPeers.sourceHeading).toBe(actionContext);
        expect(initialPeers.sourceAccessibleName).toBe(expectedMoreName);
        expect(initialPeers.controls[1].name).toBe(expectedMoreName);
        await expect(peers.nth(1)).toHaveAccessibleName(expectedMoreName);
        labels = initialPeers.rawLabels.map(text => text.trim());
        expect(labels).toHaveLength(2); for (const label of labels) expect(label).toMatch(/\S/);
        await attachJSON(testInfo, "e9-outputcard-baseline-labels", { rawLabels: initialPeers.rawLabels, labels, peers: initialPeers,
          expectedMoreName, suppressedTelemetry: baseline.suppressedTelemetry,
          floor: 44, limit: "The existing OutputCard target token stays 44 CSS pixels, including the declared coarse profile." });
        for (const [index, stage] of [[0, "e9-outputcard-01-open-unactivated"], [1, "e9-outputcard-02-more-unactivated"]]) {
          const target = peers.nth(index);
          await expect(target).toBeVisible(); await expect(target).toBeEnabled();
          await retain(nativeFailures, stage + ": native Tab reachability", () => tabTo(page, target, 160));
          await retain(nativeFailures, stage + ": strict native focus", () => verifyFocus(page, target, testInfo, stage, { overlaySelectors: overlays }));
          await retain(nativeFailures, stage + ": peer observation", async () => {
            const measured = await row.evaluate(controlRow, peerSelector);
            const failures = rowVerdict(measured, labels, true);
            observations.push({ stage, measured, failures });
            await attachJSON(testInfo, stage + "-layout", { ...measured, failures });
          });
          await retain(nativeFailures, stage + ": unchanged source and native owners", () => custody(stage));
        }
        await custody("e9-outputcard-final");
      } catch (error) {
        primaryFailure = error;
      } finally {
        // Finish native/source/boundary evidence before asserting the desired
        // row layout, so a baseline peer failure cannot hide the second stage.
        let final = null;
        await retain(secondaryFailures, "E9 final fixture snapshot failed", async () => { final = await snapshot(page); });
        if (baseline && initialPeers && expectedMoreName)
          await retain(secondaryFailures, "E9 final actual output/selection/name custody failed", () => custody("e9-outputcard-final-tail"));
        await retain(secondaryFailures, "E9 final telemetry custody failed", () => {
          if (baseline && final) expect(final.suppressedTelemetry).toEqual(baseline.suppressedTelemetry);
        });
        await retain(secondaryFailures, "E9 boundary evidence attachment failed", () => attachJSON(testInfo, "e9-outputcard-synthetic-boundary", {
          surface, profile: profile.name, fixture: final, apiBypasses, errors, downloads, observations,
          rawLabels: initialPeers?.rawLabels ?? null,
          limits: "Only the two existing native peers are focused. No activation, image viewer, Taste menu, Memory operation, API write, download, generation, AT or production result." }));
        await retain(secondaryFailures, "E9 peer-owner handle cleanup failed", async () => { await peerOwners?.dispose(); });
        await retain(secondaryFailures, "E9 owner handle cleanup failed", async () => { await originalOwner?.dispose(); });
        await retain(secondaryFailures, "E9 API bypass boundary failed", () => expect(apiBypasses, "No API bypass may reach the preview").toEqual([]));
        await retain(secondaryFailures, "E9 renderer exception boundary failed", () => expect(errors, "A renderer exception is not geometry acceptance").toEqual([]));
        await retain(secondaryFailures, "E9 download boundary failed", () => expect(downloads).toEqual([]));
        await retain(secondaryFailures, "E9 finite request boundary failed", () => { if (final) expect(final.forbidden).toEqual([]); });
      }
      await retain(secondaryFailures, "E9 both native peer stages must be observed", () => expect(observations).toHaveLength(2));
      for (const observation of observations) await retain(secondaryFailures, observation.stage + ": desired peer row", () => {
        expect(observation.measured.floor).toBe(44);
        expect(observation.measured.controls).toHaveLength(2);
        expect(observation.measured.controls.map(control => control.text)).toEqual(initialPeers.rawLabels);
        expect(observation.failures).toEqual([]);
      });
      const failures = [...nativeFailures, ...(primaryFailure ? [primaryFailure] : []), ...secondaryFailures];
      if (failures.length > 1) throw new AggregateError(failures, "E9 OutputCard native, custody, layout or boundary failures");
      if (failures.length) throw failures[0];
    });
});
