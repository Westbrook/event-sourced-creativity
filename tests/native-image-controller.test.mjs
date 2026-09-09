import assert from "node:assert/strict";
import test from "node:test";
import { NativeImageController } from "../src/components/native-image-controller.ts";
import { captureNativeImageHandle, captureNativeImageSetup } from "../src/model/native-image-generation.ts";

// New reconstruction controls, using actual generation capture/join functions.
// Ports below are deterministic local promises: no Store, browser, provider,
// network, database, deployment or generation execution is claimed.
const NOW = Date.parse("2099-09-09T12:00:00.000Z");
const AT = "2099-09-09T12:00:00.000Z", EXPIRES = "2099-09-09T12:05:00.000Z";
const UNCONFIRMED = { disposition: "dispatched-unconfirmed", handle: null };
const UNAVAILABLE = { status: "unavailable" }, SUPERSEDED = { status: "superseded" };
function evidence() {
  const setup = { documentId: "document-a", documentRevision: "rev-abc123", sourceSurface: "native-image",
    promptTechnique: "prose", kind: "generate", productionMode: "manual", sourcePreviewId: null,
    requestKey: "generate:rev-abc123:document" };
  const mediaUrl = "/api/media/u-757365722d31%2Fgenerated%2Fgeneration-a.png";
  const job = { ...setup, jobId: "job-a", requestedSequence: 42, status: "completed",
    canvasId: null, promptFanId: null, parentJobId: null, fanKind: null, members: [],
    result: { head: 49, appendedEventIds: ["event-a"], promoted: false },
    error: null, errorDetail: null, moderationPromptRef: null, dismissedAt: null,
    attemptCount: 1, requestedAt: AT, startedAt: AT, completedAt: AT, notifiedAt: null,
    leaseExpiresAt: null, updatedAt: AT, stage: "completed", progressMessage: "" };
  const event = { eventId: "event-a", streamId: "creative:user-1", sequence: 48,
    occurredAt: AT, recordedAt: AT, actor: "worker:generator", clientId: "server:document-job:generate",
    correlationId: "private-correlation-not-job-id", causationId: "compiled-original",
    compensatesEventId: null, schemaVersion: 1, type: "GenerationCompleted",
    payload: { document_id: setup.documentId, generation_id: "generation-a", object_id: "output-a", object_ids: ["output-a"],
      model_id: "gpt-image-2", provider: "openai", source_surface: "native-image", prompt_technique: "prose",
      media_url: mediaUrl, media_type: "image/png", source_content_hash: "a".repeat(64),
      image_width: 1536, image_height: 1024, quality: "high", purpose: "final", simulation: false,
      canvas_id: null, context_set_id: null, prompt_fan_id: null, promotion_id: null,
      reference_preview_event_id: null, promoted_from_generation_id: null, promoted_from_object_id: null,
      promotion_outcome: null, used_ideation_preview_pixels: false, content_expires_at: EXPIRES } };
  const output = { id: "output-a", documentId: setup.documentId, generationId: "generation-a", sourceEventId: event.eventId,
    canvasId: null, contextSetId: null, modelId: "gpt-image-2", provider: "openai", variant: 0,
    latency: 1, sequence: event.sequence, pinned: false, saved: false, discarded: false, library: false,
    contentRef: null, promptRef: null, promptTechnique: "prose", promptFanId: null,
    mediaUrl, mediaType: "image/png", width: 1536, height: 1024, plannerModelId: null,
    quality: "high", purpose: "final", sourceSurface: "native-image", promotionId: null,
    promotedFromId: null, promotedFromEventId: null, focalPoint: null, standalone: true, standaloneSequence: event.sequence };
  const compiled = { ...event, eventId: "compiled-original", sequence: 47, type: "ContextCompiled",
    payload: { document_id: setup.documentId, generation_id: "generation-a", compiled_snapshot: { document: { id: setup.documentId } } } };
  const handle = captureNativeImageHandle(job, setup);
  assert.ok(handle, "the independently authored valid fixture captures a real model identity");
  return { setup, job, event, output, compiled, handle, data: { inspection: { job }, events: [event], outputs: [output] } };
}

function gate() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
const ack = f => ({ disposition: "acknowledged", handle: f.handle, reused: false });
const data = f => ({ status: "data", data: f.data });
const observe = work => {
  assert.deepEqual(Object.keys(work), ["ui", "settled"]);
  assert.ok(work.ui instanceof Promise && work.settled instanceof Promise);
  return { original: work, ui: Promise.allSettled([work.ui]).then(x => x[0]),
    settled: Promise.allSettled([work.settled]).then(x => x[0]) };
};
async function pass(work) {
  const owned = observe(work);
  assert.deepEqual(await owned.ui, { status: "fulfilled", value: undefined });
  assert.deepEqual(await owned.settled, { status: "fulfilled", value: undefined });
  return owned;
}
function rig(t, options = {}) {
  t.mock.method(Date, "now", () => NOW);
  const f = evidence(), submissions = [], reads = [], changes = [], timers = new Map();
  let current = true, serial = 0;
  const timing = { setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); options.clearTimeout?.(id); } };
  const controller = new NativeImageController({
    submit(setup, controls) { submissions.push({ setup, controls }); return options.submit?.(setup, controls) ?? Promise.resolve(ack(f)); },
    read(handle, controls) { reads.push({ handle, controls }); return options.read?.(handle, controls) ?? Promise.resolve(data(f)); },
    changed(state) { changes.push(state); options.changed?.(state, controller); },
  }, timing);
  const open = (documentId = f.setup.documentId, guard = () => current) => controller.open({ documentId, current: guard });
  const opening = open();
  return { f, controller, opening, open, submissions, reads, changes, timers,
    withdraw() { current = false; }, restore() { current = true; },
    expire() { const [id, timer] = timers.entries().next().value; assert.equal(timer.delay, 10000); timers.delete(id); timer.callback(); } };
}

test("explicit Create ACK and Check join the exact original inline image; render/lookups do not dispatch", async t => {
  const r = rig(t), { controller: c, opening: o, f } = r;
  assert.equal(c.state.canCreate, true);
  await pass(c.check(o)); assert.equal(c.editTarget(o), null); assert.equal(r.reads.length, 0);
  const work = c.create(o, f.setup);
  assert.equal(r.submissions.length, 1);
  await pass(work); assert.equal(c.state.status, "submitted"); assert.equal(c.state.canCheck, true);
  assert.notEqual(r.submissions[0].setup, f.setup); assert.ok(Object.isFrozen(r.submissions[0].setup));
  await pass(c.check(o)); assert.equal(c.state.status, "matched");
  const state = c.state, target = c.editTarget(o);
  assert.deepEqual(target, { openingId: o.id, submissionId: 1, readId: 1, documentId: f.setup.documentId,
    jobId: f.job.jobId, outputId: f.output.id, sourceEventId: f.event.eventId,
    generationId: f.output.generationId, mediaUrl: f.output.mediaUrl });
  assert.ok(Object.isFrozen(target)); assert.equal(c.state, state);
  f.output.mediaUrl = "/api/media/foreign"; f.event.payload.image_width = 1;
  assert.deepEqual(c.editTarget(o), target, "late caller mutations cannot replace the captured join");
  assert.equal(r.submissions.length, 1); assert.equal(r.reads.length, 1); assert.equal(r.timers.size, 0);
  t.mock.method(Date, "now", () => Date.parse(EXPIRES));
  assert.equal(c.editTarget(o), null); assert.equal(c.state, state, "lookup never publishes");
});

test("invalid setup and foreign opening cannot invoke Create or adopt an unacknowledged job", async t => {
  for (const delta of [{ documentId: "other-document" }, { sourceSurface: "document" },
    { requestKey: "wrong" }, { documentRevision: "" }, { productionMode: "managed" }, { sourcePreviewId: "preview" }]) {
    await t.test(JSON.stringify(delta), async child => {
      const r = rig(child); await pass(r.controller.create(r.opening, { ...r.f.setup, ...delta }));
      await pass(r.controller.check(r.opening)); assert.equal(r.submissions.length, 0); assert.equal(r.reads.length, 0);
      assert.equal(r.controller.state.handle, null); assert.equal(r.controller.editTarget(r.opening), null);
    });
  }
});

test("unqualified ACK identity and replayed rows cannot become a result or authorize Check", async t => {
  for (const field of ["documentId", "documentRevision", "requestKey", "sourceSurface", "promptTechnique"]) {
    await t.test(field, async child => {
      const r = rig(child, { submit: () => Promise.resolve({ ...ack(evidence()), handle: { ...evidence().handle, [field]: "foreign" } }) });
      await pass(r.controller.create(r.opening, r.f.setup));
      assert.equal(r.controller.state.status, "uncertain"); assert.equal(r.controller.state.canCreate, false);
      await pass(r.controller.check(r.opening)); assert.equal(r.reads.length, 0);
      r.controller.retire(r.opening); const next = r.open();
      await pass(r.controller.create(next, r.f.setup)); assert.equal(r.submissions.length, 1);
    });
  }
});

test("only exact typed pre-dispatch refusals release the original attempt", async t => {
  for (const reason of ["budget-blocked", "user-canceled", "unavailable"]) {
    await t.test(reason, async child => {
      const r = rig(child, { submit: () => Promise.resolve({ disposition: "not-dispatched", handle: null, reason }) });
      await pass(r.controller.create(r.opening, r.f.setup)); assert.equal(r.controller.state.canCreate, true);
      await pass(r.controller.create(r.opening, r.f.setup)); assert.equal(r.submissions.length, 2);
    });
  }
  for (const outcome of [UNCONFIRMED, null, { disposition: "not-dispatched", handle: null, reason: "retry" }]) {
    await t.test(JSON.stringify(outcome), async child => {
      const r = rig(child, { submit: () => Promise.resolve(outcome) });
      await pass(r.controller.create(r.opening, r.f.setup)); assert.equal(r.controller.state.canCreate, false);
      r.controller.retire(r.opening); const reopened = r.open();
      await pass(r.controller.create(reopened, r.f.setup)); assert.equal(r.submissions.length, 1);
    });
  }
});

test("submit failures preserve falsy originals and an uncertain fence", async t => {
  for (const reason of [undefined, null, false, 0, "", new Error("submit failed")]) {
    await t.test(String(reason), async child => {
      const r = rig(child, { submit: () => Promise.reject(reason) });
      const work = observe(r.controller.create(r.opening, r.f.setup));
      assert.deepEqual(await work.ui, { status: "rejected", reason });
      assert.deepEqual(await work.settled, { status: "rejected", reason });
      assert.equal(r.controller.state.status, "uncertain");
      await pass(r.controller.create(r.opening, r.f.setup)); assert.equal(r.submissions.length, 1);
    });
  }
});

test("retirement releases UI but retains the exact submit slot and rejects late reappearing authority", async t => {
  const pending = gate(), r = rig(t, { submit: () => pending.promise }), c = r.controller;
  const work = observe(c.create(r.opening, r.f.setup)); c.retire(r.opening);
  assert.equal((await work.ui).status, "fulfilled"); assert.equal(c.submitPending, true);
  let settled = false; work.settled.then(() => { settled = true; });
  const next = r.open("document-b"); assert.equal(c.state.canCreate, false);
  await turn(); assert.equal(settled, false);
  pending.resolve(ack(r.f)); assert.equal((await work.settled).status, "fulfilled");
  assert.equal(c.state.documentId, "document-b"); assert.equal(c.state.handle, null);
  assert.equal(c.state.canCreate, true); assert.equal(c.submitPending, false);
  c.retire(next); r.open(); assert.equal(c.state.canCreate, false, "original acknowledged Document remains fenced");
});

test("ACK callback finishes current UI while physical run remains owned, including late failure", async t => {
  const run = gate(), failure = new Error("original run failed");
  const r = rig(t, { submit(_setup, controls) { controls.onAcknowledgment(ack(evidence())); return run.promise; } });
  const work = observe(r.controller.create(r.opening, r.f.setup));
  assert.equal((await work.ui).status, "fulfilled"); assert.equal(r.controller.submitPending, true);
  assert.equal(r.controller.state.status, "submitted");
  let settled = false; work.settled.then(() => { settled = true; }); await turn(); assert.equal(settled, false);
  await pass(r.controller.check(r.opening)); const exact = r.controller.editTarget(r.opening), state = r.controller.state;
  assert.ok(exact); run.reject(failure);
  assert.deepEqual(await work.settled, { status: "rejected", reason: failure });
  assert.equal(r.controller.state, state); assert.deepEqual(r.controller.editTarget(r.opening), exact);
  assert.equal(r.submissions.length, 1); assert.equal(r.reads.length, 1);
});

test("ACK callback publication failure does not invent UI success or erase later physical failure", async t => {
  const run = gate(), uiFailure = new Error("publication failed"), runFailure = new Error("run failed");
  let reported;
  const r = rig(t, {
    changed(state) { if (state.status === "submitted") throw uiFailure; },
    submit(_setup, controls) {
      try { controls.onAcknowledgment(ack(evidence())); } catch (error) { reported = error; }
      return run.promise.catch(error => { throw new AggregateError([reported, error], "both originals"); });
    },
  });
  const work = observe(r.controller.create(r.opening, r.f.setup));
  assert.deepEqual(await work.ui, { status: "rejected", reason: uiFailure });
  assert.equal(reported, uiFailure); assert.equal(r.controller.state.handle.jobId, r.f.job.jobId);
  assert.equal(r.controller.submitPending, true); run.reject(runFailure);
  const physical = await work.settled; assert.equal(physical.status, "rejected");
  const errors = physical.reason.errors.flatMap(value => value instanceof AggregateError ? value.errors : [value]);
  assert.ok(errors.includes(uiFailure) && errors.includes(runFailure));
  assert.equal(r.controller.state.canCreate, false);
});

test("callback and final settlement must preserve one original ACK", async t => {
  for (const mode of ["duplicate", "conflicting-final", "negative-final", "foreign-callback"]) {
    await t.test(mode, async child => {
      const r = rig(child, { submit(_setup, controls) {
        const original = ack(evidence());
        if (mode === "foreign-callback") controls.onAcknowledgment({ ...original, handle: { ...original.handle, documentId: "other" } });
        controls.onAcknowledgment(original);
        if (mode === "duplicate") controls.onAcknowledgment(original);
        return Promise.resolve(mode === "negative-final" ? { disposition: "not-dispatched", handle: null, reason: "unavailable" }
          : mode === "conflicting-final" ? { ...original, reused: true } : original);
      } });
      const work = observe(r.controller.create(r.opening, r.f.setup));
      assert.equal((await work.settled).status, "rejected");
      assert.equal((await work.ui).status, mode === "foreign-callback" ? "rejected" : "fulfilled");
      assert.equal(r.controller.state.canCreate, false); assert.equal(r.submissions.length, 1);
    });
  }
});

test("late ACK callback after source retirement is historical only", async t => {
  const pending = gate(); let controls;
  const r = rig(t, { submit(_setup, value) { controls = value; return pending.promise; } });
  const work = observe(r.controller.create(r.opening, r.f.setup));
  r.withdraw(); assert.equal(controls.current(), false); r.restore();
  assert.equal(controls.current(), false, "same opening cannot reappear");
  const next = r.open("document-b"); controls.onAcknowledgment(ack(r.f));
  assert.equal((await work.ui).status, "fulfilled"); assert.equal(r.controller.state.handle, null);
  pending.resolve(ack(r.f)); assert.equal((await work.settled).status, "fulfilled");
  assert.equal(r.controller.state.openingId, next.id); assert.equal(r.controller.state.canCreate, true);
});

test("callback invoked after original settlement cannot claim a retired operation's new job", async t => {
  let originalControls;
  const r = rig(t, { submit(_setup, controls) {
    originalControls = controls;
    return Promise.resolve({ disposition: "not-dispatched", handle: null, reason: "unavailable" });
  } });
  await pass(r.controller.create(r.opening, r.f.setup)); const state = r.controller.state;
  assert.throws(() => originalControls.onAcknowledgment(ack(r.f)), /settled_native_image_acknowledgment/);
  assert.equal(r.controller.state, state); assert.equal(r.controller.state.handle, null);
  assert.equal(r.controller.state.canCreate, true); assert.equal(r.submissions.length, 1);
});

test("pending may be explicitly checked again; a terminal result cannot restart generation", async t => {
  for (const status of ["queued", "running", "failed", "canceled"]) {
    await t.test(status, async child => {
      const f = evidence(); f.job.status = status; f.job.stage = status;
      f.job.result = null; f.job.completedAt = null; f.data.events = []; f.data.outputs = [];
      const r = rig(child, { read: () => Promise.resolve(data(f)) });
      await pass(r.controller.create(r.opening, r.f.setup)); await pass(r.controller.check(r.opening));
      const pending = status === "queued" || status === "running";
      assert.equal(r.controller.state.status, pending ? "pending" : "terminal");
      assert.equal(r.controller.state.canCheck, pending); assert.equal(r.controller.state.canCreate, false);
      await pass(r.controller.create(r.opening, r.f.setup)); assert.equal(r.submissions.length, 1);
      await pass(r.controller.check(r.opening)); assert.equal(r.reads.length, pending ? 2 : 1);
    });
  }
});

test("deadline ends UI only; ignored-abort read stays occupied until original late rejection", async t => {
  const pending = gate(), r = rig(t, { read: () => pending.promise });
  await pass(r.controller.create(r.opening, r.f.setup));
  const work = observe(r.controller.check(r.opening));
  assert.equal(r.reads.length, 1); r.expire();
  assert.equal((await work.ui).status, "fulfilled"); assert.equal(r.controller.readPending, true);
  assert.equal(r.reads[0].controls.signal.aborted, true); assert.equal(r.controller.state.canCheck, false);
  await pass(r.controller.check(r.opening)); assert.equal(r.reads.length, 1);
  let settled = false; work.settled.then(() => { settled = true; }); await turn(); assert.equal(settled, false);
  pending.reject(undefined); assert.deepEqual(await work.settled, { status: "rejected", reason: undefined });
  assert.equal(r.controller.readPending, false); assert.equal(r.controller.state.canCheck, true);
  assert.equal(r.timers.size, 0); assert.equal(r.reads.length, 1);
});

test("retired read settlement refreshes only current eligibility and never paints the old image", async t => {
  const pending = gate(); let first = true;
  const r = rig(t, { read: () => first ? (first = false, pending.promise) : Promise.resolve(data(evidence())) });
  await pass(r.controller.create(r.opening, r.f.setup));
  const work = observe(r.controller.check(r.opening)); r.controller.retire(r.opening);
  const next = r.open("document-b"), state = r.controller.state;
  assert.equal(state.canCreate, true); assert.equal(r.controller.readPending, true);
  assert.equal((await work.ui).status, "fulfilled"); pending.resolve(data(r.f));
  assert.equal((await work.settled).status, "fulfilled"); assert.equal(r.controller.state.openingId, next.id);
  assert.equal(r.controller.state.image, null); assert.equal(r.controller.editTarget(next), null);
});

test("actual generation join rejects foreign, stale, discarded, alias and expired read evidence", async t => {
  const mutations = {
    "foreign job": f => { f.job.jobId = "other-job"; },
    "foreign document": f => { f.event.payload.document_id = "other-document"; },
    "foreign owner": f => { f.event.streamId = "creative:other-owner"; },
    "stale request": f => { f.job.requestKey = "generate:other:document"; },
    "discarded output": f => { f.output.discarded = true; },
    "duplicate event": f => { f.data.events.push(structuredClone(f.event)); },
    "duplicate output": f => { f.data.outputs.push(structuredClone(f.output)); },
    "expired content": f => { f.event.payload.content_expires_at = "2000-01-01T00:00:00.000Z"; },
  };
  for (const [name, change] of Object.entries(mutations)) {
    await t.test(name, async child => {
      const f = evidence(); change(f);
      const r = rig(child, { read: () => Promise.resolve(data(f)) });
      await pass(r.controller.create(r.opening, r.f.setup)); await pass(r.controller.check(r.opening));
      assert.equal(r.controller.state.image, null); assert.equal(r.controller.editTarget(r.opening), null);
      assert.equal(r.submissions.length, 1); assert.equal(r.reads.length, 1);
    });
  }
});

test("successful result cannot lend its job ID to a later explicit attempt", async t => {
  const r = rig(t); await pass(r.controller.create(r.opening, r.f.setup)); await pass(r.controller.check(r.opening));
  r.controller.retire(r.opening); const next = r.open();
  assert.equal(r.controller.state.canCreate, true);
  const work = observe(r.controller.create(next, r.f.setup));
  assert.equal((await work.ui).status, "rejected"); assert.equal((await work.settled).status, "rejected");
  assert.equal(r.controller.state.image, null); assert.equal(r.controller.state.handle, null);
  await pass(r.controller.check(next)); assert.equal(r.reads.length, 1); assert.equal(r.submissions.length, 2);
});

test("reentrant publication cannot dispatch the abandoned opening or retire its replacement", async t => {
  let replacement = null;
  const r = rig(t, { changed(state, controller) {
    if (state.status === "submitting") replacement = controller.open({ documentId: "document-b", current: () => true });
  } });
  await pass(r.controller.create(r.opening, r.f.setup));
  assert.ok(replacement); assert.equal(r.submissions.length, 0); assert.equal(r.controller.state.openingId, replacement.id);
  r.controller.retire(r.opening); assert.equal(r.controller.state.openingId, replacement.id);
  assert.equal(r.controller.state.canCreate, true);
});

test("source withdrawal after match is latched, clears Edit authority and never dispatches replacement work", async t => {
  const r = rig(t); await pass(r.controller.create(r.opening, r.f.setup)); await pass(r.controller.check(r.opening));
  assert.ok(r.controller.editTarget(r.opening)); const state = r.controller.state;
  r.withdraw(); assert.equal(r.controller.editTarget(r.opening), null); r.restore();
  assert.equal(r.controller.editTarget(r.opening), null); assert.equal(r.controller.state, state);
  await pass(r.controller.check(r.opening)); assert.equal(r.controller.state.status, "retired");
  assert.equal(r.submissions.length, 1); assert.equal(r.reads.length, 1);
});

test("read cleanup failures remain in retirement and both actual operation channels", async t => {
  const pending = gate(), failure = new Error("timer cleanup failed");
  const r = rig(t, { read: () => pending.promise, clearTimeout() { throw failure; } });
  await pass(r.controller.create(r.opening, r.f.setup)); const work = observe(r.controller.check(r.opening));
  assert.throws(() => r.controller.retire(r.opening), error => error === failure);
  assert.deepEqual(await work.ui, { status: "rejected", reason: failure });
  assert.equal(r.reads[0].controls.signal.aborted, true); pending.resolve(data(r.f));
  assert.deepEqual(await work.settled, { status: "rejected", reason: failure });
  assert.equal(r.controller.state.status, "retired");
});


test("Create retirement signals its original queue wait without inventing dispatched run settlement", async t => {
  const run = gate(); let originalSignal;
  const r = rig(t, { submit(_setup, controls) {
    originalSignal = controls.signal;
    controls.onAcknowledgment(ack(evidence()));
    return run.promise;
  } });
  const work = observe(r.controller.create(r.opening, r.f.setup));
  assert.ok(originalSignal instanceof AbortSignal); assert.equal(originalSignal.aborted, false);
  assert.equal((await work.ui).status, "fulfilled");
  r.controller.retire(r.opening); assert.equal(originalSignal.aborted, true);
  let settled = false; work.settled.then(() => { settled = true; }); await turn();
  assert.equal(settled, false); assert.equal(r.controller.submitPending, true);
  run.resolve(ack(r.f)); assert.equal((await work.settled).status, "fulfilled");
  assert.equal(r.controller.submitPending, false); assert.equal(r.submissions.length, 1);
});


test("UI-only Close wakes an original pre-run wait without a Store notification", async t => {
  let aborted = 0, notifications = 0, runInvocations = 0;
  const r = rig(t, { submit(_setup, controls) {
    return new Promise(resolve => {
      controls.signal.addEventListener("abort", () => { aborted++; resolve(UNCONFIRMED); }, { once: true });
      // This models the invocation-local queue wait, not a background feed.
      // There is deliberately no queue or Store notification in this witness.
    });
  } });
  const work = observe(r.controller.create(r.opening, r.f.setup));
  r.controller.retire(r.opening);
  assert.equal(aborted, 1); assert.equal(notifications, 0); assert.equal(runInvocations, 0);
  assert.equal((await work.ui).status, "fulfilled"); assert.equal((await work.settled).status, "fulfilled");
  assert.equal(r.controller.submitPending, false); assert.equal(r.controller.state.status, "retired");
  const next = r.open(); await pass(r.controller.create(next, r.f.setup));
  assert.equal(r.submissions.length, 1, "ending a wait is not evidence of safe replacement Create");
});
