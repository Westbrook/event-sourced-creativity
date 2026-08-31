import assert from "node:assert/strict";
import test from "node:test";
import { createSceneStoreHost, sceneDeferred, untilScene } from "./helpers/scene-cost-store-host.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";
import { confirmationFixture } from "./helpers/themed-confirmation-native.mjs";

// Actual complete WorkspaceSettings, child controls, focus helper, LocaleController
// and Store. Only native rendering/events/history/FormData and the finite HTTP
// service below are ports. No Worker/database/provider authorization is claimed.
const { FormaWorkspaceSettings } = await ports.loadActual("src/components/forma-workspace-settings.ts");
const { FormaUiSwitch } = await ports.loadActual("src/components/design-system/forms.ts");
const { FormaUiCopyButton } = await ports.loadActual("src/components/design-system/feedback.ts");
const { FormaUiAudienceNavigation } = await ports.loadActual("src/components/design-system/navigation.ts");
const { FormaUiCluster } = await ports.loadActual("src/components/design-system/layout.ts");
const { localizeTemplateResult } = await ports.loadActual("src/components/design-system/localized-template.ts");
const NOW = "2026-08-30T12:00:00.000Z";
const PRINCIPAL = "settings-principal", PROJECT = "settings-personal-project", DOCUMENT = "settings-document";
const ORG = { A: "settings-org-A", B: "settings-org-B" };
const access = key => "settings-access-" + key;
const member = key => "settings-project-member-" + key;
const path = (key, section = "overview") => "/settings/workspaces/" + ORG[key] + "/" + section;
const endpoint = (key, suffix = "") => "/api/workspaces/" + ORG[key] + suffix;
const tokenPath = key => endpoint(key, "/security/provisioning-credentials");
const membersPath = key => endpoint(key, "/projects/" + access(key) + "/members");
const memberPath = key => membersPath(key) + "/" + member(key);
const method = request => (request.init.method ?? "GET").toUpperCase();
const pause = () => new Promise(setImmediate);
const permissions = [
  "workspace.member.read", "workspace.member.manage", "workspace.project.read", "workspace.project.manage",
  "workspace.usage.read", "workspace.budget.manage", "workspace.audit.read", "workspace.policy.manage",
];
const READ = ["workspace.member.read", "workspace.project.read", "workspace.audit.read"];
const events = [
  { eventId: "settings-project-created", type: "ProjectCreated", payload: { project_id: PROJECT, name: "Settings fixture" } },
  { eventId: "settings-document-created", type: "DocumentCreated", payload: { project_id: PROJECT, document_id: DOCUMENT, title: "Settings fixture document" } },
  { eventId: "settings-document-opened", type: "DocumentOpened", payload: { project_id: PROJECT, document_id: DOCUMENT } },
].map((event, index) => ({ ...event, streamId: "creative:" + PRINCIPAL, sequence: index + 1,
  actor: "user:" + PRINCIPAL, correlationId: "settings-fixture", occurredAt: NOW, recordedAt: NOW }));
const fiscal = Object.freeze({
  budgets: { period: "2026-08", user: { used: 12, reserved: 34, limit: 100000 }, workspace: { used: 12, reserved: 34, limit: 100000 } },
  costBudgets: { period: "2026-08", currency: "USD",
    user: { usedMicrousd: 2400, reservedMicrousd: 19644000, limitMicrousd: 60000000, remainingMicrousd: 40353600 },
    workspace: { usedMicrousd: 2400, reservedMicrousd: 19644000, limitMicrousd: 60000000, remainingMicrousd: 40353600 } },
});
function serviceSession() {
  return {
    user: { userId: PRINCIPAL, email: "settings@example.invalid", displayName: "Settings principal",
      role: "creator", consentVersion: "pilot-2026-08-10", consentedAt: NOW },
    impersonation: null, audience: "creative", permissionEpoch: "settings-epoch-1",
    capabilities: ["project.read", "project.author", ...permissions],
    organizations: Object.entries(ORG).map(([key, organizationId]) => ({ organizationId, name: "Workspace " + key, role: "owner" })),
    projects: [],
    policy: { version: "pilot-2026-08-10", accepted: true, passiveCapture: false,
      externalAssetsRequireAssertion: true, retentionDays: 30, evidenceRetentionDays: 365, sharing: "private-expiring-revocable" },
    canvas: { version: "settings-fixture", mode: "internal", pilotAvailable: false, access: false,
      accessReason: "role-not-eligible", blockedBy: [], requirements: [] },
    provider: { name: "No provider in this fixture", model: "fixture", configured: false, plannerConfigured: false,
      videoConfigured: false, audioConfigured: false },
    ...structuredClone(fiscal),
  };
}
function finiteSettingsService() {
  const state = {
    session: serviceSession(), roles: { A: "owner", B: "owner" }, denied: new Set(),
    credentials: { A: [], B: [] }, tokenCount: { A: 0, B: 0 }, requests: [], gates: [], writes: [],
    projectMembers: Object.fromEntries(["A", "B"].map(key => [key, [{
      membership_id: member(key), user_id: PRINCIPAL, display_name: "PRIVATE_" + key + "_PROJECT_MEMBER",
      role: "editor", status: "active", canvas_access: 0, review_access: 0, created_at: NOW,
    }]])),
    beforeSession: null, memberReadDenied: false, epoch: 1, pending: 0, stray: [],
  };
  const organization = key => ({ organizationId: ORG[key], name: "Workspace " + key, role: state.roles[key] });
  const ownPermissions = key => state.roles[key] === "owner" ? permissions : state.roles[key] === "administrator" ? READ : [];
  const base = key => ({
    organization: organization(key), permissions: ownPermissions(key),
    members: [
      { membership_id: "settings-owner-" + key, user_id: PRINCIPAL, display_name: "PRIVATE_" + key + "_MEMBER",
        email: "private-" + key + "@example.invalid", role: state.roles[key], status: "active", accepted_at: NOW },
      { membership_id: "settings-admin-" + key, user_id: "successor-" + key, display_name: "PRIVATE_" + key + "_ADMIN",
        email: "successor-" + key + "@example.invalid", role: "administrator", status: "active", accepted_at: NOW },
    ],
    projects: [{ project_access_id: access(key), project_id: "settings-shared-" + key,
      project_name: "PRIVATE_" + key + "_PROJECT", owner_user_id: "other-project-owner-" + key, status: "active", created_at: NOW }],
    invitations: [], projectCollaboration: "project-scoped",
  });
  state.bump = patch => {
    state.epoch++;
    state.session = { ...state.session, permissionEpoch: "settings-epoch-" + state.epoch,
      organizations: ["A", "B"].filter(key => state.roles[key] !== "none").map(key => ({
        organizationId: ORG[key], name: "Workspace " + key, role: state.roles[key],
      })), ...patch };
  };
  state.queue = (match, phase = "headers", spec = null) => {
    const gate = { match, phase, spec, seen: sceneDeferred(), bodyStarted: sceneDeferred(), release: sceneDeferred(),
      used: false, jsonCalls: 0, request: null };
    state.gates.push(gate); return gate;
  };
  state.reply = request => {
    const url = new URL(request.url, "http://localhost"), name = url.pathname, verb = method(request);
    if (name === "/api/session" && verb === "GET") {
      state.beforeSession?.(); state.beforeSession = null; state.memberReadDenied = false;
      return { status: 200, body: structuredClone(state.session) };
    }
    if (name === "/api/events" && verb === "GET") return { status: 200, body: { events: structuredClone(events), head: events.length, content: {} } };
    if (name === "/api/workspaces/reviews" && verb === "GET") return { status: 200, body: { tasks: [] } };
    if (name === "/api/project-notifications" && verb === "GET") return { status: 200, body: { notifications: [] } };
    if (name === "/api/workspaces" && verb === "GET") return { status: 200, body: {
      organizations: ["A", "B"].filter(key => state.roles[key] !== "none").map(key => ({ ...organization(key), permissions: ownPermissions(key) })),
      projects: [], invitations: [], projectCollaboration: "project-scoped",
    } };
    const key = ["A", "B"].find(value => name === endpoint(value) || name.startsWith(endpoint(value) + "/"));
    if (!key) { state.stray.push(request); assert.fail("Unlisted finite settings URL: " + verb + " " + name); }
    const suffix = name.slice(endpoint(key).length);
    if (verb === "GET" && (state.denied.has(key) || state.roles[key] === "none")) return { status: 403, body: { error: "access_denied" } };
    if (verb === "GET") {
      if (!suffix) return { status: 200, body: base(key) };
      if (suffix === "/members") { const value = base(key); return { status: 200, body: { organization: value.organization, members: value.members, invitations: value.invitations } }; }
      if (suffix === "/projects") return { status: 200, body: { organization: organization(key), projects: base(key).projects } };
      if (suffix === "/audit") return { status: 200, body: { organization: organization(key), audit: [{ audit_id: "audit-" + key,
        action: "OrganizationCreated", actor_display_name: "PRIVATE_" + key + "_AUDIT", occurred_at: NOW }] } };
      if (suffix === "/pilot") return { status: 200, body: { organization: organization(key), cohort: null, participants: [], organizationBudget: null, participantBudget: null, maintenance: null } };
      if (suffix === "/retention") return { status: 200, body: { organization: organization(key), policy: {
        transient_days: 30, evidence_days: 365, revision_days: 90, legal_hold: 0, version: 1, updated_at: NOW,
      }, appliesTo: "new-scoped-content-only" } };
      if (suffix === "/context-packages") return { status: 200, body: { packages: [{
        id: "package-" + key, name: "PRIVATE_" + key + "_PACKAGE", description: "Fixture-only package", version: 1,
        versionId: "version-" + key, versionStatus: "published", blockCount: 1, bindingCount: 1, publishedAt: NOW,
      }] } };
      if (suffix === "/assurance") return { status: 200, body: {
        organizationId: ORG[key],
        retention: { pendingCount: 0, heldCount: 0, oldestExpiredAt: null },
        scheduler: { state: "not-configured", hostingScheduleVerified: false, lastScheduledAt: null },
        packages: { activeCount: 1, sourceFileCustody: "PRIVATE_" + key + "_CUSTODY" }, reviews: { pendingCount: 0 },
        controls: [{ id: "fixture", status: "unverified", summary: "PRIVATE_" + key + "_ASSURANCE" }],
        enterpriseReady: false, enterpriseBlockers: ["Physical migration evidence remains open"],
      } };
      if (suffix === "/security") return { status: 200, body: {
        policy: { authenticationSource: "any", allowedEmailDomains: ["private-" + key.toLowerCase() + ".example.invalid"],
          encryptionMode: "platform-unverified", maxSessionMinutes: 60, version: 1 },
        observedSignInSource: "local-development", domainOwnershipVerified: false, mfaAttestationAvailable: false,
        encryption: { recoverySnapshots: "not-configured", primaryDatabaseAndObjectStorage: "PRIVATE_" + key + "_STORAGE", externalCustomerManagedKeys: false },
      } };
      if (suffix === "/holds") return { status: 200, body: { holds: [] } };
      if (suffix === "/recovery") return { status: 200, body: { snapshots: [] } };
      if (suffix === "/security/provisioning-credentials") return { status: 200, body: { credentials: structuredClone(state.credentials[key]) } };
      if (suffix === "/deletion") return { status: 200, body: { inventory: {
        projectCount: 1, mediaCount: 0, packageCount: 1, revisionCount: 0, privateEventBodyCount: 0,
      }, job: null, immutableOperationalMetadataRetained: true, externalBackupsPurged: false, otherDevicesPurged: false } };
      if (suffix === "/projects/" + access(key) + "/members") return state.memberReadDenied
        ? { status: 403, body: { error: "access_denied" } }
        : { status: 200, body: { members: structuredClone(state.projectMembers[key]) } };
      if (suffix === "/projects/" + access(key) + "/automation") return { status: 200, body: { policy: {
        enabled: false, notifyContextChanges: false, notifyOutputReady: false, reviewDueHours: 48, reminderHours: 24, version: 1,
      } } };
    }
    if (verb === "POST" && suffix === "/security/provisioning-credentials") {
      const id = "fixture-credential-" + key + "-" + ++state.tokenCount[key];
      const result = { credentialId: id, token: "fixture-token-" + key + "-" + state.tokenCount[key], createdAt: NOW,
        warning: "The provisioning token is shown once and only its SHA-256 digest is stored.", interoperability: "local-scoped-endpoint-only" };
      state.credentials[key].push({ id, status: "active", createdByUserId: PRINCIPAL, createdAt: NOW, revokedAt: null });
      state.writes.push({ method: verb, url: name, body: request.body, receipt: structuredClone(result) });
      return { status: 201, body: result };
    }
    if (name === memberPath(key) && ["PATCH", "DELETE"].includes(verb)) {
      const record = state.projectMembers[key].find(value => value.membership_id === member(key)); assert.ok(record);
      if (verb === "DELETE") {
        record.status = "revoked"; state.memberReadDenied = true;
        state.bump({ projectContext: undefined });
      } else {
        assert.equal(Object.keys(request.body).length, 1);
        assert.ok(Object.hasOwn(request.body, "canvasAccess") || Object.hasOwn(request.body, "reviewAccess"));
        assert.equal(typeof Object.values(request.body)[0], "boolean");
        record[Object.hasOwn(request.body, "canvasAccess") ? "canvas_access" : "review_access"] = Number(Object.values(request.body)[0]);
      }
      state.writes.push({ method: verb, url: name, body: request.body, receipt: { ok: true } });
      return { status: 200, body: { ok: true } };
    }
    if (verb === "POST" && suffix === "/ownership") {
      assert.deepEqual(request.body, { targetUserId: "successor-" + key, confirmation: "TRANSFER_ORGANIZATION_OWNERSHIP" });
      state.roles[key] = "administrator"; state.bump({ projectContext: undefined });
      const receipt = { transferId: "fixture-transfer-" + key, organizationId: ORG[key], ownerUserId: "successor-" + key,
        scope: "organization-administration-only", projectCustodyTransferred: false };
      state.writes.push({ method: verb, url: name, body: request.body, receipt });
      return { status: 200, body: receipt };
    }
    state.stray.push(request); assert.fail("Unlisted finite settings route: " + verb + " " + name);
  };
  state.request = async (input, init = {}) => {
    const url = String(input); assert.ok(url.startsWith("/api/"), "No external URL or provider transport");
    const request = { url, init, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    state.requests.push(request); state.pending++;
    try {
      const gate = state.gates.find(value => !value.used && value.match(request));
      if (gate) { gate.used = true; gate.request = request; }
      // Capture the finite service receipt at dispatch; a late body cannot silently become B.
      const spec = gate?.spec ?? state.reply(request), response = spec.raw === undefined
        ? Response.json(structuredClone(spec.body), { status: spec.status })
        : new Response(spec.raw, { status: spec.status, headers: { "content-type": "application/json" } });
      if (!gate) return response;
      gate.seen.resolve(request);
      const read = response.json.bind(response);
      Object.defineProperty(response, "json", { value: async () => {
        gate.jsonCalls++; gate.bodyStarted.resolve();
        if (gate.phase === "body") await gate.release.promise;
        return read();
      } });
      if (gate.phase === "headers") await gate.release.promise;
      return response;
    } finally { state.pending--; }
  };
  return state;
}

async function settingsFixture(t, { locale = "en", section = "overview" } = {}) {
  // Reuse the actual shared helper ports, with one cleanup owner for this
  // combined fixture. Restore them after the existing Store has closed.
  const nativeCleanups = [];
  const f = await confirmationFixture({ after(cleanup) { nativeCleanups.push(cleanup); } }, { locale });
  const service = finiteSettingsService();
  const worker = { documentId: DOCUMENT, projectId: PROJECT, requestId: "no-generation", streamId: "creative:" + PRINCIPAL,
    owner: PRINCIPAL, events: structuredClone(events), contentRef: "unused", content: "", payload: { workflowSources: [] },
    request: service.request, close() {} };
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  Object.assign(f, { store: h.store, storeHost: h, service, locale, trace: [], clipboard: [], listeners: new Map(), changed: new Map(),
    steps: 0, requested: false, resizeTargets: new Map(), frames: new Map(), timers: new Map(), timerSequence: 0, storage: new Map(),
    focusCalls: [], outsideDialog: null, forms: new WeakMap() });
  ports.bindFixture(f);
  // confirmationFixture already connected the same actual LocaleController
  // with these locale/catalog values; do not create a second subscription.
  f.renderer = new ports.RendererPort(f, {
    "forma-ui-switch": FormaUiSwitch, "forma-ui-copy-button": FormaUiCopyButton,
    "forma-ui-audience-navigation": FormaUiAudienceNavigation,
    "forma-ui-cluster": FormaUiCluster,
  });
  // This is the actual presentational update transform, as in artifact-review-host.
  const renderValue = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return renderValue.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  // Native EventTarget supplies these fields; the finite ElementPort must do so too.
  const nativeDispatch = ports.ElementPort.prototype.dispatchEvent;
  t.mock.method(ports.ElementPort.prototype, "dispatchEvent", function(event) {
    if (this.eventBindings?.[event.type]) Object.defineProperties(event, {
      target: { configurable: true, value: this }, currentTarget: { configurable: true, value: this },
    });
    return nativeDispatch.call(this, event);
  });
  const previousHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(h.location, "href", { configurable: true, get() { return this.origin + this.pathname + this.search + this.hash; } });
  Object.defineProperty(globalThis, "history", { configurable: true, value: {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  } });
  const previousConfirm = ports.windowPort.confirm;
  ports.windowPort.confirm = () => assert.fail("Owned Workspace actions must use the actual native confirmation helper");
  const originalQuery = ports.documentPort.querySelector;
  ports.documentPort.querySelector = selector => selector === "dialog[open]" && f.outsideDialog
    ? f.outsideDialog : originalQuery(selector);
  const dispatch = event => {
    ports.bindFixture(f);
    for (const handler of [...(f.listeners.get(event.type) ?? [])]) handler(event);
  };
  // Bridge actual Store native events to the same component-window listener port.
  for (const type of ["forma-route-changed", "forma-authorization-changed"]) h.window.addEventListener(type, dispatch);
  t.mock.method(globalThis, "fetch", (input, init) => h.fetch(input, init));
  t.mock.method(globalThis, "FormData", function FormDataPort(form) {
    assert.ok(form?.tag === "form" && form.isConnected, "Read only the current rendered form's native data port");
    // Native FormData is an ordered snapshot, not a live alias of later raw edits.
    const data = [...(f.forms.get(form) ?? [])];
    return { get: key => data.find(([name]) => name === key)?.[1] ?? null,
      getAll: key => data.filter(([name]) => name === key).map(([, value]) => value),
      entries: () => data[Symbol.iterator](), [Symbol.iterator]: () => data[Symbol.iterator]() };
  });
  const originalCollect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; originalCollect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) {
      node.disabled = Object.hasOwn(node.attributes, "disabled");
      node.select = () => { f.trace.push("select:" + node.value); };
      node.reset = () => { f.forms.delete(node); f.trace.push("form-reset"); };
      node.focus = () => {
        assert.ok(node.isConnected, "Native focus target is connected");
        ports.documentPort.activeElement = node; f.focusCalls.push(node); dispatch({ type: "focusin", target: node });
      };
    }
  };
  f.tick = async () => { await Promise.resolve(); f.draw(); return true; };
  f.host = new FormaWorkspaceSettings(); f.host.tag = "forma-workspace-settings"; f.host.attributes = {};
  f.host.isConnected = true; f.host.children = [];
  f.doc.body.append(f.host);
  f.draw = () => {
    ports.bindFixture(f); if (!f.host.isConnected) return "";
    for (const node of f.renderer.nodes) node.isConnected = false;
    f.requested = false; return f.renderer.draw(f.host);
  };
  f.flush = async (turns = 12) => { for (let i = 0; i < turns; i++) { await pause(); f.draw(); } };
  f.until = async (check, label) => untilScene(() => { f.draw(); return check(); }, label);
  f.tree = () => fullPageTree(f);
  f.nodes = tag => f.tree().visible(tag);
  f.find = (tag, predicate) => { const found = f.nodes(tag).filter(predicate); assert.equal(found.length, 1, "one current " + tag); return found[0]; };
  f.click = node => {
    assert.ok(node?.port?.isConnected && !node.hiddenBy, "Current connected visible control");
    assert.equal(Object.hasOwn(node.attributes, "disabled"), false, "Control is enabled");
    const handler = node.handlers.click; assert.equal(typeof handler, "function");
    return handler.call(node.owner, { target: node.port, currentTarget: node.port, preventDefault() {}, stopPropagation() {}, button: 0 });
  };
  f.submit = (node, values) => {
    assert.ok(node?.port?.isConnected && !node.hiddenBy);
    f.forms.set(node.port, new Map(Object.entries(values)));
    const choices = f.nodes("button").filter(button => {
      if (button.attributes.type !== "submit") return false;
      for (let parent = button.parent; parent; parent = parent.parent) if (parent.port === node.port) return true;
      return false;
    });
    assert.equal(choices.length, 1, "One actual current positive submitter belongs to this exact original form");
    const submitter = choices[0].port; submitter.focus();
    return node.handlers.submit.call(node.owner, { target: node.port, currentTarget: node.port, submitter, preventDefault() {}, stopPropagation() {} });
  };
  f.text = () => f.tree().root.text;
  f.values = () => f.renderer.nodes.filter(node => node.tag === "input").map(node => String(node.value));
  f.privateText = () => f.text() + "\n" + f.values().join("\n");
  f.tokenButton = () => f.find("button", node => node.text === f.i18n.system("Create one-time provisioning token"));
  f.issue = () => f.click(f.tokenButton());
  f.token = value => f.values().includes(value);
  f.switches = () => [...f.renderer.instances.values()].map(value => value.instance).filter(value =>
    value.isConnected && value instanceof FormaUiSwitch && value.parentElement === f.host);
  f.switch = key => {
    const expected = "workspace-project-" + (key === "canvasAccess" ? "canvas" : "review") + "-permission";
    const found = f.switches().filter(value => String(value.attributes.class).split(/\s+/u).includes(expected));
    assert.equal(found.length, 1, "one current permission switch"); return found[0];
  };
  f.beginToggle = key => {
    const control = f.switch(key), input = f.renderer.ownNodes(control, "input")[0];
    assert.ok(input && !input.disabled);
    input.focus(); f.focusCalls.length = 0; input.checked = true;
    input.handlers.change.call(control, { target: input, currentTarget: input });
    return { control, input };
  };
  f.interruptFocus = kind => {
    const other = ports.documentPort.createElement("button"); ports.documentPort.body.append(other);
    if (kind === "dialog") {
      f.outsideDialog = ports.documentPort.createElement("dialog");
      ports.documentPort.body.append(f.outsideDialog); f.outsideDialog.showModal();
    }
    else if (kind === "focus") { ports.documentPort.activeElement = other; dispatch({ type: "focusin", target: other }); }
    else dispatch({ type: kind === "pointer" ? "pointerdown" : "keydown", target: other });
    return other;
  };
  f.navigate = (key, nextSection = "overview") => { f.store.setRoute(path(key, nextSection)); f.draw(); };
  f.refreshAuthority = async (patch = {}) => { service.bump(patch); await f.store.refreshSession(); f.draw(); };
  f.disconnect = () => {
    ports.bindFixture(f); f.host.isConnected = false; f.host.disconnectedCallback();
    for (const { instance } of f.renderer.instances.values()) if (instance.isConnected) { instance.isConnected = false; instance.disconnectedCallback(); }
    for (const node of f.renderer.nodes) node.isConnected = false;
    f.renderer.nodes = []; f.renderer.markup = "";
  };
  f.reconnect = () => { ports.bindFixture(f); f.host.isConnected = true; f.host.connectedCallback(); f.draw(); };
  f.assertNoExternal = () => {
    assert.deepEqual(service.stray, []);
    assert.ok(service.requests.every(request => request.url.startsWith("/api/")));
    assert.equal(service.requests.some(request => /document-jobs|output-requirements|\/(?:render|run|execute|generate)(?:\/|$)/u.test(request.url)), false);
    assert.deepEqual({ budgets: service.session.budgets, costBudgets: service.session.costBudgets }, fiscal);
    const currentSession = f.store.session.get();
    assert.deepEqual({ budgets: currentSession.budgets, costBudgets: currentSession.costBudgets }, fiscal,
      "Actual Store retains the finite original accounting fields");
  };
  h.store.loading.set(false); h.store.setRoute(path("A", section));
  f.host.connectedCallback(); f.draw(); await f.flush();
  assert.match(f.privateText(), section === "projects" ? /PRIVATE_A_PROJECT/u : /PRIVATE_A_MEMBER/u,
    "Healthy finite initial detail reaches the real renderer");
  t.after(async () => {
    try {
      for (const gate of service.gates) gate.release.resolve();
      f.disconnect(); await f.flush();
      ports.documentPort.querySelector = originalQuery; ports.windowPort.confirm = previousConfirm;
      ports.documentPort.activeElement = null;
      if (previousHistory) Object.defineProperty(globalThis, "history", previousHistory); else delete globalThis.history;
      await h.close(); f.assertNoExternal();
    } finally {
      for (const cleanup of [...nativeCleanups].reverse()) await cleanup();
    }
  });
  return f;
}

for (const locale of ["en", "ja"]) test("workspace response ownership healthy private detail and one-time token " + locale, async t => {
  const f = await settingsFixture(t, { locale }); f.issue(); await f.flush();
  assert.ok(f.token("fixture-token-A-1"));
  assert.match(f.privateText(), /PRIVATE_A_PACKAGE/u);
  assert.equal(f.service.writes.length, 1); assert.equal(f.service.writes[0].url, tokenPath("A"));
  f.click(f.find("button", node => node.text === f.i18n.system("Hide token"))); await f.flush();
  assert.equal(f.token("fixture-token-A-1"), false);
  assert.equal(f.service.writes.length, 1);
});

for (const phase of ["headers", "body"]) for (const aba of [false, true]) test(
  "workspace response ownership rejects late token " + phase + (aba ? " A-B-A" : " A-B"), async t => {
    const f = await settingsFixture(t), gate = f.service.queue(request => method(request) === "POST" && request.url === tokenPath("A"), phase);
    f.issue(); await gate.seen.promise; if (phase === "body") await gate.bodyStarted.promise;
    f.navigate("B"); await f.flush(); assert.match(f.privateText(), /PRIVATE_B_MEMBER/u);
    if (aba) { f.navigate("A"); await f.flush(); }
    gate.release.resolve(); await f.flush();
    assert.equal(f.token("fixture-token-A-1"), false, "Retired A response cannot populate the current private token field");
    if (phase === "headers") assert.equal(gate.jsonCalls, 0, "Retired headers never disclose their body to the component");
    const key = aba ? "A" : "B"; f.issue(); await f.flush();
    const fresh = "fixture-token-" + key + "-" + (aba ? 2 : 1);
    assert.ok(f.token(fresh), "A fresh current issuance is still usable after stale-response refusal");
    assert.equal(f.service.writes.length, 2);
  });

for (const boundary of ["authorization", "authorization-ABA", "principal", "disconnect"]) test(
  "workspace response ownership pending body retires on " + boundary, async t => {
    const f = await settingsFixture(t), gate = f.service.queue(request => method(request) === "POST" && request.url === tokenPath("A"), "body");
    f.issue(); await gate.bodyStarted.promise;
    if (boundary === "disconnect") { f.disconnect(); f.reconnect(); }
    else if (boundary === "principal") await f.refreshAuthority({ user: { ...f.service.session.user, userId: "another-settings-principal" } });
    else {
      const original = structuredClone(f.service.session); await f.refreshAuthority();
      if (boundary === "authorization-ABA") { f.service.session = original; await f.store.refreshSession(); f.draw(); }
    }
    await f.flush(); gate.release.resolve(); await f.flush();
    assert.equal(f.token("fixture-token-A-1"), false, "Old private bytes never reappear under a new owner or lifetime");
    assert.equal(f.service.writes.length, 1, "Retirement does not retry issuance");
  });

test("workspace response ownership authorization retires cached private detail before replacement read", async t => {
  const f = await settingsFixture(t); f.issue(); await f.flush(); assert.ok(f.token("fixture-token-A-1"));
  const gate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "headers");
  await f.refreshAuthority(); await f.flush(2);
  assert.doesNotMatch(f.privateText(), /PRIVATE_A_MEMBER|PRIVATE_A_PACKAGE|PRIVATE_A_STORAGE|fixture-token-A-1/u);
  gate.release.resolve(); await f.flush();
  assert.match(f.privateText(), /PRIVATE_A_MEMBER/u, "Healthy current detail is readable again");
  assert.equal(f.token("fixture-token-A-1"), false, "Reading current detail does not recreate the one-time secret");
});

test("workspace response ownership current denied refresh is unavailable rather than endless loading", async t => {
  const f = await settingsFixture(t); f.service.denied.add("A"); f.navigate("A", "members"); await f.flush();
  assert.doesNotMatch(f.privateText(), /PRIVATE_A_MEMBER|PRIVATE_A_PACKAGE|PRIVATE_A_STORAGE/u);
  assert.ok(f.nodes("p").some(node => node.attributes.role === "alert"));
  assert.equal(f.nodes("p").some(node => node.attributes.role === "status" && node.text === f.i18n.t("status.loading", "Loading")), false);
  const retry = f.find("button", node => node.text === f.i18n.t("action.retry", "Try again"));
  f.service.denied.delete("A"); f.click(retry); await f.flush();
  assert.match(f.privateText(), /PRIVATE_A_MEMBER/u); assert.equal(f.service.writes.length, 0);
});

test("workspace response ownership late failed load cannot overwrite healthy B", async t => {
  const f = await settingsFixture(t), gate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"),
    "headers", { status: 503, body: { error: "workspace_unavailable" } });
  f.navigate("A", "members"); await gate.seen.promise; f.navigate("B"); await f.flush();
  gate.release.resolve(); await f.flush();
  assert.match(f.privateText(), /PRIVATE_B_MEMBER/u);
  assert.equal(f.nodes("p").some(node => node.attributes.role === "alert"), false);
});

test("workspace response ownership saved self-removal survives denied follow-up read", async t => {
  const f = await settingsFixture(t, { section: "projects" });
  f.click(f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access"))); await f.flush();
  const revoke = f.find("button", node => node.attributes["aria-label"] === f.i18n.t("workspace.admin.revokeNamed",
    "Revoke access for {name}", { name: "PRIVATE_A_PROJECT_MEMBER" }));
  const sessionsBefore = f.service.requests.filter(request => request.url === "/api/session").length;
  f.click(revoke);
  assert.ok(f.dialog(), "Current self-removal awaits the owned native confirmation");
  assert.equal(f.dialog().querySelector("p").textContent, f.i18n.t("workspace.admin.confirmProjectRevoke",
    "Remove {name} from this project?", { name: "PRIVATE_A_PROJECT_MEMBER" }));
  assert.equal(f.service.writes.length, 0, "Opening confirmation has not revoked access");
  f.confirm(false); await f.flush(); // finite native positive click + exact submit, not window.confirm
  assert.equal(f.service.writes.length, 1);
  assert.deepEqual(f.service.writes[0], { method: "DELETE", url: memberPath("A"), body: null, receipt: { ok: true } });
  assert.equal(f.service.requests.filter(request => request.url === "/api/session").length, sessionsBefore + 1,
    "Acknowledged mutation refreshes the actual Store session exactly once");
  assert.equal(f.store.session.get().permissionEpoch, f.service.session.permissionEpoch);
  assert.ok(f.text().includes(f.i18n.t("workspace.admin.projectRevoked", "Project access was revoked.")));
  assert.doesNotMatch(f.privateText(), /PRIVATE_A_PROJECT_MEMBER/u);
});

test("workspace response ownership saved transfer remains acknowledged after former owner permission changes", async t => {
  const f = await settingsFixture(t);
  const form = f.find("form", node => node.text.includes(f.i18n.system("Transfer administrative ownership")));
  f.submit(form, { targetUserId: "successor-A" });
  assert.ok(f.dialog(), "Current transfer awaits the owned native confirmation");
  assert.equal(f.dialog().querySelector("p").textContent, f.i18n.system(
    "Transfer administrative ownership to this eligible administrator? Your current project session will close.") + "\n"
      + f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}", { name: "\u2068\u2068PRIVATE_A_ADMIN\u2069\u2069" }));
  assert.equal(f.service.writes.length, 0, "Opening confirmation has not transferred ownership");
  f.confirm(false); await f.flush(); // same helper click/submit sequence; no automatic approval
  assert.equal(f.service.writes.length, 1);
  assert.equal(f.service.writes[0].receipt.projectCustodyTransferred, false);
  assert.ok(f.text().includes(f.i18n.system("Organization administrative ownership was transferred.")));
  assert.equal(f.nodes("button").some(node => node.text === f.i18n.system("Create one-time provisioning token")), false);
  assert.doesNotMatch(f.privateText(), /PRIVATE_A_STORAGE/u);
  assert.equal(f.store.session.get().permissionEpoch, f.service.session.permissionEpoch);
});

test("workspace response ownership non-OK issuance never invents saved acknowledgement", async t => {
  const f = await settingsFixture(t), gate = f.service.queue(request => method(request) === "POST" && request.url === tokenPath("A"),
    "headers", { status: 503, body: { error: "workspace_unavailable" } });
  f.issue(); await gate.seen.promise; gate.release.resolve(); await f.flush();
  assert.equal(f.service.writes.length, 0);
  assert.equal(f.values().some(value => value.startsWith("fixture-token-")), false);
  assert.equal(f.text().includes(f.i18n.system("A scoped provisioning token was created and is displayed only during this authorized session.")), false);
});

for (const key of ["canvasAccess", "reviewAccess"]) for (const interruption of ["none", "pointer", "key", "focus", "dialog"]) test(
  "workspace response ownership " + key + " late focus " + interruption, async t => {
    const f = await settingsFixture(t, { section: "projects" });
    f.click(f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access"))); await f.flush();
    const gate = f.service.queue(request => method(request) === "PATCH" && request.url === memberPath("A"), "headers");
    const original = f.beginToggle(key); await gate.seen.promise; f.draw();
    if (interruption !== "none") f.interruptFocus(interruption);
    gate.release.resolve(); await f.flush();
    assert.equal(f.service.writes.length, 1);
    assert.deepEqual(f.service.writes[0].body, { [key]: true });
    const current = f.switch(key), input = f.renderer.ownNodes(current, "input")[0];
    assert.equal(input.checked, true, "Real current switch reflects the finite saved permission");
    if (interruption === "none") {
      assert.equal(current, original.control, "Exact custom-control owner remains mounted");
      assert.ok(f.focusCalls.length > 0, "Healthy owned focus restoration is reachable");
      assert.equal(ports.documentPort.activeElement?.owner, current);
    } else assert.equal(f.focusCalls.length, 0, "Older completion never steals newer focus");
  });

// Same session/route, changed *detail* evidence: use the current supported token
// action's acknowledged follow-up load. An authorization event would clear the
// old detail before #load and miss this branch. The service is finite setup,
// not a live organization mutation, a Worker authorization claim, or a provider.
for (const change of ["unchanged", "role", "permissions"]) test(
  "workspace response ownership same-session detail refresh " + change, async t => {
    const f = await settingsFixture(t), service = f.service;
    for (const marker of ["PRIVATE_A_MEMBER", "PRIVATE_A_PACKAGE", "PRIVATE_A_STORAGE", "PRIVATE_A_ASSURANCE"])
      assert.ok(f.privateText().includes(marker), "Initial current evidence includes " + marker);
    const session = structuredClone(f.store.session.get()), serviceSessionBefore = structuredClone(service.session);
    const authorization = f.store.captureAuthorizationScope(), route = f.store.route.get();
    const originalEvents = structuredClone(f.store.events.get()), requestStart = service.requests.length;

    // Derive the next finite reply from this fixture's own service shapes.
    // Only organization detail changes; do not bump the session permission epoch.
    if (change === "role") service.roles.A = "administrator";
    const detail = structuredClone(service.reply({ url: endpoint("A"), init: {} }));
    service.roles.A = "owner";
    if (change === "role") service.beforeSession = () => { service.roles.A = "administrator"; };
    if (change === "permissions")
      detail.body.permissions = detail.body.permissions.filter(value => value !== "workspace.audit.read");
    const base = service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "headers", detail);
    base.release.resolve();
    const packageReply = structuredClone(service.reply({ url: endpoint("A", "/context-packages"), init: {} }));
    const freshName = "REFRESHED_A_PACKAGE_" + change;
    packageReply.body.packages[0].name = freshName;
    const evidence = service.queue(request => method(request) === "GET"
      && request.url === endpoint("A", "/context-packages"), "body", packageReply);

    try {
      f.issue(); // Actual current, enabled, connected native button; no private method call.
      await f.flush(18);
      assert.deepEqual(service.writes.map(write => [write.method, write.url]), [["POST", tokenPath("A")]],
        "Exactly one acknowledged finite issuance triggers the existing follow-up load");
      assert.equal(service.writes[0].receipt.token, "fixture-token-A-1");
      assert.equal(service.requests.slice(requestStart).filter(request => request.url === "/api/session").length, 1);
      assert.equal(base.used, true, "The same-session refresh reached the current organization detail");
      assert.equal(base.jsonCalls, 1, "The actual detail body was consumed before checking refreshed evidence");
      assert.deepEqual(service.session, serviceSessionBefore, "Service setup did not replace the session");
      assert.deepEqual(f.store.session.get(), session, "The actual Store session/epoch remains unchanged");
      assert.equal(f.store.route.get(), route);
      assert.deepEqual(f.store.captureAuthorizationScope(), authorization);
      assert.equal(f.store.authorizationScopeActive(authorization), true);
      assert.deepEqual(f.store.events.get(), originalEvents);
      t.diagnostic(JSON.stringify({
        change, baseRead: base.jsonCalls, evidenceRequested: evidence.used, evidenceBodyRead: evidence.jsonCalls,
        alerts: f.nodes("p").filter(node => node.attributes.role === "alert").map(node => node.text),
        finiteWrites: service.writes.length, sameRoute: f.store.route.get() === route,
      }));
      if (change === "unchanged") {
        assert.match(f.privateText(), /PRIVATE_A_PACKAGE/u, "Healthy same-detail refresh keeps readable prior evidence");
        assert.match(f.privateText(), /PRIVATE_A_STORAGE/u);
        assert.equal(f.token("fixture-token-A-1"), true);
      } else {
        assert.doesNotMatch(f.privateText(), /PRIVATE_A_PACKAGE|PRIVATE_A_STORAGE|PRIVATE_A_ASSURANCE|fixture-token-A-1/u,
          "Changed detail withdraws prior secondary evidence and the one-time token before new evidence publishes");
      }
      assert.equal(evidence.used && evidence.jsonCalls === 1, true,
        "Current refreshed detail must continue to its evidence read, not fail on the shadowed owner binding");
      assert.equal(f.privateText().includes(freshName), false, "Held evidence has not published early");
      assert.equal(f.nodes("p").some(node => node.attributes.role === "alert"), false);
      evidence.release.resolve(); await f.flush(18);
      assert.ok(f.privateText().includes(freshName), "Fresh current evidence reaches the actual renderer");
      assert.match(f.privateText(), /PRIVATE_A_MEMBER/u, "Still-authorized current member detail remains usable");
      assert.doesNotMatch(f.privateText(), /PRIVATE_A_PACKAGE/u, "Old package evidence is replaced, not concatenated");
      assert.equal(f.nodes("p").some(node => node.attributes.role === "alert"), false);
      assert.equal(f.nodes("p").some(node => node.attributes.role === "status"
        && node.text === f.i18n.t("status.loading", "Loading")), false);
      const hasTokenAction = f.nodes("button").some(node => node.text === f.i18n.system("Create one-time provisioning token"));
      assert.equal(hasTokenAction, change !== "role", "Current role, not the previous detail, controls owner-only reach");
      if (change === "role") assert.doesNotMatch(f.privateText(), /PRIVATE_A_STORAGE/u);
      if (change === "permissions") {
        assert.doesNotMatch(f.privateText(), /PRIVATE_A_ASSURANCE/u);
        assert.equal(service.requests.slice(requestStart).some(request => request.url === endpoint("A", "/assurance")), false,
          "Removed audit permission cannot fetch or retain the old assurance evidence");
      }
      assert.equal(f.token("fixture-token-A-1"), change === "unchanged", "A read never recreates a cleared one-time token");
      assert.deepEqual(f.store.session.get(), session);
      assert.equal(f.store.route.get(), route);
      assert.deepEqual(f.store.captureAuthorizationScope(), authorization);
      assert.deepEqual(f.store.events.get(), originalEvents);
      assert.equal(service.requests.slice(requestStart).filter(request => method(request) !== "GET").length, 1);
      assert.equal(service.writes.length, 1, "Refreshing evidence never repeats the acknowledged issuance");
      f.assertNoExternal();
    } finally {
      evidence.release.resolve(); await f.flush();
    }
  });

// Exact original three-case baseline bodies below; finite service/native delivery,
// not Worker authorization. Additional cases protect both directions of ordering.
const options = { concurrency: false, timeout: 30000 };
const ORIGINAL = "PRIVATE_A_PROJECT_MEMBER", CURRENT = "PRIVATE_CURRENT_PROJECT_MEMBER";
const isMemberRead = request => method(request) === "GET" && request.url === membersPath("A");
const visible = (f, value) => f.privateText().includes(value);
const reads = f => f.service.requests.filter(isMemberRead);
function view(f) {
  const button = f.find("button", node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access"));
  f.click(button); // The existing click port requires a current, connected, enabled control.
}
function snapshot(f) {
  return structuredClone({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
    session: f.store.session.get(), route: f.store.route.get(), members: f.service.projectMembers });
}
function assertUnchanged(f, original, expectedReads) {
  assert.deepEqual(snapshot(f), original, "Read-only delivery does not alter source, principal, scope, financial fields or finite membership records");
  assert.equal(f.service.writes.length, 0);
  assert.equal(f.service.requests.every(request => method(request) === "GET"), true);
  assert.equal(reads(f).length, expectedReads);
  assert.equal(reads(f).every(request => request.init.credentials === "same-origin"), true);
  f.assertNoExternal();
}
async function start(t) {
  const f = await settingsFixture(t, { locale: "en", section: "projects" });
  assert.equal(reads(f).length, 0); view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true, "Original exact project member list is genuinely loaded before the repeated current read");
  assert.equal(reads(f).length, 1); return { f, original: snapshot(f) };
}

test("B3 project members healthy current 200 replaces only the exact loaded list", options, async t => {
  const { f, original } = await start(t);
  const currentRows = structuredClone(f.service.projectMembers.A); currentRows[0].display_name = CURRENT;
  const gate = f.service.queue(isMemberRead, "body", { status: 200, body: { members: currentRows } });
  view(f); await gate.bodyStarted.promise; gate.release.resolve(); await f.flush();
  assert.equal(visible(f, CURRENT), true); assert.equal(visible(f, ORIGINAL), false);
  assertUnchanged(f, original, 2);
  t.diagnostic(JSON.stringify({ case: "healthy-current-200", locale: "en", currentListVisible: true, originalListVisible: false,
    reads: reads(f).length, writes: 0, externalCalls: 0, storeStateUnchanged: true, authorityEvidence: "finite HTTP service, not Worker authorization" }));
});

test("B3 project members known current 403 withdraws private rows before its held body", options, async t => {
  const { f, original } = await start(t);
  const denial = f.service.queue(isMemberRead, "body", { status: 403, body: { error: "access_denied" } });
  view(f); await denial.seen.promise; await f.flush();
  // Do not require a repaired implementation to consume a denied body at all.
  const privateVisibleAfterDeniedHeaders = visible(f, ORIGINAL), deniedJsonCalls = denial.jsonCalls;
  denial.release.resolve(); await f.flush();
  assert.equal(visible(f, ORIGINAL), false, "Completed current denial clears the exact private member rows");
  view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true, "A separate current successful read can make this exact list usable again");
  assertUnchanged(f, original, 3);
  t.diagnostic(JSON.stringify({ case: "current-403-held-body", locale: "en", deliveredStatus: 403,
    deniedJsonCalls, privateVisibleAfterDeniedHeaders, privateWithdrawnAfterBody: true, deliberateFresh200Visible: true,
    reads: reads(f).length, writes: 0, externalCalls: 0, storeStateUnchanged: true, authorityEvidence: "finite HTTP service, not Worker authorization" }));
  assert.equal(privateVisibleAfterDeniedHeaders, false, "Known current denial must withdraw the exact private list without waiting for JSON");
});

test("B3 project members older held 200 cannot resurrect rows after a newer completed 403", options, async t => {
  const { f, original } = await start(t);
  const older = f.service.queue(isMemberRead, "body");
  view(f); await older.bodyStarted.promise;
  const denial = f.service.queue(isMemberRead, "body", { status: 403, body: { error: "access_denied" } });
  view(f); await denial.seen.promise; denial.release.resolve(); await f.flush();
  assert.equal(visible(f, ORIGINAL), false, "The newer completed denial genuinely withdraws the target before the old response is released");
  older.release.resolve(); await f.flush();
  const privateResurrectedByOlder200 = visible(f, ORIGINAL);
  view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true, "An explicit later certified read still works; a stale response is not that new proof");
  assertUnchanged(f, original, 4);
  t.diagnostic(JSON.stringify({ case: "older-200-newer-403", locale: "en", newerDeliveredStatus: 403,
    olderJsonCalls: older.jsonCalls, privateResurrectedByOlder200, deliberateFresh200Visible: true,
    reads: reads(f).length, writes: 0, externalCalls: 0, storeStateUnchanged: true, authorityEvidence: "finite HTTP service, not Worker authorization" }));
  assert.equal(privateResurrectedByOlder200, false, "Older pending success cannot revive the exact member list after a newer denial");
});

for (const status of [401, 404]) test("B3 project members denial " + status + " is acted on before JSON", options, async t => {
  const { f, original } = await start(t);
  const denial = f.service.queue(isMemberRead, "body", { status, raw: "not a private JSON response" });
  view(f); await denial.seen.promise; await f.flush();
  const hidden = !visible(f, ORIGINAL), jsonCalls = denial.jsonCalls;
  denial.release.resolve(); await f.flush(); view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true, "Fresh exact read remains usable after the denial");
  assertUnchanged(f, original, 3);
  assert.equal(hidden, true, "Known denial withdraws only the target list immediately");
  assert.equal(jsonCalls, 0, "Denied private/error bodies are unnecessary for withdrawal");
});

test("B3 project members completed newer 200 survives an older denied response", options, async t => {
  const { f, original } = await start(t);
  const older = f.service.queue(isMemberRead, "headers", { status: 403, body: { error: "access_denied" } });
  view(f); await older.seen.promise;
  const currentRows = structuredClone(f.service.projectMembers.A); currentRows[0].display_name = CURRENT;
  const newer = f.service.queue(isMemberRead, "body", { status: 200, body: { members: currentRows } });
  view(f); await newer.bodyStarted.promise; newer.release.resolve(); await f.flush();
  assert.equal(visible(f, CURRENT), true, "Newer exact read is completed, not merely pending");
  older.release.resolve(); await f.flush();
  assertUnchanged(f, original, 3);
  assert.equal(visible(f, CURRENT), true, "An old denial cannot erase newer certified same-target content");
  assert.equal(visible(f, ORIGINAL), false);
  assert.equal(older.jsonCalls, 0);
});

test("B3 project members completed newer 200 survives an older body failure", options, async t => {
  const { f, original } = await start(t);
  const older = f.service.queue(isMemberRead, "body", { status: 500, raw: "invalid old JSON" });
  view(f); await older.bodyStarted.promise;
  const currentRows = structuredClone(f.service.projectMembers.A); currentRows[0].display_name = CURRENT;
  const newer = f.service.queue(isMemberRead, "body", { status: 200, body: { members: currentRows } });
  view(f); await newer.bodyStarted.promise; newer.release.resolve(); await f.flush();
  assert.equal(visible(f, CURRENT), true);
  older.release.resolve(); await f.flush();
  assertUnchanged(f, original, 3);
  assert.equal(visible(f, CURRENT), true, "Retired parse failure cannot clear the newer list");
  assert.equal(visible(f, ORIGINAL), false);
});

test("B3 project members pending newer 200 is not proof against a delivered denial", options, async t => {
  const { f, original } = await start(t);
  const denial = f.service.queue(isMemberRead, "headers", { status: 403, body: { error: "access_denied" } });
  view(f); await denial.seen.promise;
  const currentRows = structuredClone(f.service.projectMembers.A); currentRows[0].display_name = CURRENT;
  const newer = f.service.queue(isMemberRead, "body", { status: 200, body: { members: currentRows } });
  view(f); await newer.bodyStarted.promise;
  denial.release.resolve(); await f.flush();
  const hiddenOnDenial = !visible(f, ORIGINAL) && !visible(f, CURRENT);
  newer.release.resolve(); await f.flush();
  const hiddenAfterEarlierPendingBody = !visible(f, ORIGINAL) && !visible(f, CURRENT);
  view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true, "An explicit read started after withdrawal can recertify the exact list");
  assertUnchanged(f, original, 4);
  assert.equal(hiddenOnDenial, true);
  assert.equal(hiddenAfterEarlierPendingBody, true, "A body from an already-issued read cannot reverse that withdrawal");
  assert.equal(denial.jsonCalls, 0);
});

test("B3 project members overlapping reads of two loaded projects are independent", options, async t => {
  const f = await settingsFixture(t, { locale: "en", section: "overview" });
  const secondId = "settings-access-second", secondName = "PRIVATE_SECOND_PROJECT";
  const base = structuredClone(f.service.reply({ url: endpoint("A"), init: {} }));
  base.body.projects.push({ ...base.body.projects[0], project_access_id: secondId,
    project_id: "settings-shared-second", project_name: secondName });
  const detail = structuredClone(f.service.reply({ url: endpoint("A", "/projects"), init: {} }));
  detail.body.projects = structuredClone(base.body.projects);
  const baseGate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "headers", base);
  const detailGate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A", "/projects"), "headers", detail);
  baseGate.release.resolve(); detailGate.release.resolve();
  f.navigate("A", "projects"); await f.flush();
  assert.equal(baseGate.used && detailGate.used, true, "Two targets are supplied by actual loaded finite project responses");
  assert.equal(f.nodes("button").filter(node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access")).length, 2);
  const original = snapshot(f), secondUrl = endpoint("A", "/projects/" + secondId + "/members");
  const secondRows = [{ ...structuredClone(f.service.projectMembers.A[0]), membership_id: "settings-second-member",
    user_id: "settings-second-person", display_name: "PRIVATE_SECOND_PROJECT_MEMBER" }];
  const first = f.service.queue(isMemberRead, "body");
  const second = f.service.queue(request => method(request) === "GET" && request.url === secondUrl,
    "body", { status: 200, body: { members: secondRows } });
  const open = name => f.click(f.find("button", node => node.attributes["aria-label"] ===
    f.i18n.t("workspace.admin.viewAccessNamed", "View access to {name}", { name })));
  open("PRIVATE_A_PROJECT"); await first.bodyStarted.promise;
  open(secondName); await second.bodyStarted.promise;
  second.release.resolve(); await f.flush();
  assert.equal(visible(f, "PRIVATE_SECOND_PROJECT_MEMBER"), true);
  first.release.resolve(); await f.flush();
  assertUnchanged(f, original, 1);
  assert.equal(f.service.requests.filter(request => request.url === secondUrl).length, 1);
  assert.equal(visible(f, ORIGINAL), true, "Another resource's newer read cannot retire this still-current exact response");
  assert.equal(visible(f, "PRIVATE_SECOND_PROJECT_MEMBER"), true);
});

function memberReadAlerts(f, projectName) {
  const tree = f.tree(), headings = tree.visible("b").filter(node => node.text === projectName);
  assert.equal(headings.length, 1);
  let row = headings[0].parent;
  while (row && row.tag !== "li") row = row.parent;
  assert.ok(row, "Current project list item owns its read status");
  return tree.visible("p").filter(node => {
    if (node.attributes.role !== "alert") return false;
    for (let parent = node.parent; parent; parent = parent.parent) if (parent === row) return true;
    return false;
  });
}

test("B3 project members fresh successful read clears its visible prior failure", options, async t => {
  const { f, original } = await start(t);
  const denied = f.service.queue(isMemberRead, "body", { status: 403, body: { error: "access_denied" } });
  view(f); await denied.seen.promise; await f.flush();
  assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 1);
  denied.release.resolve(); await f.flush(); view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true);
  assertUnchanged(f, original, 3);
  assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 0,
    "A successful current list is not presented beside its obsolete failure notice");
});

test("B3 project members successful read cannot clear a separate current mutation refusal", options, async t => {
  const { f, original } = await start(t);
  const denied = f.service.queue(isMemberRead, "headers", { status: 403, body: { error: "access_denied" } });
  denied.release.resolve(); view(f); await f.flush();
  const refused = f.service.queue(request => method(request) === "POST" && request.url === membersPath("A"),
    "headers", { status: 400, body: { error: "member_required" } });
  refused.release.resolve();
  const form = f.find("form", node => node.text.includes(f.i18n.t("workspace.admin.grant", "Grant access")));
  f.submit(form, { userId: "successor-A", role: "viewer" }); await refused.seen.promise; await f.flush();
  assert.equal(f.service.requests.filter(request => method(request) === "POST").length, 1,
    "The current form's real handler reached the finite refusal; no successful mutation is fabricated");
  assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 1);
  assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 2,
    "Equal translated text still belongs to two separate outcomes");
  view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true);
  assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 0);
  assert.equal(f.nodes("p").filter(node => node.attributes.role === "alert").length, 1,
    "The unrelated mutation refusal remains visible after member-read recovery");
  assert.deepEqual(snapshot(f), original); assert.equal(f.service.writes.length, 0);
  assert.equal(reads(f).length, 3); f.assertNoExternal();
});

test("B3 project members recovering one loaded project preserves another project's error", options, async t => {
  const f = await settingsFixture(t, { locale: "en", section: "overview" });
  const secondId = "settings-access-second", secondName = "PRIVATE_SECOND_PROJECT";
  const base = structuredClone(f.service.reply({ url: endpoint("A"), init: {} }));
  base.body.projects.push({ ...base.body.projects[0], project_access_id: secondId,
    project_id: "settings-shared-second", project_name: secondName });
  const detail = structuredClone(f.service.reply({ url: endpoint("A", "/projects"), init: {} }));
  detail.body.projects = structuredClone(base.body.projects);
  const baseGate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "headers", base);
  const detailGate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A", "/projects"), "headers", detail);
  baseGate.release.resolve(); detailGate.release.resolve(); f.navigate("A", "projects"); await f.flush();
  assert.equal(baseGate.used && detailGate.used, true);
  const original = snapshot(f), secondUrl = endpoint("A", "/projects/" + secondId + "/members");
  const first = f.service.queue(isMemberRead, "headers", { status: 403, body: { error: "access_denied" } });
  const second = f.service.queue(request => method(request) === "GET" && request.url === secondUrl,
    "headers", { status: 403, body: { error: "access_denied" } });
  const open = name => f.click(f.find("button", node => node.attributes["aria-label"] ===
    f.i18n.t("workspace.admin.viewAccessNamed", "View access to {name}", { name })));
  first.release.resolve(); open("PRIVATE_A_PROJECT"); await first.seen.promise; await f.flush();
  second.release.resolve(); open(secondName); await second.seen.promise; await f.flush();
  assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 1);
  const otherError = memberReadAlerts(f, secondName); assert.equal(otherError.length, 1);
  const message = otherError[0].text;
  open("PRIVATE_A_PROJECT"); await f.flush();
  assert.equal(visible(f, ORIGINAL), true);
  assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 0);
  const preserved = memberReadAlerts(f, secondName); assert.equal(preserved.length, 1);
  assert.equal(preserved[0].text, message, "Another resource's failure is not canceled by this success");
  assertUnchanged(f, original, 2);
  assert.equal(f.service.requests.filter(request => request.url === secondUrl).length, 1);
});

// Same public context-publication port as Workspace draft completion and
// phase5-retirement-localization. No private controller/method replacement.
function memberReadLiveLocale(f) {
  f.i18n.hostDisconnected(); let publish, revision = 0;
  const snapshot = locale => ({ locale, formatLocale: locale, direction: locale === "ar" ? "rtl" : "ltr",
    timeZone: "UTC", messages: { ...ports.FORMA_DEFAULT_MESSAGES, ...ports.localeCatalogs[locale] }, revision: ++revision });
  const controller = new ports.FormaLocaleController({ addController() {}, requestUpdate() { f.requested = true; },
    dispatchEvent(event) { publish = event.callback; publish(snapshot(f.locale), () => {}); return true; } });
  controller.hostConnected(); f.i18n = controller; f.host.i18n = controller;
  for (const { instance } of f.renderer.instances.values()) instance.i18n = controller;
  return { change(locale) { f.locale = locale; publish(snapshot(locale)); f.draw(); } };
}

for (const status of [401, 403, 404]) test("B3 project member denial " + status + " follows same-host French to Japanese", options, async t => {
  const f = await settingsFixture(t, { locale: "fr", section: "projects" }), language = memberReadLiveLocale(f);
  const host = f.host, controller = f.i18n;
  view(f); await f.flush(); assert.equal(visible(f, ORIGINAL), true);
  const original = snapshot(f), denied = f.service.queue(isMemberRead, "body", { status, body: { error: "access_denied" } });
  view(f); await denied.seen.promise; await f.flush();
  const french = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
  assert.notEqual(french, "This workspace is unavailable.");
  assert.deepEqual(memberReadAlerts(f, "PRIVATE_A_PROJECT").map(node => node.text), [french]);
  const requests = f.service.requests.length;
  language.change("ja"); await f.flush();
  const japanese = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
  assert.equal(f.host, host); assert.equal(f.i18n, controller); assert.equal(f.i18n.locale, "ja");
  assert.notEqual(japanese, french);
  const japaneseVisible = memberReadAlerts(f, "PRIVATE_A_PROJECT").map(node => node.text);
  assert.equal(f.service.requests.length, requests, "Locale publication does not revalidate, retry or change authority");
  assert.equal(visible(f, ORIGINAL), false); assert.equal(denied.jsonCalls, 0);
  denied.release.resolve(); await f.flush(); view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true);
  assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 0, "Fresh success clears only its own error");
  assertUnchanged(f, original, 3);
  assert.deepEqual(japaneseVisible, [japanese], "App-owned denial copy resolves against the current locale");
});

test("B3 same-host locale recovery preserves the other loaded project's localized denial", options, async t => {
  const f = await settingsFixture(t, { locale: "fr", section: "overview" }), language = memberReadLiveLocale(f);
  const host = f.host, controller = f.i18n, secondId = "settings-access-second", secondName = "PRIVATE_SECOND_PROJECT";
  const base = structuredClone(f.service.reply({ url: endpoint("A"), init: {} }));
  base.body.projects.push({ ...base.body.projects[0], project_access_id: secondId,
    project_id: "settings-shared-second", project_name: secondName });
  const detail = structuredClone(f.service.reply({ url: endpoint("A", "/projects"), init: {} }));
  detail.body.projects = structuredClone(base.body.projects);
  const baseGate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A"), "headers", base);
  const detailGate = f.service.queue(request => method(request) === "GET" && request.url === endpoint("A", "/projects"), "headers", detail);
  baseGate.release.resolve(); detailGate.release.resolve(); f.navigate("A", "projects"); await f.flush();
  assert.equal(baseGate.used && detailGate.used, true);
  const original = snapshot(f), secondUrl = endpoint("A", "/projects/" + secondId + "/members");
  const first = f.service.queue(isMemberRead, "headers", { status: 403, body: { error: "access_denied" } });
  const second = f.service.queue(request => method(request) === "GET" && request.url === secondUrl,
    "headers", { status: 403, body: { error: "access_denied" } });
  const open = name => f.click(f.find("button", node => node.attributes["aria-label"] ===
    f.i18n.t("workspace.admin.viewAccessNamed", "View access to {name}", { name })));
  first.release.resolve(); open("PRIVATE_A_PROJECT"); await first.seen.promise; await f.flush();
  second.release.resolve(); open(secondName); await second.seen.promise; await f.flush();
  const french = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
  assert.deepEqual(memberReadAlerts(f, "PRIVATE_A_PROJECT").map(node => node.text), [french]);
  assert.deepEqual(memberReadAlerts(f, secondName).map(node => node.text), [french]);
  const requests = f.service.requests.length;
  language.change("ja"); await f.flush();
  assert.equal(f.host, host); assert.equal(f.i18n, controller); assert.equal(f.service.requests.length, requests);
  const japanese = f.i18n.t("workspace.admin.unavailable", "This workspace is unavailable.");
  assert.notEqual(japanese, french);
  const firstJapanese = memberReadAlerts(f, "PRIVATE_A_PROJECT").map(node => node.text);
  const secondJapanese = memberReadAlerts(f, secondName).map(node => node.text);
  open("PRIVATE_A_PROJECT"); await f.flush();
  assert.equal(visible(f, ORIGINAL), true); assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 0);
  assert.deepEqual(memberReadAlerts(f, secondName).map(node => node.text), [japanese],
    "Recovering A neither clears nor freezes B's current-locale error");
  assert.deepEqual(firstJapanese, [japanese]); assert.deepEqual(secondJapanese, [japanese]);
  assertUnchanged(f, original, 2);
  assert.equal(f.service.requests.filter(request => request.url === secondUrl).length, 1);
});

test("B3 arbitrary member-read diagnostic remains literal across same-host locale changes", options, async t => {
  const f = await settingsFixture(t, { locale: "fr", section: "projects" }), language = memberReadLiveLocale(f);
  const host = f.host, controller = f.i18n;
  view(f); await f.flush(); const original = snapshot(f), previous = f.storeHost.intercept;
  const literal = "Open document"; let failed = false;
  // Existing finite transport port supplies opaque diagnostic text. It is not
  // an app-owned message key or a real server/private-data authorization claim.
  f.storeHost.intercept = request => {
    if (isMemberRead(request) && !failed) { failed = true; throw new Error(literal); }
    return previous?.(request);
  };
  try { view(f); await f.flush(); } finally { f.storeHost.intercept = previous; }
  assert.equal(failed, true); assert.notEqual(f.i18n.system(literal), literal, "Fixture text would translate if misclassified");
  const frenchVisible = memberReadAlerts(f, "PRIVATE_A_PROJECT").map(node => node.text), requests = f.storeHost.requests.length;
  language.change("ja"); await f.flush();
  const japaneseVisible = memberReadAlerts(f, "PRIVATE_A_PROJECT").map(node => node.text);
  assert.equal(f.host, host); assert.equal(f.i18n, controller); assert.equal(f.storeHost.requests.length, requests);
  assert.notEqual(f.i18n.system(literal), literal);
  view(f); await f.flush();
  assert.equal(visible(f, ORIGINAL), true); assert.equal(memberReadAlerts(f, "PRIVATE_A_PROJECT").length, 0);
  assertUnchanged(f, original, 2); // Intercepted failure was recorded by the Store host, not the finite service.
  assert.equal(f.storeHost.requests.filter(isMemberRead).length, 3);
  assert.deepEqual(frenchVisible, [literal]); assert.deepEqual(japaneseVisible, [literal]);
});
