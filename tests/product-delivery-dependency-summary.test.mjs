// Prepared only. Actual complete Delivery/Store/RAM Worker and native selection
// fixture; all changes below are declared pre-existing fixture metadata, never
// a user command. No application method, report response, or test oracle swap.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";
import { descendants } from "./helpers/product-delivery-owner-choice-fixture.mjs";

const visible = value => String(value).replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
const comparable = value => visible(value).normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
const ordered = entries => [...entries].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const observations = [];
after(() => assert.equal(observations.length, 4, "All four complete summary cases reach their desired identity assertions."));

function summaryRows(f) {
  const tree = fullPageTree(f), lists = tree.visible("ol").filter(node => String(node.attributes.class).split(/\s+/u).includes("delivery-decision-list"));
  assert.equal(lists.length, 1);
  return new Map(lists[0].children.filter(node => typeof node !== "string" && node.tag === "li").map(row => {
    const nodes = descendants(row), forms = nodes.filter(node => node.tag === "form" && node.attributes["data-delivery-decision-id"]);
    const headings = nodes.filter(node => node.tag === "h2" && !node.hiddenBy);
    assert.equal(forms.length, 1); assert.equal(headings.length, 1);
    const id = forms[0].attributes["data-delivery-decision-id"];
    const labels = nodes.filter(node => node.tag === "dt" && visible(node.text) === visible(f.i18n.t("delivery.dependencies", "Existing dependencies")));
    assert.ok(labels.length <= 1);
    const cells = labels.length ? labels[0].parent.children.filter(node => typeof node !== "string" && node.tag === "dd") : [];
    assert.equal(cells.length, labels.length);
    if (cells.length) { assert.equal(cells[0].hiddenBy, null); assert.equal(cells[0].attributes.dir, "auto"); }
    return [id, { name: visible(headings[0].text), summary: cells.length ? visible(cells[0].text) : null }];
  }));
}

for (const locale of ["en", "fr", "ar", "ja"]) test("Read-only dependency summary shares exact current chooser identity " + locale,
  { concurrency: false, timeout: 30000 }, async t => {
    const f = await productDeliveryFixture(t); setLocale(f, locale);
    const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
    const db = f.storeHost.worker.sqlite, parent = seeded.decisionId, ids = dependencies.map(row => row.decision_id);
    const missing = "historical-unavailable-dependency-" + locale, references = [ids[0], ids[1], ids[2], missing];
    const originalTitles = ["First reference 文書", "Second reference نور", "Third reference Café"];
    for (const [index, id] of ids.entries()) db.prepare("UPDATE delivery_decisions SET title=? WHERE decision_id=?").run(originalTitles[index], id);
    db.prepare("UPDATE delivery_decisions SET dependency_ids_json=? WHERE decision_id=?").run(JSON.stringify(references), parent);
    const reports = [];
    f.deliver = async (call, response) => {
      assert.equal(call.method, "GET"); assert.equal(call.url, endpoint); assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(Array.isArray(body.report?.decisions));
      reports.push(body.report); return response;
    };
    const initialState = snapshot(f); await f.refresh(); assert.deepEqual(snapshot(f), initialState); assert.equal(reports.length, 1);
    const native = nativeCreateSelection(f), raw = { title: "  Unsubmitted summary-context draft  ", audience: "product", evidence: "  Raw evidence\nنور 文書  " };
    const nativeRecord = native.fillRaw(raw); native.choose("dependencies", [ids[2]]);
    const selectedBefore = native.observation(), states = [];
    const capture = mode => {
      const observation = native.observation(), rows = summaryRows(f), report = reports.at(-1), actual = report.decisions.find(row => row.decisionId === parent);
      assert.deepEqual(actual.dependencyIds, references, "The saved exact reference list and its order are not reconstructed from display names.");
      assert.equal(report.decisions.some(row => row.decisionId === missing), false);
      const options = new Map(observation.selectors.dependencies.options.map(option => [option.value, visible(option.text)]));
      assert.equal(native.current(), nativeRecord); assert.deepEqual(observation.raw, raw);
      assert.deepEqual(observation.selectors.dependencies.selected, [ids[2]]);
      assert.deepEqual(observation.selectors.dependencies.formData, [ids[2]]);
      assert.deepEqual(observation.selectors.dependencies.selectedNodes, selectedBefore.selectors.dependencies.selectedNodes);
      for (const id of ids) { assert.ok(rows.has(id) && options.has(id)); assert.equal(rows.get(id).summary, null, "Unrelated empty summaries remain absent."); }
      const fallback = visible(f.i18n.t("delivery.unavailableDependency", "Unavailable decision"));
      const summary = rows.get(parent).summary;
      assert.ok(summary && summary.endsWith(fallback), "A missing reference retains the existing honest unavailable wording.");
      states.push({ mode, summary, expectedSummary: references.map(id => rows.get(id)?.name ?? fallback).join(" · "),
        names: ordered([...rows].map(([id, row]) => [id, row.name])), choices: ordered(options),
        dependencyNames: ids.map(id => rows.get(id).name), native: observation.selectors.dependencies.selected });
    };
    capture("distinct");
    for (const [index, id] of ids.entries()) assert.equal(states[0].choices.find(([key]) => key === id)[1], originalTitles[index]);
    const aliases = ["Café 文書", "Cafe\u0301 文書", "1 · Café 文書"];
    for (const [index, id] of ids.entries()) db.prepare("UPDATE delivery_decisions SET title=? WHERE decision_id=?").run(aliases[index], id);
    const changed = snapshot(f); await f.refresh(); assert.deepEqual(snapshot(f), changed);
    capture("composed-alias");
    const changedAt = "2026-08-29T00:05:00.000Z";
    db.prepare("UPDATE delivery_decisions SET updated_at=? WHERE decision_id=?").run(changedAt, ids[2]);
    const reordered = snapshot(f), previousOrder = reports.at(-1).decisions.map(row => row.decisionId);
    await f.refresh(); assert.deepEqual(snapshot(f), reordered);
    assert.notDeepEqual(reports.at(-1).decisions.map(row => row.decisionId), previousOrder);
    capture("same-aliases-reordered");
    assert.equal(reports.length, 3); assert.equal(f.calls.some(call => call.method !== "GET"), false);
    assert.equal(f.committed.length, 0); assert.equal(f.formResets, 0); assert.deepEqual(f.external, []);
    assert.equal(reordered.creates.length, 0); assert.equal(reordered.updates.length, 0); assert.equal(reordered.receipts.length, 0);
    const record = { locale, parent, references, states, requests: reports.length, commands: 0, providers: 0,
      limits: "Actual full current rows, native chooser and protected RAM reports. Declared saved title/reference/order fixture setup only; no physical browser, AT, layout or live-data claim." };
    observations.push(record); t.diagnostic("DELIVERY_DEPENDENCY_SUMMARY " + JSON.stringify(record));
    for (const state of states) {
      assert.equal(state.summary, state.expectedSummary, "The visible read-only summary must reuse the same exact current decision-name map.");
      for (const id of ids) assert.equal(state.choices.find(([key]) => key === id)[1], state.names.find(([key]) => key === id)[1]);
      assert.equal(new Set(state.dependencyNames.map(comparable)).size, ids.length, "The summary's referenced identities remain distinguishable, including composed/qualifier-shaped titles.");
    }
    assert.equal(states[1].summary, states[2].summary); assert.deepEqual(states[1].names, states[2].names);
    assert.deepEqual(states[1].choices, states[2].choices);
  });
