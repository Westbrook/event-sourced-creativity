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
