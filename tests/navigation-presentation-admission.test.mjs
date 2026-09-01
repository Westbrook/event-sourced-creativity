import assert from "node:assert/strict";
import test from "node:test";
import { hasBlockingNavigationDialog, navigateInApp, navigationPresentationCurrent, navigationPresentationMatches } from "../src/components/command-departure.ts";

// Structural finite ports for the actual stateless admission helpers, not a
// browser, renderer, Store, authorization certificate or dialog-lifecycle proof.
function presentationFixture({ modal = true } = {}) {
  const nodes = [];
  const document = { defaultView: { getComputedStyle(node) { return node.computed; } }, querySelectorAll(selector) {
    assert.equal(selector, "dialog[open]");
    return nodes.filter(node => node.isConnected && node.tagName === "DIALOG" && node.hasAttribute("open"));
  } };
  const node = (tagName, parent = null) => {
    const value = { tagName, parent, isConnected: true, ownerDocument: document, attributes: new Map(), disabled: false,
      computed: { display: "block", visibility: "visible", contentVisibility: "visible" }, rects: [{}],
      get open() { return this.hasAttribute("open"); },
      set open(value) { if (value) this.attributes.set("open", ""); else this.attributes.delete("open"); },
      getClientRects() { return this.rects; },
      contains(other) { for (let current = other; current; current = current.parent) if (current === this) return true; return false; },
      getAttribute(name) { return this.attributes.get(name) ?? null; },
      hasAttribute(name) { return this.attributes.has(name); },
      matches(selector) { assert.equal(selector, ":disabled"); return this.disabled; },
      closest(selector) {
        assert.ok(["[hidden],[inert]", "dialog"].includes(selector));
        const matches = current => selector === "[hidden],[inert]"
          ? current.hasAttribute("hidden") || current.hasAttribute("inert")
          : current.tagName === "DIALOG";
        if (matches(this)) return this;
        for (let current = this.parent; current; current = current.parent) if (matches(current)) return current;
        return null;
      },
    };
    nodes.push(value); return value;
  };
  const owner = node("FORMA-PRESENTATION-OWNER"), element = node(modal ? "DIALOG" : "SECTION", owner), trigger = node("BUTTON", element);
  if (modal) element.attributes.set("open", "");
  let available = true;
  const presentation = { owner, element, trigger, current: () => available };
  return { document, owner, element, trigger, presentation, context: { presentation }, node, withdraw() { available = false; } };
}

test("presentation context is forwarded unchanged only to the actual containing Shell", async () => {
  const f = presentationFixture(), calls = [], run = () => assert.fail("The wrapper does not execute the callback itself");
  const host = { async navigateFrom(...args) { calls.push(args); return true; } };
  f.owner.closest = selector => { assert.equal(selector, "forma-shell"); return host; };
  assert.equal(await navigateInApp(f.owner, run, f.context), true);
  assert.deepEqual(calls, [[f.owner, run, f.context]]);
});

test("default navigation has no presentation exception and a missing Shell never invokes work", async () => {
  const f = presentationFixture(), calls = [], run = () => assert.fail("No standalone origin may invoke navigation");
  f.owner.closest = () => null;
  assert.equal(await navigateInApp(f.owner, run), false);
  f.owner.closest = () => ({ async navigateFrom(...args) { calls.push(args); return false; } });
  assert.equal(await navigateInApp(f.owner, run), false);
  assert.strictEqual(calls[0][0], f.owner); assert.strictEqual(calls[0][1], run);
  assert.deepEqual(calls[0][2], {});
  assert.equal(hasBlockingNavigationDialog(f.document), true);
});

test("only the exact currently certified owner and native presentation are subtracted", () => {
  const f = presentationFixture();
  assert.equal(navigationPresentationCurrent(f.presentation), true);
  assert.equal(navigationPresentationMatches(f.context, f.owner, f.element), true);
  assert.equal(hasBlockingNavigationDialog(f.document, f.context), false);
  assert.equal(navigationPresentationMatches(f.context, f.node("FORMA-OTHER-OWNER"), f.element), false);
  assert.equal(navigationPresentationMatches(f.context, f.owner, f.node("DIALOG", f.owner)), false);
  assert.equal(navigationPresentationMatches(f.context, f.owner, null), false);
});

test("another open dialog is not waived even when it belongs to the same component", () => {
  const f = presentationFixture(), other = f.node("DIALOG", f.owner);
  other.attributes.set("open", "");
  assert.equal(hasBlockingNavigationDialog(f.document, f.context), true);
  other.attributes.delete("open"); assert.equal(hasBlockingNavigationDialog(f.document, f.context), false);
  f.withdraw(); assert.equal(hasBlockingNavigationDialog(f.document, f.context), true);
});

test("detached, hidden, disabled, foreign and closed presentations fail structural admission", () => {
  const changes = {
    "owner detached": f => { f.owner.isConnected = false; },
    "element detached": f => { f.element.isConnected = false; },
    "trigger detached": f => { f.trigger.isConnected = false; },
    "foreign document": f => { f.trigger.ownerDocument = {}; },
    "foreign element": f => { f.element.parent = null; },
    "foreign trigger": f => { f.trigger.parent = f.owner; },
    "hidden owner": f => { f.owner.attributes.set("hidden", ""); },
    "inert trigger": f => { f.trigger.attributes.set("inert", ""); },
    "disabled trigger": f => { f.trigger.disabled = true; },
    "aria-disabled trigger": f => { f.trigger.attributes.set("aria-disabled", "true"); },
    "closed dialog": f => { f.element.open = false; },
    "CSS-hidden presentation": f => { f.element.computed.display = "none"; },
    "CSS-invisible trigger": f => { f.trigger.computed.visibility = "hidden"; },
    "CSS-collapsed trigger": f => { f.trigger.computed.visibility = "collapse"; },
    "no rendered trigger rectangle": f => { f.trigger.rects = []; },
    "content-hidden presentation": f => { f.element.computed.contentVisibility = "hidden"; },
  };
  for (const [label, change] of Object.entries(changes)) {
    const f = presentationFixture(); change(f);
    assert.equal(navigationPresentationCurrent(f.presentation), false, label);
    assert.equal(navigationPresentationMatches(f.context, f.owner, f.element), false, label);
  }
});

test("the owner's current mode/resource predicate remains required and exceptions fail closed", () => {
  const f = presentationFixture(); f.withdraw();
  assert.equal(navigationPresentationCurrent(f.presentation), false);
  assert.equal(hasBlockingNavigationDialog(f.document, f.context), true);
  f.presentation.current = () => { throw new Error("original read-only resource retired"); };
  assert.equal(navigationPresentationCurrent(f.presentation), false);
  assert.equal(hasBlockingNavigationDialog(f.document, f.context), true);
});

test("a certified nonmodal inspection does not exempt an enclosing closed or unrelated open dialog", () => {
  const f = presentationFixture({ modal: false });
  assert.equal(navigationPresentationCurrent(f.presentation), true);
  const outer = f.node("DIALOG", f.owner); f.element.parent = outer;
  assert.equal(navigationPresentationCurrent(f.presentation), false);
  outer.attributes.set("open", ""); assert.equal(navigationPresentationCurrent(f.presentation), true);
  assert.equal(hasBlockingNavigationDialog(f.document, f.context), true, "The section is not the enclosing dialog");
});

test("dropping an admitted node exception cannot authorize its reopened or replacement dialog", () => {
  const f = presentationFixture(); let closed = false;
  const context = { get presentation() { return closed ? undefined : f.presentation; } };
  assert.equal(hasBlockingNavigationDialog(f.document, context), false);
  closed = true; f.element.attributes.delete("open");
  assert.equal(hasBlockingNavigationDialog(f.document, context), false);
  f.element.attributes.set("open", ""); assert.equal(hasBlockingNavigationDialog(f.document, context), true);
  f.element.isConnected = false; const replacement = f.node("DIALOG", f.owner); replacement.attributes.set("open", "");
  assert.equal(hasBlockingNavigationDialog(f.document, context), true);
});

test("a replaced still-connected presentation loses the exact current owner exception", () => {
  const f = presentationFixture(); let currentPresentation = f.element;
  f.presentation.current = () => currentPresentation === f.element;
  assert.equal(navigationPresentationCurrent(f.presentation), true);
  const replacement = f.node("DIALOG", f.owner); replacement.open = true; currentPresentation = replacement;
  assert.equal(f.element.isConnected, true); assert.equal(f.element.open, true);
  assert.equal(navigationPresentationCurrent(f.presentation), false);
  assert.equal(navigationPresentationMatches(f.context, f.owner, f.element), false);
  assert.equal(navigationPresentationMatches(f.context, f.owner, replacement), false);
  assert.equal(hasBlockingNavigationDialog(f.document, f.context), true);
});
