import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// New declared approved revision0 fixture, not the prior RAM review snapshot.
// Personal-owner browser export is not an independent-approval gate test.
// Only native Download/file readback is new; prior shared RAM review gate is reused.
import {
  test as base, expect, attachJSON, openForma, captureViewport,
} from "./fixtures.mjs";
import { observeInitialSession } from "./helpers/initial-session.mjs";
import { tabTo, verifyFocus } from "./helpers/keyboard-journey.mjs";
import { classifyTestRequest } from "./helpers/read-only-network.mjs";

function throwFailures(errors, label) {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, label, { cause: errors[0] });
}
async function attempt(errors, action) {
  try { return await action(); } catch (error) { errors.push(error); return undefined; }
}
function record(ledger, key, value) {
  ledger.counts[key] += 1;
  if (ledger[key].length < 64) ledger[key].push(value);
  else ledger.overflow = true;
}
function createLedger() {
  return {
    counts: { pageErrors: 0, dialogs: 0, downloads: 0, observerErrors: 0, apiRequests: 0 },
    pageErrors: [], dialogs: [], downloads: [], observerErrors: [], apiRequests: [],
    overflow: false, pageObserved: false, pageClosed: false,
  };
}

// Backend is a dependency of baseURL -> the unchanged owned context -> page.
// Its finalizer therefore runs after those fixtures, not merely after the test body.
// Playwright retains a test-body failure independently if use() does not throw it.
const test = base.extend({
  audioDownloadFixtureRoot: [null, { option: true }],
  retainedOutputKind: ["audio", { option: true }],
  retainedScenario: ["journey", { option: true }],
  storyBackend: [async ({ retainedOutputKind, retainedScenario, audioDownloadFixtureRoot }, use, testInfo) => {
    const errors = [], ledger = createLedger(), pendingDialogs = new Set();
    let api, lastInspection, disposal, disposalFailure, disposalFulfilled = false;
    try {
      if (typeof audioDownloadFixtureRoot !== "string" || !audioDownloadFixtureRoot.startsWith("/")) throw new Error("The exact detached Audio fixture root must be explicitly configured");
      const { startStoryBackend } = await import(pathToFileURL(resolve(audioDownloadFixtureRoot, "story-backend.mjs")).href);
      api = await startStoryBackend(testInfo.project.name, retainedOutputKind, retainedScenario);
      ledger.expectedMediaPath = api.FIXTURE.mediaPath;
      ledger.expectedProjectId = api.FIXTURE.projectId; ledger.expectedDocumentId = api.FIXTURE.documentIdA;
      await use({ api, ledger, pendingDialogs });
    } catch (error) {
      errors.push(error);
      if (error?.backendObservations) {
        await attempt(errors, () => attachJSON(testInfo, "story-backend-start-failure", error.backendObservations));
      }
    } finally {
      // These independent attempts do not replace a preceding failure.
      await attempt(errors, async () => {
        await Promise.allSettled([...pendingDialogs]);
        await attachJSON(testInfo, "story-browser-ledger-after-context", ledger);
      });
      await attempt(errors, async () => {
        expect(ledger.overflow, "Browser observation retention overflow").toBe(false);
        expect(ledger.pageErrors).toEqual([]);
        expect(ledger.dialogs).toEqual([]);
        expect(ledger.downloads.length).toBeLessThanOrEqual(1);
        expect(ledger.observerErrors).toEqual([]);
        if (ledger.pageObserved) expect(ledger.pageClosed, "Owned page closes through unchanged context fixture").toBe(true);
        assertAllowedRequests(ledger);
      });
      if (api) {
        await attempt(errors, async () => { lastInspection = await api.inspectFinal(); });
        await attempt(errors, () => attachJSON(testInfo, "story-final-native-state", lastInspection ?? { unavailable: true }));
        try { disposal = await api.dispose(); disposalFulfilled = true; }
        catch (error) { disposalFailure = error; errors.push(error); }
        await attempt(errors, () => attachJSON(testInfo, "story-backend-disposal", disposal ?? {
          fulfilled: false, closed: "unconfirmed", backend: disposalFailure?.backendObservations ?? null,
        }));
        if (disposalFulfilled) {
          await attempt(errors, async () => {
            expect(disposal).toMatchObject({ closed: true, backend: {
              runtimeClosed: true, disposed: true, sourceAssetsPreserved: true,
              copiedAssetsPreserved: true, modulePinsPreserved: true, wrapperSourcePreserved: true,
              egressAttemptCount: 0, logOverflow: false, backendFailureCount: 0,
              settlement: { sealed: true, activeInvocationIds: [], failedFinishes: 0,
                protocolFailures: 0, protocolFailureOverflow: false, drainFailures: 0,
                finalReadbackSucceeded: true },
            } });
            const settled = disposal.backend.settlement;
            expect(settled.drainAttempts).toBeGreaterThan(0);
            expect(settled.invocations.length).toBe(settled.cleanFinishes);
            for (const invocation of settled.invocations) {
              expect(invocation.state).toBe("clean");
              expect(invocation.settled).toBe(invocation.registered);
            }
            expect(settled.finalReadback).toEqual(nativePart(lastInspection));
            // Captured waitUntil settlement, not proof about unregistered tasks.
          });
        }
      }
      throwFailures(errors, "Retained Story case/backend finalization failed");
    }
  }, { auto: true }],
  baseURL: async ({ storyBackend }, use) => { await use(storyBackend.api.baseURL); },
});

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function nativePart(observation) { const { backend, ...native } = observation; return native; }
function assertAllowedRequests(ledger) {
  const resume = request => request.method === "POST" && request.path === "/api/workspace/quick-edit"
    && request.classification === "recovery-read" && request.queryless && request.mainFrame
    && request.body?.action === "resume" && request.body.projectId === ledger.expectedProjectId
    && request.body.documentId === ledger.expectedDocumentId;
  const exported = request => request.method === "POST" && request.path === "/api/events"
    && request.queryless && request.mainFrame
    && isDeepStrictEqual(request.body, ledger.exportRequest);
  expect(ledger.apiRequests.filter(request => !["GET", "HEAD"].includes(request.method)
    && request.classification !== "suppressed-telemetry" && !resume(request) && !exported(request))).toEqual([]);
  expect(ledger.apiRequests.filter(exported).length).toBeLessThanOrEqual(1);
  expect(ledger.apiRequests.filter(resume).length).toBeLessThanOrEqual(4);
  expect(ledger.apiRequests.filter(request => /(?:^|\/)(?:media|document-jobs|jobs|image|images|generate|generation)(?:\/|$)/u.test(request.path)
    && !(request.method === "GET" && request.queryless && request.path === ledger.expectedMediaPath)
    && !(request.method === "GET" && request.queryless && request.path === "/api/document-jobs" && request.mainFrame))).toEqual([]);
}
function observePage(page, state, baseURL) {
  const { ledger, pendingDialogs } = state, exports = [], downloads = [];
  let overflow = false;
  ledger.pageObserved = true;
  page.on("close", () => { ledger.pageClosed = true; });
  page.on("pageerror", error => record(ledger, "pageErrors", String(error).slice(0, 2048)));
  page.on("download", download => {
    record(ledger, "downloads", { filename: download.suggestedFilename(), url: download.url(), exportResponsesSeen: exports.length });
    if (downloads.length < 2) downloads.push(download); else overflow = true;
  });
  page.on("dialog", dialog => {
    record(ledger, "dialogs", { type: dialog.type(), message: dialog.message().slice(0, 2048) });
    const task = dialog.dismiss().catch(error => record(ledger, "observerErrors", String(error)))
      .finally(() => pendingDialogs.delete(task));
    pendingDialogs.add(task);
  });
  page.context().on("request", request => {
    try {
      const url = new URL(request.url()); if (url.origin !== baseURL || !url.pathname.startsWith("/api/")) return;
      let mainFrame = false; try { mainFrame = request.frame() === page.mainFrame(); } catch { /* Record the absent frame, without inventing it. */ }
      record(ledger, "apiRequests", { method: request.method(), path: url.pathname, queryless: url.search === "",
        mainFrame, resourceType: request.resourceType(), navigation: request.isNavigationRequest(),
        classification: classifyTestRequest({ method: request.method(), url: request.url(), postData: request.postData(), resourceType: request.resourceType() }, baseURL),
        body: request.postData() === null ? null : request.postDataJSON() });
    } catch (error) { record(ledger, "observerErrors", String(error)); }
  });
  page.on("response", response => {
    const request = response.request();
    if (response.url() === baseURL + "/api/events" && request.method() === "POST") {
      if (exports.length < 2) exports.push(response); else overflow = true;
    }
  });
  return { exports, downloads, assertBounded() { expect(overflow).toBe(false); } };
}
async function currentSource(page, fixture) {
  return page.locator("forma-shell").evaluate((shell, expected) => {
    const store = shell.store, source = store?.captureSourceOwnership();
    if (!shell.isConnected || !store || !store.sourceOwnershipActive(source)) throw new Error("The exact current source is unavailable");
    const projection = store.projection.get(), artifact = projection.libraryArtifacts.find(value => value.id === expected.artifactId);
    if (!artifact) throw new Error("The exact Audio artifact is unavailable");
    return { route: store.route.get(), actorId: store.session.get()?.user.userId,
      source, documentId: projection.documentId, projectId: projection.projectId,
      documentRevision: store.documentGenerationRevision(), events: store.events.get(),
      artifact: { id: artifact.id, documentId: artifact.documentId, kind: artifact.kind, title: artifact.title,
        contentRef: artifact.contentRef, mediaUrl: artifact.mediaUrl, mediaType: artifact.mediaType },
      raw: store.content.get()[artifact.contentRef] ?? null };
  }, fixture);
}
async function assertExport(observed, api, fixture, testInfo) {
  await expect.poll(() => observed.exports.length).toBe(1); observed.assertBounded();
  const response = observed.exports[0], request = response.request();
  expect(request.url()).toBe(api.baseURL + "/api/events"); expect(request.method()).toBe("POST");
  expect(request.postDataJSON()).toEqual(fixture.exportRequest); expect(response.status()).toBe(200);
  const bytes = await response.body(); expect(bytes.length).toBeLessThanOrEqual(64_000);
  const receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  await attachJSON(testInfo, "audio-original-export-ack", { request: fixture.exportRequest, status: response.status(),
    bytes: bytes.length, sha256: hash(bytes), receipt, scope: "Actual built Worker ACK, not a route-fulfilled export response" });
  expect(receipt.appended).toHaveLength(1);
  const event = receipt.appended[0];
  expect(event.type).toBe("DocumentArtifactExported"); expect(event.actor).toBe("user");
  expect(event.payload).toMatchObject(fixture.exportInput.payload);
  expect(event.sequence).toBe(fixture.exportRequest.expectedSequence + 1);
  return event;
}
async function preserveFirstDownload(download, page, fixture, testInfo) {
  const failure = await download.failure(), nativePath = await download.path();
  const outcome = { pageIsOwned: download.page() === page, url: download.url(),
    filename: download.suggestedFilename(), failure, nativePath };
  // Preserve the first outcome before any expected-value assertion.
  await attachJSON(testInfo, "audio-first-browser-download", outcome);
  expect(outcome.pageIsOwned).toBe(true); expect(failure).toBeNull(); expect(nativePath).not.toBeNull();
  const stream = await download.createReadStream(); expect(stream).not.toBeNull();
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length; if (size > 40_000) throw new Error("Original WAV download exceeds its finite 40 KiB cap");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks), savedPath = testInfo.outputPath("Harbor narration.wav");
  await writeFile(savedPath, bytes, { flag: "wx" });
  await testInfo.attach("actual-browser-Harbor-narration.wav", { path: savedPath, contentType: "audio/wav" });
  const reopened = await readFile(savedPath), native = await readFile(nativePath);
  const result = { ...outcome, savedPath, bytes: reopened.length, sha256: hash(reopened),
    nativeBytes: native.length, nativeSha256: hash(native),
    preservation: "First actual browser stream saved exclusively and reopened; no manufactured Blob or second download" };
  await attachJSON(testInfo, "audio-original-wav-readback", result);
  expect(outcome.url).toBe(new URL(fixture.mediaPath, page.url()).href);
  expect(outcome.filename).toBe("Harbor narration.wav"); expect(reopened).toEqual(bytes); expect(native).toEqual(bytes);
  expect(reopened.length).toBe(32044); expect(hash(reopened)).toBe("78f82cd49af869013e8ec414a15d71f5f4f2ec8d006b6a0c50527c91eaa7a85f");
  expect(hash(reopened)).toBe(fixture.mediaSha256);
  return result;
}

test("Audio declared reviewed original WAV downloads once and reopens as exact retained bytes", async ({ page, context, geometry, storyBackend }, testInfo) => {
  const { api, ledger } = storyBackend, fixture = api.FIXTURE, errors = [];
  const initialSession = observeInitialSession(page, fixture.inspectorRoute), observed = observePage(page, storyBackend, api.baseURL);
  ledger.exportRequest = fixture.exportRequest;
  const routed = new Set(), routeErrors = []; let exportRoutes = 0, exportArmed = false;
  const exportRoute = route => {
    const task = (async () => {
      const request = route.request();
      if (request.method() !== "POST") return route.fallback();
      expect(exportArmed, "Only the one explicit native Download action may submit export").toBe(true);
      expect(request.url()).toBe(api.baseURL + "/api/events");
      expect(request.frame()).toBe(page.mainFrame()); expect(request.isNavigationRequest()).toBe(false);
      expect(request.postDataJSON()).toEqual(fixture.exportRequest);
      expect(++exportRoutes).toBe(1);
      return route.continue(); // Actual Worker response, never fulfilled or modified here.
    })();
    routed.add(task); task.catch(error => routeErrors.push(error)).finally(() => routed.delete(task));
    return task;
  };
  await context.route(api.baseURL + "/api/events", exportRoute);
  try {
    const before = nativePart(await api.inspect());
    expect(before).toMatchObject({ eventCount: 8, exportReceipt: null, declaredReviewOnly: true, sharedApprovalGateClaim: false,
      media: { size: 32044, sha256: fixture.mediaSha256, mimeType: "audio/wav", objectCount: 1 },
      download: { exportAttempts: 0, mediaAttempts: 0, exportAcknowledged: false, exportRequests: [], mediaRequests: [] },
      paid: { usedTokens: 0, reservedTokens: 0, usedMicrousd: 0, reservedMicrousd: 0,
        tokenReservationCount: 0, costReservationCount: 0, documentJobCount: 0 } });
    await attachJSON(testInfo, "audio-declared-reviewed-seed", { before,
      scope: "New declared synthetic approved revision0 under personal-owner session. Prior actual shared RAM review/gating is separate evidence; this browser case does not repeat or establish that gate." });
    await openForma(page, context, geometry, fixture.inspectorRoute, testInfo);
    const initial = await initialSession.read();
    expect(initial.session.user.userId).toBe(fixture.userId); expect(initial.session.provider.configured).toBe(false);
    expect(initial.session.provider.audioConfigured).toBe(false); expect(initial.session.projectContext ?? null).toBeNull();
    await attachJSON(testInfo, "audio-download-initial-session", initial);
    const dialog = page.locator('dialog.document-artifact-view[data-artifact-kind="audio"]:modal');
    await expect(dialog).toBeVisible(); await expect(dialog).toHaveAttribute("data-output-focus", "false");
    await expect(dialog.locator(".artifact-viewer-identity > h2")).toHaveText(fixture.title);
    await expect(dialog.locator(".artifact-review-status")).toHaveText("Approved");
    await expect(dialog.locator(".artifact-viewer-details code")).toHaveText(fixture.rawContentSha256);
    const original = await currentSource(page, fixture);
    expect(original).toMatchObject({ route: fixture.inspectorRoute, actorId: fixture.userId,
      documentId: fixture.documentIdA, projectId: fixture.projectId,
      artifact: { id: fixture.artifactId, documentId: fixture.documentIdA, kind: "audio", title: "Harbor narration",
        contentRef: fixture.contentId, mediaUrl: fixture.mediaPath, mediaType: "audio/wav" } });
    expect(original.raw).toBe(fixture.raw); expect(hash(original.raw)).toBe(fixture.rawContentSha256);
    const review = original.events.filter(event => ["ArtifactReviewRequested", "ArtifactApproved"].includes(event.type)
      && event.payload.artifact_id === fixture.artifactId);
    expect(review).toHaveLength(2); expect(review.map(event => event.type)).toEqual(["ArtifactReviewRequested", "ArtifactApproved"]);
    for (const event of review) expect(event.payload).toMatchObject({ document_id: fixture.documentIdA,
      artifact_revision: 0, content_sha256: fixture.rawContentSha256 });
    expect(review[0].actor).toBe("user:" + fixture.userId);
    expect(review[1].actor).toBe("user:" + review[0].payload.assigned_reviewer_user_id);
    expect(review[1].actor).not.toBe(review[0].actor);
    const audio = dialog.locator("audio");
    await expect(audio).toHaveCount(1); await expect(audio).toHaveAttribute("src", fixture.mediaPath);
    await expect(audio).toHaveAttribute("preload", "none");
    expect(await audio.evaluate(node => ({ paused: node.paused, autoplay: node.autoplay, time: node.currentTime })))
      .toEqual({ paused: true, autoplay: false, time: 0 });
    expect(observed.downloads).toHaveLength(0);
    const menu = dialog.locator(".artifact-viewer-actions-popover section:popover-open");
    const more = dialog.getByRole("button", { name: "More actions", exact: true });
    if (!await menu.isVisible()) {
      await tabTo(page, more, 100); await verifyFocus(page, more, testInfo, "audio-download-more-actions", { checkVisibleControls: false });
      await page.keyboard.press("Enter");
    }
    await expect(menu).toBeVisible();
    const choice = menu.getByRole("button", { name: "Download audio", exact: true });
    await expect(choice).toBeEnabled(); await tabTo(page, choice, 100);
    await verifyFocus(page, choice, testInfo, "audio-original-download-focus", { checkVisibleControls: false });
    await captureViewport(page, testInfo, "audio-original-ready-to-download");
    expect(await currentSource(page, fixture)).toEqual(original);
    const waiting = page.waitForEvent("download", { timeout: 10_000 })
      .then(value => ({ value }), error => ({ error }));
    let activationError;
    exportArmed = true;
    try { await page.keyboard.press("Enter"); } catch (error) { activationError = error; }
    const outcome = await waiting; // Always settles the original waiter, including activation failure.
    throwFailures([activationError, outcome.error].filter(Boolean), "Native Download activation/wait failed");
    const download = outcome.value;
    const file = await preserveFirstDownload(download, page, fixture, testInfo);
    const exported = await assertExport(observed, api, fixture, testInfo);
    await expect.poll(async () => (await currentSource(page, fixture)).events.length).toBe(original.events.length + 1);
    const after = await currentSource(page, fixture);
    expect(after).toEqual({ ...original, events: [...original.events, exported] });
    expect(observed.downloads).toHaveLength(1); expect(observed.downloads[0]).toBe(download);
    expect(ledger.downloads[0].exportResponsesSeen).toBe(1);
    await expect(menu).toHaveCount(0); await expect(more).toBeFocused();
    await verifyFocus(page, more, testInfo, "audio-original-after-download-focus", { checkVisibleControls: false });
    expect(await audio.evaluate(node => ({ paused: node.paused, autoplay: node.autoplay, time: node.currentTime })))
      .toEqual({ paused: true, autoplay: false, time: 0 });
    const final = nativePart(await api.inspect());
    expect(final).toEqual({ ...before, eventCount: 9, eventTypes: [...before.eventTypes, "DocumentArtifactExported"],
      events: [...before.events, exported], exportReceipt: exported, download: final.download });
    const transport = final.download;
    expect(transport).toMatchObject({ exportAttempts: 1, mediaAttempts: 1, maximumExports: 1,
      maximumMediaGets: 1, exportAcknowledged: true });
    expect(transport.exportRequests).toHaveLength(1); expect(transport.mediaRequests).toHaveLength(1);
    const released = transport.exportRequests[0], media = transport.mediaRequests[0];
    expect(released).toMatchObject({ method: "POST", path: "/api/events", disposition: "actual-worker-response",
      request: fixture.exportRequest, receipt: exported,
      custodyBefore: { eventCount: 8, authoringCommits: 0, media: before.media, verified: true },
      custodyAfter: { eventCount: 9, authoringCommits: 0, media: before.media, verified: true },
      workerResponse: { status: 200, accepted: true, body: { complete: true } } });
    const ackBytes = Buffer.from(released.workerResponse.rawBodyBase64, "base64");
    expect(ackBytes).toEqual(await observed.exports[0].body());
    expect(hash(ackBytes)).toBe(released.workerResponse.rawBodySha256);
    const range = media.requestHeaders.range ?? null;
    expect([null, "bytes=0-"]).toContain(range);
    const mediaStatus = range === null ? 200 : 206;
    expect(media.workerResponse.headers["content-range"] ?? null)
      .toBe(range === null ? null : "bytes 0-32043/32044");
    if (range !== null) expect(media.workerResponse.headers["content-length"]).toBe("32044");
    expect(media).toMatchObject({ method: "GET", path: fixture.mediaPath, disposition: "actual-worker-response",
      exportAcknowledgedBeforeDispatch: true, exportEventId: exported.eventId,
      custodyBefore: { eventCount: 9, media: before.media, verified: true },
      custodyAfter: { eventCount: 9, media: before.media, verified: true },
      workerResponse: { status: mediaStatus, accepted: true, rawBodyBytes: 32044, rawBodySha256: file.sha256,
        body: { complete: true }, headers: { "content-type": "audio/wav", "cache-control": "private, no-store",
          "x-content-type-options": "nosniff", "accept-ranges": "bytes" } } });
    const mediaBytes = Buffer.from(media.workerResponse.rawBodyBase64, "base64");
    expect(mediaBytes).toEqual(await readFile(file.savedPath));
    expect(hash(mediaBytes)).toBe(fixture.mediaSha256);
    await attachJSON(testInfo, "audio-export-download-wire", { transport,
      scope: "Exact actual Worker export response precedes one owned WAV GET. Request headers are observed diagnostics; no playback Fetch Metadata or browser resource-type assumption." });
    await attachJSON(testInfo, "audio-reviewed-download-complete", { before, after: final, original, current: after, file,
      scope: "One browser Download of the declared exact reviewed original, preserving the first native file; typed export is not recipient delivery. Personal browser export does not re-prove shared independent approval gating.",
      concurrentReplacement: "Not tested; stable source/artifact/raw/media equality is observed before and after the single action." });
    expect(exportRoutes).toBe(1); expect(routeErrors).toEqual([]);
    assertAllowedRequests(ledger); observed.assertBounded();
    await captureViewport(page, testInfo, "audio-original-after-download");
  } catch (error) { errors.push(error); }
  finally {
    initialSession.dispose();
    await attempt(errors, () => context.unroute(api.baseURL + "/api/events", exportRoute));
    await Promise.allSettled([...routed]); errors.push(...routeErrors);
    if (errors.length && !page.isClosed()) await attempt(errors, () => captureViewport(page, testInfo, "audio-reviewed-download-failure", { assertStable: false }));
    throwFailures(errors, "Audio reviewed original Download failed");
  }
});
