import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { fixture, projections, append, countEvents, assertFree, frames } from "./helpers/outcome-arrangement-fixture.mjs";
import {
  OutcomeArrangementController, OUTCOME_ARRANGEMENT_ENDPOINT,
  outcomeArrangementOperationFromRoute, withOutcomeArrangementOperation,
} from "../src/state/outcome-desk-controller.ts";
import {
  outcomeArrangementRevisions, previewOutcomeArrangementUndo, outcomeArrangementUndoneActions,
  isProtectedOutcomeArrangementEvent,
} from "../src/canvas/outcome-arrangements.ts";
import { canvasIdFromRoute } from "../src/canvas/routes.ts";
import { foldEvents } from "../src/model/events.ts";
import { normalizeOutputRequirementCreation } from "../src/model/output-requirement-creation.ts";
import { artifactDeliveryState } from "../src/model/artifact-delivery.ts";
import { projectOutcomeDesk, followOutcomeDeskAction, outcomeDeskActions, withOutcomeRecipe, withOutcomeDeskPosture } from "../src/model/outcome-desk.ts";
import { outcomeDeskHostActions, outcomeDeskHostActionAvailable, outcomeDeskPreparationActions } from "../src/canvas/outcome-desk-host.ts";
import { outcomeDeskIntegrationCopy } from "../src/components/design-system/locales/outcome-desk-integration-messages.ts";

/** Execute the actual store transport method with supplied current store/network ports. */
const storeSource = fs.readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
const storeTree = ts.createSourceFile("store.ts", storeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const storeClass = storeTree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "FormaStore");
const transportMember = storeClass.members.find(node => node.name?.getText(storeTree) === "canvasArrangementRequest");
assert.ok(transportMember, "real store direct transport is wired");
const transportCode = ts.transpileModule("class StoreTransport { " + transportMember.getText(storeTree) + " }; return StoreTransport.prototype.canvasArrangementRequest;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const actualTransport = new Function("OUTCOME_ARRANGEMENT_ENDPOINT", "outcomeDeskIntegrationCopy", "currentFormaLocale", "navigator", "canvasIdFromRoute", transportCode)(
  OUTCOME_ARRANGEMENT_ENDPOINT, outcomeDeskIntegrationCopy, () => ({ locale: "en" }), { onLine: true }, canvasIdFromRoute);

async function adapter(mode = "personal", count = 3) {
  const state = await fixture(mode, count);
  let projected = await projections(state), ids = [...state.selectedItemIds], epoch = "authority-a", route = "/canvas/" + state.canvasId + "/work";
  let lose = "", unavailable = false, requests = [], newIds = 0, ready = true, mayArrange = mode !== "viewer";
  const actorId = mode === "editor" || mode === "viewer" ? "arrangement-member" : state.ownerId;
  const scope = () => unavailable ? null : { authorityKey: epoch, actorId, projectId: state.projectId, canvasId: state.canvasId };
  const context = async () => {
    const revisions = await outcomeArrangementRevisions(projected.projection, projected.canvas, ids);
    if (!scope() || !revisions.ok) return null;
    return { canvas: projected.canvas, authorityKey: epoch, actorId, siteId: actorId + ":host", events: projected.events,
      selectedItemIds: ids, canRead: true, canArrange: mayArrange, atomicTransportAvailable: ready, ...revisions.value };
  };
  const store = {
    captureAuthorizationScope: () => scope() ? { key: epoch, shared: mode !== "personal" } : null,
    authorizationScopeActive: auth => Boolean(scope() && auth?.key === epoch),
    session: { get: () => ({ user: { userId: actorId }, capabilities: ["project.read", "project.canvas.use", "project.author"],
      ...(mode === "selected" || mode === "editor" || mode === "viewer" ? { projectContext: {
        projectId: state.projectId, permissions: ["project.read", "project.canvas.use", ...(mayArrange ? ["project.author"] : [])] } } : {}) }) },
    projection: { get: () => projected.projection }, route: { get: () => route },
    async guardedFetch(url, init) {
      const command = JSON.parse(init.body);
      requests.push({ url, command });
      // A routed in-memory adapter invokes the real handler and actual SQLite authority.
      assert.equal(url, "/api/canvas/arrangements"); assert.equal(init.method, "POST");
      const response = await state.call(command);
      if (lose === command.action) { lose = ""; throw new Error("injected_http_response_loss"); }
      return response;
    },
  };
  const controller = new OutcomeArrangementController({
    scope, stamp: () => JSON.stringify([epoch, ids, projected.events.map(event => event.eventId), ready, mayArrange, unavailable]),
    context, post: command => actualTransport.call(store, command),
    remember: identity => { route = withOutcomeArrangementOperation(route, identity.operationId); },
    refresh: async () => { projected = await projections(state); }, changed() {},
    operationId: () => "intent-" + (++newIds), now: () => Date.now(),
  });
  return { state, controller, store, context, scope, requests,
    current: () => projected, route: () => route, setRoute: value => { route = value; },
    select: value => { ids = [...value]; }, selected: () => ids, lose: action => { lose = action; },
    revokeLocal: () => { unavailable = true; epoch = "revoked"; }, restoreLocal: () => { unavailable = false; epoch = "authority-a"; },
    canArrange: value => { mayArrange = value; }, atomic: value => { ready = value; },
    sync: async () => { projected = await projections(state); }, idCount: () => newIds,
  };
}
const confirmation = preview => ({ operationId: preview.operationId, previewId: preview.previewId, approvalHash: preview.approvalHash, confirmed: true });
const begin = host => host.controller.start({ recipeId: "executive-deck", name: "Existing authored work" });

test("actual store/direct controller routes one atomic receipt in all authoring scopes, including 100 cards", async () => {
  for (const [mode, count] of [["personal", 100], ["selected", 3], ["editor", 3]]) {
    const host = await adapter(mode, count), before = countEvents(host.state);
    const original = host.state.sqlite.prepare("SELECT event_id,payload FROM events WHERE stream_id=? ORDER BY sequence").all(host.state.stream);
    assert.equal(await begin(host), true);
    const preview = host.controller.state.preview;
    assert.equal(countEvents(host.state), before);
    assert.equal(await host.controller.apply(confirmation(preview)), true);
    assert.equal(host.controller.state.status, "applied");
    assert.equal(countEvents(host.state) - before, 1 + 2 * count);
    assert.equal(host.state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 1);
    assert.deepEqual(host.state.sqlite.prepare("SELECT event_id,payload FROM events WHERE stream_id=? ORDER BY sequence LIMIT ?").all(host.state.stream, before), original);
    assert.deepEqual(frames(host.current().canvas, host.selected()), preview.after);
    assert.equal(host.requests.filter(value => value.command.action === "apply").length, 1);
    assert.equal(host.requests.some(value => /canvas-sync|events|append/iu.test(value.url)), false);
    assertFree(host.state); host.state.sqlite.close();
  }
});

test("HTTP loss after apply retains one operation and only retrieves the original receipt", async () => {
  const host = await adapter(), before = countEvents(host.state);
  assert.equal(await begin(host), true);
  const preview = host.controller.state.preview, path = host.route();
  host.lose("apply");
  assert.equal(await host.controller.apply(confirmation(preview)), false);
  assert.equal(host.controller.state.status, "uncertain"); assert.equal(host.controller.state.submitted, true);
  const count = host.requests.length;
  assert.equal(await host.controller.apply(confirmation(preview)), false);
  assert.equal(await begin(host), false);
  host.setRoute(withOutcomeRecipe(withOutcomeDeskPosture(host.route(), "outcomes"), "film-continuity"));
  assert.equal(outcomeArrangementOperationFromRoute(host.route()), preview.operationId);
  assert.equal(host.requests.length, count); assert.equal(host.idCount(), 1);
  assert.equal(await host.controller.retrieve(), true);
  assert.equal(host.controller.state.status, "applied");
  assert.equal(host.requests.at(-1).command.action, "retrieve");
  assert.equal(host.requests.filter(value => value.command.action === "apply").length, 1);
  assert.equal(countEvents(host.state) - before, 7);
  assert.equal(new URL(path, "https://fixture.invalid").pathname, new URL(host.route(), "https://fixture.invalid").pathname);
  assertFree(host.state); host.state.sqlite.close();
});

test("preview loss and fresh host recovery retain the server receipt without an automatic apply", async () => {
  const host = await adapter(), before = countEvents(host.state);
  host.lose("preview");
  assert.equal(await begin(host), false); assert.equal(host.controller.state.status, "uncertain");
  assert.equal(await begin(host), false);
  assert.equal(await host.controller.retrieve(), true);
  assert.equal(host.controller.state.status, "review"); assert.equal(host.controller.state.submitted, false);
  assert.equal(countEvents(host.state), before);
  const saved = host.controller.state.preview;
  const recovered = new OutcomeArrangementController({
    ...host.controller.ports, remember() {}, operationId() { assert.fail("Recovery must not allocate an intent"); },
  });
  assert.equal(await recovered.retrieve({ operationId: saved.operationId, projectId: saved.projectId, canvasId: saved.canvasId }), true);
  assert.equal(recovered.state.preview.previewId, saved.previewId);
  assert.equal(recovered.state.submitted, false); assert.equal(countEvents(host.state), before);
  assert.equal(await recovered.dismiss(), true); assert.equal(recovered.state.status, "dismissed");
  assert.equal(countEvents(host.state), before); assertFree(host.state); host.state.sqlite.close();
});

test("simultaneous preview clicks allocate one human request and confirmation remains explicit", async () => {
  const host = await adapter(), before = countEvents(host.state);
  const results = await Promise.all([begin(host), begin(host)]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal(host.idCount(), 1);
  assert.equal(host.requests.filter(value => value.command.action === "preview").length, 1);
  assert.equal(await host.controller.apply({ ...confirmation(host.controller.state.preview), confirmed: false }), false);
  assert.equal(countEvents(host.state), before);
  assert.equal(await host.controller.dismiss(), true); assert.equal(countEvents(host.state), before);
  host.state.sqlite.close();
});

test("selection, source and current permission changes fail closed with no generic events", async () => {
  for (const boundary of ["selection", "source", "permission", "offline"]) {
    const host = await adapter(), before = countEvents(host.state);
    assert.equal(await begin(host), true); const preview = host.controller.state.preview;
    if (boundary === "selection") host.select(host.selected().slice(0, 2));
    if (boundary === "source") {
      append(host.state, [["BlockPropertyEdited", { project_id: host.state.projectId, block_id: "arrangement-source-0",
        property_path: "text", old_value: "Existing authored direction 0", new_value: "A human changed this source" }]]);
      await host.sync();
    }
    if (boundary === "permission") host.canArrange(false);
    if (boundary === "offline") host.atomic(false);
    assert.equal(await host.controller.apply(confirmation(preview)), false);
    assert.equal(host.requests.some(value => value.command.action === "apply"), false);
    assert.equal(countEvents(host.state) - before, boundary === "source" ? 1 : 0);
    assertFree(host.state); host.state.sqlite.close();
  }
});

test("server catches an unseen source change atomically before the host refreshes", async () => {
  const host = await adapter(), before = countEvents(host.state);
  assert.equal(await begin(host), true);
  append(host.state, [["BlockPropertyEdited", { project_id: host.state.projectId, block_id: "arrangement-source-0",
    property_path: "text", old_value: "Existing authored direction 0", new_value: "Concurrent exact edit" }]]);
  assert.equal(await host.controller.apply(confirmation(host.controller.state.preview)), false);
  assert.equal(host.controller.state.submitted, true); assert.equal(host.controller.state.status, "uncertain");
  assert.equal(host.requests.filter(value => value.command.action === "apply").length, 1);
  assert.equal(host.state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 0);
  assert.equal(countEvents(host.state), before + 1); host.state.sqlite.close();
});

test("canonical grouped Undo uses original previous_frames through a second exact atomic receipt", async () => {
  for (const mode of ["personal", "selected"]) {
    const host = await adapter(mode);
    assert.equal(await begin(host), true); const original = host.controller.state.preview;
    assert.equal(await host.controller.apply(confirmation(original)), true);
    assert.equal(await host.controller.start({ recipeId: original.recipeId, name: "Restore original positions", undoOperationId: original.operationId }), true);
    const inverse = host.controller.state.preview;
    assert.deepEqual(inverse.before, original.after); assert.deepEqual(inverse.after, original.before);
    assert.equal(await host.controller.apply(confirmation(inverse)), true);
    assert.deepEqual(frames(host.current().canvas, host.selected()), original.before);
    const undone = outcomeArrangementUndoneActions(host.current().events, host.state.canvasId, host.scope().actorId);
    assert.equal(undone.has(original.operationId), true); assert.equal(undone.has(inverse.operationId), true);
    const records = host.current().events.filter(event => event.type === "CanvasArrangementCreated" && isProtectedOutcomeArrangementEvent(event));
    assert.equal(records.length, 2); assert.equal(records[1].payload.undo_of_arrangement_id, records[0].payload.arrangement_id);
    assert.equal(host.requests.some(value => value.command.action === "undo-preview"), true);
    assertFree(host.state); host.state.sqlite.close();
  }
});

test("Undo model rejects altered original frames, card rotation, ambiguous source and selection", async () => {
  const host = await adapter(); await begin(host); const original = host.controller.state.preview;
  await host.controller.apply(confirmation(original));
  const current = await host.context(), choice = { recipeId: original.recipeId, name: "Undo", operationId: "inverse-intent", undoOperationId: original.operationId };
  assert.equal(previewOutcomeArrangementUndo(current, choice).ok, true);
  for (const mutate of [
    value => { value.canvas.items[0].rot = 12; },
    value => { value.canvas.items[0].sourceId = "different-source"; },
    value => { value.selectedItemIds.pop(); },
    value => { value.events.find(event => event.type === "CanvasArrangementCreated").payload.previous_frames[0].w += 20; },
    value => { value.events.push(value.events.find(event => event.type === "CanvasArrangementCreated")); },
  ]) {
    const changed = structuredClone(current); mutate(changed);
    assert.equal(previewOutcomeArrangementUndo(changed, choice).ok, false);
  }
  host.state.sqlite.close();
});

test("authority loss conceals receipt details and never permits old confirmation", async () => {
  const host = await adapter(); await begin(host); const preview = host.controller.state.preview;
  host.revokeLocal(); assert.equal(host.controller.state.preview, null); assert.equal(host.controller.state.status, "unavailable");
  assert.equal(await host.controller.apply(confirmation(preview)), false); assert.equal(await host.controller.retrieve(), false);
  host.restoreLocal(); assert.equal(await host.controller.retrieve(), true);
  assert.equal(host.controller.state.preview.previewId, preview.previewId);
  assert.equal(host.requests.some(value => value.command.action === "apply"), false); host.state.sqlite.close();
});

function deskFixture() {
  let sequence = 0;
  const events = [
    ["ProjectCreated", { project_id: "project", name: "Canonical" }],
    ["DocumentCreated", { project_id: "project", document_id: "doc", title: "Human document" }],
    ["BlockCreated", { project_id: "project", document_id: "doc", block_id: "block", type: "direction", handle: "direction/one", position: "a", properties: { text: "Human-authored context", intent: "include", authority: "authored" } }],
    ["DocumentRenderCompleted", { project_id: "project", document_id: "doc", artifact_id: "exact-artifact", artifact_kind: "slides", title: "Saved deck", item_count: 1, content_ref: "content-a", items: [] }],
  ].map(([type, payload]) => ({ eventId: "e" + (++sequence), sequence, actor: "user:owner", type, payload, occurredAt: "2026-08-27T00:00:00Z", recordedAt: "2026-08-27T00:00:00Z", correlationId: "fixture", streamId: "creative:owner", clientId: "fixture", schemaVersion: 1, causationId: null, compensatesEventId: null }));
  const projection = foldEvents(events, Infinity, "doc", "project");
  let input = { document: projection.documents[0], facts: { projectId: "project", documentId: "doc", canvasId: null,
    authorityKey: "authority", canRead: true, canAuthor: true, canConfigure: true,
    blocks: projection.blocks, outputs: projection.outputs, artifacts: projection.artifacts, events, jobs: [] } };
  const ports = { localize: (_id, fallback) => fallback, delivery: artifact => artifactDeliveryState(artifact, [...input.facts.blocks], [...input.facts.events], {
    actorUserId: "owner", shared: true, independentApprovalRequired: true, canRead: input.facts.canRead, canAuthor: input.facts.canAuthor, canReview: false,
  }) };
  return { input: () => input, set: value => { input = value; }, ports };
}

test("Desk selects no substitute object, reuses canonical references and exposes only bounded next actions", async () => {
  const host = deskFixture(), current = host.input();
  assert.equal(projectOutcomeDesk(current).selected, null);
  assert.deepEqual(outcomeDeskHostActions(current, "", host.ports), []);
  assert.deepEqual(outcomeDeskHostActions(current, "artifact:missing", host.ports), []);
  const row = projectOutcomeDesk(current, "artifact:exact-artifact").selected;
  assert.equal(row.object.value, current.facts.artifacts[0]);
  const actions = outcomeDeskHostActions(current, row.key, host.ports);
  assert.equal(actions.length, 1); assert.equal(actions[0].target.kind, "delivery");
  assert.equal(actions[0].target.artifactId, "exact-artifact");
  const available = (action, input) => outcomeDeskHostActionAvailable(action, input, host.ports);
  const bounded = outcomeDeskActions(row, actions, current, available);
  assert.equal(bounded.primary, actions[0]); assert.ok(bounded.alternatives.length <= 2);
  let opened = 0;
  assert.equal(await followOutcomeDeskAction(actions[0], host.input, { available, open: () => { opened++; } }), true);
  host.set({ ...current, facts: { ...current.facts, authorityKey: "other-authority" } });
  assert.equal(await followOutcomeDeskAction(actions[0], host.input, { available, open: () => { opened++; } }), false);
  assert.equal(opened, 1);
});

test("all eight formats remain one expert choice from existing preparation, and cannot purchase or author", () => {
  const host = deskFixture(), current = host.input(), before = JSON.stringify(current);
  const actions = outcomeDeskPreparationActions(current, "document:doc", host.ports);
  assert.deepEqual(actions.map(action => action.target.action.target.medium), [
    "image", "short_story", "scene", "slides", "storyboard", "video", "audio", "model3d",
  ]);
  assert.ok(actions.every(action => action.effect === "open-existing-executor" && action.target.action.target.kind === "configure"));
  assert.equal(JSON.stringify(current), before);
  assert.deepEqual(outcomeDeskPreparationActions({ ...current, facts: { ...current.facts, canConfigure: false } }, "document:doc", host.ports), []);
  const saved = outcomeDeskHostActions(current, "document:doc", host.ports);
  assert.equal(saved[0].target.kind, "delivery", "existing canonical receipt precedes preparation");
});

test("recipe/posture/receipt query changes preserve path, selected object, draft ownership and every canonical event", () => {
  const route = "/canvas/board/current?view=list&outcome=artifact%3Aexact&focus=1#card", op = "same-intent";
  const changed = withOutcomeDeskPosture(withOutcomeRecipe(withOutcomeArrangementOperation(route, op), "campaign"), "outcomes");
  assert.equal(outcomeArrangementOperationFromRoute(changed), op);
  const url = new URL(changed, "https://fixture.invalid");
  assert.equal(url.pathname, "/canvas/board/current"); assert.equal(url.hash, "#card");
  assert.equal(url.searchParams.get("outcome"), "artifact:exact"); assert.equal(url.searchParams.get("view"), "list");
  assert.equal(withOutcomeArrangementOperation(route, "../bad"), route);
  for (const locale of ["en", "fr", "ar", "ja"]) {
    const copy = outcomeDeskIntegrationCopy(locale);
    assert.equal(Object.keys(copy).length, Object.keys(outcomeDeskIntegrationCopy("en")).length);
    assert.ok(Object.values(copy).every(value => typeof value === "string" && value.trim()));
    if (locale !== "en") assert.notEqual(copy.rights, outcomeDeskIntegrationCopy("en").rights);
  }
});


const historyNames = new Set(["#undo","#redo","#canvasHistoryEvent","#historyIndex","#streamCanvasUndoGroup","#undoCandidate","#principalEventActor","canUndo","canRedo","undo","redo","#sourceGeneration","#sourceRetired","#sourceOwners","captureSourceOwnership","sourceOwnershipScopeActive","sourceOwnershipActive","#sourceExpiryValid","#sourceDeadlineCurrent","#eventWriteComplete","#requestedEventObserved"]);
const historyMembers = storeClass.members.filter(node => historyNames.has(node.name?.getText(storeTree))).map(node => node.getText(storeTree)).join("\n");
const historyFunctions = storeTree.statements.filter(node => ts.isFunctionDeclaration(node)
  && ["historyHlc","inverseEvent","redoEvent","withoutClientEventId"].includes(node.name?.text)).map(node => node.getText(storeTree)).join("\n");
// SIMULATED legacy history fixture only: these are the old mocked append rows,
// not a server acknowledgment, source certificate, or authoring receipt.
// Duplicate/missing identities fail here rather than being invented or repaired.
function SIMULATED_HISTORY_APPEND_RESULT(inputs, appended) {
  assert.ok(Array.isArray(appended) && appended.length === inputs.length, "SIMULATED history requires every mocked input row");
  const ids = new Set(), sequences = new Set();
  for (const [index, event] of appended.entries()) {
    assert.ok(typeof event.eventId === "string" && event.eventId && !ids.has(event.eventId), "SIMULATED history rejects duplicate or absent event IDs");
    assert.ok(Number.isSafeInteger(event.sequence) && event.sequence > 0 && !sequences.has(event.sequence), "SIMULATED history rejects duplicate or absent event sequences");
    ids.add(event.eventId); sequences.add(event.sequence);
    assert.equal(event.type, inputs[index].type);
    assert.deepEqual(event.payload, inputs[index].payload);
    assert.equal(event.compensatesEventId ?? null, inputs[index].compensatesEventId ?? null);
  }
  return { appended, publication: "published", acknowledgment: { outcome: "observed", rejectedIndices: [] } };
}
const historySource = "let historyClock=0;\n"+historyFunctions+"\nclass HistoryPort { "+historyMembers+
  "\n#systemNotice(value){return value;}\n"+
  // The old fixture's captured-key port remains the authority simulation.
  // Actual source instance/generation/expiry tests use the production members.
  "authorizationScopeActive(value){const current=this.captureAuthorizationScope();return Boolean(value&&current&&value.key===current.key);}\n"+
  "async appendBatchWithReceipt(inputs,options){return SIMULATED_HISTORY_APPEND_RESULT(inputs,await this.appendBatch(inputs,options));}\n"+
  "}; return HistoryPort;";
const ActualHistory = new Function("canvasIdFromRoute","documentViewFromRoute","isProtectedOutcomeArrangementEvent","outcomeArrangementUndoneActions","SIMULATED_HISTORY_APPEND_RESULT","normalizeOutputRequirementCreation",
  ts.transpileModule(historySource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(
    canvasIdFromRoute,()=> "editor",isProtectedOutcomeArrangementEvent,outcomeArrangementUndoneActions,SIMULATED_HISTORY_APPEND_RESULT,normalizeOutputRequirementCreation);

test("actual store Undo intercepts the complete protected group for personal/shared actors without rebatching", async () => {
  for(const mode of ["personal","selected"]){
    const adapterHost=await adapter(mode);await begin(adapterHost);const preview=adapterHost.controller.state.preview;
    await adapterHost.controller.apply(confirmation(preview));
    const writes=[],requests=[],history=new ActualHistory();
    Object.assign(history,{session:adapterHost.store.session,events:{get:()=>adapterHost.current().events},route:adapterHost.store.route,
      captureAuthorizationScope:adapterHost.store.captureAuthorizationScope,canvasArrangementUndoRequest:{set:value=>requests.push(value)},
      appendBatch:async value=>{writes.push(value);return[];},notify(){},toast:assert.fail});
    assert.equal(history.canUndo(),true);await history.undo();
    assert.equal(writes.length,0);assert.equal(requests.length,1);assert.equal(requests[0].operationId,preview.operationId);
    assert.equal(requests[0].canvasId,preview.canvasId);assert.equal(requests[0].authorityKey,"authority-a");
    await history.undo();assert.equal(writes.length,0);assert.equal(requests.length,2,"reopening Undo is a review request, never duplicate writes");
    await adapterHost.controller.start({recipeId:preview.recipeId,name:"Undo positions",undoOperationId:preview.operationId});
    await adapterHost.controller.apply(confirmation(adapterHost.controller.state.preview));
    assert.equal(history.canUndo(),false,"the original and its inverse are one completed ledger Undo, not another generic inverse");
    assert.equal(history.canRedo(),false);assertFree(adapterHost.state);adapterHost.state.sqlite.close();
  }
});

test("actual ordinary Undo/Redo paths retain their existing inverse-event behavior", async () => {
  let events=[{eventId:"ordinary",sequence:1,actor:"user:owner",clientId:"fixture",type:"CanvasRegisterSet",payload:{
    canvas_id:"board",history_action_id:"ordinary-action",history_owner_id:"owner",source_surface:"canvas-keyboard-nudge",item_id:"card",
    previous_value:10,operation:{object:{kind:"canvas_item",item_id:"card"},prop:"x",value:18,hlc:{pt:1,c:0,site:"owner:fixture"}},
  }}];
  const writes=[],history=new ActualHistory();
  Object.assign(history,{session:{get:()=>({user:{userId:"owner"},projectContext:{}})},events:{get:()=>events},route:{get:()=>"/canvas/board/current"},
    captureAuthorizationScope:()=>({key:"authority"}),canvasArrangementUndoRequest:{set:()=>assert.fail("ordinary Undo must not open arrangement review")},
    appendBatch:async inputs=>{writes.push(inputs);const appended=inputs.map(input=>({...input,eventId:"written-"+(events.length+1),sequence:events.length+1,actor:"user:owner",clientId:"fixture"}));events=[...events,...appended];return appended;},
    notify(){},toast:assert.fail});
  assert.equal(history.canUndo(),true);await history.undo();
  assert.equal(writes.length,1);assert.equal(writes[0][0].type,"CanvasRegisterSet");assert.equal(writes[0][0].payload.operation.value,10);
  assert.equal(writes[0][0].compensatesEventId,"ordinary");assert.equal(history.canRedo(),true);
  await history.redo();assert.equal(writes.length,2);assert.equal(writes[1][0].payload.operation.value,18);
});

test("a retained URL operation blocks allocation on reload until explicit recovery", async () => {
  const host=await adapter();await begin(host);const preview=host.controller.state.preview;
  let allocations=0;
  const recovered=new OutcomeArrangementController({...host.controller.ports,
    operationId:()=>{allocations++;return"forbidden-replacement";},
    recoveryIdentity:()=>({operationId:preview.operationId,projectId:preview.projectId,canvasId:preview.canvasId}),
  });
  assert.equal(await recovered.start({recipeId:"campaign",name:"Should require recovery"}),false);
  assert.equal(allocations,0);assert.equal(recovered.state.identity.operationId,preview.operationId);
  assert.equal(recovered.state.status,"uncertain");assert.equal(host.requests.filter(request=>request.command.action==="preview").length,1);
  assert.equal(await recovered.retrieve(),true);assert.equal(recovered.state.status,"review");
  assert.equal(recovered.state.preview.previewId,preview.previewId);assert.equal(allocations,0);
  host.state.sqlite.close();
});

test("malformed review replies cannot expose an enabled confirmation", async () => {
  const host=await adapter(),original=host.controller.ports.post;
  host.controller.ports.post=async command=>command.action==="preview"
    ?{ok:true,status:200,body:{status:"review",preview:{...command,before:[{}],after:[],selectedItemIds:[]}}}:original(command);
  assert.equal(await begin(host),false);assert.equal(host.controller.state.status,"uncertain");assert.equal(host.controller.state.preview,null);
  assert.equal(await host.controller.apply({operationId:"intent-1",previewId:"unknown",approvalHash:"bad",confirmed:true}),false);
  assert.equal(host.requests.length,0);assertFree(host.state);host.state.sqlite.close();
});


test("a malformed applied envelope never becomes a saved claim or another apply", async () => {
  const host=await adapter();await begin(host);const preview=host.controller.state.preview;
  host.controller.ports.post=async command=>({ok:true,status:200,body:{status:"applied",operationId:command.operationId,
    projectId:command.projectId,canvasId:command.canvasId,arrangementId:"outcome-arrangement:",providerCalls:0,maximumMicrousd:0,changesSemantics:false}});
  assert.equal(await host.controller.apply(confirmation(preview)),false);
  assert.equal(host.controller.state.status,"uncertain");assert.equal(host.controller.state.submitted,true);
  assert.equal(await begin(host),false);assert.equal(host.idCount(),1);
  assert.equal(host.state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n,0);
  assertFree(host.state);host.state.sqlite.close();
});


test("SIMULATED history fixture exercises grouped ordinary Undo/Redo with distinct original mocked identities", async () => {
  let events = [0, 1].map(index => ({ eventId: "group-original-" + index, sequence: index + 1,
    actor: "user:owner", clientId: "fixture", type: "CanvasRegisterSet", payload: {
      canvas_id: "board", history_action_id: "group-action", history_owner_id: "owner", source_surface: "canvas-keyboard-nudge",
      item_id: "card-" + index, previous_value: 10 + index,
      operation: { object: { kind: "canvas_item", item_id: "card-" + index }, prop: "x", value: 20 + index,
        hlc: { pt: index + 1, c: 0, site: "owner:fixture" } },
    } }));
  const history = new ActualHistory(), writes = [];
  Object.assign(history, {
    session: { get: () => ({ user: { userId: "owner" }, projectContext: {} }) },
    events: { get: () => events }, route: { get: () => "/canvas/board/current" },
    captureAuthorizationScope: () => ({ key: "SIMULATED-group-authority" }),
    canvasArrangementUndoRequest: { set: () => assert.fail("ordinary grouped Undo must not open arrangement review") },
    appendBatch: async inputs => {
      writes.push(inputs);
      const base = events.length;
      const appended = inputs.map((input, index) => ({ ...input, eventId: "group-written-" + (base + index + 1),
        sequence: base + index + 1, actor: "user:owner", clientId: "fixture" }));
      events = [...events, ...appended]; return appended;
    },
    notify() {}, toast: assert.fail,
  });
  assert.equal(history.canUndo(), true);
  await history.undo();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 2);
  assert.deepEqual(writes[0].map(input => input.payload.operation.value), [11, 10]);
  assert.equal(history.canRedo(), true);
  await history.redo();
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[1].map(input => input.payload.operation.value), [20, 21]);
  assert.equal(new Set(events.map(event => event.eventId)).size, 6);
});

test("SIMULATED history fixture rejects the old constant-ID multi-row shape rather than certifying it", () => {
  const inputs = [0, 1].map(index => ({ type: "CanvasRegisterSet", payload: { item_id: "card-" + index } }));
  const duplicated = inputs.map(input => ({ ...input, eventId: "written-3", sequence: 3,
    actor: "user:owner", clientId: "fixture" }));
  assert.throws(() => SIMULATED_HISTORY_APPEND_RESULT(inputs, duplicated), /SIMULATED history rejects duplicate/);
  assert.deepEqual(duplicated.map(event => event.eventId), ["written-3", "written-3"]);
});
