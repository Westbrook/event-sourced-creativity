// Prepared only. Root owns execution on the actual installed source/overlay.
// Reuse the installed complete Delivery/Store/RAM Worker and native Create
// OPTION/Lit-part fixture. No application method or HTTP body is substituted.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";
import { descendants } from "./helpers/product-delivery-owner-choice-fixture.mjs";

const visible = value => String(value).replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
const comparable = value => visible(value).normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
const byId = values => [...values].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const observations = [];
after(() => {
  console.log("DELIVERY_CREATE_DEPENDENCY_LABEL_CASES " + JSON.stringify({ expected: 12, observations: observations.length }));
  assert.equal(observations.length, 12, "Every case reaches the current chooser observation; setup failures are not label evidence.");
});

function headingNames(f) {
  const tree = fullPageTree(f), lists = tree.visible("ol").filter(node => String(node.attributes.class).split(/\s+/u).includes("delivery-decision-list"));
  assert.equal(lists.length, 1);
  return new Map(lists[0].children.filter(node => typeof node !== "string" && node.tag === "li").map(row => {
    const children = descendants(row), forms = children.filter(node => node.tag === "form" && node.attributes["data-delivery-decision-id"]);
    const headings = children.filter(node => node.tag === "h2");
    assert.equal(forms.length, 1, "Current manager rows retain one exact native form, including E's hidden form.");
    assert.equal(headings.length, 1); assert.equal(headings[0].hiddenBy, null);
    const id = forms[0].attributes["data-delivery-decision-id"];
    if (row.attributes["data-delivery-decision-id"]) assert.equal(row.attributes["data-delivery-decision-id"], id);
    return [id, visible(headings[0].text)];
  }));
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const mode of ["distinct", "duplicate", "composed-alias"]) test(
  "Current Create dependency labels and keyed selection " + locale + " / " + mode,
  { concurrency: false, timeout: 30000 }, async t => {
    const f = await productDeliveryFixture(t); setLocale(f, locale);
    const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
    const db = f.storeHost.worker.sqlite, ids = [seeded.decisionId, ...dependencies.map(row => row.decision_id)];
    const titles = mode === "distinct"
      ? ["Original milestone", "First dependency 文書", "Second dependency نور", "Final dependency Café"]
      : mode === "duplicate"
        ? ["Original milestone", "Same dependency 文書", "Same dependency 文書", "Different dependency نور"]
        : ["Original milestone", "Café 文書", "Cafe\u0301 文書", "1 · Café 文書"];
    for (const [index, id] of ids.entries()) db.prepare("UPDATE delivery_decisions SET title=? WHERE decision_id=?").run(titles[index], id);
    const reads = [];
    f.deliver = async (call, response) => {
      assert.equal(call.method, "GET"); assert.equal(call.url, endpoint); assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(Array.isArray(body.report?.decisions));
      reads.push(body.report); return response;
    };
    await f.refresh(); assert.equal(reads.length, 1);
    assert.deepEqual(reads[0].decisions.map(row => row.decisionId), ids);
    assert.deepEqual(reads[0].decisions.map(row => row.title), titles, "Only declared pre-existing RAM fixture titles supply the current protected report.");
    const native = nativeCreateSelection(f), raw = { title: "  Unsubmitted new milestone e\u0301  ", audience: "product", evidence: "  Raw later evidence\nنور 文書  " };
    const form = native.fillRaw(raw), selected = dependencies[2].decision_id;
    native.choose("dependencies", [selected]);
    const before = native.observation(), beforeNames = headingNames(f), original = snapshot(f), expected = structuredClone(original), calls = f.calls.length;
    const optionsBefore = before.selectors.dependencies.options;
    assert.equal(optionsBefore.length, ids.length); assert.deepEqual(optionsBefore.map(option => option.value), ids);
    assert.deepEqual(before.selectors.dependencies.formData, [selected]); assert.equal(before.actionable, true);
    assert.equal(before.ownerRequired, false); assert.deepEqual(before.selectors.ownerUserId.selected, [""]);
    for (const [index, id] of ids.entries()) {
      const option = optionsBefore.find(item => item.value === id); assert.ok(option && !option.disabled);
      assert.ok(visible(option.text).includes(visible(titles[index])), "The native option retains its authored title, not an ID-only replacement.");
      assert.equal(visible(option.text), beforeNames.get(id), "The current list heading and Create option use one readable decision identity.");
      if (mode === "distinct") assert.equal(visible(option.text), visible(titles[index]), "Unique names remain concise.");
    }
    // Change only the current report's legitimate ordering metadata. Selection,
    // title, authority, original-operation state and every command remain intact.
    const changedAt = "2026-08-29T00:04:00.000Z";
    db.prepare("UPDATE delivery_decisions SET updated_at=? WHERE decision_id=?").run(changedAt, selected);
    expected.decisions.find(row => row.decision_id === selected).updated_at = changedAt;
    await f.refresh(); const final = native.observation(), afterNames = headingNames(f), optionsAfter = final.selectors.dependencies.options;
    assert.equal(reads.length, 2); assert.notDeepEqual(reads[1].decisions.map(row => row.decisionId), ids);
    assert.deepEqual(optionsAfter.map(option => option.value), reads[1].decisions.map(row => row.decisionId));
    assert.equal(native.current(), form); assert.deepEqual(final.raw, raw); assert.deepEqual(final.raw, before.raw);
    assert.deepEqual(final.selectors.dependencies.selected, [selected]); assert.deepEqual(final.selectors.dependencies.formData, [selected]);
    assert.deepEqual(final.selectors.dependencies.selectedNodes, before.selectors.dependencies.selectedNodes, "The actual keyed native OPTION remains the selected object.");
    assert.deepEqual(byId(optionsAfter.map(option => [option.value, visible(option.text)])), byId(optionsBefore.map(option => [option.value, visible(option.text)])), "Ordering alone cannot rename another decision or its chooser label.");
    for (const option of optionsAfter) assert.equal(visible(option.text), afterNames.get(option.value));
    assert.deepEqual(f.calls.slice(calls).map(call => [call.method, call.url]), [["GET", endpoint]]);
    assert.equal(f.calls.some(call => call.method !== "GET"), false); assert.equal(f.committed.length, 0);
    assert.equal(f.formResets, 0); assert.deepEqual(f.external, []); assert.deepEqual(snapshot(f), expected);
    assert.equal(original.creates.length, 0); assert.equal(original.updates.length, 0); assert.equal(original.receipts.length, 0);
    const record = { locale, mode, before: optionsBefore, after: optionsAfter, selected,
      sameForm: native.retained() === form, beforeHeadings: [...beforeNames], afterHeadings: [...afterNames],
      distinctBefore: new Set(optionsBefore.map(option => comparable(option.text))).size,
      distinctAfter: new Set(optionsAfter.map(option => comparable(option.text))).size,
      commands: 0, creates: 0, receipts: 0, providers: 0,
      limits: "Actual complete Delivery/Store/RAM Worker GETs and current native OPTION/Lit Parts; synthetic saved fixture titles/order only. No OS picker, physical layout, accessibility or production identity claim." };
    observations.push(record); console.log("DELIVERY_CREATE_DEPENDENCY_LABEL_OBSERVATION " + JSON.stringify(record));
    assert.equal(record.distinctBefore, ids.length, "Different current dependency IDs must have distinguishable complete native option labels.");
    assert.equal(record.distinctAfter, ids.length, "Composed-title aliases remain distinct after actual report reorder.");
  });
