import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { Signal } from "signal-polyfill";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import { formaActivityAttention, scopedFormaActivity } from "../src/model/activity.ts";
import { enforceD1ExpressionDepth } from "./helpers/d1-expression-depth.mjs";

const root = new URL("../", import.meta.url).href;
const loader = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/") &&
      specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
  },
  load(url, context, nextLoad) {
    return url.endsWith(".css") ? { format: "module", source: "export {};", shortCircuit: true } : nextLoad(url, context);
  },
});
const [copyModel, { buildDocumentDuplicationPlan, normalizeDocumentDuplicationTitle, documentDuplicationFolder },
  { foldEvents }, { renderAuthoringPreview }, { withDocumentInRoute, libraryBlockEditorRoute }, { html, nothing }, { captureOutputNavigationFocus }] = await Promise.all([
  import("../src/model/document-copy-review.ts"), import("../src/model/document-duplication.ts"),
  import("../src/model/events.ts"), import("../src/components/authoring-preview.ts"), import("../src/model/routes.ts"), import("lit"), import("../src/components/output-navigation-focus.ts"),
]).finally(() => loader.deregister());
const { documentCopyKey, documentCopyIntent, documentCopySourceRevision, documentCopyRequest,
  documentCopyOutcome, documentCopyDestination, documentCopyIssueMessage, documentCopyTargetValid } = copyModel;
const target = { projectId: "project-a", documentId: "source-a" };
const storeSource = readFileSync(new URL("../src/state/store.ts", import.meta.url), "utf8");
const hostSource = readFileSync(new URL("../src/components/forma-project-contents.ts", import.meta.url), "utf8");
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Production boundary changed: " + start);
  return source.slice(a, b).replaceAll("#", "_");
}
const storeMethods = between(storeSource, "  #documentCopyFacts(", "  #canRequestProjectOutputs(");
const hostMethods = between(hostSource, "  #copyTarget()", "  #requestDelete(");
const hostUpdated = between(hostSource, "  protected override updated()", "  #copyTarget()");
const ordinaryOwnerMethods = between(hostSource, "  #retireOrdinaryDocument(){", "  protected override updated(){");
const hostRender = between(hostSource, "  override render()", "\n}\nif (!customElements");
const hostFields = hostSource.split("\n").filter(line => /^ {2}#(?:(?:query|duplicateProjectId)=|ordinaryDocument:)/u.test(line)).join("\n").replaceAll("#", "_");
const event = (sequence, type, payload) => ({ eventId: "event-" + sequence, streamId: "creative:account-a", sequence,
  occurredAt: "2026-08-26T12:00:00.000Z", recordedAt: "2026-08-26T12:00:00.000Z", actor: "user:account-a",
  clientId: "test", correlationId: "source", causationId: null, compensatesEventId: null, schemaVersion: 1, type, payload });
function baseline() {
  return [
    ["ProjectCreated", { project_id: "project-a", name: "Copy project" }],
    ["DocumentCreated", { project_id: "project-a", document_id: "source-a", title: "Original name", handle: "original-name" }],
    ["DocumentCreated", { project_id: "project-a", document_id: "source-b", title: "Other source", handle: "other-source" }],
    ["CollectionCreated", { project_id: "project-a", collection_id: "folder-a", handle: "Café / 企画", position: "a1" }],
    ["CollectionItemAdded", { project_id: "project-a", collection_id: "folder-a", item_ref: { document_id: "source-a" }, position: "a1" }],
    ["BlockCreated", { project_id: "project-a", document_id: "source-a", block_id: "message-a", type: "message", handle: "message/main", position: "a1",
      properties: { text: "Exact original words", weight: .8, intent: "prohibit", authority: "authored" } }],
    ["BlockCreated", { project_id: "project-a", document_id: "source-a", block_id: "reference-a", type: "reference", handle: "reference/source", position: "a2",
      properties: { text: "Source evidence", reference_id: "licensed-source", rights_class: "owned_or_licensed", source_evidence_hash: "source-hash",
        source_citations: [{ anchor: "page-1", excerpt: "Protected exact evidence" }] } }],
    ["BlockCreated", { project_id: "project-a", document_id: "source-a", block_id: "action-a", type: "action", handle: "action/present", position: "a3",
      properties: { text: "Present @message", source_block_id: "message-a",
        block_references: [{ block_id: "message-a", handle: "message/main", role: "target" }] } }],
    ["BlockRelationAdded", { project_id: "project-a", document_id: "source-a", relation_id: "participant-a",
      from_block_id: "action-a", to_block_id: "message-a", kind: "action_participant", properties: { participant_role: "target", handle: "message/main" } }],
    ["BlockLocked", { project_id: "project-a", document_id: "source-a", block_id: "reference-a" }],
    ["DocumentRenderCompleted", { project_id: "project-a", document_id: "source-a", artifact_id: "original-output", artifact_kind: "slides",
      title: "Original result", item_count: 1, items: [{ id: "slide-a", title: "Original only", body: "Do not copy the result" }] }],
  ].map(([type, payload], index) => event(index + 1, type, payload));
}
const flatten = value => typeof value === "symbol" || value === undefined || value === null ? "" :
  Array.isArray(value) ? value.map(flatten).join("") :
  value?.strings ? value.strings.reduce((text, part, index) => text + part + (typeof value.values[index] === "function" ? "" : flatten(value.values[index])), "") :
  String(value);

// Actual production store methods and UI handlers, with deterministic network,
// time and DOM ports. Backend transaction correctness is tested separately by
// document-duplication-api.test.mjs using real SQLite and both Phase6 patches.
function fixture(overrides = {}) {
  const target = overrides.target ?? { projectId: "project-a", documentId: "source-a" };
  let now = overrides.now ?? 1_900_000_000_000, operationSerial = 0, serverSerial = 0;
  const canonical = baseline(), requests = [], navigation = [], notices = [], timers = new Map(), reviews = new Map();
  const state = { selectedDocumentId: target.documentId, projectId: target.projectId,
    session: { user: { userId: "account-a", role: "creator" }, policy: { accepted: true, version: "policy-1" },
      permissionEpoch: "epoch-1", capabilities: ["project.read", "project.author"], canvas: { access: false } },
    projection: overrides.projection ?? foldEvents(canonical, Infinity, target.documentId, target.projectId) };
  const controls = { losePreview: false, loseApply: false, applyBarrier: null, applying: false, stale: false, erased: false,
    refreshFail: false, refreshOmit: false, response: null, beforeResponse: null, jsonBarrier: null };
  const scope = () => state.session ? JSON.stringify([state.session.user.userId, state.session.permissionEpoch,
    state.session.projectContext?.projectAccessId ?? null]) : "";
  const Date = class extends globalThis.Date { static now() { return now; } };
  const readProjection = () => foldEvents(canonical, Infinity, state.selectedDocumentId, state.projectId);
  const seenCopyCount = () => canonical.filter(item => item.type === "DocumentCreated" && item.payload.source_document_id).length;
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const saved = row => row.applied ? { status: "applied", previewId: row.preview.previewId, approvalHash: row.preview.approvalHash,
    documentId: row.plan.documentId, operationId: row.intent.operationId,
    ...(!controls.erased ? { preview: row.preview } : {}) } :
    { status: controls.applying ? "applying" : "not-applied", preview: row.preview, stale: controls.stale };
  async function gateway(url, init) {
    assert.equal(url, "/api/documents/duplicate");
    assert.equal(init.method, "POST"); assert.equal(init.credentials, "same-origin"); assert.equal(init.cache, "no-store");
    const body = JSON.parse(init.body); requests.push(structuredClone(body));
    // SIMULATED gateway envelope port for the guarded original-preview dismiss.
    // Preserve the legacy grammar assertion below after validating/removing only
    // the two exact new protocol fields; the real SQLite bridge remains unchanged.
    const guardedDismiss = body.action === "dismiss" && body.onlyIfUnapplied === true;
    const dismissalIdentity = guardedDismiss ? { operationId: body.operationId, previewId: body.previewId, approvalHash: body.approvalHash } : null;
    if (guardedDismiss) {
      assert.deepEqual(Object.keys(body).sort(), ["action", "projectId", "documentId", "previewId", "approvalHash", "operationId", "onlyIfUnapplied"].sort());
      assert.equal(typeof body.operationId, "string");
      delete body.onlyIfUnapplied; delete body.operationId;
    }
    assert.deepEqual(Object.keys(body).filter(key => !["action", "projectId", "documentId", ...(body.action === "preview"
      ? ["operationId", "title", "collectionId"] : ["previewId", "approvalHash", ...(body.action === "resume" ? ["operationId"] : [])])].includes(key)), []);
    if (controls.beforeResponse) { const callback = controls.beforeResponse; controls.beforeResponse = null; await callback(body); }
    if (controls.response) return controls.response(body);
    let row = [...reviews.values()].find(item => item.preview.previewId === body.previewId);
    if (body.action === "resume") {
      row = body.operationId ? reviews.get(body.operationId) : [...reviews.values()].findLast(item => !item.dismissed && item.intent.projectId === body.projectId && item.intent.documentId === body.documentId);
      return reply(row ? saved(row) : { status: "none" });
    }
    if (body.action === "preview") {
      row = reviews.get(body.operationId);
      if (!row) {
        const projection = foldEvents(canonical, Infinity, body.documentId, body.projectId);
        const plan = buildDocumentDuplicationPlan({ projection, sourceDocumentId: body.documentId, title: body.title,
          sourceStreamId: "creative:account-a", sourceSequence: canonical.length,
          ...(Object.hasOwn(body, "collectionId") ? { collectionId: body.collectionId } : {}),
          createId: () => "server-copy-" + ++serverSerial });
        const previewId = "preview-" + serverSerial, changes = plan.events.filter(item => item.type === "BlockCreated").map(item => ({
          kind: "copy", type: item.payload.type, label: item.payload.handle, text: String(item.payload.properties.text ?? ""),
          sourceId: item.payload.copied_from_block_id, targetId: item.payload.block_id,
        }));
        const preview = { previewId, approvalHash: "a".repeat(64), sourceHash: "b".repeat(64), projectId: body.projectId,
          documentId: body.documentId, canvasId: null, blockId: "", changes, events: plan.events,
          blockCount: plan.blockCount, relationCount: plan.relationCount, expiresAt: new Date(now + 600_000).toISOString(),
          duplication: { operationId: body.operationId, title: plan.title, collectionId: plan.collectionId,
            collectionMode: Object.hasOwn(body, "collectionId") ? "explicit" : "source",
            collectionPath: documentDuplicationFolder(projection, plan.collectionId).map(item => item.handle),
            sourceTitle: projection.documents.find(item => item.id === body.documentId).title, copyMode: "independent-snapshot",
            excluded: ["outputs", "approvals", "generation-jobs", "review-assignments"] } };
        row = { intent: structuredClone(body), plan, preview, applied: false, dismissed: false }; reviews.set(body.operationId, row);
      }
      if (controls.losePreview) { controls.losePreview = false; throw new Error("lost preview response"); }
      return reply(saved(row));
    }
    assert.ok(row, "Exact preview identity required");
    assert.equal(body.approvalHash, row.preview.approvalHash);
    assert.equal(body.projectId, row.intent.projectId); assert.equal(body.documentId, row.intent.documentId);
    if (body.action === "dismiss") {
      if (guardedDismiss) {
        assert.equal(dismissalIdentity.operationId, row.intent.operationId);
        if (row.applied) return reply(saved(row));
      }
      if (controls.applying) return reply({ status: "applying", previewId: row.preview.previewId }, 409);
      row.dismissed = true; return reply({ status: "dismissed", ...(dismissalIdentity ?? {}) });
    }
    if (body.action === "retrieve") return reply(saved(row));
    assert.equal(body.action, "apply");
    if (controls.applyBarrier) await controls.applyBarrier;
    if (controls.applying) return reply({ status: "applying", previewId: row.preview.previewId }, 202);
    if (controls.stale) return reply({ status: "not-applied", error: "authoring_preview_stale" }, 409);
    if (!row.applied) {
      for (const input of row.plan.events) canonical.push(event(canonical.length + 1, input.type, input.payload));
      row.applied = true;
    }
    if (controls.loseApply) { controls.loseApply = false; throw new Error("lost apply response"); }
    return reply({ ...saved(row), preview: undefined });
  }
  const window = { setTimeout(callback) { const id = Symbol("timer"); timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); } };
  const storePorts = { Signal, documentCopyKey, documentCopyIntent, documentCopySourceRevision, documentCopyRequest,
    documentCopyOutcome, documentCopyTargetValid, state, scope, Date, window, AbortController,
    crypto: { randomUUID: () => "copy-operation-" + String(++operationSerial).padStart(6, "0") }, gateway, controls,
    readProjection, notices, navigation };
  const Store = Function(...Object.keys(storePorts), "return " + stripTypeScriptTypes("(class {\n" +
    "documentCopyReviews=new Signal.State({}); _documentCopyRequest=0; route=new Signal.State('/studio/project');\n" +
    "session={get:()=>state.session}; projection={get:()=>state.projection}; ui={focusCollectionId:''}; reviewInbox={get:()=>state.reviewInbox??[]}; projectNotifications={get:()=>state.projectNotifications??[]}; documentJobs={get:()=>state.documentJobs??[]};\n" +
    "captureAuthorizationScope(){return state.session?{key:scope(),shared:Boolean(state.session.projectContext)}:null;}\n" +
    "authorizationScopeActive(captured){return Boolean(captured&&captured.key===scope());}\n" +
    "_fixtureListeners=new Set(); subscribe(listener){this._fixtureListeners.add(listener);return()=>this._fixtureListeners.delete(listener);}\n" +
    "notify(){notices.push('update');for(const listener of [...this._fixtureListeners])listener();} _systemNotice(value){return value;}\n" +
    "async guardedFetch(url,init,_action,ports={}){const current=()=>{if(ports.current&&!ports.current())throw new Error('source changed');};current();const pending=gateway(url,init);ports.onDispatch?.();const response=await pending;current();return response;}\n" +
    "async refreshEvents(){notices.push('refresh');if(controls.refreshFail)throw new Error('refresh failed');if(!controls.refreshOmit)state.projection=readProjection();}\n" +
    "async openDocument(id){navigation.push(id);state.selectedDocumentId=id;state.projection=readProjection();return true;}\n" +
    "appendBatch(){throw new Error('Copy must not send an event batch');} append(){throw new Error('Copy must not send an event');}\n" +
    storeMethods + "\n})"))(...Object.values(storePorts));
  const store = new Store(), focus = [];
  installSourceOwnershipPort(store);
  const focusListeners = new Map();
  class HTMLElement { isConnected = true; focus() { focus.push(this); document.activeElement = this;
    for (const listener of [...(focusListeners.get("focusin") ?? [])]) listener({ type: "focusin", target: this, currentTarget: document }); } }
  const opener = new HTMLElement(), heading = new HTMLElement(), input = new HTMLElement();
  const document = { activeElement: opener,
    addEventListener(type, listener) { const listeners = focusListeners.get(type) ?? new Set(); listeners.add(listener); focusListeners.set(type, listeners); },
    removeEventListener(type, listener) { focusListeners.get(type)?.delete(listener); } };
  const dialog = { open: false, close() { this.open = false; } };
  const ensureModalDialog = value => { value.open = true; };
  const i18n = { t: (key, fallback = key, values = {}) => Object.entries(values).reduce((text, [name, value]) => text.replaceAll("{" + name + "}", String(value)), fallback),
    number: value => String(value), system: value => value };
  function createHost() {
    const native = overrides.nativeNavigation;
    if (native) { Object.assign(native.frame, { store, i18n }); native.ports.bindFixture(native.frame); }
    const ports = { store, document: native?.ports.documentPort ?? document,
      HTMLElement: native?.ports.ElementPort ?? HTMLElement, HostBase: native?.ports.ElementPort ?? Object,
      ensureModalDialog: native?.ports.modalPort.ensureModalDialog ?? ensureModalDialog,
      navigateInApp: native?.navigateInApp, captureOutputNavigationFocus, i18n, html, nothing, icon: () => "",
      normalizeDocumentDuplicationTitle, documentDuplicationFolder, documentCopyDestination, documentCopyIssueMessage,
      renderAuthoringPreview, withDocumentInRoute, libraryBlockEditorRoute, canvasRoute: () => "", formaActivityAttention, scopedFormaActivity, dialog, heading, input, foldEvents };
    const Host = Function(...Object.keys(ports), "return " + stripTypeScriptTypes("(class extends HostBase {\n" +
      hostFields + "\nstore=store; i18n=i18n; isConnected=true;\n" +
      (native ? "" : "ownerDocument=document; requestUpdate(){} get updateComplete(){return Promise.resolve();}\n" +
      "querySelectorAll(){return this._newDocument?[dialog]:[];} querySelector(selector){return selector.includes(' input')?input:selector.includes('dialog')&&!selector.includes('h2')?dialog:heading;}\n") +
      ordinaryOwnerMethods + "\n" + hostUpdated + "\n" + hostMethods + "\n" + hostRender + "\n})"))(...Object.values(ports));
    return new Host();
  }
  const host = createHost();
  async function review(details = {}) {
    await host._beginDuplicate(target.documentId); host._title = details.title ?? "Cafe\u0301 企画 copy";
    host._copyFolder = Object.hasOwn(details, "collectionId") ? details.collectionId === null ? "root" : "folder:" + details.collectionId : "source";
    await host._createDocument({ preventDefault() {} });
    assert.equal(store.documentCopyReview(target).phase, "review");
    return store.documentCopyReview(target);
  }
  return { store, host, state, requests, navigation, notices, controls, reviews, canonical, target, review, createHost,
    seenCopyCount, focus, dialog, timers, document, now: () => now, advance: milliseconds => { now += milliseconds; }, event, readProjection };
}

// Opt-in composition for the two original isolated Open-copy cases only.
// Their gateway, extracted copy methods and synthetic openDocument completion
// remain the original ports. This is actual Shell admission, not a full app,
// actual Store route commit, Worker receipt or native-close scheduling claim.
async function copyNavigationFixture(t) {
  const { calmFullPageNativePorts: ports, fullPageTree } = await import("./helpers/calm-full-page-fixture.mjs");
  const { installOutputNavigationFocusNative } = await import("./helpers/output-navigation-focus-native.mjs");
  const { FormaShell } = await ports.loadActual("src/components/forma-shell.ts");
  const { navigateInApp } = await ports.loadActual("src/components/command-departure.ts");
  const frame = { locale: "en", trace: [], listeners: new Map(), changed: new Map(), frames: new Map(),
    timers: new Map(), resizeTargets: new Map(), storage: new Map(), clipboard: [], timerSequence: 0, requested: false };
  const f = fixture({ nativeNavigation: { ports, frame, navigateInApp } });
  const original = { notify: f.store.notify, events: f.store.events,
    subscribe: f.store.subscribe, captureWorkspaceNavigationFocus: f.store.captureWorkspaceNavigationFocus };
  assert.equal(original.events, undefined); assert.equal(typeof original.subscribe, "function");
  assert.equal(typeof original.notify, "function"); assert.ok(f.store._fixtureListeners instanceof Set);
  assert.equal(original.captureWorkspaceNavigationFocus, undefined);
  const cleanups = [];
  let shell = null;
  t.after(async () => {
    ports.bindFixture(frame);
    try {
      f.host.isConnected = false; f.host.parentElement = null;
      for (const node of frame.renderer?.nodes ?? []) node.isConnected = false;
      if (shell) { shell.isConnected = false; shell.disconnectedCallback(); }
      frame.frames.clear(); frame.timers.clear();
    } finally {
      for (const cleanup of cleanups.reverse()) await cleanup();
      try {
        assert.equal(f.store.notify, original.notify); assert.equal(f.store.subscribe, original.subscribe);
      } finally {
        delete f.store.events; delete f.store.captureWorkspaceNavigationFocus;
        ports.bindFixture(null);
      }
    }
  });
  // The old synthetic Open does not publish a workspace-navigation receipt.
  // Reuse the real reader with its initial null slot; never fabricate arrival.
  const reader = between(storeSource, "  captureWorkspaceNavigationFocus(", "  #loadRevision=");
  const Navigation = Function("return " + stripTypeScriptTypes("(class {\n"
    + "_workspaceNavigationFocus=null; _workspaceTransition=0;\n" + reader + "\n})"))();
  const navigation = new Navigation(); navigation.route = f.store.route;
  f.store.captureWorkspaceNavigationFocus = navigation.captureWorkspaceNavigationFocus.bind(navigation);
  f.store.events = { get: () => f.canonical };
  // Reuse D's original fixture subscription; no second listener set or notify wrapper.
  frame.renderer = new ports.RendererPort(frame, {});
  frame.host = f.host; f.host.tag = "forma-project-contents"; f.host.attributes = {};
  frame.draw = () => { ports.bindFixture(frame); frame.requested = false;
    return frame.renderer.draw(f.host, () => f.host._newDocument ? f.host._copyDialog() : nothing); };
  frame.tick = async () => { await Promise.resolve(); if (f.host.isConnected) frame.draw(); return true; };
  frame.tree = () => fullPageTree(frame);
  const native = installOutputNavigationFocusNative({ after: cleanup => cleanups.push(cleanup) }, frame, ports);
  ports.bindFixture(frame);
  shell = new FormaShell(); shell.tag = "forma-shell"; shell.attributes = {}; shell.isConnected = true;
  f.host.parentElement = shell; shell.connectedCallback(); frame.draw();
  assert.ok(shell instanceof FormaShell); assert.ok(f.host instanceof ports.ElementPort);
  assert.equal(f.host.closest("forma-shell"), shell); assert.ok(shell.contains(f.host));
  assert.ok(ports.ElementPort.hasStoreIdentity(shell, f.store) && ports.ElementPort.hasStoreIdentity(f.host, f.store));
  assert.equal(f.host.ownerDocument, native.document);
  f.openCopy = () => {
    const before = { requests: structuredClone(f.requests), canonical: structuredClone(f.canonical) };
    frame.draw();
    assert.deepEqual(f.requests, before.requests); assert.deepEqual(f.canonical, before.canonical);
    const review = f.store.documentCopyReview(f.target), document = f.state.projection.documents.find(value =>
      value.id === review?.receipt?.documentId && value.projectId === f.target.projectId && !value.removed);
    assert.equal(review?.phase, "applied"); assert.ok(document);
    const tree = frame.tree(), dialogs = tree.visible("dialog").filter(row => row.owner === f.host
      && row.port.classList.contains("document-copy-dialog") && row.port.open);
    assert.equal(dialogs.length, 1); const dialog = dialogs[0];
    const anchors = tree.visible("a").filter(row => row.owner === f.host
      && row.attributes.href === withDocumentInRoute("/", document.id, document.title)
      && row.text.includes(f.host.i18n.t("document.copy.open", "Open copied document")));
    assert.equal(anchors.length, 1); const anchor = anchors[0];
    assert.equal(typeof anchor.handlers.click, "function");
    assert.ok(anchor.port.isConnected && frame.renderer.nodes.includes(anchor.port));
    assert.equal(anchor.port.closest("dialog"), dialog.port); assert.ok(dialog.port.contains(anchor.port));
    assert.equal(f.host.querySelector(".document-copy-dialog"), dialog.port);
    assert.equal(anchor.port.ownerDocument, native.document); assert.ok(anchor.port.getClientRects().length);
    assert.equal(anchor.port.matches(":disabled"), false);
    native.emit("pointerdown", anchor.port); native.focus(anchor.port);
    const event = { type: "click", target: anchor.port, currentTarget: anchor.port, button: 0,
      metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    // Observe the original extracted handler's Promise through its real emitted
    // void callback. Return that exact Promise, including a held true result;
    // do not coerce late completion to false and hide the host's epoch guard.
    const originalOpen = f.host._openCopy; let pending = null, calls = 0;
    f.host._openCopy = function (originalEvent) {
      assert.equal(this, f.host); assert.equal(originalEvent, event); calls++;
      pending = originalOpen.call(this, originalEvent); return pending;
    };
    try { anchor.handlers.click.call(anchor.owner, event); }
    finally { f.host._openCopy = originalOpen; event.currentTarget = null; }
    assert.equal(calls, 1); assert.ok(pending); assert.equal(event.defaultPrevented, true);
    return pending;
  };
  return f;
}


test("the real copy handler previews freely, then applies one complete copy and links its exact document", async t => {
  const f = await copyNavigationFixture(t), original = structuredClone(f.state.projection);
  const preview = await f.review();
  assert.equal(f.seenCopyCount(), 0);
  assert.deepEqual(f.requests.map(item => item.action), ["resume", "preview"]);
  assert.equal(preview.intent.title, "Café 企画 copy");
  assert.equal(Object.hasOwn(f.requests[1], "collectionId"), false);
  const markup = flatten(f.host._copyDialog());
  assert.match(markup, /locks, typed relationships, rights information, and source evidence/);
  assert.match(markup, /Outputs, approvals, generation jobs, and review assignments/);
  assert.match(markup, /context-change-preview/);
  assert.match(markup, /Apply copy/);
  assert.doesNotMatch(markup, /type="checkbox"/);
  await f.host._applyCopy();
  const applied = f.store.documentCopyReview(target), copy = f.state.projection.documents.find(item => item.id === applied.receipt.documentId);
  assert.equal(f.seenCopyCount(), 1); assert.equal(applied.phase, "applied");
  assert.equal(copy.title, "Café 企画 copy"); assert.notEqual(copy.id, target.documentId);
  const copied = foldEvents(f.canonical, Infinity, copy.id, target.projectId);
  assert.equal(copied.blocks.length, 3); assert.equal(copied.blockRelations.length, 1); assert.equal(copied.artifacts.length, 0);
  assert.equal(copied.blocks.find(block => block.type === "reference").locked, true);
  assert.deepEqual(copied.blocks.find(block => block.type === "reference").properties,
    original.libraryBlocks.find(block => block.type === "reference").properties);
  assert.equal(copied.blockRelations[0].kind, "action_participant");
  assert.equal(copied.blocks.find(block => block.type === "action").properties.source_block_id, "message-a");
  assert.equal(copied.membership[copy.id].collectionId, "folder-a");
  const source = foldEvents(f.canonical, Infinity, target.documentId, target.projectId);
  assert.deepEqual(source.blocks, original.libraryBlocks.filter(block => block.documentId === target.documentId));
  assert.match(flatten(f.host._copyDialog()), new RegExp(copy.id));
  await f.openCopy();
  assert.deepEqual(f.navigation, [copy.id]);
  assert.equal(f.store.documentCopyReview(target).receipt.documentId, copy.id);
  await f.host._beginDuplicate(target.documentId);
  assert.equal(f.requests.at(-1).action, "retrieve"); assert.equal(f.seenCopyCount(), 1);
});

test("explicit root and inherited folder remain distinct through preview recovery", async () => {
  for (const details of [{}, { collectionId: null }, { collectionId: "folder-a" }]) {
    const f = fixture(); await f.host._beginDuplicate(target.documentId);
    f.host._title = "Original requested name"; f.host._copyFolder = !Object.hasOwn(details, "collectionId") ? "source" : details.collectionId === null ? "root" : "folder:" + details.collectionId;
    f.controls.losePreview = true;
    await f.host._createDocument({ preventDefault() {} });
    const sent = f.requests.at(-1), pending = f.store.documentCopyReview(target);
    assert.equal(pending.phase, "uncertain"); assert.ok(pending.intent.operationId);
    f.host._closeNew(); const reopened = f.createHost();
    await reopened._beginDuplicate(target.documentId);
    assert.deepEqual(f.requests.at(-1), sent);
    assert.equal(f.store.documentCopyReview(target).intent.title, "Original requested name");
    assert.equal(Object.hasOwn(f.requests.at(-1), "collectionId"), Object.hasOwn(details, "collectionId"));
    if (Object.hasOwn(details, "collectionId")) assert.equal(f.requests.at(-1).collectionId, details.collectionId);
    assert.equal(f.seenCopyCount(), 0);
  }
});

test("a lost apply response and closed/recreated host retrieve the same copy without a replacement title", async () => {
  const f = fixture(), approved = await f.review({ title: "Exact requested title", collectionId: null });
  f.controls.loseApply = true; await f.host._applyCopy();
  assert.equal(f.seenCopyCount(), 1);
  assert.equal(f.store.documentCopyReview(target).phase, "uncertain");
  f.host._closeNew(); const reopened = f.createHost(); await reopened._beginDuplicate(target.documentId);
  assert.equal(f.requests.at(-1).action, "retrieve");
  assert.equal(f.requests.at(-1).previewId, approved.previewId);
  assert.equal(f.store.documentCopyReview(target).intent.title, "Exact requested title");
  assert.equal(f.store.documentCopyReview(target).receipt.documentId, approved.destinationDocumentId);
  assert.equal(f.seenCopyCount(), 1);
  assert.equal(f.requests.filter(item => item.action === "preview").length, 1);
});

test("closing during Apply neither cancels the save nor navigates when its response arrives", async () => {
  const f = fixture(); await f.review();
  let release; f.controls.applyBarrier = new Promise(resolve => { release = resolve; });
  const applying = f.host._applyCopy();
  assert.equal(f.store.documentCopyReview(target).busy, true);
  f.host._closeNew(); assert.equal(f.host._newDocument, false);
  await f.store.applyDocumentCopy(target, "other-preview", "f".repeat(64));
  release(); await applying;
  assert.equal(f.seenCopyCount(), 1); assert.deepEqual(f.navigation, []);
  assert.equal(f.store.documentCopyReview(target).phase, "applied");
  assert.equal(f.requests.filter(item => item.action === "apply").length, 1);
  assert.ok(!f.requests.some(item => item.action === "dismiss"));
});

test("A's late preview cannot retarget B's dialog; the original recovery handle remains scoped to A", async () => {
  const f = fixture(); await f.host._beginDuplicate(target.documentId); f.host._title = "Copy A";
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  f.controls.beforeResponse = async body => { if (body.action === "preview") { entered(); await gate; } };
  const previewing = f.host._createDocument({ preventDefault() {} }); await ready;
  f.host._closeNew(); await f.host._beginDuplicate("source-b");
  release(); await previewing;
  assert.equal(f.host._duplicateSourceId, "source-b");
  assert.equal(f.store.documentCopyReview(target).intent.title, "Copy A");
  assert.equal(f.store.documentCopyReview({ ...target, documentId: "source-b" }).phase, "draft");
  assert.deepEqual(f.navigation, []);
});

test("applying/uncertain states allow only an exact read until the server proves review or completion", async () => {
  const f = fixture(), approved = await f.review();
  f.controls.applying = true; await f.host._applyCopy();
  assert.equal(f.store.documentCopyReview(target).phase, "applying");
  const before = f.requests.length;
  await f.host._applyCopy(); await f.host._dismissCopy();
  assert.equal(f.requests.length, before);
  await f.host._checkCopy();
  assert.equal(f.requests.at(-1).action, "retrieve");
  f.controls.applying = false; await f.host._checkCopy();
  assert.equal(f.store.documentCopyReview(target).phase, "review");
  assert.equal(f.seenCopyCount(), 0, "Checking a fenced lease never applies it");
  await f.host._applyCopy();
  assert.equal(f.store.documentCopyReview(target).receipt.documentId, approved.destinationDocumentId);
  assert.equal(f.seenCopyCount(), 1);
});

test("read-only recovery and dismissal do not depend on author, provider, or budget eligibility", async () => {
  const f = fixture(); await f.review();
  f.state.session.capabilities = ["project.read"];
  const count = f.requests.length; await f.host._applyCopy(); assert.equal(f.requests.length, count);
  assert.equal(f.store.documentCopyReview(target).stale, true);
  await f.host._checkCopy(); assert.equal(f.requests.at(-1).action, "retrieve");
  await f.host._dismissCopy(); assert.equal(f.requests.at(-1).action, "dismiss");
  assert.equal(f.store.documentCopyReview(target), null); assert.equal(f.seenCopyCount(), 0);
});

test("local source, folder, rights deadline and authority changes fail closed before Apply", async () => {
  for (const change of [
    f => { f.state.projection.libraryBlocks[0].properties.text = "Changed after review"; },
    f => { f.state.projection.collections[0].handle = "Renamed folder"; },
    f => { f.advance(600_001); },
    f => { f.state.session.capabilities = ["project.read"]; },
    f => { f.state.session.policy.accepted = false; },
    f => { f.state.projectId = "project-other"; f.state.projection.projectId = "project-other"; },
  ]) {
    const f = fixture(); await f.review(); const count = f.requests.length;
    change(f); await f.host._applyCopy();
    assert.equal(f.requests.length, count); assert.equal(f.seenCopyCount(), 0);
  }
});

test("actor/permission changes during response reading never publish or open the old result", async () => {
  for (const mutate of [
    f => { f.state.session.user.userId = "account-b"; },
    f => { f.state.session.permissionEpoch = "epoch-new"; },
    f => { f.state.session.capabilities = []; },
  ]) {
    const f = fixture(); await f.review();
    f.controls.beforeResponse = () => mutate(f);
    await f.host._applyCopy(); f.host.updated();
    assert.equal(f.store.documentCopyReview(target), null);
    assert.deepEqual(f.navigation, []);
    assert.ok(!flatten(f.host._copyDialog()).includes("Protected exact evidence"));
  }
});

test("an applied receipt survives private preview erasure and failed event refresh", async () => {
  const f = fixture(); await f.review(); f.controls.refreshFail = true;
  await f.host._applyCopy();
  let review = f.store.documentCopyReview(target);
  assert.equal(review.phase, "applied"); assert.equal(review.issue, "document_copy_refresh_failed");
  assert.ok(!flatten(f.host._copyDialog()).includes("Open copied document"));
  f.controls.refreshFail = false; f.controls.erased = true; await f.host._checkCopy();
  review = f.store.documentCopyReview(target);
  assert.equal(review.phase, "applied"); assert.equal(review.preview, null);
  assert.equal(review.sourceRevision, ""); assert.ok(review.destinationDocumentId);
  assert.match(flatten(f.host._copyDialog()), /Open copied document/);
  assert.equal(f.seenCopyCount(), 1);
});

test("a fresh client resumes the retained server title, folder, operation and erased receipt", async () => {
  const f = fixture(), approved = await f.review({ title: "Saved server intent", collectionId: null });
  f.store.documentCopyReviews.set({}); await f.host._beginDuplicate(target.documentId);
  assert.equal(f.requests.at(-1).action, "resume");
  assert.equal(f.store.documentCopyReview(target).intent.title, "Saved server intent");
  assert.equal(f.store.documentCopyReview(target).intent.collectionId, null);
  assert.equal(f.store.documentCopyReview(target).intent.operationId, approved.intent.operationId);
  await f.host._applyCopy(); f.controls.erased = true; f.store.documentCopyReviews.set({});
  await f.host._beginDuplicate(target.documentId);
  const recovered = f.store.documentCopyReview(target);
  assert.equal(recovered.phase, "applied"); assert.equal(recovered.preview, null);
  assert.equal(recovered.receipt.documentId, approved.destinationDocumentId);
  assert.equal(recovered.approvalHash, approved.approvalHash);
  await f.host._dismissCopy(); assert.equal(f.store.documentCopyReview(target), null);
  assert.equal(f.seenCopyCount(), 1);
});

test("invalid preview and receipt identities never enable a guessed destination or a new operation", async () => {
  for (const mutation of [
    body => { body.preview.projectId = "foreign"; },
    body => { body.preview.duplication.title = "Changed title"; },
    body => { body.preview.duplication.collectionMode = "explicit"; body.preview.duplication.collectionId = null; },
    body => { body.preview.events[0].payload.document_id = "source-a"; },
    body => { body.preview.events.push({ type: "DocumentRemoved", payload: {} }); },
  ]) {
    const f = fixture(); const state = await f.review(), body = structuredClone({ status: "not-applied", preview: state.preview });
    mutation(body); f.controls.response = () => new Response(JSON.stringify(body));
    await f.host._checkCopy();
    assert.equal(f.store.documentCopyReview(target).phase, "uncertain");
    assert.equal(f.store.documentCopyReview(target).intent.operationId, state.intent.operationId);
    assert.equal(f.seenCopyCount(), 0);
  }
  const f = fixture(), approved = await f.review();
  f.controls.response = () => new Response(JSON.stringify({ status: "applied", previewId: approved.previewId,
    approvalHash: approved.approvalHash, operationId: approved.intent.operationId, documentId: "wrong-document" }));
  await f.host._applyCopy();
  assert.equal(f.store.documentCopyReview(target).phase, "uncertain");
  assert.deepEqual(f.navigation, []);
  assert.ok(!flatten(f.host._copyDialog()).includes('href=/document/wrong-document'));
});

test("permission denial clears private preview material while retaining the exact read identity", async () => {
  const f = fixture(), approved = await f.review();
  f.controls.response = () => new Response("not json", { status: 403 });
  await f.host._applyCopy();
  const retained = f.store.documentCopyReview(target);
  assert.equal(retained.preview, null); assert.equal(retained.sourceRevision, "");
  assert.equal(retained.previewId, approved.previewId); assert.equal(retained.destinationDocumentId, approved.destinationDocumentId);
  assert.ok(!flatten(f.host._copyDialog()).includes("Protected exact evidence"));
  assert.equal(f.seenCopyCount(), 0);
});

test("dismissal does not claim to stop a concurrently applying copy; Done allows a new explicit intent", async () => {
  const f = fixture(); await f.review(); f.controls.applying = true;
  await f.host._dismissCopy();
  assert.equal(f.store.documentCopyReview(target).phase, "applying"); assert.equal(f.host._newDocument, true);
  f.controls.applying = false; await f.host._checkCopy(); await f.host._applyCopy();
  const oldOperation = f.store.documentCopyReview(target).intent.operationId;
  await f.host._dismissCopy(); assert.equal(f.host._newDocument, false);
  await f.host._beginDuplicate(target.documentId);
  f.host._title = "Another explicit copy"; await f.host._createDocument({ preventDefault() {} });
  assert.notEqual(f.store.documentCopyReview(target).intent.operationId, oldOperation);
  assert.equal(f.seenCopyCount(), 1, "A new free preview still needs its own human Apply");
});

test("shared session expiry is checked locally without changing frozen null/omitted intent", async () => {
  const f = fixture();
  f.state.session.projectContext = { projectId: "project-a", projectAccessId: "access-a", organizationId: "org-a",
    ownerUserId: "owner-a", role: "editor", permissions: ["project.read", "project.author"],
    expiresAt: new Date(f.now() + 5_000).toISOString() };
  await f.review({ collectionId: null }); const before = f.requests.length;
  f.advance(5_001); await f.host._applyCopy();
  assert.equal(f.requests.length, before); assert.equal(f.store.documentCopyReview(target), null);
  assert.equal(f.seenCopyCount(), 0);
});

test("title normalization is Unicode-aware, and invalid details cannot create an intent", async () => {
  const f = fixture(); await f.host._beginDuplicate(target.documentId);
  for (const title of ["", "🧭".repeat(81), "Hidden\u0000name"]) {
    f.host._title = title; await f.host._createDocument({ preventDefault() {} });
    assert.equal(f.requests.length, 1);
  }
  f.host._title = "🧭".repeat(80); await f.host._createDocument({ preventDefault() {} });
  assert.equal(f.store.documentCopyReview(target).intent.title, "🧭".repeat(80));
  assert.throws(() => documentCopyIntent(target, { title: "Name", collectionId: undefined }, "valid-operation-0001"));
});


test("the existing card slot offers reader-only recovery without any new-copy fields or execution", async () => {
  const f = fixture();
  f.state.session.capabilities = ["project.read"];
  const card = flatten(f.host.render()).match(/document-duplicate-trigger[^>]*>[\s\S]*?<\/button>/u)?.[0];
  assert.ok(card); assert.match(card, /Check this copy · free/);
  assert.doesNotMatch(card, />Duplicate</u);
  await f.host._beginDuplicate(target.documentId);
  assert.deepEqual(f.requests.map(item => item.action), ["resume"]);
  assert.equal(f.store.documentCopyReview(target).intent, null);
  const empty = flatten(f.host._copyDialog());
  assert.match(empty, /No saved copy review is available for this document/);
  assert.doesNotMatch(empty, /<input|<select|Review copy · free|Apply copy/u);
  f.host._title = "Attempted new copy";
  await f.host._createDocument({ preventDefault() {} }); await f.host._applyCopy();
  await f.store.previewDocumentCopy(target, { title: "Forced new copy" });
  assert.deepEqual(f.requests.map(item => item.action), ["resume"]);
  assert.equal(f.reviews.size, 0); assert.equal(f.seenCopyCount(), 0);

  const saved = fixture(), approved = await saved.review({ title: "Exact saved name", collectionId: null });
  await saved.host._applyCopy(); saved.host._closeNew();
  saved.store.documentCopyReviews.set({}); saved.state.session.capabilities = ["project.read"];
  const reader = saved.createHost(); await reader._beginDuplicate(target.documentId);
  assert.equal(saved.requests.at(-1).action, "resume");
  const restored = saved.store.documentCopyReview(target);
  assert.equal(restored.receipt.documentId, approved.destinationDocumentId);
  assert.equal(restored.intent.title, "Exact saved name");
  assert.match(flatten(reader._copyDialog()), /Open copied document/u);
  assert.doesNotMatch(flatten(reader._copyDialog()), /<input|<select|Review copy · free|Apply copy/u);
  const before = saved.requests.length; await reader._applyCopy();
  assert.equal(saved.requests.length, before);
  await reader._dismissCopy();
  assert.equal(saved.requests.at(-1).previewId, approved.previewId); assert.equal(saved.seenCopyCount(), 1);
});

test("renderer extraction preserves the old context review and source code has no copy event transport", () => {
  const context = readFileSync(new URL("../src/components/context-intelligence.ts", import.meta.url), "utf8");
  assert.match(context, /#changesView\(\)\{\s*return this\.#changes\?renderAuthoringPreview/);
  assert.match(context, /status:this\.#saveApplied\?"applied":this\.#savePending\?"applying":"review"/);
  const copyBranch = between(hostSource, "    if(this.#duplicateSourceId){", "    const documentId=crypto.randomUUID()");
  assert.match(copyBranch, /previewDocumentCopy/); assert.doesNotMatch(copyBranch, /append|buildDocumentDuplicationPlan|rebase|queue/);
  assert.match(storeMethods, /\/api\/documents\/duplicate/);
  assert.doesNotMatch(storeMethods, /appendBatch|canvasOfflineQueue|localStorage|sessionStorage|setInterval|provider/);
  assert.match(storeSource, /this\.documentCopyReviews\.set\(\{\}\);this\.#documentCopyRequest\+=1/);
});

test("the real copy dialog and shared renderer expose translated labels in all four supported languages", async () => {
  const previousElement = globalThis.HTMLElement, previousRegistry = globalThis.customElements;
  globalThis.HTMLElement ??= class {};
  globalThis.customElements ??= { get: () => true, define() {} };
  try {
    const { FORMA_DEFAULT_MESSAGES } = await import("../src/components/design-system/localization.ts");
    const catalogs = [FORMA_DEFAULT_MESSAGES];
    for (const locale of ["fr", "ar", "ja"])
      catalogs.push((await import("../src/components/design-system/locales/" + locale + ".ts")).default);
    const distinct = new Set();
    for (const messages of catalogs) {
      const f = fixture();
      f.host.i18n.t = (key, fallback = key, values = {}) => Object.entries(values).reduce(
        (text, [name, value]) => text.replaceAll("{" + name + "}", String(value)), messages[key] ?? fallback);
      await f.review();
      const markup = flatten(f.host._copyDialog());
      for (const key of ["document.copy.title", "document.copy.preserved", "document.copy.excluded", "document.copy.apply", "context.changes.title"])
        assert.ok(messages[key] && markup.includes(messages[key]), key);
      distinct.add(messages["document.copy.title"]);
      assert.match(markup, /aria-labelledby="new-document-title"/);
      assert.match(markup, /dir="auto"/);
      f.host.updated(); assert.equal(f.dialog.open, true);
      f.state.session.capabilities = ["project.read"];
      const readOnly = flatten(f.host._copyDialog());
      for (const key of ["document.copy.reviewTitle", "document.copy.readOnly"])
        assert.ok(messages[key] && readOnly.includes(messages[key]), key);
      assert.doesNotMatch(readOnly, /<input|<select/u);
      f.store.documentCopyReviews.set({}); f.reviews.clear();
      await f.host._beginDuplicate(target.documentId);
      assert.ok(flatten(f.host._copyDialog()).includes(messages["document.copy.none"]));
      f.host._closeNew(); f.state.session.capabilities = ["project.read", "project.author"];
      await fillCopyReviewCapacity(f);
      assert.ok(flatten(f.host._copyDialog()).includes(messages["document.copy.capacity"].replace("{limit}", f.host.i18n.number(32))));
      assert.doesNotMatch(flatten(f.host._copyDialog()), /<input|<select/u);
    }
    assert.equal(distinct.size, 4);
  } finally {
    if (previousElement === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previousElement;
    if (previousRegistry === undefined) delete globalThis.customElements; else globalThis.customElements = previousRegistry;
  }
});


test("the real UI/store consumes the actual atomic API and recovers its lost save receipt through real SQLite", async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = () => { networkCalls++; throw new Error("No external transport is allowed in this copy test"); };
  const backendLoader = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(context.parentURL?.startsWith(root) && !context.parentURL.includes("/node_modules/") &&
      specifier.startsWith(".") && !/\.[a-z0-9]+$/iu.test(specifier) ? specifier + ".ts" : specifier, context);
  } });
  try {
    const [{ default: worker }, { handleDocumentDuplication }, runtime, { DatabaseSync }] = await Promise.all([
      import("../worker/index.ts"), import("../worker/document-duplication-api.ts"),
      import("../worker/runtime.ts"), import("node:sqlite"),
    ]).finally(() => backendLoader.deregister());
    // Reuse the real R1+R2 SQLite fixture, not a second implementation of the server.
    const backendSource = readFileSync(new URL("./document-duplication-api.test.mjs", import.meta.url), "utf8");
    const start = backendSource.indexOf("const json ="), end = backendSource.indexOf("const operation =", start);
    assert.ok(start >= 0 && end > start, "Atomic backend fixture boundary changed");
    const ports = { assert, DatabaseSync, worker, handleDocumentDuplication, runtime, enforceD1ExpressionDepth };
    const backend = Function(...Object.keys(ports), backendSource.slice(start, end) +
      "\nreturn { fixture, scope };")(...Object.values(ports));
    for (const mode of ["personal", "shared", "editor"]) {
      const server = await backend.fixture({ mode, count: 100, rich: true, relations: 290 });
      try {
        const target = backend.scope;
        const readCanonical = async (documentId = target.documentId) =>
          foldEvents(await runtime.readEvents(server.env, server.stream), Infinity, documentId, target.projectId);
        const before = await runtime.readEvents(server.env, server.stream);
        const f = fixture({ target, now: Date.now(), projection: await readCanonical() });
        f.state.session = await (await server.request("/api/session", { headers: server.headers })).json();
        let loseApply = true;
        f.store.guardedFetch = async (url, init) => {
          assert.equal(url, "/api/documents/duplicate");
          const body = JSON.parse(init.body); f.requests.push(body);
          const response = await server.copy(body);
          if (body.action === "apply" && loseApply && response.ok) { loseApply = false; throw new Error("lost actual API response"); }
          return response;
        };
        f.store.refreshEvents = async () => { f.state.projection = await readCanonical(); };
        await f.host._beginDuplicate(target.documentId);
        f.host._title = "Exact API copy · " + mode;
        f.host._copyFolder = mode === "personal" ? "root" : "source";
        await f.host._createDocument({ preventDefault() {} });
        const approved = f.store.documentCopyReview(target);
        assert.equal(approved.phase, "review", JSON.stringify({ mode, phase: approved.phase, issue: approved.issue }));
        assert.equal(approved.stale, false);
        assert.equal(approved.preview.blockCount, 100);
        assert.equal(approved.preview.events.length, mode === "personal" ? 511 : 512);
        assert.equal((await runtime.readEvents(server.env, server.stream)).length, before.length);
        const originalIntent = structuredClone(approved.intent);
        await f.host._applyCopy();
        assert.equal(f.store.documentCopyReview(target).phase, "uncertain");
        const laterReply = await server.copy({ action: "preview", operationId: crypto.randomUUID(), title: "Later separately requested review" });
        assert.equal(laterReply.status, 200);
        const laterPreview = (await laterReply.json()).preview;
        assert.notEqual(laterPreview.previewId, approved.previewId);
        f.host._closeNew();
        const reopened = f.createHost(); await reopened._beginDuplicate(target.documentId);
        const result = f.store.documentCopyReview(target);
        assert.equal(f.requests.at(-1).action, "retrieve");
        assert.equal(f.requests.at(-1).previewId, approved.previewId, "A later preview never replaces an already chosen receipt");
        assert.equal(result.phase, "applied");
        assert.deepEqual(result.intent, originalIntent);
        assert.equal(result.receipt.documentId, approved.destinationDocumentId);
        assert.equal(server.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits WHERE operation='document-duplicate'").get().n, 1);
        assert.equal((await runtime.readEvents(server.env, server.stream)).length - before.length, approved.preview.events.length);
        assert.equal(f.requests.filter(item => item.action === "preview").length, 1);
        assert.equal(f.requests.filter(item => item.action === "apply").length, 1);
        assert.deepEqual(f.navigation, []);
        assert.match(flatten(reopened._copyDialog()), new RegExp(approved.destinationDocumentId));
        reopened._closeNew();
        const compact = f.store.documentCopyReview(target);
        assert.equal(compact.preview, null); assert.equal(compact.intent, null); assert.equal(compact.sourceRevision, "");
        await reopened._beginDuplicate(target.documentId);
        assert.equal(f.requests.at(-1).action, "retrieve");
        assert.equal(f.requests.at(-1).previewId, approved.previewId, "Compaction retains the chosen receipt despite the newer preview");
        assert.deepEqual(f.store.documentCopyReview(target).intent, originalIntent);
        const copied = await readCanonical(result.receipt.documentId);
        assert.equal(copied.blocks.length, 100); assert.equal(copied.blockRelations.length, 290);
        assert.ok(copied.blocks.every(block => block.locked)); assert.equal(copied.artifacts.length, 0);
        assert.equal(copied.membership[result.receipt.documentId]?.collectionId ?? null, mode === "personal" ? null : "duplicate-folder");
        server.sqlite.prepare("UPDATE private_content SET content='',redacted_at=datetime('now') WHERE content_id=?").run(approved.previewId);
        await reopened._checkCopy();
        const erased = f.store.documentCopyReview(target);
        assert.equal(erased.phase, "applied"); assert.equal(erased.preview, null);
        assert.equal(erased.receipt.documentId, approved.destinationDocumentId);
        await reopened._dismissCopy();
        assert.equal(f.store.documentCopyReview(target), null);
        assert.equal(server.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits WHERE operation='document-duplicate'").get().n, 1);
        if (mode === "editor") {
          server.sqlite.prepare("UPDATE project_memberships SET role='viewer' WHERE user_id='assistant-viewer'").run();
          server.sqlite.prepare("UPDATE capability_grants SET status='revoked',revoked_at=? WHERE user_id='assistant-viewer' AND capability!='project.read'").run(new Date().toISOString());
          server.env.FORMA_USER_COST_LIMIT_USD = "0"; server.env.FORMA_USER_TOKEN_LIMIT = "0";
          f.state.session = await (await server.request("/api/session", { headers: server.headers })).json();
          f.store.documentCopyReviews.set({});
          const reader = f.createHost(); await reader._beginDuplicate(target.documentId);
          assert.equal(f.requests.at(-1).action, "resume");
          assert.equal(f.store.documentCopyReview(target).previewId, laterPreview.previewId);
          assert.equal(f.store.documentCopyAccess(target).canAuthor, false);
          assert.doesNotMatch(flatten(reader._copyDialog()), /<input|<select|Review copy · free|Apply copy/u);
          const beforeReadOnly = f.requests.length;
          reader._title = "Do not create this";
          await reader._createDocument({ preventDefault() {} }); await reader._applyCopy();
          await f.store.previewDocumentCopy(target, { title: "Do not create this either" });
          assert.equal(f.requests.length, beforeReadOnly);
          await reader._dismissCopy();
          assert.equal(f.requests.at(-1).previewId, laterPreview.previewId);
          await reader._beginDuplicate(target.documentId);
          assert.match(flatten(reader._copyDialog()), /No saved copy review is available for this document/u);
          assert.doesNotMatch(flatten(reader._copyDialog()), /<input|<select|Review copy · free|Apply copy/u);
          assert.equal(server.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits WHERE operation='document-duplicate'").get().n, 1);
          assert.equal(server.sqlite.prepare("SELECT COUNT(*) AS n FROM cost_budget_reservations").get().n, 0);
          assert.equal(server.sqlite.prepare("SELECT COUNT(*) AS n FROM document_jobs").get().n, 0);
        }
      } finally { await server.close(); }
    }
    assert.equal(networkCalls, 0);
  } finally {
    backendLoader.deregister();
    globalThis.fetch = originalFetch;
  }
});


function copyCapacitySources(f, count = 33) {
  const targets = Array.from({ length: count }, (_, index) => ({
    projectId: target.projectId, documentId: "capacity-source-" + (index + 1),
  }));
  for (const selected of targets) f.canonical.push(event(f.canonical.length + 1, "DocumentCreated", {
    project_id: selected.projectId, document_id: selected.documentId, title: selected.documentId, handle: selected.documentId,
  }));
  f.state.projection = f.readProjection();
  return targets;
}
async function capacityPreview(f, selected) {
  await f.host._beginDuplicate(selected.documentId); f.host._title = "Copy " + selected.documentId;
  await f.host._createDocument({ preventDefault() {} });
  return f.store.documentCopyReview(selected);
}
async function fillCopyReviewCapacity(f) {
  const targets = copyCapacitySources(f);
  for (const selected of targets.slice(0,32)) {
    assert.equal((await capacityPreview(f, selected)).phase, "review");
    f.host._closeNew();
  }
  await f.host._beginDuplicate(targets[32].documentId);
  return targets;
}
function copyDialogEvent(template, name) {
  function find(value) {
    if (Array.isArray(value)) return value.map(find).find(Boolean);
    if (!value?.strings) return null;
    const index = value.strings.findIndex(part => part.endsWith("@" + name + "="));
    if (index >= 0 && typeof value.values[index] === "function") return value.values[index];
    return value.values.map(find).find(Boolean);
  }
  const handler = find(template);
  assert.equal(typeof handler, "function", "Actual dialog listener missing: " + name);
  return handler;
}

test("completed copy history does not exhaust the active-review capacity", async () => {
  const f = fixture(), targets = copyCapacitySources(f), receipts = [];
  for (const selected of targets.slice(0,32)) {
    await capacityPreview(f, selected); await f.host._applyCopy();
    const completed = f.store.documentCopyReview(selected), calls = f.requests.length;
    assert.equal(completed.phase, "applied"); assert.equal(completed.busy, false);
    receipts.push({ previewId: completed.previewId, approvalHash: completed.approvalHash,
      operationId: completed.receipt.operationId, documentId: completed.destinationDocumentId, request: completed.request });
    f.host._closeNew();
    const compact = f.store.documentCopyReview(selected);
    assert.equal(compact.preview, null); assert.equal(compact.sourceTitle, "");
    assert.equal(compact.sourceRevision, ""); assert.equal(compact.intent, null);
    assert.equal(f.host._title, ""); assert.equal(f.requests.length, calls, "Close must not dismiss a durable receipt");
  }
  const before = f.requests.length;
  await f.host._beginDuplicate(targets[32].documentId);
  assert.equal(f.store.documentCopyReview(targets[32])?.phase, "draft");
  assert.equal(f.requests.length - before, 1); assert.equal(f.requests.at(-1).action, "resume");
  assert.equal(f.store.documentCopyReview(targets[32]).intent, null);
  assert.equal(f.seenCopyCount(), 32);
  assert.equal(Object.keys(f.store.documentCopyReviews.get()).length, 33, "Compact exact identities remain available");
  targets.slice(0,32).forEach((selected, index) => {
    const state = f.store.documentCopyReview(selected);
    assert.deepEqual({ previewId: state.previewId, approvalHash: state.approvalHash,
      operationId: state.receipt.operationId, documentId: state.destinationDocumentId, request: state.request }, receipts[index]);
  });
});

test("all 32 live reviews retain exact state and report capacity without a new request, operation or payload", async () => {
  const f = fixture(), targets = copyCapacitySources(f), releases = [], pending = [];
  try {
    for (const [index, selected] of targets.slice(0,32).entries()) {
      if (index === 0) f.controls.losePreview = true;
      const reviewed = await capacityPreview(f, selected);
      if (index === 0) assert.equal(reviewed.phase, "uncertain");
      else {
        assert.equal(reviewed.phase, "review");
        if (index === 1) { f.controls.loseApply = true; await f.host._applyCopy(); }
        if (index === 2) { f.controls.applying = true; await f.host._applyCopy(); f.controls.applying = false; }
        if (index === 3) {
          let release; const gate = new Promise(resolve => { release = resolve; });
          releases.push(release); f.controls.applyBarrier = gate;
          pending.push(f.host._applyCopy()); f.controls.applyBarrier = null;
          assert.equal(f.store.documentCopyReview(selected).busy, true);
        }
        if (index === 4) {
          let release, entered;
          const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
          const refresh = f.store.refreshEvents;
          releases.push(release);
          f.store.refreshEvents = async () => { entered(); await gate; f.state.projection = f.readProjection(); };
          pending.push(f.host._applyCopy()); await ready; f.store.refreshEvents = refresh;
          assert.equal(f.store.documentCopyReview(selected).phase, "applied");
          assert.equal(f.store.documentCopyReview(selected).busy, true, "The canonical refresh still owns its payload");
        }
      }
      const beforeClose = f.store.documentCopyReviews.get()[documentCopyKey(selected)];
      f.host._closeNew();
      assert.equal(f.store.documentCopyReviews.get()[documentCopyKey(selected)], beforeClose);
    }
    const cache = f.store.documentCopyReviews.get(), before = f.requests.length;
    assert.equal(Object.keys(cache).length, 32);
    assert.equal(Object.values(cache).filter(state => state.phase === "uncertain").length, 2);
    assert.equal(Object.values(cache).filter(state => state.phase === "review").length, 27);
    await f.host._beginDuplicate(targets[32].documentId);
    assert.equal(f.store.documentCopyReview(targets[32]), null);
    assert.equal(f.store.documentCopyAccess(targets[32]).issue, "document_copy_capacity");
    assert.equal(f.store.documentCopyReviews.get(), cache);
    assert.equal(f.requests.length, before); assert.equal(f.host._title, "");
    const dialog = flatten(f.host._copyDialog());
    assert.match(dialog, /32-review limit has been reached/u);
    assert.match(dialog, /check a saved copy review or discard an unsubmitted preview/u);
    assert.doesNotMatch(dialog, /<input|<select|Check this copy · free|Review copy · free|Apply copy/u);
    await f.host._checkCopy(); await f.store.previewDocumentCopy(targets[32], { title: "Must not create an intent" });
    assert.equal(f.requests.length, before); assert.equal(f.store.documentCopyReviews.get(), cache);
    releases.splice(0).forEach(release => release()); await Promise.all(pending);
    assert.equal(f.host._duplicateSourceId, targets[32].documentId);
    await f.host._checkCopy();
    assert.equal(f.store.documentCopyReview(targets[32]).phase, "draft");
    assert.equal(f.store.documentCopyReview(targets[32]).intent, null);
    assert.equal(f.requests.at(-1).action, "resume");
  } finally { releases.forEach(release => release()); await Promise.all(pending); }
});

test("compaction keeps the chosen receipt under a newer other-tab preview and never switches to latest", async () => {
  const f = fixture(), approved = await f.review({ title: "Original exact copied title", collectionId: null });
  await f.host._applyCopy(); f.host._closeNew();
  const later = await (await f.store.guardedFetch("/api/documents/duplicate", {
    method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "preview", ...target, operationId: "other-tab-operation-0001", title: "Another explicit preview" }),
  })).json();
  assert.notEqual(later.preview.previewId, approved.previewId);
  const reopened = f.createHost(); await reopened._beginDuplicate(target.documentId);
  assert.equal(f.requests.at(-1).action, "retrieve");
  assert.equal(f.requests.at(-1).previewId, approved.previewId);
  assert.equal(f.store.documentCopyReview(target).intent.title, "Original exact copied title");
  assert.equal(f.store.documentCopyReview(target).receipt.documentId, approved.destinationDocumentId);
  reopened._closeNew(); f.controls.erased = true;
  await reopened._beginDuplicate(target.documentId);
  const erased = f.store.documentCopyReview(target);
  assert.equal(erased.intent, null); assert.equal(erased.preview, null);
  assert.equal(erased.receipt.documentId, approved.destinationDocumentId);
  assert.equal(f.requests.at(-1).previewId, approved.previewId); assert.equal(f.seenCopyCount(), 1);
});

test("Close does not compact a receipt owned by an in-flight refresh or alter a newer modal", async () => {
  const f = fixture(); await f.review();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  f.store.refreshEvents = async () => { entered(); await gate; f.state.projection = f.readProjection(); };
  const saving = f.host._applyCopy(); await ready;
  const owned = f.store.documentCopyReviews.get()[documentCopyKey(target)];
  assert.equal(owned.phase, "applied"); assert.equal(owned.busy, true); assert.ok(owned.receipt && owned.preview && owned.intent);
  f.host._closeNew();
  assert.equal(f.store.documentCopyReviews.get()[documentCopyKey(target)], owned);
  await f.host._beginDuplicate("source-b");
  const newer = f.store.documentCopyReviews.get()[documentCopyKey({ ...target, documentId: "source-b" })];
  release(); await saving;
  assert.equal(f.host._duplicateSourceId, "source-b"); assert.deepEqual(f.navigation, []);
  f.store.closeDocumentCopyDraft(target);
  assert.equal(f.store.documentCopyReview(target).preview, null);
  assert.equal(f.store.documentCopyReviews.get()[documentCopyKey({ ...target, documentId: "source-b" })], newer);
});

test("a queued native close from A cannot close the reopened B dialog", async () => {
  const f = fixture(), queued = [];
  await f.host._beginDuplicate("source-a"); f.host.updated();
  let listener = copyDialogEvent(f.host._copyDialog(), "close");
  f.dialog.close = function() {
    const wasOpen = this.open; this.open = false;
    if (wasOpen) queued.push(() => listener({ currentTarget: this }));
  };
  f.host._closeNew();
  await f.host._beginDuplicate("source-b"); f.host._title = "B remains under review";
  await f.host._createDocument({ preventDefault() {} }); f.host.updated();
  listener = copyDialogEvent(f.host._copyDialog(), "close");
  const reviewed = f.store.documentCopyReview({ ...target, documentId: "source-b" });
  assert.equal(f.dialog.open, true); assert.equal(queued.length, 1);
  queued.shift()();
  assert.equal(f.host._duplicateSourceId, "source-b"); assert.equal(f.host._newDocument, true);
  assert.equal(f.store.documentCopyReview({ ...target, documentId: "source-b" }).previewId, reviewed.previewId);
});

test("captured native Close ownership survives copy and blank dialog replacement before reopening", async () => {
  for (const kind of ["copy", "blank"]) {
    const f = fixture();
    if (kind === "copy") await f.host._beginDuplicate("source-a");
    else { f.host._beginNew(); await f.host.updateComplete; }
    f.host.updated();
    const oldClose = copyDialogEvent(kind === "copy" ? f.host._copyDialog() : f.host.render(), "close");
    f.host._closeNew();
    const opening = f.host._beginDuplicate("source-b");
    assert.equal(f.dialog.open, false);
    oldClose({ currentTarget: f.dialog });
    assert.equal(f.host._newDocument, true); assert.equal(f.host._duplicateSourceId, "source-b");
    await opening;
    const request = f.host._newDocumentRequest;
    f.host._nativeNewDocumentClose({ currentTarget: { open: false } }, request);
    assert.equal(f.host._newDocument, true, "An old detached native element is not the current dialog");
  }
});

test("deferred Close focus does not outlive its actor, project, permissions or host", async () => {
  for (const change of [
    f => { f.state.session.user.userId = "another-account"; },
    f => { f.state.session.permissionEpoch = "changed-epoch"; },
    f => { f.state.session.capabilities = []; },
    f => { f.state.session.policy.accepted = false; },
    f => { f.state.projectId = "another-project"; f.state.projection.projectId = "another-project"; },
    f => { f.host.isConnected = false; },
  ]) {
    const f = fixture(); await f.host._beginDuplicate("source-a");
    let release; const gate = new Promise(resolve => { release = resolve; });
    Object.defineProperty(f.host, "updateComplete", { get: () => gate });
    f.focus.length = 0; f.host._closeNew(); change(f);
    release(); await gate; await Promise.resolve();
    assert.equal(f.focus.length, 0);
  }
});

test("only the newest opening or Close may perform deferred focus", async () => {
  const f = fixture(); await f.host._beginDuplicate("source-a");
  const originalOpener = f.host._copyReturnFocus, newerOpener = new originalOpener.constructor();
  let release; const gate = new Promise(resolve => { release = resolve; });
  Object.defineProperty(f.host, "updateComplete", { get: () => gate });
  f.focus.length = 0; f.host._closeNew();
  f.document.activeElement = newerOpener;
  const opening = f.host._beginDuplicate("source-b"); f.host._closeNew();
  release(); await opening; await gate; await Promise.resolve();
  assert.deepEqual(f.focus, [newerOpener]);

  const blank = fixture();
  let releaseBlank; const pending = new Promise(resolve => { releaseBlank = resolve; });
  Object.defineProperty(blank.host, "updateComplete", { get: () => pending });
  blank.host._beginNew(); const copy = blank.host._beginDuplicate("source-b");
  releaseBlank(); await copy; await Promise.resolve();
  assert.equal(blank.focus.length, 1, "An older blank-dialog input must not steal focus from the current copy heading");
});

test("genuine current native Close and Cancel preserve drafts and exact pending reviews", async () => {
  for (const kind of ["blank", "draft", "review"]) {
    const f = fixture();
    if (kind === "blank") { f.host._beginNew(); await f.host.updateComplete; }
    else if (kind === "review") await f.review();
    else await f.host._beginDuplicate(target.documentId);
    f.host.updated();
    const before = kind === "review" ? f.store.documentCopyReview(target) : null, requests = f.requests.length;
    const template = kind === "blank" ? f.host.render() : f.host._copyDialog();
    let prevented = false;
    copyDialogEvent(template, "cancel")({ currentTarget: f.dialog, preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(f.host._newDocument, false); assert.equal(f.dialog.open, false);
    assert.equal(f.host._title, ""); assert.equal(f.requests.length, requests);
    if (before) assert.deepEqual(f.store.documentCopyReview(target), before);
    else assert.equal(f.store.documentCopyReview(target), null);
  }
  const applied = fixture(); await applied.review(); await applied.host._applyCopy(); applied.host.updated();
  const close = copyDialogEvent(applied.host._copyDialog(), "close"), identity = applied.store.documentCopyReview(target).receipt;
  applied.dialog.close(); close({ currentTarget: applied.dialog });
  assert.equal(applied.host._newDocument, false);
  assert.deepEqual(applied.store.documentCopyReview(target).receipt, identity);
  assert.equal(applied.store.documentCopyReview(target).preview, null);
});

test("late Done from an earlier opening cannot close a newer review of the same source", async () => {
  const f = fixture(); await f.review();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), ready = new Promise(resolve => { entered = resolve; });
  f.controls.beforeResponse = async body => { if (body.action === "dismiss") { entered(); await gate; } };
  const dismissing = f.host._dismissCopy(); await ready;
  f.host._closeNew(); await f.host._beginDuplicate(target.documentId);
  release(); await dismissing;
  assert.equal(f.host._newDocument, true);
  assert.equal(f.host._duplicateSourceId, target.documentId);
  assert.equal(f.seenCopyCount(), 0);
});
test("late Open completion cannot close a newer review of the same source", async t => {
  const f = await copyNavigationFixture(t); await f.review(); await f.host._applyCopy();
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.store.openDocument = async id => { await gate; f.navigation.push(id); return true; };
  const opening = f.openCopy();
  f.host._closeNew(); await f.host._beginDuplicate(target.documentId);
  release(); await opening;
  assert.equal(f.host._newDocument, true);
  assert.equal(f.host._duplicateSourceId, target.documentId);
  assert.equal(f.navigation.length, 1); assert.equal(f.seenCopyCount(), 1);
});

test("Close focus belongs to the opening authority even when it changes before Close", async () => {
  for (const change of [
    f => { f.state.session.user.userId = "new-actor-before-close"; },
    f => { f.state.session.permissionEpoch = "new-authority-before-close"; },
  ]) {
    const f = fixture(); await f.host._beginDuplicate(target.documentId);
    f.focus.length = 0; change(f);
    f.host._closeNew(); await f.host.updateComplete; await Promise.resolve();
    assert.equal(f.focus.length, 0);
  }
});

test("main169 project attention survives the complete copy recovery with exact scoped history", async () => {
  const f = fixture();
  const context = { contextId: "context-a", projectId: "project-a", organizationId: "org-a", projectAccessId: "access-a", role: "editor",
    permissions: ["project.read", "project.author", "project.output.request", "project.review.approve"], expiresAt: new Date(f.now() + 120_000).toISOString() };
  f.state.session.projectContext = context;
  const grant = { organizationId: context.organizationId, projectAccessId: context.projectAccessId, projectId: context.projectId };
  const review = { id: "review-current", ...grant, documentId: "source-a", artifactId: "original-output", artifactTitle: "Exact assigned review", documentTitle: "Original", status: "pending" };
  f.state.reviewInbox = [review, { ...review, id: "foreign-review", projectId: "foreign-project", documentId: "foreign-document" },
    { ...review, id: "wrong-access", projectAccessId: "other-access" }, { ...review, id: "approved-review", status: "approved" }];
  const notice = { id: "unread-source", documentId: "source-a", artifactId: "original-output", readAt: null, kind: "output_ready" };
  f.state.projectNotifications = [notice, { ...notice, id: "whole-project", documentId: null, artifactId: null },
    { ...notice, id: "review-request", kind: "review_requested" }, { ...notice, id: "review-due", kind: "review_due" },
    { ...notice, id: "foreign-notice", documentId: "foreign-document" }, { ...notice, id: "orphan-artifact", artifactId: "missing-artifact" },
    { ...notice, id: "already-read", readAt: "2026-08-27T15:30:00.000Z" }];
  const failed = { jobId: "failed-slides", documentId: "source-a", kind: "render_document", status: "failed", dismissedAt: null,
    notifiedAt: "2026-08-27T15:30:00.000Z", result: { generationReceipt: { actual_provider_call_count: 2 } } };
  f.state.documentJobs = [failed, { ...failed, jobId: "partial-second", documentId: "source-b", status: "partial" },
    { ...failed, jobId: "foreign-failure", documentId: "foreign-document" }, { ...failed, jobId: "dismissed-failure", dismissedAt: "2026-08-27T15:31:00.000Z" },
    { ...failed, jobId: "completed-output", status: "completed" }, { ...failed, jobId: "approved-plan", planningExecutionId: "approved-plan", kind: "structure_adaptive", status: "canceled" }];
  const history = structuredClone(f.state.documentJobs), count = (host = f.host) => {
    const markup = flatten(host.render()), summary = markup.slice(markup.indexOf('class="project-overview-summary"'));
    assert.match(summary, /<b>6<\/b><span>Needs you<\/span>/, "one review, two distinct unread notices and three exact failed/canceled jobs");
    assert.match(markup, /Exact assigned review/);
    assert.doesNotMatch(markup, /foreign-review|foreign-failure|wrong-access/);
  };
  count(); const approved = await f.review({ title: "Copy while preserving project history" }); count();
  f.controls.loseApply = true; await f.host._applyCopy();
  assert.equal(f.store.documentCopyReview(f.target).phase, "uncertain"); count();
  f.host._closeNew(); const recovered = f.createHost(); await recovered._beginDuplicate(f.target.documentId);
  const saved = f.store.documentCopyReview(f.target);
  assert.equal(saved.phase, "applied"); assert.equal(saved.previewId, approved.previewId); assert.equal(f.seenCopyCount(), 1);
  count(recovered); assert.deepEqual(f.state.documentJobs, history, "copy recovery neither dismisses nor rewrites source job history");
  assert.equal(failed.result.generationReceipt.actual_provider_call_count, 2, "two paid replies still describe one failed job");
  assert.deepEqual(f.requests.map(request => request.action), ["resume", "preview", "apply", "retrieve"]);
});
