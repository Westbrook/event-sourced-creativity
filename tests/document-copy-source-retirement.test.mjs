import assert from "node:assert/strict";
import test from "node:test";
import { writeFixture, sceneDeferred, eventRequest, appendAuditEvent } from "./helpers/event-source-retirement-fixture.mjs";

test("future6 source-only denial must not republish an old copy preview after fresh source recovery", { timeout: 25_000 }, async t => {
  const h = await writeFixture(t), provider = globalThis.fetch;
  const target = { projectId: h.worker.projectId, documentId: h.worker.documentId };
  const countEvents = () => h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
  const initialEvents = countEvents();
  assert.equal((await h.store.beginDocumentCopy(target))?.phase, "draft");
  const initial = await h.store.previewDocumentCopy(target, { title: "Retained source-only copy", collectionId: null });
  assert.equal(initial?.phase, "review");
  assert.ok(initial.preview && initial.previewId && initial.approvalHash);
  const originalAuthorization = h.store.captureAuthorizationScope(), originalSource = h.store.captureSourceOwnership();
  const entered = sceneDeferred(), held = sceneDeferred(), eventStatuses = [];
  let holdOriginal = true;
  t.after(() => held.resolve());
  h.intercept = async request => {
    if (request.url === "/api/documents/duplicate" && request.body?.action === "retrieve" && holdOriginal) {
      holdOriginal = false;
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 200, await response.clone().text());
      entered.resolve(); await held.promise; return response;
    }
    if (eventRequest(request)) {
      const response = await h.worker.request(request.url, request.init);
      eventStatuses.push({ url: request.url, status: response.status });
      return response;
    }
  };
  const pending = h.store.checkDocumentCopy(target);
  await entered.promise;
  await h.deny();
  const hiddenAtDenial = h.store.documentCopyReview(target) === null;
  assert.equal(hiddenAtDenial, true, "the healthy denial boundary hides the getter's private review");
  assert.equal(h.store.sourceOwnershipActive(originalSource), false);
  assert.equal(h.store.authorizationScopeActive(originalAuthorization), true, "this is source-only denial, not a replaced auth scope");
  h.restore();
  await h.store.refreshEvents();
  assert.equal(h.retired(), false);
  assert.equal(h.store.captureAuthorizationScope().key, originalAuthorization.key);
  assert.equal(h.store.sourceOwnershipActive(originalSource), false);
  assert.equal(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), true);
  const beforeOldResponse = h.store.documentCopyReview(target);
  const privateBeforeOldResponse = Boolean(beforeOldResponse?.preview);
  held.resolve(); await pending;
  const afterOldResponse = h.store.documentCopyReview(target);
  const privateAfterOldResponse = Boolean(afterOldResponse?.preview);
  const oldIntentLocallyReady = Boolean(afterOldResponse?.preview && afterOldResponse.phase === "review" &&
    !afterOldResponse.busy && !afterOldResponse.stale && h.store.documentCopyAccess(target).canAuthor);
  // A separate, explicit current read is the healthy recovery control.
  const current = await h.store.checkDocumentCopy(target);
  assert.equal(current?.previewId, initial.previewId);
  assert.equal(current?.approvalHash, initial.approvalHash);
  assert.equal(current?.phase, "review");
  const requests = h.requests.filter(request => request.url === "/api/documents/duplicate");
  assert.deepEqual(requests.map(request => request.body.action), ["resume", "preview", "retrieve", "retrieve"]);
  assert.equal(countEvents(), initialEvents);
  assert.equal(h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0);
  assert.equal(provider.mock.callCount(), 0);
  console.log("FUTURE6_SOURCE_ONLY " + JSON.stringify({
    sameAuthorization: h.store.captureAuthorizationScope().key === originalAuthorization.key,
    oldSourceStillInvalid: !h.store.sourceOwnershipActive(originalSource), hiddenAtDenial,
    privateBeforeOldResponse, privateAfterOldResponse, oldIntentLocallyReady,
    freshExplicitReadSamePreview: current.previewId === initial.previewId, eventStatuses,
    actions: requests.map(request => request.body.action), canonicalEventsAdded: 0, copyReceipts: 0,
    providerCalls: provider.mock.callCount(), nativeSqlShapes: h.worker.depthProof.records.length,
    maximumBindings: Math.max(...h.worker.controls.bindings),
  }));
  assert.equal(privateBeforeOldResponse, false, "fresh source200 alone must not revive private copy review from the retired source");
  assert.equal(privateAfterOldResponse, false, "the held pre-denial copy response must remain fenced after source recovery");
  assert.equal(oldIntentLocallyReady, false, "the original retired copy intent must not become Apply-ready from an old response");
});

const copyTarget = h => ({ projectId: h.worker.projectId, documentId: h.worker.documentId });
const copyState = h => h.store.documentCopyReviews.get()[JSON.stringify([h.worker.projectId, h.worker.documentId])];
const copyCalls = h => h.requests.filter(request => request.url === "/api/documents/duplicate");
const sourceCalls = h => h.requests.filter(eventRequest);
const eventCount = h => h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM events").get().n;
const receiptCount = h => h.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n;
async function copyJson(h, body) {
  const response = await h.worker.request("/api/documents/duplicate", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}
async function reviewed(t, name) {
  const h = await writeFixture(t), target = copyTarget(h);
  assert.equal((await h.store.beginDocumentCopy(target))?.phase, "draft");
  const review = await h.store.previewDocumentCopy(target, { title: name, collectionId: null });
  assert.equal(review?.phase, "review"); assert.ok(review.preview && review.intent);
  return { h, target, review };
}
function privateReference(h, expected) {
  const current = copyState(h);
  assert.ok(current);
  assert.equal(current.operationId, expected.operationId);
  if (expected.previewId) assert.equal(current.previewId, expected.previewId);
  if (expected.approvalHash) assert.equal(current.approvalHash, expected.approvalHash);
  assert.equal(current.preview, null);
  assert.equal(current.intent, null);
  assert.equal(current.sourceTitle, "");
  assert.equal(current.sourceRevision, "");
  assert.equal(current.authorityKey, "");
  assert.equal(current.busy, false);
  assert.equal(current.stale, true);
  if (expected.privateTitle) assert.equal(JSON.stringify(current).includes(expected.privateTitle), false);
  return current;
}

test("retired old Check cannot overwrite a newer explicit exact Check in the same authorization", { timeout: 25_000 }, async t => {
  const { h, target, review } = await reviewed(t, "PRIVATE_OLD_CHECK_TITLE");
  const entered = sceneDeferred(), held = sceneDeferred(); let first = true;
  t.after(() => held.resolve());
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "retrieve" || !first) return;
    first = false; const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 200); entered.resolve(); await held.promise; return response;
  };
  const old = h.store.checkDocumentCopy(target); await entered.promise;
  await h.deny(); privateReference(h, { ...review, privateTitle: review.intent.title });
  h.restore(); await h.store.refreshEvents();
  const fresh = await h.store.checkDocumentCopy(target);
  assert.equal(fresh.previewId, review.previewId); assert.equal(fresh.phase, "review");
  const owned = copyState(h);
  held.resolve(); await old;
  assert.equal(copyState(h), owned, "a retired response/finally cannot replace the new source-owned state");
  assert.equal(h.store.sourceOwnershipActive(owned.sourceOwner), true);
  assert.equal(copyCalls(h).filter(request => request.body.action === "apply").length, 0);
});

test("held preview with no client preview ID recovers only its original operation, not a newer review", { timeout: 25_000 }, async t => {
  const h = await writeFixture(t), target = copyTarget(h), name = "PRIVATE_LOST_PREVIEW_TITLE";
  await h.store.beginDocumentCopy(target);
  const entered = sceneDeferred(), held = sceneDeferred(); let first = true, stored;
  t.after(() => held.resolve());
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "preview" || !first) return;
    first = false; const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 200); stored = await response.clone().json();
    entered.resolve(); await held.promise; return response;
  };
  const pending = h.store.previewDocumentCopy(target, { title: name, collectionId: null });
  await entered.promise;
  const operationId = copyState(h).operationId;
  assert.equal(copyState(h).previewId, "");
  await h.deny();
  assert.equal(privateReference(h, { operationId, privateTitle: name }).previewId, "");
  h.restore(); await h.store.refreshEvents();
  const other = await copyJson(h, { action: "preview", ...target, operationId: crypto.randomUUID(), title: "Other current review", collectionId: null });
  assert.equal(other.response.status, 200);
  const latest = await copyJson(h, { action: "resume", ...target });
  assert.equal(latest.body.preview.previewId, other.body.preview.previewId, "the competing latest control is actually different");
  const recovered = await h.store.checkDocumentCopy(target);
  assert.equal(copyCalls(h).at(-1).body.action, "resume");
  assert.equal(copyCalls(h).at(-1).body.operationId, operationId);
  assert.equal(recovered.previewId, stored.preview.previewId);
  assert.notEqual(recovered.previewId, other.body.preview.previewId);
  assert.equal(recovered.approvalHash, stored.preview.approvalHash);
  assert.equal(recovered.intent.title, name);
  const owned = copyState(h);
  held.resolve(); await pending;
  assert.equal(copyState(h), owned);
  assert.equal(copyCalls(h).filter(request => request.body.action === "preview").length, 1, "no private intent is resubmitted");
  assert.equal(receiptCount(h), 0);
});

test("exact resume none while the original preview is in flight keeps the sole operation Check-only", { timeout: 25_000 }, async t => {
  const h = await writeFixture(t), target = copyTarget(h), name = "PRIVATE_IN_FLIGHT_TITLE";
  await h.store.beginDocumentCopy(target);
  const entered = sceneDeferred(), held = sceneDeferred(); let first = true;
  t.after(() => held.resolve());
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "preview" || !first) return;
    first = false; entered.resolve(); await held.promise;
    return h.worker.request(request.url, request.init);
  };
  const pending = h.store.previewDocumentCopy(target, { title: name }); await entered.promise;
  const operationId = copyState(h).operationId;
  await h.deny(); h.restore(); await h.store.refreshEvents();
  const missing = await h.store.checkDocumentCopy(target);
  assert.equal(missing.phase, "unavailable");
  assert.equal(missing.operationId, operationId);
  assert.equal(missing.intent, null);
  assert.equal(missing.previewId, "");
  assert.equal(await h.store.previewDocumentCopy(target, { title: "Must not replace the unknown original" }), null);
  assert.equal(copyCalls(h).filter(request => request.body.action === "preview").length, 1);
  held.resolve(); await pending;
  assert.equal(copyState(h).preview, null);
  const recovered = await h.store.checkDocumentCopy(target);
  assert.equal(recovered.phase, "review"); assert.equal(recovered.operationId, operationId);
  assert.equal(recovered.intent.title, name);
  assert.deepEqual(copyCalls(h).map(request => request.body.action), ["resume", "preview", "resume", "resume"]);
  assert.equal(receiptCount(h), 0);
});

test("exact resume validates its ID, scope and returned operation and never falls back to latest", { timeout: 25_000 }, async t => {
  const { h, target, review } = await reviewed(t, "Original exact API review");
  const otherDocumentId="other-exact-source-document";
  await appendAuditEvent(h.worker.env,h.worker.streamId,"user","DocumentCreated",{project_id:target.projectId,document_id:otherDocumentId,title:"Other authorized source"});
  await h.store.refreshEvents();
  assert.ok(h.store.projection.get().documents.some(document=>document.id===otherDocumentId));
  const events = eventCount(h), commits = receiptCount(h);
  const invalid = [null, "", "too-short", 3, {}, "bad operation id", "x".repeat(121)];
  for (const operationId of invalid) {
    const found = await copyJson(h, { action: "resume", ...target, operationId });
    assert.equal(found.response.status, 400);
  }
  const absent = await copyJson(h, { action: "resume", ...target, operationId: crypto.randomUUID() });
  assert.equal(absent.response.status, 200); assert.deepEqual(absent.body, { status: "none" });
  const current = await copyJson(h, { action: "resume", ...target, operationId: review.operationId });
  assert.equal(current.response.status, 200);
  assert.equal(current.body.preview.previewId, review.previewId);
  assert.equal(current.body.preview.duplication.operationId, review.operationId);
  const wrong = await copyJson(h, { action: "resume", ...target, documentId: otherDocumentId, operationId: review.operationId });
  assert.equal(wrong.response.status, 403); assert.equal(wrong.body.preview, undefined);
  const wrongContext = await copyJson(h, { action: "resume", ...target, projectId: "not-this-project", operationId: review.operationId });
  assert.notEqual(wrongContext.response.status, 200); assert.equal(wrongContext.body.preview, undefined);
  const noId = await copyJson(h, { action: "resume", ...target });
  assert.equal(noId.response.status, 200); assert.equal(noId.body.preview.previewId, review.previewId);
  await h.deny();
  const denied = await copyJson(h, { action: "resume", ...target, operationId: review.operationId });
  assert.equal(denied.response.status, 403); assert.equal(denied.body.preview, undefined);
  assert.equal(eventCount(h), events); assert.equal(receiptCount(h), commits);
});

for (const outcome of ["receipt", "lost", "wrong-operation", "wrong-preview", "wrong-hash", "wrong-destination"]) {
  test("already dispatched copy after source retirement retains exact safe recovery: " + outcome, { timeout: 25_000 }, async t => {
    const { h, target, review } = await reviewed(t, "PRIVATE_DISPATCHED_" + outcome);
    const initialEvents = eventCount(h), eventTotal = review.preview.events.length;
    const entered = sceneDeferred(), held = sceneDeferred(); let first = true, actual;
    t.after(() => held.resolve());
    h.intercept = async request => {
      if (request.url !== "/api/documents/duplicate" || request.body.action !== "apply" || !first) return;
      first = false;
      const written = await h.worker.request(request.url, request.init);
      assert.equal(written.status, 200); actual = await written.clone().json();
      assert.equal(actual.status, "applied");
      // The actual idempotent response contains a private preview; the stale
      // client must keep only its exact receipt even when those bytes arrive.
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(body.preview);
      entered.resolve(); await held.promise;
      if (outcome === "lost") throw new Error("Synthetic response loss after the real commit");
      if (outcome === "wrong-operation") body.operationId = crypto.randomUUID();
      if (outcome === "wrong-preview") body.previewId = "foreign-preview";
      if (outcome === "wrong-hash") body.approvalHash = "e".repeat(64);
      if (outcome === "wrong-destination") body.documentId = "foreign-document";
      return outcome === "receipt" ? response : Response.json(body);
    };
    const pending = h.store.applyDocumentCopy(target, review.previewId, review.approvalHash);
    await entered.promise;
    assert.equal(copyState(h).commitSubmitted, true);
    assert.equal(eventCount(h) - initialEvents, eventTotal); assert.equal(receiptCount(h), 1);
    await h.deny();
    const reference = privateReference(h, { ...review, privateTitle: review.intent.title });
    assert.equal(reference.phase, "uncertain"); assert.equal(reference.receipt, null);
    h.restore(); await h.store.refreshEvents();
    assert.equal(h.store.documentCopyReview(target).preview, null);
    const reads = sourceCalls(h).length, calls = copyCalls(h).length;
    held.resolve(); await pending;
    const kept = privateReference(h, { ...review, privateTitle: review.intent.title });
    assert.equal(sourceCalls(h).length, reads, "a stale commit ACK must not auto-refresh private source");
    assert.equal(copyCalls(h).length, calls, "no automatic read/retry or new copy follows retirement");
    if (outcome === "receipt") {
      assert.equal(kept.phase, "applied");
      assert.deepEqual(kept.receipt, { documentId: actual.documentId, operationId: actual.operationId });
    } else {
      assert.equal(kept.phase, "uncertain"); assert.equal(kept.receipt, null);
    }
    const recovered = await h.store.checkDocumentCopy(target);
    assert.equal(recovered.phase, "applied");
    assert.equal(recovered.previewId, review.previewId); assert.equal(recovered.approvalHash, review.approvalHash);
    assert.equal(recovered.receipt.documentId, actual.documentId);
    assert.equal(recovered.receipt.operationId, review.operationId);
    assert.equal(eventCount(h) - initialEvents, eventTotal); assert.equal(receiptCount(h), 1);
    assert.equal(copyCalls(h).filter(request => request.body.action === "apply").length, 1);
  });
}

test("a fully covering newer source read protects the current copy from an older genuine denial", { timeout: 25_000 }, async t => {
  const { h, target, review } = await reviewed(t, "Covering source control");
  const owner = copyState(h).sourceOwner, entered = sceneDeferred(), held = sceneDeferred(); let first = true;
  t.after(() => held.resolve());
  h.intercept = async request => {
    if (!eventRequest(request) || !first) return;
    first = false; const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 403); entered.resolve(); await held.promise; return response;
  };
  h.revoke();
  const older = h.store.refreshEvents(); const rejection = assert.rejects(older, /403/);
  await entered.promise; h.restore(); await h.store.refreshEvents();
  held.resolve(); await rejection;
  assert.equal(h.retired(), false);
  assert.equal(h.store.sourceOwnershipActive(owner), true);
  const current = h.store.documentCopyReview(target);
  assert.equal(current.previewId, review.previewId); assert.equal(current.phase, "review");
  assert.ok(current.preview); assert.equal(current.stale, false);
});

test("an unrelated old authorization denial cannot retire a new current copy review", { timeout: 25_000 }, async t => {
  const h = await writeFixture(t), target = copyTarget(h);
  const entered = sceneDeferred(), held = sceneDeferred(); let first = true;
  t.after(() => held.resolve());
  h.intercept = async request => {
    if (!eventRequest(request) || !first) return;
    first = false; const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 403); entered.resolve(); await held.promise; return response;
  };
  h.revoke(); const older = h.store.refreshEvents();
  const rejection = assert.rejects(older, /403|no longer belongs|superseded/);
  await entered.promise;
  h.worker.setScopedHeaders({}); await h.store.refreshSession(); await h.store.refreshEvents();
  assert.equal(h.store.session.get().projectContext ?? null, null);
  assert.equal((await h.store.beginDocumentCopy(target))?.phase, "draft");
  const review = await h.store.previewDocumentCopy(target, { title: "Current personal copy" });
  assert.equal(review.phase, "review"); const owner = copyState(h).sourceOwner;
  held.resolve(); await rejection;
  assert.equal(h.store.sourceOwnershipActive(owner), true);
  assert.equal(h.store.documentCopyReview(target).previewId, review.previewId);
  assert.ok(h.store.documentCopyReview(target).preview);
});

for (const mode of ["personal", "migrated-owner", "selected-shared"]) {
  test("source retirement blocks old Apply; explicit current Check then deliberate Apply works: " + mode, { timeout: 25_000 }, async t => {
    const h = await writeFixture(t, { shared: mode !== "personal" }), target = copyTarget(h);
    if (mode === "migrated-owner") {
      h.worker.setScopedHeaders({}); await h.store.refreshSession(); await h.store.refreshEvents();
      h.revoke = () => { h.worker.env.FORMA_PILOT_COHORT_ID = "synthetic-missing-controlled-cohort"; };
      h.restore = () => { delete h.worker.env.FORMA_PILOT_COHORT_ID; };
    }
    const authorization = h.store.captureAuthorizationScope();
    assert.equal((await h.store.beginDocumentCopy(target))?.phase, "draft");
    const review = await h.store.previewDocumentCopy(target, { title: "PRIVATE_CURRENT_COPY_" + mode, collectionId: null });
    assert.equal(review.phase, "review"); const expectedCount = review.preview.events.length, before = eventCount(h);
    await h.deny(); const calls = copyCalls(h).length;
    assert.equal(h.store.authorizationScopeActive(authorization), true);
    privateReference(h, { ...review, privateTitle: review.intent.title });
    assert.equal(await h.store.applyDocumentCopy(target, review.previewId, review.approvalHash), null);
    h.restore(); await h.store.refreshEvents();
    assert.equal(await h.store.applyDocumentCopy(target, review.previewId, review.approvalHash), null);
    assert.equal(copyCalls(h).length, calls, "neither denied nor generally refreshed source can continue the old Apply");
    const checked = await h.store.checkDocumentCopy(target);
    assert.equal(checked.phase, "review"); assert.equal(checked.operationId, review.operationId);
    assert.equal(checked.previewId, review.previewId); assert.equal(checked.approvalHash, review.approvalHash);
    assert.deepEqual(checked.preview.events, review.preview.events, "the exact original approved event bytes are not rebased");
    const applied = await h.store.applyDocumentCopy(target, checked.previewId, checked.approvalHash);
    assert.equal(applied.phase, "applied"); assert.equal(applied.receipt.operationId, review.operationId);
    assert.equal(eventCount(h) - before, expectedCount); assert.equal(receiptCount(h), 1);
    assert.deepEqual(copyCalls(h).map(request => request.body.action), ["resume", "preview", "retrieve", "apply"]);
    assert.equal(h.worker.controls.bindings.every(count => count <= 100), true);
  });
}


function seedRetainedCopyLease(h, previewId, expired) {
  // A valid old worker lease is fixture setup, not a claimed user-controlled transition.
  const row = h.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(previewId);
  const saved = JSON.parse(row.content);
  saved.state = "applying";
  saved.leaseId = crypto.randomUUID();
  saved.leaseExpiresAt = new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString();
  const content = JSON.stringify(saved);
  assert.equal(h.worker.sqlite.prepare("UPDATE private_content SET content=? WHERE content_id=?").run(content, previewId).changes, 1);
  return content;
}
async function unknownRetainedCopyLease(t, name, expired) {
  const h = await writeFixture(t), target = copyTarget(h), entered = sceneDeferred(), held = sceneDeferred();
  let first = true, body;
  t.after(() => held.resolve());
  await h.store.beginDocumentCopy(target);
  h.intercept = async request => {
    if (request.url !== "/api/documents/duplicate" || request.body.action !== "preview" || !first) return;
    first = false;
    const response = await h.worker.request(request.url, request.init);
    assert.equal(response.status, 200); body = await response.clone().json();
    entered.resolve(); await held.promise; return response;
  };
  const pending = h.store.previewDocumentCopy(target, { title: name, collectionId: null });
  await entered.promise;
  const operationId = copyState(h).operationId;
  seedRetainedCopyLease(h, body.preview.previewId, expired);
  await h.deny(); h.restore(); await h.store.refreshEvents();
  held.resolve(); await pending;
  assert.equal(copyState(h).previewId, "");
  assert.equal(copyState(h).operationId, operationId);
  return { h, target, operationId, preview: body.preview };
}
const retainedCopyBytes = (h, previewId) => h.worker.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(previewId).content;
const totalCopyDatabaseChanges = h => h.worker.sqlite.prepare("SELECT total_changes() AS n").get().n;

test("exact operation resume leaves an expired lease untouched; existing explicit Check and Apply recover it", { timeout: 25_000 }, async t => {
  const { h, target, operationId, preview } = await unknownRetainedCopyLease(t, "Expired unknown copy", true);
  const bytes = retainedCopyBytes(h, preview.previewId), changes = totalCopyDatabaseChanges(h);
  const writes = h.worker.controls.writes.length, events = eventCount(h);
  const current = await h.store.checkDocumentCopy(target);
  const observed = { expired: true, writeStatements: h.worker.controls.writes.length - writes,
    databaseChanges: totalCopyDatabaseChanges(h) - changes, retainedBytesIdentical: retainedCopyBytes(h, preview.previewId) === bytes };
  console.log("COPY_EXACT_RESUME_READONLY " + JSON.stringify(observed));
  assert.equal(observed.writeStatements, 0, "an exact operation resume never issues a durable mutation, including lease cleanup");
  assert.equal(observed.databaseChanges, 0);
  assert.equal(observed.retainedBytesIdentical, true);
  assert.equal(current.phase, "applying");
  assert.equal(current.previewId, preview.previewId); assert.equal(current.approvalHash, preview.approvalHash);
  assert.equal(current.operationId, operationId);
  assert.deepEqual(copyCalls(h).at(-1).body, { action: "resume", ...target, operationId });
  assert.equal(copyCalls(h).filter(request => request.body.action === "apply").length, 0);
  assert.equal(await h.store.applyDocumentCopy(target, preview.previewId, preview.approvalHash), null);
  // The existing exact preview/hash Check may release the expired lease. It is
  // deliberately a second human action, not an automatic repeat of the intent.
  const checked = await h.store.checkDocumentCopy(target);
  assert.equal(copyCalls(h).at(-1).body.action, "retrieve");
  assert.equal(checked.phase, "review"); assert.equal(checked.stale, false);
  assert.equal(checked.operationId, operationId); assert.equal(checked.approvalHash, preview.approvalHash);
  assert.deepEqual(checked.preview.events, preview.events);
  assert.equal(eventCount(h), events); assert.equal(receiptCount(h), 0);
  const applied = await h.store.applyDocumentCopy(target, preview.previewId, preview.approvalHash);
  assert.equal(applied.phase, "applied"); assert.equal(applied.operationId, operationId);
  assert.equal(eventCount(h) - events, preview.events.length); assert.equal(receiptCount(h), 1);
  assert.equal(copyCalls(h).filter(request => request.body.action === "preview").length, 1);
  assert.equal(copyCalls(h).filter(request => request.body.action === "apply").length, 1);
});

test("exact operation resume of an active lease stays read-only and cannot enable Apply", { timeout: 25_000 }, async t => {
  const { h, target, operationId, preview } = await unknownRetainedCopyLease(t, "Active unknown copy", false);
  const bytes = retainedCopyBytes(h, preview.previewId), changes = totalCopyDatabaseChanges(h);
  const writes = h.worker.controls.writes.length, events = eventCount(h);
  const current = await h.store.checkDocumentCopy(target);
  const observed = { expired: false, writeStatements: h.worker.controls.writes.length - writes,
    databaseChanges: totalCopyDatabaseChanges(h) - changes, retainedBytesIdentical: retainedCopyBytes(h, preview.previewId) === bytes };
  console.log("COPY_EXACT_RESUME_READONLY " + JSON.stringify(observed));
  assert.equal(observed.writeStatements, 0); assert.equal(observed.databaseChanges, 0);
  assert.equal(observed.retainedBytesIdentical, true);
  assert.equal(current.phase, "applying"); assert.equal(current.operationId, operationId);
  const calls = copyCalls(h).length;
  assert.equal(await h.store.applyDocumentCopy(target, preview.previewId, preview.approvalHash), null);
  assert.equal(copyCalls(h).length, calls);
  assert.equal(eventCount(h), events); assert.equal(receiptCount(h), 0);
});

test("an exact resume stays conservative when another explicit writer commits after its lease snapshot", { timeout: 25_000 }, async t => {
  const { h, target, operationId, preview } = await unknownRetainedCopyLease(t, "Racing unknown copy", true);
  const events = eventCount(h), writes = h.worker.controls.writes.length;
  const prior = h.worker.controls.afterRead;
  let entered = false, winner, winnerWrites;
  t.after(() => { h.worker.controls.afterRead = prior; });
  h.worker.controls.afterRead = async (statement, value) => {
    await prior?.(statement, value);
    if (entered || !statement.sql.includes("saved.content AS preview_content")) return;
    entered = true;
    assert.equal(JSON.parse(value.preview_content).state, "applying");
    const start = h.worker.controls.writes.length;
    // This is another explicit HTTP Apply, not work performed by the resume.
    winner = await copyJson(h, { action: "apply", ...target, previewId: preview.previewId, approvalHash: preview.approvalHash });
    winnerWrites = h.worker.controls.writes.slice(start);
    assert.equal(winner.response.status, 200); assert.equal(winner.body.status, "applied");
  };
  const current = await h.store.checkDocumentCopy(target);
  h.worker.controls.afterRead = prior;
  assert.equal(entered, true);
  assert.equal(current.phase, "applying", "the older snapshot is conservative, never a false not-applied receipt");
  assert.equal(current.operationId, operationId);
  assert.deepEqual(h.worker.controls.writes.slice(writes), winnerWrites, "only the separately invoked writer mutated durable state");
  assert.equal(eventCount(h) - events, preview.events.length); assert.equal(receiptCount(h), 1);
  const recovered = await h.store.checkDocumentCopy(target);
  assert.equal(recovered.phase, "applied");
  assert.equal(recovered.receipt.operationId, operationId);
  assert.equal(recovered.receipt.documentId, winner.body.documentId);
  assert.equal(recovered.approvalHash, preview.approvalHash);
  assert.equal(copyCalls(h).filter(request => request.body.action === "apply").length, 0, "this client did not submit an Apply automatically");
  assert.equal(eventCount(h) - events, preview.events.length); assert.equal(receiptCount(h), 1);
});
