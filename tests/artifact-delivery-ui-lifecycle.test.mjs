import assert from "node:assert/strict";
import { installSourceOwnershipPort } from "./helpers/source-ownership-port.mjs";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { webcrypto } from "node:crypto";
import { foldEvents } from "../src/model/events.ts";
import { documentArtifactRevision, parseDocumentArtifactContent } from "../src/model/document-artifacts.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { nextActionFacts } from "../src/state/next-action-context.ts";
import { creativeActionSourceRevision } from "../src/model/workspace-intelligence.ts";
import { artifactFocusRoute, artifactFocusOptionsFromRoute, libraryFocusFromRoute, libraryRootRoute, libraryBlockEditorFromRoute } from "../src/model/routes.ts";

// Executes actual parsed component methods and the actual viewer @close expression.
// Application, cryptographic scheduling, native dialog event timing, and focus are
// deterministic in-memory ports. No provider/network or native-browser certificate.
const root = new URL("../", import.meta.url);
const sourceTree = relative => {
  const source = fs.readFileSync(new URL(relative, root), "utf8");
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
};
const classTree = relative => {
  const tree = sourceTree(relative);
  return { tree, host: tree.statements.find(ts.isClassDeclaration) };
};
const documentTree = classTree("src/components/document-artifacts.ts");
const libraryTree = classTree("src/components/forma-library.ts");
const canvasTree = classTree("src/canvas/canvas-application.ts");
const member = (parsed, name) => parsed.host.members.find(value => value.name?.getText(parsed.tree) === name);
const membersCode = (parsed, names) => names.flatMap(name => {
  const value = member(parsed, name);
  return value ? [value.getText(parsed.tree)] : [];
}).join("\n");
const fieldsCode = (parsed, code, declared = []) => {
  const names = [...new Set([...code.matchAll(/#([A-Za-z][A-Za-z0-9_]*)/g)].map(match => "#" + match[1]))];
  return names.filter(name => !declared.includes(name)).map(name => {
    const value = member(parsed, name);
    assert.ok(value && ts.isPropertyDeclaration(value), "actual field " + name);
    return value.getText(parsed.tree);
  }).join("\n");
};
const closeExpression = (() => {
  const viewer = member(documentTree, "#viewer");
  let expression;
  const visit = node => {
    if (ts.isTemplateExpression(node)) {
      let preceding = node.head.text;
      for (const span of node.templateSpans) {
        if (preceding.endsWith("@close=")) expression = span.expression.getText(documentTree.tree);
        preceding = span.literal.text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(viewer); assert.ok(expression, "actual viewer native-close binding");
  return expression;
})();
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const event = (sequence, type, payload, actor = "user:owner") => ({
  eventId: "event-" + sequence, streamId: "creative:owner", sequence, type, payload, actor,
  occurredAt: "2026-08-27T00:00:00Z", recordedAt: "2026-08-27T00:00:00Z", clientId: "fixture",
  correlationId: "fixture", causationId: null, compensatesEventId: null, schemaVersion: 1,
});
const digest = async content => webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
const hash = async content => Array.from(new Uint8Array(await digest(content)), byte => byte.toString(16).padStart(2, "0")).join("");
const cell = value => ({ get: () => value, set: next => { value = next; } });
const settle = async () => { await new Promise(setImmediate); };

function fixture({ kind = "short_story" } = {}) {
  const state = { authority: "scope-A", readable: true, documentId: "A", route: "/library", events: [], content: {}, requests: [], closeQueue: [], digestGate: null, saveGate: null, beforeUpdate: null };
  const trace = [];
  const append = (type, payload) => { const row = event(state.events.length + 1, type, payload); state.events.push(row); return row; };
  append("ProjectCreated", { project_id: "project", name: "Exact delivery lifecycle" });
  for (const id of ["A", "B"]) {
    append("DocumentCreated", { project_id: "project", document_id: id, title: "Document " + id });
    append("BlockCreated", { project_id: "project", document_id: id, block_id: "direction-" + id, type: "direction", handle: "direction/" + id, position: "a", properties: { text: "Exact source " + id, weight: 1, intent: "include" } });
    state.content["content-" + id] = JSON.stringify({ content_markdown: "Authored output " + id, title: "Output " + id, items: [] });
    append("DocumentRenderCompleted", { project_id: "project", document_id: id, artifact_id: "artifact-" + id, artifact_kind: kind, title: "Output " + id, content_ref: "content-" + id, item_count: 0, items: [], requested_by_user_id: "owner" });
  }
  const projection = () => foldEvents(state.events, Infinity, state.documentId, "project");
  const artifact = id => projection().libraryArtifacts.find(value => value.id === "artifact-" + id);
  const commit = (id, markdown, extra = {}) => {
    const target = projection().libraryArtifacts.find(value => value.id === id);
    state.content[target.contentRef] = JSON.stringify({ content_markdown: markdown, title: target.title, items: [] });
    append("DocumentArtifactEdited", { project_id: "project", document_id: target.documentId, artifact_id: id, content_ref: target.contentRef, revision: documentArtifactRevision(state.events, id) + 1, ...extra });
  };
  const store = {
    ui: { instrumentation: false, libraryView: "outputs" },
    session: { get: () => ({ user: { userId: "owner" }, capabilities: state.readable ? ["project.read", "project.author", "project.output.request"] : [] }) },
    captureAuthorizationScope: () => state.readable ? { key: state.authority, shared: false } : null,
    authorizationScopeActive: scope => state.readable && scope?.key === state.authority,
    projection: { get: projection }, events: { get: () => state.events }, eventView: { get: () => state.events }, content: { get: () => state.content }, asOf: cell(Infinity),
    canvasProjection: cell({ selectedCanvasId: "", canvases: [] }), projectNotifications: cell([]), reviewInbox: cell([]), documentJobs: cell([]), loading: cell(false),
    route: { get: () => state.route }, setRoute: value => { state.route = value; }, patchUi: value => Object.assign(store.ui, value),
    toast: value => trace.push(["toast", value]),
    ensurePrivateContent: async id => { state.requests.push(["content", id]); },
    reviseDocumentArtifact: async (id, input) => { state.requests.push(["save", id, structuredClone(input)]); if (state.saveGate) await state.saveGate.promise; commit(id, input.markdown); return true; },
    restoreDocumentArtifact: async (id, revision, expectedRevision) => { state.requests.push(["restore", id, revision, expectedRevision]); commit(id, "Restored " + id, { restored_from_revision: revision }); return true; },
  };
  installSourceOwnershipPort(store);
  class HTMLElement {
    constructor(name) { this.name = name; this.isConnected = true; }
    focus() { document.activeElement = this; trace.push(["focus", this.name]); }
  }
  const opener = new HTMLElement("initial-opener");
  const document = { activeElement: opener };
  const focusTargets = new Map();
  const dialog = {
    open: false, listeners: new Map(), isConnected: true,
    setAttribute() {},
    addEventListener(type, callback, options) { this.listeners.set(callback, { type, once: Boolean(options?.once) }); },
    removeEventListener(_type, callback) { this.listeners.delete(callback); },
    close() {
      if (!this.open) return;
      this.open = false; trace.push(["close", "viewer"]);
      state.closeQueue.push(() => {
        const event = { target: this, currentTarget: this };
        host.nativeCloseForTest(event);
        for (const [callback, options] of [...this.listeners]) if (options.type === "close") { if (options.once) this.listeners.delete(callback); callback(event); }
      });
    },
    querySelector(selector) {
      if (!focusTargets.has(selector)) focusTargets.set(selector, { disabled: false, open: false, focus() { trace.push(["focus", selector]); }, click() { trace.push(["click", selector]); }, querySelector() { return this; } });
      return focusTargets.get(selector);
    },
    classList: { contains: value => value === "document-artifact-view" },
  };
  const ensureModalDialog = target => { target.open = true; trace.push(["modal", "viewer"]); return true; };
  const crypto = { subtle: { digest: (...args) => state.digestGate ? state.digestGate.promise : webcrypto.subtle.digest(...args) } };
  const names = ["#privateSourceCurrent", "openArtifactById", "#openArtifact", "#artifactBinding", "#currentDeliveryBinding", "#refreshDeliveryBinding", "#showArtifactIntent", "#clearPrivateGenerationInputs", "#clearSceneCost", "#closeViewerPopovers", "#clearCreationDraft", "#startArtifactEdit", "#cancelArtifactEdit", "#saveArtifactEdit", "#restoreRevision", "#closeArtifactViewer", "#setViewerFocus", "#cancelViewer", "updated"];
  const code = membersCode(documentTree, names);
  const declared = [...names, "#targetDocumentId", "#revealWorkbenchPane", "#viewDialog", "#createDialog", "#content", "#loadHistory", "#bindCompletedWorkflowStage"];
  const fields = fieldsCode(documentTree, code + "\n" + closeExpression, declared);
  const probeSource = [
    "(class {", fields,
    'store=store;documentId="A";source="library";isConnected=true;i18n={t:(_id,fallback)=>fallback??_id};',
    "get updateComplete(){return Promise.resolve().then(()=>state.beforeUpdate?.());}requestUpdate(){}",
    "querySelector(){return null;}",
    'querySelectorAll(selector){if(selector!=="forma-ui-popover")throw new Error("Unexpected viewer DOM selector: "+selector);return[];}',
    'dispatchEvent(event){trace.push(["event",event.type]);return true;}',
    "#targetDocumentId(){return this.documentId;}",
    'async #revealWorkbenchPane(){trace.push(["reveal",this.documentId]);}',
    "#viewDialog(){return dialog;}", "#createDialog(){return null;}",
    "#content(artifact){return parseDocumentArtifactContent(store.content.get()[artifact.contentRef]);}",
    'async #loadHistory(artifact){trace.push(["history",artifact.id]);}',
    "#bindCompletedWorkflowStage(){}",
    "nativeCloseForTest(event){return (" + closeExpression + ")(event);}",
    "refreshForTest(artifact){return this.#refreshDeliveryBinding(artifact);}",
    "bindingForTest(artifact){return this.#currentDeliveryBinding(artifact);}",
    "clearAuthorizationForTest(){this.#clearPrivateGenerationInputs();}",
    "startEditForTest(artifact){this.#startArtifactEdit(artifact);}",
    "draftForTest(value){this.#editMarkdown=value;}",
    "reviewForTest(value){this.#reviewNote=value;this.#reviewPanelOpen=true;}",
    "saveForTest(artifact){return this.#saveArtifactEdit(artifact);}",
    "restoreForTest(artifact,revision){return this.#restoreRevision(artifact,revision);}",
    "intentForTest(artifact,intent){return this.#showArtifactIntent(artifact,intent);}",
    "currentForTest(){return this.#viewerCurrent?.()??false;}",
    "snapshotForTest(){return{activeId:this.#activeId,editingId:this.#editingId,draft:this.#editMarkdown,reviewNote:this.#reviewNote,reviewOpen:this.#reviewPanelOpen,binding:this.#deliveryBinding,bindingLoading:this.#deliveryBindingLoading};}",
    code, "})",
  ].join("\n");
  const Probe = new Function("store", "state", "dialog", "trace", "document", "HTMLElement", "crypto", "ensureModalDialog", "documentArtifactRevision", "parseDocumentArtifactContent", "artifactDeliveryFor", "nextActionFacts", "fetch",
    "return " + ts.transpileModule(probeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)(
      store, state, dialog, trace, document, HTMLElement, crypto, ensureModalDialog, documentArtifactRevision, parseDocumentArtifactContent, artifactDeliveryFor, nextActionFacts,
      async () => assert.fail("No network or provider operation is authorized by the fixture"),
    );
  const host = new Probe();
  const f = { state, store, host, dialog, document, opener, trace, artifact, commit, HTMLElement, append };
  f.flushClose = () => { while (state.closeQueue.length) state.closeQueue.shift()(); };
  f.library = () => {
    const names = ["updated", "#focusAvailable"];
    const code = membersCode(libraryTree, names);
    const fields = fieldsCode(libraryTree, code, names);
    const librarySource = [
      "(class {", fields, "store=store;isConnected=true;",
      "get updateComplete(){return Promise.resolve();}requestUpdate(){}",
      'querySelector(selector){return selector==="forma-document-artifacts"?{openArtifactById:(id,options)=>{const pending=viewer.openArtifactById(id,options);state.libraryOpen=pending;return pending;}}:null;}',
      "querySelectorAll(){return[];}", code, "})",
    ].join("\n");
    const Library = new Function("store", "viewer", "state", "trace", "libraryBlockEditorFromRoute", "libraryFocusFromRoute", "libraryRootRoute", "artifactFocusOptionsFromRoute", "ensureModalDialog", "CSS",
      "return " + ts.transpileModule(librarySource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)(
        store, host, state, trace, libraryBlockEditorFromRoute, libraryFocusFromRoute, libraryRootRoute, artifactFocusOptionsFromRoute, ensureModalDialog, { escape: String },
      );
    return new Library();
  };
  f.canvas = () => {
    f.host.source = "canvas";
    f.store.canvasProjection.set({ selectedCanvasId: "board-a", canvases: [{ id: "board-a", projectId: "project" }, { id: "board-b", projectId: "project" }] });
    const code = membersCode(canvasTree, ["#openArtifactDelivery"]);
    const canvasSource = ["(class {", "store=store;i18n={t:(_id,fallback)=>fallback};get updateComplete(){return Promise.resolve();}",
      '#closeCanvasArtifact(){trace.push(["close","canvas-preview"]);}', "querySelector(){return viewer;}",
      "openForTest(artifact){return this.#openArtifactDelivery(artifact);}", code, "})"].join("\n");
    const Canvas = new Function("store", "viewer", "trace", "nextActionFacts", "creativeActionSourceRevision", "documentArtifactRevision", "artifactDeliveryFor",
      "return " + ts.transpileModule(canvasSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)(
        store, host, trace, nextActionFacts, creativeActionSourceRevision, documentArtifactRevision, artifactDeliveryFor,
      );
    return new Canvas();
  };
  return f;
}

test("a queued native close cannot erase a newer viewer draft or steal its focus", async () => {
  const f = fixture(), target = f.artifact("A");
  assert.equal(await f.host.openArtifactById(target.id), true);
  f.dialog.close();
  const currentOpener = new f.HTMLElement("current-opener"); f.document.activeElement = currentOpener;
  assert.equal(await f.host.openArtifactById(target.id), true);
  f.host.startEditForTest(target); f.host.draftForTest("Keep the new unfinished manuscript.\n".repeat(50)); f.host.reviewForTest("Keep the new review note.");
  const expected = f.host.snapshotForTest(); f.trace.length = 0;
  f.flushClose();
  assert.equal(f.host.snapshotForTest().activeId, expected.activeId);
  assert.equal(f.host.snapshotForTest().draft, expected.draft);
  assert.equal(f.host.snapshotForTest().reviewNote, expected.reviewNote);
  assert.equal(f.dialog.open, true);
  assert.deepEqual(f.trace, [], "an obsolete close has no focus or parent-routing ownership");
  f.dialog.close(); f.flushClose();
  assert.equal(f.host.snapshotForTest().activeId, "");
  assert.equal(f.trace.filter(value => value[0] === "event" && value[1] === "document-artifact-close").length, 1);
  assert.equal(f.trace.filter(value => value[0] === "focus" && value[1] === "current-opener").length, 1);
});

test("a delivery digest that settled just before authorization withdrawal cannot repopulate the private cache", async () => {
  const f = fixture(), target = f.artifact("A");
  assert.equal(await f.host.openArtifactById(target.id), true);
  f.commit(target.id, "Fresh saved output for actor A");
  const pendingDigest = deferred(); f.state.digestGate = pendingDigest;
  const pending = f.host.refreshForTest(f.artifact("A"));
  pendingDigest.resolve(await digest(f.state.content[target.contentRef]));
  await pendingDigest.promise;
  f.state.authority = "scope-B"; f.host.clearAuthorizationForTest();
  await pending;
  assert.equal(f.host.bindingForTest(f.artifact("A")), null);
  assert.equal(f.host.snapshotForTest().binding, null, "the old actor's bytes remain scrubbed after its completed hash continuation");
  assert.equal(f.state.requests.length, 0);
});

test("Library exact-opening ownership ends when its route changes during the digest", async () => {
  const f = fixture(), target = f.artifact("A"), expectedHash = await hash(f.state.content[target.contentRef]);
  const library = f.library(), pendingDigest = deferred(); f.state.digestGate = pendingDigest;
  f.state.route = artifactFocusRoute(target.id, target.title, { expectedRevision: 0, expectedContentSha256: expectedHash, intent: "review" }, "/library");
  library.updated(); await settle();
  f.state.route = "/library"; library.updated();
  pendingDigest.resolve(await digest(f.state.content[target.contentRef]));
  assert.equal(await f.state.libraryOpen, false);
  assert.equal(f.dialog.open, false);
  assert.equal(f.trace.some(value => value[0] === "modal"), false);
  assert.equal(f.state.requests.length, 0);
});

test("Library keeps an exact route editable after its own Save and Restore", async () => {
  const f = fixture(), original = f.artifact("A"), initialHash = await hash(f.state.content[original.contentRef]), library = f.library();
  f.state.route = artifactFocusRoute(original.id, original.title, { expectedRevision: 0, expectedContentSha256: initialHash, intent: "review" }, "/library");
  library.updated();
  assert.equal(await f.state.libraryOpen, true);
  f.host.startEditForTest(original);
  const draft = "Fully retained authorized finished-output correction.\n".repeat(80);
  f.host.draftForTest(draft);
  await f.host.saveForTest(original);
  assert.equal(documentArtifactRevision(f.state.events, original.id), 1);
  assert.equal(f.dialog.open, true);
  assert.equal(f.host.currentForTest(), true);
  assert.equal(f.host.bindingForTest(f.artifact("A")), null, "the former hash is not reused for the revised bytes");
  await f.host.refreshForTest(f.artifact("A"));
  assert.equal(f.host.bindingForTest(f.artifact("A")).contentSha256, await hash(f.state.content[original.contentRef]));
  await f.host.restoreForTest(f.artifact("A"), 0);
  assert.equal(documentArtifactRevision(f.state.events, original.id), 2);
  assert.equal(f.dialog.open, true);
  assert.equal(f.host.currentForTest(), true);
  await f.host.refreshForTest(f.artifact("A"));
  assert.equal(f.host.bindingForTest(f.artifact("A")).revision, 2);
  assert.deepEqual(f.state.requests.map(value => value[0]), ["save", "restore"]);
  assert.equal(f.state.requests[0][1], original.id);
  assert.equal(f.state.requests[0][2].expectedRevision, 0);
  assert.equal(f.state.requests[0][2].markdown, draft);
  assert.deepEqual(f.state.requests[1], ["restore", original.id, 0, 1]);
  f.dialog.close(); f.flushClose();
  assert.equal(await f.host.openArtifactById(original.id, { expectedRevision: 0, expectedContentSha256: initialHash }), false);
  assert.equal(await f.host.openArtifactById(original.id, { expectedRevision: 2, expectedContentSha256: await hash(f.state.content[original.contentRef]) }), true);
});

for (const boundary of ["authority", "missing", "revision", "bytes", "caller", "close"]) test("a settled old digest cannot become current after the " + boundary + " boundary", async () => {
  const f = fixture(), original = f.artifact("A");
  let owned = true;
  assert.equal(await f.host.openArtifactById(original.id, { current: () => owned }), true);
  f.commit(original.id, "New revision pending exact binding");
  const retained = f.state.content[original.contentRef], gate = deferred();
  f.state.digestGate = gate;
  const pending = f.host.refreshForTest(f.artifact("A"));
  gate.resolve(await digest(retained)); await gate.promise;
  if (boundary === "authority") f.state.authority = "scope-B";
  else if (boundary === "missing") f.state.events = f.state.events.filter(row => row.type !== "DocumentRenderCompleted" || row.payload.artifact_id !== original.id);
  else if (boundary === "revision") f.commit(original.id, "Another authorized revision");
  else if (boundary === "bytes") f.state.content[original.contentRef] = retained + " ";
  else if (boundary === "caller") owned = false;
  else { f.dialog.close(); f.flushClose(); }
  await pending;
  assert.equal(f.host.bindingForTest(original), null);
  assert.notEqual(f.host.snapshotForTest().binding?.content, retained);
  assert.equal(f.state.requests.length, 0);
});

test("the current binding becomes unusable synchronously when read authority is lost, even before its notification", async () => {
  const f = fixture(), target = f.artifact("A");
  assert.equal(await f.host.openArtifactById(target.id), true);
  assert.ok(f.host.bindingForTest(target));
  f.state.readable = false;
  assert.equal(f.host.bindingForTest(target), null);
  assert.equal(f.host.currentForTest(), false);
  f.host.updated(); f.flushClose();
  assert.equal(f.dialog.open, false);
  assert.equal(f.host.snapshotForTest().activeId, "");
  assert.equal(f.trace.some(value => value[0] === "event" && value[1] === "document-artifact-close"), false, "lost authority cannot route or focus an obsolete owner");
});

test("an older refresh cannot clear the loading ownership of a newer exact viewer", async () => {
  const f = fixture(), original = f.artifact("A");
  assert.equal(await f.host.openArtifactById(original.id), true);
  f.commit(original.id, "Revision one");
  const firstBytes = f.state.content[original.contentRef], first = deferred(); f.state.digestGate = first;
  const older = f.host.refreshForTest(f.artifact("A"));
  f.state.digestGate = null;
  assert.equal(await f.host.openArtifactById(original.id, { expectedRevision: 1 }), true);
  f.commit(original.id, "Revision two");
  const second = deferred(); f.state.digestGate = second;
  const newer = f.host.refreshForTest(f.artifact("A")), ownership = f.host.snapshotForTest().bindingLoading;
  assert.ok(ownership);
  first.resolve(await digest(firstBytes)); await older;
  assert.equal(f.host.snapshotForTest().bindingLoading, ownership);
  second.resolve(await digest(f.state.content[original.contentRef])); await newer;
  assert.equal(f.host.snapshotForTest().bindingLoading, null);
  assert.equal(f.host.bindingForTest(f.artifact("A")).revision, 2);
  assert.equal(f.host.bindingForTest(f.artifact("A")).contentSha256, await hash(f.state.content[original.contentRef]));
  f.flushClose();
  assert.equal(f.dialog.open, true);
  assert.equal(f.host.snapshotForTest().activeId, original.id);
});

test("a close event from a detached old dialog has no ownership of the current viewer", async () => {
  const f = fixture(), target = f.artifact("A");
  assert.equal(await f.host.openArtifactById(target.id), true);
  f.host.startEditForTest(target); f.host.draftForTest("Do not replace this draft.");
  const expected = f.host.snapshotForTest(), old = { open: false };
  f.host.nativeCloseForTest({ target: old, currentTarget: old });
  assert.equal(f.host.snapshotForTest().activeId, expected.activeId);
  assert.equal(f.host.snapshotForTest().draft, expected.draft);
  assert.equal(f.dialog.open, true);
});

for (const boundary of ["route", "disconnect"]) test("Library ownership remains required after opening: " + boundary, async () => {
  const f = fixture(), target = f.artifact("A"), library = f.library();
  f.state.route = artifactFocusRoute(target.id, target.title, { expectedRevision: 0, intent: "inspect" }, "/library");
  library.updated(); assert.equal(await f.state.libraryOpen, true);
  if (boundary === "route") { f.state.route = "/library"; library.updated(); }
  else library.isConnected = false;
  assert.equal(f.host.currentForTest(), false);
  f.trace.length = 0; f.host.updated(); f.flushClose();
  assert.equal(f.dialog.open, false);
  assert.equal(f.trace.some(value => value[0] === "focus" || value[0] === "click" || value[0] === "event"), false);
});

test("same artifact route replacements retain the new expected revision and never open the old pending target", async () => {
  const f = fixture(), original = f.artifact("A"), library = f.library(), old = deferred();
  const oldBytes = f.state.content[original.contentRef];
  f.state.digestGate = old;
  f.state.route = artifactFocusRoute(original.id, original.title, { expectedRevision: 0, expectedContentSha256: await hash(oldBytes), intent: "review" }, "/library");
  library.updated(); const first = f.state.libraryOpen; await settle();
  f.commit(original.id, "New exact current bytes");
  f.state.digestGate = null;
  f.state.route = artifactFocusRoute(original.id, original.title, { expectedRevision: 1, expectedContentSha256: await hash(f.state.content[original.contentRef]), intent: "review" }, "/library");
  library.updated();
  assert.equal(await f.state.libraryOpen, true);
  old.resolve(await digest(oldBytes));
  assert.equal(await first, false);
  assert.equal(f.dialog.open, true);
  assert.equal(f.host.bindingForTest(f.artifact("A")).revision, 1);
  assert.equal(f.trace.filter(value => value[0] === "modal").length, 1);
  assert.equal(f.state.requests.length, 0);
});

for (const boundary of ["reopen", "authority", "editing"]) test("a pending delivery intent cannot act after the " + boundary + " boundary", async () => {
  const f = fixture({ kind: "slides" }), target = f.artifact("A");
  assert.equal(await f.host.openArtifactById(target.id), true);
  const gate = deferred(); f.state.beforeUpdate = () => gate.promise;
  const pending = f.host.intentForTest(target, "export"); await settle();
  f.state.beforeUpdate = null;
  if (boundary === "authority") { f.state.authority = "scope-B"; f.host.clearAuthorizationForTest(); }
  if (boundary !== "editing") assert.equal(await f.host.openArtifactById(target.id, { intent: "inspect" }), true);
  else { f.host.startEditForTest(target); f.host.draftForTest("Unsubmitted output changes must not be exported."); }
  f.trace.length = 0; gate.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(f.trace, [], "the earlier intent cannot focus or activate a current export control");
  assert.equal(f.state.requests.length, 0);
});

test("the owned current export intent still reaches the existing export menu without adding a purchase", async () => {
  const f = fixture({ kind: "slides" }), target = f.artifact("A");
  assert.equal(await f.host.openArtifactById(target.id), true);
  f.trace.length = 0;
  assert.equal(await f.host.intentForTest(target, "export"), true);
  assert.deepEqual(f.trace, [["focus", ".presentation-deck-export"], ["click", ".presentation-deck-export"]]);
  assert.equal(f.state.requests.length, 0);
});

for (const boundary of ["board", "source", "rights", "authority", "revision", "bytes"]) test("the actual Canvas handoff refuses " + boundary + " drift while the shared viewer hashes", async () => {
  const f = fixture(), target = f.artifact("A"), canvas = f.canvas(), gate = deferred(), retained = f.state.content[target.contentRef];
  f.state.digestGate = gate;
  const pending = canvas.openForTest(target); await settle();
  if (boundary === "board") f.store.canvasProjection.set({ ...f.store.canvasProjection.get(), selectedCanvasId: "board-b" });
  else if (boundary === "source" || boundary === "rights") f.append("BlockPropertyEdited", { project_id: "project", document_id: "A", block_id: "direction-A", property_path: boundary === "rights" ? "rights_revoked" : "text", new_value: boundary === "rights" ? true : "Changed source after opening began" });
  else if (boundary === "authority") f.state.authority = "scope-B";
  else if (boundary === "revision") f.commit(target.id, "A later saved output");
  else f.state.content[target.contentRef] = retained + " ";
  gate.resolve(await digest(retained));
  assert.equal(await pending, false);
  assert.equal(f.dialog.open, false);
  assert.equal(f.trace.some(value => value[0] === "modal" || value[0] === "click"), false);
  assert.equal(f.state.requests.length, 0);
});

test("the actual Canvas-to-viewer handoff permits authored editing but not a later board substitution", async () => {
  const f = fixture(), original = f.artifact("A"), canvas = f.canvas();
  assert.equal(await canvas.openForTest(original), true);
  f.host.startEditForTest(original); f.host.draftForTest("My exact authored Canvas correction.");
  await f.host.saveForTest(original);
  await f.host.refreshForTest(f.artifact("A"));
  assert.equal(f.host.currentForTest(), true);
  assert.equal(f.host.bindingForTest(f.artifact("A")).revision, 1);
  f.append("BlockPropertyEdited", { project_id: "project", document_id: "A", block_id: "direction-A", property_path: "text", new_value: "Legitimate subsequent source editing" });
  assert.equal(f.host.currentForTest(), true, "source editing is allowed after the exact viewer has opened");
  f.store.canvasProjection.set({ ...f.store.canvasProjection.get(), selectedCanvasId: "board-b" });
  f.trace.length = 0;
  assert.equal(f.host.currentForTest(), false);
  f.host.updated(); f.flushClose();
  assert.equal(f.dialog.open, false);
  assert.equal(f.trace.some(value => value[0] === "focus" || value[0] === "event"), false);
  assert.deepEqual(f.state.requests.map(value => value[0]), ["save"]);
});

test("a native close queued during a replacement hash cannot dismiss that pending exact opening", async () => {
  const f = fixture(), original = f.artifact("A");
  assert.equal(await f.host.openArtifactById(original.id), true);
  const gate = deferred(); f.state.digestGate = gate;
  const opener = new f.HTMLElement("pending-opening-owner"); f.document.activeElement = opener;
  const pending = f.host.openArtifactById(original.id); await settle();
  f.trace.length = 0; f.flushClose();
  assert.deepEqual(f.trace, []);
  gate.resolve(await digest(f.state.content[original.contentRef]));
  assert.equal(await pending, true);
  f.dialog.close(); f.flushClose();
  assert.equal(f.trace.filter(value => value[0] === "focus" && value[1] === "pending-opening-owner").length, 1);
  assert.equal(f.trace.filter(value => value[0] === "event" && value[1] === "document-artifact-close").length, 1);
  assert.equal(f.dialog.listeners.size, 0, "completed native close listeners do not accumulate across reopened sessions");
});

test("an older opening cannot report ownership of the replacement dialog after its pending intent", async () => {
  const f = fixture({ kind: "slides" }), target = f.artifact("A"), gate = deferred(), entered = deferred();
  let updates = 0;
  f.state.beforeUpdate = () => { if (++updates === 3) { entered.resolve(); return gate.promise; } };
  const older = f.host.openArtifactById(target.id, { intent: "export" });
  await entered.promise;
  f.state.beforeUpdate = null;
  assert.equal(await f.host.openArtifactById(target.id, { intent: "inspect" }), true);
  f.trace.length = 0; gate.resolve();
  assert.equal(await older, false, "opening success belongs to the exact viewer transaction, not any currently open dialog");
  assert.deepEqual(f.trace, []);
  assert.equal(f.dialog.open, true);
  assert.equal(f.state.requests.length, 0);
});
