// Additive current full Delivery/Store/Worker tests; no product method replacement.
// The original save and receipt are real RAM Worker results. Losing their HTTP
// delivery is finite. Only explicit synthetic owner/dependency metadata changes
// model later unavailability; nativeCreateSelection is reused without alteration.
// Native OPTION/FormData ports are not a physical browser/OS picker certificate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";

export const originalRetrySelectionObservations = [];
const posts = f => f.calls.filter(call => call.url === endpoint && call.method === "POST");
const gets = f => f.calls.filter(call => call.url === endpoint && call.method === "GET");
const rawA = Object.freeze({ title: "  Original self-owned milestone A 文書  ", audience: "product", evidence: "  Original evidence A\nنور  " });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const intentValue = value => [value.title, value.audience, value.status, value.ownerUserId, value.evidence, value.dependencyIds];
const privateRows = f => f.storeHost.worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE owner_id='platform:product-delivery' ORDER BY private_event_id").all();
const rawOriginal = (f, id) => f.storeHost.worker.sqlite.prepare("SELECT event.payload,secret.private_json FROM events event JOIN event_private_payloads secret ON secret.private_event_id=event.event_id WHERE event.event_id=?").get(id);

function safe(f, before) {
  const now = snapshot(f);
  for (const key of ["route", "session", "platformSession", "authorization", "source", "grants", "money"])
    assert.deepEqual(now[key], before[key], key + " is unchanged by an original milestone receipt retry");
  assert.equal(Object.keys(now.money).length, 9, "All nine existing job/financial table snapshots are checked.");
  assert.equal(f.calls.some(call => !["GET", "POST"].includes(call.method)), false, "No PATCH or other mutation is issued.");
  assert.deepEqual(f.external, []);
}

function checkOriginal(f, request, response, initialPrivate) {
  const { decision, receipt } = response;
  assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(receipt.version, 1); assert.equal(receipt.requestId, request.requestId);
  assert.equal(receipt.actorUserId, f.platformSession.get().user.userId);
  assert.equal(receipt.requestDigest, digest(intentValue(request)));
  assert.equal(receipt.acknowledgmentDigest, digest([decision.decisionId, ...intentValue(decision), decision.owner, decision.createdAt, decision.updatedAt]));
  assert.equal(receipt.decisionId, decision.decisionId); assert.ok(Number.isSafeInteger(receipt.sequence) && receipt.sequence > 0);
  assert.deepEqual(intentValue(decision), intentValue(request));
  assert.equal(decision.updatedAt, decision.createdAt);
  const rows = f.decisions().filter(row => row.decision_id === decision.decisionId);
  assert.equal(rows.length, 1); assert.equal(rows[0].title, rawA.title.trim());
  assert.equal(rows[0].evidence, rawA.evidence.trim()); assert.equal(rows[0].owner_user_id, request.ownerUserId);
  assert.equal(rows[0].dependency_ids_json, "[]");
  const state = snapshot(f);
  assert.equal(state.creates.length, 1); assert.equal(state.creates[0].event_id, receipt.eventId);
  assert.equal(state.receipts.length, 1); assert.equal(state.receipts[0].event_id, receipt.eventId);
  assert.equal(state.receipts[0].sequence, receipt.sequence); assert.equal(state.updates.length, 0);
  assert.equal(privateRows(f).length, initialPrivate.length + 1);
  const raw = rawOriginal(f, receipt.eventId); assert.ok(raw);
  const body = JSON.parse(raw.private_json), publicBody = JSON.parse(raw.payload);
  assert.equal(body.request_id, request.requestId); assert.equal(body.request_digest, receipt.requestDigest);
  assert.deepEqual(body.create_request, Object.fromEntries(Object.entries(request).filter(([key]) => key !== "requestId")));
  assert.deepEqual(body.create_acknowledgment, decision);
  assert.equal(publicBody._private_ref, receipt.eventId);
  assert.equal(raw.payload.includes(rawA.title.trim()), false, "The public event does not disclose the original title.");
  assert.equal(raw.payload.includes(rawA.evidence.trim()), false, "The public event does not disclose the original evidence.");
  return raw;
}

const cases = [
  { name: "fully unchanged A", owner: false, dependency: false, unavailable: false, keepDraft: false },
  { name: "eligible selection-only B", owner: true, dependency: true, unavailable: false, keepDraft: true },
  { name: "unavailable owner-only B", owner: true, dependency: false, unavailable: true, keepDraft: true },
  { name: "unavailable dependency-only B", owner: false, dependency: true, unavailable: true, keepDraft: true },
  { name: "unavailable owner-and-dependency B", owner: true, dependency: true, unavailable: true, keepDraft: true },
];

for (const locale of ["en", "ja"]) for (const item of cases)
  test("Original receipt Retry preserves selection-only draft: " + locale + " / " + item.name,
    { concurrency: false, timeout: 30_000 }, async t => {
      const f = await productDeliveryFixture(t); setLocale(f, locale);
      const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
      await f.refresh(); const native = nativeCreateSelection(f), db = f.storeHost.worker.sqlite;
      native.fillRaw(rawA); native.choose("ownerUserId", [""]); native.choose("dependencies", []);
      const originalForm = native.current().form, before = snapshot(f), initialPrivate = privateRows(f);
      const initial = native.observation(); assert.deepEqual(initial.raw, rawA);
      assert.deepEqual(initial.selectors.ownerUserId.selected, [""]); assert.deepEqual(initial.selectors.dependencies.selected, []);
      assert.equal(initial.actionable, true); assert.equal(posts(f).length, 0);

      f.loseNextCreate = "transport";
      const first = await native.activateCreate(); assert.equal(first.dispatched, true); assert.equal(first.noValidate, false);
      assert.equal(posts(f).length, 1); assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201);
      assert.equal(f.formResets, 0); assert.deepEqual(native.observation().raw, rawA);
      const request = structuredClone(posts(f)[0].body), response = structuredClone(f.committed[0].receipt);
      assert.deepEqual(request, { title: rawA.title.trim(), audience: rawA.audience, status: "planned", evidence: rawA.evidence.trim(),
        ownerUserId: f.platformSession.get().user.userId, dependencyIds: [], requestId: request.requestId });
      const originalRaw = checkOriginal(f, request, response, initialPrivate), committedPrivate = privateRows(f);
      assert.equal(f.decisions().length, before.decisions.length + 1); safe(f, before);

      const owner = seeded.people[2].userId, dependency = dependencies[2].decision_id;
      if (item.owner) native.choose("ownerUserId", [owner]);
      if (item.dependency) native.choose("dependencies", [dependency]);
      // Deliberately do not change ANY text field: only the current native
      // selections differ from the original self/no-dependencies form A.
      const chosen = native.observation(); assert.deepEqual(chosen.raw, rawA);
      const expectedOwner = item.owner ? [owner] : [""], expectedDependencies = item.dependency ? [dependency] : [];
      assert.deepEqual(chosen.selectors.ownerUserId.selected, expectedOwner);
      assert.deepEqual(chosen.selectors.dependencies.selected, expectedDependencies);
      if (item.unavailable && item.owner) db.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(owner);
      if (item.unavailable && item.dependency) db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(dependency);
      const beforeRead = snapshot(f), readCount = gets(f).length;
      await f.refresh(); const retry = native.observation();
      assert.ok(gets(f).length > readCount); assert.deepEqual(snapshot(f), beforeRead, "Current GET has no canonical or fiscal effect.");
      assert.equal(native.current().form === originalForm, true, "The same current native form owns A and later selection-only B.");
      assert.equal(posts(f).length, 1, "A report GET is neither an original receipt ACK nor a replacement Create.");
      assert.deepEqual(retry.raw, rawA); assert.deepEqual(retry.selectors.ownerUserId.selected, expectedOwner);
      assert.deepEqual(retry.selectors.dependencies.selected, expectedDependencies);
      assert.equal(retry.submitEnabled, true); assert.equal(retry.requiredFieldsValid, true); assert.equal(f.formResets, 0);
      if (item.owner) assert.equal(retry.selectors.ownerUserId.options.find(option => option.value === owner)?.disabled, item.unavailable);
      if (item.dependency) assert.equal(retry.selectors.dependencies.options.find(option => option.value === dependency)?.disabled, item.unavailable);
      assert.deepEqual(retry.selectors.ownerUserId.formData, item.owner && item.unavailable ? [] : expectedOwner);
      assert.deepEqual(retry.selectors.dependencies.formData, item.dependency && item.unavailable ? [] : expectedDependencies);
      assert.ok(f.renderer.markup.includes(f.i18n.t("delivery.retryOriginal", "Retry original save")));

      const beforeRetry = snapshot(f), action = await native.activateCreate();
      assert.equal(action.dispatched, true); assert.equal(action.noValidate, true); assert.deepEqual(action.missing, []);
      assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, request, "Only the exact original A request/ID is retried.");
      assert.equal(f.committed.length, 2); assert.equal(f.committed[1].status, 201);
      assert.deepEqual(f.committed[1].receipt, response, "The second ACK is the complete original canonical receipt and decision.");
      assert.deepEqual(snapshot(f), beforeRetry, "No second event, decision, receipt, source, user or financial mutation is caused by original Retry.");
      assert.deepEqual(privateRows(f), committedPrivate); assert.deepEqual(checkOriginal(f, request, response, initialPrivate), originalRaw);
      safe(f, before);

      const after = native.observation();
      assert.equal(native.current().form === originalForm, true);
      assert.equal(Object.hasOwn(native.current().submit.attributes, "formnovalidate"), false, "The exact original receipt ends uncertain-retry mode.");
      const keptNotice = f.renderer.markup.includes(f.i18n.t("delivery.originalSavedDraftKept", "The original milestone is saved. Your edited draft remains unsubmitted."));
      const savedNotice = f.renderer.markup.includes(f.i18n.t("delivery.saved", "Delivery decision saved."));
      const observed = { locale, mode: item.name, rawBefore: retry.raw, rawAfter: after.raw,
        selectedBefore: { owner: retry.selectors.ownerUserId.selected, dependencies: retry.selectors.dependencies.selected },
        successfulBefore: { owner: retry.selectors.ownerUserId.formData, dependencies: retry.selectors.dependencies.formData },
        selectedAfter: { owner: after.selectors.ownerUserId.selected, dependencies: after.selectors.dependencies.selected },
        resets: f.formResets, keptNotice, savedNotice, requestId: request.requestId, decisionId: response.decision.decisionId,
        eventId: response.receipt.eventId, requestDigest: response.receipt.requestDigest, acknowledgmentDigest: response.receipt.acknowledgmentDigest,
        posts: posts(f).length, createdEvents: f.creationEvents().length, receipts: snapshot(f).receipts.length,
        fiscalTablesUnchanged: 9, privateBytesUnchanged: true, external: f.external.length };
      originalRetrySelectionObservations.push(observed); t.diagnostic("ORIGINAL_RETRY_SELECTION " + JSON.stringify(observed));
      // All exact-original/private/accounting guards above run before the
      // desired draft oracle, so a reached failure cannot be called extra spend.
      assert.equal(f.formResets, item.keepDraft ? 0 : 1, "An exact original ACK may reset only the genuinely unchanged raw native draft.");
      assert.deepEqual(after.raw, item.keepDraft ? rawA : { title: "", audience: "creative", evidence: "" });
      assert.deepEqual(after.selectors.ownerUserId.selected, item.keepDraft ? expectedOwner : [""]);
      assert.deepEqual(after.selectors.dependencies.selected, item.keepDraft ? expectedDependencies : []);
      assert.equal(keptNotice, item.keepDraft); assert.equal(savedNotice, !item.keepDraft);
      assert.equal(after.submitEnabled, !(item.keepDraft && item.unavailable));
      if (item.keepDraft && item.unavailable && item.owner)
        assert.equal(after.selectors.ownerUserId.options.find(option => option.value === owner)?.disabled, true);
      if (item.keepDraft && item.unavailable && item.dependency)
        assert.equal(after.selectors.dependencies.options.find(option => option.value === dependency)?.disabled, true);
    });
