// Complete actual AssistantPanel, existing native renderer and real nested
// composer/choice cards. Public presentation fixtures are not server receipts.
// These cases isolate the slot/owner boundary, not shared destination execution.
import assert from "node:assert/strict";
import test from "node:test";
import { nothing } from "lit";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

const options = { timeout: 30_000, concurrency: false };
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => { for (let current = node; current; current = current.parent) if (current === parent) return true; return false; };
// Keep the existing exactly-one-visible contract inside one fullPageTree snapshot.
const findIn = (tree, tag, predicate) => {
  const found = tree.visible(tag).filter(predicate);
  assert.equal(found.length, 1, "one visible " + tag + " matches predicate"); return found[0];
};
const RAW = "  Keep this exact unsent thought — 保留  ";

async function panelFixture(t, locale) {
  let external = 0;
  t.mock.method(globalThis, "fetch", async () => { external++; throw Error("No external/provider request in presentation-only regression"); });
  const f = await createCalmFullPage(t, { locale });
  // Retire the old actual Shell before replacing the fixture's root with the
  // complete presentational component. No production method is extracted,
  // copied or replaced; this is explicitly not CreativeAssistant integration.
  const shell = f.host; shell.isConnected = false; shell.disconnectedCallback();
  const { FormaAssistantPanel } = await ports.loadActual("src/components/design-system/assistant-panel.ts");
  const { renderNextActionCards } = await ports.loadActual("src/components/next-action-cards.ts");
  const panel = new FormaAssistantPanel(); panel.tag = "forma-assistant-panel";
  panel.attributes = {}; panel.isConnected = true; panel.open = true;
  panel.modes = ["guidance", "quick-edit"]; panel.conversationScope = "finite-presentation-scope";
  panel.retainGuidanceDraft = true;
  const messages = [{ id: "retained:user", role: "user", text: "Original conversation" },
    { id: "retained:reply", role: "assistant", text: "Original reply" }];
  const tasks = [{ id: "original-task", turnId: "original-turn", executionId: "original-execution",
    bindingHash: "a".repeat(64), status: "recovery", recoveryOnly: true }];
  panel.messages = messages; panel.tasks = tasks;
  const activations = [], events = [];
  for (const type of ["forma-assistant-message", "forma-assistant-task", "forma-assistant-proposal",
    "forma-assistant-specialist-action", "forma-assistant-guidance-recovery"])
    panel.addEventListener(type, event => events.push({ type, detail: event.detail }));
  // Finite display values exercise the existing card, not a claimed executable
  // application target. The composed consumer has separate actual-host tests.
  const display = count => renderNextActionCards(Array.from({ length: count }, (_, index) => ({
    id: "open-output", label: "Finite local next step " + index, reason: "Local presentation only", title: "",
    priority: 100 - index, evidence: 1,
    target: { kind: "output", projectId: "display-project", documentId: "display-document",
      canvasId: null, authorityKey: "display-only", outputId: "display-result-" + index },
  })), f.i18n, action => activations.push(action));
  f.host = panel; panel.connectedCallback(); await f.settle();
  const source = structuredClone({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() });
  const requestStart = f.storeHost.requests.length;
  t.after(() => {
    assert.deepEqual({ events: f.store.events.get(), content: f.store.content.get(), head: f.store.head.get() }, source);
    assert.deepEqual(f.storeHost.requests.slice(requestStart), [], "slot rendering/input dispatches no application request");
    assert.equal(external, 0); assert.deepEqual(events, []); assert.deepEqual(activations, []);
  });
  const field = () => f.find("textarea", node => classed(node, "forma-assistant-input"));
  const setDraft = async value => { const node = field(); node.port.value = value; await f.act(node, "input"); };
  const local = (tree = f.tree()) => tree.visible("div").find(node => classed(node, "forma-assistant-continuation"));
  const blocked = (tree = f.tree()) => { const slot = local(tree); return tree.visible("fieldset").find(node => inside(node, slot)); };
  return { f, panel, messages, tasks, display, field, setDraft, local, blocked };
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("actual Assistant slot stays outside conversation and defaults absent " + locale, options, async t => {
    const x = await panelFixture(t, locale), { f, panel } = x;
    assert.equal(panel.continuation, nothing); assert.equal(x.local(), undefined);
    const composer = f.components().find(component => component.tag === "forma-ui-conversation-composer");
    panel.continuation = x.display(3); panel.requestUpdate(); await f.settle();
    const tree = f.tree(), local = x.local(tree), log = findIn(tree, "div", node => node.attributes.role === "log");
    assert.ok(local); assert.equal(inside(local, log), false);
    assert.equal(inside(log, local), false);
    assert.equal(tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, local)).length, 3);
    assert.equal(Object.hasOwn(x.blocked(tree).attributes, "disabled"), false);
    assert.equal(panel.navigationBlocked, false);
    assert.ok(log.text.includes("Original conversation") && log.text.includes("Original reply"));
    assert.equal(log.text.includes("Local presentation only"), false);
    assert.equal(panel.messages, x.messages); assert.equal(panel.tasks, x.tasks);
    assert.equal(f.components().includes(composer), true);
    panel.continuation = nothing; panel.requestUpdate(); await f.settle();
    assert.equal(x.local(), undefined); assert.equal(f.components().includes(composer), true);
    assert.equal(panel.messages, x.messages); assert.equal(panel.tasks, x.tasks);
  });

  test("actual Assistant slot updates retain current and inactive raw drafts " + locale, options, async t => {
    const x = await panelFixture(t, locale), { f, panel } = x;
    panel.continuation = x.display(3); panel.requestUpdate(); await f.settle();
    await x.setDraft(RAW); assert.equal(panel.navigationBlocked, true);
    assert.equal(Object.hasOwn(x.blocked().attributes, "disabled"), true);
    assert.equal(Object.hasOwn(x.field().attributes, "disabled"), false, "the human can finish the existing message");
    const quick = f.find("button", node => classed(node, "forma-assistant-mode") && node.text === f.i18n.t("assistant.mode.quickEdit"));
    await f.act(quick); assert.equal(x.field().properties.value, "");
    assert.equal(panel.navigationBlocked, true, "the inactive guidance draft remains owned");
    panel.continuation = x.display(1); panel.requestUpdate(); await f.settle();
    assert.equal(Object.hasOwn(x.blocked().attributes, "disabled"), true);
    const guidance = f.find("button", node => classed(node, "forma-assistant-mode") && node.text === f.i18n.t("assistant.mode.guidance"));
    await f.act(guidance); assert.equal(x.field().properties.value, RAW);
    assert.equal(panel.messages, x.messages); assert.equal(panel.tasks, x.tasks);
    await x.setDraft("");
    assert.equal(panel.navigationBlocked, false, "the current draft, not its older inactive-map copy, owns this mode");
    assert.equal(Object.hasOwn(x.blocked().attributes, "disabled"), false);
  });

  test("actual Assistant original guidance retains its controls while local navigation is blocked " + locale, options, async t => {
    const x = await panelFixture(t, locale), { f, panel } = x;
    panel.continuation = x.display(1); panel.guidanceDelivery = "uncertain"; panel.requestUpdate(); await f.settle();
    assert.equal(panel.navigationBlocked, true); assert.equal(Object.hasOwn(x.blocked().attributes, "disabled"), true);
    const tree = f.tree(), recovery = tree.visible("div").find(node => classed(node, "forma-assistant-guidance-recovery"));
    assert.ok(recovery); assert.equal(inside(recovery, x.blocked(tree)), false);
    for (const key of ["assistant.guidance.check", "assistant.guidance.retry"]) {
      const control = findIn(tree, "button", node => inside(node, recovery) && node.text === f.i18n.t(key));
      assert.equal(Object.hasOwn(control.attributes, "disabled"), false);
    }
    const original = findIn(tree, "button", node => node.attributes["data-assistant-execution-id"] === "original-execution");
    assert.equal(inside(original, x.blocked(tree)), false); assert.equal(Object.hasOwn(original.attributes, "disabled"), false);
    assert.ok(x.local().text.includes(f.i18n.t("next.lifecycle.assistantOwnsWork")));
    assert.equal(panel.tasks, x.tasks); assert.equal(panel.messages, x.messages);
    panel.guidanceDelivery = ""; panel.requestUpdate(); await f.settle();
    assert.equal(panel.navigationBlocked, false);
  });
}
