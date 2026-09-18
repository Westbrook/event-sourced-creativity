import { test, expect, attachJSON, browserMetrics, captureViewport } from "./fixtures.mjs";
import { tabTo } from "./helpers/keyboard-journey.mjs";
import { SHARED_READER as fixture } from "./helpers/shared-reader-data.mjs";
import { installSharedReaderNetwork } from "./helpers/shared-reader-network.mjs";
import { installDeliverReaderWitness } from "./helpers/deliver-reader-observation.mjs";

// The generic persistent context/read-only guard is reused. Its personal-author
// finite transport is OFF; the explicit shared-reader transport is installed first.
test("Populated synthetic shared-reader Deliver withdraws on owned denied re-entry", async ({ page, context, geometry }, testInfo) => {
  expect(process.env.FORMA_A11Y_SYNTHETIC_NETWORK).toBe("0");
  expect(process.env.FORMA_DELIVER_SHARED_READER).toBe("1");
  expect(testInfo.project.use.baseURL).toBe(fixture.origin);
  expect(geometry).toMatchObject({ viewport: { width: 1280, height: 900 }, zoom: 1, locale: "en-US" });
  expect(page.url()).toBe("about:blank");
  const failures = { pageErrorCount: 0, unexpectedConsoleErrorCount: 0, consoleErrorCount: 0, expectedTelemetryErrorCount: 0, downloadCount: 0, newPageCount: 0, pageErrors: [], consoleErrors: [], downloads: [], newPages: [] };
  let network = null;
  const eventsUrl = fixture.origin + `/api/events?after=${fixture.head}&limit=5000&content=0`;
  page.on("pageerror", error => { failures.pageErrorCount++; if (failures.pageErrors.length < 12) failures.pageErrors.push(String(error).slice(0, 1200)); });
  page.on("console", message => {
    if (message.type() !== "error") return;
    const text = message.text(), url = message.location().url;
    const expectedOwned403ResourceNotice = url === eventsUrl
      && /^Failed to load resource: the server responded with a status of 403 \(Forbidden\)$/.test(text)
      && Boolean(network?.evidence().records.some(row => row.decision === "deny403"
        && row.method === "GET" && row.origin + row.path + row.query === eventsUrl));
    const expectedTelemetryResourceNotice = /^Failed to load resource: net::ERR_BLOCKED_BY_CLIENT(?:\.Inspector)?$/.test(text)
      && Boolean(network?.evidence().records.some(row => row.decision === "abort_telemetry"
        && row.method === "POST" && row.origin === fixture.origin && row.origin + row.path === url));
    failures.consoleErrorCount++;
    if (expectedTelemetryResourceNotice) failures.expectedTelemetryErrorCount++;
    if (!expectedOwned403ResourceNotice && !expectedTelemetryResourceNotice) failures.unexpectedConsoleErrorCount++;
    if (failures.consoleErrors.length < 20) failures.consoleErrors.push({ text: text.slice(0, 1200), url,
      expectedOwned403ResourceNotice, expectedTelemetryResourceNotice });
  });
  page.on("download", download => { failures.downloadCount++; if (failures.downloads.length < 12) failures.downloads.push(download.suggestedFilename()); });
  context.on("page", opened => { if (opened !== page) { failures.newPageCount++; if (failures.newPages.length < 12) failures.newPages.push("unexpected owned-context page"); } });
  network = await installSharedReaderNetwork(context, page, fixture);
  await page.addInitScript(installDeliverReaderWitness, fixture);
  testInfo.annotations.push({ type: "synthetic-shared-reader", description: "Explicit projectContext reader; actor differs from owner; only project.read. Not personal-author relabel or live IAM evidence." });
  const record = async stage => {
    const observation = await page.evaluate(() => window.__formaDeliverReaderWitness.sample());
    await attachJSON(testInfo, stage, { fixture: fixture.fixtureId, observation });
    await captureViewport(page, testInfo, stage);
    return observation;
  };
  const assertionErrors = [];
  try {
    const response = await page.goto(fixture.deliverPath, { waitUntil: "domcontentloaded" });
    expect(response?.ok()).toBe(true);
    await expect(page.locator("forma-shell forma-deliver")).toHaveCount(1);
    await expect(page.locator("forma-deliver .forma-deliver-card")).toHaveCount(1);
    await expect(page.locator("forma-deliver .forma-deliver-card > a.forma-deliver-preview")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const loadedFaces = await page.evaluate(() => [...document.fonts].filter(face => face.status === "loaded")
      .map(face => ({ family: face.family, weight: face.weight, style: face.style })));
    await attachJSON(testInfo, "retained-offline-typeface", { loadedFaces,
      limit: "Exact earlier response bytes replayed locally; no external font request is allowed through." });
    expect(loadedFaces.some(face => face.family.replace(/["']/g, "") === "Manrope")).toBe(true);
    await expect.poll(() => network.pendingEventReads).toBe(0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const initial = await page.evaluate(() => window.__formaDeliverReaderWitness.rememberPopulated());
    const metrics = await browserMetrics(page);
    expect(metrics).toMatchObject({ width: 1280, height: 900, visualScale: 1 });
    await attachJSON(testInfo, "declared-shared-reader-source", { fixtureId: fixture.fixtureId,
      actorUserId: fixture.actorUserId, ownerUserId: fixture.ownerUserId, organizationId: fixture.organizationId,
      projectAccessId: fixture.projectAccessId, projectId: fixture.projectId, documentId: fixture.documentId,
      artifactId: fixture.artifactId, artifactRevision: fixture.artifactRevision,
      sourceEventId: fixture.events.at(-1).eventId, contentRef: fixture.artifactContentRef,
      declaredContentSha256: fixture.artifactContentSha256, initial,
      limits: "Explicit finite declarations, not real grant/authoring/generation. Raw content may be unhydrated in this metadata view; declaration hash is not a downloaded/observed body claim." });
    await record("deliver-shared-reader-populated");
    const navigation = page.locator("forma-ui-audience-navigation[data-primary-navigation=true]");
    await expect(navigation).toHaveCount(1);
    const departure = navigation.locator(`a[href="${fixture.activityPath}"]`);
    await expect(departure).toHaveCount(1); await expect(departure).toBeVisible();
    await tabTo(page, departure, 160); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(fixture.origin + fixture.activityPath);
    await expect(page.locator("forma-deliver")).toHaveCount(0);
    await expect.poll(() => network.pendingEventReads).toBe(0);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const away = await record("deliver-shared-reader-settled-departure");
    expect(away.deliverDisconnected).toBe(true);
    expect(away.sourceActive).toBe(true); expect(away.oldSourceActive).toBe(true); expect(away.source).toEqual(initial.source);
    expect(away.projectId).toBe(fixture.projectId); expect(away.documentId).toBe(fixture.documentId);
    network.armDeparture(away);
    const reentry = navigation.locator(`a[href="${fixture.deliverPath}"]`);
    await expect(reentry).toHaveCount(1); await expect(reentry).toBeVisible();
    await tabTo(page, reentry, 160); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(fixture.origin + fixture.deliverPath);
    await expect.poll(() => page.evaluate(() => window.__formaDeliverReaderWitness.evidence().retirements.length)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__formaDeliverReaderWitness.evidence().frames.some(frame => frame.stage === "first-retirement-animation-frame"))).toBe(true);
    const witness = await page.evaluate(() => window.__formaDeliverReaderWitness.evidence());
    network.recordSourceRetirement(witness.retirements[0]);
    // Source withdrawal can precede native response-body completion. Preserve
    // raw pending lifecycles: classify only the identical Request with owned403
    // fulfillment, actual response headers and this exact source's retirement.
    // The earlier departure barrier still requires all reads actually settled.
    await expect.poll(() => network.evidence().pendingLifecycle.unexpectedPending).toBe(0);
    // Preserve dispatch/microtask/first-frame observations before any eventual DOM assertion.
    await attachJSON(testInfo, "deliver-owned-denial-retirement-boundary", { witness, network: network.evidence() });
    const firstFrame = witness.frames.find(frame => frame.stage === "first-retirement-animation-frame").observation;
    expect(firstFrame.sourceActive).toBe(false); expect(firstFrame.oldSourceActive).toBe(false);
    expect(firstFrame.counts).toMatchObject({ deliver: 0, cards: 0, artifactSummaries: 0, visualHosts: 0,
      outputViews: 0, events: 0, optimisticEvents: 0, libraryArtifacts: 0, libraryOutputs: 0, contentEntries: 0 });
    expect(firstFrame.documentRouteState).toBe("unavailable");
    const final = await record("deliver-owned-denial-unavailable");
    expect(final.session).toEqual(initial.session);
    expect(final.source.authorization).toEqual(initial.source.authorization);
    expect(final.source.generation).toBeGreaterThan(initial.source.generation);
    expect(final.sourceActive).toBe(false); expect(final.deliverDisconnected).toBe(true);
    expect(final.counts).toMatchObject({ deliver: 0, cards: 0, artifactSummaries: 0, visualHosts: 0,
      outputViews: 0, events: 0, optimisticEvents: 0, libraryArtifacts: 0, libraryOutputs: 0, contentEntries: 0 });
    expect(final.retryCount).toBe(1); expect(final.retry?.text).toBe("Retry");
    expect(final.error).toBe("The current source is unavailable. Its saved operation references are retained.");
    const unavailable = page.locator("forma-shell main#main-content > .application-loading[role=status]");
    await expect(unavailable).toBeVisible(); await expect(unavailable.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    expect(witness.unexpectedCount).toBe(0); expect(witness.unexpectedEventCount).toBe(0);
    const transport = network.evidence();
    expect(transport.pendingLifecycle.countersBalanced).toBe(true);
    expect(transport.pendingLifecycle.unexpectedPending).toBe(0);
    expect(transport.pendingLifecycle.rawPending).toBe(transport.pendingLifecycle.ownedDeniedUnfinished);
    expect(transport.pendingEventReads).toBeLessThanOrEqual(transport.counts.responses403);
    expect(transport.phase).toBe("denied"); expect(transport.counts.responses403).toBeGreaterThan(0);
    expect(transport.denial.retirements).toHaveLength(1);
    expect(transport.records.some(row => row.decision === "fixture200" && row.path === "/api/events" && row.query === `?after=${fixture.head}&limit=5000&content=0`)).toBe(true);
    // Stop. Never activate Retry or an artifact/review/export/generation control.
  } catch (error) { assertionErrors.push(error); }
  finally {
    try {
      const witness = await page.evaluate(() => window.__formaDeliverReaderWitness?.evidence() ?? null).catch(() => null);
      await attachJSON(testInfo, "deliver-shared-reader-final-evidence", { fixtureId: fixture.fixtureId,
        network: network.evidence(), witness, failures,
        limits: "Single declared reader/source denial. No live IAM, all-role, touch/AT, full focus-perimeter, artifact quality or reload-safe IndexedDB/queue deletion proof. Generic owned-profile cleanup remains the fixture's responsibility." });
      expect(failures.pageErrorCount).toBe(0); expect(failures.unexpectedConsoleErrorCount).toBe(0);
      expect(failures.downloadCount).toBe(0); expect(failures.newPageCount).toBe(0);
      const transport = network.evidence();
      expect(transport.pendingLifecycle.countersBalanced).toBe(true);
      expect(failures.expectedTelemetryErrorCount).toBeLessThanOrEqual(transport.counts.suppressedTelemetry);
      expect(transport.counts.forbidden).toBe(0); expect(transport.errors).toEqual([]);
      expect(transport.counts.capErrors).toBe(0); expect(transport.counts.recordsDropped).toBe(0); expect(transport.counts.errorsDropped).toBe(0);
    } catch (error) { assertionErrors.push(error); }
    finally { await page.evaluate(() => window.__formaDeliverReaderWitness?.detach()).catch(() => undefined); }
  }
  if (assertionErrors.length > 1) throw new AggregateError(assertionErrors, "Primary journey and final transport failures retained");
  if (assertionErrors.length) throw assertionErrors[0];
});
