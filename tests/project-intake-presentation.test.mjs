import assert from "node:assert/strict";
import test from "node:test";
import { createProjectIntakeFixture } from "./helpers/project-intake-fixture.mjs";
import { readWorkspaceEvents } from "../worker/runtime.ts";
import { projectIntakeMessage } from "../src/components/design-system/locales/project-intake-messages.ts";

const values = { name: "Original project", documentTitle: "Original Document", objective: "  Exact outcome\nنص أصلي — 元の文章。  ",
  audience: "  Original audience  ", message: "  Original multiline message\nSecond line.  ", protectedPhrase: "Exact {phrase} — جملة — 台詞",
  deliverable: "  The author's requested output  ", boundary: "  No invented claims.  ", source: "  Owned passage\nExact second line.  " };
async function fixture(t, locale) {
  const base = await createProjectIntakeFixture(t, { locale, prepare: false });
  const { h, f, owner } = base, before = new Set(base.beforeEvents.map(event => event.eventId));
  const calls = () => h.requests.filter(request => request.body?.action === "project_intake");
  const button = text => f.find("button", node => node.owner === owner && node.text === text);
  const copy = key => projectIntakeMessage(locale, key);
  const form = () => f.find("form", node => node.owner === owner && String(node.attributes.class).split(" ").includes("project-intake"));
  const native = key => {
    if (key === "objective") return f.find("textarea", node => node.owner === owner && Object.hasOwn(node.attributes, "data-intake-outcome"));
    const fields = { name: f.i18n.t("projects.projectName", "Project name"), documentTitle: f.i18n.system("Document name"), protectedPhrase: f.i18n.system("Message") + " · " + f.i18n.system("Exact value") };
    if (fields[key]) return f.find("input", node => node.owner?.tag === "forma-ui-field" && node.owner.parentElement === owner && node.owner.label === fields[key]);
    const labels = { audience: "Who needs to use or approve it?", message: "What should remain with them?", deliverable: "What needs to be delivered?", boundary: "What must never appear?", source: "Owned or licensed source excerpt" };
    return f.find(["message", "source"].includes(key) ? "textarea" : "input", node => node.owner === owner && node.parent?.tag === "label" && node.parent.text.startsWith(f.i18n.system(labels[key])));
  };
  const type = async (key, value) => { const node = native(key); node.port.value = value; await f.act(node, "input"); };
  const disclosure = async key => {
    const summary = f.find("summary", node => node.owner === owner && node.text === copy(key)), details = summary.parent;
    details.port.open = true; await f.act(details, "toggle");
  };
  const rights = async checked => { const node = f.find("input", node => node.owner === owner && node.attributes.type === "checkbox"); node.port.checked = checked; await f.act(node, "change"); };
  const open = async () => { await f.act(f.find("button", node => node.owner?.tag === "forma-ui-button" && node.owner.parentElement === owner && node.owner.label === f.i18n.t("projects.new", "New project"))); };
  const next = async () => { const control = button(copy("continue")); assert.equal(Object.hasOwn(control.attributes, "disabled"), false); await f.act(form(), "submit", { submitter: control.port }); };
  const all = async () => {
    await open(); await type("objective", values.objective); await disclosure("addSource"); await type("source", values.source); await rights(true); await next();
    await type("name", values.name); await disclosure("details");
    for (const key of ["documentTitle", "audience", "message", "protectedPhrase", "deliverable", "boundary"]) await type(key, values[key]);
  };
  const create = async blank => { const control = button(blank ? copy("createBlank") : f.i18n.t("projects.createAction", "Create project")); await f.act(form(), "submit", { submitter: control.port }); };
  const added = async () => (await readWorkspaceEvents(h.worker.env, h.worker.streamId)).filter(event => !before.has(event.eventId));
  return { h, f, owner, calls, button, copy, form, native, type, disclosure, rights, open, next, all, create, added };
}
for (const locale of ["en", "fr", "ar", "ja"]) {
  test(`${locale} outcome-first review saves the existing nine-field builder without fabricated values`, { concurrency: false }, async t => {
    const x = await fixture(t, locale); await x.all(); assert.equal(x.calls().length, 0);
    for (const key of ["name", "documentTitle", "audience", "message", "protectedPhrase", "deliverable", "boundary"]) assert.equal(x.native(key).port.value, values[key]);
    await x.create(false); const events = await x.added(); assert.equal(x.calls().length, 1);
    assert.equal(events.filter(event => event.type === "ProjectCreated").length, 1); assert.equal(events.filter(event => event.type === "DocumentCreated").length, 1);
    const blocks = events.filter(event => event.type === "BlockCreated"), byType = type => blocks.find(event => event.payload.type === type).payload.properties;
    assert.equal(blocks.length, 6); assert.equal(byType("direction").text, values.objective.trim()); assert.equal(byType("audience").text, values.audience.trim());
    assert.equal(byType("message").text, values.message.trim() + "\n\nPreserve this line exactly: " + values.protectedPhrase);
    assert.equal(byType("message").exact_text, values.protectedPhrase); assert.equal(byType("format").text, values.deliverable.trim());
    assert.equal(byType("exclusion").text, values.boundary.trim()); assert.equal(byType("reference").text, values.source.trim());
    assert.equal(events.filter(event => event.type === "RightsAsserted").length, 1);
  });
  test(`${locale} Back/Close retain every field and explicit blank saves none of the retained brief`, { concurrency: false }, async t => {
    const x = await fixture(t, locale); await x.all(); await x.f.act(x.button(x.copy("back")));
    assert.equal(x.native("objective").port.value, values.objective); await x.f.act(x.button(x.f.i18n.t("action.cancel", "Cancel"))); await x.open();
    assert.equal(x.native("objective").port.value, values.objective); await x.disclosure("addSource"); assert.equal(x.native("source").port.value, values.source);
    await x.rights(false); await x.f.act(x.button(x.copy("blank"))); await x.disclosure("details");
    assert.equal(x.native("name").port.value, values.name); assert.equal(x.native("documentTitle").port.value, values.documentTitle);
    await x.f.act(x.button(x.copy("back"))); await x.rights(true); await x.next(); await x.disclosure("details");
    for (const key of ["name", "documentTitle", "audience", "message", "protectedPhrase", "deliverable", "boundary"]) assert.equal(x.native(key).port.value, values[key]);
    await x.f.act(x.button(x.copy("back"))); await x.rights(false); await x.f.act(x.button(x.copy("blank")));
    assert.equal(x.calls().length, 0); await x.create(true);
    const events = await x.added(); assert.deepEqual(events.filter(event => !["ProjectOpened", "DocumentOpened"].includes(event.type)).map(event => event.type), ["ProjectCreated", "DocumentCreated", "EmptyCanvasChosen"]);
  });
  test(`${locale} unasserted source and IME cannot cause a premature creation or discard authored input`, { concurrency: false }, async t => {
    const x = await fixture(t, locale); await x.open(); await x.type("objective", values.objective); await x.disclosure("addSource"); await x.type("source", values.source);
    assert.equal(Object.hasOwn(x.button(x.copy("continue")).attributes, "disabled"), true); assert.equal(x.calls().length, 0);
    await x.rights(true); await x.f.act(x.form(), "compositionstart");
    const outcome = x.native("objective"); outcome.port.value = values.objective + "未確定"; await x.f.act(outcome, "input");
    await x.f.act(x.form(), "submit"); assert.equal(x.calls().length, 0); assert.ok(x.native("objective"));
    await x.f.act(x.form(), "compositionend"); assert.equal(x.native("objective").port.value, values.objective + "未確定");
    await x.next(); assert.equal(x.calls().length, 0);
  });
}

// One additional scenario in the existing presentation family. Actual complete
// Projects/Shell/Store and its native form/disclosure ports; not physical AT.
test("en review outcome whitespace exposes correction and retains the original brief for a fresh Create", { concurrency: false }, async t => {
  const x = await fixture(t, "en"); await x.all();
  const source = x.h.store.captureSourceOwnership(), authorization = x.h.store.captureAuthorizationScope();
  const route = x.h.store.route.get(), head = x.h.store.head.get();
  const reviewOutcome = () => x.f.find("textarea", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-outcome-edit"));
  const create = () => x.button(x.f.i18n.t("projects.createAction", "Create project"));
  const disabled = node => Object.hasOwn(node.attributes, "disabled");
  const rawFields = ["name", "documentTitle", "audience", "message", "protectedPhrase", "deliverable", "boundary", "source"];
  const correction = "Enter an outcome before creating this project. Use Back to the outcome to edit it, or choose Start blank.";
  const corrections = () => x.f.tree().visible("p").filter(node => node.owner === x.owner && node.attributes.role === "status" && node.text === correction);
  assert.equal(route, "/projects"); assert.equal(x.owner.isConnected, true);
  assert.equal(x.f.components().filter(owner => owner.tag === "forma-projects").length, 1);
  assert.equal(x.owner.store, x.h.store); assert.equal(disabled(create()), false);
  assert.equal(reviewOutcome().port.value, values.objective);
  for (const key of rawFields) assert.equal(x.native(key).port.value, values[key]);
  assert.equal(x.calls().length, 0); assert.deepEqual(await x.added(), []);

  const whitespace = " \n\t ";
  const field = reviewOutcome(); field.port.value = whitespace; await x.f.act(field, "input");
  assert.equal(reviewOutcome().port.value, whitespace);
  for (const key of rawFields) assert.equal(x.native(key).port.value, values[key]);
  // Use the current native DETAILS toggle; no hidden-control activation.
  const details = x.f.find("summary", node => node.owner === x.owner && node.text === x.copy("details")).parent;
  assert.equal(details.port.open, true); details.port.open = false; await x.f.act(details, "toggle");
  assert.equal(x.f.tree().visible("textarea").some(node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-outcome-edit")), false);
  const enabledBefore = !disabled(create());
  // Baseline's enabled button reaches the original submit listener. A repaired
  // disabled button is never activated by this fixture.
  if (enabledBefore) await x.f.act(x.form(), "submit", { submitter: create().port });
  assert.equal(x.owner.isConnected, true); assert.equal(x.f.components().includes(x.owner), true);
  assert.equal(x.h.store.route.get(), route); assert.equal(x.h.store.head.get(), head);
  assert.equal(x.h.store.sourceOwnershipActive(source), true); assert.equal(x.h.store.authorizationScopeActive(authorization), true);
  assert.equal(x.calls().length, 0); assert.deepEqual(await x.added(), []);
  t.diagnostic(JSON.stringify({ phase: "review-whitespace", enabledBefore, enabledAfter: !disabled(create()),
    correctionCount: corrections().length, intakeRequests: x.calls().length, sameOwner: x.f.components().includes(x.owner), route: x.h.store.route.get() }));
  assert.equal(disabled(create()), true, "A required whitespace outcome must not leave an enabled silent Create");
  const messages = corrections();
  assert.equal(messages.length, 1, "Visible localized correction remains available even when More brief details is closed");
  assert.ok(messages[0].attributes.id, "The correction has a real native description identity");
  const currentFields = x.f.tree().nodes.filter(node => node.owner === x.owner && node.tag === "textarea" && Object.hasOwn(node.attributes, "data-intake-outcome-edit"));
  assert.equal(currentFields.length, 1); assert.equal(currentFields[0].port.isConnected, true);
  assert.equal(currentFields[0].port.value, whitespace); assert.equal(currentFields[0].attributes["aria-invalid"], "true");
  assert.ok(String(currentFields[0].attributes["aria-describedby"] ?? "").split(/\s+/u).includes(messages[0].attributes.id), "The responsible field is associated with that same visible correction");
  const back = x.button(x.copy("back")); assert.equal(disabled(back), false); await x.f.act(back);
  assert.equal(x.native("objective").port.isConnected, true); assert.equal(disabled(x.native("objective")), false);
  assert.equal(x.native("objective").port.value, whitespace, "Actual Back exposes the retained responsible field without manufacturing an outcome");
  await x.type("objective", values.objective); await x.next(); await x.disclosure("details");
  assert.equal(reviewOutcome().port.value, values.objective);
  for (const key of rawFields) assert.equal(x.native(key).port.value, values[key]);
  assert.equal(disabled(create()), false); assert.equal(corrections().length, 0);
  assert.notEqual(reviewOutcome().attributes["aria-invalid"], "true");
  assert.equal(x.calls().length, 0); assert.deepEqual(await x.added(), []);
  await x.create(false);
  const events = await x.added(), blocks = events.filter(event => event.type === "BlockCreated");
  assert.equal(x.calls().length, 1, "Only the fresh explicit valid Create dispatches the original builder");
  assert.equal(events.filter(event => event.type === "ProjectCreated").length, 1);
  assert.equal(events.filter(event => event.type === "DocumentCreated").length, 1);
  assert.equal(events.find(event => event.type === "ProjectCreated").payload.name, values.name);
  assert.equal(events.find(event => event.type === "DocumentCreated").payload.title, values.documentTitle);
  const byType = type => blocks.find(event => event.payload.type === type).payload.properties;
  assert.equal(blocks.length, 6); assert.equal(byType("direction").text, values.objective.trim());
  assert.equal(byType("audience").text, values.audience.trim());
  assert.equal(byType("message").text, values.message.trim() + "\n\nPreserve this line exactly: " + values.protectedPhrase);
  assert.equal(byType("message").exact_text, values.protectedPhrase);
  assert.equal(byType("format").text, values.deliverable.trim()); assert.equal(byType("exclusion").text, values.boundary.trim());
  assert.equal(byType("reference").text, values.source.trim()); assert.equal(events.filter(event => event.type === "RightsAsserted").length, 1);
});

// Actual existing Projects/Shell/Store/Worker with finite native input/details
// ports. Review copy only: no Create, Save, provider request or physical geometry.
import { financial as dIntakeReviewFinancial } from "./helpers/event-source-retirement-fixture.mjs";
import { OUTCOME_RECIPE_MESSAGES as D_INTAKE_REVIEW_RECIPES } from "../src/components/design-system/locales/outcome-recipe-messages.ts";
import { outcomeRecipeDraftLabels as dIntakeReviewDraftLabels } from "../src/components/design-system/locales/outcome-recipe-draft-messages.ts";

for (const [locale, recipeId, files] of [
  ["en", "executive-deck", ["deck"]],
  ["ja", "campaign", ["campaign-image", "campaign-audio"]],
]) {
  test(locale + " recipe review shows an identical outcome once and retains distinct authored deliverables", { concurrency: false }, async t => {
    const x = await fixture(t, locale);
    // A native text INPUT can retain spaces but sanitizes line breaks. The
    // original presentation13 and handoff23 retain their multiline coverage.
    const rawOutcome = "  Exact outcome — نص أصلي — 元の文章。  ";
    const receipts = x.h.worker.sqlite.prepare("SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY rowid");
    const before = { source: x.h.store.captureSourceOwnership(), authorization: x.h.store.captureAuthorizationScope(),
      route: x.h.store.route.get(), head: x.h.store.head.get(), events: x.h.store.events.get(),
      content: x.h.store.content.get(), session: x.h.store.session.get(), requests: x.h.requests.length,
      history: await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId),
      receipts: receipts.all(x.h.worker.streamId), money: dIntakeReviewFinancial(x.h.worker),
      receiptAppend: x.h.store.appendBatchWithReceipt };
    await x.open(); await x.type("objective", rawOutcome); await x.disclosure("addSource");
    await x.type("source", values.source); await x.rights(true); await x.disclosure("recipe");
    const select = x.f.find("select", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-choice"));
    select.port.value = recipeId; await x.f.act(select, "change");
    for (const key of files) {
      const choice = x.f.find("input", node => node.owner === x.owner && node.attributes["data-intake-recipe-file"] === key);
      choice.port.checked = true; await x.f.act(choice, "change");
    }
    await x.next(); await x.type("name", values.name);
    const variants = [
      { name: "outcome fallback", deliverable: "", expected: [] },
      { name: "distinct deliverable", deliverable: values.deliverable, expected: [values.deliverable] },
      { name: "whitespace-different deliverable", deliverable: rawOutcome + " ", expected: [rawOutcome + " "] },
      { name: "explicitly identical deliverable", deliverable: rawOutcome, expected: [] },
    ], observed = [];
    for (const [index, variant] of variants.entries()) {
      if (index) {
        await x.disclosure("details"); await x.type("deliverable", variant.deliverable);
        assert.equal(x.native("deliverable").port.value, variant.deliverable);
        const details = x.f.find("summary", node => node.owner === x.owner && node.text === x.copy("details")).parent;
        assert.equal(details.port.open, true); details.port.open = false; await x.f.act(details, "toggle");
      }
      // All structural ancestry below comes from this ONE actual render tree.
      const tree = x.f.tree();
      const reviews = tree.visible("section").filter(node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-review"));
      const outcomes = tree.visible("dd").filter(node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-outcome-review"));
      assert.equal(reviews.length, 1); assert.equal(outcomes.length, 1);
      const review = reviews[0], outcome = outcomes[0], summary = outcome.parent;
      assert.equal(review.port.isConnected, true); assert.equal(outcome.port.isConnected, true);
      assert.equal(summary.tag, "dl"); assert.equal(review.parent, summary.parent);
      const terms = summary.children.filter(child => typeof child !== "string" && child.tag === "dt");
      const definitions = summary.children.filter(child => typeof child !== "string" && child.tag === "dd");
      assert.deepEqual(terms.map(node => node.text), [x.copy("outcome"), x.f.i18n.system("Owned or licensed source excerpt"), x.copy("sourceRights")]);
      assert.equal(definitions.length, 3); assert.equal(definitions[0], outcome);
      for (const node of definitions) assert.equal(node.children.every(child => typeof child === "string"), true);
      assert.deepEqual(definitions.map(node => node.children.join("")), [rawOutcome, values.source, x.copy("rightsAsserted")]);
      assert.equal(outcome.attributes.dir, "auto");
      const headings = review.children.filter(child => typeof child !== "string" && child.tag === "h3");
      assert.equal(headings.length, 1); assert.equal(headings[0].text, D_INTAKE_REVIEW_RECIPES[locale].recipesById[recipeId].title);
      const lists = review.children.filter(child => typeof child !== "string" && child.tag === "ul");
      assert.equal(lists.length, 1);
      assert.deepEqual(lists[0].children.filter(child => typeof child !== "string").map(node => [node.tag, node.text]),
        files.map(key => ["li", dIntakeReviewDraftLabels(locale, "").choices[key]]));
      const paragraphs = review.children.filter(child => typeof child !== "string" && child.tag === "p");
      const hints = paragraphs.filter(node => node.attributes.dir !== "auto"), authored = paragraphs.filter(node => node.attributes.dir === "auto");
      assert.equal(hints.length, 1); assert.equal(hints[0].text, x.copy("recipeHint"), "The no-generation/no-save/no-plan explanation remains");
      for (const node of authored) assert.equal(node.children.every(child => typeof child === "string"), true);
      const rawParagraphs = authored.map(node => node.children.join(""));
      if (variant.expected.length) assert.deepEqual(rawParagraphs, variant.expected, "Distinct raw wording must remain before checking duplicate suppression");
      const fields = tree.nodes.filter(node => node.owner === x.owner && node.tag === "input"
        && node.parent?.tag === "label" && node.parent.text.startsWith(x.f.i18n.system("What needs to be delivered?")));
      assert.equal(fields.length, 1); assert.ok(fields[0].hiddenBy, "The authored field is retained inside the actually closed Details");
      assert.equal(fields[0].port.value, variant.deliverable);
      const outcomeFields = tree.nodes.filter(node => node.owner === x.owner && node.tag === "textarea" && Object.hasOwn(node.attributes, "data-intake-outcome-edit"));
      assert.equal(outcomeFields.length, 1); assert.equal(outcomeFields[0].port.value, rawOutcome);
      assert.equal(x.native("name").port.value, values.name);
      assert.equal(Object.hasOwn(x.button(x.f.i18n.t("projects.createAction", "Create project")).attributes, "disabled"), false);
      assert.equal(x.form().attributes["aria-busy"], "false");
      // Establish unchanged authority, private/canonical data, receipts and cost
      // BEFORE either expected baseline duplicate assertion can fail.
      assert.equal(x.owner.isConnected, true); assert.equal(x.f.components().filter(owner => owner.tag === "forma-projects").length, 1);
      assert.equal(x.owner.store, x.h.store); assert.equal(x.h.store.route.get(), before.route); assert.equal(before.route, "/projects");
      assert.equal(x.h.store.head.get(), before.head); assert.equal(x.h.store.events.get(), before.events);
      assert.equal(x.h.store.content.get(), before.content); assert.equal(x.h.store.session.get(), before.session);
      assert.equal(x.h.store.sourceOwnershipActive(before.source), true); assert.equal(x.h.store.authorizationScopeActive(before.authorization), true);
      assert.equal(x.h.store.appendBatchWithReceipt, before.receiptAppend);
      assert.equal(x.h.requests.length, before.requests); assert.equal(x.calls().length, 0);
      assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), before.history);
      assert.deepEqual(receipts.all(x.h.worker.streamId), before.receipts);
      assert.deepEqual(dIntakeReviewFinancial(x.h.worker), before.money);
      observed.push({ name: variant.name, rawParagraphs });
    }
    t.diagnostic(JSON.stringify({ phase: "recipe-review-raw-copy", locale, recipeId,
      variants: observed.map(row => ({ name: row.name, authoredParagraphs: row.rawParagraphs.length })),
      intakeRequests: x.calls().length, sameOwner: x.f.components().includes(x.owner), route: x.h.store.route.get() }));
    assert.deepEqual(observed, variants.map(variant => ({ name: variant.name, rawParagraphs: variant.expected })),
      "Exactly identical recipe wording appears once in the labelled outcome; distinct authored deliverables remain byte-for-byte");
  });
}

// Append after the exact original presentation13 + XP review2 prefix. Reuse
// its complete Projects/Shell/Store/Worker, field helpers and native ancestry.
// These are finite controls, not physical focus, layout, browser or AT proof.
import { financial as dIntakeDiscardFinancial } from "./helpers/event-source-retirement-fixture.mjs";
import { sceneDeferred as dIntakeDiscardDeferred, untilScene as dIntakeDiscardUntil,
  assertComplete as dIntakeDiscardComplete } from "./helpers/project-intake-fixture.mjs";

const D_INTAKE_DISCARD_LABELS = {
  en: "Discard draft and close", fr: "Abandonner le brouillon et fermer",
  ar: "حذف المسودة وإغلاق النافذة", ja: "下書きを破棄して閉じる",
};
const dIntakeDiscardOptions = { concurrency: false, timeout: 90000 };
const dIntakeDiscardClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const dIntakeDiscardControls = x => x.f.tree().visible("button").filter(node => node.owner === x.owner
  && Object.hasOwn(node.attributes, "data-intake-discard"));
const dIntakeDiscardModal = x => x.f.tree().visible("dialog").filter(node => node.owner === x.owner
  && dIntakeDiscardClass(node, "project-create-dialog"));
function dIntakeDiscardControl(x) {
  const controls = dIntakeDiscardControls(x);
  assert.equal(controls.length, 1, "A meaningful, unattempted draft has one explicit local discard in this opening");
  const node = controls[0];
  assert.equal(node.attributes.type, "button"); assert.equal(node.attributes.class, "button ghost");
  assert.equal(node.text, D_INTAKE_DISCARD_LABELS[x.f.locale]);
  assert.equal(node.parent.tag, "footer"); assert.equal(node.parent.parent.tag, "form");
  assert.equal(dIntakeDiscardClass(node.parent.parent, "project-intake"), true);
  assert.equal(node.parent.parent.parent.tag, "dialog"); assert.equal(node.port.isConnected, true);
  assert.equal(node.port.closest("form"), x.form().port);
  assert.equal(node.port.closest("forma-projects"), x.owner);
  return node;
}
const dIntakeDiscardReceipts = x => x.h.worker.sqlite.prepare(
  "SELECT * FROM event_client_receipts WHERE stream_id=? ORDER BY rowid").all(x.h.worker.streamId);
async function dIntakeDiscardBefore(x) {
  return { route: x.h.store.route.get(), head: x.h.store.head.get(), source: x.h.store.captureSourceOwnership(),
    authorization: x.h.store.captureAuthorizationScope(), session: x.h.store.session.get(), events: x.h.store.events.get(),
    content: x.h.store.content.get(), requests: x.h.requests.length, append: x.h.store.appendBatchWithReceipt,
    history: await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), receipts: dIntakeDiscardReceipts(x),
    financial: dIntakeDiscardFinancial(x.h.worker) };
}
async function dIntakeDiscardUnchanged(x, before) {
  assert.equal(x.owner.isConnected, true); assert.equal(x.owner.store, x.h.store);
  assert.equal(x.f.components().filter(owner => owner.tag === "forma-projects").length, 1);
  assert.equal(x.h.store.route.get(), before.route); assert.equal(x.h.store.head.get(), before.head);
  assert.equal(x.h.store.sourceOwnershipActive(before.source), true);
  assert.equal(x.h.store.authorizationScopeActive(before.authorization), true);
  assert.equal(x.h.store.session.get(), before.session); assert.equal(x.h.store.events.get(), before.events);
  assert.equal(x.h.store.content.get(), before.content); assert.equal(x.h.store.appendBatchWithReceipt, before.append);
  assert.equal(x.h.requests.length, before.requests, "Typing, dismissal and local discard are not HTTP operations");
  assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), before.history);
  assert.deepEqual(dIntakeDiscardReceipts(x), before.receipts); assert.deepEqual(dIntakeDiscardFinancial(x.h.worker), before.financial);
}
async function dIntakeDiscardRecipe(x, id = "executive-deck", files = ["deck"]) {
  await x.disclosure("recipe");
  const select = x.f.find("select", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-choice"));
  select.port.value = id; await x.f.act(select, "change");
  for (const key of files) {
    const choice = x.f.find("input", node => node.owner === x.owner && node.attributes["data-intake-recipe-file"] === key);
    choice.port.checked = true; await x.f.act(choice, "change");
  }
}
function dIntakeDiscardRawIntent(x) {
  assert.equal(x.native("objective").port.value, values.objective);
  assert.equal(x.native("source").port.value, values.source);
  const rights = x.f.find("input", node => node.owner === x.owner && node.attributes.type === "checkbox"
    && !Object.hasOwn(node.attributes, "data-intake-recipe-file"));
  assert.equal(rights.port.checked, true);
  const recipe = x.f.find("select", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-choice"));
  assert.equal(recipe.port.value, "executive-deck");
  const file = x.f.find("input", node => node.owner === x.owner && node.attributes["data-intake-recipe-file"] === "deck");
  assert.equal(file.port.checked, true);
}
async function dIntakeDiscardCancel(x) {
  await x.f.act(x.button(x.f.i18n.t("action.cancel", "Cancel")));
  assert.equal(dIntakeDiscardModal(x).length, 0);
}
async function dIntakeDiscardExplore(x) {
  const link = x.f.find("a", node => node.owner?.tag === "forma-ui-audience-navigation"
    && new URL(String(node.attributes.href), "http://localhost").pathname === "/library");
  const href = String(link.attributes.href);
  await x.f.act(link, "click", { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false });
  return href;
}
async function dIntakeDiscardPristineReopen(x) {
  await x.open(); assert.equal(x.native("objective").port.value, "");
  assert.equal(dIntakeDiscardControls(x).length, 0, "An empty opening does not gain a redundant destructive action");
  const details = x.f.tree().nodes.filter(node => node.owner === x.owner && node.tag === "details");
  assert.ok(details.length >= 2); assert.equal(details.every(node => !node.open), true);
  await x.disclosure("addSource"); assert.equal(x.native("source").port.value, "");
  // A temporary native input reveals the existing conditional rights field.
  // It is removed again; no stale assertion may be inherited by a new passage.
  await x.type("source", "Fresh unsent rights probe");
  const rights = x.f.find("input", node => node.owner === x.owner && node.attributes.type === "checkbox");
  assert.equal(rights.port.checked, false); await x.type("source", "");
  await x.disclosure("recipe");
  const recipe = x.f.find("select", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-choice"));
  assert.equal(recipe.port.value, "");
  assert.equal(x.f.tree().nodes.some(node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-recipe-file")), false);
  // Use the existing review route to inspect all otherwise hidden fields;
  // this temporary unsent outcome is deliberately cleared before departure.
  await x.type("objective", "Fresh unsent field probe"); await x.next(); await x.disclosure("details");
  for (const key of ["name", "documentTitle", "audience", "message", "protectedPhrase", "deliverable", "boundary", "source"])
    assert.equal(x.native(key).port.value, "", "Discard also clears retained hidden " + key);
  const outcome = x.f.find("textarea", node => node.owner === x.owner && Object.hasOwn(node.attributes, "data-intake-outcome-edit"));
  outcome.port.value = ""; await x.f.act(outcome, "input");
  assert.equal(dIntakeDiscardControls(x).length, 0); await dIntakeDiscardCancel(x);
  assert.equal(x.owner.captureCommandDeparture().blocked(), false);
}
async function dIntakeDiscardActivate(x) {
  const control = dIntakeDiscardControl(x), closeCount = x.f.trace.filter(value => value === "close:modal project-create-dialog").length;
  assert.equal(Object.hasOwn(control.attributes, "disabled"), false); await x.f.act(control);
  assert.equal(dIntakeDiscardModal(x).length, 0); assert.equal(x.h.store.route.get(), "/projects");
  assert.equal(x.owner.captureCommandDeparture().blocked(), false);
  assert.equal(x.f.trace.filter(value => value === "close:modal project-create-dialog").length, closeCount + 1,
    "The action reuses native dialog.close; this finite port does not certify UA focus restoration");
}
function dIntakeDiscardReplay(captured, target = captured.port) {
  return captured.handlers.click.call(captured.owner, { type: "click", target, currentTarget: target, preventDefault() {}, stopPropagation() {} });
}

for (const [locale, posture] of [["en", "intent"], ["fr", "review"], ["ar", "blank-review"], ["ja", "intent"]]) {
  test(locale + " explicit local intake discard resolves a retained " + posture + " without creating or changing Cancel", dIntakeDiscardOptions, async t => {
    const x = await fixture(t, locale), before = await dIntakeDiscardBefore(x);
    await x.open(); assert.equal(dIntakeDiscardControls(x).length, 0); await dIntakeDiscardCancel(x);
    assert.equal(x.owner.captureCommandDeparture().blocked(), false);
    await x.all(); await x.f.act(x.button(x.copy("back"))); await dIntakeDiscardRecipe(x);
    dIntakeDiscardRawIntent(x);
    if (posture === "review") await x.next();
    if (posture === "blank-review") await x.f.act(x.button(x.copy("blank")));
    await dIntakeDiscardCancel(x); assert.equal(x.owner.captureCommandDeparture().blocked(), true);
    await dIntakeDiscardExplore(x);
    assert.equal(x.h.store.route.get(), "/projects", "Normal navigation continues protecting the retained unsent draft");
    assert.equal(x.h.store.ui.toast, x.f.i18n.t("next.lifecycle.currentWorkOpen"));
    await x.open(); assert.equal(x.calls().length, 0); await dIntakeDiscardUnchanged(x, before);
    // The complete current refusal/retention/no-effects path above precedes
    // the first desired missing-affordance assertion on the old runtime.
    dIntakeDiscardControl(x);
    if (posture === "intent") dIntakeDiscardRawIntent(x);
    else assert.equal(x.native("name").port.value, values.name);
    await dIntakeDiscardActivate(x); await dIntakeDiscardUnchanged(x, before);
    await dIntakeDiscardPristineReopen(x); await dIntakeDiscardUnchanged(x, before);
    const destination = await dIntakeDiscardExplore(x);
    assert.equal(x.h.store.route.get(), destination, "Only the user's fresh ordinary Explore gesture now navigates");
    assert.equal(x.calls().length, 0);
    assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), before.history);
    assert.deepEqual(dIntakeDiscardReceipts(x), before.receipts); assert.deepEqual(dIntakeDiscardFinancial(x.h.worker), before.financial);
    t.diagnostic(JSON.stringify({ locale, posture, nativeDiscardClose: true, originalCancelRetained: true,
      rawFieldsRightsAndRecipeReset: true, freshExplore: destination, intakeRequests: x.calls().length,
      evidence: "finite actual controls; physical native focus/geometry remains separate" }));
  });
}

for (const residue of ["whitespace", "unasserted-source", "hidden-rights", "recipe-without-files"]) {
  test("en local intake discard reaches otherwise non-reviewable residue: " + residue, dIntakeDiscardOptions, async t => {
    const x = await fixture(t, "en"), before = await dIntakeDiscardBefore(x); await x.open();
    if (residue === "whitespace") await x.type("objective", " \n\t ");
    if (residue === "unasserted-source" || residue === "hidden-rights") {
      await x.disclosure("addSource"); await x.type("source", values.source);
      if (residue === "hidden-rights") { await x.rights(true); await x.type("source", ""); }
    }
    if (residue === "recipe-without-files") await dIntakeDiscardRecipe(x, "executive-deck", []);
    assert.equal(Object.hasOwn(x.button(x.copy("continue")).attributes, "disabled"), true);
    await dIntakeDiscardCancel(x); assert.equal(x.owner.captureCommandDeparture().blocked(), true);
    await x.open(); await dIntakeDiscardUnchanged(x, before);
    await dIntakeDiscardActivate(x); await dIntakeDiscardUnchanged(x, before);
    await dIntakeDiscardPristineReopen(x); await dIntakeDiscardUnchanged(x, before);
  });
}

test("ja active composition cannot turn a previously enabled discard into loss of unfinished input", dIntakeDiscardOptions, async t => {
  const x = await fixture(t, "ja"), before = await dIntakeDiscardBefore(x);
  await x.open(); await x.type("objective", values.objective); await dIntakeDiscardUnchanged(x, before);
  const discard = dIntakeDiscardControl(x), form = x.form(), outcome = x.native("objective");
  // Deliver existing native listeners synchronously before a render: the
  // button's old enabled attribute cannot stand in for current IME admission.
  form.handlers.compositionstart.call(form.owner, { type: "compositionstart", target: outcome.port, currentTarget: form.port });
  outcome.port.value = values.objective + "未確定";
  outcome.handlers.input.call(outcome.owner, { type: "input", target: outcome.port, currentTarget: outcome.port, isComposing: true });
  assert.equal(discard.port.isConnected, true); await dIntakeDiscardReplay(discard); await x.f.settle();
  assert.equal(dIntakeDiscardModal(x).length, 1); assert.equal(x.native("objective").port.value, values.objective + "未確定");
  assert.equal(Object.hasOwn(dIntakeDiscardControl(x).attributes, "disabled"), true);
  await dIntakeDiscardUnchanged(x, before); await x.f.act(x.form(), "compositionend");
  assert.equal(x.native("objective").port.value, values.objective + "未確定");
  await dIntakeDiscardActivate(x); await dIntakeDiscardUnchanged(x, before);
});

test("en an old discard EventPart cannot abandon a later opening even with its current native button", dIntakeDiscardOptions, async t => {
  const x = await fixture(t, "en"), before = await dIntakeDiscardBefore(x);
  await x.open(); await x.type("objective", values.objective); await dIntakeDiscardUnchanged(x, before);
  const old = dIntakeDiscardControl(x); await dIntakeDiscardCancel(x); await x.open();
  const newerRaw = values.objective + "\nNewer unsent work"; await x.type("objective", newerRaw);
  const current = dIntakeDiscardControl(x); assert.notEqual(current.port, old.port); assert.equal(old.port.isConnected, false);
  await dIntakeDiscardReplay(old); await dIntakeDiscardReplay(old, current.port); await x.f.settle();
  assert.equal(dIntakeDiscardModal(x).length, 1); assert.equal(x.native("objective").port.value, newerRaw);
  await dIntakeDiscardUnchanged(x, before);
  await dIntakeDiscardActivate(x); await dIntakeDiscardUnchanged(x, before);
});

test("en actual Source withdrawal invalidates local discard custody and restoration needs a new opening", dIntakeDiscardOptions, async t => {
  const x = await fixture(t, "en"); await x.open(); await x.type("objective", values.objective);
  const before = await dIntakeDiscardBefore(x), old = dIntakeDiscardControl(x);
  const env = x.h.worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), policy = env[key], intercept = x.h.intercept;
  const restore = () => { if (had) env[key] = policy; else delete env[key]; };
  let denied = 0;
  env[key] = "synthetic-intake-discard-source-cohort";
  x.h.intercept = async request => {
    if (request.url.startsWith("/api/events?") && (request.init.method ?? "GET") === "GET") {
      const response = await x.h.worker.request(request.url, request.init); assert.equal(response.status, 403);
      assert.equal((await response.clone().json()).error, "pilot_participant_required"); denied++; return response;
    }
    return intercept(request);
  };
  try {
    await assert.rejects(x.h.store.refreshEvents({ fromStart: true }), /Event stream returned 403/u); await x.f.settle();
    assert.equal(denied, 1); assert.equal(x.h.store.sourceOwnershipActive(before.source), false);
    assert.equal(x.h.store.authorizationScopeActive(before.authorization), true);
    assert.equal(dIntakeDiscardModal(x).length, 0); assert.equal(x.f.renderer.markup.includes(values.objective.trim()), false);
    await dIntakeDiscardReplay(old); assert.equal(dIntakeDiscardModal(x).length, 0);
    x.h.intercept = intercept; restore(); await x.h.store.refreshSession(); await x.h.store.refreshEvents(); await x.f.settle();
    assert.equal(dIntakeDiscardModal(x).length, 0, "Restoration never automatically opens or discards retained work");
    await x.open(); assert.equal(x.native("objective").port.value, values.objective);
    const current = dIntakeDiscardControl(x), restored = await dIntakeDiscardBefore(x);
    await dIntakeDiscardReplay(old, current.port); await x.f.settle();
    assert.equal(x.native("objective").port.value, values.objective); assert.equal(dIntakeDiscardModal(x).length, 1);
    await dIntakeDiscardUnchanged(x, restored); await dIntakeDiscardActivate(x); await dIntakeDiscardUnchanged(x, restored);
    assert.deepEqual(await readWorkspaceEvents(x.h.worker.env, x.h.worker.streamId), before.history);
    assert.deepEqual(dIntakeDiscardReceipts(x), before.receipts); assert.deepEqual(dIntakeDiscardFinancial(x.h.worker), before.financial);
  } finally { x.h.intercept = intercept; restore(); }
});

test("en pending, unresolved and confirmed original creation never exposes local draft discard", dIntakeDiscardOptions, async t => {
  const x = await createProjectIntakeFixture(t), released = dIntakeDiscardDeferred();
  const stale = dIntakeDiscardControls(x)[0] ?? null; let original = null;
  x.setBehavior(async (stage, row) => {
    if (stage === "after-worker" && !original) {
      dIntakeDiscardComplete(row); original = row; await released.promise;
      row.dropped = true; throw Error("Synthetic lost response only after actual original intake commit");
    }
  });
  const pending = x.submit();
  try {
    await dIntakeDiscardUntil(() => original !== null, "Actual original Worker commit is held before delivery"); await x.f.settle();
    const body = structuredClone(original.body), canonical = await x.canonical();
    assert.equal(canonical.delta.length, 4); assert.equal(x.visible().submitting, "true");
    assert.equal(dIntakeDiscardControls(x).length, 0);
    if (stale) { await dIntakeDiscardReplay(stale); await x.f.settle(); }
    assert.equal(x.visible().submitting, "true"); assert.equal(x.visible().editable, false);
    assert.equal(x.dispatches.length, 1); assert.deepEqual(await x.canonical(), canonical);
    released.resolve(); await pending; await x.f.settle(); x.setBehavior(async () => {});
    assert.equal(x.visible().submitting, "false"); assert.equal(x.visible().editable, false);
    assert.equal(dIntakeDiscardControls(x).length, 0); assert.deepEqual(original.body, body);
    assert.equal(x.h.store.route.get(), "/projects"); assert.equal(x.dispatches.length, 1);
    // Reuse the original-unavailable family's actual RAM removal and original
    // Check. This is declared setup, not an effect of the local discard action.
    const ids = dIntakeDiscardComplete(original);
    const response = await x.worker.request("/api/events", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "append", event: { type: "DocumentRemoved", payload: { project_id: ids.projectId, document_id: ids.documentId } } }) });
    assert.equal(response.status, 200); const removal = await response.json();
    assert.ok(removal.appended.some(event => event.type === "DocumentRemoved" && event.payload.document_id === ids.documentId));
    const removedCanonical = await x.canonical(); await x.check(); await x.f.settle();
    assert.equal(x.dispatches.length, 2); assert.equal(x.dispatches[1].body.intakeAction, "check");
    assert.deepEqual(x.dispatches[1].body.events, body.events); assert.deepEqual(x.dispatches[1].reply.appended, original.reply.appended);
    assert.equal(x.h.store.route.get(), "/projects"); assert.equal(x.visible().editable, false);
    assert.equal(dIntakeDiscardControls(x).length, 0);
    assert.ok(x.f.tree().visible("p").some(node => node.owner === x.owner && node.attributes.role === "status"
      && node.text === x.f.i18n.t("projects.originalConfirmedUnavailable")));
    assert.deepEqual(await x.canonical(), removedCanonical);
    assert.equal(x.f.tree().visible("button").some(node => node.owner === x.owner
      && node.text === x.f.i18n.t("projects.retryOriginal", "Retry same creation")), false);
  } finally { released.resolve(); await Promise.allSettled([pending]); }
});

// E11: actual existing Projects/Store/Worker and LocaleController. Counts come
// from the original Worker projection; none are injected to imitate a result.
// Keep the original27 untouched. This proves text/custody, not browser fit.
const E_PROJECT_SUMMARY_NOUNS = {
  en: {
    documentNoun: { one: "document", other: "documents" },
    decisionNoun: { one: "creative decision", other: "creative decisions" },
    outputNoun: { one: "output", other: "outputs" },
    collectionNoun: { one: "collection", other: "collections" },
  },
  fr: {
    documentNoun: { one: "document", other: "documents" },
    decisionNoun: { one: "décision créative", other: "décisions créatives" },
    outputNoun: { one: "résultat", other: "résultats" },
    collectionNoun: { one: "collection", other: "collections" },
  },
  ar: {
    documentNoun: { zero: "مستند", one: "مستند", two: "مستندان", few: "مستندات", many: "مستندًا", other: "مستند" },
    decisionNoun: { zero: "قرار إبداعي", one: "قرار إبداعي", two: "قراران إبداعيان", few: "قرارات إبداعية", many: "قرارًا إبداعيًا", other: "قرار إبداعي" },
    outputNoun: { zero: "ناتج", one: "ناتج", two: "ناتجان", few: "نواتج", many: "ناتجًا", other: "ناتج" },
    collectionNoun: { zero: "مجموعة", one: "مجموعة", two: "مجموعتان", few: "مجموعات", many: "مجموعةً", other: "مجموعة" },
  },
  ja: {
    documentNoun: { one: "ドキュメント", other: "ドキュメント" },
    decisionNoun: { one: "制作上の決定事項", other: "制作上の決定事項" },
    outputNoun: { one: "生成結果", other: "生成結果" },
    collectionNoun: { one: "コレクション", other: "コレクション" },
  },
};
for (const locale of ["en", "fr", "ar", "ja"]) {
  test(locale + " project summaries use complete localized count nouns without English suffixes", dIntakeDiscardOptions, async t => {
    const x = await fixture(t, locale), before = await dIntakeDiscardBefore(x);
    const projection = x.h.store.projection.get(), tree = x.f.tree();
    const cards = tree.visible("article").filter(node => node.owner === x.owner && dIntakeDiscardClass(node, "project-card"));
    assert.ok(projection.projects.length > 0); assert.equal(cards.length, projection.projects.length);
    const rules = new Intl.PluralRules(locale);
    const noun = (unit, count) => E_PROJECT_SUMMARY_NOUNS[locale][unit][rules.select(count)] ?? E_PROJECT_SUMMARY_NOUNS[locale][unit].other;
    const observed = [], expected = [];
    for (const [index, project] of projection.projects.entries()) {
      const card = cards[index], children = card.children.filter(node => typeof node !== "string");
      const titles = children.filter(node => node.tag === "div" && dIntakeDiscardClass(node, "project-card-title"));
      assert.equal(titles.length, 1);
      const headings = titles[0].children.filter(node => typeof node !== "string" && node.tag === "h2");
      assert.equal(headings.length, 1); assert.equal(headings[0].attributes.dir, "auto");
      assert.equal(headings[0].children.every(node => typeof node === "string"), true);
      assert.equal(headings[0].children.join(""), project.name, "Authored project names are not translated or reconstructed");
      const summaries = children.filter(node => node.tag === "div" && dIntakeDiscardClass(node, "project-card-summary"));
      assert.equal(summaries.length, 1); assert.equal(summaries[0].port.isConnected, true);
      const parts = summaries[0].children.filter(node => typeof node !== "string");
      assert.deepEqual(parts.map(node => node.tag), ["span", "p"]);
      const metric = parts[0].children.filter(node => typeof node !== "string"), paragraph = parts[1];
      assert.deepEqual(metric.map(node => node.tag), ["strong", "small"]);
      const emphasized = paragraph.children.filter(node => typeof node !== "string");
      assert.deepEqual(emphasized.map(node => node.tag), ["b", "b", "b"]);
      assert.equal(metric[0].text, String(project.documentCount));
      assert.deepEqual(emphasized.map(node => node.text), [project.blockCount, project.outputCount, project.collectionCount].map(String),
        "The same projected counts retain their original emphasis and value");
      // This existing clause and conjunction are outside the noun repair.
      const artifact = project.artifactCount ? " " + x.f.i18n.system(project.artifactCount === 1
        ? "including {artifactCount} narrative, presentation, or motion result"
        : "including {artifactCount} narrative, presentation, or motion results",
      { artifactCount: x.f.i18n.number(project.artifactCount) }) : "";
      observed.push({ document: metric[1].text, summary: paragraph.text });
      expected.push({ document: noun("documentNoun", project.documentCount),
        summary: (project.blockCount + " " + noun("decisionNoun", project.blockCount) + ", "
          + project.outputCount + " " + noun("outputNoun", project.outputCount) + artifact
          + x.f.i18n.system(", and") + " " + project.collectionCount + " " + noun("collectionNoun", project.collectionCount) + ".").replace(/\s+/gu, " ").trim() });
    }
    // Establish every no-effects/authority/raw-name prerequisite before the
    // intended copy failure. Reading a summary never creates or navigates.
    assert.equal(before.route, "/projects"); assert.equal(x.calls().length, 0);
    assert.equal(dIntakeDiscardModal(x).length, 0);
    await dIntakeDiscardUnchanged(x, before);
    t.diagnostic(JSON.stringify({ locale, counts: projection.projects.map(project => ({
      documents: project.documentCount, decisions: project.blockCount, outputs: project.outputCount, collections: project.collectionCount,
    })), observed, expected, requestsAdded: x.h.requests.length - before.requests, evidence: "actual localized finite host, not physical layout" }));
    assert.deepEqual(observed, expected, "Every count uses a complete locale-selected noun, never a translated singular plus English s");
    // Existing controller only: no synthetic project/card or count injection.
    // Intl chooses the category, including zero; no English count===1 rule.
    for (const unit of Object.keys(E_PROJECT_SUMMARY_NOUNS.en)) for (const count of [0, 1, 2, 4, 11, 100, 1_000_000]) {
      const english = E_PROJECT_SUMMARY_NOUNS.en[unit];
      assert.equal(x.f.i18n.plural("projects.summary." + unit, count, english.one, english.other), noun(unit, count),
        locale + " / " + unit + " / " + count + " uses the current controller's " + rules.select(count) + " category");
    }
  });
}
