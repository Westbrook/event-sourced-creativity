import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { registerHooks } from "node:module";
import { createSceneStoreHost } from "./helpers/scene-cost-store-host.mjs";
import { confirmationFixture, turn, until } from "./helpers/themed-confirmation-native.mjs";
import { calmFullPageNativePorts as ports, fullPageTree } from "./helpers/calm-full-page-fixture.mjs";

// Read only the immutable ownership suite's fixture declarations, not its tests.
// The actual Store/private methods are not extracted, replaced, or exposed.
const fixtureUrl = new URL("./workspace-settings-response-ownership.test.mjs", import.meta.url);
const fixtureText = fs.readFileSync(fixtureUrl, "utf8");
const fixtureTree = ts.createSourceFile(fixtureUrl.pathname, fixtureText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const fixtureCode = fixtureTree.statements.filter(node => ts.isImportDeclaration(node) || ts.isVariableStatement(node)
  || ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)).map(node => node.getFullText(fixtureTree)).join("\n")
  + "\nexport {finiteSettingsService, ORG, PRINCIPAL, PROJECT, DOCUMENT, events, fiscal, endpoint, memberPath, membersPath, path, NOW};\n";
fixtureUrl.search = "workspace-confirmation-fixture-only";
const hook = registerHooks({ load(url, context, next) {
  return url === fixtureUrl.href ? { format: "module", source: fixtureCode, shortCircuit: true } : next(url, context);
} });
const { finiteSettingsService, ORG, PRINCIPAL, PROJECT, DOCUMENT, events, fiscal, endpoint, memberPath, path, NOW } = await import(fixtureUrl.href);
hook.deregister();
const { localizeTemplateResult } = await ports.loadActual("src/components/design-system/localized-template.ts");
const { FormaUiSwitch } = await ports.loadActual("src/components/design-system/forms.ts");
const { FormaUiCopyButton } = await ports.loadActual("src/components/design-system/feedback.ts");
const { FormaUiAudienceNavigation } = await ports.loadActual("src/components/design-system/navigation.ts");
const { FormaUiCluster } = await ports.loadActual("src/components/design-system/layout.ts");
const INVITATION = "fixture-pending-invite", MEMBER = "fixture-workspace-member", HOLD = "fixture-hold";
const AVAILABLE = "fixture-available", CLEANUP = "fixture-cleanup", CREDENTIAL = "fixture-token-existing", REMOVAL = "fixture-removal";
const deletionBody = { organizationId: ORG.A, confirmation: "DELETE_ORGANIZATION_AND_SCOPED_DATA" };
const descriptions = {
  invitation: f => f.i18n.t("workspace.admin.confirmInvitationRevoke", "Revoke the invitation for {email}?", { email: "invited@example.invalid" }),
  member: f => f.i18n.t("workspace.admin.confirmRevoke", "Remove {name} from this workspace and revoke all project access?", { name: "Finite member" }),
  project: f => f.i18n.t("workspace.admin.confirmProjectRevoke", "Remove {name} from this project?", { name: "PRIVATE_A_PROJECT_MEMBER" }),
  hold: f => f.i18n.system("Release this legal hold? Eligible expired evidence can then be removed.")+"\n"+f.i18n.t("workspace.admin.selectedTarget","Selected target: {name}",
    {name:"\u2068"+f.i18n.system("Entire organization")+" · \u2068Workspace A\u2069 · \u2068Finite preserved evidence\u2069\u2069"}),
  create: f => f.i18n.system("Create an encrypted snapshot of every project you are authorized to read?"),
  rotate: f => f.i18n.system("Rotate this organization's recovery key? Existing snapshots remain decryptable."),
  restore: f => f.i18n.system("Restore") + " · " + f.i18n.system("Keep isolated") + "\n" + f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}",
    { name: "\u2068" + f.i18n.date(new Date(NOW), { dateStyle: "medium", timeStyle: "short" }) + "\u2069" }),
  cleanup: f => f.i18n.system("Remove") + " · " + f.i18n.system("Try again") + "\n" + f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}",
    { name: "\u2068" + f.i18n.date(new Date(NOW), { dateStyle: "medium", timeStyle: "short" }) + "\u2069" }),
  credential: f => f.i18n.system("Immediately revoke this organization provisioning token?") + "\n" + f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}",
    { name: "\u2068" + f.i18n.system("Active scoped token") + " · " + f.i18n.date(new Date(NOW), { dateStyle: "medium", timeStyle: "short" }) + "\u2069" }),
  retry: f => f.i18n.system("Permanently erase scoped organization projects, sources, context packages, output revisions, memberships, and recovery snapshots? Active legal holds prevent deletion."),
  transfer: f => f.i18n.system("Transfer administrative ownership to this eligible administrator? Your current project session will close.") + "\n" + f.i18n.t("workspace.admin.selectedTarget", "Selected target: {name}",
    { name: "\u2068\u2068PRIVATE_A_ADMIN\u2069\u2069" }),
  privacy: f => f.i18n.system("Privately migrate only this organization's historical authored events before irreversible deletion? Other organizations and personal projects remain unchanged."),
};
descriptions.delete = descriptions.retry;
const ACTIONS = [
  { id: "invitation", section: "members", label: "Revoke invitation", method: "DELETE", url: endpoint("A", "/invitations/" + INVITATION), body: null },
  { id: "member", section: "members", label: "Revoke", method: "DELETE", url: endpoint("A", "/members/" + MEMBER), body: null },
  { id: "project", section: "projects", label: "Revoke", method: "DELETE", url: memberPath("A"), body: null },
  { id: "hold", section: "usage", label: "Release hold", method: "DELETE", url: endpoint("A", "/holds/" + HOLD), body: null },
  { id: "create", section: "activity", label: "Create encrypted snapshot", method: "POST", url: endpoint("A", "/recovery"),
    body: { action: "create", confirmation: "CREATE_ENCRYPTED_ORGANIZATION_RECOVERY_SNAPSHOT" } },
  { id: "rotate", section: "activity", label: "Rotate recovery key", method: "POST", url: endpoint("A", "/security/keys/rotate"), body: null },
  { id: "restore", section: "activity", label: "Restore · Keep isolated", method: "POST", url: endpoint("A", "/recovery"),
    body: { action: "restore", snapshotId: AVAILABLE, organizationId: ORG.A, confirmation: "RESTORE_ORGANIZATION_SNAPSHOT_TO_ISOLATED_ROLLBACK_STAGE" } },
  { id: "cleanup", section: "activity", label: "Try again", method: "POST", url: endpoint("A", "/recovery"),
    body: { action: "cleanup", snapshotId: CLEANUP, organizationId: ORG.A, confirmation: "RETRY_ORGANIZATION_RECOVERY_OBJECT_CLEANUP" } },
  { id: "credential", section: "members", label: "Revoke token", method: "DELETE", url: endpoint("A", "/security/provisioning-credentials/" + CREDENTIAL), body: null },
  { id: "retry", section: "overview", label: "Try again", method: "POST", url: endpoint("A", "/deletion"), body: deletionBody },
  { id: "transfer", section: "members", label: "Transfer administrative ownership", form: true, method: "POST", url: endpoint("A", "/ownership"),
    body: { targetUserId: "successor-A", confirmation: "TRANSFER_ORGANIZATION_OWNERSHIP" }, fields: { targetUserId: "successor-A" } },
  { id: "privacy", section: "members", label: "Migrate historical event privacy", details: true, method: "POST", url: endpoint("A", "/recovery"),
    body: { action: "migrate-privacy", organizationId: ORG.A, confirmation: "MIGRATE_ORGANIZATION_HISTORICAL_EVENT_CONTENT" } },
  { id: "delete", section: "members", label: "Permanently delete organization data", form: true, details: true, method: "POST",
    url: endpoint("A", "/deletion"), body: deletionBody, fields: { organizationName: "Workspace A" } },
];
const entries = node => node.children.filter(child => typeof child !== "string").flatMap(child => [child, ...entries(child)]);
const verb = request => (request.init.method ?? "GET").toUpperCase();

async function workspace(t, action, locale = "en") {
  const f = await confirmationFixture(t, { locale }), service = finiteSettingsService();
  const originalReply = service.reply;
  const pendingInvitation = { invitation_id: INVITATION, email_normalized: "invited@example.invalid", role: "member",
    status: "pending", expires_at: "2026-09-06T12:00:00.000Z" };
  const regular = { membership_id: MEMBER, user_id: "finite-member", display_name: "Finite member",
    role: "member", status: "active", email: "member@example.invalid", accepted_at: NOW };
  const hold = { hold_id: HOLD, scope_kind: "organization", resource_id: ORG.A, reason: "Finite preserved evidence", status: "active", created_at: NOW };
  const snapshot = { snapshot_id: action.id === "cleanup" ? CLEANUP : AVAILABLE, created_at: NOW,
    status: action.id === "cleanup" ? "cleanup-pending" : "available", key_id: "finite-key", manifest_json: "{}" };
  const originalJob = { job_id: REMOVAL, status: "partial" };
  service.credentials.A.push({ id: CREDENTIAL, status: "active", createdByUserId: PRINCIPAL, createdAt: NOW, revokedAt: null });
  service.completed = false;
  service.reply = request => {
    const method = verb(request), name = new URL(request.url, "http://localhost").pathname;
    if (method !== "GET") {
      assert.equal(method, action.method, "Only the separately confirmed method may reach this finite service");
      assert.equal(name, action.url, "Exact originally reviewed organization/resource URL");
      assert.deepEqual(request.body, action.body, "Exact original command fields; no substitute source or action");
      if (action.id === "project" || action.id === "transfer") return originalReply(request);
      let receipt;
      if (["invitation", "member"].includes(action.id)) {
        if (action.id === "invitation") pendingInvitation.status = "revoked"; else regular.status = "revoked";
        receipt = { ok: true };
      }
      else if (action.id === "hold") { hold.status = "released"; receipt = { holdId: HOLD, status: "released", releasedAt: NOW }; }
      else if (action.id === "credential") {
        service.credentials.A[0].status = "revoked"; service.credentials.A[0].revokedAt = NOW;
        receipt = { credentialId: CREDENTIAL, status: "revoked", revokedAt: NOW };
      } else if (action.id === "rotate") receipt = { keyId: "finite-next-key", version: 2, coverage: "encrypted-recovery-snapshots-only" };
      else if (action.id === "create") receipt = { snapshotId: "finite-new-snapshot", keyId: "finite-key", contentSha256: "0".repeat(64),
        manifest: {}, encrypted: true, snapshotStorage: "encrypted-database", createdAt: NOW, isolatedRestoreAvailable: false,
        isolatedRollbackRestoreAvailable: true, productionTenantRestoreAvailable: false };
      else if (action.id === "restore") receipt = { drillId: "finite-drill", snapshotId: AVAILABLE, status: "passed", durationMs: 1,
        verifiedRecordCount: 1, verifiedObjectCount: 0, isolatedRestorePerformed: false, isolatedRollbackRestorePerformed: true,
        rollbackVerified: true, productionTenantMutated: false, objectStorageRestorePerformed: false, replicatedBackupVerified: false };
      else if (action.id === "cleanup") { snapshot.status = "removed"; receipt = { snapshotId: CLEANUP, status: "removed", objectDeletionVerified: true }; }
      else if (action.id === "privacy") receipt = { organizationId: ORG.A, migratedEvents: 1, rowIdentitiesPreserved: true,
        otherOrganizationsUnchanged: true, historicalBackupsPurged: false };
      else {
        service.completed = true; service.roles.A = "none"; service.bump({ projectContext: undefined });
        receipt = { jobId: REMOVAL, status: "completed", receipt: { organizationId: ORG.A, immutableOperationalMetadataRetained: true } };
      }
      service.writes.push({ method, url: name, body: request.body, receipt });
      return { status: action.id === "create" ? 201 : 200, body: receipt };
    }
    const result = originalReply(request);
    if (result.status !== 200) return result;
    if (name === endpoint("B") || name === endpoint("B", "/members")) {
      result.body.invitations.push({ ...pendingInvitation, invitation_id: "new-owner-invitation-B", status: "pending", email_normalized: "b@example.invalid" });
      return result;
    }
    if (!name.startsWith(endpoint("A"))) return result;
    if (name === endpoint("A") || name === endpoint("A", "/members")) {
      result.body.members.push({ ...regular }); result.body.invitations.push({ ...pendingInvitation });
    }
    if (name === endpoint("A", "/security")) result.body.encryption.recoverySnapshots = "AES-GCM-256";
    if (name === endpoint("A", "/holds")) result.body.holds = action.id === "hold" && hold.status === "active" ? [{ ...hold }] : [];
    if (name === endpoint("A", "/recovery")) result.body.snapshots = snapshot.status === "removed" ? [] : [{ ...snapshot }];
    if (name === endpoint("A", "/deletion") && action.id === "retry" && !service.completed) result.body.job = { ...originalJob };
    if (name === endpoint("A", "/usage")) return { status: 200, body: { organization: result.body.organization, period: "2026-08",
      policy: { token_limit: 100000, microusd_limit: 60000000 }, cost: { used_microusd: 2400, reserved_microusd: 19644000 },
      tokens: { used_tokens: 12, reserved_tokens: 34 }, reservations: [] } };
    return result;
  };
  // Usage is an additional finite read in this caller suite, not a policy mutation.
  const withUsage = service.reply;
  service.reply = request => request.url === endpoint("A", "/usage") && verb(request) === "GET"
    ? { status: 200, body: { organization: { organizationId: ORG.A, name: "Workspace A", role: service.roles.A }, period: "2026-08",
      policy: { token_limit: 100000, microusd_limit: 60000000 }, cost: { used_microusd: 2400, reserved_microusd: 19644000 },
      tokens: { used_tokens: 12, reserved_tokens: 34 }, reservations: [] } }
    : withUsage(request);
  const worker = { documentId: DOCUMENT, projectId: PROJECT, requestId: "no-generation", streamId: "creative:" + PRINCIPAL,
    owner: PRINCIPAL, events: structuredClone(events), contentRef: "unused", content: "", payload: { workflowSources: [] },
    request: service.request, close() {} };
  const h = await createSceneStoreHost({ workerFixture: worker, exposeSceneTestAccessors: false });
  f.store = h.store; f.storeHost = h; f.service = service; f.fields = new WeakMap();
  const previousConfirm = f.view.confirm;
  f.view.confirm = () => assert.fail("Workspace must use the owned native helper, not window.confirm");
  const oldHistory = Object.getOwnPropertyDescriptor(globalThis, "history");
  Object.defineProperty(globalThis, "history", { configurable: true, value: {
    pushState(_state, _title, route) { const url = new URL(route, "http://localhost"); Object.assign(h.location, { pathname: url.pathname, search: url.search, hash: url.hash }); },
    replaceState(...args) { this.pushState(...args); },
  } });
  for (const type of ["forma-route-changed", "forma-authorization-changed"]) h.window.addEventListener(type, event => {
    ports.bindFixture(f); f.emitWindow(type, { detail: event.detail });
  });
  f.transport.handler = request => service.request(request.url, request.init);
  t.mock.method(globalThis, "FormData", function FormDataPort(form) {
    assert.ok(form?.tag === "form" && form.isConnected);
    const values = f.fields.get(form) ?? new Map(); return { get: key => values.get(key) ?? null };
  });
  f.store.loading.set(false); f.store.setRoute(path("A", action.section));
  await f.mount("src/components/forma-workspace-settings.ts", "FormaWorkspaceSettings", "forma-workspace-settings");
  Object.assign(f.renderer.registry, { "forma-ui-switch": FormaUiSwitch, "forma-ui-copy-button": FormaUiCopyButton,
    "forma-ui-audience-navigation": FormaUiAudienceNavigation, "forma-ui-cluster": FormaUiCluster });
  const renderValue = f.renderer.value;
  f.renderer.value = function(value, ...rest) { return renderValue.call(this, localizeTemplateResult(value, f.i18n), ...rest); };
  f.tick = async () => { await Promise.resolve(); f.draw(); return true; };
  f.flush = async () => { for (let i = 0; i < 12; i++) { await turn(); f.draw(); } };
  f.tree = () => fullPageTree(f);
  f.label = () => action.id === "restore" ? f.i18n.system("Restore") + " · " + f.i18n.system("Keep isolated")
    : action.id === "invitation" ? f.i18n.t("workspace.admin.revokeInvitation", "Revoke invitation")
      : ["member", "project"].includes(action.id) ? f.i18n.t("workspace.admin.revoke", "Revoke") : f.i18n.system(action.label);
  f.pick = () => {
    f.draw();
    if (action.details) for (const node of f.tree().nodes.filter(value => value.tag === "details")) if (node.port) node.port.open = true;
    const nodes = f.tree().visible(action.form ? "form" : "button").filter(node => action.form
      ? node.text.includes(f.label()) : node.text === f.label());
    // The member fixture also has an administrator. Use the actual name-qualified action.
    const filtered = action.id === "member" ? nodes.filter(node => String(node.attributes["aria-label"]).includes("Finite member")) : nodes;
    assert.equal(filtered.length, 1, "one current native caller for " + action.id); return filtered[0];
  };
  f.beginAction = () => {
    const node = f.pick();
    assert.ok(node.port?.isConnected && !node.hiddenBy && !Object.hasOwn(node.attributes, "disabled"));
    if (!action.form) { node.port.focus(); node.handlers.click.call(node.owner, { target: node.port, currentTarget: node.port, preventDefault() {} }); }
    else {
      f.fields.set(node.port, new Map(Object.entries(action.fields)));
      const button = entries(node).find(child => child.tag === "button" && child.attributes.type === "submit");
      assert.ok(button?.port); button.port.focus();
      node.handlers.submit.call(node.owner, { target: node.port, currentTarget: node.port, submitter: button.port, preventDefault() {} });
    }
    return node;
  };
  await f.flush();
  if (action.id === "project") {
    const choices = f.tree().visible("button").filter(node => node.text === f.i18n.t("workspace.admin.viewAccess", "View access"));
    assert.equal(choices.length, 1); const choice = choices[0];
    choice.handlers.click.call(choice.owner, { target: choice.port, currentTarget: choice.port, preventDefault() {} });
    await f.flush();
  }
  t.after(async () => {
    for (const gate of service.gates) gate.release.resolve();
    f.host.isConnected = false; f.host.disconnectedCallback();
    for (let i = 0; i < 12; i++) await turn();
    assert.deepEqual(service.stray, []);
    assert.equal(service.requests.some(request => /document-jobs|output-requirements|\/(?:render|run|execute|generate)(?:\/|$)/u.test(request.url)), false);
    assert.deepEqual({ budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets }, fiscal);
    f.view.confirm = previousConfirm;
    if (oldHistory) Object.defineProperty(globalThis, "history", oldHistory); else delete globalThis.history;
    await h.close();
  });
  return f;
}

for (const action of ACTIONS) test("Workspace " + action.id + " Cancel has no dispatch and fresh approval preserves exact command", async t => {
  const f = await workspace(t, action); f.beginAction();
  const originalDialog = f.dialog(); assert.ok(originalDialog, "Native confirmation exists before any request");
  assert.equal(serviceWrites(f).length, 0);
  assert.equal(originalDialog.querySelector("p").textContent, descriptions[action.id](f));
  assert.ok(originalDialog.querySelector("h2").textContent.includes("Workspace A"));
  f.cancel(); await f.flush(); assert.equal(f.dialog(), null); assert.equal(serviceWrites(f).length, 0);
  f.beginAction(); assert.ok(f.dialog()); f.confirm();
  await until(() => serviceWrites(f).length === 1, "One explicitly approved exact finite request");
  await f.flush();
  assert.deepEqual(serviceWrites(f).map(row => [row.method, row.url, row.body]), [[action.method, action.url, action.body]]);
  assert.equal(f.dialog(), null);
});
const serviceWrites = f => f.service.writes;

for (const locale of ["fr", "ar", "ja"]) test("Workspace exact invitation confirmation is localized " + locale, async t => {
  const action = ACTIONS[0], f = await workspace(t, action, locale); f.beginAction();
  const dialog = f.dialog(); assert.ok(dialog); assert.equal(dialog.lang, locale); assert.equal(dialog.dir, locale === "ar" ? "rtl" : "ltr");
  assert.equal(dialog.querySelector("p").textContent, descriptions.invitation(f));
  assert.equal(f.buttons()[1].textContent, f.label()); f.cancel(); await f.flush(); assert.equal(serviceWrites(f).length, 0);
});

for (const boundary of ["route", "route-ABA", "authority", "authority-ABA", "disconnect"]) test(
  "Workspace pending confirmation retires before dispatch on " + boundary, async t => {
    const f = await workspace(t, ACTIONS[0]); f.beginAction();
    const old = f.dialog(), form = old.querySelector("form"), positive = f.buttons()[1];
    if (boundary === "disconnect") { f.host.isConnected = false; f.host.disconnectedCallback(); }
    else if (boundary.startsWith("route")) {
      f.store.setRoute(path("B", "members")); if (boundary === "route-ABA") f.store.setRoute(path("A", "members"));
    } else {
      const previous = structuredClone(f.service.session); f.service.bump(); await f.store.refreshSession();
      if (boundary === "authority-ABA") { f.service.session = previous; await f.store.refreshSession(); }
    }
    positive.emit("click", { isTrusted: true }); form.emit("submit", { submitter: positive, isTrusted: true });
    await turn(); assert.equal(old.isConnected, false); assert.equal(serviceWrites(f).length, 0);
  });

test("Workspace duplicate review cannot create another prompt or request", async t => {
  const action = ACTIONS[0], f = await workspace(t, action), first = f.beginAction(), dialog = f.dialog();
  first.handlers.click.call(first.owner, { target: first.port, currentTarget: first.port, preventDefault() {} });
  assert.equal(f.dialog(), dialog); assert.equal(serviceWrites(f).length, 0);
  const gate = f.service.queue(request => verb(request) === action.method && request.url === action.url, "headers");
  f.confirm(); await gate.seen.promise;
  first.handlers.click.call(first.owner, { target: first.port, currentTarget: first.port, preventDefault() {} });
  assert.equal(f.dialog(), null); assert.equal(serviceWrites(f).length, 1);
  gate.release.resolve(); await f.flush(); assert.equal(serviceWrites(f).length, 1);
});

for (const id of ["transfer", "delete"]) test("Workspace " + id + " changed current form is not overwritten by old approval", async t => {
  const action = ACTIONS.find(value => value.id === id), f = await workspace(t, action), source = f.beginAction();
  const key = id === "transfer" ? "targetUserId" : "organizationName", newer = id === "transfer" ? "newer-unsaved-target" : "Newer unsaved name";
  f.fields.get(source.port).set(key, newer);
  f.confirm(); await turn();
  assert.equal(serviceWrites(f).length, 0); assert.equal(f.fields.get(source.port).get(key), newer);
  assert.equal(f.dialog(), null, "A stale form confirmation cannot silently approve a changed intent");
});

for (const id of ["project", "transfer"]) test("Workspace confirmed " + id + " keeps saved acknowledgement after permission refresh", async t => {
  const action = ACTIONS.find(value => value.id === id), f = await workspace(t, action); f.beginAction(); f.confirm(); await f.flush();
  assert.equal(serviceWrites(f).length, 1);
  const expected = id === "project" ? f.i18n.t("workspace.admin.projectRevoked", "Project access was revoked.")
    : f.i18n.system("Organization administrative ownership was transferred.");
  assert.ok(f.tree().root.text.includes(expected));
  assert.equal(f.store.session.get().permissionEpoch, f.service.session.permissionEpoch);
});

const workspaceLateConfirmationTrace = (phase, f = null, detail = {}) => {
  if (process.env.FORMA_WORKSPACE_LATE_CONFIRMATION_TRACE !== "1") return;
  process.stderr.write("WORKSPACE_LATE_CONFIRMATION " + JSON.stringify({ phase,
    ...(f ? { route: f.store.route.get(), requests: f.service.requests.length, pending: f.service.pending,
      writes: f.service.writes.length, hostConnected: f.host.isConnected, nodes: f.renderer.nodes.length,
      nativeDialogs: f.doc.body.children.filter(node => node.tag === "dialog" && node.open).length,
      observers: f.mutations.size, traceLength: f.trace.length } : {}), ...detail }) + "\n");
};

test("Workspace sent action late response cannot clear a newer owner's confirmation or move focus", async t => {
  workspaceLateConfirmationTrace("setup-start");
  const action = ACTIONS[0], f = await workspace(t, action), gate = f.service.queue(request => verb(request) === action.method && request.url === action.url, "headers");
  workspaceLateConfirmationTrace("setup-ready", f);
  f.beginAction(); f.confirm(); workspaceLateConfirmationTrace("confirmed-before-original-seen", f);
  await gate.seen.promise; workspaceLateConfirmationTrace("original-seen", f, { gateUsed: gate.used, jsonCalls: gate.jsonCalls });
  f.store.setRoute(path("B", "members")); workspaceLateConfirmationTrace("route-B-before-flush", f);
  await f.flush(); workspaceLateConfirmationTrace("route-B-flushed", f);
  const newerSource = f.beginAction(); const newer = f.dialog(); assert.ok(newer);
  const focused = f.doc.activeElement;
  workspaceLateConfirmationTrace("newer-open", f, { sourceConnected: newerSource.port.isConnected, dialogConnected: newer.isConnected });
  gate.release.resolve(); workspaceLateConfirmationTrace("original-released-before-flush", f);
  await f.flush();
  workspaceLateConfirmationTrace("before-identity-assertions", f, { sourceConnected: newerSource.port.isConnected,
    dialogConnected: newer.isConnected, sameDialog: f.dialog() === newer, sameFocus: f.doc.activeElement === focused,
    gateUsed: gate.used, jsonCalls: gate.jsonCalls });
  assert.equal(f.dialog() === newer, true, "The exact newer native confirmation remains current");
  assert.equal(f.doc.activeElement === focused, true, "The exact newer focused native control remains current");
  assert.equal(serviceWrites(f).length, 1);
  f.cancel(); await f.flush(); assert.equal(serviceWrites(f).length, 1);
  workspaceLateConfirmationTrace("case-body-complete", f);
});

// Current complete Workspace/Store/dialog and existing finite read envelopes.
// These paired choices are not real Worker insertions or physical AT evidence.
// Cancel only: no target-specific mutation response is invented for these cases.
async function confirmationIdentityPair(t, kind, sameVisible, locale = "en") {
  const action = ACTIONS.find(candidate => candidate.id === kind);
  assert.ok(action);
  const f = await workspace(t, action, locale), originalReply = f.service.reply;
  const ids = kind === "transfer" ? ["successor-A", "successor-A-peer"]
    : kind === "credential" ? [CREDENTIAL, CREDENTIAL + "-peer"]
      : [kind === "restore" ? AVAILABLE : CLEANUP, (kind === "restore" ? AVAILABLE : CLEANUP) + "-peer"];
  const timestamps = [NOW, new Date(Date.parse(NOW) + (sameVisible ? 15000 : 86400000)).toISOString()];
  let pairReads = 0;
  f.service.reply = request => {
    const result = originalReply(request), name = new URL(request.url, "http://localhost").pathname;
    if (verb(request) !== "GET" || result.status !== 200) return result;
    if (["restore", "cleanup"].includes(kind) && name === endpoint("A", "/recovery")) {
      const original = result.body.snapshots[0]; assert.ok(original);
      result.body.snapshots = ids.map((id, index) => ({ ...original, snapshot_id: id, created_at: timestamps[index] })); pairReads++;
    } else if (kind === "credential" && name === endpoint("A", "/security/provisioning-credentials")) {
      const original = result.body.credentials.find(value => value.id === CREDENTIAL); assert.ok(original);
      result.body.credentials = ids.map((id, index) => ({ ...original, id, createdAt: timestamps[index] })); pairReads++;
    } else if (kind === "transfer" && [endpoint("A"), endpoint("A", "/members")].includes(name)) {
      const original = result.body.members.find(value => value.user_id === "successor-A"); assert.ok(original);
      result.body.members = [...result.body.members.filter(value => value.role !== "administrator"),
        ...ids.map((id, index) => ({ ...original, membership_id: original.membership_id + "-" + index, user_id: id,
          display_name: sameVisible ? "Equal administrator اسم 同名" : "Administrator " + (index + 1),
          email: "administrator-" + (index + 1) + "@example.invalid" }))]; pairReads++;
    }
    return result;
  };
  // Re-enter through the existing public Store route; do not expose private state.
  f.store.setRoute("/settings/workspaces"); await f.flush();
  f.store.setRoute(path("A", action.section)); await f.flush();
  assert.ok(pairReads > 0, "the current component consumed the paired finite resource read");
  assert.equal(new Set(ids).size, 2);
  return { f, action, ids, singleReply: originalReply };
}

const confirmationLiteralText = node => [node.textContent ?? "", ...(node.children ?? []).map(confirmationLiteralText)].join(" ").replace(/\s+/gu, " ").trim();
const confirmationChoiceText = value => String(value).replace(/[\u2066-\u2069]/gu, "").replace(/\s+/gu, " ").trim();

for (const kind of ["restore", "cleanup", "credential", "transfer"]) for (const sameVisible of [true, false]) {
  test("Workspace confirmation identity baseline " + kind + " " + (sameVisible ? "same visible context" : "distinct context control"), async t => {
    const { f, action, ids } = await confirmationIdentityPair(t, kind, sameVisible), observations = [];
    for (let index = 0; index < 2; index++) {
      f.draw(); const tree = f.tree(); let source, invoker, choiceText;
      if (kind === "transfer") {
        const forms = tree.visible("form").filter(node => node.text.includes(f.label()));
        assert.equal(forms.length, 1); source = forms[0];
        const select = entries(source).find(node => node.tag === "select" && node.attributes.name === "targetUserId");
        assert.ok(select);
        const renderedOptions = entries(select).filter(node => node.tag === "option");
        assert.equal(Object.hasOwn(select.attributes, "required"), true);
        assert.equal(renderedOptions[0].attributes.value, "");
        assert.equal(renderedOptions[0].text, f.i18n.t("field.choose", "Choose an option"));
        const options = renderedOptions.slice(1);
        assert.equal(options.length, 2); assert.deepEqual(options.map(node => node.attributes.value), ids);
        // Existing finite native FormData port models the selected public option.
        f.fields.set(source.port, new Map([["targetUserId", ids[index]]]));
        choiceText = source.text + " | selected option: " + options[index].text;
        invoker = entries(source).find(node => node.tag === "button" && node.attributes.type === "submit");
        assert.ok(invoker?.port?.isConnected); invoker.port.focus();
        source.handlers.submit.call(source.owner, { target: source.port, currentTarget: source.port, submitter: invoker.port, preventDefault() {} });
      } else {
        const choices = tree.visible("button").filter(node => node.text === f.label());
        assert.equal(choices.length, 2); source = choices[index]; invoker = source;
        let row = source.parent; while (row && row.tag !== "li") row = row.parent;
        assert.ok(row, "current action belongs to its complete visible resource row"); choiceText = row.text;
        assert.ok(source.port?.isConnected && !source.hiddenBy && !Object.hasOwn(source.attributes, "disabled"));
        source.port.focus(); source.handlers.click.call(source.owner, { target: source.port, currentTarget: source.port, preventDefault() {} });
      }
      const dialog = f.dialog(); assert.ok(dialog, "the real helper opened for the current selected resource");
      assert.equal(dialog.lang, "en"); assert.equal(dialog.dir, "ltr");
      assert.equal(dialog.getAttribute("aria-labelledby"), dialog.querySelector("h2").id);
      assert.equal(dialog.getAttribute("aria-describedby"), dialog.querySelector("p").id);
      assert.equal(f.buttons()[1].textContent, f.label());
      assert.equal(f.doc.activeElement, f.buttons()[0]);
      const modalText = confirmationLiteralText(dialog);
      observations.push({ targetId: ids[index], choiceText: confirmationChoiceText(choiceText), modalText,
        // Include all surrounding page text as an upper bound on compensating context.
        completeContext: confirmationChoiceText(tree.root.text + " | " + choiceText + " | " + modalText) });
      assert.equal(serviceWrites(f).length, 0, "opening is not execution");
      f.cancel(); await f.flush(); assert.equal(f.dialog(), null); assert.equal(serviceWrites(f).length, 0);
    }
    assert.equal(f.store.route.get(), path("A", action.section));
    assert.deepEqual(f.transport.external, []); assert.deepEqual(serviceWrites(f), []);
    t.diagnostic(JSON.stringify({ kind, sameVisible, observations: observations.map(({ targetId, choiceText, modalText }) => ({ targetId, choiceText, modalText })),
      distinctChoiceContexts: new Set(observations.map(value => value.choiceText)).size,
      distinctModalContexts: new Set(observations.map(value => value.modalText)).size }));
    assert.equal(new Set(observations.map(value => value.completeContext)).size, 2,
      "two exact resources must remain distinguishable in current visible choice plus confirmation context");
  });
}

// Additive current-component cases. The original eight paired cases above keep
// their assertions and default EN setup. New positive commands use only the
// original finite service's exact method/URL/body guards, never a peer ACK.
const targetCopy = {
  en: { selected: "Selected target:", snapshot: "Snapshot", token: "Token", member: "Member" },
  fr: { selected: "Cible sélectionnée :", snapshot: "Instantané", token: "Jeton", member: "Membre" },
  ar: { selected: "الهدف المحدد:", snapshot: "لقطة", token: "الرمز", member: "العضو" },
  ja: { selected: "選択した対象:", snapshot: "スナップショット", token: "トークン", member: "メンバー" },
};
const targetIsolate = value => "\u2068" + value + "\u2069";
const targetVisibleKey = value => confirmationChoiceText(value).normalize("NFC");
const targetQuestion = (f, kind) => kind === "restore" ? f.i18n.system("Restore") + " · " + f.i18n.system("Keep isolated")
  : kind === "cleanup" ? f.i18n.system("Remove") + " · " + f.i18n.system("Try again")
    : kind === "credential" ? f.i18n.system("Immediately revoke this organization provisioning token?")
      : f.i18n.system("Transfer administrative ownership to this eligible administrator? Your current project session will close.");

for (const locale of ["en", "fr", "ar", "ja"]) for (const kind of ["restore", "cleanup", "credential", "transfer"]) {
  test("Workspace exact target row, name and dialog survive current reorder " + kind + " / " + locale, async t => {
    const { f, action, ids, singleReply } = await confirmationIdentityPair(t, kind, true, locale), pairedReply = f.service.reply;
    let variant = "paired", reversed = false, renderedReads = 0;
    const longTail = "長い名前".repeat(24), rawNames = ["  Égal اسم " + longTail + "  ", "\u2068E\u0301gal اسم " + longTail + "\u2069"];
    const sharedEmail = "existing-" + "long-".repeat(28) + "name@example.invalid";
    const metadata = item => {
      const id = kind === "transfer" ? item.user_id : kind === "credential" ? item.id : item.snapshot_id;
      const index = ids.indexOf(id); assert.ok(index >= 0);
      if (variant === "unique") {
        if (kind === "transfer") return { ...item, display_name: "Administrator " + (index + 1) };
        const date = new Date(Date.parse(NOW) + index * 86400000).toISOString();
        return kind === "credential" ? { ...item, createdAt: date } : { ...item, created_at: date };
      }
      if (kind === "transfer" && ["no-email", "shared-email"].includes(variant)) {
        const result = { ...item, display_name: rawNames[index] };
        if (variant === "no-email") delete result.email; else result.email = sharedEmail;
        return result;
      }
      return item;
    };
    f.service.reply = request => {
      const result = pairedReply(request), name = new URL(request.url, "http://localhost").pathname;
      if (verb(request) !== "GET" || result.status !== 200) return result;
      const shape = rows => { renderedReads++; const next = rows.map(metadata); return reversed ? next.reverse() : next; };
      if (["restore", "cleanup"].includes(kind) && name === endpoint("A", "/recovery")) result.body.snapshots = shape(result.body.snapshots);
      else if (kind === "credential" && name === endpoint("A", "/security/provisioning-credentials")) result.body.credentials = shape(result.body.credentials);
      else if (kind === "transfer" && [endpoint("A"), endpoint("A", "/members")].includes(name))
        result.body.members = [...result.body.members.filter(item => item.role !== "administrator"), ...shape(result.body.members.filter(item => item.role === "administrator"))];
      return result;
    };
    const reload = async () => {
      const before = renderedReads;
      f.store.setRoute("/settings/workspaces"); await f.flush(); f.store.setRoute(path("A", action.section)); await f.flush();
      assert.ok(renderedReads > before, "the actual component read the current shaped metadata");
    };
    const expectedLabel = id => {
      const index = ids.indexOf(id), copy = targetCopy[locale];
      if (kind === "transfer") {
        if (variant === "unique") return targetIsolate("Administrator " + (index + 1));
        if (variant === "paired") return targetIsolate("Equal administrator اسم 同名") + " · " + targetIsolate("administrator-" + (index + 1) + "@example.invalid");
        return targetIsolate(rawNames[index]) + (variant === "shared-email" ? " · " + targetIsolate(sharedEmail) : "")
          + " · " + copy.member + " " + f.i18n.number(index + 1);
      }
      const date = f.i18n.date(new Date(Date.parse(NOW) + (variant === "unique" ? index * 86400000 : 0)), { dateStyle: "medium", timeStyle: "short" });
      return date + (variant === "unique" ? "" : " · " + (kind === "credential" ? copy.token : copy.snapshot) + " " + f.i18n.number(index + 1));
    };
    const currentChoices = () => {
      f.draw(); const tree = f.tree(), order = reversed ? [...ids].reverse() : ids;
      if (kind === "transfer") {
        const form = tree.visible("form").find(node => node.text.includes(f.label())); assert.ok(form);
        const select = entries(form).find(node => node.tag === "select" && node.attributes.name === "targetUserId"); assert.ok(select);
        const renderedOptions = entries(select).filter(node => node.tag === "option");
        assert.equal(Object.hasOwn(select.attributes, "required"), true);
        assert.equal(renderedOptions[0].attributes.value, "");
        assert.equal(renderedOptions[0].text, f.i18n.t("field.choose", "Choose an option"));
        const options = renderedOptions.slice(1);
        assert.deepEqual(options.map(node => node.attributes.value), order, "native values retain exact user IDs, not membership labels");
        const invoker = entries(form).find(node => node.tag === "button" && node.attributes.type === "submit"); assert.ok(invoker);
        return options.map(node => ({ id: node.attributes.value, source: form, invoker, label: node.text }));
      }
      const buttons = tree.visible("button").filter(node => node.text === f.label()); assert.equal(buttons.length, 2);
      return buttons.map((node, index) => {
        let row = node.parent; while (row && row.tag !== "li") row = row.parent; assert.ok(row);
        const identity = entries(row).find(child => child.tag === "bdi"); assert.ok(identity, "visible identity is bidi-isolated in the unchanged row");
        const label = identity.text, target = kind === "credential" ? f.i18n.system("Active scoped token") + " · " + label : label;
        const name = String(node.attributes["aria-label"]);
        assert.equal(name, f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", { action: f.label(), name: targetIsolate(target) }));
        assert.ok(targetVisibleKey(name).includes(targetVisibleKey(f.label())), "full visible action is retained in its programmatic name");
        return { id: order[index], source: node, invoker: node, label };
      });
    };
    const open = choice => {
      assert.ok(choice.invoker.port?.isConnected && !choice.invoker.hiddenBy && !Object.hasOwn(choice.invoker.attributes, "disabled"));
      choice.invoker.port.focus();
      if (kind === "transfer") {
        f.fields.set(choice.source.port, new Map([["targetUserId", choice.id]]));
        choice.source.handlers.submit.call(choice.source.owner, { target: choice.source.port, currentTarget: choice.source.port, submitter: choice.invoker.port, preventDefault() {} });
      } else choice.source.handlers.click.call(choice.source.owner, { target: choice.source.port, currentTarget: choice.source.port, preventDefault() {} });
      const dialog = f.dialog(); assert.ok(dialog);
      const label = expectedLabel(choice.id), target = kind === "credential" ? f.i18n.system("Active scoped token") + " · " + label : label;
      assert.equal(dialog.lang, locale); assert.equal(dialog.dir, locale === "ar" ? "rtl" : "ltr");
      assert.equal(dialog.getAttribute("aria-labelledby"), dialog.querySelector("h2").id);
      assert.equal(dialog.getAttribute("aria-describedby"), dialog.querySelector("p").id);
      assert.equal(dialog.querySelector("p").textContent, targetQuestion(f, kind) + "\n" + targetCopy[locale].selected + " " + targetIsolate(target));
      assert.equal(f.buttons()[1].textContent, f.label()); assert.equal(f.doc.activeElement, f.buttons()[0]);
      assert.equal(serviceWrites(f).length, 0, "opening a named confirmation never dispatches");
    };
    const inspect = async () => {
      const labels = new Map(currentChoices().map(choice => [choice.id, choice.label]));
      assert.equal(new Set([...labels.values()].map(targetVisibleKey)).size, 2, "complete current choice labels remain distinguishable");
      for (const [id, label] of labels) assert.equal(targetVisibleKey(label), targetVisibleKey(expectedLabel(id)));
      for (const id of ids) { const choice = currentChoices().find(row => row.id === id); open(choice); f.cancel(); await f.flush(); assert.equal(f.dialog(), null); }
      return labels;
    };
    const originalLabels = await inspect(); reversed = true; await reload();
    assert.deepEqual(await inspect(), originalLabels, "reordering cannot relabel a retained exact identity");
    if (kind === "transfer") for (const next of ["no-email", "shared-email"]) { variant = next; await reload(); await inspect(); }
    variant = "unique"; await reload(); const concise = await inspect();
    for (const label of concise.values()) assert.doesNotMatch(label, /@example\.invalid|\[(?:fixture|settings)-/u, "unique choices do not acquire email or ID clutter");
    // Restore the original finite service before the original positive action;
    // all peer cases were Cancel-only. Existing original identity guards remain.
    const original = currentChoices().find(choice => choice.id === ids[0]); open(original); f.service.reply = singleReply; f.confirm();
    await until(() => serviceWrites(f).length === 1, "one deliberately approved original exact command"); await f.flush();
    assert.deepEqual(serviceWrites(f).map(row => [row.method, row.url, row.body]), [[action.method, action.url, action.body]]);
    assert.equal(f.dialog(), null); assert.deepEqual(f.transport.external, []);
    t.diagnostic(JSON.stringify({ locale, kind, reordered: true, longAuthoredFallback: kind === "transfer", originalCommands: 1, providerCalls: 0,
      evidence: "actual component/Store/native helper with existing finite HTTP service; not Worker authorization, geometry or physical AT" }));
  });
}


// Browser history may change a fragment while a native modal is open. This is
// the downstream actual Store publication already exercised through the full
// Shell by workspace-settings-fragment-custody; never click an inert background
// Skip link or reuse an old positive callback to simulate that browser gesture.
for (const fragment of [false, true]) test("Workspace pending confirmation " + (fragment ? "native history fragment retires only its prompt" : "healthy current Cancel remains reachable"), async t => {
  const f = await workspace(t, ACTIONS[0]), route = f.store.route.get(), source = structuredClone(f.store.events.get());
  const session = structuredClone(f.store.session.get()), authority = f.store.captureAuthorizationScope();
  f.beginAction(); const dialog = f.dialog();
  assert.ok(dialog?.isConnected && dialog.open, "actual current native modal is open");
  assert.equal(serviceWrites(f).length, 0);
  if (fragment) {
    const location = f.storeHost.location, next = route + "#main-content";
    // Finite native History only changes Location. Explicitly deliver the same
    // public Store commit as Shell.#pop, without a background DOM interaction.
    f.emitWindow("keydown", { target: f.doc.activeElement, key: "ArrowLeft", altKey: true });
    history.pushState({}, "", next);
    assert.equal(f.store.route.get(), route, "native history does not implicitly mutate the Store");
    const focusStart = f.trace.length;
    f.store.setRoute(location.pathname + location.search + location.hash);
    assert.equal(f.store.route.get(), next);
    assert.equal(dialog.isConnected, false, "fragment publication synchronously retires the unsent prompt");
    assert.equal(f.dialog(), null);
    await turn();
    assert.equal(f.trace.slice(focusStart).some(value => Array.isArray(value) && value[0] === "focus"), false,
      "history retirement cannot restore the old invoker's focus");
  } else {
    assert.equal(f.dialog(), dialog, "without a new gesture the existing confirmation remains usable");
    f.cancel();
  }
  await f.flush();
  assert.equal(serviceWrites(f).length, 0, "neither cancellation nor history approves or dispatches the command");
  assert.deepEqual(f.store.events.get(), source); assert.deepEqual(f.store.session.get(), session);
  assert.equal(f.store.authorizationScopeActive(authority), true);
  f.beginAction(); const fresh = f.dialog();
  assert.ok(fresh?.isConnected && fresh.open); assert.notEqual(fresh, dialog, "only a fresh current control opens the next review");
  f.cancel(); await f.flush();
  assert.equal(f.dialog(), null); assert.equal(serviceWrites(f).length, 0);
  assert.deepEqual(f.transport.external, []);
});
