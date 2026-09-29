// Permanent regression: actual complete WorkspaceSettings/Store with finite HTTP
// and same-template native FormData/form lifetime ports. No Worker, financial,
// physical-browser or provider authorization is claimed by the finite replies.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";

const digest = value => createHash("sha256").update(value).digest("hex");
const base = new URL("../", import.meta.url);
const tsModule = await import(new URL("node_modules/typescript/lib/typescript.js", base)); const ts = tsModule.default ?? tsModule;
const fixtureUrl = new URL("tests/workspace-settings-response-ownership.test.mjs", base);
const source = fs.readFileSync(fixtureUrl, "utf8");
const tree = ts.createSourceFile(fixtureUrl.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
// Same declaration-only export technique as workspace-settings-confirmation.
// No current component or Store method is extracted, exposed or replaced.
const prefix = tree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)).map(node => node.getFullText(tree)).join("\n")
  + "\nexport {settingsFixture, ORG, PRINCIPAL, PROJECT, DOCUMENT, events, fiscal, endpoint, path, NOW};\n";
fixtureUrl.search = "workspace-draft-completion-fixture-only";
const loader = registerHooks({ load(url, context, next) {
  return url === fixtureUrl.href ? { format: "module", source: prefix, shortCircuit: true } : next(url, context);
} });
let originalFixture;
try { originalFixture = await import(fixtureUrl.href); } finally { loader.deregister(); }
const { settingsFixture, ORG, PRINCIPAL, PROJECT, events, endpoint, path: settingsPath, NOW } = originalFixture;
const { calmFullPageNativePorts: ports } = await import(new URL("tests/helpers/calm-full-page-fixture.mjs", base));
console.log("B3_DRAFT_RESET_PREFIX " + JSON.stringify({ source: digest(source), prefix: digest(prefix), applicationMethodsChanged: false }));

const PROJECT_B = "settings-personal-project-B", CREATED = ORG.B;
const cases = [
  { id: "organization", marker: "#submitOrganization", section: "overview", url: "/api/workspaces",
    a: { name: "Original new organization A" }, b: { name: "Newer unsubmitted organization B" } },
  { id: "invitation", marker: "#submitInvite", section: "members", url: endpoint("A", "/members"),
    a: { email: "original-a@example.invalid", role: "member" }, b: { email: "newer-b@example.invalid", role: "administrator" } },
  { id: "registration", marker: "#registerProject", section: "projects", url: endpoint("A", "/projects"),
    a: { projectId: PROJECT }, b: { projectId: PROJECT_B } },
  { id: "grant", marker: "#grantProject", section: "projects", url: endpoint("A", "/projects/settings-access-A/members"),
    a: { userId: "successor-A", role: "viewer" }, b: { userId: "successor-A", role: "editor" } },
  { id: "pilot", marker: "#enrollPilot", section: "members", url: endpoint("A", "/pilot/participants"),
    a: { email: "original-pilot-a@example.invalid", role: "member" }, b: { email: "newer-pilot-b@example.invalid", role: "reviewer" } },
  { id: "hold", marker: "The exact organization evidence is protected by an active legal hold.", section: "usage", url: endpoint("A", "/holds"),
    a: { scope: "organization", resourceId: "", reason: "Original evidence reason A" }, b: { scope: "organization", resourceId: "", reason: "Newer unsubmitted evidence reason B" } },
];
const within = (node, parent) => { for (let value = node.parent; value; value = value.parent)
  if (value === parent || parent.port && value.port === parent.port) return true; return false; };
const samePath = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
function draftLocaleCheckpoint(stage, read = () => ({})) {
  if (process.env.FORMA_SETTINGS_DRAFT_TRACE !== "1") return;
  process.stderr.write("C_SETTINGS_DRAFT_TRACE " + JSON.stringify({ stage, ...read() }) + "\n");
}

// Adapts nativeCreateForms in product-delivery-refresh-continuity.test.mjs:
// exact TemplateStringsArray ancestry retains the form; a real template/route
// departure disconnects it. The production render and handlers stay untouched.
// Unlike the original finite Settings draw, it does not manufacture form loss
// on each ordinary redraw. Raw FormData remains in the existing f.forms port.
function nativeFormLifetime(f, entry, { owner: nestedOwner } = {}) {
  let retained = null; const all = [], resets = [], emittedOwners = new Map(), renderedForms = new Map();
  let capturing = false;
  // Observe the original evaluation once. The existing renderer already owns
  // keyed/repeat ancestry; no render callback or account state is re-evaluated.
  // Ordinary array/TemplateResult paths retain the original locate() below.
  const value = f.renderer.value.bind(f.renderer);
  f.renderer.value = (part, owner, path, caches) => {
    if (capturing && nestedOwner && !emittedOwners.has(owner)) emittedOwners.set(owner, part);
    if (capturing && part?.strings
      && part.values.some(value => typeof value === "function" && value.toString().includes(entry.marker))) {
      assert.equal(typeof path, "string", "The actual renderer supplies the current form's native part path");
      const observed = renderedForms.get(owner) ?? [];
      observed.push({ path: [path, part.strings] }); renderedForms.set(owner, observed);
    }
    return value(part, owner, path, caches);
  };
  const currentOwner = () => nestedOwner ? nestedOwner() : f.host;
  const disconnect = f.disconnect;
  f.disconnect = () => {
    if (retained) { retained.form.isConnected = false; retained.form.parentElement = null; retained = null; }
    return disconnect();
  };
  const locate = (part, ancestry = []) => {
    if (Array.isArray(part)) return part.flatMap((child, index) => locate(child, [...ancestry, index]));
    if (!part?.strings) return [];
    const own = [...ancestry, part.strings];
    if (part.values.some(value => typeof value === "function" && value.toString().includes(entry.marker))) return [{ path: own }];
    return part.values.flatMap((child, index) => locate(child, [...own, index]));
  };
  const actual = () => f.tree().visible("form").filter(node => node.owner === currentOwner() && String(node.handlers.submit).includes(entry.marker));
  const fields = form => f.tree().nodes.filter(node => within(node, form) && ["input", "select", "textarea"].includes(node.tag) && node.attributes.name);
  const options = field => f.tree().nodes.filter(node => node.tag === "option" && within(node, field));
  const defaults = field => {
    assert.equal(Object.hasOwn(field.properties, "value"), false, "Audited raw fields are natively owned, not a controlled binding");
    if (field.tag === "select") {
      const choices = options(field), selected = choices.find(node => Object.hasOwn(node.attributes, "selected") || node.properties.selected === true) ?? choices[0];
      return String(selected?.attributes.value ?? selected?.text ?? "");
    }
    return String(field.attributes.value ?? (field.tag === "textarea" ? field.text : ""));
  };
  f.draw = () => {
    ports.bindFixture(f); if (!f.host.isConnected) return "";
    for (const node of f.renderer.nodes) node.isConnected = false;
    f.requested = false; let emitted, markup; emittedOwners.clear(); renderedForms.clear(); capturing = true;
    try { markup = f.renderer.draw(f.host, () => { emitted = f.host.render(); return emitted; }); }
    finally { capturing = false; }
    const owner = currentOwner(), ordinary = locate(nestedOwner ? emittedOwners.get(owner) : emitted);
    // A repeated form is reached only through its actual renderer evaluation.
    // Its key is part of that path, never a synthetic native-field reset rule.
    const templates = ordinary.length ? ordinary : (renderedForms.get(owner) ?? []);
    const found = owner ? f.renderer.ownNodes(owner, "form").filter(node => String(node.handlers.submit).includes(entry.marker)) : [];
    assert.equal(templates.length, found.length, "Exact native form and actual template agree"); assert.ok(found.length <= 1);
    if (retained && (!found.length || retained.owner !== owner || !samePath(retained.path, templates[0].path))) {
      retained.form.isConnected = false; retained.form.parentElement = null; retained = null;
    }
    if (found.length) {
      const fresh = found[0];
      if (retained) {
        const form = retained.form;
        for (const key of ["full", "handlers", "attributes", "properties"]) form[key] = fresh[key];
        form.isConnected = true; form.parentElement = owner;
        f.renderer.nodes[f.renderer.nodes.indexOf(fresh)] = form;
      } else {
        fresh.parentElement = owner;
        retained = { form: fresh, owner, path: templates[0].path, defaults: null }; all.push(retained);
        const nativeReset = fresh.reset;
        fresh.reset = () => {
          resets.push({ form: fresh, before: Object.fromEntries(f.forms.get(fresh) ?? []) });
          nativeReset(); f.forms.set(fresh, new Map(retained?.form === fresh ? retained.defaults : []));
        };
      }
      const node = actual()[0]; assert.equal(node.port, retained.form);
      if (!retained.defaults) retained.defaults = fields(node).map(field => [field.attributes.name, defaults(field)]);
      if (!f.forms.has(retained.form)) f.forms.set(retained.form, new Map(retained.defaults));
      for (const field of fields(node)) field.port.value = String(f.forms.get(retained.form).get(field.attributes.name) ?? "");
    }
    return markup;
  };
  const current = () => { f.draw(); const nodes = actual(); assert.equal(nodes.length, 1, "One current visible audited form"); return nodes[0]; };
  const editable = field => {
    assert.ok(field.port?.isConnected && !field.hiddenBy, "Actual visible connected native field");
    assert.equal(Object.hasOwn(field.attributes, "disabled") || field.properties.disabled === true || field.port.disabled === true, false);
    assert.equal(Object.hasOwn(field.attributes, "readonly") || field.properties.readOnly === true, false);
    for (let node = field; node; node = node.parent) {
      assert.equal(Object.hasOwn(node.attributes ?? {}, "inert"), false, "No inert ancestor admits input");
      assert.equal(node.tag === "fieldset" && Object.hasOwn(node.attributes, "disabled"), false, "Disabled fieldset does not admit input");
    }
  };
  const fill = values => {
    const form = current(), nativeFields = fields(form); assert.deepEqual(nativeFields.map(field => field.attributes.name).sort(), Object.keys(values).sort());
    for (const field of nativeFields) {
      editable(field); const value = String(values[field.attributes.name]);
      if (field.tag === "select") assert.ok(options(field).some(option => String(option.attributes.value ?? option.text) === value
        && !Object.hasOwn(option.attributes, "disabled")), "New selection is an actual enabled option");
      field.port.value = value; f.forms.get(form.port).set(field.attributes.name, value);
      const event = field.tag === "select" ? "change" : "input";
      field.handlers[event]?.call(field.owner, { type: event, target: field.port, currentTarget: field.port, preventDefault() {}, stopPropagation() {} });
    }
    return form;
  };
  const button = form => {
    const found = f.tree().visible("button").filter(node => within(node, form) && node.attributes.type === "submit");
    assert.equal(found.length, 1); return found[0];
  };
  const submit = () => {
    const form = current(), positive = button(form);
    assert.equal(Object.hasOwn(positive.attributes, "disabled"), false, "Only an enabled current submitter is activated");
    for (const field of fields(form)) {
      editable(field);
      if (Object.hasOwn(field.attributes, "required")) assert.ok(String(f.forms.get(form.port).get(field.attributes.name) ?? ""), "Required native value is present");
      if (field.attributes.type === "email") assert.match(String(field.port.value), /^[^\s@]+@[^\s@]+\.[^\s@]+$/u);
    }
    return f.submit(form, Object.fromEntries(f.forms.get(form.port)));
  };
  return { current, fill, submit, button, resets, all, raw: form => Object.fromEntries(f.forms.get(form) ?? []), defaults: () => Object.fromEntries(retained?.defaults ?? []) };
}

async function setup(t, entry, { locale = "en" } = {}) {
  // Start on the existing Members task; install the additional finite
  // usage/pilot shapes before navigating to their actual current sections.
  const f = await settingsFixture(t, { locale, section: "members" }), service = f.service, originalReply = service.reply;
  const secondProject = { ...structuredClone(events[0]), eventId: "settings-project-B-created", sequence: events.length + 1,
    payload: { project_id: PROJECT_B, name: "Second legitimate personal project B" } };
  const setupEvents = [...structuredClone(events), secondProject];
  const finite = { created: null, invitations: [], registered: [], participants: [], holds: [] };
  // ORG.B is a declared fixture identity, initially absent from this case's
  // visible organization list. The create reply makes that new organization
  // available; no live or actual Worker organization is created.
  if (entry.id === "organization") {
    service.roles.B = "none"; service.session.organizations = service.session.organizations.filter(row => row.organizationId !== CREATED);
  }
  service.reply = request => {
    const method = (request.init.method ?? "GET").toUpperCase(), url = new URL(request.url, "http://localhost").pathname;
    if (method !== "GET") {
      assert.equal(method, "POST"); assert.equal(url, entry.url, "Only this current original endpoint may be written");
      assert.deepEqual(request.body, entry.a, "Only original A—not newer B—is sent");
      let body;
      if (entry.id === "organization") {
        body = { organizationId: CREATED, name: request.body.name, role: "owner" }; finite.created = body;
        service.roles.B = "owner"; service.session.organizations.push({ ...body });
      } else if (entry.id === "invitation") {
        const id = "finite-original-invitation-A", expiresAt = "2026-09-06T12:00:00.000Z";
        body = { invitationId: id, membershipId: id, status: "pending", expiresAt,
          invitationUrl: "http://localhost/settings/workspaces/invitations?invitation=" + id + "&token=finite-original-token-A" };
        finite.invitations.push({ invitation_id: id, email_normalized: request.body.email, role: request.body.role, status: "pending", expires_at: expiresAt });
      } else if (entry.id === "registration") {
        body = { projectAccessId: "finite-original-project-access-A", projectId: request.body.projectId, eventCount: 3, documentCount: 1 };
        finite.registered.push({ project_access_id: body.projectAccessId, project_id: body.projectId, project_name: "Settings fixture", owner_user_id: PRINCIPAL, status: "active" });
      } else if (entry.id === "grant") {
        body = { ok: true, role: request.body.role };
        service.projectMembers.A.push({ membership_id: "finite-original-project-member-A", user_id: request.body.userId,
          display_name: "PRIVATE_A_ADMIN", role: body.role, status: "active", canvas_access: 0, review_access: 0, created_at: NOW });
      } else if (entry.id === "pilot") {
        body = { participantId: "finite-original-participant-A", email: request.body.email, role: request.body.role, userId: null, reenrolled: false };
        finite.participants.push({ participant_id: body.participantId, email_normalized: body.email, user_id: null, role: body.role, status: "active", created_at: NOW, revoked_at: null });
      } else {
        assert.equal(entry.id, "hold"); body = { holdId: "finite-original-hold-A", scope: "organization", resourceId: ORG.A, status: "active", createdAt: NOW };
        finite.holds.push({ hold_id: body.holdId, scope_kind: body.scope, resource_id: body.resourceId, reason: request.body.reason, status: "active", created_by_user_id: PRINCIPAL, created_at: NOW, released_at: null });
      }
      service.writes.push({ method, url, body: structuredClone(request.body), receipt: structuredClone(body) });
      return { status: 201, body };
    }
    if (url === "/api/events") return { status: 200, body: { events: structuredClone(setupEvents), head: setupEvents.length, content: {} } };
    if (url === endpoint("A", "/usage")) return { status: 200, body: { organization: { organizationId: ORG.A, name: "Workspace A", role: "owner" },
      period: "2026-08", policy: { token_limit: 100000, microusd_limit: 60000000 }, cost: { used_microusd: 2400, reserved_microusd: 19644000 }, tokens: { used_tokens: 12, reserved_tokens: 34 }, reservations: [] } };
    const reply = originalReply(request); if (reply.status !== 200) return reply;
    if (url === "/api/workspaces" && finite.created) {
      const row = reply.body.organizations.find(value => value.organizationId === CREATED); if (row) row.name = finite.created.name;
    }
    if (url.startsWith(endpoint("B")) && finite.created && reply.body.organization) reply.body.organization.name = finite.created.name;
    if ([endpoint("A"), endpoint("A", "/members")].includes(url)) reply.body.invitations.push(...structuredClone(finite.invitations));
    if ([endpoint("A"), endpoint("A", "/projects")].includes(url)) reply.body.projects.push(...structuredClone(finite.registered));
    if (entry.id === "pilot" && url === endpoint("A", "/pilot")) Object.assign(reply.body, { cohort: {
      cohort_id: "finite-active-cohort-A", status: "active", starts_at: "2026-08-29T12:00:00.000Z", ends_at: "2026-09-28T12:00:00.000Z",
      max_participants: 10, participant_cap_microusd: 15000000, organization_cap_microusd: 150000000, source_classification: "non-sensitive-licensed" },
      participants: structuredClone(finite.participants) });
    if (url === endpoint("A", "/holds")) reply.body.holds.push(...structuredClone(finite.holds));
    return reply;
  };
  await f.store.refreshSession(); await f.store.refreshEvents(); f.draw();
  if (entry.id === "organization") f.store.setRoute("/settings/workspaces");
  else { f.navigate("B"); await f.flush(); f.navigate("A", entry.section); }
  await f.flush();
  const native = nativeFormLifetime(f, entry); native.current();
  assert.deepEqual(service.writes, [], "Fixture preparation does not submit any audited command");
  return { f, service, native, finite };
}

const originalNotice = (f, entry) => {
  const messages = {
    organization: ["workspace.admin.created", "Workspace created."],
    invitation: ["workspace.admin.invited", "A private, expiring invitation was created."],
    registration: ["workspace.admin.projectRegistered", "The project was safely indexed for collaboration."],
    grant: ["workspace.admin.projectGranted", "Project access was granted."],
    pilot: [null, "The named participant was enrolled in this pilot."],
    hold: [null, "The exact organization evidence is protected by an active legal hold."],
  };
  const [key, text] = messages[entry.id]; return key ? f.i18n.t(key, text) : f.i18n.system(text);
};
const visibleNotice = f => {
  const nodes = f.tree().visible("p").filter(node => node.attributes.role === "status"
    && String(node.attributes.class).split(/\s+/u).includes("workspace-settings-notice"));
  assert.equal(nodes.length, 1, "One existing visible completion status, not a new manager or focus target");
  const node = nodes[0]; assert.equal(node.attributes["aria-live"], "polite");
  assert.equal(String(node.attributes.class).split(/\s+/u).includes("sr-only"), false);
  assert.equal(Object.hasOwn(node.attributes, "hidden"), false); return node.text;
};
function assertRetainedNotice(f, entry) {
  const suffix = f.i18n.t("workspace.admin.newerFormKept");
  assert.notEqual(suffix, "workspace.admin.newerFormKept", "The installed locale supplies the retained-draft copy");
  if (f.locale !== "en") assert.notEqual(suffix, "Your newer form values were kept without being submitted.");
  const text = visibleNotice(f);
  assert.ok(text.includes(originalNotice(f, entry)), "Original positive ACK remains explicit");
  assert.ok(text.includes(suffix), "Newer raw fields were kept, not silently described as submitted");
}

// Existing phase5-retirement-localization/specialist-guidance provider port:
// publish a new snapshot through the actual LocaleController's public context
// callback. Keep the mounted Settings instance and its native forms intact.
function liveLocale(f) {
  f.i18n.hostDisconnected(); let publish, revision = 0;
  const snapshot = locale => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr",
    timeZone: "UTC", messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] }, revision: ++revision });
  const controller = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; },
    dispatchEvent(event) { publish = event.callback; publish(snapshot(f.locale), () => {}); return true; } });
  controller.hostConnected(); f.i18n = controller; f.host.i18n = controller;
  for (const { instance } of f.renderer.instances.values()) instance.i18n = controller;
  return { change(locale) { f.locale = locale; publish(snapshot(locale)); f.draw(); } };
}

for (const locale of ["en", "fr", "ar", "ja"]) for (const entry of cases) for (const edited of [false, true]) test("Workspace " + locale + " " + entry.id + " actual same-form " + (edited ? "newer B survives A ACK" : "unchanged A completes and resets"),
  { concurrency: false, timeout: 45000 }, async t => {
    const { f, service, native, finite } = await setup(t, entry, { locale });
    const sourceBefore = structuredClone(f.store.events.get()), authority = f.store.captureAuthorizationScope();
    const originalRoute = f.store.route.get(), form = native.fill(entry.a).port, defaults = native.defaults();
    assert.notDeepEqual(entry.b, defaults, "Newer B must be distinguishable from native reset defaults");
    const gate = service.queue(request => (request.init.method ?? "GET") === "POST" && request.url === entry.url, "headers");
    const submitted = native.submit();
    try {
      await gate.seen.promise; f.draw();
      assert.equal(service.writes.length, 1); assert.equal(gate.request.url, entry.url); assert.deepEqual(gate.request.body, entry.a);
      const current = native.current(); assert.equal(current.port, form, "Actual unchanged template retains the original native form");
      assert.equal(Object.hasOwn(native.button(current).attributes, "disabled"), true, "Pending original blocks a second submit");
      if (edited) native.fill(entry.b);
      assert.deepEqual(native.raw(form), edited ? entry.b : entry.a);
      assert.equal(f.store.route.get(), originalRoute); assert.equal(f.store.authorizationScopeActive(authority), true);
    } finally { gate.release.resolve(); if (submitted?.then) await submitted; }
    await f.flush(24);
    assert.equal(service.pending, 0, "Existing finite service requests have settled"); assert.equal(gate.jsonCalls, 1, "Actual #request decoded the held original response once");
    assert.equal(service.writes.length, 1); assert.deepEqual(service.writes[0].body, entry.a);
    assert.equal(service.requests.filter(request => (request.init.method ?? "GET") !== "GET").length, 1);
    assert.equal(f.store.authorizationScopeActive(authority), true); assert.deepEqual(f.store.events.get(), sourceBefore);
    f.assertNoExternal();
    const currentForms = f.tree().visible("form").filter(node => node.owner === f.host && String(node.handlers.submit).includes(entry.marker));
    const observation = { locale, case: entry.id, edited, originalRoute, currentRoute: f.store.route.get(),
      finiteReply: service.writes[0].receipt, originalCommand: service.writes[0].body, currentFormCount: currentForms.length,
      originalFormConnected: form.isConnected, resets: native.resets.length, resetValues: native.resets.map(value => value.before),
      retainedRaw: native.raw(form), sameAuthority: f.store.authorizationScopeActive(authority), sourceEventsUnchanged: true,
      finiteAccountingFieldsUnchanged: true, realWorkerReceiptClaimed: false, providerRequests: 0 };
    t.diagnostic("B3_WORKSPACE_DRAFT_RESET " + JSON.stringify(observation));
    if (!edited) {
      assert.equal(native.resets.length, 1); assert.deepEqual(native.raw(form), defaults);
      if (entry.id === "organization") { assert.ok(finite.created); assert.equal(f.store.route.get(), settingsPath("B", "overview")); }
      else { assert.equal(currentForms.length, 1); assert.equal(currentForms[0].port, form); assert.equal(form.isConnected, true); }
    } else {
      assert.equal(native.resets.length, 0, "A positive original response must not reset genuinely editable newer B");
      assert.equal(currentForms.length, 1, "Newer unsubmitted form remains reachable instead of automatic departure");
      assert.equal(currentForms[0].port, form); assert.equal(form.isConnected, true); assert.deepEqual(native.raw(form), entry.b);
      assertRetainedNotice(f, entry);
    }
  });

for (const entry of cases) test("Workspace " + entry.id + " newer B during the acknowledged refresh survives final cleanup",
  { concurrency: false, timeout: 45000 }, async t => {
    const { f, service, native } = await setup(t, entry);
    const route = f.store.route.get(), source = structuredClone(f.store.events.get()), authority = f.store.captureAuthorizationScope();
    const form = native.fill(entry.a).port;
    const refresh = service.queue(request => request.url === "/api/session" && (request.init.method ?? "GET") === "GET", "headers");
    const submitted = native.submit();
    try {
      await refresh.seen.promise; f.draw();
      assert.equal(service.writes.length, 1, "Original A was positively acknowledged before its follow-up read");
      assert.deepEqual(service.writes[0].body, entry.a);
      assert.equal(native.current().port, form);
      assert.equal(Object.hasOwn(native.button(native.current()).attributes, "disabled"), true);
      native.fill(entry.b);
    } finally { refresh.release.resolve(); if (submitted?.then) await submitted; }
    await f.flush(24);
    assert.equal(native.resets.length, 0); assert.equal(native.current().port, form);
    assert.deepEqual(native.raw(form), entry.b); assert.equal(f.store.route.get(), route);
    assert.equal(service.writes.length, 1); assert.equal(service.pending, 0);
    assert.deepEqual(f.store.events.get(), source); assert.equal(f.store.authorizationScopeActive(authority), true);
    assertRetainedNotice(f, entry); f.assertNoExternal();
  });

for (const entry of cases) test("Workspace " + entry.id + " deliberate raw B-to-A return retains unchanged completion",
  { concurrency: false, timeout: 45000 }, async t => {
    const { f, service, native } = await setup(t, entry), form = native.fill(entry.a).port, defaults = native.defaults();
    const gate = service.queue(request => request.url === entry.url && request.init.method === "POST", "headers");
    const submitted = native.submit();
    try { await gate.seen.promise; native.fill(entry.b); native.fill(entry.a); }
    finally { gate.release.resolve(); if (submitted?.then) await submitted; }
    await f.flush(24);
    assert.equal(native.resets.length, 1); assert.deepEqual(native.raw(form), defaults);
    if (entry.id === "organization") assert.equal(f.store.route.get(), settingsPath("B", "overview"));
    else assert.equal(native.current().port, form);
    assert.equal(f.text().includes(f.i18n.t("workspace.admin.newerFormKept")), false);
    assert.equal(service.writes.length, 1); assert.deepEqual(service.writes[0].body, entry.a); f.assertNoExternal();
  });

for (const variant of ["whitespace-only", "cleared-required"]) test("Workspace organization preserves raw " + variant + " B without automatic departure",
  { concurrency: false, timeout: 45000 }, async t => {
    const entry = cases[0], { f, service, native } = await setup(t, entry);
    const route = f.store.route.get(), form = native.fill(entry.a).port;
    const raw = { name: variant === "whitespace-only" ? "  " + entry.a.name + "  " : "" };
    const gate = service.queue(request => request.url === entry.url && request.init.method === "POST", "headers");
    const submitted = native.submit();
    try { await gate.seen.promise; native.fill(raw); }
    finally { gate.release.resolve(); if (submitted?.then) await submitted; }
    await f.flush(24);
    assert.equal(native.resets.length, 0); assert.equal(native.current().port, form);
    assert.deepEqual(native.raw(form), raw); assert.equal(f.store.route.get(), route);
    assertRetainedNotice(f, entry); assert.equal(service.writes.length, 1);
    assert.deepEqual(service.writes[0].body, entry.a); f.assertNoExternal();
  });

for (const boundary of ["route", "route-ABA", "authorization", "disconnect"]) test("Workspace old form cleanup cannot adopt a newer owner after " + boundary,
  { concurrency: false, timeout: 45000 }, async t => {
    const entry = cases[1], { f, service, native } = await setup(t, entry), original = native.fill(entry.a).port;
    const gate = service.queue(request => request.url === entry.url && request.init.method === "POST", "headers");
    native.submit(); await gate.seen.promise; native.fill(entry.b);
    if (boundary.startsWith("route")) {
      f.navigate("B", "members"); await f.flush();
      if (boundary === "route-ABA") { f.navigate("A", "members"); await f.flush(); }
    } else if (boundary === "authorization") { await f.refreshAuthority(); await f.flush(); }
    else { f.disconnect(); f.reconnect(); await f.flush(); }
    const current = native.fill(entry.b).port;
    assert.notEqual(current, original); assert.equal(original.isConnected, false);
    gate.release.resolve(); await f.flush(24);
    assert.equal(native.resets.length, 0); assert.equal(native.current().port, current);
    assert.deepEqual(native.raw(current), entry.b);
    assert.equal(f.text().includes(originalNotice(f, entry)), false, "Retired ACK cannot announce success in the new owner");
    assert.equal(f.text().includes(f.i18n.t("workspace.admin.newerFormKept")), false);
    assert.equal(service.writes.length, 1); assert.deepEqual(service.writes[0].body, entry.a); f.assertNoExternal();
  });

for (const entry of cases.slice(0, 2)) test("Workspace " + entry.id + " known ACK plus failed session refresh retains B and honest visible completion",
  { concurrency: false, timeout: 45000 }, async t => {
    const { f, service, native } = await setup(t, entry), form = native.fill(entry.a).port, route = f.store.route.get();
    const gate = service.queue(request => request.url === "/api/session" && (request.init.method ?? "GET") === "GET",
      "headers", { status: 503, body: { error: "temporary_session_read" } });
    const submitted = native.submit();
    try { await gate.seen.promise; assert.equal(service.writes.length, 1); native.fill(entry.b); }
    finally { gate.release.resolve(); if (submitted?.then) await submitted; }
    await f.flush(24);
    assert.equal(native.resets.length, 0); assert.equal(native.current().port, form);
    assert.deepEqual(native.raw(form), entry.b); assert.equal(f.store.route.get(), route);
    assertRetainedNotice(f, entry);
    assert.ok(f.tree().visible("p").some(node => node.attributes.role === "alert"
      && node.text.includes(f.i18n.t("workspace.admin.unavailable"))));
    assert.equal(service.writes.length, 1); assert.deepEqual(service.writes[0].body, entry.a); f.assertNoExternal();
  });

for (const entry of cases) test("Workspace " + entry.id + " saved original and retained B relocalize FR-to-JA without another request",
  { concurrency: false, timeout: 45000 }, async t => {
    draftLocaleCheckpoint("before-setup", () => ({ entry: entry.id }));
    const { f, service, native } = await setup(t, entry, { locale: "fr" }), language = liveLocale(f);
    draftLocaleCheckpoint("after-setup", () => ({ entry: entry.id, locale: f.locale }));
    const host = f.host, form = native.fill(entry.a).port, route = f.store.route.get(), authority = f.store.captureAuthorizationScope();
    const observe = () => {
      const retained = native.all.at(-1), current = retained?.form;
      return { entry: entry.id, locale: f.locale, sameHost: f.host === host, sameForm: current === form,
        originalConnected: form.isConnected, currentConnected: current?.isConnected ?? false,
        nativeFormsCreated: native.all.length, nativeResets: native.resets.length,
        rawMatchesB: current ? JSON.stringify(native.raw(current)) === JSON.stringify(entry.b) : false,
        pathHash: retained ? digest(JSON.stringify(retained.path.map(value => Array.isArray(value) ? { template: digest(value.join("\u0000")) } : value))) : null,
        routeUnchanged: f.store.route.get() === route, authorityCurrent: f.store.authorizationScopeActive(authority),
        requests: service.requests.length, writes: service.writes.length, pending: service.pending };
    };
    draftLocaleCheckpoint("before-submit", observe);
    const gate = service.queue(request => request.url === entry.url && request.init.method === "POST", "headers");
    const submitted = native.submit();
    try { await gate.seen.promise; draftLocaleCheckpoint("original-headers-held", observe); native.fill(entry.b); draftLocaleCheckpoint("newer-B-entered", observe); }
    finally { gate.release.resolve(); if (submitted?.then) await submitted; }
    draftLocaleCheckpoint("original-completed", observe);
    await f.flush(24); draftLocaleCheckpoint("after-completion-flush", observe); assertRetainedNotice(f, entry);
    const french = originalNotice(f, entry), frenchSuffix = f.i18n.t("workspace.admin.newerFormKept"), requests = service.requests.length;
    draftLocaleCheckpoint("before-locale-change", observe);
    language.change("ja"); draftLocaleCheckpoint("after-locale-change", observe); await f.flush(2);
    draftLocaleCheckpoint("before-original-identity-assertion", observe);
    assert.equal(f.host === host, true, "The exact original Settings host survives the locale change");
    assert.equal(native.current().port === form, true, "The exact original native form survives the locale change");
    assert.equal(f.store.route.get(), route);
    draftLocaleCheckpoint("after-original-identity-assertion", observe);
    assert.deepEqual(native.raw(form), entry.b); assert.equal(native.resets.length, 0);
    assert.notEqual(originalNotice(f, entry), french); assertRetainedNotice(f, entry);
    assert.equal(visibleNotice(f).includes(french), false); assert.equal(visibleNotice(f).includes(frenchSuffix), false);
    assert.equal(service.requests.length, requests); assert.equal(service.writes.length, 1);
    assert.deepEqual(service.writes[0].body, entry.a); assert.equal(f.store.authorizationScopeActive(authority), true); f.assertNoExternal();
    draftLocaleCheckpoint("complete", observe);
  });

for (const entry of [cases[1], cases[4]]) test("Workspace " + entry.id + " unchanged saved feedback relocalizes FR-to-JA on the same form",
  { concurrency: false, timeout: 45000 }, async t => {
    const { f, service, native } = await setup(t, entry, { locale: "fr" }), language = liveLocale(f);
    const form = native.fill(entry.a).port, defaults = native.defaults(); native.submit(); await f.flush(24);
    assert.equal(native.resets.length, 1); assert.deepEqual(native.raw(form), defaults);
    const french = originalNotice(f, entry), requests = service.requests.length; assert.ok(visibleNotice(f).includes(french));
    language.change("ja"); await f.flush(2);
    assert.equal(native.current().port, form); assert.deepEqual(native.raw(form), defaults);
    assert.notEqual(originalNotice(f, entry), french); assert.ok(visibleNotice(f).includes(originalNotice(f, entry)));
    assert.equal(visibleNotice(f).includes(french), false); assert.equal(visibleNotice(f).includes(f.i18n.t("workspace.admin.newerFormKept")), false);
    assert.equal(service.requests.length, requests); assert.equal(service.writes.length, 1); f.assertNoExternal();
  });

for (const action of ["permission", "token"]) test("Workspace existing " + action + " notice retains message identity through FR-to-JA",
  { concurrency: false, timeout: 45000 }, async t => {
    const f = await settingsFixture(t, { locale: "fr", section: action === "permission" ? "projects" : "members" });
    const language = liveLocale(f), host = f.host;
    if (action === "permission") {
      f.click(f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess"))); await f.flush();
      f.beginToggle("canvasAccess");
    } else f.issue();
    await f.flush(24);
    const message = () => action === "permission" ? f.i18n.t("workspace.admin.canvasAccessUpdated")
      : f.i18n.system("A scoped provisioning token was created and is displayed only during this authorized session.");
    const french = message(), requests = f.service.requests.length; assert.ok(visibleNotice(f).includes(french));
    const original = structuredClone(f.service.writes[0]); assert.equal(f.service.writes.length, 1);
    language.change("ja"); await f.flush(2);
    assert.equal(f.host, host); assert.notEqual(message(), french); assert.ok(visibleNotice(f).includes(message()));
    assert.equal(visibleNotice(f).includes(french), false); assert.equal(f.service.requests.length, requests);
    assert.deepEqual(f.service.writes, [original]); if (action === "token") assert.equal(f.token("fixture-token-A-1"), true);
    f.assertNoExternal();
  });
