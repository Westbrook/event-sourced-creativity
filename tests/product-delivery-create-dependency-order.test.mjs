// Permanent additive counterpart of root-executed R6 baseline7d5a0ae8.
// All helpers and four case bodies/oracles below are unchanged. Only standalone
// freeze/runtime-import packaging is removed; the root owns the outer census.
// Genuine native Update -> actual RAM Worker PATCH -> ordinary report reorder;
// no canonicalized original request, substituted receipt or provider request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after } from "node:test";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";
import { nativeUpdateForms } from "./helpers/product-delivery-update-draft-fixture.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
export const observations = [];
after(() => {
  assert.equal(observations.length, 4, "All four cases must reach the draft oracle after actual reorder and exact original/private/fiscal checks.");
});
const calls = (f, method) => f.calls.filter(call => call.url === endpoint && call.method === method);
const rawA = Object.freeze({ title: "  Original two-dependency milestone A 文書  ", audience: "product", evidence: "  Original dependency evidence A\nنور  " });
const orderedIntent = value => [value.title, value.audience, value.status, value.ownerUserId, value.evidence, value.dependencyIds];
const digest = value => hash(JSON.stringify(value));
const privateRows = f => f.storeHost.worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE owner_id='platform:product-delivery' ORDER BY private_event_id").all();
const originalPrivate = (f, eventId) => f.storeHost.worker.sqlite.prepare("SELECT event.payload,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.event_id=?").get(eventId);
function stableAuthorityAndMoney(f, before) {
  const now = snapshot(f);
  for (const key of ["route", "session", "platformSession", "authorization", "source", "users", "grants", "money"])
    assert.deepEqual(now[key], before[key], key + " remains unchanged by the deliberately scoped Delivery operations");
  assert.equal(Object.keys(now.money).length, 9, "Compare all nine job/financial table contents, without filtering.");
  assert.deepEqual(f.external, []);
  assert.equal(f.calls.some(call => !["GET", "POST", "PATCH"].includes(call.method)), false);
}
function originalEvidence(f, request, response, before) {
  const { decision, receipt } = response;
  assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(receipt.version, 1); assert.equal(receipt.requestId, request.requestId);
  assert.equal(receipt.actorUserId, f.platformSession.get().user.userId);
  assert.equal(receipt.requestDigest, digest(orderedIntent(request)), "The exact ordered original request is not normalized.");
  assert.equal(receipt.acknowledgmentDigest, digest([decision.decisionId, ...orderedIntent(decision), decision.owner, decision.createdAt, decision.updatedAt]));
  assert.equal(receipt.decisionId, decision.decisionId); assert.ok(Number.isSafeInteger(receipt.sequence) && receipt.sequence > 0);
  assert.deepEqual(orderedIntent(decision), orderedIntent(request)); assert.equal(decision.createdAt, decision.updatedAt);
  const state = snapshot(f), rows = state.decisions.filter(row => row.decision_id === decision.decisionId);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, rawA.title.trim()); assert.equal(rows[0].evidence, rawA.evidence.trim());
  assert.equal(rows[0].owner_user_id, request.ownerUserId); assert.equal(rows[0].dependency_ids_json, JSON.stringify(request.dependencyIds));
  assert.equal(state.decisions.length, before.decisions.length + 1);
  assert.equal(state.creates.length, before.creates.length + 1); assert.equal(state.creates.at(-1).event_id, receipt.eventId);
  assert.equal(state.receipts.length, before.receipts.length + 1);
  assert.equal(state.receipts.find(row => row.event_id === receipt.eventId)?.sequence, receipt.sequence);
  const raw = originalPrivate(f, receipt.eventId); assert.ok(raw);
  const body = JSON.parse(raw.private_json), publicBody = JSON.parse(raw.payload);
  assert.equal(body.request_id, request.requestId); assert.equal(body.request_digest, receipt.requestDigest);
  assert.deepEqual(body.create_request, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "requestId")));
  assert.deepEqual(body.create_acknowledgment, decision); assert.equal(publicBody._private_ref, receipt.eventId);
  assert.equal(raw.payload.includes(rawA.title.trim()), false); assert.equal(raw.payload.includes(rawA.evidence.trim()), false);
  return raw;
}

for (const locale of ["en", "ja"]) for (const editedSet of [false, true])
  test("Original dependency selection after genuine report reorder: " + locale + " / " + (editedSet ? "truly edited set" : "same set, no Create edit"),
    { concurrency: false, timeout: 30_000 }, async t => {
      const f = nativeUpdateForms(await productDeliveryFixture(t)); setLocale(f, locale);
      const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
      await f.refresh(); const native = nativeCreateSelection(f);
      const [firstDependency, alternateDependency, lastDependency] = dependencies;
      const originalIds = [firstDependency.decision_id, lastDependency.decision_id];
      native.fillRaw(rawA); native.choose("ownerUserId", [""]); native.choose("dependencies", originalIds);
      const form = native.current().form, initial = native.observation(), before = snapshot(f), privateBefore = privateRows(f);
      assert.equal(initial.actionable, true); assert.deepEqual(initial.raw, rawA);
      assert.deepEqual(initial.selectors.dependencies.selected, originalIds);
      assert.deepEqual(initial.selectors.dependencies.formData, originalIds); assert.equal(calls(f, "POST").length, 0);
      f.loseNextCreate = "transport";
      assert.equal((await native.activateCreate()).dispatched, true);
      assert.equal(calls(f, "POST").length, 1); assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201);
      assert.equal(f.formResets, 0);
      const request = structuredClone(calls(f, "POST")[0].body), response = structuredClone(f.committed[0].receipt);
      assert.deepEqual(request, { title: rawA.title.trim(), audience: "product", status: "planned", evidence: rawA.evidence.trim(),
        ownerUserId: f.platformSession.get().user.userId, dependencyIds: originalIds, requestId: request.requestId });
      const originalRaw = originalEvidence(f, request, response, before), committed = snapshot(f);
      assert.equal(privateRows(f).length, privateBefore.length + 1); stableAuthorityAndMoney(f, before);

      // Genuine current visible Update, not SQL reorder, fake report, or hidden
      // handler. Its actual Worker PATCH makes C newer; the normal post-ACK GET
      // orders available dependencies by updated_at DESC. A itself is untouched.
      const update = f.updateRow(lastDependency.title), oldDependency = committed.decisions.find(row => row.decision_id === lastDependency.decision_id);
      assert.ok(oldDependency); assert.equal(oldDependency.status, "planned");
      let patchReply = null;
      f.deliver = async (call, http) => {
        if (call.url === endpoint && call.method === "PATCH") patchReply = { status: http.status, body: await http.clone().json() };
        return http;
      };
      const beforeUpdateGet = calls(f, "GET").length;
      f.editUpdate(update, { status: "running" }); await f.submitUpdate(update); f.draw();
      assert.equal(calls(f, "PATCH").length, 1); assert.equal(patchReply?.status, 200);
      assert.equal(patchReply.body.decision.decisionId, lastDependency.decision_id);
      assert.equal(patchReply.body.decision.status, "running");
      assert.deepEqual(calls(f, "PATCH")[0].body, { decisionId: lastDependency.decision_id, title: oldDependency.title,
        evidence: oldDependency.evidence, ownerUserId: oldDependency.owner_user_id, status: "running", expectedUpdatedAt: oldDependency.updated_at });
      assert.ok(Date.parse(patchReply.body.decision.updatedAt) > Date.parse(oldDependency.updated_at));
      assert.ok(calls(f, "GET").length > beforeUpdateGet, "The actual successful Update refreshes the real Worker report.");
      const afterUpdate = snapshot(f), reordered = native.observation();
      assert.equal(afterUpdate.updates.length, committed.updates.length + 1);
      assert.deepEqual(afterUpdate.creates, committed.creates); assert.deepEqual(afterUpdate.receipts, committed.receipts);
      assert.equal(afterUpdate.decisions.length, committed.decisions.length);
      for (const row of committed.decisions.filter(row => row.decision_id !== lastDependency.decision_id))
        assert.deepEqual(afterUpdate.decisions.find(item => item.decision_id === row.decision_id), row);
      assert.deepEqual(originalEvidence(f, request, response, before), originalRaw); stableAuthorityAndMoney(f, before);
      assert.equal(native.current().form, form); assert.equal(f.formResets, 0); assert.deepEqual(reordered.raw, rawA);
      assert.deepEqual(reordered.selectors.ownerUserId.selected, [""]);
      assert.deepEqual(reordered.selectors.dependencies.selected, [...originalIds].reverse(), "Actual report order changed selectedOptions order without changing the selected set.");
      assert.deepEqual([...reordered.selectors.dependencies.selectedNodes].sort(), [...initial.selectors.dependencies.selectedNodes].sort(), "The same keyed native option nodes retain selectedness.");
      assert.deepEqual([...reordered.selectors.dependencies.selected].sort(), [...originalIds].sort());
      assert.equal(calls(f, "POST").length, 1, "Neither Update nor its report automatically retries A.");
      if (editedSet) native.choose("dependencies", [lastDependency.decision_id, alternateDependency.decision_id]);
      const retry = native.observation(), expectedIds = editedSet
        ? [lastDependency.decision_id, alternateDependency.decision_id] : [...originalIds].reverse();
      assert.deepEqual(retry.raw, rawA); assert.deepEqual(retry.selectors.dependencies.selected, expectedIds);
      assert.deepEqual(retry.selectors.dependencies.formData, expectedIds);
      assert.equal(retry.actionable, true); assert.ok(f.renderer.markup.includes(f.i18n.t("delivery.retryOriginal", "Retry original save")));
      const beforeRetry = snapshot(f), privateBeforeRetry = privateRows(f), result = await native.activateCreate();
      assert.equal(result.dispatched, true); assert.equal(result.noValidate, true); assert.deepEqual(result.missing, []);
      assert.equal(calls(f, "POST").length, 2); assert.deepEqual(calls(f, "POST")[1].body, request);
      assert.equal(f.committed.length, 2); assert.equal(f.committed[1].status, 201); assert.deepEqual(f.committed[1].receipt, response);
      assert.deepEqual(snapshot(f), beforeRetry, "Original retry changes no decision, event, receipt, private authority, or financial row.");
      assert.deepEqual(privateRows(f), privateBeforeRetry); assert.deepEqual(originalEvidence(f, request, response, before), originalRaw);
      assert.equal(calls(f, "PATCH").length, 1); stableAuthorityAndMoney(f, before);
      const afterDraft = native.observation(); assert.equal(native.current().form, form);
      assert.equal(Object.hasOwn(native.current().submit.attributes, "formnovalidate"), false);
      const keptNotice = f.renderer.markup.includes(f.i18n.t("delivery.originalSavedDraftKept", "The original milestone is saved. Your edited draft remains unsubmitted."));
      const savedNotice = f.renderer.markup.includes(f.i18n.t("delivery.saved", "Delivery decision saved."));
      const observation = { locale, editedSet, originalIds, reorderedIds: reordered.selectors.dependencies.selected,
        retryIds: retry.selectors.dependencies.selected, afterIds: afterDraft.selectors.dependencies.selected, rawAfter: afterDraft.raw,
        resets: f.formResets, keptNotice, savedNotice, originalRequestId: request.requestId, originalDecisionId: response.decision.decisionId,
        originalEventId: response.receipt.eventId, requestDigest: response.receipt.requestDigest, acknowledgmentDigest: response.receipt.acknowledgmentDigest,
        posts: 2, patches: 1, createdEvents: snapshot(f).creates.length - before.creates.length,
        updateEvents: snapshot(f).updates.length - before.updates.length, receipts: snapshot(f).receipts.length - before.receipts.length,
        unchangedFiscalTables: 9, originalPrivateBytesUnchanged: true, external: f.external.length };
      observations.push(observation); t.diagnostic("DEPENDENCY_ORDER_OBSERVATION " + JSON.stringify(observation));
      // Product-set interpretation only. All exact-byte receipt/accounting
      // controls have already passed if this oracle is reached. A failure is
      // conservative draft retention / over-specific copy, never B erasure.
      assert.equal(f.formResets, editedSet ? 0 : 1, "A report-only ordering change is not a deliberate edit to the dependency set.");
      assert.deepEqual(afterDraft.raw, editedSet ? rawA : { title: "", audience: "creative", evidence: "" });
      assert.deepEqual(afterDraft.selectors.ownerUserId.selected, [""]);
      assert.deepEqual(afterDraft.selectors.dependencies.selected, editedSet ? expectedIds : []);
      assert.equal(keptNotice, editedSet); assert.equal(savedNotice, !editedSet);
    });
