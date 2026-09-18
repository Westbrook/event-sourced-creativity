import assert from "node:assert/strict";
import test from "node:test";
import { NativeShortStoryController } from "../src/components/native-short-story-controller.ts";

// SOURCE_UNRUN. These deterministic controller witnesses do not exercise the
// Store, native dispatch, custody, browser layout/focus, networking or spending.
// Host close/hide/replacement events are represented by the required explicit
// retire operation; no claim is made that shared host bindings are integrated.
const NOW = Date.parse("2030-01-01T00:00:00.000Z");
const ORIGIN = "https://forma.test";
const settings = () => ({ audience: " General readers ", tone: " Warm ", locale: "en-US" });
const handle = (documentId = "document-one", jobId = "job-one") => ({ documentId, jobId });
const acknowledged = (documentId = "document-one", jobId = "job-one", reused = false) => ({
  disposition: "acknowledged", handle: handle(documentId, jobId), reused,
});
const notDispatched = (reason = "unavailable") => ({ disposition: "not-dispatched", handle: null, reason });
const unconfirmed = () => ({ disposition: "dispatched-unconfirmed", handle: null });
const completion = (selectedHandle = handle(), expiresAt = "2030-01-02T00:00:00.000Z") => ({
  schemaVersion: 1, kind: "native-short-story-completion", handle: { ...selectedHandle },
  selection: { documentId: selectedHandle.documentId, artifactId: "artifact-one", revision: 0, contentSha256: "a".repeat(64) },
  expiresAt,
});
const expectedRoute = "/make/short-story?document=document-one&artifact=artifact-one&revision=0&sha256=" + "a".repeat(64);
const turn = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject, settled = false;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {
    promise,
    get settled() { return settled; },
    resolve(value) { if (!settled) { settled = true; resolve(value); } },
    reject(error) { if (!settled) { settled = true; reject(error); } },
  };
}

function manualClock() {
  let now = NOW, serial = 0;
  const pending = new Map(), scheduled = [], cleared = [];
  return {
    now: () => now,
    setTimeout(callback, milliseconds) {
      const id = ++serial;
      scheduled.push({ id, milliseconds });
      pending.set(id, { callback, at: now + milliseconds });
      return id;
    },
    clearTimeout(id) { cleared.push(id); pending.delete(id); },
    advance(milliseconds) {
      assert.ok(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
      now += milliseconds;
      // One snapshot avoids implicitly dispatching a newly scheduled timeout.
      for (const [id, timer] of [...pending].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])) {
        if (timer.at <= now && pending.delete(id)) timer.callback();
      }
    },
    pending, scheduled, cleared,
  };
}

function fixture(t, options = {}) {
  const clock = manualClock(), submissions = [], reads = [], requests = [], changes = [], operations = [], openings = [];
  t.mock.method(Date, "now", clock.now);
  const ports = {
    origin: ORIGIN,
    submit(input, controls) {
      const gate = deferred(), call = { input, controls, gate };
      submissions.push(call);
      if (options.submit) return options.submit(call);
      return gate.promise;
    },
    request(path, init) {
      const gate = deferred(); requests.push({ path, init, gate }); return gate.promise;
    },
    changed(state) { changes.push(state); options.changed?.(state); },
  };
  if (!options.defaultReader) ports.readCompletion = (input, controls) => {
    const gate = deferred(); reads.push({ input, controls, gate }); return gate.promise;
  };
  const controller = new NativeShortStoryController(ports, {
    now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout,
  });
  function observe(promise) {
    const observation = { promise, settled: false, rejected: false, value: undefined };
    // Observe only the public operation. In particular, never install a test
    // catch on an ignored-abort read port; that would hide a controller leak.
    promise.then(value => { observation.settled = true; observation.value = value; }, error => {
      observation.settled = true; observation.rejected = true; observation.value = error;
    });
    operations.push(observation); return observation;
  }
  const rig = {
    controller, clock, submissions, reads, requests, changes,
    openInput(input) { const opening = controller.open(input); openings.push(opening); return opening; },
    open(documentId = "document-one", current = () => true) {
      const opening = controller.open({ documentId, current }); openings.push(opening); return opening;
    },
    create(opening, input = settings()) { return observe(controller.create(opening, input)); },
    check(opening) { return observe(controller.check(opening)); },
  };
  t.after(async () => {
    for (const opening of [...openings].reverse()) controller.retire(opening);
    for (const call of submissions) call.gate.resolve(notDispatched());
    for (const call of reads) call.gate.resolve(null);
    for (const call of requests) call.gate.reject(new Error("fixture_request_cleanup"));
    await Promise.allSettled(operations.map(operation => operation.promise));
    await turn();
    assert.equal(clock.pending.size, 0, "test cleanup must leave no controller UI timer");
  });
  return rig;
}

async function submitAcknowledged(rig, opening, value = acknowledged()) {
  const operation = rig.create(opening);
  await turn();
  const call = rig.submissions.at(-1);
  assert.ok(call);
  call.gate.resolve(value);
  await operation.promise;
  assert.equal(rig.controller.state.status, "submitted");
  return operation;
}

async function immediate(operation) {
  await turn();
  assert.equal(operation.settled, true, "a refused/local-only operation must not wait on a new port");
  assert.equal(operation.rejected, false);
  await operation.promise;
}

function assertOpaqueFence(state) {
  assert.equal(state.status, "uncertain");
  assert.equal(state.handle, null);
  assert.equal(state.completion, null);
  assert.equal(state.reason, null);
  assert.equal(state.reused, null);
}

test("native story controller freezes the opening and submitted setup before awaiting, and double activation dispatches once", async t => {
  const rig = fixture(t), openingInput = { documentId: "document-one", current: () => true };
  const opening = rig.openInput(openingInput), input = settings();
  assert.equal(Object.isFrozen(opening), true);
  openingInput.documentId = "document-later";
  openingInput.current = () => false;
  const first = rig.create(opening, input), second = rig.create(opening, input);
  input.audience = "Later audience"; input.tone = "Later tone"; input.locale = "ar";
  await turn();
  assert.equal(rig.submissions.length, 1);
  assert.deepEqual(rig.submissions[0].input, { documentId: "document-one", audience: "General readers", tone: "Warm", locale: "en-US" });
  assert.equal(Object.isFrozen(rig.submissions[0].input), true);
  assert.equal(rig.submissions[0].controls.current(), true);
  assert.equal(rig.controller.state.status, "submitting");
  const response = acknowledged();
  rig.submissions[0].gate.resolve(response);
  await Promise.all([first.promise, second.promise]);
  response.handle.jobId = "later-job";
  assert.equal(rig.controller.state.status, "submitted", "an acknowledgment is not inferred queued or complete");
  assert.deepEqual(rig.controller.state.handle, handle());
  assert.equal(Object.isFrozen(rig.controller.state), true);
  assert.equal(Object.isFrozen(rig.controller.state.handle), true);
  assert.equal(rig.controller.state.completion, null);
  assert.equal(rig.controller.openStory(opening), null);
  assert.equal(rig.reads.length, 0);
  assert.equal(rig.clock.pending.size, 0);
  rig.controller.retire(opening);
});

test("native story controller preserves every typed submission outcome without inferred dispatch or automatic reads", async t => {
  const rows = [
    ["fresh acknowledgment", acknowledged(), "submitted", null, false],
    ["reused acknowledgment", acknowledged("document-one", "job-one", true), "submitted", null, true],
    ["budget blocked", notDispatched("budget-blocked"), "not-dispatched", "budget-blocked", null],
    ["user canceled", notDispatched("user-canceled"), "not-dispatched", "user-canceled", null],
    ["unavailable before dispatch", notDispatched(), "not-dispatched", "unavailable", null],
    ["dispatched without acknowledgment", unconfirmed(), "uncertain", null, null],
  ];
  for (const [name, response, status, reason, reused] of rows) await t.test(name, async t => {
    const rig = fixture(t), opening = rig.open(), operation = rig.create(opening);
    await turn(); rig.submissions[0].gate.resolve(response); await operation.promise;
    assert.equal(rig.controller.state.status, status);
    assert.equal(rig.controller.state.reason, reason);
    assert.equal(rig.controller.state.reused, reused);
    assert.deepEqual(rig.controller.state.handle, status === "submitted" ? handle() : null);
    assert.equal(rig.controller.state.completion, null);
    assert.equal(rig.reads.length, 0);
    assert.equal(rig.requests.length, 0);
    assert.equal(rig.controller.openStory(opening), null);
    const again = rig.create(opening);
    await turn();
    if (status === "not-dispatched") {
      assert.equal(rig.submissions.length, 2, "only explicit safe retry follows typed no-dispatch");
      rig.submissions[1].gate.resolve(notDispatched("user-canceled"));
    } else assert.equal(rig.submissions.length, 1, "acknowledged or uncertain attempt cannot be resubmitted");
    await again.promise;
    if (status === "submitted" || status === "uncertain") {
      rig.controller.retire(opening);
      const reopened = rig.open();
      assertOpaqueFence(rig.controller.state);
      await immediate(rig.create(reopened));
      assert.equal(rig.submissions.length, 1, "acknowledgment alone never proves completion or permits another attempt");
    }
  });
});

test("native story controller treats unexpected rejection and malformed submission results conservatively", async t => {
  const sentinel = new Error("unexpected_submit_rejection");
  const rows = [
    ["synchronous throw", () => { throw sentinel; }],
    ["asynchronous rejection", () => Promise.reject(sentinel)],
    ["boolean result", () => Promise.resolve(true)],
    ["wrong Document acknowledgment", () => Promise.resolve(acknowledged("another-document"))],
    ["missing reused field", () => Promise.resolve({ disposition: "acknowledged", handle: handle() })],
    ["unrecognized no-dispatch reason", () => Promise.resolve(notDispatched("not-a-reason"))],
  ];
  for (const [name, submit] of rows) await t.test(name, async t => {
    const rig = fixture(t, { submit }), opening = rig.open();
    await rig.create(opening).promise;
    assertOpaqueFence(rig.controller.state);
    rig.controller.retire(opening);
    const reopened = rig.open();
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 1);
    assert.equal(rig.reads.length, 0);
    assert.equal(rig.controller.openStory(reopened), null);
  });
});

test("native story controller rejects invalid setup before submission and does not create a retry fence", async t => {
  for (const [field, value] of [["audience", "x".repeat(121)], ["tone", null], ["locale", "en_US"]]) {
    await t.test(field, async t => {
      const rig = fixture(t), opening = rig.open();
      await immediate(rig.create(opening, { ...settings(), [field]: value }));
      assert.equal(rig.submissions.length, 0);
      assert.equal(rig.controller.state.status, "not-dispatched");
      assert.equal(rig.controller.state.reason, "unavailable");
      await submitAcknowledged(rig, opening);
      assert.equal(rig.submissions.length, 1);
    });
  }
});

test("native story controller snapshots submission branch fields once and never commits a partial outcome", async t => {
  await t.test("acknowledged reused is captured once", async t => {
    const rig = fixture(t), opening = rig.open(), operation = rig.create(opening);
    let reads = 0;
    const response = { disposition: "acknowledged", handle: handle(), get reused() {
      if (++reads > 1) throw new Error("reused_was_read_twice");
      return true;
    } };
    await turn(); rig.submissions[0].gate.resolve(response); await operation.promise;
    assert.equal(reads, 1);
    assert.equal(rig.controller.state.status, "submitted");
    assert.equal(rig.controller.state.reused, true);
    assert.deepEqual(rig.controller.state.handle, handle());
  });
  await t.test("negative disposition and reason are captured once before clearing a fence", async t => {
    const rig = fixture(t), opening = rig.open(), operation = rig.create(opening);
    let dispositions = 0, reasons = 0;
    const response = { get disposition() {
      if (++dispositions > 1) throw new Error("disposition_was_read_twice");
      return "not-dispatched";
    }, handle: null, get reason() { return ++reasons === 1 ? "user-canceled" : "invalid_second_reason"; } };
    await turn(); rig.submissions[0].gate.resolve(response); await operation.promise;
    assert.equal(dispositions, 1); assert.equal(reasons, 1);
    assert.equal(rig.controller.state.status, "not-dispatched");
    assert.equal(rig.controller.state.reason, "user-canceled");
    const retry = rig.create(opening); await turn();
    assert.equal(rig.submissions.length, 2);
    rig.submissions[1].gate.resolve(notDispatched()); await retry.promise;
  });
  for (const field of ["reused", "handle", "reason"]) await t.test(`throwing ${field} cannot partly commit or clear a fence`, async t => {
    const rig = fixture(t), opening = rig.open(), operation = rig.create(opening);
    const response = field === "reason" ? notDispatched() : acknowledged();
    Object.defineProperty(response, field, { enumerable: true, get() { throw new Error(`throwing_${field}`); } });
    await turn(); rig.submissions[0].gate.resolve(response); await operation.promise;
    assertOpaqueFence(rig.controller.state);
    rig.controller.retire(opening);
    const reopened = rig.open();
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 1);
  });
  await t.test("late malformed negative result leaves the reopened fence intact", async t => {
    const rig = fixture(t), opening = rig.open(), operation = rig.create(opening);
    await turn(); rig.controller.retire(opening);
    const reopened = rig.open(), before = rig.controller.state, notifications = rig.changes.length;
    const response = notDispatched();
    Object.defineProperty(response, "reason", { enumerable: true, get() { throw new Error("late_negative_getter"); } });
    rig.submissions[0].gate.resolve(response); await operation.promise;
    assert.equal(rig.controller.state, before);
    assert.equal(rig.changes.length, notifications);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 1);
    assertOpaqueFence(rig.controller.state);
  });
});

test("native story controller close/reopen and hide/show retain only the opaque uncertain attempt fence", async t => {
  for (const transition of ["close then reopen", "hide then show"]) await t.test(transition, async t => {
    const rig = fixture(t), original = rig.open(), pending = rig.create(original);
    await turn();
    rig.controller.retire(original);
    const reopened = rig.open();
    assert.notEqual(reopened.id, original.id);
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened, { audience: "New opening", tone: "", locale: "ar" }));
    assert.equal(rig.submissions.length, 1);
    const before = rig.controller.state, notificationCount = rig.changes.length;
    rig.submissions[0].gate.reject(new Error("late_submit_after_retirement"));
    await pending.promise; await turn();
    assert.equal(rig.controller.state, before);
    assert.equal(rig.changes.length, notificationCount);
    rig.controller.retire(reopened);
    const again = rig.open();
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(again));
    assert.equal(rig.submissions.length, 1);
    assert.equal(rig.controller.openStory(original), null);
    assert.equal(rig.controller.openStory(again), null);
  });
});

test("native story controller old submit success, catch and finally cannot change a busy replacement Document", async t => {
  const rows = [
    ["acknowledged", call => call.gate.resolve(acknowledged()), false],
    ["dispatched-unconfirmed", call => call.gate.resolve(unconfirmed()), false],
    ["unexpected rejection", call => call.gate.reject(new Error("late_submit_failure")), false],
    ["exact no-dispatch", call => call.gate.resolve(notDispatched("user-canceled")), true],
  ];
  for (const [name, finishOld, mayRetry] of rows) await t.test(name, async t => {
    const rig = fixture(t), original = rig.open(), oldOperation = rig.create(original);
    await turn(); rig.controller.retire(original);
    const replacement = rig.open("document-two"), newOperation = rig.create(replacement, { audience: "Second", tone: "Plain", locale: "ar" });
    await turn();
    assert.equal(rig.submissions.length, 2);
    assert.equal(rig.controller.state.documentId, "document-two");
    assert.equal(rig.controller.state.status, "submitting");
    const before = rig.controller.state, notificationCount = rig.changes.length;
    finishOld(rig.submissions[0]); await oldOperation.promise; await turn();
    assert.equal(rig.controller.state, before, "old catch/finally cannot clear replacement busy state");
    assert.equal(rig.changes.length, notificationCount);
    assert.deepEqual(rig.submissions[1].input, { documentId: "document-two", audience: "Second", tone: "Plain", locale: "ar" });
    rig.submissions[1].gate.resolve(acknowledged("document-two", "job-two"));
    await newOperation.promise;
    assert.deepEqual(rig.controller.state.handle, handle("document-two", "job-two"));
    rig.controller.retire(replacement);
    const returned = rig.open();
    assert.equal(rig.controller.state.handle, null, "retirement never restores private acknowledged data");
    if (mayRetry) {
      assert.equal(rig.controller.state.status, "ready");
      const retry = rig.create(returned); await turn();
      assert.equal(rig.submissions.length, 3);
      rig.submissions[2].gate.resolve(notDispatched()); await retry.promise;
    } else {
      assertOpaqueFence(rig.controller.state);
      await immediate(rig.create(returned));
      assert.equal(rig.submissions.length, 2);
    }
  });
});

test("native story controller observed false or throwing currentness irreversibly retires the opening", async t => {
  for (const failure of ["false", "throw"]) await t.test(failure, async t => {
    const rig = fixture(t);
    let current = true;
    const opening = rig.open("document-one", () => {
      if (current === "throw") throw new Error("source_predicate_failure");
      return current;
    });
    current = failure === "throw" ? "throw" : false;
    await immediate(rig.create(opening));
    assert.equal(rig.controller.state.status, "retired");
    assert.equal(rig.submissions.length, 0);
    current = true;
    await immediate(rig.create(opening)); await immediate(rig.check(opening));
    assert.equal(rig.submissions.length, 0);
    assert.equal(rig.reads.length, 0);
    assert.equal(rig.controller.openStory(opening), null);
    const fresh = rig.open();
    await submitAcknowledged(rig, fresh);
  });
});

test("native story controller source replacement while submitting withholds the late handle and cannot revive by currentness alone", async t => {
  const rig = fixture(t); let sourceEpoch = 1;
  const opening = rig.open("document-one", () => sourceEpoch === 1), pending = rig.create(opening);
  await turn(); sourceEpoch = 2;
  rig.submissions[0].gate.resolve(acknowledged()); await pending.promise;
  assert.equal(rig.controller.state.status, "retired");
  assert.equal(rig.controller.state.handle, null);
  sourceEpoch = 1;
  await immediate(rig.create(opening));
  assert.equal(rig.submissions.length, 1);
  const replacement = rig.open();
  assertOpaqueFence(rig.controller.state);
  await immediate(rig.create(replacement));
  assert.equal(rig.submissions.length, 1);
});

test("native story controller one explicit status check owns one read, captures completion, and recomputes the exact retained route", async t => {
  const rig = fixture(t), opening = rig.open();
  await submitAcknowledged(rig, opening, acknowledged("document-one", "job-one", true));
  const first = rig.check(opening), second = rig.check(opening);
  await turn();
  assert.equal(rig.reads.length, 1);
  assert.deepEqual(rig.reads[0].input, handle());
  assert.equal(Object.isFrozen(rig.reads[0].input), true);
  assert.equal(rig.reads[0].controls.origin, ORIGIN);
  assert.equal(rig.reads[0].controls.signal.aborted, false);
  assert.equal(rig.reads[0].controls.current(), true);
  assert.deepEqual(rig.clock.scheduled.map(row => row.milliseconds), [10000]);
  const response = completion();
  rig.reads[0].gate.resolve(response);
  await Promise.all([first.promise, second.promise]);
  assert.equal(rig.controller.state.status, "available");
  assert.equal(rig.controller.state.reused, true);
  assert.equal(Object.isFrozen(rig.controller.state.completion), true);
  assert.equal(Object.isFrozen(rig.controller.state.completion.selection), true);
  response.handle.jobId = "later-job"; response.selection.artifactId = "newest-artifact";
  assert.deepEqual(rig.controller.state.completion, completion());
  assert.equal(rig.controller.openStory(opening), expectedRoute);
  assert.equal(rig.controller.openStory(opening), expectedRoute, "opening reads a route and does not write content or submit again");
  assert.equal(rig.submissions.length, 1);
  assert.equal(rig.reads.length, 1);
  assert.equal(rig.clock.pending.size, 0);
});

test("native story controller ten-second UI deadline preserves one underlying read occupancy across checks and replacement Documents", async t => {
  for (const late of ["fulfilled", "rejected"]) await t.test(late, async t => {
    const rig = fixture(t), opening = rig.open();
    await submitAcknowledged(rig, opening);
    const oldCheck = rig.check(opening); await turn();
    const oldRead = rig.reads[0];
    rig.clock.advance(9999); await turn();
    assert.equal(oldCheck.settled, false);
    assert.equal(rig.controller.state.status, "checking");
    rig.clock.advance(1); await turn();
    assert.equal(oldCheck.settled, true, "UI deadline must settle even though the port ignores abort");
    assert.equal(oldCheck.rejected, false);
    assert.equal(oldRead.gate.settled, false, "UI settlement is not backend cancellation settlement");
    assert.equal(oldRead.controls.signal.aborted, true);
    assert.equal(rig.controller.completionReadPending, true);
    assert.equal(rig.controller.state.status, "unavailable");
    assert.equal(rig.controller.state.completion, null);
    assert.equal(rig.clock.pending.size, 0);
    assert.ok(rig.clock.cleared.includes(rig.clock.scheduled[0].id));
    rig.clock.advance(20000); await turn();
    assert.equal(rig.reads.length, 1, "no automatic polling after deadline");
    assert.equal(rig.submissions.length, 1);
    await immediate(rig.check(opening)); await immediate(rig.check(opening));
    assert.equal(rig.reads.length, 1, "explicit repeated Check cannot accumulate unresolved ports");
    rig.controller.retire(opening);
    const reopened = rig.open();
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.check(reopened));
    assert.equal(rig.reads.length, 1);
    rig.controller.retire(reopened);
    const replacement = rig.open("document-two");
    await submitAcknowledged(rig, replacement, acknowledged("document-two", "job-two"));
    await immediate(rig.check(replacement));
    assert.equal(rig.reads.length, 1, "a newly acknowledged Document cannot bypass controller-wide occupancy");
    const before = rig.controller.state, notificationCount = rig.changes.length;
    assert.equal(before.status, "submitted");
    if (late === "fulfilled") oldRead.gate.resolve(completion());
    else oldRead.gate.reject(new Error("ignored_abort_late_rejection"));
    await turn();
    assert.equal(rig.controller.state, before);
    assert.equal(rig.changes.length, notificationCount);
    assert.equal(rig.controller.completionReadPending, false, "only actual port settlement releases occupancy");
    assert.equal(rig.clock.pending.size, 0);
    assert.equal(rig.reads.length, 1, "late settlement itself must not poll or start replacement work");
    assert.equal(rig.controller.openStory(opening), null);
    assert.equal(rig.controller.openStory(replacement), null);
    const newCheck = rig.check(replacement); await turn();
    const newRead = rig.reads[1];
    assert.deepEqual(newRead.input, handle("document-two", "job-two"));
    assert.equal(rig.controller.state.status, "checking");
    assert.equal(newRead.controls.signal.aborted, false);
    assert.equal(rig.clock.pending.size, 1);
    newRead.gate.resolve(completion(handle("document-two", "job-two"))); await newCheck.promise;
    assert.equal(rig.controller.state.status, "available");
    assert.equal(rig.controller.openStory(replacement), expectedRoute.replace("document=document-one", "document=document-two"));
    assert.equal(rig.clock.pending.size, 0);
    assert.equal(rig.controller.completionReadPending, false);
  });
});

test("native story controller retirement settles an ignored-abort read and hide/show cannot restore its handle or completion", async t => {
  for (const late of ["fulfilled", "rejected"]) await t.test(late, async t => {
    const rig = fixture(t), opening = rig.open();
    await submitAcknowledged(rig, opening);
    const reading = rig.check(opening); await turn();
    const oldRead = rig.reads[0];
    rig.controller.retire(opening); await turn();
    assert.equal(reading.settled, true);
    assert.equal(reading.rejected, false);
    assert.equal(oldRead.gate.settled, false);
    assert.equal(oldRead.controls.signal.aborted, true);
    assert.equal(rig.controller.completionReadPending, true);
    assert.equal(rig.clock.pending.size, 0);
    const shownAgain = rig.open();
    assertOpaqueFence(rig.controller.state);
    const before = rig.controller.state, notificationCount = rig.changes.length;
    if (late === "fulfilled") oldRead.gate.resolve(completion());
    else oldRead.gate.reject(new Error("retired_read_late_rejection"));
    await turn();
    assert.equal(rig.controller.state, before);
    assert.equal(rig.changes.length, notificationCount);
    assert.equal(rig.controller.completionReadPending, false);
    await immediate(rig.check(shownAgain)); await immediate(rig.create(shownAgain));
    assert.equal(rig.reads.length, 1);
    assert.equal(rig.submissions.length, 1);
    assert.equal(rig.controller.openStory(opening), null);
    assert.equal(rig.controller.openStory(shownAgain), null);
  });
});

test("native story controller retirement publishes withdrawal before an abort listener opens another busy Document", async t => {
  const rig = fixture(t), opening = rig.open();
  await submitAcknowledged(rig, opening);
  const oldCheck = rig.check(opening); await turn();
  let replacement, newSubmission;
  rig.reads[0].controls.signal.addEventListener("abort", () => {
    replacement = rig.open("document-two");
    newSubmission = rig.create(replacement, { audience: "Second", tone: "Plain", locale: "ar" });
  }, { once: true });
  rig.controller.retire(opening); await turn();
  assert.ok(replacement);
  assert.equal(oldCheck.settled, true);
  assert.equal(rig.controller.state.openingId, replacement.id);
  assert.equal(rig.controller.state.documentId, "document-two");
  assert.equal(rig.controller.state.status, "submitting");
  assert.equal(rig.submissions.length, 2);
  const before = rig.controller.state, notificationCount = rig.changes.length;
  rig.reads[0].gate.resolve(completion()); await turn();
  assert.equal(rig.controller.state, before);
  assert.equal(rig.changes.length, notificationCount);
  rig.submissions[1].gate.resolve(acknowledged("document-two", "job-two"));
  await newSubmission.promise;
  assert.deepEqual(rig.controller.state.handle, handle("document-two", "job-two"));
});

test("native story controller current read rejection is unavailable rather than proof of failed or canceled generation", async t => {
  const rig = fixture(t), opening = rig.open();
  await submitAcknowledged(rig, opening);
  const reading = rig.check(opening); await turn();
  rig.reads[0].gate.reject(new Error("completion_transport_unavailable"));
  await reading.promise;
  assert.equal(rig.controller.state.status, "unavailable");
  assert.deepEqual(rig.controller.state.handle, handle());
  assert.equal(rig.controller.state.reason, null);
  assert.equal(rig.controller.state.completion, null);
  assert.equal(rig.controller.completionReadPending, false);
  assert.equal(rig.clock.pending.size, 0);
  assert.equal(rig.controller.openStory(opening), null);
  assert.equal(rig.reads.length, 1);
  assert.equal(rig.submissions.length, 1);
});

test("native story controller outer open cannot overwrite a newer opening created synchronously during retirement", async t => {
  for (const reentry of ["changed retired callback", "read abort listener"]) await t.test(reentry, async t => {
    let rig, replacement, armed = false, entered = false;
    const replace = () => {
      if (!armed || entered) return;
      entered = true;
      replacement = rig.open("document-two");
    };
    rig = fixture(t, { changed: state => {
      if (reentry === "changed retired callback" && state.status === "retired") replace();
    } });
    const original = rig.open();
    let oldCheck;
    if (reentry === "read abort listener") {
      await submitAcknowledged(rig, original);
      oldCheck = rig.check(original); await turn();
      rig.reads[0].controls.signal.addEventListener("abort", replace, { once: true });
    }
    armed = true;
    const superseded = rig.open("document-three");
    await turn();
    assert.ok(replacement);
    assert.notEqual(superseded, replacement, "outer caller must never receive another caller's authority token");
    assert.equal(superseded.documentId, "document-three");
    assert.equal(rig.controller.state.openingId, replacement.id);
    assert.equal(rig.controller.state.documentId, "document-two");
    assert.equal(rig.controller.state.status, "ready");
    const before = rig.controller.state, notifications = rig.changes.length, submissions = rig.submissions.length;
    await immediate(rig.create(superseded)); await immediate(rig.check(superseded));
    assert.equal(rig.controller.openStory(superseded), null);
    rig.controller.retire(superseded);
    assert.equal(rig.controller.state, before);
    assert.equal(rig.changes.length, notifications);
    assert.equal(rig.submissions.length, submissions);
    const currentSubmission = rig.create(replacement); await turn();
    assert.equal(rig.submissions.at(-1).input.documentId, "document-two");
    rig.submissions.at(-1).gate.resolve(acknowledged("document-two", "job-two"));
    await currentSubmission.promise;
    assert.deepEqual(rig.controller.state.handle, handle("document-two", "job-two"));
    if (oldCheck) {
      assert.equal(oldCheck.settled, true);
      const active = rig.controller.state, count = rig.changes.length;
      rig.reads[0].gate.resolve(completion()); await turn();
      assert.equal(rig.controller.state, active);
      assert.equal(rig.changes.length, count);
      assert.equal(rig.controller.completionReadPending, false);
    }
  });
});

test("native story controller rejects mismatched or expired completion without guessing another artifact or generation status", async t => {
  const faults = [
    ["handle Document", value => { value.handle.documentId = "another-document"; }],
    ["handle job", value => { value.handle.jobId = "another-job"; }],
    ["selection Document", value => { value.selection.documentId = "another-document"; }],
    ["edited revision", value => { value.selection.revision = 1; }],
    ["malformed hash", value => { value.selection.contentSha256 = "a".repeat(63); }],
    ["expired", value => { value.expiresAt = new Date(NOW).toISOString(); }],
    ["content in receipt", value => { value.contentMarkdown = "not a completion handle"; }],
    ["wrong schema", value => { value.schemaVersion = 2; }],
  ];
  for (const [name, mutate] of faults) await t.test(name, async t => {
    const rig = fixture(t), opening = rig.open();
    await submitAcknowledged(rig, opening);
    const reading = rig.check(opening); await turn();
    const response = completion(); mutate(response); rig.reads[0].gate.resolve(response);
    await reading.promise;
    assert.equal(rig.controller.state.status, "unavailable");
    assert.deepEqual(rig.controller.state.handle, handle());
    assert.equal(rig.controller.state.completion, null);
    assert.equal(rig.controller.openStory(opening), null);
    assert.equal(rig.reads.length, 1);
    assert.equal(rig.submissions.length, 1);
    assert.equal(rig.clock.pending.size, 0);
    rig.controller.retire(opening);
    const reopened = rig.open();
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 1, "invalid completion cannot release the attempt fence");
  });
});

test("native story controller revalidates expiry and currentness at Open rather than retaining a previously valid route", async t => {
  for (const invalidation of ["exact expiry", "source retirement", "throwing currentness"]) await t.test(invalidation, async t => {
    const rig = fixture(t); let current = true;
    const opening = rig.open("document-one", () => {
      if (current === "throw") throw new Error("open_source_predicate_failure");
      return current;
    });
    await submitAcknowledged(rig, opening);
    const reading = rig.check(opening); await turn();
    rig.reads[0].gate.resolve(completion(handle(), new Date(NOW + 1000).toISOString()));
    await reading.promise;
    assert.equal(rig.controller.openStory(opening), expectedRoute);
    if (invalidation === "exact expiry") rig.clock.advance(1000);
    else current = invalidation === "throwing currentness" ? "throw" : false;
    assert.equal(rig.controller.openStory(opening), null);
    assert.equal(rig.controller.state.status, invalidation === "exact expiry" ? "unavailable" : "retired");
    assert.equal(rig.controller.state.completion, null);
    current = true;
    assert.equal(rig.controller.openStory(opening), null, "restoring a predicate does not resurrect a route");
    assert.equal(rig.submissions.length, 1);
    assert.equal(rig.reads.length, 1);
  });
});

test("native story controller synchronous presentation retirement prevents not-yet-invoked submission and read ports", async t => {
  for (const boundary of ["submitting", "checking"]) await t.test(boundary, async t => {
    let rig, opening, armed = false;
    rig = fixture(t, { changed: state => {
      if (armed && state.status === boundary) {
        armed = false;
        rig.controller.retire(opening);
      }
    } });
    opening = rig.open();
    if (boundary === "checking") await submitAcknowledged(rig, opening);
    armed = true;
    const operation = boundary === "submitting" ? rig.create(opening) : rig.check(opening);
    await immediate(operation);
    assert.equal(rig.controller.state.status, "retired");
    assert.equal(rig.submissions.length, boundary === "checking" ? 1 : 0);
    assert.equal(rig.reads.length, 0, "checking presentation retires before the queued reader invocation");
    assert.equal(rig.requests.length, 0);
    assert.equal(rig.clock.pending.size, 0);
    assert.equal(rig.controller.completionReadPending, false);
    const before = rig.controller.state, notifications = rig.changes.length;
    await immediate(rig.create(opening)); await immediate(rig.check(opening));
    assert.equal(rig.controller.openStory(opening), null);
    assert.equal(rig.controller.state, before);
    assert.equal(rig.changes.length, notifications);
    const reopened = rig.open();
    if (boundary === "submitting") {
      assert.equal(rig.controller.state.status, "ready", "retirement before submit invocation leaves no attempt fence");
      await submitAcknowledged(rig, reopened);
      assert.equal(rig.submissions.length, 1);
    } else {
      assertOpaqueFence(rig.controller.state);
      await immediate(rig.check(reopened));
      assert.equal(rig.reads.length, 0);
    }
  });
});

test("native story controller proven completion permits only a fresh explicit setup and later expiry does not recreate the fence", async t => {
  for (const afterProof of ["still unexpired", "expired after accepted completion"]) await t.test(afterProof, async t => {
    const rig = fixture(t), opening = rig.open();
    await submitAcknowledged(rig, opening);
    const reading = rig.check(opening); await turn();
    rig.reads[0].gate.resolve(completion(handle(), new Date(NOW + 1000).toISOString()));
    await reading.promise;
    assert.equal(rig.controller.state.status, "available");
    assert.equal(rig.controller.openStory(opening), expectedRoute);
    await immediate(rig.create(opening));
    assert.equal(rig.submissions.length, 1, "completed opening cannot submit again merely because its fence was released");
    if (afterProof === "expired after accepted completion") {
      rig.clock.advance(1000);
      assert.equal(rig.controller.openStory(opening), null);
      assert.equal(rig.controller.state.status, "unavailable");
      await immediate(rig.create(opening));
      assert.equal(rig.submissions.length, 1);
    }
    const fresh = rig.open();
    assert.notEqual(fresh.id, opening.id);
    assert.equal(rig.controller.state.status, "ready");
    assert.equal(rig.controller.state.handle, null);
    assert.equal(rig.controller.state.completion, null);
    assert.equal(rig.controller.state.reason, null);
    assert.equal(rig.controller.state.reused, null);
    const next = rig.create(fresh, { audience: "New audience", tone: "Plain", locale: "ar" });
    await turn();
    assert.equal(rig.submissions.length, 2);
    assert.deepEqual(rig.submissions[1].input, { documentId: "document-one", audience: "New audience", tone: "Plain", locale: "ar" });
    assert.equal(Object.isFrozen(rig.submissions[1].input), true);
    rig.submissions[1].gate.resolve(acknowledged("document-one", "job-two")); await next.promise;
    assert.deepEqual(rig.controller.state.handle, handle("document-one", "job-two"));
    assert.equal(rig.reads.length, 1);
  });
});

test("native story controller old completion work cannot release a newer same-Document attempt fence", async t => {
  for (const boundary of ["stale explicit recheck", "available observer reentry and throw"]) await t.test(boundary, async t => {
    let rig, replacement, replacementSubmission, replacementState, notificationCount, armed = false;
    const observerFailure = new Error("available_observer_failed_after_new_attempt");
    rig = fixture(t, { changed: state => {
      if (armed && state.status === "available") {
        armed = false;
        replacement = rig.open();
        replacementSubmission = rig.create(replacement, { audience: "Second", tone: "Plain", locale: "ar" });
        replacementState = rig.controller.state;
        notificationCount = rig.changes.length;
        throw observerFailure;
      }
    } });
    const original = rig.open();
    await submitAcknowledged(rig, original);
    const firstRead = rig.check(original); await turn();
    if (boundary === "available observer reentry and throw") armed = true;
    rig.reads[0].gate.resolve(completion());
    if (boundary === "available observer reentry and throw") {
      await assert.rejects(firstRead.promise, error => error === observerFailure);
      assert.equal(firstRead.rejected, true);
      assert.equal(firstRead.value, observerFailure);
    } else {
      await firstRead.promise;
      assert.equal(rig.controller.state.status, "available");
      const oldRecheck = rig.check(original); await turn();
      assert.equal(rig.reads.length, 2);
      replacement = rig.open();
      replacementSubmission = rig.create(replacement, { audience: "Second", tone: "Plain", locale: "ar" });
      await turn();
      assert.equal(oldRecheck.settled, true);
      assert.equal(rig.controller.completionReadPending, true);
      replacementState = rig.controller.state;
      notificationCount = rig.changes.length;
      rig.reads[1].gate.resolve(completion()); await turn();
      assert.equal(rig.controller.completionReadPending, false);
    }
    assert.ok(replacement);
    assert.equal(rig.submissions.length, 2);
    assert.equal(rig.controller.state, replacementState);
    assert.equal(rig.changes.length, notificationCount);
    assert.equal(rig.controller.state.status, "submitting");
    assert.equal(rig.controller.state.openingId, replacement.id);
    assert.equal(rig.controller.state.handle, null);
    assert.equal(rig.controller.openStory(original), null);
    // Busy state alone could hide a deleted fence. Retire/reopen while the
    // newer submission is genuinely unresolved, then require no third call.
    rig.controller.retire(replacement);
    const reopened = rig.open();
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 2);
    rig.submissions[1].gate.resolve(unconfirmed()); await replacementSubmission.promise;
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 2);
  });
});

test("native story controller pre-submit observer failures preserve the original rejection and release only the never-invoked attempt", async t => {
  for (const [name, thrown] of [["Error object", new Error("submitting_observer_failure")], ["undefined thrown value", undefined]]) {
    await t.test(name, async t => {
      let armed = true;
      const rig = fixture(t, { changed: state => {
        if (armed && state.status === "submitting") { armed = false; throw thrown; }
      } });
      const opening = rig.open(), notifications = rig.changes.length;
      const operation = rig.create(opening);
      await assert.rejects(operation.promise, error => error === thrown);
      assert.equal(operation.rejected, true, "undefined is a real rejected value, not absence of rejection");
      assert.equal(operation.value, thrown);
      assert.equal(rig.submissions.length, 0);
      assert.equal(rig.controller.state.status, "submitting", "the controller must not invent a second presentation after observer failure");
      assert.equal(rig.changes.length, notifications + 1, "only the original throwing submitting publication may be emitted");
      assert.equal(rig.reads.length, 0);
      assert.equal(rig.clock.pending.size, 0);
      const fresh = rig.open();
      assert.equal(rig.controller.state.status, "ready", "the exact uninvoked attempt must not leave an uncertainty fence");
      await submitAcknowledged(rig, fresh);
      assert.equal(rig.submissions.length, 1);
    });
  }
  await t.test("reentrant different-Document attempt survives the older observer rejection", async t => {
    let rig, replacement, replacementSubmission, replacementState, notificationCount, armed = true;
    const thrown = new Error("older_observer_failure");
    rig = fixture(t, { changed: state => {
      if (armed && state.status === "submitting" && state.documentId === "document-one") {
        armed = false;
        replacement = rig.open("document-two");
        replacementSubmission = rig.create(replacement, { audience: "Second", tone: "Plain", locale: "ar" });
        replacementState = rig.controller.state;
        notificationCount = rig.changes.length;
        throw thrown;
      }
    } });
    const original = rig.open(), operation = rig.create(original);
    await assert.rejects(operation.promise, error => error === thrown);
    assert.equal(operation.rejected, true);
    assert.equal(operation.value, thrown);
    assert.ok(replacement);
    assert.equal(rig.submissions.length, 1, "only the reentrant Document may have reached the native port");
    assert.equal(rig.submissions[0].input.documentId, "document-two");
    assert.equal(rig.controller.state, replacementState);
    assert.equal(rig.changes.length, notificationCount);
    assert.equal(rig.controller.state.status, "submitting");
    rig.controller.retire(replacement);
    const reopened = rig.open("document-two");
    assertOpaqueFence(rig.controller.state);
    await immediate(rig.create(reopened));
    assert.equal(rig.submissions.length, 1, "older cleanup cannot remove the newer Document's pending fence");
    rig.submissions[0].gate.resolve(unconfirmed()); await replacementSubmission.promise;
    assertOpaqueFence(rig.controller.state);
    const retryOriginal = rig.open();
    assert.equal(rig.controller.state.status, "ready");
    const retry = rig.create(retryOriginal); await turn();
    assert.equal(rig.submissions.length, 2);
    assert.equal(rig.submissions[1].input.documentId, "document-one");
    rig.submissions[1].gate.resolve(notDispatched()); await retry.promise;
  });
});

test("native story controller default completion client performs one exact bounded same-origin read without a replacement reader", async t => {
  const rig = fixture(t, { defaultReader: true }), opening = rig.open();
  await submitAcknowledged(rig, opening);
  const reading = rig.check(opening); await turn();
  assert.equal(rig.requests.length, 1);
  const request = rig.requests[0];
  assert.equal(request.path, "/api/retained-story/jobs/document-one/job-one");
  assert.deepEqual(request.init, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error",
    headers: { accept: "application/json" }, signal: request.init.signal });
  assert.equal(request.init.signal.aborted, false);
  const encoded = new TextEncoder().encode(JSON.stringify(completion()));
  const response = new Response(encoded, { headers: { "content-type": "application/json", "content-length": String(encoded.length) } });
  Object.defineProperty(response, "url", { value: ORIGIN + request.path });
  request.gate.resolve(response); await reading.promise;
  assert.equal(rig.controller.state.status, "available");
  assert.equal(rig.controller.openStory(opening), expectedRoute);
  assert.equal(response.body.locked, false);
  assert.equal(rig.requests.length, 1);
  assert.equal(rig.reads.length, 0);
  assert.equal(rig.submissions.length, 1);
  assert.equal(rig.clock.pending.size, 0);
});
