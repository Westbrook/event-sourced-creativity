import assert from "node:assert/strict";
import test, { after } from "node:test";
import { html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { lifecyclePage, finishLifecycle, lifecycleOwner, activateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";

const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw Error("No external/provider transport in committed-renderer controls"); };
after(() => { assert.equal(external, 0); globalThis.fetch = originalFetch; });

// These small probes qualify only the reused finite renderer's native lifecycle.
// The actual Image/source/gesture controls below still use the complete app.
function lifecycleFixture(t) {
  const f = { trace: [], listeners: new Map(), changed: new Map(), requested: false,
    tick: async () => true, frames: new Map(), timers: new Map(), resizeTargets: new Map(), storage: new Map() };
  ports.bindFixture(f);
  const state = { value: "A", key: "one", mounted: true }, rows = [];
  let parent, renderer;
  const observe = (phase, self) => {
    const parentNode = parent.querySelector("#committed-parent");
    const ownNode = self.querySelector("#committed-child");
    const child = parent.querySelector("forma-committed-probe");
    rows.push({ phase, self, parentNode, ownNode, child,
      parentValue: parentNode?.getAttribute("data-value") ?? null,
      ownValue: ownNode?.getAttribute("data-value") ?? null,
      active: f.native.document.activeElement,
      activeConnected: Boolean(f.native.document.activeElement?.isConnected),
      updatingOwner: renderer.updatingOwner ?? null });
  };
  class Probe extends ports.ElementPort {
    static properties = { currentValue: { attribute: false } };
    currentValue = "";
    willUpdate() { observe("child-will", this); }
    render() { observe("child-render", this); return html`<button id="committed-child" data-value=${this.currentValue}>Child</button>`; }
    firstUpdated() { observe("child-first", this); }
    updated() { observe("child-updated", this); }
  }
  class Parent extends ports.ElementPort {
    willUpdate() { observe("parent-will", this); }
    render() {
      observe("parent-render", this);
      return html`<button id="committed-parent" data-value=${state.value}>Parent</button>
        ${state.mounted ? keyed(state.key, html`<forma-committed-probe .currentValue=${state.value}></forma-committed-probe>`) : nothing}`;
    }
    updated() { observe("parent-updated", this); }
  }
  renderer = new ports.RendererPort(f, { "forma-committed-probe": Probe }); f.renderer = renderer;
  parent = new Parent(); parent.tag = "forma-committed-parent"; parent.attributes = {};
  f.native = installOutputNavigationFocusNative(t, f, ports);
  const draw = () => { ports.bindFixture(f); renderer.draw(parent); return parent.querySelector("forma-committed-probe"); };
  t.after(() => {
    for (const record of renderer.instances.values()) record.instance.isConnected = false;
    for (const node of renderer.nodes) node.isConnected = false;
    parent.isConnected = false;
  });
  return { f, state, rows, parent, renderer, draw };
}

test("native lifecycle initial render cannot query uncommitted ports; post-update sees the complete parent and child", t => {
  const f = lifecycleFixture(t), child = f.draw();
  assert.ok(child);
  for (const row of f.rows.filter(row => row.phase.endsWith("-will") || row.phase.endsWith("-render"))) {
    assert.equal(row.parentNode, null); assert.equal(row.ownNode, null); assert.equal(row.child, null);
    assert.equal(row.updatingOwner, row.self);
  }
  const post = f.rows.filter(row => row.phase.endsWith("-first") || row.phase.endsWith("-updated"));
  assert.equal(post.length, 3);
  for (const row of post) {
    assert.equal(row.parentValue, "A"); assert.equal(row.ownValue, "A"); assert.equal(row.child, child);
    assert.equal(row.updatingOwner, null);
  }
  assert.equal(f.rows.filter(row => row.phase === "child-first").length, 1);
});

test("native lifecycle reads the prior exact committed tree during render, then retires replacement ports before updated", t => {
  const f = lifecycleFixture(t), child = f.draw(), oldParent = f.parent.querySelector("#committed-parent");
  const oldChild = child.querySelector("#committed-child");
  f.f.native.focus(oldParent);
  f.rows.length = 0; f.state.value = "B";
  assert.equal(f.draw(), child);
  for (const row of f.rows.filter(row => row.phase.endsWith("-will") || row.phase.endsWith("-render"))) {
    assert.equal(row.parentNode, oldParent); assert.equal(row.parentValue, "A"); assert.equal(row.child, child);
    assert.equal(row.ownNode, oldChild); assert.equal(row.ownValue, "A");
  }
  for (const row of f.rows.filter(row => row.phase.endsWith("-updated"))) {
    assert.equal(row.parentValue, "B"); assert.equal(row.ownValue, "B"); assert.equal(row.child, child);
    assert.notEqual(row.parentNode, oldParent); assert.notEqual(row.ownNode, oldChild);
    assert.equal(row.active, oldParent, "the fixture does not transfer focus to a replacement node");
    assert.equal(row.activeConnected, false, "removed native ports retire before post-update hooks");
  }
  assert.equal(oldParent.isConnected, false); assert.equal(oldChild.isConnected, false);
  assert.equal(f.renderer.query(null, "button").includes(oldParent), false);
  assert.equal(f.renderer.query(null, "button").includes(oldChild), false);
  assert.equal(f.rows.some(row => row.phase === "child-first"), false);
});

test("native lifecycle keyed replacement never gives the new owner the former owner's committed descendants", t => {
  const f = lifecycleFixture(t), old = f.draw(), oldNative = old.querySelector("#committed-child");
  f.f.native.focus(oldNative);
  f.rows.length = 0; f.state.key = "two";
  const current = f.draw();
  assert.notEqual(current, old); assert.equal(old.isConnected, false); assert.equal(oldNative.isConnected, false);
  const rendering = f.rows.find(row => row.phase === "child-render");
  assert.equal(rendering.self, current); assert.equal(rendering.ownNode, null);
  assert.equal(rendering.child, old, "the parent still exposes its previous committed child during render only");
  const updated = f.rows.find(row => row.phase === "child-updated");
  assert.equal(updated.child, current); assert.ok(updated.ownNode); assert.notEqual(updated.ownNode, oldNative);
  assert.equal(updated.active, oldNative); assert.equal(updated.activeConnected, false);
  assert.equal(f.parent.querySelector("forma-committed-probe"), current);
  assert.equal(f.renderer.query(null, "button").includes(oldNative), false);
});

test("native lifecycle actual removal and remount cannot revive an old port or committed owner", t => {
  const f = lifecycleFixture(t), old = f.draw(), oldNative = old.querySelector("#committed-child");
  f.state.mounted = false; f.rows.length = 0;
  assert.equal(f.draw(), null); assert.equal(old.isConnected, false); assert.equal(oldNative.isConnected, false);
  assert.equal(f.rows.some(row => row.phase === "child-updated"), false);
  assert.equal(f.parent.querySelector("#committed-child"), null);
  f.state.mounted = true; f.rows.length = 0;
  const current = f.draw(); assert.ok(current); assert.notEqual(current, old);
  const rendering = f.rows.find(row => row.phase === "child-render");
  assert.equal(rendering.ownNode, null); assert.equal(rendering.child, null);
  assert.notEqual(current.querySelector("#committed-child"), oldNative);
  assert.equal(f.rows.filter(row => row.phase === "child-first").length, 1);
});

const classed = (node, value) => String(node.attributes?.class ?? "").split(/\s/u).includes(value);
for (const boundary of ["keydown", "caller", "source", "route"]) test(
  "actual Image chooser still refuses " + boundary + " retirement before its child update", { concurrency: false, timeout: 30_000 }, async t => {
    const f = await lifecyclePage(t), owner = lifecycleOwner(f);
    const action = f.actions().find(value => value.target.kind === "configure"); assert.ok(action);
    assert.equal(await finishLifecycle(f, f.open(action, owner)), true);
    assert.ok(f.tree().visible("dialog").some(node => node.port?.open && classed(node, "next-format-dialog")));
    const cards = f.tree().visible("button").filter(node => node.attributes["data-choice-value"] === "image");
    assert.equal(cards.length, 1); const card = cards[0];
    const traceStart = f.trace.length;
    f.native.emit("pointerdown", card.port); f.native.focus(card.port); activateLifecycle(f, card);
    if (boundary === "keydown") f.native.emit("keydown", f.native.document.activeElement);
    else if (boundary === "caller") owner.retire();
    else if (boundary === "source") f.appendEvent("BlockPropertyEdited", {
      block_id: "lifecycle-direction", property_path: "text", old_value: "Exact authored direction for this Document",
      new_value: "A newer deliberate source before Image configuration",
    });
    else f.store.setRoute("/activity");
    const expectedRoute = f.store.route.get();
    const expectedSource = JSON.stringify(f.store.events.get());
    for (let attempt = 0; attempt < 8; attempt++) await f.settle();
    assert.equal(f.tree().visible("dialog").some(node => node.port?.open && classed(node, "generation-details-dialog")), false);
    assert.equal(f.trace.slice(traceStart).some(value => value.startsWith("open:")
      && value.slice(5).split(/\s/u).includes("generation-details-dialog")), false, "retired Image opening never promotes even a transient modal");
    assert.equal(JSON.stringify(f.store.events.get()), expectedSource, "no configuration or generation event is added");
    assert.equal(f.store.projection.get().documentId, f.documentId);
    if (boundary === "route") {
      const route = new URL(expectedRoute, "https://fixture.invalid");
      assert.equal(route.pathname, "/activity"); assert.equal(route.searchParams.get("document"), f.documentId);
      assert.equal(f.store.route.get(), expectedRoute, "the exact current canonical Activity route is retained");
    }
    t.diagnostic(JSON.stringify({ boundary, imageDialogs: 0, documentId: f.documentId,
      currentRoute: f.store.route.get(), nativeTrace: f.trace.filter(value => value.startsWith("open:") || value.startsWith("focus:")) }));
  });


test("finite native closest single tag.class follows the nearest current matching ancestor, not a class-only lookalike", { concurrency: false }, async t => {
  const { fullPageTree } = await import("./helpers/calm-full-page-fixture.mjs");
  // Native-adapter contract only. This fixture supplies no application/Store
  // permission, route, receipt, physical browser focus or modal authority.
  const f = { trace: [], listeners: new Map(), timers: new Map(), store: {},
    storeHost: { document: {}, window: { ...ports.windowPort } } };
  ports.bindFixture(f); t.after(() => ports.bindFixture(null));
  f.host = new ports.ElementPort(); f.host.tag = "fixture-tag-class-owner";
  f.renderer = new ports.RendererPort(f, {}); f.tree = () => fullPageTree(f);
  const native = installOutputNavigationFocusNative(t, f, ports), state = { mounted: true };
  const view = () => html`<section id="compound-root"><button id="compound-outside">Outside</button>
    ${state.mounted ? html`<dialog id="compound-outer" class="library-focus-dialog" open>
      <div id="compound-lookalike" class="library-focus-dialog"><button id="compound-trigger">Controls</button></div>
      <dialog id="compound-inner" class="library-focus-dialog other-class" open><button id="compound-inner-trigger">Inner controls</button></dialog>
    </dialog>` : nothing}<dialog id="compound-sibling" class="other-dialog" open><button id="compound-sibling-trigger" disabled>Other</button></dialog></section>`;
  const draw = () => {
    f.renderer.draw(f.host, view);
    return Object.fromEntries(f.renderer.nodes.filter(node => node.attributes.id)
      .map(node => [node.attributes.id.replace("compound-", ""), node]));
  };
  let nodes = draw();
  assert.strictEqual(nodes.trigger.closest(".library-focus-dialog"), nodes.lookalike,
    "The existing class-only selector truthfully finds the closer wrong-tag node");
  assert.strictEqual(nodes.trigger.closest("dialog.library-focus-dialog"), nodes.outer,
    "The compound selector must skip a nearer DIV carrying the same class");
  assert.strictEqual(nodes["inner-trigger"].closest("dialog.library-focus-dialog"), nodes.inner);
  assert.strictEqual(nodes.inner.closest("dialog.library-focus-dialog"), nodes.inner, "closest includes the native node itself");
  assert.strictEqual(nodes.trigger.closest("div.library-focus-dialog"), nodes.lookalike);
  assert.equal(nodes.trigger.closest("section.library-focus-dialog"), null);
  assert.equal(nodes.outside.closest("dialog.library-focus-dialog"), null);
  assert.equal(nodes["sibling-trigger"].closest("dialog.library-focus-dialog"), null,
    "A same-owner sibling dialog is not an ancestor or a fallback target");
  assert.equal(nodes["sibling-trigger"].matches(":disabled"), true);
  assert.equal(nodes.trigger.matches(":disabled"), false, "Existing native pseudo behavior is unchanged");
  nodes.outer.setAttribute("class", "changed-current-class");
  assert.equal(nodes.trigger.closest("dialog.library-focus-dialog"), null, "Native class changes are read live, not cached as a positive answer");
  assert.strictEqual(nodes.trigger.closest("dialog.changed-current-class"), nodes.outer);
  assert.strictEqual(nodes["inner-trigger"].closest("dialog.library-focus-dialog"), nodes.inner);
  const old = nodes; state.mounted = false; nodes = draw();
  assert.equal(old.trigger.isConnected, false); assert.equal(old.outer.isConnected, false);
  assert.equal(old.trigger.closest("dialog.library-focus-dialog"), null, "Removed literal nodes cannot recover a target from another current tree");
  state.mounted = true; nodes = draw();
  assert.notStrictEqual(nodes.trigger, old.trigger); assert.notStrictEqual(nodes.outer, old.outer);
  assert.strictEqual(nodes.trigger.closest("dialog.library-focus-dialog"), nodes.outer);
  assert.equal(old.trigger.closest("dialog.library-focus-dialog"), null);
  assert.equal(native.nativeFocus.length, 0); assert.equal(native.nativeScroll.length, 0);
});
