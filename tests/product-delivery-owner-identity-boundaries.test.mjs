// Additive current native/Worker owner-label boundaries, separate from the
// unchanged eight desired/healthy cases. Root alone executes this preparation.
// No application grant, form submit, provider, hold or paid-work operation.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { nativeUpdateForms, endpoint } from "./helpers/product-delivery-update-draft-fixture.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { snapshot, setLocale, seedExistingFixtureHistory, enterOwnerChoiceEditor, normalize, descendants, ancestor } from "./helpers/product-delivery-owner-choice-fixture.mjs";

const observations = [];
after(() => assert.equal(observations.length, 12, "All added actual prerequisites were reached."));
const sorted = choices => [...choices].sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0);
function currentChoices(f, seeded) {
  enterOwnerChoiceEditor(f, seeded);
  const tree = fullPageTree(f, f.draw());
  const selects = tree.visible("select").filter(node => node.attributes.name === "ownerUserId");
  assert.equal(selects.length, 2);
  return selects.map(select => {
    const form = ancestor(select, "form"), label = ancestor(select, "label"), article = ancestor(select, "article");
    assert.ok(form && label && select.port?.isConnected && f.host.contains(select.port));
    assert.equal(Object.hasOwn(select.attributes, "disabled"), false);
    const kind = form.attributes["data-delivery-decision-id"] ? "update" : "create";
    if (kind === "update") assert.equal(form.attributes["data-delivery-decision-id"], seeded.decisionId);
    assert.ok(form.handlers.submit?.toString().includes(kind === "update" ? "#update" : "#create"));
    return { kind, label: normalize(label.text), formContext: normalize(form.text),
      articleContext: article ? normalize(article.text) : null,
      choices: descendants(select).filter(node => node.tag === "option").map(node => ({
        value: String(node.attributes.value ?? ""), text: node.text, visibleText: normalize(node.text),
        disabled: Object.hasOwn(node.attributes, "disabled"), selected: node.properties.selected === true || Object.hasOwn(node.attributes, "selected") })) };
  });
}
function enabledOwnerLabels(surfaces) {
  return surfaces.map(surface => ({ kind: surface.kind,
    choices: sorted(surface.choices.filter(choice => choice.value && !choice.disabled)
      .map(({ value, text, visibleText }) => ({ value, text, visibleText }))) }));
}
function reorderFixturePeople(f, seeded) {
  const db = f.storeHost.worker.sqlite;
  const rows = seeded.people.map(person => db.prepare("SELECT * FROM users WHERE user_id=?").get(person.userId));
  // Reinsert identical synthetic fixture rows in reverse physical order. The
  // actual Worker query, sort, names, eligibility and response are untouched.
  for (const row of rows) db.prepare("DELETE FROM users WHERE user_id=?").run(row.user_id);
  const insert = db.prepare("INSERT INTO users(user_id,email,display_name,role,consent_version,consented_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
  for (const row of [...rows].reverse()) insert.run(row.user_id, row.email, row.display_name, row.role,
    row.consent_version, row.consented_at, row.created_at, row.updated_at);
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const mode of ["reorder", "unavailable", "self-label"]) test(
  "Product Delivery owner identity " + mode + " " + locale, { timeout: 30000, concurrency: false }, async t => {
    const f = nativeUpdateForms(await productDeliveryFixture(t)); setLocale(f, locale);
    const seeded = seedExistingFixtureHistory(f, locale, mode !== "self-label"), db = f.storeHost.worker.sqlite;
    if (mode === "self-label") {
      seeded.people[0].name = f.i18n.t("delivery.owner.me", "Assign to me");
      db.prepare("UPDATE users SET display_name=? WHERE user_id=?").run(seeded.people[0].name, seeded.people[0].userId);
    }
    const reads = [];
    f.deliver = async (call, response) => {
      assert.equal(call.method, "GET"); assert.equal(call.url, endpoint); assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(Array.isArray(body.report?.owners));
      reads.push(body.report); return response;
    };
    await f.refresh(); f.draw();
    assert.equal(reads.length, 1); assert.equal(reads[0].owners.length, 4);
    assert.equal(f.platformSession.get().user.userId, seeded.currentOwner);
    assert.ok(f.platformSession.get().capabilities.includes("product.delivery.manage"));
    const before = snapshot(f), first = currentChoices(f, seeded), callsBefore = f.calls.length;
    const original = f.updateRow(seeded.title), revision = original.form.getAttribute("data-delivery-revision");
    const raw = { title: "  Retained owner-choice B 文書  ", evidence: "  Raw owner context\nنور  ",
      ownerUserId: seeded.people[0].userId, status: "running" };
    if (mode !== "self-label") f.editUpdate(original, raw);
    if (mode === "reorder") reorderFixturePeople(f, seeded);
    if (mode === "unavailable") {
      // Explicit synthetic eligibility transition only. No grant API is called,
      // and the current viewing principal, capability and source do not change.
      db.prepare("UPDATE users SET role='creator' WHERE user_id=?").run(seeded.people[0].userId);
    }
    await f.refresh(); const second = currentChoices(f, seeded), current = f.updateRow(seeded.title);
    assert.equal(reads.length, 2); assert.equal(current.form, original.form);
    assert.deepEqual(f.calls.slice(callsBefore).map(call => [call.method, call.url]), [["GET", endpoint]]);
    assert.equal(f.calls.filter(call => call.method !== "GET").length, 0);
    const expected = structuredClone(before);
    if (mode === "unavailable") expected.users.find(user => user.user_id === seeded.people[0].userId).role = "creator";
    assert.deepEqual(snapshot(f), expected, "Only the explicitly declared fixture eligibility change is permitted; no Source/authority/receipt/event/finance effect.");
    assert.equal(f.formResets, 0); assert.equal(f.committed.length, 0); assert.deepEqual(f.external, []);
    const create = second.find(surface => surface.kind === "create"), update = second.find(surface => surface.kind === "update");
    assert.ok(create && update);
    const self = create.choices.filter(choice => choice.value === ""); assert.equal(self.length, 1);
    assert.equal(self[0].text, f.i18n.t("delivery.owner.me", "Assign to me")); assert.equal(self[0].disabled, false);
    const eligible = sorted(reads.at(-1).owners.map(owner => ({ value: owner.userId })));
    assert.deepEqual(sorted(create.choices.filter(choice => choice.value).map(choice => ({ value: choice.value }))), eligible);
    const labels = enabledOwnerLabels(second);
    assert.deepEqual(labels[0].choices, labels[1].choices, "Both actual selectors reuse the same current eligible-owner labels.");
    if (mode !== "self-label") {
      assert.deepEqual(f.updateValues(current), raw); assert.equal(current.form.getAttribute("data-delivery-revision"), revision);
      assert.equal(current.form.getAttribute("data-delivery-dirty"), "true");
      const selected = current.fields.get("ownerUserId").description.options.filter(option => option.selected);
      assert.deepEqual(selected.map(option => option.value), [raw.ownerUserId], "The native bound selected owner stays exact; labels do not select another account.");
    }
    const orderBefore = reads[0].owners.map(owner => owner.userId).filter(id => seeded.people.slice(0, 2).some(person => person.userId === id));
    const orderAfter = reads.at(-1).owners.map(owner => owner.userId).filter(id => seeded.people.slice(0, 2).some(person => person.userId === id));
    if (mode === "reorder") {
      assert.deepEqual(orderAfter, [...orderBefore].reverse(), "The real SQLite-backed report actually reordered equal-named fixture people.");
      assert.deepEqual(enabledOwnerLabels(second), enabledOwnerLabels(first), "Labels stay attached to exact IDs, not response position.");
      assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), false);
    }
    if (mode === "unavailable") {
      assert.equal(reads.at(-1).owners.some(owner => owner.userId === raw.ownerUserId), false);
      const missing = update.choices.filter(choice => choice.value === raw.ownerUserId); assert.equal(missing.length, 1);
      assert.equal(missing[0].disabled, true); assert.equal(missing[0].selected, true);
      assert.ok(missing[0].text.includes(f.i18n.t("delivery.unavailableOwner", "No longer an eligible owner")));
      assert.equal(Object.hasOwn(current.saveButton.attributes, "disabled"), true);
      assert.ok(current.reloadButton, "The existing explicit Discard remains directly available.");
    }
    const distinct = second.map(surface => ({ kind: surface.kind, exact: surface.choices.length,
      visible: new Set(surface.choices.map(choice => choice.visibleText)).size }));
    observations.push({ locale, mode, currentPrincipal: seeded.currentOwner, originalDecision: seeded.decisionId,
      currentFormRetained: true, rawOwner: mode === "self-label" ? seeded.currentOwner : raw.ownerUserId,
      orderBefore, orderAfter, surfaces: second, distinct, deliverySubmissions: 0, grantCommands: 0,
      providerCalls: 0, sameCurrentSourceAndAuthority: true,
      limits: "Actual protected RAM report/current component with finite native/Lit selected properties; fixture metadata transitions, not physical OS select or live authorization." });
    console.log("DELIVERY_OWNER_BOUNDARY_OBSERVATION " + JSON.stringify(observations.at(-1)));
    assert.ok(distinct.every(surface => surface.exact === surface.visible), "Complete option sets, including fixed Assign to me, are visibly distinct.");
    if (mode === "unavailable") {
      const beforeDiscard = f.calls.length;
      await f.reloadUpdate(current); f.draw();
      assert.deepEqual(f.updateValues(current), { title: seeded.title, evidence: "Already saved fixture evidence",
        ownerUserId: seeded.currentOwner, status: "planned" });
      assert.equal(current.form.getAttribute("data-delivery-dirty"), null);
      assert.equal(f.calls.length, beforeDiscard); assert.deepEqual(snapshot(f), expected);
    }
    ports.bindFixture(f);
  });
