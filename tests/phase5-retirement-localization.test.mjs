import assert from "node:assert/strict";
import test from "node:test";
import { createUnusedSceneFixture } from "./helpers/scene-unused-fixture.mjs";
import { createSceneCostFixture, createSceneStoreHost, accountCachePort, financial, sceneDeferred, eventRequest, appendAuditEvent } from "./helpers/event-source-retirement-fixture.mjs";
import { createCalmFullPage, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { certifyActualOutputFixtureResumeReads } from "./helpers/output-reachability-fixture.mjs";
import { FORMA_RESPONSIVE_MESSAGES as copies } from "../src/components/design-system/locales/responsive-messages.ts";

// Full production Shell/Activity classes, Store, Worker, shipped catalogs and
// real template-localization function. Only native DOM/context/history/cache
// ports and the database are synthetic; this is not browser/AT certification.
const RAW_NOTICE = "The current source is unavailable. Its saved operation references are retained.";
const { localizeTemplateResult } = await ports.loadActual("src/components/design-system/localized-template.ts");
let unexpectedExternalCalls = 0;
const originalFetch = globalThis.fetch;
test.before(() => { globalThis.fetch = async () => { unexpectedExternalCalls++; throw new Error("No external or provider request"); }; });
test.after(() => { globalThis.fetch = originalFetch; assert.equal(unexpectedExternalCalls, 0); });
const expectedAlert = (full, key) => full.i18n.t("shell.streamUnavailable") + " " + copies[full.i18n.locale][key] + " " + full.i18n.t("action.retry");

function hasClass(node, name) { return String(node.attributes.class ?? "").split(/\s+/u).includes(name); }

// One actual template-tree snapshot owns each lookup. Renderer ports alone
// share a component parent and cannot distinguish banner from main ancestry.
function sourceRetry(full, owner) {
  assert.ok(owner === "main" || owner === "banner");
  const tree = full.tree();
  const inside = (node, ancestor) => {
    for (let current = node.parent; current; current = current.parent) if (current === ancestor) return true;
    return false;
  };
  const current = (node, label) => {
    assert.equal(node.owner, full.host, label + " belongs to the current actual Shell");
    assert.equal(node.hiddenBy, null, label + " is structurally visible");
    assert.ok(node.port?.isConnected && full.renderer.nodes.includes(node.port), label + " has its current connected native port");
    assert.equal(node.port.owner, full.host);
    for (let at = node; at; at = at.parent) {
      assert.equal(Object.hasOwn(at.attributes, "inert"), false, label + " has no inert ancestor");
      assert.notEqual(at.attributes["aria-hidden"], "true", label + " is not aria-hidden");
    }
  };
  const mains = tree.nodes.filter(node => node.tag === "main" && node.owner === full.host && node.attributes.id === "main-content");
  assert.equal(mains.length, 1, "one actual Shell main");
  const main = mains[0]; current(main, "main");
  const containers = tree.nodes.filter(node => node.owner === full.host && (owner === "main"
    ? node.tag === "section" && node.parent === main && node.attributes.role === "status" && hasClass(node, "application-loading")
    : node.tag === "div" && node.attributes.role === "alert" && hasClass(node, "error-banner") && !inside(node, main)));
  assert.equal(containers.length, 1, "one current " + owner + " source-status owner");
  const container = containers[0]; current(container, owner + " source status");
  if (owner === "main") {
    assert.equal(main.attributes["aria-busy"], "false", "terminal source unavailability is not pending work");
    const copy = tag => tree.nodes.filter(node => node.tag === tag && node.owner === full.host && inside(node, container)).map(node => node.text);
    assert.deepEqual(copy("b"), [full.i18n.t("shell.documentUnavailable")]);
    assert.deepEqual(copy("p"), [full.i18n.t("shell.documentUnavailableDetail")]);
    const opening = full.i18n.t("shell.loading", "", { application: full.i18n.t("shell.creative") });
    assert.ok(opening && full.i18n.t("shell.loadingDetail"), "actual localized pending copy is known");
    assert.equal(main.text.includes(opening), false, "terminal main makes no opening claim");
    assert.equal(main.text.includes(full.i18n.t("shell.loadingDetail")), false, "terminal main makes no restoration claim");
    assert.equal(container.children.some(node => typeof node !== "string" && node.tag === "span" && node.attributes["aria-hidden"] === "true"), false,
      "the pending source spinner is absent");
  }
  const retries = tree.nodes.filter(node => node.tag === "button" && node.owner === full.host && inside(node, container));
  assert.equal(retries.length, 1, "one native Retry within the exact " + owner + " owner");
  const retry = retries[0]; current(retry, owner + " Retry");
  assert.equal(retry.text, full.i18n.t("action.retry"));
  assert.equal(Object.hasOwn(retry.attributes, "disabled"), false);
  assert.notEqual(retry.port.disabled, true);
  assert.notEqual(retry.properties.disabled, true, "Lit disabled property bindings cannot hide behind an unreflected native port");
  assert.equal(typeof retry.handlers.click, "function", "the actual current Retry handler is retained");
  assert.equal(retry.handlers.click, retry.port.handlers.click);
  if (owner === "main") {
    assert.equal(retry.attributes.type, "button");
    if (Object.hasOwn(retry.attributes, "tabindex")) {
      assert.match(String(retry.attributes.tabindex), /^\d+$/u, "terminal native Retry is not removed from sequential focus");
    }
  }
  return retry;
}


// Observe the existing native port, not a replacement focus algorithm. Its
// ordinary literal ports redraw; record the first actual focus while current.
function retirementMain(full, tree = full.tree()) {
  const rows = tree.nodes.filter(row => row.tag === "main" && row.owner === full.host && row.attributes.id === "main-content");
  assert.equal(rows.length, 1); return rows[0];
}
function retirementCommand(full) {
  const rows = full.tree().visible("button").filter(row => row.owner === full.host && hasClass(row, "command-trigger"));
  assert.equal(rows.length, 1); assert.equal(rows[0].attributes["aria-expanded"], "false"); return rows[0];
}
function retirementOrigin(x) {
  const { full, h } = x, activity = x.activity(), tree = full.tree();
  assert.ok(activity?.isConnected && activity.store === h.store);
  const rows = tree.visible("a").filter(row => row.owner === activity && hasClass(row.parent, "forma-activity-header-actions")
    && row.text === full.i18n.t("activity.openDeliverables"));
  assert.equal(rows.length, 1, "one actual Activity View deliverables link");
  const origin = rows[0], href = new URL(String(origin.attributes.href), h.location.origin);
  assert.equal(href.pathname, "/deliver"); assert.equal(href.searchParams.get("document"), h.store.projection.get().documentId);
  assert.equal(typeof origin.handlers.click, "function");
  assert.ok(retirementMain(full, tree).port.contains(origin.port), "the actual link is in the current main branch");
  return origin;
}
function retirementViewEvent(h, type) {
  const view = h.window;
  // The existing window port does not assign DOM Event.target on dispatch.
  // Supply its exact actual window identity, as the browser event would.
  view.dispatchEvent({ type, target: view, currentTarget: view, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
}
function retirementKey(full, native, target) {
  const event = { type: "keydown", key: "ArrowRight", target, currentTarget: ports.windowPort,
    isComposing: false, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    composedPath: () => [target, full.host, native.document], preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  for (const listener of [...(full.listeners.get("keydown") ?? [])]) listener(event);
}
async function retirementFocusWitness(t, x) {
  const { full, h } = x, native = installOutputNavigationFocusNative(t, full, ports), document = native.document;
  assert.equal(document, h.document); assert.equal(full.host.ownerDocument, document);
  const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState"), hasFocus = Object.getOwnPropertyDescriptor(document, "hasFocus");
  let focused = true;
  document.visibilityState = "visible"; document.hasFocus = () => focused;
  t.after(() => {
    if (visibility) Object.defineProperty(document, "visibilityState", visibility); else delete document.visibilityState;
    if (hasFocus) Object.defineProperty(document, "hasFocus", hasFocus); else delete document.hasFocus;
  });
  await full.settle(); // Install/observe the existing command EventPart before capturing an origin.
  const command = retirementCommand(full).port;
  await full.settle(); assert.equal(retirementCommand(full).port, command, "the existing native command control really survives redraw");
  let active = null, intent = false;
  const draw = full.draw;
  full.draw = (...args) => {
    const result = draw(...args);
    if (active) try {
      // Observe only after the genuine complete draw returns. This does not
      // hold/replace tick, updateComplete, its promise, or the application callback.
      const tree = full.tree(), main = retirementMain(full, tree);
      active.draws.push({ originDisconnected: !active.origin.isConnected, busy: main.attributes["aria-busy"],
        statuses: tree.nodes.filter(row => row.parent === main && row.attributes.role === "status" && hasClass(row, "application-loading")).length,
        dialogs: tree.visible("dialog").map(row => ({ port: row.port, owner: row.owner, consent: hasClass(row, "consent-modal"),
          open: Boolean(row.port?.open), current: Boolean(row.port?.isConnected && full.renderer.nodes.includes(row.port)) })) });
    } catch (error) { active.errors.push(error); }
    return result;
  };
  t.after(() => { full.draw = draw; });
  const onFocus = event => {
    if (!active) return;
    const record = active, target = event.target, last = native.nativeFocus.at(-1);
    const sample = { target, kind: intent ? "declared-newer-intent" : "product", current: target?.isConnected && full.renderer.nodes.includes(target),
      previous: last?.node === target ? last.previous : null, previousConnected: last?.node === target ? last.previousConnected : null };
    record.focuses.push(sample);
    if (intent) return;
    try {
      const retry = sourceRetry(full, "main");
      Object.assign(sample, { exactRetry: target === retry.port, type: retry.attributes.type, label: retry.text,
        sameStore: full.host.store === h.store && h.store === record.store, sameDocument: full.host.ownerDocument === document,
        originalDisconnected: !record.origin.isConnected, branchDisconnected: !record.branch.isConnected,
        route: h.store.route.get(), locale: full.i18n.locale, generation: h.store.captureSourceOwnership()?.generation,
        sourceInactive: !h.store.sourceOwnershipActive(h.store.captureSourceOwnership()), busy: retirementMain(full).attributes["aria-busy"],
        title: full.i18n.t("shell.documentUnavailable"), detail: full.i18n.t("shell.documentUnavailableDetail") });
    } catch (error) { record.errors.push(error); }
  };
  const onRetirement = event => {
    if (!active) return;
    const record = active;
    try {
      assert.equal(event.type, "forma-event-source-retired");
      assert.ok(event.detail && Object.isFrozen(event.detail));
      const current = h.store.captureSourceOwnership();
      record.events.push({ event, detail: event.detail, currentGeneration: current?.generation,
        scopeCurrent: h.store.sourceOwnershipScopeActive(event.detail.source), sourceInactive: !h.store.sourceOwnershipActive(current),
        originConnected: record.origin.isConnected, originCurrent: full.renderer.nodes.includes(record.origin) });
      if (record.events.length === 1) {
        assert.ok(record.origin.isConnected && full.renderer.nodes.includes(record.origin), "capture precedes the genuine retirement draw");
        record.afterCapture?.({ event, record, native, command, setFocused: value => { focused = value; },
          intent: action => { intent = true; try { action(); } finally { intent = false; } } });
      }
    } catch (error) { record.errors.push(error); }
  };
  document.addEventListener("focusin", onFocus, true);
  // Phase5 already forwards this ORIGINAL Store event. Append after the real
  // Shell listener; do not add another bridge or replace updateComplete/tick.
  ports.windowPort.addEventListener("forma-event-source-retired", onRetirement);
  t.after(() => {
    active = null; document.removeEventListener("focusin", onFocus, true);
    ports.windowPort.removeEventListener("forma-event-source-retired", onRetirement);
  });
  return {
    native, command,
    arm(row, { afterCapture, branch = row.owner } = {}) {
      assert.equal(active, null); assert.ok(row.port?.isConnected && full.renderer.nodes.includes(row.port));
      assert.equal(row.hiddenBy, null); assert.equal(Object.hasOwn(row.attributes, "disabled"), false);
      assert.notEqual(row.properties.disabled, true); assert.equal(row.port.matches(":disabled"), false);
      assert.equal(row.port.closest('[hidden],[inert],[aria-hidden="true"]'), null);
      native.focus(row.port); // Explicit original user-focus input, before retirement only.
      assert.equal(document.activeElement, row.port);
      const main = retirementMain(full);
      active = { store: h.store, origin: row.port, branch, route: h.store.route.get(), locale: full.i18n.locale,
        beforeSource: h.store.captureSourceOwnership(), initialInMain: main.port.contains(row.port), initialMain: row.port === main.port,
        initialStatus: Boolean(row.port.closest(".application-loading")), initialProjects: Boolean(row.port.closest(".projects-source-owner")),
        afterCapture, events: [], focuses: [], draws: [], errors: [] };
      return active;
    },
    finish() { assert.ok(active); const record = active; active = null; return record; },
  };
}
function assertRetirementFocus(record) {
  assert.deepEqual(record.errors, []);
  assert.equal(record.events.length, 1); const retired = record.events[0];
  assert.equal(retired.detail.status, 403); assert.equal(retired.currentGeneration, retired.detail.generation);
  assert.equal(retired.detail.source.generation, record.beforeSource.generation);
  assert.equal(retired.detail.source.generation + 1, retired.detail.generation);
  assert.ok(retired.scopeCurrent && retired.sourceInactive && retired.originConnected && retired.originCurrent);
  assert.ok(record.initialInMain && !record.initialMain && !record.initialStatus && !record.initialProjects);
  assert.equal(record.focuses.length, 1, "the original retirement performs exactly one direct native recovery focus before any post-retirement key");
  const focus = record.focuses[0];
  assert.equal(focus.kind, "product"); assert.ok(focus.current && focus.exactRetry && focus.sameStore && focus.sameDocument);
  assert.ok(focus.originalDisconnected && focus.branchDisconnected);
  assert.equal(focus.previous, record.origin); assert.equal(focus.previousConnected, false);
  assert.equal(focus.route, record.route); assert.equal(focus.locale, record.locale);
  assert.equal(focus.generation, retired.detail.generation); assert.equal(focus.sourceInactive, true);
  assert.equal(focus.type, "button"); assert.equal(focus.busy, "false");
}
function assertNoRetirementFocus(record, { events = 1, intents = 0 } = {}) {
  assert.deepEqual(record.errors, []); assert.equal(record.events.length, events);
  const first = record.events[0];
  assert.equal(first.detail.status, 403); assert.equal(first.currentGeneration, first.detail.generation);
  assert.equal(first.detail.source.generation, record.beforeSource.generation);
  assert.ok(first.scopeCurrent && first.sourceInactive && first.originConnected && first.originCurrent);
  assert.equal(record.focuses.filter(row => row.kind === "declared-newer-intent").length, intents);
  assert.deepEqual(record.focuses.filter(row => row.kind === "product"), [], "retirement cannot take focus after this exact exclusion or newer intent");
}
function retirementCustody(x, before) {
  const state = x.state();
  assert.equal(state.sourceReady, false); assert.equal(state.loading, false);
  assert.equal(state.sourceEvents, 0); assert.equal(state.contentRefs, 0);
  assert.equal(state.projectId, ""); assert.equal(state.documentId, "");
  assert.deepEqual(state.references, before.references);
  assert.equal(x.full.renderer.markup.includes("Saved complete story"), false);
  assert.equal(x.full.renderer.markup.includes("The keeper checks harbor position 1."), false);
  x.assertReadOnly();
}

async function fixture(t, locale, { empty = false } = {}) {
  let assertReadOnly;
  t.after(() => assertReadOnly?.()); // Run the final accounting check before the reused fixture closes SQLite.
  accountCachePort(t);
  // Actual native job admission and failure BEFORE provider dispatch. This is
  // not a fabricated zero-call receipt or an uncertain provider result.
  const worker = empty
    ? await createSceneCostFixture(1, "visual", { shared: false, depth: true })
    : await createUnusedSceneFixture({ shared: true, reason: "source-expired" });
  if (!empty) worker.repairSource();
  let documentId = worker.documentId;
  if (empty) {
    documentId = "ordinary-empty-document";
    await appendAuditEvent(worker.env, worker.streamId, "user", "ProjectCreated", {
      project_id: "ordinary-empty-project", name: "Verified ordinary empty project",
    });
    await appendAuditEvent(worker.env, worker.streamId, "user", "DocumentCreated", {
      project_id: "ordinary-empty-project", document_id: documentId, title: "Verified ordinary empty document",
    });
  }
  const h = await createSceneStoreHost({ workerFixture: worker });
  t.after(() => h.close());
  // Populate from this exact actual Worker response, not an invented status.
  if (worker.job) h.store.documentJobs.set([worker.job]);
  const priorHistory = globalThis.history;
  const updateLocation = route => {
    const location = new URL(route, h.location.origin);
    Object.assign(h.location, { pathname: location.pathname, search: location.search, hash: location.hash, href: location.href });
  };
  globalThis.history = { pushState(_state, _title, route) { updateLocation(route); }, replaceState(_state, _title, route) { updateLocation(route); } };
  t.after(() => { globalThis.history = priorHistory; });
  updateLocation(h.store.route.get());
  const original = { events: h.store.events.get(), content: h.store.content.get(), head: h.store.head.get(), session: h.store.session.get() };
  const beforeMoney = financial(worker), requestStart = h.requests.length;
  const full = await createCalmFullPage(t, { locale, storeHost: h });
  // Certify only captured bootstrap reads against this original Worker/SQL,
  // before restoring source and changing the destination to Activity.
  assert.equal(full.storeHost, h, "the full page retains this exact transport host");
  assert.equal(h.worker, worker, "the transport retains this exact native SQL Worker");
  assert.equal(h.transport, null, "no synthetic response transport replaces the Worker");
  assert.equal(h.intercept, null, "no interceptor manufactures the bootstrap response");
  const isReadOnlyResume = await certifyActualOutputFixtureResumeReads(full);
  // The reusable layout fixture writes synthetic layout state. Restore the
  // exact Worker event/content/session snapshot before any audited observation.
  h.store.events.set(original.events); h.store.content.set(original.content);
  h.store.head.set(original.head); h.store.session.set(original.session);
  h.store.setRoute("/activity?document=" + encodeURIComponent(documentId));
  const dispatch = h.window.dispatchEvent;
  h.window.dispatchEvent = function (event) {
    const result = dispatch.call(this, event);
    for (const handler of [...(full.listeners.get(event.type) ?? [])]) handler(event);
    return result;
  };
  t.after(() => { h.window.dispatchEvent = dispatch; });
  // Existing RendererPort replaces native Lit update. Apply its actual
  // production localization step to the complete Shell template, not a
  // separately manufactured banner. Nested Activity uses the real catalog too.
  const nativeDraw = full.renderer.draw.bind(full.renderer);
  full.renderer.draw = (host, render = () => host.render()) =>
    nativeDraw(host, () => localizeTemplateResult(render(), host.i18n));
  await full.settle();
  const activity = () => full.components().find(component => component.tag === "forma-activity");
  const state = () => {
    const tree = full.tree(), projection = h.store.projection.get();
    return {
      locale, route: h.store.route.get(), sourceReady: h.store.routeDataReady(), loading: h.store.loading.get(),
      projectId: projection.projectId, documentId: projection.documentId,
      sourceEvents: h.store.eventView.get().length, contentRefs: Object.keys(h.store.content.get()).length,
      activityMounted: Boolean(activity()), mainBusy: tree.nodes.find(node => node.attributes.id === "main-content")?.attributes["aria-busy"],
      loadingPane: tree.nodes.some(node => hasClass(node, "application-loading") && !node.hiddenBy),
      headings: tree.visible("h2").map(node => node.text),
      alerts: tree.nodes.filter(node => node.attributes.role === "alert" && !node.hiddenBy).map(node => node.text),
      error: h.store.error.get(),
      references: h.store.documentJobs.get().map(job => ({ jobId: job.jobId, documentId: job.documentId, kind: job.kind, status: job.status })),
    };
  };
  assertReadOnly = () => {
    assert.deepEqual(financial(worker), beforeMoney, "original jobs, exact IDs and all financial rows remain unchanged");
    assert.deepEqual(h.requests.slice(requestStart).filter(request => request.init.method && request.init.method !== "GET" && !isReadOnlyResume(request)), [],
      "presentation/revalidation never submits, retries, runs, acknowledges, or reconciles an operation");
    assert.equal(unexpectedExternalCalls, 0);
  };
  assertReadOnly();
  const setRevoked = revoked => {
    assert.ok(worker.sharing);
    worker.sqlite.prepare("UPDATE project_context_sessions SET revoked_at=? WHERE context_id=?")
      .run(revoked ? new Date().toISOString() : null, worker.sharing.contextId);
  };
  return { h, worker, full, activity, state, setRevoked, assertReadOnly, original };
}

for (const locale of ["en", "fr", "ar", "ja"]) {
  test("current owned403 localization and actual Shell recovery — " + locale, { timeout: 20000 }, async t => {
    const x = await fixture(t, locale), { h, worker, full } = x;
    const focusWitness = await retirementFocusWitness(t, x);
    const before = x.state(), originalActivity = x.activity(), originalId = worker.job.jobId;
    assert.equal(before.sourceReady, true); assert.equal(before.activityMounted, true);
    assert.ok(before.headings.includes(full.i18n.t("activity.needsYou")));
    assert.deepEqual(before.alerts, []); assert.equal(before.references[0].status, "failed");
    assert.equal(worker.counts().budget_reservations, 0); assert.equal(worker.counts().cost_budget_reservations, 0);

    focusWitness.arm(retirementOrigin(x));
    x.setRevoked(true);
    const denied = await worker.request("/api/events?after=0&limit=2000&content=0");
    assert.equal(denied.status, 403, "the original current source is denied by the actual Worker");
    await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u);
    await full.settle();
    const retirementFocus = focusWitness.finish();
    const retired = x.state();
    assert.equal(retired.error, RAW_NOTICE);
    assert.deepEqual(retired.alerts, [expectedAlert(full, "shell.sourceUnavailable")]);
    assert.equal(typeof copies[locale]["shell.sourceUnavailable"], "string");
    if (locale !== "en") assert.notEqual(copies[locale]["shell.sourceUnavailable"], RAW_NOTICE);
    if (locale !== "en") assert.notEqual(full.i18n.t("shell.streamUnavailable"), "Durable stream unavailable.");
    assert.equal(retired.sourceReady, false); assert.equal(retired.loading, false);
    assert.equal(retired.sourceEvents, 0); assert.equal(retired.contentRefs, 0);
    assert.equal(retired.projectId, ""); assert.equal(retired.documentId, "");
    assert.equal(retired.activityMounted, false); assert.equal(originalActivity.isConnected, false);
    assert.equal(retired.mainBusy, "false"); sourceRetry(full, "main");
    assert.equal(retired.headings.includes(full.i18n.t("activity.emptyTitle")), false,
      "a disconnected Activity empty branch is not visible through actual Shell");
    assert.deepEqual(retired.references, before.references, "retirement is not operation completion");
    const retained = h.store.documentJobs.get()[0];
    assert.equal(retained.jobId, originalId); assert.equal(retained.error, null); assert.equal(retained.errorDetail, null);
    assert.equal(retained.result?.generationReceipt, undefined);
    assert.equal(full.renderer.markup.includes("Saved complete story"), false);
    assert.equal(full.renderer.markup.includes("The keeper checks harbor position 1."), false);
    x.assertReadOnly();

    const privateBody = "EXTRA_PRIVATE_DENIAL_BODY_" + locale;
    h.intercept = async request => {
      if (request.url !== "/api/session") return;
      const actual = await worker.request(request.url, request.init), body = await actual.json();
      assert.equal(actual.status, 403); assert.equal(body.error, "project_access_revoked");
      return Response.json({ ...body, message: privateBody, privateContent: { source: privateBody } }, { status: actual.status });
    };
    await full.act(sourceRetry(full, "banner"));
    h.intercept = null;
    const deniedRetry = x.state();
    assert.equal(deniedRetry.sourceReady, false); assert.equal(deniedRetry.activityMounted, false);
    assert.equal(deniedRetry.loading, false); sourceRetry(full, "main");
    assert.equal(deniedRetry.error, "project_access_revoked");
    assert.deepEqual(deniedRetry.alerts, [expectedAlert(full, "shell.sourceAccessRevoked")]);
    assert.equal(deniedRetry.alerts[0].includes("project_access_revoked"), false);
    assert.equal(full.renderer.markup.includes(privateBody), false, "extra denied response fields never become notice copy");
    assert.deepEqual(deniedRetry.references, before.references);
    x.assertReadOnly();

    x.setRevoked(false);
    await full.act(sourceRetry(full, "banner"));
    const restored = x.state();
    assert.equal(restored.sourceReady, true); assert.equal(restored.activityMounted, true);
    assert.equal(restored.error, ""); assert.deepEqual(restored.alerts, []);
    assert.notEqual(x.activity(), originalActivity, "actual Shell remounts Activity only after authorized source read");
    assert.deepEqual(restored.references, before.references);
    assert.ok(restored.headings.includes(full.i18n.t("activity.needsYou")));
    assert.ok(full.components().some(component => component.tag === "forma-activity-issue-panel" && component.job?.jobId === originalId),
      "the remounted real Activity issue uses the exact original job");
    x.assertReadOnly();
    // Keep the complete original denial/private/reference/recovery tails before
    // this new red-baseline verdict. A later redraw is not native Retry identity.
    assertRetirementFocus(retirementFocus);
  });

  test("genuine current ordinary-empty Activity — " + locale, { timeout: 20000 }, async t => {
    const x = await fixture(t, locale, { empty: true }), observed = x.state();
    assert.equal(observed.sourceReady, true); assert.equal(observed.activityMounted, true);
    assert.equal(observed.projectId, "ordinary-empty-project"); assert.equal(observed.documentId, "ordinary-empty-document");
    assert.deepEqual(observed.alerts, []); assert.equal(observed.error, "");
    assert.ok(observed.headings.includes(x.full.i18n.t("activity.emptyTitle")));
    assert.deepEqual(observed.references, []); assert.equal(observed.loadingPane, false);
    x.assertReadOnly();
  });
}

for (const locale of ["en", "fr"]) test("superseded actual403 cannot retire newer certified source — " + locale, { timeout: 20000 }, async t => {
  const x = await fixture(t, locale), { h, worker, full } = x;
  const before = x.state(), originalActivity = x.activity(), gate = sceneDeferred(), entered = sceneDeferred();
  let once = false;
  x.setRevoked(true);
  h.intercept = async request => {
    if (!eventRequest(request) || once) return;
    once = true;
    const denied = await worker.request(request.url, request.init);
    assert.equal(denied.status, 403); entered.resolve();
    await gate.promise; return denied;
  };
  const pending = h.store.refreshEvents().then(() => null, error => error.message);
  try {
    await entered.promise; x.setRevoked(false);
    await h.store.refreshEvents(); await full.settle();
    gate.resolve(); assert.equal(await pending, "Event stream returned 403");
    await full.settle();
    const observed = x.state();
    assert.equal(observed.sourceReady, true); assert.equal(observed.activityMounted, true);
    assert.equal(observed.error, ""); assert.deepEqual(observed.alerts, []);
    assert.equal(x.activity(), originalActivity);
    assert.deepEqual(observed.references, before.references);
    assert.ok(observed.headings.includes(full.i18n.t("activity.needsYou")));
    x.assertReadOnly();
  } finally { gate.resolve(); await pending; }
});

function liveLocale(full) {
  full.i18n.hostDisconnected();
  let deliver, revision = 0, updates = 0;
  const snapshot = locale => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr", timeZone: "UTC",
    messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] }, revision: ++revision });
  const controller = new ports.FormaLocaleController({
    addController() {},
    requestUpdate() { updates++; full.requested = true; },
    dispatchEvent(event) { deliver = event.callback; event.callback(snapshot(full.locale), () => {}); return true; },
  });
  controller.hostConnected();
  full.i18n = controller;
  for (const component of full.components()) component.i18n = controller;
  return { controller, updates: () => updates, change(locale) { full.locale = locale; deliver(snapshot(locale)); } };
}

for (const notice of ["retained", "revoked"]) test("persistent " + notice + " notice follows the same actual locale controller without another read", { timeout: 20000 }, async t => {
  const x = await fixture(t, "en"), { h, full } = x, locale = liveLocale(full);
  x.setRevoked(true);
  await assert.rejects(h.store.refreshEvents(), /403/u); await full.settle();
  if (notice === "revoked") await full.act(sourceRetry(full, "banner"));
  sourceRetry(full, "main");
  const originalError = h.store.error.get(), originalReferences = x.state().references, requests = h.requests.length;
  assert.equal(originalError, notice === "retained" ? RAW_NOTICE : "project_access_revoked");
  const key = notice === "retained" ? "shell.sourceUnavailable" : "shell.sourceAccessRevoked";
  const updates = locale.updates();
  for (const language of ["fr", "ar", "ja", "en", "fr"]) {
    locale.change(language); await full.settle();
    assert.equal(full.i18n, locale.controller, "existing controller receives the provider's new snapshot");
    assert.equal(full.i18n.locale, language);
    assert.equal(h.store.error.get(), originalError, "localization never overwrites the underlying error or owns authority");
    assert.deepEqual(x.state().alerts, [expectedAlert(full, key)]);
    assert.equal(x.state().activityMounted, false); assert.equal(x.state().sourceReady, false);
    assert.equal(x.state().loading, false); sourceRetry(full, "main");
    assert.deepEqual(x.state().references, originalReferences);
    assert.equal(h.requests.length, requests, "language changes cannot revalidate, resubmit, or run work");
    x.assertReadOnly();
  }
  assert.equal(locale.updates(), updates + 5, "real locale subscriber requested each render");
});

for (const language of ["en", "fr", "ar", "ja"]) test("only exact known notices translate; unknown and authored-looking error values remain escaped in " + language, { timeout: 20000 }, async t => {
  const x = await fixture(t, language), { h, full } = x;
  const ownership = h.store.captureSourceOwnership(), source = x.state();
  const requests = h.requests.length;
  const unknowns = [
    "new_gateway_error_2026", "project_access_revoked: retry later", " project_access_revoked ",
    "PROJECT_ACCESS_REVOKED", RAW_NOTICE + " [unclassified]", "Open document",
    "<span data-private-diagnostic>Not an app-owned notice</span>",
  ];
  for (const unknown of unknowns) {
    h.store.error.set(unknown); await full.settle();
    assert.deepEqual(x.state().alerts, [(full.i18n.t("shell.streamUnavailable") + " " + unknown + " " + full.i18n.t("action.retry")).replace(/\s+/gu, " ").trim()]);
    assert.equal(h.store.error.get(), unknown);
    assert.equal(h.store.sourceOwnershipActive(ownership), true, "error copy is not a permission or source-availability decision");
    assert.equal(x.state().sourceReady, true); assert.equal(x.state().activityMounted, true);
    assert.deepEqual(x.state().references, source.references);
    assert.equal(full.tree().nodes.some(node => Object.hasOwn(node.attributes, "data-private-diagnostic")), false);
    assert.equal(h.requests.length, requests);
    x.assertReadOnly();
  }
});


// These finite interruptions occur after the actual Shell has seen the original
// owned retirement notification and before its untouched update continuation.
const retirementInterruptions = ["outside-command", "newer-focus", "pointer", "key", "hidden-return", "blur-return", "pagehide",
  "route", "authority", "locale", "locale-return", "consent-modal", "duplicate-after-pointer"];
for (const mode of retirementInterruptions) test("owned403 retirement focus yields to " + mode, { timeout: 20000 }, async t => {
  const x = await fixture(t, "en"), { full, h, worker } = x;
  const locale = mode.startsWith("locale") ? liveLocale(full) : null;
  const witness = await retirementFocusWitness(t, x), before = x.state(), activity = x.activity(), session = h.store.session.get();
  let modalPolicy = false;
  t.after(() => { if (modalPolicy) h.store.session.set(session); });
  witness.arm(mode === "outside-command" ? retirementCommand(full) : retirementOrigin(x), {
    afterCapture: ({ event, native, command, setFocused, intent }) => {
      if (mode === "newer-focus") intent(() => native.focus(command));
      else if (mode === "pointer" || mode === "duplicate-after-pointer") native.emit("pointerdown", command);
      else if (mode === "key") retirementKey(full, native, native.document.activeElement);
      else if (mode === "hidden-return") {
        native.document.visibilityState = "hidden"; native.emit("visibilitychange");
        native.document.visibilityState = "visible"; native.emit("visibilitychange");
      } else if (mode === "blur-return") {
        setFocused(false); retirementViewEvent(h, "blur"); setFocused(true);
      } else if (mode === "pagehide") retirementViewEvent(h, "pagehide");
      else if (mode === "route") h.store.setRoute("/projects", { preserveFocus: true });
      else if (mode === "authority") {
        h.store.session.set({ ...session, permissionEpoch: "e0-newer-finite-authority" }); h.store.notify();
      } else if (mode === "locale" || mode === "locale-return") {
        locale.change("fr"); if (mode === "locale-return") locale.change("en");
      } else if (mode === "consent-modal") {
        // A declared finite policy input emits the real current consent dialog.
        // It changes no backend consent and keeps the captured authorization key.
        const authority = h.store.captureAuthorizationScope();
        modalPolicy = true; h.store.session.set({ ...session, policy: { ...session.policy, accepted: false } });
        assert.equal(h.store.authorizationScopeActive(authority), true); full.host.requestUpdate();
      }
      if (mode === "duplicate-after-pointer") {
        // Redeliver the SAME frozen actual retirement payload in a distinct
        // notification, while the original focused native control is still live.
        h.window.dispatchEvent(new CustomEvent(event.type, { detail: event.detail }));
      }
    },
  });
  x.setRevoked(true);
  assert.equal((await worker.request("/api/events?after=0&limit=2000&content=0")).status, 403);
  await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); await full.settle();
  const record = witness.finish();
  retirementCustody(x, before); assert.equal(activity.isConnected, false);
  sourceRetry(full, "main");
  if (mode === "outside-command" || mode === "newer-focus") {
    assert.equal(retirementCommand(full).port, witness.command); assert.equal(witness.native.document.activeElement, witness.command);
    assert.ok(witness.command.isConnected);
  }
  if (mode === "route") assert.equal(h.store.route.get(), "/projects");
  else assert.equal(h.store.route.get(), before.route);
  if (mode === "authority") assert.equal(h.store.authorizationScopeActive(record.beforeSource.authorization), false);
  if (mode === "locale") assert.equal(full.i18n.locale, "fr");
  if (mode === "locale-return") assert.equal(full.i18n.locale, "en");
  if (mode === "consent-modal") {
    const dialogs = full.tree().visible("dialog").filter(row => row.owner === full.host && hasClass(row, "consent-modal"));
    assert.equal(dialogs.length, 1); assert.ok(dialogs[0].port.open && dialogs[0].port.isConnected);
    assert.ok(witness.native.document.querySelectorAll("dialog[open]").includes(dialogs[0].port), "the actual guard can see the emitted open dialog");
    assert.equal(h.store.captureAuthorizationScope().key, record.beforeSource.authorization.key);
    const committed = record.draws.find(draw => draw.originDisconnected && draw.busy === "false" && draw.statuses === 1);
    assert.ok(committed, "the original draw committed the actual terminal branch before its update continuation");
    assert.ok(committed.dialogs.some(dialog => dialog.owner === full.host && dialog.consent && dialog.open && dialog.current),
      "the real consent dialog was open in that same committed draw, not introduced after the handoff checkpoint");
  }
  assert.equal(record.initialInMain, mode !== "outside-command");
  assertNoRetirementFocus(record, { events: mode === "duplicate-after-pointer" ? 2 : 1, intents: mode === "newer-focus" ? 1 : 0 });
});

for (const target of ["main", "terminal-retry"]) test("owned403 retirement does not re-focus an existing " + target, { timeout: 20000 }, async t => {
  const x = await fixture(t, "en"), { h, full } = x, witness = await retirementFocusWitness(t, x), before = x.state();
  witness.arm(retirementCommand(full)); x.setRevoked(true);
  await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); await full.settle();
  const first = witness.finish();
  witness.arm(target === "main" ? retirementMain(full) : sourceRetry(full, "main"));
  await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); await full.settle();
  const second = witness.finish(); retirementCustody(x, before); sourceRetry(full, "main");
  assertNoRetirementFocus(first); assertNoRetirementFocus(second);
  assert.equal(second.events[0].detail.generation, first.events[0].detail.generation + 1);
  assert.equal(target === "main" ? second.initialMain : second.initialStatus, true);
});

test("stale original retirement cannot rearm newer interrupted owned403 focus", { timeout: 20000 }, async t => {
  const x = await fixture(t, "en"), { h, full } = x, witness = await retirementFocusWitness(t, x), before = x.state();
  witness.arm(retirementCommand(full)); x.setRevoked(true);
  await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); await full.settle();
  const first = witness.finish();
  x.setRevoked(false); await h.store.refreshEvents(); await full.settle();
  assert.equal(h.store.routeDataReady(), true); assert.ok(x.activity()?.isConnected);
  witness.arm(retirementOrigin(x), { afterCapture: ({ native, command, event }) => {
    native.emit("pointerdown", command);
    h.window.dispatchEvent(new CustomEvent(event.type, { detail: first.events[0].detail }));
  } });
  x.setRevoked(true); await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); await full.settle();
  const second = witness.finish(); retirementCustody(x, before);
  assertNoRetirementFocus(first); assertNoRetirementFocus(second, { events: 2 });
  assert.equal(second.events[0].detail.generation, first.events[0].detail.generation + 1);
  assert.equal(second.events[1].detail, first.events[0].detail);
  assert.notEqual(second.events[1].detail.generation, second.events[1].currentGeneration);
});

test("owned403 preserves the personal Projects owner without taking its removed control focus", { timeout: 20000 }, async t => {
  const x = await fixture(t, "en", { empty: true }), { h, full, worker } = x;
  assert.equal(Boolean(h.store.session.get().projectContext), false);
  h.store.setRoute("/projects", { preserveFocus: true }); await full.settle();
  const witness = await retirementFocusWitness(t, x), before = x.state();
  const projects = full.components().filter(owner => owner.tag === "forma-projects"); assert.equal(projects.length, 1);
  const project = projects[0], rows = full.tree().visible("button").filter(row => row.owner.tag === "forma-ui-button"
    && row.owner.parentElement === project && row.owner.label === full.i18n.t("projects.new"));
  assert.equal(rows.length, 1); assert.ok(rows[0].port.closest(".projects-source-owner"));
  witness.arm(rows[0], { branch: project });
  // Reuse the existing actual missing-cohort GET denial, without replacing a
  // response, changing a principal, or submitting a project-intake action.
  const env = worker.env, key = "FORMA_PILOT_COHORT_ID", had = Object.hasOwn(env, key), previous = env[key];
  const restore = () => { if (had) env[key] = previous; else delete env[key]; }; t.after(restore);
  env[key] = "synthetic-missing-e0-retirement-cohort";
  const denied = await worker.request("/api/events?after=0&limit=2000&content=0");
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error, "pilot_participant_required");
  await assert.rejects(h.store.refreshEvents(), /Event stream returned 403/u); await full.settle();
  const record = witness.finish(); retirementCustody(x, before); sourceRetry(full, "main");
  assert.equal(project.isConnected, true); assert.equal(project.store, h.store);
  assert.equal(full.components().find(owner => owner.tag === "forma-projects"), project);
  const wrappers = full.tree().nodes.filter(row => hasClass(row, "projects-source-owner")); assert.equal(wrappers.length, 1);
  assert.ok(Object.hasOwn(wrappers[0].attributes, "hidden") && Object.hasOwn(wrappers[0].attributes, "inert"));
  assert.equal(record.origin.isConnected, false); assert.equal(record.initialProjects, true);
  assertNoRetirementFocus(record); restore();
});
