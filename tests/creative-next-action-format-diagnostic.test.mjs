// Diagnostic pair only. Actual installed components, Store and existing native
// ports; no private-method replacement or physical-browser/AT claim.
// Run after root's separate lifecycle cleanup-order correction.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { lifecyclePage, finishLifecycle, lifecycleOwner, activateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";

const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw Error("No external/provider transport in C19 format diagnostics"); };
after(() => { assert.equal(external, 0); globalThis.fetch = originalFetch; });
const classed = (node, value) => String(node.attributes?.class ?? "").split(/\s/u).includes(value);
const dialogs = f => f.tree().visible("dialog").filter(node => node.port?.open);
const unique = (values, label) => { assert.equal(values.length, 1, label); return values[0]; };
const describe = node => node ? { tag: node.tagName ?? node.tag, id: node.getAttribute?.("id"),
  className: node.getAttribute?.("class"), pane: node.getAttribute?.("data-workbench-pane"),
  choice: node.getAttribute?.("data-choice-value") } : null;
// Observe the actual public call and only the required() calls it really makes.
// No private method or guard result is replaced, no additional guard is invoked,
// and the original method's exact Promise is returned without an added await.
function observeImageConfiguration(t, f) {
  const prototype = f.renderer.registry["forma-generation-actions"].prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "openConfiguration");
  assert.equal(typeof descriptor?.value, "function", "the registered actual public method exists");
  const original = descriptor.value, rows = [];
  const snapshot = host => {
    let workspace = host.parentElement;
    while (workspace && workspace.tag !== "forma-workspace") workspace = workspace.parentElement;
    const active = f.native.document.activeElement;
    const panes = nodes => (nodes ?? []).filter(node => node.owner === workspace && node.tag === "button"
      && node.attributes?.["data-workbench-pane"] === "result");
    const current = panes(f.renderer.nodes), previous = panes(f.renderer.previousNodes);
    return {
      host: { tag: host.tag, connected: host.isConnected, compact: host.compact, source: host.source,
        sameStore: host.store === f.store, workspaceConnected: Boolean(workspace?.isConnected) },
      connectedImageHosts: [...f.renderer.instances.values()].filter(row => row.instance.tag === "forma-generation-actions"
        && row.instance.isConnected && row.instance.store === f.store).length,
      active: { ...describe(active), connected: Boolean(active?.isConnected) },
      currentResultCount: current.length, previousResultCount: previous.length,
      activeIsCurrentResult: current.includes(active), activeIsPreviousResult: previous.includes(active),
      updatingOwner: f.renderer.updatingOwner?.tag ?? null,
      documentId: f.store.projection.get().documentId,
    };
  };
  Object.defineProperty(prototype, "openConfiguration", { ...descriptor, value: function (...args) {
    const host = () => this, call = rows.filter(row => row.kind === "call").length + 1;
    rows.push({ kind: "call", call, suppliedGuard: typeof args[0] === "function", snapshot: snapshot(host()) });
    const forwarded = [...args];
    if (typeof args[0] === "function") {
      const required = args[0];
      forwarded[0] = function (...values) {
        const before = snapshot(host());
        // Method labels only: do not emit eval/data-URL source from the fixture.
        const callers = String(new Error().stack ?? "").split("\n").slice(2, 8)
          .map(line => line.trim().split("(")[0].slice(0, 100));
        try {
          const result = Reflect.apply(required, this, values);
          rows.push({ kind: "required", call, stage: values[0], before, result, callers });
          return result;
        } catch (error) {
          rows.push({ kind: "required-threw", call, stage: values[0], before, name: error?.name, callers });
          throw error;
        }
      };
    }
    try {
      const pending = Reflect.apply(original, host(), forwarded);
      Promise.resolve(pending).then(result => {
        rows.push({ kind: "settled", call, result, snapshot: snapshot(host()) });
      }, error => { rows.push({ kind: "rejected", call, name: error?.name, snapshot: snapshot(host()) }); });
      return pending;
    } catch (error) {
      rows.push({ kind: "threw", call, name: error?.name, snapshot: snapshot(host()) });
      throw error;
    }
  } });
  t.after(() => {
    Object.defineProperty(prototype, "openConfiguration", descriptor);
    t.diagnostic("C19_IMAGE_PUBLIC_CALL_OBSERVATION " + JSON.stringify(rows));
  });
}

function nativeActivate(f, node) {
  // A pointer activation focuses its current native button before its click.
  // This does not grant a lease or replace the actual ChoiceCard event path.
  assert.ok(node.port?.isConnected);
  f.native.emit("pointerdown", node.port);
  f.native.focus(node.port);
  activateLifecycle(f, node);
}
async function settleChoice(f) {
  // Preserve the original seven cases' bounded settle, which already drains
  // component RAFs. Report any remaining Store RAF separately, do not hide it.
  for (let attempt = 0; attempt < 8; attempt++) await f.settle();
}
function evidence(f, traceStart, focusStart) {
  return {
    trace: f.trace.slice(traceStart),
    nativeFocus: f.native.nativeFocus.slice(focusStart).map(row => ({
      target: describe(row.node), previous: describe(row.previous), previousConnected: row.previousConnected,
    })),
    active: describe(f.native.document.activeElement),
    openDialogs: dialogs(f).map(node => node.attributes.class),
    componentRafs: f.frames.size,
    storeRafs: [...f.storeHost.timers.values()].filter(timer => timer.delay === 16).length,
    documentId: f.store.projection.get().documentId,
  };
}
async function keepCurrentEditing(f, dialog) {
  const firstField = f.tree().visible("input").find(node => node.owner === dialog.owner)
    ?? f.tree().visible("button").find(node => node.owner === dialog.owner);
  assert.ok(firstField, "the actual current configuration field exists");
  f.native.emit("keydown", firstField.port);
  await f.settle();
  assert.ok(dialogs(f).some(node => classed(node, "generation-details-dialog")),
    "healthy editing remains open after its later keyboard interaction");
  assert.equal(f.store.projection.get().documentId, f.documentId);
  f.sourceUnchanged();
}

test("C19 format diagnostic: native chooser Image reaches its existing configuration", { concurrency: false, timeout: 30_000 }, async t => {
  const f = await lifecyclePage(t), owner = lifecycleOwner(f);
  observeImageConfiguration(t, f);
  const action = f.actions().find(value => value.target.kind === "configure");
  assert.ok(action, "the actual current resolver offers configuration");
  assert.equal(await finishLifecycle(f, f.open(action, owner)), true);
  assert.ok(dialogs(f).some(node => classed(node, "next-format-dialog")));
  const card = unique(f.tree().visible("button").filter(node => node.attributes["data-choice-value"] === "image"),
    "one current native Image choice");
  const traceStart = f.trace.length, focusStart = f.native.nativeFocus.length;
  nativeActivate(f, card);
  await settleChoice(f);
  f.sourceUnchanged();
  assert.equal(f.store.projection.get().documentId, f.documentId);
  t.diagnostic("C19_FORMAT_NATIVE_HANDOFF " + JSON.stringify(evidence(f, traceStart, focusStart)));
  assert.ok(f.trace.slice(traceStart).includes("event:forma-action"), "actual ChoiceCard emitted its genuine semantic action");
  const dialog = dialogs(f).find(node => classed(node, "generation-details-dialog"));
  assert.ok(dialog, "the current native Image choice must open its existing configuration");
  await keepCurrentEditing(f, dialog);
});

test("C19 format diagnostic: direct current Image options is a healthy child control", { concurrency: false, timeout: 30_000 }, async t => {
  const f = await lifecyclePage(t, { route: "document" });
  observeImageConfiguration(t, f);
  const result = unique(f.tree().visible("button").filter(node => node.attributes["data-workbench-pane"] === "result"),
    "one current Result pane invoker");
  nativeActivate(f, result);
  await settleChoice(f);
  const trigger = unique(f.tree().visible("button").filter(node => classed(node, "generation-details-trigger")),
    "one existing direct Image options invoker");
  const traceStart = f.trace.length, focusStart = f.native.nativeFocus.length;
  nativeActivate(f, trigger);
  await settleChoice(f);
  f.sourceUnchanged();
  t.diagnostic("C19_FORMAT_DIRECT_CHILD " + JSON.stringify(evidence(f, traceStart, focusStart)));
  const dialog = dialogs(f).find(node => classed(node, "generation-details-dialog"));
  assert.ok(dialog, "existing native Image options opens the same real child configuration");
  await keepCurrentEditing(f, dialog);
});
