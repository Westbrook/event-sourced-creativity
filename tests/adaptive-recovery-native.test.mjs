// Permanent original-source recovery regressions; all eleven case bodies are retained.
// Complete native/Store/Worker fixture; deterministic ports are not browser/AT evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { family, evidence, emit, inFamily, page, openSuggestion, untilScene, currentHost, eventRows, previews, begin, control, enteredOrTerminal, retire, restore, settle, evidenceState, visibleText, applies, receipts, snapshot, explicitApply, freshExactRecovery, openResume, preview, holdRead, holdNativeRedraw, receiptIdentity, copy, inProposal, digest } from "./helpers/adaptive-recovery-native-fixture.mjs";

if (inFamily("preparation")) for (const interruption of ["none", "close", "source-unmount-restore"])
test("Canvas genuine preparation entry: " + interruption, async t => {
  const x = await page(t, true); await openSuggestion(x);
  await untilScene(() => x.queue.transactions.every(row => row.completed || row.aborted), "initial real queue transactions have completed");
  const queueHold = x.queue.holdRequest(detail => detail.method === "getAll" && detail.transaction.mode === "readwrite");
  x.gates.push(queueHold);
  const oldHost = currentHost(x), before = eventRows(x), start = previews(x).length;
  const pending = begin(x, control(x, "adaptive.changes.preview"));
  await enteredOrTerminal(queueHold.entered, pending, "production Canvas preparation's native getAll");
  assert.equal(previews(x).length, start, "free preview has not dispatched before actual preparation completes");
  if (interruption === "close") await x.f.act(control(x, "action.close"));
  if (interruption === "source-unmount-restore") { await retire(x); assert.equal(oldHost.isConnected, false); await restore(x); assert.equal(currentHost(x) !== oldHost, true); }
  queueHold.release(); await pending; await settle(x);
  const dispatchedByOldPreparation = previews(x).length - start;
  const beforeDeliberate = { old: evidenceState(oldHost), current: evidenceState(currentHost(x)),
    visiblePrivateOriginal: visibleText(x).includes(x.originalText), dispatchedByOldPreparation,
    applyCount: applies(x).length, canonicalReceiptCount: receipts(x).length };
  assert.deepEqual(eventRows(x), before); assert.equal(applies(x).length, 0); assert.equal(receipts(x).length, 0);
  if (interruption === "none") {
    assert.equal(dispatchedByOldPreparation, 1); assert.equal(snapshot(currentHost(x)).phase, "review");
    await explicitApply(x); assert.equal(receipts(x).length, 1);
  } else if (interruption === "close") {
    assert.equal(dispatchedByOldPreparation, 1, "healthy Close retains the original pending operation");
    assert.equal(snapshot(currentHost(x)).visible, false, "a late response never automatically reopens");
    const saved = structuredClone(snapshot(currentHost(x)).preview); assert.ok(saved);
    await freshExactRecovery(x, saved); assert.equal(applies(x).length, 0);
  } else {
    assert.equal(snapshot(currentHost(x)).visible, false, "restoration does not reopen the retired host");
    // Fresh deliberate recovery is performed BEFORE the desired fence assertion.
    await openResume(x);
    if (!snapshot(currentHost(x)).preview) {
      await x.h.store.syncDocumentJobs();
      assert.equal(await x.h.store.reviewPlanningJob(x.state.paidQuote.executionId), true);
      x.h.store.closePlanningConsent(); await x.h.store.loadDocumentJobDetail(x.state.paidQuote.executionId); await x.f.settle();
      if (snapshot(currentHost(x)).visible) await x.f.act(control(x, "action.close"));
      await preview(x);
    }
    assert.ok(snapshot(currentHost(x)).preview); assert.equal(snapshot(currentHost(x)).executionId, x.state.paidQuote.executionId);
    assert.equal(applies(x).length, 0); assert.deepEqual(eventRows(x), before);
  }
  emit({ family: "preparation", interruption, setupProviderResponses: 1, newProviderResponses: x.state.calls.length - 1,
    beforeDeliberate, afterDeliberate: evidenceState(currentHost(x)), authoringReceiptCount: receipts(x).length });
  if (interruption === "source-unmount-restore") assert.equal(dispatchedByOldPreparation, 0,
    "desired pre-dispatch ownership: retired original preparation must not submit after current source restoration; not a privacy/Apply claim");
});

if (inFamily("read")) for (const canvas of [false, true]) for (const interruption of ["close", "source-deferred-render", "source-unmount-restore"])
test((canvas ? "Canvas" : "Document") + " actual original read: " + interruption, async t => {
  const x = await page(t, canvas), saved = await preview(x), oldHost = currentHost(x);
  const oldPreview = snapshot(oldHost).preview, events = eventRows(x), posts = previews(x).length;
  const hold = holdRead(x), pending = begin(x, control(x, "adaptive.changes.check"));
  const received = await enteredOrTerminal(hold.entered.promise, pending, "actual Worker response JSON read");
  assert.equal(received.status, 200); assert.equal(received.body.preview.previewId, saved.previewId);
  assert.equal(received.request.previewId, saved.previewId); assert.equal(received.request.approvalHash, saved.approvalHash);
  let native;
  if (interruption === "close") await x.f.act(control(x, "action.close"));
  else if (interruption === "source-deferred-render") {
    native = holdNativeRedraw(x); await retire(x, { draw: false }); assert.equal(oldHost.isConnected, true);
    await restore(x, { draw: false }); assert.equal(currentHost(x) === oldHost, true, "controlled native schedule kept the original connected child");
  } else { await retire(x); assert.equal(oldHost.isConnected, false); await restore(x); assert.equal(currentHost(x) !== oldHost, true); }
  const beforeRelease = evidenceState(oldHost), beforeVisible = snapshot(currentHost(x)).visible;
  hold.release(); await pending;
  const afterReturn = snapshot(oldHost), newPrivateObjectAdopted = afterReturn.preview !== null && afterReturn.preview !== oldPreview;
  if (native) await native.finish(); await settle(x);
  const beforeDeliberate = { old: evidenceState(oldHost), current: evidenceState(currentHost(x)), newPrivateObjectAdopted,
    visiblePrivateOriginal: visibleText(x).includes(x.originalText), originalSourceActive: x.h.store.sourceOwnershipActive(x.originalSource) };
  assert.equal(applies(x).length, 0); assert.equal(previews(x).length, posts); assert.deepEqual(eventRows(x), events); assert.equal(receipts(x).length, 0);
  if (!beforeVisible) assert.equal(snapshot(currentHost(x)).visible, false, "no automatic reopening by an old read");
  if (interruption === "close") assert.equal(beforeDeliberate.current.visible, false);
  await freshExactRecovery(x, saved);
  assert.equal(previews(x).length, posts); assert.equal(applies(x).length, 0); assert.deepEqual(eventRows(x), events);
  emit({ family: "read", surface: canvas ? "Canvas" : "Document", interruption, setupProviderResponses: 1,
    beforeRelease, beforeDeliberate, afterDeliberate: evidenceState(currentHost(x)),
    freshRecoveryUsedExactOriginal: true, newProviderResponses: x.state.calls.length - 1 });
  if (interruption !== "close") {
    assert.equal(beforeDeliberate.visiblePrivateOriginal, false, "desired visible boundary: retired read does not republish original private text before deliberate recovery");
    if (interruption === "source-deferred-render") assert.equal(newPrivateObjectAdopted, false,
      "diagnostic only: no newly adopted old response; retained authorized internal state is separately reported");
  }
});

if (inFamily("receipt")) for (const canvas of [false, true])
test((canvas ? "Canvas" : "Document") + " current deliberate recovery preserves actual committed original", async t => {
  const x = await page(t, canvas); await preview(x); const committed = await explicitApply(x);
  const events = eventRows(x), ledger = receipts(x), oldHost = currentHost(x); assert.equal(ledger.length, 1);
  await retire(x); assert.equal(oldHost.isConnected, false); await restore(x); assert.equal(currentHost(x) !== oldHost, true);
  assert.equal(snapshot(currentHost(x)).visible, false);
  await openResume(x);
  if (!snapshot(currentHost(x)).receipt) {
    const choices = x.f.tree().visible("button").filter(node => inProposal(node) && node.text.startsWith(copy(x, "adaptive.changes.readReceipt")) && node.text.includes(committed.previewId));
    if (!choices.length) { await x.f.act(control(x, "adaptive.changes.findDestinationReceipts")); await settle(x); }
    const chosen = x.f.find("button", node => inProposal(node) && node.text.startsWith(copy(x, "adaptive.changes.readReceipt")) && node.text.includes(committed.previewId));
    await x.f.act(chosen); await settle(x);
  }
  const recovered = snapshot(currentHost(x)); assert.equal(recovered.phase, "applied", recovered.notice);
  assert.deepEqual(receiptIdentity(recovered.receipt), receiptIdentity(committed)); assert.equal(applies(x).length, 1);
  if (committed.createdAt !== undefined) assert.equal(recovered.receipt.createdAt, committed.createdAt);
  assert.deepEqual(eventRows(x), events); assert.deepEqual(receipts(x), ledger);
  emit({ family: "receipt", surface: canvas ? "Canvas" : "Document", setupProviderResponses: 1,
    exactReceipt: committed, canonicalEventsDigest: digest(events), canonicalReceiptDigest: digest(ledger),
    newProviderResponses: x.state.calls.length - 1, originalApplyCount: applies(x).length,
    current: evidenceState(currentHost(x)), freshCurrentRecovery: true });
});

test.after(() => console.log("ADAPTIVE_RECOVERY_SUMMARY " + JSON.stringify({ family, observations: evidence.length,
  setup: "one existing deterministic in-memory provider response per fixture; not production provider execution",
  actual: "complete Shell/host/Store plus routed in-memory Worker responses",
  limits: "native DOM/IndexedDB schedule, not browser/AT; internal retention alone is not a privacy incident" })));
