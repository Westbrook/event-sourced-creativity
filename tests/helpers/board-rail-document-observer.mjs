import assert from "node:assert/strict";
import { readWorkspaceEvents } from "../../worker/runtime.ts";
import { financial } from "./event-source-retirement-fixture.mjs";
import { isOutputFixtureReadOnlyResume } from "./output-reachability-fixture.mjs";

// Explicit test-only opt-in for ONE original ProjectRail DocumentOpened. This
// follows c19ObserveNavigationReceipts' original-response/history proof. It is
// not an application receipt service, generic POST allowance or request replay.
// Observation delays the original response; a concurrent original Resume starts
// its unchanged zero-write proof only after this exact append has settled.
export function observeBoardRailDocument(h, resume, documentId, { sourceSurface = "project-rail" } = {}) {
  assert.equal(typeof documentId, "string"); assert.ok(documentId);
  assert.ok(["project-rail", "studio-alternative"].includes(sourceSurface), "Only the two explicitly covered native callers");
  const prior = h.transport; assert.equal(typeof prior, "function");
  const proofs = new WeakMap(); let armed = null, record = null, inFlight = null;
  const history = () => readWorkspaceEvents(h.worker.env, h.worker.streamId);
  const isOriginal = request => {
    const proof = proofs.get(request);
    return Boolean(proof && request.url === "/api/events" && request.init === proof.init
      && request.init.method === "POST" && request.init.body === proof.bytes
      && JSON.stringify(request.body) === proof.bytes);
  };
  const observe = async (request, current) => {
    const init = request.init, bytes = init.body, envelope = JSON.parse(bytes);
    assert.deepEqual(Object.keys(envelope).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
    assert.equal(envelope.action, "append"); assert.equal(envelope.clientId, "web:lit");
    assert.deepEqual(envelope.event, current.event); assert.deepEqual(envelope.events, [current.event]);
    assert.ok(h.store.authorizationScopeActive(current.authority) && h.store.sourceOwnershipActive(current.source));
    assert.equal(h.store.projection.get().projectId, current.projectId);
    const before = await history(), fiscal = financial(h.worker);
    assert.deepEqual(before, current.history, "No event may interleave between the actual Rail gesture and its single original append");
    assert.equal(envelope.expectedSequence, before.at(-1)?.sequence);
    const response = await prior(request);
    assert.equal(response.status, 200, "Only the original real Worker acknowledgment can certify this navigation");
    const receipt = await response.clone().json(); assert.equal(response.bodyUsed, false);
    assert.deepEqual(Object.keys(receipt).sort(), ["appended", "head", "rejected"]);
    assert.deepEqual(receipt.rejected, []); assert.equal(receipt.appended.length, 1);
    const event = receipt.appended[0];
    assert.equal(event.type, "DocumentOpened"); assert.deepEqual(event.payload, current.event.payload);
    assert.equal(event.streamId, h.worker.streamId); assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit");
    assert.ok(typeof event.eventId === "string" && event.eventId.length);
    assert.equal(event.sequence, envelope.expectedSequence + 1); assert.equal(receipt.head, event.sequence);
    await h.worker.drainBackground();
    assert.deepEqual(await history(), [...before, event], "The actual canonical history gains exactly this returned original event");
    assert.deepEqual(financial(h.worker), fiscal, "Every original job/reservation/provider/counter row is unchanged");
    assert.equal(request.init, init); assert.equal(request.init.body, bytes); assert.equal(JSON.stringify(request.body), bytes);
    assert.ok(h.store.authorizationScopeActive(current.authority) && h.store.sourceOwnershipActive(current.source));
    proofs.set(request, { init, bytes }); current.returned = event;
    current.receipt = { eventId: event.eventId, sequence: event.sequence, head: receipt.head, status: response.status };
    assert.equal(isOriginal({ ...request }), false, "A cloned row cannot inherit the original request proof");
    return response;
  };
  const transport = request => {
    if (request.url === "/api/events" && request.init.method === "POST") {
      assert.ok(armed && !record && !inFlight, "Only one deliberately armed original Rail DocumentOpened is permitted");
      record = armed; armed = null; record.request = request; inFlight = record;
      const pending = observe(request, record); record.pending = pending;
      pending.then(() => { if (inFlight === record) inFlight = null; }, () => { if (inFlight === record) inFlight = null; });
      return pending;
    }
    const current = inFlight;
    if (current && isOutputFixtureReadOnlyResume(request, { projectId: current.projectId, documentId })) {
      const init = request.init, bytes = init.body; current.queuedResumes++;
      return current.pending.then(() => {
        assert.equal(request.init, init); assert.equal(request.init.body, bytes);
        assert.equal(h.store.projection.get().projectId, current.projectId);
        assert.equal(h.store.projection.get().documentId, documentId);
        return prior(request); // The existing Resume observer must prove this original response itself.
      });
    }
    return prior(request);
  };
  h.transport = transport;
  return {
    async arm() {
      assert.equal(armed, null); assert.equal(record, null); assert.equal(inFlight, null);
      await resume.settleOriginalRequests(); assert.equal(resume.pendingOriginalCount(), 0);
      const projection = h.store.projection.get(), authority = h.store.captureAuthorizationScope(), source = h.store.captureSourceOwnership();
      assert.ok(authority && h.store.authorizationScopeActive(authority) && source && h.store.sourceOwnershipActive(source));
      assert.equal(h.store.session.get()?.projectContext == null, true);
      assert.notEqual(projection.documentId, documentId);
      assert.ok(projection.documents.some(document => document.id === documentId && document.projectId === projection.projectId));
      armed = { projectId: projection.projectId, authority, source, history: await history(), request: null, pending: null,
        receipt: null, returned: null, queuedResumes: 0, event: { type: "DocumentOpened", payload: {
          document_id: documentId, previous_document_id: projection.documentId, source_surface: sourceSurface,
        } } };
    },
    isOriginal,
    acknowledged() { return Boolean(record?.receipt && isOriginal(record.request)); },
    async verify() {
      assert.equal(armed, null, "The armed current Rail control must dispatch its original request");
      assert.ok(record?.pending, "The actual Rail gesture must reach the real append path");
      await record.pending; assert.ok(record.receipt && isOriginal(record.request)); assert.equal(inFlight, null);
      assert.deepEqual(h.requests.filter(request => request.url === "/api/events" && request.init.method === "POST"), [record.request]);
      assert.deepEqual(await history(), [...record.history, record.returned], "No replacement navigation, source mutation or compensating event is hidden");
      return { documentId, previousDocumentId: record.event.payload.previous_document_id, sourceSurface,
        ...record.receipt, queuedOriginalResumes: record.queuedResumes };
    },
    restore() { if (h.transport === transport) h.transport = prior; },
  };
}
