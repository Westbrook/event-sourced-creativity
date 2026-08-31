// Baseline/repair oracle for the installed static Add-context command only.
// Actual Shell, Workspace, Store and existing native ports; no private method
// extraction, replacement or provider operation. Root alone executes this file.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { lifecyclePage, finishLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";

const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw Error("No external/provider transport in static context ownership"); };
after(() => { assert.equal(external, 0); globalThis.fetch = originalFetch; });
const B = "  Later unsent draft B 文書\nنور  ";
const C = "An admitted composer keeps this later unsent decision.";
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s/u).includes(name);
const openComposers = f => f.tree().visible("dialog").filter(node => node.port?.open && classed(node, "block-composer-dialog"));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function drain(f) {
  for (let attempt = 0; attempt < 8; attempt++) {
    await f.settle();
    for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) {
      f.storeHost.timers.delete(id); timer.callback(0);
    }
    await new Promise(setImmediate);
  }
}

for (const boundary of ["healthy", "pointerdown", "keydown", "focus"]) test(
  "C19 static Add context owns delayed native opening / " + boundary,
  { concurrency: false, timeout: 30_000 }, async t => {
    const f = await lifecyclePage(t), originRoute = f.store.route.get();
    const trigger = f.find("button", node => node.owner.tag === "forma-shell" && classed(node, "command-trigger"));
    await f.act(trigger);
    const label = f.i18n.t("command.addDecision", "Add a creative decision");
    const row = f.find("button", node => node.attributes.role === "option"
      && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
    const gate = deferred(), entered = deferred(), tick = f.tick;
    let held = false;
    // Delay only the existing native updateComplete port after the helper's
    // genuine route change. The actual menu row and every app method run intact.
    f.tick = async owner => {
      if (!held && owner === f.host && !f.store.ui.commandOpen && f.store.route.get() !== originRoute) {
        held = true; entered.resolve(); await gate.promise;
      }
      return tick(owner);
    };
    t.after(() => { gate.resolve(); f.tick = tick; });
    const traceStart = f.trace.length;
    const activation = f.act(row);
    await finishLifecycle(f, entered.promise);
    assert.equal(held, true, "the actual post-route Shell updateComplete was reached");
    assert.equal(f.store.ui.commandOpen, false);
    assert.equal(f.store.projection.get().projectId, f.projectId);
    assert.equal(f.store.projection.get().documentId, f.documentId);
    assert.equal(openComposers(f).length, 0, "the barrier precedes native composer promotion");
    const expectedRoute = f.store.route.get();
    if (boundary !== "healthy") {
      const field = f.find("textarea", node => node.attributes.id === "creative-command");
      assert.ok(field.port.isConnected && !field.hiddenBy, "the newer input is a genuine current native field");
      // Isolate each cancellation signal; do not manufacture another app action.
      if (boundary === "focus") f.native.focus(field.port);
      else f.native.emit(boundary, boundary === "pointerdown" ? field.port : f.native.document.activeElement);
      field.port.value = B;
      await f.act(field, "input");
      assert.equal(f.tree().nodes.find(node => node.attributes?.id === "creative-command")?.port?.value, B);
    }
    gate.resolve();
    await activation;
    await drain(f);
    f.sourceUnchanged();
    assert.equal(f.store.route.get(), expectedRoute, "no different route is used to make the refusal pass");
    assert.equal(f.store.projection.get().projectId, f.projectId);
    assert.equal(f.store.projection.get().documentId, f.documentId);
    const promoted = f.trace.slice(traceStart).filter(value => value.startsWith("open:") && value.includes("block-composer-dialog"));
    const draft = f.tree().nodes.find(node => node.attributes?.id === "creative-command")?.port?.value;
    t.diagnostic("C19_STATIC_CONTEXT " + JSON.stringify({ boundary, held, originRoute, currentRoute: expectedRoute,
      projectId: f.projectId, documentId: f.documentId, promoted, openComposers: openComposers(f).length,
      currentDraft: draft, componentRafs: f.frames.size,
      storeRafs: [...f.storeHost.timers.values()].filter(timer => timer.delay === 16).length, external }));
    if (boundary !== "healthy") {
      assert.equal(draft, B, "the original command does not change newer raw input");
      assert.deepEqual(promoted, [], "a newer native interaction must prevent even transient late composer promotion");
      assert.equal(openComposers(f).length, 0);
      return;
    }
    assert.equal(openComposers(f).length, 1, "untouched Add context reaches the existing composer");
    const direction = f.find("button", node => node.attributes["data-choice-value"] === "direction");
    await f.act(direction);
    const dialog = openComposers(f)[0]; assert.ok(dialog);
    const text = f.find("textarea", node => node.owner === dialog.owner && classed(node.parent, "block-draft-copy"));
    text.port.value = C; await f.act(text, "input");
    f.native.emit("keydown", text.port); await drain(f);
    assert.equal(openComposers(f).length, 1, "disposing the opening lease must not retire admitted editing");
    assert.ok(f.tree().visible("textarea").some(node => node.port?.value === C));
    f.sourceUnchanged();
  });

test("C19 static Add context vetoes a newer gesture at the actual child-render boundary",
  { concurrency: false, timeout: 30_000 }, async t => {
    const f = await lifecyclePage(t), render = f.renderer.value.bind(f.renderer);
    let entered = false;
    // The actual Workspace has already called #beginBlock/requestUpdate when
    // its real composer template reaches this existing native-renderer seam.
    // Deliver one newer key gesture before returning that unchanged template;
    // no app method, private field, current callback or dialog is replaced.
    f.renderer.value = function(value, component, ...args) {
      if (!entered && component?.tag === "forma-workspace" && value?.strings
        && value.strings.some(part => part.includes("block-composer-dialog"))) {
        entered = true;
        f.native.emit("keydown");
      }
      return render(value, component, ...args);
    };
    t.after(() => { f.renderer.value = render; });
    await f.act(f.find("button", node => node.owner.tag === "forma-shell" && classed(node, "command-trigger")));
    const label = f.i18n.t("command.addDecision", "Add a creative decision");
    const row = f.find("button", node => node.attributes.role === "option"
      && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
    const traceStart = f.trace.length;
    await f.act(row); await drain(f);
    const promoted = f.trace.slice(traceStart).filter(value => value.startsWith("open:") && value.includes("block-composer-dialog"));
    t.diagnostic("C19_STATIC_CONTEXT_CHILD " + JSON.stringify({ entered, promoted,
      openComposers: openComposers(f).length, projectId: f.store.projection.get().projectId,
      documentId: f.store.projection.get().documentId, external }));
    assert.equal(entered, true, "the genuine child template reached its pre-promotion boundary");
    assert.deepEqual(promoted, [], "a final refusal must not excuse transient stale native promotion");
    assert.equal(openComposers(f).length, 0);
    assert.equal(f.store.projection.get().projectId, f.projectId);
    assert.equal(f.store.projection.get().documentId, f.documentId);
    f.sourceUnchanged();
  });

test("C19 static Add context preserves an already-present Ask draft and ordinary admitted editing",
  { concurrency: false, timeout: 30_000 }, async t => {
    const f = await lifecyclePage(t, { route: "document" });
    const before = "  Existing unsent Ask A 文書\nنور  ";
    const field = f.find("textarea", node => node.attributes.id === "creative-command");
    field.port.value = before; await f.act(field, "input");
    await f.act(f.find("button", node => node.owner.tag === "forma-shell" && classed(node, "command-trigger")));
    const label = f.i18n.t("command.addDecision", "Add a creative decision");
    const row = f.find("button", node => node.attributes.role === "option"
      && node.children.some(child => typeof child !== "string" && child.tag === "span" && child.text === label));
    await f.act(row); await drain(f);
    assert.equal(openComposers(f).length, 1, "static Add context must not borrow generic next-action prompt refusal");
    assert.equal(f.tree().nodes.find(node => node.attributes?.id === "creative-command")?.port?.value, before);
    await f.act(f.find("button", node => node.attributes["data-choice-value"] === "direction"));
    const dialog = openComposers(f)[0]; assert.ok(dialog);
    const text = f.find("textarea", node => node.owner === dialog.owner && classed(node.parent, "block-draft-copy"));
    text.port.value = C; await f.act(text, "input");
    f.native.emit("keydown", text.port); await drain(f);
    assert.equal(openComposers(f).length, 1);
    assert.ok(f.tree().visible("textarea").some(node => node.port?.value === C));
    assert.equal(f.tree().nodes.find(node => node.attributes?.id === "creative-command")?.port?.value, before);
    f.sourceUnchanged();
  });
