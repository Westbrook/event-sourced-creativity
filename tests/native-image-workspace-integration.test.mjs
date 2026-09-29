// Focused current composition controls. The existing full-page fixture supplies
// real component methods and deterministic native event/ResizeObserver ports.
// These tests make no browser, provider, background-quiescence or paint claim.
import assert from "node:assert/strict";
import test from "node:test";
import { nothing as noImagePresentation } from "lit";
import {
  IMAGE_RESPONSIVE_OPTIONS, imageResponsiveFixture, assertImageRetiredBeforeRender,
} from "./helpers/native-image-workspace-integration-fixture.mjs";
import { sceneDeferred as imageDeferred, untilScene as untilImageHost } from "./helpers/scene-cost-store-host.mjs";
import { captureNativeImageHandle as imageHandle } from "../src/model/native-image-generation.ts";

function observeStoryRetirement(t, f, observed) {
  const viewer = f.components().find(value => value.tag === "forma-document-artifacts"
    && value.parentElement === f.workspace && value.source === "document");
  assert.ok(viewer, "the current Document artifact component owns Story retirement");
  const retire = viewer.retireNativeShortStory;
  assert.equal(typeof retire, "function");
  return t.mock.method(viewer, "retireNativeShortStory", function(...args) {
    observed();
    return Reflect.apply(retire, this, args);
  });
}

test("Native Image Workspace pane and resize conflicts preserve Story retirement before Image retirement and source reentry", IMAGE_RESPONSIVE_OPTIONS, async t => {
  for (const mode of ["pane", "resize"]) await t.test(mode, async child => {
    const f = await imageResponsiveFixture(child);
    if (mode === "resize") { f.resize(1280); f.pane("write"); }
    else { f.resize(390); f.pane("result"); }
    f.draw();
    const opening = f.openImage(), order = [], before = JSON.stringify(f.store.events.get());
    const revision = f.store.documentGenerationRevision(), source = f.store.captureSourceOwnership();
    let submissions = 0, inspections = 0, callbackFailure = null;
    child.mock.method(f.store, "submitNativeImage", () => { submissions++; assert.fail("retired Image action cannot submit"); });
    child.mock.method(f.store, "inspectNativeImage", () => { inspections++; assert.fail("retired Image action cannot inspect"); });
    observeStoryRetirement(child, f, () => { order.push("story"); });
    opening.presentation.subscribe(() => {
      try {
        order.push("image");
        assert.deepEqual(order, ["story", "image"], "the preserved Story call precedes Image invalidation");
        assert.equal(opening.presentation.current(), false, "invalidate before notifying subscribers");
        const count = f.openings.length;
        // A synchronous source publication belongs to the fixture's actual Store.
        // It must not let old touch callbacks admit or mutate another opening.
        if (mode === "pane") f.appendEvent("BlockPropertyEdited", {
          block_id: "synthetic-0", property_path: "text", new_value: "Changed during the old pane retirement",
        });
        opening.entry.activate();
        opening.mounted.activate(0); opening.mounted.activate(1);
        assert.equal(f.openings.length, count, "reentry cannot open ahead of the visibility transition");
      } catch (reason) {
        callbackFailure = { reason }; throw reason;
      }
    });
    if (mode === "pane") f.pane("write"); else f.resize(390);
    assert.equal(callbackFailure, null, "Host receipt capture cannot swallow a failed test observation");
    assert.deepEqual(order, ["story", "image"]);
    assertImageRetiredBeforeRender(f, opening);
    assert.equal(submissions, 0); assert.equal(inspections, 0);
    assert.equal(f.store.sourceOwnershipActive(source), true, "the source publication does not replace authorization identity");
    if (mode === "pane") assert.notEqual(f.store.documentGenerationRevision(), revision);
    else assert.equal(JSON.stringify(f.store.events.get()), before);
    f.pane("result"); f.draw();
    const fresh = f.openImage();
    assert.notEqual(fresh.presentation, opening.presentation);
    opening.mounted.activate(0); opening.mounted.activate(1);
    assert.equal(fresh.presentation.current(), true, "queued A callbacks leave fresh B current");
    assert.equal(submissions, 0); assert.equal(inspections, 0);
  });
});

test("Native Image Workspace artifact-close conflict preserves Story retirement and keeps the narrow write pane ineligible", IMAGE_RESPONSIVE_OPTIONS, async t => {
  const f = await imageResponsiveFixture(t);
  f.resize(390); f.pane("result"); f.draw();
  const opening = f.openImage();
  f.artifact(true);
  assertImageRetiredBeforeRender(f, opening);
  f.pane("write"); f.draw();
  const before = JSON.stringify(f.store.events.get()), count = f.openings.length;
  let stories = 0, submissions = 0, inspections = 0;
  t.mock.method(f.store, "submitNativeImage", () => { submissions++; assert.fail("hidden Image cannot submit"); });
  t.mock.method(f.store, "inspectNativeImage", () => { inspections++; assert.fail("hidden Image cannot inspect"); });
  const observation = observeStoryRetirement(t, f, () => {
    stories++;
    f.entry().activate(); opening.mounted.activate(0); opening.mounted.activate(1);
    assert.equal(f.openings.length, count, "Story cleanup cannot reopen Image while the viewer closes");
  });
  try {
    f.artifact(false);
    assert.equal(stories, 1, "closing the viewer on the narrow write pane invokes the original Story retirement");
    assertImageRetiredBeforeRender(f, opening);
  } finally {
    // This observation owns only the target transition, not later fixture teardown.
    observation.mock.restore();
  }
  f.draw(); f.entry().activate();
  assert.equal(f.openings.length, count, "the newly hidden result pane still denies Image entry");
  assert.equal(JSON.stringify(f.store.events.get()), before);
  assert.equal(submissions, 0); assert.equal(inspections, 0);
  f.pane("result"); f.draw();
  const fresh = f.openImage();
  assert.notEqual(fresh.presentation, opening.presentation);
  assert.equal(fresh.presentation.current(), true);
});

// Verbatim retained pending-operation/replacement control; its synthetic submit
// promise is observed by the actual current Controller and Shell Host.
function responsiveImageAcknowledgment(setup) {
  const handle = imageHandle({ ...setup, jobId: "native-image-responsive-job", requestedSequence: 42,
    promptFanId: null, parentJobId: null, fanKind: null, members: [] }, setup);
  assert.ok(handle, "the explicit submit port supplies actual I1-captured Image identity");
  return { disposition: "acknowledged", handle, reused: false };
}

test("Native Image Shell preserves pending submit ownership and attempt fencing across actual GenerationActions replacement", IMAGE_RESPONSIVE_OPTIONS, async t => {
  const f = await imageResponsiveFixture(t), pending = imageDeferred(), calls = [];
  let physicalSettled = false;
  const physical = pending.promise.then(value => { physicalSettled = true; return value; });
  t.mock.method(f.store, "submitNativeImage", (setup, controls) => { calls.push({ setup, controls }); return physical; });
  t.mock.method(f.store, "inspectNativeImage", async () => assert.fail("Replacement must not invent an inspection"));
  t.after(async () => { if (!physicalSettled) pending.resolve({ disposition: "not-dispatched", handle: null, reason: "unavailable" }); await physical; });
  const opening = f.openImage(), oldActions = f.actions(), session = f.store.session.get();
  const source = f.store.captureSourceOwnership(), route = f.store.route.get(), revision = f.store.documentGenerationRevision();
  opening.mounted.activate(0);
  await untilImageHost(() => calls.length === 1, "the actual Host/I2 invokes its original submit port once");
  assert.equal(f.shell.nativeImageAvailable, false);
  const record = [...f.renderer.instances].find(([_id, value]) => value.instance === oldActions);
  assert.ok(record, "the current renderer owns the actual GenerationActions instance");
  oldActions.isConnected = false; oldActions.disconnectedCallback();
  assertImageRetiredBeforeRender(f, opening);
  assert.equal(physicalSettled, false); assert.equal(f.shell.nativeImageAvailable, false);
  f.renderer.instances.delete(record[0]); f.draw();
  const replacement = f.actions();
  assert.notEqual(replacement, oldActions); assert.equal(replacement.store, f.store);
  assert.equal(f.store.session.get(), session); assert.equal(f.store.route.get(), route);
  assert.equal(f.store.documentGenerationRevision(), revision); assert.equal(f.store.sourceOwnershipActive(source), true);
  assert.equal(Object.hasOwn(f.entry(replacement).node.attributes, "disabled"), true, "pending original work disables B's actual entry");
  f.entry(replacement).activate(); opening.entry.activate(); opening.mounted.activate(0);
  assert.equal(calls.length, 1); assert.equal(physicalSettled, false);
  assert.equal(f.shell.nativeImageAvailable, false, "UI retirement/replacement does not free physical occupancy");
  pending.resolve(responsiveImageAcknowledgment(calls[0].setup)); await physical;
  await untilImageHost(() => f.shell.nativeImageAvailable, "the Host consumes the original terminal outcome before releasing its cell");
  const fresh = f.openImage();
  assert.equal(fresh.mounted.buttons[0].disabled, true, "settlement does not waive I2's acknowledged-attempt fence for the same Document");
  fresh.mounted.activate(0); opening.mounted.activate(0);
  assert.equal(calls.length, 1, "neither replacement nor late stale handlers duplicate the original dispatch");
  assert.equal(opening.presentation.current(), false); assert.equal(fresh.presentation.current(), true);
});

// Observe the Shell current Workspace invalidation at final capacity release. The
// existing fixture has no automatic browser/Lit paint scheduler: do not draw
// after settlement to fabricate the missing Workspace notification.
for (const mode of ["current", "source-withdrawn", "owner-replaced", "owner-disconnected"]) test("Native Image Close late acknowledgment notifies only the Shell current Workspace / " + mode, IMAGE_RESPONSIVE_OPTIONS, async t => {
  const f = await imageResponsiveFixture(t), pending = imageDeferred(), calls = [], notifications = [];
  const workspace = f.workspace, source = f.store.captureSourceOwnership();
  let physicalSettled = false;
  const physical = pending.promise.then(value => { physicalSettled = true; return value; });
  t.mock.method(f.store, "submitNativeImage", (setup, controls) => { calls.push({ setup, controls }); return physical; });
  t.mock.method(f.store, "inspectNativeImage", async () => assert.fail("Close and late acknowledgment cannot invent an inspection"));
  t.after(async () => { if (!physicalSettled) pending.resolve({ disposition: "not-dispatched", handle: null, reason: "unavailable" }); await physical; });
  const observeUpdate = owner => {
    const update = owner.requestUpdate;
    t.mock.method(owner, "requestUpdate", function(...args) {
      if (physicalSettled && f.shell.nativeImageAvailable) notifications.push(this);
      return Reflect.apply(update, this, args);
    });
  };
  observeUpdate(workspace); let currentWorkspace = workspace;
  const opening = f.openImage();
  assert.equal(opening.origin === workspace, true, "the actual Workspace owns this operation's opening");
  opening.mounted.activate(0);
  await untilImageHost(() => calls.length === 1, "the actual Create invokes one held submit");
  assert.equal(f.shell.nativeImageAvailable, false);
  opening.mounted.activate(2);
  assert.equal(opening.mounted.region.hidden, true, "explicit Close synchronously hides its exact launcher");
  assert.equal(opening.mounted.region.isConnected, false, "explicit Close removes its exact launcher");
  assert.equal(f.shell.renderNativeImage(workspace), noImagePresentation, "the Host has no closed Image presentation");
  assert.equal(physicalSettled, false, "explicit Close does not manufacture physical settlement");
  assert.equal(f.shell.nativeImageAvailable, false, "the retired opening still occupies its physical operation");
  if (mode === "source-withdrawn") {
    f.store.session.set({ ...f.store.session.get(), permissionEpoch: "image-close-late-ack-source-withdrawn" });
    assert.equal(f.store.sourceOwnershipActive(source), false, "the actual Store withdraws the captured source owner");
  } else if (mode === "owner-replaced" || mode === "owner-disconnected") {
    const record = [...f.renderer.instances].find(([_id, value]) => value.instance === workspace);
    assert.ok(record, "the current renderer owns the originating Workspace");
    workspace.isConnected = false; workspace.disconnectedCallback();
    if (mode === "owner-replaced") {
      f.renderer.instances.delete(record[0]); f.draw();
      const replacement = f.components().find(value => value.tag === "forma-workspace");
      assert.ok(replacement?.isConnected && replacement !== workspace, "the actual renderer installs a distinct Workspace");
      assert.equal(replacement.store === f.store, true);
      assert.equal(f.store.sourceOwnershipActive(source), true, "replacement does not need an authorization change");
      currentWorkspace = replacement; observeUpdate(replacement);
    } else currentWorkspace = null;
  }
  const before = notifications.length;
  pending.resolve(responsiveImageAcknowledgment(calls[0].setup)); await physical;
  await untilImageHost(() => f.shell.nativeImageAvailable, "the Host consumes the physical acknowledgment and releases occupancy");
  // No draw/openImage/property assignment occurs before this decisive observer.
  assert.equal(notifications.length - before, currentWorkspace ? 1 : 0,
    "released Shell capacity requests exactly its current connected Workspace update");
  assert.equal(notifications.slice(before).every(owner => owner === currentWorkspace), true,
    "a late operation never targets a disconnected or replaced source owner");
  if (mode === "owner-replaced") assert.equal(notifications.slice(before).includes(workspace), false);
  assert.equal(calls.length, 1); assert.equal(opening.mounted.region.isConnected, false);
  if (mode === "current") {
    // Only after the notification assertion, reuse the existing explicit draw
    // admission port to check the acknowledged-attempt fence independently.
    const fresh = f.openImage();
    assert.equal(fresh.mounted.buttons[0].disabled, true);
    fresh.mounted.activate(0); opening.mounted.activate(0);
    assert.equal(calls.length, 1, "late acknowledgment does not authorize another same-Document dispatch");
    assert.equal(fresh.presentation.current(), true);
  }
});
