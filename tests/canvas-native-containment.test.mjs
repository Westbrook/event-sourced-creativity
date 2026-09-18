import assert from "node:assert/strict";
import test from "node:test";
import { fixture, documentPort } from "./helpers/canvas-focus-repair-host.mjs";

// Direct finite-native IDL/lifetime control over the existing complete Canvas
// renderer. No private field, production callback, raw value or active element
// is remapped. This is not Worker authorization or physical DOM/AT proof.
test("Canvas native containment follows the current owner and retires removed ports across cached reentry", { concurrency: false, timeout: 45000 }, async t => {
  const network = t.mock.method(globalThis, "fetch", async () => assert.fail("No network or provider is allowed by this native containment control"));
  const f = fixture({ populated: true, documentCount: 2 }); documentPort.activeElement = documentPort.body;
  t.after(() => {
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) {
      instance.isConnected = false; instance.disconnectedCallback();
    }
    f.i18n.hostDisconnected(); assert.equal(network.mock.callCount(), 0);
  });
  await f.select(0);
  const owner = f.renderer.query(f.host, "forma-context-intelligence")[0]; assert.ok(owner?.isConnected);
  const button = f.renderer.ownNodes(owner, "button").find(node => node.attributes.class === "button ghost compact");
  const outside = f.native("article", node => node.attributes["data-canvas-item-id"] === "item-block-0");
  assert.ok(button?.isConnected && outside?.isConnected); assert.notEqual(button, outside);
  assert.equal(owner.contains(owner), true); assert.equal(owner.contains(button), true);
  assert.equal(f.host.contains(button), true); assert.equal(f.host.contains(outside), true);
  assert.equal(owner.contains(outside), false); assert.equal(button.contains(owner), false); assert.equal(owner.contains(null), false);
  button.focus(); assert.equal(documentPort.activeElement, button);
  await f.select(1);
  const next = f.renderer.query(f.host, "forma-context-intelligence")[0]; assert.ok(next?.isConnected); assert.notEqual(next, owner);
  assert.equal(owner.isConnected, false); assert.equal(button.isConnected, false);
  assert.equal(owner.contains(button), true, "the detached cached subtree retains its own internal ancestry");
  assert.equal(f.host.contains(owner), false); assert.equal(f.host.contains(button), false); assert.equal(next.contains(button), false);
  await f.select(0);
  assert.equal(f.renderer.query(f.host, "forma-context-intelligence")[0], owner, "the original cache owner genuinely returns");
  const fresh = f.renderer.ownNodes(owner, "button").find(node => node.attributes.class === "button ghost compact");
  assert.ok(fresh?.isConnected); assert.notEqual(fresh, button, "a native port absent from the intervening draw is not resurrected");
  assert.equal(button.isConnected, false); assert.equal(owner.contains(button), false); assert.equal(f.host.contains(button), false);
  assert.equal(owner.contains(fresh), true); assert.equal(f.host.contains(fresh), true);
  assert.equal(f.state.requests.length, 0); assert.equal(f.state.batches.length, 0);
});
