import assert from "node:assert/strict";
import test from "node:test";
import { settingsFixture, endpoint, tokenPath, method, memberReadLiveLocale } from "./helpers/workspace-settings-whole-read-fixture.mjs";

// Actual complete Settings/Store/render and the existing finite HTTP service.
// These are emitted-subject/native-port contracts, not Worker approval, browser
// required-validation, accessibility, pointer or queued-event timing proof.
const options = { timeout: 45_000, concurrency: false };
const title = id => "Finite pending " + id;
const packageRow = (id, draft) => ({ id, name: title(id), description: "Explicit finite review catalog input",
  version: 1, versionId: id + "-published", versionStatus: "published", blockCount: 1, bindingCount: 0,
  publishedAt: "2026-08-30T12:00:00.000Z", pendingDraftVersionId: draft, pendingDraftVersion: 2, canApprove: true,
  draftPreview: [{ handle: "direction/" + id, type: "direction", text: "Finite evidence for " + draft,
    locked: false, intent: "include", active: true, exactText: null, exactPlacements: [],
    protectedPhrases: [], relations: [], sourceName: null, rightsExpiresAt: null }] });
const publishPath = row => endpoint("A", "/context-packages/" + encodeURIComponent(row.id)
  + "/versions/" + encodeURIComponent(row.pendingDraftVersionId) + "/publish");

// Only literal nodes of the actual current review form are retained. Identity
// comes from the renderer's real @submit EventPart (template + keyed/repeat path),
// never the expected package, version, visible name, index or a test-authored key.
// Retain the enclosing native details' unbound open state and the checkbox's
// unbound checked state, as well as the actual form object/current EventPart.
function reviewNativeParts(t, f) {
  const renderer = f.renderer, draw = f.draw, value = renderer.value, collect = renderer.collect;
  let drawing = false, previous = new Set(), seen = new Set(), emitted = new Map(), current = [], rowStack = [];
  const records = new Map();
  const copy = (old, fresh) => {
    for (const key of ["full", "attributes", "properties", "propertyParts", "handlers"]) old[key] = fresh[key];
    old.owner = fresh.owner; old.parentElement = fresh.parentElement; old.isConnected = true;
    renderer.nodes[renderer.nodes.indexOf(fresh)] = old; fresh.isConnected = false;
    return old;
  };
  renderer.value = function (part, owner, path, caches) {
    const row = drawing && owner === f.host && part?.strings?.[0] === '<li><div><b dir="auto">';
    if (row) rowStack.push({ name: part.values[0] });
    try {
      const result = Reflect.apply(value, this, [part, owner, path, caches]);
      if (drawing && owner === f.host && part?.strings?.[0].startsWith('<form data-workspace-review @submit=')) {
        const opening = result.match(/^<form\b[^>]*>/u)?.[0]; assert.ok(opening);
        assert.equal(emitted.has(opening), false); assert.ok(rowStack.length);
        emitted.set(opening, { name: rowStack.at(-1).name, path, strings: part.strings });
      }
      return result;
    } finally { if (row) rowStack.pop(); }
  };
  renderer.collect = function (markup, owner) {
    const start = renderer.nodes.length; Reflect.apply(collect, this, [markup, owner]);
    if (!drawing || owner !== f.host) return;
    // This is collect's exact literal opening-token order, not a new renderer.
    const tags = [...markup.matchAll(/<([\w-]+)([^>]*)>/gu)], nodes = renderer.nodes.slice(start);
    assert.deepEqual(nodes.map(node => node.full), tags.map(tag => tag[0]));
    for (const [index, fresh] of nodes.entries()) {
      if (fresh.tag !== "form" || !Object.hasOwn(fresh.attributes, "data-workspace-review")) continue;
      const observation = emitted.get(fresh.full); assert.ok(observation);
      const token = fresh.full.match(/\s@submit=(?:["'])?__bound_(\d+)__(?:["'])?(?=[\s>])/u);
      const binding = token && renderer.bindings[Number(token[1])];
      assert.ok(binding && binding.owner === owner && typeof binding.part === "string");
      assert.strictEqual(binding.value, fresh.handlers.submit); assert.equal(typeof binding.value, "function");
      assert.match(String(binding.value), /approveOrganizationContextPackage/u);
      const end = markup.indexOf("</form>", tags[index].index); assert.ok(end > tags[index].index);
      const inside = nodes.filter((_node, position) => tags[position].index > tags[index].index && tags[position].index < end);
      assert.equal(inside.some(node => node.tag === "form"), false);
      const fields = inside.filter(node => node.tag === "input"), buttons = inside.filter(node => node.tag === "button");
      assert.equal(fields.length, 1); assert.equal(buttons.length, 1);
      const field = fields[0], button = buttons[0];
      assert.equal(field.attributes.type, "checkbox"); assert.equal(field.attributes.name, "reviewed");
      assert.equal(Object.hasOwn(field.attributes, "required"), true);
      assert.equal(Object.hasOwn(field.attributes, "checked"), false); assert.equal(Object.hasOwn(field.properties, "checked"), false);
      assert.equal(field.handlers.click, undefined); assert.equal(field.handlers.change, undefined);
      assert.equal(button.attributes.type, "submit");
      const detailOffset = markup.lastIndexOf("<details", tags[index].index);
      const detailIndex = tags.findIndex(tag => tag.index === detailOffset); assert.ok(detailIndex >= 0);
      assert.ok(markup.indexOf("</details>", detailOffset) > end);
      const details = nodes[detailIndex]; assert.equal(details.tag, "details");
      assert.equal(Object.hasOwn(details.attributes, "open"), false);
      const summaries = nodes.filter((node, position) => node.tag === "summary"
        && tags[position].index > detailOffset && tags[position].index < tags[index].index);
      assert.equal(summaries.length, 1);
      const scope = f.store.route.get().split("#")[0], authority = f.store.captureAuthorizationScope()?.key;
      const old = records.get(binding.part), same = old && old.owner === owner && old.store === owner.store
        && old.scope === scope && old.authority === authority && old.strings === observation.strings
        && [old.form, old.field, old.details].every(node => previous.has(node));
      const record = { ...observation, part: binding.part, owner, store: owner.store, scope, authority,
        form: same ? copy(old.form, fresh) : fresh, field: same ? copy(old.field, field) : field,
        details: same ? copy(old.details, details) : details, button, summary: summaries[0] };
      record.field.defaultChecked = false; record.field.form = record.form;
      assert.equal(seen.has(binding.part), false, "Ambiguous emitted subjects cannot borrow one native record");
      records.set(binding.part, record); seen.add(binding.part); current.push(record);
    }
  };
  f.draw = () => {
    previous = new Set(renderer.nodes.filter(node => node.isConnected)); seen = new Set(); emitted = new Map(); current = []; rowStack = []; drawing = true;
    try { return draw(); }
    finally {
      drawing = false;
      for (const [part, record] of records) if (!seen.has(part)) {
        for (const node of [record.form, record.field, record.details]) node.isConnected = false;
        records.delete(part);
      }
    }
  };
  t.after(() => { f.draw = draw; renderer.value = value; renderer.collect = collect; });
  return {
    rows() { f.draw(); return [...current]; },
    check(record, checked) {
      assert.ok(f.host.isConnected && record.owner === f.host);
      for (const node of [record.form, record.field, record.details, record.summary]) assert.ok(node.isConnected && renderer.nodes.includes(node));
      assert.equal(Object.hasOwn(record.field.attributes, "disabled"), false);
      assert.equal(record.field.handlers.click, undefined); assert.equal(record.summary.handlers.click, undefined);
      if (!record.details.open) { record.summary.click(); record.details.open = true; }
      if (record.field.checked !== checked) { record.field.click(); record.field.checked = checked; }
      // Explicit delivery of the existing finite native defaults; no app state,
      // validation result, handler, Source, permission or success is supplied.
      assert.equal(record.details.open, true); assert.equal(record.field.checked, checked);
    },
  };
}

async function subjectFixture(t) {
  const f = await settingsFixture(t), service = f.service, reply = service.reply;
  const a = packageRow("review-package-A", "review-draft-A1"), b = packageRow("review-package-B", "review-draft-B1");
  let catalog = [a, b], expectedProbe = null, refreshes = 0;
  const probes = [], errors = [], native = reviewNativeParts(t, f);
  service.reply = request => {
    try {
      if (request.url === endpoint("A", "/context-packages") && method(request) === "GET")
        return { status: 200, body: { packages: structuredClone(catalog) } };
      if (method(request) === "POST" && request.url !== tokenPath("A")) {
        probes.push(request); assert.equal(request.url, expectedProbe, "Original current rendered closure chooses the exact encoded subject endpoint");
        assert.equal(request.init.body, undefined); assert.equal(request.body, null);
        // A declared finite refusal, never a fake approval or backend grant.
        return { status: 409, body: { error: "finite_review_subject_probe_refused" } };
      }
      return reply(request);
    } catch (error) { errors.push(error); throw error; }
  };
  // Initial finite catalog enters through the original current resource reads.
  // No checkbox exists yet, so this setup route transition proves no retention.
  f.navigate("B"); await f.flush(); f.navigate("A"); await f.flush();
  const owner = f.host, route = f.store.route.get(), source = f.store.captureSourceOwnership();
  const unchanged = structuredClone({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
    user: f.store.session.get().user, authority: f.store.captureAuthorizationScope()?.key,
    budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets });
  const invariant = () => {
    assert.strictEqual(f.host, owner); assert.ok(owner.isConnected); assert.equal(f.store.route.get(), route);
    assert.equal(f.store.sourceOwnershipActive(source), true); assert.equal(service.pending, 0); assert.deepEqual(errors, []);
    assert.deepEqual({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
      user: f.store.session.get().user, authority: f.store.captureAuthorizationScope()?.key,
      budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets }, unchanged);
    assert.equal(service.tokenCount.A, refreshes); assert.equal(service.tokenCount.B, 0);
    assert.equal(service.credentials.A.length, refreshes); assert.equal(service.credentials.B.length, 0);
    assert.equal(service.writes.length, refreshes);
    for (const [index, write] of service.writes.entries()) {
      assert.equal(write.method, "POST"); assert.equal(write.url, tokenPath("A")); assert.equal(write.body, null);
      assert.equal(write.receipt.credentialId, "fixture-credential-A-" + (index + 1));
      assert.equal(write.receipt.token, "fixture-token-A-" + (index + 1));
    }
    assert.ok(service.requests.every(request => method(request) === "GET"
      || method(request) === "POST" && (request.url === tokenPath("A") || probes.includes(request))));
    f.assertNoExternal();
  };
  const rows = () => {
    const observed = native.rows(); assert.equal(observed.length, catalog.filter(row => row.canApprove).length);
    assert.deepEqual(observed.map(row => row.name), catalog.filter(row => row.canApprove).map(row => row.name));
    return observed;
  };
  const named = (observed, row) => {
    const matches = observed.filter(record => record.name === row.name); assert.equal(matches.length, 1);
    return matches[0]; // Name locates this snapshot only; it never participates in retention.
  };
  const refresh = async next => {
    catalog = structuredClone(next);
    // Existing actual native control -> original finite201 token operation ->
    // original Store session refresh -> same-owner Settings #load. No approval.
    f.issue(); refreshes++; await f.flush(); invariant(); return rows();
  };
  const endpointWitness = async (record, row) => {
    native.check(record, true); assert.equal(record.field.defaultChecked, false);
    assert.equal(Object.hasOwn(record.field.attributes, "required"), true);
    assert.equal(Object.hasOwn(record.button.attributes, "disabled"), false);
    expectedProbe = publishPath(row); const before = probes.length; let prevented = false;
    // Invoke only the exact currently emitted closure as a provenance witness.
    // This does not claim browser requestSubmit/required validation or approval.
    await record.form.handlers.submit.call(owner, { type: "submit", target: record.form, currentTarget: record.form,
      submitter: record.button, preventDefault() { prevented = true; }, stopPropagation() {} });
    expectedProbe = null; await f.flush();
    assert.equal(prevented, true); assert.equal(probes.length, before + 1);
    assert.ok(service.requests.includes(probes.at(-1))); assert.equal(probes.at(-1).url, publishPath(row));
    assert.equal(f.store.ui.toast, "finite_review_subject_probe_refused"); invariant();
  };
  t.after(() => { service.reply = reply; assert.deepEqual(errors, []); });
  invariant(); return { f, a, b, native, rows, named, refresh, invariant, endpointWitness };
}

test("Settings actual review subject retains its native check through same-subject refresh, rename and locale", options, async t => {
  const x = await subjectFixture(t), first = x.rows(), a0 = x.named(first, x.a), b0 = x.named(first, x.b);
  x.native.check(a0, true); assert.equal(b0.field.checked, false);
  const renamed = { ...x.a, name: "Same immutable A, renamed 日本語" };
  let next = await x.refresh([renamed, x.b]), a1 = x.named(next, renamed), b1 = x.named(next, x.b);
  assert.strictEqual(a1.form, a0.form); assert.strictEqual(a1.field, a0.field); assert.equal(a1.field.checked, true);
  assert.strictEqual(b1.field, b0.field); assert.equal(b1.field.checked, false);
  const locale = memberReadLiveLocale(x.f); locale.change("ja"); await x.f.flush(); next = x.rows();
  a1 = x.named(next, renamed); b1 = x.named(next, x.b);
  assert.strictEqual(a1.field, a0.field); assert.equal(a1.field.checked, true); assert.equal(b1.field.checked, false);
  assert.equal(a1.part, a0.part, "The actual rendered EventPart remains the same immutable subject");
  await x.endpointWitness(a1, renamed); x.invariant();
});

test("Settings actual review subject follows reorder and retires a replaced pending version before another attestation", options, async t => {
  const x = await subjectFixture(t), first = x.rows(), a0 = x.named(first, x.a), b0 = x.named(first, x.b);
  x.native.check(a0, true); assert.equal(b0.field.checked, false);
  const ordered = await x.refresh([x.b, x.a]), a1 = x.named(ordered, x.a), b1 = x.named(ordered, x.b);
  const reorder = { aSame: a1.field === a0.field, bSame: b1.field === b0.field,
    aChecked: a1.field.checked, bUnchecked: b1.field.checked === false };
  x.native.check(a1, true);
  const replacement = { ...x.a, pendingDraftVersionId: "review-draft-A2", pendingDraftVersion: 3,
    draftPreview: [{ ...x.a.draftPreview[0], text: "Different exact immutable evidence for A2" }] };
  const replaced = await x.refresh([x.b, replacement]), a2 = x.named(replaced, replacement), b2 = x.named(replaced, x.b);
  const changed = { oldRetired: !a1.field.isConnected, differentField: a2.field !== a1.field,
    differentPart: a2.part !== a1.part, newUnchecked: a2.field.checked === false,
    bSame: b2.field === b1.field, bCheckedUnchanged: b2.field.checked === b1.field.checked };
  // Permission removal must withdraw the exact field; reappearance is a fresh
  // presentation, not a resurrection of the prior native attestation.
  x.native.check(a2, true);
  const unavailable = await x.refresh([x.b, { ...replacement, canApprove: false }]);
  assert.equal(unavailable.length, 1); assert.equal(a2.field.isConnected, false);
  const returned = x.named(await x.refresh([x.b, replacement]), replacement);
  assert.notStrictEqual(returned.field, a2.field); assert.equal(returned.field.checked, false);
  await x.endpointWitness(returned, replacement);
  t.diagnostic("SETTINGS_REVIEW_SUBJECT_IDENTITY " + JSON.stringify({ reorder, changed,
    originalPart: a0.part, reorderedPart: a1.part, replacementPart: a2.part,
    evidence: "actual full Settings render/Store and finite service; exact EventPart native witness, no browser approval/validation claim" }));
  assert.deepEqual(reorder, { aSame: true, bSame: true, aChecked: true, bUnchecked: true });
  assert.deepEqual(changed, { oldRetired: true, differentField: true, differentPart: true, newUnchecked: true,
    bSame: true, bCheckedUnchanged: true });
  x.invariant();
});

// Positive HTTP caller contract only. The original two identity/409 witnesses
// remain exact; genuine Store/Worker approval receipts are covered separately.
// One existing finite token completion drives a same-owner catalog refresh.
// No Store method, application callback, currentness predicate or result is replaced.
for (const retired of [false, true]) test("Settings original positive approval HTTP / "
  + (retired ? "retired exact form cannot start the new subject's load" : "healthy exact form completes its current load"), options, async t => {
  const x = await subjectFixture(t), { f } = x, service = f.service;
  const current = x.named(x.rows(), x.a), owner = f.host, route = f.store.route.get();
  x.native.check(current, true);
  assert.ok(owner.contains(current.form)); assert.equal(current.field.checked, true);
  assert.equal(Object.hasOwn(current.field.attributes, "required"), true);
  assert.equal(Object.hasOwn(current.button.attributes, "disabled"), false);
  assert.ok(current.button.isConnected && f.renderer.nodes.includes(current.button));
  const source = f.store.captureSourceOwnership(), authorization = f.store.captureAuthorizationScope()?.key;
  assert.equal(f.store.session.get().projectContext, undefined);
  const unchanged = structuredClone({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
    user: f.store.session.get().user, budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets });
  const prefix = service.requests.map(request => [method(request), request.url]);
  const expectedReads = ["/api/workspaces", endpoint("A"), endpoint("A", "/pilot"), endpoint("A", "/retention"),
    endpoint("A", "/context-packages"), endpoint("A", "/assurance"), endpoint("A", "/security"),
    endpoint("A", "/holds"), endpoint("A", "/recovery"), tokenPath("A"), endpoint("A", "/deletion")].map(path => ["GET", path]);
  const expected = { version: x.a.pendingDraftVersion }, url = publishPath(x.a);
  const gate = service.queue(request => method(request) === "POST" && request.url === url, "body", { status: 200, body: expected });
  const received = [], observerErrors = [], transport = f.storeHost.transport;
  assert.equal(transport, null); assert.strictEqual(f.storeHost.worker.request, service.request);
  f.storeHost.transport = async request => {
    const response = await f.storeHost.worker.request(request.url, request.init);
    if (request.url === url && method(request) === "POST") {
      const observation = { response, request, json: response.json, body: null };
      received.push(observation);
      // Read only a clone of the exact finite response bytes. The service's
      // own non-writable json gate and the caller's original Response stay exact.
      try { observation.body = await response.clone().json(); }
      catch (error) { observerErrors.push(error); throw error; }
    }
    return response;
  };
  t.after(() => { f.storeHost.transport = transport; });
  let prevented = false;
  // Exact current emitted submit closure, not a claim of browser form validation.
  // The required native check is present; no synthetic approval handler is supplied.
  const original = current.form.handlers.submit.call(owner, { type: "submit", target: current.form,
    currentTarget: current.form, submitter: current.button, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.ok(original?.then); const completion = original.then(value => ({ value }), error => ({ error }));
  const reply = service.reply;
  let next = x.a;
  service.reply = request => request.url === endpoint("A", "/context-packages") && method(request) === "GET"
    ? { status: 200, body: { packages: structuredClone([next, x.b]) } } : reply(request);
  try {
    await f.until(() => gate.jsonCalls === 1, "The actual Settings/Store caller reaches the original positive response body");
    assert.equal(prevented, true); assert.equal(gate.used, true); assert.equal(received.length, 1);
    assert.equal(received[0].response.status, 200); assert.deepEqual(received[0].body, expected);
    assert.strictEqual(received[0].response.json, received[0].json); assert.equal(received[0].response.bodyUsed, false);
    assert.ok(service.requests.includes(gate.request)); assert.equal(gate.request.url, url);
    assert.strictEqual(received[0].request.init, gate.request.init);
    assert.equal(method(gate.request), "POST"); assert.equal(gate.request.init.body, undefined); assert.equal(gate.request.body, null);
    assert.equal(service.requests.filter(request => method(request) === "POST").length, 1);
    assert.equal(service.writes.length, 0, "A finite HTTP shape is not an actual approval/commit receipt");
    next = retired ? { ...x.a, pendingDraftVersionId: "review-draft-A-next", pendingDraftVersion: 3,
      draftPreview: [{ ...x.a.draftPreview[0], text: "New current immutable subject while original A response is held" }] } : structuredClone(x.a);
    f.issue(); await f.flush();
    assert.strictEqual(f.host, owner); assert.equal(f.store.route.get(), route);
    assert.equal(f.store.captureAuthorizationScope()?.key, authorization); assert.equal(f.store.sourceOwnershipActive(source), true);
    assert.equal(service.pending, 0); assert.equal(service.writes.length, 1);
    assert.equal(service.writes[0].method, "POST"); assert.equal(service.writes[0].url, tokenPath("A"));
    assert.equal(service.writes[0].body, null); assert.equal(service.writes[0].receipt.credentialId, "fixture-credential-A-1");
    assert.equal(service.writes[0].receipt.token, "fixture-token-A-1");
    assert.equal(service.tokenCount.A, 1); assert.equal(service.credentials.A.length, 1);
    const rows = x.native.rows(), subject = x.named(rows, next); assert.equal(rows.length, 2);
    assert.equal(current.form.isConnected, !retired);
    assert.equal(subject.form === current.form, !retired, "Only the changed immutable subject retires the original form");
    assert.equal(subject.part === current.part, !retired);
    if (retired) { assert.equal(subject.field.checked, false); x.native.check(subject, true); }
    assert.equal(subject.field.checked, true); assert.ok(owner.contains(subject.form));
    const beforeRelease = service.requests.length, beforeReads = service.requests.filter(request => method(request) === "GET").length;
    assert.deepEqual(service.requests.slice(0, prefix.length).map(request => [method(request), request.url]), prefix);
    assert.deepEqual(service.requests.slice(prefix.length).map(request => [method(request), request.url]),
      [["POST", url], ["POST", tokenPath("A")], ["GET", "/api/session"], ["GET", "/api/workspaces/reviews"], ...expectedReads],
      "The held original plus the one existing token/session/current-catalog refresh are exactly accounted for before release");
    assert.equal(received[0].response.bodyUsed, false); gate.release.resolve();
    const result = await completion; assert.equal(result.error, undefined); assert.equal(result.value, undefined);
    await f.flush();
    assert.equal(gate.jsonCalls, 1); assert.equal(received[0].response.bodyUsed, true);
    assert.strictEqual(received[0].response.json, received[0].json); assert.deepEqual(observerErrors, []);
    assert.equal(f.store.ui.toast, f.i18n.system("Organization context version {version} was published. Following documents must explicitly accept the update.",
      { version: expected.version }), "The actual unchanged-authorization Store caller reaches its original positive feedback");
    assert.equal(service.requests.filter(request => method(request) === "POST" && request.url === url).length, 1);
    assert.equal(service.requests.filter(request => method(request) === "POST").length, 2, "One original finite approval HTTP and one existing finite token operation only");
    assert.equal(service.writes.length, 1, "The positive HTTP fixture never manufactures a backend approval receipt");
    assert.deepEqual({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
      user: f.store.session.get().user, budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets }, unchanged);
    assert.strictEqual(f.host, owner); assert.equal(f.store.route.get(), route);
    assert.equal(f.store.captureAuthorizationScope()?.key, authorization); assert.equal(f.store.sourceOwnershipActive(source), true);
    assert.equal(service.pending, 0); f.assertNoExternal();
    const after = x.named(x.native.rows(), next);
    assert.strictEqual(after.form, subject.form); assert.strictEqual(after.field, subject.field); assert.equal(after.field.checked, true);
    const followup = service.requests.slice(beforeRelease).map(request => [method(request), request.url]);
    t.diagnostic("SETTINGS_POSITIVE_ACK_CALLER " + JSON.stringify({ retired, originalStatus: received[0].response.status,
      originalJsonCalls: gate.jsonCalls, originalFormConnected: current.form.isConnected, sameOwner: f.host === owner,
      sameRoute: f.store.route.get() === route, beforeReads, afterReads: service.requests.filter(request => method(request) === "GET").length,
      followup, finiteApprovalReceipt: false, evidence: "actual Settings/Store caller; original finite HTTP response; no Worker/pilot/browser approval claim" }));
    assert.deepEqual(followup, retired ? [] : expectedReads,
      retired ? "A true original ACK cannot acquire a fresh #load owner after its exact form retires"
        : "A current exact original form must complete the actual existing same-resource #load");
  } finally {
    gate.release.resolve(); await completion; service.reply = reply; f.storeHost.transport = transport;
    assert.deepEqual(observerErrors, []);
  }
});
