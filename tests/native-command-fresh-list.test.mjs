import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

// Execute the unchanged Store owner/read/pump/driver methods plus the tiny
// explicit freshness seam. HTTP responses are local controlled fixtures only.
const source = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
const start = source.indexOf("  #driveDocumentJobs("), end = source.indexOf("  /** Read-only client evidence guard", start);
assert(start >= 0 && end > start);
const compiled = stripTypeScriptTypes("class Store {" + source.slice(start, end).replaceAll(/#([A-Za-z]\w*)/g, "$1") + "}") + ";return Store;";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const cell = value => ({ get: () => value, set: next => { value = next; } });
async function settle() { for (let i = 0; i < 80; i++) await Promise.resolve(); }
function harness() {
  const requests = [], reads = [], delays = [], errors = [];
  const document = { visibilityState: "visible" }, window = { clearTimeout() {} };
  const fetch = (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET" });
    if (init.method === "POST") { assert.equal(url, "/api/document-jobs/original/run"); return Promise.resolve(Response.json({ job: { jobId: "original", status: "running" } })); }
    assert.equal(url, "/api/document-jobs?document=document"); const gate = deferred(); reads.push(gate); return gate.promise;
  };
  const Store = new Function("fetch", "window", "document", "documentJobTerminal", "documentJobIsStale", "documentJobCanRecoverPresentation", compiled)(fetch, window, document, () => false, () => false, () => false);
  const store = new Store(), session = {}, authorization = { key: "authorization", shared: false }, sourceOwner = { generation: 1, authorization };
  let currentSource = sourceOwner, eligible = true;
  Object.assign(store, {
    workspaceTransition: 1, jobFeedRevision: 1, sessionRevision: 1, projectContextCookieGeneration: 1, projectContextSessionGeneration: 1,
    route: cell("/studio?document=document"), session: cell(session), documentJobs: cell([]), projection: cell({ projectId: "project", documents: [{ id: "document", projectId: "project" }] }),
    jobDetails: new Map(), planningRecoveryIdentities: new Map(), sourcePausedJobs: new Map(), jobsDriving: new Set(), presentationRecoveryAttempts: new Set(),
    planningRecoverySequence: 0, pendingJobEventRefresh: false, pendingJobSessionRefresh: false,
    captureSourceOwnership: () => currentSource, sourceOwnershipActive: value => value === currentSource && eligible,
    jobFeedCurrent: revision => (revision === undefined || revision === store.jobFeedRevision) && eligible,
    canReadProjectJobs: () => eligible, canRequestProjectOutputs: () => eligible, jobScope: () => "?document=document",
    authorizationScope: () => "authorization", activeAuthorizationScope: () => "authorization", scopeStillActive: value => value === "authorization" && eligible,
    assertAuthorizationScope: value => { assert.equal(value, "authorization"); assert(eligible); }, assertSourceOwnership: value => { assert.equal(value, currentSource); assert(eligible); },
    observeAdaptivePlanningJob() {}, notify() {}, syncAdaptiveSuggestionSets() {}, revalidateMissingAdaptivePlans: async () => [],
    scheduleJobPoll: delay => delays.push(delay), toast: message => errors.push(message),
  });
  const original = { jobId: "original", documentId: "document", kind: "generate", sourceSurface: "experience", status: "queued", requestedAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:00Z" };
  return { store, requests, reads, delays, errors, original, eligible: value => { eligible = value; }, source: () => { currentSource = { ...sourceOwner, generation: 2 }; } };
}
test("verified freshness queues a new GET after an in-transit empty page and existing driver starts original promptly", async () => {
  const h = harness(), first = h.store.syncDocumentJobs(); assert.equal(h.reads.length, 1);
  await h.store.syncDocumentJobs({ freshAfterActive: true }); assert(h.store.initialListReadPending); assert.equal(h.reads.length, 1);
  h.reads[0].resolve(Response.json({ jobs: [] })); await first; await settle();
  assert.equal(h.reads.length, 2, "fresh page begins without invoking a poll timer"); assert.deepEqual(h.delays, [60000]);
  h.reads[1].resolve(Response.json({ jobs: [h.original] })); await settle();
  assert.equal(h.requests.filter(row => row.method === "POST").length, 1); assert.equal(h.store.documentJobs.get()[0].jobId, "original");
  assert.equal(h.store.initialListReadActive, null); assert.equal(h.store.initialListReadPending, null); assert.deepEqual(h.errors, []);
});
test("legacy busy sync retains exact active-read coalescing with no new page", async () => {
  const h = harness(), first = h.store.syncDocumentJobs(); await h.store.syncDocumentJobs();
  assert.equal(h.store.initialListReadPending, null); h.reads[0].resolve(Response.json({ jobs: [] })); await first; await settle();
  assert.equal(h.reads.length, 1); assert.deepEqual(h.delays, [60000]); assert.equal(h.requests.filter(row => row.method === "POST").length, 0);
});
test("multiple explicit freshness requests share the same undispatched pending page", async () => {
  const h = harness(), first = h.store.syncDocumentJobs(); await h.store.syncDocumentJobs({ freshAfterActive: true }); const pending = h.store.initialListReadPending;
  await h.store.syncDocumentJobs({ freshAfterActive: true }); assert.equal(h.store.initialListReadPending, pending);
  h.reads[0].resolve(Response.json({ jobs: [] })); await first; await settle(); assert.equal(h.reads.length, 2);
  h.reads[1].resolve(Response.json({ jobs: [] })); await settle(); assert.equal(h.reads.length, 2); assert.equal(h.store.initialListReadActive, null);
});
for (const mode of ["navigation", "route", "session", "sessionRevision", "source", "cookie", "cookieSession", "ineligible", "feed"]) test(mode + " withdrawal retires the queued fresh owner without a provider start", async () => {
  const h = harness(), first = h.store.syncDocumentJobs(); await h.store.syncDocumentJobs({ freshAfterActive: true }); const pending = h.store.initialListReadPending;
  if (mode === "navigation") h.store.workspaceTransition++;
  if (mode === "route") h.store.route.set("/other");
  if (mode === "session") h.store.session.set({});
  if (mode === "sessionRevision") h.store.sessionRevision++;
  if (mode === "source") h.source();
  if (mode === "cookie") h.store.projectContextCookieGeneration++;
  if (mode === "cookieSession") h.store.projectContextSessionGeneration++;
  if (mode === "ineligible") h.eligible(false);
  if (mode === "feed") h.store.jobFeedRevision++;
  h.reads[0].resolve(Response.json({ jobs: [] })); await first; await settle();
  assert.deepEqual(await pending.operation.initial, { status: "superseded", dispatched: false }); await pending.operation.settled;
  // Feed resumption already schedules a separate current-owner automatic read;
  // the withdrawn queued owner itself must still never dispatch or drive.
  if (mode === "feed") { assert.equal(h.reads.length, 2); assert.notEqual(h.store.initialListReadActive, pending); h.reads[1].resolve(Response.json({ jobs: [] })); await settle(); }
  else assert.equal(h.reads.length, 1);
  assert.equal(h.requests.filter(row => row.method === "POST").length, 0); assert.equal(h.store.initialListReadActive, null);
});
test("a newer owner supersedes a pending fresh claim and the old finalizer cannot reclaim it", async () => {
  const h = harness(), first = h.store.syncDocumentJobs(); await h.store.syncDocumentJobs({ freshAfterActive: true }); const previous = h.store.initialListReadPending;
  h.store.workspaceTransition++; await h.store.syncDocumentJobs({ freshAfterActive: true }); const current = h.store.initialListReadPending; assert.notEqual(current, previous);
  assert.deepEqual(await previous.operation.initial, { status: "superseded", dispatched: false }); await previous.operation.settled;
  h.reads[0].resolve(Response.json({ jobs: [] })); await first; await settle(); assert.equal(h.store.initialListReadActive, current); assert.equal(h.reads.length, 2);
  h.reads[1].resolve(Response.json({ jobs: [] })); await settle(); assert.equal(h.store.initialListReadActive, null); assert.equal(h.reads.length, 2);
});
test("fresh idle invocation uses one ordinary read and does not manufacture another", async () => {
  const h = harness(), request = h.store.syncDocumentJobs({ freshAfterActive: true }); assert.equal(h.reads.length, 1);
  h.reads[0].resolve(Response.json({ jobs: [] })); await request; await settle(); assert.equal(h.reads.length, 1); assert.equal(h.store.initialListReadActive, null);
});
