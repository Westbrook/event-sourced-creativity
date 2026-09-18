// Actual mounted Memory forms, full Shell/Store and RAM Worker originals.
// No provider request, application method replacement or fabricated success.
// The SAME original Worker response is held only after exact receipt checks.
import assert from "node:assert/strict";
import test from "node:test";
import { createSceneCostFixture } from "./helpers/scene-cost-fixture.mjs";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { createCalmFullPage, registerCalmFullPageComponents, calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";
import { observeActualSceneResumeReads } from "./helpers/actual-scene-resume-read.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { readEvents } from "../worker/runtime.ts";

const OPTIONS = { concurrency: false, timeout: 45_000 };
const inside = (node, parent) => { for (let at = node; at; at = at.parent) if (at === parent) return true; return false; };
const clientReceipts = worker => worker.sqlite.prepare("SELECT * FROM event_client_receipts ORDER BY stream_id,client_event_id").all();
async function settle(x) {
  let queues;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Original Save is a separately certified intercept below. It does not
    // enter this observer's pending map; do not join its deliberately held ACK.
    await x.resume.settleOriginalRequests();
    for (const [id, timer] of [...x.h.timers]) if (timer.delay === 16) { x.h.timers.delete(id); timer.callback(0); }
    await x.f.settle(); await x.resume.settleOriginalRequests();
    queues = { requests: x.resume.pendingOriginalCount(), frames: x.f.frames.size,
      storeFrames: [...x.h.timers.values()].filter(timer => timer.delay === 16).length, requested: Number(x.f.requested) };
    if (Object.values(queues).every(value => value === 0)) break;
  }
  assert.deepEqual(queues, { requests: 0, frames: 0, storeFrames: 0, requested: 0 });
  await x.worker.drainBackground();
}
async function page(t, kind, locale) {
  t.mock.method(globalThis, "fetch", async () => assert.fail("No external/provider transport in Memory custody"));
  const worker = await createSceneCostFixture(1, "visual");
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  h.store.loading.set(false);
  const original = { events: h.store.events.get(), head: h.store.head.get(), content: h.store.content.get() };
  const resume = observeActualSceneResumeReads(h);
  const previousHistory = globalThis.history;
  globalThis.history = { pushState(_state, _title, route) { const url = new URL(route, "http://localhost");
    Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); } };
  t.after(() => { globalThis.history = previousHistory; resume.restore(); });
  const f = await createCalmFullPage(t, { storeHost: h, locale, assistant: false });
  h.store.events.set(original.events); h.store.head.set(original.head); h.store.content.set(original.content);
  await registerCalmFullPageComponents(f, ["forma-memory", "forma-scout"]);
  f.nativeHistoryLocation = h.location; f.native = installOutputNavigationFocusNative(t, f, ports);
  h.store.setRoute("/memory"); await h.store.refreshEvents({ fromStart: true });
  const x = { f, h, worker, resume, kind }; await settle(x);
  x.owner = f.components().find(value => value.tag === "forma-memory" && value.store === h.store);
  assert.ok(x.owner instanceof f.modules.get("src/components/forma-memory.ts").FormaMemory && x.owner.isConnected);
  assert.equal(h.store.route.get(), "/memory"); assert.equal(h.store.projection.get().documentId, worker.documentId);
  assert.ok(h.store.sourceOwnershipActive(h.store.captureSourceOwnership()));
  assert.ok(h.store.authorizationScopeActive(h.store.captureAuthorizationScope()));
  t.after(() => h.close()); return x;
}
function controls(x) {
  const tree = x.f.tree(), fields = tree.visible("input").filter(node => node.owner === x.owner
    && String(node.attributes.maxlength) === (x.kind === "preference" ? "120" : "300"));
  assert.equal(fields.length, 1); const field = fields[0];
  let form = field.parent; while (form && form.tag !== "form") form = form.parent;
  assert.ok(form && form.owner === x.owner && typeof form.handlers.submit === "function");
  const selects = tree.visible("select").filter(node => node.owner === x.owner && inside(node, form));
  assert.equal(selects.length, x.kind === "preference" ? 2 : 1);
  const extra = x.kind === "condition" ? tree.visible("input").find(node => node.owner === x.owner
    && inside(node, form) && ["date", "number"].includes(node.attributes.type)) : null;
  for (const node of [form, field, ...selects, ...(extra ? [extra] : [])]) {
    assert.ok(node.port.isConnected && x.f.renderer.nodes.includes(node.port));
    assert.equal(node.port.owner, x.owner); assert.equal(node.hiddenBy, null);
  }
  assert.equal(field.port.matches(":disabled"), false);
  return { tree, form, field, selects, extra, part: field.propertyParts.value };
}
function observed(x) {
  const current = controls(x);
  return { raw: current.field.port.value, boundRaw: current.field.properties.value,
    selectors: current.selects.map(node => node.port.value), boundSelectors: current.selects.map(node => node.properties.value),
    extra: current.extra?.port.value ?? null, part: current.part, connected: x.owner.isConnected };
}
async function type(x, raw) {
  const field = controls(x).field; field.port.value = raw; await x.f.act(field, "input");
  assert.equal(controls(x).field.port.value, raw);
}
async function select(x, index, value) {
  const current = controls(x), choice = current.selects[index];
  assert.ok(choice && typeof choice.handlers.change === "function");
  choice.port.value = value; await x.f.act(choice, "change");
  assert.equal(controls(x).selects[index].port.value, value);
}
async function originalFields(x) {
  const raw = "  Original Memory A — 元の依頼  ";
  await type(x, raw);
  if (x.kind === "preference") {
    await select(x, 0, "lighting"); await select(x, 1, "forbid");
    return { raw, selectors: ["lighting", "forbid"], extra: null, axis: "lighting", polarity: "forbid" };
  }
  await select(x, 0, "on_date"); const date = controls(x).extra;
  assert.equal(date.attributes.type, "date"); date.port.value = "2026-12-31"; await x.f.act(date, "input");
  return { raw, selectors: ["on_date"], extra: "2026-12-31", triggerKind: "on_date", threshold: 3, onDate: "2026-12-31" };
}
async function newerFields(x) {
  const raw = "  Newer unsent Memory B — 未送信\n  ";
  await type(x, raw);
  if (x.kind === "preference") {
    await select(x, 0, "palette"); await select(x, 1, "affirm");
    return { raw, selectors: ["palette", "affirm"], extra: null };
  }
  await select(x, 0, "generation_count"); const count = controls(x).extra;
  assert.equal(count.attributes.type, "number"); count.port.value = "7"; await x.f.act(count, "input");
  return { raw, selectors: ["generation_count"], extra: "7" };
}
async function baseline(x) {
  await settle(x);
  return { history: await readEvents(x.worker.env, x.worker.streamId), money: financial(x.worker), receipts: clientReceipts(x.worker),
    source: x.h.store.captureSourceOwnership(), authorization: x.h.store.captureAuthorizationScope(),
    session: JSON.stringify(x.h.store.session.get()), route: x.h.store.route.get(), requests: x.h.requests.length };
}
function originalSave(x, before, input, held) {
  const prior = x.h.intercept, gate = sceneDeferred(), records = [], proofs = new WeakMap();
  const isOriginal = request => { const proof = proofs.get(request); return Boolean(proof && request.init === proof.init && request.init.body === proof.bytes); };
  let failure = null;
  const intercept = async request => {
    if (request.url !== "/api/events" || request.init.method !== "POST") return prior?.(request);
    assert.equal(records.length, 0, "Only the one deliberately submitted original Memory mutation may enter this seam");
    const record = { request, input: request.init, bytes: request.init.body, verified: false, delivered: false, body: null };
    records.push(record);
    try {
      assert.equal(x.h.store.route.get(), before.route);
      assert.ok(x.h.store.sourceOwnershipActive(before.source) && x.h.store.authorizationScopeActive(before.authorization));
      const body = JSON.parse(record.bytes);
      assert.equal(body.expectedSequence, before.history.at(-1).sequence);
      if (x.kind === "preference") {
        assert.deepEqual(Object.keys(body).sort(), ["action", "clientId", "event", "events", "expectedSequence"]);
        assert.equal(body.action, "append"); assert.equal(body.clientId, "web:lit");
        assert.equal(body.events.length, 1); assert.deepEqual(body.event, body.events[0]);
        assert.equal(body.event.type, "PreferenceAuthored");
        assert.deepEqual(Object.keys(body.event.payload).sort(), ["axis", "polarity", "preference_id", "scope", "source_claim_ref", "value"]);
        assert.match(body.event.payload.preference_id, /^[0-9a-f-]{36}$/iu);
        assert.deepEqual(body.event.payload, { preference_id: body.event.payload.preference_id, axis: input.axis,
          value: input.raw.trim(), polarity: input.polarity, scope: "account", source_claim_ref: null });
      } else {
        assert.deepEqual(body, { action: "set_condition", expectedSequence: before.history.at(-1).sequence,
          clientId: "web:memory", condition: input.raw.trim(), triggerKind: input.triggerKind, threshold: input.threshold, onDate: input.onDate });
      }
      const response = await x.worker.request(request.url, request.init);
      assert.equal(response.status, 200); const returned = await response.clone().json();
      assert.equal(response.bodyUsed, false); assert.deepEqual(returned.rejected, []);
      assert.deepEqual(Object.keys(returned).sort(), x.kind === "preference" ? ["appended", "head", "rejected"] : ["appended", "content", "head", "rejected"]);
      assert.equal(returned.appended.length, x.kind === "preference" ? 1 : 2);
      for (const [index, event] of returned.appended.entries()) {
        assert.equal(event.streamId, x.worker.streamId); assert.equal(event.actor, "user");
        assert.equal(event.clientId, body.clientId); assert.equal(event.sequence, body.expectedSequence + index + 1);
        assert.ok(typeof event.eventId === "string" && event.eventId.length);
      }
      assert.equal(returned.head, returned.appended.at(-1).sequence);
      if (x.kind === "preference") {
        assert.equal(returned.appended[0].type, "PreferenceAuthored"); assert.deepEqual(returned.appended[0].payload, body.event.payload);
      } else {
        const [deferred, condition] = returned.appended;
        assert.equal(deferred.type, "Deferred"); assert.equal(condition.type, "ConditionSet");
        assert.equal(condition.causationId, deferred.eventId);
        assert.equal(deferred.payload.object_ref, x.worker.documentId); assert.equal(condition.payload.target_ref, x.worker.documentId);
        assert.equal(condition.payload.scope, "project"); assert.equal(condition.payload.created_sequence, condition.sequence);
        assert.equal(typeof condition.payload.condition_id, "string"); assert.ok(condition.payload.condition_id);
        assert.equal(deferred.payload.condition_id, condition.payload.condition_id);
        assert.equal(deferred.payload.condition_ref, condition.payload.condition_ref);
        for (const event of [deferred, condition]) {
          assert.equal(event.payload.trigger_kind, input.triggerKind); assert.equal(event.payload.threshold, null);
          assert.equal(event.payload.fire_on, input.onDate);
        }
        assert.deepEqual(returned.content, { [condition.payload.condition_ref]: input.raw.trim() });
      }
      await x.worker.drainBackground();
      assert.deepEqual(await readEvents(x.worker.env, x.worker.streamId), [...before.history, ...returned.appended]);
      assert.deepEqual(financial(x.worker), before.money); assert.deepEqual(clientReceipts(x.worker), before.receipts);
      assert.equal(request.init, record.input); assert.equal(request.init.body, record.bytes);
      proofs.set(request, { init: record.input, bytes: record.bytes }); record.body = returned; record.verified = true;
      assert.equal(isOriginal({ ...request }), false, "Copied request identity cannot borrow an original-write certificate");
      if (held) await gate.promise;
      record.delivered = true; return response;
    } catch (error) { failure = error; throw error; }
  };
  x.h.intercept = intercept;
  return { records, isOriginal, release: () => gate.resolve(),
    async reached() { await untilScene(() => failure || records[0]?.verified, "The exact current Memory Save reaches and verifies its genuine original Worker receipt"); if (failure) throw failure; return records[0]; },
    restore() { if (x.h.intercept === intercept) x.h.intercept = prior; } };
}
async function exactEffects(x, before, original) {
  await settle(x); assert.equal(original.records.length, 1);
  const record = original.records[0]; assert.ok(record.verified && original.isOriginal(record.request));
  assert.deepEqual(await readEvents(x.worker.env, x.worker.streamId), [...before.history, ...record.body.appended]);
  assert.deepEqual(financial(x.worker), before.money); assert.deepEqual(clientReceipts(x.worker), before.receipts);
  assert.equal(JSON.stringify(x.h.store.session.get()), before.session);
  assert.ok(x.h.store.sourceOwnershipActive(before.source) && x.h.store.authorizationScopeActive(before.authorization));
  assert.deepEqual(x.h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !original.isOriginal(row) && !x.resume.isReadOnlyResume(row)), [],
    "Only this same original Memory write plus independently certified free Resume; no rerun, navigation write, paid work or provider request");
}
async function depart(x) {
  const link = x.f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement?.tag === "forma-area-navigation" && node.attributes.href === "/scout");
  assert.ok(link.port.isConnected); x.f.native.emit("pointerdown", link.port); x.f.native.focus(link.port);
  await x.f.act(link, "click", { button: 0, defaultPrevented: false }); await settle(x);
}
for (const [kind, locale] of [["preference", "en"], ["condition", "ja"]]) for (const state of ["unchanged", "newer"])
test("C Memory original Save custody / " + kind + " / " + state + " / " + locale, OPTIONS, async t => {
  const x = await page(t, kind, locale), input = await originalFields(x), part = controls(x).part;
  const before = await baseline(x), original = originalSave(x, before, input, state === "newer");
  const submission = controls(x), buttons = submission.tree.visible("button").filter(node => node.owner === x.owner && inside(node, submission.form) && (node.attributes.type ?? "submit") === "submit");
  assert.equal(buttons.length, 1); assert.equal(buttons[0].port.matches(":disabled"), false);
  const pending = x.f.act(submission.form, "submit"); void pending.catch(() => {});
  let expected = { raw: "", selectors: input.selectors, extra: input.extra };
  try {
    const record = await original.reached();
    if (state === "newer") {
      assert.equal(record.delivered, false); assert.equal(x.resume.pendingOriginalCount(), 0, "One certified held intercept, no held observer/GET pipeline");
      assert.equal(x.h.store.events.get().some(event => record.body.appended.some(row => row.eventId === event.eventId)), false);
      expected = await newerFields(x); const local = observed(x);
      assert.equal(local.raw, expected.raw); assert.deepEqual(local.selectors, expected.selectors); assert.equal(local.extra, expected.extra);
      assert.equal(local.part, part); assert.equal(x.owner.isConnected, true);
      await exactEffects(x, before, original); assert.equal(record.delivered, false);
    }
    original.release(); await pending; await settle(x); await exactEffects(x, before, original);
    assert.equal(record.delivered, true);
    assert.ok(record.body.appended.every(event => x.h.store.events.get().some(row => row.eventId === event.eventId)));
    const after = observed(x);
    t.diagnostic("C_MEMORY_ORIGINAL_SAVE " + JSON.stringify({ kind, state, locale, genuineStatus: 200,
      sameOriginalCount: original.records.length, sameOwner: x.owner.isConnected, samePart: after.part === part,
      raw: after.raw, expectedRaw: expected.raw, selectors: after.selectors, expectedSelectors: expected.selectors,
      extra: after.extra, expectedExtra: expected.extra, onlyExactHistoryAndFiscal: true,
      evidence: "Actual Memory form/Shell/Store/RAM Worker; response clone adds delay; finite native ports, not physical browser" }));
    assert.equal(after.part, part); assert.equal(after.raw, expected.raw, "Positive original ACK clears unchanged A only; it cannot consume newer native B");
    assert.equal(after.boundRaw, expected.raw); assert.deepEqual(after.selectors, expected.selectors);
    assert.deepEqual(after.boundSelectors, expected.selectors); assert.equal(after.extra, expected.extra);
    const requestCount = x.h.requests.length; await depart(x); await exactEffects(x, before, original);
    if (state === "unchanged") {
      assert.equal(x.h.store.route.get(), "/scout", "Acknowledged nondefault selectors are clean, not a permanent touched/default blocker");
      assert.equal(x.owner.isConnected, false);
    } else {
      assert.equal(x.h.store.route.get(), before.route); assert.equal(x.owner.isConnected, true);
      assert.equal(x.h.requests.length, requestCount); assert.equal(observed(x).raw, expected.raw);
    }
  } finally { original.release(); await pending; original.restore(); await settle(x); }
});

// Separate pending-only controls; the original four Save bodies stay exact.
for (const [kind, locale] of [["preference", "en"], ["condition", "ja"]])
test("C Memory pending original owns departure after local clearing / " + kind + " / " + locale, OPTIONS, async t => {
  const x = await page(t, kind, locale), input = await originalFields(x), part = controls(x).part;
  const before = await baseline(x), original = originalSave(x, before, input, true);
  const submission = controls(x), buttons = submission.tree.visible("button").filter(node => node.owner === x.owner && inside(node, submission.form) && (node.attributes.type ?? "submit") === "submit");
  assert.equal(buttons.length, 1); assert.equal(buttons[0].port.matches(":disabled"), false);
  const pending = x.f.act(submission.form, "submit"); void pending.catch(() => {});
  try {
    const record = await original.reached(); assert.equal(record.delivered, false);
    await type(x, "");
    if (kind === "preference") { await select(x, 0, "style"); await select(x, 1, "affirm"); }
    else {
      const date = controls(x).extra; assert.equal(date.attributes.type, "date");
      date.port.value = ""; await x.f.act(date, "input"); await select(x, 0, "generation_count");
    }
    const clean = kind === "preference" ? { selectors: ["style", "affirm"], extra: null }
      : { selectors: ["generation_count"], extra: "3" };
    const current = observed(x); assert.equal(current.raw, ""); assert.equal(current.part, part);
    assert.deepEqual(current.selectors, clean.selectors); assert.equal(current.extra, clean.extra);
    await exactEffects(x, before, original);
    assert.equal(record.delivered, false); assert.equal(x.resume.pendingOriginalCount(), 0);
    assert.equal(x.h.store.events.get().some(event => record.body.appended.some(row => row.eventId === event.eventId)), false);
    const requests = x.h.requests.length, events = JSON.stringify(x.h.store.events.get()), head = x.h.store.head.get();
    const focus = x.f.native.nativeFocus.length;
    await depart(x); await exactEffects(x, before, original);
    t.diagnostic("C_MEMORY_PENDING_ONLY " + JSON.stringify({ kind, locale, originalVerified: record.verified,
      originalDelivered: record.delivered, route: x.h.store.route.get(), expectedRoute: before.route,
      sameOwner: x.owner.isConnected, cleanBeforeDeparture: current,
      requestsAfterGesture: x.h.requests.length - requests, originalWrites: original.records.length,
      evidence: "Actual held original response and current native clear; no application pending-field substitution" }));
    assert.equal(x.h.store.route.get(), before.route, "Visible clearing does not cancel a still-pending original Save");
    assert.ok(x.owner.isConnected); assert.equal(x.h.requests.length, requests);
    assert.equal(JSON.stringify(x.h.store.events.get()), events); assert.equal(x.h.store.head.get(), head);
    assert.equal(x.h.store.ui.toast, x.f.i18n.t("next.lifecycle.currentWorkOpen"));
    assert.equal(x.f.native.nativeFocus.slice(focus).some(row => row.node.owner?.tag === "forma-scout"), false);
    assert.equal(record.delivered, false); assert.equal(observed(x).raw, ""); assert.equal(observed(x).part, part);
    original.release(); await pending; await settle(x); await exactEffects(x, before, original);
    const retained = observed(x); assert.equal(retained.raw, "");
    assert.deepEqual(retained.selectors, clean.selectors); assert.equal(retained.extra, clean.extra);
    // A's positive ACK establishes its own original selector baseline. Explicitly
    // restore those keys; never treat the intervening clear as a new Save.
    if (kind === "preference") { await select(x, 0, input.selectors[0]); await select(x, 1, input.selectors[1]); }
    else {
      await select(x, 0, "on_date"); const date = controls(x).extra;
      date.port.value = input.extra; await x.f.act(date, "input");
    }
    const resolved = observed(x); assert.equal(resolved.raw, ""); assert.deepEqual(resolved.selectors, input.selectors);
    assert.equal(resolved.extra, input.extra);
    await depart(x); await exactEffects(x, before, original);
    assert.equal(x.h.store.route.get(), "/scout"); assert.equal(x.owner.isConnected, false);
    assert.equal(original.records.length, 1); assert.equal(record.delivered, true);
  } finally { original.release(); await pending; original.restore(); await settle(x); }
});

// Additive visible-resolution controls. Reuse the complete Memory/Shell/Worker
// fixture above; no new renderer, private accessor, response or request allowlist.
// Memory-only native prerequisite. Reuse the existing committed full-page
// ancestry and its literal form query adapter; add only the unsupported
// class-ancestor + form selector. No new renderer, cached draft or app method.
async function memoryDiscardPage(t, kind, locale) {
  const x = await page(t, kind, locale), renderer = x.f.renderer, previous = renderer.query;
  const query = function(owner, selector) {
    if (owner !== x.owner || selector !== ".preference-author form") return previous.call(this, owner, selector);
    if (!owner.isConnected) return [];
    assert.ok(!renderer.updatingOwner, "Memory descendant queries inspect a complete committed native tree");
    const tree = x.f.tree();
    if (!tree.nodes.some(node => node.component === owner)) return [];
    return tree.nodes.filter(node => {
      if (node.tag !== "form" || node.owner !== owner || !node.port?.isConnected || !renderer.nodes.includes(node.port)) return false;
      for (let parent = node.parent; parent; parent = parent.parent)
        if (parent.owner === owner && parent.port?.isConnected && parent.port.classList.contains("preference-author")) return true;
      return false;
    }).map(node => node.port);
  };
  renderer.query = query;
  t.after(() => { if (renderer.query === query) renderer.query = previous; });
  return x;
}
function memorySubmitControl(x) {
  const current = controls(x);
  const buttons = current.tree.visible("button").filter(node => node.owner === x.owner
    && inside(node, current.form) && (node.attributes.type ?? "submit") === "submit");
  assert.equal(buttons.length, 1, "retain the one actual native form submit");
  return { ...current, submit: buttons[0] };
}
function memoryDiscardControl(x, disabled = false) {
  const current = controls(x), label = x.f.i18n.t("workspace.admin.discardPolicy", "Discard unsaved changes");
  const buttons = current.tree.visible("button").filter(node => node.owner === x.owner
    && inside(node, current.form) && node.attributes.type === "button" && node.text.trim() === label);
  assert.equal(buttons.length, 1, "the exact Memory form offers a visible no-write Discard, not remembered clean keys");
  const button = buttons[0];
  assert.ok(button.port.isConnected && x.f.renderer.nodes.includes(button.port));
  assert.strictEqual(x.owner.querySelector(x.kind === "preference" ? ".preference-author form" : ".condition-author"), current.form.port,
    "the current owner resolves this exact native form, not its section or sibling");
  assert.strictEqual(button.port.closest("form"), current.form.port);
  assert.strictEqual(current.form.port.querySelector(".memory-discard"), button.port,
    "the current native form resolves only its own Discard descendant");
  assert.equal(button.port.matches(":disabled"), disabled);
  assert.equal(button.attributes["aria-label"], x.f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
    action: label, name: x.f.i18n.system(x.kind === "preference" ? "Specific preference" : "Conditions & resurfacing"),
  }), "the native name identifies this form without another label policy");
  return button;
}
async function memoryDiscard(x) {
  const button = memoryDiscardControl(x);
  x.f.native.emit("pointerdown", button.port); x.f.native.focus(button.port);
  await x.f.act(button, "click"); await settle(x);
}
async function memoryNoWriteEffects(x, before) {
  await settle(x);
  assert.deepEqual(await readEvents(x.worker.env, x.worker.streamId), before.history);
  assert.deepEqual(financial(x.worker), before.money); assert.deepEqual(clientReceipts(x.worker), before.receipts);
  assert.equal(JSON.stringify(x.h.store.session.get()), before.session);
  assert.ok(x.h.store.sourceOwnershipActive(before.source) && x.h.store.authorizationScopeActive(before.authorization));
  assert.deepEqual(x.h.requests.slice(before.requests).filter(row => (row.init.method ?? "GET") !== "GET"
    && !x.resume.isReadOnlyResume(row)), [], "only the unchanged exact read-only Resume certificate may admit a non-GET");
}

test("C Memory visible resolution / pristine ordinary forms leave without a write / en", OPTIONS, async t => {
  const x = await memoryDiscardPage(t, "preference", "en"), sibling = { ...x, kind: "condition" }, before = await baseline(x);
  assert.equal(observed(x).raw, ""); assert.deepEqual(observed(x).selectors, ["style", "affirm"]);
  assert.equal(observed(sibling).raw, ""); assert.deepEqual(observed(sibling).selectors, ["generation_count"]);
  assert.equal(observed(sibling).extra, "3");
  assert.equal(memorySubmitControl(x).submit.port.matches(":disabled"), true);
  assert.equal(memorySubmitControl(sibling).submit.port.matches(":disabled"), true);
  await depart(x); await memoryNoWriteEffects(x, before);
  assert.equal(x.h.store.route.get(), "/scout"); assert.equal(x.owner.isConnected, false);
});

for (const [kind, locale] of [["preference", "fr"], ["condition", "ja"]])
test("C Memory visible resolution / selection-only " + kind + " / " + locale, OPTIONS, async t => {
  const x = await memoryDiscardPage(t, kind, locale), before = await baseline(x), part = controls(x).part;
  if (kind === "preference") { await select(x, 0, "lighting"); await select(x, 1, "forbid"); }
  else {
    await select(x, 0, "on_date"); const date = controls(x).extra;
    assert.equal(date.attributes.type, "date"); date.port.value = "2031-01-02"; await x.f.act(date, "input");
    await select(x, 0, "generation_count");
    assert.equal(controls(x).extra.attributes.type, "number"); assert.equal(observed(x).extra, "3");
  }
  const dirty = observed(x); assert.equal(dirty.raw, ""); assert.equal(dirty.part, part);
  assert.equal(memorySubmitControl(x).submit.port.matches(":disabled"), true);
  await memoryNoWriteEffects(x, before); const requests = x.h.requests.length;
  await depart(x); await memoryNoWriteEffects(x, before);
  assert.equal(x.h.store.route.get(), before.route); assert.ok(x.owner.isConnected);
  assert.equal(x.h.requests.length, requests); assert.deepEqual(observed(x), dirty);
  assert.equal(x.h.store.ui.toast, x.f.i18n.t("next.lifecycle.currentWorkOpen"));
  t.diagnostic("C_MEMORY_LOCAL_RESOLUTION " + JSON.stringify({ kind, locale,
    visible: { raw: dirty.raw, selectors: dirty.selectors, extra: dirty.extra },
    hiddenDateWasAuthored: kind === "condition", guardedBeforeDiscard: true, originalRequests: 0 }));
  await memoryDiscard(x); await memoryNoWriteEffects(x, before);
  assert.equal(x.h.store.route.get(), before.route); assert.equal(x.h.requests.length, requests);
  assert.equal(observed(x).raw, ""); assert.equal(observed(x).part, part);
  assert.deepEqual(observed(x).selectors, kind === "preference" ? ["style", "affirm"] : ["generation_count"]);
  assert.equal(observed(x).extra, kind === "preference" ? null : "3");
  await depart(x); await memoryNoWriteEffects(x, before);
  assert.equal(x.h.store.route.get(), "/scout", "Discard also clears the inactive date branch; fresh departure is usable");
  assert.equal(x.owner.isConnected, false);
});

for (const [kind, locale] of [["preference", "en"], ["condition", "ar"]])
test("C Memory visible resolution / last positive " + kind + " and independent sibling / " + locale, OPTIONS, async t => {
  const x = await memoryDiscardPage(t, kind, locale), input = await originalFields(x), before = await baseline(x);
  const original = originalSave(x, before, input, false), pending = x.f.act(controls(x).form, "submit");
  void pending.catch(() => {});
  try {
    const record = await original.reached(); await pending; await exactEffects(x, before, original);
    assert.equal(record.delivered, true); assert.equal(observed(x).raw, "");
    const part = controls(x).part; await newerFields(x);
    const sibling = { ...x, kind: kind === "preference" ? "condition" : "preference" };
    await newerFields(sibling); const siblingRaw = observed(sibling);
    await exactEffects(x, before, original); const requests = x.h.requests.length;
    await depart(x); assert.equal(x.h.store.route.get(), before.route); assert.ok(x.owner.isConnected);
    assert.equal(x.h.requests.length, requests);
    await memoryDiscard(x); await exactEffects(x, before, original);
    assert.equal(x.h.requests.length, requests); assert.equal(observed(x).raw, ""); assert.equal(observed(x).part, part);
    assert.deepEqual(observed(x).selectors, input.selectors); assert.equal(observed(x).extra, input.extra);
    assert.deepEqual(observed(sibling), siblingRaw, "discarding one form never clears its sibling");
    await depart(x); assert.equal(x.h.store.route.get(), before.route); assert.equal(x.h.requests.length, requests);
    await memoryDiscard(sibling); await exactEffects(x, before, original);
    assert.equal(x.h.requests.length, requests); assert.equal(observed(sibling).raw, "");
    assert.deepEqual(observed(sibling).selectors, sibling.kind === "preference" ? ["style", "affirm"] : ["generation_count"]);
    assert.equal(observed(sibling).extra, sibling.kind === "preference" ? null : "3");
    await depart(x); await exactEffects(x, before, original);
    assert.equal(x.h.store.route.get(), "/scout"); assert.equal(x.owner.isConnected, false);
    assert.equal(original.records.length, 1, "local Discard neither revokes nor resubmits the positive original");
  } finally { original.release(); await pending; original.restore(); await settle(x); }
});

test("C Memory visible resolution / pending original waits, then current Discard resolves newer B / ja", OPTIONS, async t => {
  const x = await memoryDiscardPage(t, "condition", "ja"), input = await originalFields(x), before = await baseline(x);
  const original = originalSave(x, before, input, true), pending = x.f.act(controls(x).form, "submit");
  void pending.catch(() => {});
  try {
    const record = await original.reached(); assert.equal(record.delivered, false);
    await newerFields(x); const newer = observed(x); await exactEffects(x, before, original);
    const requests = x.h.requests.length;
    await depart(x); assert.equal(x.h.store.route.get(), before.route); assert.ok(x.owner.isConnected);
    assert.equal(x.h.requests.length, requests); assert.deepEqual(observed(x), newer);
    memoryDiscardControl(x, true); // Native disabled state; do not invoke a disabled handler artificially.
    assert.equal(record.delivered, false); assert.equal(original.records.length, 1);
    original.release(); await pending; await exactEffects(x, before, original);
    assert.equal(record.delivered, true); assert.deepEqual(observed(x), newer, "ACK still cannot consume B");
    const afterAckRequests = x.h.requests.length;
    await memoryDiscard(x); await exactEffects(x, before, original);
    assert.equal(x.h.requests.length, afterAckRequests); assert.equal(x.h.store.route.get(), before.route);
    assert.equal(observed(x).raw, ""); assert.deepEqual(observed(x).selectors, input.selectors);
    assert.equal(observed(x).extra, input.extra);
    await depart(x); await exactEffects(x, before, original);
    assert.equal(x.h.store.route.get(), "/scout"); assert.equal(x.owner.isConnected, false);
    assert.equal(original.records.length, 1);
  } finally { original.release(); await pending; original.restore(); await settle(x); }
});

test("C Memory visible resolution / native Save and Discard share one wrapping action cell", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/components/forma-memory.ts", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  for (const [method, kind, label] of [["#authorPreference", "preference", "Save preference"], ["#setCondition", "condition", "Set time policy"]]) {
    const marker = "@submit=" + "$" + "{this." + method + "}";
    const start = source.indexOf(marker), end = source.indexOf("</form>", start);
    assert.ok(start >= 0 && end > start); assert.equal(source.indexOf(marker, start + marker.length), -1);
    const form = source.slice(start, end);
    const group = form.match(/<div class="platform-form-actions">([\s\S]*?)<\/div>$/u);
    assert.ok(group, "both actions occupy one existing shared grid cell, not a fifth direct form column");
    assert.equal((group[1].match(/<button\b/gu) ?? []).length, 1, "the unchanged Save is the group's direct submit");
    assert.ok(group[1].includes(label + "</button>"));
    assert.ok(group[1].endsWith("$" + "{this.#discardControl(" + JSON.stringify(kind) + ")}"));
    assert.equal((form.match(/<button\b/gu) ?? []).length, 1, "no duplicate direct Save or independent peer column");
  }
  const group = css.match(/^\.platform-form-actions \{([^}]+)\}/mu)?.[1];
  const peers = css.match(/^\.platform-form-actions > \.button \{([^}]+)\}/mu)?.[1];
  assert.ok(group && peers, "reuse the installed shared action row, not new Memory CSS");
  for (const declaration of ["display: flex;", "min-inline-size: 0;", "grid-column: 1 / -1;", "flex-wrap: wrap;", "align-items: stretch;"])
    assert.ok(group.includes(declaration), declaration);
  for (const declaration of ["flex: 0 1 auto;", "min-block-size: var(--forma-control-min-size, 2.75rem);", "max-inline-size: 100%;", "white-space: normal;", "overflow-wrap: anywhere;"])
    assert.ok(peers.includes(declaration), declaration);
});

test("C Memory finite native form queries preserve exact current ancestry and retirement", OPTIONS, async t => {
  const x = await memoryDiscardPage(t, "preference", "en"), sibling = { ...x, kind: "condition" };
  const before = await baseline(x), preference = controls(x), condition = controls(sibling);
  assert.notStrictEqual(preference.form.port, condition.form.port);
  assert.strictEqual(x.owner.querySelector(".preference-author form"), preference.form.port);
  assert.deepEqual(x.owner.querySelectorAll(".preference-author form"), [preference.form.port]);
  assert.strictEqual(x.owner.querySelector(".condition-author"), condition.form.port);
  assert.strictEqual(preference.field.port.closest("form"), preference.form.port);
  assert.strictEqual(condition.field.port.closest("form"), condition.form.port);
  assert.strictEqual(preference.form.port.querySelector("input"), preference.field.port);
  assert.strictEqual(condition.form.port.querySelector("input"), condition.field.port);
  assert.deepEqual(preference.form.port.querySelectorAll("input"), [preference.field.port]);
  assert.deepEqual(condition.form.port.querySelectorAll("input"), [condition.field.port, condition.extra.port]);
  assert.equal(condition.form.port.querySelector(".preference-author form"), null, "a native form cannot query its sibling");
  assert.equal(preference.form.port.querySelector(".condition-author"), null);
  assert.equal(preference.form.port.contains(condition.field.port), false);
  assert.equal(condition.form.port.contains(preference.field.port), false);
  const raw = observed(x), siblingRaw = observed(sibling), focusCount = x.f.native.nativeFocus.length;
  const requests = x.h.requests.length;
  await settle(x); // Existing real render settlement; no synthetic replacement or currentness assignment.
  const current = controls(x), currentSibling = controls(sibling);
  assert.notStrictEqual(current.form.port, preference.form.port);
  assert.equal(preference.form.port.isConnected, false); assert.equal(condition.form.port.isConnected, false);
  assert.strictEqual(x.owner.querySelector(".preference-author form"), current.form.port);
  assert.strictEqual(x.owner.querySelector(".condition-author"), currentSibling.form.port);
  assert.equal(preference.form.port.querySelector("input"), null, "retired literal form cannot borrow a current field");
  assert.equal(condition.form.port.querySelector("input"), null);
  assert.deepEqual(observed(x), raw); assert.deepEqual(observed(sibling), siblingRaw);
  assert.equal(x.f.native.nativeFocus.length, focusCount); assert.equal(x.h.requests.length, requests);
  await memoryNoWriteEffects(x, before);
  await depart(x); await memoryNoWriteEffects(x, before);
  assert.equal(x.h.store.route.get(), "/scout"); assert.equal(x.owner.isConnected, false);
  assert.equal(x.owner.querySelector(".preference-author form"), null);
  assert.equal(x.owner.querySelector(".condition-author"), null);
});

test("C Memory condition fields keep three wide tracks above one full-span action row", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/components/forma-memory.ts", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const shared = await readFile(new URL("../src/design-system.css", import.meta.url), "utf8");
  const marker = '<form class="condition-author" @submit=' + "$" + "{this.#setCondition}>";
  const start = source.indexOf(marker), end = source.indexOf("</form>", start);
  assert.ok(start >= 0 && end > start); assert.equal(source.indexOf(marker, start + marker.length), -1);
  const form = source.slice(start, end);
  const alternative = form.match(/\$\{this\.#trigger === "generation_count" \? html`(<label>Count[\s\S]*?<\/label>)` : html`(<label>Date[\s\S]*?<\/label>)`\}/u);
  assert.ok(alternative, "the existing conditional renders Count or Date, never both as separate field cells");
  for (const branch of [alternative[1], alternative[2]]) {
    const chosen = form.replace(alternative[0], () => branch);
    assert.equal((chosen.match(/<label\b/gu) ?? []).length, 3, "copy, When and the chosen Count/Date are exactly three field cells");
    assert.equal((chosen.match(/<\/label>/gu) ?? []).length, 3);
  }
  const wide = styles.match(/^\.condition-author \{([^}]+)\}/mu)?.[1];
  assert.ok(wide);
  assert.equal(wide.match(/grid-template-columns:\s*([^;]+);/u)?.[1], "minmax(220px,1fr) 150px 100px",
    "preserve original field widths without the obsolete empty fourth action track");
  for (const declaration of ["display: grid;", "align-items: end;", "gap: 7px;"]) assert.ok(wide.includes(declaration));
  assert.equal((form.match(/<div class="platform-form-actions">/gu) ?? []).length, 1);
  assert.ok(form.endsWith("$" + '{this.#discardControl("condition")}</div>'));
  const actions = shared.match(/^\.platform-form-actions \{([^}]+)\}/mu)?.[1];
  assert.ok(actions?.includes("grid-column: 1 / -1;"), "the one action row aligns with all three field tracks");
  assert.ok(styles.includes(".condition-author { grid-template-columns: 1fr 1fr; }"));
  assert.ok(shared.includes(".condition-author { grid-template-columns: repeat(2, minmax(0, 1fr)); }"));
  assert.ok(shared.includes(".condition-author,\n  .taste-signal,\n  .spatial-box-fields,\n  .spatial-scope-actions { grid-template-columns: minmax(0, 1fr); }"),
    "the existing narrow two-/one-column rules remain, without a new breakpoint or layout framework");
});
