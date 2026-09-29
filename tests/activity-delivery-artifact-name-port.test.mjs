// Three finite renderer-port controls for the test-local attribute adapter.
// These synthetic templates are not substitute application/Store admissions,
// actual viewer acceptance, browser DOM identity, focus or accessibility proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { registerHooks } from "node:module";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";

const fixtureUrl = new URL("./activity-delivery-exact-destinations.test.mjs", import.meta.url);
const original = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, original, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const firstLoop = tree.statements.find(ts.isForOfStatement); assert.ok(firstLoop);
const fixtureSource = original.slice(0, firstLoop.getFullStart()) + "\nexport { installDestinationDialogNames };";
const virtual = new URL(fixtureUrl); virtual.search = "?c146-artifact-native-name-port-controls";
const hook = registerHooks({ load(url, context, next) {
  return url === virtual.href ? { format: "module", source: fixtureSource, shortCircuit: true } : next(url, context);
} });
let installDestinationDialogNames;
try { ({ installDestinationDialogNames } = await import(virtual.href)); } finally { hook.deregister(); }

function namePortFixture(t) {
  let epoch = 0;
  const store = { captureSourceOwnership: () => ({ epoch }), sourceOwnershipActive: source => source?.epoch === epoch };
  const f = { trace: [], store }, owner = { tag: "forma-document-artifacts", store, documentId: "document-a", source: "library" };
  ports.bindFixture(f); t.after(() => ports.bindFixture(null));
  f.renderer = new ports.RendererPort(f, {});
  const observed = installDestinationDialogNames(t, f);
  return { f, owner, observed, retireSource: () => { epoch++; }, draw(template, host = owner) {
    f.renderer.draw(host, () => template);
    return f.renderer.ownNodes(host, "dialog");
  } };
}
const view = heading => html`<dialog class="document-artifact-view" @close=${() => {}}><h2>${heading}</h2></dialog>`;
const otherView = heading => html`<section><dialog class="document-artifact-view" @close=${() => {}}><h2>${heading}</h2></dialog></section>`;

test("artifact name port retains only an observed imperative attribute on the same native EventPart", { concurrency: false }, t => {
  const q = namePortFixture(t), first = q.draw(view("Visible heading"))[0];
  assert.equal(first.getAttribute("aria-label"), null, "the adapter never derives a label from expected title or visible text");
  first.setAttribute("aria-label", "Observed name — 原名"); first.setAttribute("data-unrelated", "do not carry");
  const next = q.draw(view("Changed visible heading"))[0];
  assert.notStrictEqual(next, first, "attribute persistence does not claim complete native node identity");
  assert.equal(first.isConnected, false); assert.equal(next.getAttribute("aria-label"), "Observed name — 原名");
  assert.equal(next.getAttribute("data-unrelated"), null); assert.equal(next.open, false);
  assert.deepEqual(q.observed.writes().map(row => row.value), ["Observed name — 原名"], "replay is not another production write");
  first.setAttribute("aria-label", "Detached old write");
  assert.equal(q.draw(view("Current heading"))[0].getAttribute("aria-label"), "Observed name — 原名");
  const current = q.f.renderer.ownNodes(q.owner, "dialog")[0];
  current.setAttribute("aria-label", "Current observed name");
  assert.equal(q.draw(view("Current heading"))[0].getAttribute("aria-label"), "Current observed name");
  q.f.renderer.ownNodes(q.owner, "dialog")[0].removeAttribute("aria-label");
  assert.equal(q.draw(view("Current heading"))[0].getAttribute("aria-label"), null);
  // One stable EventPart also exercises authored AttributePart precedence.
  // The label comes from that emitted binding, not an expected-name adapter.
  const namedView = label => html`<dialog class="document-artifact-view" aria-label=${label} @close=${() => {}}><h2>Same heading</h2></dialog>`;
  const beforeAuthored = q.draw(namedView(nothing))[0]; beforeAuthored.setAttribute("aria-label", "Observed before authored binding");
  assert.equal(q.draw(namedView("Actual authored binding"))[0].getAttribute("aria-label"), "Actual authored binding");
  assert.equal(q.draw(namedView(nothing))[0].getAttribute("aria-label"), null,
    "removing the authored attribute cannot revive the earlier imperative value");
  assert.deepEqual(q.f.trace, [], "the adapter does not open, close or focus a native port");
});

test("artifact name port retires an observed attribute when the dialog is removed", { concurrency: false }, t => {
  const q = namePortFixture(t), first = q.draw(view("Original"))[0];
  first.setAttribute("aria-label", "Original observed name");
  assert.equal(q.draw(nothing).length, 0); assert.equal(first.isConnected, false);
  const returned = q.draw(view("Returned"))[0];
  assert.equal(returned.getAttribute("aria-label"), null, "a reintroduced same template cannot borrow a removed dialog's name");
  first.setAttribute("aria-label", "Late detached write");
  assert.equal(q.draw(view("Returned"))[0].getAttribute("aria-label"), null);
  assert.equal(q.observed.writes().length, 1);
});

test("artifact name port rejects replaced template, key, owner, Store, Document and Source", { concurrency: false }, t => {
  const q = namePortFixture(t);
  const prime = (template = view("Same title"), host = q.owner) => {
    const node = q.draw(template, host)[0]; node.setAttribute("aria-label", "Observed original"); return node;
  };
  prime(); assert.equal(q.draw(otherView("Same title"))[0].getAttribute("aria-label"), null);
  prime(keyed("a", view("Same title")));
  assert.equal(q.draw(keyed("b", view("Same title")))[0].getAttribute("aria-label"), null);
  prime(); const replacement = { ...q.owner };
  assert.equal(q.draw(view("Same title"), replacement)[0].getAttribute("aria-label"), null);
  prime(); q.owner.documentId = "document-b";
  assert.equal(q.draw(view("Same title"))[0].getAttribute("aria-label"), null);
  prime(); q.retireSource();
  assert.equal(q.draw(view("Same title"))[0].getAttribute("aria-label"), null);
  prime(); q.owner.source = "activity";
  assert.equal(q.draw(view("Same title"))[0].getAttribute("aria-label"), null);
  prime(); q.owner.store = { captureSourceOwnership: () => ({}), sourceOwnershipActive: () => true };
  assert.equal(q.draw(view("Same title"))[0].getAttribute("aria-label"), null);
  prime(); assert.equal(q.draw([view("Same title"), view("Same title")]).length, 2);
  assert.equal(q.draw(view("Same title"))[0].getAttribute("aria-label"), null, "ambiguous anchors cannot establish continuity");
});
