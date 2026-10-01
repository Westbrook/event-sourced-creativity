// Focused current composition controls. The existing full-page fixture supplies
// real component methods and deterministic native event/ResizeObserver ports.
// These tests make no browser, provider, background-quiescence or paint claim.
import assert from "node:assert/strict";
import test from "node:test";
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
