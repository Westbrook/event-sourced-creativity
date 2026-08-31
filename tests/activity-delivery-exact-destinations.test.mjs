// Four actual-Shell destinations complement reduced naming/binding matrices.
// Historical artifact/review/notification rows are explicit fixture input, not
// performed generation, independent approval, delivery or financial success.
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";
import test from "node:test";
import { lifecyclePage } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { registerCalmFullPageComponents, calmFullPageNativePorts as destinationNativePorts } from "./helpers/calm-full-page-fixture.mjs";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { appendAuditEvent, readWorkspaceEvents } from "../worker/runtime.ts";
import { storePrivateContent } from "../worker/pilot-policy.ts";
import { artifactDeliveryFor } from "../src/state/artifact-delivery-context.ts";
import { artifactFocusOptionsFromRoute, artifactFocusRoute, documentIdFromRoute, libraryFocusFromRoute,
  libraryRootRoute, projectTaskDocumentIdFromRoute, withDocumentInRoute, withProjectTaskDocumentInRoute } from "../src/model/routes.ts";

const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const classed = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const plain = value => String(value).replace(/\s+/gu, " ").trim();
const exactlyOne = (rows, message) => { assert.equal(rows.length, 1, message); return rows[0]; };

// The finite renderer recreates native link ports on each settled update.
// Reacquire the current same-owner/same-href control; do not keep a detached
// port alive or replace the native handler/admission.
function currentDestinationLink(f, owner, previous) {
  assert.equal(previous.tag, "a"); assert.ok(owner.isConnected);
  const current = exactlyOne(f.tree().visible("a").filter(row => row.owner === owner
    && row.attributes.href === previous.attributes.href && row.attributes.class === previous.attributes.class),
    "one current native link for the same exact destination");
  assert.equal(current.text, previous.text);
  assert.equal(current.attributes["aria-label"], previous.attributes["aria-label"]);
  assert.ok(current.port?.isConnected && f.renderer.nodes.includes(current.port));
  assert.equal(current.hiddenBy, null); assert.equal(current.port.matches(":disabled"), false);
  return current;
}

// Read-only observations of current public owners/native state, not an admission
// override or new route success criterion. No text, tokens or request bodies.
function destinationNavigationState(f, h, source, authorization) {
  const tree = f.tree(), libraries = f.components().filter(value => value.tag === "forma-library" && value.isConnected);
  const departure = libraries.length === 1 ? libraries[0].captureCommandDeparture() : null;
  const transferred = h.store.captureWorkspaceNavigationFocus(h.store.route.get()), active = f.native.document.activeElement;
  return { route: h.store.route.get(), sourceCurrent: h.store.sourceOwnershipActive(source),
    authorizationCurrent: h.store.authorizationScopeActive(authorization),
    transferredFocus: transferred ? { current: transferred.current(), focusCurrent: transferred.focus.current() } : null,
    active: active ? { tag: active.tagName ?? active.tag ?? null, owner: active.owner?.tag ?? null, connected: active.isConnected === true } : null,
    library: { count: libraries.length, current: departure?.current() ?? null,
      blocked: departure?.blocked() ?? null, reason: departure?.reason() ?? null },
    dialogs: tree.nodes.filter(row => row.tag === "dialog").map(row => ({ owner: row.owner?.tag ?? null,
      class: String(row.attributes.class ?? ""), connected: row.port?.isConnected === true,
      open: row.port?.open === true, visible: !row.hiddenBy })) };
}


// Reuse the existing complete publisher native-form/default contracts. These
// read actual uncontrolled value/checked attributes; no clean-owner override,
// controlled-field defaultValue surrogate or new application method is used.
const publisherFixtureUrl = new URL("./project-navigation-continuity.test.mjs", import.meta.url);
const publisherFixtureSource = fs.readFileSync(publisherFixtureUrl, "utf8");
const publisherFixtureTree = ts.createSourceFile(publisherFixtureUrl.pathname, publisherFixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const publisherDeclarations = ["fObjectClassed", "cLibraryPublisherWithin", "cLibraryPublisherNativeForm", "cLibraryDraftNativeDefaults"].map(name => {
  const found = publisherFixtureTree.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === name
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === name));
  assert.equal(found.length, 1, "one existing publisher fixture declaration: " + name);
  return found[0].getText(publisherFixtureTree);
});
const { cLibraryPublisherNativeForm, cLibraryDraftNativeDefaults } = new Function("assert",
  publisherDeclarations.join("\n") + "\nreturn { cLibraryPublisherNativeForm, cLibraryDraftNativeDefaults };")(assert);
function installDestinationPublisherInputs(t, f, library) {
  const native = cLibraryPublisherNativeForm(t, f, library);
  native.current();
  const currentInputs = cLibraryDraftNativeDefaults(t, f, library), inputs = currentInputs();
  assert.ok(inputs.some(input => input.getAttribute("name") === "packageName"), "the actual shared Library publisher has its native name field");
  assert.ok(inputs.some(input => input.getAttribute("name") === "packageBlock"), "actual current Document decisions provide the publisher checkboxes");
  for (const input of inputs) assert.equal(input.getAttribute("type") === "checkbox"
    ? input.checked === input.defaultChecked : input.value === input.defaultValue, true,
    "an untouched actual publisher field starts at its emitted native default");
  return currentInputs;
}

// Test-local attribute persistence only. The actual viewer writes aria-label
// imperatively after its first update; the finite renderer then reconstructs
// literal ports on later updates. Preserve that observed write only within the
// same emitted close EventPart and uninterrupted owner/Store/Document/Source.
// The default preserves only the attribute, not dialog DOM identity or open
// state. The explicit actual-destination option has separate identity controls;
// neither mode changes permissions or certifies physical focus/modal timing.
function installDestinationDialogNames(t, f, { retainDialogIdentity = false } = {}) {
  const renderer = f.renderer, records = new Map(), writes = [], dispatches = new Map();
  const originalCollect = renderer.collect, originalDraw = renderer.draw;
  let drawing = false, generation = 0;
  // Same exact native field bridge as the manual-output fixture. The existing
  // finite primitive invokes the actual parent's bound listener, but does not
  // populate Event.target/currentTarget. Do not replace that listener or event.
  const reflectArtifactCloseDispatch = owner => {
    if (dispatches.has(owner)) return;
    const descriptor = Object.getOwnPropertyDescriptor(owner, "dispatchEvent"), original = owner.dispatchEvent;
    assert.equal(original, destinationNativePorts.ElementPort.prototype.dispatchEvent,
      "Only the existing inherited finite DOM dispatch primitive is extended");
    const dispatch = function(event) {
      if (event.type !== "document-artifact-close") return Reflect.apply(original, this, [event]);
      const target = Object.getOwnPropertyDescriptor(event, "target"), currentTarget = Object.getOwnPropertyDescriptor(event, "currentTarget");
      Object.defineProperties(event, { target: { configurable: true, value: this }, currentTarget: { configurable: true, value: this } });
      try { return Reflect.apply(original, this, [event]); }
      finally {
        if (target) Object.defineProperty(event, "target", target); else delete event.target;
        if (currentTarget) Object.defineProperty(event, "currentTarget", currentTarget); else delete event.currentTarget;
      }
    };
    owner.dispatchEvent = dispatch; dispatches.set(owner, { descriptor, dispatch });
  };
  const current = record => record.owner.isConnected && record.owner.store === record.store
    && record.owner.documentId === record.documentId && record.owner.source === record.surface
    && record.store.sourceOwnershipActive(record.source);
  renderer.collect = function(markup, owner) {
    const start = this.nodes.length;
    const result = Reflect.apply(originalCollect, this, [markup, owner]);
    if (!drawing || owner?.tag !== "forma-document-artifacts") return result;
    const anchors = this.nodes.slice(start).filter(node => node.owner === owner && node.tag === "dialog"
      && String(node.attributes.class ?? "").split(/\s+/u).includes("document-artifact-view"));
    if (anchors.length !== 1) { records.delete(owner); return result; }
    const fresh = anchors[0], token = fresh.full.match(/\s@close=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
    const binding = token ? this.bindings[Number(token[1])] : null;
    if (binding?.owner !== owner || typeof binding.part !== "string"
      || typeof binding.value !== "function" || binding.value !== fresh.handlers.close) {
      records.delete(owner); return result;
    }
    const previous = records.get(owner);
    const same = previous?.generation === generation - 1 && previous.node.isConnected
      && this.previousNodes?.includes(previous.node) && previous.part === binding.part && current(previous);
    const source = same ? previous.source : owner.store?.captureSourceOwnership?.();
    if (!source || !owner.store.sourceOwnershipActive(source)) { records.delete(owner); return result; }
    // Only the already opt-in actual Library viewer receives this native IDL
    // support. The standalone name/identity templates do not declare a launcher.
    if (retainDialogIdentity && owner.launcherOnly === true && owner.source === "library") reflectArtifactCloseDispatch(owner);
    // Explicit actual-destination-only option. Reuse the old native object,
    // listener closures and unbound open state; fresh methods close over the
    // discarded fresh node and must never be copied onto the retained node.
    const retain = retainDialogIdentity && same && !/\s[.?]?open(?=[=\s>])/u.test(fresh.full);
    let node = fresh;
    if (retain) {
      node = previous.node;
      for (const key of ["full", "attributes", "properties", "propertyParts", "handlers"]) node[key] = fresh[key];
      node.parentElement = owner; node.isConnected = true;
      this.nodes[this.nodes.indexOf(fresh)] = node; fresh.isConnected = false;
    }
    const authoredName = Object.hasOwn(node.attributes, "aria-label");
    const record = { owner, store: owner.store, documentId: owner.documentId, surface: owner.source,
      source, part: binding.part, node, generation, label: same && !authoredName ? previous.label : undefined };
    records.set(owner, record);
    const setAttribute = retain ? previous.nativeSetAttribute : node.setAttribute;
    const removeAttribute = retain ? previous.nativeRemoveAttribute : node.removeAttribute;
    record.nativeSetAttribute = setAttribute; record.nativeRemoveAttribute = removeAttribute;
    if (record.label !== undefined) Reflect.apply(setAttribute, node, ["aria-label", record.label]);
    node.setAttribute = function(name, value) {
      const result = Reflect.apply(setAttribute, this, [name, value]);
      if (name === "aria-label" && records.get(owner) === record && record.node === this && current(record)) {
        record.label = this.getAttribute(name);
        writes.push({ owner, node: this, part: record.part, value: record.label });
      }
      return result;
    };
    node.removeAttribute = function(name) {
      const result = Reflect.apply(removeAttribute, this, [name]);
      if (name === "aria-label" && records.get(owner) === record && record.node === this && current(record)) record.label = undefined;
      return result;
    };
    return result;
  };
  renderer.draw = function(...args) {
    generation++; drawing = true;
    try { return Reflect.apply(originalDraw, this, args); }
    finally {
      drawing = false;
      for (const [owner, record] of records) if (record.generation !== generation || !this.nodes.includes(record.node)
        || !current(record)) records.delete(owner);
    }
  };
  t.after(() => {
    for (const [owner, { descriptor, dispatch }] of dispatches) if (owner.dispatchEvent === dispatch) {
      if (descriptor) Object.defineProperty(owner, "dispatchEvent", descriptor); else delete owner.dispatchEvent;
    }
    dispatches.clear(); renderer.collect = originalCollect; renderer.draw = originalDraw; records.clear();
  });
  return { writes: () => [...writes] };
}

// The complete DocumentArtifacts class uses one direct same-origin member GET.
// Bridge only that actual current resource into the already-owned original
// SceneStoreHost/Worker transport. Every other global request remains rejected.
// This neither supplies a successful body nor changes the response or rights.
function installDestinationMembersTransport(t, getHost, unexpected) {
  const reads = [];
  t.mock.method(globalThis, "fetch", (input, init = {}) => {
    const h = getHost(), context = h?.store.session.get()?.projectContext, sharing = h?.worker.sharing;
    const path = sharing ? `/api/workspaces/${encodeURIComponent(sharing.organizationId)}/projects/${encodeURIComponent(sharing.projectAccessId)}/members` : null;
    if (typeof input !== "string" || input !== path || (init.method ?? "GET") !== "GET" || init.credentials !== "same-origin") return unexpected();
    const record = { method: "GET", path, init, request: null, response: null, admitted: false, error: null };
    reads.push(record);
    try {
      assert.ok(h && context && sharing);
      assert.equal(context.organizationId, sharing.organizationId); assert.equal(context.projectAccessId, sharing.projectAccessId);
      assert.equal(context.projectId, h.worker.projectId); assert.equal(h.store.session.get().user.userId, h.worker.owner);
      assert.ok(context.permissions.includes("project.read") && context.permissions.includes("project.author"));
      assert.equal(h.store.projection.get().projectId, h.worker.projectId); assert.equal(h.store.projection.get().documentId, h.worker.documentId);
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      record.admitted = true;
      const pending = h.fetch(input, init);
      const requests = h.requests.filter(request => request.url === input && request.init === init);
      assert.equal(requests.length, 1, "one exact original request object from the existing transport");
      record.request = requests[0];
      return pending.then(response => {
        record.response = response;
        t.diagnostic("C149_EXACT_MEMBER_READ " + JSON.stringify({ method: record.method, path: record.path,
          responseStatus: response.status, currentSourceAtDispatch: record.admitted, originalRequest: h.requests.includes(record.request) }));
        return response; // The SAME original Worker response, no replacement success.
      }, error => { record.error = error; throw error; });
    } catch (error) { record.error = error; return Promise.reject(error); }
  });
  return { verify() {
    for (const record of reads) {
      const h = getHost();
      assert.equal(record.admitted, true); assert.equal(record.error, null);
      assert.ok(record.request && h.requests.includes(record.request));
      assert.equal(record.request.url, record.path); assert.strictEqual(record.request.init, record.init);
      assert.equal(record.request.init.method ?? "GET", "GET"); assert.equal(record.request.init.body, undefined);
      assert.ok(record.response); assert.equal(record.response.status, 200, "actual current authorized members response, not a caught mock failure");
    }
  } };
}

async function historicalTargets(worker, stage) {
  const title = "Same saved output — 同じ成果", artifacts = [];
  for (const suffix of ["peer", "target"]) {
    const id = "c137-" + stage + "-" + suffix, markdown = "Exact historical " + suffix + " bytes for " + stage + " — 保持された内容。";
    const raw = JSON.stringify({ title, summary: "Explicit historical navigation fixture", content_markdown: markdown,
      presentation: null, items: [{ title: "Part", body: markdown, notes: "", image_prompt: "", context_group_ids: [], slide: null }] });
    const stored = await storePrivateContent(worker.env, worker.owner, "document-artifact", raw);
    const sha = createHash("sha256").update(raw).digest("hex");
    const completed = await appendAuditEvent(worker.env, worker.streamId, "worker:fixture-history", "DocumentRenderCompleted", {
      project_id: worker.projectId, document_id: worker.documentId, artifact_id: id, artifact_kind: "short_story", title,
      summary: "Explicit historical navigation fixture", content_ref: stored.contentId, requested_by_user_id: "fixture-author",
      source_block_versions: [{ block_id: "scene-reuse-direction", version: 1 }], item_count: 1, items: [{ id: id + "-part", title: "Part" }],
    });
    const exact = { project_id: worker.projectId, document_id: worker.documentId, artifact_id: id, artifact_revision: 0, content_sha256: sha };
    await appendAuditEvent(worker.env, worker.streamId, "user:fixture-assigner", "ArtifactReviewRequested", {
      ...exact, assigned_reviewer_user_id: worker.owner,
    });
    if (stage === "export") await appendAuditEvent(worker.env, worker.streamId, "user:" + worker.owner, "ArtifactApproved", exact);
    artifacts.push({ id, title, markdown, raw, sha, revision: 0, contentRef: stored.contentId, sourceEventId: completed.eventId });
  }
  const notificationId = "c137-notification-" + stage, target = artifacts[1], context = worker.sharing;
  assert.ok(context);
  const now = new Date().toISOString(), expires = new Date(Date.now() + 3600000).toISOString();
  // Same explicit historical envelope shape as artifact-noop-save. No endpoint
  // or Store response is replaced; the mounted Activity reads the original GET.
  worker.sqlite.prepare("INSERT INTO project_notifications(notification_id,project_access_id,organization_id,project_id,recipient_user_id,event_id,kind,artifact_id,document_id,message,created_at,expires_at,read_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,NULL)")
    .run(notificationId, context.projectAccessId, context.organizationId, worker.projectId, worker.owner,
      target.sourceEventId + "-c137-notification", stage === "document" ? "context_changed" : stage === "review" ? "output_ready" : "output_approved",
      stage === "document" ? null : target.id, worker.documentId,
      stage === "document" ? "Project context changed." : stage === "review" ? "A new finished output is ready for the project." : "A finished output was independently approved.", now, expires);
  await worker.drainBackground();
  return { target, peer: artifacts[0], notificationId };
}

for (const spec of [
  { label: "Activity notification review", surface: "activity", stage: "review", locale: "en" },
  { label: "Activity notification export", surface: "activity", stage: "export", locale: "ja" },
  { label: "Activity notification Document fallback", surface: "activity", stage: "document", locale: "en" },
  { label: "Deliver artifact export", surface: "deliver", stage: "export", locale: "ja" },
]) test(spec.label + " reaches the exact current destination through the actual Shell / " + spec.locale,
  { concurrency: false, timeout: 120000 }, async t => {
    let externalAttempts = 0, memberHost;
    const members = installDestinationMembersTransport(t, () => memberHost, async () => { externalAttempts++; assert.fail("No external/provider request in a read-only destination witness"); });
    const h = await createSceneStoreHost({ count: 1, shared: true, exposeSceneTestAccessors: false }), worker = h.worker;
    memberHost = h;
    const resume = observeActualSceneResumeReads(h);
    let f, verify = async () => {};
    t.after(async () => { try { await resume.settleOriginalRequests(); await verify(); }
      finally { resume.restore(); if (!f) await h.close(); } });
    const seeded = await historicalTargets(worker, spec.stage), { target, peer } = seeded;
    const originRoute = withProjectTaskDocumentInRoute("/" + spec.surface, worker.documentId);
    f = await lifecyclePage(t, { route: withProjectTaskDocumentInRoute("/activity", worker.documentId), mode: "configure", locale: spec.locale, storeHost: h });
    const dialogNames = installDestinationDialogNames(t, f, { retainDialogIdentity: true });
    await registerCalmFullPageComponents(f, ["forma-deliver", "forma-library", "forma-workspace"]);
    const drain = async () => {
      for (let step = 0; step < 8; step++) {
        await f.settle();
        for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
        await resume.settleOriginalRequests(); await new Promise(setImmediate);
      }
      await f.settle(); await resume.settleOriginalRequests(); await worker.drainBackground();
      assert.equal(resume.pendingOriginalCount(), 0);
    };
    // Replace the helper's presentation-only projection with complete original
    // current Worker reads before any destination or no-effects assertion.
    await h.store.refreshSession(); await h.store.refreshEvents({ fromStart: true }); await h.store.syncProjectNotifications();
    await drain(); h.store.setRoute(originRoute); await drain();
    assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-") || event.eventId.startsWith("synthetic-extra-")), false);
    const projection = h.store.projection.get(), document = projection.documents.find(row => row.id === worker.documentId && !row.removed);
    assert.ok(document && document.projectId === worker.projectId); assert.equal(projection.documentId, document.id);
    const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
    assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
    const session = h.store.session.get();
    assert.equal(session.user.userId, worker.owner); assert.equal(session.projectContext.projectAccessId, worker.sharing.projectAccessId);
    assert.ok(session.projectContext.permissions.includes("project.read") && session.projectContext.permissions.includes("project.review.approve"));
    const originalHistory = await readWorkspaceEvents(worker.env, worker.streamId);
    assert.ok(originalHistory.some(event => event.type === "DocumentCreated" && event.payload.document_id === document.id));
    const artifact = projection.libraryArtifacts.find(row => row.id === target.id);
    assert.ok(artifact && artifact.documentId === document.id && artifact.sourceEventId === target.sourceEventId && artifact.contentRef === target.contentRef);
    assert.ok(projection.libraryArtifacts.some(row => row.id === peer.id && row.title === artifact.title));
    const delivery = artifactDeliveryFor(h.store, artifact);
    if (spec.stage !== "document") {
      assert.equal(delivery.action, spec.stage); assert.equal(delivery.intent, spec.stage);
      assert.equal(delivery.revision, target.revision); assert.equal(delivery.contentSha256, target.sha);
    }
    const owner = exactlyOne(f.components().filter(value => value.tag === "forma-" + spec.surface && value.isConnected), "one exact current source owner");
    assert.equal(f.host.tag, "forma-shell"); assert.equal(owner.closest("forma-shell"), f.host);
    assert.equal(owner.store, h.store); assert.equal(f.host.store, h.store); assert.equal(h.store.route.get(), originRoute);
    const tree = f.tree(); let action;
    if (spec.surface === "activity") {
      const notice = h.store.projectNotifications.get().find(row => row.id === seeded.notificationId);
      assert.ok(notice && notice.documentId === document.id); assert.equal(notice.artifactId, spec.stage === "document" ? null : target.id);
      const panel = exactlyOne(tree.nodes.filter(row => row.component?.tag === "forma-activity-issue-panel"
        && row.component.isConnected && row.component.notification?.id === notice.id), "one actual notification child from the original authorized GET");
      assert.equal(panel.component.store, h.store);
      const card = exactlyOne(tree.visible("article").filter(row => row.owner === owner && inside(panel, row)), "one current notification card");
      action = exactlyOne(tree.visible("button").filter(row => row.owner === owner && inside(row, card) && row.attributes.class === "button secondary"), "one original notification action");
      assert.equal(action.text, spec.stage === "document" ? f.i18n.t("activity.openDocument", "Open document") : f.i18n.t("artifact.delivery.action." + delivery.action));
      if (spec.stage !== "document") {
        assert.equal(action.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: action.text, name: card.attributes["aria-label"] }));
        assert.ok(card.text.includes(artifact.title) && card.text.includes(document.title));
      }
      assert.equal(action.attributes.type, "button");
    } else {
      action = exactlyOne(tree.visible("a").filter(row => row.owner === owner && row.attributes.class === "button secondary compact"
        && libraryFocusFromRoute(row.attributes.href ?? "")?.id === target.id), "one exact Deliver footer action, not its preview link");
      assert.equal(action.text, f.i18n.t("artifact.delivery.action." + delivery.action));
      assert.ok(action.attributes["aria-label"].includes(artifact.title) && action.attributes["aria-label"].includes(document.title));
    }
    assert.ok(action.port?.isConnected && f.renderer.nodes.includes(action.port)); assert.equal(action.hiddenBy, null);
    assert.equal(action.port.matches(":disabled"), false);
    const options = { expectedRevision: target.revision, expectedContentSha256: target.sha, intent: delivery.intent };
    const rawTarget = spec.stage === "document" ? withDocumentInRoute("/", document.id, document.title)
      : artifactFocusRoute(target.id, target.title, options, spec.surface === "deliver" ? originRoute : "/library");
    const expected = withProjectTaskDocumentInRoute(rawTarget, document.id, originRoute);
    if (spec.surface === "deliver") assert.equal(action.attributes.href, rawTarget);
    const before = { history: originalHistory, money: financial(worker),
      privateContent: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
      receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
      notifications: worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all(),
      events: structuredClone(h.store.events.get()), head: h.store.head.get(), session: JSON.stringify(session) };
    verify = async () => {
      assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), before.history, "including navigation, the exact canonical history is unchanged");
      assert.deepEqual(financial(worker), before.money, "all nine existing job/fiscal/provider tables are unchanged");
      assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
      assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
      assert.deepEqual(worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all(), before.notifications);
      assert.deepEqual(h.store.events.get(), before.events); assert.equal(h.store.head.get(), before.head); assert.equal(JSON.stringify(h.store.session.get()), before.session);
      assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      assert.deepEqual(h.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(row)), [],
        "Only positively certified exact original no-write Resume reads may use POST; no endpoint-wide exemption");
      assert.equal(h.requests.filter(row => row.url.startsWith("/api/document-jobs") && (row.init.method ?? "GET") !== "GET").length, 0,
        "No job create/run, retry, recovery, checkpoint or server Dismiss");
      members.verify();
      assert.equal(externalAttempts, 0);
    };
    const navigation = [], nativePush = globalThis.history.pushState;
    t.mock.method(globalThis.history, "pushState", function(...args) { navigation.push(String(args[2])); return nativePush.apply(this, args); });
    if (spec.surface === "deliver") for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
      action = currentDestinationLink(f, owner, action);
      await f.act(action, "click", { button: 0, defaultPrevented: false, [modifier]: true, preventDefault() { assert.fail("modified native href must not be intercepted"); } });
      assert.equal(h.store.route.get(), originRoute); assert.deepEqual(navigation, []);
    }
    if (spec.surface === "deliver") action = currentDestinationLink(f, owner, action);
    f.native.emit("pointerdown", action.port); f.native.focus(action.port);
    await f.act(action, "click", { button: 0, defaultPrevented: false }); await drain();
    assert.deepEqual(navigation, [expected], "one actual current action commits its one exact ordinary destination");
    assert.equal(h.store.route.get(), expected); assert.equal(h.location.pathname + h.location.search + h.location.hash, expected);
    assert.equal(owner.isConnected, false); assert.equal(h.store.projection.get().projectId, document.projectId); assert.equal(h.store.projection.get().documentId, document.id);
    if (spec.stage === "document") {
      assert.equal(documentIdFromRoute(expected), document.id);
      const arrived = f.tree(), workspace = exactlyOne(arrived.nodes.filter(row => row.tag === "forma-workspace" && row.component?.isConnected && !row.hiddenBy), "actual ordinary Document destination");
      assert.equal(workspace.component.store, h.store);
      assert.equal(arrived.visible("h1").filter(row => row.owner === workspace.component && row.text === document.title).length, 1);
    } else {
      assert.equal(libraryFocusFromRoute(expected)?.kind, "artifact"); assert.equal(libraryFocusFromRoute(expected)?.id, target.id);
      assert.deepEqual(artifactFocusOptionsFromRoute(expected), options); assert.equal(projectTaskDocumentIdFromRoute(expected), document.id);
      const library = exactlyOne(f.components().filter(value => value.tag === "forma-library" && value.isConnected), "actual Library destination");
      assert.equal(library.store, h.store);
      installDestinationPublisherInputs(t, f, library);
      const opened = await library.awaitArtifactRouteOpening({ artifactId: target.id, documentId: document.id, revision: target.revision, contentSha256: target.sha },
        { current: () => h.store.route.get() === expected && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization) });
      t.diagnostic("C139_EXACT_ARTIFACT_ARRIVAL " + JSON.stringify({ label: spec.label, opened,
        artifactId: target.id, revision: target.revision, contentSha256: target.sha, intent: delivery.intent,
        state: destinationNavigationState(f, h, source, authorization) }));
      assert.equal(opened, true);
      await drain();
      const arrived = f.tree(), viewer = exactlyOne(f.components().filter(value => value.tag === "forma-document-artifacts" && value.isConnected && value.closest("forma-library") === library), "exact actual Library artifact viewer");
      assert.equal(viewer.store, h.store); assert.equal(viewer.documentId, document.id); assert.equal(viewer.source, "library");
      const dialog = exactlyOne(arrived.visible("dialog").filter(row => row.owner === viewer && classed(row, "document-artifact-view")), "current native artifact dialog is open");
      assert.ok(dialog.port.open); assert.equal(dialog.attributes["data-artifact-kind"], "short_story");
      assert.equal(dialog.port.getAttribute("aria-label"), target.title);
      assert.ok(dialogNames.writes().some(write => write.owner === viewer && write.value === target.title),
        "the observed production setAttribute, not expected-title injection, supplies the retained native name");
      assert.equal(arrived.visible("h2").filter(row => inside(row, dialog) && row.text === target.title).length, 1);
      const prose = exactlyOne(arrived.visible("pre").filter(row => inside(row, dialog) && classed(row, "artifact-prose")), "actual retained content, not URL-only arrival");
      assert.equal(prose.text, plain(target.markdown)); assert.notEqual(prose.text, plain(peer.markdown));
      assert.equal(h.store.content.get()[target.contentRef], target.raw);
      assert.equal(arrived.nodes.filter(row => row.tag === "code" && inside(row, dialog) && row.text === target.sha).length, 1, "exact retained digest exists in the production-evidence details; not asserted visible while collapsed");
      const intent = exactlyOne(arrived.visible("button").filter(row => inside(row, dialog) && classed(row, "artifact-viewer-review-toggle")), "current intent control");
      assert.equal(intent.text, f.i18n.t("artifact.delivery.action." + spec.stage)); assert.equal(String(intent.attributes["aria-expanded"]), "true");
      const panelId = intent.attributes["aria-controls"];
      assert.equal(arrived.visible("div").filter(row => inside(row, dialog) && row.attributes.id === panelId).length, 1, "exact Review/Export pane is reached, with no approval or download activated");
      const close = exactlyOne(arrived.visible("button").filter(row => row.owner === viewer && inside(row, dialog) && row.attributes["aria-label"] === f.i18n.t("action.close", "Close")), "current native viewer Close");
      const namedDialog = dialogNames.writes().filter(write => write.owner === viewer).at(-1);
      assert.ok(namedDialog, "the original native dialog received the production name write");
      const closeTrace = f.trace.length;
      const closeToken = dialog.port.full.match(/\s@close=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
      const clickedPart = closeToken ? f.renderer.bindings[Number(closeToken[1])]?.part : null;
      const closeNativeState = () => {
        const current = viewer.querySelector(".document-artifact-view");
        return { originalIsClicked: namedDialog.node === dialog.port, clickedIsCurrent: dialog.port === current,
          sameEmittedClosePartAtCapture: namedDialog.part === clickedPart,
          originalConnected: namedDialog.node.isConnected, clickedConnected: dialog.port.isConnected,
          originalOpen: namedDialog.node.open, clickedOpen: dialog.port.open,
          originalListener: typeof namedDialog.node.listeners?.close === "function",
          clickedListener: typeof dialog.port.listeners?.close === "function",
          closeEvents: f.trace.slice(closeTrace).filter(value => value === "event:document-artifact-close"),
          state: destinationNavigationState(f, h, source, authorization) };
      };
      const beforeNativeClose = closeNativeState();
      f.native.emit("pointerdown", close.port); f.native.focus(close.port); await f.act(close, "click", { button: 0 }); await drain();
      t.diagnostic("C147_EXACT_ARTIFACT_NATIVE_CLOSE " + JSON.stringify({ label: spec.label,
        before: beforeNativeClose, after: closeNativeState() }));
      assert.equal(h.store.route.get(), libraryRootRoute(expected)); assert.equal(libraryFocusFromRoute(h.store.route.get()), null);
      assert.equal(f.tree().visible("dialog").filter(row => classed(row, "document-artifact-view")).length, 0);
    }
    const returnLink = exactlyOne(f.tree().visible("a").filter(row => row.owner.tag === "forma-ui-audience-navigation"
      && new URL(row.attributes.href, "https://fixture.invalid").pathname === "/" + spec.surface), "current ordinary return task");
    assert.equal(returnLink.attributes.href, originRoute);
    const beforeReturn = destinationNavigationState(f, h, source, authorization);
    f.native.emit("pointerdown", returnLink.port); f.native.focus(returnLink.port); await f.act(returnLink, "click", { button: 0 }); await drain();
    t.diagnostic("C139_EXACT_DESTINATION_RETURN " + JSON.stringify({ label: spec.label, href: returnLink.attributes.href,
      before: beforeReturn, after: destinationNavigationState(f, h, source, authorization) }));
    assert.equal(h.store.route.get(), originRoute); assert.equal(h.store.projection.get().documentId, document.id);
    assert.equal(f.components().filter(value => value.tag === "forma-" + spec.surface && value.isConnected).length, 1);
    await verify();
    t.diagnostic("ACTIVITY_DELIVER_ACTUAL_DESTINATION " + JSON.stringify({ label: spec.label, locale: spec.locale, documentId: document.id,
      artifactId: spec.stage === "document" ? null : target.id, revision: spec.stage === "document" ? null : target.revision,
      contentSha256: spec.stage === "document" ? null : target.sha, intent: spec.stage === "document" ? null : spec.stage,
      destination: expected, returned: originRoute, actualShell: true, historicalSeedOnly: true, noEffects: true,
      originalResumeProofs: resume.observations().length, generationApprovalDeliveryClaim: false, physicalBrowserClaim: false }));
  });

// Additive ordinary-origin lease controls, not the command-menu or Library-card
// paths already covered elsewhere. The first four complete bodies above stay
// unchanged. The two ordinary image witnesses remain a separate whole file.
import { finishLifecycle, ports } from "./helpers/creative-next-action-navigation-fixture.mjs";
import { sceneDeferred } from "./helpers/scene-cost-store-host.mjs";
import { documentArtifactRevision } from "../src/model/document-artifacts.ts";

for (const [locale, boundary] of [["en", "healthy"], ["en", "newer-pointer"], ["ja", "other-route"], ["ja", "source-withdrawal"], ["en", "stale-revision"]])
  test("Ordinary Activity exact artifact delayed opening / " + locale + " / " + boundary,
    { concurrency: false, timeout: 120000 }, async t => {
      const release = sceneDeferred(), progressed = sceneDeferred();
      let restoreTick = () => {}, settleOpening = async () => {}, activation, activationError = null;
      // Register release before the existing full-host cleanup: a prerequisite
      // failure must not strand the original held update/Worker fixture.
      t.after(async () => { release.resolve(); restoreTick(); await settleOpening(); });
      let externalAttempts = 0, memberHost;
      const members = installDestinationMembersTransport(t, () => memberHost, async () => { externalAttempts++; assert.fail("No external/provider transport in a delayed ordinary artifact opening"); });
      const h = await createSceneStoreHost({ count: 1, shared: true, exposeSceneTestAccessors: false }), worker = h.worker;
      memberHost = h;
      const resume = observeActualSceneResumeReads(h); let f, verify = async () => {};
      t.after(async () => { try { await resume.settleOriginalRequests(); await verify(); }
        finally { resume.restore(); if (!f) await h.close(); } });
      const seeded = await historicalTargets(worker, "review"), { target, peer } = seeded;
      const originRoute = withProjectTaskDocumentInRoute("/activity", worker.documentId);
      f = await lifecyclePage(t, { route: originRoute, mode: "configure", locale, storeHost: h });
      const dialogNames = installDestinationDialogNames(t, f, { retainDialogIdentity: true });
      await registerCalmFullPageComponents(f, ["forma-library", "forma-workspace"]);
      const drain = async () => {
        for (let step = 0; step < 8; step++) {
          await f.settle();
          for (const [id, timer] of [...h.timers]) if (timer.delay === 16) { h.timers.delete(id); timer.callback(0); }
          await resume.settleOriginalRequests(); await new Promise(setImmediate);
        }
        await f.settle(); await resume.settleOriginalRequests(); await worker.drainBackground();
        assert.equal(resume.pendingOriginalCount(), 0);
      };
      await h.store.refreshSession(); await h.store.refreshEvents({ fromStart: true }); await h.store.syncProjectNotifications();
      await drain(); h.store.setRoute(originRoute); await drain();
      assert.equal(h.store.events.get().some(event => event.eventId.startsWith("synthetic-study-") || event.eventId.startsWith("synthetic-extra-")), false);
      const projection = h.store.projection.get(), document = projection.documents.find(row => row.id === worker.documentId && !row.removed);
      assert.ok(document && document.projectId === worker.projectId); assert.equal(projection.documentId, document.id);
      const source = h.store.captureSourceOwnership(), authorization = h.store.captureAuthorizationScope();
      assert.ok(source && authorization && h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      assert.equal(h.store.session.get().user.userId, worker.owner);
      assert.equal(h.store.session.get().projectContext.projectAccessId, worker.sharing.projectAccessId);
      const artifact = projection.libraryArtifacts.find(row => row.id === target.id);
      assert.ok(artifact && artifact.documentId === document.id && artifact.sourceEventId === target.sourceEventId && artifact.contentRef === target.contentRef);
      const delivery = artifactDeliveryFor(h.store, artifact);
      assert.equal(delivery.action, "review"); assert.equal(delivery.intent, "review");
      assert.equal(delivery.revision, 0); assert.equal(delivery.contentSha256, target.sha);
      assert.equal(documentArtifactRevision(h.store.events.get(), target.id), 0);
      // Warm only via the original authorized private read, never an installed
      // response or content-map assignment. This is not a paid operation.
      assert.equal(await h.store.ensurePrivateContent(target.contentRef, { force: true }), target.raw); await drain();
      const activity = exactlyOne(f.components().filter(owner => owner.tag === "forma-activity" && owner.isConnected), "one actual ordinary Activity owner");
      assert.equal(activity.store, h.store); assert.equal(activity.closest("forma-shell"), f.host);
      const tree = f.tree(), notice = h.store.projectNotifications.get().find(row => row.id === seeded.notificationId);
      assert.ok(notice && notice.artifactId === target.id && notice.documentId === document.id);
      const panel = exactlyOne(tree.nodes.filter(row => row.component?.tag === "forma-activity-issue-panel"
        && row.component.isConnected && row.component.notification?.id === notice.id), "current original GET notification child");
      const card = exactlyOne(tree.visible("article").filter(row => row.owner === activity && inside(panel, row)), "current exact notification card");
      const action = exactlyOne(tree.visible("button").filter(row => row.owner === activity && inside(row, card)
        && row.attributes.class === "button secondary"), "actual ordinary exact Review action");
      assert.equal(action.text, f.i18n.t("artifact.delivery.action.review"));
      assert.equal(action.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: action.text, name: card.attributes["aria-label"] }));
      assert.ok(action.port.isConnected && f.renderer.nodes.includes(action.port)); assert.equal(action.hiddenBy, null);
      assert.equal(action.port.matches(":disabled"), false); assert.equal(action.attributes.type, "button");
      const options = { expectedRevision: 0, expectedContentSha256: target.sha, intent: "review" };
      const expected = withProjectTaskDocumentInRoute(artifactFocusRoute(target.id, target.title, options, "/library"), document.id, originRoute);
      const before = { history: await readWorkspaceEvents(worker.env, worker.streamId), money: financial(worker),
        privateContent: worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(),
        receipts: worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(),
        notifications: worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all() };
      let expectedHistory = before.history, expectedNotifications = before.notifications;
      verify = async () => {
        assert.deepEqual(await readWorkspaceEvents(worker.env, worker.streamId), expectedHistory,
          "only the explicitly declared concurrent revision input may change canonical history");
        assert.deepEqual(financial(worker), before.money, "all nine existing job/fiscal/provider tables stay exact");
        assert.deepEqual(worker.sqlite.prepare("SELECT * FROM private_content ORDER BY rowid").all(), before.privateContent);
        assert.deepEqual(worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all(), before.receipts);
        assert.deepEqual(worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all(), expectedNotifications);
        assert.deepEqual(h.requests.filter(row => (row.init.method ?? "GET") !== "GET" && !resume.isReadOnlyResume(row)), [],
          "only exact positively certified original no-write Resume may use POST; no endpoint exemption");
        assert.equal(h.requests.filter(row => row.url.startsWith("/api/document-jobs") && (row.init.method ?? "GET") !== "GET").length, 0,
          "no job create/run/recovery/retry/checkpoint/server Dismiss");
        members.verify();
        assert.equal(externalAttempts, 0);
      };
      const { DocumentArtifacts } = await ports.loadActual("src/components/document-artifacts.ts");
      const originalOpen = DocumentArtifacts.prototype.openArtifactById, calls = [];
      t.mock.method(DocumentArtifacts.prototype, "openArtifactById", function(id, actualOptions) {
        const pending = originalOpen.call(this, id, actualOptions);
        if (id === target.id) {
          const call = { owner: this, id, options: actualOptions, pending, settled: false, result: undefined, error: null };
          calls.push(call);
          pending.then(value => { call.settled = true; call.result = value; progressed.resolve(); },
            error => { call.settled = true; call.error = error; progressed.resolve(); });
        }
        return pending; // The original exact Promise and original current predicate.
      });
      const originalTick = f.tick; let held = false;
      f.tick = async owner => {
        const result = await originalTick(owner), call = calls.find(row => row.owner === owner && !row.settled);
        if (!held && call && owner.isConnected && owner.store === h.store && owner.source === "library"
          && owner === f.host.querySelector("forma-library")?.querySelector("forma-document-artifacts")) {
          held = true; progressed.resolve(); await release.promise;
        }
        return result;
      };
      restoreTick = () => { f.tick = originalTick; };
      settleOpening = () => finishLifecycle(f, Promise.allSettled([activation, ...calls.map(call => call.pending)]));
      const traceStart = f.trace.length;
      f.native.emit("pointerdown", action.port); f.native.focus(action.port);
      activation = f.act(action, "click", { button: 0 });
      activation.then(() => {}, error => { activationError = error; progressed.resolve(); });
      await finishLifecycle(f, progressed.promise);
      t.diagnostic("C146_ORDINARY_ARTIFACT_BOUNDARY " + JSON.stringify({ locale, boundary, held, calls: calls.length,
        settled: calls[0]?.settled ?? false, result: calls[0]?.result ?? null,
        activationError: activationError?.name ?? null, route: h.store.route.get() }));
      assert.equal(activationError, null, "the original native action reaches the intended asynchronous boundary without a setup error");
      assert.equal(held, true, "the original public viewer reaches its real pre-promotion updateComplete; earlier refusal is a prerequisite failure");
      assert.equal(calls.length, 1); const call = calls[0];
      assert.equal(call.settled, false); assert.equal(call.id, target.id); assert.equal(call.owner.documentId, document.id);
      assert.equal(call.options.expectedRevision, 0); assert.equal(call.options.expectedContentSha256, target.sha); assert.equal(call.options.intent, "review");
      assert.equal(h.store.route.get(), expected); assert.equal(activity.isConnected, false);
      assert.deepEqual(libraryFocusFromRoute(expected), { kind: "artifact", id: target.id });
      assert.deepEqual(artifactFocusOptionsFromRoute(expected), options); assert.equal(projectTaskDocumentIdFromRoute(expected), document.id);
      const library = exactlyOne(f.components().filter(owner => owner.tag === "forma-library" && owner.isConnected), "actual exact Library destination");
      assert.equal(library.store, h.store); assert.equal(call.owner.closest("forma-library"), library);
      installDestinationPublisherInputs(t, f, library);
      const transferred = h.store.captureWorkspaceNavigationFocus(expected);
      assert.ok(transferred?.current() && transferred.focus.current(), "ordinary bridge retains the original transferred lease while pending");
      assert.equal(f.trace.slice(traceStart).includes("open:document-artifact-view"), false);
      assert.equal(f.tree().visible("dialog").filter(row => classed(row, "document-artifact-view")).length, 0);
      if (boundary === "newer-pointer") {
        const trigger = exactlyOne(f.tree().visible("button").filter(row => row.owner === f.host && classed(row, "command-trigger")), "current native header target for a newer gesture");
        assert.ok(trigger.port.isConnected && f.renderer.nodes.includes(trigger.port));
        f.native.emit("pointerdown", trigger.port); // No command is activated.
        assert.equal(transferred.focus.current(), false);
      } else if (boundary === "other-route") {
        h.store.setRoute(originRoute); await drain();
        assert.equal(h.store.route.get(), originRoute); assert.equal(h.store.projection.get().documentId, document.id);
        assert.equal(call.owner.isConnected, false); assert.equal(transferred.current(), false);
      } else if (boundary === "source-withdrawal") {
        await resume.settleOriginalRequests();
        // Reuse the existing withdrawal input with ordinary session/events reads.
        // The owned events denial below supplies the actual Source-retirement fence.
        const prior = worker.sqlite.prepare("SELECT * FROM project_context_sessions WHERE context_id=?").get(worker.sharing.contextId);
        assert.ok(prior && !prior.revoked_at);
        worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?")
          .run(new Date().toISOString(), worker.sharing.contextId);
        await assert.rejects(h.store.refreshSession(), { name: "Error", message: "project_access_revoked" });
        // Session rejection is not itself an event-Source retirement receipt.
        // Reuse the ordinary owned events read that performs that actual fence.
        await assert.rejects(h.store.refreshEvents(), { name: "Error", message: "Event stream returned 403" });
        await drain();
        assert.equal(h.store.sourceOwnershipActive(source), false); assert.equal(transferred.current(), false);
        assert.equal(h.store.session.get().user.userId, worker.owner, "this is Source withdrawal, not an invented principal swap");
        assert.equal(h.store.content.get()[target.contentRef], undefined, "withdrawn private bytes are not retained by the old viewer");
      } else if (boundary === "stale-revision") {
        await resume.settleOriginalRequests();
        const event = await appendAuditEvent(worker.env, worker.streamId, "user:fixture-concurrent-revision", "DocumentArtifactEdited", {
          project_id: worker.projectId, document_id: document.id, artifact_id: target.id, content_ref: target.contentRef,
          revision: 1, changed_fields: ["notes"], source_surface: "finite-concurrent-revision" });
        expectedHistory = await readWorkspaceEvents(worker.env, worker.streamId);
        assert.deepEqual(expectedHistory, [...before.history, event], "one declared historical interleaving, not an accepted Save or approval");
        await h.store.refreshEvents(); await drain();
        assert.equal(documentArtifactRevision(h.store.events.get(), target.id), 1);
        assert.equal(h.store.projection.get().libraryArtifacts.find(row => row.id === target.id)?.contentRef, target.contentRef);
        assert.equal(call.settled, false, "the original viewer remains held while declared input consequences are certified");
        const afterNotifications = worker.sqlite.prepare("SELECT * FROM project_notifications ORDER BY notification_id").all();
        assert.deepEqual(afterNotifications.filter(row => row.event_id !== event.eventId), before.notifications,
          "every pre-existing notification remains exact");
        const consequence = exactlyOne(afterNotifications.filter(row => row.event_id === event.eventId),
          "the declared revision creates exactly its one current recipient notification");
        const scope = worker.sqlite.prepare("SELECT * FROM project_event_scopes WHERE event_id=? AND project_access_id=?")
          .get(event.eventId, worker.sharing.projectAccessId);
        assert.ok(scope); assert.equal(scope.organization_id, worker.sharing.organizationId);
        assert.deepEqual({ projectAccessId: consequence.project_access_id, organizationId: consequence.organization_id,
          projectId: consequence.project_id, documentId: consequence.document_id, artifactId: consequence.artifact_id,
          recipient: consequence.recipient_user_id, eventId: consequence.event_id, kind: consequence.kind,
          message: consequence.message, readAt: consequence.read_at },
        { projectAccessId: worker.sharing.projectAccessId, organizationId: worker.sharing.organizationId,
          projectId: worker.projectId, documentId: document.id, artifactId: target.id, recipient: worker.owner,
          eventId: event.eventId, kind: "output_edited", message: "A finished output changed and needs a fresh review.", readAt: null });
        assert.match(consequence.notification_id, /^[a-f0-9]{32}$/u);
        assert.equal(consequence.created_at, scope.created_at);
        assert.equal(Date.parse(consequence.expires_at) - Date.parse(consequence.created_at), 30 * 24 * 60 * 60 * 1000);
        expectedNotifications = afterNotifications;
        t.diagnostic("C149_DECLARED_REVISION_CONSEQUENCE " + JSON.stringify({ eventId: event.eventId,
          artifactId: target.id, revision: 1, notificationCount: afterNotifications.length - before.notifications.length,
          kind: consequence.kind, originalOpeningStillHeld: !call.settled }));
      }
      if (boundary !== "source-withdrawal") assert.ok(h.store.sourceOwnershipActive(source) && h.store.authorizationScopeActive(authorization));
      const afterBoundary = { route: h.store.route.get(), session: JSON.stringify(h.store.session.get()),
        documentId: h.store.projection.get().documentId, events: structuredClone(h.store.events.get()), head: h.store.head.get(),
        focusCount: f.native.nativeFocus.length, active: f.native.document.activeElement };
      release.resolve(); await finishLifecycle(f, activation);
      let result, error = null;
      try { result = await finishLifecycle(f, call.pending); } catch (caught) { error = caught; }
      await drain(); await verify();
      assert.equal(calls.length, 1, "no late replacement viewer or repeated original open");
      assert.equal(h.store.route.get(), afterBoundary.route); assert.equal(JSON.stringify(h.store.session.get()), afterBoundary.session);
      assert.equal(h.store.projection.get().documentId, afterBoundary.documentId);
      assert.deepEqual(h.store.events.get(), afterBoundary.events); assert.equal(h.store.head.get(), afterBoundary.head);
      assert.equal(h.store.sourceOwnershipActive(source), boundary !== "source-withdrawal", "late completion cannot revoke or revive the captured Source");
      if (boundary !== "source-withdrawal") assert.ok(h.store.authorizationScopeActive(authorization));
      const arrived = f.tree(), dialogs = arrived.visible("dialog").filter(row => classed(row, "document-artifact-view") && row.port?.open);
      const promotions = f.trace.slice(traceStart).filter(value => value === "open:document-artifact-view");
      t.diagnostic("C146_ORDINARY_ARTIFACT_RESULT " + JSON.stringify({ locale, boundary, artifactId: target.id, revision: 0,
        contentSha256: target.sha, intent: "review", held, result: result ?? null, error: error?.message ?? null,
        dialogs: dialogs.length, promotions: promotions.length, route: h.store.route.get(),
        sourceCurrent: h.store.sourceOwnershipActive(source), originalResumeProofs: resume.observations().length,
        declaredRevisionInput: boundary === "stale-revision", noPaidOrClientMutation: true, physicalBrowserClaim: false }));
      if (boundary !== "healthy") {
        if (boundary === "stale-revision") assert.ok(result === false && !error
          || error?.message === "The requested output changed before it opened.", "only the existing exact-revision refusal is accepted");
        else { assert.equal(error, null); assert.equal(result, false); }
        assert.deepEqual(promotions, [], "a final refusal cannot excuse a transient stale native opening");
        assert.equal(dialogs.length, 0); assert.equal(f.native.nativeFocus.length, afterBoundary.focusCount);
        assert.strictEqual(f.native.document.activeElement, afterBoundary.active, "late completion must not move newer focus");
        return;
      }
      assert.equal(error, null); assert.equal(result, true);
      const dialog = exactlyOne(dialogs, "actual healthy exact viewer opens after releasing the original update");
      assert.equal(dialog.owner, call.owner); assert.equal(dialog.attributes["data-artifact-kind"], "short_story");
      assert.equal(dialog.port.getAttribute("aria-label"), target.title);
      assert.ok(dialogNames.writes().some(write => write.owner === call.owner && write.value === target.title));
      assert.equal(arrived.visible("h2").filter(row => inside(row, dialog) && row.text === target.title).length, 1);
      const prose = exactlyOne(arrived.visible("pre").filter(row => inside(row, dialog) && classed(row, "artifact-prose")), "original exact retained body");
      assert.equal(prose.text, plain(target.markdown)); assert.notEqual(prose.text, plain(peer.markdown));
      assert.equal(h.store.content.get()[target.contentRef], target.raw);
      assert.equal(arrived.nodes.filter(row => row.tag === "code" && inside(row, dialog) && row.text === target.sha).length, 1);
      const intent = exactlyOne(arrived.visible("button").filter(row => inside(row, dialog) && classed(row, "artifact-viewer-review-toggle")), "actual exact Review intent");
      assert.equal(intent.text, f.i18n.t("artifact.delivery.action.review")); assert.equal(String(intent.attributes["aria-expanded"]), "true");
      assert.equal(arrived.visible("div").filter(row => inside(row, dialog) && row.attributes.id === intent.attributes["aria-controls"]).length, 1);
      const ownFocus = exactlyOne(arrived.visible("button").filter(row => row.owner === call.owner && inside(row, dialog)
        && classed(row, "artifact-viewer-focus-toggle")), "actual current viewer focus control");
      assert.ok(ownFocus.port.isConnected); f.native.focus(ownFocus.port);
      assert.equal(transferred.focus.current(), true, "the existing original lease permits its exact current viewer's own programmatic focus");
      f.native.emit("pointerdown", ownFocus.port);
      assert.equal(transferred.focus.current(), false, "a newer deliberate gesture retires that route-lifetime lease");
      await drain();
      assert.equal(f.tree().visible("dialog").filter(row => row.owner === call.owner && classed(row, "document-artifact-view") && row.port.open).length, 1,
        "retiring the opening focus lease does not revoke an already-open authorized inspection");
      await verify();
    });
