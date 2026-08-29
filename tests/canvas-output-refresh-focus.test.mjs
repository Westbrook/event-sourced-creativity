import assert from "node:assert/strict";
import test from "node:test";
import { fixture, documentPort } from "./helpers/canvas-focus-repair-host.mjs";

const turn = () => new Promise(setImmediate);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const clickEvent = target => ({ type: "click", target, currentTarget: target, button: 0, shiftKey: false,
  composedPath: () => [target], preventDefault() {}, stopPropagation() {} });
const listenerCounts = f => Object.fromEntries(["pointerdown", "keydown", "focusin"].map(type => [type, (f.listeners.get(type) ?? []).length]));
const focusCount = f => f.trace.filter(value => value.startsWith("focus:")).length;
const refreshButton = f => f.native("button", node => node.handlers.click?.toString().includes("#deskRefreshOutputs"));
const ordinaryControl = f => f.native("button", node => node.attributes.class?.includes("canvas-focus-toggle"));
const selectedHeading = f => f.host.querySelectorAll("[id]").find(node => node.id === "canvas-outcome-desk-selected");

async function setup(locale) {
  const f = fixture({ populated: true, chosen: "document-0", documentCount: 2, locale });
  const reads = [], gates = [];
  f.store.outputRequirements = {
    resource: () => ({ state: "idle", snapshot: null }),
    ensure: async (documentId, options) => { const gate = deferred(); reads.push({ documentId, options }); gates.push(gate); await gate.promise; },
  };
  const toggle = f.renderer.ownNodes(f.host, "button").find(node => node.id === "canvas-outcome-toggle");
  assert.ok(toggle); toggle.handlers.click.call(f.host, clickEvent(toggle)); await f.flush();
  assert.ok(selectedHeading(f)?.isConnected);
  const original = { events: JSON.stringify(f.state.events), route: f.store.route.get(), selected: [...f.state.selected], listeners: listenerCounts(f) };
  return { f, reads, gates, original };
}
function start(f) {
  const button = refreshButton(f); assert.ok(button?.isConnected && !button.disabled);
  button.focus(); button.handlers.click.call(f.host, clickEvent(button)); return button;
}
function unchanged({ f, reads, original }, count = 1) {
  assert.deepEqual(reads, Array.from({ length: count }, () => ({ documentId: "document-0", options: { force: true } })));
  assert.equal(JSON.stringify(f.state.events), original.events, "free read does not author events");
  assert.equal(f.state.requests.length, 0, "no generation, receipt mutation or generic API command");
  assert.equal(f.state.batches.length, 0, "no queued authoring");
  assert.deepEqual(listenerCounts(f), original.listeners, "the request disposes its existing shared DOM lease");
}
async function cleanup(h, renderGate) {
  for (const gate of h.gates) gate.resolve();
  renderGate?.resolve(true); await turn();
  h.f.host.isConnected = false; h.f.host.disconnectedCallback();
}

// These two families use actual full Canvas/component/model bodies and existing
// deterministic Store/resource/native ports. The ensure family leaves normal
// rendering untouched. The render family holds only updateComplete after its
// original full render has occurred. Neither is a browser or Worker authority test.
for (const locale of ["en", "fr", "ar", "ja"]) for (const boundary of ["ensure", "render"]) {
  for (const change of ["none", "pointer-focus", "keyboard-focus", "focus"]) {
    test(locale + " Output refresh " + boundary + " preserves " + change + " focus ownership", async () => {
      const h = await setup(locale), { f } = h, renderGate = deferred();
      let renderEntered = false;
      const originalTick = f.tick;
      if (boundary === "render") f.tick = owner => {
        const rendered = originalTick(owner);
        if (owner !== f.host) return rendered;
        renderEntered = true; return rendered.then(() => renderGate.promise);
      };
      try {
        start(f); assert.equal(h.reads.length, 1);
        if (boundary === "render") { h.gates[0].resolve(); await turn(); assert.equal(renderEntered, true); }
        const newer = ordinaryControl(f); assert.ok(newer?.isConnected);
        if (change === "pointer-focus") documentPort.emit("pointerdown", newer);
        if (change === "keyboard-focus") documentPort.emit("keydown", newer);
        if (change !== "none") newer.focus();
        const before = focusCount(f);
        h.gates[0].resolve(); renderGate.resolve(true); await turn();
        assert.equal(documentPort.activeElement === (change === "none" ? selectedHeading(f) : newer), true,
          "the original read cannot adopt a newer user's focus at either awaited boundary");
        assert.equal(focusCount(f) - before, change === "none" ? 1 : 0);
        assert.equal(f.store.route.get(), h.original.route);
        assert.deepEqual(f.state.selected, h.original.selected);
        unchanged(h);
      } finally { f.tick = originalTick; await cleanup(h, renderGate); }
    });
  }
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const change of ["route", "authority", "authority-ABA", "selection", "disconnect", "modal"]) {
  test(locale + " Output refresh retains the existing " + change + " invalidation", async () => {
    const h = await setup(locale), { f } = h;
    try {
      start(f);
      if (change === "route") { const control = ordinaryControl(f); control.handlers.click.call(f.host, clickEvent(control)); await f.flush(); }
      if (change === "authority" || change === "authority-ABA") {
        f.state.authorization = "new-authorization"; f.draw();
        if (change === "authority-ABA") { f.state.authorization = "actor-a"; f.draw(); }
      }
      if (change === "selection") await f.select(1, "document");
      if (change === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
      if (change === "modal") await f.sources();
      const before = focusCount(f), route = f.store.route.get(), selection = [...f.state.selected];
      h.gates[0].resolve(); await turn();
      assert.equal(focusCount(f), before, "a stale refresh never restores focus");
      assert.equal(f.store.route.get(), route); assert.deepEqual(f.state.selected, selection);
      if (change === "disconnect") {
        assert.equal(f.host.isConnected, false);
        assert.equal(listenerCounts(f).pointerdown, 0); assert.equal(listenerCounts(f).focusin, 0);
        assert.equal(JSON.stringify(f.state.events), h.original.events);
        assert.equal(f.state.requests.length, 0); assert.equal(f.state.batches.length, 0);
      } else unchanged(h);
    } finally { await cleanup(h); }
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const gesture of ["pointerdown", "keydown", "focus-ABA", "pointer-body"]) {
  test(locale + " Output refresh does not revive after " + gesture, async () => {
    const h = await setup(locale), { f } = h;
    try {
      const original = start(f), newer = ordinaryControl(f); assert.ok(newer?.isConnected);
      if (gesture === "focus-ABA") { newer.focus(); original.focus(); }
      else if (gesture === "pointer-body") { documentPort.emit("pointerdown", newer); newer.focus(); documentPort.activeElement = documentPort.body; }
      else documentPort.emit(gesture, newer);
      const before = focusCount(f), active = documentPort.activeElement;
      h.gates[0].resolve(); await turn();
      assert.equal(documentPort.activeElement === active, true); assert.equal(focusCount(f), before);
      unchanged(h);
    } finally { await cleanup(h); }
  });
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test(locale + " only the latest explicit Output refresh may return focus", async () => {
    const h = await setup(locale), { f } = h;
    try {
      start(f); start(f); assert.equal(h.reads.length, 2);
      const before = focusCount(f); h.gates[0].resolve(); await turn();
      assert.equal(focusCount(f), before, "first request is retired while the second remains pending");
      h.gates[1].resolve(); await turn();
      assert.equal(documentPort.activeElement === selectedHeading(f), true); assert.equal(focusCount(f), before + 1);
      unchanged(h, 2);
    } finally { await cleanup(h); }
  });
}
