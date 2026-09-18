import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";

// Semantic-only reproduction of the accepted prepared3d seed's English desktop
// and Arabic RTL recipes (seed SHA-256:
// 296a3f257e308babc234650c5434fa877ddd9cb035e118650204369e1f6e2ad5).
// No supplier seed, lifecycle or RAM module is imported. This timestamp is a
// fixed test datum, not an observed persisted or native-browser timestamp.
const NOW = "2026-09-05T00:00:00.000Z";
const USER = "prepared3d-real-shell-user";
const PROJECT = "prepared3d-real-shell-project";
const DOCUMENT = "prepared3d-real-shell-document";
const BLOCK = "native3d-direction";
const OPERATION = "prepared3d-real-shell-owned-operation";
const ORIGINAL = 'Create one jade <mesh> with a "curved" handle & matte sides. 🧊';
const REVISED = 'Create one copper <mesh> with a "curved" handle & polished sides. 🧊';
const OVERFLOW = "Required geometry detail ".repeat(64);
const rows = [
  {
    locale: "en",
    label: "Owned model direction 🧊",
    originalPrompt: 'direction: Owned model direction 🧊; Create one jade <mesh> with a "curved" handle & matte sides. 🧊',
    revisedPrompt: 'direction: Owned model direction 🧊; Create one copper <mesh> with a "curved" handle & polished sides. 🧊',
  },
  {
    locale: "ar",
    label: "توجّه النموذج المملوك 🧊",
    originalPrompt: 'direction: توجّه النموذج المملوك 🧊; Create one jade <mesh> with a "curved" handle & matte sides. 🧊',
    revisedPrompt: 'direction: توجّه النموذج المملوك 🧊; Create one copper <mesh> with a "curved" handle & polished sides. 🧊',
  },
];
const requiredIssue = {
  code: "model3d_document_required_context_too_long",
  message: "The subject and required document context exceed Rodin’s 1,024-character limit. Shorten the identified blocks before generating.",
  blockIds: [BLOCK],
};
// The pure adapter returns machine codes and default English guidance. Arabic
// UI localization, painted text and browser interaction are separate evidence.
const suggestions = [
  { code: "model3d_suggest_subject", message: "A Subject block can clarify the object or character to model.", blockTypes: ["subject"] },
  { code: "model3d_suggest_material", message: "A Material block can clarify surfaces, textures, and finish.", blockTypes: ["material"] },
  { code: "model3d_suggest_scale", message: "A Scale block can clarify proportions and relative size.", blockTypes: ["scale"] },
  { code: "model3d_suggest_reference_view", message: "A reference image or saved 3D view can clarify the intended shape and appearance.", blockTypes: ["reference", "model3d"] },
];

function seedEvents(row) {
  const inputs = [
    { type: "ProjectCreated", payload: { project_id: PROJECT, name: "Prepared 3D Real Shell Project", state: "active" } },
    { type: "DocumentCreated", payload: { document_id: DOCUMENT, project_id: PROJECT,
      title: "Prepared 3D Direction Document", handle: "prepared3d-real-shell-document" } },
    { type: "BlockCreated", payload: { project_id: PROJECT, document_id: DOCUMENT,
      block_id: BLOCK, type: "direction", handle: "direction/prepared3d-real-shell",
      properties: { label: row.label, text: ORIGINAL, weight: 1 } } },
    { type: "DocumentOpened", payload: { document_id: DOCUMENT, previous_document_id: null, source_surface: "studio" } },
  ];
  return inputs.map((input, index) => ({
    eventId: "prepared3d-real-shell-event-" + (index + 1),
    streamId: "creative:" + USER, sequence: index + 1,
    occurredAt: NOW, recordedAt: NOW, actor: "user",
    clientId: "fixture:prepared3d-real-shell", correlationId: "prepared3d-real-shell-fixture",
    causationId: null, compensatesEventId: null, schemaVersion: 1,
    ...input,
  }));
}

function prescribedEdits(initial) {
  const created = initial[2];
  return [OVERFLOW, ORIGINAL, REVISED].map((text, index) => ({
    eventId: OPERATION + ":ram-direction:" + (index + 1),
    streamId: created.streamId, sequence: initial.length + index + 1,
    occurredAt: created.occurredAt, recordedAt: created.recordedAt, actor: created.actor,
    clientId: OPERATION + ":ram-direction", correlationId: OPERATION + ":ram-direction",
    causationId: null, compensatesEventId: null, schemaVersion: 1,
    type: "BlockPropertyEdited",
    payload: { project_id: PROJECT, document_id: DOCUMENT, block_id: BLOCK, property_path: "text", new_value: text },
  }));
}

function observation(store) {
  return structuredClone({
    events: store.events.get(), head: store.head.get(),
    projection: store.projection.get(),
    revision: store.documentGenerationRevision(),
    adaptation: store.documentModel3dAdaptation(DOCUMENT, 0),
    unrelated: {
      session: store.session.get(), route: store.route.get(), asOf: store.asOf.get(),
      content: store.content.get(), optimisticEvents: store.optimisticEvents.get(),
      jobs: store.documentJobs.get(), readiness: store.generationReadiness.get(),
      planningConsent: store.planningConsent.get(), busy: store.busy.get(),
      error: store.error.get(), appendFailure: store.appendFailure.get(),
    },
  });
}

function withoutDirectionChanges(projection) {
  const result = structuredClone(projection);
  for (const collection of [result.blocks, result.libraryBlocks]) {
    for (const block of collection) {
      if (block.id !== BLOCK) continue;
      delete block.properties.text;
      delete block.sourceEvents;
    }
  }
  return result;
}

for (const row of rows) test("prepared Document seed and three prescribed edits retain real Store semantics (" + row.locale + ")", { concurrency: false, timeout: 20_000 }, async t => {
  const initial = seedEvents(row), seedBefore = structuredClone(initial), edits = prescribedEdits(initial);
  const attempts = [], reads = [], failures = [];
  let host, unsubscribe, closeCount = 0;
  const deny = (port, url, method = "GET") => {
    attempts.push({ port, url: String(url), method });
    throw new Error("Prepared Document semantic test denied " + port + " operation");
  };
  t.mock.method(globalThis, "fetch", async (input, init = {}) => deny("global-fetch", input, init.method ?? "GET"));
  // The unchanged helper has a dormant queued-job Response.json shortcut
  // before its worker data port. Deny it before helper initialization too;
  // only the two explicit new Response data values below may be returned.
  t.mock.method(Response, "json", () => deny("unexpected-json-response", "Response.json"));
  // The existing host calls this data callback directly twice. These are local
  // JSON data reads, with no HTTP request, backend, readiness/admission result,
  // authenticated session claim or successful mutation response.
  const workerFixture = {
    owner: USER, documentId: DOCUMENT, projectId: PROJECT, events: initial, payload: {},
    requestId: "unused-prepared3d-semantic-request",
    async request(path, init) {
      const expected = reads.length === 0 ? "/api/session" : reads.length === 1 ? "/api/events?after=0&limit=2000&content=1" : null;
      if (path !== expected || init !== undefined) return deny("data-port", path, init?.method ?? "GET");
      reads.push(path);
      if (path === "/api/session") return new Response(JSON.stringify({
        user: { userId: USER, email: "prepared3d-real-shell@example.test", displayName: "prepared3d-real-shell", role: "creator" },
        impersonation: null,
      }), { headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ events: initial, head: 4, content: {} }), { headers: { "content-type": "application/json" } });
    },
    close() { closeCount++; },
  };
  try {
    // Passing a non-null data-only fixture bypasses the helper's default
    // createSceneCostFixture/database construction. No private Store gates are
    // exposed. Its existing transitive module imports remain part of the run.
    host = await createSceneStoreHost({ workerFixture, exposeSceneTestAccessors: false });
    host.intercept = request => deny("store-fetch", request.url, request.init.method ?? "GET");
    host.fetch = async (input, init = {}) => deny("host-fetch", input, init.method ?? "GET");
    assert.equal(host.worker, workerFixture);
    assert.equal("sceneGateForTest" in host.store, false);
    assert.equal("sceneEstimateForTest" in host.store, false);
    assert.deepEqual(reads, ["/api/session", "/api/events?after=0&limit=2000&content=1"]);
    assert.deepEqual(host.requests, []);
    assert.deepEqual([...host.storage], []);
    assert.equal(host.timers.size, 0);
    const methods = {
      adaptation: host.store.documentModel3dAdaptation,
      revision: host.store.documentGenerationRevision,
      render: host.store.renderDocumentArtifact,
      notify: host.store.notify,
    };
    const observed = [];
    unsubscribe = host.store.subscribe(() => observed.push(observation(host.store)));
    host.store.notify();
    for (const edit of edits) {
      const previous = host.store.events.get();
      host.store.events.set([...previous, structuredClone(edit)]);
      host.store.head.set(edit.sequence);
      host.store.notify();
    }
    assert.equal(observed.length, 4, "each synchronous notification exposes one complete semantic state");
    assert.deepEqual(observed.map(state => state.head), [4, 5, 6, 7]);
    const expectedPrompts = [row.originalPrompt, "direction: " + row.label + "; " + "Required geometry detail ".repeat(64).trim(), row.originalPrompt, row.revisedPrompt];
    const expectedTexts = [ORIGINAL, OVERFLOW, ORIGINAL, REVISED];
    const expectedValid = [true, false, true, true];
    const baseline = observed[0];
    const stableProjection = withoutDirectionChanges(baseline.projection);
    for (const [index, state] of observed.entries()) {
      assert.equal(state.projection.projectId, PROJECT);
      assert.equal(state.projection.documentId, DOCUMENT, "the seeded opened Document is the actual active projection");
      assert.equal(state.projection.documentTitle, "Prepared 3D Direction Document");
      assert.equal(state.projection.documents.length, 1);
      assert.deepEqual(state.projection.documents[0].sourceEvents, [initial[1].eventId, initial[3].eventId], "DocumentOpened retains its own source event");
      for (const blocks of [state.projection.blocks, state.projection.libraryBlocks]) {
        assert.deepEqual(blocks.map(block => block.id), [BLOCK]);
        assert.equal(blocks[0].documentId, DOCUMENT);
        assert.equal(blocks[0].type, "direction");
        assert.equal(blocks[0].removed, false);
        assert.equal(blocks[0].properties.label, row.label);
        assert.equal(blocks[0].properties.weight, 1);
        assert.equal(blocks[0].properties.text, expectedTexts[index]);
        assert.deepEqual(blocks[0].sourceEvents, [initial[2].eventId, ...edits.slice(0, index).map(edit => edit.eventId)]);
      }
      assert.deepEqual(withoutDirectionChanges(state.projection), stableProjection, "only Direction text and source-event lineage may change");
      assert.deepEqual(state.unrelated, baseline.unrelated);
      assert.deepEqual(state.unrelated.content, {});
      assert.deepEqual(state.unrelated.jobs, []);
      assert.deepEqual(state.unrelated.optimisticEvents, []);
      assert.deepEqual(state.unrelated.readiness, {});
      assert.equal(state.unrelated.planningConsent, null);
      assert.deepEqual(state.events, [...seedBefore, ...edits.slice(0, index)]);
      if (index > 0) {
        assert.deepEqual(state.events.slice(0, observed[index - 1].events.length), observed[index - 1].events, "all prior source events retain their complete envelopes");
        assert.notEqual(state.revision, observed[index - 1].revision);
      }
      assert.equal(typeof state.revision, "string");
      assert.ok(state.revision.length > 0);
      assert.equal(state.adaptation.prompt, expectedPrompts[index]);
      assert.equal(state.adaptation.promptCharacters, Array.from(expectedPrompts[index]).length);
      assert.equal(state.adaptation.valid, expectedValid[index]);
      assert.deepEqual(state.adaptation.issues, index === 1 ? [requiredIssue] : []);
      assert.deepEqual(state.adaptation.suggestions, suggestions);
      assert.deepEqual(state.adaptation.includedBlockIds, [BLOCK]);
      assert.deepEqual(state.adaptation.omittedBlockIds, []);
      assert.equal(typeof state.adaptation.adapterVersion, "string");
      assert.ok(state.adaptation.adapterVersion.length > 0);
      assert.equal(state.adaptation.adapterVersion, baseline.adaptation.adapterVersion);
    }
    assert.ok(observed[1].adaptation.promptCharacters > 1024, "the required overflow stays whole instead of being silently truncated");
    assert.equal(new Set(observed.map(state => state.revision)).size, 4, "restoring the original prompt does not rewind its source revision");
    assert.deepEqual(observed[2].adaptation, observed[0].adaptation, "restored text recovers the same usable adaptation despite its later source revision");
    assert.deepEqual(observation(host.store), observed[3], "repeat observation is stable and performs no mutation");
    assert.equal(host.store.documentModel3dAdaptation, methods.adaptation);
    assert.equal(host.store.documentGenerationRevision, methods.revision);
    assert.equal(host.store.renderDocumentArtifact, methods.render);
    assert.equal(host.store.notify, methods.notify);
  } catch (error) {
    failures.push(error);
  } finally {
    const retain = async operation => { try { await operation(); } catch (error) { failures.push(error); } };
    await retain(() => { if (host) assert.equal(host.timers.size, 0, "preparation schedules no timer before cleanup"); });
    await retain(() => unsubscribe?.());
    await retain(async () => { if (host) await host.close(); else workerFixture.close(); });
    await retain(() => assert.equal(closeCount, 1, "the data-only fixture is disposed exactly once"));
    await retain(() => assert.deepEqual(initial, seedBefore, "seed data is never rewritten"));
    await retain(() => assert.deepEqual(attempts, [], "all attempted application, persistence or provider operations fail the case"));
    if (host) {
      await retain(() => assert.deepEqual(host.requests, []));
      await retain(() => assert.deepEqual([...host.storage], [], "no local persistence is written"));
      await retain(() => assert.equal(host.timers.size, 0));
    }
  }
  // A body failure is retained alongside every independent denial or cleanup
  // failure. No retry, skip, native trusted-event, provider or custody result is
  // inferred from this synchronous event-folding/IR/adapter sequence.
  if (failures.length) throw new AggregateError(failures, "Prepared Document semantic regression failed (" + row.locale + ")");
});
