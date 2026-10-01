// Full actual PlatformShell/Product/Delivery/Assistant and RAM Worker. Raw
// fields/defaults use the existing exact native FormData/template-lifetime port.
// Header hard navigation is an observed native request, not a second app mount.
import assert from "node:assert/strict";
import test from "node:test";
import { sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { financial } from "./helpers/event-source-retirement-fixture.mjs";
import { setLocale } from "./helpers/product-delivery-owner-choice-fixture.mjs";
import { calmFullPageNativePorts as ports } from "./helpers/calm-full-page-fixture.mjs";
import { originalDraft, posts, canonical, currentDelivery, currentCreate, submitCurrent,
  platformDeliveryFixture } from "./helpers/product-platform-fragment-fixture.mjs";

const options = { concurrency: false, timeout: 45000 };
const classed = (node, name) => String(node.attributes?.class ?? "").split(/\s+/u).includes(name);
const inside = (node, parent) => { for (let current = node; current; current = current.parent) if (current === parent) return true; return false; };
const rawValues = (f, form) => {
  const entries = f.values(form), values = new Map(entries);
  return { title: String(values.get("title") ?? ""), audience: String(values.get("audience") ?? ""),
    evidence: String(values.get("evidence") ?? ""), ownerUserId: String(values.get("ownerUserId") ?? ""),
    dependencies: entries.filter(([name]) => name === "dependencies").map(([, value]) => String(value)) };
};
const creatorState = f => ({ route: f.store.route.get(), events: structuredClone(f.store.events.get()),
  content: structuredClone(f.store.content.get()), head: f.store.head.get() });
function emit(f, type, target) {
  for (const listener of [...(f.listeners.get(type) ?? [])]) listener({ type, target,
    currentTarget: ports.documentPort, preventDefault() {}, stopPropagation() {}, composedPath: () => [target, ports.documentPort] });
}
function gesture(f, node) {
  assert.ok(node.isConnected && f.renderer.nodes.includes(node));
  emit(f, "pointerdown", node); ports.documentPort.activeElement = node; node.focus(); emit(f, "focusin", node);
}
async function page(t) {
  const f = await platformDeliveryFixture(t), current = currentCreate(f);
  f.departureAssignments = []; f.departureNewTabs = []; f.departureDispatch = new WeakSet();
  f.nativeLocationAssign = value => { assert.ok(["/projects", "/settings"].includes(value)); f.departureAssignments.push(value); };
  const defaults = rawValues(f, current.form);
  const tree = f.tree(), forms = tree.visible("form").filter(node => node.port === current.form);
  assert.equal(forms.length, 1);
  const audiences = tree.visible("select").filter(node => inside(node, forms[0]) && node.attributes.name === "audience");
  assert.equal(audiences.length, 1);
  const emitted = tree.nodes.filter(node => node.tag === "option" && inside(node, audiences[0]));
  assert.ok(emitted.length > 1); assert.equal(defaults.audience, emitted[0].attributes.value,
    "The healthy nonempty audience is the actual native first-option default, not a presumed Product value");
  assert.equal(defaults.title, ""); assert.equal(defaults.evidence, ""); assert.equal(defaults.ownerUserId, "");
  assert.deepEqual(defaults.dependencies, []);
  assert.equal(current.owner.parentElement.parentElement, f.host);
  return Object.assign(f, { departureOwner: current.owner, departureForm: current.form, departureDefaults: defaults,
    departureSource: creatorState(f), departureMoney: financial(f.storeHost.worker), departureCounts: f.storeHost.worker.counts(),
    departureSession: f.platformSession.get() });
}
function anchor(f, kind) {
  f.draw();
  const rows = f.tree().visible("a").filter(node => kind === "task"
    ? node.owner.tag === "forma-ui-audience-navigation" && node.owner.parentElement === f.host && node.attributes.href === "/product/insights"
    : node.owner === f.host && classed(node, "brand") && node.attributes.href === "/projects");
  assert.equal(rows.length, 1, "one current real " + kind + " navigation anchor"); return rows[0];
}
async function activate(f, kind, { modified = false } = {}) {
  const row = anchor(f, kind), owner = row.owner;
  if (owner.tag === "forma-ui-audience-navigation" && !f.departureDispatch.has(owner)) {
    // Existing ElementPort dispatch invokes the real bound parent handler but
    // always returns true. Supply only the native cancelable return contract on
    // this actual navigation instance. No app handler/result is substituted.
    const dispatch = owner.dispatchEvent;
    owner.dispatchEvent = function (event) {
      const result = dispatch.call(this, event);
      return event.cancelable && event.defaultPrevented ? false : result;
    };
    f.departureDispatch.add(owner);
  }
  gesture(f, row.port);
  const event = { type: "click", target: row.port, currentTarget: row.port, button: 0, metaKey: modified,
    ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, composedPath: () => [row.port, owner, f.host] };
  row.handlers.click?.call(owner, event);
  if (!event.defaultPrevented) {
    // The finite native port does not follow anchors. Model only this current
    // emitted href's default request; never infer a mounted destination here.
    if (modified) f.departureNewTabs.push(row.attributes.href);
    else { assert.equal(kind, "header", "the actual task handler must cancel its native default"); f.nativeLocationAssign(row.attributes.href); }
  }
  await f.flush(); return event;
}
function writeRaw(f, changes) {
  const current = currentCreate(f), before = rawValues(f, current.form), next = { ...before, ...changes };
  const tree = f.tree(), forms = tree.visible("form").filter(node => node.port === current.form); assert.equal(forms.length, 1);
  for (const [name, value] of Object.entries(changes)) {
    const fields = tree.nodes.filter(node => inside(node, forms[0]) && ["input", "textarea", "select"].includes(node.tag) && node.attributes.name === name);
    if (name === "dependencies" && value.length === 0 && fields.length === 0) continue;
    assert.equal(fields.length, 1); const field = fields[0];
    assert.ok(field.port.isConnected && !field.hiddenBy && !Object.hasOwn(field.attributes, "disabled"));
    if (field.tag === "select") for (const selected of Array.isArray(value) ? value : [value])
      assert.ok(tree.nodes.some(node => node.tag === "option" && inside(node, field) && node.attributes.value === selected
        && !Object.hasOwn(node.attributes, "disabled")), "only an actual enabled native option is chosen");
    gesture(f, field.port); if (!Array.isArray(value)) field.port.value = value;
  }
  // The existing fixture owns the sole native raw-value map. Keep it coherent
  // with these exact current fields; there is no application draft substitute.
  f.fill(current.form, next);
  current.node.handlers.change?.call(current.owner, { type: "change", target: current.form,
    currentTarget: current.form, preventDefault() {}, stopPropagation() {} });
  f.draw(); assert.equal(currentCreate(f).form, current.form); assert.deepEqual(rawValues(f, current.form), next);
}
function unchanged(f, expectedCanonical) {
  assert.deepEqual(canonical(f), expectedCanonical);
  assert.deepEqual(financial(f.storeHost.worker), f.departureMoney);
  assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts);
  assert.deepEqual(creatorState(f), f.departureSource, "Platform navigation did not mutate or navigate the infrastructure Creator Store");
  assert.equal(f.platformSession.get(), f.departureSession); assert.deepEqual(f.external, []);
}
function refusal(f) {
  assert.equal(f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search, "/product/delivery");
  assert.equal(currentDelivery(f), f.departureOwner); assert.equal(currentCreate(f).form, f.departureForm);
  assert.ok(f.departureOwner.isConnected && f.departureForm.isConnected);
  const rows = f.tree().visible("p").filter(node => node.owner === f.host && classed(node, "platform-departure-notice"));
  assert.equal(rows.length, 1); assert.equal(rows[0].attributes.role, "status");
  assert.equal(rows[0].text, f.i18n.t("next.lifecycle.currentWorkOpen"));
  assert.equal(f.tree().visible("dialog").filter(node => node.port?.open).length, 0);
}
async function arrived(f, kind) {
  if (kind === "header") {
    assert.deepEqual(f.departureAssignments, ["/projects"], "one actual current hard-navigation request, not an invented mounted Creator app"); return;
  }
  await f.settle(); assert.equal(f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search, "/product/insights");
  assert.equal(currentDelivery(f), null); assert.equal(f.departureOwner.isConnected, false);
  const owners = [...f.renderer.instances.values()].map(row => row.instance).filter(owner => owner.tag === "forma-product-insights" && owner.isConnected);
  assert.equal(owners.length, 1); assert.equal(owners[0].parentElement.parentElement, f.host);
  assert.deepEqual(f.departureAssignments, []);
}

for (const kind of ["task", "header"]) for (const mode of ["clean", "raw-reset"])
  test("actual full Platform Delivery " + kind + " ordinary departure / " + mode, options, async t => {
    const f = await page(t), before = canonical(f), starts = f.calls.length;
    if (mode === "raw-reset") {
      writeRaw(f, { title: "  Unsubmitted delivery B 文書  ", evidence: "  Raw evidence\nنور  ", audience: "product" });
      const raw = rawValues(f, f.departureForm);
      if (kind === "header") {
        const modified = await activate(f, kind, { modified: true });
        assert.equal(modified.defaultPrevented, false); assert.deepEqual(f.departureNewTabs, ["/projects"]);
        assert.deepEqual(f.departureAssignments, []); assert.deepEqual(rawValues(f, f.departureForm), raw);
      }
      const calls = f.calls.length; await activate(f, kind);
      unchanged(f, before); assert.equal(posts(f).length, 0);
      t.diagnostic("PLATFORM_DELIVERY_DEPARTURE " + JSON.stringify({ kind, mode,
        path: f.nativeHistoryLocation.pathname + f.nativeHistoryLocation.search, assignments: f.departureAssignments,
        originalOwnerConnected: f.departureOwner.isConnected, originalFormConnected: f.departureForm.isConnected,
        additionalRequests: f.calls.length - calls }));
      assert.deepEqual(f.departureAssignments, [], "a current raw form refuses the hard-navigation request");
      assert.equal(f.nativeHistoryLocation.pathname, "/product/delivery", "an ordinary task must not discard the current raw form");
      assert.equal(f.calls.length, calls, "refusal starts no new session/report/load request");
      refusal(f); assert.deepEqual(rawValues(f, f.departureForm), raw);
      if (kind === "task") {
        // Existing finite locale context, propagated to its current base ports;
        // no new session, field state or application method is substituted.
        setLocale(f, "ja"); for (const { instance } of f.renderer.instances.values()) instance.i18n = f.i18n;
        f.draw(); refusal(f); assert.deepEqual(rawValues(f, f.departureForm), raw);
      }
      writeRaw(f, f.departureDefaults);
      assert.deepEqual(rawValues(f, f.departureForm), f.departureDefaults);
      assert.equal(f.formResets, 0, "resolution is explicit native field/default restoration, not an invented Reset button");
    }
    await activate(f, kind); await arrived(f, kind); unchanged(f, before);
    assert.equal(posts(f).length, 0); assert.ok(f.calls.slice(starts).every(call => call.method === "GET"));
  });

test("actual full Platform Delivery pending original create refuses task departure, then its real ACK/reset permits a fresh task", options, async t => {
  const f = await page(t), gate = sceneDeferred(); let entered = false;
  writeRaw(f, originalDraft);
  f.deliver = async (call, response) => {
    if (call.url === "/api/portfolio/product/delivery" && call.method === "POST") {
      assert.equal(entered, false); assert.equal(response.status, 201); assert.equal(response.bodyUsed, false);
      assert.equal(f.committed.length, 1); assert.ok(f.committed[0].receipt.receipt?.eventId);
      entered = true; await gate.promise;
    }
    return response; // The exact original Worker response, no fabricated ACK.
  };
  const pending = submitCurrent(f); let committed, request, receipt;
  try {
    await untilScene(() => entered, "the real original create201 is held after commit");
    committed = canonical(f); request = structuredClone(posts(f)[0].body); receipt = structuredClone(f.committed[0].receipt);
    assert.equal(f.decisions().length, 1); assert.equal(f.creationEvents().length, 1);
    const calls = f.calls.length; await activate(f, "task");
    unchanged(f, committed); assert.equal(posts(f).length, 1); assert.deepEqual(posts(f)[0].body, request);
    assert.deepEqual(f.committed[0].receipt, receipt);
    t.diagnostic("PLATFORM_DELIVERY_PENDING_ORIGINAL " + JSON.stringify({ path: f.nativeHistoryLocation.pathname,
      originalRequestId: request.requestId, originalEventId: receipt.receipt.eventId,
      originalOwnerConnected: f.departureOwner.isConnected, additionalRequests: f.calls.length - calls }));
    assert.equal(f.nativeHistoryLocation.pathname, "/product/delivery", "a running original save owns this ordinary departure");
    assert.equal(f.calls.length, calls); assert.equal(currentDelivery(f), f.departureOwner);
    assert.equal(f.form(), f.departureForm); assert.ok(f.departureForm.isConnected);
    const forms = f.tree().visible("form").filter(node => node.port === f.departureForm); assert.equal(forms.length, 1);
    const buttons = f.tree().visible("button").filter(node => node.owner === f.departureOwner && node.attributes.type === "submit" && classed(node, "primary"));
    assert.equal(buttons.length, 1); assert.ok(Object.hasOwn(buttons[0].attributes, "disabled"));
    assert.equal(buttons[0].text, f.i18n.t("delivery.saving", "Saving…"));
  } finally { gate.resolve(); await pending; }
  assert.equal(currentCreate(f).form, f.departureForm); assert.equal(f.formResets, 1);
  assert.deepEqual(rawValues(f, f.departureForm), f.departureDefaults);
  assert.equal(posts(f).length, 1); assert.deepEqual(posts(f)[0].body, request); assert.deepEqual(f.committed[0].receipt, receipt);
  await activate(f, "task"); await arrived(f, "task"); unchanged(f, committed);
});

test("Actual Review lookup native ownership preserves departure drafts without managed requests", options, async t => {
  const f = await page(t), delivery = currentDelivery(f), review = f.renderer.component("forma-experience-review");
  assert.ok(review instanceof f.renderer.registry["forma-experience-review"] && review.isConnected);
  const selector = "form[data-experience-publication-lookup]", form = review.querySelector(selector);
  assert.ok(form?.isConnected && form.owner === review);
  const input = form.elements.namedItem("publicationId");
  assert.ok(input && input.owner === review && input.form === form && input.parentElement === form);
  const rendered = f.tree().nodes.find(node => node.port === input);
  assert.ok(rendered?.hiddenBy?.includes("details[closed]"), "closed disclosure does not remove a native successful control");
  for (const absent of ["form[data-experience-patch]", 'form[data-experience-proposal][data-experience-proposal-owner="0"]',
    'form[data-experience-action][data-experience-action-owner="0"]']) assert.equal(review.querySelector(absent), null);
  assert.throws(() => review.querySelector('form[data-experience-proposal][data-experience-proposal-owner="invalid"]'), /exact current Review form selectors/u);
  assert.throws(() => new FormData(input), /actual selected form/u, "only an admitted actual form is accepted");
  const calls = f.calls.length, state = canonical(f), initial = new FormData(form);
  assert.equal(initial.get("publicationId"), "");
  assert.equal(delivery.captureCommandDeparture().blocked(), false);
  input.value = "  Publication 日本語  ";
  const snapshot = new FormData(form);
  assert.equal(snapshot.get("publicationId"), input.value); assert.equal(initial.get("publicationId"), "");
  assert.equal(delivery.captureCommandDeparture().blocked(), true, "actual Review raw lookup participates in Delivery departure");
  f.draw();
  assert.equal(review.querySelector(selector), form); assert.equal(form.elements.namedItem("publicationId"), input);
  assert.equal(input.value, "  Publication 日本語  ");
  input.disabled = true;
  assert.equal(new FormData(form).get("publicationId"), null); assert.equal(delivery.captureCommandDeparture().blocked(), false);
  f.draw(); assert.equal(input.disabled, true, "unchanged actual disabled binding preserves native IDL state");
  input.removeAttribute("disabled"); input.name = "renamed";
  assert.equal(new FormData(form).get("publicationId"), null); assert.equal(new FormData(form).get("renamed"), input.value);
  assert.equal(form.elements.namedItem("publicationId"), null); assert.equal(form.elements.namedItem("renamed"), input);
  input.removeAttribute("name"); assert.deepEqual(new FormData(form).getAll("renamed"), []);
  input.name = "publicationId"; input.value = "Changed";
  assert.equal(snapshot.get("publicationId"), "  Publication 日本語  ", "FormData is a snapshot, not a live field view");
  form.reset(); assert.equal(input.value, ""); assert.equal(delivery.captureCommandDeparture().blocked(), false);
  assert.equal(f.calls.length, calls); assert.deepEqual(canonical(f), state);
  const oldDeparture = review.captureCommandDeparture();
  review.retireAccess();
  assert.equal(oldDeparture.current(), false); assert.equal(review.querySelector(selector), null);
  assert.equal(form.isConnected, false); assert.equal(input.isConnected, false);
  f.draw(); assert.equal(review.querySelector(selector), null, "a cleared private root does not revive prior native controls");
  assert.equal(f.calls.length, calls); assert.deepEqual(canonical(f), state);
  assert.deepEqual(f.calls.filter(call => call.url.startsWith("/api/portfolio/product/experiences/")).map(call => [call.method, call.url]),
    [["GET", "/api/portfolio/product/experiences/materials"], ["GET", "/api/portfolio/product/experiences/materials"]],
    "standalone and full Platform inventory reads only; no managed lookup, proposal, transition or publication");
});

// Opt-in Maintenance uses the same full Platform/native port and real domain
// handlers. These cases qualify prospective command/form ownership assertions,
// not an outer-router integration, physical touch, IME engine or browser layout.
const maintenanceEndpoint = "/api/portfolio/product/experiences/maintenance";
const adoptionMarker = "adoption-proposal";
function reviewEvent(type, target, currentTarget = target, extra = {}) {
  return { type, target, currentTarget, preventDefault() {}, stopPropagation() {},
    composedPath: () => [target, currentTarget, ports.documentPort], ...extra };
}
function reviewButton(f, marker, value) {
  if (!f.flushReviewUpdate || f.requested) f.draw();
  const rows = f.tree().visible("button").filter(node => node.owner === f.maintenanceReview
    && Object.hasOwn(node.attributes, marker) && (value === undefined || node.attributes[marker] === value));
  assert.equal(rows.length, 1, "one actual current " + marker + " button");
  assert.ok(rows[0].port.isConnected && f.maintenanceReview.contains(rows[0].port));
  return rows[0];
}
function invokeReviewButton(f, row) {
  assert.ok(row.port.isConnected && typeof row.handlers.click === "function");
  assert.equal(Object.hasOwn(row.attributes, "disabled"), false);
  gesture(f, row.port);
  return row.handlers.click.call(row.owner, reviewEvent("click", row.port));
}
function reviewRaw(form) {
  const values = new FormData(form);
  return Object.fromEntries(["nomination", "title", "ownerUserId", "evidence", "status"]
    .filter(name => form.elements.namedItem(name)).map(name => [name, values.get(name)]));
}
function writeReview(f, marker, changes) {
  const form = f.reviewForm(marker); assert.ok(form?.isConnected);
  const before = new FormData(form), tree = f.tree(), description = tree.nodes.find(node => node.port === form);
  assert.ok(description);
  for (const [name, value] of Object.entries(changes)) {
    const field = form.elements.namedItem(name), row = tree.nodes.find(node => node.port === field);
    assert.ok(field?.isConnected && field.form === form && row && inside(row, description));
    assert.equal(field.disabled, false);
    if (row.tag === "select") assert.ok(tree.nodes.some(option => option.tag === "option" && inside(option, row)
      && option.attributes.value === value && !Object.hasOwn(option.attributes, "disabled")), "choose an actual enabled option");
    gesture(f, field); field.value = value;
    const type = row.tag === "select" ? "change" : "input";
    emit(f, type, field);
    form.handlers[type]?.call(form.owner, reviewEvent(type, field, form));
  }
  f.draw(); assert.equal(f.reviewForm(marker), form, "native edits retain their actual form lifetime");
  for (const [name, value] of Object.entries(changes)) assert.equal(form.elements.namedItem(name).value, value);
  return { form, before };
}
function submitReview(f, marker, buttonMarker, value) {
  const form = f.reviewForm(marker), button = reviewButton(f, buttonMarker, value);
  assert.ok(form?.isConnected && form.contains(button.port));
  assert.equal(Object.hasOwn(button.attributes, "disabled"), false);
  gesture(f, button.port);
  return form.handlers.submit.call(form.owner, reviewEvent("submit", form, form, { submitter: button.port }));
}
function composeReview(f, form, field, active) {
  assert.ok(form.isConnected && field.isConnected && field.form === form);
  const type = active ? "compositionstart" : "compositionend";
  emit(f, type, field);
  form.handlers[type].call(form.owner, reviewEvent(type, field, form));
}
function maintenanceCommands(f) {
  return f.calls.filter(call => call.method !== "GET" && (call.url.startsWith(maintenanceEndpoint + "/")
    || call.url === "/api/portfolio/product/delivery" && call.body?.maintenanceAdoption));
}
function acknowledgmentText(f) {
  f.draw();
  const rows = f.tree().visible("div").filter(node => node.owner === f.maintenanceReview
    && Object.hasOwn(node.attributes, "data-experience-acknowledgment"));
  assert.equal(rows.length, 1); return rows[0].text;
}
async function maintenancePage(t) {
  const f = await platformDeliveryFixture(t, { maintenanceAdoption: true }), current = currentCreate(f);
  f.departureAssignments = []; f.departureNewTabs = []; f.departureDispatch = new WeakSet();
  f.nativeLocationAssign = value => { assert.ok(["/projects", "/settings"].includes(value)); f.departureAssignments.push(value); };
  Object.assign(f, { departureOwner: current.owner, departureForm: current.form, departureDefaults: rawValues(f, current.form),
    departureSource: creatorState(f), departureMoney: financial(f.storeHost.worker), departureCounts: f.storeHost.worker.counts(),
    departureSession: f.platformSession.get(), maintenanceReview: f.renderer.component("forma-experience-review"), maintenanceResponses: [] });
  assert.ok(f.maintenanceReview instanceof f.renderer.registry["forma-experience-review"] && f.maintenanceReview.isConnected);
  f.deliver = async (call, response) => {
    if (maintenanceCommands({ calls: [call] }).length && response.ok) {
      assert.equal(response.bodyUsed, false);
      const body = await response.clone().json();
      assert.equal(body.receipt.protocol, "forma-experience-maintenance-adoption@1");
      f.maintenanceResponses.push({ call: structuredClone(call), status: response.status, body });
    }
    return f.maintenanceDelivery ? await f.maintenanceDelivery(call, response) : response;
  };
  const tree = f.tree(), candidates = tree.visible("button").filter(node => node.owner === f.maintenanceReview
    && tree.nodes.some(parent => classed(parent, "experience-review-candidates") && inside(node, parent)));
  assert.equal(candidates.length, 1); assert.ok(candidates[0].text.includes("model3d"));
  invokeReviewButton(f, candidates[0]);
  await untilScene(() => { f.draw(); return f.tree().nodes.some(node => node.owner === f.maintenanceReview
    && node.tag === "details" && Object.hasOwn(node.attributes, "data-experience-maintenance")); }, "actual material selection loads its disclosure");
  const detailTree = f.tree();
  const details = detailTree.nodes.find(node => node.owner === f.maintenanceReview
    && node.tag === "details" && Object.hasOwn(node.attributes, "data-experience-maintenance"));
  const summary = detailTree.nodes.filter(node => node.owner === f.maintenanceReview && node.tag === "summary"
    && node.parent === details);
  assert.equal(summary.length, 1); assert.ok(details.port.isConnected && summary[0].port.isConnected);
  assert.equal(details.port.open, false);
  // Explicit native disclosure state: neither the style port nor a render may
  // open Maintenance merely to make its controls visible to this fixture.
  details.port.open = true;
  details.handlers.toggle?.call(details.owner, reviewEvent("toggle", details.port, details.port, { oldState: "closed", newState: "open" }));
  assert.equal(details.port.open, true);
  const load = reviewButton(f, "data-experience-adoption-load"); assert.ok(details.port.contains(load.port));
  await invokeReviewButton(f, load);
  await f.flush();
  const form = f.reviewForm(adoptionMarker); assert.ok(form?.isConnected);
  assert.deepEqual(reviewRaw(form), { nomination: "", title: "", ownerUserId: f.platformSession.get().user.userId, evidence: "" });
  assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), false);
  return f;
}
function fillAdoption(f, title = "  Baseline A 日本語  ") {
  const form = f.reviewForm(adoptionMarker), tree = f.tree(), select = form.elements.namedItem("nomination");
  const row = tree.nodes.find(node => node.port === select);
  const choices = tree.nodes.filter(node => node.tag === "option" && inside(node, row)
    && node.attributes.value && !Object.hasOwn(node.attributes, "disabled"));
  assert.equal(choices.length, 1, "one genuine server nomination, not a caller-authored binding");
  return writeReview(f, adoptionMarker, { nomination: choices[0].attributes.value, title, evidence: "  Recorded evidence\nنور  " }).form;
}
async function openMaintenanceDecision(f, decisionId) {
  const previous = f.reviewForm("action");
  await untilScene(() => { f.draw(); return f.tree().visible("button").some(node => node.owner === currentDelivery(f)
    && node.attributes["data-experience-decision-review"] === decisionId); }, "the actual Delivery report emits its Review action");
  const button = f.tree().visible("button").find(node => node.owner === currentDelivery(f)
    && node.attributes["data-experience-decision-review"] === decisionId);
  invokeReviewButton(f, button);
  await untilScene(() => { f.draw(); const form = f.reviewForm("action"); return Boolean(form && form !== previous); }, "the real decision read mounts its current action form");
  await f.flush();
}

test("Actual Maintenance context retains departure ownership for all five reserved native Review forms", options, async t => {
  const f = await maintenancePage(t), calls = f.calls.length;
  const exercised = [];
  for (const [marker, name, draft] of [["publication-lookup", "publicationId", "Publication B"],
    ["proposal", "title", "Release draft B"], [adoptionMarker, "title", "Baseline draft B"]]) {
    const form = f.reviewForm(marker), field = form.elements.namedItem(name), before = new FormData(form);
    assert.ok(form.isConnected && field.isConnected && field.form === form);
    assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), false);
    // Direct native IDL/FormData custody includes successful controls under a
    // closed disclosure; it does not claim that a user can focus hidden fields.
    field.value = draft;
    form.handlers.input?.call(form.owner, reviewEvent("input", field, form)); f.draw();
    assert.equal(f.reviewForm(marker), form); assert.equal(before.get(name), "");
    assert.equal(new FormData(form).get(name), draft);
    assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), true, marker);
    field.value = before.get(name);
    form.handlers.input?.call(form.owner, reviewEvent("input", field, form)); f.draw();
    assert.equal(new FormData(form).get(name), "");
    assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), false, marker);
    exercised.push(marker);
  }
  const patch = f.reviewForm("patch"), layout = patch.elements.namedItem("layout"), tree = f.tree();
  const row = tree.nodes.find(node => node.port === layout), initialLayout = layout.value;
  const alternate = tree.nodes.find(node => node.tag === "option" && inside(node, row)
    && node.attributes.value !== initialLayout && !Object.hasOwn(node.attributes, "disabled"));
  assert.ok(alternate); layout.value = alternate.attributes.value;
  patch.handlers.change.call(patch.owner, reviewEvent("change", layout, patch)); f.draw();
  assert.equal(patch.getAttribute("data-experience-dirty"), "true");
  assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), true);
  const reset = f.tree().visible("button").filter(node => node.owner === f.maintenanceReview
    && node.handlers.click?.toString().includes("#resetDraft"));
  assert.equal(reset.length, 1); await invokeReviewButton(f, reset[0]); await f.flush();
  assert.equal(f.reviewForm("patch"), patch); assert.equal(layout.value, initialLayout);
  assert.equal(patch.getAttribute("data-experience-dirty"), null);
  assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), false); exercised.push("patch");
  assert.equal(f.calls.length, calls); assert.equal(maintenanceCommands(f).length, 0);
  fillAdoption(f); await submitReview(f, adoptionMarker, "data-experience-adoption-propose"); await f.flush();
  await openMaintenanceDecision(f, f.maintenanceResponses[0].body.result.decision.decisionId);
  const action = f.reviewForm("action"), evidence = new FormData(action).get("evidence");
  writeReview(f, "action", { evidence: "  Unrecorded action B  " });
  assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), true);
  const actionReset = f.tree().visible("button").filter(node => node.owner === f.maintenanceReview
    && classed(node, "experience-review-action-reset"));
  assert.equal(actionReset.length, 1); assert.ok(action.contains(actionReset[0].port));
  gesture(f, actionReset[0].port); assert.equal(ports.documentPort.activeElement, actionReset[0].port);
  const resetCalls = f.calls.length;
  await invokeReviewButton(f, actionReset[0]); await f.flush();
  const successor = f.reviewForm("action"); assert.notEqual(successor, action); assert.equal(action.isConnected, false);
  const successorReset = f.tree().visible("button").filter(node => node.owner === f.maintenanceReview
    && classed(node, "experience-review-action-reset"));
  assert.equal(successorReset.length, 1);
  assert.ok(successor.isConnected && successorReset[0].port.isConnected && successor.contains(successorReset[0].port));
  assert.notEqual(successorReset[0].port, actionReset[0].port); assert.equal(actionReset[0].port.isConnected, false);
  assert.equal(ports.documentPort.activeElement, successorReset[0].port, "the exact successor action Reset receives recovery focus");
  assert.equal(f.calls.length, resetCalls);
  assert.equal(new FormData(successor).get("evidence"), evidence);
  assert.equal(currentDelivery(f).captureCommandDeparture().blocked(), false); exercised.push("action");
  assert.deepEqual(exercised.sort(), ["action", "adoption-proposal", "patch", "proposal", "publication-lookup"]);
  assert.equal(maintenanceCommands(f).length, 1); assert.equal(f.decisions().length, 1);
  assert.equal(f.storeHost.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM experience_release_heads").get().n, 0);
  assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts);
});

test("Actual Maintenance operator proposes, records, independently approves and adopts one baseline without publication or generation", options, async t => {
  const f = await maintenancePage(t), form = fillAdoption(f), raw = reviewRaw(form);
  await submitReview(f, adoptionMarker, "data-experience-adoption-propose"); await f.flush();
  assert.equal(f.maintenanceResponses.length, 1);
  const proposed = f.maintenanceResponses[0], decisionId = proposed.body.result.decision.decisionId;
  assert.equal(proposed.status, 201); assert.equal(proposed.body.receipt.operation, "maintenance-proposal");
  assert.deepEqual(proposed.call.body.binding, f.maintenanceMaterial.adoptionBinding);
  assert.equal(proposed.call.body.title, raw.title.trim()); assert.equal(proposed.call.body.evidence, raw.evidence.trim());
  assert.deepEqual(proposed.call.body.dependencyIds, []);
  assert.ok(acknowledgmentText(f).includes(proposed.body.receipt.eventId));
  assert.notEqual(f.reviewForm(adoptionMarker), form); assert.equal(form.isConnected, false);
  await openMaintenanceDecision(f, decisionId);
  for (const status of ["running", "passed", "approval_required"]) {
    writeReview(f, "action", { status, evidence: "Recorded " + status });
    await submitReview(f, "action", "data-experience-transition", "record"); await f.flush();
    assert.equal(f.maintenanceResponses.at(-1).body.result.decision.status, status);
    assert.ok(acknowledgmentText(f).includes(f.maintenanceResponses.at(-1).body.receipt.eventId));
    assert.equal(ports.documentPort.activeElement, f.maintenanceReview.querySelector("[data-experience-acknowledgment]"),
      "a replaced current submitter recovers focus to the exact acknowledged decision");
  }
  const approvalButton = reviewButton(f, "data-experience-transition", "approved");
  assert.ok(Object.hasOwn(approvalButton.attributes, "disabled"), "the proposal owner cannot approve their own adoption");
  const prior = f.maintenanceResponses.at(-1).body.result, reviewerId = f.reviewer["oai-authenticated-user-id"];
  assert.notEqual(reviewerId, prior.decision.ownerUserId);
  const approvalIntent = { version: 1, requestId: crypto.randomUUID(), decisionId, expectedUpdatedAt: prior.decision.updatedAt,
    title: prior.decision.title, ownerUserId: prior.decision.ownerUserId, evidence: "Independent review", status: "approved", maintenanceAdoption: prior.binding };
  const approvalResponse = await f.storeHost.worker.request("/api/portfolio/product/delivery", { method: "PATCH",
    headers: { ...f.reviewer, "Content-Type": "application/json" }, body: JSON.stringify(approvalIntent) });
  assert.equal(approvalResponse.status, 200); const approved = await approvalResponse.json();
  assert.equal(approved.receipt.actorUserId, reviewerId); assert.equal(approved.result.decision.status, "approved");
  await openMaintenanceDecision(f, decisionId);
  await invokeReviewButton(f, reviewButton(f, "data-experience-adopt")); await f.flush();
  const adopted = f.maintenanceResponses.at(-1);
  assert.equal(adopted.body.receipt.operation, "maintenance-adoption");
  assert.equal(adopted.call.body.approvalEventId, approved.receipt.eventId);
  assert.equal(adopted.call.body.expectedDecisionUpdatedAt, approved.result.decision.updatedAt);
  assert.equal(adopted.body.result.head.revision, 1);
  assert.equal(adopted.body.result.head.adoptionEventId, adopted.body.receipt.eventId);
  assert.equal(adopted.body.result.head.baselineObservationHash, f.maintenanceMaterial.adoptionBinding.target.observationHash);
  assert.ok(acknowledgmentText(f).includes(adopted.body.receipt.eventId));
  assert.equal(ports.documentPort.activeElement, f.maintenanceReview.querySelector("[data-experience-acknowledgment]"));
  assert.equal(f.storeHost.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM experience_maintenance_heads").get().n, 1);
  assert.equal(f.storeHost.worker.sqlite.prepare("SELECT COUNT(*) AS n FROM experience_release_heads").get().n, 0);
  assert.equal(f.decisions().length, 1); assert.equal(maintenanceCommands(f).length, 5);
  assert.ok(f.maintenanceResponses.every(row => row.body.result.generationAvailable === false && row.body.result.canPublish === false));
  assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts); assert.deepEqual(f.external, []);
});

for (const mode of ["raw-B", "IME"])
  test("Actual Maintenance original recovery retains " + mode + " native fields and departure ownership", options, async t => {
    const f = await maintenancePage(t), form = fillAdoption(f); let lost = false;
    f.maintenanceDelivery = async (call, response) => {
      if (call.url === maintenanceEndpoint + "/adoption-proposals" && call.method === "POST" && !lost) {
        assert.equal(response.status, 201); assert.equal(f.maintenanceResponses.length, 1); lost = true;
        const error = new TypeError("The genuine proposal response was lost after commit");
        f.expectManagedDeliveryFailure(error); throw error;
      }
      return response;
    };
    await submitReview(f, adoptionMarker, "data-experience-adoption-propose"); await f.flush();
    assert.equal(lost, true); assert.equal(f.decisions().length, 1);
    const original = structuredClone(f.maintenanceResponses[0]), requestCount = maintenanceCommands(f).length;
    assert.equal(f.reviewForm(adoptionMarker), form);
    const field = form.elements.namedItem("title");
    assert.equal(f.tree().nodes.find(row => row.port === field)?.tag, "input");

    // Controlled CSS-pixel/native scheduling ports, not browser-layout or physical IME evidence.
    const restores = [], scrolls = [], centers = [], focuses = [];
    const replace = (object, name, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, name);
      restores.push(() => { if (descriptor) Object.defineProperty(object, name, descriptor); else delete object[name]; });
      Object.defineProperty(object, name, { configurable: true, writable: true, value });
    };
    const restore = () => { for (const undo of restores.splice(0).reverse()) undo(); };
    t.after(restore);
    let rect = { left: 12, right: 308, top: 20, bottom: 68, width: 296, height: 48 }, focusVisible = true;
    const style = ports.windowPort.getComputedStyle, matches = field.matches, focus = field.focus, center = field.scrollIntoView;
    replace(ports.windowPort, "innerWidth", 419); replace(ports.windowPort, "innerHeight", 398);
    replace(ports.windowPort, "visualViewport", { ...ports.windowPort.visualViewport, width: 419, height: 398.5, offsetLeft: 0, offsetTop: 0 });
    replace(ports.windowPort, "getComputedStyle", element => element === field
      ? { ...style(element), visibility: "visible", opacity: "1", outlineStyle: "solid", outlineWidth: "2px", outlineOffset: "3px" } : style(element));
    replace(ports.documentPort, "scrollingElement", ports.documentPort.body);
    replace(ports.documentPort.body, "scrollBy", options => {
      scrolls.push(structuredClone(options)); rect = { ...rect, left: rect.left - options.left, right: rect.right - options.left,
        top: rect.top - options.top, bottom: rect.bottom - options.top };
    });
    replace(field, "getBoundingClientRect", () => ({ ...rect }));
    replace(field, "matches", function(selector) {
      if (selector === ":focus-visible") return focusVisible;
      if (selector === "input, textarea, select, button") return true;
      return Reflect.apply(matches, this, [selector]);
    });
    replace(field, "focus", function(...args) { focuses.push(args); return Reflect.apply(focus, this, args); });
    replace(field, "scrollIntoView", function(...args) { centers.push(args); return Reflect.apply(center, this, args); });
    const frame = async () => {
      await f.flush();
      // One snapshot of the existing native frame queue: newly queued work belongs to a later frame.
      for (const [id, callback] of [...f.frames]) { f.frames.delete(id); callback(0); }
      await f.flush();
    };
    const nativeFocus = () => {
      gesture(f, field);
      const listener = f.maintenanceReview.listeners?.focusin;
      assert.equal(typeof listener, "function", "the actual connected Review owns native field focus");
      listener.call(f.maintenanceReview, reviewEvent("focusin", field, f.maintenanceReview));
    };
    const originalGate = sceneDeferred(), parentGate = sceneDeferred();
    let entered = false, parentEntered = false, registration;
    try {
      if (mode === "raw-B") {
        focusVisible = false; rect = { ...rect, top: 350.3125, bottom: 398.3125 };
        nativeFocus(); await frame(); assert.deepEqual(scrolls, [], "ordinary pointer focus must not scroll");
        focusVisible = true; rect = { ...rect, top: 20, bottom: 68 };
        nativeFocus(); const focused = focuses.length; await frame();
        assert.deepEqual(scrolls, [], "an already clear outline must not scroll"); assert.equal(focuses.length, focused);
        rect = { ...rect, top: 350.3125, bottom: 398.3125 };
        nativeFocus(); await frame();
        assert.deepEqual(scrolls, [{ left: 0, top: 6, behavior: "instant" }], "398px layout viewport clips the 398.5px visual viewport; round the 5px ring outward");
        for (const type of ["wheel", "touchstart", "input"]) {
          const count = scrolls.length; rect = { ...rect, top: 450, bottom: 498 };
          nativeFocus(); await f.flush(); emit(f, type, field); await frame();
          assert.equal(scrolls.length, count, type + " retires the pending native clearance");
        }
      }
      scrolls.length = 0; centers.length = 0;
      const dispatch = f.maintenanceReview.dispatchEvent;
      replace(f.maintenanceReview, "dispatchEvent", function(event) {
        if (event.type === "experience-proposal-saved") {
          assert.equal(registration, undefined); registration = event.detail?.registerDeliveryRefresh;
          assert.equal(typeof registration, "function");
        }
        return Reflect.apply(dispatch, this, [event]);
      });
      const originalPath = maintenanceEndpoint + "/adoption-operations/maintenance-proposal/" + original.call.body.requestId;
      f.maintenanceDelivery = async (call, response) => {
        if (call.method === "GET" && call.url === originalPath) {
          assert.equal(entered, false); assert.equal(response.status, 200); entered = true; await originalGate.promise;
        } else if (call.method === "GET" && call.url === "/api/portfolio/product/delivery") {
          assert.equal(entered, true); assert.equal(parentEntered, false); parentEntered = true; await parentGate.promise;
        }
        return response;
      };
      const check = f.tree().visible("button").filter(node => node.owner === f.maintenanceReview
        && node.text === f.i18n.t("experience.review.Check original", "Check original"));
      assert.equal(check.length, 1); invokeReviewButton(f, check[0]);
      await untilScene(() => entered, "the exact original-operation GET is held before its response reaches Review");
      if (mode === "raw-B") {
        writeReview(f, adoptionMarker, { title: "  Baseline B 文書  ", evidence: "  Unsaved B\nنور  " }); gesture(f, field);
      } else { gesture(f, field); composeReview(f, form, field, true); field.value = "変換中"; f.draw(); }
      const raw = reviewRaw(form), snapshot = new FormData(form), departure = f.maintenanceReview.captureCommandDeparture();
      const focused = focuses.length;
      assert.equal(departure.blocked(), true); assert.equal(ports.documentPort.activeElement, field);
      rect = { ...rect, top: 450, bottom: 498 };
      originalGate.resolve();
      await untilScene(() => parentEntered, "the genuine ACK starts the actual owning Delivery refresh");
      assert.ok(acknowledgmentText(f).includes(original.body.receipt.eventId));
      await frame(); assert.deepEqual(scrolls, [], "a held parent refresh cannot authorize premature clearance");
      parentGate.resolve(); await f.flush();
      if (mode === "raw-B") registration(Promise.resolve(true)); // A late registration invalidates even a completed first refresh.
      await frame();
      assert.deepEqual(scrolls, mode === "raw-B" ? [] : [{ left: 0, top: 105, behavior: "instant" }],
        "only the single current parent completion may clear the retained composing field");
      assert.deepEqual(centers, [], "visibility preservation never centers the field");
      assert.equal(focuses.length, focused, "visibility preservation never focuses or reassigns the field");
      assert.equal(ports.documentPort.activeElement, field);
      assert.equal(f.reviewForm(adoptionMarker), form); assert.ok(form.isConnected && field.isConnected);
      assert.deepEqual(reviewRaw(form), raw); assert.equal(snapshot.get("title"), raw.title);
      assert.equal(departure.current(), true); assert.equal(departure.blocked(), true);
      const calls = f.calls.length; await activate(f, "task"); refusal(f);
      assert.equal(f.calls.length, calls); assert.deepEqual(reviewRaw(form), raw);
      assert.equal(maintenanceCommands(f).length, requestCount); assert.deepEqual(f.maintenanceResponses, [original]);
      assert.equal(f.managedDeliveryFailures.length, 1); assert.equal(f.managedDeliveryFailures[0].error instanceof TypeError, true);
      assert.equal(f.decisions().length, 1);
      assert.equal(f.calls.filter(call => call.method === "GET" && call.url === originalPath).length, 1);
      if (mode === "IME") composeReview(f, form, field, false);
      restore();
      await invokeReviewButton(f, reviewButton(f, "data-experience-adoption-reset")); await f.flush();
      assert.notEqual(f.reviewForm(adoptionMarker), form); assert.equal(form.isConnected, false);
      assert.equal(f.maintenanceReview.captureCommandDeparture().blocked(), false);
      assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts);
    } finally { originalGate.resolve(); parentGate.resolve(); restore(); }
  });

test("Actual Maintenance pending proposal refuses departure and a retired Review cannot consume its later genuine response", options, async t => {
  const f = await maintenancePage(t), form = fillAdoption(f), gate = sceneDeferred(); let entered = false;
  f.maintenanceDelivery = async (call, response) => {
    if (call.url === maintenanceEndpoint + "/adoption-proposals" && call.method === "POST") {
      assert.equal(response.status, 201); assert.equal(entered, false); entered = true; await gate.promise;
    }
    return response;
  };
  const pending = submitReview(f, adoptionMarker, "data-experience-adoption-propose");
  let committed, calls;
  try {
    await untilScene(() => entered, "the original proposal is held after the real transaction commits");
    committed = structuredClone(f.maintenanceResponses[0]); calls = f.calls.length;
    assert.equal(f.maintenanceReview.captureCommandDeparture().blocked(), true);
    assert.ok(Object.hasOwn(reviewButton(f, "data-experience-adoption-propose").attributes, "disabled"));
    await activate(f, "task"); refusal(f); assert.equal(f.calls.length, calls);
    const oldDeparture = f.maintenanceReview.captureCommandDeparture(), field = form.elements.namedItem("title");
    f.maintenanceReview.retireAccess(false); f.draw();
    assert.equal(oldDeparture.current(), false); assert.equal(f.reviewForm(adoptionMarker), null);
    assert.equal(form.isConnected, false); assert.equal(field.isConnected, false);
  } finally { gate.resolve(); await pending; }
  await f.flush();
  assert.deepEqual(f.maintenanceResponses, [committed]); assert.equal(f.calls.length, calls);
  assert.equal(f.reviewForm(adoptionMarker), null); assert.equal(form.isConnected, false);
  assert.equal(f.tree().visible("div").filter(node => node.owner === f.maintenanceReview
    && Object.hasOwn(node.attributes, "data-experience-acknowledgment")).length, 0);
  assert.equal(f.decisions().length, 1, "retirement does not erase the already committed original");
  assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts);
});

for (const mode of ["newer-focus", "touch", "IME"])
  test("Actual Maintenance command acknowledgment preserves newer native activity / " + mode, options, async t => {
    const f = await maintenancePage(t); fillAdoption(f);
    await submitReview(f, adoptionMarker, "data-experience-adoption-propose"); await f.flush();
    await openMaintenanceDecision(f, f.maintenanceResponses[0].body.result.decision.decisionId);
    const action = writeReview(f, "action", { status: "running", evidence: "Recorded running" }).form;
    const gate = sceneDeferred(); let entered = false, newer;
    f.maintenanceDelivery = async (call, response) => {
      if (call.url === "/api/portfolio/product/delivery" && call.method === "PATCH" && call.body?.maintenanceAdoption) {
        assert.equal(response.status, 200); assert.equal(entered, false); entered = true; await gate.promise;
      }
      return response;
    };
    const pending = submitReview(f, "action", "data-experience-transition", "record");
    try {
      await untilScene(() => entered, "the genuine transition response is held after commit");
      assert.ok(Object.hasOwn(reviewButton(f, "data-experience-transition", "record").attributes, "disabled"));
      assert.equal(action.elements.namedItem("evidence").disabled, true);
      const field = currentCreate(f).fields.find(row => row.attributes.name === "title").port;
      assert.ok(field.isConnected && !Object.hasOwn(field.attributes, "disabled"));
      if (mode === "touch") emit(f, "touchstart", field);
      else {
        newer = field; ports.documentPort.activeElement = newer; newer.focus(); emit(f, "focusin", newer);
        if (mode === "IME") emit(f, "compositionstart", newer);
      }
    } finally { gate.resolve(); await pending; }
    await f.flush();
    const acknowledged = f.maintenanceResponses.at(-1);
    assert.equal(acknowledged.body.receipt.operation, "maintenance-transition");
    assert.ok(acknowledgmentText(f).includes(acknowledged.body.receipt.eventId));
    const target = f.maintenanceReview.querySelector("[data-experience-acknowledgment]");
    assert.ok(target?.isConnected); assert.notEqual(ports.documentPort.activeElement, target);
    if (mode !== "touch") assert.equal(ports.documentPort.activeElement, newer);
    if (mode === "IME") emit(f, "compositionend", newer);
    assert.equal(action.isConnected, false); assert.ok(f.reviewForm("action")?.isConnected);
    assert.equal(maintenanceCommands(f).length, 2); assert.equal(f.decisions().length, 1);
    assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts);
  });

for (const mode of ["reset", "newer-focus", "touch", "IME"])
  test("Actual Maintenance Reset native focus ownership / " + mode, options, async t => {
    const f = await maintenancePage(t), form = fillAdoption(f), before = canonical(f), calls = f.calls.length;
    const original = reviewButton(f, "data-experience-adoption-reset"), gate = sceneDeferred(), tick = f.tick;
    let entered = false, nextForm, target, newer;
    f.tick = async () => {
      if (!entered) { entered = true; await gate.promise; }
      return tick();
    };
    const pending = invokeReviewButton(f, original);
    try {
      await untilScene(() => entered, "the existing native updateComplete port holds the Reset continuation");
      f.draw(); nextForm = f.reviewForm(adoptionMarker); target = reviewButton(f, "data-experience-adoption-reset").port;
      assert.notEqual(nextForm, form); assert.equal(form.isConnected, false); assert.equal(original.port.isConnected, false);
      assert.ok(nextForm.isConnected && target.isConnected && nextForm.contains(target));
      if (mode === "newer-focus") { newer = nextForm.elements.namedItem("title"); gesture(f, newer); }
      else if (mode === "touch") { newer = ports.documentPort.activeElement; emit(f, "touchstart", target); }
      else if (mode === "IME") {
        newer = nextForm.elements.namedItem("title"); gesture(f, newer); composeReview(f, nextForm, newer, true); newer.value = "入力中";
      }
    } finally { gate.resolve(); await pending; f.tick = tick; }
    await f.flush();
    if (mode === "reset") assert.equal(ports.documentPort.activeElement, target, "only the exact successor Reset receives recovery focus");
    else { assert.notEqual(ports.documentPort.activeElement, target); assert.equal(ports.documentPort.activeElement, newer); }
    if (mode === "IME") {
      assert.equal(nextForm.elements.namedItem("title").value, "入力中");
      assert.equal(f.maintenanceReview.captureCommandDeparture().blocked(), true);
      composeReview(f, nextForm, newer, false);
    }
    if (mode === "reset") for (const variant of ["inert-review", "inert-delivery", "parent-redraw"]) {
      const priorForm = fillAdoption(f, "  Reset " + variant + "  "), priorControl = reviewButton(f, "data-experience-adoption-reset");
      const update = sceneDeferred(), nativeTick = f.tick, context = f.maintenanceReview.reviewContext;
      const ancestor = variant === "inert-review" ? f.maintenanceReview : variant === "inert-delivery" ? currentDelivery(f) : null;
      const hadInert = ancestor?.hasAttribute("inert"), inertValue = ancestor?.getAttribute("inert");
      let waiting = false, successor, resetTarget;
      f.tick = async () => { if (!waiting) { waiting = true; await update.promise; } return nativeTick(); };
      const resetting = invokeReviewButton(f, priorControl);
      try {
        assert.equal(ports.documentPort.activeElement, priorControl.port, "the actual Reset gesture owns the initial focus");
        await untilScene(() => waiting, "the native update continuation holds " + variant);
        f.draw(); successor = f.reviewForm(adoptionMarker); resetTarget = reviewButton(f, "data-experience-adoption-reset").port;
        assert.notEqual(successor, priorForm); assert.equal(priorForm.isConnected, false); assert.equal(priorControl.port.isConnected, false);
        assert.ok(successor.isConnected && resetTarget.isConnected && successor.contains(resetTarget));
        assert.equal(f.maintenanceReview.querySelector("[data-experience-maintenance]").contains(successor), true);
        assert.equal(f.maintenanceReview.reviewContext, context, "draining the Review update does not reevaluate its parent context");
        if (ancestor) {
          ancestor.setAttribute("inert", "");
          assert.equal(resetTarget.closest("[hidden], [inert], details:not([open])"), ancestor);
        } else {
          assert.equal(f.requested, false, "the explicit parent redraw is not a pending Review commit");
          f.draw();
          assert.notEqual(f.maintenanceReview.reviewContext, context, "an explicit parent redraw still commits the parent's real context object");
          assert.equal(f.reviewForm(adoptionMarker), successor);
          assert.equal(reviewButton(f, "data-experience-adoption-reset").port, resetTarget);
          assert.ok(successor.isConnected && resetTarget.isConnected && successor.contains(resetTarget));
        }
      } finally {
        update.resolve();
        try { await resetting; }
        finally {
          f.tick = nativeTick;
          if (ancestor) { if (hadInert) ancestor.setAttribute("inert", inertValue); else ancestor.removeAttribute("inert"); }
        }
      }
      await f.flush();
      assert.notEqual(ports.documentPort.activeElement, resetTarget, variant + " cannot recover focus into the successor");
      assert.equal(f.reviewForm(adoptionMarker), successor);
      assert.deepEqual(canonical(f), before); assert.equal(f.calls.length, calls); assert.equal(maintenanceCommands(f).length, 0);
    }
    assert.deepEqual(canonical(f), before); assert.equal(f.calls.length, calls); assert.equal(maintenanceCommands(f).length, 0);
    assert.deepEqual(f.storeHost.worker.counts(), f.departureCounts);
  });

test("Actual Maintenance native constructor lease lifecycle", options, async t => {
  const { productDeliveryFixture } = await import("./helpers/product-delivery-native-fixture.mjs");
  const nativeNames = ["HTMLButtonElement", "HTMLFormElement", "HTMLTextAreaElement"];
  const nativeDescriptors = () => nativeNames.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const assertNative = expected => assert.deepEqual(nativeDescriptors(), expected, "exact native constructor descriptors");
  const queue = () => {
    const callbacks = [];
    return { context: { after(callback) { assert.equal(typeof callback, "function"); callbacks.push(callback); } }, callbacks,
      async cleanup() {
        const failures = [];
        for (const callback of [...callbacks].reverse()) try { await callback(); } catch (error) { failures.push(error); }
        if (failures.length) throw new AggregateError(failures, "Queued native fixture cleanup failed");
      } };
  };
  const contained = async body => {
    // The older fetch/FormData/style/focus ports use captured-value restores,
    // not leases. Contain deliberate FIFO teardown without repairing, masking,
    // or manually restoring any of the three native constructor bindings.
    const ambient = [[globalThis, "fetch"], [globalThis, "FormData"],
      [ports.windowPort, "getComputedStyle"], [ports.documentPort, "activeElement"]]
      .map(([target, name]) => ({ target, name, descriptor: Object.getOwnPropertyDescriptor(target, name) }));
    const queues = [], createQueue = () => { const entry = queue(); queues.push(entry); return entry; };
    const failures = [];
    try { await body(createQueue); } catch (error) { failures.push(error); }
    for (const entry of [...queues].reverse()) try { await entry.cleanup(); } catch (error) { failures.push(error); }
    for (const entry of ambient) try {
      if (entry.descriptor) Object.defineProperty(entry.target, entry.name, entry.descriptor);
      else assert.ok(Reflect.deleteProperty(entry.target, entry.name));
      assert.deepEqual(Object.getOwnPropertyDescriptor(entry.target, entry.name), entry.descriptor);
    } catch (error) { failures.push(error); }
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, "Native lifecycle containment failed");
  };
  const actualTypes = async f => {
    const owner = f.renderer.component("forma-experience-review");
    assert.ok(owner?.isConnected && owner instanceof f.renderer.registry["forma-experience-review"]);
    const candidates = f.renderer.ownNodes(owner, "button").filter(node => node.handlers.click?.toString().includes("selectMaterial"));
    assert.equal(candidates.length, 1);
    const candidate = candidates[0];
    assert.ok(candidate.isConnected && owner.contains(candidate) && !candidate.disabled);
    ports.bindFixture(f);
    candidate.handlers.click.call(owner, reviewEvent("click", candidate));
    await untilScene(() => { f.draw(); return f.reviewForm("proposal"); }, "actual candidate selection supplies its native proposal controls");
    const form = f.reviewForm("proposal"), textarea = form.elements.namedItem("evidence");
    const input = form.elements.namedItem("title"), select = form.elements.namedItem("ownerUserId");
    const buttons = f.renderer.ownNodes(owner, "button").filter(node => node.isConnected && form.contains(node) && node.attributes.type === "submit");
    assert.equal(buttons.length, 1);
    const button = buttons[0], section = form.parentElement;
    assert.equal(section.tag, "section"); assert.ok(section.contains(form));
    const constructors = nativeDescriptors().map(descriptor => descriptor.value);
    assert.equal(new Set(constructors).size, 3, "button, form and textarea have distinct native classes");
    for (const [index, constructor] of constructors.entries()) {
      assert.equal(constructor.name, nativeNames[index]);
      assert.equal(Object.getPrototypeOf(constructor.prototype), ports.ElementPort.prototype);
    }
    for (const [node, expected] of [[button, 0], [form, 1], [textarea, 2], [input, -1], [select, -1], [section, -1]]) {
      assert.ok(node.isConnected && node.owner === owner && f.renderer.nodes.includes(node) && node instanceof ports.ElementPort);
      for (const [index, constructor] of constructors.entries()) assert.equal(node instanceof constructor, index === expected,
        node.tag + " has only its authored native type");
    }
    assert.equal(textarea.form, form); assert.equal(input.form, form); assert.equal(select.form, form);
    assert.equal(typeof textarea.setCustomValidity, "function"); assert.equal(typeof form.reset, "function");
    assert.equal(typeof form.handlers.submit, "function"); assert.equal(typeof button.disabled, "boolean");
    for (const tag of ["button", "form", "textarea"]) {
      const forged = Object.assign(Object.create(ports.ElementPort.prototype), { tag });
      assert.ok(forged instanceof ports.ElementPort);
      for (const constructor of constructors) assert.equal(forged instanceof constructor, false, "a forged mutable tag is not a native type");
    }
    return { constructors, nodes: [button, form, textarea] };
  };
  const overlap = order => contained(async createQueue => {
    const before = nativeDescriptors(), firstQueue = createQueue();
    const first = await productDeliveryFixture(firstQueue.context, { maintenanceAdoption: true });
    const firstTypes = await actualTypes(first), installed = nativeDescriptors();
    for (const [index, descriptor] of installed.entries()) assert.deepEqual(descriptor,
      { value: firstTypes.constructors[index], configurable: true, writable: true, enumerable: false });
    const secondQueue = createQueue(), second = await productDeliveryFixture(secondQueue.context, { maintenanceAdoption: true });
    const secondTypes = await actualTypes(second);
    assert.equal(first.host.isConnected, true); assert.equal(second.host.isConnected, true);
    assertNative(installed);
    for (const [index, constructor] of firstTypes.constructors.entries()) {
      assert.equal(secondTypes.constructors[index], constructor, "simultaneously live fixtures share each exact class");
      assert.ok(firstTypes.nodes[index] instanceof constructor && secondTypes.nodes[index] instanceof constructor);
    }
    assert.equal(firstQueue.callbacks.length, 1); assert.equal(secondQueue.callbacks.length, 1);
    const releases = order === "FIFO" ? [firstQueue, secondQueue] : [secondQueue, firstQueue];
    await releases[0].cleanup(); assertNative(installed);
    await releases[0].cleanup(); assertNative(installed);
    // Retained nodes prove class identity, not session/access custody after a
    // sibling's existing ambient teardown has run.
    for (const types of [firstTypes, secondTypes]) for (const [index, constructor] of types.constructors.entries())
      assert.ok(types.nodes[index] instanceof constructor);
    await releases[1].cleanup(); assertNative(before);
    await releases[1].cleanup(); assertNative(before);
  });
  await t.test("FIFO cleanup retains the second lease and restores the originals", () => overlap("FIFO"));
  await t.test("LIFO cleanup retains the first lease and restores the originals", () => overlap("LIFO"));
  const setupFault = (child, phase) => contained(async createQueue => {
    const before = nativeDescriptors(), failedQueue = createQueue(), failure = new Error("One native " + phase + " setup fault");
    const defineProperty = Object.defineProperty, setPrototypeOf = Object.setPrototypeOf;
    let faults = 0, observed;
    if (phase === "install") child.mock.method(Object, "defineProperty", function (target, name, descriptor) {
      if (faults === 0 && target === globalThis && name === "HTMLFormElement" && typeof descriptor?.value === "function"
        && descriptor.value.name === "HTMLFormElement" && Object.getPrototypeOf(descriptor.value.prototype) === ports.ElementPort.prototype) {
        faults++; observed = nativeDescriptors();
        assert.equal(observed[0].value.name, "HTMLButtonElement");
        assert.deepEqual(observed.slice(1), before.slice(1), "the exact second install fails after only Button was installed");
        throw failure;
      }
      return defineProperty(target, name, descriptor);
    });
    else child.mock.method(Object, "setPrototypeOf", function (node, prototype) {
      const formType = Object.getOwnPropertyDescriptor(globalThis, "HTMLFormElement")?.value;
      if (faults === 0 && typeof formType === "function" && prototype === formType.prototype
        && node?.owner?.tag === "forma-experience-review" && node.tag === "form"
        && Object.hasOwn(node.attributes ?? {}, "data-experience-publication-lookup")) {
        faults++; observed = { node, owner: node.owner, descriptors: nativeDescriptors() };
        assert.ok(node.owner.fixture.renderer.nodes.includes(node));
        assert.ok(node.owner instanceof node.owner.fixture.renderer.registry["forma-experience-review"]);
        assert.equal(Object.getPrototypeOf(node), ports.ElementPort.prototype);
        throw failure;
      }
      return setPrototypeOf(node, prototype);
    });
    try {
      await assert.rejects(productDeliveryFixture(failedQueue.context, { maintenanceAdoption: true }), error => error === failure);
    } finally { child.mock.restoreAll(); }
    assert.equal(faults, 1); assert.equal(failedQueue.callbacks.length, 1);
    if (phase === "brand") {
      assert.equal(observed.owner.isConnected, false, "setup failure retires the actual owned Review before returning");
      for (const [index, descriptor] of observed.descriptors.entries()) {
        assert.equal(descriptor.value.name, nativeNames[index]);
        assert.deepEqual(descriptor, { value: descriptor.value, configurable: true, writable: true, enumerable: false });
      }
    }
    assertNative(before);
    const healthyQueue = createQueue(), healthy = await productDeliveryFixture(healthyQueue.context, { maintenanceAdoption: true });
    await actualTypes(healthy); const installed = nativeDescriptors();
    await failedQueue.cleanup(); assertNative(installed);
    await failedQueue.cleanup(); assertNative(installed);
    assert.equal(healthy.host.isConnected, true, "the stale failed-setup cleanup does not retire a later fixture");
    assert.equal(healthyQueue.callbacks.length, 1);
    await healthyQueue.cleanup(); assertNative(before);
  });
  await t.test("Second constructor install failure rolls back the partial installation", child => setupFault(child, "install"));
  await t.test("Owned form branding failure releases once before the next fixture", child => setupFault(child, "brand"));
});
