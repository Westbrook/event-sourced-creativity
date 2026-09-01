// Current complete Workspace/Shell/Store and existing native fixture ports.
// Source/job fixtures are explicitly synthetic; assigned review uses the real
// RAM Worker and Output uses its existing finite domain/HTTP adapter. No private
// method extraction/replacement, provider execution, CSS or physical AT proof.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { lifecyclePage, activateLifecycle, ports } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { assignmentPage, originalFetch, externalCount } from "./helpers/assigned-review-action-fixture.mjs";
import { createOutputReachabilityPage } from "./helpers/output-reachability-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeNextActions } from "../src/model/workspace-intelligence.ts";
import { withDocumentInRoute, libraryFocusFromRoute, artifactFocusOptionsFromRoute } from "../src/model/routes.ts";

after(() => { assert.equal(externalCount(), 0); globalThis.fetch = originalFetch; });
const options = { concurrency: false, timeout: 45_000 };
const RAW = "  Keep my next unsent question — 文書\nسؤال جديد  ";
const classed = (node, name) => String(node?.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const workspace = f => {
  const owners = f.components().filter(value => value.tag === "forma-workspace");
  assert.equal(owners.length, 1, "one actual current Workspace owner"); return owners[0];
};
const dialogs = f => f.tree().visible("dialog").filter(value => value.port?.open);
const source = f => JSON.stringify(f.store.events.get());
const actions = f => creativeNextActions(nextActionFacts(f.store, f.store.projection.get().documentId, null, { lifecycle: true }));
function rendered(f) {
  const owner = workspace(f), tree = f.tree();
  const groups = tree.visible("aside").filter(node => node.owner === owner && classed(node, "exact-next-actions"));
  assert.equal(groups.length, 1, "the current rendered recommendation group exists before the new-policy assertion");
  return tree.nodes.filter(node => node.tag === "forma-ui-choice-card" && inside(node, groups[0])).map(node => {
    const button = tree.visible("button").find(value => inside(value, node)); assert.ok(button?.port);
    assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
    return { node, button, id: button.attributes["data-choice-value"], label: node.component.label };
  });
}
function priority(f, t, kind) {
  const expected = actions(f), current = rendered(f);
  assert.ok(expected.length > 0 && expected.length <= 3);
  assert.equal(expected[0].target.kind, kind, "the original shared resolver has this independently established priority");
  assert.notEqual(expected[0].target.sourceGeneration, undefined);
  t.diagnostic("WORKSPACE_LIFECYCLE_PRIORITY " + JSON.stringify({
    route: f.store.route.get(), expected: expected.map(value => ({ id: value.id, target: value.target })),
    rendered: current.map(({ id, label }) => ({ id, label })),
  }));
  assert.deepEqual(current.map(value => value.id), expected.map(value => value.id),
    "Workspace's rendered order must use the same current lifecycle facts as the other adopted surfaces");
  assert.equal(current.filter(value => value.node.attributes["data-primary"] === "true").length, 1);
  return { chosen: expected[0], button: current[0].button };
}
async function drain(f, count = 8) {
  for (let attempt = 0; attempt < count; attempt++) {
    await f.settle();
    for (const [id, timer] of [...f.storeHost.timers]) if (timer.delay === 16) {
      f.storeHost.timers.delete(id); timer.callback(0);
    }
    await new Promise(setImmediate);
  }
}
async function reached(f, predicate, label) {
  for (let attempt = 0; attempt < 32; attempt++) { await drain(f, 1); if (predicate()) return; }
  assert.ok(predicate(), label);
}
function nativeHistory(t, f) {
  const previous = globalThis.history;
  globalThis.history = { pushState(_state, _title, path) {
    const value = new URL(path, "http://localhost");
    Object.assign(f.storeHost.location, { pathname: value.pathname, search: value.search, hash: value.hash });
  }, replaceState(...args) { this.pushState(...args); } };
  t.after(() => { globalThis.history = previous; });
}

test("Workspace rendered source priority reaches the exact current source without authoring", options, async t => {
  const f = await lifecyclePage(t, { route: "document" });
  f.appendEvent("BlockPropertyEdited", { block_id: "lifecycle-direction", property_path: "rights_expires_at", new_value: "2020-01-01T00:00:00Z" });
  await f.settle(); const before = source(f), { chosen, button } = priority(f, t, "source-block");
  assert.equal(chosen.target.blockId, "lifecycle-direction");
  activateLifecycle(f, button);
  await reached(f, () => f.native.document.activeElement?.getAttribute("data-block-id") === chosen.target.blockId,
    "the same exact source article, not a new-context composer, owns focus");
  assert.equal(f.store.projection.get().documentId, chosen.target.documentId);
  assert.equal(source(f), before); assert.equal(dialogs(f).length, 0);
});

test("Workspace rendered unresolved original priority opens that same job's retained inputs", options, async t => {
  const f = await lifecyclePage(t, { route: "document", mode: "job", jobResult: {
    generationReceipt: { provider_request_status: "submission_unknown", reservation_status: "unknown" },
  } });
  const original = f.store.documentJobs.get().find(value => value.jobId === f.jobId); assert.ok(original);
  assert.equal(original.result.generationReceipt.provider_request_status, "submission_unknown");
  const before = source(f), { chosen, button } = priority(f, t, "job");
  assert.equal(chosen.id, "check-original-job"); assert.equal(chosen.target.jobId, original.jobId);
  activateLifecycle(f, button);
  await reached(f, () => dialogs(f).some(value => classed(value, "generation-input-dialog")), "the original job inspector opens");
  const inspector = f.components().find(value => value.tag === "forma-generation-input-dialog" && value.open); assert.ok(inspector?.inspection);
  assert.equal(inspector.inspection.receipt.job.job_id, original.jobId);
  assert.equal(inspector.inspection.receipt.job.document_id, original.documentId);
  assert.equal(f.store.documentJobs.get().find(value => value.jobId === original.jobId).result.generationReceipt.provider_request_status, "submission_unknown");
  assert.equal(source(f), before);
});

test("Workspace rendered assigned review joins the exact current Worker task and review viewer", options, async t => {
  const q = await assignmentPage(t, "same-document"), f = q.f, p = f.store.projection.get();
  const document = p.documents.find(value => value.id === q.targetDocument); assert.ok(document);
  f.store.setRoute(withDocumentInRoute("/", document.id, document.title)); await drain(f);
  const native = installOutputNavigationFocusNative(t, f, ports);
  const { chosen, button } = priority(f, t, "assigned-review");
  const task = f.store.reviewInbox.get().find(value => value.id === chosen.target.reviewId); assert.ok(task);
  assert.equal(task.documentId, document.id); assert.equal(q.viewerCalls.length, 0);
  const beforeRequests = q.h.requests.length;
  activateLifecycle(f, button);
  await reached(f, () => q.viewerCalls.length === 1 && q.viewerCalls[0].result === true, "one actual exact review viewer arrives");
  assert.deepEqual(libraryFocusFromRoute(f.store.route.get()), { kind: "artifact", id: task.artifactId });
  assert.deepEqual(artifactFocusOptionsFromRoute(f.store.route.get()), {
    expectedRevision: task.revision, expectedContentSha256: task.contentSha256, intent: "review",
  });
  const call = q.viewerCalls[0]; assert.equal(call.id, task.artifactId); assert.equal(call.owner.documentId, task.documentId);
  assert.ok(call.owner.isConnected && call.owner.querySelector(".document-artifact-view")?.open);
  assert.ok(native.document.activeElement && call.owner.contains(native.document.activeElement));
  const contextPath = "/api/workspaces/" + encodeURIComponent(task.organizationId) + "/projects/" + encodeURIComponent(task.projectAccessId) + "/context";
  const writes = q.h.requests.slice(beforeRequests).filter(value => (value.init.method ?? "GET") !== "GET");
  assert.equal(writes.length, 1, "only the existing exact context-cookie selection, not an authoring/approval/generation command");
  assert.equal(writes[0].url, contextPath); assert.equal(writes[0].init.method, "POST"); assert.equal(writes[0].init.body, undefined);
  // The reused real Worker fixture independently checks all nine fiscal tables,
  // non-navigation source events, personal history and zero new job admissions.
});

test("Workspace rendered owed Output priority reaches the exact existing controller", options, async t => {
  const f = await createOutputReachabilityPage(t, { state: "confirmed", surface: "document", authoredSource: true });
  nativeHistory(t, f); const native = installOutputNavigationFocusNative(t, f, ports);
  const before = source(f), snapshot = JSON.stringify(f.adapter.snapshot(f.store.projection.get().documentId));
  const { chosen, button } = priority(f, t, "canonical-output"); assert.equal(chosen.target.refresh, false);
  activateLifecycle(f, button);
  const exact = () => f.outputControllers().filter(value => value.isConnected && value.documentId === chosen.target.documentId
    && value.blockId === (chosen.target.reference.kind === "requirement" ? chosen.target.reference.blockId : ""));
  await reached(f, () => exact().length === 1 && native.document.activeElement && exact()[0].contains(native.document.activeElement),
    "the exact reference's existing controller owns the revealed native destination");
  assert.equal(source(f), before); assert.equal(JSON.stringify(f.adapter.snapshot(chosen.target.documentId)), snapshot);
  assert.deepEqual(f.storeHost.requests.filter(value => (value.init.method ?? "GET") !== "GET" && !f.isReadOnlyResume(value)), []);
});

for (const mode of ["context", "configure"]) test("Workspace clean rendered " + mode + " keeps its existing useful local entry", options, async t => {
  const f = await lifecyclePage(t, { route: "document", mode }), before = source(f);
  const { button } = priority(f, t, mode); activateLifecycle(f, button);
  const name = mode === "context" ? "block-composer-dialog" : "next-format-dialog";
  await reached(f, () => dialogs(f).some(value => classed(value, name)), "the original local dialog opens");
  assert.equal(dialogs(f).filter(value => classed(value, name)).length, 1);
  assert.equal(source(f), before);
});

test("Workspace rendered next step preserves a current raw unsent Ask instead of opening another owner", options, async t => {
  const f = await lifecyclePage(t, { route: "document" }), owner = workspace(f);
  const input = f.find("textarea", node => node.owner === owner && node.attributes.id === "creative-command");
  input.port.value = RAW; await f.act(input, "input");
  // The fixture's earlier real setRoute queued Store hydration/job RAF reads.
  // Join those original callbacks before measuring this later blocked gesture.
  await drain(f);
  assert.strictEqual(workspace(f), owner);
  assert.equal(f.find("textarea", node => node.owner === owner && node.attributes.id === "creative-command").port.value, RAW);
  const before = source(f), route = f.store.route.get(), requests = f.storeHost.requests.length;
  const button = rendered(f)[0].button; assert.equal(button.attributes["data-choice-value"], "configure-output");
  activateLifecycle(f, button); await drain(f);
  assert.strictEqual(workspace(f), owner); assert.equal(f.store.route.get(), route);
  assert.equal(f.find("textarea", node => node.owner === owner && node.attributes.id === "creative-command").port.value, RAW);
  if(f.storeHost.requests.length!==requests)t.diagnostic("RAW_ASK_REQUEST_DELTA "+JSON.stringify({requests: f.storeHost.requests.slice(requests).map(value=>({url:value.url,method:value.init.method??"GET"})),dialogs:dialogs(f).map(value=>value.attributes.class),toast:f.store.ui.toast,expectedToast:f.i18n.t("next.lifecycle.currentWorkOpen")}));
  assert.equal(source(f), before); assert.equal(f.storeHost.requests.length, requests);
  assert.equal(dialogs(f).length, 0, "a rendered recommendation must not compete with the unsent Ask owner");
  assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
});

test("Workspace rendered next step preserves the current controller's raw Output draft", options, async t => {
  const f = await createOutputReachabilityPage(t, { state: "confirmed", surface: "document", authoredSource: true });
  const owner = workspace(f), documentId = f.store.projection.get().documentId;
  const card = f.outputCards().find(value => value.snapshot.scope.documentId === documentId); assert.ok(card);
  await f.act(f.find("button", node => node.owner === card && node.text === f.i18n.t("output.requirement.edit")));
  const input = f.find("textarea", node => node.owner === card && node.attributes.name === "originalText");
  input.port.value = RAW; await f.act(input, "input");
  const controller = card.closest("forma-output-requirements"); assert.ok(controller?.navigationBlocked);
  const before = source(f), route = f.store.route.get(), requests = f.storeHost.requests.length;
  const snapshot = JSON.stringify(f.adapter.snapshot(documentId));
  activateLifecycle(f, rendered(f)[0].button); await drain(f);
  assert.strictEqual(workspace(f), owner); assert.ok(card.isConnected && card.hasOpenDraft && controller.navigationBlocked);
  assert.equal(f.find("textarea", node => node.owner === card && node.attributes.name === "originalText").port.value, RAW);
  assert.equal(f.store.route.get(), route); assert.equal(source(f), before); assert.equal(f.storeHost.requests.length, requests);
  assert.equal(JSON.stringify(f.adapter.snapshot(documentId)), snapshot);
  assert.equal(dialogs(f).length, 0, "the existing Save/Cancel owner remains the only unfinished edit");
  assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"));
});

for (const boundary of ["keydown", "route-aba"]) test("Workspace rendered continuation yields to newer " + boundary + " before native promotion", options, async t => {
  const f = await lifecyclePage(t, { route: "document" }), before = source(f), route = f.store.route.get(), start = f.trace.length;
  activateLifecycle(f, rendered(f)[0].button);
  if (boundary === "keydown") f.native.emit("keydown");
  else { f.store.setRoute("/activity"); f.store.setRoute(route); }
  await drain(f);
  assert.equal(source(f), before);
  assert.equal(dialogs(f).filter(value => classed(value, "next-format-dialog")).length, 0);
  assert.equal(f.trace.slice(start).filter(value => value.startsWith("open:") && value.includes("next-format-dialog")).length, 0,
    "later cleanup cannot excuse an obsolete native dialog promotion");
});
