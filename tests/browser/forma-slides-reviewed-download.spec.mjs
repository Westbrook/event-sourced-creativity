import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// New declared approved revision1 fixture, not the prior RAM review snapshot.
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
  slidesDownloadFixtureRoot: [null, { option: true }],
  retainedOutputKind: ["slides", { option: true }],
  retainedScenario: ["journey", { option: true }],
  storyBackend: [async ({ retainedOutputKind, retainedScenario, slidesDownloadFixtureRoot }, use, testInfo) => {
    const errors = [], ledger = createLedger(), pendingDialogs = new Set();
    let api, lastInspection, disposal, disposalFailure, disposalFulfilled = false;
    try {
      if (typeof slidesDownloadFixtureRoot !== "string" || !slidesDownloadFixtureRoot.startsWith("/")) throw new Error("The exact detached Slides fixture root must be explicitly configured");
      const { startStoryBackend } = await import(pathToFileURL(resolve(slidesDownloadFixtureRoot, "story-backend.mjs")).href);
      api = await startStoryBackend(testInfo.project.name, retainedOutputKind, retainedScenario);
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
    if (!artifact) throw new Error("The exact Slides artifact is unavailable");
    return { route: store.route.get(), actorId: store.session.get()?.user.userId,
      source, documentId: projection.documentId, projectId: projection.projectId,
      documentRevision: store.documentGenerationRevision(), events: store.events.get(),
      artifact: { id: artifact.id, documentId: artifact.documentId, kind: artifact.kind, title: artifact.title,
        contentRef: artifact.contentRef, itemCount: artifact.itemCount,
        revision: store.events.get().filter(event => event.type === "DocumentArtifactEdited" && event.payload.artifact_id === expected.artifactId).length },
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
  await attachJSON(testInfo, "slides-original-export-ack", { request: fixture.exportRequest, status: response.status(),
    bytes: bytes.length, sha256: hash(bytes), receipt, scope: "Actual built Worker ACK, not a route-fulfilled export response" });
  expect(receipt.appended).toHaveLength(1);
  const event = receipt.appended[0];
  expect(event.type).toBe("DocumentArtifactExported"); expect(event.actor).toBe("user");
  expect(event.payload).toMatchObject(fixture.exportInput.payload);
  expect(event.sequence).toBe(fixture.exportRequest.expectedSequence + 1);
  return event;
}
// Exact independent ZIP/CRC/relationship and editable-text reader declarations
// reused from tests/office-documents.test.mjs, also used by the accepted Slides
// revision/review/file test. No exporter or test body is called to create a file.
function verifyOfficeArchive(bytes,{binary=false}={}){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.byteLength-22;
  assert.equal(view.getUint32(end,true),0x06054b50,"the ZIP end-of-central-directory record exists");
  const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true);
  let central=view.getUint32(end+16,true);
  assert.equal(central+length,end,"central-directory boundaries match the archive footer");
  const entries=new Map();
  for(let index=0;index<count;index+=1){
    assert.equal(view.getUint32(central,true),0x02014b50,"every advertised central-directory entry exists");
    const nameLength=view.getUint16(central+28,true),extraLength=view.getUint16(central+30,true),commentLength=view.getUint16(central+32,true);
    const name=new TextDecoder().decode(bytes.slice(central+46,central+46+nameLength));
    const local=view.getUint32(central+42,true),size=view.getUint32(central+24,true);
    assert.equal(view.getUint32(local,true),0x04034b50,`${name} has a real local-file header`);
    assert.equal(view.getUint16(local+8,true),0,"the dependency-free archive uses interoperable ZIP STORE parts");
    const offset=local+30+view.getUint16(local+26,true)+view.getUint16(local+28,true);
    const body=bytes.slice(offset,offset+size);
    let crc=0xffffffff;
    for(const byte of body){crc^=byte;for(let bit=0;bit<8;bit+=1)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}
    assert.equal((crc^0xffffffff)>>>0,view.getUint32(central+16,true),`${name} has a valid independently calculated CRC-32`);
    assert.equal(size,view.getUint32(local+22,true),`${name} has consistent local and central uncompressed sizes`);
    entries.set(name,binary?body:new TextDecoder().decode(body));
    central+=46+nameLength+extraLength+commentLength;
  }
  assert.equal(central,end);
  for(const [name,xml] of entries){
    if(!name.endsWith(".rels")||typeof xml!=="string")continue;
    const base=name==="_rels/.rels"?"":name.replace(/\/_rels\/[^/]+\.rels$/,"/");
    for(const [,target] of xml.matchAll(/\bTarget="([^"]+)"/g)){
      if(/^[a-z]+:/i.test(target))continue;
      const resolved=path.posix.normalize(path.posix.join(base,target));
      assert.ok(entries.has(resolved),`${name} relationship resolves to existing package part ${resolved}`);
    }
  }
  return entries;
}

function editableShape(xml,name,kind="sp"){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const expression=new RegExp(`<p:${kind}>(?:(?!<\\/p:${kind}>)[\\s\\S])*?<p:cNvPr id="\\d+" name="${escaped}"(?:(?!<\\/p:${kind}>)[\\s\\S])*?<\\/p:${kind}>`);
  const match=xml.match(expression);
  assert.ok(match,`editable PowerPoint ${kind} exists: ${name}`);
  return match[0];
}

function shapeText(xml,name){
  return [...editableShape(xml,name).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(([,value])=>value).join("\n");
}

const decodeXml = value => value.replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
async function preserveFirstDownload(download, page, fixture, testInfo) {
  const failure = await download.failure(), nativePath = await download.path();
  const outcome = { pageIsOwned: download.page() === page, url: download.url(),
    filename: download.suggestedFilename(), failure, nativePath };
  await attachJSON(testInfo, "slides-first-browser-download", outcome);
  expect(outcome.pageIsOwned).toBe(true); expect(failure).toBeNull(); expect(nativePath).not.toBeNull();
  const stream = await download.createReadStream(); expect(stream).not.toBeNull();
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length; if (size > 1_048_576) throw new Error("Two-slide audience PPTX exceeds the finite 1 MiB case bound");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks), savedPath = testInfo.outputPath("harbor-decisions.pptx");
  await writeFile(savedPath, bytes, { flag: "wx" });
  await testInfo.attach("actual-browser-harbor-decisions.pptx", { path: savedPath, contentType: PPTX_MIME });
  const reopened = await readFile(savedPath), native = await readFile(nativePath);
  const result = { ...outcome, savedPath, bytes: reopened.length, sha256: hash(reopened),
    nativeBytes: native.length, nativeSha256: hash(native), mimeType: PPTX_MIME,
    preservation: "First actual browser stream saved exclusively and reopened; original browser file equals saved bytes. No second export or manufactured Blob." };
  await attachJSON(testInfo, "slides-original-pptx-readback", result);
  const url = new URL(outcome.url);
  expect(url.protocol).toBe("blob:"); expect(url.origin).toBe(new URL(page.url()).origin);
  expect(outcome.filename).toBe("harbor-decisions.pptx"); expect(reopened).toEqual(bytes); expect(native).toEqual(bytes);
  const parts = verifyOfficeArchive(reopened);
  const slides = [...parts.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  expect(slides).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);
  expect(parts.get("[Content_Types].xml")).toContain("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml");
  expect(parts.get("[Content_Types].xml")).toContain("application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
  const completeXml = [...parts.values()].join("\n"), editable = [];
  for (const [index, item] of fixture.body.items.entries()) {
    const slide = parts.get(`ppt/slides/slide${index + 1}.xml`), notes = parts.get(`ppt/notesSlides/notesSlide${index + 1}.xml`);
    const title = decodeXml(shapeText(slide, "Editable slide title"));
    const body = decodeXml(shapeText(slide, "Editable slide content"));
    expect(title).toBe(item.title); expect(body).toBe(item.body);
    expect(typeof notes).toBe("string");
    const noteText = [...notes.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(([, value]) => decodeXml(value)).join("\n");
    expect(noteText).toBe("");
    for (const note of item.notes.split("\n")) {
      expect(decodeXml(slide)).not.toContain(note);
      expect(decodeXml(completeXml)).not.toContain(note);
    }
    editable.push({ part: `ppt/slides/slide${index + 1}.xml`, title, body, presenterNotes: noteText });
  }
  await attachJSON(testInfo, "slides-audience-pptx-structure", { bytes: result.bytes, sha256: result.sha256,
    parts: parts.size, slides: editable, validZipCrcAndRelationships: true, privateNotesExcluded: true,
    scope: "Independent read of the first actual browser file; no second serializer comparison or presentation-application rendering claim." });
  return result;
}

test("Slides declared reviewed revision one downloads one audience PowerPoint file", async ({ page, context, geometry, storyBackend }, testInfo) => {
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
    expect(fixture.rawContentSha256).toBe("6a2a62709ac9dcdc35d46c3b502e3bfa42cf5a5866bd6a65b7fd492665c16163");
    expect(Buffer.byteLength(fixture.raw)).toBe(1622); expect(fixture.expectedMimeType).toBe(PPTX_MIME);
    const before = nativePart(await api.inspect());
    expect(before).toMatchObject({ eventCount: 9, exportReceipt: null, declaredReviewOnly: true, sharedApprovalGateClaim: false,
      media: { objectCount: 0 },
      download: { exportAttempts: 0, mediaAttempts: 0, exportAcknowledged: false, exportRequests: [], mediaRequests: [] },
      paid: { usedTokens: 0, reservedTokens: 0, usedMicrousd: 0, reservedMicrousd: 0,
        tokenReservationCount: 0, costReservationCount: 0, documentJobCount: 0 } });
    await attachJSON(testInfo, "slides-declared-reviewed-seed", { before,
      scope: "New declared synthetic approved revision1 under personal-owner session. Prior actual shared RAM review/gating is separate evidence; this browser case does not repeat or establish that gate." });
    await openForma(page, context, geometry, fixture.inspectorRoute, testInfo);
    const initial = await initialSession.read();
    expect(initial.session.user.userId).toBe(fixture.userId); expect(initial.session.provider.configured).toBe(false);
    expect(initial.session.projectContext ?? null).toBeNull();
    await attachJSON(testInfo, "slides-download-initial-session", initial);
    const dialog = page.locator('dialog.document-artifact-view[data-artifact-kind="slides"]:modal');
    await expect(dialog).toBeVisible(); await expect(dialog).toHaveAttribute("data-output-focus", "false");
    await expect(dialog.locator(".artifact-viewer-identity > h2")).toHaveText(fixture.title);
    await expect(dialog.locator(".artifact-review-status")).toHaveText("Approved");
    await expect(dialog.locator(".artifact-viewer-details code")).toHaveText(fixture.rawContentSha256);
    const original = await currentSource(page, fixture);
    expect(original).toMatchObject({ route: fixture.inspectorRoute, actorId: fixture.userId,
      documentId: fixture.documentIdA, projectId: fixture.projectId,
      artifact: { id: fixture.artifactId, documentId: fixture.documentIdA, kind: "slides", title: "Harbor decisions",
        contentRef: fixture.contentId, itemCount: 2, revision: 1 } });
    expect(original.raw).toBe(fixture.raw); expect(hash(original.raw)).toBe(fixture.rawContentSha256);
    const review = original.events.filter(event => ["ArtifactReviewRequested", "ArtifactApproved"].includes(event.type)
      && event.payload.artifact_id === fixture.artifactId);
    expect(review).toHaveLength(2); expect(review.map(event => event.type)).toEqual(["ArtifactReviewRequested", "ArtifactApproved"]);
    for (const event of review) expect(event.payload).toMatchObject({ document_id: fixture.documentIdA,
      artifact_revision: 1, content_sha256: fixture.rawContentSha256 });
    expect(review[0].actor).toBe("user:" + fixture.userId);
    expect(review[1].actor).toBe("user:" + review[0].payload.assigned_reviewer_user_id);
    expect(review[1].actor).not.toBe(review[0].actor);
    const deck = dialog.locator("forma-presentation-deck");
    await expect(deck).toHaveCount(1);
    expect(await deck.evaluate(node => ({ artifactId: node.preferenceKey, documentId: node.documentId,
      title: node.deckTitle, sourceSurface: node.sourceSurface, releaseAllowed: node.releaseAllowed,
      items: node.items, presentation: node.presentation })))
      .toMatchObject({ artifactId: fixture.artifactId, documentId: fixture.documentIdA,
        title: "Harbor decisions", sourceSurface: "library-artifact-viewer", releaseAllowed: true });
    expect(observed.downloads).toHaveLength(0);
    const more = deck.locator("button.presentation-deck-export");
    await expect(more).toHaveText("Export"); await expect(more).toBeEnabled();
    await tabTo(page, more, 100); await verifyFocus(page, more, testInfo, "slides-export-trigger-focus", { checkVisibleControls: false });
    await page.keyboard.press("Enter");
    const menu = deck.locator(".presentation-deck-export-menu:popover-open");
    await expect(menu).toBeVisible(); await expect(menu).toHaveAttribute("role", "group");
    await expect(menu).toHaveAttribute("aria-label", "Export");
    const choice = menu.getByRole("button", { name: "PowerPoint / Google Slides / Keynote (.pptx)", exact: true });
    await expect(choice).toBeEnabled(); await tabTo(page, choice, 100);
    await verifyFocus(page, choice, testInfo, "slides-audience-download-focus", { checkVisibleControls: false });
    await captureViewport(page, testInfo, "slides-audience-ready-to-download");
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
    await expect(menu).toHaveCount(0); await expect(more).toBeEnabled();
    // Capture the actual settled focus before any new native action. The source
    // focuses Export before disabling it; success does not promise a refocus.
    const finalFocus = await dialog.evaluate(owner => {
      const active = owner.ownerDocument.activeElement;
      return { documentHasFocus: owner.ownerDocument.hasFocus(), ownedByCurrentDialog: Boolean(active && owner.contains(active)),
        tag: active?.tagName ?? null, id: active?.id ?? null, className: active?.className ?? null,
        text: active?.textContent?.trim() ?? null, connected: Boolean(active?.isConnected),
        disabled: Boolean(active && "disabled" in active && active.disabled) };
    });
    await attachJSON(testInfo, "slides-after-download-native-focus", finalFocus);
    expect(finalFocus.documentHasFocus).toBe(true); expect(finalFocus.ownedByCurrentDialog).toBe(true);
    expect(finalFocus.connected).toBe(true); expect(finalFocus.disabled).toBe(false);
    const currentFocus = dialog.locator(":focus"); await expect(currentFocus).toHaveCount(1);
    const completeSelector = 'dialog.document-artifact-view[data-artifact-kind="slides"]:modal .presentation-deck-export-status[data-export-stage="completed"]';
    const readSelector = 'dialog.document-artifact-view[data-artifact-kind="slides"]:modal .presentation-deck-reading-toggle';
    const completedStatus = page.locator(completeSelector), readSlide = page.locator(readSelector);
    await expect(completedStatus).toBeVisible();
    await expect(completedStatus).toHaveAttribute("role", "status");
    await expect(completedStatus).toHaveAttribute("aria-live", "polite");
    await expect(completedStatus).toHaveAttribute("aria-atomic", "true");
    await expect(completedStatus).toHaveText("2 audience-safe editable PowerPoint slides downloaded.");
    await expect(completedStatus.locator("button, progress")).toHaveCount(0);
    await expect(readSlide).toBeVisible(); await expect(readSlide).toBeEnabled();
    await expect(readSlide).toHaveAccessibleName("Read slide");
    await expect(page.locator(".toast")).toHaveCount(0);
    // Retain the original settled native-focus assertion. The added regions are
    // observed in that same posture, without focusing, scrolling or clicking them.
    const completionGeometry = await verifyFocus(page, currentFocus, testInfo, "slides-audience-after-download-focus", {
      checkVisibleControls: false, regionSelectors: [completeSelector, readSelector],
      overlaySelectors: [".forma-assistant-launcher", ":popover-open", ":modal", ".toast", completeSelector],
    });
    expect(completionGeometry.regions).toHaveLength(2);
    for (const region of completionGeometry.regions) {
      expect(region.paintedBox, "Completion status and Read slide must be painted").toBe(true);
      expect(region.visible, "The complete region must fit the current clipping and viewport bounds").toEqual(region.raw);
      expect(region.unknown, "Unsupported region geometry is not a pass").toEqual([]);
      expect(region.collisions, "Completion status and Read slide must have no foreign overlay collision").toEqual([]);
    }
    const readSlideHits = await readSlide.evaluate(button => {
      const rect = button.getBoundingClientRect(), doc = button.ownerDocument;
      const dx = Math.min(2, rect.width / 4), dy = Math.min(2, rect.height / 4);
      const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
      return [[x, rect.top + dy], [rect.right - dx, y], [x, rect.bottom - dy], [rect.left + dx, y], [x, y]]
        .map(([sampleX, sampleY]) => {
          let top = doc.elementFromPoint(sampleX, sampleY);
          for (;;) {
            const next = top?.shadowRoot?.elementFromPoint?.(sampleX, sampleY);
            if (!next || next === top) break;
            top = next;
          }
          return { x: sampleX, y: sampleY, owned: Boolean(top && button.contains(top)),
            top: top ? { tag: top.tagName, id: top.id || null, className: top.getAttribute("class") } : null };
        });
    });
    await attachJSON(testInfo, "slides-completed-status-and-read-slide-clearance", {
      regions: completionGeometry.regions, readSlideHits,
      scope: "Same settled Download posture: full region clipping bounds and finite Read slide hit samples; no extra native action, full pixel-paint or assistive-technology claim.",
      toastObservation: "No global toast exists at this settled observation; this is not a continuous transient-toast audit.",
    });
    expect(readSlideHits).toHaveLength(5);
    expect(readSlideHits.every(sample => sample.owned), "Every observed Read slide hit must belong to its native button").toBe(true);
    const final = nativePart(await api.inspect());
    expect(final).toEqual({ ...before, eventCount: 10, eventTypes: [...before.eventTypes, "DocumentArtifactExported"],
      events: [...before.events, exported], exportReceipt: exported, download: final.download });
    const transport = final.download;
    expect(transport).toMatchObject({ exportAttempts: 1, mediaAttempts: 0, maximumExports: 1,
      maximumMediaGets: 0, exportAcknowledged: true });
    expect(transport.exportRequests).toHaveLength(1); expect(transport.mediaRequests).toEqual([]);
    const released = transport.exportRequests[0];
    expect(released).toMatchObject({ method: "POST", path: "/api/events", disposition: "actual-worker-response",
      request: fixture.exportRequest, receipt: exported,
      custodyBefore: { eventCount: 9, authoringCommits: 0, media: before.media, verified: true },
      custodyAfter: { eventCount: 10, authoringCommits: 0, media: before.media, verified: true },
      workerResponse: { status: 200, accepted: true, body: { complete: true } } });
    const ackBytes = Buffer.from(released.workerResponse.rawBodyBase64, "base64");
    expect(ackBytes).toEqual(await observed.exports[0].body());
    expect(hash(ackBytes)).toBe(released.workerResponse.rawBodySha256);
    expect(exported.payload).toMatchObject({ artifact_revision: 1, content_sha256: fixture.rawContentSha256,
      format: PPTX_MIME, destination_kind: "powerpoint", page_count: 2,
      render_mode: "editable-office-shapes", presenter_notes_included: false });
    await attachJSON(testInfo, "slides-export-ack-and-blob-download", { transport, file,
      scope: "Exact actual Worker export ACK precedes the built client's audience PPTX Blob download. No PPTX server/media response exists or is claimed; first native file and ZIP contents are verified separately." });
    await attachJSON(testInfo, "slides-reviewed-download-complete", { before, after: final, original, current: after, file,
      scope: "One audience PPTX browser Download of declared reviewed revision1; first native file preserved. No new shared approval gate, application rendering or recipient delivery claim.",
      concurrentReplacement: "Not tested; stable source/artifact/raw equality is observed before and after the single action." });
    expect(exportRoutes).toBe(1); expect(routeErrors).toEqual([]);
    assertAllowedRequests(ledger); observed.assertBounded();
    await captureViewport(page, testInfo, "slides-original-after-download");
  } catch (error) { errors.push(error); }
  finally {
    initialSession.dispose();
    await attempt(errors, () => context.unroute(api.baseURL + "/api/events", exportRoute));
    await Promise.allSettled([...routed]); errors.push(...routeErrors);
    if (errors.length && !page.isClosed()) await attempt(errors, () => captureViewport(page, testInfo, "slides-reviewed-download-failure", { assertStable: false }));
    throwFailures(errors, "Slides reviewed original Download failed");
  }
});
