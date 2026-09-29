// Prepared only. Root executes this additive file against the exact E recipe.
// Real current Delivery/Store/RAM report and native OPTION/Lit-part fixture;
// direct SQLite statements below declare saved fixture metadata, not commands.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { productDeliveryFixture, snapshot, setLocale, seedExistingFixtureHistory,
  endpoint, nativeCreateSelection, seedDependencies } from "./helpers/product-delivery-create-selection-fixture.mjs";
import { descendants } from "./helpers/product-delivery-owner-choice-fixture.mjs";

const visible = value => String(value).replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();
const comparable = value => visible(value).normalize("NFC");
const ordered = entries => [...entries].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const observations = [];
after(() => assert.equal(observations.length, 4, "Every locale reaches all current-read naming observations."));

function currentRows(f) {
  const tree = fullPageTree(f), lists = tree.visible("ol").filter(node => String(node.attributes.class).split(/\s+/u).includes("delivery-decision-list"));
  assert.equal(lists.length, 1);
  return new Map(lists[0].children.filter(node => typeof node !== "string" && node.tag === "li").map(row => {
    const nodes = descendants(row), forms = nodes.filter(node => node.tag === "form" && node.attributes["data-delivery-decision-id"]);
    const headings = nodes.filter(node => node.tag === "h2" && !node.hiddenBy);
    assert.equal(forms.length, 1); assert.equal(headings.length, 1);
    const id = forms[0].attributes["data-delivery-decision-id"], heading = headings[0];
    const toggles = nodes.filter(node => node.tag === "button" && node.attributes["data-delivery-editor-toggle"] === id);
    assert.equal(toggles.length, 1); assert.equal(toggles[0].hiddenBy, null);
    assert.ok(toggles[0].port?.isConnected && f.host.contains(toggles[0].port));
    assert.equal(toggles[0].attributes["aria-controls"], "delivery-decision-edit-" + encodeURIComponent(id));
    assert.equal(toggles[0].attributes["aria-expanded"], "false");
    assert.ok(forms[0].hiddenBy && Object.hasOwn(forms[0].attributes, "inert"));
    const labels = nodes.filter(node => node.tag === "dt" && visible(node.text) === visible(f.i18n.t("delivery.dependencies", "Existing dependencies")));
    assert.ok(labels.length <= 1);
    const cells = labels.length ? labels[0].parent.children.filter(node => typeof node !== "string" && node.tag === "dd") : [];
    assert.equal(cells.length, labels.length);
    return [id, { name: visible(heading.text), rawName: heading.text,
      action: visible(toggles[0].text), expectedAction: visible(f.i18n.t("delivery.editNamed", "Edit decision {name}", { name: "\u2068" + heading.text + "\u2069" })),
      summary: cells.length ? visible(cells[0].text) : null }];
  }));
}

for (const locale of ["en", "fr", "ar", "ja"]) test("Current decision labels stay local through unrelated additions and removals " + locale,
  { concurrency: false, timeout: 30000 }, async t => {
    const f = await productDeliveryFixture(t); setLocale(f, locale);
    const seeded = seedExistingFixtureHistory(f, locale, false), dependencies = seedDependencies(f, seeded, locale);
    const db = f.storeHost.worker.sqlite, parent = seeded.decisionId, ids = dependencies.map(row => row.decision_id);
    const titles = ["Café 文書", "Cafe\u0301 文書", "Unrelated dependency نور 日本語"], parentTitle = "Steady milestone نور 日本語";
    db.prepare("UPDATE delivery_decisions SET title=?,dependency_ids_json=? WHERE decision_id=?")
      .run(parentTitle, JSON.stringify(ids.slice(0, 2)), parent);
    for (const [index, id] of ids.entries()) db.prepare("UPDATE delivery_decisions SET title=? WHERE decision_id=?").run(titles[index], id);
    const originalRows = new Map(f.decisions().map(row => [row.decision_id, { ...row }]));
    const insert = db.prepare("INSERT INTO delivery_decisions(decision_id,title,audience,status,owner_user_id,owner_display_name,evidence,dependency_ids_json,created_by_user_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    const insertSaved = row => insert.run(row.decision_id, row.title, row.audience, row.status, row.owner_user_id, row.owner_display_name,
      row.evidence, row.dependency_ids_json, row.created_by_user_id, row.created_at, row.updated_at);
    const extraId = "0000-unrelated-decision-" + locale, aliasId = "0001-authored-suffix-decision-" + locale;
    const extra = { ...originalRows.get(ids[2]), decision_id: extraId, title: "Independent added milestone خطوة", dependency_ids_json: "[]",
      updated_at: "2026-08-29T00:06:00.000Z" };
    const alias = { ...extra, decision_id: aliasId, title: titles[0] + " · " + f.i18n.number(1) };
    const reports = [];
    f.deliver = async (call, response) => {
      assert.equal(call.method, "GET"); assert.equal(call.url, endpoint); assert.equal(response.status, 200);
      const body = await response.clone().json(); assert.ok(Array.isArray(body.report?.decisions));
      reports.push(body.report); return response;
    };
    const original = snapshot(f); await f.refresh(); assert.deepEqual(snapshot(f), original);
    const native = nativeCreateSelection(f), raw = { title: "  Unsubmitted label-stability draft e\u0301  ", audience: "product", evidence: "  Raw later evidence\nنور 文書  " };
    const form = native.fillRaw(raw); native.choose("dependencies", [ids[2]]);
    const initialNative = native.observation(), states = [];
    const capture = mode => {
      const observation = native.observation(), rows = currentRows(f), report = reports.at(-1);
      const options = new Map(observation.selectors.dependencies.options.map(option => [option.value, visible(option.text)]));
      assert.deepEqual([...rows.keys()].sort(), report.decisions.map(row => row.decisionId).sort());
      assert.deepEqual([...options.keys()].sort(), [...rows.keys()].sort());
      assert.equal(native.current(), form); assert.deepEqual(observation.raw, raw);
      assert.deepEqual(observation.selectors.dependencies.selected, [ids[2]]);
      assert.deepEqual(observation.selectors.dependencies.formData, [ids[2]]);
      assert.deepEqual(observation.selectors.dependencies.selectedNodes, initialNative.selectors.dependencies.selectedNodes);
      assert.deepEqual(observation.selectors.ownerUserId.selected, [""]); assert.equal(observation.actionable, true);
      assert.equal(observation.selectors.dependencies.options.some(option => option.disabled), false);
      assert.deepEqual(report.decisions.find(row => row.decisionId === parent).dependencyIds, ids.slice(0, 2));
      for (const row of report.decisions) {
        assert.ok(rows.get(row.decisionId).rawName.includes(row.title), "Authored raw code points remain present; only presentation qualifiers are added.");
        assert.equal(rows.get(row.decisionId).action, rows.get(row.decisionId).expectedAction);
      }
      const fallback = visible(f.i18n.t("delivery.unavailableDependency", "Unavailable decision"));
      states.push({ mode, names: ordered([...rows].map(([id, row]) => [id, row.name])), choices: ordered(options),
        parentSummary: rows.get(parent).summary, expectedSummary: ids.slice(0, 2).map(id => rows.get(id)?.name ?? fallback).join(" · "),
        authored: ordered(report.decisions.map(row => [row.decisionId, visible(row.title)])),
        selected: observation.selectors.dependencies.selected, selectedNodes: observation.selectors.dependencies.selectedNodes });
    };
    const readCurrent = async mode => {
      const expected = snapshot(f); await f.refresh(); assert.deepEqual(snapshot(f), expected); capture(mode);
    };
    capture("duplicate-pair");
    insertSaved(extra); await readCurrent("unrelated-added");
    db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(extraId); await readCurrent("unrelated-removed");
    insertSaved(alias); await readCurrent("authored-suffix-alias-added");
    db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(aliasId); await readCurrent("authored-suffix-alias-removed");
    db.prepare("DELETE FROM delivery_decisions WHERE decision_id=?").run(ids[1]); await readCurrent("collision-peer-removed");
    insertSaved(originalRows.get(ids[1])); await readCurrent("collision-peer-restored");
    assert.equal(reports.length, 7); assert.equal(f.calls.some(call => call.method !== "GET"), false);
    assert.equal(f.committed.length, 0); assert.equal(f.formResets, 0); assert.deepEqual(f.external, []);
    assert.deepEqual(snapshot(f), original, "Fixture metadata round trip leaves all protected rows, source, receipts and fiscal tables unchanged.");
    assert.equal(original.creates.length, 0); assert.equal(original.updates.length, 0); assert.equal(original.receipts.length, 0);
    const record = { locale, parent, selected: ids[2], states, currentReads: reports.length, commands: 0, providers: 0,
      limits: "Actual full current rows, summaries, named Edit controls and native OPTION/Lit Parts under protected RAM reads. Declared saved fixture membership/title changes only; no live delete, browser picker, geometry, AT or production claim." };
    observations.push(record); t.diagnostic("DELIVERY_DECISION_LABEL_STABILITY " + JSON.stringify(record));
    const names = state => new Map(state.names), baseline = names(states[0]);
    for (const state of states) {
      assert.equal(names(state).get(parent), parentTitle, "An unrelated title stays verbatim when another collision group changes.");
      assert.equal(names(state).get(ids[2]), titles[2], "The selected unrelated decision is not globally rank-prefixed.");
      assert.deepEqual(state.choices, state.names, "Headings and native choices share the same current map.");
      assert.equal(state.parentSummary, state.expectedSummary, "Saved dependency summaries use that map without changing exact references.");
      assert.equal(new Set(state.names.map(([, name]) => comparable(name))).size, state.names.length, "Final labels, including an authored suffix alias, are distinguishable.");
    }
    for (const state of states.slice(0, 5)) for (const id of [parent, ...ids])
      assert.equal(names(state).get(id), baseline.get(id), "Unrelated and suffix-shaped row additions/removals cannot renumber existing choices.");
    assert.equal(names(states[1]).get(extraId), extra.title, "A genuinely unrelated new title stays concise.");
    assert.equal(names(states[5]).get(ids[0]), titles[0], "A former collision may become concise when its own peer disappears.");
    assert.equal(names(states[5]).has(ids[1]), false);
    assert.deepEqual(states[6].names, states[0].names); assert.deepEqual(states[6].choices, states[0].choices);
  });
