// Separate finite dialog-identity controls. The existing three name-only units
// remain unchanged and continue to require fresh node identity by default.
// These are renderer-unit templates, not substitute application admissions or
// browser dialog/AT/focus timing evidence. Actual six destinations remain gates.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

const fixtureUrl = new URL("./activity-delivery-exact-destinations.test.mjs", import.meta.url);
const original = fs.readFileSync(fixtureUrl, "utf8"), syntax = ts.createSourceFile(fixtureUrl.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = syntax.statements.find(ts.isForOfStatement); assert.ok(firstLoop);
const source = original.slice(0, firstLoop.getFullStart()) + "\nexport { installDestinationDialogNames };";
const virtual = new URL(fixtureUrl); virtual.search = "?c147-artifact-native-dialog-identity-controls";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source, shortCircuit: true } : next(url, context);
} });
let installDestinationDialogNames;
try { ({ installDestinationDialogNames } = await import(virtual.href)); } finally { hook.deregister(); }

function identityPortFixture(t) {
  let generation = 0;
  const store = { captureSourceOwnership: () => ({ generation }), sourceOwnershipActive: token => token?.generation === generation };
  const f = { trace: [], store }, owner = { tag: "forma-document-artifacts", store, documentId: "document-a", source: "library" };
  ports.bindFixture(f); t.after(() => ports.bindFixture(null));
  f.renderer = new ports.RendererPort(f, {});
  const names = installDestinationDialogNames(t, f, { retainDialogIdentity: true });
  return { f, owner, names, retireSource: () => { generation++; }, draw(template, host = owner) {
    f.renderer.draw(host, () => template); return f.renderer.ownNodes(host, "dialog");
  } };
}
const view = (heading, close = () => {}) => html`<dialog class="document-artifact-view" data-current=${heading} @close=${close}><h2>${heading}</h2></dialog>`;
const alternate = () => html`<section><dialog class="document-artifact-view" @close=${() => {}}><h2>Same title</h2></dialog></section>`;

test("artifact identity option retains exact native close object/listener/open state for the same EventPart", { concurrency: false }, t => {
  const q = identityPortFixture(t), calls = [];
  const first = q.draw(view("Original", () => calls.push("old bound handler")))[0], nativeClose = first.close;
  first.setAttribute("aria-label", "Actual observed name"); first.open = true;
  const closed = () => {
    assert.equal(first.open, false, "the imperative closure observes its original native dialog closing");
    first.removeEventListener("close", closed); calls.push("original listener");
  };
  first.addEventListener("close", closed);
  const current = q.draw(view("Current", () => calls.push("current bound handler")))[0];
  assert.strictEqual(current, first); assert.strictEqual(current.close, nativeClose);
  assert.strictEqual(current.listeners.close, closed); assert.equal(current.open, true);
  assert.equal(current.getAttribute("data-current"), "Current"); assert.equal(current.getAttribute("aria-label"), "Actual observed name");
  assert.equal(q.names.writes().length, 1, "a redraw neither fabricates a name write nor reattaches a listener");
  for (let index = 0; index < 3; index++) assert.strictEqual(q.draw(view("Current", () => calls.push("current bound handler")))[0], first);
  current.setAttribute("aria-label", "Second original write");
  assert.deepEqual(q.names.writes().map(row => row.value), ["Actual observed name", "Second original write"],
    "each original call is recorded once across repeated retained-node redraws");
  assert.equal(q.draw(view("Current", () => calls.push("current bound handler")))[0].getAttribute("aria-label"), "Second original write");
  current.close();
  assert.deepEqual(calls, ["current bound handler", "original listener"]);
  assert.equal(current.open, false); assert.equal(current.listeners.close, undefined);
  const stillCurrent = q.draw(view("After Close", () => calls.push("after close")))[0];
  assert.strictEqual(stillCurrent, first); assert.equal(stillCurrent.open, false); assert.equal(stillCurrent.listeners.close, undefined);
  stillCurrent.close(); assert.deepEqual(calls, ["current bound handler", "original listener"]);
  assert.deepEqual(q.f.trace, ["close:document-artifact-view"], "retention itself performs no open, close or focus operation");
});

test("artifact identity option retires a removed native dialog without reviving its listener or name", { concurrency: false }, t => {
  const q = identityPortFixture(t), first = q.draw(view("Same title"))[0], listener = () => assert.fail("removed listener must not migrate");
  first.setAttribute("aria-label", "Removed name"); first.addEventListener("close", listener); first.open = true;
  assert.equal(q.draw(nothing).length, 0); assert.equal(first.isConnected, false);
  const returned = q.draw(view("Same title"))[0];
  assert.notStrictEqual(returned, first); assert.equal(returned.open, false);
  assert.equal(returned.listeners?.close, undefined); assert.equal(returned.getAttribute("aria-label"), null);
  assert.strictEqual(first.listeners.close, listener, "the old listener remains on its detached original, never a new lookalike");
  assert.deepEqual(q.f.trace, []);
});

test("artifact identity option rejects replacement EventPart/owner/Store/Document/Source and ambiguity", { concurrency: false }, t => {
  const q = identityPortFixture(t);
  const prime = (template = view("Same title"), owner = q.owner) => {
    const node = q.draw(template, owner)[0]; node.open = true; node.setAttribute("aria-label", "Original observed name");
    node.addEventListener("close", () => assert.fail("a retired listener must not migrate")); return node;
  };
  const replaced = (original, template = view("Same title"), owner = q.owner) => {
    const next = q.draw(template, owner)[0]; assert.notStrictEqual(next, original); assert.equal(original.isConnected, false);
    assert.equal(next.open, false); assert.equal(next.listeners?.close, undefined); assert.equal(next.getAttribute("aria-label"), null); return next;
  };
  replaced(prime(), alternate());
  replaced(prime(keyed("a", view("Same title"))), keyed("b", view("Same title")));
  replaced(prime(), view("Same title"), { ...q.owner });
  let before = prime(); q.owner.documentId = "document-b"; replaced(before);
  before = prime(); q.retireSource(); replaced(before);
  before = prime(); q.owner.source = "activity"; replaced(before);
  before = prime(); q.owner.store = { captureSourceOwnership: () => ({}), sourceOwnershipActive: () => true }; replaced(before);
  before = prime(); assert.equal(q.draw([view("Same title"), view("Same title")]).length, 2); assert.equal(before.isConnected, false);
  const uniqueAgain = q.draw(view("Same title"))[0]; assert.notStrictEqual(uniqueAgain, before);
  assert.equal(uniqueAgain.open, false); assert.equal(uniqueAgain.listeners?.close, undefined); assert.equal(uniqueAgain.getAttribute("aria-label"), null);
  assert.deepEqual(q.f.trace, [], "replacement does not dispatch a close or steal focus");
});
