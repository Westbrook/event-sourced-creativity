// Complete current Creator Shell/WorkspaceSettings/AccountSettings/Store.
// Settings HTTP is the existing explicit finite service, NOT a Worker or a
// permission mutation. Native form reflection is not browser/AT certification.
import assert from "node:assert/strict";
import test from "node:test";
import { workspaceFragmentFixture, ports, invitation, method, settingsPath, nativeFormLifetime, nativeDefaultProperties } from "./helpers/workspace-settings-fragment-fixture.mjs";
import { retentionNativeForm, within } from "./helpers/workspace-policy-native-fixture.mjs";
import { memberReadLiveLocale } from "./helpers/workspace-settings-whole-read-fixture.mjs";
import { installOutputNavigationFocusNative } from "./helpers/output-navigation-focus-native.mjs";

const options = { timeout: 45_000, concurrency: false };
const hasClass = (node, name) => String(node.attributes.class ?? "").split(/\s+/u).includes(name);
const currentComponents = f => [...f.renderer.instances.values()].map(record => record.instance).filter(owner => owner.isConnected);
const snapshot = f => structuredClone({ events: f.store.events.get(), head: f.store.head.get(), content: f.store.content.get(),
  authority: f.store.captureAuthorizationScope()?.key, user: f.store.session.get().user, impersonation: f.store.session.get().impersonation,
  budgets: f.store.session.get().budgets, costBudgets: f.store.session.get().costBudgets,
  credentials: f.service.credentials, tokenCount: f.service.tokenCount });

function commandNativeClose(t, f) {
  // Exact current calm-full-page command-dialog port: synchronous open removal,
  // then one native close task. The legacy Settings fixture's synchronous event
  // would reenter Shell before it retires the original command presentation.
  const tasks = new Set(); let disposed = false;
  const collect = f.renderer.collect.bind(f.renderer);
  f.renderer.collect = (markup, owner) => {
    const start = f.renderer.nodes.length; collect(markup, owner);
    for (const node of f.renderer.nodes.slice(start)) if (node.tag === "dialog" && owner.tag === "forma-shell"
      && node.classList.contains("command-dialog")) node.close = () => {
      if (disposed || !node.open) return;
      f.trace.push("close:" + node.attributes.class); node.open = false; node.removeAttribute("open");
      const task = setImmediate(() => {
        tasks.delete(task); if (disposed) return; ports.bindFixture(f);
        const event = { type: "close", target: node, currentTarget: node, bubbles: false, cancelable: false };
        node.handlers.close?.call(owner, event); node.listeners?.close?.(event);
      });
      tasks.add(task);
    };
  };
  t.after(() => { disposed = true; for (const task of tasks) clearImmediate(task); tasks.clear(); });
  return tasks;
}

async function settingsCommandFixture(t, { locale = "en", policy = false } = {}) {
  const x = await workspaceFragmentFixture(t), { f, service } = x;
  const { FormaAccountSettings } = await ports.loadActual("src/components/forma-account-settings.ts");
  f.renderer.registry["forma-account-settings"] = FormaAccountSettings;
  const reply = service.reply;
  service.reply = request => request.url === "/api/shares" && method(request) === "GET"
    ? { status: 200, body: { shares: [] } } : reply(request);
  // Existing live LocaleController publication; every actual current child uses
  // the same controller. No translated fixture replacement or new permission.
  const language = memberReadLiveLocale(f); language.change(locale);
  // A non-English catalog changes the native renderer's template path. Join
  // the actual newly connected Settings owner's reads before using its forms;
  // the established flush keeps its original finite turns and native RAFs.
  await f.flush();
  if (policy) x.policy = retentionNativeForm(f, { owner: x.currentOwner });
  x.closeTasks = commandNativeClose(t, f);
  x.focus = installOutputNavigationFocusNative(t, f, ports);
  nativeDefaultProperties(x);
  x.original = snapshot(f); x.sourceOwner = x.currentOwner(); x.route = f.store.route.get();
  assert.equal(x.sourceOwner.tag, "forma-workspace-settings"); assert.equal(f.host.tag, "forma-shell");
  assert.equal(service.writes.length, 0); assert.equal(service.pending, 0);
  x.unchanged = () => { assert.deepEqual(snapshot(f), x.original); f.assertNoExternal(); };
  return x;
}

async function chooseAccountCommand(x) {
  const { f } = x; f.draw();
  const trigger = f.find("button", node => node.owner === f.host && hasClass(node, "command-trigger"));
  trigger.port.focus(); f.click(trigger); await f.flush();
  assert.equal(f.store.ui.commandOpen, true, "Actual current Shell trigger opened commands");
  const label = f.i18n.t("command.openSettings", "Review personal privacy and usage");
  const search = f.find("input", node => node.owner === f.host && node.attributes.id === "command-search");
  assert.equal(search.attributes.role, "combobox"); search.port.value = label;
  search.handlers.input.call(search.owner, { type: "input", target: search.port, currentTarget: search.port, preventDefault() {}, stopPropagation() {} });
  f.draw();
  const action = f.find("button", node => node.owner === f.host && node.attributes.role === "option" && node.text.includes(label));
  assert.equal(action.attributes.tabindex, "-1"); f.click(action); await f.flush();
  assert.equal(f.store.ui.commandOpen, false, "The original native command presentation closes on either outcome");
  assert.equal(x.closeTasks.size, 0, "The original queued native close event has actually been delivered");
}

function refused(x) {
  const { f } = x;
  assert.equal(f.store.route.get(), x.route, "Current raw or pending Workspace work blocks the actual departing command");
  assert.equal(x.currentOwner(), x.sourceOwner); assert.equal(x.sourceOwner.isConnected, true);
  assert.equal(currentComponents(f).some(owner => owner.tag === "forma-account-settings"), false);
  assert.equal(f.store.ui.toast, f.i18n.t("next.lifecycle.currentWorkOpen"), "Refusal is the current locale's existing owner guidance");
  x.unchanged();
}

function arrived(x) {
  const { f } = x;
  assert.equal(f.store.route.get(), "/settings");
  assert.equal(currentComponents(f).filter(owner => owner.tag === "forma-account-settings").length, 1, "Actual AccountSettings destination mounted");
  assert.equal(x.currentOwner(), null); assert.equal(x.sourceOwner.isConnected, false);
  assert.equal(serviceCount(x, "GET", "/api/shares"), 1, "The destination performed its real mount-triggered scoped read once");
  x.unchanged();
}

const serviceCount = (x, verb, url) => x.service.requests.filter(request => method(request) === verb && request.url === url).length;
function oneOriginalInvitation(x) {
  assert.equal(x.service.writes.length, 1);
  assert.deepEqual(x.service.writes[0].body, invitation.a);
  assert.equal(x.service.writes[0].method, "POST"); assert.equal(x.service.writes[0].url, invitation.url);
  assert.equal(x.service.writes[0].receipt.invitationId, "finite-original-invitation-A");
  assert.equal(x.finite.invitations.length, 1, "The existing finite service has exactly one original receipt, not a Worker claim");
  assert.equal(serviceCount(x, "POST", invitation.url), 1);
}

test("Creator Workspace clean native defaults allow the actual Account command", options, async t => {
  const x = await settingsCommandFixture(t);
  assert.deepEqual(x.native.raw(x.native.current().port), x.native.defaults());
  await chooseAccountCommand(x); arrived(x); assert.equal(x.service.writes.length, 0);
  const back = x.f.find("a", node => node.attributes.href === "/settings/workspaces"
    && node.owner.tag === "forma-account-settings");
  x.f.click(back); await x.f.flush();
  assert.equal(x.f.store.route.get(), "/settings/workspaces");
  assert.equal(x.currentOwner()?.tag, "forma-workspace-settings", "Immediate-only Account controls require no invented draft facade");
  x.unchanged();
});

for (const locale of ["en", "ja"]) test("Creator Workspace raw invitation refuses departure until native clear " + locale, options, async t => {
  const x = await settingsCommandFixture(t, { locale }), raw = { email: "unsent-work@example.invalid", role: "administrator" };
  const originalForm = x.native.fill(raw).port;
  await chooseAccountCommand(x); refused(x);
  assert.equal(x.native.current().port, originalForm); assert.deepEqual(x.native.raw(originalForm), raw);
  assert.equal(x.service.writes.length, 0);
  x.native.fill(x.native.defaults());
  await chooseAccountCommand(x); arrived(x); assert.equal(x.service.writes.length, 0);
});

test("Creator Workspace pending original invitation still blocks after deliberate native clear", options, async t => {
  const x = await settingsCommandFixture(t), { f, service } = x;
  const gate = service.queue(request => method(request) === "POST" && request.url === invitation.url, "body");
  x.native.fill(invitation.a); x.native.submit(); await gate.bodyStarted.promise; await f.flush();
  oneOriginalInvitation(x); assert.equal(gate.jsonCalls, 1);
  x.native.fill(x.native.defaults());
  const pendingButton = x.native.button(x.native.current());
  assert.equal(Object.hasOwn(pendingButton.attributes, "disabled"), true, "Original current operation is still visibly pending");
  await chooseAccountCommand(x); refused(x);
  assert.deepEqual(x.native.raw(x.native.current().port), x.native.defaults());
  gate.release.resolve(); await f.flush();
  assert.equal(Object.hasOwn(x.native.button(x.native.current()).attributes, "disabled"), false);
  assert.equal(x.native.resets.length, 0, "Original A must not reset the deliberately cleared later form");
  oneOriginalInvitation(x); await chooseAccountCommand(x); arrived(x); oneOriginalInvitation(x);
});

test("Creator Workspace original acknowledged Save resets unchanged form and permits fresh departure", options, async t => {
  const x = await settingsCommandFixture(t);
  x.native.fill(invitation.a); x.native.submit(); await x.f.flush();
  oneOriginalInvitation(x); assert.equal(x.native.resets.length, 1);
  assert.deepEqual(x.native.raw(x.native.current().port), x.native.defaults());
  assert.equal(x.notice(), x.saved());
  await chooseAccountCommand(x); arrived(x); oneOriginalInvitation(x);
});

test("Creator Workspace actual policy Discard releases its existing dirty owner", options, async t => {
  const x = await settingsCommandFixture(t, { policy: true, locale: "ja" }), { f } = x;
  const defaults = x.policy.values("security");
  const form = x.policy.fill({ ...defaults, allowedDomains: "newer-unsent.example.invalid" }, "security").port;
  assert.equal(form.getAttribute("data-workspace-policy-dirty"), "true");
  await chooseAccountCommand(x); refused(x);
  assert.equal(x.policy.current("security").port, form);
  assert.equal(x.policy.values("security").allowedDomains, "newer-unsent.example.invalid");
  x.policy.discard("security"); await f.flush();
  assert.deepEqual(x.policy.values("security"), defaults);
  assert.notEqual(form.getAttribute("data-workspace-policy-dirty"), "true");
  await chooseAccountCommand(x); arrived(x); assert.equal(x.service.writes.length, 0);
});

test("Creator Workspace native section and organization choices retain unsent invitation", options, async t => {
  const x = await settingsCommandFixture(t), { f } = x, raw = invitation.b;
  const form = x.native.fill(raw).port;
  const usage = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement === x.sourceOwner && node.attributes.href === settingsPath("A", "usage"));
  f.click(usage); await f.flush(); refused(x); assert.deepEqual(x.native.raw(form), raw);
  const organization = f.find("select", node => node.owner === x.sourceOwner && !node.attributes.name
    && String(node.handlers.change).includes("/settings/workspaces/"));
  const target = "settings-org-B";
  assert.ok(f.tree().nodes.some(node => node.tag === "option" && within(node, organization) && node.attributes.value === target));
  organization.port.value = target;
  organization.handlers.change.call(organization.owner, { type: "change", target: organization.port, currentTarget: organization.port,
    preventDefault() {}, stopPropagation() {} });
  assert.equal(organization.port.value, "settings-org-A", "Refused selection immediately shows its still-current organization");
  await f.flush(); refused(x); assert.deepEqual(x.native.raw(form), raw); assert.equal(x.service.writes.length, 0);
  x.native.fill(x.native.defaults());
  const fresh = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement === x.sourceOwner && node.attributes.href === settingsPath("A", "usage"));
  f.click(fresh); await f.flush();
  assert.equal(f.store.route.get(), settingsPath("A", "usage")); x.unchanged();
});

// C121 residuals. Explicit finite Settings DTOs only; these are not actual
// shared-project permission, context-cookie, package-approval or Worker proofs.
async function contextPackageExitFixture(t, { shared = false, review = false } = {}) {
  assert.equal(shared && review, false, "The two finite scenarios stay separate");
  const x = await settingsCommandFixture(t, { policy: true }), { f, service } = x;
  const organizationId = "settings-org-A", root = "/api/workspaces/" + organizationId;
  let project = null, documentId = "", scopedEvents = [];
  if (shared) {
    const response = await f.storeHost.fetch(root), detail = await response.json();
    assert.equal(response.status, 200); assert.equal(detail.organization.organizationId, organizationId);
    project = detail.projects[0]; assert.ok(project?.project_access_id && project.project_id && project.owner_user_id);
    // The reused setup adds a later, empty Project B. Its current Settings
    // projection therefore has no Document; the exact original A still exists
    // in the canonical personal event stream. Do not invent a current selection.
    const events = f.store.events.get(), opened = events.filter(event => event.type === "DocumentOpened");
    assert.equal(opened.length, 1, "The existing finite source has exactly one declared Document opening");
    const originalProject = opened[0].payload.project_id; documentId = opened[0].payload.document_id;
    assert.ok(typeof originalProject === "string" && originalProject && typeof documentId === "string" && documentId);
    assert.equal(f.store.projection.get().projects.filter(value => value.id === originalProject).length, 1);
    assert.equal(f.store.session.get().projectContext, undefined, "Derive only from this fixture's original personal source");
    const source = events.filter(event => event.payload.project_id === originalProject
      && ["ProjectCreated", "DocumentCreated", "DocumentOpened"].includes(event.type));
    assert.deepEqual(source.map(event => event.type), ["ProjectCreated", "DocumentCreated", "DocumentOpened"]);
    assert.equal(source[1].payload.document_id, documentId); assert.equal(source[2].payload.document_id, documentId);
    const stream = "creative:" + f.store.session.get().user.userId;
    assert.ok(source.every(event => event.streamId === stream), "Every cloned event belongs to the current finite principal");
    scopedEvents = source.map((event, index) => ({ ...structuredClone(event),
      eventId: "finite-settings-shared-" + event.eventId, streamId: "project:" + project.project_access_id,
      sequence: index + 1, payload: { ...structuredClone(event.payload), project_id: project.project_id } }));
  }
  const packageId = "package-A", draftId = "finite-pending-package-version-A";
  const reply = service.reply;
  service.reply = request => {
    assert.equal(method(request), "GET", "These controls never approve, adopt, grant, create or change a context cookie");
    const url = new URL(request.url, "http://localhost");
    if (shared && url.pathname === "/api/workspaces") {
      const original = reply(request); assert.equal(original.status, 200);
      original.body.projects = [{ organizationId, projectAccessId: project.project_access_id, projectId: project.project_id,
        projectName: project.project_name, role: "editor" }];
      return original;
    }
    if (shared && url.pathname === "/api/events") return { status: 200,
      body: { events: structuredClone(scopedEvents.filter(event => event.sequence > Number(url.searchParams.get("after") ?? 0))),
        head: scopedEvents.length, content: {}, hasMore: false } };
    if (url.pathname === root + "/context-packages") {
      if (shared) return { status: 200, body: { packages: [] } };
      const original = reply(request); assert.equal(original.status, 200);
      const item = original.body.packages.find(value => value.id === packageId); assert.ok(item);
      return { status: 200, body: { packages: [{ ...structuredClone(item),
        pendingDraftVersionId: draftId, pendingDraftVersion: 2, canApprove: true,
        draftPreview: [{ handle: "direction/finite-reviewed-context", type: "direction", text: "Finite review decision",
          locked: false, intent: "include", active: true, exactText: null, exactPlacements: [],
          protectedPhrases: [], relations: [], sourceName: null, rightsExpiresAt: null }] }] } };
    }
    return reply(request);
  };
  if (shared) {
    // A declared finite positive session/Source scenario, not a context write or
    // private Store field. Derive its exact org/access/project/owner tuple from
    // the already authorized finite GET above. The actual Store consumes both
    // its new session and matching project-stream response normally.
    service.bump({ projectContext: { organizationId, projectAccessId: project.project_access_id,
      projectId: project.project_id, ownerUserId: project.owner_user_id, role: "editor",
      permissions: ["project.read", "project.author", "project.library.manage"],
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString() },
    projects: [{ organizationId, projectAccessId: project.project_access_id, projectId: project.project_id,
      projectName: project.project_name, role: "editor" }] });
    await f.store.refreshSession(); await f.store.refreshEvents({ fromStart: true }); await f.flush();
    assert.equal(f.store.projection.get().projectId, project.project_id);
    assert.equal(f.store.projection.get().documentId, documentId);
    assert.deepEqual(f.store.events.get(), scopedEvents);
    const context = f.store.session.get().projectContext;
    assert.equal(context.organizationId, organizationId); assert.equal(context.projectAccessId, project.project_access_id);
    assert.equal(context.permissions.includes("project.library.manage"), true);
    assert.equal(f.store.sourceOwnershipActive(f.store.captureSourceOwnership()), true);
  }
  const current = x.currentOwner(); assert.ok(current?.isConnected);
  const overview = f.find("a", node => node.owner.tag === "forma-ui-audience-navigation"
    && node.owner.parentElement === current && node.attributes.href === settingsPath("A", "overview"));
  f.click(overview); await f.flush();
  assert.equal(f.store.route.get(), settingsPath("A", "overview"));
  assert.equal(service.pending, 0); assert.equal(service.writes.length, 0);
  x.sourceOwner = x.currentOwner(); x.route = f.store.route.get(); x.original = snapshot(f);
  x.documentId = documentId; x.packageId = packageId; x.draftId = draftId;
  x.requestStart = service.requests.length;
  return x;
}

function currentContextLibraryButton(x) {
  const { f } = x, label = f.i18n.system("Choose exact decisions and licensed sources in the Library");
  const node = f.find("button", row => row.owner === x.currentOwner() && row.text === label);
  assert.equal(node.attributes.type, "button"); assert.ok(!node.hiddenBy);
  return node;
}

function exactLibraryRoute(x) {
  const url = new URL(x.f.store.route.get(), "http://localhost");
  assert.equal(url.pathname, "/library"); assert.deepEqual(url.searchParams.getAll("document"), [x.documentId]);
  assert.equal(x.service.writes.length, 0); x.unchanged();
}

test("Creator Settings current scoped Library button admits pristine overview", options, async t => {
  const x = await contextPackageExitFixture(t, { shared: true });
  const current = currentContextLibraryButton(x); x.f.click(current);
  // Current native handler + canonical route commit only. Destination rendering
  // and physical focus are deliberately not represented by this finite fixture.
  exactLibraryRoute(x);
});

test("Creator Settings scoped Library button retains raw policy until actual Discard", options, async t => {
  const x = await contextPackageExitFixture(t, { shared: true }), { f } = x;
  const defaults = x.policy.values("security"), raw = { ...defaults, allowedDomains: "unsent-library-exit.example.invalid" };
  const form = x.policy.fill(raw, "security").port;
  assert.equal(form.getAttribute("data-workspace-policy-dirty"), "true");
  f.click(currentContextLibraryButton(x));
  assert.equal(f.store.route.get(), x.route, "Actual ordinary Library button cannot bypass current Settings work");
  assert.equal(x.currentOwner(), x.sourceOwner); assert.equal(form.isConnected, true);
  assert.deepEqual(x.policy.values("security"), raw); assert.equal(serviceCount(x, "POST", invitation.url), 0); x.unchanged();
  x.policy.discard("security"); await f.flush();
  assert.deepEqual(x.policy.values("security"), defaults);
  f.click(currentContextLibraryButton(x)); exactLibraryRoute(x);
});

function openCurrentPackageReview(x) {
  const { f } = x;
  const label = f.i18n.t("workspace.context.review");
  const tree = f.tree(), summaries = tree.visible("summary").filter(row => row.owner === x.currentOwner() && row.text === label);
  assert.equal(summaries.length, 1); const summary = summaries[0];
  const details = summary.parent; assert.equal(details.tag, "details"); assert.ok(details.port?.isConnected);
  // The legacy fullPageTree maps identical literal tags to their first native
  // occurrence. Qualify this ONE package's actual first details/summary pair;
  // do not borrow that port for a later disclosure or claim multi-row coverage.
  for (const [tag, chosen] of [["details", details], ["summary", summary]]) {
    const rows = tree.nodes.filter(row => row.tag === tag && row.owner === chosen.owner);
    const native = f.renderer.nodes.filter(node => node.tag === tag && node.owner === chosen.owner);
    assert.equal(rows.length, native.length); assert.equal(rows[0], chosen); assert.equal(chosen.port, native[0]);
  }
  assert.equal(summary.handlers.click, undefined, "This is the current native inline disclosure, not a command menu");
  assert.equal(details.port.open, false); summary.port.click();
  // Same native-summary default port as output-reachability-fixture: it opens
  // the existing disclosure without a Lit draw or application command.
  details.port.open = true;
  const forms = f.tree().visible("form").filter(row => row.owner === x.currentOwner()
    && String(row.handlers.submit).includes("approveOrganizationContextPackage"));
  assert.equal(forms.length, 1);
  const fields = f.tree().visible("input").filter(row => within(row, forms[0]) && row.attributes.type === "checkbox");
  assert.equal(fields.length, 1); const field = fields[0];
  assert.equal(Object.hasOwn(field.attributes, "required"), true);
  assert.equal(field.parent.tag, "label");
  assert.ok(field.parent.text.includes(f.i18n.system("I reviewed these decisions, sources, and changes to finished outputs.")));
  assert.equal(field.port.checked, false); assert.equal(field.handlers.click, undefined); assert.equal(field.handlers.change, undefined);
  return { form: forms[0], field, details };
}

function nativeReviewCheck(x, current, checked) {
  const { field } = current;
  assert.ok(field.port.isConnected && !field.hiddenBy); assert.equal(Object.hasOwn(field.attributes, "disabled"), false);
  assert.notEqual(field.port.checked, checked); field.port.click();
  // Existing policy-native ports also deliver native checkedness explicitly.
  // No app handler/state is replaced; this source checkbox has none.
  field.port.checked = checked; assert.equal(field.port.checked, checked);
  assert.equal(x.service.writes.length, 0, "Checking the attestation is preparation, not an approval");
}

async function currentBrandDeparture(x) {
  const brand = x.f.find("button", node => node.owner === x.f.host && hasClass(node, "brand"));
  assert.ok(!brand.hiddenBy); await x.f.click(brand);
}

test("Creator Settings unchecked package review permits native ordinary departure", options, async t => {
  const x = await contextPackageExitFixture(t, { review: true });
  openCurrentPackageReview(x); await currentBrandDeparture(x);
  assert.equal(x.f.store.route.get(), "/projects"); assert.equal(x.service.writes.length, 0); x.unchanged();
});

test("Creator Settings checked package preparation requires explicit native uncheck before departure", options, async t => {
  const x = await contextPackageExitFixture(t, { review: true }), current = openCurrentPackageReview(x);
  nativeReviewCheck(x, current, true); await currentBrandDeparture(x);
  assert.equal(x.f.store.route.get(), x.route, "A required checked review preparation cannot disappear through the ordinary Shell exit");
  assert.equal(x.currentOwner(), x.sourceOwner); assert.equal(current.form.port.isConnected, true);
  assert.equal(current.field.port.checked, true); assert.equal(x.service.writes.length, 0); x.unchanged();
  nativeReviewCheck(x, current, false); await currentBrandDeparture(x);
  assert.equal(x.f.store.route.get(), "/projects"); assert.equal(x.service.writes.length, 0); x.unchanged();
});

test("Creator Settings edited pilot configuration offers a local no-write native reset before departure", options, async t => {
  const x = await settingsCommandFixture(t), { f } = x;
  // Reuse the exact existing generic raw-form adapter with this actual form's
  // emitted submit marker. Do not install a new form state or enable a pilot.
  const pilot = nativeFormLifetime(f, { id: "pilot-configuration", marker: "#configurePilot" }, { owner: x.currentOwner });
  nativeDefaultProperties(x);
  const defaults = pilot.defaults();
  assert.deepEqual(defaults, { participants: "10", participantUsd: "15", organizationUsd: "150", evidenceDays: "365" });
  const raw = { participants: "12", participantUsd: "14", organizationUsd: "140", evidenceDays: "366" };
  const form = pilot.fill(raw).port; assert.deepEqual(pilot.raw(form), raw);
  await chooseAccountCommand(x); refused(x);
  assert.equal(pilot.current().port, form); assert.deepEqual(pilot.raw(form), raw);
  const node = f.tree().visible("form").find(row => row.port === form); assert.ok(node);
  const resets = f.tree().visible("button").filter(row => within(row, node) && row.attributes.type === "reset");
  assert.equal(resets.length, 1, "Edited pilot defaults need a visible local no-write reset, not remembered values or a consequential submit");
  const reset = resets[0], action = f.i18n.t("workspace.admin.discardPolicy");
  const submit = pilot.button(node);
  assert.equal(reset.parent.tag, "forma-ui-cluster");
  assert.equal(submit.parent.component, reset.parent.component);
  assert.equal(reset.parent.attributes.alignment, "stretch", "Both actual native peers reuse the existing stretch/wrap group");
  assert.equal(reset.text, action);
  assert.equal(reset.attributes["aria-label"], f.i18n.t("artifact.delivery.namedAction", "{action} — {name}", {
    action, name: "\u2068" + f.i18n.system("Controlled pilot") + "\u2069" }));
  assert.equal(Object.hasOwn(reset.attributes, "disabled"), false);
  assert.equal(reset.handlers.click, undefined); assert.equal(node.handlers.reset, undefined);
  assert.equal(pilot.resets.length, 0); reset.port.click();
  // RendererPort models button invocation, not the HTML form-reset default.
  // Deliver that default to this exact retained form's existing native reset.
  form.reset(); f.draw();
  assert.equal(pilot.resets.length, 1); assert.deepEqual(pilot.raw(pilot.current().port), defaults);
  assert.equal(x.service.writes.length, 0); x.unchanged();
  await chooseAccountCommand(x); arrived(x); assert.equal(x.service.writes.length, 0);
});
