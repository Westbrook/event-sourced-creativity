// Actual full Output hierarchy and original Store/client/domain fixture. HTTP
// inputs are the existing declared synthetic Output endpoints, not Worker
// authority. No paid/confirm/upload action. No held application promise; newer
// same-turn native focus is a deferred-ownership policy, not physical timing.
import assert from "node:assert/strict";
import test from "node:test";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { retainDeferredFocusInvokers } from "./helpers/deferred-focus-invokers.mjs";

const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
for (const action of ["open", "close"]) for (const newer of [false, true])
  test("C Output plan " + action + " / " + (newer ? "same-turn newer native interaction wins" : "healthy current focus"),
    { concurrency: false, timeout: 45_000 }, async t => {
      const f = await createOutputReachabilityPage(t, { state: "confirmed", surface: "document", locale: "en" });
      const owners = f.outputControllers().filter(owner => !owner.blockId); assert.equal(owners.length, 1);
      const owner = owners[0], native = installOutputNavigationFocusNative(t, f, ports);
      retainDeferredFocusInvokers(f, new Set([owner])); await f.settle();
      const opener = () => f.find("button", node => node.owner === owner && node.handlers.click?.toString().includes("#reviewPlan ?"));
      const review = () => f.tree().nodes.filter(node => node.owner === owner && classed(node, "output-plan-review"));
      const start = opener(); assert.ok(start.port.isConnected); assert.equal(start.port.matches(":disabled"), false);
      const originalOpener = start.port; await f.settle();
      assert.equal(opener().port, originalOpener, "same actual EventPart, not a label-derived replacement");
      if (action === "close") {
        native.emit("pointerdown", originalOpener); native.focus(originalOpener); await f.act(opener());
        assert.equal(review().length, 1); assert.equal(review()[0].attributes.tabindex, "-1");
      }
      const control = action === "open" ? opener() : f.find("button", node => node.owner === owner
        && node.handlers.click?.toString().includes("#closePlan()") && node.text === f.i18n.t("output.delivery.cancel", "Cancel"));
      const baseline = { route: f.store.route.get(), session: f.store.session.get(), source: f.store.captureSourceOwnership(),
        authority: f.store.captureAuthorizationScope(), events: f.store.events.get(), content: f.store.content.get(),
        head: f.store.head.get(), records: structuredClone(f.outputRecords), requests: structuredClone(f.outputRequests),
        snapshot: structuredClone(f.outputSnapshot(owner.documentId)) };
      native.emit("pointerdown", control.port); native.focus(control.port);
      const pending = f.act(control);
      const command = f.find("button", node => node.owner === f.host && classed(node, "command-trigger"));
      assert.ok(command.port.isConnected); assert.equal(command.port.matches(":disabled"), false);
      if (newer) { native.emit("pointerdown", command.port); native.focus(command.port); }
      const mark = native.nativeFocus.length; await pending; await f.settle();
      const late = native.nativeFocus.slice(mark).filter(row => row.node.owner === owner);
      t.diagnostic(JSON.stringify({ action, newer, lateFocus: late.map(row => ({ tag: row.node.tag,
        class: row.node.attributes.class ?? null, label: row.node.attributes["aria-label"] ?? null })),
        boundary: "actual native listener; same-turn intervention; no held update" }));
      if (newer) assert.equal(late.length, 0, "deferred plan focus cannot overwrite the newer ordinary control");
      else { assert.equal(late.length, 1); if (action === "open") assert.ok(classed(late[0].node, "output-plan-review"));
        else assert.equal(late[0].node, originalOpener); }
      assert.equal(review().length, action === "open" ? 1 : 0);
      assert.equal(owner.isConnected, true); assert.equal(opener().port, originalOpener);
      assert.equal(f.store.route.get(), baseline.route); assert.equal(f.store.session.get(), baseline.session);
      assert.ok(f.store.sourceOwnershipActive(baseline.source)); assert.ok(f.store.authorizationScopeActive(baseline.authority));
      assert.equal(f.store.events.get(), baseline.events); assert.equal(f.store.content.get(), baseline.content); assert.equal(f.store.head.get(), baseline.head);
      assert.deepEqual(f.outputSnapshot(owner.documentId), baseline.snapshot);
      assert.deepEqual(f.outputRequests, baseline.requests); assert.deepEqual(f.outputRecords, baseline.records);
    });
