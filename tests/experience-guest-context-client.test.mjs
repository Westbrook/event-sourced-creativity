import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceIntakeRuntime } from "../src/experiences/intake-runtime.ts";
import { canonicalJson, digest } from "../src/experiences/compiler.ts";
import { guestContextResponse } from "./helpers/guest-context-client.mjs";

async function fixture(t, value = undefined, options = {}) {
  value ??= await guestContextResponse();
  const calls = []; let current = value, status = 200;
  t.mock.method(globalThis, "fetch", () => assert.fail("context read must use its injected read transport"));
  const runtime = new ExperienceIntakeRuntime(value.plan.release, async function (path, init) {
    assert.equal(this, undefined); calls.push({ path, init });
    assert.equal(init.method ?? "GET", "GET"); assert.equal(init.body, undefined);
    assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store"); assert.equal(init.redirect, "error");
    return Response.json(current, { status });
  }, options.sponsor);
  t.after(() => runtime.dispose());
  return { runtime, calls, value, respond(next, code = 200) { current = next; status = code; } };
}
async function readonly(runtime, calls) {
  const count = calls.length, phase = runtime.state.phase;
  assert.equal(runtime.canRetry, false);
  assert.equal(runtime.change("subject", "Changed"), false);
  assert.equal(runtime.changeReference(null, true), false);
  runtime.back(); await runtime.prepare(); await runtime.submit();
  assert.equal(calls.length, count); assert.equal(runtime.state.phase, phase);
}

test("context custody keeps original guest plan and separate canonical receipt with GET-only exact recovery", async t => {
  const f = await fixture(t), original = canonicalJson(f.value.plan);
  await f.runtime.resume(f.value.plan.draftId);
  assert.equal(f.runtime.state.phase, "complete", JSON.stringify(f.runtime.state.issues));
  assert.equal(f.runtime.contextOnly, true); assert.equal(f.runtime.receipt, undefined);
  assert.equal(canonicalJson(f.runtime.committedPlan), original);
  assert.deepEqual(f.runtime.contextReceipt, f.value.custody);
  assert.equal(f.runtime.documentRoute, f.value.custody.documentRoute);
  assert.equal(Object.isFrozen(f.runtime.contextReceipt), true);
  assert.equal(Object.isFrozen(f.runtime.contextReceipt.appended[0].payload), true);
  assert.notEqual(f.runtime.committedPlan.streamId, f.runtime.contextReceipt.targetStreamId);
  assert.equal(f.calls.length, 1); await readonly(f.runtime, f.calls);
  const replay = structuredClone(f.value); replay.replayed = false; f.respond(replay);
  await f.runtime.recover();
  assert.equal(f.runtime.state.phase, "complete"); assert.equal(canonicalJson(f.runtime.committedPlan), original);
  assert.equal(f.calls.at(-1).path, `/api/experiences/drafts/${f.value.plan.draftId}/receipt`);
  await readonly(f.runtime, f.calls);
});

const mutations = {
  "response version": value => { value.version = 2; },
  "ordinary status with custody": value => { value.status = "complete"; },
  "generated authority": value => { value.generationAvailable = true; },
  "completed mini-app claim": value => { value.miniAppClaimComplete = true; },
  "extra response authority": value => { value.executionGrant = "foreign"; },
  "missing replay marker": value => { delete value.replayed; },
  "invalid expiration": value => { value.expiresAt = "later"; },
  "missing custody": value => { delete value.custody; },
  "extra custody authority": value => { value.custody.outputGrant = "foreign"; },
  "wrong custody version": value => { value.custody.version = 2; },
  "wrong custody kind": value => { value.custody.kind = "output"; },
  "foreign session": value => { value.custody.sessionId = "44444444-4444-4444-8444-444444444444"; },
  "foreign destination": value => { value.custody.destinationUserId = "foreign"; },
  "guest destination": value => { value.custody.destinationUserId = value.plan.streamId.slice(9); value.custody.targetStreamId = value.plan.streamId; },
  "invalid destination": value => { value.custody.destinationUserId = "bad\nowner"; value.custody.targetStreamId = "creative:bad\nowner"; },
  "foreign target stream": value => { value.custody.targetStreamId = "creative:foreign"; },
  "malformed manifest digest": value => { value.custody.manifestDigest = "a".repeat(64); },
  "malformed lineage digest": value => { value.custody.lineageDigest = "sha256:bad"; },
  "foreign draft": value => { value.custody.draftId = `experience-draft-${"f".repeat(64)}`; },
  "foreign hash": value => { value.custody.draftHash = `sha256:${"f".repeat(64)}`; },
  "foreign Project": value => { value.custody.projectId = "foreign-project"; },
  "foreign Document": value => { value.custody.documentId = "foreign-document"; },
  "foreign edit route": value => { value.custody.documentRoute = "https://foreign.example/document/other"; },
  "caller report URL": value => { value.custody.documentRoute += "?progress-report=https://foreign.example"; },
  "current stream head substituted for baseline": value => { value.custody.head++; },
  "original guest head substituted": value => { value.custody.head = value.plan.events.length; },
  "missing event": value => { value.custody.appended.pop(); },
  "duplicate event IDs": value => { value.custody.eventIds[1] = value.custody.eventIds[0]; value.custody.appended[1].eventId = value.custody.eventIds[0]; },
  "foreign event ID": value => { value.custody.appended[0].eventId = crypto.randomUUID(); },
  "extra event authority": value => { value.custody.appended[0].outputGrant = "foreign"; },
  "original guest event stream": value => { value.custody.appended[0].streamId = value.plan.streamId; },
  "wrong event actor": value => { value.custody.appended[0].actor = "guest"; },
  "ordinary intake client": value => { value.custody.appended[0].clientId = "web:experience-intake"; },
  "ordinary intake correlation": value => { value.custody.appended[0].correlationId = `experience-intake:${value.plan.projectId}`; },
  "foreign causation": value => { value.custody.appended[0].causationId = crypto.randomUUID(); },
  "foreign compensation": value => { value.custody.appended[0].compensatesEventId = crypto.randomUUID(); },
  "wrong event schema": value => { value.custody.appended[0].schemaVersion = 2; },
  "invalid occurred timestamp": value => { value.custody.appended[0].occurredAt = "today"; },
  "invalid recorded timestamp": value => { value.custody.appended[0].recordedAt = null; },
  "noncontiguous event sequence": value => { value.custody.appended[1].sequence++; },
  "zero sequence": value => { value.custody.appended[0].sequence = 0; },
  "wrong event type": value => { value.custody.appended[0].type = "DocumentRemoved"; },
  "original guest client key": value => { value.custody.appended[0].payload.client_event_id = value.plan.events[0].payload.client_event_id; },
  "substituted private payload": value => { value.custody.appended.at(-1).payload.properties.text = "Substituted"; },
  "changed plan hash": value => { value.plan.draftHash = `sha256:${"e".repeat(64)}`; },
  "stripped custody response": value => { for (const key of Object.keys(value)) if (key !== "plan") delete value[key]; },
};
for (const [name, change] of Object.entries(mutations)) test(`claimed-context rejects ${name} and cannot retry an ordinary write`, async t => {
  const value = await guestContextResponse(); change(value);
  const f = await fixture(t, value); await f.runtime.resume(value.plan.draftId);
  assert.equal(f.runtime.state.phase, "uncertain", name); assert.equal(f.runtime.contextOnly, true);
  assert.equal(f.runtime.contextReceipt, undefined); assert.equal(f.runtime.receipt, undefined);
  assert.equal(f.runtime.preparedPlan, undefined); assert.equal(f.runtime.documentRoute, undefined);
  await readonly(f.runtime, f.calls); assert.equal(f.calls.length, 1);
});

test("rehashed original plan cannot rewrite deterministic same-Document identity", async t => {
  const value = await guestContextResponse(); value.plan.documentId = crypto.randomUUID();
  for (const event of value.plan.events) if (event.payload.document_id) event.payload.document_id = value.plan.documentId;
  const { draftHash: _oldHash, ...base } = value.plan; value.plan.draftHash = await digest(base);
  const f = await fixture(t, value); await f.runtime.resume(value.plan.draftId);
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.preparedPlan, undefined); await readonly(f.runtime, f.calls);
});

test("context-only response is not admitted through owner-derived intent lookup or sponsor mode", async t => {
  const first = await fixture(t); await first.runtime.resume(first.value.plan.request.intentId, true);
  assert.equal(first.runtime.state.phase, "uncertain"); await readonly(first.runtime, first.calls);
  await first.runtime.recover(); assert.equal(first.calls.length, 1, "intent lookup cannot recover guessed canonical custody");
  const second = await fixture(t, undefined, { sponsor: { version: 1, campaignId: "campaign", actorUserId: "canonical-owner" } });
  await second.runtime.resume(second.value.plan.draftId); assert.equal(second.runtime.state.phase, "uncertain");
  assert.equal(second.runtime.contextReceipt, undefined); await readonly(second.runtime, second.calls);
});

test("failed authority recheck withdraws private state and later identity substitutions cannot restore it", async t => {
  const f = await fixture(t); await f.runtime.resume(f.value.plan.draftId);
  f.respond({ error: "experience_auth_required" }, 401); await f.runtime.recover();
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.preparedPlan, undefined);
  assert.equal(f.runtime.contextReceipt, undefined); assert.equal(f.runtime.documentRoute, undefined); await readonly(f.runtime, f.calls);
  const foreign = await guestContextResponse({ destinationUserId: "another-owner" }); f.respond(foreign);
  await f.runtime.recover(); assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.contextReceipt, undefined);
  const changedLineage = structuredClone(f.value); changedLineage.custody.lineageDigest = `sha256:${"c".repeat(64)}`; f.respond(changedLineage);
  await f.runtime.recover(); assert.equal(f.runtime.state.phase, "uncertain");
  f.respond(f.value); await f.runtime.recover(); assert.equal(f.runtime.state.phase, "complete");
  assert.deepEqual(f.runtime.contextReceipt, f.value.custody); await readonly(f.runtime, f.calls);
});

test("known custody cannot downgrade to an ordinary saved-plan or ACK after a retry failure", async t => {
  const f = await fixture(t); await f.runtime.resume(f.value.plan.draftId);
  f.respond({ plan: f.value.plan }); await f.runtime.recover();
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.contextReceipt, undefined); await readonly(f.runtime, f.calls);
  f.respond({ status: "complete", generation: "unavailable", ...f.value.custody, rejected: [] }); await f.runtime.recover();
  assert.equal(f.runtime.state.phase, "uncertain"); assert.equal(f.runtime.receipt, undefined); await readonly(f.runtime, f.calls);
});

test("context recovery is single-flight and disposal clears private state and aborts pending response", async t => {
  const value = await guestContextResponse(); let releaseResponse, call = 0, signal;
  const runtime = new ExperienceIntakeRuntime(value.plan.release, async (_path, init) => {
    call++; signal = init.signal; if (call > 1) await new Promise(resolve => { releaseResponse = resolve; });
    return Response.json(value);
  }); t.after(() => runtime.dispose());
  await runtime.resume(value.plan.draftId);
  const pending = runtime.recover(); await runtime.recover();
  assert.equal(call, 2); assert.equal(runtime.preparedPlan, undefined); assert.equal(runtime.contextReceipt, undefined);
  runtime.dispose(); assert.equal(signal.aborted, true); releaseResponse(); await pending;
  assert.equal(runtime.contextOnly, true); assert.equal(runtime.canRetry, false);
  assert.equal(runtime.preparedPlan, undefined); assert.equal(runtime.committedPlan, undefined); assert.equal(runtime.documentRoute, undefined);
});

test("a malformed context tag on a failed HTTP response still disables ordinary mutation", async t => {
  const f = await fixture(t); f.respond({ status: "context-only", error: "forbidden" }, 403);
  await f.runtime.resume(f.value.plan.draftId);
  assert.equal(f.runtime.contextOnly, true); assert.equal(f.runtime.state.phase, "uncertain"); await readonly(f.runtime, f.calls);
});
