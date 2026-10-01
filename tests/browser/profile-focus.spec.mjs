import { test, expect, attachJSON, applyBrowserZoom, browserMetrics, captureViewport } from "./fixtures.mjs";
import { tabTo, verifyFocus, pressTo } from "./helpers/keyboard-journey.mjs";
import { PROFILE_FOCUS_DOCUMENT, PROFILE_FOCUS_ENTRY, installProfileFocusBrowserBoundary } from "../profile-focus.transport.mjs";

// One retained native geometry, four paths. No broad matrix or whole-app claim.
test.use({ geometry: { viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" } });
const snapshot = page => page.evaluate(() => globalThis.formaProfileFocusFixture?.snapshot() ?? null);
const observation = { regionSelectors: ["forma-personal-memory"], checkVisibleControls: true };
const fixtureScope = "Synthetic component-only Profile focus; actual component/Store/client/focus helper, no account, backend, provider, whole-app or AT acceptance.";

function assertOwned(value) {
  expect(value).toMatchObject({ schema: "forma-profile-focus-native-r1", closed: false,
    apiIsolationBeforeOwner: true, actualRegistryInstance: true, connected: true, actualStore: true,
    sourceActive: true, authorizationActive: true, stableSources: true, focusOverflow: 0,
    transport: { installed: true, closed: false, poisoned: false, denied: [], deniedOverflow: 0, networkRequestsForwarded: 0 } });
}

async function runProfileCase({ page, context, geometry, baseURL }, testInfo, caseId) {
  // The historical E6 network/build is not this fixture. Keep its mode off;
  // ordinary retained read-only policy remains active beneath our local guard.
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK ?? "0").toBe("0");
  testInfo.annotations.push({ type: "scope", description: fixtureScope });
  const network = await installProfileFocusBrowserBoundary(context, baseURL, caseId);
  const pageErrors = [], cleanupErrors = [];
  const onPageError = error => pageErrors.push(String(error));
  page.on("pageerror", onPageError);
  let primaryError, baseline = null, final = null;
  try {
    const response = await page.goto(PROFILE_FOCUS_ENTRY + "?case=" + caseId, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect.poll(() => snapshot(page)).toMatchObject({ caseId, connected: true, sourceActive: true, actualRegistryInstance: true });
    await page.evaluate(() => document.fonts.ready);
    await applyBrowserZoom(page, context, geometry.zoom, testInfo);
    const metrics = await browserMetrics(page);
    expect({ width: metrics.width, height: metrics.height }).toEqual(geometry.viewport);
    await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.locator("forma-shell")).toHaveCount(0);
    const owner = page.locator("#profile-focus-root > forma-personal-memory");
    await expect(owner).toHaveCount(1);
    const documentChoice = owner.locator('select[name="memory-document"]');
    await expect(documentChoice).toBeEnabled();
    expect((await snapshot(page)).transport.requests).toHaveLength(1);
    await documentChoice.selectOption(PROFILE_FOCUS_DOCUMENT); // Existing native-control preparation seam.
    await expect.poll(async () => (await snapshot(page)).transport.requests.length).toBe(2);
    const profile = owner.locator("details[data-memory-profile]");
    await expect(profile).toHaveCount(1);
    const summary = profile.locator(":scope > summary");
    await tabTo(page, summary);
    await page.keyboard.press("Enter");
    await expect(profile).toHaveAttribute("open", "");
    expect((await snapshot(page)).transport.requests).toHaveLength(2);
    const load = profile.locator('[data-memory-profile-action="load"]');
    const inspect = profile.locator('[data-memory-profile-action="inspect"]');
    const heading = owner.locator('h2[data-memory-focus="heading"]');
    const view = profile.locator("[data-memory-profile-view]");
    const hide = profile.getByRole("button", { name: "Close palette view", exact: true });
    const suppress = profile.getByRole("button", { name: "Hide this palette claim", exact: true });
    const refresh = owner.locator('[data-memory-action="refresh"]');
    await expect(load).toHaveAccessibleName("Load palette settings");
    await tabTo(page, load); await page.keyboard.press("Enter");
    await expect(inspect).toBeEnabled();
    await expect(inspect).toHaveAccessibleName("Inspect palette choices");
    await tabTo(page, inspect); await page.keyboard.press("Enter");
    await expect(view).toHaveCount(1);
    await expect(view).toContainText("#123abc");
    await expect(view.getByRole("heading", { name: "Conflicting statements included", exact: true })).toHaveCount(1);
    baseline = await snapshot(page); assertOwned(baseline);
    expect(baseline.transport.requests).toHaveLength(4);
    expect(baseline.transport.requests.map(request => request.method)).toEqual(["GET", "GET", "GET", "GET"]);
    expect(baseline.transport.requests.every(request => request.outcome === "responded")).toBe(true);
    await attachJSON(testInfo, "profile-" + caseId + "-setup", baseline);

    if (caseId === "hide-dirty") {
      const retention = owner.locator('input[name="memory-retention"]');
      await tabTo(page, retention, 80, "Shift+Tab");
      await retention.fill("45"); await page.keyboard.press("Tab");
      await expect(retention).toHaveValue("45");
      await expect(inspect).toBeDisabled();
      expect((await snapshot(page)).departureBlocked).toBe(true);
    }
    if (caseId === "hide-clean" || caseId === "hide-dirty") {
      await tabTo(page, hide);
      await verifyFocus(page, hide, testInfo, caseId + "-before-hide", observation);
      const before = await snapshot(page);
      await page.keyboard.press("Enter");
      await expect(view).toHaveCount(0);
      const target = caseId === "hide-clean" ? inspect : load;
      await verifyFocus(page, target, testInfo, caseId + "-returned-focus", observation);
      const after = await snapshot(page);
      expect(after.transport.requests).toEqual(before.transport.requests);
      expect(after.focusEvents.slice(before.focusEvents.length).filter(event =>
        event.target?.profileAction === (caseId === "hide-clean" ? "inspect" : "load"))).toHaveLength(1);
      if (caseId === "hide-dirty") {
        await expect(owner.locator('input[name="memory-retention"]')).toHaveValue("45");
        await expect(inspect).toBeDisabled(); await expect(load).toBeEnabled();
        expect(after.departureBlocked).toBe(true);
      }
    } else if (caseId === "expiry") {
      await tabTo(page, hide);
      await verifyFocus(page, hide, testInfo, "expiry-before-deadline", observation);
      const before = await snapshot(page), wall = await page.evaluate(() => Date.now());
      expect(before.transport.inspection.leaseMs).toBe(10_000);
      expect(Date.parse(before.transport.inspection.validUntil)).toBeGreaterThan(wall);
      await attachJSON(testInfo, "expiry-actual-deadline", { wall, inspection: before.transport.inspection, active: before.active });
      // Actual browser timer and actual client elapsed clock; no clock override,
      // dispatchEvent wake-up, lease mutation or forced focus.
      await expect(view).toHaveCount(0, { timeout: 15_000 });
      const retiredClock = await page.evaluate(() => ({ wall: Date.now(), monotonic: performance.now() }));
      await attachJSON(testInfo, "expiry-retirement-observation", {
        retiredClock, originalValidUntil: before.transport.inspection.validUntil,
        limit: "The real client also bounds elapsed time from before fetch. Its private request-start clock is not instrumented; this observation does not certify an exact retirement instant.",
      });
      await verifyFocus(page, inspect, testInfo, "expiry-returned-focus", observation);
      await expect(profile.getByRole("status")).toHaveText("The palette view has been retired. A new explicit inspection requires current permission.");
      const after = await snapshot(page);
      expect(after.transport.requests).toEqual(before.transport.requests);
      expect(after.focusEvents.slice(before.focusEvents.length).filter(event => event.target?.profileAction === "inspect")).toHaveLength(1);
    } else if (caseId === "suppress") {
      await tabTo(page, suppress);
      await verifyFocus(page, suppress, testInfo, "suppress-before-request", observation);
      const before = await snapshot(page);
      await page.keyboard.press("Enter");
      await expect.poll(async () => (await snapshot(page)).transport.pending).toBe(true);
      await expect(view).toHaveCount(0);
      await expect(inspect).toBeDisabled(); await expect(load).toBeDisabled();
      await expect(profile.locator(":scope > div")).toHaveAttribute("aria-busy", "true");
      await expect(profile.getByRole("status")).toHaveText("Working on the requested palette action…");
      await expect(heading).toHaveAttribute("tabindex", "-1");
      await expect(heading).toHaveAccessibleName("Personal memory");
      await verifyFocus(page, heading, testInfo, "suppress-pending-heading", observation);
      const held = await snapshot(page); assertOwned(held);
      expect(held.transport.requests).toHaveLength(5);
      expect(held.transport.requests.at(-1)).toEqual({ method: "PUT", path: "/api/memory/document-profile/suppress",
        outcome: "held", body: { version: "document-profile-control-v1", grantId: held.transport.grant.grantId,
          grantRevision: 1, claimKey: (904).toString(16).padStart(64, "0"), revision: 0,
          confirmation: "SUPPRESS_DOCUMENT_PALETTE_CLAIM" } });
      expect(held.focusEvents.slice(before.focusEvents.length).filter(event => event.target?.heading)).toHaveLength(1);
      await attachJSON(testInfo, "suppress-held-before-release", held);
      // Native Tab gives another existing enabled control focus ownership.
      // A later acknowledgment is transport control, not an app gesture.
      await pressTo(page, "Tab", refresh, testInfo, "suppress-new-focus-owner", observation);
      await page.evaluate(() => globalThis.formaProfileFocusFixture.releaseSuppression());
      await expect(profile.locator(":scope > div")).toHaveAttribute("aria-busy", "false");
      await expect(profile.getByRole("status")).toHaveText("The selected palette claim was hidden for this permission. Inspect again to load a fresh view.");
      await expect(load).toBeEnabled(); await expect(inspect).toBeEnabled();
      await verifyFocus(page, refresh, testInfo, "suppress-completion-keeps-owner", observation);
      const after = await snapshot(page);
      expect(after.transport.requests).toHaveLength(5);
      expect(after.transport.requests.at(-1).outcome).toBe("acknowledged");
      expect(after.transport.pending).toBe(false); expect(after.transport.released).toBe(true);
      expect(after.focusEvents.slice(before.focusEvents.length).filter(event => event.target?.heading)).toHaveLength(1);
    } else throw new Error("Undeclared native Profile case");
    await expect(view).toHaveCount(0);
    await expect(owner).not.toContainText("#123abc");
    final = await snapshot(page); assertOwned(final);
    expect(final.custody).toEqual(baseline.custody);
    expect(final.transport.requests).toHaveLength(caseId === "suppress" ? 5 : 4);
    expect(final.transport.requests.filter(request => request.method !== "GET")).toHaveLength(caseId === "suppress" ? 1 : 0);
    expect(pageErrors).toEqual([]);
  } catch (error) {
    primaryError = error;
  } finally {
    // Retained E6 cleanup pattern: keep the first failure and every subsequent
    // evidence/cleanup failure. Never replace a product failure with a pass.
    const retain = async (stage, run) => {
      try { await run(); } catch (error) { cleanupErrors.push(new Error(stage, { cause: error })); }
    };
    await retain("Profile final snapshot", async () => { final = await snapshot(page); });
    await retain("Profile final evidence", () => attachJSON(testInfo, "profile-" + caseId + "-final",
      { scope: fixtureScope, final, network, pageErrors }));
    await retain("Profile final viewport", () => captureViewport(page, testInfo, "profile-" + caseId + "-final"));
    await retain("Profile source custody", async () => {
      if (!baseline) throw new Error("Profile setup custody was not established");
      assertOwned(final); expect(final.custody).toEqual(baseline.custody);
    });
    await retain("Profile fixture cleanup", async () => {
      const disposed = await page.evaluate(() => globalThis.formaProfileFocusFixture?.dispose() ?? null);
      await attachJSON(testInfo, "profile-" + caseId + "-disposed", disposed);
      expect(disposed).toMatchObject({ closed: true, connected: false, transport: { closed: true, pending: false, installed: true } });
    });
    await retain("Profile default-deny boundary", async () => {
      expect(network).toMatchObject({ forbidden: [], overflow: 0, actualApiRequests: 0 });
      expect(pageErrors).toEqual([]);
    });
    page.off("pageerror", onPageError);
    // Retained fixtures.mjs saves trace/network and closes/removes the owned
    // disposable browser profile. Case-local routes stay guarded until close.
  }
  if (primaryError && cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], "Profile native path and cleanup failed");
  if (primaryError) throw primaryError;
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Profile native cleanup failed");
}

test("Profile native focus: clean Hide returns to Inspect", async ({ page, context, geometry, baseURL }, testInfo) =>
  runProfileCase({ page, context, geometry, baseURL }, testInfo, "hide-clean"));
test("Profile native focus: dirty Hide returns to Load and preserves the draft", async ({ page, context, geometry, baseURL }, testInfo) =>
  runProfileCase({ page, context, geometry, baseURL }, testInfo, "hide-dirty"));
test("Profile native focus: real display expiry returns to Inspect without a read", async ({ page, context, geometry, baseURL }, testInfo) =>
  runProfileCase({ page, context, geometry, baseURL }, testInfo, "expiry"));
test("Profile native focus: pending Suppress uses the heading once and completion keeps the new owner", async ({ page, context, geometry, baseURL }, testInfo) =>
  runProfileCase({ page, context, geometry, baseURL }, testInfo, "suppress"));
