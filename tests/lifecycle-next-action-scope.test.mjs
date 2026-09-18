import assert from "node:assert/strict";
import test from "node:test";
import { nothing } from "lit";
import { FORMA_NEXT_ACTION_MESSAGES } from "../src/components/design-system/locales/next-action-messages.ts";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { createNextActionFactsPort } from "./helpers/next-action-facts-fixture.mjs";

const { renderNextActionCards, renderLifecycleNextActionCards } = await ports.loadActual("src/components/next-action-cards.ts");
const { FormaUiChoiceCard } = await ports.loadActual("src/components/design-system/choice-card.ts");
const { nextActionFacts } = await ports.loadActual("src/state/next-action-context.ts");
const { creativeNextActions, creativeNextTargetAvailable } = await ports.loadActual("src/model/workspace-intelligence.ts");
const projectName = "Same name · مشروع", documentTitle = "Same name · 文書";
const actions = ["a", "b", "c"].map((id, index) => Object.freeze({ id: "open-output",
  label: "Open saved result", reason: "Inspect this exact saved output without starting another generation.",
  title: documentTitle, target: Object.freeze({ kind: "output", outputId: id, projectId: "p", documentId: "d",
    canvasId: null, authorityKey: "exact", sourceGeneration: 7 }), rank: index }));
function renderer(t, locale) {
  const f = { locale, trace: [], clipboard: [], listeners: new Map(), changed: new Map(), requested: false,
    resizeTargets: new Map(), frames: new Map(), timers: new Map(), timerSequence: 0, storage: new Map() };
  ports.bindFixture(f);
  const messages = { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] };
  f.i18n = new ports.FormaLocaleController({ addController() {}, requestUpdate() {}, dispatchEvent(event) {
    event.callback({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr",
      timeZone: "UTC", messages, revision: 1 }, () => {}); return true;
  } });
  f.i18n.hostConnected(); f.host = new ports.ElementPort(); f.host.tag = "scope-contract"; f.host.attributes = {};
  f.renderer = new ports.RendererPort(f, { "forma-ui-choice-card": FormaUiChoiceCard });
  f.draw = value => { ports.bindFixture(f); f.renderer.draw(f.host, () => value); return fullPageTree(f); };
  t.after(() => { ports.bindFixture(f); for (const { instance } of f.renderer.instances.values()) {
    if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
  } f.i18n.hostDisconnected(); });
  return f;
}
const within = (node, ancestor) => { for (let at = node.parent; at; at = at.parent) if (at === ancestor) return true; return false; };
const nativeCards = tree => tree.nodes.filter(node => node.tag === "forma-ui-choice-card").map(node => {
  const button = tree.visible("button").find(value => within(value, node)); assert.ok(button);
  return { node, button, name: button.text };
});

for (const locale of ["en", "fr", "ar", "ja"]) test(locale + " scoped lifecycle wrapper preserves all actual card names, identity, order and native activation", t => {
  const f = renderer(t, locale), calls = [];
  const legacy = nativeCards(f.draw(renderNextActionCards(actions, f.i18n, () => assert.fail("rendering does not activate")))).map(value => value.name);
  const tree = f.draw(renderLifecycleNextActionCards(actions, f.i18n, value => calls.push(value), { projectName, documentTitle, scopeUnknown: true }));
  const labels = tree.visible("bdi"); assert.deepEqual(labels.map(value => value.text), [projectName, documentTitle]);
  assert.ok(labels.every(value => value.attributes.dir === "auto"));
  const cards = nativeCards(tree); assert.deepEqual(cards.map(value => value.name), legacy);
  assert.equal(cards.filter(value => value.node.attributes["data-primary"] === "true").length, 1);
  assert.equal(cards.length, 3);
  assert.deepEqual(tree.visible("p").filter(value => value.attributes.role === "status").map(value => value.text),
    [f.i18n.t("next.lifecycle.scopeUnknown")]);
  for (let index = 0; index < cards.length; index++) {
    cards[index].button.handlers.click.call(cards[index].button.owner, { currentTarget: cards[index].button.port, target: cards[index].button.port }); assert.strictEqual(calls[index], actions[index]);
  }
  assert.deepEqual(actions.map(value => value.target.outputId), ["a", "b", "c"]);
  const known = f.draw(renderLifecycleNextActionCards(actions, f.i18n, () => {}, { projectName, documentTitle, scopeUnknown: false }));
  assert.equal(known.visible("p").filter(value => value.attributes.role === "status").length, 0);
  assert.strictEqual(renderLifecycleNextActionCards([], f.i18n, () => assert.fail("empty"), { projectName, documentTitle, scopeUnknown: true }), nothing);
});

test("assistant ownership explanation is localized in the existing complete catalog", () => {
  const key = "next.lifecycle.assistantOwnsWork", keys = Object.keys(FORMA_NEXT_ACTION_MESSAGES.en);
  for (const locale of ["en", "fr", "ar", "ja"]) {
    assert.deepEqual(Object.keys(FORMA_NEXT_ACTION_MESSAGES[locale]), keys);
    assert.ok(FORMA_NEXT_ACTION_MESSAGES[locale][key]);
    if (locale !== "en") assert.notEqual(FORMA_NEXT_ACTION_MESSAGES[locale][key], FORMA_NEXT_ACTION_MESSAGES.en[key]);
  }
});

// Actual facts/resolver plus the existing native choice-card renderer. Store
// ports are explicitly finite/read-only, not a Worker or authority certificate.
// All policy, callback and no-read checks precede the desired copy assertion,
// so root may run these four cases against the unchanged runtime as a baseline.
const informationalScope = {
  en: "Delivery scope is unknown.",
  fr: "Le périmètre de livraison est inconnu.",
  ar: "نطاق التسليم غير معروف.",
  ja: "納品範囲が不明です。",
};
for (const locale of ["en", "fr", "ar", "ja"]) test(locale + " unknown Output scope is informational while exact local work remains available", t => {
  const view = renderer(t, locale), observations = [];
  for (const scenario of ["empty", "direction"]) for (const state of ["loading", "refreshing", "unavailable"]) {
    const f = createNextActionFactsPort({ kind: null });
    if (scenario === "empty") f.state.events = f.state.events.filter(event => event.type !== "BlockCreated");
    f.state.read = { state, snapshot: null, error: state === "unavailable" ? "finite read unavailable" : null };
    const events = structuredClone(f.state.events), session = structuredClone(f.state.session);
    const facts = nextActionFacts(f.store, f.state.documentId, null, { lifecycle: true });
    const before = structuredClone(facts), actions = creativeNextActions(facts), called = [];
    const expectedKind = scenario === "empty" ? "context" : "configure";
    assert.equal(facts.canRead, true); assert.equal(facts.canAuthor, true); assert.equal(facts.canConfigure, true);
    assert.equal(facts.lifecycle.output.state, state); assert.equal(facts.lifecycle.output.scopeKnown, null);
    assert.deepEqual(facts.lifecycle.output.requirementBlockIds, []); assert.deepEqual(facts.lifecycle.output.choices, []);
    assert.equal(Object.hasOwn(facts.lifecycle.output, "owedCount"), false, "Unknown is not a zero-owed certificate");
    assert.deepEqual(actions.map(action => action.target.kind), [expectedKind]);
    assert.ok(actions.every(action => creativeNextTargetAvailable(action.target, facts)));
    assert.deepEqual(f.calls, [{ type: "resource", documentId: f.state.documentId }]);
    const tree = view.draw(renderLifecycleNextActionCards(actions, view.i18n, action => called.push(action), {
      projectName: f.projection().projectName, documentTitle: f.projection().documentTitle, scopeUnknown: true,
    }));
    const cards = nativeCards(tree); assert.equal(cards.length, 1);
    assert.equal(cards[0].node.attributes["data-primary"], "true");
    assert.equal(Object.hasOwn(cards[0].button.attributes, "disabled"), false);
    const label = tree.visible("strong").find(node => within(node, cards[0].button));
    const detail = tree.visible("small").find(node => within(node, cards[0].button));
    assert.ok(label); assert.ok(detail);
    assert.equal(label.text, view.i18n.t("next.exact." + actions[0].id + ".label"));
    assert.equal(detail.text, view.i18n.t("next.exact." + actions[0].id + ".reason"));
    cards[0].button.handlers.click.call(cards[0].button.owner, { currentTarget: cards[0].button.port, target: cards[0].button.port });
    assert.equal(called.length, 1); assert.strictEqual(called[0], actions[0]);
    assert.deepEqual(facts, before); assert.deepEqual(f.state.events, events); assert.deepEqual(f.state.session, session);
    assert.deepEqual(f.calls, [{ type: "resource", documentId: f.state.documentId }], "Rendering/activation did not start a read or command");
    assert.equal(f.state.read.snapshot, null);
    const statuses = tree.visible("p").filter(node => node.attributes.role === "status").map(node => node.text);
    observations.push({ scenario, state, kind: called[0].target.kind, statuses, resourceReads: f.calls.length });
  }
  assert.equal(observations.length, 6);
  t.diagnostic("LIFECYCLE_SCOPE_INFORMATION " + JSON.stringify({ locale, observations }));
  assert.deepEqual(observations.map(row => row.statuses), observations.map(() => [informationalScope[locale]]),
    "Unknown scope must stay visible without inventing a Refresh prerequisite for unrelated available work");
  assert.equal(FORMA_NEXT_ACTION_MESSAGES[locale]["next.lifecycle.scopeUnknown"], informationalScope[locale]);
  assert.notEqual(view.i18n.t("output.delivery.scopeUnknown"), informationalScope[locale],
    "The existing Output-controller refresh instruction remains intact at its own boundary");
});
