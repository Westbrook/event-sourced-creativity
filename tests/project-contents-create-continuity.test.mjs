import assert from "node:assert/strict";
import test from "node:test";
import { writeFixture, financial, readWorkspaceEvents, appendAuditEvent, sceneDeferred, untilScene } from "./helpers/event-source-retirement-fixture.mjs";
import { createCalmFullPage, calmFullPageNativePorts, registerCalmFullPageComponents } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { isOutputFixtureReadOnlyResume } from "./helpers/output-reachability-fixture.mjs";
import { documentIdFromRoute, routePathname } from "../src/model/routes.ts";

// Four D consistency baselines. Real current Project contents, Shell, Store and
// Worker; finite native/history/HTTP ports. No application method replacement,
// synthetic success, provider execution, browser geometry or AT claim.
const options = { timeout: 40_000 };
const RAW_A = "  Original project document  ", RAW_B = "  Newer unsent project title  ";
const within = (node, parent) => { for (let value = node; value; value = value.parent)
  if (value === parent || value.port && value.port === parent.port) return true; return false; };
const own = (f, tag) => {
  const rows = f.components().filter(component => component.tag === tag);
  assert.equal(rows.length, 1, "one actual connected " + tag); return rows[0];
};

// This is a local observer for ONLY this native form's two-event request.
// It is not Atomic's Sessions contract or a general event/POST allowlist.
// Clones inspect the actual response before the SAME Response reaches Store.
// Canonical write timing is serialized with already-started original Resume
// reads; their unchanged observer must independently certify 200:none/no writes.
function observeCreates(h, resumes, history) {
  const prior = h.transport, proofs = new WeakMap(), records = [];
  const expectedPosts = [], capacityRequests = [];
  let capacityPreparing = null;
  let armed = null, writing = null, expectedHistory = history;
  const exact = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.url === "/api/events" && request.init === proof.init
      && request.init.method === "POST" && request.init.body === proof.bytes
      && JSON.stringify(request.body) === proof.bytes);
  };
  const execute = async (request, record, attempt) => {
    const init = request.init, bytes = init.body, input = JSON.parse(bytes);
    assert.ok(h.requests.includes(request)); assert.equal(h.store.route.get(), record.route);
    assert.equal(h.store.session.get().user.userId, record.actor);
    assert.equal(h.store.session.get().projectContext == null, true);
    assert.ok(h.store.authorizationScopeActive(record.authorization) && h.store.sourceOwnershipActive(record.source));
    assert.equal(h.store.projection.get().projectId, record.projectId);
    assert.deepEqual(Object.keys(input).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(input.action, "batch"); assert.equal(input.clientId, "web:lit");
    assert.equal(input.events.length, 2); assert.deepEqual(input.event, input.events[0]);
    const documentId = input.events[0].payload.document_id;
    assert.match(documentId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu);
    const slug = record.title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "document-" + documentId.slice(0, 8);
    assert.deepEqual(input.events, [
      { type: "DocumentCreated", payload: { project_id: record.projectId, document_id: documentId, handle: slug, title: record.title } },
      { type: "EmptyCanvasChosen", payload: { project_id: record.projectId, document_id: documentId, source_surface: "project-contents" } },
    ]);
    if (record.inputEvents) assert.deepEqual(input.events, record.inputEvents, "Store rebase retains the original exact batch and UUID");
    else { record.inputEvents = structuredClone(input.events); record.documentId = documentId; }
    await resumes.settleOriginalRequests();
    const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
    assert.deepEqual(before, expectedHistory, "no unaccounted canonical write before this exact attempt");
    assert.equal(before.some(event => event.type === "DocumentCreated" && event.payload.document_id === documentId), false);
    attempt.headBefore = before.at(-1).sequence;
    // Bypass no application gate: guardedFetch has dispatched this request and
    // the original RAM Worker still enforces admission, validation and sequence.
    const response = await h.worker.request(request.url, init), returned = await response.clone().json();
    assert.equal(response.bodyUsed, false); attempt.response = response; attempt.status = response.status;
    if (response.status === 409) {
      assert.equal(record.allowRebase, true); assert.equal(record.attempts.length, 1);
      assert.deepEqual(returned, { error: "stale_sequence", expected: input.expectedSequence, head: attempt.headBefore });
      assert.ok(input.expectedSequence < attempt.headBefore);
      await h.worker.drainBackground();
      assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before);
    } else {
      assert.equal(response.status, 200, "the original actual Worker positively acknowledged this exact create");
      assert.equal(input.expectedSequence, attempt.headBefore);
      assert.deepEqual(Object.keys(returned).sort(), ["appended", "head", "rejected"]);
      assert.deepEqual(returned.rejected, []); assert.equal(returned.appended.length, 2);
      assert.equal(new Set(returned.appended.map(event => event.eventId)).size, 2);
      for (const [index, event] of returned.appended.entries()) {
        assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user");
        assert.equal(event.clientId, "web:lit"); assert.ok(event.eventId && event.correlationId);
        assert.equal(event.sequence, input.expectedSequence + index + 1);
        assert.equal(event.type, input.events[index].type); assert.deepEqual(event.payload, input.events[index].payload);
      }
      assert.equal(returned.head, returned.appended.at(-1).sequence);
      await h.worker.drainBackground();
      expectedHistory = [...before, ...returned.appended];
      assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), expectedHistory,
        "full original history plus exactly the two genuinely returned events");
      record.receipt = structuredClone(returned); record.originalResponse = response;
    }
    assert.deepEqual(financial(h.worker), money, "every original financial/job row is unchanged across the actual create");
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.ok(h.store.authorizationScopeActive(record.authorization) && h.store.sourceOwnershipActive(record.source));
    proofs.set(request, { init, bytes }); assert.equal(exact({ ...request }), false, "clones cannot acquire original-request proof");
    if (writing === attempt) writing = null; attempt.canonical.resolve();
    if (response.status === 409) return response;
    armed = null;
    await record.gate.promise;
    if (record.lose) { record.deliveryFault = true; throw new TypeError("Finite loss after the genuine Project contents Worker 200"); }
    record.delivered = true; return response;
  };
  const transport = request => {
    if (request.url === "/api/events" && request.init.method === "POST") {
      if (capacityPreparing) {
        const preparation = capacityPreparing;
        assert.equal(preparation.request, null, "one actual transport invocation for this exact capacity prerequisite ID");
        assert.deepEqual(request.body, { action: "append", clientId: "web:lit", expectedSequence: preparation.head,
          event: preparation.event, events: [preparation.event] });
        assert.equal(request.init.body, JSON.stringify(request.body));
        assert.ok(h.store.sourceOwnershipActive(preparation.source) && h.store.authorizationScopeActive(preparation.authorization));
        preparation.request = request;
        proofs.set(request, { init: request.init, bytes: request.init.body });
        assert.equal(exact({ ...request }), false);
        capacityRequests.push(request); expectedPosts.push(request);
        // Explicit synthetic transport uncertainty, before any Worker dispatch.
        // This does NOT prove an attempted original unused or fabricate an ACK.
        throw new TypeError("Finite named capacity prerequisite transport outcome unknown");
      }
      assert.ok(armed && !writing && !armed.receipt, "only the exact explicitly armed current form submission can append");
      const record = armed;
      assert.ok(record.attempts.length < (record.allowRebase ? 2 : 1), "no unbounded or independent retry");
      const attempt = { request, canonical: sceneDeferred(), pending: null }; record.attempts.push(attempt); writing = attempt;
      expectedPosts.push(request);
      attempt.pending = execute(request, record, attempt);
      attempt.pending.catch(error => { if (!record.deliveryFault) record.error = error; if (writing === attempt) writing = null; attempt.canonical.resolve(); });
      return attempt.pending;
    }
    const attempt = writing, scope = { projectId: h.store.projection.get().projectId, documentId: h.store.projection.get().documentId };
    if (attempt && isOutputFixtureReadOnlyResume(request, scope)) {
      const init = request.init, bytes = init.body;
      return attempt.canonical.promise.then(() => {
        assert.equal(request.init, init); assert.equal(request.init.body, bytes);
        return prior(request); // unchanged original-response observer, no read exemption here
      });
    }
    return prior(request);
  };
  h.transport = transport;
  return {
    records, exact,
    async prepareCapacity() {
      assert.equal(capacityPreparing, null); assert.equal(capacityRequests.length, 0);
      assert.equal(armed, null); assert.equal(writing, null);
      await resumes.settleOriginalRequests(); await h.worker.drainBackground();
      const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
      assert.deepEqual(before, expectedHistory);
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const owner = { authorizationKey: authorization.key, actorUserId: h.store.session.get().user.userId,
        projectId: h.worker.projectId, sourceGeneration: source.generation };
      assert.equal(h.store.eventWriteAcknowledgments(owner).length, 0, "capacity starts with no earlier unknown invocation");
      const receipts = [];
      for (let index = 0; index < 32; index++) {
        const id = "d-project-contents-capacity-" + index;
        const event = { type: "BlockCreated", payload: { project_id: h.worker.projectId, document_id: h.worker.documentId,
          block_id: id, client_event_id: "client-" + id, type: "direction", properties: { text: "Named finite capacity prerequisite " + index } } };
        const preparation = { event, source, authorization, head: h.store.head.get(), request: null };
        capacityPreparing = preparation;
        let result;
        try { result = await h.store.appendWithReceipt(event); } finally { capacityPreparing = null; }
        assert.ok(preparation.request && exact(preparation.request));
        assert.equal(result.publication, "none"); assert.equal(result.acknowledgment.outcome, "unconfirmed");
        assert.equal(result.acknowledgment.privateUnavailable, false); assert.deepEqual(result.appended, []);
        assert.deepEqual(result.acknowledgment.owner, owner);
        assert.deepEqual(result.acknowledgment.requestedClientEventIds, ["client-" + id]);
        assert.deepEqual(result.acknowledgment.committed, []); assert.deepEqual(result.acknowledgment.rejectedIndices, []);
        assert.equal(result.acknowledgment.observedHead, null); receipts.push(result.acknowledgment);
      }
      assert.equal(capacityRequests.length, 32); assert.deepEqual(h.store.eventWriteAcknowledgments(owner), receipts);
      assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), before); assert.deepEqual(financial(h.worker), money);
      // Separate public-result probe. Its exact pair must never reach transport;
      // the subsequent real native form proves the presentation consequence.
      const documentId = "d0000000-0000-4000-8000-000000000099", beforePosts = expectedPosts.length;
      const probe = await h.store.appendBatchWithReceipt([
        { type: "DocumentCreated", payload: { project_id: h.worker.projectId, document_id: documentId, handle: "capacity-probe", title: "Capacity nondispatch probe" } },
        { type: "EmptyCanvasChosen", payload: { project_id: h.worker.projectId, document_id: documentId, source_surface: "project-contents" } },
      ]);
      assert.equal(expectedPosts.length, beforePosts); assert.equal(probe.publication, "none");
      assert.equal(probe.acknowledgment.outcome, "not-attempted"); assert.equal(probe.acknowledgment.privateUnavailable, false);
      assert.equal(probe.acknowledgment.action, "batch"); assert.deepEqual(probe.acknowledgment.owner, owner);
      assert.deepEqual(probe.appended, []); assert.deepEqual(probe.acknowledgment.requestedClientEventIds, []);
      assert.deepEqual(probe.acknowledgment.committed, []); assert.deepEqual(probe.acknowledgment.rejectedIndices, []);
      assert.equal(probe.acknowledgment.observedHead, null); assert.deepEqual(h.store.eventWriteAcknowledgments(owner), receipts);
      return { owner, receipts, probe, requests: [...capacityRequests] };
    },
    async removeOriginalForAvailability(record) {
      assert.ok(records.includes(record) && record.lose && record.acknowledgment?.outcome === "unconfirmed");
      assert.equal(armed, null); assert.equal(writing, null); await resumes.settleOriginalRequests();
      const before = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
      assert.deepEqual(before, expectedHistory);
      const payload = { project_id: record.projectId, document_id: record.documentId, was_current: false,
        reason: "explicit synthetic original-availability interleaving" };
      const seeded = await appendAuditEvent(h.worker.env, h.worker.streamId, "user", "DocumentRemoved", payload);
      await h.worker.drainBackground();
      const after = await readWorkspaceEvents(h.worker.env, h.worker.streamId);
      assert.deepEqual(after.slice(0, -1), before); assert.equal(after.length, before.length + 1);
      const removal = after.at(-1); assert.equal(removal.eventId, seeded.eventId);
      assert.equal(removal.type, "DocumentRemoved"); assert.deepEqual(removal.payload, payload);
      assert.equal(removal.streamId, h.worker.streamId); assert.equal(removal.actor, "user");
      assert.equal(removal.clientId, "server:policy"); assert.equal(removal.sequence, before.at(-1).sequence + 1);
      assert.deepEqual(financial(h.worker), money); expectedHistory = after;
      return removal;
    },
    arm(title, { lose = false, allowRebase = false } = {}) {
      assert.equal(armed, null); assert.equal(writing, null); assert.ok(records.length < 2);
      const authorization = h.store.captureAuthorizationScope(), source = h.store.captureSourceOwnership();
      assert.ok(authorization && source && h.store.authorizationScopeActive(authorization) && h.store.sourceOwnershipActive(source));
      const actor = h.store.session.get().user.userId, projectId = h.store.projection.get().projectId;
      const owner = { authorizationKey: authorization.key, actorUserId: actor, projectId, sourceGeneration: source.generation };
      armed = { title, actor, projectId, source, authorization, owner, route: h.store.route.get(), lose, allowRebase,
        beforeObservations: new Set(h.store.eventWriteAcknowledgments(owner).map(row => row.observationId)),
        attempts: [], gate: sceneDeferred(), receipt: null, error: null, submission: null };
      assert.equal(routePathname(armed.route), "/studio/project"); records.push(armed); return armed;
    },
    async reached(record) {
      await untilScene(() => Boolean(record.receipt || record.error), "the actual Worker positive response must reach the finite hold");
      if (record.error) throw record.error;
      assert.ok(record.receipt); assert.equal(record.originalResponse.bodyUsed, false);
      const pending = h.store.eventWriteAcknowledgments(record.owner).filter(row => !record.beforeObservations.has(row.observationId));
      assert.equal(pending.length, 1, "one exact still-pending Store observation belongs to this held original response");
      record.pendingObservation = pending[0];
      assert.equal(pending[0].action, "batch"); assert.deepEqual(pending[0].owner, record.owner);
      assert.equal(pending[0].privateUnavailable, false); assert.equal(pending[0].observedHead, null);
      assert.deepEqual(pending[0].requestedClientEventIds, []); assert.deepEqual(pending[0].committed, []);
      assert.deepEqual(pending[0].rejectedIndices, []);
      return record;
    },
    async finish(record) {
      record.gate.resolve(); await record.submission;
      if (record.error) throw record.error;
      const observations = h.store.eventWriteAcknowledgments(record.owner).filter(row => !record.beforeObservations.has(row.observationId));
      assert.ok(record.pendingObservation?.observationId);
      if (!record.lose) {
        assert.equal(observations.length, 0, "published observed receipts are released, not retained as a success ledger");
        assert.equal(record.originalResponse.bodyUsed, true, "the actual Store consumed the same original positive response");
        for (const event of record.receipt.appended) assert.deepEqual(h.store.events.get().find(value => value.eventId === event.eventId), event);
        assert.equal(h.store.head.get(), record.receipt.head); assert.equal(h.store.appendFailure.get(), "");
        record.publishedAndPruned = true;
        return;
      }
      assert.equal(observations.length, 1, "the original uncertain invocation remains in the actual pending/uncertain registry");
      record.acknowledgment = observations[0];
      assert.equal(record.acknowledgment.observationId, record.pendingObservation.observationId);
      assert.equal(record.acknowledgment.action, "batch"); assert.deepEqual(record.acknowledgment.owner, record.owner);
      assert.deepEqual(record.acknowledgment.requestedClientEventIds, []); assert.deepEqual(record.acknowledgment.rejectedIndices, []);
      assert.equal(record.acknowledgment.observedHead, record.lose ? null : record.receipt.head);
      assert.equal(record.acknowledgment.outcome, record.lose ? "unconfirmed" : "observed");
      assert.equal(record.acknowledgment.privateUnavailable, false);
      assert.deepEqual(record.acknowledgment.committed, record.lose ? [] : record.receipt.appended.map(event => ({
        eventId: event.eventId, type: event.type, sequence: event.sequence, clientEventId: null,
      })));
      assert.equal(record.originalResponse.bodyUsed, !record.lose, "only delivered responses were consumed by the actual Store");
    },
    async verify() {
      for (const record of records) {
        record.gate.resolve(); if (record.submission) await record.submission;
        if (record.error) throw record.error;
        assert.ok(record.receipt); for (const attempt of record.attempts) assert.ok(exact(attempt.request));
      }
      await resumes.settleOriginalRequests(); await h.worker.drainBackground();
      assert.equal(resumes.pendingOriginalCount(), 0);
      assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), expectedHistory);
      assert.deepEqual(h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST"), expectedPosts);
      assert.deepEqual(expectedPosts.filter(request => !capacityRequests.includes(request)),
        records.flatMap(record => record.attempts.map(attempt => attempt.request)));
      assert.ok(capacityRequests.length === 0 || capacityRequests.length === 32);
      for (const request of capacityRequests) assert.ok(exact(request));
      for (const request of h.requests) if ((request.init.method ?? "GET") !== "GET")
        assert.ok(exact(request) || resumes.isReadOnlyResume(request), "only exact observed creates and actual zero-write Resume reads");
      assert.equal(globalThis.fetch.mock.callCount(), 0);
    },
    restore() { if (h.transport === transport) h.transport = prior; },
  };
}

// Only the two actual ordinary-dialog descendant queries are missing from the
// finite selector port. Resolve current native ancestry, not a first match or
// an application method, and leave every other selector with the existing port.
function projectContentsNative(t, f, owner) {
  f.native = installOutputNavigationFocusNative(t, f, calmFullPageNativePorts);
  const prior = f.renderer.query.bind(f.renderer);
  f.renderer.query = (queryOwner, selector) => {
    if (queryOwner !== owner || ![".new-document-dialog form", ".new-document-dialog input"].includes(selector))
      return prior(queryOwner, selector);
    const tree = f.tree(), dialogs = tree.nodes.filter(node => node.owner === owner && node.tag === "dialog"
      && String(node.attributes.class ?? "").split(/\s+/u).includes("new-document-dialog"));
    assert.ok(dialogs.length <= 1, "ordinary opening has at most one exact current native dialog");
    if (!dialogs.length) return [];
    const tag = selector.endsWith(" form") ? "form" : "input";
    const nodes = tree.nodes.filter(node => node.owner === owner && node.tag === tag && within(node, dialogs[0]));
    assert.equal(nodes.length, 1); assert.ok(nodes[0].port?.isConnected);
    return [nodes[0].port];
  };
}

async function projectContents(t) {
  let finalCheck = async () => {}; t.after(() => finalCheck());
  const h = await writeFixture(t, { shared: false }), original = {
    events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get(), session: h.store.session.get(),
  };
  const history = await readWorkspaceEvents(h.worker.env, h.worker.streamId), money = financial(h.worker);
  const resumes = observeActualSceneResumeReads(h);
  const f = await createCalmFullPage(t, { storeHost: { ...h, close() {} } });
  h.store.events.set(original.events); h.store.head.set(original.head);
  h.store.content.set(original.content); h.store.session.set(original.session);
  h.store.setRoute("/studio/project"); h.store.loading.set(false); f.nativeHistoryLocation = h.location;
  await f.settle(); await resumes.settleOriginalRequests();
  assert.deepEqual(h.store.events.get(), original.events); assert.equal(h.store.head.get(), original.head);
  assert.deepEqual(await readWorkspaceEvents(h.worker.env, h.worker.streamId), history);
  assert.equal(h.store.projection.get().projectId, h.worker.projectId);
  assert.equal(h.store.session.get().projectContext == null, true);
  const owner = own(f, "forma-project-contents"), creates = observeCreates(h, resumes, history);
  await registerCalmFullPageComponents(f, ["forma-project-contents", "forma-workspace", "forma-activity"]);
  projectContentsNative(t, f, owner);
  await f.settle(); await resumes.settleOriginalRequests();
  finalCheck = async () => {
    try {
      await creates.verify(); assert.deepEqual(financial(h.worker), money);
      const originalIds = new Set(original.events.map(event => event.eventId));
      assert.deepEqual(h.store.events.get().filter(event => originalIds.has(event.eventId)), original.events,
        "all original published source events remain byte-equivalent as data");
    }
    finally { creates.restore(); resumes.restore(); }
  };
  const dialog = () => f.find("dialog", node => node.owner === owner
    && String(node.attributes.class).split(/\s+/u).includes("new-document-dialog")
    && !String(node.attributes.class).split(/\s+/u).includes("document-copy-dialog"));
  const title = () => { const modal = dialog(); return f.find("input", node => node.owner === owner && within(node, modal)
    && node.attributes.placeholder === "e.g. Packaging exploration"); };
  const form = () => { const modal = dialog(); return f.find("form", node => node.owner === owner && within(node, modal)); };
  const submit = () => { const modal = dialog(); return f.find("button", node => node.owner === owner && within(node, modal)
    && node.text === f.i18n.system("Create & open")); };
  await f.act(f.find("button", node => node.owner === owner && node.text === f.i18n.system("New document")));
  assert.ok(dialog().port.open && owner.isConnected);
  const type = async raw => {
    const field = title(); assert.ok(field.port.isConnected && f.renderer.nodes.includes(field.port));
    assert.equal(Object.hasOwn(field.attributes, "readonly"), false); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
    field.port.value = raw; await f.act(field, "input"); assert.equal(title().port.value, raw);
  };
  await type(RAW_A); const route = h.store.route.get();
  const start = async settings => {
    assert.ok(owner.isConnected); const button = submit(), currentForm = form();
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    const record = creates.arm(title().port.value.trim(), settings);
    record.submission = f.act(currentForm, "submit", { submitter: button.port });
    record.submission.catch(() => {}); // finish/cleanup still awaits and exposes the original rejection
    await creates.reached(record); return record;
  };
  const diagnostic = mode => t.diagnostic(JSON.stringify({ mode, route: h.store.route.get(),
    currentContents: owner.isConnected, positiveDocumentIds: creates.records.map(record => record.documentId),
    attempts: creates.records.map(record => record.attempts.map(attempt => attempt.status)),
    acknowledgments: creates.records.map(record => record.acknowledgment?.outcome ?? (record.publishedAndPruned ? "published-and-pruned" : "pending")),
    canonicalCreateCount: creates.records.filter(record => record.receipt).length }));
  return { h, f, owner, creates, history, money, route, dialog, title, form, submit, type, start, diagnostic };
}

function ordinaryOriginalButton(x, action) {
  const modal = x.dialog();
  return x.f.find("button", node => node.owner === x.owner && within(node, modal)
    && String(node.attributes.class ?? "").split(/\s+/u).includes("project-blank-original-" + action));
}
function ordinaryOriginalNotice(x) {
  const modal = x.dialog();
  return x.f.find("p", node => node.owner === x.owner && within(node, modal)
    && String(node.attributes.class ?? "").split(/\s+/u).includes("project-blank-original-notice"));
}
function ordinaryNoResubmit(x) {
  const modal = x.dialog();
  assert.equal(x.f.tree().visible("button").filter(node => node.owner === x.owner && within(node, modal)
    && node.attributes.type === "submit").length, 0, "unknown original has no replacement Create action");
}

test("D Project contents healthy ordinary create opens its exact acknowledged blank document", options, async t => {
  const x = await projectContents(t), record = await x.start();
  assert.equal(x.h.store.head.get(), x.history.at(-1).sequence, "the withheld Worker response has not been invented as a Store ACK");
  await x.creates.finish(record); await x.creates.verify(); x.diagnostic("healthy");
  assert.equal(documentIdFromRoute(x.h.store.route.get()), record.documentId);
  assert.equal(x.h.store.projection.get().documentId, record.documentId);
  assert.equal(x.h.store.projection.get().blocks.length, 0, "ordinary creation infers no authored context");
  assert.ok(own(x.f, "forma-workspace").isConnected); assert.equal(x.owner.isConnected, false);
  assert.equal(x.f.tree().visible("dialog").some(node => node.owner === x.owner), false);
  assert.equal(x.h.store.ui.toast, x.f.i18n.system("{title} created as a blank document.", { title: RAW_A.trim() }));
});

test("D Project contents original ACK preserves a newer raw title in the current native form", options, async t => {
  const x = await projectContents(t), record = await x.start();
  await x.type(RAW_B);
  assert.equal(x.h.store.route.get(), x.route); assert.equal(x.title().port.value, RAW_B);
  assert.equal(record.receipt.appended[0].payload.title, RAW_A.trim());
  await x.creates.finish(record); await x.creates.verify(); x.diagnostic("newer-raw-title");
  assert.equal(x.h.store.route.get(), x.route, "the saved A does not navigate away from the newer unsubmitted B");
  assert.ok(x.owner.isConnected); assert.ok(x.dialog().port.open);
  assert.equal(x.title().port.value, RAW_B, "the exact raw newer title remains in the current authorized native form");
  assert.equal(x.creates.records.length, 1);
});

test("D Project contents original ACK cannot override a later actual Shell history departure", options, async t => {
  const x = await projectContents(t), record = await x.start();
  const destination = "/activity?document=" + encodeURIComponent(x.h.worker.documentId);
  const before = x.h.store.route.get();
  // A legal browser-history traversal can occur while a modal is open. This
  // uses the existing native Location port and CURRENT Shell popstate listener,
  // not a click through inert background or a retained detached callback.
  globalThis.history.pushState({}, "", destination);
  assert.equal(x.h.store.route.get(), before, "finite native history alone does not invoke an application callback");
  const listeners = [...(x.f.listeners.get("popstate") ?? [])]; assert.equal(listeners.length, 1);
  for (const listener of listeners) listener({ type: "popstate", state: null });
  await x.f.settle();
  assert.equal(x.h.store.route.get(), destination); assert.equal(x.owner.isConnected, false);
  const activity = own(x.f, "forma-activity"); assert.ok(activity.isConnected);
  assert.ok(x.h.store.sourceOwnershipActive(record.source));
  await x.creates.finish(record); await x.creates.verify(); x.diagnostic("native-history-departure");
  assert.equal(x.h.store.route.get(), destination, "an old positive response cannot replace the newer actual route");
  assert.ok(activity.isConnected); assert.equal(x.owner.isConnected, false);
});

test("D Project contents lost positive ACK checks and opens the exact original without resubmission", options, async t => {
  const x = await projectContents(t), first = await x.start({ lose: true });
  await x.creates.finish(first); await x.creates.verify();
  assert.equal(x.h.store.route.get(), x.route); assert.ok(x.owner.isConnected && x.dialog().port.open);
  assert.equal(x.title().port.value, RAW_A); assert.equal(first.acknowledgment.outcome, "unconfirmed");
  assert.equal(first.originalResponse.bodyUsed, false, "the positive original response was lost, not delivered as fake success");
  assert.equal((await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId)).filter(event =>
    event.type === "DocumentCreated" && event.payload.document_id === first.documentId).length, 1);
  ordinaryNoResubmit(x);
  const uncertainty = structuredClone(x.h.store.eventWriteAcknowledgments(first.owner));
  x.f.native.emit("pointerdown", ordinaryOriginalButton(x, "check").port);
  await x.f.act(ordinaryOriginalButton(x, "check"));
  assert.equal(x.title().port.value, RAW_A);
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAvailable"));
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(first.owner), uncertainty,
    "a successful exact read does not acknowledge the original two-event batch");
  assert.ok(x.h.store.sourceOwnershipActive(first.source) && x.h.store.authorizationScopeActive(first.authorization));
  ordinaryNoResubmit(x); assert.equal(x.creates.records.length, 1);
  x.f.native.emit("pointerdown", ordinaryOriginalButton(x, "open").port);
  await x.f.act(ordinaryOriginalButton(x, "open"));
  await x.creates.verify(); x.diagnostic("lost-positive-check-original");
  assert.equal(documentIdFromRoute(x.h.store.route.get()), first.documentId);
  assert.equal(x.h.store.projection.get().documentId, first.documentId);
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(first.owner), uncertainty);
  const created = (await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId)).slice(x.history.length)
    .filter(event => event.type === "DocumentCreated");
  assert.equal(created.length, 1, "same original form intent must recover the first canonical create, not mint another document");
  assert.equal(created[0].payload.document_id, first.documentId);
});

// Additive controls below use the same actual host, Store and RAM Worker.
// Names, native gestures and explicit server interleavings are finite fixtures;
// no application method, returned acknowledgment or authority predicate is replaced.
const ordinaryClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
function ordinaryCurrentSubmit(x) {
  const modal = x.dialog();
  return x.f.find("button", node => node.owner === x.owner && within(node, modal) && node.attributes.type === "submit");
}
function ordinaryNoOriginalUi(x) {
  assert.equal(x.f.tree().visible("button").filter(node => node.owner.tag === "forma-project-contents"
    && String(node.attributes.class ?? "").split(/\s+/u).some(name => name.startsWith("project-blank-original-"))).length, 0);
  assert.equal(x.f.tree().visible("dialog").filter(node => node.owner.tag === "forma-project-contents"
    && ordinaryClass(node, "new-document-dialog")).length, 0);
}
function ordinaryRecovery(x) {
  return x.f.find("button", node => node.owner === x.owner && ordinaryClass(node, "project-blank-original-review"));
}
async function ordinaryClose(x, mode) {
  const modal = x.dialog(); assert.ok(modal.port.open && modal.port.isConnected);
  if (mode === "Close") {
    const button = x.f.find("button", node => node.owner === x.owner && within(node, modal)
      && node.text === x.f.i18n.t("action.close") && ordinaryClass(node, "ghost"));
    x.f.native.emit("pointerdown", button.port); await x.f.act(button);
  } else if (mode === "Escape") {
    x.f.native.emit("keydown", modal.port); await x.f.act(modal, "cancel");
  } else {
    assert.equal(mode, "backdrop"); x.f.native.emit("pointerdown", modal.port);
    await x.f.act(modal, "click", { target: modal.port });
  }
  assert.equal(x.h.store.route.get(), x.route); assert.ok(x.owner.isConnected);
  assert.equal(x.f.tree().visible("dialog").filter(node => node.owner === x.owner && ordinaryClass(node, "new-document-dialog")).length, 0);
  assert.ok(ordinaryRecovery(x).port.isConnected);
}
async function ordinaryReview(x) {
  const control = ordinaryRecovery(x); x.f.native.emit("pointerdown", control.port); await x.f.act(control);
  assert.ok(x.dialog().port.open && x.owner.isConnected);
}
async function ordinaryDiscardName(x) {
  const modal = x.dialog(), button = x.f.find("button", node => node.owner === x.owner && within(node, modal)
    && node.text === x.f.i18n.t("sessions.blank.discard"));
  x.f.native.emit("pointerdown", button.port); await x.f.act(button);
  assert.equal(x.title().port.value, "");
}
async function ordinaryOpen(x, record) {
  const control = ordinaryOriginalButton(x, "open"); assert.equal(Object.hasOwn(control.attributes, "disabled"), false);
  x.f.native.emit("pointerdown", control.port); await x.f.act(control);
  assert.equal(documentIdFromRoute(x.h.store.route.get()), record.documentId);
  assert.equal(x.h.store.projection.get().documentId, record.documentId);
  assert.equal(x.owner.isConnected, false); await x.creates.verify();
}
async function ordinaryCheck(x, record, { loseRead = false } = {}) {
  const prior = x.h.transport, reads = []; let armed = true;
  x.h.transport = async request => {
    const url = new URL(request.url, "https://fixture.invalid");
    if (!armed || url.pathname !== "/api/events" || (request.init.method ?? "GET") !== "GET"
      || url.searchParams.get("after") !== "0") return prior(request);
    armed = false;
    const before = await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), money = financial(x.h.worker);
    const response = await prior(request); assert.equal(response.status, 200);
    const body = await response.clone().json(); assert.ok(Array.isArray(body.events));
    assert.ok(body.events.some(event => event.type === "DocumentCreated" && event.payload.document_id === record.documentId));
    assert.equal(response.bodyUsed, false); assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), before);
    assert.deepEqual(financial(x.h.worker), money); reads.push({ request, response, body });
    if (loseRead) throw new TypeError("Finite lost read after the genuine original-history Worker 200");
    return response;
  };
  try {
    const control = ordinaryOriginalButton(x, "check"); assert.equal(Object.hasOwn(control.attributes, "disabled"), false);
    x.f.native.emit("pointerdown", control.port); await x.f.act(control);
  } finally { x.h.transport = prior; }
  assert.equal(reads.length, 1, "one exact fresh from-start read belongs to this Check gesture");
  assert.equal(reads[0].response.bodyUsed, !loseRead); return reads[0];
}
async function ordinaryHistory(x, destination) {
  const before = x.h.store.route.get(); globalThis.history.pushState({}, "", destination);
  assert.equal(x.h.store.route.get(), before, "native history alone does not dispatch a Store callback");
  const listeners = [...(x.f.listeners.get("popstate") ?? [])]; assert.equal(listeners.length, 1);
  for (const listener of listeners) listener({ type: "popstate", state: null });
  await x.f.settle(); assert.equal(x.h.store.route.get(), destination);
}

for (const mode of ["Close", "Escape", "backdrop"]) {
  test("D ordinary-create " + mode + " retains a pending original without late reopening or navigation", options, async t => {
    const x = await projectContents(t), record = await x.start();
    await ordinaryClose(x, mode);
    assert.ok(ordinaryRecovery(x).text.includes(RAW_A.trim()));
    await x.creates.finish(record); await x.creates.verify();
    assert.equal(x.h.store.route.get(), x.route); assert.ok(x.owner.isConnected);
    assert.equal(x.f.tree().visible("dialog").filter(node => node.owner === x.owner).length, 0);
    assert.ok(ordinaryRecovery(x).port.isConnected, "the verified original remains explicitly reachable on the same page");
    await ordinaryReview(x); assert.equal(x.title().port.value, "", "existing Close discarded only the live name");
    assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalCreated"));
    await ordinaryOpen(x, record); assert.equal(x.creates.records.length, 1);
  });

  test("D ordinary-create " + mode + " reopens the uncertain original instead of a fresh Create", options, async t => {
    const x = await projectContents(t), record = await x.start({ lose: true });
    await x.creates.finish(record); const uncertainty = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
    await ordinaryClose(x, mode); await ordinaryReview(x);
    assert.equal(x.title().port.value, ""); ordinaryNoResubmit(x);
    assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.unconfirmed"));
    await ordinaryCheck(x, record);
    assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAvailable"));
    assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty); ordinaryNoResubmit(x);
    await ordinaryOpen(x, record); assert.equal(x.creates.records.length, 1);
  });
}

test("D ordinary-create completion cannot consume B in a reopened original presentation", options, async t => {
  const x = await projectContents(t), record = await x.start();
  await ordinaryClose(x, "Close"); await ordinaryReview(x); await x.type(RAW_B);
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.creating"));
  await x.creates.finish(record); await x.creates.verify();
  assert.equal(x.h.store.route.get(), x.route); assert.ok(x.dialog().port.open && x.owner.isConnected);
  assert.equal(x.title().port.value, RAW_B);
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalCreated"));
  assert.equal(Object.hasOwn(ordinaryOriginalButton(x, "open").attributes, "disabled"), true);
  assert.equal(x.creates.records.length, 1);
});

for (const mode of ["newer raw B", "raw-name ABA", "whitespace-only B"]) {
  test("D ordinary-create Check preserves " + mode + " until explicit Discard name permits Open", options, async t => {
    const x = await projectContents(t), record = await x.start({ lose: true });
    await x.creates.finish(record);
    if (mode === "raw-name ABA") { await x.type(RAW_B); await x.type(RAW_A); }
    else await x.type(mode === "whitespace-only B" ? "   " : RAW_B);
    const raw = x.title().port.value, uncertainty = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
    await ordinaryCheck(x, record);
    assert.equal(x.title().port.value, raw); assert.equal(x.h.store.route.get(), x.route);
    assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAvailable"));
    assert.equal(Object.hasOwn(ordinaryOriginalButton(x, "open").attributes, "disabled"), true);
    assert.equal(x.f.find("p", node => node.owner === x.owner && within(node, x.dialog())
      && node.text === x.f.i18n.t("projects.blank.openBlocked")).text, x.f.i18n.t("projects.blank.openBlocked"));
    ordinaryNoResubmit(x); assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty);
    await ordinaryDiscardName(x); await ordinaryOpen(x, record);
    assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty);
  });
}

test("D ordinary-create exact removed original stays unconfirmed and cannot authorize a replacement", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.type(RAW_B);
  const uncertainty = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
  const removal = await x.creates.removeOriginalForAvailability(record), read = await ordinaryCheck(x, record);
  assert.ok(read.body.events.some(event => event.eventId === removal.eventId && event.type === "DocumentRemoved"));
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAbsent"));
  assert.equal(x.title().port.value, RAW_B); assert.equal(x.h.store.route.get(), x.route);
  assert.equal(x.f.tree().visible("button").filter(node => node.owner === x.owner && ordinaryClass(node, "project-blank-original-open")).length, 0);
  ordinaryNoResubmit(x); assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty);
  assert.ok(x.h.store.sourceOwnershipActive(record.source)); await x.creates.verify();
});

test("D ordinary-create failed read preserves B and uncertainty, then a fresh exact read permits inspection only", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.type(RAW_B);
  const uncertainty = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
  await ordinaryCheck(x, record, { loseRead: true });
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.checkUnavailable"));
  assert.equal(x.title().port.value, RAW_B); assert.equal(x.h.store.route.get(), x.route);
  assert.equal(x.f.tree().visible("button").filter(node => node.owner === x.owner && ordinaryClass(node, "project-blank-original-open")).length, 0);
  ordinaryNoResubmit(x); assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty);
  await ordinaryCheck(x, record);
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAvailable"));
  assert.equal(x.title().port.value, RAW_B); assert.equal(Object.hasOwn(ordinaryOriginalButton(x, "open").attributes, "disabled"), true);
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty); ordinaryNoResubmit(x); await x.creates.verify();
});

test("D ordinary-create actual Source denial retires private recovery and a fresh Source cannot revive that owner", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.type(RAW_B);
  x.h.revoke();
  try {
    await x.f.act(ordinaryOriginalButton(x, "check"));
    assert.ok(x.h.retired()); assert.equal(x.h.store.sourceOwnershipActive(record.source), false);
    ordinaryNoOriginalUi(x);
  } finally { x.h.restore(); await x.h.store.refreshEvents({ fromStart: true }); await x.f.settle(); }
  assert.equal(x.h.store.sourceOwnershipActive(record.source), false);
  assert.ok(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership())); ordinaryNoOriginalUi(x);
  assert.equal(x.creates.records.length, 1); await x.creates.verify();
});

test("D ordinary-create principal ABA permanently retires the opening without granting the synthetic principal any read", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.type(RAW_B);
  const session = x.h.store.session.get(), beforeRequests = x.h.requests.length;
  // A negative local authority transition only. Restore before any await or
  // rendering/read for this synthetic principal; no capability is granted.
  x.h.store.session.set({ ...session, user: { ...session.user, userId: "negative-principal-retirement-only" } });
  x.h.store.notify(); assert.equal(x.h.store.sourceOwnershipActive(record.source), false);
  x.h.store.session.set(session); x.h.store.notify();
  assert.equal(x.h.requests.length, beforeRequests);
  await x.f.settle(); assert.ok(x.h.store.sourceOwnershipActive(record.source));
  ordinaryNoOriginalUi(x); assert.equal(x.creates.records.length, 1); await x.creates.verify();
});

test("D ordinary-create resource query departure and return cannot revive the original opening", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.type(RAW_B);
  await ordinaryHistory(x, "/studio/project?ordinary-retirement=1");
  assert.ok(x.h.store.sourceOwnershipActive(record.source)); ordinaryNoOriginalUi(x);
  await ordinaryHistory(x, x.route); ordinaryNoOriginalUi(x);
  assert.equal(x.creates.records.length, 1); await x.creates.verify();
});

test("D ordinary-create actual route unmount disconnects its recovery owner before re-entry", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.type(RAW_B);
  await ordinaryHistory(x, "/activity?document=" + encodeURIComponent(x.h.worker.documentId));
  assert.equal(x.owner.isConnected, false); assert.ok(own(x.f, "forma-activity").isConnected);
  assert.ok(x.h.store.sourceOwnershipActive(record.source));
  await ordinaryHistory(x, x.route); ordinaryNoOriginalUi(x);
  t.diagnostic(JSON.stringify({ sameProjectContentsInstanceAfterReentry: own(x.f, "forma-project-contents") === x.owner }));
  assert.equal(x.creates.records.length, 1); await x.creates.verify();
});

for (const previous of [false, true]) {
  test("D ordinary-create explicit capacity nondispatch preserves raw B" + (previous ? " and the earlier verified original" : " without inventing an unknown original"), options, async t => {
    const x = await projectContents(t); let original = null;
    if (previous) { original = await x.start(); await x.type(RAW_B); await x.creates.finish(original); }
    else await x.type(RAW_B);
    const capacity = await x.creates.prepareCapacity(), beforePosts = x.h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST").length;
    const button = ordinaryCurrentSubmit(x); assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    x.f.native.emit("pointerdown", button.port); await x.f.act(x.form(), "submit", { submitter: button.port });
    assert.equal(x.h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST").length, beforePosts,
      "the real native form hits the real full Store capacity before dispatch");
    assert.equal(x.title().port.value, RAW_B); assert.equal(x.h.store.route.get(), x.route);
    assert.deepEqual(x.h.store.eventWriteAcknowledgments(capacity.owner), capacity.receipts);
    assert.equal(Object.hasOwn(ordinaryCurrentSubmit(x).attributes, "disabled"), false,
      "explicit nondispatch leaves a deliberate future Create, not phantom Check recovery");
    assert.equal(x.f.tree().visible("button").filter(node => node.owner === x.owner && ordinaryClass(node, "project-blank-original-check")).length, 0);
    if (original) {
      assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalCreated"));
      assert.ok(ordinaryOriginalButton(x, "open").text.includes(RAW_A.trim()));
      assert.equal(Object.hasOwn(ordinaryOriginalButton(x, "open").attributes, "disabled"), true);
      await ordinaryDiscardName(x); await ordinaryOpen(x, original);
    } else assert.equal(x.f.tree().visible("p").filter(node => node.owner === x.owner && ordinaryClass(node, "project-blank-original-notice")).length, 0);
    assert.equal(x.creates.records.length, previous ? 1 : 0); await x.creates.verify();
  });
}

// Additive D destination-admission controls. The original22 helpers and cases
// remain intact. Actual Worker creates/ACKs still use observeCreates above.
const D_PC_ASSISTANT_RAW = "  Keep this separate Project Contents draft — 未送信\n  ";

function dPCSiblingReads(t, x) {
  const { h, f } = x, previousFetch = globalThis.fetch, previousTransport = h.transport;
  const pending = new Set(), errors = [], reads = [];
  const track = original => {
    pending.add(original);
    void original.then(() => pending.delete(original), error => { errors.push(error); pending.delete(original); });
    return original;
  };
  const transport = request => {
    const original = previousTransport(request);
    // The held original Create is joined by creates.finish, not a read barrier.
    return (request.init.method ?? "GET") === "GET" ? track(original) : original;
  };
  h.transport = transport;
  const bridge = (input, init = {}) => {
    const url = new URL(String(input), "https://fixture.invalid");
    if (url.origin !== "https://fixture.invalid" || url.pathname !== "/api/assistant") return previousFetch(input, init);
    assert.equal(init.method ?? "GET", "GET", "Only original read-only Assistant context is bridged");
    const row = { url: url.pathname + url.search, response: null, status: null, body: null }; reads.push(row);
    return track(h.fetch(row.url, init).then(async response => {
      row.response = response; row.status = response.status; row.body = await response.clone().json();
      assert.equal(response.bodyUsed, false, "Read observation returns the same unconsumed original Response");
      return response;
    }));
  };
  const empty = () => {
    assert.deepEqual(errors, []);
    for (const table of ["assistant_turns", "assistant_action_proposals", "assistant_action_commits", "assistant_specialist_tasks", "assistant_billing_reconciliations"])
      if (h.worker.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        assert.equal(h.worker.sqlite.prepare('SELECT COUNT(*) AS n FROM "' + table + '"').get().n, 0, table + " has no Assistant business row");
  };
  const settle = async () => {
    let queues;
    for (let step = 0; step < 4; step++) {
      while (pending.size) await Promise.allSettled([...pending]);
      for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
      await f.settle();
      while (pending.size) await Promise.allSettled([...pending]);
      await h.worker.drainBackground();
      queues = { reads: pending.size, frames: f.frames.size,
        storeFrames: [...h.timers.values()].filter(timer => timer.delay === 16).length, renderRequests: Number(f.requested) };
      if (Object.values(queues).every(value => value === 0)) break;
    }
    assert.deepEqual(queues, { reads: 0, frames: 0, storeFrames: 0, renderRequests: 0 }); empty();
  };
  const restore = () => {
    if (globalThis.fetch === bridge) globalThis.fetch = previousFetch;
    if (h.transport === transport) h.transport = previousTransport;
  };
  t.after(restore);
  return { reads, empty, restore, settle, async use(action) {
    assert.equal(globalThis.fetch, previousFetch); globalThis.fetch = bridge;
    let result, failure;
    try { result = await action(); } catch (error) { failure = error; }
    try { await settle(); } catch (error) { failure ??= error; }
    finally { if (globalThis.fetch === bridge) globalThis.fetch = previousFetch; }
    if (failure) throw failure;
    return result;
  } };
}

async function dPCSiblingClick(x, control, event = "click", extra = {}) {
  assert.ok(control.port.isConnected && x.f.renderer.nodes.includes(control.port));
  assert.equal(control.port.matches(":disabled"), false);
  x.f.native.emit("pointerdown", control.port); x.f.native.focus(control.port);
  await x.f.act(control, event, { button: 0, ...extra });
}
function dPCSiblingField(x, expected) {
  assert.ok(x.assistant.isConnected && x.panel.isConnected && x.panel.open);
  assert.equal(x.panel.conversationScope, x.assistantScope);
  const composers = x.f.components().filter(value => value.tag === "forma-ui-conversation-composer"
    && value.parentElement === x.panel && value.isConnected);
  assert.equal(composers.length, 1);
  const fields = x.f.tree().visible("textarea").filter(node => node.owner === composers[0]
    && ordinaryClass(node, "forma-assistant-input"));
  assert.equal(fields.length, 1); const field = fields[0];
  assert.ok(field.port.isConnected && x.f.renderer.nodes.includes(field.port));
  assert.equal(field.port.matches(":disabled"), false);
  assert.equal(typeof field.handlers.input, "function");
  assert.equal(field.port.value, expected); assert.equal(field.properties.value, expected);
  return field;
}
async function dPCSiblingType(x, before, value) {
  const field = dPCSiblingField(x, before), requests = x.h.requests.length;
  x.f.native.emit("keydown", field.port); x.f.native.focus(field.port); field.port.value = value;
  await x.f.act(field, "input"); await x.siblingReads.settle();
  dPCSiblingField(x, value); assert.equal(x.h.requests.length, requests);
}
async function dPCSiblingOpen(x, expected) {
  assert.ok(x.panel.isConnected && !x.panel.open);
  assert.equal(x.f.tree().visible("dialog").filter(node => node.port.open).length, 0,
    "No Assistant/background gesture is invoked through an open native modal");
  await dPCSiblingClick(x, x.f.find("button", node => node.owner === x.panel && ordinaryClass(node, "forma-assistant-launcher")));
  await x.siblingReads.settle(); dPCSiblingField(x, expected);
}
async function dPCSiblingCollapse(x, expected) {
  dPCSiblingField(x, expected);
  await dPCSiblingClick(x, x.f.find("button", node => node.owner === x.panel && ordinaryClass(node, "forma-assistant-close")));
  await x.siblingReads.settle(); assert.equal(x.panel.open, false);
  assert.equal(x.panel.conversationScope, x.assistantScope);
  assert.equal(x.assistant.captureCommandDeparture().blocked(), expected !== "");
}
async function dPCSiblingPage(t, raw) {
  const x = await projectContents(t), { h, f } = x;
  const siblingReads = dPCSiblingReads(t, x); x.siblingReads = siblingReads;
  // Existing two-window native event bridge; no application method is replaced.
  const dispatch = h.window.dispatchEvent;
  const routedDispatch = function (event) {
    const result = dispatch.call(this, event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) listener(event);
    return result;
  };
  h.window.dispatchEvent = routedDispatch;
  t.after(() => { if (h.window.dispatchEvent === routedDispatch) h.window.dispatchEvent = dispatch; });
  await siblingReads.use(async () => {
    // The original fixture opens a fresh name form. Deliberately close that
    // unsubmitted presentation before touching the floating Assistant.
    const modal = x.dialog();
    await dPCSiblingClick(x, f.find("button", node => node.owner === x.owner && within(node, modal)
      && ordinaryClass(node, "ghost") && node.text === f.i18n.t("action.close")));
    assert.equal(f.tree().visible("dialog").filter(node => node.port.open).length, 0);
    await registerCalmFullPageComponents(f, ["forma-creative-assistant"]);
    // Same established RAM-only no-provider configuration and genuine session
    // refresh as the current C Assistant fixture; no grant/projection setter.
    h.worker.env.OPENAI_API_KEY = "";
    await h.store.refreshSession(); await siblingReads.settle();
    const session = h.store.session.get();
    assert.equal(session.projectContext, undefined); assert.equal(session.assistant.enabled, true);
    assert.equal(session.policy.accepted, true); assert.equal(session.provider.configured, false);
    assert.ok(session.capabilities.includes("project.author"));
    assert.equal(h.store.route.get(), x.route); assert.equal(h.store.projection.get().projectId, h.worker.projectId);
    const assistants = f.components().filter(value => value.tag === "forma-creative-assistant" && value.store === h.store && value.isConnected);
    assert.equal(assistants.length, 1); x.assistant = assistants[0];
    const panels = f.components().filter(value => value.tag === "forma-assistant-panel" && value.parentElement === x.assistant && value.isConnected);
    assert.equal(panels.length, 1); x.panel = panels[0]; x.assistantScope = x.panel.conversationScope;
    assert.equal(JSON.parse(x.assistantScope)[9], x.route); assert.equal(x.panel.open, false);
    await dPCSiblingOpen(x, "");
    if (raw) await dPCSiblingType(x, "", raw);
    await dPCSiblingCollapse(x, raw);
    await dPCSiblingClick(x, f.find("button", node => node.owner === x.owner && node.text === f.i18n.system("New document")));
    await x.type(RAW_A); await siblingReads.settle();
    assert.ok(x.dialog().port.open); assert.equal(x.title().port.value, RAW_A);
    assert.equal(x.panel.conversationScope, x.assistantScope); assert.equal(x.panel.open, false);
    assert.equal(x.assistant.captureCommandDeparture().blocked(), raw !== "");
  });
  assert.ok(siblingReads.reads.length > 0);
  for (const read of siblingReads.reads) {
    assert.equal(read.status, 200); assert.ok(read.response instanceof Response);
    const url = new URL(read.url, "https://fixture.invalid"); assert.equal(url.searchParams.get("route"), x.route);
    assert.deepEqual(read.body.context.scope, { actorUserId: h.store.session.get().user.userId,
      organizationId: null, projectAccessId: null, projectId: h.worker.projectId, documentId: null });
  }
  await x.creates.verify(); return x;
}

for (const outcome of ["observed", "unconfirmed"]) for (const sibling of ["pristine", "raw"]) {
  test("D ordinary original " + outcome + " destination / " + sibling + " sibling Assistant", options, async t => {
    const raw = sibling === "raw" ? D_PC_ASSISTANT_RAW : "", x = await dPCSiblingPage(t, raw);
    const { h, f } = x, origin = { route: x.route, session: h.store.session.get(), source: h.store.captureSourceOwnership(),
      authorization: h.store.captureAuthorizationScope(), url: h.location.href };
    let record, uncertainty, recoveredOpenRequests = null;
    await x.siblingReads.use(async () => {
      const submit = x.submit(); f.native.emit("pointerdown", submit.port); f.native.focus(submit.port);
      record = await x.start({ lose: outcome === "unconfirmed" });
      assert.equal(record.originalResponse.bodyUsed, false); assert.equal(record.receipt.appended.length, 2);
      await x.creates.finish(record);
      if (outcome === "unconfirmed") {
        assert.equal(h.store.route.get(), origin.route); ordinaryNoResubmit(x);
        uncertainty = structuredClone(h.store.eventWriteAcknowledgments(record.owner));
        await ordinaryCheck(x, record);
        assert.equal(ordinaryOriginalNotice(x).text, f.i18n.t("sessions.blank.originalAvailable"));
        assert.deepEqual(h.store.eventWriteAcknowledgments(record.owner), uncertainty);
        await x.siblingReads.settle(); const requests = h.requests.length;
        await dPCSiblingClick(x, ordinaryOriginalButton(x, "open"));
        await x.siblingReads.settle(); recoveredOpenRequests = h.requests.length - requests;
      }
    });
    await x.creates.verify();
    const sameScope = x.panel.isConnected && x.panel.conversationScope === x.assistantScope;
    t.diagnostic("D_PC_SIBLING_DESTINATION " + JSON.stringify({ outcome, sibling, route: h.store.route.get(),
      exactOriginal: record.documentId, originalPublishedAndPruned: record.publishedAndPruned === true,
      originalUnconfirmed: record.acknowledgment?.outcome === "unconfirmed", currentContents: x.owner.isConnected,
      sameAssistantScope: sameScope, retainedAssistantBlocker: sameScope && x.panel.commandDepartureBlocked,
      originalAttempts: record.attempts.length }));
    assert.equal(record.attempts.length, 1); assert.equal(x.creates.records.length, 1);
    assert.ok(h.store.sourceOwnershipActive(origin.source) && h.store.authorizationScopeActive(origin.authorization));
    assert.equal(h.store.session.get(), origin.session); assert.deepEqual(financial(h.worker), x.money);
    if (raw) {
      assert.equal(h.store.route.get(), origin.route, "An original ACK/availability cannot bypass current sibling draft admission");
      assert.equal(h.location.href, origin.url); assert.ok(x.owner.isConnected && x.dialog().port.open);
      assert.equal(x.title().port.value, RAW_A); assert.equal(sameScope, true);
      assert.equal(x.assistant.captureCommandDeparture().blocked(), true);
      assert.equal(h.store.ui.toast, f.i18n.t("next.lifecycle.assistantOwnsWork"));
      if (outcome === "unconfirmed") assert.equal(recoveredOpenRequests, 0, "Refused recovered Open performs no destination request");
      assert.equal(ordinaryOriginalNotice(x).text, f.i18n.t(outcome === "observed" ? "sessions.blank.originalCreated" : "sessions.blank.originalAvailable"));
      const beforeResolution = h.requests.length;
      await x.siblingReads.use(async () => {
        await ordinaryClose(x, "Close");
        await dPCSiblingOpen(x, raw); await dPCSiblingType(x, raw, ""); await dPCSiblingCollapse(x, "");
        await ordinaryReview(x); assert.equal(x.title().port.value, "", "Explicit Close discarded only the ordinary live name");
        if (outcome === "unconfirmed") ordinaryNoResubmit(x);
        await dPCSiblingClick(x, ordinaryOriginalButton(x, "open"));
      });
      assert.equal(h.requests.slice(beforeResolution).filter(request => (request.init.method ?? "GET") !== "GET"
        && request.url === "/api/events").length, 0, "Resolution and fresh Open never replace or reopen the original write");
    }
    assert.equal(documentIdFromRoute(h.store.route.get()), record.documentId);
    assert.equal(h.store.projection.get().documentId, record.documentId); assert.equal(x.owner.isConnected, false);
    assert.ok(own(f, "forma-workspace").isConnected);
    if (outcome === "unconfirmed") assert.deepEqual(h.store.eventWriteAcknowledgments(record.owner), uncertainty,
      "Neither successful Check nor deliberate Open acknowledges the lost original batch");
    else assert.equal(record.publishedAndPruned, true, "Refused navigation does not hide or revoke a genuine original ACK");
    await x.creates.verify(); x.siblingReads.empty(); x.siblingReads.restore();
  });
}

// Reuse the original actual create/response/read/history owners. Lifetime copy
// describes local presentation retirement; it cannot cancel or acknowledge a write.
for (const outcome of ["observed", "unconfirmed"]) {
  test("D ordinary-create " + outcome + " explains recovery lifetime in the dialog and closed presentation", options, async t => {
    const x = await projectContents(t), lifetimes = [];
    const lifetimeText = "Leaving this page removes these local recovery controls. It does not cancel the original creation.";
    const expectedLine = { text: lifetimeText, role: null, live: null, children: [] };
    const captureLifetime = stage => {
      const tree = x.f.tree();
      const lines = tree.visible("p").filter(node => node.owner.tag === "forma-project-contents"
        && ordinaryClass(node, "project-blank-original-lifetime"));
      lifetimes.push({ stage, lines: lines.map(line => ({ text: line.text,
        role: line.attributes.role ?? null, live: line.attributes["aria-live"] ?? null,
        children: tree.nodes.filter(node => node !== line && within(node, line)).map(node => node.tag) })) });
    };
    captureLifetime("before-original");
    const record = await x.start({ lose: outcome === "unconfirmed" });
    await x.f.settle();
    assert.equal(record.receipt.appended.length, 2); assert.equal(record.originalResponse.bodyUsed, false);
    assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.creating"));
    captureLifetime("pending-dialog");
    await ordinaryClose(x, "Close"); captureLifetime("pending-closed");
    // Close discards the live name only. The genuine original Response still
    // owns its completion, and cannot reopen the dismissed presentation.
    await x.creates.finish(record); await x.f.settle();
    assert.equal(x.h.store.route.get(), x.route); assert.ok(x.owner.isConnected);
    assert.equal(x.f.tree().visible("dialog").filter(node => node.owner === x.owner).length, 0);
    captureLifetime("settled-closed");
    const observations = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
    if (outcome === "unconfirmed") {
      assert.equal(record.acknowledgment.outcome, "unconfirmed"); assert.equal(record.originalResponse.bodyUsed, false);
    } else {
      assert.equal(record.publishedAndPruned, true); assert.equal(record.originalResponse.bodyUsed, true);
    }
    await ordinaryReview(x);
    assert.equal(x.title().port.value, "");
    assert.equal(ordinaryOriginalNotice(x).text,
      x.f.i18n.t(outcome === "observed" ? "sessions.blank.originalCreated" : "sessions.blank.unconfirmed"));
    captureLifetime("settled-dialog");
    if (outcome === "unconfirmed") {
      ordinaryNoResubmit(x); await ordinaryCheck(x, record);
      assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAvailable"));
      assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), observations,
        "Actual availability GET does not acknowledge the lost original two-event batch");
      ordinaryNoResubmit(x); captureLifetime("available-dialog");
    }
    await ordinaryClose(x, "Close"); captureLifetime("before-departure");
    const history = await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId);
    const money = financial(x.h.worker), attempts = record.attempts.length;
    await ordinaryHistory(x, "/activity?document=" + encodeURIComponent(x.h.worker.documentId));
    assert.equal(x.owner.isConnected, false); ordinaryNoOriginalUi(x); captureLifetime("away");
    await ordinaryHistory(x, x.route); ordinaryNoOriginalUi(x); captureLifetime("returned");
    assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), observations,
      "Leaving and returning neither cancel nor acknowledge the original request");
    assert.equal(record.attempts.length, attempts); assert.equal(x.creates.records.length, 1);
    assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), history);
    assert.deepEqual(financial(x.h.worker), money); await x.creates.verify();
    t.diagnostic("D_PC_RECOVERY_LIFETIME " + JSON.stringify({ outcome, lifetimes,
      originalAttempts: record.attempts.length, originalPublishedAndPruned: record.publishedAndPruned === true,
      originalUnconfirmed: record.acknowledgment?.outcome === "unconfirmed", route: x.h.store.route.get() }));
    // Assert the new presentation obligation only after the original write,
    // deliberate Close/Review, genuine Check and native departure all finish.
    assert.deepEqual(lifetimes, [
      { stage: "before-original", lines: [] },
      ...["pending-dialog", "pending-closed", "settled-closed", "settled-dialog"].map(stage => ({ stage, lines: [expectedLine] })),
      ...(outcome === "unconfirmed" ? [{ stage: "available-dialog", lines: [expectedLine] }] : []),
      { stage: "before-departure", lines: [expectedLine] },
      { stage: "away", lines: [] }, { stage: "returned", lines: [] },
    ], "Explain view-local recovery only for an original, as one ordinary nonlive plaintext paragraph");
    assert.equal(x.f.i18n.t("projects.blank.recoveryLifetime"), lifetimeText);
  });
}

// Append-only presentation controls on the original real create/recovery host.
// Availability comes from the same Worker ACK/full GET, never injected UI state.
test("D ordinary-create primary action advances from Check to the available unconfirmed original", options, async t => {
  const x = await projectContents(t), record = await x.start({ lose: true });
  await x.creates.finish(record); await x.creates.verify();
  const uncertainty = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
  const history = [...x.history, ...record.receipt.appended];
  assert.equal(record.acknowledgment.outcome, "unconfirmed");
  assert.equal(record.originalResponse.bodyUsed, false);
  assert.equal(record.attempts.length, 1); assert.equal(x.creates.records.length, 1);
  assert.equal(x.h.store.route.get(), x.route); assert.equal(x.title().port.value, RAW_A);
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.unconfirmed"));
  ordinaryNoResubmit(x);
  const unknown = ordinaryOriginalButton(x, "check"), unknownDialog = x.dialog();
  assert.ok(unknown.port.isConnected && x.f.renderer.nodes.includes(unknown.port));
  assert.equal(Object.hasOwn(unknown.attributes, "disabled"), false);
  assert.deepEqual(x.f.tree().visible("button").filter(node => node.owner === x.owner && within(node, unknownDialog)
    && ordinaryClass(node, "primary")).map(node => node.port), [unknown.port], "Check is the one primary action while availability is unknown");
  assert.equal(x.f.tree().visible("button").filter(node => node.owner === x.owner
    && ordinaryClass(node, "project-blank-original-open")).length, 0);

  const read = await ordinaryCheck(x, record);
  for (const event of record.receipt.appended) assert.deepEqual(read.body.events.find(value => value.eventId === event.eventId), event);
  assert.equal(read.response.bodyUsed, true, "the original full GET was consumed by the actual Store");
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalAvailable"));
  assert.equal(x.h.store.route.get(), x.route); assert.equal(x.title().port.value, RAW_A);
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty, "a usable original does not acknowledge the lost batch");
  assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), history);
  assert.deepEqual(financial(x.h.worker), x.money); ordinaryNoResubmit(x);
  const found = ordinaryOriginalButton(x, "open"), recheck = ordinaryOriginalButton(x, "check"), foundDialog = x.dialog();
  assert.ok(found.port.isConnected && x.f.renderer.nodes.includes(found.port));
  assert.equal(Object.hasOwn(found.attributes, "disabled"), false);
  assert.equal(ordinaryClass(found, "primary"), true, "the exact available original becomes the next primary action");
  assert.equal(ordinaryClass(found, "secondary"), false);
  assert.equal(ordinaryClass(recheck, "secondary"), true); assert.equal(ordinaryClass(recheck, "primary"), false);
  assert.deepEqual(x.f.tree().visible("button").filter(node => node.owner === x.owner && within(node, foundDialog)
    && ordinaryClass(node, "primary")).map(node => node.port), [found.port]);

  // New local work still blocks Open; styling must not grant its authority.
  await x.type(RAW_B);
  assert.equal(Object.hasOwn(ordinaryOriginalButton(x, "open").attributes, "disabled"), true);
  assert.equal(ordinaryClass(ordinaryOriginalButton(x, "open"), "primary"), false);
  assert.equal(ordinaryClass(ordinaryOriginalButton(x, "check"), "primary"), true);
  assert.equal(x.title().port.value, RAW_B); ordinaryNoResubmit(x);
  await ordinaryDiscardName(x);
  assert.equal(ordinaryClass(ordinaryOriginalButton(x, "open"), "primary"), true);
  assert.equal(ordinaryClass(ordinaryOriginalButton(x, "check"), "secondary"), true);
  assert.equal(x.h.store.route.get(), x.route);
  assert.ok(x.h.store.sourceOwnershipActive(record.source) && x.h.store.authorizationScopeActive(record.authorization));
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty);
  assert.deepEqual(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST"),
    record.attempts.map(attempt => attempt.request), "Check and local name resolution did not submit another create");
  await ordinaryOpen(x, record);
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), uncertainty);
  assert.equal(record.originalResponse.bodyUsed, false);
  assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), history);
  assert.deepEqual(financial(x.h.worker), x.money); assert.equal(x.creates.records.length, 1);
});

test("D ordinary-create acknowledged original takes primary emphasis over disabled Create another", options, async t => {
  const x = await projectContents(t), record = await x.start();
  await ordinaryClose(x, "Close");
  await x.creates.finish(record); await x.creates.verify();
  assert.equal(record.publishedAndPruned, true); assert.equal(record.originalResponse.bodyUsed, true);
  assert.equal(record.attempts.length, 1); assert.equal(x.creates.records.length, 1);
  assert.equal(x.h.store.route.get(), x.route);
  const history = [...x.history, ...record.receipt.appended];
  const acknowledgments = structuredClone(x.h.store.eventWriteAcknowledgments(record.owner));
  assert.deepEqual(acknowledgments, [], "the real observed receipt was published and pruned, not replaced by a synthetic ledger");
  await ordinaryReview(x);
  assert.equal(x.title().port.value, "");
  assert.equal(ordinaryOriginalNotice(x).text, x.f.i18n.t("sessions.blank.originalCreated"));
  const open = ordinaryOriginalButton(x, "open"), another = ordinaryCurrentSubmit(x), modal = x.dialog();
  assert.ok(open.port.isConnected && x.f.renderer.nodes.includes(open.port));
  assert.equal(Object.hasOwn(open.attributes, "disabled"), false);
  assert.equal(another.text, x.f.i18n.t("sessions.blank.createAnother"));
  assert.equal(Object.hasOwn(another.attributes, "disabled"), true);
  assert.equal(ordinaryClass(open, "primary"), true, "Open the acknowledged original, not a disabled new creation, is primary");
  assert.equal(ordinaryClass(open, "secondary"), false);
  assert.equal(ordinaryClass(another, "secondary"), true); assert.equal(ordinaryClass(another, "primary"), false);
  assert.deepEqual(x.f.tree().visible("button").filter(node => node.owner === x.owner && within(node, modal)
    && ordinaryClass(node, "primary")).map(node => node.port), [open.port]);
  assert.equal(x.f.tree().visible("button").filter(node => node.owner === x.owner
    && ordinaryClass(node, "project-blank-original-check")).length, 0);

  // A deliberate newer name keeps the existing separate Create-another route.
  await x.type(RAW_B);
  assert.equal(Object.hasOwn(ordinaryOriginalButton(x, "open").attributes, "disabled"), true);
  assert.equal(ordinaryClass(ordinaryOriginalButton(x, "open"), "primary"), false);
  assert.equal(Object.hasOwn(ordinaryCurrentSubmit(x).attributes, "disabled"), false);
  assert.equal(ordinaryClass(ordinaryCurrentSubmit(x), "primary"), true);
  assert.equal(x.title().port.value, RAW_B);
  await ordinaryDiscardName(x);
  assert.equal(ordinaryClass(ordinaryOriginalButton(x, "open"), "primary"), true);
  assert.equal(ordinaryClass(ordinaryCurrentSubmit(x), "secondary"), true);
  assert.equal(Object.hasOwn(ordinaryCurrentSubmit(x).attributes, "disabled"), true);
  assert.equal(x.h.store.route.get(), x.route);
  assert.ok(x.h.store.sourceOwnershipActive(record.source) && x.h.store.authorizationScopeActive(record.authorization));
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), acknowledgments);
  assert.deepEqual(x.h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST"),
    record.attempts.map(attempt => attempt.request), "presentation and local name changes did not create another document");
  await ordinaryOpen(x, record);
  assert.deepEqual(x.h.store.eventWriteAcknowledgments(record.owner), acknowledgments);
  assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), history);
  assert.deepEqual(financial(x.h.worker), x.money); assert.equal(x.creates.records.length, 1);
});
