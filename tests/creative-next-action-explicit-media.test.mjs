import assert from "node:assert/strict";
import test, { after } from "node:test";
import { lifecyclePage, lifecycleButton, activateLifecycle } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeActionSourceRevision, requestedCreativeMedium } from "../src/model/workspace-intelligence.ts";
import { DOCUMENT_ARTIFACT_KINDS } from "../src/model/document-artifacts.ts";
import { documentIdFromRoute, routePathname } from "../src/model/routes.ts";
import { isOutputFixtureReadOnlyResume } from "./helpers/output-reachability-fixture.mjs";

// Full existing page/Store/Worker/native ports. The existing fixture's authored
// projection is synthetic; its actual current Store folds the declared event.
// This is not a browser/AT, server authoring-custody or provider certificate.
// Unlike the older null-medium chooser cases, the source already requests one
// exact medium before the user activates the real configure recommendation.
const originalFetch = globalThis.fetch;
let external = 0;
globalThis.fetch = async () => { external++; throw Error("No external/provider transport in explicit-media preparation"); };
after(() => { assert.equal(external, 0); globalThis.fetch = originalFetch; });
const media = ["image", ...DOCUMENT_ARTIFACT_KINDS];
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, ancestor) => { for (let at = node.parent; at; at = at.parent) if (at === ancestor) return true; return false; };
const unique = (values, description) => { assert.equal(values.length, 1, description); return values[0]; };
const noCommands = f => assert.deepEqual(f.storeHost.requests.filter(request => (request.init.method ?? "GET") !== "GET"
  && !isOutputFixtureReadOnlyResume(request, { projectId: f.projectId, documentId: f.documentId })), [],
"preparation uses only existing exact free Resume reads, never event writes, generation, grants or receipt commands");

for (const origin of ["projects", "document"]) for (const medium of media) {
  test("current " + origin + " explicit " + medium + " recommendation opens only its existing configuration", { concurrency: false, timeout: 45_000 }, async t => {
    const f = await lifecyclePage(t, { route: origin === "projects" ? "/projects" : "document" });
    assert.equal(f.storeHost.transport, null); assert.equal(f.storeHost.intercept, null,
      "the original RAM Worker transport is not replaced with a successful adapter");
    const direction = unique(f.store.projection.get().blocks.filter(block => block.id === "lifecycle-direction"
      && block.projectId === f.projectId && block.documentId === f.documentId && !block.removed), "one current authored fixture direction");
    assert.equal(direction.properties.authority, "authored");
    const declared = f.appendEvent("BlockPropertyEdited", { block_id: direction.id, property_path: "output_kind",
      old_value: direction.properties.output_kind, new_value: medium });
    await f.settle();
    const currentFacts = () => nextActionFacts(f.store, f.documentId, null, { lifecycle: true });
    const facts = currentFacts(), source = f.store.captureSourceOwnership(), authorization = f.store.captureAuthorizationScope();
    assert.ok(source && authorization); assert.equal(f.store.sourceOwnershipActive(source), true);
    assert.equal(f.store.authorizationScopeActive(authorization), true); assert.equal(f.store.routeDataReady(), true);
    assert.equal(facts.canRead && facts.canAuthor && facts.canConfigure, true);
    assert.equal(facts.projectId, f.projectId); assert.equal(facts.documentId, f.documentId);
    assert.equal(facts.sourceGeneration, source.generation);
    assert.ok(f.store.eventView.get().some(event => event.eventId === declared.eventId && event.type === "BlockPropertyEdited"));
    assert.equal(facts.blocks.find(block => block.id === direction.id)?.properties.output_kind, medium);
    assert.equal(requestedCreativeMedium(facts), medium, "the actual resolver reads the current authored field, not a test-created target override");
    const chosen = unique(f.actions().filter(action => action.target.kind === "configure"), "one actual current configure action");
    assert.equal(chosen.target.medium, medium); assert.equal(chosen.target.documentId, f.documentId);
    assert.equal(chosen.target.projectId, f.projectId); assert.equal(chosen.target.canvasId, null);
    assert.equal(chosen.target.authorityKey, authorization.key); assert.equal(chosen.target.sourceGeneration, source.generation);
    assert.equal(chosen.target.sourceRevision, creativeActionSourceRevision(facts));
    const originHost = unique(f.components().filter(host => host.tag === (origin === "projects" ? "forma-projects" : "forma-workspace")), "one actual current origin host");
    const button = lifecycleButton(f, chosen.id);
    assert.equal(button.owner.tag, "forma-ui-choice-card"); assert.ok(button.port?.isConnected && button.owner.isConnected);
    let owned = false; for (let at = button.parent; at; at = at.parent) if (at.component === originHost) owned = true;
    assert.equal(owned, true, "the visible native choice belongs to the actual current origin");
    if (origin === "projects") assert.equal(routePathname(f.store.route.get()), "/projects");
    else assert.equal(documentIdFromRoute(f.store.route.get()), f.documentId);
    assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
    noCommands(f);
    const originalEvents = JSON.stringify(f.store.events.get()), target = JSON.stringify(chosen.target);
    const traceStart = f.trace.length, focusStart = f.native.nativeFocus.length;
    t.diagnostic("C19_EXPLICIT_MEDIA " + JSON.stringify({ stage: "admitted", origin, medium,
      projectId: f.projectId, documentId: f.documentId, action: chosen.id, requestedMedium: chosen.target.medium,
      sourceGeneration: source.generation, sourceCurrent: true, configuredDialogOpen: false }));

    f.native.emit("pointerdown", button.port); f.native.focus(button.port); activateLifecycle(f, button);
    // Existing component settling plus finishLifecycle's Store RAF delivery:
    // the rendered callback returns void, so no opener/guard is wrapped merely
    // to manufacture a completion promise. Both are finite native timer ports.
    for (let attempt = 0; attempt < 8; attempt++) {
      await f.settle();
      for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) {
        f.storeHost.timers.delete(id); timer.callback(0);
      }
      await new Promise(setImmediate);
    }
    const tree = f.tree(), openDialogs = tree.visible("dialog").filter(node => node.port?.open);
    const expectedClass = medium === "image" ? "generation-details-dialog" : "document-artifact-create";
    const configurations = openDialogs.filter(node => classed(node, expectedClass));
    const resultFocus = f.native.nativeFocus.slice(focusStart).filter(row => row.node?.getAttribute?.("data-workbench-pane") === "result"
      && row.node.owner?.tag === "forma-workspace" && row.node.owner.store === f.store);
    const checkedKinds = tree.visible("input").filter(node => node.attributes.name === "artifact-kind" && node.port?.checked)
      .map(node => node.port.value);
    t.diagnostic("C19_EXPLICIT_MEDIA " + JSON.stringify({ stage: "after-control", origin, medium,
      route: f.store.route.get(), documentId: f.store.projection.get().documentId,
      sourceCurrent: f.store.sourceOwnershipActive(source), currentRequestedMedium: requestedCreativeMedium(currentFacts()),
      semanticActionEmitted: f.trace.slice(traceStart).includes("event:forma-action"), resultFocusCount: resultFocus.length,
      openDialogs: openDialogs.map(node => node.attributes.class), checkedKinds,
      componentRafs: f.frames.size, storeRafs: [...f.storeHost.timers.values()].filter(timer => timer.delay === 16).length }));

    assert.ok(f.trace.slice(traceStart).includes("event:forma-action"), "the actual ChoiceCard emitted its semantic action");
    assert.equal(f.store.sourceOwnershipActive(source), true); assert.equal(f.store.authorizationScopeActive(authorization), true);
    assert.equal(documentIdFromRoute(f.store.route.get()), f.documentId); assert.equal(f.store.projection.get().documentId, f.documentId);
    assert.equal(requestedCreativeMedium(currentFacts()), medium); assert.equal(creativeActionSourceRevision(currentFacts()), chosen.target.sourceRevision);
    assert.equal(JSON.stringify(chosen.target), target); assert.equal(JSON.stringify(f.store.events.get()), originalEvents); noCommands(f);
    assert.ok(f.storeHost.requests.some(request => isOutputFixtureReadOnlyResume(request, { projectId: f.projectId, documentId: f.documentId })),
      "the actual mounted Workspace retains its existing exact free Resume read");
    assert.ok(resultFocus.length > 0, "the actual explicit-medium path reached its exact current Workspace Result-pane focus before configuration");
    assert.equal(configurations.length, 1, "the current explicit request must open its own existing configuration without returning to the chooser");
    assert.equal(openDialogs.length, 1, "no alternative medium, chooser, consent or other dialog substitutes for this configuration");
    const dialog = configurations[0];
    assert.equal(dialog.owner.store, f.store); assert.ok(dialog.owner.isConnected);
    assert.equal(dialog.owner.tag, medium === "image" ? "forma-generation-actions" : "forma-document-artifacts");
    assert.equal(dialog.owner.source, "document");
    const kindInputs = tree.visible("input").filter(node => node.attributes.name === "artifact-kind" && inside(node, dialog));
    if (medium === "image") {
      assert.equal(kindInputs.length, 0, "Image uses its existing image-specific configuration, not an invented artifact radio");
      assert.equal(tree.nodes.filter(node => node.tag === "forma-image-format-editor" && inside(node, dialog) && node.component?.isConnected).length, 1);
    } else {
      assert.equal(dialog.owner.documentId, f.documentId);
      assert.equal(kindInputs.length, DOCUMENT_ARTIFACT_KINDS.length);
      assert.ok(kindInputs.every(node => node.port?.isConnected && node.owner === dialog.owner));
      assert.deepEqual(kindInputs.filter(node => node.port.checked).map(node => node.port.value), [medium], "only the requested native medium is checked");
    }
    assert.equal(JSON.stringify(f.store.events.get()), originalEvents); noCommands(f);
    // lifecyclePage's original after-hook additionally compares all existing
    // financial/job/operation tables and rejects every non-read command.
  });
}
