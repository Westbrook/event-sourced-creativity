import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { productDeliveryFixture } from "./helpers/product-delivery-native-fixture.mjs";
import { nativeDeliveryForms, setDeliveryLocale, deliveryTree, deliveryRow, toggleDeliveryEditor,
  submitVisibleDeliveryForm, within } from "./helpers/product-delivery-edit-density-native-port.mjs";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";

// Additive to, not replacements for, B3's original receipt/ownership and report
// continuity cases. All writes below go only through the real current host and
// routed in-memory Worker fixture. This file is prepared, not executed evidence.
const locales = ["en", "fr", "ar", "ja"];
const draft = title => ({ title, audience: "product", evidence: "Evidence for " + title, ownerUserId: "", dependencies: [] });
const posts = f => f.calls.filter(call => call.method === "POST");
const patches = f => f.calls.filter(call => call.method === "PATCH");
const mutations = f => f.calls.filter(call => call.method !== "GET");
const exactDecision = (f, id) => f.host.report.decisions.find(decision => decision.decisionId === id);
const editForms = tree => tree.nodes.filter(node => node.tag === "form" && Object.hasOwn(node.attributes, "data-delivery-decision-id"));
const normalize = text => text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/gu, " ").trim().toLowerCase();
const rawDraft = label => ({ title: "  " + label + " e\u0301 خطوة 議題  ", evidence: "  Unsubmitted\nخطوة / 議題\n  " });

async function fixture(t, locale) {
  const f = nativeDeliveryForms(await productDeliveryFixture(t)); setDeliveryLocale(f, locale); return f;
}

async function seed(f, title) {
  const previous = new Set(f.decisions().map(decision => decision.decision_id));
  f.fill(f.form(), draft(title)); await submitVisibleDeliveryForm(f); f.draw();
  const added = f.decisions().filter(decision => !previous.has(decision.decision_id));
  assert.equal(added.length, 1, "a real visible creation produces one exact milestone");
  assert.ok(f.committed.at(-1)?.receipt.receipt, "the real creation receipt was delivered");
  return added[0].decision_id;
}

function assertCollapsed(tree, count) {
  const forms = editForms(tree); assert.equal(forms.length, count, "all native draft owners remain mounted");
  assert.equal(forms.filter(form => !form.hiddenBy).length, 0, "no milestone editor is shown at rest");
  for (const form of forms) {
    assert.ok(form.hiddenBy); assert.ok(Object.hasOwn(form.attributes, "hidden")); assert.ok(Object.hasOwn(form.attributes, "inert"));
    assert.equal(tree.visible("button").filter(node => within(node, form)).length, 0);
    assert.equal(tree.visible("input").filter(node => within(node, form)).length, 0);
    assert.equal(tree.visible("select").filter(node => within(node, form)).length, 0);
    assert.equal(tree.visible("textarea").filter(node => within(node, form)).length, 0);
  }
}

function assertOneEditor(tree, id) {
  const forms = editForms(tree), visible = forms.filter(form => !form.hiddenBy);
  assert.equal(visible.length, 1); assert.equal(visible[0].attributes["data-delivery-decision-id"], id);
  assert.equal(Object.hasOwn(visible[0].attributes, "inert"), false);
  for (const form of forms.filter(form => form !== visible[0])) {
    assert.ok(form.hiddenBy); assert.ok(Object.hasOwn(form.attributes, "inert"));
  }
  return visible[0];
}

for (const locale of locales) {
  test(`${locale} delivery editors use one current named reveal and keep raw native drafts across Hide and another row`, async t => {
    const f = await fixture(t, locale), a = await seed(f, "Same milestone"), b = await seed(f, "Same milestone"), c = await seed(f, "1 · Same milestone");
    const before = mutations(f).length, financial = f.financial(), create = f.form();
    let tree = deliveryTree(f); assertCollapsed(tree, 3);
    const toggles = tree.visible("button").filter(node => Object.hasOwn(node.attributes, "data-delivery-editor-toggle"));
    assert.equal(toggles.length, 3); assert.equal(new Set(toggles.map(node => normalize(node.text))).size, 3, "complete visible actions distinguish simultaneous authored-title collisions");
    for (const id of [a, b, c]) {
      const row = deliveryRow(f, id); assert.match(row.text, /Evidence for /u, "current evidence stays readable without opening an editor");
      assert.equal(row.hiddenBy, null);
    }
    tree = await toggleDeliveryEditor(f, a); assertOneEditor(tree, a);
    const formA = f.decisionForm(a), values = { ...f.currentFields(formA), ...rawDraft("A") }; f.fill(formA, values);
    tree = await toggleDeliveryEditor(f, a); assertCollapsed(tree, 3);
    tree = await toggleDeliveryEditor(f, b); assertOneEditor(tree, b); const formB = f.decisionForm(b);
    f.fill(formB, { ...f.currentFields(formB), ...rawDraft("B") });
    tree = await toggleDeliveryEditor(f, a); assertOneEditor(tree, a);
    assert.equal(f.decisionForm(a), formA); assert.deepEqual(f.currentFields(formA), values); assert.equal(formA.isConnected, true);
    assert.equal(f.decisionForm(b), formB); assert.equal(f.currentFields(formB).title, rawDraft("B").title);
    assert.equal(f.form(), create, "the independent create/retry owner was not remounted by editor selection");
    assert.equal(mutations(f).length, before, "view changes and typing never autosave"); assert.deepEqual(f.financial(), financial); assert.deepEqual(f.external, []);
  });

  test(`${locale} a genuine pending update stays named when hidden and cannot replace newer row selection or draft`, async t => {
    const f = await fixture(t, locale), a = await seed(f, "Original A"), b = await seed(f, "Original B"), financial = f.financial();
    const original = exactDecision(f, a); await toggleDeliveryEditor(f, a); const formA = f.decisionForm(a);
    const submitted = { ...f.currentFields(formA), status: "running", evidence: "A current update" }; f.fill(formA, submitted);
    const entered = sceneDeferred(), gate = sceneDeferred(); let held = false;
    f.deliver = async (call, response) => {
      if (!held && call.method === "PATCH") { assert.equal(response.status, 200, "real authorized PATCH succeeds before the finite delivery hold"); held = true; entered.resolve(); await gate.promise; }
      return response;
    };
    const pending = submitVisibleDeliveryForm(f, a);
    try {
      await entered.promise; assert.equal(patches(f).length, 1);
      assert.equal(patches(f)[0].body.decisionId, a); assert.equal(patches(f)[0].body.expectedUpdatedAt, original.updatedAt);
      await toggleDeliveryEditor(f, a); const tree = await toggleDeliveryEditor(f, b), current = assertOneEditor(tree, b);
      const formB = f.decisionForm(b), rawB = { ...f.currentFields(formB), ...rawDraft("B during A") }; f.fill(formB, rawB);
      const rowA = deliveryRow(f, a); assert.ok(rowA.text.includes(f.i18n.t("delivery.saving")), "the exact A row keeps its pending status outside its hidden form");
      const savingB = tree.visible("button").find(node => within(node, current) && node.attributes.type === "submit");
      assert.ok(Object.hasOwn(savingB.attributes, "disabled")); assert.equal(savingB.text, f.i18n.t("delivery.save"), "B is disabled, not described as the submitted update");
      gate.resolve(); await pending;
      assertOneEditor(deliveryTree(f), b); assert.equal(f.decisionForm(b), formB); assert.deepEqual(f.currentFields(formB), rawB);
      assert.equal(f.decisionForm(a), formA, "the exact keyed A form survives the real status reorder");
      assert.equal(exactDecision(f, a).status, "running"); assert.equal(exactDecision(f, b).status, "planned");
      assert.ok(deliveryRow(f, a).text.includes(f.i18n.t("delivery.saved"))); assert.equal(patches(f).length, 1);
    } finally { gate.resolve(); await pending; }
    assert.deepEqual(f.financial(), financial); assert.deepEqual(f.external, []);
  });

  test(`${locale} changing an editor does not replace an unconfirmed create or submit its newer raw draft`, async t => {
    const f = await fixture(t, locale), existing = await seed(f, "Existing milestone"), financial = f.financial(), form = f.form();
    const original = draft("Original unconfirmed creation"), newer = { ...draft("Different creation"), ...rawDraft("Newer creation") };
    f.fill(form, original); f.loseNextCreate = "transport"; await submitVisibleDeliveryForm(f); f.draw();
    const originalRequest = posts(f).at(-1).body, count = posts(f).length;
    assert.ok(deliveryTree(f).root.text.includes(f.i18n.t("delivery.retryOriginal")));
    f.fill(form, newer); await toggleDeliveryEditor(f, existing); const existingForm = f.decisionForm(existing);
    f.fill(existingForm, { ...f.currentFields(existingForm), ...rawDraft("Existing row") }); await toggleDeliveryEditor(f, existing);
    assert.equal(f.form(), form); assert.deepEqual(f.currentFields(form), newer);
    await submitVisibleDeliveryForm(f); f.draw();
    assert.equal(posts(f).length, count + 1); assert.deepEqual(posts(f).at(-1).body, originalRequest, "only the original key and frozen create fields were retried");
    assert.equal(f.decisions().length, 2); assert.equal(f.creationEvents().length, 2); assert.equal(patches(f).length, 0);
    assert.equal(f.form(), form); assert.deepEqual(f.currentFields(form), newer); assert.equal(f.currentFields(existingForm).title, rawDraft("Existing row").title);
    assert.ok(deliveryTree(f).root.text.includes(f.i18n.t("delivery.originalSavedDraftKept")));
    assert.deepEqual(f.financial(), financial); assert.deepEqual(f.external, []);
  });

  test(`${locale} same-owner live locale changes keep the selected native form and untouched exact save semantics`, async t => {
    const f = await fixture(t, "en"), a = await seed(f, "Milestone \u062e\u0637\u0648\u0629"), before = mutations(f).length;
    await toggleDeliveryEditor(f, a); const form = f.decisionForm(a), raw = { ...f.currentFields(form), ...rawDraft("Selected") }; f.fill(form, raw);
    setDeliveryLocale(f, locale); const tree = deliveryTree(f), current = assertOneEditor(tree, a);
    assert.equal(f.decisionForm(a), form); assert.deepEqual(f.currentFields(form), raw);
    const toggle = tree.visible("button").find(node => node.attributes["data-delivery-editor-toggle"] === a);
    assert.ok(toggle.text.includes(f.i18n.t("delivery.hideEditNamed", "", { name: "\u2068" + exactDecision(f, a).title + "\u2069" })));
    assert.equal(current.attributes["aria-labelledby"], "delivery-decision-title-" + encodeURIComponent(a));
    const statuses = tree.nodes.filter(node => node.tag === "option" && within(node, current) && node.parent?.attributes.name === "status").map(node => node.attributes.value);
    assert.deepEqual(statuses, ["planned", "running", "failed", "superseded"], "existing canonical transition/approval limits stay intact");
    assert.equal(mutations(f).length, before); await submitVisibleDeliveryForm(f, a);
    assert.equal(patches(f).length, 1); assert.equal(patches(f)[0].body.decisionId, a); assert.equal(patches(f)[0].body.title, raw.title);
    assert.equal(exactDecision(f, a).title, raw.title.trim()); assert.equal(f.formResets, 1, "only the original seeded create used reset");
    assert.deepEqual(f.external, []);
  });
}

for (const locale of ["en", "ja"]) test(`${locale} a qualified unavailable report hides old update fields without destroying the raw native draft`, async t => {
  const f = await fixture(t, locale), a = await seed(f, "Retained update A"), financial = f.financial();
  await toggleDeliveryEditor(f, a); const form = f.decisionForm(a), create = f.form(), raw = { ...f.currentFields(form), ...rawDraft("Unavailable A") };
  f.fill(form, raw); const before = mutations(f).length; let failed = false;
  f.deliver = async (call, response) => {
    if (!failed && call.method === "GET" && call.url === "/api/portfolio/product/delivery") {
      assert.equal(response.status, 200, "the current authorized report exists before its finite delivery failure"); failed = true;
      return Response.json({ error: "temporary_report_delivery" }, { status: 503 });
    }
    return response;
  };
  await f.refresh(); const unavailable = deliveryTree(f); assert.equal(failed, true);
  assert.equal(unavailable.visible("form").length, 0); assert.equal(unavailable.visible("button").some(node => Object.hasOwn(node.attributes, "data-delivery-editor-toggle")), false);
  assert.ok(unavailable.visible("button").some(node => node.handlers.click?.toString().includes("this.refresh")), "existing Refresh remains the useful current action");
  assert.equal(f.decisionForm(a), form); assert.equal(form.isConnected, true); assert.deepEqual(f.currentFields(form), raw); assert.equal(f.form(), create);
  await f.refresh(); const restored = deliveryTree(f); assertOneEditor(restored, a);
  assert.equal(f.decisionForm(a), form); assert.deepEqual(f.currentFields(form), raw); assert.equal(mutations(f).length, before);
  assert.deepEqual(f.financial(), financial); assert.deepEqual(f.external, []);
});

for (const retirement of ["route", "principal"]) test(`delivery ${retirement} retirement removes the old native editor and its unsaved presentation`, async t => {
  const f = await fixture(t, "en"), a = await seed(f, "Retired milestone"); await toggleDeliveryEditor(f, a);
  const form = f.decisionForm(a); f.fill(form, { ...f.currentFields(form), ...rawDraft("Retired private") }); const before = mutations(f).length;
  if (retirement === "route") { f.store.route.set("/product/insights"); f.emitWindow("popstate"); }
  else f.platformSession.reset();
  const withdrawn = deliveryTree(f); assert.equal(editForms(withdrawn).length, 0); assert.equal(form.isConnected, false);
  assert.equal(withdrawn.root.text.includes(rawDraft("Retired private").title), false); assert.equal(mutations(f).length, before);
  if (retirement === "route") {
    // This finite host reconnects; the separate full-Platform tests prove new-child ownership.
    f.host.isConnected = false; f.host.disconnectedCallback();
    f.store.route.set("/product/delivery"); f.emitWindow("popstate");
    f.host.isConnected = true; f.host.connectedCallback();
  }
  else await f.platformSession.load("product");
  await untilScene(() => deliveryTree(f).visible("button").some(node => node.attributes["data-delivery-editor-toggle"] === a), "fresh report restores the existing authorized row");
  assertCollapsed(deliveryTree(f), 1); await toggleDeliveryEditor(f, a);
  assert.notEqual(f.decisionForm(a), form); assert.equal(f.currentFields(f.decisionForm(a)).title, "Retired milestone");
  assert.equal(mutations(f).length, before); assert.deepEqual(f.external, []);
});

test("delivery hidden update forms explicitly override the inherited grid rule without adding an overlay", () => {
  const css = readFileSync(new URL("../src/apps/product/delivery.css", import.meta.url), "utf8");
  const inherited = readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  assert.match(inherited, /\.delivery-decision-form\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/u, "the mandatory B3 hidden-form supplement is composed once");
  assert.match(css, /\.delivery-planning\s+\.delivery-decision-list\[hidden\]\s*\{\s*display:\s*none\s*!important\s*;/u);
  assert.match(css, /\.delivery-editor-toggle\s*\{[^}]*white-space:\s*normal\s*;[^}]*overflow-wrap:\s*anywhere\s*;/u);
  assert.doesNotMatch(css, /position:\s*(?:fixed|absolute)|z-index|popover/iu);
});

// Current R3 integration composition: this adds assertions, preserving all 21
// original cases above. Actual native ownership comes from the shared update
// fixture; the original Worker acknowledgement contract is not substituted.
for (const locale of locales) test(locale + " hidden exact update preserves newer raw fields through ACK and exposes the existing Discard beside Save", async t => {
  const f = await fixture(t, locale), a = await seed(f, "Original current A"), b = await seed(f, "Other current B");
  await toggleDeliveryEditor(f, a);
  const formA = f.decisionForm(a), create = f.form();
  const submitted = { ...f.currentFields(formA), evidence: "Submitted A evidence", status: "running" };
  f.fill(formA, submitted);
  const entered = sceneDeferred(), gate = sceneDeferred(); let held = false;
  f.deliver = async (call, response) => {
    if (!held && call.method === "PATCH") {
      assert.equal(response.status, 200, "The unchanged actual Worker committed the original A update.");
      held = true; entered.resolve(); await gate.promise;
    }
    return response;
  };
  const pending = submitVisibleDeliveryForm(f, a);
  try {
    await entered.promise;
    const newer = { ...submitted, ...rawDraft("Later A"), status: "failed" };
    f.fill(formA, newer);
    const before = mutations(f).length, financial = f.financial();
    await toggleDeliveryEditor(f, a); await toggleDeliveryEditor(f, b);
    assert.equal(f.decisionForm(a), formA); assert.deepEqual(f.currentFields(formA), newer);
    gate.resolve(); await pending;
    assertOneEditor(deliveryTree(f), b);
    assert.equal(f.decisionForm(a), formA); assert.deepEqual(f.currentFields(formA), newer);
    assert.equal(f.form(), create, "The separate original create form remains the same owner.");
    assert.ok(deliveryRow(f, a).text.includes(f.i18n.t("delivery.updateSavedDraftKept")));
    assert.equal(formA.getAttribute("data-delivery-dirty"), "true");
    assert.equal(formA.getAttribute("data-delivery-revision"), exactDecision(f, a).updatedAt);
    await toggleDeliveryEditor(f, a);
    const tree = deliveryTree(f), current = assertOneEditor(tree, a);
    const peers = tree.visible("button").filter(node => within(node, current));
    assert.equal(peers.length, 2, "Dirty current editor exposes the existing Discard and Save only.");
    const discard = peers.find(node => node.text === f.i18n.t("delivery.discardDraft"));
    const save = peers.find(node => node.attributes.type === "submit");
    assert.ok(discard && save); assert.equal(discard.parent, save.parent);
    assert.equal(save.parent.tag, "forma-ui-cluster"); assert.ok(save.parent.component, "Actual shared Cluster is mounted.");
    assert.equal(save.parent.attributes.alignment, "stretch"); assert.equal(save.parent.attributes.gap, "small");
    assert.equal(Object.hasOwn(discard.attributes, "disabled"), false); assert.equal(Object.hasOwn(save.attributes, "disabled"), false);
    const record = f.updateRows().find(item => item.form === formA); assert.ok(record);
    await f.reloadUpdate(record);
    const saved = exactDecision(f, a);
    assert.deepEqual(f.currentFields(formA), { title: saved.title, ownerUserId: saved.ownerUserId ?? "", evidence: saved.evidence, status: saved.status });
    assert.equal(formA.getAttribute("data-delivery-dirty"), null);
    assert.equal(formA.getAttribute("data-delivery-revision"), saved.updatedAt);
    assert.equal(mutations(f).length, before, "Hide, reveal and explicit local discard issue no second mutation.");
    assert.deepEqual(f.financial(), financial); assert.deepEqual(f.external, []);
  } finally { gate.resolve(); await pending; }
});

test("delivery action peers reuse the documented full-width wrapping Cluster instead of separate form-grid cells", () => {
  const source = readFileSync(new URL("../src/apps/product/delivery.ts", import.meta.url), "utf8");
  const css = readFileSync(new URL("../src/apps/product/delivery.css", import.meta.url), "utf8");
  const shared = readFileSync(new URL("../src/design-system.css", import.meta.url), "utf8");
  const form = source.slice(source.indexOf('<form id='), source.indexOf('</form>', source.indexOf('<form id=')));
  assert.match(form, /<forma-ui-cluster class="delivery-editor-actions" alignment="stretch" gap="small">/u);
  assert.ok(form.indexOf("#reloadDecision") > form.indexOf("<forma-ui-cluster"));
  assert.ok(form.indexOf('type="submit"') > form.indexOf("#reloadDecision"));
  assert.ok(form.indexOf("</forma-ui-cluster>") > form.indexOf('type="submit"'));
  assert.match(css, /\.delivery-decision-list :is\(\.delivery-editor-note,\.delivery-editor-conflict,\.delivery-editor-actions\)\s*\{\s*grid-column:\s*1 \/ -1;\s*\}/u);
  assert.match(shared, /forma-ui-cluster\[alignment="stretch"\]\s*\{\s*align-items:\s*stretch;\s*\}/u);
  assert.match(shared, /forma-ui-cluster\s*\{[^}]*flex-wrap:\s*wrap;/u);
  assert.doesNotMatch(css, /overflow(?:-x|-y)?:\s*(?:hidden|clip)|white-space:\s*nowrap|(?:^|[;{])\s*(?:block-size|height):/u);
});

// Additive E2 resumption check. Keep all original 26 cases and their helpers.
// Reuse the existing complete protected snapshot; the density fixture's
// narrower three-table count is not presented as whole financial custody.
import { snapshot as retainedDeliverySnapshot } from "./helpers/product-delivery-owner-choice-fixture.mjs";

const retainedDeliveryResumeCopy = {
  en: "Resume editing {name}",
  fr: "Reprendre la modification de {name}",
  ar: "متابعة تعديل {name}",
  ja: "「{name}」の編集を再開",
};

for (const locale of locales) test(locale + " collapsed Delivery drafts identify their existing resume action through Save, newer ACK and explicit Discard", async t => {
  const f = await fixture(t, locale), a = await seed(f, "Same saved milestone"), b = await seed(f, "Same saved milestone");
  const ids = [a, b], before = retainedDeliverySnapshot(f), create = f.form(), createRaw = f.currentFields(create);
  const beforeMutations = mutations(f).length, beforePosts = posts(f).length, beforePatches = patches(f).length;
  const beforeCommitted = structuredClone(f.committed), beforeResets = f.formResets, states = [], acknowledgments = [];
  const capture = (stage, resumeIds, openId = "") => {
    const tree = deliveryTree(f);
    const rows = ids.map(id => {
      const matches = tree.visible("li").filter(node => node.attributes["data-delivery-decision-id"] === id);
      assert.equal(matches.length, 1, "Observe the current exact-ID row, not a remembered label.");
      const row = matches[0], headings = tree.visible("h2").filter(node => within(node, row));
      const toggles = tree.visible("button").filter(node => within(node, row) && node.attributes["data-delivery-editor-toggle"] === id);
      const forms = tree.nodes.filter(node => node.tag === "form" && within(node, row) && node.attributes["data-delivery-decision-id"] === id);
      assert.equal(headings.length, 1); assert.equal(toggles.length, 1); assert.equal(forms.length, 1);
      const toggle = toggles[0], named = "\u2068" + headings[0].text + "\u2069", editing = id === openId;
      assert.ok(toggle.port.isConnected && f.host.contains(toggle.port));
      assert.equal(toggle.attributes.type, "button");
      assert.equal(toggle.attributes["aria-controls"], "delivery-decision-edit-" + encodeURIComponent(id));
      assert.equal(toggle.attributes["aria-expanded"], String(editing));
      assert.equal(forms[0].hiddenBy === null, editing);
      assert.equal(Object.hasOwn(forms[0].attributes, "inert"), !editing);
      return { id, action: toggle.text, expected: editing
        ? f.i18n.t("delivery.hideEditNamed", "", { name: named })
        : resumeIds.includes(id) ? retainedDeliveryResumeCopy[locale].replace("{name}", named)
          : f.i18n.t("delivery.editNamed", "", { name: named }) };
    });
    assert.equal(new Set(rows.map(row => normalize(row.action))).size, 2, "The simultaneous authored-title collision stays visibly distinguished.");
    states.push({ stage, rows });
  };
  capture("pristine", []);
  await toggleDeliveryEditor(f, a);
  const formA = f.decisionForm(a), rawA = { ...f.currentFields(formA), ...rawDraft("Retained A"), status: "running" };
  f.fill(formA, rawA); await toggleDeliveryEditor(f, a); capture("A hidden", [a]);
  await toggleDeliveryEditor(f, b);
  const formB = f.decisionForm(b), rawB = { ...f.currentFields(formB), ...rawDraft("Retained B") };
  f.fill(formB, rawB); capture("B open, A retained", [a], b);
  await toggleDeliveryEditor(f, b); capture("both hidden", ids);
  assert.equal(f.decisionForm(a), formA); assert.deepEqual(f.currentFields(formA), rawA);
  assert.equal(f.decisionForm(b), formB); assert.deepEqual(f.currentFields(formB), rawB);
  assert.equal(mutations(f).length, beforeMutations, "Opening, editing and hiding have issued no save.");

  const entered = sceneDeferred(), release = sceneDeferred();
  let holdNext = false, held = false;
  f.deliver = async (call, response) => {
    if (call.method === "PATCH") {
      assert.equal(response.status, 200, "The unchanged RAM Worker acknowledged this exact deliberate update.");
      acknowledgments.push({ request: structuredClone(call.body), body: await response.clone().json() });
      if (holdNext && !held) { held = true; entered.resolve(); await release.promise; }
    }
    return response;
  };
  await toggleDeliveryEditor(f, a);
  const firstRevision = formA.getAttribute("data-delivery-revision");
  await submitVisibleDeliveryForm(f, a);
  assert.equal(acknowledgments.length, 1);
  assert.deepEqual(acknowledgments[0].request, { decisionId: a, ...rawA, expectedUpdatedAt: firstRevision });
  assert.equal(acknowledgments[0].body.decision.decisionId, a);
  assert.equal(formA.getAttribute("data-delivery-dirty"), null);
  assert.ok(deliveryRow(f, a).text.includes(f.i18n.t("delivery.saved")));
  await toggleDeliveryEditor(f, a); capture("A saved, B retained", [b]);

  await toggleDeliveryEditor(f, a);
  const submitted = { ...f.currentFields(formA), evidence: "Deliberately submitted second A evidence", status: "failed" };
  const secondRevision = formA.getAttribute("data-delivery-revision");
  f.fill(formA, submitted); holdNext = true;
  const pending = submitVisibleDeliveryForm(f, a);
  let newer;
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error("The second original update returned before its actual response hold."); })]);
    newer = { ...submitted, ...rawDraft("Newer A after submission") };
    f.fill(formA, newer); await toggleDeliveryEditor(f, b);
    capture("A pending with newer fields, B open", [a], b);
    release.resolve(); await pending;
    assert.equal(acknowledgments.length, 2);
    assert.deepEqual(acknowledgments[1].request, { decisionId: a, ...submitted, expectedUpdatedAt: secondRevision });
    assert.equal(acknowledgments[1].body.decision.decisionId, a);
    assert.equal(f.decisionForm(a), formA); assert.deepEqual(f.currentFields(formA), newer);
    assert.equal(f.decisionForm(b), formB); assert.deepEqual(f.currentFields(formB), rawB);
    assert.equal(formA.getAttribute("data-delivery-dirty"), "true");
    assert.equal(formA.getAttribute("data-delivery-revision"), acknowledgments[1].body.decision.updatedAt);
    assert.ok(deliveryRow(f, a).text.includes(f.i18n.t("delivery.updateSavedDraftKept")));
    capture("A acknowledged with newer draft, B open", [a], b);
  } finally { release.resolve(); await pending; }
  await toggleDeliveryEditor(f, b); capture("both hidden after exact ACK", ids);

  const discard = async (id, form) => {
    await toggleDeliveryEditor(f, id);
    const records = f.updateRows().filter(record => record.form === form);
    assert.equal(records.length, 1);
    await f.reloadUpdate(records[0]); // Existing visible Discard; no invented Cancel or reset.
    const saved = exactDecision(f, id);
    assert.equal(f.decisionForm(id), form);
    assert.deepEqual(f.currentFields(form), { title: saved.title, ownerUserId: saved.ownerUserId ?? "", evidence: saved.evidence, status: saved.status });
    assert.equal(form.getAttribute("data-delivery-dirty"), null);
    assert.equal(form.getAttribute("data-delivery-revision"), saved.updatedAt);
    await toggleDeliveryEditor(f, id);
  };
  await discard(a, formA); capture("A explicitly discarded, B retained", [b]);
  await discard(b, formB); capture("both explicitly resolved", []);
  const after = retainedDeliverySnapshot(f);
  for (const key of ["route", "session", "platformSession", "authorization", "source", "users", "grants", "creates", "receipts", "money"])
    assert.deepEqual(after[key], before[key], "Unchanged original protected " + key + " around the deliberate two updates.");
  assert.equal(after.decisions.length, before.decisions.length);
  assert.deepEqual(after.decisions.find(row => row.decision_id === b), before.decisions.find(row => row.decision_id === b));
  assert.equal(after.decisions.find(row => row.decision_id === a).title, submitted.title.trim());
  assert.equal(after.decisions.find(row => row.decision_id === a).evidence, submitted.evidence);
  assert.equal(after.decisions.find(row => row.decision_id === a).status, submitted.status);
  assert.deepEqual(after.updates.slice(0, before.updates.length), before.updates);
  assert.equal(after.updates.length, before.updates.length + 2);
  assert.equal(mutations(f).length, beforeMutations + 2); assert.equal(posts(f).length, beforePosts);
  assert.equal(patches(f).length, beforePatches + 2); assert.deepEqual(f.committed, beforeCommitted);
  assert.equal(f.form(), create); assert.deepEqual(f.currentFields(create), createRaw); assert.equal(f.formResets, beforeResets);
  assert.deepEqual(f.external, []);
  t.diagnostic("DELIVERY_RETAINED_DRAFT_ACTION " + JSON.stringify({ locale, states, deliberateUpdates: 2,
    limits: "Actual existing Delivery/native fields/RAM Worker and complete protected snapshot; no new control, live navigation, browser geometry, AT or persistent-draft guarantee." }));
  // The intended pre-runtime failure is the A-hidden named action, only after
  // the original real commands, ACKs, raw custody and complete fiscal checks.
  for (const state of states) for (const row of state.rows)
    assert.equal(row.action, row.expected, state.stage + ": the existing exact-ID action tells the user which editing draft can be resumed.");
});
