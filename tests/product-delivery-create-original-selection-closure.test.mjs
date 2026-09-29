// Separate positive closure controls for the raw-native-selection equality fix.
// Real current Delivery/Store/RAM Worker and unchanged native OPTION/Lit Parts.
// The lost response is finite; the selected owner's/dependency's later removal
// is explicit synthetic fixture metadata, not a customer command or policy bypass.
// No application methods or response receipts are replaced. Not a browser proof.
import assert from "node:assert/strict";
import test from "node:test";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";

const posts = f => f.calls.filter(call => call.url === endpoint && call.method === "POST");
const gets = f => f.calls.filter(call => call.url === endpoint && call.method === "GET");
const privateRows = f => f.storeHost.worker.sqlite.prepare("SELECT * FROM event_private_payloads WHERE owner_id='platform:product-delivery' ORDER BY private_event_id").all();
const rawA = Object.freeze({ title: "  Original named-owner milestone A 文書  ", audience: "product", evidence: "  Original dependency evidence A\nنور  " });

for (const locale of ["en", "ja"]) test("Unchanged nonempty original selections resolve and reset once after becoming unavailable: " + locale,
  { concurrency: false, timeout: 30_000 }, async t => {
    const f = await productDeliveryFixture(t); setLocale(f, locale);
    const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
    await f.refresh(); const native = nativeCreateSelection(f), db = f.storeHost.worker.sqlite;
    const owner = seeded.people[2].userId, dependency = dependencies[2].decision_id;
    native.fillRaw(rawA); native.choose("ownerUserId", [owner]); native.choose("dependencies", [dependency]);
    const form = native.current().form, before = snapshot(f), privateBefore = privateRows(f), initial = native.observation();
    assert.deepEqual(initial.raw, rawA); assert.equal(initial.actionable, true);
    assert.deepEqual(initial.selectors.ownerUserId.selected, [owner]);
    assert.deepEqual(initial.selectors.dependencies.selected, [dependency]);
    assert.deepEqual(initial.selectors.ownerUserId.formData, [owner]);
    assert.deepEqual(initial.selectors.dependencies.formData, [dependency]);
    assert.equal(posts(f).length, 0);

    f.loseNextCreate = "transport";
    const first = await native.activateCreate(); assert.equal(first.dispatched, true); assert.equal(first.noValidate, false);
    assert.equal(posts(f).length, 1); assert.equal(f.committed.length, 1); assert.equal(f.committed[0].status, 201);
    assert.equal(f.formResets, 0); assert.deepEqual(native.observation().raw, rawA);
    const request = structuredClone(posts(f)[0].body), response = structuredClone(f.committed[0].receipt);
    assert.deepEqual(request, { title: rawA.title.trim(), audience: rawA.audience, status: "planned", evidence: rawA.evidence.trim(),
      ownerUserId: owner, dependencyIds: [dependency], requestId: request.requestId });
    assert.match(request.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.equal(response.receipt.requestId, request.requestId);
    assert.equal(response.receipt.actorUserId, f.platformSession.get().user.userId);
    assert.equal(response.receipt.decisionId, response.decision.decisionId);
    assert.equal(response.decision.ownerUserId, owner); assert.deepEqual(response.decision.dependencyIds, [dependency]);
    const decision = f.decisions().filter(row => row.decision_id === response.decision.decisionId);
    assert.equal(decision.length, 1); assert.equal(decision[0].owner_user_id, owner);
    assert.equal(decision[0].dependency_ids_json, JSON.stringify([dependency]));
    assert.equal(decision[0].title, rawA.title.trim()); assert.equal(decision[0].evidence, rawA.evidence.trim());
    assert.equal(f.decisions().length, before.decisions.length + 1);
    assert.equal(f.creationEvents().length, before.creates.length + 1); assert.equal(snapshot(f).receipts.length, before.receipts.length + 1);
    const privateCommitted = privateRows(f); assert.equal(privateCommitted.length, privateBefore.length + 1);

    // No human edit occurs after A: the exact selected IDs remain on this form.
    db.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(owner);
    db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(dependency);
    const beforeRead = snapshot(f), readCount = gets(f).length;
    await f.refresh(); const retry = native.observation();
    assert.ok(gets(f).length > readCount); assert.deepEqual(snapshot(f), beforeRead);
    assert.equal(native.current().form, form); assert.deepEqual(retry.raw, rawA);
    assert.deepEqual(retry.selectors.ownerUserId.selected, [owner]);
    assert.deepEqual(retry.selectors.dependencies.selected, [dependency]);
    assert.equal(retry.selectors.ownerUserId.options.find(option => option.value === owner)?.disabled, true);
    assert.equal(retry.selectors.dependencies.options.find(option => option.value === dependency)?.disabled, true);
    assert.deepEqual(retry.selectors.ownerUserId.formData, []);
    assert.deepEqual(retry.selectors.dependencies.formData, []);
    assert.equal(retry.submitEnabled, true); assert.equal(retry.requiredFieldsValid, true); assert.equal(f.formResets, 0);
    assert.equal(posts(f).length, 1, "A current GET neither acknowledges nor retries the original.");
    assert.ok(f.renderer.markup.includes(f.i18n.t("delivery.retryOriginal", "Retry original save")));
    const beforeRetry = snapshot(f), action = await native.activateCreate();
    assert.equal(action.dispatched, true); assert.equal(action.noValidate, true); assert.deepEqual(action.missing, []);
    assert.equal(posts(f).length, 2); assert.deepEqual(posts(f)[1].body, request);
    assert.equal(f.committed.length, 2); assert.equal(f.committed[1].status, 201);
    assert.deepEqual(f.committed[1].receipt, response, "The actual Worker returns A's complete original receipt, not a new Create.");
    assert.deepEqual(snapshot(f), beforeRetry, "Original Retry creates no second event, decision or receipt, and changes no other state.");
    assert.deepEqual(privateRows(f), privateCommitted);
    assert.equal(f.decisions().filter(row => row.decision_id === response.decision.decisionId).length, 1);
    assert.equal(f.creationEvents().length, before.creates.length + 1); assert.equal(snapshot(f).receipts.length, before.receipts.length + 1);
    assert.equal(snapshot(f).updates.length, before.updates.length);

    const after = native.observation(); assert.equal(native.current().form, form);
    assert.equal(f.formResets, 1, "Unchanged raw nonempty selections close exactly once with the acknowledged original.");
    assert.deepEqual(after.raw, { title: "", audience: "creative", evidence: "" });
    assert.deepEqual(after.selectors.ownerUserId.selected, [""]); assert.deepEqual(after.selectors.dependencies.selected, []);
    assert.equal(after.selectors.ownerUserId.options.some(option => option.value === owner), false);
    assert.equal(after.selectors.dependencies.options.some(option => option.value === dependency), false);
    assert.equal(Object.hasOwn(native.current().submit.attributes, "formnovalidate"), false);
    assert.equal(after.submitEnabled, true); assert.equal(after.requiredFieldsValid, false); assert.equal(after.actionable, false);
    assert.ok(f.renderer.markup.includes(f.i18n.t("delivery.saved", "Delivery decision saved.")));
    assert.equal(f.renderer.markup.includes(f.i18n.t("delivery.originalSavedDraftKept", "The original milestone is saved. Your edited draft remains unsubmitted.")), false);
    const settled = snapshot(f);
    for (const key of ["route", "session", "platformSession", "authorization", "source", "grants", "money"])
      assert.deepEqual(settled[key], before[key], key + " remains unchanged by original receipt recovery");
    assert.equal(Object.keys(settled.money).length, 9);
    assert.equal(f.calls.some(call => !["GET", "POST"].includes(call.method)), false); assert.deepEqual(f.external, []);
    t.diagnostic("CREATE_ORIGINAL_SELECTION_CLOSURE " + JSON.stringify({ locale, posts: posts(f).length,
      createdEvents: settled.creates.length - before.creates.length, receipts: settled.receipts.length - before.receipts.length,
      resets: f.formResets, originalRequestId: request.requestId, originalDecisionId: response.decision.decisionId,
      selectedBefore: { owner: retry.selectors.ownerUserId.selected, dependencies: retry.selectors.dependencies.selected },
      successfulBefore: { owner: retry.selectors.ownerUserId.formData, dependencies: retry.selectors.dependencies.formData },
      privateBytesUnchanged: true, financialTablesUnchanged: 9, external: f.external.length }));
  });
