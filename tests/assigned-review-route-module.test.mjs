import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assignmentPage, sceneDeferred, flushStoreFrames, libraryFocusFromRoute,
  artifactFocusOptionsFromRoute, originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });
const turn = () => new Promise(setImmediate);
const connectedLibraries = q => q.f.components().filter(owner => owner.tag === "forma-library" && owner.isConnected);

async function advance(q) {
  await flushStoreFrames(q.h);
  await q.f.flush();
  await turn();
}
async function until(q, check, message) {
  for (let attempt = 0; attempt < 80 && !check(); attempt++) await advance(q);
  assert.ok(check(), message);
}

async function delayedPage(t) {
  const q = await assignmentPage(t, "same-document"), { f, h } = q;
  await flushStoreFrames(h); await f.settle();
  const native = installOutputNavigationFocusNative(t, f, ports);
  assert.equal(connectedLibraries(q).length, 0, "Activity is mounted before the tested action");
  assert.equal(typeof f.renderer.registry["forma-library"], "function", "retain the actual Library constructor");
  assert.equal(f.pendingNativeComponentTags, undefined, "registration gate is opt-in");
  const pendingTags = new Set(["forma-library"]);
  f.pendingNativeComponentTags = pendingTags;

  // Existing native route-module port: every request joins one deferred module.
  // It only withholds custom-element registration. Shell, Store, Library and
  // DocumentArtifacts execute their complete current implementations.
  const gate = sceneDeferred(), loader = ports.moduleCache.get("src/route-loader.ts");
  const originalLoad = loader.loadRouteComponent, moduleCalls = [];
  let released = false, frameCallbacks = 0;
  const completion = gate.promise.then(() => {
    released = true; pendingTags.delete("forma-library"); f.requested = true;
  });
  t.mock.method(loader, "loadRouteComponent", function (route) {
    if (libraryFocusFromRoute(route)?.kind !== "artifact") return originalLoad.call(this, route);
    moduleCalls.push(route);
    return completion.then(() => originalLoad.call(this, route));
  });
  const originalFrame = ports.windowPort.requestAnimationFrame;
  t.mock.method(ports.windowPort, "requestAnimationFrame", function (callback) {
    return originalFrame.call(this, time => { if (!released) frameCallbacks++; callback(time); });
  });
  const calls = [], originalOpen = h.store.openAssignedReview;
  t.mock.method(h.store, "openAssignedReview", function (task, options) {
    assert.equal(task.id, q.task.id, "the original Activity control selects the exact task");
    const call = { task }; calls.push(call);
    call.pending = originalOpen.call(this, task, options);
    void call.pending.then(value => { call.value = value; call.done = true; }, error => { call.error = error; call.done = true; });
    return call.pending;
  });
  t.after(() => { gate.resolve(); delete f.pendingNativeComponentTags; });
  return { ...q, native, gate, completion, moduleCalls, calls, released: () => released, frameCallbacks: () => frameCallbacks };
}

for (const boundary of ["current", "route", "source", "keydown"]) test(
  "Assigned review waits for the delayed actual Library module / " + boundary,
  { timeout: 25_000 }, async t => {
    const q = await delayedPage(t), { h, f } = q;
    const activation = f.act(q.button());
    let activationDone = false, activationError;
    void activation.then(() => { activationDone = true; }, error => { activationDone = true; activationError = error; });
    try {
      await until(q, () => q.calls[0]?.done,
        "the actual Store handoff completes before releasing Library registration");
    } catch (error) {
      t.diagnostic("ASSIGNED_REVIEW_ADMISSION " + JSON.stringify({
        route: h.store.route.get(), calls: q.calls.map(call => ({ done: call.done, value: call.value, error: String(call.error ?? "") })),
        moduleCalls: q.moduleCalls, activationDone, activationError: String(activationError ?? ""), trace: f.trace.slice(-24),
      }));
      throw error;
    }
    if (q.calls[0].error) throw q.calls[0].error;
    assert.equal(q.calls[0].value, true, "Store route handoff is genuine, not a fabricated success");
    assert.equal(q.calls.length, 1, "one explicit context handshake");
    const destination = h.store.route.get(), source = h.store.captureSourceOwnership();
    assert.deepEqual(libraryFocusFromRoute(destination), { kind: "artifact", id: q.task.artifactId });
    assert.deepEqual(artifactFocusOptionsFromRoute(destination), {
      expectedRevision: q.task.revision, expectedContentSha256: q.task.contentSha256, intent: "review",
    });
    assert.equal(h.store.sourceOwnershipActive(source), true);

    // More than the former 24 animation opportunities pass while registration
    // is unavailable. Only actual pending callbacks execute; no private method
    // or lease.current() is invoked to create an observation.
    for (let frame = 0; frame < 36; frame++) await advance(q);
    assert.equal(q.released(), false);
    assert.equal(connectedLibraries(q).length, 0, "no same-Store Library attaches before module completion");
    assert.equal(q.viewerCalls.length, 0, "no viewer can open before the real child is available");
    const held = { boundary, opportunities: 36, callbacks: q.frameCallbacks(), route: h.store.route.get(),
      moduleRequests: q.moduleCalls.length, connectedLibraries: connectedLibraries(q).length, viewerCalls: q.viewerCalls.length };
    t.diagnostic("ASSIGNED_REVIEW_DELAYED_MODULE " + JSON.stringify(held));

    if (boundary === "route") {
      h.store.setRoute("/activity?document=" + encodeURIComponent(q.entryDocument));
      await advance(q);
    } else if (boundary === "source") {
      // Existing RAM Worker revocation helper owns its one expected audit event
      // and financial/source-history assertions. No real service is reachable.
      await q.revoke();
      await assert.rejects(h.store.refreshEvents(), /403/);
      assert.equal(h.store.sourceOwnershipActive(source), false);
      await advance(q);
    } else if (boundary === "keydown") q.native.emit("keydown");
    const routeAtRelease = h.store.route.get(), traceAtRelease = f.trace.length;
    q.gate.resolve(); await q.completion;
    for (let frame = 0; frame < 36; frame++) await advance(q);
    await until(q, () => activationDone && q.viewerCalls.every(call => call.result !== undefined || call.error !== undefined),
      "the original activation and any actual viewer opening settle");
    if (activationError) throw activationError;
    assert.equal(h.store.route.get(), routeAtRelease, "late module completion cannot replace the current route");

    const visible = f.tree().visible("dialog").filter(node => node.port?.open
      && String(node.attributes.class ?? "").includes("document-artifact-view"));
    if (boundary === "current") {
      assert.equal(q.viewerCalls.length, 1, "join the one original Library opening after the delayed module");
      const call = q.viewerCalls[0];
      assert.equal(call.result, true, "current assigned review must survive a module delay beyond 24 frames");
      assert.equal(call.owner.documentId, q.task.documentId);
      assert.equal(call.owner.isConnected, true);
      assert.equal(visible.length, 1);
      assert.match(f.tree().root.text, /EXACT_ASSIGNED_B_BODY/);
      assert.equal(h.store.sourceOwnershipActive(source), true);
      assert.equal(h.store.session.get().projectContext.projectId, q.task.projectId);
      assert.equal(h.store.reviewInbox.get().find(task => task.id === q.task.id)?.status, "pending");
      assert.deepEqual(artifactFocusOptionsFromRoute(h.store.route.get()), {
        expectedRevision: q.task.revision, expectedContentSha256: q.hash, intent: "review",
      });
    } else {
      assert.equal(visible.length, 0, "a cancelled opening cannot promote after delayed registration");
      assert.ok(q.viewerCalls.every(call => call.result !== true), "no replacement viewer adopts a retired opening");
      assert.ok(!f.trace.slice(traceAtRelease).includes("open:document-artifact-view"), "no transient stale dialog promotion");
      if (boundary === "source") assert.equal(h.store.sourceOwnershipActive(source), false);
    }
  });
