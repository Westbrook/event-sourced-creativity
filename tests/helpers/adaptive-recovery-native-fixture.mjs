import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./scene-cost-store-host.mjs";
import { createCalmFullPage, readAdaptiveProposalEvidence } from "./calm-full-page-fixture.mjs";
import { canvasQueueDatabase } from "./canvas-source-queue-host.mjs";
import { accountCachePort, financial } from "./event-source-retirement-fixture.mjs";
import { withDocumentInRoute } from "../../src/model/routes.ts";
import { canvasViewFromRoute } from "../../src/canvas/routes.ts";

// Shared native regression fixture for the original-source and recovery suites.
// This module registers no tests and adds no production test accessor.
// Complete actual hosts/Store/Worker; deterministic native ports are not a
// browser, CSS, accessibility, production-provider, or payment certificate.
const family = process.env.FORMA_ADAPTIVE_RECOVERY_FAMILY ?? "all";
assert.ok(["preparation", "read", "receipt", "all"].includes(family));
const digest = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
const inFamily = name => family === "all" || family === name;
const API = "/api/context/adaptive/apply";
const evidence = [];
const emit = row => { evidence.push(row); console.log("ADAPTIVE_RECOVERY_OBSERVATION " + JSON.stringify(row)); };

// Observation-only prerequisite diagnostics: whitelist exact identity/authority
// metadata and structural sizes. Never print private prompts, labels, instructions,
// content, full quotes/results, cookies, headers, or session tokens.
const diagnosticFields = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));
const structureMetadata = value => ({
  present: value != null, type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
  keys: value && typeof value === "object" ? Object.keys(value).sort() : [],
  activeDecisionPresent: value?.active_decision != null,
  activeDecisionType: typeof value?.active_decision?.type === "string" ? value.active_decision.type : null,
  suggestedBlocksType: Array.isArray(value?.suggested_blocks) ? "array" : typeof value?.suggested_blocks,
  suggestedBlocksCount: Array.isArray(value?.suggested_blocks) ? value.suggested_blocks.length : null,
  hiddenUntilLaterCount: Array.isArray(value?.hidden_until_later) ? value.hidden_until_later.length : null,
});
const quoteMetadata = value => diagnosticFields(value, [
  "status", "operation", "executionId", "bindingHash", "projectId", "documentId", "canvasId",
]);
const jobMetadata = value => ({
  present: value != null,
  keys: value && typeof value === "object" ? Object.keys(value).sort() : [],
  identity: diagnosticFields(value, ["jobId", "kind", "status", "documentId", "canvasId", "sourceSurface",
    "planningExecutionId", "requestKey", "planningLocale", "planningProjectScope"]),
  resultKeys: value?.result && typeof value.result === "object" ? Object.keys(value.result).sort() : [],
  result: diagnosticFields(value?.result, ["bindingHash", "planningReviewAvailable", "resultUnavailable"]),
  quote: quoteMetadata(value?.result?.quote), structure: structureMetadata(value?.result?.structure),
});

// Reuse every original fixture declaration/import; omit test registrations,
// not application methods or assertions. This is the existing fixture pattern.
async function definitions(file, names) {
  const url = new URL(file, import.meta.url), source = readFileSync(url, "utf8");
  const tree = ts.createSourceFile(url.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const declarations = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
    || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)
    || ts.isExpressionStatement(node) && node.getText(tree) === "hooks.deregister();")
    .map(node => node.getFullText(tree)).join("\n");
  const fixtureUrl = new URL(url); fixtureUrl.search = "?adaptive-recovery-native-fixture";
  const hook = registerHooks({ load(request, context, next) {
    return request === fixtureUrl.href
      ? { format: "module", source: declarations + "\nexport { " + names.join(",") + " };\n", shortCircuit: true }
      : next(request, context);
  } });
  try { return await import(fixtureUrl.href); } finally { hook.deregister(); }
}
const routed = await definitions("../assistant-runtime.test.mjs", [
  "main170Phase8Fixture", "phase8PaidEvidence", "phase8AssertNoPayment", "main170Phase8Ledgers",
]);

const under = (node, predicate) => {
  for (let parent = node; parent; parent = parent.parent) if (predicate(parent)) return true;
  return false;
};
const classHas = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inProposal = node => under(node, parent => parent.tag === "dialog" && classHas(parent, "adaptive-proposal-dialog"));
const visibleText = x => x.f.tree().nodes.filter(node => !node.hiddenBy && inProposal(node))
  .map(node => node.text + " " + String(node.port?.value ?? "")).join(" ");
const currentHost = x => x.f.components().find(component => component.tag === (x.canvas ? "forma-canvas-surface" : "forma-adaptive-path"));
const snapshot = host => {
  assert.ok(host, "the actual complete proposal host exists");
  assert.equal(typeof readAdaptiveProposalEvidence, "function", "test-only actual factory observation is available");
  return readAdaptiveProposalEvidence(host);
};
const copy = (x, key) => currentHost(x).i18n.t(key);
// Observation only. Only static translated control keys and native metadata
// are emitted; the exact original f.find remains the sole control selector.
const observeProposalControl = (x, key) => {
  const host = currentHost(x), state = snapshot(host), tree = x.f.tree();
  const keys = ["action.close", "adaptive.changes.preview", "adaptive.changes.apply",
    "adaptive.changes.retryApply", "adaptive.changes.check", "adaptive.changes.dismiss",
    "adaptive.changes.findReceipts", "adaptive.changes.findDestinationReceipts", "adaptive.changes.retrieveOriginal"];
  const label = copy(x, key), recognized = node => keys.filter(name => node.text === copy(x, name));
  const buttons = tree.nodes.filter(node => node.tag === "button");
  const exact = buttons.filter(node => node.text === label);
  const proposal = buttons.filter(inProposal);
  const metadata = node => ({
    tag: node.tag, ownerTag: node.owner?.tag ?? null, ownerIsCurrentHost: node.owner === host,
    connected: Boolean(node.port?.isConnected && node.owner?.isConnected),
    hiddenBy: node.hiddenBy ?? null, hasPort: Boolean(node.port),
    disabled: Object.hasOwn(node.attributes, "disabled"), staticKeys: recognized(node),
  });
  const dialogs = tree.nodes.filter(node => node.tag === "dialog" && classHas(node, "adaptive-proposal-dialog"));
  const nativeDialogs = x.f.renderer.nodes.filter(node => node.tag === "dialog" && classHas(node, "adaptive-proposal-dialog"));
  const viewports = x.f.renderer.nodes.filter(node => node.owner === host && classHas(node, "canvas-viewport"));
  const finite = value => typeof value === "number" && Number.isFinite(value) ? value : null;
  console.log("ADAPTIVE_RECOVERY_CONTROL_TRACE " + JSON.stringify({
    key: keys.includes(key) ? key : "unlisted-control-key", surface: x.canvas ? "Canvas" : "Document",
    hostTag: host.tag, readonlyState: diagnosticFields(state, ["visible", "busy", "phase", "notice",
      "presentationId", "executionId", "bindingHash", "uncertain", "originalCount", "canEdit", "canPreview",
      "canApply", "outputEditorRequired", "draftCount", "canAuthor", "policyAccepted"]),
    expected: { total: exact.length, inProposal: exact.filter(inProposal).length,
      visibleInProposal: exact.filter(node => inProposal(node) && !node.hiddenBy).length,
      matching: exact.slice(0, 12).map(metadata) },
    proposalControls: { total: proposal.length, visible: proposal.filter(node => !node.hiddenBy).length,
      recognized: proposal.filter(node => recognized(node).length).slice(0, 20).map(metadata) },
    dialogs: dialogs.map(node => ({ ...metadata(node), className: node.attributes.class,
      treeOpen: node.open, portOpen: node.port?.open ?? null, hasOpenAttribute: Object.hasOwn(node.attributes, "open"),
      ownFixtureDataset: Boolean(node.port && Object.hasOwn(node.port, "fixtureDataset")),
      canvasTopLayer: node.port?.fixtureDataset?.canvasTopLayer ?? null,
      nativeIdentityMatches: nativeDialogs.filter(port => port === node.port).length })),
    nativeDialogs: nativeDialogs.map(node => ({ ownerTag: node.owner?.tag ?? null,
      ownerIsCurrentHost: node.owner === host, className: node.attributes.class, open: node.open,
      hasOpenAttribute: Object.hasOwn(node.attributes, "open"), ownFixtureDataset: Object.hasOwn(node, "fixtureDataset"),
      canvasTopLayer: node.fixtureDataset?.canvasTopLayer ?? null })),
    nativeViewports: viewports.map(node => { const box = node.getBoundingClientRect(); return {
      ownerIsCurrentHost: node.owner === host, clientWidthType: typeof node.clientWidth, clientHeightType: typeof node.clientHeight,
      clientWidth: finite(node.clientWidth), clientHeight: finite(node.clientHeight),
      boxWidth: finite(box.width), boxHeight: finite(box.height),
    }; }),
  }));
};
const control = (x, key) => {
  observeProposalControl(x, key);
  return x.f.find("button", node => inProposal(node) && node.text === copy(x, key));
};
const proposalPosts = x => x.h.requests.filter(row => row.url === API);
const applies = x => proposalPosts(x).filter(row => row.body?.action === "apply");
const previews = x => proposalPosts(x).filter(row => row.body?.action === "preview");
const eventRows = x => x.state.sqlite.prepare("SELECT * FROM events ORDER BY stream_id,sequence").all();
const receipts = x => x.state.sqlite.prepare("SELECT * FROM authoring_commits ORDER BY preview_id").all();
const evidenceState = host => {
  const value = snapshot(host);
  return { connected: host.isConnected, visible: value.visible, busy: value.busy, phase: value.phase,
    presentationId: value.presentationId, executionId: value.executionId, bindingHash: value.bindingHash,
    handle: value.handle, previewId: value.preview?.previewId ?? null,
    privatePreviewDigest: value.preview ? digest(value.preview) : null,
    receipt: value.receipt, originals: value.originalCount, notice: value.notice };
};

// Observation only: reuse current public ownership/accessor reads and the
// existing actual response records. No requests, callbacks, awaits or assertions.
const freshReadState = x => {
  const store = x.h.store, host = currentHost(x), value = host ? snapshot(host) : null;
  const source = store.captureSourceOwnership(), authorization = store.captureAuthorizationScope();
  const sourceMetadata = executionId => {
    const current = store.adaptiveProposalSource(x.state.scope.documentId, x.state.scope.canvasId, executionId);
    return { present: current != null,
      ...diagnosticFields(current, ["executionId", "bindingHash", "readable", "withdrawalRevision"]),
      structurePresent: current?.structure != null };
  };
  const projection = store.projection.get(), canvas = store.canvasProjection.get();
  return { host: host ? evidenceState(host) : null, routeSha256: digest(store.route.get()),
    projectId: projection.projectId, documentId: projection.documentId, selectedCanvasId: canvas.selectedCanvasId,
    authorityKeySha256: authorization?.key ? digest(authorization.key) : null,
    originalAuthorityActive: store.authorizationScopeActive(x.originalAuth),
    originalSourceGeneration: x.originalSource?.generation ?? null,
    originalSourceActive: store.sourceOwnershipActive(x.originalSource),
    currentSourceGeneration: source?.generation ?? null, currentSourceActive: store.sourceOwnershipActive(source),
    defaultSource: sourceMetadata(undefined), currentExecutionSource: sourceMetadata(value?.executionId ?? ""),
    savedExecutionSource: sourceMetadata(x.state.paidQuote.executionId),
    originalCount: value?.originalCount ?? null, requestCount: proposalPosts(x).length, responseCount: x.responses.length };
};
const freshReadResponse = row => ({
  request: diagnosticFields(row.request, ["action", "projectId", "documentId", "canvasId",
    "executionId", "bindingHash", "previewId", "approvalHash"]),
  httpStatus: row.status,
  result: diagnosticFields(row.body, ["status", "readOnly", "canApply", "retentionUnavailable", "stale", "dismissed"]),
  errorCode: typeof row.body?.error === "string" && /^[a-z][a-z0-9_:-]{0,100}$/u.test(row.body.error) ? row.body.error : null,
  errorPresent: row.body?.error != null, previewPresent: row.body?.preview != null,
  preview: diagnosticFields(row.body?.preview, ["previewId", "approvalHash", "projectId", "documentId", "canvasId"]),
  original: diagnosticFields(row.body?.preview?.adaptiveReview, ["executionId", "bindingHash", "selectionKey"]),
});

// Activate a currently rendered connected native control, keeping the original
// promise instead of forcing a redraw. No detached/stale callback invocation.
function begin(x, node, eventName = "click") {
  assert.ok(node.port?.isConnected && node.owner?.isConnected && !node.hiddenBy);
  assert.equal(Object.hasOwn(node.attributes, "disabled"), false);
  const current = x.f.tree().visible(node.tag).find(candidate => candidate.port === node.port);
  assert.ok(current && current.handlers[eventName] === node.handlers[eventName], "current exact handler, not a captured obsolete callback");
  const handler = node.handlers[eventName]; assert.equal(typeof handler, "function");
  const pending = handler.call(node.owner, { target: node.port, currentTarget: node.port,
    preventDefault() {}, stopPropagation() {} });
  assert.equal(typeof pending?.then, "function", "prerequisite: current Preview/Check returns its actual original Promise");
  x.pending.add(pending); pending.then(() => x.pending.delete(pending), () => x.pending.delete(pending));
  return pending;
}
async function enteredOrTerminal(entered, pending, label) {
  const result = await Promise.race([entered.then(detail => ({ entered: true, detail })),
    pending.then(() => ({ entered: false }), error => { throw error; })]);
  assert.equal(result.entered, true, label + ": actual entry, not a tick or assumed dispatch");
  return result.detail;
}
async function settle(x) {
  await x.f.settle();
  await untilScene(() => !currentHost(x) || !snapshot(currentHost(x)).busy, "the current original proposal operation terminates");
  await x.f.settle();
}

async function page(t, canvas, locale = "en") {
  const denied = t.mock.method(globalThis, "fetch", async () => assert.fail("No external/provider transport is permitted"));
  accountCachePort(t);
  const accountIndexedDB = globalThis.indexedDB, queue = canvasQueueDatabase();
  globalThis.indexedDB = { open(name, version) {
    return name === "canvas-offline-queue-v1" ? queue.indexedDB.open(name, version) : accountIndexedDB.open(name, version);
  } };
  // ONE existing deterministic in-memory provider response creates the seed.
  // It is reported as fixture setup, never as zero-generation setup evidence.
  const state = await routed.main170Phase8Fixture("shared", canvas);
  assert.equal(state.calls.length, 1, "the existing paid-plan setup responder was invoked once");
  globalThis.fetch = denied;
  const contextRows = state.sqlite.prepare("SELECT context_id FROM project_context_sessions WHERE project_access_id=? AND principal_user_id=? AND revoked_at IS NULL")
    .all(state.projectAccessId, state.owner);
  assert.equal(contextRows.length, 1, "exact actual authorized shared context");
  const contextId = contextRows[0].context_id;
  const worker = { ...state, projectId: state.scope.projectId, documentId: state.scope.documentId,
    streamId: state.stream, events: [], contentRef: "unused-native-port-fallback", content: "",
    requestId: "unused-scene-request-port", payload: { workflowSources: [] }, close() {},
    request(url, init = {}) {
      const headers = new Headers(state.headers); new Headers(init.headers).forEach((value, key) => headers.set(key, value));
      return state.request(url, { ...init, headers });
    } };
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  assert.equal("sceneGateForTest" in h.store, false, "this suite uses the untouched complete Store");
  assert.equal("sceneEstimateForTest" in h.store, false, "no unused private method accessor is installed");
  const original = { session: h.store.session.get(), events: h.store.events.get(), content: h.store.content.get(), head: h.store.head.get() };
  assert.ok(original.events.length > 0, "actual Worker initial event body, not the fallback port");
  assert.ok(original.session.projectContext?.permissions.includes("project.author"));
  if (canvas) assert.equal(original.session.canvas.access, true, "actual RAM Worker Canvas access");
  const historyBefore = globalThis.history, channelBefore = globalThis.BroadcastChannel;
  const onlineBefore = Object.getOwnPropertyDescriptor(globalThis.navigator, "onLine");
  globalThis.BroadcastChannel = undefined;
  Object.defineProperty(globalThis.navigator, "onLine", { configurable: true, value: true });
  globalThis.history = { pushState(_state, _title, route) {
    const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href });
  }, replaceState(...args) { this.pushState(...args); } };
  t.after(() => { globalThis.history = historyBefore; globalThis.BroadcastChannel = channelBefore;
    if (onlineBefore) Object.defineProperty(globalThis.navigator, "onLine", onlineBefore); else delete globalThis.navigator.onLine; });
  const f = await createCalmFullPage(t, { storeHost: h, locale, observeAdaptiveProposals: true });
  if (canvas) {
    // Native geometry access only, after the existing finite rectangle is
    // installed and before the original Canvas updated/RAF/insertion callbacks.
    const collect = f.renderer.collect;
    f.renderer.collect = function (markup, owner) {
      const start = this.nodes.length, result = Reflect.apply(collect, this, [markup, owner]);
      if (owner?.tag === "forma-canvas-surface") for (const node of this.nodes.slice(start)) {
        if (node.owner !== owner || node.tag !== "div" || !classHas(node, "canvas-viewport")) continue;
        const dimension = axis => {
          const value = node.getBoundingClientRect()[axis];
          if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
            throw new Error("The existing native Canvas viewport rectangle must have finite nonnegative dimensions");
          return value;
        };
        Object.defineProperties(node, {
          clientWidth: { configurable: true, get: () => dimension("width") },
          clientHeight: { configurable: true, get: () => dimension("height") },
        });
      }
      return result;
    };
  }
  if (canvas) {
  // The generic native renderer reconstructs element ports each draw. Real
  // ResizeObserver only re-notifies a stable element when its size changes.
  // Keep that browser behavior at the fixture boundary, never in production.
  const resizeSeen=new WeakMap(),targets=f.resizeTargets;
  f.resizeTargets=new class extends Map{
   *[Symbol.iterator](){for(const [observer,node]of super[Symbol.iterator]()){
    if(String(node.attributes?.class??"").split(/\s+/u).includes("canvas-viewport")){
     const key=node.owner??node,parent=resizeSeen.get(key)??new Map(),box=node.getBoundingClientRect(),stamp=box.width+":"+box.height;
     if(parent.get("canvas-viewport")===stamp)continue;parent.set("canvas-viewport",stamp);resizeSeen.set(key,parent);
    }yield [observer,node];
   }}
  }(targets);
  }
  // Documented initial setup only: remove the reused helper's synthetic study
  // seed and reinstall its INITIAL actual Worker response. No post-retirement
  // session/events/source assignment is allowed anywhere in this proof.
  h.store.events.set(original.events); h.store.content.set(original.content); h.store.head.set(original.head); h.store.session.set(original.session);
  h.store.route.set(canvas ? "/canvas/" + state.scope.canvasId + "/actual-proposal?view=list"
    : withDocumentInRoute("/studio/adaptive", state.scope.documentId, h.store.projection.get().documentTitle));
  const dispatch = h.window.dispatchEvent.bind(h.window);
  h.window.dispatchEvent = event => {
    const result = dispatch(event);
    for (const listener of [...(f.listeners.get(event.type) ?? [])]) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
    return result;
  };
  const x = { t, state, worker, h, f, canvas, queue, contextId, pending: new Set(), gates: [], holds: [], responses: [], setupProviderResponses: state.calls.length };
  h.transport = async row => {
    assert.doesNotMatch(row.url, /^\/api\/document-jobs\/[^/]+\/(?:run|dismiss|checkpoint)(?:[/?]|$)/u, "no generation or forbidden job continuation probe");
    const response = await worker.request(row.url, row.init);
    if (row.url !== API) return response;
    const body = await response.clone().json(), record = { request: structuredClone(row.body), status: response.status, body };
    x.responses.push(record);
    const index = x.holds.findIndex(hold => hold.action === row.body?.action);
    if (index < 0) return response;
    const hold = x.holds.splice(index, 1)[0]; hold.record = record;
    const actualJson = response.json.bind(response);
    return new Proxy(response, { get(target, key) {
      if (key === "json") return async () => { hold.entered.resolve(record); await hold.gate.promise; return actualJson(); };
      const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
    } });
  };
  if (canvas) assert.equal(h.store.chooseCanvasPlanningDocument(state.scope.documentId), true);
  await f.settle(); assert.ok(currentHost(x), "actual Shell-mounted target host");
  await h.store.syncDocumentJobs();
  assert.equal(await h.store.reviewPlanningJob(state.paidQuote.executionId), true, "existing exact original planning resume, no new execute");
  h.store.closePlanningConsent();
  const originalDetail = await h.store.loadDocumentJobDetail(state.paidQuote.executionId);
  await f.settle();
  const originalSource = h.store.adaptiveProposalSource(state.scope.documentId, state.scope.canvasId, state.paidQuote.executionId);
  const currentJob = h.store.documentJobs.get().find(job => job.jobId === state.paidQuote.executionId);
  const currentSession = h.store.session.get(), currentAuthorization = h.store.captureAuthorizationScope();
  const currentProjection = h.store.projection.get(), currentCanvas = h.store.canvasProjection.get();
  console.log("ADAPTIVE_RECOVERY_PREREQUISITE_DIAGNOSTIC " + JSON.stringify({
    version: "r4-observation-only", family, canvas, fixtureSetupProviderResponses: state.calls.length,
    expected: { ...diagnosticFields(state.scope, ["projectId", "documentId", "canvasId"]),
      quote: quoteMetadata(state.paidQuote) },
    currentTarget: { route: h.store.route.get(), projectId: currentProjection.projectId,
      documentId: currentProjection.documentId, selectedCanvasId: currentCanvas.selectedCanvasId,
      canvasProjectId: currentCanvas.projectId, canvasPlanningDocumentId: canvas ? h.store.canvasPlanningDocumentId([]) : null,
      targetDocumentPresent: currentProjection.documents.some(item => item.id === state.scope.documentId && item.projectId === state.scope.projectId),
      events: h.store.events.get().length, jobs: h.store.documentJobs.get().length },
    authority: { actorUserId: currentSession?.user?.userId ?? null, role: currentSession?.user?.role ?? null,
      scopeKeySha256: currentAuthorization?.key ? digest(currentAuthorization.key) : null,
      projectContext: diagnosticFields(currentSession?.projectContext, ["organizationId", "projectAccessId", "historyOwnerId", "permissionEpoch"]),
      permissions: currentSession?.projectContext?.permissions ?? null,
      canvasAccess: currentSession?.canvas?.access ?? null },
    originalSource: { present: originalSource != null,
      ...diagnosticFields(originalSource, ["executionId", "bindingHash", "readable", "withdrawalRevision"]),
      structure: structureMetadata(originalSource?.structure) },
    currentJob: jobMetadata(currentJob), returnedDetail: jobMetadata(originalDetail),
  }));
  assert.ok(originalSource?.readable && originalSource.structure?.suggested_blocks.length);
  assert.equal(originalSource.executionId, state.paidQuote.executionId);
  x.originalText = originalSource.structure.suggested_blocks[0].instruction;
  x.originalLabel = originalSource.structure.suggested_blocks[0].label;
  assert.ok(x.originalText.length > 0);
  x.originalSource = h.store.captureSourceOwnership(); x.originalAuth = h.store.captureAuthorizationScope();
  assert.equal(h.store.sourceOwnershipActive(x.originalSource), true);
  x.start = h.requests.length; x.paidBefore = routed.phase8PaidEvidence(state);
  x.financialBefore = financial(worker); x.ledgersBefore = routed.main170Phase8Ledgers(state);
  t.after(async () => {
    for (const gate of x.gates) gate.release();
    await Promise.allSettled([...x.pending]);
    try {
      assert.equal(denied.mock.callCount(), 0);
      assert.equal(state.calls.length, 1, "zero NEW deterministic-provider invocations after the one setup response");
      routed.phase8AssertNoPayment(state, x.paidBefore);
      assert.deepEqual(financial(worker), x.financialBefore, "no job, provider, grant/slot, or used/held budget change");
      assert.deepEqual(routed.main170Phase8Ledgers(state), x.ledgersBefore);
      assert.equal(queue.values.size, 0, "these controls do not enqueue generic Canvas writes");
      assert.equal(h.requests.slice(x.start).filter(row => /^\/api\/document-jobs\/[^/]+\/(?:run|dismiss|checkpoint)(?:[/?]|$)/u.test(row.url)).length, 0);
    } finally { await state.cleanup(); state.sqlite.close(); }
  });
  return x;
}

function holdRead(x) {
  const entered = sceneDeferred(), gate = sceneDeferred();
  const observationHost = currentHost(x), observationPreview = snapshot(observationHost).preview;
  const value = { action: "retrieve", entered, gate, record: null, release: () => gate.resolve(),
    observationHost, observationPreview };
  x.holds.push(value); x.gates.push(value); return value;
}
function holdNativeRedraw(x) {
  // Only the existing native updateComplete schedule is held. Application
  // source/retirement/control handlers are not replaced or directly cleared.
  const old = x.f.tick, gate = sceneDeferred(), pending = [];
  x.f.tick = (...args) => { const value = gate.promise.then(() => old(...args)); pending.push(value); return value; };
  let released = false;
  const hold = { release() { if (released) return; released = true; x.f.tick = old; gate.resolve(); },
    async finish() { this.release(); await Promise.allSettled(pending); } };
  x.gates.push(hold); return hold;
}
async function retire(x, { draw = true } = {}) {
  x.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?").run(new Date().toISOString(), x.contextId);
  const real = await x.worker.request("/api/events?after=0&limit=2000&content=0"); assert.equal(real.status, 403);
  await assert.rejects(x.h.store.refreshEvents(), /403/u);
  assert.equal(x.h.store.sourceOwnershipActive(x.originalSource), false);
  assert.equal(x.h.store.authorizationScopeActive(x.originalAuth), true, "real authorization identity is not replaced with a fake session");
  assert.equal(x.h.store.routeDataReady(), false);
  if (draw) { await x.f.settle(); assert.equal(currentHost(x) === undefined, true, "actual denied-source Shell unmount"); }
  return real.status;
}
async function restore(x, { draw = true } = {}) {
  x.state.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=NULL WHERE context_id=?").run(x.contextId);
  // The original REAL context is restored in the RAM Worker. Only actual
  // source loading may publish it; no direct Store assignment follows denial.
  await x.h.store.refreshEvents();
  assert.equal(x.h.store.sourceOwnershipActive(x.h.store.captureSourceOwnership()), true);
  assert.equal(x.h.store.sourceOwnershipActive(x.originalSource), false, "same-key restoration never revives the old source token");
  assert.equal(x.h.store.authorizationScopeActive(x.originalAuth), true);
  assert.equal(x.h.store.routeDataReady(), true);
  if (draw) { await x.f.settle(); assert.ok(currentHost(x)); }
}

async function openSuggestion(x) {
  if (x.canvas) {
    const posture = stage => {
      const tree = x.f.tree(), executionId = x.state.paidQuote.executionId;
      const cards = tree.nodes.filter(node => node.attributes?.["data-suggestion-id"] === executionId);
      const buttons = tree.visible("button").filter(node => under(node, parent => parent.attributes?.["data-suggestion-id"] === executionId));
      const returns = tree.visible("button").filter(node => node.text === copy(x, "canvas.returnToBoard")
        && under(node, parent => classHas(parent, "canvas-list-view")));
      console.log("ADAPTIVE_RECOVERY_ENTRY_POSTURE " + JSON.stringify({
        stage, route: x.h.store.route.get(), view: canvasViewFromRoute(x.h.store.route.get()),
        executionId, selectedCanvasId: x.h.store.canvasProjection.get().selectedCanvasId,
        originalReadable: exactEntrySource()?.readable ?? false,
        returnToBoardControls: returns.map(node => ({ tag: node.tag, ownerTag: node.owner?.tag,
          connected: Boolean(node.port?.isConnected && node.owner?.isConnected), handlers: Object.keys(node.handlers).sort() })),
        exactCards: cards.map(node => ({ tag: node.tag, hiddenBy: node.hiddenBy, connected: Boolean(node.port?.isConnected) })),
        exactVisibleButtons: buttons.length,
        exactLabelMatches: buttons.filter(node => node.children.some(child => typeof child === "object" && child.tag === "b" && child.text === x.originalLabel)).length,
      }));
    };
    const exactEntrySource = () => x.h.store.adaptiveProposalSource(x.state.scope.documentId, x.state.scope.canvasId, x.state.paidQuote.executionId);
    posture("before-current-board-gesture");
    if (canvasViewFromRoute(x.h.store.route.get()) === "list") {
      // Existing current Reading-order control invokes actual #setView("spatial").
      // No direct route assignment, fabricated suggestion or private handler.
      const board = x.f.find("button", node => node.text === copy(x, "canvas.returnToBoard")
        && under(node, parent => classHas(parent, "canvas-list-view")));
      assert.ok(board.port?.isConnected && board.owner?.isConnected);
      await x.f.act(board);
      assert.equal(canvasViewFromRoute(x.h.store.route.get()), "spatial", "the actual Return to board handler changes the posture");
      posture("after-current-board-gesture");
    }
  }
  const label = copy(x, "adaptive.changes.reviewSuggestion");
  const buttons = x.f.tree().visible("button").filter(node => x.canvas
    ? under(node, parent => parent.attributes?.["data-suggestion-id"] === x.state.paidQuote.executionId)
      && node.children.some(child => typeof child === "object" && child.tag === "b" && child.text === x.originalLabel)
    : node.text === label && under(node, parent => classHas(parent, "adaptive-model-suggestions")));
  assert.ok(buttons.length > 0, "current genuine paid-plan suggestion control");
  await x.f.act(buttons[0]); await settle(x);
  const value = snapshot(currentHost(x)); assert.equal(value.executionId, x.state.paidQuote.executionId);
  assert.equal(value.bindingHash, x.state.paidQuote.bindingHash); assert.equal(value.visible, true);
  assert.equal(value.originalCount > 0, true);
}
async function preview(x) {
  await openSuggestion(x); const old = previews(x).length;
  await x.f.act(control(x, "adaptive.changes.preview")); await settle(x);
  const value = snapshot(currentHost(x)); assert.equal(previews(x).length, old + 1);
  assert.equal(value.phase, "review", value.notice); assert.ok(value.preview && value.handle);
  assert.equal(x.responses.at(-1).status, 200); return structuredClone(value.preview);
}
async function openResume(x) {
  const label = copy(x, "adaptive.changes.resume");
  if (x.canvas) {
    const menu = x.f.components().find(component => component.tag === "forma-ui-popover" && classHas(component, "canvas-view-menu"));
    assert.ok(menu); const trigger = x.f.find("button", node => node.owner === menu && classHas(node, "ui-popover-trigger"));
    await x.f.act(trigger);
    const panel = x.f.renderer.ownNodes(menu, "section").find(node => node.attributes.id === trigger.attributes.popovertarget);
    assert.ok(panel); panel.showPopover(); await x.f.settle();
  }
  await x.f.act(x.f.find("button", node => node.text === label && !inProposal(node)));
  await settle(x);
}
async function freshExactRecovery(x, originalPreview) {
  const responseStart = x.responses.length;
  const held = x.gates.find(value => value.action === "retrieve"
    && value.record?.request.previewId === originalPreview.previewId && value.observationHost);
  const heldState = held ? snapshot(held.observationHost) : null;
  console.log("ADAPTIVE_RECOVERY_READ_TRACE " + JSON.stringify({
    stage: "before-deliberate", surface: x.canvas ? "Canvas" : "Document",
    expected: diagnosticFields(originalPreview, ["previewId", "approvalHash", "projectId", "documentId", "canvasId"]),
    beforeDeliberate: { old: held ? evidenceState(held.observationHost) : null,
      current: evidenceState(currentHost(x)),
      newPrivateObjectAdopted: heldState ? heldState.preview !== null && heldState.preview !== held.observationPreview : null,
      visiblePrivateOriginal: visibleText(x).includes(x.originalText),
      originalSourceActive: x.h.store.sourceOwnershipActive(x.originalSource) },
    current: freshReadState(x),
  }));
  if (snapshot(currentHost(x)).visible && snapshot(currentHost(x)).handle)
    await x.f.act(control(x, "adaptive.changes.check"));
  else await openResume(x);
  await settle(x);
  const value = snapshot(currentHost(x));
  console.log("ADAPTIVE_RECOVERY_READ_TRACE " + JSON.stringify({
    stage: "after-deliberate-before-assertions", surface: x.canvas ? "Canvas" : "Document",
    current: freshReadState(x), responses: x.responses.slice(responseStart).map(freshReadResponse),
  }));
  assert.equal(value.phase, "review", value.notice); assert.equal(value.preview?.previewId, originalPreview.previewId);
  assert.equal(value.handle?.approvalHash, originalPreview.approvalHash);
  assert.equal(value.executionId, x.state.paidQuote.executionId); assert.equal(value.bindingHash, x.state.paidQuote.bindingHash);
  assert.equal(visibleText(x).includes(x.originalText), true, "private original is shown after the deliberate current exact read");
  return value;
}
async function explicitApply(x) {
  const before = applies(x).length;
  await x.f.act(control(x, "adaptive.changes.apply")); await settle(x);
  const value = snapshot(currentHost(x)); assert.equal(value.phase, "applied", value.notice); assert.ok(value.receipt);
  assert.equal(applies(x).length, before + 1); assert.equal(x.responses.at(-1).status, 200);
  return structuredClone(value.receipt);
}
const receiptIdentity = receipt => ({ previewId: receipt.previewId, approvalHash: receipt.approvalHash,
  executionId: receipt.executionId, bindingHash: receipt.bindingHash, selectionKey: receipt.selectionKey,
  blockIds: receipt.blockIds, canvasItemIds: receipt.canvasItemIds, relationCount: receipt.relationCount });


export { family, evidence, emit, inFamily, page, openSuggestion, untilScene, currentHost, eventRows, previews, begin, control, enteredOrTerminal, retire, restore, settle, evidenceState, visibleText, applies, receipts, snapshot, explicitApply, freshExactRecovery, openResume, preview, holdRead, holdNativeRedraw, receiptIdentity, copy, under, classHas, digest, sceneDeferred, inProposal };
