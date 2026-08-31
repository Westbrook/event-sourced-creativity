import assert from "node:assert/strict";
import test from "node:test";
import { creativeEditorCommandPage } from "./helpers/creative-editor-command-fixture.mjs";
import { installStudioNavigatorNative } from "./helpers/studio-navigator-native-selection.mjs";
import { documentIdFromRoute, documentViewFromRoute, withDocumentInRoute } from "../src/model/routes.ts";

const options = { concurrency: false, timeout: 120_000 };
const plain = { "item-type": "direction", "item-intent": "include", copy: "The keeper checks the harbor.", strength: "lead" };
async function originalEffects(x, before) {
  const { h, navigationReceipt: receipt } = x;
  await x.settle(); assert.equal(x.resume.pendingOriginalCount(), 0);
  assert.ok(h.store.sourceOwnershipActive(before.source) && h.store.authorizationScopeActive(before.authority));
  assert.equal(JSON.stringify(h.store.session.get()), before.session);
  assert.equal(h.store.projection.get().projectId, h.worker.projectId);
  assert.deepEqual(x.counts(), before.counts); assert.deepEqual(x.receipts(), before.receipts);
  const requests = h.requests.slice(before.requests), writes = requests.filter(row => row.url === "/api/events" && row.init.method === "POST");
  let proof = null;
  if (receipt.acknowledged()) {
    proof = await receipt.verify(); assert.equal(writes.length, 1); assert.ok(receipt.isOriginal(writes[0]));
    assert.equal(receipt.isOriginal({ ...writes[0] }), false);
    const history = await x.history(), event = history.at(-1);
    assert.deepEqual(history.slice(0, -1), before.history); assert.equal(event.eventId, proof.eventId);
    assert.equal(event.type, "DocumentOpened"); assert.deepEqual(event.payload, {
      document_id: x.navigationTarget.documentId, previous_document_id: h.worker.documentId, source_surface: "studio-alternative" });
    assert.equal(event.actor, "user"); assert.equal(event.clientId, "web:lit"); assert.equal(event.streamId, h.worker.streamId);
    assert.equal(proof.status, 200); assert.equal(proof.sequence, before.history.at(-1).sequence + 1);
  } else {
    assert.equal(writes.length, 0, "An unobserved POST is never accepted as a refused or completed navigation");
    assert.deepEqual(await x.history(), before.history);
  }
  assert.deepEqual(requests.filter(row => (row.init.method ?? "GET") !== "GET"
    && !receipt.isOriginal(row) && !x.resume.isReadOnlyResume(row)), [],
    "Only the exact one original DocumentOpened or independently certified original free Resume; no source, execution, approval or provider write");
  return proof;
}

for (const [kind, locale] of [["document", "en"], ["collection", "ja"]]) for (const state of ["clean", "raw"])
test("C StudioNavigator actual selected destination / " + kind + " / " + state + " / " + locale, options, async t => {
  const x = await creativeEditorCommandPage(t, locale, { navigationDocument: true }), { f, h, native, navigationTarget: target, navigationReceipt: receipt } = x;
  assert.ok(target && receipt); const selector = installStudioNavigatorNative(t, x); await x.settle();
  const projection = h.store.projection.get(); assert.equal(projection.documentId, h.worker.documentId);
  assert.ok(projection.documents.some(document => document.id === target.documentId && document.title === target.title && document.projectId === h.worker.projectId));
  assert.ok(projection.collections.some(collection => collection.id === target.collectionId && collection.handle === target.collectionHandle));
  assert.equal(projection.membership[target.documentId].collectionId, target.collectionId);
  assert.notEqual(projection.membership[h.worker.documentId]?.collectionId, target.collectionId);
  assert.equal(selector.owner.closest("forma-shell"), f.host); assert.ok(f.host.contains(selector.owner));
  const initialValues = { collection: "", document: h.worker.documentId };
  assert.deepEqual(selector.values(), initialValues); assert.deepEqual(native.raw(), plain);
  assert.deepEqual(selector.current("document").node.options.map(option => option.value), ["", ...projection.documents.map(document => document.id)]);
  assert.deepEqual(selector.current("collection").node.options.map(option => option.value), ["", ...projection.collections.map(collection => collection.id)]);
  const originalControls = Object.fromEntries(["collection", "document"].map(name => [name, selector.current(name).node]));
  for (const name of ["collection", "document"]) {
    assert.equal(originalControls[name].selectedOptions.length, 1);
    assert.equal(originalControls[name].selectedOptions[0].value, initialValues[name]);
  }
  const destination = withDocumentInRoute(selector.owner.getAttribute("destination"), target.documentId, target.title);
  assert.equal(documentIdFromRoute(destination), target.documentId); assert.equal(documentViewFromRoute(destination), "editor");
  const raw = { ...plain, copy: "  Unsent native selection B — 未保存\n  " };
  if (state === "raw") { assert.deepEqual(native.change({ copy: raw.copy }), raw); await f.settle(); }
  const originalForm = native.current().form, before = await x.snapshot(); await receipt.arm();
  const chosenId = kind === "document" ? target.documentId : target.collectionId;
  await selector.choose(kind, chosenId); let proof = await originalEffects(x, before);
  t.diagnostic("C_STUDIO_NATIVE_SELECTION " + JSON.stringify({ kind, state, locale, originalRoute: before.route,
    actualRoute: h.store.route.get(), originalDocumentId: h.worker.documentId, target, originalResponse: proof,
    currentValues: selector.values(), nativeFormConnected: originalForm.isConnected,
    receiptsAndFiscalUnchanged: true, evidence: "actual Editor/StudioNavigator native OPTION/Lit Parts and original RAM Worker; no physical/provider claim" }));
  if (state === "raw") {
    assert.equal(h.store.route.get(), before.route, "The actual select must refuse before original navigation publication when native Editor work is raw");
    assert.equal(h.location.pathname + h.location.search + h.location.hash, before.route);
    assert.equal(proof, null); assert.equal(receipt.acknowledged(), false); assert.equal(h.requests.length, before.requests);
    assert.equal(h.store.projection.get().documentId, h.worker.documentId); assert.equal(h.store.ui.focusCollectionId, "");
    assert.ok(x.owner.isConnected && selector.owner.isConnected); assert.equal(native.current().form, originalForm);
    assert.deepEqual(native.raw(), raw); assert.deepEqual(selector.values(), initialValues, "Refused native choices reflect the unchanged current Document and scope");
    for (const name of ["collection", "document"]) {
      const current = selector.current(name).node; assert.equal(current, originalControls[name]);
      assert.equal(current.selectedOptions.length, 1); assert.equal(current.selectedOptions[0].value, initialValues[name]);
    }
    assert.deepEqual(await native.escape(), plain); assert.deepEqual(native.raw(), plain);
    assert.deepEqual(selector.values(), initialValues); assert.equal(native.current().form, originalForm);
    // The same exact target remains armed: a refused gesture dispatched no
    // request. This fresh actual native choice, not a replay, may now proceed.
    await selector.choose(kind, chosenId); proof = await originalEffects(x, before);
  }
  assert.ok(proof); assert.equal(proof.documentId, target.documentId); assert.equal(proof.previousDocumentId, h.worker.documentId);
  assert.equal(proof.sourceSurface, "studio-alternative"); assert.equal(h.store.route.get(), destination);
  assert.equal(h.location.pathname + h.location.search + h.location.hash, destination);
  assert.equal(h.store.projection.get().documentId, target.documentId); assert.equal(h.store.projection.get().documentTitle, target.title);
  assert.equal(h.store.ui.focusCollectionId, kind === "collection" ? target.collectionId : "");
  assert.deepEqual(selector.values(), { collection: kind === "collection" ? target.collectionId : "", document: target.documentId });
  const editors = f.components().filter(owner => owner.tag === "forma-creative-editor" && owner.store === h.store);
  assert.equal(editors.length, 1); assert.ok(editors[0].isConnected); assert.equal(selector.owner.closest("forma-creative-editor"), editors[0]);
  const titles = f.tree().visible("strong").filter(node => node.owner === selector.owner); assert.equal(titles.length, 1); assert.equal(titles[0].text, target.title);
  assert.equal(originalForm.isConnected, false, "The exact empty destination does not keep editing the former Document's native form");
  assert.equal(h.store.ui.commandOpen, false); assert.equal(h.requests.filter(row => row.url === "/api/events" && row.init.method === "POST").length, 1);
  assert.deepEqual(await receipt.verify(), proof); await originalEffects(x, before);
});
