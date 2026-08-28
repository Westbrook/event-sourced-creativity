import test from "node:test";
import assert from "node:assert/strict";
import { sceneDeferred,untilScene,withDocumentInRoute,matrix,pause,eventRequest,financial,view,isRetired,result,settled,sourceFixture,accountCachePort,snapshotIdentity } from "./helpers/event-source-retirement-fixture.mjs";


test("actual shared-reader membership denial retires the warm source", async t => {
  const h = await sourceFixture(t), before = view(h), session = structuredClone(h.store.session.get());
  h.revoke(); const response = await h.worker.request("/api/events?after=0&limit=2000&content=0");
  assert.equal(response.status, 403);
  const error = await settled(h.store.refreshEvents());
  assert.equal(error, "Event stream returned 403");
  assert.deepEqual(h.store.session.get(), session, "No fabricated role, permission epoch, or financial session reset");
  result(t, "current403 retires all source-derived private views", { workerStatus: response.status, before, after: view(h) }, isRetired(h));
});


for (const status of [401, 403, 404]) for (const bodyMode of ["pending", "malformed"]) test("owned " + status + " headers retire before a " + bodyMode + " body", async t => {
  const h = await sourceFixture(t), bodyGate = sceneDeferred(); let headers = 0, parses = 0;
  h.revoke();
  h.intercept = async request => {
    if (!eventRequest(request)) return;
    const actual = await h.worker.request(request.url, request.init); assert.equal(actual.status, 403);
    const response = status === 403 ? actual : new Response(null, { status });
    response.json = () => { parses++; return bodyMode === "pending" ? bodyGate.promise : Promise.reject(new SyntaxError("synthetic malformed denial body")); };
    headers++; return response;
  };
  const read = settled(h.store.refreshEvents());
  try {
    await untilScene(() => headers === 1); await pause();
    assert.equal(parses, 0, "Authority-denial handling must not wait for or parse its body");
    result(t, "exact-current denial headers retire before body parsing", { status, transportOnlyStatus: status !== 403, parses, after: view(h) }, isRetired(h));
  } finally { bodyGate.resolve({ error: "synthetic_denial" }); await read; }
});


for (const mode of ["success", "transport", "503"]) test("ordinary " + mode + " preserves recoverable current source", async t => {
  const h = await sourceFixture(t), before = view(h);
  h.intercept = async request => {
    if (!eventRequest(request)) return;
    if (mode === "transport") throw new Error("synthetic offline transport");
    if (mode === "503") return new Response("synthetic upstream unavailable", { status: 503 });
  };
  const error = await settled(h.store.refreshEvents());
  assert.equal(Boolean(error), mode !== "success");
  result(t, "non-denial keeps the known current source and operation state", { mode, error, after: view(h) }, JSON.stringify(view(h)) === JSON.stringify(before));
});


test("an older denied read cannot retire a newer already-verified read in the same scope", async t => {
  const h = await sourceFixture(t), gate = sceneDeferred(), entered = sceneDeferred(); let intercepted = false;
  h.revoke();
  h.intercept = async request => {
    if (!eventRequest(request) || intercepted) return;
    intercepted = true; const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 403);
    entered.resolve(); await gate.promise; return response;
  };
  const old = settled(h.store.refreshEvents()); await entered.promise;
  h.restoreMembership(); await h.store.refreshEvents(); const certified = view(h);
  gate.resolve(); await old;
  result(t, "a later fully verified read supersedes an older denial", { certified, after: view(h) }, JSON.stringify(view(h)) === JSON.stringify(certified) && certified.visibleEvents > 0);
});


test("an older denied read cannot retire an actual newly selected personal scope", async t => {
  const h = await sourceFixture(t, { reader: false, personalSibling: true }), gate = sceneDeferred(), entered = sceneDeferred();
  const originalScope = h.store.captureAuthorizationScope(); let intercepted = false;
  h.revoke();
  h.intercept = async request => {
    if (!eventRequest(request) || intercepted) return;
    intercepted = true; const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 403);
    entered.resolve(); await gate.promise; return response;
  };
  const old = settled(h.store.refreshEvents()); await entered.promise;
  // Cookie removal is only a deterministic browser transport change. Both the
  // new session and source are produced by the actual Worker with real custody.
  h.worker.setScopedHeaders({});
  await h.store.refreshSession(); assert.equal(h.store.session.get().projectContext, undefined);
  await h.store.refreshEvents(); h.store.setRoute(withDocumentInRoute("/", "source-personal-document"));
  const currentScope = h.store.captureAuthorizationScope(), certified = view(h);
  assert.notEqual(currentScope.key, originalScope.key); assert.equal(certified.project, "source-personal-project"); assert.ok(certified.visibleEvents > 0);
  gate.resolve(); await old;
  result(t, "old scope denial cannot clear new verified private work", { certified, after: view(h) }, JSON.stringify(view(h)) === JSON.stringify(certified));
});


test("a late original200 cannot republish replay history after a current denial", async t => {
  const h = await sourceFixture(t), gate = sceneDeferred(), entered = sceneDeferred(); let intercepted = false;
  h.intercept = async request => {
    if (!eventRequest(request) || intercepted) return;
    intercepted = true; const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    entered.resolve(); await gate.promise; return response;
  };
  const old = settled(h.store.replayAuthoritativeHistory(h.store.head.get())); await entered.promise;
  assert.equal(h.store.replayEvents.get().length, 0);
  h.revoke(); await settled(h.store.refreshEvents()); const afterDenial = view(h);
  gate.resolve(); const lateError = await old;
  result(t, "pre-denial replay200 cannot restore private replay after retirement", { afterDenial, lateError, after: view(h) }, h.store.replayEvents.get().length === 0 && isRetired(h));
});


test("a late original200 hydration cannot republish private content after a current denial", async t => {
  const h = await sourceFixture(t), gate = sceneDeferred(), entered = sceneDeferred(); let intercepted = false;
  h.store.content.set({}); // A genuine metadata-only/cold-body state; no session or permission changes.
  h.intercept = async request => {
    if (!eventRequest(request) || intercepted || !request.url.includes("content=1")) return;
    intercepted = true; const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    entered.resolve(); await gate.promise; return response;
  };
  const old = h.store.ensurePrivateContent(h.worker.contentRef, { force: true }); await entered.promise;
  h.revoke(); await settled(h.store.refreshEvents()); const afterDenial = view(h);
  gate.resolve(); const returned = await old;
  result(t, "pre-denial hydrated200 cannot restore retired private bytes", { afterDenial, returnedPrivateContent: typeof returned === "string", after: view(h) }, h.store.content.get()[h.worker.contentRef] === undefined && isRetired(h));
});


test("a denied second page retires the warm source and never publishes the partial page", async t => {
  const h = await sourceFixture(t); let pages = 0;
  h.intercept = async request => {
    if (!eventRequest(request)) return;
    const url = new URL(request.url, "http://localhost"); url.searchParams.set("limit", "2");
    if (++pages === 2) h.revoke();
    return h.worker.request(url.pathname + url.search, request.init);
  };
  const error = await settled(h.store.replayAuthoritativeHistory(h.store.head.get()));
  assert.equal(pages, 2); assert.equal(error, "Event stream returned 403");
  assert.equal(h.store.replayEvents.get().length, 0, "the existing complete-page contract already avoids partial replay publication");
  result(t, "owned denial on any page retires prior warm source", { pages, error, after: view(h) }, isRetired(h));
});


test("denied required incremental hydration is not ignored as a successful refresh", async t => {
  const h = await sourceFixture(t);
  await h.seedEvent("DocumentArtifactEdited", { artifact_id: "saved-scene-story", revision: 1, content_ref: h.worker.contentRef });
  let pages = 0, hydrationStatus = null;
  h.intercept = async request => {
    if (!eventRequest(request)) return;
    const response = await h.worker.request(request.url, request.init);
    if (++pages === 1) { assert.equal(response.status, 200); h.revoke(); }
    else hydrationStatus = response.status;
    return response;
  };
  const error = await settled(h.store.refreshEvents());
  assert.equal(hydrationStatus, 403, "the required hydration traversed the actual denied Worker route");
  result(t, "required hydration denial retires and fails the enclosing source read", { pages, hydrationStatus, error, after: view(h) }, Boolean(error) && isRetired(h));
});


test("an older full read cannot overwrite a newer certified source", async t => {
  const h = await sourceFixture(t), gate = sceneDeferred(), entered = sceneDeferred(); let intercepted = false;
  h.store.events.set([]); h.store.content.set({}); h.store.head.set(0); // Actual cold Store state after verified session.
  h.intercept = async request => {
    if (!eventRequest(request) || intercepted) return;
    intercepted = true; const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
    entered.resolve(); await gate.promise; return response;
  };
  const old = settled(h.store.refreshEvents()); await entered.promise;
  const oldHead = h.worker.sqlite.prepare("SELECT MAX(project_sequence) AS head FROM project_event_scopes WHERE project_access_id=?").get(h.worker.sharing.projectAccessId).head;
  await h.seedEvent("DocumentArtifactEdited", { artifact_id: "saved-scene-story", revision: 1, content_ref: h.worker.contentRef });
  await h.store.refreshEvents(); const certified = view(h); assert.ok(certified.head > oldHead, "the newer full response contains a genuinely later canonical event");
  gate.resolve(); await old;
  result(t, "older response cannot replace newer verified head/source", { certified, after: view(h) }, h.store.head.get() === certified.head && h.store.events.get().length === certified.events);
});


test("a new independently verified read can recover after membership is restored", async t => {
  const h = await sourceFixture(t), original = view(h);
  h.revoke(); await settled(h.store.refreshEvents());
  h.restoreMembership(); await h.store.refreshEvents();
  result(t, "denial is not a permanent invented permission change", { original, recovered: view(h) }, view(h).visibleEvents === original.visibleEvents && view(h).artifacts === 1 && view(h).project === original.project);
});


test("denial must retire private source without canceling the exact queued job or inventing billing", async t => {
  const h = await sourceFixture(t, { reader: false, queued: true }), session = structuredClone(h.store.session.get()), before = financial(h.worker);
  assert.equal(before.document_jobs.length, 1);
  assert.equal(before.cost_budget_reservations.length, 0, "Scene admission is queued, not a fictional prepaid hold");
  assert.equal(before.budget_reservations.length, 0);
  h.revoke(); await settled(h.store.refreshEvents());
  assert.deepEqual(h.store.session.get(), session, "No invented budget, permission or session reset");
  assert.equal(h.worker.sqlite.prepare("SELECT job_id FROM document_jobs").get().job_id, h.originalJobId);
  assert.deepEqual(financial(h.worker), before);
  result(t, "private retirement preserves the original queued operation and the actual unchanged ledger", {
    jobIdRetained: h.store.documentJobs.get().some(job => job.jobId === h.originalJobId),
    databaseJobId: h.originalJobId, actualReservationCount: before.cost_budget_reservations.length, after: view(h)
  }, isRetired(h));
});


test("a later pending read does not immunize an older current denial or restore afterward", async t => {
  const h = await sourceFixture(t), oldGate = sceneDeferred(), newGate = sceneDeferred(), oldEntered = sceneDeferred(), newEntered = sceneDeferred(); let calls = 0;
  h.revoke();
  h.intercept = async request => {
    if (!eventRequest(request)) return;
    const response = await h.worker.request(request.url, request.init);
    if (++calls === 1) { assert.equal(response.status, 403); oldEntered.resolve(); await oldGate.promise; }
    else if (calls === 2) { assert.equal(response.status, 200); newEntered.resolve(); await newGate.promise; }
    return response;
  };
  const old = settled(h.store.refreshEvents()); await oldEntered.promise;
  h.restoreMembership(); const pending = settled(h.store.replayAuthoritativeHistory(h.store.head.get())); await newEntered.promise;
  oldGate.resolve(); await old; const immediatelyRetired = isRetired(h), afterDenial = view(h);
  newGate.resolve(); await pending;
  result(t, "only completed verified reads supersede denials; pre-retirement pending reads cannot restore source", { immediatelyRetired, afterDenial, afterLate200: view(h) }, immediatelyRetired && isRetired(h));
});


test("actual cached load cannot retain a snapshot after its live source revalidation is denied", async t => {
  const h = await sourceFixture(t), port = accountCachePort(t), accountCache = h.modules.get("src/state/account-cache.ts");
  const identity = snapshotIdentity(h.store.session.get());
  await accountCache.writeAccountSnapshot(identity, h.store.events.get(), h.store.head.get(), "full");
  const stored = await accountCache.readAccountSnapshots(identity);
  assert.equal(stored.length, 1); assert.ok(accountCache.matchingAccountSnapshot(stored, identity, "full"));
  const { FormaStore } = h.modules.get("src/state/store.ts"); h.store = new FormaStore(); h.store.route.set(h.deep);
  let verifiedSession = false, deniedHeaders = false; const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  h.intercept = async request => {
    if (request.url === "/api/session" && !verifiedSession) {
      const response = await h.worker.request(request.url, request.init); assert.equal(response.status, 200);
      verifiedSession = true; h.revoke(); return response;
    }
    if (eventRequest(request)) {
      const response = await h.worker.request(request.url, request.init);
      assert.equal(response.status, 403); deniedHeaders = true; return response;
    }
  };
  await h.store.load(); await untilScene(() => deniedHeaders); await pause();
  const remaining = await accountCache.readAccountSnapshots(identity);
  result(t, "current denied revalidation retires already-published device cache and prevents fallback", {
    verifiedSession, deniedHeaders, logOnly: warnings.some(parts => parts.some(value => String(value).includes("Event stream returned 403"))),
    cachedSnapshots: remaining.length, rawCacheRows: port.rows().length, after: view(h),
  }, isRetired(h) && remaining.length === 0);
});


test("a pending original snapshot write cannot recreate the denied scope cache afterward", async t => {
  const h = await sourceFixture(t), port = accountCachePort(t, [2]), accountCache = h.modules.get("src/state/account-cache.ts");
  const identity = snapshotIdentity(h.store.session.get()), { FormaStore } = h.modules.get("src/state/store.ts");
  h.store = new FormaStore(); h.store.route.set(h.deep);
  await h.store.load(); await untilScene(() => port.pending.has(2), "actual Store's background snapshot write is waiting for IndexedDB");
  assert.equal(port.rows().length, 0);
  h.revoke(); await settled(h.store.refreshEvents()); const afterDenial = view(h);
  port.release(2); await pause(); await pause();
  const remaining = await accountCache.readAccountSnapshots(identity);
  result(t, "pre-denial device-cache write cannot republish after the source retirement barrier", { afterDenial, cachedSnapshots: remaining.length, rawCacheRows: port.rows().length, after: view(h) }, remaining.length === 0 && isRetired(h));
});


test.after(() => console.log("SOURCE_DENIAL_MATRIX " + JSON.stringify(matrix)));
