// Permanent private-original bridge regressions; all nine case bodies are retained.
// One deterministic setup response; no production provider or browser/AT certificate.
import assert from "node:assert/strict";
import test from "node:test";
import { page, retire, restore, under, classHas, currentHost, snapshot, openSuggestion, digest, sceneDeferred } from "./helpers/adaptive-recovery-native-fixture.mjs";

const endpoint = "/api/document-jobs/adaptive";
const evidence = [];
const emit = value => { evidence.push(value); console.log("ADAPTIVE_ORIGINAL_SOURCE_BRIDGE " + JSON.stringify(value)); };
const inNative = node => under(node, parent => parent.tag === "dialog" && classHas(parent, "planning-consent-dialog"));
const exactSource = x => x.h.store.adaptiveProposalSource(x.state.scope.documentId, x.state.scope.canvasId, x.state.paidQuote.executionId);
const originalReads = x => x.h.requests.filter(row => row.url === endpoint);
const assertUnquotedPublic = (x, detail) => {
  for (const job of [...x.h.store.documentJobs.get(), ...(detail ? [detail] : [])]) {
    assert.equal(Object.hasOwn(job, "adaptiveOriginalProof"), false, "private cache certificate is not a public job DTO");
    assert.equal(Object.hasOwn(job.result ?? {}, "quote"), false, "actual public feed/detail stays intentionally unquoted");
    assert.doesNotMatch(JSON.stringify(job), /"adaptiveOriginalProof"|"privateInput"/u);
  }
};

function recordOriginalResponses(x) {
  const previous = x.h.transport, rows = [], entered = sceneDeferred();
  x.h.transport = async row => {
    const response = await previous(row);
    if (row.url === endpoint) {
      const record = { request: structuredClone(row.body), status: response.status, body: await response.clone().json() };
      rows.push(record); entered.resolve(record);
    }
    return response;
  };
  x.t.after(() => { x.h.transport = previous; });
  return { rows, entered };
}

async function openNativeOriginal(x, records) {
  // Navigate through the actual Store route lifecycle, then use the genuinely
  // connected Activity control. No copied handler or synthetic consent owner.
  x.h.store.setRoute("/activity"); await x.f.settle(); await x.h.store.syncDocumentJobs(); await x.f.settle();
  const node = x.f.find("button", item => item.attributes["data-planning-recovery-id"] === x.state.paidQuote.executionId);
  assert.ok(node.port?.isConnected && node.owner?.isConnected && !node.hiddenBy);
  // working=false can be an intermediate unquoted completed-job observation.
  // Transparently observe the SAME original method invocation made by this
  // current void Activity handler. Return its exact Promise unchanged.
  const store = x.h.store, method = store.reviewPlanningJob;
  const descriptor = Object.getOwnPropertyDescriptor(store, "reviewPlanningJob");
  let observed, calls = 0, receiver = null, argumentsRead = null;
  Object.defineProperty(store, "reviewPlanningJob", { configurable: true, writable: true, value: function (...args) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- Observe the actual callback receiver for the identity assertion below.
    calls += 1; receiver = this; argumentsRead = args;
    const returned = Reflect.apply(method, this, args); observed = returned;
    return returned;
  } });
  try {
    const activation = x.f.act(node);
    const state = x.h.store.planningConsent.get();
    assert.ok(state && state.recoveryExecutionId === x.state.paidQuote.executionId, "actual native handler synchronously admits this original owner");
    assert.equal(calls, 1, "the current Activity control invokes exactly one original method");
    assert.equal(receiver === store, true);
    assert.deepEqual(argumentsRead, [x.state.paidQuote.executionId]);
    const pending = observed;
    assert.equal(typeof pending?.then, "function", "observe the actual original Promise, never manufacture completion");
    x.pending.add(pending); pending.then(() => x.pending.delete(pending), () => x.pending.delete(pending));
    const entry = await Promise.race([records.entered.promise.then(value => ({ entered: true, value })),
      pending.then(() => ({ entered: false }))]);
    assert.equal(entry.entered, true, "real original transport entry, not a void callback or tick assumed complete");
    await pending; await activation; await x.f.settle();
    assert.equal(calls, 1, "joining does not retry or request another original");
    const finished = x.h.store.planningConsent.get();
    assert.equal(finished?.id, state.id, "the same original native presentation owns completion");
    assert.equal(finished?.working, false);
    console.log("ADAPTIVE_ORIGINAL_NATIVE_COMPLETION " + JSON.stringify({
      wrapperInvocations: calls, exactOriginalPromiseJoined: true, samePresentation: finished?.id === state.id,
      executionId: finished?.recoveryExecutionId, quoteStatus: finished?.quote?.status ?? null,
    }));
    return { entry: entry.value, finished };
  } finally {
    if (descriptor) Object.defineProperty(store, "reviewPlanningJob", descriptor);
    else delete store.reviewPlanningJob;
  }
}

async function closeNative(x) {
  const label = x.f.i18n.t("planning.consent.closeReview");
  await x.f.act(x.f.find("button", node => inNative(node) && node.text === label));
  assert.equal(x.h.store.planningConsent.get(), null);
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const canvas of [false, true])
test("actual native original source remains privately certified after close and generic reads: " + locale + "/" + (canvas ? "Canvas" : "Document"), async t => {
  const x = await page(t, canvas, locale), route = x.h.store.route.get();
  assertUnquotedPublic(x);
  await retire(x); await restore(x);
  await x.h.store.syncDocumentJobs();
  assert.equal(exactSource(x)?.readable ?? false, false, "a current generic feed cannot recreate the private original quote");
  const records = recordOriginalResponses(x), count = originalReads(x).length;
  const { entry, finished } = await openNativeOriginal(x, records);
  assert.equal(originalReads(x).length, count + 1);
  assert.equal(entry.request.action, "resume"); assert.equal(entry.request.executionId, x.state.paidQuote.executionId);
  assert.equal(entry.request.prompt, ""); assert.equal(entry.status, 200);
  assert.equal(entry.body.quote.status, "completed");
  assert.equal(entry.body.quote.executionId, x.state.paidQuote.executionId);
  assert.equal(entry.body.quote.bindingHash, x.state.paidQuote.bindingHash);
  assert.deepEqual(finished.quote, entry.body.quote, "native quote comes from the actual original authorized response");
  assert.deepEqual(finished.recoveredPlan, entry.body.job.result.structure);
  assert.equal(x.f.tree().nodes.some(node => !node.hiddenBy && inNative(node) && node.text.includes(x.originalText)), true);
  assertUnquotedPublic(x, entry.body.job);
  await closeNative(x);
  x.h.store.setRoute(route); await x.f.settle();
  const detail = await x.h.store.loadDocumentJobDetail(x.state.paidQuote.executionId);
  await x.h.store.syncDocumentJobs(); await x.f.settle();
  assertUnquotedPublic(x, detail);
  assert.equal(exactSource(x)?.readable, true, "unchanged generic detail/feed can preserve, not create, the exact private proof");
  assert.deepEqual(exactSource(x).structure, entry.body.job.result.structure);
  const returned = exactSource(x).structure; returned.interpretation = "TEST-ONLY MUTATION OF RETURNED COPY";
  assert.notEqual(exactSource(x).structure.interpretation, returned.interpretation, "private retained structure is immutable and not returned by alias");
  await openSuggestion(x);
  assert.equal(snapshot(currentHost(x)).originalCount > 0, true);
  assert.equal(x.h.requests.filter(row => row.url === "/api/context/adaptive/apply" && row.body?.action === "apply").length, 0);
  emit({ kind: "native-original", locale, surface: canvas ? "Canvas" : "Document", status: entry.status,
    executionId: entry.body.quote.executionId, bindingHash: entry.body.quote.bindingHash,
    structureDigest: digest(exactSource(x).structure), sourceReadable: exactSource(x).readable,
    originalResumeCount: originalReads(x).length - count, publicQuoteAbsent: true,
    fixtureSetupResponses: 1, newGenerationResponses: x.state.calls.length - 1 });
});

test("silent original read cannot replace an already open native consent presentation", async t => {
  const x = await page(t, false), records = recordOriginalResponses(x);
  const { finished } = await openNativeOriginal(x, records), prior = structuredClone(finished), count = x.h.requests.length;
  await assert.rejects(x.h.store.loadAdaptiveProposalOriginal(x.state.paidQuote.executionId), /planning_result_unavailable/u);
  assert.deepEqual(x.h.store.planningConsent.get(), prior);
  assert.equal(x.h.requests.length, count, "silent adapter dispatches nothing while another native presentation owns consent");
  assert.equal(x.f.tree().nodes.some(node => !node.hiddenBy && inNative(node) && node.text.includes(x.originalText)), true);
  await closeNative(x);
});

test.after(() => console.log("ADAPTIVE_ORIGINAL_SOURCE_BRIDGE_SUMMARY " + JSON.stringify({
  completedObservations: evidence.length,
  qualification: "full real components/Store and actual isolated Worker responses; functional native ports, not browser/AT/provider execution",
  seed: "one existing deterministic in-memory provider response per fixture; all post-seed transport/finance checks are unchanged original helper assertions",
})));
